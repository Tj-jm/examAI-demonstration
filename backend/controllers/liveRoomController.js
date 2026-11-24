const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const LiveClass = require("../models/liveClassModel");
const LiveQuestion = require("../models/liveQuestionModel");
const LivePoll = require("../models/livePollModel");
const liveClassAdapter = require("../adapters/liveClass");
const { screenMessage } = require("../utils/conduct");

// The in-app classroom's own tools — the Q&A board and polls — for both
// sides: staff (admin routes, /api/live-classes/:id/…) and students (app
// routes, /api/app/batches/:batchId/live-classes/:id/…). A public
// webinar's guests use the student handlers too (/api/app/webinars/:slug/…,
// req.guest set by webinarController's guestProtect). Every change pings
// the room over LiveKit so open screens refresh at once.

const lk = () => liveClassAdapter.get("livekit");
const ping = (liveClass, type, extra = {}) => lk().broadcast(liveClass.externalId, { type, ...extra });
const oid = (id) => mongoose.isValidObjectId(id);

// ------------------------------------------------------------ loaders

const staffClass = async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id);
  if (!liveClass || liveClass.provider !== "livekit") {
    res.status(404);
    throw new Error("In-app class not found.");
  }
  if (req.user.role === "teacher" && !(liveClass.teachers || []).some((t) => String(t) === String(req.user._id))) {
    res.status(403);
    throw new Error("You are not assigned to this class.");
  }
  return liveClass;
};

const studentClass = async (req, res, { mustBeLive = true } = {}) => {
  // A guest (webinarController guestProtect) was already matched to the class.
  const liveClass = req.webinar
    ? await LiveClass.findById(req.webinar._id)
    : await LiveClass.findOne({ _id: req.params.id, batch: req.params.batchId });
  if (!liveClass || liveClass.provider !== "livekit") {
    res.status(404);
    throw new Error("In-app class not found.");
  }
  if (mustBeLive && liveClass.status !== "live") {
    res.status(409);
    throw new Error("The class isn't live.");
  }
  return liveClass;
};

// ------------------------------------------------------------ Q&A

const shapeQuestion = (q, me) => ({
  _id: q._id,
  name: q.name,
  text: q.text,
  votes: q.upvotes.length,
  votedByMe: me ? q.upvotes.some((u) => String(u) === String(me)) : undefined,
  mine: me ? String(q.student) === String(me) : undefined,
  status: q.status,
  spotlight: q.spotlight,
  guest: q.guest || undefined,
  createdAt: q.createdAt,
});
const byVotes = (a, b) => b.upvotes.length - a.upvotes.length || a.createdAt - b.createdAt;

//@route  GET /api/app/batches/:batchId/live-classes/:id/qa
const studentListQuestions = asyncHandler(async (req, res) => {
  const liveClass = await studentClass(req, res, { mustBeLive: false });
  // A guest's question waiting for approval shows only to its asker.
  const list = await LiveQuestion.find({
    liveClass: liveClass._id,
    $or: [{ status: { $in: ["open", "answered"] } }, { status: "pending", student: req.student._id }],
  });
  res.status(200).json({ questions: list.sort(byVotes).map((q) => shapeQuestion(q, req.student._id)) });
});

//@route  POST /api/app/batches/:batchId/live-classes/:id/qa  { text }
const studentAsk = asyncHandler(async (req, res) => {
  const liveClass = await studentClass(req, res);
  const text = String(req.body.text || "").trim().slice(0, 400);
  if (!text) {
    res.status(400);
    throw new Error("Type your question first.");
  }
  const mode = req.guest ? liveClass.public?.questions || "approve" : "open";
  if (mode === "off") {
    res.status(403);
    throw new Error("Questions are off in this webinar.");
  }
  const open = await LiveQuestion.countDocuments({ liveClass: liveClass._id, student: req.student._id, status: { $in: ["open", "pending"] } });
  if (open >= 3) {
    res.status(429);
    throw new Error("You have 3 questions waiting. Wait for the host to get to them.");
  }
  if (req.guest) {
    // A guest has no account to hold to the rules: a rude question is
    // refused, and one question every 20 seconds.
    if (require("../utils/abuseWords").findAbuse(text)) {
      res.status(400);
      throw new Error("That message was flagged as abusive and wasn't sent. Please keep it respectful.");
    }
    const lastOne = await LiveQuestion.findOne({ liveClass: liveClass._id, student: req.student._id }).sort({ createdAt: -1 }).select("createdAt");
    if (lastOne && Date.now() - lastOne.createdAt < 20000) {
      res.status(429);
      throw new Error("Wait a few seconds before asking again.");
    }
  } else {
    await screenMessage({ student: req.student._id, batch: liveClass.batch, source: "liveQa", text });
  }
  const q = await LiveQuestion.create({
    liveClass: liveClass._id, student: req.student._id, name: req.student.name || "Student", text,
    ...(req.guest ? { guest: true, status: mode === "approve" ? "pending" : "open" } : {}),
  });
  ping(liveClass, "qa");
  res.status(201).json({ question: shapeQuestion(q, req.student._id) });
});

