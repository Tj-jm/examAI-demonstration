require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

// A class's worth of activity on a local install, in one command:
//
//   npm run simulate -- --batch "HSC Physics"
//
// 1. Creates students (100 by default; password 123456789) and enrols them
//    in the batch, the way "Grant access" does.
// 2. If the batch has a class live right now, they attend it. In-app
//    classes: they join the room as viewers (no camera or mic) and stay
//    until you press Ctrl+C, so the host sees them and attendance is
//    recorded as for anyone; a few ask on the Q&A board and they answer the
//    open poll. Needs your LiveKit server running; --no-join records
//    attendance without joining.
// 3. They all sit the same exam with random answers, each student with
//    their own skill level, and hand it in. Scoring, results and the
//    leaderboard all run through the server as for a real student.
//
// Needs the backend running (npm run dev). Options:
//   --batch <name or id>     required
//   --exam <title or id>     default: the batch's open exam (the newest)
//   --class <title or id>    default: the batch's live class, if any
//   --students <n>           default 100
//   --api <url>              default http://localhost:<PORT or 5000>
//   --no-join                don't connect to the room, only record attendance
//   --existing               use students already enrolled in the batch
//                            (up to --students of them) instead of making
//                            new ones; all of them attend the live class
//   --no-exam                skip the exam
//
// The accounts go to sim-accounts.csv. Local databases only (the password
// is public); --allow-remote overrides that.

const PASSWORD = "123456789";
const FIRST = ["Rafi", "Nadia", "Tanvir", "Sadia", "Arif", "Mitu", "Fahim", "Nusrat", "Imran", "Tania", "Rakib", "Farzana", "Sakib", "Jannat", "Hasan", "Lamia", "Shuvo", "Riya", "Mahin", "Anika", "Zahid", "Sumaiya", "Rifat", "Mehjabin", "Asif", "Tasnim", "Nayeem", "Orpita", "Siam", "Puja"];
const LAST = ["Ahmed", "Rahman", "Hossain", "Islam", "Khan", "Chowdhury", "Akter", "Sarker", "Uddin", "Haque", "Kabir", "Alam", "Das", "Roy", "Karim", "Biswas"];
const QUESTIONS = [
  "Can you explain that last step again?", "Will this be in the exam?", "Why does the sign change there?",
  "Is there a shortcut for this type of problem?", "Can you share the notes after class?", "What unit should the answer be in?",
  "Could you do one more example?", "How is this different from yesterday's topic?",
];
const WRITTEN = [
  "Using the formula from the chapter, the value works out after substituting the given quantities.",
  "First I wrote the given data, then applied the law and simplified step by step to get the result.",
  "The answer follows from the definition; the diagram shows the forces acting on the body.",
  "I am not fully sure, but I think the relation is directly proportional as shown in class.",
];

const args = (() => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith("--") ? (i += 1, next) : true;
  }
  return out;
})();

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[crypto.randomInt(list.length)];
const isLocal = (uri) => /^mongodb:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?\//.test(uri || "");
const fail = (msg) => { throw new Error(msg); };

// By id, else by name/title (case-insensitive, partial).
const find = async (Model, field, value, extra = {}) => {
  if (mongoose.isValidObjectId(value)) {
    const doc = await Model.findOne({ _id: value, ...extra });
    if (doc) return doc;
  }
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = await Model.find({ [field]: new RegExp(escaped, "i"), ...extra }).limit(5);
  if (matches.length > 1) {
    const exact = matches.find((m) => String(m[field]).toLowerCase() === String(value).toLowerCase());
    if (exact) return exact;
    fail(`More than one match for "${value}": ${matches.map((m) => `"${m[field]}" (${m._id})`).join(", ")}. Use the id.`);
  }
  return matches[0] || null;
};

