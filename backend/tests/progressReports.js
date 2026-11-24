// Progress reports: schedule maths, wording and SMS parts, then (with
// TEST_MONGO_URL) a batch's reports end to end with stand-in gateways,
// no double send, the instant result, the public link, guardian rules.

process.env.NODE_ENV = "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const run = (fn, req) => new Promise((resolve) => {
  const res = { code: 200, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  fn({ query: {}, params: {}, body: {}, ...req }, res, (e) => resolve({ code: res.code, err: e?.message }));
});

(async () => {
  const r = require("../utils/progressReports");
  const tz = "Asia/Dhaka";
  console.log("schedule");
  const fri2030 = new Date("2026-10-16T14:30:00Z"); // Friday 20:30 in Dhaka
  const weekly = { enabled: true, frequency: "weekly", weekday: 5, hour: 20 };
  const occ = r.lastOccurrence(weekly, fri2030, tz);
  check("weekly: Friday 8 pm Dhaka is 14:00 UTC", occ.key === "2026-10-16" && occ.at.toISOString() === "2026-10-16T14:00:00.000Z");
  check("weekly: covers the 7 days before", occ.from.toISOString() === "2026-10-09T14:00:00.000Z");
  check("due once the hour has passed", r.dueOccurrence(weekly, fri2030, tz)?.key === "2026-10-16");
  check("not due before the hour", r.dueOccurrence({ ...weekly, hour: 21 }, fri2030, tz)?.key !== "2026-10-16");
  check("not due again once sent", r.dueOccurrence({ ...weekly, lastPeriod: "2026-10-16" }, fri2030, tz) === null);
  check("a send missed by over 12 hours is skipped", r.dueOccurrence(weekly, new Date("2026-10-17T06:00:00Z"), tz) === null);
  check("off means never due", r.dueOccurrence({ ...weekly, enabled: false }, fri2030, tz) === null);
  const bi = r.lastOccurrence({ frequency: "biweekly", weekday: 5, hour: 20 }, fri2030, tz);
  const biNext = r.lastOccurrence({ frequency: "biweekly", weekday: 5, hour: 20 }, new Date("2026-10-23T15:00:00Z"), tz);
  check("fortnightly: every other Friday, 14 days covered", biNext.key === bi.key && bi.at - bi.from === 14 * 86400000);
  const mo = r.lastOccurrence({ frequency: "monthly", monthDay: 1, hour: 9 }, fri2030, tz);
  check("monthly: the 1st, covering the month before", mo.key === "2026-10-01" && mo.from.toISOString() === "2026-09-01T03:00:00.000Z");
  check("next send is a week on", r.nextOccurrence(weekly, fri2030, tz).toISOString() === "2026-10-23T14:00:00.000Z");
  const ny = r.lastOccurrence({ frequency: "weekly", weekday: 0, hour: 9 }, new Date("2026-03-09T12:00:00Z"), "America/New_York");
  check("time zones with summer time: 9 am New York after the change is 13:00 UTC", ny.at.toISOString() === "2026-03-08T13:00:00.000Z", ny.at);

  console.log("wording");
  const snap = {
    student: { name: "Rahim Uddin" }, from: occ.from, to: occ.at,
    exams: [{ title: "Ch 3", marks: 45, total: 50, pct: 90, rank: 3, of: 42 }, { title: "Ch 4", marks: 33, total: 50, pct: 66, rank: 9, of: 40 }],
    avg: 78, prevAvg: 72, rank: 5, of: 42, missed: ["Mock 2"], live: { attended: 2, total: 3 }, assignments: { missing: [], total: 0, handed: 0 }, showRank: true,
  };
  const en = r.periodicSms(snap, { brand: "Udvash", link: "https://ex.am/progress/abcdefghijklmnop", tz, lang: "en", frequency: "weekly" });
  check("English SMS: exams, average with change, rank, missed, classes, link", /Rahim weekly report \(9-16 Oct\): 2 exams, avg 78% \(\+6\), rank 5\/42, missed 1, live classes 2\/3\. Details: https/.test(en), en);
  check("English weekly SMS fits one part", r.smsParts(en) === 1, en.length);
  const bn = r.periodicSms(snap, { brand: "Udvash", link: "https://ex.am/progress/abcdefghijklmnop", tz, lang: "bn", frequency: "weekly" });
  check("Bangla SMS in Bangla digits", /সাপ্তাহিক রিপোর্ট \(৯-১৬ অক্টো\): পরীক্ষা ২টি, গড় ৭৮% \(\+৬\), অবস্থান ৫\/৪২/.test(bn), bn);
  check("Bangla counts as Unicode (70 a part)", r.smsParts(bn) === Math.ceil([...bn].length / 67));
  const none = r.periodicSms({ ...snap, exams: [], avg: null, rank: null, missed: [] }, { brand: "", link: "", tz, lang: "en", frequency: "monthly" });
  check("no exams still reports, no link when there's no address", none === "Rahim monthly report (9-16 Oct): no exams taken, live classes 2/3.", none);
  const mail = r.emailFor(snap, { brand: "Udvash <b>", link: "https://x/p", tz, lang: "en", frequency: "weekly", kind: "periodic", smsText: en });
  check("email: subject, table, escaped brand", /weekly progress report/.test(mail.subject) && /<table/.test(mail.html) && /Udvash &lt;b&gt;/.test(mail.html) && /Ch 3: 45\/50 \(90%\)/.test(mail.text));
  check("SMS parts: 160 GSM, 153 after", r.smsParts("a".repeat(160)) === 1 && r.smsParts("a".repeat(161)) === 2);

  console.log("recipients");
  const cfg = { student: { sms: false, email: true }, guardian: { sms: true, email: true } };
  const t = r.targetsFor({ email: "s@x.com", phoneNumber: "+8801711111111", guardian: { phone: "+8801722222222", email: "g@x.com" } }, cfg);
  check("student email, guardian SMS and email", t.map((x) => `${x.recipient}:${x.channel}`).join(",") === "student:email,guardian:sms,guardian:email");
  check("guardian who opted out gets nothing", r.targetsFor({ guardian: { phone: "+8801722222222", optOut: true } }, cfg).length === 0);
  check("guardian with the student's own number isn't sent twice", r.targetsFor({ phoneNumber: "+8801711111111", guardian: { phone: "+8801711111111" } }, { student: { sms: true }, guardian: { sms: true } }).length === 1);

  const { cleanGuardian } = require("../utils/guardian");
  check("local guardian number takes the country from the currency", cleanGuardian({ phone: "01712345678" }, {}, { defaultCurrency: "BDT" }).guardian.phone === "+8801712345678");
  check("a bad number is refused", Boolean(cleanGuardian({ phone: "12" }, {}, {}).error));

  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, database checks skipped."); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|progress/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Student = require("../models/studentModel");
  const User = require("../models/userModel");
  const Purchase = require("../models/purchaseModel");
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const ProgressReport = require("../models/progressReportModel");
  const AppSettings = require("../models/appSettingsModel");
  const LiveClass = require("../models/liveClassModel");
  const LiveAttendance = require("../models/liveAttendanceModel");
  const staff = require("../controllers/admin/progressReportController");
  const app = require("../controllers/app/progressReportController");

  process.env.CLIENT_URL_STUDENT = "https://learn.example.com";
  const settings = await AppSettings.get();
  settings.siteName = "Udvash";
  settings.defaultCurrency = "BDT";
  settings.progressReports = { enabled: true, timezone: "Asia/Dhaka", smsMonthlyCap: 0, linkDays: 60 };
  await settings.save();

  const owner = await User.create({ name: "Owner", email: "o@example.com", password: "Passw0rd!x", role: "owner" });
  const teacher = await User.create({ name: "Teach", email: "t@example.com", password: "Passw0rd!x", role: "teacher" });
  const batch = await Batch.create({
    name: "Class 8", accessType: "paid", program: new mongoose.Types.ObjectId(), teachers: [teacher._id],
    progressReports: { enabled: true, frequency: "weekly", weekday: 5, hour: 20, student: { sms: false, email: true }, guardian: { sms: true, email: false }, language: "en", showRank: true, instantResult: true },
  });
  const other = await Batch.create({ name: "Class 9", accessType: "paid", program: new mongoose.Types.ObjectId() });
  const s1 = await Student.create({ name: "Rafi Ahmed", email: "r@example.com", password: "Passw0rd!x", isProfileComplete: true, guardian: { name: "Mr Ahmed", phone: "+8801711111111" } });
  const s2 = await Student.create({ name: "Nadia Islam", email: "n@example.com", password: "Passw0rd!x", isProfileComplete: true, guardian: { phone: "+8801722222222", optOut: true } });
  const s3 = await Student.create({ name: "Tamim", phoneNumber: "+8801733333333", password: "Passw0rd!x", isProfileComplete: true });
  for (const s of [s1, s2, s3]) await Purchase.create({ student: s._id, batch: batch._id, plan: { label: "Grant", price: 0, isInfinite: true }, provider: "manual", status: "complete" });

  const now = new Date();
  const day = 86400000;
  const e1 = await Exam.create({ title: "Chapter 3 test", durationMinutes: 30, batches: [batch._id], isPublished: true, isActive: true });
  const mock = await Exam.create({ title: "Mock 2", durationMinutes: 60, mode: "mock", liveHours: 2, batches: [batch._id], isPublished: true, isActive: true, opensAt: new Date(now - 2 * day) });
  await Submission.create({ exam: e1._id, student: s1._id, batch: batch._id, status: "graded", marks: 30, totalMarks: 50, attempt: 1, submittedAt: new Date(now - 3 * day) });
  await Submission.create({ exam: e1._id, student: s1._id, batch: batch._id, status: "graded", marks: 45, totalMarks: 50, attempt: 2, submittedAt: new Date(now - 2 * day) });
  await Submission.create({ exam: e1._id, student: s2._id, batch: batch._id, status: "graded", marks: 40, totalMarks: 50, attempt: 1, submittedAt: new Date(now - 2 * day) });
  await Submission.create({ exam: mock._id, student: s2._id, batch: batch._id, status: "graded", marks: 20, totalMarks: 50, attempt: 1, submittedAt: new Date(now - 2 * day) });
  await Submission.create({ exam: e1._id, student: s1._id, batch: batch._id, status: "graded", marks: 20, totalMarks: 50, attempt: 3, submittedAt: new Date(now - 9 * day) });
  const lc = await LiveClass.create({ title: "Class", batch: batch._id, host: teacher._id, scheduledAt: new Date(now - day), status: "ended", durationMinutes: 60 }).catch((e) => { console.log("live class seed:", e.message); return null; });
  if (lc) await LiveAttendance.create({ liveClass: lc._id, identity: `student:${s1._id}`, student: s1._id, totalSeconds: 1800 });

  const sentSms = [];
  const sentMail = [];
  const adapters = {
    sms: { configured: () => true, send: async (to, text) => { if (to === "+8801733333333") throw new Error("gateway down"); sentSms.push({ to, text }); } },
    email: { configured: () => true, send: async (to, subject, text, html) => { sentMail.push({ to, subject, html }); } },
  };

  console.log("a batch's reports");
  const fresh = await Batch.findById(batch._id);
  const counts = await r.runNow(fresh, { now, adapters });
  check("one report per student on the register", counts.students === 3, counts);
  const rep1 = await ProgressReport.findOne({ student: s1._id, kind: "periodic" }).lean();
  check("best attempt counts: 45/50, rank 1 of 2", rep1.snapshot.exams.length === 1 && rep1.snapshot.exams[0].marks === 45 && rep1.snapshot.exams[0].rank === 1 && rep1.snapshot.exams[0].of === 2, rep1.snapshot.exams);
  check("average change against the week before (+50)", rep1.snapshot.avg === 90 && rep1.snapshot.prevAvg === 40, rep1.snapshot);
  check("the closed mock they didn't sit is missed", rep1.snapshot.missed.join() === "Mock 2", rep1.snapshot.missed);
  if (lc) check("live class attendance 1/1", rep1.snapshot.live.attended === 1 && rep1.snapshot.live.total === 1, rep1.snapshot.live);
  check("guardian SMS with the link", sentSms.some((m) => m.to === "+8801711111111" && /Rafi weekly report/.test(m.text) && /https:\/\/learn\.example\.com\/progress\/[A-Za-z0-9_-]{16}/.test(m.text)), sentSms);
  check("student email sent", sentMail.some((m) => m.to === "r@example.com" && /<table/.test(m.html)));
  const rep2 = await ProgressReport.findOne({ student: s2._id, kind: "periodic" }).lean();
  check("opted-out guardian: student email only", rep2.deliveries.length === 1 && rep2.deliveries[0].recipient === "student");
  const rep3 = await ProgressReport.findOne({ student: s3._id, kind: "periodic" }).lean();
  check("student with no email and no guardian: nothing to send", rep3.status === "nothing" && rep3.deliveries.length === 0);
  const smsDelivery = rep1.deliveries.find((d) => d.channel === "sms");
  check("SMS parts recorded", smsDelivery.parts >= 1 && smsDelivery.parts === r.smsParts(rep1.smsText), { parts: smsDelivery.parts, text: rep1.smsText });

  console.log("schedule, once only");
  const due = new Date();
  const dueBatch = await Batch.findById(batch._id);
  dueBatch.progressReports.weekday = new Date(due.toLocaleString("en-US", { timeZone: "Asia/Dhaka" })).getDay();
  dueBatch.progressReports.hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", hour: "numeric", hourCycle: "h23" }).format(due)) % 24;
  dueBatch.progressReports.lastPeriod = "";
  dueBatch.markModified("progressReports");
  await dueBatch.save();
  const before = sentSms.length;
  const [a, b] = await Promise.all([r.runDue({ now: due, adapters }), r.runDue({ now: due, adapters })]);
  check("two servers at once: the batch goes out once", a.length + b.length === 1, { a, b });
  check("…and its messages once", sentSms.length - before === 1, sentSms.length - before);
  check("not again on the next tick", (await r.runDue({ now: new Date(due.getTime() + 600000), adapters })).length === 0);

  console.log("monthly SMS limit");
  settings.progressReports.smsMonthlyCap = await r.smsPartsThisMonth();
  settings.markModified("progressReports");
  await settings.save();
  const capped = await r.runNow(await Batch.findById(batch._id), { now: new Date(), adapters });
  check("over the limit: SMS skipped, email still sent", capped.skipped >= 1 && capped.sent >= 1, capped);
  settings.progressReports.smsMonthlyCap = 0;
  settings.markModified("progressReports");
  await settings.save();

  console.log("instant result");
  const sub = await Submission.create({ exam: e1._id, student: s3._id, batch: batch._id, status: "graded", marks: 25, totalMarks: 50, attempt: 1, submittedAt: new Date() });
  await Student.updateOne({ _id: s3._id }, { $set: { guardian: { phone: "+8801744444444" } } });
  const res1 = await r.sendResultMessage(sub._id, { adapters });
  check("result SMS: marks, rank among the batch", res1 && sentSms.some((m) => m.to === "+8801744444444" && /Tamim scored 25\/50 \(50%\) in "Chapter 3 test", rank 3\/3/.test(m.text)), sentSms.slice(-1));
  check("a regrade doesn't send it again", (await r.sendResultMessage(sub._id, { adapters })) === null);
  await Batch.updateOne({ _id: batch._id }, { $set: { "progressReports.instantResult": false } });
  const sub2 = await Submission.create({ exam: mock._id, student: s3._id, batch: batch._id, status: "graded", marks: 25, totalMarks: 50, attempt: 1, submittedAt: new Date() });
  check("batch switch off: no result message", (await r.sendResultMessage(sub2._id, { adapters })) === null);

  console.log("the link");
  const open = await run(app.getReport, { params: { token: rep1.token } });
  check("opens without login: name, exams, brand", open.code === 200 && open.body.student.name === "Rafi Ahmed" && open.body.exams.length === 1 && open.body.brand.name === "Udvash", open);
  check("a wrong token is not found", (await run(app.getReport, { params: { token: "x".repeat(16) } })).code === 404);
  await ProgressReport.updateOne({ _id: rep1._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  check("an expired link is not found", (await run(app.getReport, { params: { token: rep1.token } })).code === 404);

  console.log("staff");
  const asTeacher = { user: { _id: teacher._id, role: "teacher" } };
  check("teacher sees own batch's settings", (await run(staff.getBatch, { ...asTeacher, params: { id: String(batch._id) } })).code === 200);
  check("teacher can't open another batch", (await run(staff.getBatch, { ...asTeacher, params: { id: String(other._id) } })).code === 403);
  check("teacher can't Send now", (await run(staff.sendNow, { ...asTeacher, params: { id: String(batch._id) } })).code === 403);
  check("teacher can't change the global settings", (await run(staff.updateSettings, { ...asTeacher, body: { enabled: false } })).code === 403);
  const upd = await run(staff.updateBatch, { user: { _id: owner._id, role: "owner" }, params: { id: String(other._id) }, body: { enabled: true, frequency: "monthly", monthDay: 40, guardian: { sms: true, email: false }, language: "bn" } });
  check("switching on: monthly, day clamped to 28, Bangla", upd.code === 200 && upd.body.settings.frequency === "monthly" && upd.body.settings.monthDay === 28 && upd.body.settings.language === "bn", upd.body);
  check("switching on marks the past send done (no surprise send)", (await Batch.findById(other._id)).progressReports.lastPeriod !== "");
  check("preview: SMS count and coverage", upd.body.preview && typeof upd.body.preview.smsParts === "number" && upd.body.preview.coverage.students === 0);
  const log = await run(staff.getLog, { user: { _id: owner._id, role: "owner" }, query: { batch: String(batch._id), status: "partial" } });
  check("log filters by status", log.code === 200 && log.body.reports.every((x) => x.status === "partial"));
  const failedOne = await ProgressReport.findOne({ "deliveries.status": "failed" });
  if (failedOne) {
    const realSms = require("../adapters/sms");
    const saved = { configured: realSms.configured, send: realSms.send };
    realSms.configured = () => true;
    realSms.send = async () => {};
    const re = await run(staff.resend, { user: { _id: owner._id, role: "owner" }, params: { id: String(failedOne._id) } });
    Object.assign(realSms, saved);
    check("resend sends what failed", re.code === 200 && re.body.status === "sent", re);
  }

  console.log("guardian on the student's side");
  const asStudent = (s) => ({ student: { _id: s._id } });
  const g1 = await run(app.getGuardian, asStudent(s1));
  check("set by staff: the student can't change it", g1.body.canEdit === false);
  check("…and a change is refused", (await run(app.updateGuardian, { ...asStudent(s1), body: { phone: "01799999999" } })).code === 403);
  const s4 = await Student.create({ name: "New", email: "new@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const add = await run(app.updateGuardian, { ...asStudent(s4), body: { name: "Mum", relation: "Mother", phone: "01712345678" } });
  check("none on record: the student may add one (local number made international)", add.code === 200 && add.body.guardian.phone === "+8801712345678", add);

  console.log("import");
  const { importStudents } = require("../utils/studentImport");
  const imp = await importStudents([{ email: "r@example.com", guardianName: "Mrs Ahmed", guardianPhone: "01755555555", guardianEmail: "MA@example.com" }, { name: "Bad", email: "b@example.com", guardianPhone: "99" }]);
  const s1after = await Student.findById(s1._id).lean();
  check("guardian columns update the student", imp.updated === 1 && s1after.guardian.phone === "+8801755555555" && s1after.guardian.email === "ma@example.com" && s1after.guardian.name === "Mrs Ahmed", { imp, g: s1after.guardian });
  check("a bad guardian number is a row error", imp.errors.length === 1 && /guardian phone/.test(imp.errors[0].message), imp.errors);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
