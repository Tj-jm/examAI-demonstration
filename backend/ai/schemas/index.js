const { z } = require("zod");
const { SKILL_TYPE_VALUES } = require("../../utils/skillTypes");

// Optional everywhere it's used below: a schema that predates skillType, or
// a provider that drops an unrecognized-to-it field, should still validate.
const skillType = z.enum(SKILL_TYPE_VALUES).optional();

// Every structured model response is parsed through one of these before it
// goes anywhere near the database. A malformed question reaching the bank is
// the single most likely way generated content becomes a support ticket.

// Document extraction only (see prompts.extractQuestions): where the
// question sits in the source, whether its answer was printed, and which
// page figures belong to it. All optional — generation never sends them, and
// the ingest controller turns them into images/metadata before saving.
const extractionMeta = {
  number: z.string().max(20).optional(),
  answerSource: z.enum(["printed", "solved"]).optional(),
  figure: z.string().max(20).optional(),
  solutionFigure: z.string().max(20).optional(),
};

const mcqOption = z.object({
  key: z.string().min(1).max(4),
  // An option that is only a picture has no text of its own; its figure
  // (below) becomes the option's image.
  text: z.string(),
  figure: z.string().max(20).optional(),
}).refine((o) => o.text.trim() || o.figure, { message: "an option needs text or a figure", path: ["text"] });

const generatedMcq = z
  .object({
    type: z.literal("mcq"),
    question: z.string().min(5),
    options: z.array(mcqOption).min(2).max(8),
    correctOption: z.string().min(1),
    solutionText: z.string().min(1),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
    skillType,
    ...extractionMeta,
  })
  // The check no field-level rule can make: the answer must be one of the
  // options that exist.
  .refine((q) => q.options.some((o) => o.key === q.correctOption), {
    message: "correctOption must match one of the option keys",
    path: ["correctOption"],
  })
  .refine((q) => new Set(q.options.map((o) => o.key)).size === q.options.length, {
    message: "option keys must be unique",
    path: ["options"],
  });

const generatedMtf = z.object({
  type: z.literal("mtf"),
  question: z.string().min(5),
  statements: z
    .array(z.object({ text: z.string().min(1), isTrue: z.boolean() }))
    .min(2)
    .max(8),
  solutionText: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  skillType,
  ...extractionMeta,
});

const generatedWritten = z.object({
  type: z.literal("written"),
  question: z.string().min(5),
  marks: z.number().int().min(1).max(50),
  rubric: z
    .array(
      z.object({
        criterion: z.string().min(1),
        marks: z.number().min(0),
      })
    )
    .min(1),
  modelAnswer: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  skillType,
  // A written part of a passage (utils/questionText.js).
  context: z.string().optional().catch(undefined),
  partLabel: z.string().max(10).optional().catch(undefined),
  group: z.string().max(40).optional().catch(undefined),
  ...extractionMeta,
});

// One sub-question under a passage — shaped like a standalone mcq option-set
// plus its own marks, since that's exactly how questionModel.js's Passage
// discriminator scores it (each sub-question graded independently, see
// submissionModel.js's scoreObjective). No solutionText per sub-question —
// the passage's own top-level solutionText below covers the whole thing,
// same as generatedMcq/Mtf/Written's single solutionText covers theirs.
const generatedPassageMcq = z
  .object({
    type: z.literal("mcq").optional(),
    label: z.string().max(10).optional().catch(undefined),
    question: z.string().min(5),
    options: z.array(mcqOption).min(2).max(6),
    correctOption: z.string().min(1),
    marks: z.number().min(0).max(20).default(1),
  })
  .refine((q) => q.options.some((o) => o.key === q.correctOption), {
    message: "correctOption must match one of the option keys",
    path: ["correctOption"],
  })
  .refine((q) => new Set(q.options.map((o) => o.key)).size === q.options.length, {
    message: "option keys must be unique",
    path: ["options"],
  });

// A written question under a passage: a creative question's ক, খ, গ, ঘ.
const generatedPassageWritten = z.object({
  type: z.literal("written"),
  label: z.string().max(10).optional().catch(undefined),
  question: z.string().min(2),
  marks: z.number().min(0).max(50).default(1),
  modelAnswer: z.string().min(1),
  rubric: z.array(z.object({ criterion: z.string().min(1), marks: z.number().min(0) })).min(1),
});

