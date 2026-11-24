const asyncHandler = require("express-async-handler");
const ChatThread = require("../../models/chatThreadModel");

//@desc   Recent questions students asked the course documents — by default
//        only the ones the documents couldn't answer, which is a list of
//        what the lecture notes are missing.
//@route  GET /api/ai/doc-chat/questions?all=true&batch=
//@access Private (owner/admin/teacher)
const getDocChatQuestions = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.batch) filter.batch = req.query.batch;
  if (req.query.all !== "true") filter.unanswered = { $gt: 0 };

  const threads = await ChatThread.find(filter)
    .sort({ updatedAt: -1 })
    .limit(100)
    .populate("batch", "name")
    .populate("lecture", "title")
    .populate("student", "name");

  const rows = [];
  for (const thread of threads) {
    thread.messages.forEach((m, i) => {
      if (m.role !== "student") return;
      const reply = thread.messages[i + 1];
      if (!reply || reply.role !== "assistant") return;
      if (req.query.all !== "true" && reply.foundInDocuments) return;
      rows.push({
        threadId: thread._id,
        at: m.at,
        question: m.text,
        answer: reply.text,
        foundInDocuments: Boolean(reply.foundInDocuments),
        generalAnswer: Boolean(reply.generalAnswer),
        citations: reply.citations || [],
        batch: thread.batch,
        lecture: thread.lecture,
        student: thread.student ? { _id: thread.student._id, name: thread.student.name } : null,
      });
    });
  }
  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  res.status(200).json({ questions: rows.slice(0, 200) });
});

module.exports = { getDocChatQuestions };
