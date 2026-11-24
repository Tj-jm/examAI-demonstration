// A passage a student highlighted in a lecture, before it goes to the AI
// (studentVideoController.js). The text comes
// from the browser, so it is checked against the lecture: most of its words
// have to be in the lecture's title, description or notes. Selected maths
// and formatting never match the raw Markdown exactly, so this counts words
// rather than looking for the exact string.

const MAX_HIGHLIGHT = 1000;
const MIN_HIGHLIGHT = 2;
// Share of the passage's words that must be in the lecture.
const MATCH = 0.6;

const wordsOf = (text) => String(text || "").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];

// Whitespace squeezed, cut to the limit. Empty when there is nothing to send.
const cleanHighlight = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_HIGHLIGHT);

const inLecture = (text, lecture) => {
  const words = wordsOf(text);
  if (!words.length) return false;
  const known = new Set(wordsOf([lecture.title, lecture.description, lecture.bodyMarkdown].filter(Boolean).join(" ")));
  const found = words.filter((w) => known.has(w)).length;
  return found / words.length >= MATCH;
};

module.exports = { MAX_HIGHLIGHT, MIN_HIGHLIGHT, cleanHighlight, inLecture };
