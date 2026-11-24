const mongoose = require("mongoose");
const Tutor = require("../models/tutorModel");
const { skillTypeLabel } = require("./skillTypes");
const { orderLectures } = require("./courseOutline");
const { batchQuestionScope, subjectIds } = require("./batchSubjects");

// The student tutor: each day a short plan from the student's own data,
// progress read from what they actually did, a streak, and a sprint mode
// when an exam date is set. Follows the study plan: today's plan day comes
// first and ticks itself from real work. In a sprint the plan waits and the
// tutor works for the exam only. Deterministic: no AI calls.

// A time zone name the runtime knows, or null.
const validTz = (tz) => {
  if (!tz || typeof tz !== "string") return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
};
const dayKey = (date, tz) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};
// The student's UTC offset in minutes (e.g. +360 for Asia/Dhaka).
const offsetMinutes = (tz, at = new Date()) => {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value || "GMT";
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  } catch {
    return 0;
  }
};
// The moment the student's day began, for "done today" counts.
const dayStart = (tz) => {
  const off = offsetMinutes(tz) * 60000;
  const local = new Date(Date.now() + off);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - off);
};
const yesterdayKey = (tz) => dayKey(new Date(Date.now() - 86400000), tz);
// Calendar days from today to the date, both in the student's time zone.
const daysUntil = (date, tz) => (date ? Math.round((Date.parse(dayKey(new Date(date), tz)) - Date.parse(dayKey(new Date(), tz))) / 86400000) : null);

// Study plan link. Plan day N falls on the Nth calendar day since the plan
// was made, in the student's time zone.
const PLAN_TARGET = 10; // practice questions that count as a plan day's work
const planDayToday = (plan, tz) => {
  const a = Date.parse(dayKey(new Date(plan.generatedAt || plan.createdAt), tz));
  const b = Date.parse(dayKey(new Date(), tz));
  return Math.floor((b - a) / 86400000) + 1;
};
// Where the student is on their plan: today's plan day, the first undone
// day up to today (a catch-up when it's earlier), and how far behind.
const planStatus = (plan, tz) => {
  if (!plan?.days?.length) return null;
  const days = [...plan.days].sort((x, y) => x.day - y.day);
  const last = days[days.length - 1].day;
  const today = planDayToday(plan, tz);
  // A day whose content is gone (see syncPlan) can't be done, so it is
  // never today's task and never counts as behind.
  const open = days.filter((d) => !d.completed && !d.unavailable && d.day <= today);
  return { today, last, ended: today > last, current: open[0] || null, behind: open.filter((d) => d.day < today).length, left: days.filter((d) => !d.completed && !d.unavailable).length };
};
const loadPlan = async (student, batchId) => {
  const StudyPlan = require("../models/studyPlanModel");
  return StudyPlan.findOne({ student, batch: batchId });
};
const planTopicIds = (day) => (day.topics || []).filter((t) => t.topic).map((t) => String(t.topic));
const planLectureIds = (day) => (day.topics || []).filter((t) => t.lecture?.lecture).map((t) => String(t.lecture.lecture));

// Question types each practice screen serves: the study plan's Practice
// button and the practice page alike. Written only where AI can grade it.
const planTypes = (batch) => (batch.features?.aiAssist ? ["mcq", "mtf", "written", "passage"] : ["mcq", "mtf", "passage"]);
const pageTypes = planTypes;
// Chapter-pool practice only exists where the batch allows it (the
// archive always has it).
const entryUsable = (t, batch) => t.topic && (!t.chapterPool || batch.planArchive || batch.features?.practiceByChapter);
// The questions a plan draws on: the batch's, or for the archive's plan
// (batch.planArchive, see today) the archive questions this batch reaches.
const planScope = (batch) => (batch.planArchive
  ? { isPublic: true, status: "published", "sources.authority": { $in: batch.archiveAuthorities || [] }, subject: { $in: subjectIds(batch) } }
  : { ...batchQuestionScope(batch), status: "published" });
const planLink = (batch) => `/batches/${batch._id}/${batch.planArchive ? "archive/" : ""}study-plan`;

