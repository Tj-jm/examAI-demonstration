// One-time migration — run this ONCE, before deploying the code change
// that repurposes Batch.doubtLimits.weeklyHumanDoubts.
//
// Old meaning: 0 or unset both meant "unlimited human doubts" (the
// schema used to default new batches to 0).
// New meaning: unset means "unlimited", but 0 is now its own distinct
// state — "this batch has no human doubt capacity at all" (AI-only).
//
// Any batch currently sitting on a literal 0 — whether an admin never
// touched this field (schema default) or explicitly saved 0 to mean "no
// cap" under the old convention — would silently flip from "unlimited
// human doubts" to "AI-only, humans blocked" the moment the new code
// ships, with no admin action and no warning. This script finds every
// batch at exactly 0 and clears the field instead, so they keep their
// old "unlimited" behavior under the new rules. An admin who actually
// wants a batch to be AI-only sets 0 again afterward, deliberately.
//
// Usage:  node backend/scripts/migrateDoubtLimitSentinel.js
// Needs the same MONGO_URI as the server (reads backend/.env).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Batch = require("../models/batchModel");

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set — copy backend/.env.example to backend/.env first.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected: ${mongoose.connection.host}`);

  const affected = await Batch.find({ "doubtLimits.weeklyHumanDoubts": 0 }).select("_id name");
  console.log(`Found ${affected.length} batch(es) at doubtLimits.weeklyHumanDoubts = 0:`);
  affected.forEach((b) => console.log(`  - ${b.name} (${b._id})`));

  if (affected.length > 0) {
    const result = await Batch.updateMany(
      { "doubtLimits.weeklyHumanDoubts": 0 },
      { $unset: { "doubtLimits.weeklyHumanDoubts": "" } }
    );
    console.log(`Cleared the field on ${result.modifiedCount} batch(es) — they now mean "unlimited", same as before this migration.`);
  } else {
    console.log("Nothing to migrate.");
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
