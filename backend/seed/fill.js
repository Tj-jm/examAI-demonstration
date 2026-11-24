require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// Dummy records for every admin and student list page (questions and the
// archive excepted), to see how paging, filters and long lists behave.
//
//   node seed/fill.js                 300 of each
//   node seed/fill.js --count 500     500 of each
//   node seed/fill.js --only Doubt,Submission
//   node seed/fill.js --clean         deletes everything this script made
//   node seed/fill.js --dry           builds and validates, writes nothing
//
// Records are built from each model's schema: required fields, enums and
// unique keys are always valid; titles and text read like real content.
// Every id made is logged in the "fillseeds" collection, which --clean uses.
// Students and staff get @fill.example.com addresses and the password
// 123456789. Exams use the questions already there (none are made).
//
// Local databases only (the password is public); --allow-remote overrides.

const PASSWORD = "123456789";
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
const COUNT = Math.max(1, Number(option("count")) || 300);
const DRY = flag("dry");
const ONLY = option("only") ? option("only").split(",").map((x) => x.trim()) : null;

// What gets made, in an order where everything a record points to exists
// first.
const ORDER = [
  "User", "Media", "Program", "Subject", "Chapter", "Topic", "Batch", "Student", "Coupon", "Purchase", "Trial",
  "Lecture", "LectureProgress", "Exam", "Submission", "Assignment", "AssignmentSubmission", "Doubt", "SupportTicket",
  "ConductEvent", "Notice", "Notification", "LiveClass", "LiveAttendance", "LiveQuestion", "LivePoll", "LiveTranscript",
  "Campaign", "CampaignDelivery", "Certificate", "Payslip", "Invite", "Lead", "ShortLink", "Update", "StudyPlan",
  "Tutor", "GradeRemark", "ProgressReport", "AiCreditPlan", "AiCredit", "AiUsage", "ChatThread", "DocChatPack",
  "DeletionRequest", "AgentRun", "Visitor", "VisitSession", "CheckoutStart", "PlanView", "PageStat", "LiveStat",
  "LectureAiSummary", "StudentUpload",
];

const FIRST = ["Rafi", "Nadia", "Tanvir", "Sadia", "Arif", "Mitu", "Fahim", "Nusrat", "Imran", "Tania", "Rakib", "Farzana", "Sakib", "Jannat", "Hasan", "Lamia", "Shuvo", "Riya", "Mahin", "Anika", "Zahid", "Sumaiya", "Rifat", "Mehjabin", "Asif", "Tasnim", "Nayeem", "Orpita", "Siam", "Puja"];
const LAST = ["Ahmed", "Rahman", "Hossain", "Islam", "Khan", "Chowdhury", "Akter", "Sarker", "Uddin", "Haque", "Kabir", "Alam", "Das", "Roy", "Karim", "Biswas"];
const WORDS = ["Motion", "Vectors", "Waves", "Optics", "Algebra", "Calculus", "Organic", "Atoms", "Cells", "Energy", "Gravity", "Circuits", "Matrices", "Probability", "Genetics", "Acids", "Thermodynamics", "Statistics", "Geometry", "Ecology"];
const SENTENCES = [
  "Can you explain the second step of this problem again?",
  "I solved it a different way and got a different answer; which one is right?",
  "The formula from the lecture does not seem to match the textbook.",
  "Please check my working, I think I made a sign mistake somewhere.",
  "Why do we take the derivative here instead of integrating?",
  "The video stopped halfway and would not load again.",
  "Will this chapter be included in the final exam?",
  "Thanks, the explanation in class made this much clearer.",
  "I could not open the attached PDF on my phone.",
  "Could you share a few more practice problems on this topic?",
];

const rand = (n) => crypto.randomInt(Math.max(1, n));
const pick = (list) => list[rand(list.length)];
const chance = (p) => Math.random() < p;
const DAY = 86400000;
const daysAgo = (max, min = 0) => new Date(Date.now() - (min + Math.random() * (max - min)) * DAY);
const daysAhead = (max, min = 0) => new Date(Date.now() + (min + Math.random() * (max - min)) * DAY);
const token = () => crypto.randomBytes(8).toString("hex");
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const phrase = (i) => `${pick(WORDS)} ${pick(WORDS).toLowerCase()} ${i + 1}`;
const sentence = () => pick(SENTENCES);
const dayString = (d) => d.toISOString().slice(0, 10);

