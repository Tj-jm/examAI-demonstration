const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const Batch = require("../../models/batchModel");
const AiConfig = require("../../models/aiConfigModel");
const Purchase = require("../../models/purchaseModel");
const Trial = require("../../models/trialModel");
const Lecture = require("../../models/lectureModel");
const Exam = require("../../models/examModel");
const ExamSetGroup = require("../../models/examSetGroupModel");
const examSets = require("../../utils/examSets");
const Submission = require("../../models/submissionModel");
const LectureProgress = require("../../models/lectureProgressModel");
const Doubt = require("../../models/doubtModel");
const { resolveExpiry, resolveWindowStart, FOREVER } = require("../../utils/accessWindow");
const { shape: shapeMedia } = require("../admin/mediaController");
const cache = require("../../utils/cache");
const tags = require("../../utils/cacheTags");
const { SELECT: TEACHER_FIELDS, teachersByBatch } = require("../../utils/teacherProfile");

const hasActiveProgram = (batch) => batch.program?.isActive !== false;

// One batch's published lectures and open-able exams, the same for every
// student: cached until a lecture, exam or the batch changes. Lecture.batches
// and Exam.batches are arrays (shared across batches), so each batch lists
// its own ids rather than grouping by the first batch in the array.
const EXAM_FIELDS = "title durationMinutes mode opensAt liveHours closesAt attemptsAllowed batches isPublished isActive createdAt paperSet";
const batchContent = (batchId) =>
  cache.wrap(
    `dashboard:content:${batchId}`,
    [tags.BATCHES, tags.batch(batchId), tags.LECTURES, tags.EXAMS],
    async () => {
      const [lectures, exams] = await Promise.all([
        Lecture.find({ batches: batchId, isPublished: true }).distinct("_id"),
        Exam.find({ batches: batchId, isPublished: true, isActive: true, offline: null }).select(EXAM_FIELDS).lean(),
      ]);
      return JSON.parse(JSON.stringify({ lectures, exams }));
    },
    { group: "dashboard" }
  );

// Resolves the same three-way access a batchAccess middleware check would,
// but for every batch at once rather than one named by a route param — the
// dashboard and the browse list both need "which of these can this student
// actually open", not just a yes/no for a single batch.
const resolveAccess = async (studentId, batches) => {
  const now = new Date();
  const ids = batches.map((b) => b._id);

  const [purchases, trials] = await Promise.all([
    Purchase.find({ student: studentId, batch: { $in: ids }, status: "complete" }).sort({ startDate: 1 }),
    Trial.find({ student: studentId, batch: { $in: ids } }),
  ]);

  const purchasesByBatch = new Map();
  for (const p of purchases) {
    const key = String(p.batch);
    if (!purchasesByBatch.has(key)) purchasesByBatch.set(key, []);
    purchasesByBatch.get(key).push(p);
  }
  const trialByBatch = new Map(trials.map((t) => [String(t.batch), t]));

  return batches.map((batch) => {
    // Free batches used to be auto-enrolled — now they go through a 0-cost
    // purchase so every batch, free or paid, has a consistent access model:
    // a Purchase record is what grants access, not accessType.
    const batchPurchases = purchasesByBatch.get(String(batch._id)) || [];
    const expiry = resolveExpiry(batchPurchases);
    if (expiry && expiry >= now) {
      return {
        batch, accessVia: "purchase", expiresAt: expiry, hasAccess: true,
        // Only meaningful (non-null) when expiry isn't the FOREVER sentinel —
        // a lifetime plan has no "total days" to show a countdown against.
        startDate: expiry.getTime() === FOREVER.getTime() ? null : resolveWindowStart(batchPurchases),
      };
    }

    const trial = trialByBatch.get(String(batch._id));
    if (trial && trial.endDate >= now) {
      return { batch, accessVia: "trial", expiresAt: trial.endDate, hasAccess: true, startDate: trial.startDate };
    }

    return {
      batch,
      accessVia: null,
      expiresAt: null,
      hasAccess: false,
      trialAvailable: !trial && (batch.trialDays || 0) > 0,
    };
  });
};