// The questions a practice or revision plan day draws on: each entry's
// topic (or chapter pool), narrowed to its skill when it has one, the same
// way the study plan's Practice button asks for them.
const planPool = async (day, batch) => {
  const { Question } = require("../models/questionModel");
  const entries = (day.topics || []).filter((t) => entryUsable(t, batch));
  if (!entries.length) return [];
  const or = entries.map((t) => ({
    ...(t.chapterPool ? { chapter: t.topic, topic: null } : { topic: t.topic }),
    ...(t.skillType ? { skillType: t.skillType === "none" ? null : t.skillType } : {}),
  }));
  const types = batch.planArchive ? ["mcq", "mtf", "passage", ...(batch.features?.archiveAiAssist ? ["written"] : [])] : planTypes(batch);
  return Question.find({ ...planScope(batch), type: { $in: types }, $or: or }).distinct("_id");
};
// A lecture day's lectures that still exist, are published and are in
// the batch.
const liveLectures = async (day, batch) => {
  const ids = planLectureIds(day);
  if (!ids.length) return [];
  const Lecture = require("../models/lectureModel");
  return (await Lecture.find({ _id: { $in: ids }, batches: batch._id, isPublished: true }).distinct("_id")).map(String);
};
// Fewest questions a self-build exam can be made from
// (practiceExamController.js MIN_QUESTIONS).
const EXAM_MIN = 3;
const examDayMcq = async (day, batch) => {
  const e = day.exam;
  if (!e?.topic || (e.chapterPool && !batch.planArchive && !batch.features?.practiceByChapter)) return 0;
  const { Question } = require("../models/questionModel");
  return Question.countDocuments({ ...planScope(batch), type: "mcq", ...(e.chapterPool ? { chapter: e.topic, topic: null } : { topic: e.topic }) });
};
// Whether a plan day can still be done: the batch still has its feature,
// and its questions or lectures are still there.
const dayAvailable = async (day, batch) => {
  const has = (f) => batch.features?.[f] !== false;
  if (day.kind === "lecture") return has("lectures") && (await liveLectures(day, batch)).length > 0;
  if (!batch.planArchive && !has("practice")) return false;
  if (day.kind === "exam") return (await examDayMcq(day, batch)) >= EXAM_MIN;
  return (await planPool(day, batch)).length > 0;
};
// Of these topics, the ones practice can actually serve: published
// questions assigned to the batch, the same filter the practice page uses.
// A topic can be weak from exam answers alone while having nothing to
// practise, and suggesting it would open an empty page.
const practiceableTopics = async (batch, topicIds) => {
  if (!topicIds.length) return new Set();
  const { Question } = require("../models/questionModel");
  const q = { ...batchQuestionScope(batch), status: "published", topic: { $in: topicIds }, type: { $in: pageTypes(batch) } };
  return new Set((await Question.find(q).distinct("topic")).map(String));
};
const anyPractice = async (batch) => {
  const { Question } = require("../models/questionModel");
  return Boolean(await Question.exists({ ...batchQuestionScope(batch), status: "published", type: { $in: pageTypes(batch) } }));
};
// Exams the student can sit right now: open (isOpen), with questions, and
// not attempted yet. Soonest-opened first.
const openExams = async (student, batch) => {
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  // Any attempt, from any batch: attempts are counted per exam, not per
  // batch (app/examController.js), so one taken through another batch the
  // exam is also in leaves nothing to take here.
  const taken = await Submission.find({ student }).distinct("exam");
  const exams = await Exam.find({ batches: batch._id, isPublished: true, isActive: true, createdByStudent: null, offline: null, paperSet: null, _id: { $nin: taken }, "questions.0": { $exists: true } })
    .sort({ opensAt: 1, createdAt: 1 }).limit(50).select("title isActive isPublished opensAt mode liveHours closesAt createdAt");
  return exams.filter((e) => e.isOpen());
};
const entryLabel = (t) => (t.skillType && t.skillType !== "none" ? `${t.title} (${skillTypeLabel(t.skillType)})` : t.title);

