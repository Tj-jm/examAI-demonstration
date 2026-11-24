import { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Heading2, List, ListOrdered, ListChecks, Quote, Link, Image, Code, Table, Minus,
  WandSparkles, Undo2, Pencil, Eye, Columns2,
} from "lucide-react";
import SafeMarkdown from "./SafeMarkdown";
import LatexInserter from "./LatexInserter";
import { useAiWriteMutation } from "../api/aiWritingApi";
import { ErrorNote } from "./bits";

// A Markdown field: a toolbar over a plain textarea, a preview through the
// same SafeMarkdown the student app renders with, and "Format with AI",
// which turns pasted text into headings, lists and tables without changing
// its words. The textarea stays a textarea, so paste, drop and the browser's
// own undo keep working.
//
// textareaRef: pass one when the page needs the textarea itself (a cursor
// position for an inserted image). tools: extra buttons for the toolbar.
// actions: things shown beside the label (Write with AI, Translate).

const TABLE = "\n| Column | Column |\n| --- | --- |\n| | |\n";
const VIEWS = [["write", Pencil, "Write"], ["split", Columns2, "Side by side"], ["preview", Eye, "Preview"]];

export default function MarkdownEditor({
  value, onChange, label, actions, tools, textareaRef, minHeight = 140, placeholder,
  onPaste, onDrop, onDragOver, onBlur, hint, mono = true, initialView = "write", maxLength,
}) {
  const ownRef = useRef(null);
  const ref = textareaRef || ownRef;
  const text = value || "";
  const [view, setView] = useState(initialView);
  const [undo, setUndo] = useState(null); // { before, after }
  const [write, { isLoading: formatting, error, reset }] = useAiWriteMutation();

  // The undo is for the AI's change only: any edit after it retires it.
  useEffect(() => {
    if (undo && text !== undo.after) setUndo(null);
  }, [text, undo]);

  // Replace [start, end) with `insert`, then select [selStart, selEnd) of the result.
  const splice = (start, end, insert, selStart, selEnd) => {
    onChange(text.slice(0, start) + insert + text.slice(end));
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  };

  const range = () => {
    const el = ref.current;
    return el ? [el.selectionStart, el.selectionEnd] : [text.length, text.length];
  };

  // **bold**, *italic*, `code`: wrap the selection, or a placeholder word.
  const wrap = (before, after, filler) => {
    const [s, e] = range();
    const picked = text.slice(s, e);
    if (picked && text.slice(s - before.length, s) === before && text.slice(e, e + after.length) === after) {
      splice(s - before.length, e + after.length, picked, s - before.length, e - before.length);
      return;
    }
    const inner = picked || filler;
    splice(s, e, before + inner + after, s + before.length, s + before.length + inner.length);
  };

  // "- ", "1. ", "> ": on every line the selection touches; off again when all have it.
  const prefix = (make, test) => {
    const [s, e] = range();
    const from = text.lastIndexOf("\n", s - 1) + 1;
    const next = text.indexOf("\n", e > s && text[e - 1] === "\n" ? e - 1 : e);
    const to = next === -1 ? text.length : next;
    const lines = text.slice(from, to).split("\n");
    const on = lines.every((l) => !l.trim() || test.test(l));
    const out = lines.map((l, i) => (!l.trim() && lines.length > 1 ? l : on ? l.replace(test, "") : make(i) + l.replace(/^(#{1,4}\s+|[-*]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s?)/, ""))).join("\n");
    splice(from, to, out, from, from + out.length);
  };

  // A block on lines of its own.
  const block = (snippet, selectFrom = 0, selectLength = 0) => {
    const [s, e] = range();
    const lead = s === 0 || text[s - 1] === "\n" ? "" : "\n";
    const insert = lead + snippet;
    const at = s + lead.length + selectFrom;
    splice(s, e, insert, at, at + selectLength);
  };

  const link = () => {
    const [s, e] = range();
    const picked = text.slice(s, e) || "link text";
    const insert = `[${picked}](https://)`;
    const urlAt = s + picked.length + 3;
    splice(s, e, insert, urlAt, urlAt + 8);
  };

  const image = () => {
    const [s, e] = range();
    const alt = text.slice(s, e) || "description";
    const insert = `![${alt}](https://)`;
    const urlAt = s + alt.length + 4;
    splice(s, e, insert, urlAt, urlAt + 8);
  };

  const format = async () => {
    const [s, e] = range();
    const part = s !== e;
    const source = part ? text.slice(s, e) : text;
    if (!source.trim()) return;
    reset();
    try {
      const data = await write({ task: "format", text: source }).unwrap();
      const out = part ? text.slice(0, s) + data.text + text.slice(e) : data.text;
      setUndo({ before: text, after: out });
      onChange(out);
    } catch {
      // shown under the toolbar
    }
  };

  const keys = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); wrap("**", "**", "bold text"); }
    else if (k === "i") { e.preventDefault(); wrap("*", "*", "italic text"); }
    else if (k === "k") { e.preventDefault(); link(); }
  };

  const TOOLS = [
    [Bold, "Bold (Ctrl+B)", () => wrap("**", "**", "bold text")],
    [Italic, "Italic (Ctrl+I)", () => wrap("*", "*", "italic text")],
    [Heading2, "Heading", () => prefix(() => "## ", /^#{1,4}\s+/)],
    [List, "Bulleted list", () => prefix(() => "- ", /^[-*]\s+(?!\[[ xX]\])/)],
    [ListOrdered, "Numbered list", () => prefix((i) => `${i + 1}. `, /^\d+\.\s+/)],
    [ListChecks, "Checklist", () => prefix(() => "- [ ] ", /^[-*]\s+\[[ xX]\]\s+/)],
    [Quote, "Quote", () => prefix(() => "> ", /^>\s?/)],
    [Link, "Link (Ctrl+K)", link],
    [Image, "Picture from a link", image],
    [Code, "Code", () => {
      const [s, e] = range();
      // A few words selected: inline code. Nothing selected, or whole
      // lines: a code block.
      const sel = text.slice(s, e);
      if (sel && !sel.includes("\n")) wrap("`", "`", "code");
      else wrap(`${s > 0 && text[s - 1] !== "\n" ? "\n" : ""}\`\`\`\n`, "\n```\n", "code here");
    }],
    [Table, "Table", () => block(TABLE, 3, 6)],
    [Minus, "Divider", () => block("\n---\n")],
  ];

  const editor = (
    <textarea
      ref={ref}
      className="textarea"
      style={{ minHeight, fontFamily: mono ? "monospace" : undefined, fontSize: mono ? 13 : undefined, width: "100%" }}
      placeholder={placeholder}
      value={text}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={keys}
      onPaste={onPaste}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onBlur={onBlur}
      maxLength={maxLength}
      disabled={formatting}
    />
  );
  const preview = (
    <div className="card-quiet" style={{ minHeight, overflow: "auto" }}>
      {text.trim()
        ? <SafeMarkdown className="prose">{text}</SafeMarkdown>
        : <span className="hint">Nothing to preview yet.</span>}
    </div>
  );

  return (
    <div className="stack" style={{ gap: 6 }}>
      {(label || actions) && (
        <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
          {label ? <span className="label">{label}</span> : <span />}
          {actions && <span className="row-tight" style={{ flexWrap: "wrap" }}>{actions}</span>}
        </div>
      )}

      <div className="row-tight" style={{ flexWrap: "wrap", gap: 2 }}>
        {view !== "preview" && (
          <>
            {TOOLS.map(([Icon, title, run]) => (
              <button key={title} type="button" className="icon-btn" title={title} aria-label={title}
                onMouseDown={(e) => e.preventDefault()} onClick={run} disabled={formatting}>
                <Icon size={15} />
              </button>
            ))}
            <LatexInserter textareaRef={ref} value={text} onChange={onChange} label="Maths" />
            {tools}
            {undo ? (
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => { onChange(undo.before); setUndo(null); }}>
                <Undo2 size={13} /> Undo format
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-quiet" onClick={format} disabled={formatting || !text.trim()}
                title="Turn pasted text into headings, lists and tables. Select part of it to format only that.">
                <WandSparkles size={13} /> {formatting ? "Formatting…" : "Format with AI"}
              </button>
            )}
          </>
        )}
        <span className="grow" />
        <span className="row-tight" style={{ gap: 2 }} role="radiogroup" aria-label="View">
          {VIEWS.map(([v, Icon, title]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} title={title} aria-label={title}
              className="icon-btn" style={view === v ? { background: "var(--surface-alt)", color: "var(--text)" } : undefined}
              onClick={() => setView(v)}>
              <Icon size={15} />
            </button>
          ))}
        </span>
      </div>
      <ErrorNote error={error} />

      {view === "write" && editor}
      {view === "preview" && preview}
      {view === "split" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
          {editor}
          {preview}
        </div>
      )}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