const shapeBatch = async (entry, progress, teachers = []) => ({
  _id: entry.batch._id,
  name: entry.batch.name,
  icon: entry.batch.icon,
  description: entry.batch.description || null,
  // program.image is a Media ref — populated by the caller, but never
  // trusted to already be shaped: shapeMedia is what turns it into a real
  // resolvable url (or null when unset), same discipline as
  // Notice.coverImage elsewhere in this codebase.
  program: entry.batch.program && {
    _id: entry.batch.program._id,
    title: entry.batch.program.title,
    icon: entry.batch.program.icon,
    iconColor: entry.batch.program.iconColor,
    description: entry.batch.program.description || null,
    image: entry.batch.program.image ? await shapeMedia(entry.batch.program.image) : null,
    order: entry.batch.program.order,
    isActive: entry.batch.program.isActive,
  },
  accessType: entry.batch.accessType,
  features: entry.batch.features,
  hasAccess: entry.hasAccess,
  accessVia: entry.accessVia,
  expiresAt: entry.expiresAt,
  neverExpires: Boolean(entry.expiresAt) && new Date(entry.expiresAt).getTime() === FOREVER.getTime(),
  // Anchors the "days remaining" ring's total-length calc (expiresAt -
  // startDate) — null for a lifetime plan (no total to show) or when
  // there's no access at all.
  startDate: entry.startDate || null,
  trialAvailable: entry.trialAvailable || false,
  plans: entry.hasAccess ? undefined : entry.batch.plans.filter((p) => p.isActive),
  progress,
  teachers,
});

// How much of each kind of content a batch has: a section with nothing in
// it isn't shown on the batch's page.
const contentCounts = async (batch) => {
  const { Question } = require("../../models/questionModel");
  const { batchQuestionScope } = require("../../utils/batchSubjects");
  const LiveClass = require("../../models/liveClassModel");
  const { Assignment } = require("../../models/assignmentModel");
  const Notice = require("../../models/noticeModel");
  const id = batch._id;
  const SlideDeck = require("../../models/slideDeckModel");
  const [lectures, exams, practice, liveClasses, upcomingLive, assignments, notices, slides] = await Promise.all([
    Lecture.countDocuments({ batches: id, isPublished: true }),
    Exam.find({ batches: id, isPublished: true }).select("paperSet").lean().then((rows) => new Set(rows.map((e) => String(e.paperSet?.group || e._id))).size),
    Question.countDocuments({ ...batchQuestionScope(batch), status: "published" }),
    LiveClass.countDocuments({ batch: id, status: { $ne: "cancelled" } }),
    LiveClass.findOne({ batch: id, status: { $in: ["scheduled", "live"] }, scheduledAt: { $gte: new Date(Date.now() - 3 * 3600000) } }).sort({ scheduledAt: 1 }).select("title scheduledAt status").lean(),
    Assignment.countDocuments({ batch: id, isPublished: true }),
    Notice.countDocuments({ batches: id }),
    SlideDeck.countDocuments({ batch: id, published: true }),
  ]);
  return { lectures, exams, practice, liveClasses, assignments, notices, slides, nextLive: upcomingLive ? { title: upcomingLive.title, at: upcomingLive.scheduledAt, live: upcomingLive.status === "live" } : null };
};

//@desc   Every active batch, with this student's access status on each —
//        both what they're enrolled in and what's available to browse
//@route  GET /api/app/batches
//@access Private (student)
const getBatches = asyncHandler(async (req, res) => {
  const batches = await Batch.find({ isActive: true })
    .populate({ path: "program", select: "title icon iconColor description image order isActive", populate: { path: "image" } })
    .populate({ path: "teachers", select: TEACHER_FIELDS })
    .sort({ "program.order": 1, order: 1, name: 1 });
  const resolved = await resolveAccess(req.student._id, batches.filter(hasActiveProgram));
  const byBatch = await teachersByBatch(batches);
  const teachersOf = (r) => byBatch.get(String(r.batch._id)) || [];

  const [enrolled, browsable] = await Promise.all([
    Promise.all(resolved.filter((r) => r.hasAccess).map((r) => shapeBatch(r, undefined, teachersOf(r)))),
    Promise.all(resolved.filter((r) => !r.hasAccess).map((r) => shapeBatch(r, undefined, teachersOf(r)))),
  ]);

  // Nothing to browse where nothing is sold: staff add students.
  const sales = (await require("../../models/appSettingsModel").get()).institution?.sales !== false;
  res.status(200).json({ enrolled, browsable: sales ? browsable : [] });
});