const generatedPassageSubQuestion = z.union([generatedPassageWritten, generatedPassageMcq]);

// `question` here is the shared passage text itself — reusing the same
// field every other generated type uses for its own prompt, exactly as
// questionModel.js's Passage discriminator reuses the base schema's
// question/questionImage fields rather than adding passageText/Image. A
// passage question can only ever be chapter-pool (no topic) — enforced by
// the caller (aiController.js's generateQuestions), not by this schema.
const generatedPassage = z.object({
  type: z.literal("passage"),
  question: z.string().min(20),
  subQuestions: z.array(generatedPassageSubQuestion).min(1).max(8),
  solutionText: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  skillType,
  group: z.string().max(40).optional().catch(undefined),
  ...extractionMeta,
});

// A plain union rather than discriminatedUnion: the mcq schema carries
// .refine() checks, which hide its shape from the discriminator lookup.
const generatedQuestion = z.union([generatedMcq, generatedMtf, generatedWritten, generatedPassage]);

// Wrapped in an object rather than a bare array: some providers refuse to
// return a top-level array in json mode.
const questionBatch = z.object({
  questions: z.array(generatedQuestion).min(1),
});

// Extraction's own variant of the same shape — no .min(1). A generation
// call always asked for at least one question to invent, so getting zero
// back is a real failure; an extraction call is reporting how many real
// questions actually exist in one chunk of a document, which is
// legitimately zero (a references page, an instructions block, a chunk that
// only contains an answer key). Forcing min(1) there would make "none
// found" indistinguishable from a schema-validation failure, and — worse —
// would pressure a structured-output provider toward fabricating one
// question just to satisfy the shape, exactly what extraction must never do.
// An answer key printed elsewhere in the document ("উত্তরমালা: 1. B 2. C …"),
// matched to questions by number after the whole run (ingestController).
const answerKeyEntry = z.object({ number: z.string().max(20), answer: z.string().max(200) });
// A solution printed away from its question (a solutions section at the end
// of a chapter or book, or one running on from the previous page), matched
// the same way.
const solutionEntry = z.object({
  number: z.string().min(1).max(20),
  answer: z.string().max(500).optional(),
  solutionText: z.string().max(6000).optional(),
  solutionFigure: z.string().max(20).optional(),
}).refine((e) => e.answer || e.solutionText);

const questionBatchExtract = z.object({
  questions: z.array(generatedQuestion),
  answerKey: z.array(answerKeyEntry).optional(),
  solutions: z.array(solutionEntry).optional(),
});

// What extraction actually validates against (questionBatchExtract above is
// still what the provider is constrained with). A chunk of a real paper can
// hold fifteen or twenty questions, and one of them coming back malformed —
// an answer key that doesn't match an option, a one-statement mtf — used to
// reject the whole chunk, so a long paper failed section after section.
// Each question is checked on its own here and only the bad ones are dropped.
const questionBatchExtractLenient = z
  .object({ questions: z.array(z.unknown()), answerKey: z.array(z.unknown()).optional(), solutions: z.array(z.unknown()).optional() })
  .transform(({ questions, answerKey, solutions }) => {
    const results = questions.map((q) => generatedQuestion.safeParse(q));
    return {
      questions: results.filter((r) => r.success).map((r) => r.data),
      dropped: results.filter((r) => !r.success).length,
      answerKey: (answerKey || []).map((e) => answerKeyEntry.safeParse(e)).filter((r) => r.success).map((r) => r.data),
      solutions: (solutions || []).map((e) => solutionEntry.safeParse(e)).filter((r) => r.success).map((r) => r.data),
    };
  });

// Predicted next paper (predictedPaperController.js). Indices out of range
// are dropped server-side, like poolAudit's.
const paperPrediction = z.object({
  summary: z.string().min(1).max(1200),
  topics: z.array(
    z.object({
      index: z.number().int().min(0),
      likelihood: z.enum(["high", "medium", "low"]),
      share: z.number().min(0).max(1),
      reason: z.string().min(1).max(400),
    })
  ),
});

// One archive hint (archiveController's getHint) — short on purpose, a hint
// that runs long is usually one that has started solving.
const hint = z.object({
  hint: z.string().min(1).max(600),
});

const solution = z.object({
  solutionText: z.string().min(1),
});

