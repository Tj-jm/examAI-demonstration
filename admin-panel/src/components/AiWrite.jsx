import { useEffect, useState } from "react";
import { Sparkles, Languages, Undo2, X } from "lucide-react";
import { useAiWriteMutation } from "../api/aiWritingApi";
import { ErrorNote } from "./bits";
import { LANGUAGES, WRITE_LANGUAGES } from "../utils/languages";

// "Write with AI" (backend/ai/writing.js). A button that opens a short
// dialog: what it's about (when the task needs it), the language, then
// Write. `input` is everything the task needs besides the prompt; `onResult`
// gets the fields the AI wrote and puts them in the form.
//
// prompt: "required" (notice, live class), "optional" (exam description,
// landing section) or "none" (push line: runs straight away). lead: a line
// of explanation shown beside the button.
export default function AiWrite({
  task, input = {}, onResult, prompt: promptMode = "optional",
  label = "Write with AI", promptLabel = "What should it say?", placeholder = "",
  disabled = false, title, lead,
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [language, setLanguage] = useState("en");
  const [write, { isLoading, error, reset }] = useAiWriteMutation();

  const run = async () => {
    try {
      const data = await write({ task, ...input, prompt: text.trim(), language }).unwrap();
      onResult(data);
      setOpen(false);
    } catch {
      // shown in the dialog, or under the button for "none"
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const start = () => {
    reset();
    if (promptMode === "none") run();
    else setOpen(true);
  };

  const button = (
    <button type="button" className="btn btn-sm btn-quiet" onClick={start} disabled={disabled || isLoading} title={title}>
      <Sparkles size={13} /> {isLoading && !open ? "Writing…" : label}
    </button>
  );

  return (
    <>
      {lead ? (
        <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className="hint" style={{ margin: 0 }}>{lead}</span>
          {button}
        </div>
      ) : button}
      {promptMode === "none" && !open && error && <ErrorNote error={error} />}

      {open && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="dialog stack" style={{ maxWidth: 480 }} role="dialog" aria-label={label}>
            <div className="spread">
              <div className="row-tight"><Sparkles size={16} /><h3 style={{ margin: 0 }}>{label}</h3></div>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="Close"><X size={15} /></button>
            </div>
            <label className="stack" style={{ gap: 6 }}>
              <span className="label">{promptLabel}{promptMode === "optional" ? " (optional)" : ""}</span>
              <textarea
                className="textarea"
                rows={4}
                autoFocus
                value={text}
                placeholder={placeholder}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }}
              />
            </label>
            <div className="row-tight" role="radiogroup" aria-label="Language">
              <span className="label" style={{ marginRight: 4 }}>Language</span>
              {WRITE_LANGUAGES.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={language === v}
                  className={`pill pill-btn${language === v ? " pill-on" : ""}`} onClick={() => setLanguage(v)}>{l}</button>
              ))}
            </div>
            <ErrorNote error={error} />
            <span className="hint">It fills in the form. Read it and change anything before you save.</span>
            <div className="row-tight" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn" onClick={run}
                disabled={isLoading || (promptMode === "required" && !text.trim())}>
                <Sparkles size={14} /> {isLoading ? "Writing…" : "Write"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Translate a field into a language picked from a list, in place, with an undo.
export function AiTranslate({ value, onChange }) {
  const [write, { isLoading, error }] = useAiWriteMutation();
  const [before, setBefore] = useState(null);

  useEffect(() => {
    if (before === null) return undefined;
    const t = setTimeout(() => setBefore(null), 15000);
    return () => clearTimeout(t);
  }, [before]);

  const run = async (to) => {
    if (!to) return;
    try {
      const data = await write({ task: "translate", text: value, to }).unwrap();
      setBefore(value);
      onChange(data.text);
    } catch {
      // shown below
    }
  };

  return (
    <span className="row-tight" style={{ gap: 4 }}>
      {before !== null ? (
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => { onChange(before); setBefore(null); }}>
          <Undo2 size={13} /> Undo translate
        </button>
      ) : (
        <label className="row-tight" style={{ gap: 4 }} title="Translate this field">
          <Languages size={13} />
          <select className="select" style={{ width: "auto", padding: "2px 6px", fontSize: 12 }} value=""
            disabled={!String(value || "").trim() || isLoading} onChange={(e) => run(e.target.value)}>
            <option value="">{isLoading ? "Translating…" : "Translate to…"}</option>
            {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      )}
      {error && <span className="hint" style={{ color: "var(--incorrect)" }}>{error?.data?.message || "Translation failed."}</span>}
    </span>
  );
}
