// Support tickets, conduct and account deletion, against a real
// MongoDB-compatible server (skipped without TEST_MONGO_URL).

process.env.NODE_ENV = "test";

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

// Runs an express-async-handler controller with a fake req/res.
const run = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await new Promise((resolve) => {
    Promise.resolve(handler({ params: {}, query: {}, body: {}, ...req }, res, (err) => {
      if (err) { res.code = err.statusCode || (res.code === 200 ? 500 : res.code); res.body = { message: err.message }; }
      resolve();
    })).then(resolve);
  });
  return res;
};

(async () => {
  if (!process.env.TEST_MONGO_URL) {
    console.log("database: skipped (set TEST_MONGO_URL to run)");
    console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed\nPASS`);
    return;
  }
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.TEST_MONGO_URL);
  const Student = require("../models/studentModel");
  require("../models/batchModel");
  require("../models/examModel");
  const User = require("../models/userModel");
  const SupportTicket = require("../models/supportTicketModel");
  const Notification = require("../models/notificationModel");
  const StudentUpload = require("../models/studentUploadModel");
  await Promise.all([SupportTicket.deleteMany({}), Notification.deleteMany({}), StudentUpload.deleteMany({})]);

  const student = { _id: new mongoose.Types.ObjectId() };
  const other = { _id: new mongoose.Types.ObjectId() };
  const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };
  const teacher = { _id: new mongoose.Types.ObjectId(), role: "teacher" };

  console.log("\nsupport tickets");
  const app = require("../controllers/app/supportController");
  const staff = require("../controllers/admin/supportController");

  let out = await run(app.createTicket, { student, body: { category: "payment", subject: "Paid but no access", text: "I paid yesterday." } });
  check("a student opens a ticket", out.code === 201 && out.body.ticket.status === "open", out.body);
  const id = String(out.body.ticket._id);

  out = await run(app.createTicket, { student, body: { category: "nonsense", subject: "x", text: "y" } });
  check("an unknown category is refused", out.code === 400);
  out = await run(app.createTicket, { student, body: { category: "other", subject: "x", images: ["/media/support-images/not-mine.png"] } });
  check("an image the student didn't upload is refused", out.code === 400, out.body);
  await StudentUpload.create({ key: "support-images/mine.png", student: student._id, folder: "support-images" });
  out = await run(app.createTicket, { student, body: { category: "technical", subject: "Screen", images: ["/media/support-images/mine.png"] } });
  check("a ticket can be just a screenshot", out.code === 201 && out.body.ticket.messages[0].images.length === 1, out.body);

  out = await run(app.getMyTicket, { student: other, params: { id } });
  check("another student can't open it", out.code === 404);

  out = await run(staff.listTickets, { user: teacher, query: {} });
  check("a teacher sees only tickets assigned to them", out.code === 200 && out.body.total === 0, out.body);
  out = await run(staff.listTickets, { user: admin, query: { status: "open", category: "payment" } });
  check("an admin filters by status and category", out.body.total === 1, out.body);
  out = await run(staff.ticketCounts, { user: admin });
  check("open tickets are counted for the badge", out.body.open === 2, out.body);

  out = await run(staff.replyTicket, { user: admin, params: { id }, body: { text: "Fixed, check again." } });
  check("staff reply waits on the student and assigns the replier", out.body.ticket.status === "waiting" && String((await SupportTicket.findById(id)).assignedTo) === String(admin._id), out.body.ticket?.status);
  // notify() only writes when the type is on; AppSettings defaults it on.
  const note = await Notification.findOne({ student: student._id, type: "ticketReply" });
  check("…and the student is notified", Boolean(note) && note.link === `/support/${id}`);
  out = await run(app.getMyTicket, { student, params: { id } });
  check("the student sees the reply, without staff details", out.body.ticket.messages[1].author.name !== undefined && out.body.ticket.messages[1].author.email === undefined && out.body.ticket.assignedTo === undefined, out.body.ticket.messages[1]);
  check("…and opening it clears the unread mark", (await SupportTicket.findById(id)).unreadByStudent === false);

  out = await run(staff.updateTicket, { user: teacher, params: { id }, body: { status: "resolved" } });
  check("a teacher can't touch a ticket not assigned to them", out.code === 404);
  await SupportTicket.updateOne({ _id: id }, { $set: { assignedTo: teacher._id } });
  out = await run(staff.updateTicket, { user: teacher, params: { id }, body: { assignedTo: null } });
  check("…and can't reassign one that is", out.code === 403);
  out = await run(staff.updateTicket, { user: teacher, params: { id }, body: { status: "resolved" } });
  check("an assigned teacher resolves it", out.code === 200 && out.body.ticket.status === "resolved");

  out = await run(app.getMyTicket, { student, params: { id } });
  check("a resolved ticket shows until when it can be reopened", out.body.ticket.canReply === true && Boolean(out.body.ticket.reopenUntil), out.body.ticket.reopenUntil);
  out = await run(app.replyToTicket, { student, params: { id }, body: { text: "Still broken." } });
  check("a student reply reopens a resolved ticket", out.body.ticket.status === "open" && (await SupportTicket.findById(id)).unreadByStaff === true);
  await SupportTicket.updateOne({ _id: id }, { $set: { status: "resolved", resolvedAt: new Date(Date.now() - 8 * 86400000) } });
  out = await run(app.replyToTicket, { student, params: { id }, body: { text: "Hello again" } });
  check("past the reopen window it's closed for good", out.code === 409, out.body);
  out = await run(app.getMyTicket, { student, params: { id } });
  check("…and shown as closed", out.body.ticket.canReply === false);

  console.log("\nconduct");
  const ConductEvent = require("../models/conductEventModel");
  const AppSettings = require("../models/appSettingsModel");
  const conduct = require("../utils/conduct");
  const admin2 = require("../controllers/admin/conductController");
  const account = require("../controllers/app/accountController");
  await ConductEvent.deleteMany({});
  const kid = await Student.create({ name: "Test Kid", email: `kid${Date.now()}@x.test`, password: "Secret123!", isProfileComplete: true });
  const batch = new mongoose.Types.ObjectId();

  let threw = null;
  try { await conduct.screenMessage({ student: kid._id, batch, source: "course-chat", text: "what is newton's second law?" }); } catch (e) { threw = e; }
  check("a normal message passes the word check", threw === null);
  try { await conduct.screenMessage({ student: kid._id, batch, source: "course-chat", text: "tui ekta bokachoda" }); } catch (e) { threw = e; }
  check("an abusive message is refused", threw?.statusCode === 400);
  check("…and recorded against the student", (await ConductEvent.countDocuments({ student: kid._id, kind: "abuse", flaggedBy: "words" })) === 1);

  let settings = await AppSettings.get();
  settings.conduct = { autoPause: true, flags: 2, windowDays: 30, pauseDays: 7 };
  await settings.save();
  await conduct.recordAbuse({ student: kid._id, batch, source: "doubt", text: "insult", flaggedBy: "ai" });
  const paused = await Student.findById(kid._id);
  check("the automatic rule pauses AI at the threshold", paused.aiPausedUntil > new Date(Date.now() + 6 * 86400000), paused.aiPausedUntil);
  threw = null;
  try { await conduct.assertAiAllowed(kid._id); } catch (e) { threw = e; }
  check("…and AI calls are refused while paused", threw?.statusCode === 403, threw?.message);

  out = await run(admin2.listStudents, { user: admin, query: { status: "open", minFlags: "2" } });
  check("the conduct list finds the student by flag count", out.body.rows.some((r) => String(r._id) === String(kid._id) && r.abuse === 2), out.body);
  out = await run(admin2.listStudents, { user: admin, query: { restricted: "1" } });
  check("…and among restricted students", out.body.rows.some((r) => String(r._id) === String(kid._id)));

  out = await run(admin2.actOnStudent, { user: admin, params: { id: String(kid._id) }, body: { action: "resumeAi", message: "Second chance." } });
  check("staff lift the pause", out.code === 200 && !(await Student.findById(kid._id)).aiPausedUntil);
  check("…which handles the open flags", (await ConductEvent.countDocuments({ student: kid._id, status: "open" })) === 0);
  out = await run(admin2.actOnStudent, { user: admin, params: { id: String(kid._id) }, body: { action: "warn" } });
  check("a warning needs a message", out.code === 400);
  out = await run(admin2.actOnStudent, { user: admin, params: { id: String(kid._id) }, body: { action: "suspend", days: 3, message: "Cool off." } });
  const suspended = await Student.findById(kid._id);
  check("a timed suspension", out.code === 200 && suspended.isActive && suspended.suspendedUntil > new Date());
  check("…blocks sign-in", /suspended until/.test(conduct.suspensionMessage(suspended) || ""));
  check("…and the student is told", Boolean(await Notification.findOne({ student: kid._id, type: "accountStanding", title: "Your account was suspended" })));
  await run(admin2.actOnStudent, { user: admin, params: { id: String(kid._id) }, body: { action: "reactivate" } });
  check("reactivating clears it", conduct.suspensionMessage(await Student.findById(kid._id)) === null);

  const flag = await ConductEvent.findOne({ student: kid._id, kind: "abuse" });
  out = await run(admin2.updateEvent, { user: admin, params: { id: String(flag._id) }, body: { status: "dismissed" } });
  check("a false alarm is dismissed", out.body.event.status === "dismissed");
  out = await run(account.getStanding, { student: await Student.findById(kid._id) });
  check("the student's standing hides dismissed entries", out.code === 200 && !out.body.events.some((e) => String(e._id) === String(flag._id)) && out.body.events.some((e) => e.action === "suspend"), out.body.events?.map((e) => e.kind));

  const sub = { _id: new mongoose.Types.ObjectId(), student: kid._id, batch, violations: [{}, {}] };
  await conduct.recordExamViolation(sub);
  check("fewer exam flags than the line stay off the record", (await ConductEvent.countDocuments({ submission: sub._id })) === 0);
  sub.violations.push({});
  await conduct.recordExamViolation(sub);
  sub.violations.push({});
  await conduct.recordExamViolation(sub);
  const ev = await ConductEvent.find({ submission: sub._id, kind: "examViolation" });
  check("exam flags are one entry per attempt, with the latest count", ev.length === 1 && ev[0].count === 4, ev.map((e) => e.count));
  let summary = await conduct.examFlagSummary(sub, admin);
  check("a submission shows its conduct entry to admins", summary && String(summary.event?._id) === String(ev[0]._id) && summary.event.status === "open" && summary.line === 3 && summary.attemptsOnRecord === 1, summary);
  check("…and nothing to a teacher", (await conduct.examFlagSummary(sub, { role: "teacher" })) === null);
  summary = await conduct.examFlagSummary({ _id: new mongoose.Types.ObjectId(), student: kid._id }, admin);
  check("an attempt under the line has no entry", summary.event === null);
  const minor = await ConductEvent.create({ student: kid._id, kind: "examViolation", source: "exam", count: 1 });
  out = await run(account.getStanding, { student: await Student.findById(kid._id) });
  check("an older single-flag entry is hidden from the student", !out.body.events.some((e) => String(e._id) === String(minor._id)));
  out = await run(admin2.getStudentRecord, { user: admin, params: { id: String(kid._id) } });
  check("…and from staff", out.code === 200 && !out.body.events.some((e) => String(e._id) === String(minor._id)) && out.body.events.some((e) => String(e._id) === String(ev[0]._id)));
  await run(admin2.updateConductSettings, { user: admin, body: { examFlags: 1 } });
  out = await run(admin2.getStudentRecord, { user: admin, params: { id: String(kid._id) } });
  check("the line is settable", out.body.events.some((e) => String(e._id) === String(minor._id)));
  settings = await AppSettings.get();

  out = await run(app.createTicket, { student: { _id: kid._id }, body: { category: "account", subject: "Appeal", text: "It was a joke.", conductEvent: String(ev[0]._id) } });
  check("an appeal ticket links to the entry", out.code === 201 && out.body.ticket.category === "appeal" && String((await ConductEvent.findById(ev[0]._id)).appealTicket) === String(out.body.ticket._id), out.body);

  settings.conduct = { autoPause: false, flags: 3, windowDays: 30, pauseDays: 7, examFlags: 3 };
  await settings.save();
  await Student.deleteOne({ _id: kid._id });

  console.log("\naccount deletion");
  const DeletionRequest = require("../models/deletionRequestModel");
  const Purchase = require("../models/purchaseModel");
  const Submission = require("../models/submissionModel");
  const ChatThread = require("../models/chatThreadModel");
  const { processDue } = require("../utils/accountDeletion");
  const del = require("../controllers/admin/deletionController");
  await DeletionRequest.deleteMany({});
  const leaver = await Student.create({ name: "Leaving Kid", email: `leave${Date.now()}@x.test`, password: "Secret123!", isProfileComplete: true });
  const me2 = () => Student.findById(leaver._id);
  settings.accountDeletion = { enabled: true, graceDays: 14, autoDelete: true };
  await settings.save();

  out = await run(account.requestDeletion, { student: await me2(), body: { reason: "Done with exams" } });
  check("deletion needs typing DELETE", out.code === 400);
  out = await run(account.requestDeletion, { student: await me2(), body: { reason: "Done with exams", confirm: "delete" } });
  check("a request is scheduled after the grace period", out.code === 201 && new Date(out.body.request.scheduledFor) > new Date(Date.now() + 13 * 86400000), out.body);
  check("…and shown on the account", Boolean((await me2()).deletionScheduledFor));
  out = await run(account.requestDeletion, { student: await me2(), body: { confirm: "DELETE" } });
  check("a second request is refused", out.code === 409);
  out = await run(account.cancelDeletion, { student: await me2() });
  check("the student can cancel in the grace period", out.code === 200 && !(await me2()).deletionScheduledFor && (await DeletionRequest.findOne({ student: leaver._id })).status === "cancelled");

  // Due now, automatic erase.
  await run(account.requestDeletion, { student: await me2(), body: { confirm: "DELETE" } });
  const purchase = await Purchase.create({ student: leaver._id, batch, plan: { label: "Paid", price: 500 } }).catch((e) => { console.log(e.message); return null; });
  await ChatThread.create({ student: leaver._id, batch, title: "t", messages: [] });
  await DeletionRequest.updateOne({ student: leaver._id, status: "pending" }, { $set: { scheduledFor: new Date(Date.now() - 1000) } });
  await processDue();
  const gone = await me2();
  check("after the grace period the student is erased", gone.name === "Deleted student" && !gone.email && gone.isActive === false && Boolean(gone.deletedAt), { name: gone.name, email: gone.email });
  check("…their personal records are removed", (await ChatThread.countDocuments({ student: leaver._id })) === 0);
  check("…but payment records stay", Boolean(purchase) && (await Purchase.countDocuments({ student: leaver._id })) === 1);
  out = await run(admin2.actOnStudent, { user: admin, params: { id: String(leaver._id) }, body: { action: "reactivate" } });
  check("a deleted account can't be reactivated or acted on", out.code === 409, out.body);
    check("…and the request is completed", (await DeletionRequest.findOne({ student: leaver._id, status: "completed" })) !== null);

  // Staff approval mode.
  settings.accountDeletion = { enabled: true, graceDays: 0, autoDelete: false };
  await settings.save();
  const second = await Student.create({ name: "Other Kid", email: `other${Date.now()}@x.test`, password: "Secret123!", isProfileComplete: true });
  await run(account.requestDeletion, { student: second, body: { confirm: "DELETE" } });
  const waiting = await DeletionRequest.findOne({ student: second._id });
  check("with approval on, a due request waits for staff", waiting.status === "awaiting" && (await Student.findById(second._id)).name === "Other Kid", waiting.status);
  out = await run(del.deletionCounts, { user: admin });
  check("…counted for the badge", out.body.awaiting === 1);
  out = await run(del.rejectRequest, { user: admin, params: { id: String(waiting._id) }, body: {} });
  check("rejecting needs a note", out.code === 400);
  out = await run(del.rejectRequest, { user: admin, params: { id: String(waiting._id) }, body: { note: "Outstanding payment dispute." } });
  check("staff can reject with a note", out.code === 200 && !(await Student.findById(second._id)).deletionScheduledFor);
  await run(account.requestDeletion, { student: await Student.findById(second._id), body: { confirm: "DELETE" } });
  const again = await DeletionRequest.findOne({ student: second._id, status: "awaiting" });
  out = await run(del.approveRequest, { user: admin, params: { id: String(again._id) } });
  check("…or approve, which erases", out.code === 200 && (await Student.findById(second._id)).name === "Deleted student");
  settings.accountDeletion = { enabled: false, graceDays: 14, autoDelete: true };
  await settings.save();
  out = await run(account.requestDeletion, { student: kid, body: { confirm: "DELETE" } });
  check("switched off, students can't request it", out.code === 403);
  settings.accountDeletion = { enabled: true, graceDays: 14, autoDelete: true };
  await settings.save();
  await Student.deleteMany({ _id: { $in: [leaver._id, second._id] } });
  await Purchase.deleteMany({ student: leaver._id });

  await mongoose.disconnect();
  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exit(1); }
  console.log("PASS");
})();
