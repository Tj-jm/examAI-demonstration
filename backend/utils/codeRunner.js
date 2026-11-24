// Runs a student's code against a coding question's tests in a sandbox.
//   CODE_RUNNER  judge0 (default) | piston
//   JUDGE0_URL   e.g. http://localhost:2358
//   JUDGE0_KEY   optional. Sent as X-Auth-Token, or as X-RapidAPI-Key when
//                the URL is a RapidAPI host.
//   PISTON_URL   e.g. http://localhost:2000 (self-hosted, one container)

// Judge0 CE language ids.
// id: Judge0 CE language id. piston: Piston's language name.
const LANGUAGES = {
  python: { id: 71, piston: "python", label: "Python" },
  javascript: { id: 63, piston: "javascript", label: "JavaScript" },
  c: { id: 50, piston: "c", label: "C" },
  cpp: { id: 54, piston: "c++", label: "C++" },
  java: { id: 62, piston: "java", label: "Java" },
  csharp: { id: 51, piston: "csharp", label: "C#" },
  go: { id: 60, piston: "go", label: "Go" },
  php: { id: 68, piston: "php", label: "PHP" },
  ruby: { id: 72, piston: "ruby", label: "Ruby" },
  rust: { id: 73, piston: "rust", label: "Rust" },
  kotlin: { id: 78, piston: "kotlin", label: "Kotlin" },
  typescript: { id: 74, piston: "typescript", label: "TypeScript" },
};

const MAX_CODE = 50000;
const PARALLEL = 4;

const b64 = (s) => Buffer.from(String(s ?? ""), "utf8").toString("base64");
const unb64 = (s) => (s ? Buffer.from(s, "base64").toString("utf8") : "");
// Trailing spaces on each line and trailing blank lines don't count.
const tidy = (s) => String(s ?? "").replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trimEnd();

const usePiston = () => (process.env.CODE_RUNNER || "").toLowerCase() === "piston";
const configured = () => Boolean(usePiston() ? process.env.PISTON_URL : process.env.JUDGE0_URL);

const headers = () => {
  const url = process.env.JUDGE0_URL || "";
  const key = process.env.JUDGE0_KEY;
  const h = { "Content-Type": "application/json" };
  if (!key) return h;
  if (/rapidapi\.com/.test(url)) {
    h["X-RapidAPI-Key"] = key;
    h["X-RapidAPI-Host"] = new URL(url).host;
  } else {
    h["X-Auth-Token"] = key;
  }
  return h;
};

