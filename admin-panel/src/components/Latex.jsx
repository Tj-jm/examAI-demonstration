import { memo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

// Questions are written with LaTeX, so anywhere a question, option, statement
// or solution is shown, the maths has to render. Showing a teacher
// "$v = \frac{s}{t}$" as literal text makes it impossible to check what a
// student will actually see.
//
// Named Latex rather than Math on purpose: `Math` is a JavaScript global, and
// importing a component under that name silently breaks Math.min, Math.round
// and everything else in the same file.
//
// KaTeX rather than MathJax: it renders synchronously, so there is no flash of
// raw source, and it is a fraction of the size.

// Four delimiter styles, because models ignore the instruction to use dollar
// signs about half the time and emit bare \begin{align} or \[ ... \] instead.
// Rendering only $...$ leaves a correct solution showing as raw source.
//
// A lone dollar in prose — a price — is left alone: it has no closing partner.
const ENVIRONMENTS = "align\\*?|equation\\*?|gather\\*?|aligned|cases|matrix|[bpvVB]matrix";

const SEGMENT = new RegExp(
  [
    "\\$\\$[\\s\\S]+?\\$\\$",
    "\\$[^$\\n]+?\\$",
    "\\\\\\[[\\s\\S]+?\\\\\\]",
    "\\\\\\([\\s\\S]+?\\\\\\)",
    `\\\\begin\\{(?:${ENVIRONMENTS})\\}[\\s\\S]+?\\\\end\\{(?:${ENVIRONMENTS})\\}`,
  ].join("|"),
  "g"
);

// What each delimiter wraps, and whether it renders on its own line.
const unwrap = (part) => {
  if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
    return { expression: part.slice(2, -2), display: true };
  }
  if (part.startsWith("\\[") && part.endsWith("\\]")) {
    return { expression: part.slice(2, -2), display: true };
  }
  if (part.startsWith("\\(") && part.endsWith("\\)")) {
    return { expression: part.slice(2, -2), display: false };
  }
  // An environment carries its own delimiters and KaTeX expects them intact.
  if (part.startsWith("\\begin{")) {
    return { expression: part, display: true };
  }
  if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
    return { expression: part.slice(1, -1), display: false };
  }
  return null;
};

// Exported so SafeMarkdown can render the exact same maths, with the exact
// same options, inside markdown prose — one katex.renderToString config for
// the whole app, never a second copy that could quietly drift from this one.
// Typesetting is the slow part of showing a question, and the same
// expressions come back on every re-render and every revisit. Remembered by
// source text, oldest dropped first once the cache is full.
const KATEX_CACHE_LIMIT = 2000;
const katexCache = new Map();

export const renderKatex = (expression, displayMode) => {
  const cacheKey = `${displayMode ? "D" : "I"}${expression}`;
  if (katexCache.has(cacheKey)) return katexCache.get(cacheKey);
  const html = typesetKatex(expression, displayMode);
  if (katexCache.size >= KATEX_CACHE_LIMIT) katexCache.delete(katexCache.keys().next().value);
  katexCache.set(cacheKey, html);
  return html;
};

const typesetKatex = (expression, displayMode) => {
  try {
    return katex.renderToString(expression, {
      displayMode,
      throwOnError: false,
      // Malformed maths is shown in red rather than crashing the page or
      // silently vanishing. A teacher needs to see that it is broken.
      errorColor: "var(--incorrect)",
      strict: false,
      trust: false,
    });
  } catch {
    return null;
  }
};

// matchAll rather than split: split only keeps capturing groups, and the
// environment pattern needs a group of its own, so the two fight each other
// and the delimiters get dropped. Walking the matches avoids that entirely.
export const segment = (text) => {
  const parts = [];
  let cursor = 0;

  for (const match of text.matchAll(SEGMENT)) {
    if (match.index > cursor) {
      parts.push({ text: text.slice(cursor, match.index), math: false });
    }
    parts.push({ text: match[0], math: true });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), math: false });
  }

  return parts;
};

const FENCE = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)```/g;
const CODE_BLOCK = {
  display: "block", whiteSpace: "pre", overflowX: "auto", margin: "8px 0", padding: "10px 12px", borderRadius: 8,
  background: "rgba(127,127,127,0.12)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.85em", lineHeight: 1.5,
};

function Latex({ children, className = "", as: Tag = "span", ...rest }) {
  const text = typeof children === "string" ? children : "";

  if (!text) return null;

  // A fenced code block (```python ... ```), as in a coding question's
  // solution: shown as code, untouched by the maths.
  if (text.includes("```")) {
    const parts = [];
    let cursor = 0;
    for (const m of text.matchAll(FENCE)) {
      if (m.index > cursor) parts.push({ text: text.slice(cursor, m.index) });
      parts.push({ code: m[2].replace(/\n$/, ""), lang: m[1] });
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor) });
    if (parts.some((p) => p.code !== undefined)) {
      return (
        <Tag className={className} {...rest}>
          {parts.map((p, i) => (p.code !== undefined
            ? <code key={i} data-lang={p.lang || undefined} style={CODE_BLOCK}>{p.code}</code>
            : <Latex key={i}>{p.text.replace(/^\n+|\n+$/g, "")}</Latex>))}
        </Tag>
      );
    }
  }

  // Remaining props are forwarded so a caller can pass style or a title
  // without the component quietly dropping them.
  if (!text.includes("$") && !text.includes("\\")) {
    return <Tag className={className} {...rest} style={{ whiteSpace: "pre-line", ...rest.style }}>{text}</Tag>;
  }

  const parts = segment(text);

  return (
    <Tag className={className} {...rest} style={{ whiteSpace: "pre-line", ...rest.style }}>
      {parts.map((part, index) => {
        if (!part.math) return <span key={index}>{part.text}</span>;

        const found = unwrap(part.text);
        if (!found) return <span key={index}>{part.text}</span>;

        const html = renderKatex(found.expression, found.display);

        // Unrenderable maths is shown as its source rather than vanishing, so
        // a teacher can see what the model actually wrote.
        if (html === null) return <span key={index}>{part.text}</span>;

        return (
          <span
            key={index}
            className={found.display ? "math-display" : undefined}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </Tag>
  );
}

// Memoised: a parent re-rendering with the same text (a ticking clock, a
// typing field elsewhere) does not redo the maths.
export default memo(Latex);

// For places that need the plain text — a title attribute, a search match.
export const stripMath = (text) =>
  String(text || "").replace(SEGMENT, (m) => m.replace(/\$/g, ""));

export { SEGMENT, unwrap };
