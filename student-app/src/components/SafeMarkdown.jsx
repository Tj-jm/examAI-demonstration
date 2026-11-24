import { SEGMENT as MATH_SEGMENT, unwrap as unwrapMath, renderKatex } from "./Latex";
import { API_ROOT } from "../api/apiBase";

// Lecture bodies are written in Markdown, not real MDX. Real MDX compiles to
// JSX and runs as code — a lecture author's stored text executing arbitrary
// script in every browser that later opens the lecture is not a trade a
// content field should make. This renders a fixed vocabulary of markdown
// syntax (headings, emphasis, code, lists, quotes, links, images, tables,
// rules) into a fixed vocabulary of safe tags. Nothing else ever reaches the
// page — there is no raw-HTML passthrough anywhere in this file.
//
// The one part that needs care beyond escaping is links/images: a
// javascript: url survives HTML-escaping perfectly — escaping neutralises
// <, >, &, and quotes, it does not touch a url scheme — so a link or image
// target is checked against an allowlist before it is ever written into an
// href/src.

const escapeHtml = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Called on text that has already been through escapeHtml once, so the
// characters that would make a `"` or `<` dangerous are already gone —
// this only needs to rule out a dangerous scheme, not re-escape anything.
// data: is excluded deliberately, not just http(s)/mailto/relative — an
// <img src="data:image/svg+xml,..."> can carry a <script> the same way an
// inline SVG on the page would.
const safeHref = (url) => {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return trimmed;
  return null;
};

// A backslash before one of these punctuation characters means "show this
// character literally, don't treat it as markdown syntax" — CommonMark's
// escaping mechanism. Run on the raw source, before block-level line
// matching, so `\#` doesn't become a heading and `\-` doesn't start a list,
// not just so `\*` doesn't become emphasis. Placeholder tokens (not the
// literal character) travel through every later pass so nothing downstream
// re-interprets them, then get swapped back in at the very end.
const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!~|>])/g;

const protectEscapes = (text) => {
  const tokens = [];
  const out = text.replace(ESCAPABLE, (_, ch) => {
    const token = `\u0001ESC${tokens.length}\u0001`;
    tokens.push(ch);
    return token;
  });
  return { text: out, tokens };
};