const planTask = async (day, status, batch) => {
  const what = day.kind === "lecture" ? "Watch" : day.kind === "exam" ? "Take" : day.kind === "revision" ? "Revise" : "Practise";
  const lectures = day.kind === "lecture" ? await liveLectures(day, batch) : [];
  const catchUp = day.day < status.today;
  // A practice day asks for 10 questions, or every question it has when
  // that's fewer: one recall question on the plan means one, not ten.
  let target = day.kind === "lecture" ? Math.max(lectures.length, 1) : day.kind === "exam" ? 1 : PLAN_TARGET;
  if (day.kind !== "lecture" && day.kind !== "exam") {
    const pool = await planPool(day, batch);
    if (pool.length) target = Math.min(PLAN_TARGET, pool.length);
  }
  const n = `${target} question${target === 1 ? "" : "s"}`;
  return {
    key: `plan:${day.day}`,
    kind: "plan",
    planDay: day.day,
    target,
    unit: day.kind === "lecture" ? "lectures" : "questions",
    title: `${catchUp ? "Catch up: " : ""}Plan day ${day.day}: ${day.focus}`,
    detail: day.kind === "exam" ? `${what} ${day.exam?.title || "the plan exam"}`
      : day.kind === "lecture" ? `${what} ${(day.topics || []).map((t) => t.lecture?.title).filter(Boolean).join(", ") || "the lecture"}`
        : `${what} ${(day.topics || []).map(entryLabel).slice(0, 3).join(", ")}, ${n}`,
    link: planLink(batch),
  };
};

// The topics a picked sprint exam covers, from its questions: those in
// the batch's subjects (practice can serve them) and how many are not.
const examScope = async (examId, batch) => {
  const Exam = require("../models/examModel");
  const { Question } = require("../models/questionModel");
  const exam = await Exam.findById(examId).select("questions").lean();
  if (!exam) return null;
  const qs = await Question.find({ _id: { $in: exam.questions || [] }, topic: { $ne: null } }).select("topic subject").lean();
  const allowed = new Set(subjectIds(batch).map(String));
  const inBatch = qs.filter((q) => allowed.has(String(q.subject)));
  return {
    topics: new Set(inBatch.map((q) => String(q.topic))),
    outside: new Set(qs.filter((q) => !allowed.has(String(q.subject))).map((q) => String(q.topic))).size,
  };
};

const sprintOn = (state) => {
  const left = daysUntil(state.sprint?.date, state.timezone);
  return left !== null && left >= 0 && left <= 21;
};