const isLocal = (uri) => /^mongodb:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\//.test(uri || "");

// Load every model so refs resolve.
const modelsDir = path.join(__dirname, "..", "models");
for (const file of fs.readdirSync(modelsDir)) {
  if (file.endsWith(".js")) { try { require(path.join(modelsDir, file)); } catch { /* not in this edition */ } }
}
const has = (name) => mongoose.modelNames().includes(name);

// Ids to point at, per model: what this run made first, else what's there.
const made = {};
const existing = {};
const idsOf = async (name) => {
  if (made[name]?.length) return made[name];
  if (existing[name]) return existing[name];
  if (DRY || !has(name)) return (existing[name] = name === "Question" ? [] : Array.from({ length: 50 }, () => new mongoose.Types.ObjectId()));
  existing[name] = (await mongoose.model(name).find({}, "_id").limit(1000).lean()).map((d) => d._id);
  return existing[name];
};
// Half the picks go to the first record made, so one batch, exam, class
// and student each get a long list of their own to page through.
const pickRef = (name, ids) => (made[name]?.length && chance(0.5) ? ids[0] : pick(ids));
// Whole records made this run, for overrides that need their fields.
const docs = {};

// Optional fields filled anyway, so lists have something to show and filter.
const FILL_TEXT = new Set(["title", "name", "description", "text", "body", "bodyMarkdown", "subject", "message", "note", "summary", "question", "answer", "remark", "reply", "caption", "recipientName", "label", "studentName"]);
const FILL_ENUM = new Set(["status", "kind", "type", "mode", "category", "priority", "role", "channel", "noticeType", "severity", "stage"]);
const FILL_REF = new Set(["batch", "student", "user", "host", "exam", "lecture", "program", "subject", "chapter", "topic", "campaign", "liveClass", "assignment", "createdBy", "assignedTo", "resolvedBy", "issuedBy", "gradedBy", "invitedBy"]);
const FILL_REFS = new Set(["batches", "subjects", "teachers", "graders", "topics"]);
const SKIP = new Set(["_id", "__v", "createdAt", "updatedAt"]);
const PEOPLE = new Set(["User", "Student", "Lead", "Payslip", "Certificate"]);

const set = (obj, p, value) => {
  const keys = p.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
};
const get = (obj, p) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

const ttlOf = (schema) => {
  const out = {};
  for (const [keys, opts] of schema.indexes()) if (opts.expireAfterSeconds !== undefined) out[Object.keys(keys)[0]] = opts.expireAfterSeconds;
  schema.eachPath((p, t) => { if (t.options?.expires !== undefined) out[p] = Number(t.options.expires); });
  return out;
};

// A date that the TTL index won't sweep before you've looked at it.
const ttlDate = (seconds) => (seconds === 0 ? daysAhead(60, 20) : daysAgo(Math.min(60, (seconds / 86400) * 0.25)));

const stringFor = (model, p, i, t) => {
  const leaf = p.split(".").pop();
  if (leaf === "email") return null; // set by overrides
  if (leaf === "day") return dayString(daysAgo(60));
  if (leaf === "path") return pick(["/", "/batches", "/pricing", "/login", "/signup", "/batch/hsc-physics"]);
  if (/phone/i.test(leaf)) return `+8801${String(rand(1e9)).padStart(9, "0")}`;
  if (leaf === "currency") return "BDT";
  if (leaf === "driver") return "local";
  if (leaf === "period") return dayString(daysAgo(90)).slice(0, 7);
  if (/^(code|couponCode)$/.test(leaf)) return `FILL${token().slice(0, 8).toUpperCase()}`;
  if (/^(serial|token|tokenHash|reference|key|contentHash|number|identity|visitor|catalogueId|slug)$/.test(leaf)) return `fill-${leaf}-${i}-${token()}`;
  if ((leaf === "name" || leaf === "recipientName") && PEOPLE.has(model)) return person();
  if (/^(question|text|body|bodyMarkdown|description|summary|message|note|remark|reply|request|source|caption|answer)$/.test(leaf)) return sentence();
  return phrase(i);
};