// A coding question's solution: the idea and the program, joined into one
// solution with a code block by the caller (the model is never trusted to
// write the fences itself).
const codingSolution = z.object({
  idea: z.string().default(""),
  code: z.string().min(1),
});

// A follow-up on a practice question (prompts' practiceFollowUp).
const practiceFollowUp = z.object({
  onTopic: z.boolean(),
  reply: z.string().min(1).max(2000),
});

const explanation = z.object({
  explanation: z.string().min(1).max(1200),
});

const gradedAnswer = z.object({
  // What the model read from the answer photos, written before it marks.
  transcript: z.string().max(6000).optional(),
  // What the photos show (utils/handwriting.js).
  imageSource: z.enum(["handwritten", "printed", "screenshot", "mixed"]).optional().catch(undefined),
  marks: z.number().min(0),
  reasoning: z.string().min(1),
  // Exam marking only: the explanation of the mark for the student, apart
  // from reasoning (which there is for the teacher).
  feedback: z.string().max(2500).optional().catch(undefined),
  // Low confidence is what sorts a teacher's review queue, so the model is
  // asked for it explicitly rather than it being inferred.
  confidence: z.number().min(0).max(1),
  criteriaMet: z.array(z.object({
    criterion: z.string(),
    met: z.boolean(),
    marksAwarded: z.number().min(0),
  })).optional(),
});

// A fix is optional — some issues (ambiguous_wording on a well-formed
// question, say) are worth flagging without the model having to invent a
// rewrite. Shape mirrors the fields updateQuestion actually accepts
// (questionController.js's COMMON/BY_TYPE), so a fix can be handed straight
// to that endpoint's body with no translation step. skillType/difficulty are
// here too (poolAuditFix below has never needed them, so it stays without)
// since a single-question review is exactly where those two get judged.
const qualityReviewFix = z
  .object({
    question: z.string().optional(),
    options: z.array(z.object({ key: z.string().min(1), text: z.string() })).optional(),
    correctOption: z.string().optional(),
    statements: z.array(z.object({ text: z.string(), isTrue: z.boolean() })).optional(),
    skillType,
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  })
  // The check no field-level rule can make, and the one gap that let a
  // useless "Apply fix" through before this was added: a fix that rewrites
  // the options but doesn't say which one is now correct (or names one that
  // isn't in the list) parses fine on its own, then fails validateShape's
  // "Mark which option is correct" check the moment it's actually applied —
  // same shape of bug generatedMcq's own .refine() above already guards
  // against for freshly-generated questions. Rejecting it here instead
  // sends the model back through ai.generate()'s retry loop with the real
  // reason, so either a coherent fix comes back or the review fails loudly
  // — never a fix that looks fine in the UI and then can't be saved.
  .refine((fix) => !fix.options || (fix.correctOption && fix.options.some((o) => o.key === fix.correctOption)), {
    message: "A fix that rewrites the options must also name which one of them is correct.",
    path: ["correctOption"],
  });

const qualityReview = z
  .object({
    issues: z.array(
      z.object({
        kind: z.enum([
          "wrong_answer_key",
          "multiple_valid_answers",
          "ambiguous_wording",
          "no_correct_answer",
          "typo",
          "latex_error",
          "wrong_skill_type",
          "wrong_difficulty",
          "other",
        ]),
        severity: z.enum(["low", "medium", "high"]),
        detail: z.string().min(1),
      })
    ),
    fix: qualityReviewFix.optional(),
  })
  // Unlike ambiguous_wording or a broken premise, a malformed LaTeX string
  // has no judgment call attached — it's mechanical to correct, so there is
  // no legitimate "detail only, no fix" case for it the way there is for the
  // others. Without this, a model that noticed the broken LaTeX but skipped
  // the rewrite still validated fine (fix has always been optional), so the
  // bad-but-flagged question just sat there with nothing for an admin to
  // apply. This routes that gap into ai.generate()'s existing retry loop
  // instead: a violation here becomes a validation error, which gets fed
  // back to the model as "your previous response was rejected: <message>" —
  // the same path a malformed fix.options already took — so the model gets
  // one or two more chances to actually produce the correction before the
  // call gives up and surfaces an error.
  .superRefine((val, ctx) => {
    if (val.issues.some((i) => i.kind === "latex_error") && !val.fix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A latex_error issue was reported with no fix. latex_error must always include a fix — correcting broken LaTeX syntax is mechanical, never a judgment call to skip.",
        path: ["fix"],
      });
    }
  });