const buildTasks = async (state, batch, plan) => {
  const batchId = batch._id;
  const { rankWeakTopics } = require("./weakTopics");
  const Lecture = require("../models/lectureModel");
  const Batch = require("../models/batchModel");
  const LectureProgress = require("../models/lectureProgressModel");
  const student = state.student;
  const sprint = sprintOn(state);
  const tasks = [];
  // Only suggest what the batch includes.
  const has = (f) => batch.features?.[f] !== false;

  // 0. Today's study plan day first. Not in a sprint: then it's the exam only.
  let planDay = null;
  if (!sprint) {
    const status = planStatus(plan, state.timezone);
    if (status?.current && (await dayAvailable(status.current, batch))) {
      planDay = status.current;
      tasks.push(await planTask(planDay, status, batch));
    }
  }
  const planTopics = new Set(planDay ? planTopicIds(planDay) : []);
  const planLectures = new Set(planDay ? planLectureIds(planDay) : []);

  // 1. Practice where it helps most (not a topic the plan already covers).
  // In a sprint for a picked exam: only that exam's topics, weakest first,
  // then ones not practised yet.
  const scope = sprint && state.sprint?.exam ? await examScope(state.sprint.exam, batch).catch(() => null) : null;
  state.sprintOutside = scope?.outside || 0;
  const ranked = !has("practice") ? [] : await rankWeakTopics(student, new mongoose.Types.ObjectId(String(batchId)), { subjects: subjectIds(batch) }).catch(() => []);
  const candidates = scope
    ? ranked.filter((t) => !t.chapterPool && t.accuracy < 90 && scope.topics.has(String(t._id)))
    : ranked.filter((t) => !t.chapterPool && t.accuracy < 75 && !planTopics.has(String(t._id)));
  const servable = await practiceableTopics(batch, candidates.map((t) => t._id));
  const weak = candidates.filter((t) => servable.has(String(t._id))).slice(0, sprint ? 2 : 1);
  for (const t of weak) {
    tasks.push({ key: `practice:${t._id}`, kind: "practice", refId: t._id, target: sprint ? 15 : 10, title: `Practise ${t.title}`, detail: `${t.accuracy}% correct so far`, link: `/batches/${batchId}/practice/${t._id}` });
  }
  if (scope && has("practice") && weak.length < 2) {
    const Topic = require("../models/topicModel");
    const seen = new Set(ranked.map((t) => String(t._id)));
    const unseen = [...scope.topics].filter((id) => !seen.has(id));
    const servableFresh = await practiceableTopics(batch, unseen);
    const fresh = await Topic.find({ _id: { $in: unseen.filter((id) => servableFresh.has(id)) } }).select("title").limit(2 - weak.length).lean();
    for (const t of fresh) {
      weak.push(t);
      tasks.push({ key: `practice:${t._id}`, kind: "practice", refId: t._id, target: 15, title: `Practise ${t.title}`, detail: "In your exam, not practised yet", link: `/batches/${batchId}/practice/${t._id}` });
    }
  }
  if (has("practice") && !weak.length && !planDay && (await anyPractice(batch))) tasks.push({ key: "practice:any", kind: "practice", refId: null, target: sprint ? 15 : 10, title: "Practise any topic", detail: `${sprint ? 15 : 10} questions`, link: `/batches/${batchId}/practice` });

  // 2. The next lecture they haven't finished (not in a sprint).
  if (!sprint && has("lectures")) {
    const done = await LectureProgress.find({ student, batch: batchId, completedAt: { $ne: null } }).distinct("lecture");
    // First unfinished lecture in the batch's outline order.
    const left = await Lecture.find({ batches: batchId, isPublished: true, _id: { $nin: done } }).select("title chapter topic order createdAt").lean();
    if (left.length) await orderLectures(await Batch.findById(batchId).select("outline").lean(), left);
    const next = left[0];
    if (next && !planLectures.has(String(next._id))) tasks.push({ key: `lecture:${next._id}`, kind: "lecture", refId: next._id, target: 1, title: `Watch ${next.title}`, detail: "Next lecture", link: `/batches/${batchId}/lectures/${next._id}` });
  }

  // 3. An exam that's open now and not yet taken.
  const exam = has("exams") ? (await openExams(student, batch))[0] : null;
  if (exam) tasks.push({ key: `exam:${exam._id}`, kind: "exam", refId: exam._id, target: 1, title: `Take ${exam.title}`, detail: "Open now", link: `/batches/${batchId}/exams/${exam._id}` });

  return tasks;
};

