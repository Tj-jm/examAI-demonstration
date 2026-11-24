// What happens to extracted questions between the model and the database —
// the checks that don't need the model or the database, kept apart from the
// controller so they can be tested on their own.

const { hasBijoyResidue } = require("./bijoy");
const { stripFigureMarkers } = require("./figures");

// Every text field a question can carry, for the passes below.
const textFields = (q) => [
  q.question,
  q.solutionText,
  q.modelAnswer,
  ...(q.options || []).map((o) => o.text),
  ...(q.statements || []).map((s) => s.text),
  ...(q.rubric || []).map((r) => r.criterion),
  ...(q.subQuestions || []).flatMap((sq) => [sq.question, ...(sq.options || []).map((o) => o.text)]),
];

// A copy of a question with fn applied to every student-facing text field.
const mapText = (q, fn) => ({
  ...q,
  question: fn(q.question),
  ...(q.solutionText !== undefined && { solutionText: fn(q.solutionText) }),
  ...(q.modelAnswer !== undefined && { modelAnswer: fn(q.modelAnswer) }),
  ...(q.options && { options: q.options.map((o) => ({ ...o, text: fn(o.text) })) }),
  ...(q.statements && { statements: q.statements.map((s) => ({ ...s, text: fn(s.text) })) }),
  ...(q.rubric && { rubric: q.rubric.map((r) => ({ ...r, criterion: fn(r.criterion) })) }),
  ...(q.subQuestions && {
    subQuestions: q.subQuestions.map((sq) => ({
      ...sq,
      question: fn(sq.question),
      ...(sq.modelAnswer !== undefined && { modelAnswer: fn(sq.modelAnswer) }),
      options: (sq.options || []).map((o) => ({ ...o, text: fn(o.text) })),
    })),
  }),
});

// [FIGURE …] markers are pipeline plumbing; the figure itself is attached as
// an image, so no student ever sees the marker text.
const stripMarkers = (q) => mapText(q, stripFigureMarkers);

// Unconverted Bijoy text anywhere in a question — never worth a reviewer's
// time, and never shown to a student.
const isGarbled = (q) => textFields(q).some((t) => hasBijoyResidue(t));

// "Q07", "০৭", "7." and "7" are the same question number.
const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";
const normalizeNumber = (n) =>
  String(n || "")
    .replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(?:q|question)/, "")
    .replace(/^0+(?=\d)/, "");

const BANGLA_OPTION_LETTERS = ["ক", "খ", "গ", "ঘ", "ঙ", "চ"];

// Which option an answer-key entry means: its own key ("B", "(b)"), a Bangla
// letter (ক = 1st), or a Latin letter by position when the keys are Bangla.
const optionFor = (answer, options) => {
  const raw = String(answer || "").trim().replace(/^[([]|[)\].:]$/g, "").trim();
  if (!raw) return null;
  const direct = options.find((o) => o.key.toLowerCase() === raw.toLowerCase());
  if (direct) return direct.key;
  const bn = BANGLA_OPTION_LETTERS.indexOf(raw);
  if (bn >= 0 && options[bn]) return options[bn].key;
  const latin = "abcdef".indexOf(raw.toLowerCase());
  if (raw.length === 1 && latin >= 0 && options[latin]) return options[latin].key;
  return null;
};

// An answer key printed on another page ("উত্তরমালা") fills in MCQs whose
// answer the model had to work out itself. Numbers that appear twice in the
// key (a book restarting its numbering per chapter) are ambiguous and skipped
// rather than guessed. → number of answers taken from the key.
const applyAnswerKey = (questions, entries) => {
  const byNumber = new Map();
  const conflicting = new Set();
  for (const e of entries || []) {
    const n = normalizeNumber(e.number);
    if (!n) continue;
    if (byNumber.has(n) && byNumber.get(n) !== e.answer) conflicting.add(n);
    byNumber.set(n, e.answer);
  }

  let applied = 0;
  for (const q of questions) {
    if (q.type !== "mcq" || q.answerSource === "printed") continue;
    const n = normalizeNumber(q.number);
    if (!n || conflicting.has(n) || !byNumber.has(n)) continue;
    const key = optionFor(byNumber.get(n), q.options || []);
    if (!key) continue;
    q.correctOption = key;
    q.answerSource = "printed";
    applied += 1;
  }
  return applied;
};

