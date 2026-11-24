const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Batch = require("../../models/batchModel");
const Student = require("../../models/studentModel");
const ProgressReport = require("../../models/progressReportModel");
const AppSettings = require("../../models/appSettingsModel");
const sms = require("../../adapters/sms");
const email = require("../../adapters/email");
const { staffBatchIds } = require("../../utils/staffBatchIds");
const reports = require("../../utils/progressReports");

// Progress reports for staff (utils/progressReports.js): the settings that
// apply everywhere (owner, admin), each batch's schedule and recipients
// (teachers on their own batches too), a preview, Send now, and the
// delivery log with resend.

const isAdmin = (req) => ["owner", "admin"].includes(req.user.role);

const assertBatch = async (req, res, id) => {
  if (req.user.role === "grader") { res.status(403); throw new Error("Graders don't manage progress reports."); }
  if (!mongoose.isValidObjectId(id)) { res.status(404); throw new Error("Batch not found."); }
  const ids = await staffBatchIds(req.user);
  if (ids && !ids.some((x) => String(x) === String(id))) { res.status(403); throw new Error("You are not assigned to this batch."); }
  const batch = await Batch.findById(id).select("name progressReports");
  if (!batch) { res.status(404); throw new Error("Batch not found."); }
  return batch;
};

const globalShape = async (settings) => ({
  ...(settings.progressReports?.toObject?.() || settings.progressReports || {}),
  timezoneUsed: reports.zoneOf(settings),
  smsReady: sms.configured(),
  emailReady: email.configured(),
  usedThisMonth: await reports.smsPartsThisMonth(),
  currency: settings.defaultCurrency || "",
});

//@desc   Settings that apply to every batch's reports
//@route  GET /api/grading/progress-reports/settings
const getSettings = asyncHandler(async (req, res) => {
  res.json(await globalShape(await AppSettings.get()));
});

//@route  PUT /api/grading/progress-reports/settings (owner, admin)
const updateSettings = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) { res.status(403); throw new Error("Only an owner or admin can change these."); }
  const settings = await AppSettings.get();
  const cur = settings.progressReports?.toObject?.() || {};
  const b = req.body || {};
  const next = { ...cur };
  if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
  if (b.timezone !== undefined) {
    const tz = String(b.timezone || "").trim();
    if (tz) {
      try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { res.status(400); throw new Error(`"${tz}" isn't a time zone (e.g. Asia/Dhaka).`); }
    }
    next.timezone = tz;
  }
  if (b.phoneCountry !== undefined) next.phoneCountry = String(b.phoneCountry || "").trim().toUpperCase().slice(0, 2);
  if (b.smsMonthlyCap !== undefined) next.smsMonthlyCap = Math.max(0, Math.floor(Number(b.smsMonthlyCap) || 0));
  if (b.smsPartCost !== undefined) next.smsPartCost = Math.max(0, Number(b.smsPartCost) || 0);
  if (b.studentCanEditGuardian !== undefined) next.studentCanEditGuardian = Boolean(b.studentCanEditGuardian);
  if (b.linkDays !== undefined) next.linkDays = Math.min(365, Math.max(1, Math.floor(Number(b.linkDays) || 60)));
  settings.progressReports = next;
  settings.markModified("progressReports");
  await settings.save();
  res.json(await globalShape(settings));
});

const batchShape = (batch) => {
  const c = batch.progressReports?.toObject?.() || batch.progressReports || {};
  return {
    enabled: Boolean(c.enabled), frequency: c.frequency || "weekly", weekday: c.weekday ?? 5, monthDay: c.monthDay ?? 1, hour: c.hour ?? 20,
    student: { sms: Boolean(c.student?.sms), email: c.student?.email !== false },
    guardian: { sms: c.guardian?.sms !== false, email: c.guardian?.email !== false },
    language: c.language || "en", showRank: c.showRank !== false, instantResult: Boolean(c.instantResult), lastPeriod: c.lastPeriod || "",
  };
};

//@desc   Every batch you can see, with its report schedule
//@route  GET /api/grading/progress-reports/batches
const listBatches = asyncHandler(async (req, res) => {
  if (req.user.role === "grader") { res.status(403); throw new Error("Graders don't manage progress reports."); }
  const ids = await staffBatchIds(req.user);
  const list = await Batch.find(ids ? { _id: { $in: ids } } : {}).select("name isActive progressReports").sort({ name: 1 }).lean();
  res.json({ batches: list.map((b) => ({ _id: b._id, name: b.name, isActive: b.isActive, ...batchShape(b) })) });
});

//@desc   One batch's report settings and a preview of the next report
//@route  GET /api/grading/progress-reports/batch/:id
const getBatch = asyncHandler(async (req, res) => {
  const batch = await assertBatch(req, res, req.params.id);
  res.json({ _id: batch._id, name: batch.name, settings: batchShape(batch), preview: await reports.preview(batch) });
});