// Real work done today towards a task. For a plan day, also whether the
// student ticked it by hand.
const progressOf = async (state, batch, task, plan) => {
  const batchId = batch._id;
  const PracticeAttempt = require("../models/practiceAttemptModel");
  const LectureProgress = require("../models/lectureProgressModel");
  const Submission = require("../models/submissionModel");
  const since = dayStart(state.timezone);
  if (task.kind === "practice") {
    const q = { student: state.student, batch: batchId, createdAt: { $gte: since } };
    if (task.refId) q.topic = task.refId;
    return { progress: await PracticeAttempt.countDocuments(q) };
  }
  if (task.kind === "lecture") {
    return { progress: (await LectureProgress.exists({ student: state.student, lecture: task.refId, completedAt: { $ne: null } })) ? 1 : 0 };
  }
  if (task.kind === "exam") {
    // Done once an attempt is in, or when every attempt is used up (an
    // abandoned one too): "Take" would only lead to an exam with none left.
    if (await Submission.exists({ student: state.student, exam: task.refId, status: { $nin: ["in_progress", "abandoned"] } })) return { progress: 1 };
    const Exam = require("../models/examModel");
    const [exam, used] = await Promise.all([
      Exam.findById(task.refId).select("attemptsAllowed").lean(),
      Submission.countDocuments({ student: state.student, exam: task.refId, status: { $ne: "in_progress" } }),
    ]);
    return { progress: used > 0 && used >= (exam?.attemptsAllowed || 1) ? 1 : 0 };
  }
  if (task.kind === "plan") {
    const day = plan?.days?.find((d) => d.day === task.planDay);
    if (!day) return { progress: 0, gone: true };
    let progress = 0;
    if (day.kind === "lecture") {
      const ids = await liveLectures(day, batch);
      progress = ids.length ? await LectureProgress.countDocuments({ student: state.student, lecture: { $in: ids }, completedAt: { $ne: null } }) : 0;
    } else if (day.kind === "exam") {
      // A self-build exam submitted today. Self-build exams are only
      // recorded as a running score (PracticeExamRecord); older ones were
      // saved as the student's own Exam.
      const Records = require("../models/practiceExamRecordModel");
      const PracticeExamRecord = batch.planArchive ? Records.Archive : Records;
      const Exam = require("../models/examModel");
      const record = await PracticeExamRecord.exists({ student: state.student, batch: batchId, lastAttemptAt: { $gte: since } });
      const own = record ? [] : await Exam.find({ createdByStudent: state.student, createdAt: { $gte: since } }).distinct("_id");
      progress = record || (own.length && (await Submission.exists({ student: state.student, exam: { $in: own }, status: { $nin: ["in_progress", "abandoned"] } }))) ? 1 : 0;
    } else {
      // Different questions from the day's pool answered today, so a
      // recall day only counts recall questions, and answering the same
      // one ten times is still one.
      const pool = await planPool(day, batch);
      progress = pool.length
        ? (await (batch.planArchive ? PracticeAttempt.Archive : PracticeAttempt).distinct("question", { student: state.student, batch: batchId, createdAt: { $gte: since }, question: { $in: pool } })).length
        : 0;
    }
    // Real work ticks the plan day; a hand tick is trusted but isn't work.
    if (progress >= task.target && !day.completed) {
      day.completed = true;
      day.autoDone = true;
      await plan.save();
      const next = plan.days.find((d) => !d.completed);
      const { notify } = require("./notify");
      await notify(state.student, "studyPlanDayDone", {
        title: `Study plan: Day ${day.day} done`,
        body: `${day.focus ? `${day.focus}, ticked from your practice.` : "Ticked from your practice."}${next ? ` Next: Day ${next.day}.` : " That was the last day."}`,
        link: planLink(batch),
      }).catch(() => {});
    }
    return { progress, manual: day.completed && !day.autoDone };
  }
  return { progress: 0 };
};

// Whether a task made earlier today still leads somewhere: content can be
// unpublished, unassigned or closed after the list was made.
const taskValid = async (task, batch, plan, student) => {
  const has = (f) => batch.features?.[f] !== false;
  if (task.kind === "practice") {
    if (!has("practice")) return false;
    return task.refId ? (await practiceableTopics(batch, [task.refId])).has(String(task.refId)) : anyPractice(batch);
  }
  if (task.kind === "lecture") {
    const Lecture = require("../models/lectureModel");
    return has("lectures") && Boolean(await Lecture.exists({ _id: task.refId, batches: batch._id, isPublished: true }));
  }
  if (task.kind === "exam") {
    if (!has("exams")) return false;
    // Taken today: keep it, so it shows as done.
    const Submission = require("../models/submissionModel");
    if (await Submission.exists({ student, exam: task.refId })) return true;
    return (await openExams(student, batch)).some((e) => String(e._id) === String(task.refId));
  }
  if (task.kind === "plan") {
    const day = plan?.days?.find((d) => d.day === task.planDay);
    return Boolean(day) && (day.completed || !day.unavailable);
  }
  return true;
};