// A fix is optional per issue — some issues (ambiguous_wording on a
// well-formed question, say) are worth flagging without the model having to
// invent a rewrite. Shape mirrors the fields updateQuestion actually accepts
// (questionController.js's COMMON/BY_TYPE), so a fix can be handed straight
// to that endpoint's body with no translation step.
const poolAuditFix = z
  .object({
    question: z.string().optional(),
    options: z.array(z.object({ key: z.string().min(1), text: z.string() })).optional(),
    correctOption: z.string().optional(),
    statements: z.array(z.object({ text: z.string(), isTrue: z.boolean() })).optional(),
  })
  // Same gap, same fix as qualityReviewFix above — a rewritten options list
  // with no valid correctOption to match parses fine here, then fails at
  // apply time in QuestionAudit.jsx with no earlier warning.
  .refine((fix) => !fix.options || (fix.correctOption && fix.options.some((o) => o.key === fix.correctOption)), {
    message: "A fix that rewrites the options must also name which one of them is correct.",
    path: ["correctOption"],
  });

// The exam builder's smart-pick (examSmartPick below) and this both refer to
// candidates by their position in a numbered list rather than by id — same
// reasoning here: the model never sees a Mongo _id, so it can't hallucinate
// one into a response the server would then trust.
const poolAuditIssue = z
  .object({
    index: z.number().int().min(0),
    kind: z.enum([
      "wrong_answer_key",
      "multiple_valid_answers",
      "ambiguous_wording",
      "no_correct_answer",
      "typo",
      "latex_error",
      "other",
    ]),
    severity: z.enum(["low", "medium", "high"]),
    detail: z.string().min(1),
    fix: poolAuditFix.optional(),
  })
  // Same reasoning as qualityReview's superRefine above — a latex_error is
  // always mechanically fixable, so "flagged but no fix" is a gap in the
  // response, not a legitimate judgment call. Per-issue here (unlike
  // qualityReview's single shared fix) since a pool audit's fix already
  // lives on the issue it belongs to.
  .superRefine((val, ctx) => {
    if (val.kind === "latex_error" && !val.fix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A latex_error issue was reported with no fix. latex_error must always include a fix — correcting broken LaTeX syntax is mechanical, never a judgment call to skip.",
        path: ["fix"],
      });
    }
  });

const poolAudit = z.object({
  issues: z.array(poolAuditIssue),
  duplicateGroups: z.array(
    z.object({
      // min(1), not min(2): a one-index group would reject the whole audit;
      // the controller already drops groups with fewer than 2 valid questions.
      indices: z.array(z.number().int().min(0)).min(1),
      reason: z.string().min(1),
    })
  ),
});

const misconception = z.object({
  summary: z.string().min(1).max(600),
  likelyMisconception: z.string().min(1),
  suggestedAction: z.string().min(1),
});

// abusive: the model's own judgement that the student's message insults or
// harasses (see utils/conduct.js). Optional — a model that leaves it out
// is read as "no".
const doubtSolution = z.object({
  answer: z.string().min(1),
  abusive: z.boolean().optional(),
});

const lectureSummary = z.object({
  points: z.array(z.string().min(1)).min(2).max(8),
});

// Deliberately a different shape from lectureSummary above (one flowing
// string, not a bullet array) — a student wants two different things: a
// skimmable checklist of the lecture's own notes (points) versus a prose
// recap of whatever's in the lecture's attached files (this one).
const lectureAttachmentSummary = z.object({
  summary: z.string().min(1),
});

const similarQuestions = z.object({
  questions: z.array(generatedMcq).length(5),
});

// mcq/mtf only, no `written` — this becomes a lecture's persisted "Ace this
// lecture" practice set (lectureController.js's generatePracticeQuestions),
// which needs instant self-check grading with no rubric/model-answer review
// step. A count between 3 and 8 rather than similarQuestions' fixed 5: an
// admin picks how many, unlike the fixed 5-question reinforcement modal.
const lecturePracticeQuestions = z.object({
  questions: z.array(z.union([generatedMcq, generatedMtf])).min(3).max(8),
});