const inline = (text) => {
  // Code spans are protected with a token, not just replaced up front —
  // replacing them with real `<code>` markup first (as this used to do)
  // still leaves that markup's text content exposed to every regex below,
  // so a span like `list_comprehension` or `**kwargs` lost its underscores
  // or asterisks to emphasis parsing despite being "inside backticks". A
  // token is inert to every rule that follows; the real `<code>` tag is
  // spliced back in right before this function returns.
  const codeTokens = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0002CODE${codeTokens.length}\u0002`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  // Images before links: "![alt](url)" would otherwise have its "[alt](url)"
  // tail consumed by the link rule below, silently dropping the leading "!".
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    let src = safeHref(url);
    if (!src) return alt;
    // An app-relative picture (lecture notes' "Insert image") needs the
    // backend's origin in the mobile app, whose own origin isn't it.
    if (/^\/(api|media)\//.test(src)) src = `${API_ROOT}${src}`;
    return `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy" style="max-width:100%;height:auto;display:block" />`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, title) => {
    const href = safeHref(url);
    return href
      ? `<a href="${href}"${title ? ` title="${title}"` : ""} target="_blank" rel="noopener noreferrer">${label}</a>`
      : label;
  });

  // Autolinks: "<https://example.com>". Matched against the already-escaped
  // "&lt;...&gt;" form — the whole document was HTML-escaped before inline()
  // ever runs — which also means a bare "<3" or "<name>" with no real scheme
  // never matches this and just renders as literal text, unaffected.
  out = out.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (_, url) => {
    const href = safeHref(url);
    return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>` : `&lt;${url}&gt;`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<![\w_])__(?!\s)([^_]+?)(?<!\s)__(?![\w_])/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  // Underscore emphasis excludes the intraword case (snake_case_words stay
  // plain text) by requiring the delimiters not be flanked by a word
  // character or another underscore — the same reason CommonMark does it.
  out = out.replace(/(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])/g, "<em>$1</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // ==highlight==: a marker-pen highlight (book builder, lecture notes).
  out = out.replace(/==(?!\s)([^=\n]+?)(?<!\s)==/g, "<mark>$1</mark>");

  codeTokens.forEach((html, i) => {
    out = out.split(`\u0002CODE${i}\u0002`).join(html);
  });

  return out;
};

// Pulled out of the raw text before anything is HTML-escaped, and put back
// after every other markdown rule has run — a lecture written with LaTeX
// (see ai/prompts/index.js's LATEX instruction: lecture summaries and
// attachment recaps are told to use it, and an author can type it into the
// body by hand) needs KaTeX to see the real, unescaped expression. Doing
// this after escapeHtml would hand katex "a &lt; b" instead of "a < b" and
// either mis-render or show broken source. A NUL-delimited placeholder
// survives escaping and every other regex below untouched (none of them
// match \u0000), so the rendered KaTeX markup is spliced back in at the very
// end rather than being exposed to markdown syntax (a stray `_` or `*`
// inside "$x^{-1}$" must never be read as italics).
const extractMath = (raw) => {
  const tokens = [];
  const sources = [];
  const text = raw.replace(MATH_SEGMENT, (match) => {
    const found = unwrapMath(match);
    if (!found) return match;
    const html = renderKatex(found.expression, found.display);
    // Unrenderable maths is left as literal source (still escaped normally
    // below) rather than silently vanishing — same call Latex.jsx makes.
    if (html === null) return match;
    const token = `\u0000MATH${tokens.length}\u0000`;
    sources.push(found.expression);
    tokens.push(found.display ? `<span class="math-display">${html}</span>` : html);
    return token;
  });
  return { text, tokens, sources };
};

const HR = /^ {0,3}([-*_])\1{2,}\s*$/;
// A table's own header row is any line with at least one "|" in it — what
// actually confirms it's a table, not a stray pipe in prose, is the very
// next line being a delimiter row of dashes (each cell optionally colon-
// flanked for alignment, GFM's own rule for telling the two apart).
// The repeated group requires at least one *more* column after the first —
// i.e. at least two columns — specifically so a bare "---" (which the HR
// check above already handles) never also satisfies this and turns an
// unrelated line above it into a false one-column table.
const TABLE_DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

const splitTableRow = (line) => {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  // Safe to split on a plain "|" here — protectEscapes already turned any
  // author-escaped "\|" into an inert token before this line was ever read,
  // so every "|" left at this point is a real column separator.
  return trimmed.split("|").map((cell) => cell.trim());
};

// "| (s) None of these" under a two-column header is a row whose first cell
// is empty — the leading "|" is that empty cell, not GFM's optional edge pipe.
const rowCells = (line, width) => {
  const cells = splitTableRow(line);
  const trimmed = line.trim();
  if (cells.length < width && trimmed.startsWith("|") && !trimmed.endsWith("|")) cells.unshift("");
  return cells;
};

// A table written as bare pipe rows with no delimiter row — how a page
// transcription writes one (ai/prompts transcribePage: cells separated by
// " | "), and how models often write one anyway. Two consecutive lines of
// two or more cells each start one; the first is its header.
const isBareRow = (line) => line.includes("|") && rowCells(line, 2).length >= 2;

const alignOf = (delimiterCell) => {
  const cell = delimiterCell.trim();
  if (cell.startsWith(":") && cell.endsWith(":")) return "center";
  if (cell.endsWith(":")) return "right";
  if (cell.startsWith(":")) return "left";
  return null;
};

export const renderMarkdown = (raw) => {
  const { text: withMathTokens, tokens: mathTokens, sources: mathSources } = extractMath(raw || "");
  const { text: withEscTokens, tokens: escTokens } = protectEscapes(withMathTokens);

  // Escaped once, up front, on the whole document — every line handled below
  // is already inert text, so nothing that follows can introduce a real tag.
  const lines = escapeHtml(withEscTokens).split("\n");

  const html = [];
  let list = null; // "ul" | "ol" | null
  let paragraph = [];
  let inCodeBlock = false;
  let codeLines = [];
  // "li" | "blockquote" | null — an unmarked non-blank line right after one
  // of these is CommonMark's "lazy continuation": part of that same list
  // item / quote, not a new paragraph that closes it. Without tracking
  // this, a list item that happens to wrap onto a second line in the raw
  // text (very easy to do typing in a plain textarea) silently split into
  // "one-item list, then an unrelated paragraph" instead of one item.
  let lastLineKind = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      if (inCodeBlock) {
        html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushParagraph();
        closeList();
        inCodeBlock = true;
      }
      lastLineKind = null;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (HR.test(line)) {
      flushParagraph();
      closeList();
      html.push("<hr />");
      lastLineKind = null;
      continue;
    }

    // A table only starts here if the *next* line is a delimiter row — a
    // single line with a stray "|" in it (a coordinate, a shell pipe in a
    // code span) is not enough on its own.
    const delimited = line.includes("|") && i + 1 < lines.length && TABLE_DELIMITER.test(lines[i + 1]);
    const bare = !delimited && isBareRow(line) && i + 1 < lines.length && isBareRow(lines[i + 1]);
    if (delimited || bare) {
      flushParagraph();
      closeList();
      const headerCells = splitTableRow(line);
      const aligns = delimited ? splitTableRow(lines[i + 1]).map(alignOf) : [];
      let row = delimited ? i + 2 : i + 1;
      const bodyRows = [];
      while (row < lines.length && lines[row].includes("|") && lines[row].trim() !== "") {
        bodyRows.push(rowCells(lines[row], headerCells.length));
        row++;
      }
      const cellTag = (tag, cell, index) => {
        const align = aligns[index];
        return `<${tag}${align ? ` style="text-align:${align}"` : ""}>${inline(cell || "")}</${tag}>`;
      };
      html.push('<div class="md-table-wrap"><table>');
      html.push(`<thead><tr>${headerCells.map((c, idx) => cellTag("th", c, idx)).join("")}</tr></thead>`);
      html.push(`<tbody>${bodyRows.map((r) => `<tr>${headerCells.map((_, idx) => cellTag("td", r[idx], idx)).join("")}</tr>`).join("")}</tbody>`);
      html.push("</table></div>");
      i = row - 1;
      lastLineKind = null;
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      flushParagraph();
      closeList();
      // Starts at h2: the lecture's own title is the page's h1, so its body
      // headings sit a level below rather than competing with it.
      const level = heading[1].length + 1;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      lastLineKind = null;
      continue;
    }

    // ">" was escaped to "&gt;" in the pass above.
    const quote = line.match(/^&gt;\s?(.*)/);
    if (quote) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      lastLineKind = "blockquote";
      continue;
    }

    const task = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)/);
    const ul = !task && line.match(/^[-*]\s+(.*)/);
    const ol = line.match(/^(\d+)\.\s+(.*)/);
    if (task || ul || ol) {
      flushParagraph();
      const tag = ol ? "ol" : "ul";
      if (list !== tag) {
        closeList();
        // A numbered list broken up by a picture or a table carries on from
        // its own number ("2.") rather than restarting at 1.
        const start = ol ? Number(ol[1]) : 1;
        html.push(start !== 1 ? `<ol start="${start}">` : `<${tag}>`);
        list = tag;
      }
      if (task) {
        const checked = task[1].toLowerCase() === "x";
        html.push(`<li><label><input type="checkbox" disabled ${checked ? "checked" : ""} /> ${inline(task[2])}</label></li>`);
      } else {
        html.push(`<li>${inline(ul ? ul[1] : ol[2])}</li>`);
      }
      lastLineKind = "li";
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      closeList();
      lastLineKind = null;
      continue;
    }

    // Lazy continuation: an unmarked line right after a list item or a
    // blockquote, with no blank line in between, extends that same element
    // instead of starting a new paragraph after it.
    if (lastLineKind === "li" && list) {
      const last = html.pop();
      // Inserted right before the closing </li> regardless of whether the
      // item is a plain <li>...</li> or a task item's <li><label>...
      // </label></li> — either way the continuation text ends up inside
      // the same list item, which is all this needs to guarantee.
      html.push(last.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`));
      continue;
    }
    if (lastLineKind === "blockquote") {
      const last = html.pop();
      html.push(last.replace(/<\/blockquote>$/, ` ${inline(line.trim())}</blockquote>`));
      continue;
    }

    closeList();
    lastLineKind = null;
    paragraph.push(line.trim());
  }

  flushParagraph();
  closeList();
  if (inCodeBlock && codeLines.length) html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);

  // split/join rather than .replace(token, html) — the rendered KaTeX markup
  // can itself contain a literal "$", which String.replace's second-argument
  // special-pattern handling ($&, $1, ...) would otherwise misinterpret.
  let result = html.join("\n");
  // Maths inside an image's alt text or a title ("![capacitors $C_1$ …](…)")
  // goes back in as its plain source: KaTeX markup inside an attribute ends
  // the attribute at its first quote and spills the rest onto the page.
  result = result.replace(/ (alt|title)="([^"]*)"/g, (_, name, value) =>
    ` ${name}="${value.replace(/\u0000MATH(\d+)\u0000/g, (t, n) => escapeHtml(mathSources[Number(n)]))}"`);
  mathTokens.forEach((mathHtml, i) => {
    result = result.split(`\u0000MATH${i}\u0000`).join(mathHtml);
  });
  escTokens.forEach((ch, i) => {
    result = result.split(`\u0001ESC${i}\u0001`).join(ch);
  });

  return result;
};

export default function SafeMarkdown({ children, className }) {
  const html = renderMarkdown(children || "");
  if (!html) return null;
  // Safe here specifically because every code path above either escaped its
  // input first or emitted one of a fixed set of tags — never both an
  // unescaped input and an emitted tag at once.
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