// Solutions printed away from their questions — a "Solutions" section at the
// end of a chapter or the book, or a solution running on to the next page —
// fill in questions whose answer the model had to work out itself.
// Numbering restarts per chapter, so questions and solutions are split into
// runs (a new run where the number stops going up) and whole runs are paired:
// by the values a question and its solution share ("2 m", "25.2"), or, when
// those don't decide and there are as many runs of each, in order. A run
// that can't be paired with confidence is left alone and its questions keep
// the AI's solution, with a note. Questions and solutions carry _order (the
// step they came from) and _page; a solution is never paired with a question
// read after it. Notes go to q._notes. → { matched, unclear }.
const runsOf = (items) => {
  const runs = [];
  let run = null;
  let last = -Infinity;
  for (const item of items) {
    const n = normalizeNumber(item.number);
    if (!n) continue;
    const value = parseInt(n, 10);
    const restarts = !run || run.byNumber.has(n) || (Number.isFinite(value) && value <= last);
    if (restarts) {
      run = { items: [], byNumber: new Map(), order: item._order ?? 0 };
      runs.push(run);
    }
    run.items.push(item);
    run.byNumber.set(n, item);
    if (Number.isFinite(value)) last = value;
  }
  return runs;
};

const valuesIn = (text) => new Set((String(text || "").match(/\d+(?:\.\d+)?/g) || []).filter((v) => v.length >= 2 || v.includes(".")));
const questionValues = (q) => valuesIn(textFields(q).join(" "));

// How strongly a run of solutions belongs to a run of questions: shared
// values between same-numbered pairs.
const runScore = (qRun, sRun) => {
  let score = 0;
  for (const [n, q] of qRun.byNumber) {
    const s = sRun.byNumber.get(n);
    if (!s) continue;
    const qv = questionValues(q);
    for (const v of valuesIn(`${s.answer || ""} ${s.solutionText || ""}`)) if (qv.has(v)) score += 1;
  }
  return score;
};

const applySolution = (q, s) => {
  if (s.solutionText) q.solutionText = s.solutionText;
  if (s.solutionFigure) q.solutionFigure = s.solutionFigure;
  if (s.answer) {
    if (q.type === "mcq") {
      const key = optionFor(s.answer, q.options || []);
      if (key) { q.correctOption = key; q.answerSource = "printed"; }
    } else if (q.type === "written") {
      q.modelAnswer = s.answer;
      q.answerSource = "printed";
    }
  } else if (q.type === "written" && s.solutionText) {
    q.answerSource = "printed";
  }
  const where = s._page ? `page ${s._page}` : "later in the document";
  (q._notes ||= []).push(`The solution was taken from ${where}, where it is printed apart from the question — check it belongs to this question.`);
};

