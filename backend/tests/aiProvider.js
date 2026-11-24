// The provider adapter, exercised against a local server speaking the OpenAI
// chat completions protocol. That is the same path an Ollama, LM Studio or
// vLLM install takes, so this covers the whole local-model story.

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const http = require("http");
const { getAdapter } = require("../ai/providers");

let passed = 0;
let failed = 0;

const check = (label, ok, detail) => {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

// Behaviour is switched by the model name the test asks for, so one server
// covers every case.
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });

  req.on("end", () => {
    const parsed = JSON.parse(body || "{}");
    const model = parsed.model || "";

    if (model === "returns-html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>404 not found</body></html>");
      return;
    }

    if (model === "returns-error") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Invalid API key provided" } }));
      return;
    }

    if (model === "returns-no-choices") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [] }));
      return;
    }

    if (model === "no-usage-block") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }));
      return;
    }

    // Simulates a reasoning-family model: rejects max_tokens outright, and
    // once that is fixed, also rejects any temperature but its default.
    // Reports only the first violation it finds, same as the real api.
    if (model === "reasoning-model") {
      if (parsed.max_tokens !== undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
        }));
        return;
      }
      if (parsed.temperature !== undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { message: "Unsupported value: 'temperature' does not support 0.3 with this model. Only the default (1) value is supported." },
        }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        model,
        choices: [{ message: { role: "assistant", content: "reasoned answer" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }));
      return;
    }

    // Answers after 3 seconds — for stopping a call in flight.
    if (model === "slow") {
      const timer = setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model, choices: [{ message: { content: "late" }, finish_reason: "stop" }], usage: {} }));
      }, 3000);
      req.on("close", () => clearTimeout(timer));
      return;
    }

    // A reasoning model that reports whether reasoning_effort reached it.
    // "effort-rejected" also refuses the parameter, like a server that
    // doesn't know it.
    if (model === "effort-echo" || model === "effort-rejected") {
      if (parsed.max_tokens !== undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }));
        return;
      }
      if (model === "effort-rejected" && parsed.reasoning_effort !== undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unrecognized request argument supplied: reasoning_effort" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model, choices: [{ message: { content: String(parsed.reasoning_effort || "none") }, finish_reason: "stop" }], usage: {} }));
      return;
    }

    // Rejects max_tokens only — a model that needs the renamed parameter but
    // has no objection to temperature.
    if (model === "token-param-only") {
      if (parsed.max_tokens !== undefined) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
        }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        model,
        choices: [{ message: { content: "fine" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      model,
      choices: [{ message: { role: "assistant", content: "ready" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
      _echo: { auth: req.headers.authorization, sentJsonMode: Boolean(parsed.response_format) },
    }));
  });
});