// Piston: one call per test. Java's file must be Main.java.
const runPiston = async (code, lang, test, timeLimitSec) => {
  const base = process.env.PISTON_URL.replace(/\/+$/, "");
  const r = await send(`${base}/api/v2/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: lang.piston, version: "*", files: [{ name: lang.piston === "java" ? "Main.java" : undefined, content: String(code) }],
      stdin: String(test.input ?? ""), // Piston refuses more than its own limit (3 seconds unless
      // PISTON_RUN_TIMEOUT is raised on the container; PISTON_MAX_MS here to match).
      run_timeout: Math.min(timeLimitSec * 1000, Number(process.env.PISTON_MAX_MS) || 3000), compile_timeout: 10000, run_memory_limit: 256 * 1024 * 1024,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const compileFailed = r.compile && r.compile.code !== 0;
  const run = r.run || {};
  const timedOut = run.signal === "SIGKILL";
  const ok = !compileFailed && run.code === 0 && !run.signal;
  const status = compileFailed ? "Compilation Error" : timedOut ? "Time Limit Exceeded" : ok ? "Accepted" : "Runtime Error";
  const stdout = String(run.stdout || "");
  return {
    passed: ok && tidy(stdout) === tidy(test.output),
    status: ok && tidy(stdout) !== tidy(test.output) ? "Wrong Answer" : status,
    stdout: stdout.slice(0, 4000),
    error: String((compileFailed ? r.compile.stderr || r.compile.output : run.stderr) || "").slice(0, 4000),
    timeMs: null,
  };
};

// One request to the runner. Its own reply goes to the server log; the
// student gets a plain sentence (their app hides technical text anyway).
const send = async (url, init) => {
  let res;
  try {
    res = await fetch(url, init);
  } catch (error) {
    console.error(`[codeRunner] ${url}: ${error.cause?.code || error.message}`);
    throw Object.assign(new Error("Can't reach the code runner right now. Try again later."), { statusCode: 503 });
  }
  if (!res.ok) {
    console.error(`[codeRunner] ${url} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 500)}`);
    throw Object.assign(new Error("The code runner couldn't run this right now. Try again later."), { statusCode: 502 });
  }
  return res.json();
};

const runOne = async (code, languageId, test, timeLimitSec) => {
  const base = process.env.JUDGE0_URL.replace(/\/+$/, "");
  const r = await send(`${base}/submissions?base64_encoded=true&wait=true`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      source_code: b64(code), language_id: languageId, stdin: b64(test.input),
      cpu_time_limit: timeLimitSec, wall_time_limit: timeLimitSec * 3, memory_limit: 256000,
    }),
    signal: AbortSignal.timeout(30000),
  });

  const stdout = unb64(r.stdout);
  const error = unb64(r.compile_output) || unb64(r.stderr) || (r.status?.id > 4 ? r.status.description : "");
  return {
    passed: r.status?.id === 3 && tidy(stdout) === tidy(test.output),
    status: r.status?.description || "",
    stdout: stdout.slice(0, 4000),
    error: error.slice(0, 4000),
    timeMs: r.time ? Math.round(Number(r.time) * 1000) : null,
  };
};

// Every test, a few at a time. Returns one result per test, in order.
const runTests = async ({ code, language, tests, timeLimitMs = 2000 }) => {
  if (!configured()) { console.error(`[codeRunner] ${usePiston() ? "PISTON_URL" : "JUDGE0_URL"} is not set`); throw Object.assign(new Error("The code runner isn't set up yet."), { statusCode: 503 }); }
  const lang = LANGUAGES[language];
  if (!lang) throw Object.assign(new Error("That language isn't supported."), { statusCode: 400 });
  if (String(code || "").length > MAX_CODE) throw Object.assign(new Error("The code is too long."), { statusCode: 400 });
  const sec = Math.min(10, Math.max(1, Math.round(timeLimitMs / 1000)));
  const out = new Array(tests.length);
  for (let i = 0; i < tests.length; i += PARALLEL) {
    const chunk = tests.slice(i, i + PARALLEL);
    const results = await Promise.all(chunk.map((t) => (usePiston() ? runPiston(code, lang, t, sec) : runOne(code, lang.id, t, sec))));
    results.forEach((r, j) => { out[i + j] = r; });
  }
  return out;
};

// Marks for a set of results: each test's own marks, or an equal share.
const marksFor = (question, results) => {
  const tests = question.tests || [];
  if (!tests.length) return 0;
  const weighted = tests.some((t) => Number(t.marks) > 0);
  const total = weighted ? tests.reduce((s, t) => s + (Number(t.marks) || 0), 0) : tests.length;
  const got = results.reduce((s, r, i) => s + (r?.passed ? (weighted ? Number(tests[i].marks) || 0 : 1) : 0), 0);
  return Math.round(((question.marks || 0) * got / total) * 100) / 100;
};

// Runs every coding answer on a paper against all its tests, and keeps the
// result on the answer (codeResult) for scoreObjective. A runner failure
// leaves codeResult unset, so the answer scores 0 and a staff member can
// re-run it later.
const judgeAnswers = async (answers, questionMap) => {
  for (const answer of answers) {
    if (answer.questionType !== "coding") continue;
    const q = questionMap.get(String(answer.question));
    if (!q) continue;
    if (!String(answer.answerText || "").trim()) {
      answer.codeResult = { passed: 0, total: (q.tests || []).length, results: [], at: new Date() };
      continue;
    }
    try {
      const results = await runTests({ code: answer.answerText, language: answer.selectedOption || q.languages?.[0], tests: q.tests || [], timeLimitMs: q.timeLimitMs });
      answer.codeResult = {
        passed: results.filter((r) => r.passed).length,
        total: results.length,
        results: results.map((r) => ({ passed: r.passed, status: r.status, timeMs: r.timeMs })),
        at: new Date(),
      };
    } catch (error) {
      answer.codeResult = { passed: 0, total: (q.tests || []).length, results: [], error: error.message, at: new Date() };
    }
  }
};

module.exports = { LANGUAGES, configured, runTests, marksFor, judgeAnswers, tidy };
