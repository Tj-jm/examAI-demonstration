const crypto = require("crypto");

// Pure text helpers for document chat (utils/docIndex.js, docRetrieve.js):
// cutting lecture notes and files into citable pieces, turning text into
// search terms that work for Bangla and English alike, ranking pieces
// against a question, and checking that a quoted line really is in the
// piece it claims to come from. No database, no AI — all testable offline.

// About 700 tokens of English, and a little less of Bangla (which tokenises
// longer) — big enough to hold a worked example, small enough that eight of
// them fit a prompt comfortably.
const CHUNK_CHARS = 2800;
const OVERLAP_CHARS = 400;

// NFC so a precomposed য় and its decomposed form compare equal; case-folded;
// every run of whitespace one space.
const normalize = (text) => String(text || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

// Words: letters (any script, with their combining marks) and digits.
// Bangla digits count as digits. LaTeX commands (\frac) and punctuation are
// separators.
const WORD = /[\p{L}\p{M}\p{N}]+/gu;

// Common words that match everything and mean nothing. Bangla particles and
// postpositions included — a question is full of them.
const STOP = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "of", "to", "in", "on", "at", "for", "and", "or", "but",
  "with", "by", "from", "as", "that", "this", "these", "those", "it", "its", "what", "which", "who", "whom", "how",
  "why", "when", "where", "do", "does", "did", "can", "could", "will", "would", "should", "i", "you", "he", "she",
  "we", "they", "me", "my", "your", "our", "their", "there", "here", "not", "no", "yes", "if", "then", "so", "than",
  "about", "into", "also", "please", "explain", "tell", "give",
  "কি", "কী", "কেন", "কিভাবে", "কীভাবে", "এবং", "ও", "বা", "যে", "এই", "সেই", "এর", "করে", "করা", "হয়", "হয়", "হবে",
  "একটি", "একটা", "থেকে", "জন্য", "দিয়ে", "দিয়ে", "না", "আমি", "আমার", "তুমি", "আপনি", "কোন", "কোনো", "কোনো", "আছে", "ছিল",
  "তা", "তার", "এটা", "এটি", "সাথে", "মধ্যে", "উপর", "নিয়ে", "নিয়ে", "বলুন", "বলো", "বুঝিয়ে",
].map((w) => w.normalize("NFC")));

// A crude suffix trim so "forces"/"force", "বলের"/"বল" meet. Deliberately
// light: a wrong trim only loosens a match; stemming properly per language
// is not worth its failure modes here.
const BANGLA_SUFFIXES = ["গুলোর", "গুলো", "দের", "টির", "টার", "য়ের", "ের", "টি", "টা", "কে", "তে"].map((w) => w.normalize("NFC"));
const stem = (word) => {
  if (/^[a-z]+$/.test(word)) {
    if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }
  if (/[ঀ-৿]/.test(word)) {
    for (const suffix of BANGLA_SUFFIXES) {
      if (word.length > suffix.length + 1 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
    }
  }
  return word;
};

// → search terms, in order (duplicates kept, for term frequency).
const terms = (text) => {
  const out = [];
  for (const m of normalize(text).matchAll(WORD)) {
    const word = m[0];
    if (STOP.has(word)) continue;
    if (word.length < 2 && !/^\p{N}$/u.test(word)) continue;
    out.push(stem(word));
  }
  return out;
};

const hash = (text) => crypto.createHash("sha1").update(String(text)).digest("hex");

// Splits one page (or one notes section) into pieces of about CHUNK_CHARS,
// ending each at a paragraph, line or sentence end where one is near, with
// OVERLAP_CHARS repeated at the start of the next so a sentence cut at the
// seam is whole in one of them.
const splitText = (text, { size = CHUNK_CHARS, overlap = OVERLAP_CHARS } = {}) => {
  const clean = String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const pieces = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start + Math.floor(size * 0.6), end);
      const breaks = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), Math.max(window.lastIndexOf(". "), window.lastIndexOf("। "), window.lastIndexOf("? "))];
      const at = breaks.find((b) => b > 0);
      if (at !== undefined) end = start + Math.floor(size * 0.6) + at + 1;
    }
    pieces.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return pieces.filter(Boolean);
};

// Lecture notes (Markdown) → sections by heading, each keeping its heading
// as the citation label. Text before the first heading is "Notes".
const splitNotes = (markdown) => {
  const sections = [];
  let current = { heading: "Notes", lines: [] };
  for (const line of String(markdown || "").split("\n")) {
    const h = line.match(/^#{1,4}\s+(.+?)\s*#*\s*$/);
    if (h) {
      if (current.lines.join("").trim()) sections.push(current);
      current = { heading: h[1].trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join("").trim()) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, text: s.lines.join("\n").trim() }));
};

// BM25 over a candidate set. docs: [{ terms: [...], length? }] → scores,
// same order. `terms` may be the chunk's unique terms (as stored) with its
// full term count in `length`; repeats in `terms` still count.
const bm25 = (queryTerms, docs, { k1 = 1.2, b = 0.75 } = {}) => {
  if (!docs.length || !queryTerms.length) return docs.map(() => 0);
  const unique = [...new Set(queryTerms)];
  const lengths = docs.map((d) => d.length || d.terms.length || 1);
  const avgLen = lengths.reduce((sum, n) => sum + n, 0) / docs.length || 1;
  const df = new Map(unique.map((t) => [t, 0]));
  const tfs = docs.map((d) => {
    const tf = new Map();
    for (const t of d.terms) if (df.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, df.get(t) + 1);
    return tf;
  });
  return docs.map((d, i) => {
    let score = 0;
    for (const t of unique) {
      const f = tfs[i].get(t);
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * lengths[i]) / avgLen)));
    }
    return score;
  });
};

const cosine = (a, b) => {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

// Reciprocal-rank fusion: merges rankings that score on different scales
// (keyword and meaning) by position alone. rankings: [[id, …], …] best first.
const fuse = (rankings, k = 60) => {
  const scores = new Map();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1)));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
};

// For quote checking: letters and digits only, so a quote that differs in
// spacing, punctuation, LaTeX dollar signs or line breaks still matches.
const skeleton = (text) => (normalize(text).match(WORD) || []).join(" ");

// Is `quote` really in `source`? Exact on the skeleton, or — for a quote
// the model shortened with "…" — every part of it, in order.
const quoteIn = (quote, source) => {
  const q = skeleton(quote);
  const s = skeleton(source);
  if (!q || q.split(" ").length < 3) return false;
  if (s.includes(q)) return true;
  const parts = String(quote).split(/\.\.\.|…/).map(skeleton).filter((p) => p.split(" ").length >= 3);
  if (parts.length < 2) return false;
  let from = 0;
  for (const part of parts) {
    const at = s.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
};

const estimateTokens = (text) => Math.ceil(String(text || "").length / 4);

module.exports = { normalize, terms, stem, hash, splitText, splitNotes, bm25, cosine, fuse, quoteIn, skeleton, estimateTokens, CHUNK_CHARS };