// One record from the schema; the model's override then adds meaning.
const build = async (name, i) => {
  const Model = mongoose.model(name);
  const schema = Model.schema;
  const ttl = ttlOf(schema);
  const doc = {};
  const paths = [];
  schema.eachPath((p, t) => paths.push([p, t]));
  for (const [p, t] of paths) {
    if (SKIP.has(p) || p.includes(".$")) continue;
    const top = !p.includes(".");
    const leaf = p.split(".").pop();
    const required = Boolean(t.isRequired);
    const ref = t.options?.ref || t.caster?.options?.ref;
    const enums = (t.enumValues || []).filter((v) => v !== null);
    if (ttl[p] !== undefined) { set(doc, p, ttlDate(ttl[p])); continue; }
    if (t.instance === "Array") {
      if (ref && (required || FILL_REFS.has(leaf))) {
        const ids = await idsOf(ref);
        if (ids.length) set(doc, p, [...new Set(Array.from({ length: 1 + rand(2) }, () => pickRef(ref, ids)))]);
      }
      continue;
    }
    if (ref) {
      if (required || (top && FILL_REF.has(leaf))) {
        const ids = await idsOf(ref);
        if (ids.length) set(doc, p, pickRef(ref, ids));
      }
      continue;
    }
    if (enums.length) {
      if (required || (top && FILL_ENUM.has(leaf))) set(doc, p, pick(enums));
      continue;
    }
    if (t.instance === "String") {
      const unique = t.options?.unique && !t.options?.sparse;
      if (required || unique || (top && FILL_TEXT.has(leaf))) { const v = stringFor(name, p, i, t); if (v !== null) set(doc, p, v); }
      continue;
    }
    if (!required) continue;
    if (t.instance === "Number") {
      const lo = t.options?.min ?? 1;
      const hi = t.options?.max ?? 100;
      set(doc, p, lo + rand(hi - lo + 1));
    } else if (t.instance === "Date") set(doc, p, chance(0.5) ? daysAgo(60) : daysAhead(30));
    else if (t.instance === "Boolean") set(doc, p, chance(0.5));
  }
  if (schema.path("createdAt") && ttl.createdAt === undefined) doc.createdAt = daysAgo(120);
  const override = OVERRIDES[name];
  if (override) await override(doc, i);
  return doc;
};

let HASH = null;
const usedEmails = new Set();
const emailFor = (fullName) => {
  for (;;) {
    const e = `${fullName.replace(/\s+/g, ".")}${rand(10000)}@fill.example.com`.toLowerCase();
    if (!usedEmails.has(e)) { usedEmails.add(e); return e; }
  }
};
const docOf = (model, id) => (docs[model] || []).find((d) => String(d._id) === String(id));

