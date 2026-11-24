const asyncHandler = require("express-async-handler");
const Doubt = require("../../models/doubtModel");
const aiService = require("../../ai/service");
const { solveDoubt } = require("../../ai/prompts");
const { doubtSolution: doubtSolutionSchema } = require("../../ai/schemas");
const storage = require("../../adapters/storage");
const { assertWithinWeeklyDoubtLimit, countHumanDoubtsThisWeek, endOfWeek } = require("../../utils/doubtQuota");
const { toAbsoluteUrl, assertOwnMediaUrl, recordStudentUpload } = require("../../utils/mediaUrl");
const { preparePhoto } = require("../../utils/photo");

const runAi = async (doubt, { regenerate = false, imageUrl = null } = {}) => {
  const prompt = solveDoubt({ question: doubt.question, topicTitle: undefined, regenerate });
  const { data } = await aiService.generate({
    // A vision call costs more than a text-only one — kept as its own
    // feature key rather than a flag, so admin's per-feature credit cost
    // and the usage-by-feature dashboard can price/report the two
    // differently instead of averaging them together.
    feature: imageUrl ? "doubt-solve-image" : "doubt-solve",
    schema: doubtSolutionSchema,
    student: doubt.student,
    batch: doubt.batch,
    imageUrl: imageUrl || undefined,
    ...prompt,
  });
  // The model judged the doubt abusive: recorded, and a calm reply instead.
  if (data.abusive) {
    await require("../../utils/conduct")
      .recordAbuse({ student: doubt.student, batch: doubt.batch, source: "doubt", text: doubt.question, flaggedBy: "ai" })
      .catch(() => {});
    return "Let's keep it respectful — ask your doubt and I'll help.";
  }
  return data.answer;
};

//@desc   Ask a doubt — "ai" gets an answer immediately, "human" queues for
//        a doubt-solver straight away
//@route  POST /api/app/batches/:batchId/doubts
//@access Private (student + batchAccess + features.doubtSolving)
const createDoubt = asyncHandler(async (req, res) => {
  const { question, mode, questionImage } = req.body;

  if (!question || !question.trim()) {
    res.status(400);
    throw new Error("Describe the doubt before submitting.");
  }
  if (!["ai", "human"].includes(mode)) {
    res.status(400);
    throw new Error("Choose either AI or human help.");
  }
  if (questionImage) {
    await assertOwnMediaUrl(questionImage, req.student._id, "reference image");
  }
  // Free check before a teacher or the AI sees it; throws when abusive.
  await require("../../utils/conduct").screenMessage({ student: req.student._id, batch: req.batch._id, source: "doubt", text: question });
  // doubtSolving is the master switch for the whole route (see
  // requireFeature("doubtSolving") on this router), but that only means
  // "this batch does doubts at all" — aiAssist is the separate switch for
  // whether the AI half of that is available. A batch can have doubts on
  // with AI off (human-only support), so "ai" mode is only valid when
  // both are true; the frontend already hides the AI card in that case
  // (DoubtAsk.jsx), this is the same rule enforced server-side.
  if (mode === "ai" && !req.batch.features?.aiAssist) {
    res.status(400);
    throw new Error("AI doubt help isn't available for this batch — ask a human instead.");
  }

  // Only a "human" doubt spends any of the weekly allowance — an AI-only
  // doubt never asks a human for anything, so it can never trip this.
  // Checked before create, not after, so a student who's out of allowance
  // never ends up with a doubt sitting half-created that then can't be
  // escalated either.
  if (mode === "human") {
    await assertWithinWeeklyDoubtLimit(req.student._id, req.batch);
  }

  const doubt = await Doubt.create({
    student: req.student._id,
    batch: req.batch._id,
    question: question.trim(),
    questionImage,
    mode,
    status: mode === "human" ? "escalated" : "pending",
    escalatedAt: mode === "human" ? new Date() : null,
  });

  if (mode === "ai") {
    try {
      doubt.aiAnswer = await runAi(doubt, { imageUrl: toAbsoluteUrl(req, questionImage) });
      doubt.status = "answered";
      await doubt.save();
    } catch (error) {
      // The doubt still exists in "pending" — the student can retry via
      // regenerate, or escalate straight to a human instead of being stuck.
      // capReached is exposed structurally (not left for the frontend to
      // guess at from the message text) so it can offer "buy more credits"
      // specifically when that's actually why this failed.
      res.status(200).json({ doubt, aiError: error.message, aiErrorCapReached: error.statusCode === 429 });
      return;
    }
  }

  res.status(201).json({ doubt });
});

//@desc   Ask the AI again — only while still in AI hands, not yet escalated
//@route  POST /api/app/batches/:batchId/doubts/:id/regenerate
//@access Private (student + batchAccess + features.doubtSolving)
const regenerateDoubt = asyncHandler(async (req, res) => {
  const doubt = await Doubt.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id });
  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }
  if (doubt.mode !== "ai" || !["pending", "answered"].includes(doubt.status)) {
    res.status(400);
    throw new Error("This doubt is no longer with the AI.");
  }

  doubt.aiAnswer = await runAi(doubt, { regenerate: true, imageUrl: toAbsoluteUrl(req, doubt.questionImage) });
  doubt.status = "answered";
  doubt.regenerateCount += 1;
  await doubt.save();

  res.status(200).json({ doubt });
});

