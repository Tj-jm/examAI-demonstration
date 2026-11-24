const AppSettings = require("../models/appSettingsModel");
const User = require("../models/userModel");

// Who may grade what, and who gets paid for it. Settings → Grading:
//
//   payMode "question": pay counts graded answers. Anyone on the batch may
//     pick up a part-marked script's remaining answers.
//   payMode "script": pay counts finished scripts. The first grader to save
//     a mark holds the script until it's finished or an admin reopens it.
//
// In both modes an answer someone has marked is theirs: another grader
// can't change it (an admin can, or reopens the script). An admin can also
// assign a script to one grader. A regrade goes to whoever it was sent to
// (by default the first marker) for regradeHours, then to anyone on the
// batch. Credit stays with the first marker unless someone else does the
// regrade.

const DEFAULTS = { payMode: "question", ratePerQuestion: 0, ratePerScript: 0, stuckHours: 24, regradeHours: 48 };

const gradingSettings = async () => {
  const s = await AppSettings.get();
  const g = s.grading?.toObject?.() || s.grading || {};
  return { ...DEFAULTS, ...Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined && v !== null)) };
};

const isPrivileged = (user) => ["owner", "admin"].includes(user?.role);
const sameId = (a, b) => Boolean(a) && Boolean(b) && String(a._id || a) === String(b._id || b);

// Still able to grade this batch: active, not deleted, and on its staff
// (owners and admins always are). `user` must carry role/isActive/isDeleted.
const canStillGrade = (user, batchDoc) =>
  Boolean(user && user._id) && !user.isDeleted && user.isActive !== false &&
  (isPrivileged(user) || Boolean(batchDoc?.hasGradingStaff?.(user._id)));

const USER_FIELDS = "name identifier role isActive isDeleted";

// The person holding a script, if that hold still counts. heldBy must be
// populated with USER_FIELDS.
const holderOf = (submission, batchDoc) =>
  submission.heldBy && submission.heldBy._id && canStillGrade(submission.heldBy, batchDoc) ? submission.heldBy : null;

const isRegrade = (submission) => Boolean(submission.referral?.requested && submission.referral?.decision === "approved");

// Who a regraded answer is reserved for right now, or null when anyone on
// the batch may do it. Needs referral.routeTo and answers.regradeOf.by
// populated with USER_FIELDS.
const regradeTarget = (submission, answer, batchDoc, now = new Date()) => {
  if (!isRegrade(submission) || answer.questionType !== "written") return null;
  const referred = new Set((submission.referral.questionIds || []).map(String));
  if (!referred.has(String(answer.question))) return null;
  const r = submission.referral;
  if (r.routeMode === "pool") return null;
  if (r.routeUntil && new Date(r.routeUntil) <= now) return null;
  const target = r.routeMode === "grader" ? r.routeTo : answer.regradeOf?.by;
  if (!target || !target._id) return null;
  return canStillGrade(target, batchDoc) ? target : null;
};

const markedByPerson = (a) => a.questionType === "written" && a.marksAwarded !== null && a.marksAwarded !== undefined;
const pendingWritten = (a) => a.questionType === "written" && (a.marksAwarded === null || a.marksAwarded === undefined);

// Part-marked: some written answers have marks, some don't.
const isPartial = (submission) => {
  const written = submission.answers.filter((a) => a.questionType === "written");
  return written.some(markedByPerson) && written.some(pendingWritten);
};

// The last time anyone marked something here: progressAt, or for scripts
// marked before that field existed, the newest answer mark.
const lastProgress = (submission) => {
  if (submission.progressAt) return new Date(submission.progressAt);
  const times = submission.answers.map((a) => a.gradedAt).filter(Boolean).map((d) => new Date(d).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
};

const isStuck = (submission, stuckHours, now = new Date()) => {
  if (submission.status !== "grading" || !isPartial(submission)) return false;
  const last = lastProgress(submission);
  return Boolean(last) && now - last >= stuckHours * 3600 * 1000;
};

// Scripts matching `base` whose marking state passes `test` (partial,
// stuck, untouched): worked out here rather than in the query so it runs
// the same on every MongoDB-compatible database. The grading queue is
// hundreds of scripts, not millions.
const SCAN_FIELDS = "status progressAt answers.questionType answers.marksAwarded answers.gradedAt";
const idsWhere = async (base, test, limit = 5000) => {
  const Submission = require("../models/submissionModel");
  const rows = await Submission.find(base).select(SCAN_FIELDS).limit(limit).lean();
  return rows.filter(test).map((r) => r._id);
};
const isUntouched = (s) => !s.answers.some(markedByPerson);

// Throw away the marking done so far and put the script back: to anyone
// on the batch, or held for one grader. AI suggestions stay, so whoever
// picks it up starts from them. During a regrade only the referred answers
// reopen; the rest of the paper keeps its marks.
const reopenScript = (submission, { graderId = null, now = new Date() } = {}) => {
  const referred = isRegrade(submission) ? new Set((submission.referral.questionIds || []).map(String)) : null;
  let cleared = 0;
  for (const a of submission.answers) {
    if (a.questionType !== "written") continue;
    if (referred && !referred.has(String(a.question))) continue;
    // A blank answer stays at its automatic 0: there's nothing to mark.
    const blank = !(typeof a.answerText === "string" && a.answerText.trim())
      && !(a.answerImages || []).some((u) => typeof u === "string" && u.trim());
    if (blank) {
      a.marksAwarded = 0;
      a.gradedBy = "auto";
      continue;
    }
    if (a.marksAwarded !== null && a.marksAwarded !== undefined) cleared += 1;
    a.marksAwarded = null;
    a.gradedBy = null;
    // Outside a regrade nobody keeps credit for thrown-away work. In one,
    // the first marker's credit (regradeOf) is theirs to keep.
    if (!referred || !a.regradeOf?.by) { a.gradedByUser = null; a.gradedAt = null; }
    a.teacherComment = undefined;
    a.annotatedImage = null;
    if (referred) a.regradeReviewed = false;
  }
  submission.status = "grading";
  submission.claimedBy = null;
  submission.claimedAt = null;
  submission.heldBy = graderId || null;
  submission.heldSince = graderId ? now : null;
  submission.heldAssigned = Boolean(graderId);
  submission.progressAt = null;
  if (referred && graderId) {
    submission.referral.routeMode = "grader";
    submission.referral.routeTo = graderId;
  } else if (referred) {
    submission.referral.routeMode = "pool";
    submission.referral.routeTo = null;
  }
  return cleared;
};

// A grader an admin may hand a script or regrade to: active, on the batch.
const assertAssignable = async (graderId, batchDoc) => {
  const staff = await User.findById(graderId).select(USER_FIELDS);
  return staff && canStillGrade(staff, batchDoc) ? staff : null;
};

module.exports = {
  DEFAULTS, USER_FIELDS, gradingSettings, isPrivileged, sameId, canStillGrade, holderOf, isRegrade, regradeTarget,
  isPartial, lastProgress, isStuck, isUntouched, idsWhere, reopenScript, assertAssignable,
};