const OVERRIDES = {
  User: (d) => {
    Object.assign(d, { email: emailFor(d.name), password: HASH, isActive: true, role: pick(["teacher", "teacher", "grader", "doubtSolver", "representative", "admin"]) });
  },
  Student: (d) => {
    // insertMany skips the save hook that clears the 7-day signup sweep.
    Object.assign(d, { email: emailFor(d.name), password: HASH, isProfileComplete: true, isOtpVerified: true, isActive: true, expiresAt: null, lastSeenAt: daysAgo(30) });
  },
  Media: (d, i) => Object.assign(d, { kind: pick(["pdf", "image", "document"]), key: `fill/${i}-${token()}.pdf`, originalName: `notes-${i + 1}.pdf` }),
  Program: (d, i) => Object.assign(d, { title: `${pick(WORDS)} Program ${i + 1}` }),
  Subject: (d, i) => Object.assign(d, { title: `${pick(WORDS)} ${i + 1}` }),
  Batch: (d, i) => Object.assign(d, { name: `Batch ${pick(WORDS)} ${i + 1}`, isActive: true, accessType: pick(["free", "paid"]), order: i }),
  Purchase: (d, i) => {
    const students = made.Student || [];
    if (students[i]) d.student = students[i];
    Object.assign(d, {
      kind: "batch", status: chance(0.9) ? "complete" : pick(["pending", "failed", "refunded"]),
      plan: { label: pick(["1 month", "3 months", "Full course"]), price: pick([500, 1200, 2500]) },
      amountPaid: pick([500, 1200, 2500]), currency: "BDT", startDate: daysAgo(60), endDate: daysAhead(365, 30),
    });
  },
  Topic: (d) => { const c = docOf("Chapter", d.chapter); if (c) d.subject = c.subject; },
  Lecture: (d) => { const c = docOf("Chapter", d.chapter); if (c) d.subject = c.subject; },
  Trial: (d) => Object.assign(d, { startDate: daysAgo(10), endDate: daysAhead(10) }),
  Exam: async (d, i) => {
    const questions = await idsOf("Question");
    d.questions = questions.length ? [...new Set(Array.from({ length: Math.min(10, questions.length) }, () => pick(questions)))] : [];
    Object.assign(d, { title: `${pick(WORDS)} test ${i + 1}`, durationMinutes: pick([20, 30, 45, 60]), isPublished: true, createdByStudent: null });
  },
  Submission: (d) => {
    const exam = docOf("Exam", d.exam);
    if (exam?.batches?.length) d.batch = exam.batches[0];
    const status = pick(["submitted", "grading", "graded", "graded", "graded", "in_progress"]);
    Object.assign(d, { attempt: 1, status, totalMarks: 100, startedAt: daysAgo(30, 1) });
    if (status !== "in_progress") d.submittedAt = new Date(d.startedAt.getTime() + 40 * 60000);
    if (status === "graded") Object.assign(d, { marks: rand(101), gradedAt: daysAgo(1) });
  },
  Assignment: (d, i) => Object.assign(d, { title: `${pick(WORDS)} assignment ${i + 1}`, maxMarks: pick([10, 20, 50]), dueAt: chance(0.5) ? daysAgo(20) : daysAhead(20) }),
  AssignmentSubmission: (d) => { const a = docOf("Assignment", d.assignment); if (a) d.batch = a.batch; },
  LectureProgress: (d) => { const l = docOf("Lecture", d.lecture); if (l?.batches?.length) d.batch = l.batches[0]; },
  LiveClass: (d, i) => Object.assign(d, { title: `${pick(WORDS)} live class ${i + 1}`, scheduledAt: chance(0.5) ? daysAgo(30) : daysAhead(30), provider: pick(["manual", "zoom", "livekit"]) }),
  LiveAttendance: (d) => { d.identity = `student-${d.student}`; },
  Campaign: (d, i) => Object.assign(d, { name: `${pick(["Eid offer", "Exam reminder", "Comeback", "New batch", "Discount"])} ${i + 1}` }),
  Coupon: (d) => Object.assign(d, { discountType: pick(["percent", "fixed"]), discountValue: pick([10, 20, 30, 100]), isActive: true, referrer: undefined, ownerStudent: undefined }),
  Notice: (d) => Object.assign(d, { bodyMarkdown: `${sentence()}\n\n${sentence()}` }),
  Invite: (d) => Object.assign(d, { name: person(), email: emailFor(person()) }),
  Certificate: (d, i) => Object.assign(d, { title: `Certificate of completion ${i + 1}` }),
  Payslip: (d, i) => Object.assign(d, { number: `FILL-PS-${i + 1}-${token().slice(0, 4)}`, currency: "BDT", total: pick([5000, 8000, 12000]), periodFrom: daysAgo(60, 30), periodTo: daysAgo(30) }),
  ShortLink: (d) => { const c = (docs.Coupon || [])[rand((docs.Coupon || [1]).length)]; d.couponCode = c?.code || d.couponCode; },
  Lead: (d) => Object.assign(d, { name: person(), phone: `+8801${String(rand(1e9)).padStart(9, "0")}` }),
  AgentRun: (d) => Object.assign(d, { agent: pick(["grading", "copilot", "atRisk", "afterClass"]) }),
  AiUsage: (d) => Object.assign(d, { feature: pick(["doubt", "practice", "grading", "explain"]) }),
  StudentUpload: (d) => Object.assign(d, { folder: pick(["notes", "homework", "photos"]) }),
};

