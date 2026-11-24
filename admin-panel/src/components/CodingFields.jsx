import { useState } from "react";
import { Plus, X, Eye, EyeOff, Sparkles } from "lucide-react";
import { Field, ErrorNote, useConfirm } from "./bits";
import { useWriteCodingStarterMutation } from "../api/aiApi";

// Keys match backend utils/codeRunner.js LANGUAGES.
export const CODE_LANGUAGES = [
  ["python", "Python"], ["javascript", "JavaScript"], ["c", "C"], ["cpp", "C++"], ["java", "Java"], ["csharp", "C#"],
  ["go", "Go"], ["php", "PHP"], ["ruby", "Ruby"], ["rust", "Rust"], ["kotlin", "Kotlin"], ["typescript", "TypeScript"],
];
const LABEL = Object.fromEntries(CODE_LANGUAGES);
const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13 };

export const BLANK_CODING = { languages: ["python"], starterCode: [], tests: [{ input: "", output: "", hidden: false, marks: "" }], timeLimitMs: 2000 };

export const codingProblems = (form) => {
  const issues = [];
  if (!form.languages?.length) issues.push("Allow at least one language.");
  const tests = (form.tests || []).filter((t) => t.output.trim());
  if (!tests.length) issues.push("Add at least one test with an expected output.");
  return issues;
};

export const codingPayload = (form) => ({
  languages: form.languages,
  starterCode: (form.starterCode || []).filter((s) => form.languages.includes(s.language) && s.code.trim()),
  tests: form.tests.filter((t) => t.output.trim()).map((t) => ({
    input: t.input || "", output: t.output, hidden: Boolean(t.hidden), ...(Number(t.marks) > 0 ? { marks: Number(t.marks) } : {}),
  })),
  timeLimitMs: Number(form.timeLimitMs) || 2000,
});

export const codingFromQuestion = (q) => ({
  languages: q.languages?.length ? q.languages : BLANK_CODING.languages,
  starterCode: q.starterCode || [],
  tests: q.tests?.length ? q.tests.map((t) => ({ input: t.input || "", output: t.output || "", hidden: Boolean(t.hidden), marks: t.marks ?? "" })) : BLANK_CODING.tests,
  timeLimitMs: q.timeLimitMs || 2000,
});

