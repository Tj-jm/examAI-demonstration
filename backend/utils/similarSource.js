// "Practice 5 similar": AI writes five questions like the one shown.

// Whether "Practice 5 similar" is offered for this question.
const offered = async () => true;

// The similar questions for one student request. `ai` makes them (a
// function returning { questions }).
const similarFor = async ({ ai }) => ({ ...(await ai()), source: "ai" });

module.exports = { offered, similarFor };