//@route  PUT /api/grading/progress-reports/batch/:id
const updateBatch = asyncHandler(async (req, res) => {
  const batch = await assertBatch(req, res, req.params.id);
  const b = req.body || {};
  const c = batchShape(batch);
  const bool = (v, d) => (v === undefined ? d : Boolean(v));
  const next = {
    ...c,
    enabled: bool(b.enabled, c.enabled),
    frequency: ["weekly", "biweekly", "monthly"].includes(b.frequency) ? b.frequency : c.frequency,
    weekday: b.weekday !== undefined ? Math.min(6, Math.max(0, Math.floor(Number(b.weekday) || 0))) : c.weekday,
    monthDay: b.monthDay !== undefined ? Math.min(28, Math.max(1, Math.floor(Number(b.monthDay) || 1))) : c.monthDay,
    hour: b.hour !== undefined ? Math.min(23, Math.max(0, Math.floor(Number(b.hour) || 0))) : c.hour,
    student: { sms: bool(b.student?.sms, c.student.sms), email: bool(b.student?.email, c.student.email) },
    guardian: { sms: bool(b.guardian?.sms, c.guardian.sms), email: bool(b.guardian?.email, c.guardian.email) },
    language: ["en", "bn"].includes(b.language) ? b.language : c.language,
    showRank: bool(b.showRank, c.showRank),
    instantResult: bool(b.instantResult, c.instantResult),
  };
  // Turning reports on mid-period: the send already past is marked done,
  // so switching on never fires a report for a stretch nobody chose.
  if (next.enabled && !c.enabled) {
    const occ = reports.lastOccurrence(next, new Date(), reports.zoneOf(await AppSettings.get()));
    if (occ) next.lastPeriod = occ.key;
  }
  batch.progressReports = next;
  batch.markModified("progressReports");
  await batch.save();
  res.json({ _id: batch._id, name: batch.name, settings: batchShape(batch), preview: await reports.preview(batch) });
});

//@desc   Send this batch's report now, for the stretch ending now (owner, admin)
//@route  POST /api/grading/progress-reports/batch/:id/send-now
const sendNow = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) { res.status(403); throw new Error("Only an owner or admin can send reports now."); }
  const batch = await assertBatch(req, res, req.params.id);
  const settings = await AppSettings.get();
  if (!settings.progressReports?.enabled) { res.status(400); throw new Error("Turn progress reports on first (Progress reports → Settings)."); }
  const only = Array.isArray(req.body?.students) && req.body.students.length ? new Set(req.body.students.map(String)) : null;
  res.json(await reports.runNow(batch, { onlyStudents: only }));
});

//@desc   Reports sent: who, when, how each message went
//@route  GET /api/grading/progress-reports/log?batch=&status=&kind=&page=
const getLog = asyncHandler(async (req, res) => {
  if (req.user.role === "grader") { res.status(403); throw new Error("Graders don't manage progress reports."); }
  const query = {};
  if (req.query.batch) { await assertBatch(req, res, req.query.batch); query.batch = req.query.batch; }
  else {
    const ids = await staffBatchIds(req.user);
    if (ids) query.batch = { $in: ids };
  }
  if (["sent", "partial", "failed", "nothing"].includes(req.query.status)) query.status = req.query.status;
  if (["periodic", "result"].includes(req.query.kind)) query.kind = req.query.kind;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  const [total, list] = await Promise.all([
    ProgressReport.countDocuments(query),
    ProgressReport.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("student", "name studentId").populate("batch", "name").lean(),
  ]);
  const settings = await AppSettings.get();
  res.json({
    page, pages: Math.max(1, Math.ceil(total / limit)), total,
    reports: list.map((r) => ({
      _id: r._id, kind: r.kind, period: r.period, status: r.status, createdAt: r.createdAt, openedAt: r.openedAt,
      student: r.student, batch: r.batch, smsText: r.smsText, link: reports.linkFor(r.token, settings),
      deliveries: r.deliveries.map((d) => ({ _id: d._id, recipient: d.recipient, channel: d.channel, to: d.to, status: d.status, error: d.error, parts: d.parts, at: d.at })),
    })),
  });
});

//@desc   Send a report's failed or skipped messages again (owner, admin)
//@route  POST /api/grading/progress-reports/log/:id/resend
const resend = asyncHandler(async (req, res) => {
  if (!isAdmin(req)) { res.status(403); throw new Error("Only an owner or admin can resend."); }
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404); throw new Error("Report not found."); }
  const report = await ProgressReport.findById(req.params.id);
  if (!report) { res.status(404); throw new Error("Report not found."); }
  await assertBatch(req, res, report.batch);
  const settings = await AppSettings.get();
  const retry = report.deliveries.filter((d) => d.status !== "sent");
  if (!retry.length) { res.status(400); throw new Error("Every message of this report was sent."); }
  // The contact may have been fixed since: send to what's on record now.
  const student = await Student.findById(report.student).select("email phoneNumber guardian").lean();
  const fresh = (d) => {
    if (d.recipient === "student") return d.channel === "sms" ? student?.phoneNumber : student?.email;
    if (student?.guardian?.optOut) return null;
    return d.channel === "sms" ? student?.guardian?.phone : student?.guardian?.email;
  };
  const targets = retry.map((d) => ({ recipient: d.recipient, channel: d.channel, to: fresh(d) || d.to }));
  const budget = { cap: settings.progressReports?.smsMonthlyCap || 0, used: await reports.smsPartsThisMonth() };
  const results = await reports.deliver(report, targets, { settings, budget });
  report.deliveries = [...report.deliveries.filter((d) => d.status === "sent"), ...results];
  const sent = report.deliveries.filter((d) => d.status === "sent").length;
  report.status = sent === report.deliveries.length ? "sent" : sent ? "partial" : "failed";
  await report.save();
  res.json({ status: report.status, deliveries: report.deliveries });
});

module.exports = { getSettings, updateSettings, listBatches, getBatch, updateBatch, sendNow, getLog, resend };