// Languages, starter code and tests for a coding question.
export default function CodingFields({ form, set }) {
  const [starterFor, setStarterFor] = useState(form.languages?.[0] || "python");
  const lang = form.languages.includes(starterFor) ? starterFor : form.languages[0];
  const starter = (form.starterCode || []).find((s) => s.language === lang)?.code || "";
  const setStarter = (code) => set({ starterCode: [...(form.starterCode || []).filter((s) => s.language !== lang), { language: lang, code }] });
  const setTest = (i, patch) => set({ tests: form.tests.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const toggleLang = (key) => set({ languages: form.languages.includes(key) ? form.languages.filter((l) => l !== key) : [...form.languages, key] });
  const weighted = form.tests.some((t) => Number(t.marks) > 0);
  const [writeStarter, starterState] = useWriteCodingStarterMutation();
  const confirm = useConfirm();
  const hasStarter = (form.starterCode || []).some((s) => form.languages.includes(s.language) && s.code.trim());
  const aiStarter = async () => {
    if (hasStarter && !(await confirm({ title: "Write the starter code again?", body: "The AI writes starter code for every allowed language. What you have now is replaced.", confirmLabel: "Replace it", tone: "neutral" }))) return;
    try {
      const { starterCode } = await writeStarter({ question: form.question || "", languages: form.languages, tests: form.tests }).unwrap();
      const made = new Set(starterCode.map((s) => s.language));
      set({ starterCode: [...(form.starterCode || []).filter((s) => !made.has(s.language)), ...starterCode] });
    } catch { /* shown below */ }
  };

  return (
    <>
      <div className="card stack">
        <h3>Languages</h3>
        <p className="hint" style={{ margin: 0 }}>The student picks one of these. The program reads input and prints output.</p>
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          {CODE_LANGUAGES.map(([key, label]) => (
            <button key={key} type="button" className={`pill pill-btn${form.languages.includes(key) ? " pill-on" : ""}`} onClick={() => toggleLang(key)}>{label}</button>
          ))}
        </div>
        <Field label="Time limit per test (seconds)">
          <input className="input" type="number" min={1} max={10} style={{ width: 90 }} value={Math.round((form.timeLimitMs || 2000) / 1000)} onChange={(e) => set({ timeLimitMs: Math.min(10, Math.max(1, Number(e.target.value) || 1)) * 1000 })} />
        </Field>
      </div>

      {form.languages.length > 0 && (
        <div className="card stack">
          <h3>Starter code</h3>
          <div className="spread">
            <p className="hint" style={{ margin: 0 }}>Optional. What the editor opens with.</p>
            <button type="button" className="btn btn-sm btn-quiet" disabled={starterState.isLoading || !(form.question || "").trim()} title={(form.question || "").trim() ? "Reads the input in every allowed language, leaves the solving to the student" : "Write the question first"} onClick={aiStarter}>
              <Sparkles size={13} /> {starterState.isLoading ? "Writing…" : "Write starter code with AI"}
            </button>
          </div>
          {starterState.error && <ErrorNote error={starterState.error} />}
          {form.languages.length > 1 && (
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              {form.languages.map((key) => (
                <button key={key} type="button" className={`pill pill-btn${key === lang ? " pill-on" : ""}`} onClick={() => setStarterFor(key)}>{LABEL[key]}</button>
              ))}
            </div>
          )}
          <textarea className="textarea" rows={8} spellCheck={false} style={mono} value={starter} onChange={(e) => setStarter(e.target.value)} placeholder={`${LABEL[lang]} starter code`} />
        </div>
      )}

      <div className="card stack">
        <h3>Tests</h3>
        <p className="hint" style={{ margin: 0 }}>
          Shown tests can be tried with Run. Hidden ones count only at submit. {weighted ? "Marks follow each test's marks." : "Each test is worth an equal share of the marks."}
        </p>
        {form.tests.map((t, i) => (
          <div key={i} className="stack" style={{ gap: 6, padding: 10, border: "1px solid var(--border)", borderRadius: 10 }}>
            <div className="spread">
              <strong className="small">Test {i + 1}</strong>
              <div className="row-tight" style={{ gap: 6 }}>
                <button type="button" className={`pill pill-btn row-tight${t.hidden ? "" : " pill-on"}`} style={{ gap: 4 }} onClick={() => setTest(i, { hidden: !t.hidden })}>
                  {t.hidden ? <EyeOff size={12} /> : <Eye size={12} />} {t.hidden ? "Hidden" : "Shown"}
                </button>
                <input className="input" type="number" min={0} step="any" placeholder="Marks" title="Optional: this test's own marks" style={{ width: 80 }} value={t.marks} onChange={(e) => setTest(i, { marks: e.target.value })} />
                {form.tests.length > 1 && (
                  <button type="button" className="icon-btn icon-btn-danger" title="Remove this test" onClick={() => set({ tests: form.tests.filter((_, j) => j !== i) })}><X size={15} /></button>
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              <textarea className="textarea" rows={3} spellCheck={false} style={mono} placeholder="Input (stdin)" value={t.input} onChange={(e) => setTest(i, { input: e.target.value })} />
              <textarea className="textarea" rows={3} spellCheck={false} style={mono} placeholder="Expected output" value={t.output} onChange={(e) => setTest(i, { output: e.target.value })} />
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-sm btn-quiet" style={{ alignSelf: "flex-start" }} onClick={() => set({ tests: [...form.tests, { input: "", output: "", hidden: true, marks: "" }] })}>
          <Plus size={13} /> Add a test
        </button>
      </div>
    </>
  );
}
