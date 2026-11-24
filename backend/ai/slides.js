const { z } = require("zod");

// Lecture slides with AI (controllers/admin/slideController.js): an outline
// from the source material, the slides from an approved outline, and one
// slide rewritten on request. Facts come from the material; the model
// arranges them for teaching.

const JSON_ONLY = "Return only a single JSON object. No prose, no markdown fences, no explanation before or after.";
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const LANGUAGES = { en: "English", bn: "Bangla (Bengali script)", hi: "Hindi (Devanagari script)", ar: "Arabic", ur: "Urdu", es: "Spanish", fr: "French" };
const lang = (l) => (LANGUAGES[l] && l !== "en" ? `Write in ${LANGUAGES[l]}. Keep numbers, units, formulas, code and names as they are.` : "Write in English.");
const LAYOUTS = ["title", "section", "bullets", "twoCol", "imageText", "quote", "code", "quiz"];
const RULES = [
  "Slides are for a teacher lecturing a class: short bullet phrases (under 14 words each), 3 to 6 bullets a slide, never paragraphs.",
  "Maths in LaTeX inside $...$. No emoji, no hype words, no exclamation marks.",
  "Use only facts from the material and standard textbook knowledge of the subject. Never invent statistics, dates or quotes.",
].join(" ");

const LAYOUT_HELP = `Layouts:
- title: first slide only. title, subtitle.
- section: a divider between parts. title, subtitle.
- bullets: title, bullets.
- twoCol: a comparison. title, leftTitle, left (bullets), rightTitle, right (bullets).
- imageText: title, bullets, imagePrompt (one sentence describing a diagram or picture that would help).
- quote: a definition, law or key statement. quote, by (source or law name).
- code: title, code, codeLang (python, javascript, c, cpp, java, ...). Only for programming topics.
- quiz: a check-your-understanding question. quiz { question, options (4), answer (0-based index) }. If a numbered bank question fits, set bank to its number instead and leave quiz empty.`;

const materialBlock = ({ material, bank = [] }) => `Material:
"""
${clip(material, 40000) || "(none: use standard textbook knowledge of the title)"}
"""
${bank.length ? `\nQuestion bank (for quiz slides):\n${bank.map((q, i) => `${i + 1}. ${clip(q.question, 300)} | ${q.options.map((o, j) => `${"ABCDEF"[j]}) ${clip(o, 80)}`).join(" ")} | answer ${"ABCDEF"[q.answer]}`).join("\n")}\n` : ""}`;

const slideShape = z.object({
  layout: z.enum(LAYOUTS).catch("bullets"),
  title: z.string().max(300).optional().default(""),
  subtitle: z.string().max(300).optional().default(""),
  bullets: z.array(z.string().max(400)).max(10).optional().default([]),
  leftTitle: z.string().max(200).optional().default(""),
  rightTitle: z.string().max(200).optional().default(""),
  left: z.array(z.string().max(400)).max(8).optional().default([]),
  right: z.array(z.string().max(400)).max(8).optional().default([]),
  imagePrompt: z.string().max(500).optional().default(""),
  code: z.string().max(6000).optional().default(""),
  codeLang: z.string().max(30).optional().default(""),
  quote: z.string().max(1000).optional().default(""),
  by: z.string().max(200).optional().default(""),
  quiz: z.object({
    question: z.string().max(2000).optional().default(""),
    options: z.array(z.string().max(500)).max(6).optional().default([]),
    answer: z.number().int().min(0).max(5).optional().default(0),
  }).optional(),
  bank: z.number().int().optional(),
  notes: z.string().max(5000).optional().default(""),
});

const outline = {
  schema: z.object({
    title: z.string().max(200),
    outline: z.array(z.object({
      title: z.string().min(1).max(300),
      points: z.array(z.string().max(300)).max(8).default([]),
      layout: z.enum(LAYOUTS).catch("bullets"),
    })).min(2).max(45),
  }),
  build: ({ title, brief, count, material, bank, language }) => ({
    system: ["You plan lecture slide decks for teachers.", RULES, lang(language), JSON_ONLY].join(" "),
    prompt: `Lecture: ${clip(title, 200) || "(name it from the material)"}
${brief ? `Teacher's brief: ${clip(brief, 800)}\n` : ""}About ${count} slides, including a title slide first and a short summary slide last. Put a quiz slide after each main part when it fits.

${LAYOUT_HELP}

${materialBlock({ material, bank })}
Plan the deck: for each slide a title, 2-5 short points it will cover, and its layout.

Shape:
{ "title": "deck title", "outline": [ { "title": "...", "points": ["..."], "layout": "bullets" } ] }`,
  }),
};

const slides = {
  schema: z.object({ slides: z.array(slideShape).min(1).max(45) }),
  build: ({ title, brief, outline: plan, material, bank, language }) => ({
    system: ["You write lecture slides and speaker notes for teachers.", RULES, lang(language), JSON_ONLY].join(" "),
    prompt: `Lecture: ${clip(title, 200)}
${brief ? `Teacher's brief: ${clip(brief, 800)}\n` : ""}
Approved outline (one slide each, in this order, same layouts):
${plan.map((s, i) => `${i + 1}. [${s.layout}] ${clip(s.title, 200)}${s.points?.length ? ` — ${s.points.map((p) => clip(p, 200)).join("; ")}` : ""}`).join("\n")}

${LAYOUT_HELP}

${materialBlock({ material, bank })}
Write every slide. notes: what the teacher says on that slide, 2-5 sentences, with an example or a question to ask the class.

Shape:
{ "slides": [ { "layout": "bullets", "title": "...", "bullets": ["..."], "notes": "..." } ] }`,
  }),
};

const rewrite = {
  schema: z.object({ slide: slideShape }),
  build: ({ title, slide, ask, material, language }) => ({
    system: ["You improve one lecture slide for a teacher.", RULES, lang(language), JSON_ONLY].join(" "),
    prompt: `Lecture: ${clip(title, 200)}
Current slide (JSON):
${JSON.stringify(slide).slice(0, 8000)}

Teacher asks: ${clip(ask, 600) || "Make it clearer and tighter."}

${LAYOUT_HELP}

${material ? `${materialBlock({ material: clip(material, 12000) })}\n` : ""}Return the whole slide, changed as asked. Keep its layout unless the teacher asks for another.

Shape:
{ "slide": { "layout": "...", "title": "...", ... , "notes": "..." } }`,
  }),
};

const TASKS = { outline, slides, rewrite };
const slideTask = (task, input) => {
  const t = TASKS[task];
  if (!t) throw Object.assign(new Error("Unknown slides task."), { statusCode: 400 });
  return { schema: t.schema, ...t.build(input) };
};

module.exports = { slideTask, SLIDE_LANGUAGES: Object.keys(LANGUAGES) };