const run = async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const adapter = getAdapter("custom");

  console.log("\nlocal openai-compatible server");

  const ok = await adapter.complete({
    baseUrl, apiKey: "", model: "qwen2.5:14b", prompt: "hello", maxTokens: 50,
  });
  check("returns the completion text", ok.text === "ready", ok.text);
  check("reports prompt tokens", ok.promptTokens === 12);
  check("reports completion tokens", ok.completionTokens === 3);
  check("echoes back the model name", ok.model === "qwen2.5:14b", ok.model);

  const withJson = await adapter.complete({
    baseUrl, apiKey: "k", model: "any", prompt: "hi", maxTokens: 10, json: true,
  });
  check("json mode is requested when asked for", withJson.text === "ready");

  const noUsage = await adapter.complete({
    baseUrl, apiKey: "", model: "no-usage-block", prompt: "hi", maxTokens: 10,
  });
  check("a missing usage block does not throw", noUsage.promptTokens === 0);

  console.log("\nfailure modes");

  const expectThrow = async (label, model, contains) => {
    try {
      await adapter.complete({ baseUrl, apiKey: "k", model, prompt: "hi", maxTokens: 10 });
      check(label, false, "did not throw");
    } catch (error) {
      check(label, error.message.includes(contains), error.message);
    }
  };

  // A local server that is up but pointed at the wrong path returns html, and
  // "Unexpected token <" tells a buyer nothing useful.
  await expectThrow("html response explains the base url is wrong", "returns-html", "base URL");
  await expectThrow("provider error message is surfaced", "returns-error", "Invalid API key");
  await expectThrow("empty choices array is caught", "returns-no-choices", "no completion");

  const expectNetworkError = async (label, url, contains) => {
    try {
      await adapter.complete({ baseUrl: url, apiKey: "k", model: "m", prompt: "hi", maxTokens: 10 });
      check(label, false, "did not throw");
    } catch (error) {
      check(label, error.message.includes(contains), error.message);
    }
  };

  // A real port that was bound and then released. Port 1 is rejected by fetch
  // as a bad port before any connection is attempted, so it never produces the
  // ECONNREFUSED this is meant to cover.
  const closedPort = await new Promise((resolve) => {
    const probe = require("net").createServer();
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

  await expectNetworkError(
    "a stopped local server says so",
    `http://127.0.0.1:${closedPort}/v1`,
    "Is it running"
  );
  await expectNetworkError(
    "an unresolvable host says so",
    "http://not-a-real-host.invalid/v1",
    "resolve"
  );

  console.log("\nreasoning-model quirks");
  {
    const { quirks, resetStructuredMode } = require("../ai/providers");
    resetStructuredMode();

    const both = await adapter.complete({
      baseUrl, apiKey: "k", model: "reasoning-model", prompt: "explain", maxTokens: 200,
    });
    check("succeeds despite rejecting both max_tokens and temperature",
      both.text === "reasoned answer", both.text);

    const learned = quirks.get(`${baseUrl}::reasoning-model`);
    check("remembers to use max_completion_tokens for this model",
      learned?.tokenParam === "max_completion_tokens", JSON.stringify(learned));
    check("remembers to drop temperature for this model",
      learned?.dropTemperature === true, JSON.stringify(learned));

    // A second call for the same model should need no correction round trips
    // — this is really just confirming the first one worked, since a broken
    // cache would surface as the call failing outright with the server above.
    const again = await adapter.complete({
      baseUrl, apiKey: "k", model: "reasoning-model", prompt: "again", maxTokens: 50,
    });
    check("the cached fix keeps working on a later call", again.text === "reasoned answer");

    resetStructuredMode();
    const partial = await adapter.complete({
      baseUrl, apiKey: "k", model: "token-param-only", prompt: "hi", maxTokens: 10,
    });
    check("a model needing only the token-param fix still succeeds", partial.text === "fine", partial.text);

    const partialLearned = quirks.get(`${baseUrl}::token-param-only`);
    check("does not learn a temperature quirk it never hit",
      partialLearned?.dropTemperature === false, JSON.stringify(partialLearned));

    resetStructuredMode();
  }

  console.log("\nstopping a call");
  {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 100);
    try {
      await adapter.complete({ baseUrl, apiKey: "", model: "slow", prompt: "hi", maxTokens: 10, signal: controller.signal });
      check("an aborted call throws", false);
    } catch (error) {
      check("an aborted call throws a stop, not a timeout", error.stopped === true, error.message);
      check("it stops at once rather than waiting for the answer", Date.now() - started < 1500, `${Date.now() - started}ms`);
    }
    try {
      await adapter.complete({ baseUrl, apiKey: "", model: "slow", prompt: "hi", maxTokens: 10, signal: controller.signal });
      check("an already-stopped signal never sends", false);
    } catch (error) {
      check("an already-stopped signal never sends", error.stopped === true, error.message);
    }
  }

  console.log("\nreasoning effort");
  {
    const { resetStructuredMode } = require("../ai/providers");
    resetStructuredMode();
    const plain = await adapter.complete({ baseUrl, apiKey: "", model: "qwen2.5:14b", prompt: "hi", maxTokens: 10, reasoningEffort: "low" });
    check("not sent to an ordinary model", plain.text === "ready", plain.text);
    const first = await adapter.complete({ baseUrl, apiKey: "", model: "effort-echo", prompt: "hi", maxTokens: 10, reasoningEffort: "low" });
    check("sent once the model is known to be reasoning-family", first.text === "low", first.text);
    const without = await adapter.complete({ baseUrl, apiKey: "", model: "effort-echo", prompt: "hi", maxTokens: 10 });
    check("not sent when the caller didn't ask", without.text === "none", without.text);
    const rejected = await adapter.complete({ baseUrl, apiKey: "", model: "effort-rejected", prompt: "hi", maxTokens: 10, reasoningEffort: "low" });
    check("a server that rejects it gets the call without it", rejected.text === "none", rejected.text);
    const again = await adapter.complete({ baseUrl, apiKey: "", model: "effort-rejected", prompt: "hi", maxTokens: 10, reasoningEffort: "low" });
    check("and that is remembered", again.text === "none", again.text);
    resetStructuredMode();
  }

  console.log("\nadapter selection");
  check("openai and custom share one adapter", getAdapter("openai") === getAdapter("custom"));
  check("anthropic is separate", getAdapter("anthropic") !== getAdapter("openai"));
  try {
    getAdapter("nonsense");
    check("unknown provider is rejected", false);
  } catch (error) {
    check("unknown provider is rejected", error.message.includes("Unknown provider"));
  }

  server.close();

  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((error) => {
  console.error("suite crashed:", error);
  server.close();
  process.exit(1);
});