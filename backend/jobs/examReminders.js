const cron = require("node-cron");
const shared = require("../utils/shared");
const Exam = require("../models/examModel");
const ExamSetGroup = require("../models/examSetGroupModel");
const Batch = require("../models/batchModel");
const { getActiveBatchStudentIds } = require("../utils/batchMembers");
const { notify } = require("../utils/notify");

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Polling every CHECK_INTERVAL rather than scheduling a precise one-shot per
// exam — every tick asks "is any exam's opensAt now inside a reminder
// window that hasn't been sent for THIS opensAt yet". That's what makes it
// self-healing: a missed tick (server restart, a slow deploy) is caught on
// the next one, as long as opensAt hasn't passed entirely by then — and
// what makes editing an exam's schedule "just work": sentFor is compared
// against opensAt's current value, not a plain boolean, so moving the
// schedule re-arms both reminders with no separate reset needed anywhere.
const CHECK_INTERVAL = "*/10 * * * *";

const sentForMatches = (sentFor, opensAt) => Boolean(sentFor) && sentFor.getTime() === opensAt.getTime();

const checkExamReminders = async () => {
  const now = Date.now();

  // Same exclusion as the grading queue and submissions browse — a
  // student's own custom-built practice exam has no fixed audience to
  // remind, and createdByStudent is how those are told apart from an
  // authored one (see examController.js's getExams).
  const exams = await Exam.find({
    isPublished: true,
    isActive: true,
    createdByStudent: null,
    opensAt: { $gt: new Date(now), $lte: new Date(now + ONE_DAY_MS) },
    batches: { $exists: true, $ne: [] },
  }).select("title opensAt batches reminders paperSet");

  // Paper sets (utils/examSets.js): the sets of one group that open at the
  // same time send one reminder, under the group's title, linking to the
  // group (which opens the student's own set).
  const setGroups = new Map(
    (await ExamSetGroup.find({ _id: { $in: exams.filter((e) => e.paperSet?.group).map((e) => e.paperSet.group) } }).select("title").lean())
      .map((g) => [String(g._id), g])
  );
  const sentWindows = new Set();

  for (const exam of exams) {
    let title = exam.title;
    let linkId = exam._id;
    let skip = false;
    if (exam.paperSet?.group) {
      const group = setGroups.get(String(exam.paperSet.group));
      const windowKey = `${exam.paperSet.group}:${exam.opensAt.getTime()}`;
      skip = !group || sentWindows.has(windowKey);
      sentWindows.add(windowKey);
      title = group?.title || title;
      linkId = exam.paperSet.group;
    }

    const msUntil = exam.opensAt.getTime() - now;
    const dueDay = msUntil <= ONE_DAY_MS && !sentForMatches(exam.reminders?.oneDaySentFor, exam.opensAt);
    const dueHour = msUntil <= ONE_HOUR_MS && !sentForMatches(exam.reminders?.oneHourSentFor, exam.opensAt);

    if (!dueDay && !dueHour) continue;
    if (skip) {
      exam.reminders = {
        oneDaySentFor: dueDay ? exam.opensAt : exam.reminders?.oneDaySentFor || null,
        oneHourSentFor: dueHour ? exam.opensAt : exam.reminders?.oneHourSentFor || null,
      };
      await exam.save();
      continue;
    }

    // Only batches that still have the exams feature on — a batch that
    // turned it off since this exam was assigned shouldn't have its
    // students pinged about something they can no longer open.
    const batches = await Batch.find({ _id: { $in: exam.batches }, "features.exams": true }).select("_id");

    for (const batch of batches) {
      const studentIds = await getActiveBatchStudentIds(batch._id);
      if (studentIds.length === 0) continue;

      // A multi-batch exam links each recipient to the exam within THEIR
      // OWN batch — one notify() call per batch rather than merging
      // audiences, since the link's batchId has to be one they actually
      // have access to.
      if (dueHour) {
        await notify(studentIds, "examReminder", {
          title: "Exam starting soon",
          body: `${title} opens in about an hour.`,
          link: `/batches/${batch._id}/exams/${linkId}`,
        });
      }
      if (dueDay) {
        await notify(studentIds, "examReminder", {
          title: "Exam tomorrow",
          body: `${title} opens in about a day.`,
          link: `/batches/${batch._id}/exams/${linkId}`,
        });
      }
    }

    // Reassigned wholesale, not `exam.reminders.oneDaySentFor = ...` —
    // Mongoose doesn't track a mutation 2+ levels deep on a plain nested
    // schema (see the field's own comment in examModel.js).
    exam.reminders = {
      oneDaySentFor: dueDay ? exam.opensAt : exam.reminders?.oneDaySentFor || null,
      oneHourSentFor: dueHour ? exam.opensAt : exam.reminders?.oneHourSentFor || null,
    };
    await exam.save();
  }
};

// Called once from server.js — never from app.js, which tests also require
// directly (via supertest) without wanting a real timer running in the
// background during a test run.
// With several servers (Pro with Redis), each run is claimed by one of them
// only, so nobody gets the same reminder twice.
const runChecked = () =>
  shared
    .runOnce("examReminders", 5 * 60 * 1000, checkExamReminders)
    .catch((err) => console.error("Exam reminders check failed:", err));

const start = () => {
  runChecked();
  cron.schedule(CHECK_INTERVAL, runChecked);
};

module.exports = { start, checkExamReminders };
