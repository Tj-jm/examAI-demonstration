require("dotenv").config();

const crypto = require("crypto");
const mongoose = require("mongoose");

// Test guardians for one batch: every student on its register gets a random
// guardian with a Bangladeshi mobile number and an @example.com address (a
// reserved domain, so nothing is ever delivered anywhere). For trying
// progress reports against Mailpit and a fake SMS gateway.
//
//   npm run seed:guardians -- "Physics A"      (a batch name or id)
//   npm run seed:guardians -- "Physics A" --replace
//
// Students who already have a guardian are left alone unless --replace.
// Local databases only; --allow-remote overrides that.

const MEN = ["Abdul Karim", "Mizanur Rahman", "Jamal Uddin", "Habibur Rahman", "Anwar Hossain", "Kamal Chowdhury", "Delwar Hossain", "Mosharraf Ali", "Nurul Islam", "Shafiqul Alam"];
const WOMEN = ["Rahima Begum", "Shahana Akter", "Nasrin Sultana", "Ferdousi Khatun", "Rokeya Begum", "Salma Haque", "Parveen Akter", "Hasina Banu", "Jesmin Ara", "Morium Begum"];
const RELATIONS = [["Father", MEN], ["Mother", WOMEN], ["Father", MEN], ["Mother", WOMEN], ["Uncle", MEN], ["Aunt", WOMEN], ["Elder brother", MEN]];

const pick = (list) => list[crypto.randomInt(list.length)];
const isLocal = (uri) => /^mongodb:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\//.test(uri || "");

const run = async () => {
  const args = process.argv.slice(2);
  const key = args.find((a) => !a.startsWith("--"));
  const replace = args.includes("--replace");
  if (!key) throw new Error('Name the batch: npm run seed:guardians -- "Physics A"');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set (backend/.env).");
  if (!isLocal(uri) && !args.includes("--allow-remote")) {
    throw new Error("MONGO_URI is not a local database. Add --allow-remote if you really mean it.");
  }
  await mongoose.connect(uri);
  const Batch = require("../models/batchModel");
  const Student = require("../models/studentModel");
  const { roster } = require("../utils/roster");

  const matches = mongoose.isValidObjectId(key)
    ? await Batch.find({ _id: key }).select("name")
    : await Batch.find({ name: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).select("name");
  if (!matches.length) throw new Error(`No batch "${key}".`);
  if (matches.length > 1) throw new Error(`${matches.length} batches are called "${key}"; use the id instead:\n${matches.map((b) => `  ${b._id}`).join("\n")}`);
  const batch = matches[0];

  const students = await roster(batch._id);
  const used = new Set();
  let added = 0;
  let kept = 0;
  for (const s of students) {
    const current = await Student.findById(s._id).select("guardian").lean();
    if (!replace && (current?.guardian?.phone || current?.guardian?.email)) { kept += 1; continue; }
    let phone;
    do phone = `+8801${pick(["3", "4", "5", "6", "7", "8", "9"])}${String(crypto.randomInt(1e8)).padStart(8, "0")}`; while (used.has(phone));
    used.add(phone);
    const [relation, names] = pick(RELATIONS);
    const name = pick(names);
    await Student.updateOne({ _id: s._id }, {
      $set: {
        guardian: {
          name, relation, phone,
          email: `${name.toLowerCase().replace(/\s+/g, ".")}.${crypto.randomInt(1e4)}@example.com`,
          optOut: false,
        },
      },
    });
    added += 1;
  }
  console.log(`${batch.name}: ${students.length} students on the register, ${added} guardian${added === 1 ? "" : "s"} added${kept ? `, ${kept} kept (use --replace to overwrite)` : ""}.`);
  await mongoose.disconnect();
};

run().catch((e) => { console.error(e.message); process.exit(1); });
