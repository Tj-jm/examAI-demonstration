const { z } = require("zod");

// AI checking for assignments: reads a student's hand-in (typed text and
// photos of their work) against the assignment, its rubric and the marking
// notes, and suggests marks and feedback. Only ever a suggestion: staff
// accept, change or ignore it (controllers/admin/courseworkAiController.js,
// and the assignment agent). Self-contained so it only needs the AI
// connection (ai/service.js), not the rest of the AI features.

const IMAGE = /^image\/(png|jpe?g|webp|gif)$/i;

const schema = z.object({
  rubric: z.array(z.object({ marks: z.number().min(0), comment: z.string().max(600) })).max(30).optional(),
  marks: z.number().min(0),
  feedback: z.string().min(1).max(2500),
  reasoning: z.string().max(2500),
});

const buildPrompt = ({ assignment, submission }) => {
  const rubric = assignment.rubric || [];
  const files = submission.files || [];
  const images = files.filter((f) => IMAGE.test(f.type || "") || /\.(png|jpe?g|webp|gif)$/i.test(f.url));
  const others = files.filter((f) => !images.includes(f));
  const system = [
    "You are a fair, careful teacher's assistant marking a student's coursework.",
    "Mark only what the student actually handed in. Do not invent work that isn't there.",
    rubric.length
      ? `Score each rubric row from 0 to that row's marks, in the same order, with a one-line comment each. "marks" is their sum.`
      : `Give one total from 0 to ${assignment.maxMarks}.`,
    "feedback is written to the student: what was done well, what to fix, in plain words, 2 to 6 sentences.",
    "reasoning is for the teacher: why these marks, briefly.",
    "If the hand-in is blank, off-topic or unreadable, give 0 and say so.",
    "Reply in the language the assignment is written in.",
  ].join(" ");
  const prompt = [
    `Assignment: ${assignment.title}`,
    `Maximum marks: ${assignment.maxMarks}`,
    assignment.instructions ? `Instructions:\n${assignment.instructions}` : "",
    rubric.length ? `Rubric (score in this order):\n${rubric.map((r, i) => `${i + 1}. ${r.criterion} (${r.marks} marks)${r.guidance ? ` — ${r.guidance}` : ""}`).join("\n")}` : "",
    assignment.markingNotes ? `Marking notes / model answer (teacher only):\n${assignment.markingNotes}` : "",
    `Student's written answer:\n${submission.text?.trim() || "(none)"}`,
    images.length ? `The student also attached ${images.length} photo(s) of their work, shown with this message in order. Read them.` : "",
    others.length ? `Other files attached but not readable here: ${others.map((f) => f.name || "file").join(", ")}. Mark what you can see and say that these weren't read.` : "",
  ].filter(Boolean).join("\n\n");
  return { system, prompt, imageUrls: images.map((f) => f.url) };
};

// Capped to the rubric (or the maximum): a suggestion can never exceed it.
const reconcile = (assignment, data) => {
  const rows = assignment.rubric || [];
  if (rows.length && Array.isArray(data.rubric) && data.rubric.length === rows.length) {
    const rubricScores = rows.map((row, i) => ({
      marks: Math.min(Math.max(0, Number(data.rubric[i].marks) || 0), row.marks),
      comment: String(data.rubric[i].comment || "").slice(0, 600),
    }));
    return { rubricScores, marks: rubricScores.reduce((s, r) => s + r.marks, 0) };
  }
  return { rubricScores: undefined, marks: Math.min(Math.max(0, Number(data.marks) || 0), assignment.maxMarks) };
};

// Runs the check and stores the suggestion on the hand-in.
const checkSubmission = async ({ assignment, submission, toUrl = (u) => u, by = "check", user = null }) => {
  const ai = require("./service");
  const { system, prompt, imageUrls } = buildPrompt({ assignment, submission });
  const { data } = await ai.generate({
    feature: "assignment-check",
    schema,
    system,
    prompt,
    imageUrls: imageUrls.length ? imageUrls.map(toUrl) : undefined,
    maxTokens: 2000,
    user,
    batch: submission.batch,
    wrapLatex: false,
  });
  const { rubricScores, marks } = reconcile(assignment, data);
  submission.ai = { marks: Math.round(marks * 100) / 100, rubricScores, feedback: data.feedback, reasoning: data.reasoning, by, at: new Date() };
  await submission.save();
  return submission.ai;
};

module.exports = { schema, buildPrompt, reconcile, checkSubmission };
