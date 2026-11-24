const { Question } = require("../models/questionModel");

// The practice pickers choose from a whole topic's pool but only serve a
// handful. They query the pool as bare ids (`.select("_id type").lean()`),
// choose, and then load only the chosen questions here. Returns them in the
// order given; an id that no longer exists is dropped.
const loadQuestionsInOrder = async (ids) => {
  if (ids.length === 0) return [];
  const docs = await Question.find({ _id: { $in: ids } });
  const byId = new Map(docs.map((q) => [String(q._id), q]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
};

module.exports = { loadQuestionsInOrder };