//@desc   One batch, with progress — requires access
//@route  GET /api/app/batches/:batchId
//@access Private (student + batchAccess)
const getBatch = asyncHandler(async (req, res) => {
  const batch = req.batch; // set by batchAccess, not populated there — every
  // other route behind that middleware would pay for a populate it doesn't
  // need, so it's done here instead, once, for the one route that does.
  await batch.populate("program", "title icon iconColor");
  const teachers = (await teachersByBatch([await Batch.findById(batch._id).select("teachers").populate({ path: "teachers", select: TEACHER_FIELDS }).lean()])).get(String(batch._id)) || [];

  // watchedCount deliberately doesn't filter LectureProgress by `batch` —
  // that field is only ever set once, via $setOnInsert, to whichever batch
  // the student happened to be in the very first time they opened that
  // lecture (see getLecture/updateProgress above). A lecture shared across
  // more than one batch (Lecture.batches is an array on purpose) would
  // then have its progress permanently attributed to just one of them,
  // silently undercounting every other batch it's also assigned to — a
  // lecture genuinely watched would show as not-watched here while the
  // Lectures list page (which correctly matches by lecture id only, no
  // batch filter) shows it checked off. Matching by this batch's own
  // lecture ids instead is what makes the two agree.
  const lectureIds = await Lecture.find({ batches: batch._id, isPublished: true }).distinct("_id");

  const [lectureCount, watchedCount, examCount, submissions] = await Promise.all([
    lectureIds.length,
    LectureProgress.countDocuments({ student: req.student._id, lecture: { $in: lectureIds }, completedAt: { $ne: null } }),
    Exam.find({ batches: batch._id, isPublished: true }).select("paperSet").lean()
      .then((rows) => new Set(rows.map((e) => String(e.paperSet?.group || e._id))).size),
    Submission.find({ student: req.student._id, batch: batch._id, status: "graded" })
      .select("marks totalMarks")
      .sort({ createdAt: -1 })
      .limit(50),
  ]);

  const averageScore = submissions.length > 0
    ? Math.round(
        (submissions.reduce((sum, s) => sum + (s.totalMarks > 0 ? s.marks / s.totalMarks : 0), 0) / submissions.length) * 100
      )
    : null;

  res.status(200).json({
    _id: batch._id,
    name: batch.name,
    icon: batch.icon,
    program: batch.program,
    features: batch.features,
    gradesPublished: Boolean(batch.gradebook?.published),
    accessType: batch.accessType,
    accessVia: req.accessVia,
    expiresAt: req.expiresAt,
    // An infinite plan resolves expiresAt to a literal year-9999 sentinel
    // (see resolveExpiry in accessWindow.js) rather than null, so a
    // finite-access batch and a lifetime one are never ambiguous with
    // each other at the database layer — but formatting that sentinel as
    // an actual date is exactly the "awkward date" a lifetime batch would
    // otherwise show. This flag is what lets the frontend say "lifetime
    // access" instead, without needing to know the sentinel value itself
    // or guess at how far in the future is "too far to be a real date".
    neverExpires: Boolean(req.expiresAt) && new Date(req.expiresAt).getTime() === FOREVER.getTime(),
    trialEndsAt: req.trialEndsAt || null,
    trialDays: batch.trialDays || null,
    // Whether this batch presents the archive module at all — the actual
    // list of which boards/exams it's restricted to lives behind the
    // archive's own routes, not exposed here.
    hasArchive: (batch.archiveAuthorities || []).length > 0,
    // Admin-wide "Explain mistakes to students" switch — the "Explain why"
    // button is hidden everywhere when it's off (practice + archive).
    aiExplanations: Boolean((await AiConfig.get()).features.studentExplanations),
    // Settings → AI switches for questions on practice solutions and short
    // AI videos; the batch's own switches are in features.
    aiPracticeQna: Boolean((await AiConfig.get()).features.practiceQna),
    aiStudentVideos: Boolean((await AiConfig.get()).features.studentVideos),
    aiPoraDhora: Boolean((await AiConfig.get()).features.poraDhora),
    aiTutor: Boolean((await AiConfig.get()).features.aiTutor),
    aiInterview: Boolean((await AiConfig.get()).features.interview),
    progress: { lectureCount, watchedCount, examCount, examsTaken: submissions.length, averageScore },
    counts: await contentCounts(batch),
    // What to do next here: the lecture to pick up, the next exam, a live
    // class (utils/nextUp.js), for the Bento and Tabs styles.
    next: await require("../../utils/nextUp").forBatch(req.student._id, batch._id).catch((e) => { console.error("nextUp.forBatch:", e.message); return null; }),
    teachers,
  });
});