// Pairs that a unique index allows once (student + batch and the like).
const uniqueKeys = (schema) => schema.indexes().filter(([keys, o]) => o.unique && Object.keys(keys).length > 1 && !o.partialFilterExpression).map(([keys]) => Object.keys(keys));

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!DRY) {
    if (!uri) throw new Error("MONGO_URI is not set (backend/.env).");
    if (!isLocal(uri) && !flag("allow-remote")) {
      throw new Error(`MONGO_URI is not a local database (${uri.replace(/\/\/[^@]*@/, "//***@")}). These accounts share a public password; add --allow-remote if you really mean it.`);
    }
    await mongoose.connect(uri);
  }
  const log = DRY ? null : mongoose.connection.collection("fillseeds");

  if (flag("clean")) {
    for (const name of [...ORDER].reverse()) {
      if (!has(name)) continue;
      const ids = (await log.find({ model: name }).toArray()).flatMap((x) => x.ids);
      if (!ids.length) continue;
      const { deletedCount } = await mongoose.model(name).deleteMany({ _id: { $in: ids } });
      console.log(`  ${name}: ${deletedCount} deleted`);
    }
    await log.deleteMany({});
    console.log("Done.");
    await mongoose.disconnect();
    return;
  }

  HASH = await bcrypt.hash(PASSWORD, 10);
  for (const name of ORDER) {
    if (!has(name) || (ONLY && !ONLY.includes(name))) continue;
    const Model = mongoose.model(name);
    const pairs = uniqueKeys(Model.schema);
    const seen = pairs.map(() => new Set());
    const out = [];
    for (let i = 0, tries = 0; out.length < COUNT && tries < COUNT * 20; tries += 1, i += 1) {
      const d = await build(name, i);
      const keys = pairs.map((ks) => ks.map((k) => String(get(d, k))).join("|"));
      if (keys.some((k, j) => seen[j].has(k))) continue;
      keys.forEach((k, j) => seen[j].add(k));
      d._id = new mongoose.Types.ObjectId();
      out.push(d);
    }
    let inserted = out;
    let problem = "";
    if (DRY) {
      const errors = out.map((d) => new Model(d).validateSync()).filter(Boolean);
      if (errors.length) problem = ` (${errors.length} invalid: ${errors[0].message})`;
    } else {
      try {
        const res = await Model.insertMany(out, { ordered: false, rawResult: true, lean: false });
        const bad = new Set((res.mongoose?.validationErrors || []).map(String));
        if (bad.size) problem = ` (${bad.size} invalid: ${[...bad][0]})`;
        const ok = new Set(Object.values(res.insertedIds || {}).map(String));
        inserted = out.filter((d) => ok.has(String(d._id)));
      } catch (error) {
        const ok = new Set((error.insertedDocs || []).map((x) => String(x._id)));
        inserted = out.filter((d) => ok.has(String(d._id)));
        problem = ` (${out.length - inserted.length} failed: ${error.writeErrors?.[0]?.errmsg || error.message})`;
      }
      if (inserted.length) await log.insertOne({ model: name, ids: inserted.map((d) => d._id), at: new Date() });
    }
    made[name] = inserted.map((d) => d._id);
    docs[name] = inserted;
    console.log(`${name.padEnd(22)} ${String(inserted.length).padStart(5)}${problem}`);
  }

  if (!DRY) {
    console.log(`\nStudents and staff: @fill.example.com, password ${PASSWORD}.`);
    console.log("Undo all of it: node seed/fill.js --clean --allow-remote");
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
