// Agents: the admin copilot's plan → approve → act loop, with the AI stubbed.
process.env.SETTINGS_CACHE_MS = process.env.SETTINGS_CACHE_MS || "0";
let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); }
};
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
const settle = async (Model, id, until, tries = 60) => {
  for (let i = 0; i < tries; i += 1) {
    const doc = await Model.findById(id);
    if (until(doc)) return doc;
    await new Promise((r) => setTimeout(r, 50));
  }
  return Model.findById(id);
};

(async () => {
  console.log("plan checks");
  const engine = require("../agents/engine");
  const good = engine.checkPlan("copilot", [
    { tool: "create_exam", title: "Make it", args: JSON.stringify({ title: "Mock", durationMinutes: 60, batchIds: ["64b000000000000000000001"] }) },
    { tool: "add_questions", title: "Fill it", args: JSON.stringify({ exam: "step:1", count: 10 }) },
  ]);
  check("a sound plan passes, with defaults filled", !good.errors.length && good.steps[0].args.mode === "test" && good.steps[0].risk === "safe", good.errors);
  const bad = engine.checkPlan("copilot", [
    { tool: "drop_database", title: "x", args: "{}" },
    { tool: "add_questions", title: "x", args: JSON.stringify({ exam: "step:5", count: 0 }) },
    { tool: "create_exam", title: "x", args: "not json" },
  ]);
  check("unknown tools, bad args and forward references are caught", bad.errors.length === 3 && !bad.steps.length, bad.errors);

  // A notice's picture: the plan may describe one, never pick the stored image.
  const notice = engine.checkPlan("copilot", [
    { tool: "post_notice", title: "Tell them", args: JSON.stringify({ title: "Eid holiday", bodyMarkdown: "No class on Friday.", batchIds: ["64b000000000000000000001"], picture: "a crescent moon over a mosque", coverImage: "64b000000000000000000009" }) },
  ]);
  check("a planned notice keeps its picture description but not a chosen image",
    !notice.errors.length && notice.steps[0].args.picture && notice.steps[0].args.coverImage === undefined, notice.errors);
  const postNotice = engine.AGENTS.copilot.tools.post_notice;
  const removed = await postNotice.changePicture({ title: "t", coverImage: "64b000000000000000000009" }, {}, { action: "remove" });
  check("removing the picture clears it", removed.coverImage === null);
  let refused = null;
  try { await postNotice.changePicture({ title: "t" }, {}, { action: "remake" }); } catch (e) { refused = e; }
  check("remaking with no description is refused", refused?.statusCode === 400);

  if (!process.env.TEST_MONGO_URL) {
    console.log("database: skipped (set TEST_MONGO_URL to run)");
  } else {
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.TEST_MONGO_URL);
    // A test database of its own: start clean, whatever an earlier run left.
    if (/test/.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
    const Batch = require("../models/batchModel");
    const Program = require("../models/programModel");
    const Exam = require("../models/examModel");
    const Notice = require("../models/noticeModel");
    const AgentRun = require("../models/agentRunModel");
    const AiConfig = require("../models/aiConfigModel");
    const Subject = require("../models/subjectModel");
    const Chapter = require("../models/chapterModel");
    const { Question } = require("../models/questionModel");
    const User = require("../models/userModel");
    require("../models/studentModel");
    const ctl = require("../controllers/admin/agentController");
    const ai = require("../ai/service");
    const realGenerate = ai.generate;
    process.env.SETTINGS_CACHE_MS = "0";

    const owner = await User.create({ name: "Owner AG", email: `ag${Date.now()}@t.io`, password: "x".repeat(12), role: "owner" });
    const teacher = await User.create({ name: "Teacher AG", email: `agt${Date.now()}@t.io`, password: "x".repeat(12), role: "teacher" });
    const program = await Program.create({ title: "AG test" });
    const subject = await Subject.create({ title: "Physics AG", name: "Physics AG" });
    const chapter = await Chapter.create({ title: "Optics AG", name: "Optics AG", subject: subject._id });
    const other = await Chapter.create({ title: "Waves AG", name: "Waves AG", subject: subject._id });
    const batch = await Batch.create({ name: "AG Batch", program: program._id, isActive: true, subjects: [subject._id], features: { agentCopilot: true } });
    const offBatch = await Batch.create({ name: "AG Off", program: program._id, isActive: true, features: { agentCopilot: false } });
    const mk = (n, ch, type = "mcq") => Question.create({
      type, question: `Q${n} about light rays and lenses?`, options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1,
      status: "published", subject: subject._id, chapter: ch, topic: new mongoose.Types.ObjectId(),
    });
    for (let i = 0; i < 8; i += 1) await mk(i, chapter._id);
    for (let i = 0; i < 5; i += 1) await mk(100 + i, other._id);

    await AiConfig.updateOne({}, { $set: { "agents.enabled": false } }, { upsert: true });
    let out = await run(ctl.createRun, { user: owner, body: { request: "Make a quiz" } });
    check("off by default: the copilot refuses", out.code === 403 && /switched off/.test(out.body.message), out.body);
    await AiConfig.updateOne({}, { $set: { "agents.enabled": true, "agents.copilot.enabled": true, "agents.copilot.mode": "safe", "agents.copilot.roles": ["owner", "admin"] } });
    out = await run(ctl.createRun, { user: teacher, body: { request: "Make a quiz" } });
    check("roles not allowed are refused", out.code === 403 && /role/.test(out.body.message), out.body);

    console.log("\ncopilot");
    let prompts = [];
    ai.generate = async (o) => {
      prompts.push(o.prompt);
      return { data: {
        reply: "I'll make a 6-question Optics quiz for AG Batch, then publish it and tell the students.",
        steps: [
          { tool: "create_exam", title: "Create the quiz", args: JSON.stringify({ title: "Optics quiz", mode: "quiz", durationMinutes: 20, batchIds: [String(batch._id)] }) },
          { tool: "add_questions", title: "Add Optics questions", args: JSON.stringify({ exam: "step:1", count: 6, chapterIds: [String(chapter._id)] }) },
          { tool: "publish_exam", title: "Publish it", args: JSON.stringify({ exam: "step:1" }) },
          { tool: "post_notice", title: "Tell the batch", args: JSON.stringify({ title: "Optics quiz is up", bodyMarkdown: "Good luck!", batchIds: [String(batch._id)] }) },
        ],
      }, usage: { promptTokens: 1, completionTokens: 1 } };
    };
    out = await run(ctl.createRun, { user: owner, body: { request: "Make a 6 question optics quiz for AG Batch, publish it and tell them", timezone: "Asia/Dhaka" } });
    check("a request is accepted and planned in the background", out.code === 201 && out.body.status === "planning", out.body);
    const rid = out.body._id;
    let doc = await settle(AgentRun, rid, (d) => d.status === "awaiting" || d.status === "failed");
    check("the planner sees the batch, chapters and bank counts", /AG Batch/.test(prompts[0]) && /Optics AG \| mcq:8/.test(prompts[0]) && /UTC\+06:00/.test(prompts[0]), prompts[0]?.slice(0, 400));
    check("a batch without the switch is listed by name only, as off-limits", /OTHER BATCHES[^\n]*\n[^\n]*AG Off/.test(prompts[0]) && !new RegExp(`${offBatch._id}`).test(prompts[0]), prompts[0]?.slice(0, 600));
    check("safe mode: drafts run by themselves, publishing waits", doc.status === "awaiting" && doc.steps[0].status === "done" && doc.steps[1].status === "done" && doc.steps[2].status === "pending", doc.steps.map((s) => s.status + (s.error ? ":" + s.error : "")));
    const examId = doc.steps[0].result.examId;
    let exam = await Exam.findById(examId);
    check("the draft exam exists, in the batch, unpublished", exam && !exam.isPublished && exam.batches.map(String).includes(String(batch._id)) && exam.mode === "quiz");
    const qs = await Question.find({ _id: { $in: exam.questions } });
    check("6 questions, all from the asked chapter", qs.length === 6 && qs.every((q) => String(q.chapter) === String(chapter._id)), qs.length);
    out = await run(ctl.getRun, { user: owner, params: { id: rid } });
    check("steps read in plain words for the inbox", /Optics quiz/.test(out.body.steps[0].detail) && /AG Batch/.test(out.body.steps[0].detail) && out.body.steps[2].needsApproval === true, out.body.steps.map((s) => s.detail));
    out = await run(ctl.getStatus, { user: owner });
    check("the inbox count shows it waiting", out.body.waiting >= 1 && out.body.available === true, out.body);

    out = await run(ctl.decide, { user: owner, params: { id: rid }, body: { stepIds: [String(doc.steps[2]._id)], approve: true } });
    doc = await settle(AgentRun, rid, (d) => (d.steps[2].status === "done" && d.status === "awaiting") || d.status === "failed");
    exam = await Exam.findById(examId);
    check("approved: it's published, then waits on the notice", exam.isPublished && doc.status === "awaiting" && doc.steps[3].status === "pending", doc.steps.map((s) => s.status));
    out = await run(ctl.decide, { user: owner, params: { id: rid }, body: { stepIds: "all", approve: false } });
    doc = await settle(AgentRun, rid, (d) => d.status === "done");
    check("rejected: no notice, request finished", doc.status === "done" && doc.steps[3].status === "rejected" && !(await Notice.findOne({ title: "Optics quiz is up" })));

    console.log("\nlimits");
    ai.generate = async () => ({ data: { reply: "x", steps: [
      { tool: "create_exam", title: "Sneaky", args: JSON.stringify({ title: "Off batch exam", durationMinutes: 20, batchIds: [String(offBatch._id)] }) },
      { tool: "add_questions", title: "Fill", args: JSON.stringify({ exam: "step:1", count: 3 }) },
    ] }, usage: {} });
    out = await run(ctl.createRun, { user: owner, body: { request: "Make an exam for AG Off" } });
    doc = await settle(AgentRun, out.body._id, (d) => ["failed", "done"].includes(d.status));
    check("a batch without the copilot switch is refused, later steps skipped", doc.status === "failed" && /isn't allowed/.test(doc.steps[0].error) && doc.steps[1].status === "skipped" && !(await Exam.findOne({ title: "Off batch exam" })), doc.steps);

    ai.generate = async () => ({ data: { reply: "Which batch should the exam be for?", needsInfo: true, steps: [] }, usage: {} });
    out = await run(ctl.createRun, { user: owner, body: { request: "make an exam" } });
    doc = await settle(AgentRun, out.body._id, (d) => d.status !== "planning");
    check("an unclear request gets a question back", doc.status === "needs_info" && /Which batch/.test(doc.reply));

    console.log("\nedit and ask again");
    const asked = doc;
    ai.generate = async (o) => ({ data: { reply: "ok", steps: [{ tool: "create_exam", title: "Edited exam", args: JSON.stringify({ durationMinutes: 30, batchIds: [String(batch._id)], seen: /EARLIER TRIES/.test(o.prompt) }) }] }, usage: {} });
    out = await run(ctl.retryRun, { user: owner, params: { id: String(asked._id) }, body: { request: "make an exam for AG Batch" } });
    doc = await settle(AgentRun, asked._id, (d) => ["failed", "done", "awaiting"].includes(d.status));
    check("the same request is edited and planned again, with its earlier try kept", out.code === 200 && doc.status === "done" && doc.request === "make an exam for AG Batch" && doc.history.length === 1 && doc.history[0].request === "make an exam" && /Which batch/.test(doc.history[0].reply) && doc.retries.length === 1, { code: out.code, body: out.body, status: doc.status, error: doc.error });
    check("a missing exam title is filled from the step instead of failing", Boolean(await Exam.findOne({ title: "Edited exam" })));
    out = await run(ctl.retryRun, { user: owner, params: { id: String(asked._id) }, body: { request: "again please" } });
    check("a request that already did its work can't be asked again", out.code === 409, out.body);
    const filled = engine.checkPlan("copilot", [{ tool: "create_exam", title: "", args: JSON.stringify({ mode: "mock", liveHours: 3, batchIds: [String(batch._id)] }) }]);
    check("planner gaps get defaults: title and duration", !filled.errors.length && filled.steps[0].args.title === "Mock exam" && filled.steps[0].args.durationMinutes === 180, filled.errors);

    let calls = 0;
    ai.generate = async () => {
      calls += 1;
      return { data: { reply: "ok", steps: calls === 1
        ? [{ tool: "create_exam", title: "x", args: JSON.stringify({ title: "Retry exam", durationMinutes: 30 }) }]
        : [{ tool: "create_exam", title: "x", args: JSON.stringify({ title: "Retry exam", durationMinutes: 30, batchIds: [String(batch._id)] }) }] }, usage: {} };
    };
    out = await run(ctl.createRun, { user: owner, body: { request: "exam please" } });
    doc = await settle(AgentRun, out.body._id, (d) => ["failed", "done", "awaiting"].includes(d.status));
    check("a broken plan is sent back once to be fixed", calls === 2 && doc.status === "done" && Boolean(await Exam.findOne({ title: "Retry exam" })), { calls, status: doc.status, error: doc.error });

    await AiConfig.updateOne({}, { $set: { "agents.copilot.mode": "ask", "agents.copilot.roles": ["owner", "admin", "teacher"] } });
    out = await run(ctl.createRun, { user: teacher, body: { request: "exam for AG Batch" } });
    check("teachers can't use it even if listed (they can't make exams themselves)", out.code === 403, out.body);
    ai.generate = async () => ({ data: { reply: "ok", steps: [{ tool: "create_exam", title: "x", args: JSON.stringify({ title: "Ask exam", durationMinutes: 30, batchIds: [String(batch._id)] }) }] }, usage: {} });
    out = await run(ctl.createRun, { user: owner, body: { request: "exam for AG Batch" } });
    doc = await settle(AgentRun, out.body._id, (d) => ["failed", "done", "awaiting"].includes(d.status));
    check("ask mode: even a draft waits for approval", doc.status === "awaiting" && doc.steps[0].status === "pending" && !(await Exam.findOne({ title: "Ask exam" })));
    out = await run(ctl.decide, { user: owner, params: { id: String(doc._id) }, body: { stepIds: "all", approve: true } });
    doc = await settle(AgentRun, doc._id, (d) => ["failed", "done"].includes(d.status));
    check("…and runs once approved", doc.status === "done" && Boolean(await Exam.findOne({ title: "Ask exam" })), doc.error);
    out = await run(ctl.getRun, { user: teacher, params: { id: rid } });
    check("other staff can't open someone's request", out.code === 404);

    console.log("\ngrading agent");
    const Submission = require("../models/submissionModel");
    const Trial = require("../models/trialModel");
    const Student = require("../models/studentModel");
    const LiveClass = require("../models/liveClassModel");
    const LiveAttendance = require("../models/liveAttendanceModel");
    const Notification = require("../models/notificationModel");
    const grading = require("../agents/grading");
    const afterClass = require("../agents/afterClass");
    const gb = await Batch.create({ name: "AG Grading", program: program._id, isActive: true, accessType: "paid", subjects: [subject._id], features: { agentGrading: true, aiAssist: true, examAiGrading: true, agentAfterClass: true } });
    const studs = [];
    for (const n of ["Rafi", "Mim", "Tanha"]) {
      const st = await Student.create({ name: `${n} AG`, email: `${n.toLowerCase()}${Date.now()}@ag.io`, password: "x".repeat(12) }).catch((e) => ({ error: e.message }));
      studs.push(st);
      if (st._id) await Trial.create({ student: st._id, batch: gb._id, startDate: new Date(), endDate: new Date(Date.now() + 86400000 * 7) }).catch((e) => console.log("trial", e.message));
    }
    check("(test students)", studs.every((x) => x._id), studs.map((x) => x.error));
    const wq = await Question.create({ type: "written", question: "Explain how a convex lens forms an image.", marks: 5, rubric: [{ criterion: "Refraction", marks: 3 }, { criterion: "Diagram", marks: 2 }], modelAnswer: "x", status: "published", subject: subject._id, chapter: chapter._id });
    const gExam = await Exam.create({ title: "Optics written", durationMinutes: 30, questions: [wq._id], batches: [gb._id], isPublished: true });
    const mkSub = (st, text) => Submission.create({ exam: gExam._id, student: st._id, batch: gb._id, status: "grading", submittedAt: new Date(), answers: [{ question: wq._id, questionType: "written", answerText: text }] });
    const subA = await mkSub(studs[0], "Light refracts through the lens and converges at the focal point.");
    const subB = await mkSub(studs[1], "not sure");
    // A batch with the agent switched off: its waiting script is reported, not marked.
    const gradingOffBatch = await Batch.create({ name: "AG Grading Off", program: program._id, isActive: true, accessType: "paid", subjects: [subject._id], features: { aiAssist: true, examAiGrading: true } });
    await Submission.create({ exam: gExam._id, student: studs[2]._id, batch: gradingOffBatch._id, status: "grading", submittedAt: new Date(), answers: [{ question: wq._id, questionType: "written", answerText: "x" }] });
    await AiConfig.updateOne({}, { $set: { "features.writtenGrading": true, "agents.grading.enabled": true, "agents.grading.mode": "safe", "agents.grading.minConfidence": 0.8 } });
    ai.generate = async (o) => {
      const sure = /converges/.test(o.prompt);
      return { data: { marks: sure ? 4 : 1, reasoning: "ok", confidence: sure ? 0.92 : 0.4, criteriaMet: [{ criterion: "Refraction", met: true, marksAwarded: sure ? 3 : 1 }, { criterion: "Diagram", met: sure, marksAwarded: sure ? 1 : 0 }] }, usage: {} };
    };
    let res = await grading.sweep();
    check("the pass AI-marks every waiting answer", res.marked === 2 && res.needTeacher === 1, res);
    let gRun = await AgentRun.findById(res.run);
    check("the confident script becomes an apply step, the other a 'needs a person' step", gRun && gRun.steps.length === 2 && gRun.steps[0].tool === "apply_grades" && gRun.steps[0].args.submissionId === String(subA._id) && gRun.steps[1].tool === "review_script" && gRun.steps[1].args.submissionId === String(subB._id) && gRun.steps[1].args.unsure[0].confidence === 0.4 && gRun.status === "awaiting", gRun?.steps);
    check("a batch with the agent off is reported with its waiting scripts", res.blocked?.some((b) => b.name === "AG Grading Off" && b.waiting === 1 && b.missing.includes("Grading agent")), res.blocked);
    const shaped = await require("../agents/engine").shape(gRun, owner);
    check("each step links to its script before it runs", shaped.steps.every((st) => st.link === `/grading/${st.args.submissionId}`), shaped.steps.map((st) => st.link));
    let a = (await Submission.findById(subA._id)).answers[0];
    check("nothing applied before approval; the suggestion is stored", a.marksAwarded === null && a.aiMarks === 4 && a.aiConfidence === 0.92, a);
    check("the low-confidence script keeps its suggestion for a teacher", (await Submission.findById(subB._id)).answers[0].aiMarks === 1);
    res = await grading.sweep();
    check("a script already waiting isn't offered twice", !res.run, res);
    out = await run(ctl.decide, { user: owner, params: { id: String(gRun._id) }, body: { stepIds: "all", approve: true } });
    gRun = await settle(AgentRun, gRun._id, (d) => ["done", "failed"].includes(d.status));
    const doneSub = await Submission.findById(subA._id);
    check("approved: marks applied as AI grading, script finished", gRun.status === "done" && doneSub.answers[0].marksAwarded === 4 && doneSub.answers[0].gradedBy === "ai" && doneSub.status === "graded", { status: gRun.status, err: gRun.error, sub: doneSub.status, by: doneSub.answers[0].gradedBy });
    check("…and the student is told", Boolean(await Notification.findOne({ student: studs[0]._id, type: "examGraded" })));
    const reviewed = await Submission.findById(subB._id);
    check("the unsure script went to the grading queue with its AI suggestion", reviewed.status === "grading" && reviewed.answers[0].aiMarks === 1 && reviewed.answers[0].marksAwarded === null && reviewed.agentReviewAt, reviewed);
    // An approved regrade is back in "grading": the teacher's, not the agent's.
    await Submission.updateOne({ _id: subA._id }, { $set: {
      status: "grading", "answers.0.marksAwarded": null, "answers.0.gradedBy": null,
      referral: { requested: true, decision: "approved", questionIds: [wq._id], requestedAt: new Date() },
    } });
    await AgentRun.updateMany({ agent: "grading" }, { $set: { status: "done" } });
    res = await grading.sweep();
    const reSub = await Submission.findById(subA._id);
    check("regrades are left to the teacher", !res.run && reSub.answers[0].marksAwarded === null && reSub.status === "grading", { res, marks: reSub.answers[0].marksAwarded });
    await AiConfig.updateOne({}, { $set: { "agents.grading.enabled": false } });
    check("switched off: the pass does nothing", (await grading.sweep()).skipped === "off");

    console.log("\nafter-class agent");
    const lc = await LiveClass.create({ batch: gb._id, host: owner._id, title: "Lenses live", scheduledAt: new Date(), provider: "livekit", status: "ended", externalId: "examai-agac", publishChapter: chapter._id, notes: { status: "ready", markdown: "## Summary\nConvex lenses converge light." } });
    await LiveAttendance.create({ liveClass: lc._id, identity: `student:${studs[0]._id}`, student: studs[0]._id, name: "Rafi", sessions: [] });
    await AiConfig.updateOne({}, { $set: { "agents.afterClass.enabled": true, "agents.afterClass.mode": "safe", "agents.afterClass.quizSize": 3 } });
    let gens = 0;
    ai.generate = async () => {
      gens += 1;
      return { data: { questions: [1, 2, 3].map((i) => ({ type: "mcq", question: `What does a convex lens do (${i})?`, options: [{ key: "A", text: "Converges light" }, { key: "B", text: "Diverges light" }], correctOption: "A", solutionText: "It converges light.", difficulty: "easy" })) }, usage: {} };
    };
    res = await afterClass.sweep();
    let acRun = await AgentRun.findById(res.runs?.[0]);
    acRun = acRun && await settle(AgentRun, acRun._id, (d) => ["awaiting", "done", "failed"].includes(d.status));
    check("after the class: quiz drafted by itself, publishing and messaging wait", acRun && acRun.steps.map((x) => x.tool).join() === "make_class_quiz,publish_class_quiz,message_absentees" && acRun.steps[0].status === "done" && acRun.status === "awaiting", acRun?.steps.map((x) => `${x.tool}:${x.status}:${x.error || ""}`));
    const quizId = acRun.steps[0].result?.examId;
    const quiz = await Exam.findById(quizId);
    const quizQs = await Question.find({ _id: { $in: quiz?.questions || [] } });
    check("the draft quiz has 3 questions waiting in Review", quizQs.length === 3 && quizQs.every((q) => q.status === "pending_review" && String(q.chapter) === String(chapter._id)) && !quiz.isPublished);
    check("absentees counted from attendance (2 of 3 missed)", acRun.steps[2].args.absent === 2, acRun.steps[2].args);
    check("each class is planned only once", !(await afterClass.sweep()).runs?.length);
    out = await run(ctl.decide, { user: owner, params: { id: String(acRun._id) }, body: { stepIds: "all", approve: true } });
    acRun = await settle(AgentRun, acRun._id, (d) => ["done", "failed"].includes(d.status));
    const live = await Exam.findById(quizId);
    check("approved: questions approved, quiz published and open", acRun.status === "done" && live.isPublished && live.isActive && (await Question.countDocuments({ _id: { $in: live.questions }, status: "published" })) === 3, acRun.error);
    const missed = await Notification.find({ type: "liveClassMissed", student: { $in: studs.map((x) => x._id) } });
    check("…and only the two who missed it get a catch-up message", missed.length === 2 && missed.every((n) => String(n.student) !== String(studs[0]._id)), missed.length);
    console.log("\nat-risk agent");
    const PracticeAttempt = require("../models/practiceAttemptModel");
    const atRisk = require("../agents/atRisk");
    await Notification.deleteMany({ student: { $in: studs.map((x) => x._id) } });
    await Submission.deleteMany({ exam: gExam._id });
    const day = 86400000;
    // Rafi: 80% three times, then 50% three times. Mim: practised 20 days ago, nothing since. Tanha: fine.
    const riskExams = [];
    for (let i = 0; i < 6; i += 1) riskExams.push(await Exam.create({ title: `Risk ${i}`, durationMinutes: 10, questions: [], batches: [gb._id] }));
    for (let i = 0; i < 6; i += 1) {
      await Submission.create({ exam: riskExams[i]._id, student: studs[0]._id, batch: gb._id, status: "graded", marks: i < 3 ? 5 : 8, totalMarks: 10, submittedAt: new Date(Date.now() - (i < 3 ? 2 + i : 20 + i) * day), answers: [] });
    }
    await PracticeAttempt.create({ student: studs[1]._id, batch: gb._id, question: wq._id, chapter: chapter._id, topic: null, isCorrect: false, createdAt: new Date(Date.now() - 20 * day) }).catch((e) => console.log("pa", e.message));
    await PracticeAttempt.collection.updateMany({ student: studs[1]._id }, { $set: { createdAt: new Date(Date.now() - 20 * day) } });
    await Submission.create({ exam: gExam._id, student: studs[2]._id, batch: gb._id, status: "graded", marks: 9, totalMarks: 10, submittedAt: new Date(Date.now() - day), answers: [] });
    await AiConfig.updateOne({}, { $set: { "agents.atRisk.enabled": true, "agents.atRisk.mode": "ask" } });
    await Batch.updateOne({ _id: gb._id }, { $set: { "features.agentAtRisk": true } });
    res = await atRisk.sweep();
    let arRun = res.runs?.[0] && await AgentRun.findById(res.runs[0]);
    const who = (arRun?.steps || []).map((x) => x.args.studentName);
    check("finds the falling and the quiet student, not the one doing fine", who.length === 2 && who.includes("Rafi AG") && who.includes("Mim AG"), who);
    const rafi = arRun.steps.find((x) => x.args.studentName === "Rafi AG");
    check("reasons read plainly (scores down 30 pts, 80% → 50%)", /scores down 30 pts \(80% → 50%\)/.test(rafi.args.reasons.join()), rafi.args.reasons);
    check("ask mode: nothing sent until approved", arRun.status === "awaiting" && !(await Notification.exists({ type: "studyNudge" })));
    check("once a week per batch", !(await atRisk.sweep()).runs?.length);
    out = await run(ctl.decide, { user: owner, params: { id: String(arRun._id) }, body: { stepIds: [String(rafi._id)], approve: true } });
    arRun = await settle(AgentRun, arRun._id, (d) => d.steps.find((x) => String(x._id) === String(rafi._id)).status === "done");
    out = await run(ctl.decide, { user: owner, params: { id: String(arRun._id) }, body: { stepIds: "all", approve: false } });
    const nudges = await Notification.find({ type: "studyNudge" });
    check("only the approved check-in is sent", nudges.length === 1 && String(nudges[0].student) === String(studs[0]._id), nudges.length);
    check("…and nobody is checked on twice in a week, even on a manual run", !(await atRisk.sweep({ force: true })).runs?.length);
    await PracticeAttempt.deleteMany({ batch: gb._id });

    console.log("\nsupport agent");
    const Doubt = require("../models/doubtModel");
    const Ticket = require("../models/supportTicketModel");
    const support = require("../agents/support");
    await Batch.updateOne({ _id: gb._id }, { $set: { "features.agentSupport": true, "features.doubtSolving": true } });
    const doubt = await Doubt.create({ student: studs[0]._id, batch: gb._id, topic: new mongoose.Types.ObjectId(), question: "Why does a convex lens converge light?", mode: "ai", status: "escalated", escalatedAt: new Date() });
    const okTicket = await Ticket.create({ student: studs[1]._id, category: "account", subject: "How do I change my password?", status: "open", messages: [{ from: "student", text: "Where can I change my password?" }] });
    const refund = await Ticket.create({ student: studs[2]._id, category: "payment", subject: "Refund please", status: "open", messages: [{ from: "student", text: "I want my money back" }] });
    await AiConfig.updateOne({}, { $set: { "agents.support.enabled": true, "agents.support.mode": "ask", "agents.support.knowledge": "", "agents.support.doubts": false } });
    let aiCalls = 0;
    let lastPrompt = "";
    ai.generate = async (o) => { aiCalls += 1; lastPrompt = o.prompt; return { data: { needsPerson: true, reason: "not sure" }, usage: {} }; };
    res = await support.sweep();
    check("no policy text: tickets still go to the AI, with the app guide", res.found.tickets === 2 && aiCalls === 2 && /APP GUIDE/.test(lastPrompt) && /POLICY:\n\(none\)/.test(lastPrompt), { found: res.found, aiCalls });
    await AiConfig.updateOne({}, { $set: { "agents.support.doubts": true } });
    await AiConfig.updateOne({}, { $set: { "agents.support.enabled": true, "agents.support.mode": "ask", "agents.support.knowledge": "Passwords: Profile → Security → Change password. Refunds are decided by the owner within 7 days." } });
    ai.generate = async (o) => {
      aiCalls += 1;
      if (/needsPerson/.test(o.prompt)) {
        return /money back/.test(o.prompt)
          ? { data: { needsPerson: true, reason: "a refund decision", policyHint: "Refunds: ask the owner within 7 days of paying." }, usage: {} }
          : { data: { needsPerson: false, reply: "Go to Profile → Security → Change password.", resolve: true }, usage: {} };
      }
      return { data: { answer: "Because it refracts light towards the axis." }, usage: {} };
    };
    res = await support.sweep({ force: true });
    let spRun = await AgentRun.findById(res.run);
    check("a ticket left for a person comes with a line to add to the policy", res.forPeople.some((x) => /add to the policy: “Refunds: ask the owner/.test(x)), res.forPeople);
    check("drafts a doubt answer and a ticket reply; the refund is left for a person", spRun && spRun.steps.map((x) => x.tool).sort().join() === "answer_doubt,reply_ticket" && /refund decision/.test(spRun.reply), { steps: spRun?.steps.map((x) => x.tool), reply: spRun?.reply });
    const dStep = spRun.steps.find((x) => x.tool === "answer_doubt");
    out = await run(ctl.editStep, { user: owner, params: { id: String(spRun._id), stepId: String(dStep._id) }, body: { args: { answer: "Edited: it refracts light inwards.", doubtId: String(refund._id) } } });
    spRun = await AgentRun.findById(spRun._id);
    check("staff can edit the draft (only the editable field)", out.code === 200 && spRun.steps.id(dStep._id).args.answer.startsWith("Edited") && spRun.steps.id(dStep._id).args.doubtId === String(doubt._id), out.body?.message);
    check("nothing goes before approval", (await Doubt.findById(doubt._id)).status === "escalated");
    aiCalls = 0;
    check("a second pass doesn't draft the same things again", !(await support.sweep()).run);
    check("…nor send the refund left for a person to the AI again", aiCalls === 0, aiCalls);
    await Ticket.updateOne({ _id: refund._id }, { $push: { messages: { from: "student", text: "Please, any update on my money back?" } }, $set: { lastActivityAt: new Date(Date.now() + 1000) } });
    res = await support.sweep();
    check("a new message from the student gets a fresh look", aiCalls === 1 && res.forPeople.some((x) => /Refund please/.test(x)), { aiCalls, res });
    aiCalls = 0;
    res = await support.sweep({ force: true });
    check("Run now looks again at what was left for a person", aiCalls === 1 && res.found.tickets === 2, { aiCalls, found: res.found });
    out = await run(ctl.decide, { user: owner, params: { id: String(spRun._id) }, body: { stepIds: "all", approve: true } });
    spRun = await settle(AgentRun, spRun._id, (d) => ["done", "failed"].includes(d.status));
    const answered = await Doubt.findById(doubt._id);
    const replied = await Ticket.findById(okTicket._id);
    check("approved: the edited answer is sent", spRun.status === "done" && answered.status === "resolved" && /Edited/.test(answered.humanAnswer), { st: spRun.status, err: spRun.error, d: answered.status });
    check("…and the ticket is answered and resolved", replied.messages.at(-1).from === "staff" && /Change password/.test(replied.messages.at(-1).text) && replied.status === "resolved", replied.status);

    console.log("\nstudent tutor");
    const Topic = require("../models/topicModel");
    const Lecture = require("../models/lectureModel");
    const LectureProgress = require("../models/lectureProgressModel");
    const tutorCtl = require("../controllers/app/tutorController");
    const tutor = require("../utils/tutor");
    await PracticeAttempt.deleteMany({ batch: gb._id });
    await Submission.deleteMany({ batch: gb._id });
    await Notification.deleteMany({});
    const topic = await Topic.create({ title: "Refraction AG", name: "Refraction AG", chapter: chapter._id, subject: subject._id });
    const tq = await Question.create({ type: "mcq", question: "Refraction question?", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1, status: "published", subject: subject._id, chapter: chapter._id, topic: topic._id, batches: [gb._id], skillType: "application" });
    const old = new Date(Date.now() - 3 * day);
    for (let i = 0; i < 4; i += 1) await PracticeAttempt.collection.insertOne({ student: studs[0]._id, batch: gb._id, question: tq._id, topic: topic._id, chapter: chapter._id, isCorrect: i === 0, createdAt: old, updatedAt: old });
    const lec = await Lecture.create({ title: "Lenses 101", subject: subject._id, chapter: chapter._id, batches: [gb._id], isPublished: true });
    await Exam.updateOne({ _id: gExam._id }, { $set: { isActive: true, isPublished: true } });
    await Batch.updateOne({ _id: gb._id }, { $set: { "features.agentTutor": true } });
    // FerretDB (the local test database) lacks $cond, which the weak-topic
    // ranking uses; real MongoDB has it. Stand in for it only there.
    const weakMod = require("../utils/weakTopics");
    const realRank = weakMod.rankWeakTopics;
    const works = await realRank(studs[0]._id, gb._id).then(() => true, (e) => !/not implemented/.test(e.message));
    if (!works) weakMod.rankWeakTopics = async () => [{ _id: topic._id, title: topic.title, accuracy: 25, rawAccuracy: 0.25, chapterPool: false }];
    const gbDoc = await Batch.findById(gb._id);
    const sreq = (st, extra = {}) => ({ student: st, batch: gbDoc, params: { batchId: String(gb._id) }, query: { tz: "Asia/Dhaka" }, ...extra });
    out = await run(tutorCtl.getToday, sreq(studs[0]));
    check("tutor off in settings: not available", out.code === 403);
    await AiConfig.updateOne({}, { $set: { "agents.tutor.enabled": true, "agents.tutor.eveningNudge": true } });
    // A weaker topic known only from exam answers, with nothing practice
    // can serve (its question isn't assigned to the batch): never suggested.
    const examOnly = await Topic.create({ title: "Matrices AG", name: "Matrices AG", chapter: chapter._id, subject: subject._id });
    await Question.create({ type: "mcq", question: "Matrix?", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1, status: "published", subject: subject._id, chapter: chapter._id, topic: examOnly._id, batches: [] });
    const rankBefore = weakMod.rankWeakTopics;
    weakMod.rankWeakTopics = async (...a) => [{ _id: examOnly._id, title: examOnly.title, accuracy: 10, rawAccuracy: 0.1, chapterPool: false }, ...(await rankBefore(...a))];
    out = await run(tutorCtl.getToday, sreq(studs[0]));
    weakMod.rankWeakTopics = rankBefore;
    check("a weak topic with nothing to practise is skipped", !(out.body.tasks || []).some((t) => /Matrices AG/.test(t.title)), (out.body.tasks || []).map((t) => t.title));
    const kinds = (out.body.tasks || []).map((t) => t.kind).join();
    check("today's plan: weakest topic, next lecture, the open exam", out.code === 200 && kinds === "practice,lecture,exam" && /Refraction AG/.test(out.body.tasks[0].title) && /25%/.test(out.body.tasks[0].detail), out.body);
    check("nothing done yet", out.body.tasks.every((t) => !t.done) && out.body.streak === 0);
    for (let i = 0; i < 10; i += 1) await PracticeAttempt.collection.insertOne({ student: studs[0]._id, batch: gb._id, question: tq._id, topic: topic._id, chapter: chapter._id, isCorrect: true, createdAt: new Date(), updatedAt: new Date() });
    await LectureProgress.create({ student: studs[0]._id, lecture: lec._id, batch: gb._id, completedAt: new Date(), lastWatchedAt: new Date() }).catch((e) => console.log("lp", e.message));
    out = await run(tutorCtl.getToday, sreq(studs[0]));
    check("progress comes from what they actually did", out.body.tasks[0].done && out.body.tasks[0].progress === 10 && out.body.tasks[1].done && !out.body.tasks[2].done, out.body.tasks.map((t) => `${t.kind}:${t.progress}/${t.target}`));
    await Submission.create({ exam: gExam._id, student: studs[0]._id, batch: gb._id, status: "submitted", submittedAt: new Date(), answers: [] });
    out = await run(tutorCtl.getToday, sreq(studs[0]));
    check("all done: streak starts at 1", out.body.allDone && out.body.streak === 1 && /All done/.test(out.body.note), out.body);
    await require("../models/tutorModel").updateOne({ student: studs[0]._id, batch: gb._id }, { $set: { lastCompleteDay: tutor.dayKey(new Date(Date.now() - day), "Asia/Dhaka"), streak: 4, day: null } });
    out = await run(tutorCtl.getToday, sreq(studs[0]));
    check("a new day's plan carries yesterday's streak", out.body.streak === 4 && !out.body.allDone, out.body);
    out = await run(tutorCtl.updateTutor, sreq(studs[0], { body: { sprintDate: new Date(Date.now() + 5 * day).toISOString(), sprintLabel: "the HSC mock" } }));
    check("sprint mode: higher targets and a countdown", out.body.tasks[0].target === 15 && /5 days to the HSC mock/.test(out.body.note), { t: out.body.tasks?.[0], note: out.body.note });
    const soonMock = await Exam.create({ title: "Physics grand mock", mode: "mock", durationMinutes: 60, liveHours: 3, opensAt: new Date(Date.now() + 3 * day + 3600000), batches: [gb._id], isPublished: true, isActive: true });
    const pastMock = await Exam.create({ title: "Last week's mock", mode: "mock", durationMinutes: 60, liveHours: 3, opensAt: new Date(Date.now() - 7 * day), batches: [gb._id], isPublished: true, isActive: true });
    out = await run(tutorCtl.getToday, sreq(studs[0]));
    const opts = (out.body.sprintOptions || []).map((o) => o.title);
    check("sprint exams to pick: ones still to take, not finished or closed", opts.includes("Physics grand mock") && !opts.includes("Optics written") && !opts.includes("Last week's mock") && out.body.sprintOptions[0].title === "Physics grand mock", opts);
    // The mock covers Refraction (practised), a topic not practised yet,
    // and one outside the batch's subjects.
    const fresh2 = await Topic.create({ title: "Lens power AG", name: "Lens power AG", chapter: chapter._id, subject: subject._id });
    const fq = await Question.create({ type: "mcq", question: "Lens power?", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1, status: "published", subject: subject._id, chapter: chapter._id, topic: fresh2._id, batches: [gb._id] });
    const otherSubject = new mongoose.Types.ObjectId();
    const oq = await Question.create({ type: "mcq", question: "Outside?", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1, status: "published", subject: otherSubject, chapter: chapter._id, topic: new mongoose.Types.ObjectId(), batches: [gb._id] });
    await Exam.updateOne({ _id: soonMock._id }, { $set: { questions: [tq._id, fq._id, oq._id] } });
    out = await run(tutorCtl.updateTutor, sreq(studs[0], { body: { sprintExamId: String(soonMock._id) } }));
    check("picking an exam names the sprint and uses its date", out.code === 200 && out.body.sprint.label === "Physics grand mock" && new Date(out.body.sprint.date).getTime() === soonMock.opensAt.getTime() && String(out.body.sprint.examId) === String(soonMock._id), out.body.sprint);
    out = await run(tutorCtl.updateTutor, sreq(studs[0], { body: { sprintExamId: String(pastMock._id) } }));
    check("an exam they can't take can't be picked", out.code === 400, out.body);
    out = await run(tutorCtl.getToday, sreq(studs[0]));
    const sprintTitles = out.body.tasks.filter((t) => t.kind === "practice").map((t) => `${t.title}|${t.detail}`);
    check("a sprint for a picked exam practises that exam's topics, untouched ones next", /Refraction AG/.test(sprintTitles[0]) && sprintTitles.some((x) => /Lens power AG\|In your exam, not practised yet/.test(x)), sprintTitles);
    check("…and says which exam topics are outside the batch's practice", /1 topic in this exam isn't in this batch's practice/.test(out.body.note), out.body.note);
    console.log("\nstudent tutor + study plan");
    const StudyPlan = require("../models/studyPlanModel");
    const TutorModel = require("../models/tutorModel");
    const lec2 = await Lecture.create({ title: "Lens formula", subject: subject._id, chapter: chapter._id, batches: [gb._id], isPublished: true });
    const planDays = [
      { day: 1, focus: "Warm up", kind: "practice", completed: true, topics: [{ topic: topic._id, title: topic.title, note: "x" }] },
      { day: 2, focus: "Refraction", kind: "practice", topics: [{ topic: topic._id, title: topic.title, note: "x" }] },
      { day: 3, focus: "Lens formula", kind: "lecture", topics: [{ topic: topic._id, title: topic.title, note: "x", lecture: { lecture: lec2._id, title: "Lens formula" } }] },
      { day: 4, focus: "Revision", kind: "revision", revision: true, topics: [{ topic: topic._id, title: topic.title, note: "x" }] },
    ];
    await StudyPlan.create({ student: studs[2]._id, batch: gb._id, summary: "Plan", durationDays: 4, days: planDays, generatedAt: new Date(Date.now() - 2 * day) });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    check("plan day comes first; a missed day becomes a catch-up", out.body.tasks[0]?.kind === "plan" && /^Catch up: Plan day 2: Refraction/.test(out.body.tasks[0].title) && out.body.plan.day === 3 && out.body.plan.behind === 1, { t: out.body.tasks, plan: out.body.plan });
    check("the tutor doesn't repeat the plan's topic", !out.body.tasks.some((t) => t.kind === "practice" && String(t.refId) === String(topic._id)), out.body.tasks.map((t) => t.title));
    // The study plan page's tick (toggleStudyPlanDay) uses a positional
    // update the local test database lacks; same write, done directly.
    const tick = async (d, completed) => {
      const pl = await StudyPlan.findOne({ student: studs[2]._id });
      Object.assign(pl.days.find((x) => x.day === d), { completed, autoDone: false });
      await pl.save();
    };
    await tick(2, true);
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    let pt = out.body.tasks.find((t) => t.kind === "plan");
    check("a day ticked by hand shows done, marked as hand-ticked", pt.done && pt.manual && pt.progress === 0, pt);
    await tick(2, false);
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    check("…unticked, it's open again", !out.body.tasks.find((t) => t.kind === "plan").done);
    for (let i = 0; i < 10; i += 1) await PracticeAttempt.collection.insertOne({ student: studs[2]._id, batch: gb._id, question: tq._id, topic: topic._id, chapter: chapter._id, isCorrect: true, createdAt: new Date(), updatedAt: new Date() });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    pt = out.body.tasks.find((t) => t.kind === "plan");
    const day2 = (await StudyPlan.findOne({ student: studs[2]._id })).days.find((d) => d.day === 2);
    check("real work ticks the plan day itself", pt.done && !pt.manual && day2.completed && day2.autoDone, { pt, day2 });
    check("…asking for only as many questions as the day has", pt.target === 1 && /1 question$/.test(pt.detail), pt);
    const dayDone = await Notification.find({ type: "studyPlanDayDone", student: studs[2]._id });
    check("…and tells the student once", dayDone.length === 1 && dayDone[0].title === "Study plan: Day 2 done" && dayDone[0].link === `/batches/${gb._id}/study-plan`, dayDone.map((n) => n.title));
    await run(tutorCtl.getToday, sreq(studs[2]));
    check("…not again on the next visit", (await Notification.countDocuments({ type: "studyPlanDayDone", student: studs[2]._id })) === 1);
    // A day narrowed to one skill: only that skill's questions count.
    const rq = await Question.create({ type: "mcq", question: "Define refraction?", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1, status: "published", subject: subject._id, chapter: chapter._id, topic: topic._id, batches: [gb._id], skillType: "recall" });
    const sk = await StudyPlan.findOne({ student: studs[2]._id });
    Object.assign(sk.days.find((d) => d.day === 2), { completed: false, autoDone: false, topics: [{ topic: topic._id, title: topic.title, note: "x", skillType: "recall" }] });
    await sk.save();
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { day: null } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    pt = out.body.tasks.find((t) => t.kind === "plan");
    check("a recall day: other skills' practice doesn't count", pt.target === 1 && pt.progress === 0 && !pt.done && /Recall \/ Definition/.test(pt.detail), pt);
    await PracticeAttempt.collection.insertOne({ student: studs[2]._id, batch: gb._id, question: rq._id, topic: topic._id, chapter: chapter._id, isCorrect: true, createdAt: new Date(), updatedAt: new Date() });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    pt = out.body.tasks.find((t) => t.kind === "plan");
    check("…a recall question does", pt.done && pt.progress === 1, pt);
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { day: null } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    check("next, today's plan day: the lecture, with nothing to catch up", /^Plan day 3: Lens formula/.test(out.body.tasks[0]?.title) && out.body.tasks[0].target === 1 && out.body.plan.behind === 0, out.body.tasks.map((t) => t.title));
    const fresh = await StudyPlan.findOne({ student: studs[2]._id });
    fresh.generatedAt = new Date(Date.now() - 5 * day);
    for (const d of fresh.days) Object.assign(d, { completed: false, autoDone: false });
    await fresh.save();
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    const firstOpen = (await StudyPlan.findOne({ student: studs[2]._id })).days.filter((d) => !d.completed).sort((a, b) => a.day - b.day)[0]?.day;
    check("far behind: the label points at the first open day", out.body.plan.behind > 1 && out.body.plan.next === firstOpen, { plan: out.body.plan, firstOpen });
    // Day 1 is already ticked from today's practice (syncPlan), so the
    // first catch-up is a later open day.
    check("a new plan rebuilds today's tasks; far behind, the tutor says so", /^Catch up: Plan day [2-9]:/.test(out.body.tasks[0]?.title) && /Catch up, or make a new plan/.test(out.body.note), { t: out.body.tasks.map((t) => t.title), note: out.body.note });
    out = await run(tutorCtl.updateTutor, sreq(studs[2], { body: { sprintDate: new Date(Date.now() + 4 * day).toISOString(), sprintLabel: "the mock" } }));
    check("sprint: exam only, the plan waits", !out.body.tasks.some((t) => t.kind === "plan" || t.kind === "lecture") && out.body.plan.paused && /Exam focus/.test(out.body.note), { t: out.body.tasks.map((t) => t.title), note: out.body.note });
    check("…with a word about the plan backlog", /Study plan: \d+ days behind\. Back to it after the exam/.test(out.body.note), out.body.note);
    const planCtl = require("../controllers/app/studyPlanController");
    const lp = await StudyPlan.findOne({ student: studs[2]._id });
    const lday = lp.days.find((d) => d.kind === "lecture" && d.topics.some((t) => t.lecture?.lecture));
    if (lday) {
      Object.assign(lday, { completed: false, autoDone: false });
      await lp.save();
      for (const t of lday.topics.filter((x) => x.lecture?.lecture)) {
        await LectureProgress.updateOne({ student: studs[2]._id, lecture: t.lecture.lecture }, { $set: { batch: gb._id, completedAt: new Date(), lastWatchedAt: new Date() } }, { upsert: true });
      }
      out = await run(planCtl.getStudyPlan, sreq(studs[2]));
      check("the plan page ticks a lecture day once its lecture is watched, without the tutor", out.body.plan.days.find((d) => d.day === lday.day).completed, out.body.plan?.days?.map((d) => `${d.day}:${d.kind}:${d.completed}`));
      // Put it back: the sprint checks below count overdue days.
      const back = await StudyPlan.findById(lp._id);
      Object.assign(back.days.find((d) => d.day === lday.day), { completed: false, autoDone: false });
      await back.save();
      await LectureProgress.updateMany({ student: studs[2]._id, lecture: { $in: lday.topics.map((t) => t.lecture?.lecture).filter(Boolean) } }, { $set: { completedAt: null } });
    } else check("a plan with a lecture day to test", false, lp.days.map((d) => d.kind));
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { lastBacklogWarnDay: tutor.dayKey(new Date(Date.now() - day), "Asia/Dhaka"), day: null } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    check("…but not every day", !/Back to it after the exam/.test(out.body.note), out.body.note);
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { "sprint.date": null, day: null } });
    await StudyPlan.deleteMany({ student: studs[2]._id });
    await Lecture.deleteOne({ _id: lec2._id });

    console.log("\nstudent tutor + study plan: nothing leads nowhere");
    const PracticeExamRecord = require("../models/practiceExamRecordModel");
    const goneTopic = await Topic.create({ title: "Optical fibre AG", name: "Optical fibre AG", chapter: chapter._id, subject: subject._id });
    const gq = await Question.create({ type: "mcq", question: "Fibre?", options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1, status: "published", subject: subject._id, chapter: chapter._id, topic: goneTopic._id, batches: [gb._id] });
    const passOnly = await Topic.create({ title: "Passage only AG", name: "Passage only AG", chapter: chapter._id, subject: subject._id });
    await Question.collection.insertOne({ type: "passage", question: "Read this.", status: "published", subject: subject._id, chapter: chapter._id, topic: passOnly._id, batches: [gb._id], marks: 1 });
    const lec3 = await Lecture.create({ title: "Total internal reflection", subject: subject._id, chapter: chapter._id, batches: [gb._id], isPublished: true });
    const mcqs = [];
    for (let i = 0; i < 3; i += 1) mcqs.push(await Question.create({ type: "mcq", question: `Lens mcq ${i}?`, options: [{ key: "A", text: "x" }, { key: "B", text: "y" }], correctOption: "A", marks: 1, status: "published", subject: subject._id, chapter: chapter._id, topic: fresh2._id, batches: [gb._id] }));
    await StudyPlan.create({
      // Made 5 days ago: today is day 6, so every day is due.
      student: studs[2]._id, batch: gb._id, summary: "Plan", durationDays: 6, generatedAt: new Date(Date.now() - 5 * day),
      days: [
        { day: 1, focus: "Fibre", kind: "practice", topics: [{ topic: goneTopic._id, title: goneTopic.title, note: "x" }] },
        { day: 2, focus: "Passages", kind: "practice", topics: [{ topic: passOnly._id, title: passOnly.title, note: "x" }] },
        { day: 3, focus: "Chapter pool", kind: "practice", topics: [{ topic: chapter._id, chapterPool: true, title: "Chapter", note: "x" }] },
        { day: 4, focus: "TIR", kind: "lecture", topics: [{ topic: topic._id, title: topic.title, note: "x", lecture: { lecture: lec3._id, title: lec3.title } }] },
        { day: 5, focus: "Lens exam", kind: "exam", topics: [{ topic: fresh2._id, title: fresh2.title, note: "x" }], exam: { topic: fresh2._id, title: fresh2.title, questionCount: 4, types: ["mcq"], durationMinutes: 10 } },
        { day: 6, focus: "Revision", kind: "revision", revision: true, topics: [{ topic: topic._id, title: topic.title, note: "x" }] },
      ],
    });
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { day: null } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    pt = out.body.tasks.find((t) => t.kind === "plan");
    check("an available day is today's plan task", pt?.planDay === 1, out.body.tasks.map((t) => t.title));
    // Its only question is taken out of the batch mid-day.
    await Question.updateOne({ _id: gq._id }, { $set: { batches: [] } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    let flags = Object.fromEntries((await StudyPlan.findOne({ student: studs[2]._id })).days.map((d) => [d.day, d.unavailable]));
    check("a day whose questions left the batch is flagged and skipped, same day", flags[1] && !out.body.tasks.some((t) => t.kind === "plan" && t.planDay === 1), { flags, t: out.body.tasks.map((t) => t.title) });
    check("a passage-only day (the plan's Practice doesn't serve passages) is skipped", flags[2] === true, flags);
    check("a chapter-pool day without chapter practice is skipped", flags[3] === true, flags);
    pt = out.body.tasks.find((t) => t.kind === "plan");
    check("…so the plan task is the first day that can be done: the lecture", pt?.planDay === 4 && out.body.plan.next === 4, { pt, plan: out.body.plan });
    out = await run(planCtl.getStudyPlan, sreq(studs[2]));
    check("the plan page gets the same flags", out.body.plan.days.filter((d) => d.unavailable).map((d) => d.day).join() === "1,2,3", out.body.plan.days.map((d) => `${d.day}:${d.unavailable}`));
    await Question.updateOne({ _id: gq._id }, { $set: { batches: [gb._id] } });
    out = await run(planCtl.getStudyPlan, sreq(studs[2]));
    check("…and clears a flag when the content comes back", !out.body.plan.days.find((d) => d.day === 1).unavailable);
    await Question.updateOne({ _id: gq._id }, { $set: { batches: [] } });
    await Lecture.updateOne({ _id: lec3._id }, { $set: { isPublished: false } });
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { day: null } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    pt = out.body.tasks.find((t) => t.kind === "plan");
    check("an unpublished lecture's day is skipped too", pt?.planDay === 5 && /Plan day 5: Lens exam/.test(pt.title), out.body.tasks.map((t) => t.title));
    // recordAttempt's pipeline update isn't in the local test database; the
    // same record, written directly.
    await PracticeExamRecord.collection.insertOne({ student: studs[2]._id, batch: gb._id, attemptCount: 1, averagePercent: 80, lastAttemptAt: new Date() });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    pt = out.body.tasks.find((t) => t.kind === "plan");
    check("a self-build exam taken today ticks the exam day", pt?.done && !pt.manual && (await StudyPlan.findOne({ student: studs[2]._id })).days.find((d) => d.day === 5).completed, pt);
    // Too few multiple-choice questions left for a self-build exam.
    const ep = await StudyPlan.findOne({ student: studs[2]._id });
    Object.assign(ep.days.find((d) => d.day === 5), { completed: false, autoDone: false });
    await ep.save();
    await Question.updateMany({ _id: { $in: mcqs.map((q) => q._id) } }, { $set: { status: "draft" } });
    await Question.updateOne({ _id: fq._id }, { $set: { status: "draft" } });
    out = await run(planCtl.getStudyPlan, sreq(studs[2]));
    check("an exam day without enough questions left is skipped", out.body.plan.days.find((d) => d.day === 5).unavailable, out.body.plan.days.map((d) => `${d.day}:${d.unavailable}`));
    await Question.updateMany({ _id: { $in: [...mcqs.map((q) => q._id), fq._id] } }, { $set: { status: "published" } });

    // Exams: only one open right now is suggested.
    await Exam.updateOne({ _id: gExam._id }, { $set: { isActive: false } });
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { day: null } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    const examTitles = out.body.tasks.filter((t) => t.kind === "exam").map((t) => t.title);
    check("no exam that hasn't opened or has closed is suggested", !examTitles.some((x) => /Physics grand mock|Last week's mock/.test(x)), examTitles);
    await Exam.updateOne({ _id: gExam._id }, { $set: { isActive: true } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    const exT = out.body.tasks.find((t) => t.kind === "exam");
    const exDoc = exT && await Exam.findById(exT.refId);
    check("an open exam is", exDoc?.isOpen(), out.body.tasks.map((t) => t.title));
    // Closed mid-day: off the list on the next look.
    await Exam.updateOne({ _id: exDoc._id }, { $set: { isActive: false } });
    out = await run(tutorCtl.getToday, sreq(studs[2]));
    check("an exam closed after the list was made drops off", !out.body.tasks.some((t) => t.kind === "exam" && String(t.refId) === String(exDoc._id)), out.body.tasks.map((t) => t.title));
    await Exam.updateOne({ _id: exDoc._id }, { $set: { isActive: true } });

    // A nonsense time zone is ignored, not stored.
    out = await run(tutorCtl.getToday, sreq(studs[2], { query: { tz: "Mars/Olympus" } }));
    check("an unknown time zone is ignored", out.code === 200 && (await TutorModel.findOne({ student: studs[2]._id, batch: gb._id })).timezone !== "Mars/Olympus", out.code);
    await TutorModel.updateOne({ student: studs[2]._id, batch: gb._id }, { $set: { day: null } });
    await StudyPlan.deleteMany({ student: studs[2]._id });
    await Lecture.deleteOne({ _id: lec3._id });

    console.log("\nexam sprint dates");
    // "Today" in the student's own time zone: Dhaka's date runs ahead of UTC's from 18:00 UTC.
    const sprintTz = (await TutorModel.findOne({ student: studs[1]._id, batch: gb._id }))?.timezone || "UTC";
    out = await run(tutorCtl.updateTutor, sreq(studs[1], { body: { sprintDate: tutor.dayKey(new Date(Date.now() - 2 * day), sprintTz), sprintLabel: "old exam" } }));
    check("a date in the past is refused", out.code === 400 && /today or a later date/.test(out.body.message), out.body);
    const todayKey = tutor.dayKey(new Date(), sprintTz);
    out = await run(tutorCtl.updateTutor, sreq(studs[1], { body: { sprintDate: todayKey, sprintLabel: "today's quiz" } }));
    check("today is fine, and reads as exam day", out.code === 200 && out.body.sprint?.daysLeft === 0 && /Exam today/.test(out.body.note), out.body.sprint);
    await TutorModel.updateOne({ student: studs[1]._id, batch: gb._id }, { $set: { "sprint.date": new Date(Date.now() - 3 * day) } });
    out = await run(tutorCtl.getToday, sreq(studs[1]));
    check("a sprint whose date passed ends, and says so", !out.body.sprint && out.body.sprintEnded === "today's quiz" && /has passed\. Set your next exam/.test(out.body.note), { sprint: out.body.sprint, ended: out.body.sprintEnded, note: out.body.note });
    out = await run(tutorCtl.getToday, sreq(studs[1]));
    check("…once", !out.body.sprintEnded);

    out = await run(tutorCtl.getToday, sreq(studs[1]));
    const sent = await tutor.eveningNudges();
    const nudge = await Notification.findOne({ type: "studyNudge", student: studs[1]._id });
    check("evening: a reminder to students with tasks left", sent >= 1 && nudge && /left today/.test(nudge.body), sent);
    check("…once a day", (await tutor.eveningNudges()) === 0);
    out = await run(tutorCtl.updateTutor, sreq(studs[1], { body: { enabled: false } }));
    check("a student can turn it off", out.body.enabled === false && !out.body.tasks.length || out.body.enabled === false, out.body);
    weakMod.rankWeakTopics = realRank;
    await require("../models/tutorModel").deleteMany({ batch: gb._id });
    await LectureProgress.deleteMany({ batch: gb._id });
    await Lecture.deleteMany({ _id: lec._id });
    await PracticeAttempt.deleteMany({ batch: gb._id });
    await Submission.deleteMany({ batch: gb._id });
    await Doubt.deleteMany({ batch: gb._id });
    await Ticket.deleteMany({ student: { $in: studs.map((x) => x._id) } });
    await Submission.deleteMany({ batch: gb._id });

    await Notification.deleteMany({ student: { $in: studs.map((x) => x._id) } });
    await Submission.deleteMany({ exam: gExam._id });
    await LiveAttendance.deleteMany({ liveClass: lc._id });
    await LiveClass.deleteMany({ batch: gb._id });
    await Exam.deleteMany({ batches: gb._id });
    await Trial.deleteMany({ batch: gb._id });
    const { reachableStudents } = require("../utils/batchMembers");
    await Student.updateOne({ _id: studs[0]._id }, { $set: { deletedAt: new Date() } });
    const reach = await reachableStudents(studs.map((x) => x._id));
    check("deleted students are left out of agent plans", reach.length === studs.length - 1 && !reach.some((x) => String(x) === String(studs[0]._id)));
    await Student.deleteMany({ _id: { $in: studs.map((x) => x._id) } });
    await Batch.deleteOne({ _id: gb._id });

    console.log("\nrequest list: filters, pages, delete");
    const all = await AgentRun.countDocuments({ hidden: { $ne: true } });
    out = await run(ctl.getRuns, { user: owner, query: { limit: "2", page: "2" } });
    check("pages: total, page count and the right slice", out.body.total === all && out.body.pages === Math.ceil(all / 2) && out.body.page === 2 && out.body.runs.length === Math.min(2, all - 2), { total: out.body.total, all, pages: out.body.pages });
    out = await run(ctl.getRuns, { user: owner, query: { agent: "copilot", status: "done", q: "ag batch" } });
    check("filter by agent, status and text", out.body.runs.length > 0 && out.body.runs.every((r) => r.agent === "copilot" && r.status === "done" && /ag batch/i.test(`${r.request} ${r.reply}`)), out.body.runs.map((r) => [r.agent, r.status, r.request]));
    out = await run(ctl.getRuns, { user: owner, query: { q: "(((" } });
    check("search text is taken literally", out.code === 200 && out.body.runs.length === 0);
    out = await run(ctl.deleteRun, { user: owner, params: { id: String(asked._id) } });
    const gone = await run(ctl.getRun, { user: owner, params: { id: String(asked._id) } });
    const listed = await run(ctl.getRuns, { user: owner, query: { limit: "50" } });
    const kept = await AgentRun.findById(asked._id);
    check("delete hides it from the page and keeps it a while for the agents", out.code === 200 && gone.code === 404 && !listed.body.runs.some((r) => String(r._id) === String(asked._id)) && kept.hidden && kept.deleteAfter > new Date());
    const active = await AgentRun.create({ agent: "copilot", user: owner._id, request: "busy one", status: "running" });
    out = await run(ctl.deleteRun, { user: owner, params: { id: String(active._id) } });
    check("work in progress can't be deleted", out.code === 409);
    const waitingRun = await AgentRun.create({ agent: "copilot", user: owner._id, request: "waits", status: "awaiting", steps: [{ tool: "create_exam", title: "x", args: {} }] });
    out = await run(ctl.clearRuns, { user: owner, query: {}, body: {} });
    const left = await AgentRun.find({ hidden: { $ne: true } }).select("status").lean();
    check("clear finished removes only finished requests", out.body.cleared > 0 && left.every((r) => ["running", "awaiting", "planning"].includes(r.status)) && left.some((r) => String(r._id) === String(waitingRun._id)), { cleared: out.body.cleared, left });

    ai.generate = realGenerate;
    await AgentRun.deleteMany({});
    await Exam.deleteMany({ batches: { $in: [batch._id, offBatch._id] } });
    await Question.deleteMany({ subject: subject._id });
    await Chapter.deleteMany({ subject: subject._id });
    await Subject.deleteOne({ _id: subject._id });
    await Batch.deleteMany({ _id: { $in: [batch._id, offBatch._id] } });
    await Program.deleteOne({ _id: program._id });
    await User.deleteMany({ _id: { $in: [owner._id, teacher._id] } });
    await mongoose.disconnect();
  }
  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exit(1); }
  console.log("PASS");
})();