// The day-by-day schedule (which topic, which skill, which day) used to be
// the model's job — an index-referenced topic per day, an optional
// self-reported skillType, checked and clamped downstream. That structure
// is now built deterministically in studyPlanController.js instead: weakest
// topic first, split into that topic's own weakest-skill-first subsets,
// with a final all-topics revision day — a schedule that doesn't depend on
// the model reliably reproducing a >100-line JSON array every time. The
// model's only job left is the plan's one-paragraph overview.
// max(320) used to be the display limit itself, sent straight to the
// provider as a maxLength constraint — and a constrained decoder enforces
// that as a hard, mid-word cutoff the instant it hits character 320, no
// matter how much token budget is left. The room here is generation
// headroom, not the display target; the prompt already asks for well under
// 320, and studyPlanController.js trims to a clean sentence boundary before
// storing it, so a model that overshoots still gets tidied up in code
// instead of hard-cut by the provider mid-sentence.
const buildStudyPlanSchema = () =>
  z.object({
    summary: z.string().min(1).max(900),
  });

// A video lesson's script (utils/videoLesson.js): spoken segments, each
// with the board steps shown while it plays. Kept flat (one object shape
// for every board item) so small models follow it.
const videoSegment = z.object({
    say: z.string().min(1).max(1500),
    board: z.array(z.object({
      type: z.enum(["heading", "text", "math", "list", "answer", "image", "table", "highlight", "callout", "newBoard", "pause", "diagram", "clip", "sequence", "remove", "camera", "code", "output", "graph", "numberline"]),
      // graph: curves y = f(x) and points, drawn as the voice speaks;
      // numberline: points (open or filled) and shaded spans on a line.
      fns: z.array(z.object({ expr: z.string().max(120), label: z.string().max(40).nullable().optional() })).max(3).nullable().optional(),
      xRange: z.array(z.number()).length(2).nullable().optional(),
      yRange: z.array(z.number()).length(2).nullable().optional(),
      points: z.array(z.object({ x: z.number(), y: z.number().nullable().optional(), label: z.string().max(40).nullable().optional(), open: z.boolean().nullable().optional() })).max(8).nullable().optional(),
      spans: z.array(z.object({ a: z.number(), b: z.number() })).max(3).nullable().optional(),
      // list: shown as ticks.
      check: z.boolean().nullable().optional(),
      // math: the next step of an earlier line ("S-K"): it takes that line's place.
      from: z.string().max(20).nullable().optional(),
      // clip: lines spoken at set seconds into it (set in the editor).
      lines: z.array(z.object({ at: z.number().min(0).max(600), text: z.string().max(300) })).max(20).nullable().optional(),
      // code: its language.
      lang: z.enum(["c", "cpp", "python", "java", "javascript", "html", "sql"]).nullable().optional(),
      // How it comes on; highlight: how it marks; remove: how it goes;
      // camera: how close (1 to 3).
      enter: z.enum(["fade", "slide", "pop", "zoom", "wipe", "write", "draw", "type", "morph"]).nullable().optional(),
      emphasis: z.enum(["glow", "pulse", "underline", "circle", "arrow", "spotlight", "point"]).nullable().optional(),
      exit: z.enum(["fade", "strike", "cross"]).nullable().optional(),
      zoom: z.number().min(1).max(3).nullable().optional(),
      // image: a part of a listed picture ("r2", from its regions), a crop
      // (set in the editor) and a slow zoom or pan.
      focus: z.string().max(20).nullable().optional(),
      crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable().optional(),
      motion: z.enum(["in", "out", "left", "right"]).nullable().optional(),
      // clip: the voice waits ("pause") or talks over it ("over"); its sound
      // under the voice; seconds its last frame holds.
      voice: z.enum(["pause", "over"]).nullable().optional(),
      duck: z.number().min(0).max(1).nullable().optional(),
      freeze: z.number().min(0).max(10).nullable().optional(),
      // sequence: pictures from the list ("ref") or uploads ("media"), each
      // at its cue.
      frames: z.array(z.object({
        ref: z.string().max(20).nullable().optional(),
        media: z.object({ key: z.string().max(300).nullable(), driver: z.string().max(40).nullable() }).nullable().optional(),
        url: z.string().max(2000).nullable().optional(),
        cue: z.string().max(200).nullable().optional(),
        caption: z.string().max(200).nullable().optional(),
      })).max(12).nullable().optional(),
      loop: z.boolean().nullable().optional(),
      transition: z.enum(["cut", "fade"]).nullable().optional(),
      // diagram: drawn step by step, each step at its cue.
      build: z.boolean().nullable().optional(),
      stepCues: z.array(z.string().max(200)).max(8).nullable().optional(),
      // When it appears: words from this segment's "say"; with: together
      // with the item before.
      cue: z.string().max(200).nullable().optional(),
      with: z.boolean().nullable().optional(),
      // pause: seconds the board holds, and after which sentence.
      seconds: z.number().min(0).max(60).nullable().optional(),
      after: z.string().max(200).nullable().optional(),
      // clip (set in the editor): start in the video, and its own sound on.
      start: z.number().min(0).max(36000).nullable().optional(),
      sound: z.boolean().nullable().optional(),
      // In a part redone by AI: this is the original item number N, kept
      // (its picture, marks or drawing come back with it).
      keep: z.number().int().min(0).max(20).nullable().optional(),
      // diagram: what to draw (the AI drawing is made from it).
      prompt: z.string().max(600).nullable().optional(),
      svg: z.string().max(40000).nullable().optional(),
      // callout: a thought bubble or a labelled note.
      kind: z.enum(["think", "idea", "tip", "warning", "note", "question"]).nullable().optional(),
      text: z.string().max(2000).nullable().optional(),
      latex: z.string().max(600).nullable().optional(),
      items: z.array(z.string().max(300)).max(8).nullable().optional(),
      // image: whose picture, and how it is shown.
      // "library": a picture from the list the prompt gives, by its "ref".
      // "ai": a picture made for you from "prompt".
      src: z.enum(["question", "solution", "upload", "library", "ai"]).nullable().optional(),
      caption: z.string().max(200).nullable().optional(),
      size: z.enum(["small", "medium", "large", "full"]).nullable().optional(),
      fit: z.enum(["contain"]).nullable().optional(),
      // table: rows of cells, the first row is the header.
      rows: z.array(z.array(z.string().max(120)).max(6)).max(8).nullable().optional(),
      // Set in the editor, not by the AI: an uploaded picture, marks drawn
      // over a picture, and which earlier item a highlight points at.
      media: z.object({ key: z.string().max(300).nullable(), driver: z.string().max(40).nullable() }).nullable().optional(),
      marks: z.array(z.object({
        kind: z.enum(["circle", "dashcircle", "oval", "dashoval", "arrow", "double", "dasharrow", "underline", "dashed", "label", "number", "box", "dashbox", "highlight", "dim", "cross", "tick"]),
        x: z.number(), y: z.number(), x2: z.number().nullable().optional(), y2: z.number().nullable().optional(),
        text: z.string().max(120).nullable().optional(),
        old: z.boolean().nullable().optional(),
        color: z.string().max(7).nullable().optional(),
      })).max(40).nullable().optional(),
      ref: z.string().max(20).nullable().optional(),
      // Where the item sits across the board (left when unset).
      align: z.enum(["left", "center", "right"]).nullable().optional(),
      // Set in the editor: beside the item above (one row) instead of below
      // it, and the part of an item a camera zooms onto (x, y, w, h in %).
      row: z.boolean().nullable().optional(),
      // Set in the editor: stays through a new board, until removed.
      keep: z.boolean().nullable().optional(),
      area: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable().optional(),
    })).max(20),
    // This part's board colour and layout (both optional).
    background: z.string().max(20).nullable().optional(),
    layout: z.enum(["stack", "center", "split"]).nullable().optional(),
});
const videoLessonScript = z.object({
  title: z.string().min(1).max(160),
  segments: z.array(videoSegment).min(2).max(40),
});
// One part redone by AI (redo, more detail, shorter…): what replaces it,
// one to four parts.
// A lesson's plan (prompts videoLessonPlan), and its review (videoLessonReview).
const videoLessonPlanSchema = z.object({
  goal: z.string().max(600),
  prior: z.array(z.string().max(300)).max(10).catch([]),
  mistakes: z.array(z.string().max(300)).max(10).catch([]),
  parts: z.array(z.object({ purpose: z.string().max(400), points: z.array(z.string().max(300)).max(10).catch([]) })).min(1).max(40),
});
const videoLessonReviewSchema = z.object({
  issues: z.array(z.object({ index: z.number().int().min(0), problem: z.string().max(600), segment: videoSegment })).max(20),
});
const videoLessonPart = z.object({
  segments: z.array(videoSegment).min(1).max(4),
});
// One part's narration said like a real teacher (videoLessonController
// humanizeSegment): the new "say", and each board item's cue in it.
const videoHumanize = z.object({
  say: z.string().min(1).max(1500),
  cues: z.array(z.object({ n: z.number().int().min(0).max(40), cue: z.string().max(200) })).max(40),
});