//@route  POST /api/app/batches/:batchId/live-classes/:id/qa/:qid/upvote
const studentUpvote = asyncHandler(async (req, res) => {
  const liveClass = await studentClass(req, res);
  const q = oid(req.params.qid) && (await LiveQuestion.findOne({ _id: req.params.qid, liveClass: liveClass._id }));
  if (!q || ["dismissed", "pending"].includes(q.status)) {
    res.status(404);
    throw new Error("Question not found.");
  }
  if (String(q.student) === String(req.student._id)) {
    res.status(400);
    throw new Error("You can't upvote your own question.");
  }
  const has = q.upvotes.some((u) => String(u) === String(req.student._id));
  q.upvotes = has ? q.upvotes.filter((u) => String(u) !== String(req.student._id)) : [...q.upvotes, req.student._id];
  await q.save();
  ping(liveClass, "qa");
  res.status(200).json({ question: shapeQuestion(q, req.student._id) });
});

//@route  GET /api/live-classes/:id/qa
const staffListQuestions = asyncHandler(async (req, res) => {
  const liveClass = await staffClass(req, res);
  const list = await LiveQuestion.find({ liveClass: liveClass._id });
  res.status(200).json({ questions: list.sort(byVotes).map((q) => shapeQuestion(q)) });
});

//@route  PUT /api/live-classes/:id/qa/:qid  { status?, spotlight? }
const staffUpdateQuestion = asyncHandler(async (req, res) => {
  const liveClass = await staffClass(req, res);
  const q = oid(req.params.qid) && (await LiveQuestion.findOne({ _id: req.params.qid, liveClass: liveClass._id }));
  if (!q) {
    res.status(404);
    throw new Error("Question not found.");
  }
  if (["open", "answered", "dismissed"].includes(req.body.status)) {
    q.status = req.body.status;
    if (q.status !== "open") q.spotlight = false;
  }
  if (req.body.spotlight !== undefined) {
    // One question in the spotlight at a time.
    if (req.body.spotlight) await LiveQuestion.updateMany({ liveClass: liveClass._id, spotlight: true }, { spotlight: false });
    q.spotlight = Boolean(req.body.spotlight);
  }
  await q.save();
  ping(liveClass, "qa");
  res.status(200).json({ question: shapeQuestion(q) });
});

// ------------------------------------------------------------ polls

const tally = (poll) => {
  const counts = Object.fromEntries(poll.options.map((o) => [o.key, 0]));
  for (const r of poll.responses) if (r.key in counts) counts[r.key] += 1;
  return counts;
};

const shapePoll = (poll, me) => {
  const mine = me ? poll.responses.find((r) => String(r.student) === String(me)) : null;
  const showResults = !me || poll.revealed;
  return {
    _id: poll._id,
    text: poll.text,
    image: poll.image,
    options: poll.options.map((o) => ({ key: o.key, text: o.text, image: o.image })),
    status: poll.status,
    revealed: poll.revealed,
    fromBank: Boolean(poll.question),
    responses: showResults ? poll.responses.length : undefined,
    counts: showResults ? tally(poll) : undefined,
    correct: !me || poll.revealed ? poll.correct : undefined,
    myAnswer: me ? mine?.key || null : undefined,
    createdAt: poll.createdAt,
  };
};

//@route  POST /api/live-classes/:id/polls  { questionId } or { text, options: [text…], correct? }
const staffCreatePoll = asyncHandler(async (req, res) => {
  const liveClass = await staffClass(req, res);
  if (liveClass.status !== "live") {
    res.status(409);
    throw new Error("Start the class to run a poll.");
  }
  let doc;
  if (req.body.questionId) {
    const { Question } = require("../models/questionModel");
    require("../models/mediaModel");
    const question = oid(req.body.questionId) && (await Question.findById(req.body.questionId).populate("questionImage options.image"));
    if (!question || question.type !== "mcq") {
      res.status(400);
      throw new Error("Pick a multiple-choice question.");
    }
    doc = {
      question: question._id,
      text: question.question,
      image: question.questionImage?.url || null,
      options: question.options.map((o) => ({ key: o.key, text: o.text || "", image: o.image?.url || null })),
      correct: question.correctOption,
    };
  } else {
    const options = (req.body.options || []).map((t) => String(t || "").trim()).filter(Boolean).slice(0, 6);
    const text = String(req.body.text || "").trim();
    if (!text || options.length < 2) {
      res.status(400);
      throw new Error("A poll needs a question and at least two options.");
    }
    const keys = "ABCDEF";
    doc = {
      text,
      options: options.map((t, i) => ({ key: keys[i], text: t })),
      correct: req.body.correct && keys.slice(0, options.length).includes(req.body.correct) ? req.body.correct : null,
    };
  }
  // One poll at a time: launching a new one closes any open one.
  await LivePoll.updateMany({ liveClass: liveClass._id, status: "open" }, { status: "closed", closedAt: new Date() });
  const poll = await LivePoll.create({ liveClass: liveClass._id, ...doc });
  ping(liveClass, "poll", { pollId: String(poll._id) });
  res.status(201).json({ poll: shapePoll(poll) });
});

