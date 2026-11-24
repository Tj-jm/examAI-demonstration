const asyncHandler = require("express-async-handler");
const ProgressReport = require("../../models/progressReportModel");
const Student = require("../../models/studentModel");
const AppSettings = require("../../models/appSettingsModel");
const { cleanGuardian } = require("../../utils/guardian");
const { zoneOf } = require("../../utils/progressReports");

//@desc   A progress report from its link, no login: what it said when sent
//@route  GET /api/app/progress/:token
//@access Public — the token is the credential (96 random bits, expires)
const getReport = asyncHandler(async (req, res) => {
  const token = String(req.params.token || "");
  const report = /^[A-Za-z0-9_-]{16,32}$/.test(token) ? await ProgressReport.findOne({ token }).lean() : null;
  if (!report || report.expiresAt < new Date()) { res.status(404); throw new Error("This report link has expired or doesn't exist."); }
  if (!report.openedAt) ProgressReport.updateOne({ _id: report._id }, { $set: { openedAt: new Date() } }).catch(() => {});
  const settings = await AppSettings.get();
  res.set("Cache-Control", "no-store");
  res.json({
    kind: report.kind, frequency: report.frequency, language: report.language, createdAt: report.createdAt,
    timezone: zoneOf(settings), ...report.snapshot,
    brand: { name: settings.siteName || "", logo: settings.logo || null },
  });
});

const guardianShape = (g) => ({ name: g?.name || "", relation: g?.relation || "", phone: g?.phone || "", email: g?.email || "", optOut: Boolean(g?.optOut) });

//@desc   My guardian's contact, and whether I may change it
//@route  GET /api/app/account/guardian
const getGuardian = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.student._id).select("guardian").lean();
  const settings = await AppSettings.get();
  const g = guardianShape(student?.guardian);
  const isSet = Boolean(g.phone || g.email);
  res.json({ guardian: g, canEdit: !isSet || Boolean(settings.progressReports?.studentCanEditGuardian) });
});

//@desc   Add (or, where allowed, change) my guardian's contact
//@route  PUT /api/app/account/guardian
// Changing a contact staff entered is off by default: otherwise a student
// could point the reports to their own number.
const updateGuardian = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.student._id);
  const settings = await AppSettings.get();
  const cur = guardianShape(student.guardian);
  if ((cur.phone || cur.email) && !settings.progressReports?.studentCanEditGuardian) {
    res.status(403); throw new Error("Your guardian's contact is on record. Ask your institution to change it.");
  }
  const b = req.body || {};
  const { guardian, error } = cleanGuardian({ name: b.name, relation: b.relation, phone: b.phone, email: b.email }, cur, settings);
  if (error) { res.status(400); throw new Error(error); }
  guardian.optOut = cur.optOut; // staff's call, not the student's
  student.guardian = guardian;
  await student.save();
  res.json({ guardian: guardianShape(student.guardian), canEdit: Boolean(settings.progressReports?.studentCanEditGuardian) || !(guardian.phone || guardian.email) });
});

module.exports = { getReport, getGuardian, updateGuardian };
