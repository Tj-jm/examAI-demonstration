// Certificates: serials, wording, issuing, no duplicates, revoking, the
// public check, and who may issue.
// Database checks need TEST_MONGO_URL (a throwaway database).

process.env.NODE_ENV = "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const run = (fn, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  fn({ query: {}, params: {}, body: {}, ...req }, res, (e) => resolve({ code: res.code, err: e?.message }));
});

(async () => {
  const { makeSerial, normaliseSerial, render } = require("../utils/certificates");
  console.log("serials and wording");
  const serials = new Set(Array.from({ length: 2000 }, makeSerial));
  check("serials look like XXXX-XXXX-XXXX with no 0, O, 1 or I", [...serials].every((s) => /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(s)));
  check("2000 serials, no repeats", serials.size === 2000);
  check("typed loosely, still found", normaliseSerial(" ab2c dE3f-gh4k ") === "AB2C-DE3F-GH4K");
  check("placeholders filled, unknown ones kept", render("{name} finished {batch} {oops}", { name: "Rafi", batch: "Class 8" }) === "Rafi finished Class 8 {oops}");

  const { verifyUrlFor, cleanSignatures } = require("../utils/certificates");
  const { resolveOwnMediaKey } = require("../utils/mediaUrl");
  console.log("links and signatures");
  const savedBase = process.env.CLIENT_URL_STUDENT;
  process.env.CLIENT_URL_STUDENT = "https://learn.example.com/";
  check("verify link uses the student site, not the asking page", verifyUrlFor("AB2C-DE3F-GH4K", {}) === "https://learn.example.com/verify/AB2C-DE3F-GH4K");
  check("a canonical address wins over the env", verifyUrlFor("AB2C-DE3F-GH4K", { seo: { canonicalUrl: "https://school.example.org" } }) === "https://school.example.org/verify/AB2C-DE3F-GH4K");
  if (savedBase === undefined) delete process.env.CLIENT_URL_STUDENT; else process.env.CLIENT_URL_STUDENT = savedBase;
  const sigs = cleanSignatures([
    { name: "Dr. Karim", role: "Principal", image: "/media/signatures/a.png" },
    { name: "Evil", role: "", image: "http://169.254.169.254/latest" },
    { name: "", role: "", image: null },
    { name: "A" }, { name: "B" },
  ], resolveOwnMediaKey);
  check("own signature picture kept", sigs[0].image === "/media/signatures/a.png");
  check("outside address dropped, signer kept", sigs[1].name === "Evil" && sigs[1].image === null);
  check("empty rows dropped, at most 3", sigs.length === 3 && sigs[2].name === "A");

  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, database checks skipped."); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|cert/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Student = require("../models/studentModel");
  const User = require("../models/userModel");
  const Purchase = require("../models/purchaseModel");
  const Certificate = require("../models/certificateModel");
  const Notification = require("../models/notificationModel");
  const staff = require("../controllers/admin/certificateController");
  const app = require("../controllers/app/certificateController");

  const owner = await User.create({ name: "Owner", email: "o@example.com", password: "Passw0rd!x", role: "owner" });
  const teacher = await User.create({ name: "Teach", email: "t@example.com", password: "Passw0rd!x", role: "teacher" });
  const grader = await User.create({ name: "Grade", email: "g@example.com", password: "Passw0rd!x", role: "grader" });
  const batch = await Batch.create({ name: "Web Bootcamp", accessType: "free", program: new mongoose.Types.ObjectId(), teachers: [teacher._id], graders: [grader._id] });
  const other = await Batch.create({ name: "Other", accessType: "free", program: new mongoose.Types.ObjectId() });
  const s1 = await Student.create({ name: "Rafi", email: "r@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const s2 = await Student.create({ name: "Nadia", email: "n@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const outsider = await Student.create({ name: "Out", email: "x@example.com", password: "Passw0rd!x", isProfileComplete: true });
  for (const s of [s1, s2]) await Purchase.create({ student: s._id, batch: batch._id, plan: { label: "Grant", price: 0, isInfinite: true }, provider: "manual", status: "complete" });

  console.log("\ntemplate");
  let out = await run(staff.updateTemplate, { user: teacher, body: { title: "X" } });
  check("a teacher can't change the design", out.code === 403);
  out = await run(staff.updateTemplate, { user: owner, body: { title: "Certificate of Achievement", body: "{name} completed {batch} on {date}.", signatures: [{ name: "Dr. Karim", role: "Principal" }, { name: "", role: "" }] } });
  check("owner sets wording; empty signature rows dropped", out.code === 200 && out.body.signatures.length === 1, out.body);

  console.log("\nissuing");
  out = await run(staff.issueCertificates, { user: grader, body: { batch: batch._id, students: [s1._id] } });
  check("graders can't issue", out.code === 403);
  out = await run(staff.issueCertificates, { user: teacher, body: { batch: other._id, students: [s1._id] } });
  check("a teacher can't issue for another batch", out.code === 403);
  out = await run(staff.issueCertificates, { user: teacher, body: { batch: batch._id, students: [outsider._id] } });
  check("only students on the register", out.code === 400, out);
  out = await run(staff.issueCertificates, { user: teacher, body: { batch: batch._id, students: [s1._id, s2._id, outsider._id] } });
  check("issued to the two on the register", out.code === 201 && out.body.issued === 2, out.body);
  const cert = await Certificate.findOne({ student: s1._id });
  check("wording filled in at issue time", cert.title === "Certificate of Achievement" && /^Rafi completed Web Bootcamp on \d/.test(cert.body) && cert.signatures[0].role === "Principal", cert);
  check("the student was told", (await Notification.countDocuments({ type: "certificateIssued" })) === 2);
  out = await run(staff.issueCertificates, { user: teacher, body: { batch: batch._id, students: [s1._id] } });
  check("issuing again skips who already has it", out.body.issued === 0 && out.body.skipped === 1, out.body);
  await run(staff.updateTemplate, { user: owner, body: { body: "Changed later." } });
  check("a later design change never alters an issued certificate", (await Certificate.findById(cert._id)).body !== "Changed later.");

  console.log("\nchecking and revoking");
  out = await run(app.verifyCertificate, { params: { serial: cert.serial.toLowerCase().replace(/-/g, " ") } });
  check("anyone can check by number", out.code === 200 && out.body.valid && out.body.recipientName === "Rafi" && out.body.student === undefined, out.body);
  out = await run(app.verifyCertificate, { params: { serial: "AAAA-BBBB-CCCC" } });
  check("an unknown number is not found", out.code === 404);
  out = await run(staff.revokeCertificate, { user: teacher, params: { id: String(cert._id) }, body: { reason: "Issued by mistake" } });
  out = await run(app.verifyCertificate, { params: { serial: cert.serial } });
  check("revoked: the check says so", out.body.valid === false && out.body.revokedAt);
  out = await run(app.getMyCertificates, { student: s1 });
  check("a revoked certificate leaves the student's list", out.body.certificates.length === 0);
  out = await run(staff.issueCertificates, { user: teacher, body: { batch: batch._id, students: [s1._id] } });
  check("after revoking, it can be issued again", out.body.issued === 1);
  await run(staff.restoreCertificate, { user: owner, params: { id: String(cert._id) } });
  out = await run(app.getMyCertificates, { student: s1 });
  check("restore brings it back", out.body.certificates.length === 2);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
