require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// Test accounts for a local install: 200 students, and 20 each of teachers,
// doubt solvers, graders and representatives. Every one has the password
// 123456789. Random names and @example.com addresses (a reserved domain, so
// nothing is ever delivered anywhere). The list goes to seed-accounts.csv.
// Each student is enrolled in 1 to 3 random active batches.
//
//   npm run seed:people
//   npm run seed:people -- --enrol-only
//       creates nobody: enrols the test students (@example.com) who aren't
//       in any batch yet in 1 to 3 random active batches each.
//
// Refuses to run against anything but a local database, since these
// passwords are public. --allow-remote overrides that, at your own risk.

const PASSWORD = "123456789";
const COUNTS = { student: 200, teacher: 20, doubtSolver: 20, grader: 20, representative: 20 };

const FIRST = ["Rafi", "Nadia", "Tanvir", "Sadia", "Arif", "Mitu", "Fahim", "Nusrat", "Imran", "Tania", "Rakib", "Farzana", "Sakib", "Jannat", "Hasan", "Lamia", "Shuvo", "Riya", "Mahin", "Anika", "Zahid", "Sumaiya", "Rifat", "Mehjabin", "Asif", "Tasnim", "Nayeem", "Orpita", "Siam", "Puja", "Adnan", "Raisa", "Tamim", "Bushra", "Fardin", "Ishrat", "Sajid", "Nabila", "Rashed", "Maliha"];
const LAST = ["Ahmed", "Rahman", "Hossain", "Islam", "Khan", "Chowdhury", "Akter", "Sarker", "Uddin", "Haque", "Kabir", "Alam", "Begum", "Das", "Roy", "Karim", "Mia", "Sultana", "Biswas", "Talukder"];
const ROLE_LABEL = { teacher: "Teacher", doubtSolver: "Doubt solver", grader: "Grader", representative: "Representative" };

const pick = (list) => list[crypto.randomInt(list.length)];

const isLocal = (uri) => /^mongodb:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\//.test(uri || "");

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set (backend/.env).");
  if (!isLocal(uri) && !process.argv.includes("--allow-remote")) {
    throw new Error(`MONGO_URI is not a local database (${uri.replace(/\/\/[^@]*@/, "//***@")}). These accounts all share a public password; run this against a local database, or add --allow-remote if you really mean it.`);
  }
  await mongoose.connect(uri);
  const Student = require("../models/studentModel");
  const User = require("../models/userModel");
  const Batch = require("../models/batchModel");
  const Purchase = require("../models/purchaseModel");
  const AppSettings = require("../models/appSettingsModel");

  // 1 to 3 random active batches per student, free and never ending.
  // insertMany skips Purchase's save hook, so endDate is set here.
  const batches = await Batch.find({ isActive: true }).select("_id").lean();
  const currency = (await AppSettings.get()).defaultCurrency;
  const enrol = async (list) => {
    if (!batches.length) return 0;
    const docs = list.flatMap((s) => {
      const picked = [...batches].sort(() => Math.random() - 0.5).slice(0, 1 + crypto.randomInt(Math.min(3, batches.length)));
      return picked.map((b) => ({
        student: s._id, batch: b._id, plan: { label: "Test enrolment", price: 0, durationDays: null, isInfinite: true },
        currency, provider: "manual", status: "complete", amountPaid: 0, startDate: new Date(),
        endDate: new Date("9999-12-31T23:59:59Z"), note: "npm run seed:people",
      }));
    });
    await Purchase.insertMany(docs);
    return docs.length;
  };

  if (process.argv.includes("--enrol-only")) {
    const enrolled = await Purchase.distinct("student", { status: "complete" });
    const loose = await Student.find({ email: /@example\.com$/, _id: { $nin: enrolled } }).select("_id").lean();
    const made = await enrol(loose);
    console.log(batches.length
      ? `Enrolled ${loose.length} students (${made} enrolments across ${batches.length} active batches).`
      : "No active batches to enrol anyone in.");
    await mongoose.disconnect();
    return;
  }

  // Hashed once: 280 separate bcrypt runs would take a minute for nothing.
  const hash = await bcrypt.hash(PASSWORD, await bcrypt.genSalt(10));
  const taken = new Set([
    ...(await Student.find({}, "email").lean()).map((s) => s.email),
    ...(await User.find({}, "email").lean()).map((u) => u.email),
  ].filter(Boolean));

  const person = () => {
    for (;;) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const email = `${first}.${last}${crypto.randomInt(100, 1000)}@example.com`.toLowerCase();
      if (!taken.has(email)) { taken.add(email); return { name: `${first} ${last}`, email }; }
    }
  };

  const rows = [];
  const students = Array.from({ length: COUNTS.student }, () => {
    const p = person();
    rows.push(["student", p.name, p.email]);
    return { ...p, password: hash, isProfileComplete: true, isOtpVerified: true, isActive: true };
  });
  // insertMany skips the save hook, which would hash the hash again.
  const madeStudents = await Student.insertMany(students);
  const enrolments = await enrol(madeStudents);

  const staff = [];
  for (const role of ["teacher", "doubtSolver", "grader", "representative"]) {
    for (let i = 0; i < COUNTS[role]; i += 1) {
      const p = person();
      rows.push([role, `${p.name}`, p.email]);
      staff.push({ ...p, name: `${p.name} (${ROLE_LABEL[role]})`, password: hash, role, isActive: true });
    }
  }
  await User.insertMany(staff);

  const csv = ["role,name,email,password", ...rows.map((r) => [...r, PASSWORD].join(","))].join("\n") + "\n";
  // In the Docker image the app folder is read-only to the app's user; the
  // list then goes to the temp folder.
  let file = path.join(__dirname, "..", "seed-accounts.csv");
  try {
    fs.writeFileSync(file, csv);
  } catch {
    file = path.join(require("os").tmpdir(), "seed-accounts.csv");
    fs.writeFileSync(file, csv);
  }

  console.log(`Created ${students.length} students and ${staff.length} staff (${Object.entries(COUNTS).filter(([r]) => r !== "student").map(([r, n]) => `${n} ${r}`).join(", ")}).`);
  console.log(batches.length ? `Students enrolled: ${enrolments} enrolments across ${batches.length} active batches.` : "No active batches, so no student was enrolled.");
  console.log(`Password for all of them: ${PASSWORD}`);
  console.log(`Every email is in ${file}`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
