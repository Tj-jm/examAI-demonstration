// Models are told, every time, to wrap maths in $...$ or $$...$$ (see the
// LATEX line in prompts/index.js). Small ones — the local ones this platform
// is built to support — ignore that instruction constantly: they write
// "v = \frac{s}{t}" with the command spelled correctly and no delimiter
// around it at all.
//
// Latex.jsx only renders what it can find between a recognised delimiter, so
// an undelimited command is not a rendering bug on the frontend — it is
// content the frontend was never given a way to find. This repairs that
// before anything is saved, the same way repairJson.js repairs escaping: a
// small, deliberately narrow fix that runs unconditionally because the
// alternative is a solution silently showing raw backslashes forever.
//
// It wraps only the mathematical token itself — a command plus its argument
// groups, or a bare var^sup / var_sub pair — never the sentence around it.
// Guessing where a whole equation starts and ends in prose ("the speed v is
// \frac{s}{t} because...") is far more likely to swallow real words than
// under-wrapping a command is to leave one unrendered.

const ENVIRONMENTS = "align\\*?|equation\\*?|gather\\*?|aligned|cases|matrix|[bpvVB]matrix";

// Spans already inside one of these are left completely alone.
const DELIMITED = new RegExp(
  [
    "\\$\\$[\\s\\S]+?\\$\\$",
    "\\$[^$\\n]+?\\$",
    "\\\\\\[[\\s\\S]+?\\\\\\]",
    "\\\\\\([\\s\\S]+?\\\\\\)",
    `\\\\begin\\{(?:${ENVIRONMENTS})\\}[\\s\\S]+?\\\\end\\{(?:${ENVIRONMENTS})\\}`,
  ].join("|"),
  "g"
);

const COMMAND = /\\[a-zA-Z]+/g;

// Consumes one balanced {...} group starting at text[index], which must be
// "{". Returns the index just past the matching "}", or -1 if it never
// closes — an unbalanced brace is left untouched rather than swallowing the
// rest of the string into a math span.
const consumeBraceGroup = (text, index) => {
  if (text[index] !== "{") return -1;
  let depth = 0;
  for (let i = index; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
};

// Extends a match past whatever immediately follows it: \frac{a}{b},
// \sqrt{2}, x_{max}^2 are each one token, not three left as fragments.
const consumeTail = (text, start) => {
  let i = start;
  while (i < text.length) {
    if (text[i] === "{") {
      const end = consumeBraceGroup(text, i);
      if (end === -1) break;
      i = end;
      continue;
    }
    if (text[i] === "^" || text[i] === "_") {
      if (text[i + 1] === "{") {
        const end = consumeBraceGroup(text, i + 1);
        if (end === -1) break;
        i = end;
        continue;
      }
      if (/[A-Za-z0-9]/.test(text[i + 1] || "")) {
        i += 2;
        continue;
      }
      break;
    }
    break;
  }
  return i;
};

// Wraps bare LaTeX commands in a single string. Safe to call on anything —
// prose with no backslash in it returns unchanged immediately.
const wrapBareLatex = (text) => {
  if (typeof text !== "string" || !text.includes("\\")) return text;

  const skip = [];
  DELIMITED.lastIndex = 0;
  let d;
  while ((d = DELIMITED.exec(text))) skip.push([d.index, d.index + d[0].length]);
  const isSkipped = (index) => skip.some(([s, e]) => index >= s && index < e);

  // Walked by hand rather than by letting COMMAND.exec's own lastIndex drive
  // the loop: a nested command like \sqrt{\frac{a}{b}} matches \sqrt first,
  // and consumeTail correctly swallows the whole nested group as one token —
  // but the regex would still go on to find \frac again inside that span,
  // producing a second, shorter, overlapping token that corrupts the merge
  // step below. Advancing the search past whatever a token just consumed
  // means anything nested inside it is never seen as a separate command.
  const tokens = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    COMMAND.lastIndex = searchFrom;
    const c = COMMAND.exec(text);
    if (!c) break;

    if (isSkipped(c.index)) {
      searchFrom = c.index + c[0].length;
      continue;
    }

    const end = consumeTail(text, c.index + c[0].length);
    tokens.push([c.index, end]);
    searchFrom = end;
  }

  if (tokens.length === 0) return text;

  // Adjacent tokens separated only by a short run of whitespace are merged
  // into one span, so "\frac{a}{b} \cdot \frac{c}{d}" renders as one
  // expression instead of three disjointed ones.
  const merged = [tokens[0]];
  for (const [start, end] of tokens.slice(1)) {
    const last = merged[merged.length - 1];
    const between = text.slice(last[1], start);
    if (between.length <= 3 && /^\s*$/.test(between)) {
      last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }

  let out = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    out += text.slice(cursor, start);
    out += `$${text.slice(start, end)}$`;
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
};

// Walks a parsed response (object, array, or string) and applies
// wrapBareLatex to every string it finds — the same shape schema.parse()
// hands back, so the caller does not need to know which fields might carry
// maths and which do not.
const deepWrapLatex = (value) => {
  if (typeof value === "string") return wrapBareLatex(value);
  if (Array.isArray(value)) return value.map(deepWrapLatex);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = deepWrapLatex(v);
    return out;
  }
  return value;
};

module.exports = { wrapBareLatex, deepWrapLatex };