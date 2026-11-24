require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const validateEnv = require("../config/validateEnv");

const User = require("../models/userModel");
const Subject = require("../models/subjectModel");
const Chapter = require("../models/chapterModel");
const Topic = require("../models/topicModel");
const Program = require("../models/programModel");
const Batch = require("../models/batchModel");
const Lecture = require("../models/lectureModel");
const ExamAuthority = require("../models/examAuthorityModel");
const AppSettings = require("../models/appSettingsModel");
const { Question } = require("../models/questionModel");
const { generateUniqueIdentifier } = require("../utils/generateOtp");

// A buyer who runs `npm run seed` should get something they can log into and
// click through, not an empty shell that needs an hour of setup before the
// product shows what it does.

// Every copy of this codebase shipped the same literal password here until
// now — fine for a throwaway local demo, but this script is also how many
// buyers get their very first account, and a fixed, publicly-known
// (it's in the source of every install) owner password left unchanged is a
// full takeover of any install that goes live before someone remembers to
// change it. Generated fresh per run instead, below.
const OWNER = {
  name: "Demo Owner",
  email: "owner@example.com",
};

const run = async () => {
  validateEnv();
  await connectDB();

  const existing = await User.estimatedDocumentCount();
  if (existing > 0 && process.argv[2] !== "--force") {
    console.log("This install already has accounts. Re-run with --force to wipe and reseed.");
    process.exit(0);
  }

  if (process.argv[2] === "--force") {
    console.log("Wiping...");
    await Promise.all([
      User.deleteMany({}),
      Subject.deleteMany({}),
      Chapter.deleteMany({}),
      Topic.deleteMany({}),
      Program.deleteMany({}),
      Batch.deleteMany({}),
      Lecture.deleteMany({}),
      Question.deleteMany({}),
      ExamAuthority.deleteMany({}),
    ]);
  }

  const ownerPassword = crypto.randomBytes(12).toString("base64url");

  const owner = await User.create({
    ...OWNER,
    password: ownerPassword,
    role: "owner",
    mustChangePassword: true,
    sessionId: generateUniqueIdentifier(),
  });

  await AppSettings.get();

  // Taxonomies are data, not enums. A different curriculum seeds different
  // rows here and nothing in the code changes.
  await ExamAuthority.insertMany([
    { name: "Cambridge International", shortName: "CIE", order: 1 },
    { name: "Advanced Placement", shortName: "AP", order: 2 },
    { name: "International Baccalaureate", shortName: "IB", order: 3 },
  ]);

  const physics = await Subject.create({ title: "Physics", order: 1, iconColor: "#14161A" });
  const chemistry = await Subject.create({ title: "Chemistry", order: 2, iconColor: "#0E7C5A" });

  const mechanics = await Chapter.create({
    title: "Mechanics",
    subject: physics._id,
    section: "Paper 1",
    order: 1,
  });

  const motion = await Topic.create({
    title: "Motion and momentum",
    chapter: mechanics._id,
    subject: physics._id,
    order: 1,
  });

  const energy = await Topic.create({
    title: "Work and energy",
    chapter: mechanics._id,
    subject: physics._id,
    order: 2,
  });

  // One of each type, so a mixed exam can be built immediately.
  await Question.create({
    type: "mcq",
    question: "A 2 kg ball at 5 m/s strikes a stationary 3 kg ball. If they move together, the final velocity is",
    subject: physics._id,
    chapter: mechanics._id,
    topic: motion._id,
    marks: 1,
    negativeMarks: 0.25,
    difficulty: "medium",
    options: [
      { key: "A", text: "2 m/s" },
      { key: "B", text: "2.5 m/s" },
      { key: "C", text: "5 m/s" },
      { key: "D", text: "10 m/s" },
    ],
    correctOption: "A",
    solutionText:
      "Momentum is conserved: $(2)(5) = (2+3)v$, so $v = 2$ m/s. The combined mass is larger, so the shared velocity is lower.",
  });

  await Question.create({
    type: "mcq",
    question: "The net force on a body moving with constant velocity is",
    subject: physics._id,
    chapter: mechanics._id,
    topic: motion._id,
    marks: 1,
    negativeMarks: 0.25,
    difficulty: "easy",
    options: [
      { key: "A", text: "Zero" },
      { key: "B", text: "Equal to its weight" },
      { key: "C", text: "Increasing steadily" },
      { key: "D", text: "Cannot be determined" },
    ],
    correctOption: "A",
    solutionText: "Constant velocity means zero acceleration, and $F = ma$ gives $F = 0$.",
  });

  await Question.create({
    type: "mtf",
    question: "For an object in uniform circular motion, decide whether each statement is true.",
    subject: physics._id,
    chapter: mechanics._id,
    topic: motion._id,
    marks: 1,
    negativeMarks: 0.25,
    difficulty: "medium",
    statements: [
      { text: "Its speed is constant.", isTrue: true },
      { text: "Its velocity is constant.", isTrue: false },
      { text: "It is accelerating.", isTrue: true },
      { text: "The net force on it is zero.", isTrue: false },
    ],
    solutionText:
      "Speed is constant but direction changes, so velocity changes and the object accelerates toward the centre.",
  });

  await Question.create({
    type: "written",
    question: "Explain why a satellite in a stable orbit is in continuous free fall.",
    subject: physics._id,
    chapter: mechanics._id,
    topic: energy._id,
    marks: 5,
    difficulty: "hard",
    rubric: [
      { criterion: "States that gravity is the only significant force acting", marks: 1 },
      { criterion: "Identifies gravity as providing the centripetal force", marks: 2 },
      { criterion: "Explains that tangential velocity means the surface curves away as fast as the satellite falls", marks: 2 },
    ],
    modelAnswer:
      "The satellite is accelerating toward the Earth under gravity alone, which is the definition of free fall. Its tangential velocity is large enough that the Earth's surface curves away at the same rate it falls, so it never gets closer.",
  });

  const program = await Program.create({
    title: "Year 12 Sciences",
    description: "Demo program",
    order: 1,
    isActive: true,
  });

  const paidBatch = await Batch.create({
    name: "Physics — Year 12",
    program: program._id,
    subjects: [physics._id],
    accessType: "paid",
    trialDays: 7,
    trialWarningDays: 3,
    features: { lectures: true, practice: true, exams: true, aiAssist: false },
    isActive: true,
    plans: [
      { label: "1 month", price: 15, durationDays: 30 },
      { label: "3 months", price: 40, durationDays: 90 },
      { label: "Full course", price: 120, durationDays: null, isInfinite: true },
    ],
  });

  const freeBatch = await Batch.create({
    name: "Chemistry — free sampler",
    program: program._id,
    subjects: [chemistry._id],
    accessType: "free",
    features: { lectures: true, practice: true, exams: true, aiAssist: false },
    isActive: true,
    plans: [],
  });

  const lecture = await Lecture.create({
    title: "Conservation of momentum",
    description: "Worked examples on elastic and inelastic collisions.",
    subject: physics._id,
    chapter: mechanics._id,
    topic: motion._id,
    tag: "Core",
    order: 1,
    isPublished: true,
    // assigned below, through the same field the assignment endpoints write
    batches: [],
  });

  // Visibility comes from assignment and nothing else.
  await Lecture.updateOne({ _id: lecture._id }, { $addToSet: { batches: paidBatch._id } });
  await Question.updateMany(
    { subject: physics._id },
    { $addToSet: { batches: paidBatch._id } }
  );

  console.log("");
  console.log("Seeded.");
  console.log("");
  console.log(`  Owner    ${OWNER.email}`);
  console.log(`  Password ${ownerPassword}`);
  console.log("");
  console.log("  This password is shown once, here, and nowhere else — save it now.");
  console.log("  You'll be asked to change it before this install goes live.");
  console.log("");
  console.log(`  ${await Subject.countDocuments()} subjects, ${await Chapter.countDocuments()} chapters, ${await Topic.countDocuments()} topics`);
  console.log(`  ${await Question.countDocuments()} questions across mcq, mtf and written`);
  console.log(`  ${await Batch.countDocuments()} batches (${paidBatch.name}, ${freeBatch.name})`);
  console.log(`  ${await Lecture.countDocuments()} lecture assigned to ${paidBatch.name}`);
  console.log("");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (error) => {
  console.error("Seed failed:", error.message);
  await mongoose.connection.close();
  process.exit(1);
});