// Today's plan with progress; makes the plan on the first look of the day
// and keeps the streak.
const today = async (studentId, batchId, { timezone } = {}) => {
  timezone = validTz(timezone);
  let state = await Tutor.findOne({ student: studentId, batch: batchId });
  if (!state) state = await Tutor.create({ student: studentId, batch: batchId, timezone: timezone || "UTC" });
  if (timezone && timezone !== state.timezone) state.timezone = timezone;
  if (!validTz(state.timezone)) state.timezone = "UTC";
  const key = dayKey(new Date(), state.timezone);
  const batch = (await require("../models/batchModel").findById(batchId).select("features subjects archiveAuthorities").lean()) || { _id: batchId, features: {}, subjects: [] };
  // The plan the tutor follows: the student's pick when the batch has the
  // archive and both plans exist, else whichever plan there is.
  const hasArchive = (batch.archiveAuthorities || []).length > 0;
  const [batchPlan, archivePlan] = await Promise.all([
    loadPlan(studentId, batchId),
    hasArchive ? require("../models/studyPlanModel").Archive.findOne({ student: studentId, batch: batchId }) : null,
  ]);
  const useArchive = Boolean(archivePlan?.days?.length) && (state.planSource === "archive" || !batchPlan?.days?.length);
  const plan = useArchive ? archivePlan : batchPlan;
  if (useArchive) batch.planArchive = true;
  const planChoices = batchPlan?.days?.length && archivePlan?.days?.length ? ["batch", "archive"] : [];
  await syncPlan(studentId, batch, plan, state.timezone).catch(() => {});
  const stamp = plan ? new Date(plan.generatedAt || plan.createdAt) : null;
  const newPlan = String(stamp?.getTime() || "") !== String(state.planStamp?.getTime() || "");
  // An exam date that has passed ends the sprint.
  let sprintEnded = null;
  if (daysUntil(state.sprint?.date, state.timezone) < 0) {
    sprintEnded = state.sprint.label || "your exam";
    state.sprint.date = null;
    state.sprint.exam = null;
    state.sprint.label = "";
    state.day = null;
  }
  // Remake today's list on a new day or plan, or when something on it no
  // longer leads anywhere. Progress is read from real work, so nothing done
  // is lost.
  let stale = false;
  if (state.enabled && state.day === key && !newPlan) {
    for (const t of state.tasks) {
      if (!(await taskValid(t, batch, plan, studentId).catch(() => true))) { stale = true; break; }
    }
  }
  if (state.enabled && (state.day !== key || newPlan || stale)) {
    state.day = key;
    state.planStamp = stamp;
    state.tasks = await buildTasks(state, batch, plan);
  }
  const tasks = [];
  for (const t of state.tasks) {
    const { progress, manual, gone } = await progressOf(state, batch, t, plan);
    if (gone) continue;
    const p = Math.min(progress, t.target);
    // A plan day ticked by hand shows as done; it just doesn't count as work.
    tasks.push({ ...t.toObject(), progress: p, done: p >= t.target || Boolean(manual), manual: Boolean(manual) && p < t.target });
  }
  const allDone = tasks.length > 0 && tasks.every((t) => t.done);
  // The streak needs real work: hand-ticked plan days don't count.
  const worked = allDone && tasks.some((t) => !t.manual);
  if (worked && state.lastCompleteDay !== key) {
    state.streak = state.lastCompleteDay === yesterdayKey(state.timezone) ? state.streak + 1 : 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.lastCompleteDay = key;
  }
  // A missed day ends the streak.
  const alive = state.lastCompleteDay === key || state.lastCompleteDay === yesterdayKey(state.timezone);
  if (!alive && state.streak) state.streak = 0;

  const left = daysUntil(state.sprint?.date, state.timezone);
  const sprint = sprintOn(state);
  const status = planStatus(plan, state.timezone);
  // In a sprint the plan waits; now and then a word about what's piling up.
  let backlog = null;
  if (sprint && status && (status.behind || (status.current && status.current.day < status.today)) && state.lastBacklogWarnDay !== key) {
    const last = state.lastBacklogWarnDay ? Date.parse(state.lastBacklogWarnDay) : 0;
    if (Date.parse(key) - last >= 3 * 86400000) {
      backlog = status.behind;
      state.lastBacklogWarnDay = key;
    }
  } else if (sprint && state.lastBacklogWarnDay === key && status?.behind) {
    backlog = status.behind;
  }
  await state.save();

  const remaining = tasks.filter((t) => !t.done).length;
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  let note = null;
  if (state.enabled) {
    if (allDone) note = `All done today.${state.streak > 1 ? ` ${state.streak} days in a row.` : ""}`;
    else if (sprint) note = `${left === 0 ? "Exam today" : `${n(left, "day")} to ${state.sprint.label || "your exam"}`}. Exam focus: ${n(remaining, "task")} today.`;
    else note = `${n(remaining, "task")} today.${state.streak ? ` Streak: ${n(state.streak, "day")}.` : ""}`;
    if (sprint && state.sprintOutside) note += ` ${n(state.sprintOutside, "topic")} in this exam ${state.sprintOutside === 1 ? "isn't" : "aren't"} in this batch's practice.`;
    if (sprintEnded) note += ` The date for ${sprintEnded} has passed. Set your next exam.`;
    if (backlog) note += ` Study plan: ${n(backlog, "day")} behind. Back to it after the exam.`;
    else if (!sprint && status && (status.behind >= 2 || (status.ended && status.left))) note += ` Study plan: ${status.ended ? "time is up with days left" : `${n(status.behind, "day")} behind`}. Catch up, or make a new plan.`;
  }
  return {
    enabled: state.enabled,
    day: key,
    tasks,
    allDone,
    streak: state.streak,
    bestStreak: state.bestStreak,
    sprint: state.sprint?.date ? { date: state.sprint.date, label: state.sprint.label, examId: state.sprint.exam || null, daysLeft: left } : null,
    sprintEnded,
    sprintOptions: await sprintOptions(state.student, batchId),
    plan: status ? { day: Math.min(status.today, status.last), next: status.current?.day ?? null, of: status.last, behind: status.behind, ended: status.ended, left: status.left, paused: sprint, link: planLink(batch), source: useArchive ? "archive" : "batch" } : null,
    planChoices,
    note,
  };
};

