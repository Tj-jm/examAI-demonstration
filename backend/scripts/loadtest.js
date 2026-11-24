require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// Test students for a load test (loadtest/GUIDE.txt), run on an app server:
//
//   node scripts/loadtest.js seed --batch "Load test" --students 1000 --password <8+ chars>
//       lt0001@loadtest.example.com … enrolled in the batch. Prints the
//       batch's id and its open exams, for the k6 scripts.
//   node scripts/loadtest.js reset
//       deletes their exam attempts, so the exam can be run again.
//   node scripts/loadtest.js clean
//       deletes the accounts and everything they made.
//
// Runs only while LOADTEST_TOKEN is set, i.e. on a server put into test
// mode on purpose. example.com is reserved, so nothing is ever delivered.

const DOMAIN = "loadtest.example.com";
const MATCH = /@loadtest\.example\.com$/;
const emailFor = (i) => `lt${String(i).padStart(4, "0")}@${DOMAIN}`;

const args = {};
for (let i = 3; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next && !next.startsWith("--") ? (i += 1, next) : true;
}

const fail = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

// Every model with a student field, for reset and clean.
const studentModels = () => {
  const dir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith(".js")) require(path.join(dir, file));
  }
  return mongoose.modelNames().map((n) => mongoose.model(n)).filter((m) => m.schema.path("student"));
};

const seed = async () => {
  const Student = require("../models/studentModel");
  const Batch = require("../models/batchModel");
  const Exam = require("../models/examModel");
  const Purchase = require("../models/purchaseModel");
  const AppSettings = require("../models/appSettingsModel");

  const count = Math.min(5000, Math.max(1, Number(args.students) || 0));
  const password = typeof args.password === "string" ? args.password : "";
  if (!args.batch || args.batch === true) fail('Say which batch: --batch "Batch name or id"');
  if (!args.students) fail("Say how many: --students 1000");
  if (password.length < 8) fail("Give a password of 8+ characters: --password <password>");

  const batch = mongoose.isValidObjectId(args.batch)
    ? await Batch.findById(args.batch)
    : await Batch.findOne({ name: args.batch });
  if (!batch) fail(`No batch is called "${args.batch}". Use its exact name or its id.`);

  const have = new Set((await Student.find({ email: MATCH }).select("email").lean()).map((s) => s.email));
  const hash = await bcrypt.hash(password, await bcrypt.genSalt(10));
  const docs = [];
  for (let i = 1; i <= count; i += 1) {
    const email = emailFor(i);
    if (have.has(email)) continue;
    docs.push({ name: `Load Test ${i}`, email, password: hash, isProfileComplete: true, isOtpVerified: true, isActive: true });
  }
  // insertMany skips the save hook, which would hash the hash again.
  const made = docs.length ? await Student.insertMany(docs) : [];
  if (have.size) await Student.updateMany({ email: MATCH }, { $set: { password: hash, loginAttempts: 0 }, $unset: { lockedUntil: 1 } });

  const all = await Student.find({ email: MATCH }).select("_id").lean();
  const enrolled = new Set((await Purchase.distinct("student", { batch: batch._id, status: "complete", student: { $in: all.map((s) => s._id) } })).map(String));
  const currency = (await AppSettings.get()).defaultCurrency;
  const missing = all.filter((s) => !enrolled.has(String(s._id)));
  if (missing.length) {
    await Purchase.insertMany(missing.map((s) => ({
      student: s._id, batch: batch._id, plan: { label: "Load test", price: 0, durationDays: null, isInfinite: true },
      // insertMany skips Purchase's save hook, which sets these.
      amountPaid: 0, startDate: new Date(), endDate: new Date("9999-12-31T23:59:59Z"),
      currency, provider: "manual", status: "complete", note: "scripts/loadtest.js",
    })));
  }

  const exams = await Exam.find({ batches: batch._id, createdByStudent: null, isPublished: true }).select("title questions").lean();
  console.log(`\n${made.length} students created, ${have.size} already there, ${missing.length} newly enrolled.`);
  console.log(`Accounts: ${emailFor(1)} … ${emailFor(count)}, all with the password you gave.`);
  console.log(`\nBATCH_ID=${batch._id}   (${batch.name})`);
  if (!exams.length) console.log("No published exam on this batch yet: add one before the exam test.");
  for (const e of exams) console.log(`EXAM_ID=${e._id}   (${e.title}, ${e.questions.length} questions)`);
};

const reset = async () => {
  const Student = require("../models/studentModel");
  const Submission = require("../models/submissionModel");
  const ids = await Student.find({ email: MATCH }).distinct("_id");
  const { deletedCount } = await Submission.deleteMany({ student: { $in: ids } });
  await Student.updateMany({ _id: { $in: ids } }, { $set: { loginAttempts: 0 }, $unset: { lockedUntil: 1 } });
  console.log(`\nDeleted ${deletedCount} exam attempts of ${ids.length} load-test students.`);
};

const clean = async () => {
  const Student = require("../models/studentModel");
  const ids = await Student.find({ email: MATCH }).distinct("_id");
  let total = 0;
  for (const Model of studentModels()) {
    if (Model.modelName === Student.modelName) continue;
    const { deletedCount } = await Model.deleteMany({ student: { $in: ids } });
    if (deletedCount) console.log(`  ${Model.modelName}: ${deletedCount}`);
    total += deletedCount;
  }
  await Student.deleteMany({ _id: { $in: ids } });
  console.log(`\nDeleted ${ids.length} load-test students and ${total} things they made.`);
};

const run = async () => {
  const command = process.argv[2];
  if (!["seed", "reset", "clean"].includes(command)) fail("Use: node scripts/loadtest.js seed|reset|clean");
  if ((process.env.LOADTEST_TOKEN || "").length < 32) {
    fail("LOADTEST_TOKEN isn't set (32+ characters) on this server, so it isn't in load-test mode. See loadtest/GUIDE.txt.");
  }
  if (!process.env.MONGO_URI) fail("MONGO_URI is not set.");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    await { seed, reset, clean }[command]();
  } finally {
    await mongoose.disconnect();
  }
  // Model files can open Redis connections; don't wait on them.
  process.exit(0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