// A short video a student asked for (prompts' studentVideoScript).
const studentVideo = z.object({
  onTopic: z.boolean(),
  title: z.string().min(1).max(160),
  segments: z.array(videoSegment).min(1).max(4),
});

// One exam attempt's AI performance report (utils/examReport.js) —
// strengths/weaknesses are allowed to come back empty (an attempt with
// nothing strong, or nothing weak enough to call out, is a real outcome,
// not a model failure), capped at 5 each since this is a short note, not a
// full breakdown of every topic.
const examPerformanceReport = z.object({
  summary: z.string().min(1).max(400),
  strengths: z.array(z.string().min(1).max(160)).max(5),
  weaknesses: z.array(z.string().min(1).max(160)).max(5),
  recommendation: z.string().min(1).max(320),
});

// The "AI skill definer" — same single-question backfill pattern as
// `solution` above (questionController's backfillSkillTypes), classifying
// an already-existing question rather than writing a new one.
//
// Weaker models (small local ones especially) hedge the "pick exactly one"
// instruction by answering with an array of two or three guesses instead of
// a single string — seen in practice from a 3B local model returning
// `["recall","comprehension"]`. That's not garbage, it's a valid answer with
// one extra layer of wrapping, so this unwraps it rather than burning both
// of ai/service.js's retry attempts rejecting an answer that already had the
// right value in it.
const skillTypeSuggestion = z.object({
  skillType: z.preprocess(
    (v) => (Array.isArray(v) ? v[0] : v),
    z.enum(SKILL_TYPE_VALUES)
  ),
});

