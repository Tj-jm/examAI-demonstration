import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Box, Button, MenuItem, Select, Typography, CircularProgress, Alert, Chip } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Play, CheckCircle2, XCircle, Palette, EyeOff } from "lucide-react";
import { useRunCodeMutation } from "../api/contentApi";

// Keys match backend utils/codeRunner.js LANGUAGES.
const LANGS = {
  python: ["Python", "python"], javascript: ["JavaScript", "javascript"], c: ["C", "c"], cpp: ["C++", "cpp"], java: ["Java", "java"],
  csharp: ["C#", "csharp"], go: ["Go", "go"], php: ["PHP", "php"], ruby: ["Ruby", "ruby"], rust: ["Rust", "rust"], kotlin: ["Kotlin", "kotlin"], typescript: ["TypeScript", "typescript"],
};

// "auto" follows the app's light or dark mode.
const THEMES = [
  ["auto", "Follow app"], ["vs", "Light"], ["vs-dark", "Dark"], ["github-light", "GitHub"], ["dracula", "Dracula"],
  ["monokai", "Monokai"], ["hc-black", "High contrast dark"], ["hc-light", "High contrast light"],
];
const THEME_KEY = "examai.codeTheme";
const readTheme = () => { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } };

const defineThemes = (monaco) => {
  monaco.editor.defineTheme("dracula", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "comment", foreground: "6272a4" }, { token: "string", foreground: "f1fa8c" }, { token: "keyword", foreground: "ff79c6" },
      { token: "number", foreground: "bd93f9" }, { token: "type", foreground: "8be9fd" }, { token: "identifier", foreground: "f8f8f2" },
    ],
    colors: { "editor.background": "#282a36", "editor.foreground": "#f8f8f2", "editor.lineHighlightBackground": "#44475a55", "editorCursor.foreground": "#f8f8f0" },
  });
  monaco.editor.defineTheme("monokai", {
    base: "vs-dark", inherit: true,
    rules: [
      { token: "comment", foreground: "75715e" }, { token: "string", foreground: "e6db74" }, { token: "keyword", foreground: "f92672" },
      { token: "number", foreground: "ae81ff" }, { token: "type", foreground: "66d9ef" },
    ],
    colors: { "editor.background": "#272822", "editor.foreground": "#f8f8f2", "editor.lineHighlightBackground": "#3e3d32" },
  });
  monaco.editor.defineTheme("github-light", {
    base: "vs", inherit: true,
    rules: [
      { token: "comment", foreground: "6a737d" }, { token: "string", foreground: "032f62" }, { token: "keyword", foreground: "d73a49" },
      { token: "number", foreground: "005cc5" }, { token: "type", foreground: "6f42c1" },
    ],
    colors: { "editor.background": "#ffffff", "editor.foreground": "#24292e", "editor.lineHighlightBackground": "#f6f8fa" },
  });
};

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12.5, whiteSpace: "pre-wrap", m: 0 };