//@desc   Start a trial on a batch that offers one
//@route  POST /api/app/batches/:batchId/trial
//@access Private (student)
const startTrial = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.batchId);
  if (!batch || !batch.isActive) {
    res.status(404);
    throw new Error("Batch not found.");
  }
  if (!batch.trialDays || batch.trialDays <= 0) {
    res.status(400);
    throw new Error("This batch does not offer a trial.");
  }

  const existing = await Trial.findOne({ student: req.student._id, batch: batch._id });
  if (existing) {
    res.status(409);
    throw new Error("A trial has already been used on this batch.");
  }

  const trial = await Trial.create({
    student: req.student._id,
    batch: batch._id,
    endDate: new Date(Date.now() + batch.trialDays * 86400000),
  });

  res.status(201).json(trial);
});

//@desc   Everything the home screen needs in one call: enrolled batches with
//        progress, what to resume, what's ready to take
//@route  GET /api/app/dashboard
//@access Private (student)
const getDashboard = asyncHandler(async (req, res) => {
  // isActive: true here is what keeps every stat below scoped to currently
  // active batches — a batch that gets deactivated drops out of `batches`
  // (and so out of `batchIds`) entirely, so nothing it holds (lectures,
  // exams, doubts) counts toward any summary number, without needing a
  // separate isActive check in each query below.
  const batches = await Batch.find({ isActive: true })
    .populate({ path: "program", select: "title icon iconColor description image order isActive", populate: { path: "image" } })
    .sort({ "program.order": 1, order: 1, name: 1 });
  const resolved = (await resolveAccess(req.student._id, batches)).filter((r) => r.hasAccess);
  const batchIds = resolved.map((r) => r.batch._id);

  const [continueWatching, contents] = await Promise.all([
    LectureProgress.findOne({ student: req.student._id, batch: { $in: batchIds }, completedAt: null })
      .sort({ lastWatchedAt: -1 })
      .populate({ path: "lecture", select: "title chapter", populate: { path: "chapter", select: "title" } })
      .populate("batch", "name"),
    Promise.all(batchIds.map((id) => batchContent(id))),
  ]);
  const lectureCounts = batchIds.map((id, i) => ({ _id: id, lectures: contents[i].lectures, count: contents[i].lectures.length }));
  // Every exam across the student's batches once, even when shared.
  const examById = new Map();
  // The first of the student's batches each exam is in: its page lives
  // under a batch (/batches/:batchId/exams/:id).
  const examBatch = new Map();
  contents.forEach((c, i) => {
    for (const e of c.exams) {
      if (examById.has(String(e._id))) continue;
      examById.set(String(e._id), e);
      examBatch.set(String(e._id), batchIds[i]);
    }
  });
  // Paper sets fold into one entry per group: the student's own set, or
  // the one they would get now (utils/examSets.js). Its link uses the
  // group's id, which the exam pages resolve to the student's set.
  const hydrated = [...examById.values()].map((e) => Exam.hydrate(e));
  const setGroupIds = [...new Set(hydrated.filter((e) => e.paperSet?.group).map((e) => String(e.paperSet.group)))];
  const liveGroups = new Map((setGroupIds.length ? await ExamSetGroup.find({ _id: { $in: setGroupIds }, isPublished: true }).select("title").lean() : []).map((g) => [String(g._id), g]));
  const { plain, folded } = examSets.foldSets(hydrated, await examSets.assignmentsFor(req.student._id, setGroupIds), liveGroups);
  const linkId = new Map();
  for (const f of folded) {
    if (!liveGroups.has(f.groupId)) continue;
    linkId.set(String(f.exam._id), { id: f.groupId, title: f.title });
    plain.push(f.exam);
  }
  const allExams = plain;
  const exams = allExams.slice(0, 20);

  // watchedCountByBatch is built from the unwound lectureCounts rows above
  // (each batch's real lecture ids), not from grouping LectureProgress by
  // its own `batch` field — that field is set once, via $setOnInsert, to
  // whichever batch a student happened to be in the first time they ever
  // opened a given lecture (see getLecture/updateProgress), and never
  // updates after. A lecture shared across batches would then have its
  // watched status permanently pinned to just one of them, undercounting
  // every other batch it's also assigned to. Same fix as getBatch above,
  // applied here for the same reason.
  const allLectureIds = lectureCounts.flatMap((row) => row.lectures);
  const watchedLectureIds = new Set(
    (
      await LectureProgress.find({
        student: req.student._id,
        lecture: { $in: allLectureIds },
        completedAt: { $ne: null },
      }).distinct("lecture")
    ).map(String)
  );
  const watchedCountByBatch = new Map(
    lectureCounts.map((row) => [
      String(row._id),
      row.lectures.filter((lectureId) => watchedLectureIds.has(String(lectureId))).length,
    ])
  );

  const lectureCountByBatch = new Map(lectureCounts.map((l) => [String(l._id), l.count]));

  const attempts = await Submission.find({ student: req.student._id, exam: { $in: exams.map((e) => e._id) } })
    .select("exam status attempt");

  const attemptsByExam = new Map();
  for (const a of attempts) {
    const key = String(a.exam);
    attemptsByExam.set(key, (attemptsByExam.get(key) || []).concat(a));
  }

  const upcoming = exams
    .filter((e) => e.isOpen())
    .filter((e) => (attemptsByExam.get(String(e._id)) || []).length < e.attemptsAllowed)
    .slice(0, 5)
    .map((e) => ({
      _id: linkId.get(String(e._id))?.id || e._id,
      batch: examBatch.get(String(e._id)),
      title: linkId.get(String(e._id))?.title || e.title,
      durationMinutes: e.durationMinutes,
      mode: e.mode,
      attemptsUsed: (attemptsByExam.get(String(e._id)) || []).length,
      attemptsAllowed: e.attemptsAllowed,
    }));

  const totalLectures = Array.from(lectureCountByBatch.values()).reduce((sum, c) => sum + c, 0);
  const totalWatched = Array.from(watchedCountByBatch.values()).reduce((sum, c) => sum + c, 0);

  const examsAvailable = allExams.length;
  const allAttempts = await Submission.find({ student: req.student._id, batch: { $in: batchIds } }).select("exam status batch");
  // A paper-set group counts once, however many sets it has.
  const examCounts = batchIds.map((id, i) => ({
    _id: id,
    count: new Set(contents[i].exams.map((e) => String(e.paperSet?.group || e._id))).size,
  }));
  const examCountByBatch = new Map(examCounts.map((e) => [String(e._id), e.count]));

  // Per-batch "exams taken" / "exams graded" — distinct exams per batch,
  // not submission counts (a re-attempted exam shouldn't count twice).
  const examsTakenByBatch = new Map();
  const examsGradedByBatch = new Map();
  for (const a of allAttempts) {
    const bKey = String(a.batch);
    const eKey = String(a.exam);
    if (["in_progress", "submitted", "grading", "graded", "rejected"].includes(a.status)) {
      if (!examsTakenByBatch.has(bKey)) examsTakenByBatch.set(bKey, new Set());
      examsTakenByBatch.get(bKey).add(eKey);
    }
    if (a.status === "graded") {
      if (!examsGradedByBatch.has(bKey)) examsGradedByBatch.set(bKey, new Set());
      examsGradedByBatch.get(bKey).add(eKey);
    }
  }

  const examsTaken = new Set(
    allAttempts
      .filter((a) => ["in_progress", "submitted", "grading", "graded", "rejected"].includes(a.status))
      .map((a) => String(a.exam))
  ).size;
  // Exams with a released result, out of exams taken — a completion ratio
  // like the dashboard's other bars (Lectures viewed, Exams taken), not a
  // pending-grading backlog. "graded" is the one status that means a result
  // actually exists on the student side; "submitted"/"grading" have nothing
  // to show yet, and "rejected" (arrived after the window, never scored —
  // see submissionController.js) never will.
  const examsGraded = new Set(
    allAttempts
      .filter((a) => a.status === "graded")
      .map((a) => String(a.exam))
  ).size;
  // "Human doubt" is a status, not the original mode — mode never changes
  // when an AI doubt is escalated (see escalateDoubt in
  // controllers/app/doubtController.js, which only touches status and
  // escalatedAt), so filtering on mode: "human" here missed every doubt
  // that started with the AI and was later escalated, even once a human
  // had resolved it. The doubt-solver queue, the payment summary, and the
  // weekly quota all already key off status/escalatedAt instead — this
  // matches that, rather than being the one place on the platform that
  // still reads the original mode.
  const humanDoubtQuery = {
    student: req.student._id,
    batch: { $in: batchIds },
    status: { $in: ["escalated", "resolved"] },
  };
  const [doubtsTotal, doubtsAnswered] = await Promise.all([
    Doubt.countDocuments(humanDoubtQuery),
    Doubt.countDocuments({ ...humanDoubtQuery, status: "resolved" }),
  ]);

  res.status(200).json({
    batches: await Promise.all(resolved.map((entry) => {
      const bKey = String(entry.batch._id);
      return shapeBatch(entry, {
        lectureCount: lectureCountByBatch.get(bKey) || 0,
        watchedCount: watchedCountByBatch.get(bKey) || 0,
        examCount: examCountByBatch.get(bKey) || 0,
        examsTaken: examsTakenByBatch.get(bKey)?.size || 0,
        examsGraded: examsGradedByBatch.get(bKey)?.size || 0,
      });
    })),
    continueWatching,
    upcoming,
    // Next exam and live class, today's timeline and the tutor streak, for
    // the Bento and Today home styles (utils/nextUp.js).
    next: await require("../../utils/nextUp").forHome(req.student._id, batchIds, { timezone: String(req.query.tz || "").slice(0, 60) || undefined }).catch((e) => { console.error("nextUp.forHome:", e.message); return null; }),
    stats: {
      activeBatches: resolved.length,
      totalLectures,
      totalWatched,
      examsAvailable,
      examsTaken,
      examsGraded,
      doubtsTotal,
      doubtsAnswered,
    },
  });
});