//@desc   Not satisfied with the AI answer — send it to a human
//@route  POST /api/app/batches/:batchId/doubts/:id/escalate
//@access Private (student + batchAccess + features.doubtSolving)
const escalateDoubt = asyncHandler(async (req, res) => {
  const doubt = await Doubt.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id });
  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }
  if (!["pending", "answered"].includes(doubt.status)) {
    res.status(400);
    throw new Error("This doubt has already been escalated or resolved.");
  }

  // This is the "referral" case the weekly limit exists to cover — a doubt
  // that started with the AI still spends the same human allowance the
  // moment it's handed off, same as one asked for a human from the start.
  await assertWithinWeeklyDoubtLimit(req.student._id, req.batch);

  doubt.status = "escalated";
  doubt.escalatedAt = new Date();
  await doubt.save();

  res.status(200).json({ doubt });
});

//@desc   Ask for a resolved doubt to be looked at again — one request per
//        doubt, ever, whether it's approved or turned down. reason is
//        required so an owner/admin has something to judge before deciding
//        (see decideReview in the admin controller); nothing here reopens
//        the doubt by itself, only an approval does that.
//@route  POST /api/app/batches/:batchId/doubts/:id/request-review
//@access Private (student + batchAccess + features.doubtSolving)
const requestReview = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    res.status(400);
    throw new Error("Say why this needs another look.");
  }

  const doubt = await Doubt.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id });
  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }
  if (doubt.status !== "resolved") {
    res.status(400);
    throw new Error("Only a resolved doubt can be reviewed.");
  }
  if (doubt.review.requested) {
    res.status(400);
    throw new Error("This doubt has already used its one review request.");
  }

  doubt.review.requested = true;
  doubt.review.reason = reason.trim();
  doubt.review.requestedAt = new Date();
  await doubt.save();

  res.status(200).json({ doubt });
});

//@desc   This week's human-doubt allowance for the meter on the doubt
//        page — how many used, the limit, and exactly when it resets.
//        null limit means this batch has no cap at all, which the
//        frontend uses to skip rendering a meter entirely rather than
//        showing "0 of 0".
//@route  GET /api/app/batches/:batchId/doubts/quota
//@access Private (student + batchAccess + features.doubtSolving)
const getDoubtQuota = asyncHandler(async (req, res) => {
  // `|| null` used to collapse a real 0 into "unlimited" (null) — wrong
  // now that 0 is its own distinct state (no human doubt capacity at
  // all), not the same as unset. `!= null` is the only check that tells
  // "unset" and "explicitly 0" apart. See doubtLimits.weeklyHumanDoubts's
  // own comment on the Batch model.
  const limit = req.batch.doubtLimits?.weeklyHumanDoubts;
  const hasLimit = limit != null;
  const used = hasLimit ? await countHumanDoubtsThisWeek(req.student._id, req.batch._id) : 0;

  res.status(200).json({ used, limit: hasLimit ? limit : null, resetsAt: hasLimit ? endOfWeek() : null });
});

//@desc   This student's doubts on this batch, most recent first
//@route  GET /api/app/batches/:batchId/doubts?page=&limit=
//@access Private (student + batchAccess + features.doubtSolving)
const getMyDoubts = asyncHandler(async (req, res) => {
  const query = { student: req.student._id, batch: req.batch._id };
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [doubts, total] = await Promise.all([
    Doubt.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Doubt.countDocuments(query),
  ]);

  res.status(200).json({ doubts, total, page, pages: Math.ceil(total / limit) });
});

//@desc   One doubt, in full
//@route  GET /api/app/batches/:batchId/doubts/:id
//@access Private (student + batchAccess + features.doubtSolving)
const getDoubt = asyncHandler(async (req, res) => {
  const doubt = await Doubt.findOne({ _id: req.params.id, student: req.student._id, batch: req.batch._id });
  if (!doubt) {
    res.status(404);
    throw new Error("Doubt not found.");
  }
  res.status(200).json({ doubt });
});

//@desc   Upload a reference image for a doubt — not read by the AI (no
//        vision model wired up), but a human solver can open it
//@route  POST /api/app/batches/:batchId/doubts/upload-image
//@access Private (student + batchAccess + features.doubtSolving)
const uploadDoubtImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const stored = await storage.store("doubt-images", await preparePhoto(req.file));
  await recordStudentUpload(stored.key, req.student._id, "doubt-images");
  const url = await storage.urlFor(stored.key, stored.driver);

  res.status(200).json({ url });
});

module.exports = { createDoubt, regenerateDoubt, escalateDoubt, requestReview, getMyDoubts, getDoubt, uploadDoubtImage, getDoubtQuota };