// A coding question while an exam is taken: pick a language, write, Run
// against the shown tests. The paper's hidden tests run when it's handed in.
// Practice passes useRun (its own run endpoint) and runArgs, and checked:
// the result of Check, every test, hidden ones without their data.
export default function CodeAnswer({ question, answer, onChange, submissionId, locked, useRun = useRunCodeMutation, runArgs, checked, onRun }) {
  const appMode = useTheme().palette.mode;
  const [themeKey, setThemeKey] = useState(readTheme);
  const theme = themeKey === "auto" ? (appMode === "dark" ? "vs-dark" : "vs") : themeKey;
  const languages = question.languages || [];
  const language = languages.includes(answer?.selectedOption) ? answer.selectedOption : languages[0];
  const starter = (l) => (question.starterCode || []).find((s) => s.language === l)?.code || "";
  const code = answer?.answerText ?? starter(language);
  const [run, { data, isLoading, error, reset }] = useRun();
  const codeRef = useRef(code);
  codeRef.current = code;

  // The language is saved with the first edit too, so the paper always says which one the code is in.
  const save = (patch) => onChange({ selectedOption: language, answerText: codeRef.current, ...patch });
  const pickLanguage = (l) => {
    const keepCode = codeRef.current.trim() && codeRef.current !== starter(language);
    onChange({ selectedOption: l, answerText: keepCode ? codeRef.current : starter(l) });
    reset();
  };
  const pickTheme = (t) => { setThemeKey(t); try { localStorage.setItem(THEME_KEY, t); } catch { /* private window */ } };
  // reset changes identity while a run is in flight (RTK Query), so it is
  // read from a ref: depending on it cleared every run the moment it started.
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => { resetRef.current(); }, [question._id]);

  const results = checked?.results || data?.results || [];
  const passed = results.filter((r) => r.passed).length;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        <Select size="small" value={language || ""} onChange={(e) => pickLanguage(e.target.value)} disabled={locked || languages.length < 2} sx={{ minWidth: 130 }}>
          {languages.map((l) => <MenuItem key={l} value={l}>{LANGS[l]?.[0] || l}</MenuItem>)}
        </Select>
        <Select
          size="small" value={themeKey} onChange={(e) => pickTheme(e.target.value)} sx={{ minWidth: 150 }}
          renderValue={(v) => <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}><Palette size={14} />{THEMES.find(([k]) => k === v)?.[1]}</Box>}
        >
          {THEMES.map(([k, label]) => <MenuItem key={k} value={k}>{label}</MenuItem>)}
        </Select>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained" size="small" disabled={locked || isLoading || !code.trim()}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Play size={14} />}
          onClick={() => { onRun?.(); run({ ...(runArgs || { submissionId }), questionId: question._id, code: codeRef.current, language }); }}
        >
          Run
        </Button>
      </Box>

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden" }}>
        <Editor
          height="340px"
          language={LANGS[language]?.[1] || "plaintext"}
          theme={theme}
          value={code}
          beforeMount={defineThemes}
          onChange={(v) => save({ answerText: v ?? "" })}
          options={{ readOnly: locked, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, automaticLayout: true, tabSize: 4, wordWrap: "on" }}
          loading={<CircularProgress size={20} />}
        />
      </Box>

      {data && !checked && !results.length && (
        <Alert severity="info">This problem has no shown tests to run. Submit to run the hidden ones.</Alert>
      )}

      {error && <Alert severity="error">{error.data?.message || "Couldn't run the code."}</Alert>}

      {results.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            {passed} of {results.length} {checked ? "tests" : "shown tests"} passed{checked?.outOf != null ? ` · ${checked.marks} / ${checked.outOf} marks` : ""}
          </Typography>
          {results.map((r, i) => (r.hidden ? (
            <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.75, border: 1, borderColor: r.passed ? "success.main" : "error.main", borderRadius: 2, px: 1.25, py: 0.75 }}>
              {r.passed ? <CheckCircle2 size={15} color="var(--mui-palette-success-main, #2e7d32)" /> : <XCircle size={15} color="var(--mui-palette-error-main, #d32f2f)" />}
              <Typography variant="body2" fontWeight={600}>Test {i + 1}</Typography>
              <EyeOff size={13} />
              <Typography variant="caption" color="text.secondary">Hidden · {r.status}</Typography>
            </Box>
          ) : (
            <Box key={i} sx={{ border: 1, borderColor: r.passed ? "success.main" : "error.main", borderRadius: 2, p: 1.25 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
                {r.passed ? <CheckCircle2 size={15} color="var(--mui-palette-success-main, #2e7d32)" /> : <XCircle size={15} color="var(--mui-palette-error-main, #d32f2f)" />}
                <Typography variant="body2" fontWeight={600}>Test {i + 1}</Typography>
                <Typography variant="caption" color="text.secondary">{r.status}{r.timeMs != null ? ` · ${r.timeMs} ms` : ""}</Typography>
              </Box>
              {r.input && <><Typography variant="caption" color="text.secondary">Input</Typography><Box component="pre" sx={mono}>{r.input}</Box></>}
              <Typography variant="caption" color="text.secondary">Expected</Typography>
              <Box component="pre" sx={mono}>{r.expected}</Box>
              {!r.passed && <><Typography variant="caption" color="text.secondary">Your output</Typography><Box component="pre" sx={mono}>{r.stdout || "(nothing)"}</Box></>}
              {r.error && <Box component="pre" sx={{ ...mono, color: "error.main" }}>{r.error}</Box>}
            </Box>
          )))}
        </Box>
      )}

      {!results.length && (question.tests || []).length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {question.tests.map((t, i) => (
            <Box key={i} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.25 }}>
              <Typography variant="body2" fontWeight={600}>Example {i + 1}</Typography>
              {t.input && <><Typography variant="caption" color="text.secondary">Input</Typography><Box component="pre" sx={mono}>{t.input}</Box></>}
              <Typography variant="caption" color="text.secondary">Output</Typography>
              <Box component="pre" sx={mono}>{t.output}</Box>
            </Box>
          ))}
        </Box>
      )}

      {question.hiddenTests > 0 && !checked && (
        <Chip size="small" variant="outlined" icon={<EyeOff size={13} />} sx={{ alignSelf: "flex-start" }} label={`${question.hiddenTests} hidden test${question.hiddenTests === 1 ? "" : "s"} run when you submit`} />
      )}
    </Box>
  );
}
