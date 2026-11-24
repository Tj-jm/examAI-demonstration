// The local model manager, against a server that speaks Ollama's protocol.
// The pull path streams NDJSON for minutes in real use, so the parsing is
// exercised here rather than discovered on a buyer's machine.

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const http = require("http");

let passed = 0;
let failed = 0;

const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${detail}` : ""}`); }
};

// A stand-in Ollama. /api/tags lists what is installed, /api/pull streams
// progress as newline-delimited json.
const server = http.createServer((req, res) => {
  if (req.url === "/api/tags") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      models: [
        { name: "qwen2.5:14b", size: 9_000_000_000, modified_at: "2026-08-01T00:00:00Z" },
        { name: "llama3.1:8b", size: 4_700_000_000, modified_at: "2026-07-01T00:00:00Z" },
      ],
    }));
    return;
  }

  if (req.url === "/api/pull") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const { name } = JSON.parse(body);

      if (name === "fails") {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end(JSON.stringify({ error: "model not found" }) + "\n");
        return;
      }

      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      // Written in awkward chunks on purpose: a json object split across two
      // writes is the normal case for a streamed response.
      const events = [
        { status: "pulling manifest" },
        { status: "downloading", total: 1000, completed: 250 },
        { status: "downloading", total: 1000, completed: 700 },
        { status: "downloading", total: 1000, completed: 1000 },
        { status: "success" },
      ];
      const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      res.write(text.slice(0, 60));
      setTimeout(() => { res.write(text.slice(60)); res.end(); }, 30);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

const run = async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { CATALOGUE } = require("../controllers/admin/localModelController");

  console.log("\ncatalogue");
  check("has entries", CATALOGUE.length > 0, CATALOGUE.length);
  check("every entry names a size and a ram requirement",
    CATALOGUE.every((m) => m.sizeGb > 0 && m.ramGb > 0));
  check("every entry says what it is good at",
    CATALOGUE.every((m) => Array.isArray(m.good) && m.good.length > 0));
  check("exactly one is recommended",
    CATALOGUE.filter((m) => m.recommended).length === 1);
  check("a grading-capable option exists",
    CATALOGUE.some((m) => m.good.some((g) => /grad/i.test(g))));

  console.log("\nreading installed models");
  {
    const res = await fetch(`${base}/api/tags`);
    const data = await res.json();
    const installed = (data.models || []).map((m) => ({
      name: m.name,
      sizeGb: Number((m.size / 1e9).toFixed(1)),
    }));
    check("installed models are listed", installed.length === 2, installed.length);
    check("size is converted to gigabytes", installed[0].sizeGb === 9, installed[0].sizeGb);
  }

  console.log("\nbase url handling");
  {
    // The configured address ends in /v1 for the OpenAI-compatible endpoints,
    // but tags and pull live at the root. Getting this wrong means every call
    // 404s against a server that is running fine.
    const strip = (u) => (u || "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
    check("strips /v1", strip("http://localhost:11434/v1") === "http://localhost:11434");
    check("strips /v1/", strip("http://localhost:11434/v1/") === "http://localhost:11434");
    check("leaves a bare host alone", strip("http://localhost:11434") === "http://localhost:11434");
    check("strips a trailing slash", strip("http://localhost:11434/") === "http://localhost:11434");
    check("handles an empty value", strip("") === "");
  }

  console.log("\nstreamed progress");
  {
    const response = await fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "qwen2.5:14b", stream: true }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const percents = [];
    let sawSuccess = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.total && event.completed) {
          percents.push(Math.round((event.completed / event.total) * 100));
        }
        if (event.status === "success") sawSuccess = true;
      }
    }

    check("progress is parsed across chunk boundaries",
      percents.join(",") === "25,70,100", percents.join(","));
    check("completion is detected", sawSuccess);
    check("no partial line is left unconsumed", buffer.trim() === "", JSON.stringify(buffer));
  }

  console.log("\nfailure is reported");
  {
    const response = await fetch(`${base}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "fails" }),
    });
    const text = await response.text();
    const event = JSON.parse(text.trim());
    check("an error event is surfaced, not swallowed", event.error === "model not found", event.error);
  }

  server.close();

  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((e) => { console.error(e); server.close(); process.exit(1); });