// Exams in this batch the student can still sit: published, not closed,
// attempts left (one in progress counts as still available). For picking
// what to sprint towards; date is when it opens (or closes, for a mock
// already open), null when it has no fixed time.
// Keeps the study plan in step with real work, wherever it's looked at
// (the tutor or the plan page): a lecture day ticks once all its lectures
// are watched, whenever that was, and the current day ticks from today's
// work. A day ticked by hand already counts as done in the tutor.
const syncPlan = async (studentId, batch, plan, tz) => {
  if (!plan?.days?.length) return;
  let changed = false;
  // Days whose questions or lectures are gone (or whose feature was turned
  // off) are flagged, so nothing sends the student to an empty page; the
  // flag clears if the content comes back.
  for (const d of plan.days.filter((x) => !x.completed)) {
    const unavailable = !(await dayAvailable(d, batch));
    if (Boolean(d.unavailable) !== unavailable) { d.unavailable = unavailable; changed = true; }
  }
  const lectureDays = plan.days.filter((d) => d.kind === "lecture" && !d.completed && !d.unavailable);
  if (lectureDays.length) {
    const LectureProgress = require("../models/lectureProgressModel");
    const live = new Map();
    for (const d of lectureDays) live.set(d, await liveLectures(d, batch));
    const ids = [...new Set([...live.values()].flat())];
    const watched = new Set((await LectureProgress.find({ student: studentId, lecture: { $in: ids }, completedAt: { $ne: null } }).distinct("lecture")).map(String));
    for (const d of lectureDays) {
      const lv = live.get(d);
      if (lv.length && lv.every((id) => watched.has(id))) { d.completed = true; d.autoDone = true; changed = true; }
    }
  }
  if (changed) await plan.save();
  const status = planStatus(plan, tz);
  if (status?.current && status.current.kind !== "lecture") {
    await progressOf({ student: studentId, timezone: tz }, batch, await planTask(status.current, status, batch), plan);
  }
};

const sprintOptions = async (studentId, batchId) => {
  const Exam = require("../models/examModel");
  const Submission = require("../models/submissionModel");
  const exams = await Exam.find({ batches: batchId, isPublished: true, isActive: true, createdByStudent: null, offline: null, paperSet: null })
    .select("title mode opensAt liveHours closesAt attemptsAllowed createdAt").sort({ opensAt: 1, createdAt: -1 }).limit(100);
  const finished = await Submission.aggregate([
    { $match: { student: new (require("mongoose").Types.ObjectId)(String(studentId)), exam: { $in: exams.map((e) => e._id) }, status: { $nin: ["in_progress", "abandoned"] } } },
    { $group: { _id: "$exam", n: { $sum: 1 } } },
  ]);
  const used = new Map(finished.map((f) => [String(f._id), f.n]));
  const now = Date.now();
  const out = [];
  for (const e of exams) {
    if ((used.get(String(e._id)) || 0) >= (e.attemptsAllowed || 1)) continue;
    const closes = e.closesAt ? new Date(e.closesAt).getTime() : e.mode === "mock" && e.liveHours ? new Date(e.opensAt || e.createdAt).getTime() + e.liveHours * 3600000 : null;
    if (closes && closes < now) continue;
    const upcoming = e.opensAt && e.opensAt.getTime() > now;
    out.push({ _id: e._id, title: e.title, mode: e.mode, date: upcoming ? e.opensAt : closes ? new Date(closes) : null, open: !upcoming });
  }
  // Dated ones first, soonest first; then the rest.
  return out.sort((a, b) => (a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity));
};

