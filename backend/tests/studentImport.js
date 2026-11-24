// Students → Import and logging in by student ID.
// Needs TEST_MONGO_URL (a throwaway database).

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "student-import-test-secret";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const run = (fn, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, cookie() { return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  fn(req, res, (e) => resolve({ code: res.code, err: e?.message }));
});

(async () => {
  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|import/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Student = require("../models/studentModel");
  const Batch = require("../models/batchModel");
  const Purchase = require("../models/purchaseModel");
  const AppSettings = require("../models/appSettingsModel");
  const { importStudents } = require("../utils/studentImport");
  const { login } = require("../controllers/app/authController");

  const b1 = await Batch.create({ name: "Class 9 A", accessType: "free", program: new mongoose.Types.ObjectId() });
  const b2 = await Batch.create({ name: "Class 9 B", accessType: "free", program: new mongoose.Types.ObjectId() });
  await Student.create({ name: "Old Timer", email: "old@example.com", password: "Passw0rd!x", isProfileComplete: true });

  const rows = [
    { studentId: "s-001", name: "Rafi Ahmed", batch: "Class 9 A" },
    { studentId: "S-002", name: "Nadia Islam", email: "nadia@example.com", password: "mypassword1", batch: "class 9 a; Class 9 B" },
    { email: "old@example.com", batch: "Class 9 B" },
    { studentId: "S-003", name: "No Class", batch: "Class 10" },
    { name: "Nobody" },
    { studentId: "S-001", name: "Twice" },
    { studentId: "S-004", name: "Short Pass", password: "abc" },
  ];

  console.log("check first");
  const dry = await importStudents(rows, { dryRun: true });
  check("a check counts but changes nothing", dry.created === 2 && dry.enrolled === 4 && (await Student.countDocuments()) === 1, dry);
  check("problems are listed by spreadsheet line", dry.errors.map((e) => e.line).join(",") === "5,6,7,8", dry.errors);

  console.log("\nimport");
  const res = await importStudents(rows, {});
  check("two students made; the existing one only gets access", res.created === 2 && res.updated === 0, res);
  check("four access grants", res.enrolled === 4 && (await Purchase.countDocuments({ status: "complete", provider: "manual" })) === 4);
  const rafi = await Student.findOne({ studentId: "S-001" });
  check("student ID stored upper-case", Boolean(rafi));
  const cred = res.credentials.find((c) => c.studentId === "S-001");
  check("a generated password is handed back once", cred && cred.password.length === 10);
  check("a given password is used as is", res.credentials.find((c) => c.studentId === "S-002")?.password === "mypassword1");
  check("an existing student found by email isn't duplicated", (await Student.countDocuments({ email: "old@example.com" })) === 1);
  const again = await importStudents([{ studentId: "S-001", batch: "Class 9 A" }], {});
  check("importing again doesn't grant twice", again.enrolled === 0 && (await Purchase.countDocuments({ student: rafi._id })) === 1, again);

  console.log("\nlog in by student ID");
  let out = await run(login, { get: () => undefined, body: { studentId: "s-001", password: cred.password } });
  check("refused while it's switched off", out.code === 400, out);
  const s = await AppSettings.get(); s.institution.studentIdLogin = true; await s.save();
  out = await run(login, { get: () => undefined, body: { studentId: "s-001", password: cred.password } });
  check("logs in, any case", out.code === 200 && out.body?.name === "Rafi Ahmed", out);
  out = await run(login, { get: () => undefined, body: { studentId: "S-001", password: "wrong-password" } });
  check("a wrong password is refused", out.code === 401 && /student ID/.test(out.err || ""), out);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