// The exam builder's smart-pick (ai/prompts/index.js's examSmartPick) —
// same "reference by position, never trust blindly" shape as
// studyPlanTopic.topicIndex above: an index outside the candidate list it
// was actually given is schema-valid (any non-negative int) but meaningless,
// so examController.js drops it rather than trusting it, same reasoning as
// studyPlanController.js's topicIndex filter.
const examSmartPick = z.object({
  picks: z.array(z.number().int().min(0)).min(1),
});

// ai/prompts/index.js's suggestSeoMeta — length bounds are generous
// (search engines truncate, they don't reject), so a model running a few
// characters over its instructed target still parses instead of retrying.
// A site mascot drawn as shape data (utils/mascot.js checks every value
// again before it is kept or shown).
const mascotShape = z.object({
  t: z.enum(["path", "circle", "ellipse", "rect", "polygon", "line"]),
  d: z.string().optional(),
  points: z.string().optional(),
  cx: z.number().optional(),
  cy: z.number().optional(),
  r: z.number().optional(),
  rx: z.number().optional(),
  ry: z.number().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  sw: z.number().optional(),
  cap: z.enum(["round", "butt", "square"]).optional(),
  join: z.enum(["round", "miter", "bevel"]).optional(),
  opacity: z.number().optional(),
});
const mascotCharacter = z.object({
  legs: z.array(mascotShape),
  armL: z.array(mascotShape),
  armR: z.array(mascotShape),
  body: z.array(mascotShape).min(1),
  face: z.array(mascotShape),
  eyes: z.array(mascotShape),
});

const seoMetaSuggestion = z.object({
  metaTitle: z.string().min(1).max(70),
  metaDescription: z.string().min(1).max(200),
  keywords: z.array(z.string().min(1)).min(1).max(10),
});

// ai/prompts/index.js's suggestLectureDescription — one short paragraph, not
// a summary of every section, so a generous cap rather than a tight one:
// long enough to actually say something, short enough it can't turn into a
// second copy of the lecture's own notes.
const lectureDescriptionSuggestion = z.object({
  description: z.string().min(1).max(400),
});

// Document chat (docChatController.js): an answer grounded in numbered
// course excerpts, with the exact lines it relied on. The quotes are checked
// against the excerpts before a student sees them.
const docChatAnswer = z.object({
  answer: z.string(),
  foundInDocuments: z.boolean(),
  citations: z
    .array(
      z.object({
        excerpt: z.number().int().min(1),
        quote: z.string().max(600),
      })
    )
    .max(8)
    .default([]),
  abusive: z.boolean().optional(),
});

