// Extraction reads a paged document one page at a time instead of in
// fixed-size text chunks. A 600-token chunk boundary used to fall anywhere —
// between a question and its options, or its "Solution" box — so the model
// saw half a question and skipped it, or saw an answer with no question.
//
// Each step is one page (or one part of a dense page), framed by the end of
// the page before and the start of the page after, and the model is told to
// transcribe only questions that start inside the frame. A question running
// over a page break is completed from the next page's start and output once.

// The start of a numbered question on its own line: "01.", "১৫.", "7)", "Q7.",
// "প্রশ্ন ৩।", "Example 12". Sub-parts like "(ক)" and options like "(A)" are
// deliberately not matched — they belong to the question above them.
const QUESTION_START = /^[ \t]*(?:(?:Q|Question|প্রশ্ন|Example|Illustration)[ \t]*)?[0-9০-৯]{1,3}[ \t]*[.)।:](?![0-9০-৯])/gm;

// Splits text into pieces of at most maxChars, cutting only where a new
// question starts. A single question longer than maxChars stays whole.
const splitAtQuestions = (text, maxChars) => {
  if (text.length <= maxChars) return [text];

  const starts = [...text.matchAll(QUESTION_START)].map((m) => m.index).filter((i) => i > 0);
  if (starts.length === 0) return [text];

  const parts = [];
  let from = 0;
  let lastCut = 0;
  for (const start of starts) {
    if (start - from > maxChars && lastCut > from) {
      parts.push(text.slice(from, lastCut));
      from = lastCut;
    }
    lastCut = start;
  }
  if (text.length - from > maxChars && lastCut > from) {
    parts.push(text.slice(from, lastCut));
    from = lastCut;
  }
  parts.push(text.slice(from));
  return parts.map((p) => p.trim()).filter(Boolean);
};

// pages: [{ number, text }] in order (only the selected pages, already
// assembled — transcriptions swapped in). → [{ page, part, parts, text }]
const planPageSteps = (pages, { maxChars = 3000, contextChars = 600 } = {}) => {
  const pieces = [];
  for (const page of pages) {
    const text = String(page.text || "").trim();
    if (!text) continue;
    const parts = splitAtQuestions(text, maxChars);
    parts.forEach((part, i) => pieces.push({ page: page.number, part: i + 1, parts: parts.length, body: part }));
  }

  return pieces.map((piece, i) => {
    const label = `page ${piece.page}${piece.parts > 1 ? `, part ${piece.part} of ${piece.parts}` : ""}`;
    const before = i > 0 ? pieces[i - 1].body.slice(-contextChars) : "";
    const after = i < pieces.length - 1 ? pieces[i + 1].body.slice(0, contextChars) : "";
    const text = [
      before && `[… end of the text before — context only]\n${before}`,
      `>>> TRANSCRIBE FROM HERE (${label})\n${piece.body}\n<<< TRANSCRIBE TO HERE`,
      after && `[start of the text after — context only …]\n${after}`,
    ].filter(Boolean).join("\n\n");
    return { page: piece.page, part: piece.part, parts: piece.parts, label, body: piece.body, text };
  });
};

module.exports = { QUESTION_START, splitAtQuestions, planPageSteps };
