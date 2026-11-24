// Models write LaTeX inside JSON strings and get the escaping wrong, reliably.
//
// A solution containing \frac{a}{b} has to be sent as "\\frac{a}{b}", because
// a lone backslash starts a JSON escape. Small models emit "\frac" about half
// the time. Sometimes that is merely wrong — \f is a formfeed, so the text
// silently loses the command. Sometimes it is fatal — \t before a letter
// produces a raw tab inside a string, which is not valid JSON at all, and
// JSON.parse throws.
//
// Rejecting those responses means throwing away a correct answer over
// punctuation. This repairs the string before parsing, which is worth doing
// because the alternative is a section that produces nothing.

// Escapes JSON actually defines. Everything else after a backslash is the
// model failing to escape a LaTeX command.
const VALID_ESCAPES = '"\\/bfnrtu';

// The ambiguity: "\ttab" could be a tab followed by "ab", or the LaTeX command
// \ttab. Guessing from "a letter follows" gets the common case right and then
// corrupts a genuine tab in ordinary prose.
//
// So only a known command wins. Anything else is left as the escape the author
// wrote, which is the safe direction: a missing command is visible, a mangled
// sentence is not.
const COMMANDS_BY_ESCAPE = {
  t: ["text", "times", "theta", "tfrac", "tan", "tilde", "top", "triangle", "to", "tau"],
  n: ["nabla", "neq", "notin", "nonumber", "newline", "nu", "ne"],
  f: ["frac", "forall", "fbox", "footnotesize", "flat"],
  b: ["begin", "beta", "binom", "bmatrix", "boxed", "bullet", "bar", "bf"],
  r: ["rho", "rightarrow", "right", "rangle", "rfloor", "rceil", "ref", "rm"],
};

const startsWithCommand = (escapeChar, rest) => {
  const candidates = COMMANDS_BY_ESCAPE[escapeChar];
  if (!candidates) return false;

  // The escape character is the command's first letter, so the rest of the
  // command follows it: "\text" is "t" plus "ext".
  return candidates.some((command) => rest.startsWith(command.slice(1)));
};

const repairJson = (text) => {
  let out = "";
  let inString = false;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (!inString) {
      if (char === '"') inString = true;
      out += char;
      index += 1;
      continue;
    }

    if (char === "\\") {
      const next = text[index + 1];

      if (next === undefined) {
        // A trailing backslash cannot be an escape.
        out += "\\\\";
        index += 1;
        continue;
      }

      if (VALID_ESCAPES.includes(next)) {
        // \t, \n, \f and \b are real escapes, but a model writing \text,
        // \nabla, \frac or \beta means the LaTeX command.
        const looksLikeCommand = startsWithCommand(next, text.slice(index + 2));

        if (looksLikeCommand) {
          out += `\\\\${next}`;
        } else {
          out += char + next;
        }

        index += 2;
        continue;
      }

      // \frac, \begin, \cdot, \times — a command the model left unescaped.
      out += "\\\\";
      index += 1;
      continue;
    }

    if (char === '"') {
      // A quote that really closes a string is followed by , } ] or : (or
      // the end). Anything else is the model quoting a word inside a value —
      // "detail": "Option "B" is wrong" — which ends the string early and
      // throws "Expected ',' or '}'". Escaped instead of closing.
      const after = text.slice(index + 1).match(/^\s*(.)/);
      if (after && !",}]:".includes(after[1])) {
        out += '\\"';
        index += 1;
        continue;
      }
      inString = false;
      out += char;
      index += 1;
      continue;
    }

    // A literal newline or tab inside a JSON string is invalid. Models put
    // them there when they pretty-print a multi-line solution.
    if (char === "\n") { out += "\\n"; index += 1; continue; }
    if (char === "\r") { out += "\\r"; index += 1; continue; }
    if (char === "\t") { out += "\\t"; index += 1; continue; }
    if (char === "\v" || char === "\f" || char === "\b") { out += `\\\\${{ "\v": "v", "\f": "f", "\b": "b" }[char]}`; index += 1; continue; }

    out += char;
    index += 1;
  }

  return out;
};

// After parsing, a few control characters can still be sitting in a string:
// the model (or its provider's own JSON encoder) turned \vec into a vertical
// tab, \frac into a form feed or \beta into a backspace, and wrote it as
// \u000b or as the raw byte. None of them belongs in exam text, so each is
// put back as the backslash it started as.
const CONTROL_TO_ESCAPE = { "\b": "\\b", "\v": "\\v", "\f": "\\f" };
const CONTROL_RE = /[\b\v\f]/g;

const restoreLatex = (value) => {
  if (typeof value === "string") return value.replace(CONTROL_RE, (c) => CONTROL_TO_ESCAPE[c]);
  if (Array.isArray(value)) return value.map(restoreLatex);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = restoreLatex(value[key]);
  }
  return value;
};

module.exports = { repairJson, restoreLatex, COMMANDS_BY_ESCAPE };