// Oral Quiz (poraController.js): one teacher turn, and the end report.
const poraTurn = z.object({
  verdict: z.enum(["none", "correct", "partial", "wrong", "skipped"]).catch("none"),
  marks: z.coerce.number().min(0).max(10).catch(0).optional(),
  feedback: z.string().max(600).default(""),
  next: z.enum(["hint", "followUp", "question", "finish"]),
  say: z.string().min(1).max(800),
  excerpt: z.coerce.number().int().min(0).catch(0).optional(),
  quote: z.string().max(600).default(""),
});

const tutorTurn = poraTurn.extend({
  say: z.string().min(1).max(1200),
  wrongPart: z.string().max(300).default(""),
});

const tutorPaper = z.object({
  stimulus: z.string().min(1).max(1500),
  parts: z.array(z.object({ question: z.string().min(1).max(600), answer: z.string().max(1500).default("") })).length(4),
});

const tutorMark = z.object({
  got: z.coerce.number().min(0).max(10).catch(0),
  feedback: z.string().max(600).default(""),
  wrongPart: z.string().max(300).default(""),
});

// Interview practice (interviewController.js).
const interviewTurn = z.object({
  verdict: z.enum(["none", "strong", "ok", "weak", "skipped"]).catch("none"),
  marks: z.coerce.number().min(0).max(10).catch(0).optional(),
  feedback: z.string().max(400).default(""),
  next: z.enum(["followUp", "question", "finish"]),
  by: z.coerce.number().int().min(0).max(2).catch(0),
  say: z.string().min(1).max(900),
});
const interviewReport = z.object({
  criteria: z.array(z.object({ name: z.string().max(60), score: z.coerce.number().min(0).max(10) })).max(8).default([]),
  strengths: z.array(z.string().max(220)).max(3).default([]),
  weaknesses: z.array(z.string().max(220)).max(4).default([]),
  tips: z.array(z.string().max(220)).max(4).default([]),
  better: z.object({ question: z.string().max(600).default(""), answer: z.string().max(1500).default("") }).default({ question: "", answer: "" }),
  remark: z.string().max(300).default(""),
});
const interviewDraft = z.object({
  title: z.string().min(1).max(120),
  kind: z.enum(["viva", "admission", "job", "scholarship", "other"]).catch("other"),
  brief: z.string().max(2000).default(""),
  interviewers: z.array(z.object({ name: z.string().max(40), role: z.string().max(60), style: z.string().max(200) })).min(1).max(3),
  criteria: z.array(z.string().max(60)).min(2).max(6),
  mustAsk: z.array(z.string().max(300)).max(6).default([]),
});

const poraReport = z.object({
  criteria: z.array(z.object({ name: z.string().max(40), score: z.coerce.number().min(0).max(5) })).max(6).default([]),
  strengths: z.array(z.string().max(200)).max(3).default([]),
  weaknesses: z.array(z.string().max(200)).max(4).default([]),
  remark: z.string().max(300).default(""),
});

module.exports = {
  videoLessonPlanSchema,
  videoLessonReviewSchema,
  interviewTurn,
  interviewReport,
  interviewDraft,
  poraTurn,
  poraReport,
  tutorTurn,
  tutorPaper,
  tutorMark,
  docChatAnswer,
  generatedMcq,
  generatedMtf,
  generatedWritten,
  generatedPassage,
  generatedQuestion,
  questionBatch,
  paperPrediction,
  hint,
  questionBatchExtract,
  questionBatchExtractLenient,
  solution,
  codingSolution,
  explanation,
  practiceFollowUp,
  gradedAnswer,
  qualityReview,
  poolAudit,
  lectureDescriptionSuggestion,
  misconception,
  doubtSolution,
  lectureSummary,
  lectureAttachmentSummary,
  similarQuestions,
  lecturePracticeQuestions,
  buildStudyPlanSchema,
  videoLessonScript,
  videoLessonPart,
  videoHumanize,
  studentVideo,
  examPerformanceReport,
  examSmartPick,
  skillTypeSuggestion,
  seoMetaSuggestion,
  mascotCharacter,
};