//@route  GET /api/live-classes/:id/polls
const staffListPolls = asyncHandler(async (req, res) => {
  const liveClass = await staffClass(req, res);
  const polls = await LivePoll.find({ liveClass: liveClass._id }).sort({ createdAt: -1 }).limit(50);
  res.status(200).json({ polls: polls.map((p) => shapePoll(p)) });
});

//@route  PUT /api/live-classes/:id/polls/:pid  { status?: "closed", revealed?: true }
const staffUpdatePoll = asyncHandler(async (req, res) => {
  const liveClass = await staffClass(req, res);
  const poll = oid(req.params.pid) && (await LivePoll.findOne({ _id: req.params.pid, liveClass: liveClass._id }));
  if (!poll) {
    res.status(404);
    throw new Error("Poll not found.");
  }
  if (req.body.status === "closed" && poll.status === "open") {
    poll.status = "closed";
    poll.closedAt = new Date();
  }
  if (req.body.revealed) {
    poll.revealed = true;
    if (poll.status === "open") {
      poll.status = "closed";
      poll.closedAt = new Date();
    }
  }
  await poll.save();
  ping(liveClass, "poll", { pollId: String(poll._id) });
  res.status(200).json({ poll: shapePoll(poll) });
});

//@desc   The poll a student should see now: the open one, or the latest
//        revealed one for a minute after it's revealed.
//@route  GET /api/app/batches/:batchId/live-classes/:id/polls/current
const studentCurrentPoll = asyncHandler(async (req, res) => {
  const liveClass = await studentClass(req, res, { mustBeLive: false });
  const latest = await LivePoll.findOne({ liveClass: liveClass._id }).sort({ createdAt: -1 });
  const visible = latest && (latest.status === "open" || (latest.revealed && Date.now() - latest.updatedAt < 90 * 1000));
  res.status(200).json({ poll: visible ? shapePoll(latest, req.student._id) : null });
});

//@desc   Answer the open poll, once. A bank question also counts as
//        practice, so it feeds the student's weak topics.
//@route  POST /api/app/batches/:batchId/live-classes/:id/polls/:pid/answer  { key }
const studentAnswerPoll = asyncHandler(async (req, res) => {
  const liveClass = await studentClass(req, res);
  const poll = oid(req.params.pid) && (await LivePoll.findOne({ _id: req.params.pid, liveClass: liveClass._id }));
  if (!poll || poll.status !== "open") {
    res.status(409);
    throw new Error("This poll is closed.");
  }
  if (!poll.options.some((o) => o.key === req.body.key)) {
    res.status(400);
    throw new Error("Pick one of the options.");
  }
  if (poll.responses.some((r) => String(r.student) === String(req.student._id))) {
    res.status(409);
    throw new Error("You've already answered.");
  }
  const updated = await LivePoll.findOneAndUpdate(
    { _id: poll._id, status: "open", "responses.student": { $ne: req.student._id } },
    { $push: { responses: { student: req.student._id, key: req.body.key, at: new Date() } } },
    { new: true }
  );
  if (!updated) {
    res.status(409);
    throw new Error("You've already answered.");
  }
  if (poll.question && !req.guest) {
    const PracticeAttempt = require("../models/practiceAttemptModel");
    const { Question } = require("../models/questionModel");
    const question = await Question.findById(poll.question).select("topic chapter");
    if (question) {
      const previous = await PracticeAttempt.findOne({ student: req.student._id, question: question._id }).sort({ createdAt: -1 });
      await PracticeAttempt.create({
        student: req.student._id,
        batch: liveClass.batch,
        question: question._id,
        topic: question.topic || undefined,
        chapter: question.topic ? undefined : question.chapter,
        selectedOption: req.body.key,
        isCorrect: req.body.key === poll.correct,
        timeSpentMs: 0,
        seenCount: (previous?.seenCount || 0) + 1,
      }).catch(() => {});
    }
  }
  // Hosts see the count move; students only see results once revealed.
  ping(liveClass, "pollAnswer", { pollId: String(poll._id) });
  res.status(200).json({ poll: shapePoll(updated, req.student._id) });
});

module.exports = {
  studentListQuestions, studentAsk, studentUpvote, staffListQuestions, staffUpdateQuestion,
  staffCreatePoll, staffListPolls, staffUpdatePoll, studentCurrentPoll, studentAnswerPoll,
};