const update = async (studentId, batchId, { enabled, sprintDate, sprintLabel, sprintExamId, planSource }) => {
  const state = (await Tutor.findOne({ student: studentId, batch: batchId })) || new Tutor({ student: studentId, batch: batchId });
  if (!validTz(state.timezone)) state.timezone = "UTC";
  // Picking an exam names the sprint after it and, when the exam has a
  // date and none was given, sprints to that date.
  if (sprintExamId !== undefined) {
    const pick = sprintExamId ? (await sprintOptions(studentId, batchId)).find((o) => String(o._id) === String(sprintExamId)) : null;
    if (sprintExamId && !pick) throw Object.assign(new Error("That exam isn't one you can still take."), { statusCode: 400 });
    state.sprint.exam = pick ? pick._id : null;
    state.day = null; // re-plan around the new exam's topics
    if (pick) {
      sprintLabel = pick.title;
      if (!sprintDate && pick.date) sprintDate = pick.date;
    }
  }
  if (enabled !== undefined) state.enabled = Boolean(enabled);
  if (planSource === "batch" || planSource === "archive") {
    if (state.planSource !== planSource) state.day = null; // re-plan today from the other plan
    state.planSource = planSource;
  }
  if (sprintDate !== undefined) {
    let d = null;
    if (sprintDate) {
      // A typed day ("2026-10-20") is kept at noon UTC, so it reads as the
      // same day in every time zone.
      const typed = /^\d{4}-\d{2}-\d{2}$/.test(String(sprintDate));
      d = new Date(typed ? `${sprintDate}T12:00:00Z` : sprintDate);
      if (Number.isNaN(d.getTime())) throw Object.assign(new Error("That date isn't valid."), { statusCode: 400 });
      if (daysUntil(d, state.timezone) < 0) throw Object.assign(new Error("Pick today or a later date."), { statusCode: 400 });
    }
    state.sprint.date = d;
    state.day = null; // re-plan with the new intensity
  }
  if (sprintLabel !== undefined) state.sprint.label = String(sprintLabel || "").slice(0, 120);
  await state.save();
  return state;
};

// Evening: a reminder to students with tasks left today (once a day).
const eveningNudges = async () => {
  const AiConfig = require("../models/aiConfigModel");
  const Batch = require("../models/batchModel");
  const { notify } = require("./notify");
  const a = (await AiConfig.get()).agents || {};
  if (!a.enabled || !a.tutor?.enabled || a.tutor.eveningNudge === false) return 0;
  const batches = (await Batch.find({ "features.agentTutor": true }).select("_id").lean()).map((b) => b._id);
  let sent = 0;
  for (const state of await Tutor.find({ enabled: true, batch: { $in: batches } })) {
    const key = dayKey(new Date(), state.timezone);
    if (state.day !== key || state.lastNudgeDay === key || state.lastCompleteDay === key) continue;
    const t = await today(state.student, state.batch, {});
    const left = t.tasks.filter((x) => !x.done).length;
    if (!left) continue;
    await notify(state.student, "studyNudge", {
      title: t.streak ? `Keep your ${t.streak}-day streak` : "Tasks left today",
      body: `${left} task${left === 1 ? "" : "s"} left today.`,
      link: `/batches/${state.batch}/tutor`,
    });
    state.lastNudgeDay = key;
    await Tutor.updateOne({ _id: state._id }, { $set: { lastNudgeDay: key } });
    sent += 1;
  }
  return sent;
};

module.exports = { today, update, sprintOptions, eveningNudges, dayKey, dayStart, buildTasks, syncPlan, dayAvailable, validTz };