//@desc   Which of the student's batches has this lecture or exam, for a
//        notice link (/go/:kind/:id) that can't name one batch. Prefers a
//        batch the student can open now; the page itself still checks access.
//@route  GET /api/app/batches/locate/:kind/:id
//@access Private (student)
const locateItem = asyncHandler(async (req, res) => {
  const model = { lecture: Lecture, exam: Exam }[req.params.kind];
  if (!model || !mongoose.isValidObjectId(req.params.id)) {
    res.status(404);
    throw new Error("Not found.");
  }
  const item = await model.findById(req.params.id).select("batches").lean();
  const itemBatches = (item?.batches || []).map(String);
  if (!itemBatches.length) {
    res.status(200).json({ batchId: null });
    return;
  }
  const now = new Date();
  const [purchases, trials] = await Promise.all([
    Purchase.find({ student: req.student._id, batch: { $in: itemBatches }, status: "complete" }).select("batch plan startDate").sort({ startDate: 1 }).lean(),
    Trial.find({ student: req.student._id, batch: { $in: itemBatches }, endDate: { $gte: now } }).select("batch").lean(),
  ]);
  const byBatch = new Map();
  for (const p of purchases) byBatch.set(String(p.batch), [...(byBatch.get(String(p.batch)) || []), p]);
  const open = itemBatches.find((b) => {
    const expiry = byBatch.has(b) ? resolveExpiry(byBatch.get(b)) : null;
    return (expiry && expiry >= now) || trials.some((t) => String(t.batch) === b);
  });
  const owned = open || itemBatches.find((b) => byBatch.has(b));
  res.status(200).json({ batchId: owned || null });
});

module.exports = { contentCounts, resolveAccess, getBatches, getBatch, startTrial, getDashboard, locateItem };