// A few requests at a time; waits out the student API's rate limit.
const runPool = async (items, size, fn) => {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i).catch((error) => ({ error: error.message }));
    }
  }));
  return results;
};

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) fail("MONGO_URI is not set (backend/.env).");
  if (!isLocal(uri) && !args["allow-remote"]) fail("MONGO_URI is not a local database. These students share a public password; run this against a local database, or add --allow-remote.");
  if (!process.env.JWT_SECRET) fail("JWT_SECRET is not set (backend/.env).");
  if (!args.batch || args.batch === true) fail('Say which batch: npm run simulate -- --batch "Batch name"');
  const api = String(args.api || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");
  const count = Math.max(1, Math.min(2000, Number(args.students) || 100));

  try {
    const health = await fetch(`${api}/api/health`);
    if (!health.ok) throw new Error();
  } catch {
    fail(`The backend isn't answering at ${api}. Start it (npm run dev) or pass --api.`);
  }

  await mongoose.connect(uri);
  const Student = require("../models/studentModel");
  const Batch = require("../models/batchModel");
  const Exam = require("../models/examModel");
  const LiveClass = require("../models/liveClassModel");
  const LiveAttendance = require("../models/liveAttendanceModel");
  const Purchase = require("../models/purchaseModel");
  const Submission = require("../models/submissionModel");
  const AppSettings = require("../models/appSettingsModel");
  const { Question } = require("../models/questionModel");

  const batch = await find(Batch, "name", args.batch);
  if (!batch) fail(`No batch matches "${args.batch}".`);

  let exam = null;
  if (args.exam && args.exam !== true) {
    exam = await find(Exam, "title", args.exam, { batches: batch._id, createdByStudent: null });
    if (!exam) fail(`No exam on ${batch.name} matches "${args.exam}".`);
  } else if (!args["no-exam"]) {
    const exams = await Exam.find({ batches: batch._id, createdByStudent: null, isPublished: true }).sort({ createdAt: -1 });
    exam = exams.find((e) => e.isOpen() && e.questions.length) || null;
  }
  if (exam && !exam.isOpen()) fail(`"${exam.title}" isn't open right now (published, active and inside its time window).`);
  if (exam && !exam.questions.length) fail(`"${exam.title}" has no questions.`);

  let liveClass = null;
  if (args.class && args.class !== true) {
    liveClass = await find(LiveClass, "title", args.class, { batch: batch._id });
    if (!liveClass) fail(`No live class on ${batch.name} matches "${args.class}".`);
    if (liveClass.status !== "live") fail(`"${liveClass.title}" isn't live (it's ${liveClass.status}). Start it first.`);
  } else {
    liveClass = await LiveClass.findOne({ batch: batch._id, status: "live" }).sort({ scheduledAt: -1 });
  }

  console.log(`Batch: ${batch.name}`);
  console.log(`Exam: ${exam ? `${exam.title} (${exam.questions.length} questions)` : "none open, skipped"}`);
  console.log(`Live class: ${liveClass ? `${liveClass.title} (${liveClass.provider})` : "none live, skipped"}`);

  // ---- students, enrolled ----
  const existing = Boolean(args.existing);
  let students;
  if (existing) {
    const enrolled = await Purchase.distinct("student", { batch: batch._id, status: "complete" });
    students = await Student.find({ _id: { $in: enrolled }, isActive: { $ne: false } }).limit(count);
    if (!students.length) fail(`No students are enrolled in ${batch.name}.`);
    // A signed-in cookie needs a session id; give one to anyone without.
    for (const s of students.filter((st) => !st.sessionId)) {
      s.sessionId = crypto.randomBytes(16).toString("hex");
      await Student.updateOne({ _id: s._id }, { sessionId: s.sessionId });
    }
    console.log(`\n${students.length} enrolled students taking part.`);
  } else {
    const hash = await bcrypt.hash(PASSWORD, await bcrypt.genSalt(10));
    const taken = new Set((await Student.find({}, "email").lean()).map((s) => s.email));
    const docs = [];
    while (docs.length < count) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const email = `${first}.${last}${crypto.randomInt(1000, 10000)}@example.com`.toLowerCase();
      if (taken.has(email)) continue;
      taken.add(email);
      docs.push({
        name: `${first} ${last}`, email, password: hash, isProfileComplete: true, isOtpVerified: true, isActive: true,
        sessionId: crypto.randomBytes(16).toString("hex"),
      });
    }
    // insertMany skips the save hook, which would hash the hash again.
    students = await Student.insertMany(docs);
    const currency = (await AppSettings.get()).defaultCurrency;
    await Purchase.insertMany(students.map((s) => ({
      student: s._id, batch: batch._id, plan: { label: "Simulated class", price: 0, durationDays: null, isInfinite: true },
      // insertMany skips Purchase's save hook, which sets these.
      amountPaid: 0, startDate: new Date(), endDate: new Date("9999-12-31T23:59:59Z"),
      currency, provider: "manual", status: "complete", note: "npm run simulate",
    })));
    console.log(`\n${students.length} students created and enrolled.`);
  }

  // Signed in as each student: the same cookie a login sets.
  const cookieFor = (s) => `examai_student=${jwt.sign({ id: s._id, sessionId: s.sessionId, role: "student", aud: "student" }, process.env.JWT_SECRET, { expiresIn: "1d" })}`;
  const call = async (s, method, url, body) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await fetch(`${api}${url}`, {
        method,
        headers: { cookie: cookieFor(s), ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get("ratelimit-reset") || res.headers.get("retry-after") || 5);
        await new Promise((r) => setTimeout(r, Math.min(60, wait + 1) * 1000));
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `${method} ${url}: ${res.status}`);
      return data;
    }
    throw new Error("Still rate limited after several tries.");
  };
  const base = `/api/app/batches/${batch._id}`;

  // ---- the live class ----
  const rooms = [];
  const joinedIds = new Set();
  if (liveClass) {
    // A few never turn up, unless these are the batch's own students.
    const attending = existing ? students : students.filter(() => Math.random() < 0.9);
    if (liveClass.provider === "livekit") {
      // Really in the room: each student connects as a viewer (no camera
      // or microphone), so the host sees them, and the attendance sweep
      // records them as it would anyone. They stay until Ctrl+C.
      if (!args["no-join"]) {
        let Room = null;
        // Its logger prints a debug line per connection unless NODE_ENV is
        // production when it loads.
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        try { ({ Room } = require("@livekit/rtc-node")); } catch { /* optional package not installed */ }
        process.env.NODE_ENV = env;
        if (!Room) {
          console.log("Live class: @livekit/rtc-node isn't installed (npm install in backend), so attendance is recorded without joining the room.");
        } else {
          const joined = await runPool(attending, 8, async (s) => {
            const pass = await call(s, "POST", `${base}/live-classes/${liveClass._id}/room-token`);
            const room = new Room();
            await room.connect(pass.url, pass.token, { autoSubscribe: false, dynacast: false });
            rooms.push(room);
            joinedIds.add(String(s._id));
            return true;
          });
          const failed = joined.filter((j) => j?.error);
          console.log(`Live class: ${rooms.length} students are in the room${failed.length ? ` (${failed.length} couldn't join, e.g.: ${failed[0].error})` : ""}.`);
        }
      }
      const now = Date.now();
      const started = Math.min(now - 5 * 60000, new Date(liveClass.liveSince || liveClass.scheduledAt).getTime());
      const span = now - started;
      // Students who didn't join get attendance written for them instead.
      const recordFor = attending.filter((s) => !joinedIds.has(String(s._id)));
      if (recordFor.length) await LiveAttendance.insertMany(recordFor.map((s) => {
        const joinedAt = new Date(started + rand(0, 0.3) * span);
        const leftAt = new Date(Math.min(now, joinedAt.getTime() + rand(0.4, 1) * (now - joinedAt.getTime())));
        return {
          liveClass: liveClass._id, identity: `student:${s._id}`, student: s._id, name: s.name, role: "student",
          sessions: [{ joinedAt, leftAt }], lastSeenAt: leftAt, totalSeconds: Math.round((leftAt - joinedAt) / 1000),
        };
      }), { ordered: false });
      const askers = attending.filter(() => Math.random() < 0.15);
      const asked = await runPool(askers, 5, (s) => call(s, "POST", `${base}/live-classes/${liveClass._id}/qa`, { text: pick(QUESTIONS) }));
      let polled = 0;
      const poll = attending[0] ? await call(attending[0], "GET", `${base}/live-classes/${liveClass._id}/polls/current`).catch(() => null) : null;
      const current = poll?.poll || poll;
      if (current?._id && Array.isArray(current.options) && current.options.length) {
        const answers = await runPool(attending, 8, (s) => call(s, "POST", `${base}/live-classes/${liveClass._id}/polls/${current._id}/answer`, { key: pick(current.options).key }));
        polled = answers.filter((a) => !a?.error).length;
      }
      console.log(`Live class: ${attending.length} attended, ${asked.filter((a) => !a?.error).length} asked a question${current?._id ? `, ${polled} answered the poll` : ""}.`);
    } else {
      const opened = await runPool(attending, 8, (s) => call(s, "GET", `${base}/live-classes/${liveClass._id}`));
      console.log(`Live class: ${opened.filter((o) => !o?.error).length} opened the join page (attendance for ${liveClass.provider} classes comes from ${liveClass.provider === "zoom" ? "Zoom" : "the host"}, not the app).`);
    }
  }

  // ---- the exam ----
  if (exam) {
    const questions = await Question.find({ _id: { $in: exam.questions } }).lean();
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    const choose = (options, correct, skill) => {
      const keys = (options || []).map((o) => o.key);
      if (!keys.length) return null;
      if (Math.random() < skill) return correct ?? pick(keys);
      const wrong = keys.filter((k) => k !== correct);
      return wrong.length ? pick(wrong) : pick(keys);
    };
    const answerFor = (q, skill) => {
      if (Math.random() < 0.06) return null; // skipped
      if (q.type === "mcq") return { selectedOption: choose(q.options, q.correctOption, skill) };
      if (q.type === "mtf") return { statementAnswers: (q.statements || []).map((st, index) => ({ index, value: Math.random() < skill ? st.isTrue : !st.isTrue })) };
      if (q.type === "passage") return { subAnswers: (q.subQuestions || []).map((sq, index) => ({ index, selectedOption: choose(sq.options, sq.correctOption, skill) })) };
      if (q.type === "written") return { answerText: pick(WRITTEN) };
      return null;
    };

    const results = await runPool(students, 6, async (s) => {
      const skill = rand(0.3, 0.95);
      const started = await call(s, "POST", `${base}/exams/${exam._id}/start`);
      const submission = await Submission.findById(started.submissionId);
      if (!submission) throw new Error("No attempt was opened.");
      // Took part of the time allowed, as a real sitting would.
      const tookMs = rand(0.35, 0.9) * exam.durationMinutes * 60000;
      submission.startedAt = new Date(Date.now() - tookMs);
      for (const a of submission.answers) {
        const q = byId.get(String(a.question));
        const ans = q && answerFor(q, skill);
        if (ans) Object.assign(a, ans);
        a.timeSpentMs = Math.round(tookMs / submission.answers.length * rand(0.5, 1.5));
      }
      await submission.save();
      const done = await call(s, "POST", `/api/app/submissions/${started.submissionId}/submit`);
      return { status: done.status };
    });

    const ok = results.filter((r) => r && !r.error);
    const errors = results.filter((r) => r?.error);
    const byStatus = ok.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
    console.log(`Exam: ${ok.length} handed in (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}).`);
    if (errors.length) console.log(`  ${errors.length} couldn't sit it, e.g.: ${errors[0].error}`);
    const graded = await Submission.find({ exam: exam._id, student: { $in: students.map((s) => s._id) }, status: "graded" }).select("marks totalMarks").lean();
    if (graded.length) {
      const marks = graded.map((g) => g.marks || 0);
      console.log(`  Scores: lowest ${Math.min(...marks)}, average ${(marks.reduce((a, b) => a + b, 0) / marks.length).toFixed(1)}, highest ${Math.max(...marks)} (of ${graded[0].totalMarks ?? "?"}).`);
    }
    if (questions.some((q) => q.type === "written")) console.log("  Written answers are waiting for a grader (Submissions → To grade).");
  }

  if (!existing) {
    const rows = students.map((s) => `${batch.name.replace(/,/g, " ")},${s.name},${s.email},${PASSWORD}`).join("\n") + "\n";
    const append = (file) => fs.appendFileSync(file, (fs.existsSync(file) ? "" : "batch,name,email,password\n") + rows);
    // In the Docker image the app folder is read-only to the app's user; the
    // list then goes to the temp folder.
    let file = path.join(__dirname, "..", "sim-accounts.csv");
    try {
      append(file);
    } catch {
      file = path.join(require("os").tmpdir(), "sim-accounts.csv");
      append(file);
    }
    console.log(`\nAccounts (password ${PASSWORD}) are in ${file}`);
  }
  await mongoose.disconnect();

  if (rooms.length) {
    console.log(`\n${rooms.length} students are still in the live class. Press Ctrl+C to have them all leave.`);
    await new Promise((resolve) => process.once("SIGINT", resolve));
    console.log("Leaving the room...");
    await Promise.all(rooms.map((room) => room.disconnect().catch(() => {})));
    try { await require("@livekit/rtc-node").dispose(); } catch { /* already gone */ }
    process.exit(0);
  }
};

run().catch(async (error) => {
  console.error(`\n${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