const applySolutions = (questions, solutions) => {
  const result = { matched: 0, unclear: 0 };
  if (!solutions?.length) return result;
  // The same solution read twice (overlapping chunks) counts once.
  const seen = new Set();
  const unique = solutions.filter((s) => {
    const k = `${normalizeNumber(s.number)}|${s.answer || ""}|${String(s.solutionText || "").replace(/\s+/g, " ").slice(0, 200)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const qRuns = runsOf(questions);
  const sRuns = runsOf(unique);
  const pairs = new Map(); // qRun → sRun
  const taken = new Set();

  const scored = qRuns.map((qRun) => {
    const options = sRuns
      .filter((sRun) => sRun.order >= qRun.order)
      .map((sRun) => ({ sRun, score: runScore(qRun, sRun) }))
      .sort((a, b) => b.score - a.score);
    return { qRun, options };
  });
  // Clear winners first: some shared values, at least twice the runner-up.
  for (const { qRun, options } of scored) {
    const [best, second] = options;
    if (best && best.score > 0 && (!second || best.score >= 2 * second.score) && !taken.has(best.sRun)) {
      pairs.set(qRun, best.sRun);
      taken.add(best.sRun);
    }
  }
  // Nothing to tell runs apart, as many of each: in order.
  if (pairs.size === 0 && qRuns.length === sRuns.length) {
    qRuns.forEach((qRun, i) => { if (sRuns[i].order >= qRun.order) pairs.set(qRun, sRuns[i]); });
  }

  for (const qRun of qRuns) {
    const sRun = pairs.get(qRun);
    for (const [n, q] of qRun.byNumber) {
      if (q.answerSource === "printed") continue;
      const found = sRun?.byNumber.get(n);
      const s = found && (found._order ?? 0) >= (q._order ?? 0) ? found : null;
      if (s) {
        applySolution(q, s);
        result.matched += 1;
      } else if (!sRun && sRuns.some((r) => r.order >= qRun.order && r.byNumber.has(n))) {
        (q._notes ||= []).push(`A solution numbered ${q.number} is printed elsewhere in the document, but it wasn't clear which question it belongs to, so it wasn't used.`);
        result.unclear += 1;
      }
    }
  }
  return result;
};

// Models translate English questions despite being told not to ("10 cm" →
// "১০ cm", "kg" → "কিগ্রাম"). When the page the question came from has no
// Bangla at all, its Bangla digits are put back (in place) and Bangla words
// are reported. → true when Bangla words remain.
const BANGLA_ANY = /[\u0980-\u09FF]/;
const BANGLA_LETTER = /[\u0985-\u09B9\u09CE\u09DC-\u09E1]/;
const toLatinDigits = (t) => (typeof t === "string" ? t.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d))) : t);
const undoTranslation = (q, sourceText) => {
  if (BANGLA_ANY.test(String(sourceText || "").replace(/\[FIGURE[^\]]*\]/gi, ""))) return false;
  const fixed = mapText(q, toLatinDigits);
  for (const key of Object.keys(fixed)) q[key] = fixed[key];
  return textFields(q).some((t) => typeof t === "string" && BANGLA_LETTER.test(t));
};

// A placeholder the model wrote instead of a solution is no solution; the
// model's own back-and-forth is not one either. Clears a placeholder in
// place. → a flag for the reviewer, or null.
const PLACEHOLDER = /^\s*\[?\s*(?:no|missing|not)\b[^\]]*\b(?:solution|explanation|answer|provided|given)\b[^\]]*\]?\s*\.?\s*$/i;
const DELIBERATION = /\b(?:still not matching|re-?check|likely a typo|answer key (?:is likely|says)|not explicitly given|incorrect per answer key)\b/i;
const cleanSolution = (q) => {
  if (typeof q.solutionText === "string" && PLACEHOLDER.test(q.solutionText)) {
    q.solutionText = "";
    return null;
  }
  if (typeof q.solutionText === "string" && (DELIBERATION.test(q.solutionText) || q.solutionText.length > 1500)) {
    return "The solution reads like the AI's rough working, not a clean solution — rewrite it.";
  }
  return null;
};

// "Q2. Which graph…" → "Which graph…" when the prefix is the question's own
// number (or labelled Q/Question/প্রশ্ন), so the printed number isn't
// shown twice.
const LEADING_NUMBER = /^\s*(?:(Q|Question|প্রশ্ন)\s*)?([0-9০-৯]{1,3})\s*[.):।]\s+/i;
const stripNumber = (q) => {
  if (typeof q.question !== "string") return;
  const m = q.question.match(LEADING_NUMBER);
  if (!m) return;
  if (m[1] || (q.number && normalizeNumber(q.number) === normalizeNumber(m[2]))) {
    q.question = q.question.slice(m[0].length);
    if (!q.number) q.number = m[2];
  }
};

module.exports = { stripMarkers, isGarbled, normalizeNumber, optionFor, applyAnswerKey, applySolutions, textFields, undoTranslation, cleanSolution, stripNumber };
