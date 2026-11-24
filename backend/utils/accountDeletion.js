const crypto = require("crypto");
const mongoose = require("mongoose");
const Student = require("../models/studentModel");
const DeletionRequest = require("../models/deletionRequestModel");

// Erasing a student who asked to be deleted. Personal data goes; records
// the business must keep (payments, AI usage) and ones other students'
// results depend on (exam submissions, for leaderboards and statistics)
// stay, attached to an anonymous "Deleted student".

// Collections that are the student's own and nothing else needs.
const PERSONAL = [
  "ChatThread", "DocChatPack", "Doubt", "StudyPlan", "PracticeAttempt", "CodingDraft", "PracticeExamRecord", "ArchiveExamRecord", "PracticeFavorite", "ArchiveAttempt", "ArchiveFavorite", "ArchiveStudyPlan",
  "LectureProgress", "Notification", "StudentUpload", "SupportTicket", "ConductEvent", "Trial", "AiCredit",
  "LectureAiSummary", "PoraSession", "PoraPack",
  "TutorSession", "TutorPack", "InterviewSession", "InterviewPack",
];

const model = (name) => {
  try {
    return mongoose.model(name);
  } catch {
    return null;
  }
};

const eraseStudent = async (studentId) => {
  // Make sure every model is registered (a job may run before routes load).
  for (const file of ["chatThread", "docChatPack", "doubt", "studyPlan", "practiceAttempt", "codingDraft", "practiceExamRecord", "practiceFavorite",
    "lectureProgress", "notification", "studentUpload", "supportTicket", "conductEvent", "trial", "aiCredit", "exam", "lectureAiSummary", "poraSession", "poraPack", "tutorSession", "tutorPack"]) {
    try { require(`../models/${file}Model`); } catch { /* not in this edition */ }
  }
  for (const name of PERSONAL) {
    const M = model(name);
    if (M) await M.deleteMany({ student: studentId });
  }
  const Exam = model("Exam");
  if (Exam) await Exam.deleteMany({ createdByStudent: studentId });

  await Student.updateOne(
    { _id: studentId },
    {
      $set: {
        name: "Deleted student",
        isActive: false,
        deletedAt: new Date(),
        deletionScheduledFor: null,
        // Unusable password; no session can match.
        password: crypto.randomBytes(32).toString("hex"),
        sessionId: null,
      },
      $unset: { email: 1, phoneNumber: 1, otpHash: 1, otpExpiresAt: 1 },
    }
  );
};

const complete = async (request, userId = null) => {
  await eraseStudent(request.student);
  request.status = "completed";
  request.completedAt = new Date();
  if (userId) request.handledBy = userId;
  await request.save();
};

// Requests whose grace period is over: erased now, or waiting for staff.
const processDue = async () => {
  const AppSettings = require("../models/appSettingsModel");
  const settings = (await AppSettings.get()).accountDeletion || {};
  const due = await DeletionRequest.find({ status: "pending", scheduledFor: { $lte: new Date() } }).limit(200);
  for (const request of due) {
    try {
      if (settings.autoDelete !== false) await complete(request);
      else {
        request.status = "awaiting";
        await request.save();
      }
    } catch (error) {
      console.error(`Account deletion ${request._id}: ${error.message}`);
    }
  }
  return due.length;
};

module.exports = { eraseStudent, complete, processDue, PERSONAL };
