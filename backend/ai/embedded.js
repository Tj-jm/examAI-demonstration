const net = require("net");
const EmbeddedModel = require("../models/embeddedModelModel");
const { CATALOGUE } = require("./embeddedCatalogue");
const { resolveBinary } = require("./llamaServerBinary");
const { spawn } = require("child_process");

// The embedded provider runs a real llama.cpp server (llama-server) as a
// child process on localhost and talks to it over its own OpenAI-compatible
// HTTP API — see providers/index.js's openAiCompatible adapter, reused
// below rather than duplicated. This replaced an earlier, in-process
// (node-llama-cpp) implementation: that library has no image-input API at
// all (checked its actual type definitions and every release's changelog —
// nothing), which ruled out vision. The real llama-server binary supports
// vision natively (--mmproj) and is what "Local or self-hosted" already
// talks to when pointed at Ollama/LM Studio, so this is the same protocol,
// just spawned and managed by this process instead of installed by hand.

let current = null; // { catalogueId, port, proc }
let switching = null;

const findFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const waitForHealth = async (port, timeoutMs = 180000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // Not listening yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("The built-in model server did not become ready in time.");
};

const stopCurrent = async () => {
  if (!current) return;
  const { proc } = current;
  current = null;
  if (!proc || proc.killed || proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      resolve();
    }, 5000);
    proc.once("exit", () => { clearTimeout(timer); resolve(); });
  });
};

const resolveRecord = async (catalogueId) => {
  const record = await EmbeddedModel.findOne({ catalogueId });
  if (!record) {
    throw new Error(`"${catalogueId}" has not been downloaded on this server yet. Download it in AI settings first.`);
  }
  return record;
};

const ensureRunning = async (catalogueId) => {
  if (current?.catalogueId === catalogueId) return current;
  if (switching?.catalogueId === catalogueId) return switching.promise;

  const promise = (async () => {
    const record = await resolveRecord(catalogueId);
    await stopCurrent();

    const { binaryPath, libDir } = await resolveBinary();
    const port = await findFreePort();

    const args = [
      "-m", record.filePath,
      "--port", String(port),
      "--host", "127.0.0.1",
      "-c", "4096",
      "-ngl", "0",
      "--no-webui",
    ];
    if (record.mmprojPath) args.push("--mmproj", record.mmprojPath);

    const proc = spawn(binaryPath, args, {
      env: { ...process.env, LD_LIBRARY_PATH: libDir },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let startupLog = "";
    const capture = (buf) => {
      startupLog = (startupLog + buf.toString()).slice(-4000);
    };
    proc.stdout.on("data", capture);
    proc.stderr.on("data", capture);

    const exited = new Promise((resolve) => proc.once("exit", (code) => resolve(code)));

    try {
      await Promise.race([
        waitForHealth(port),
        exited.then((code) => {
          throw new Error(`The built-in model server exited before starting (code ${code}).\n${startupLog.slice(-800)}`);
        }),
      ]);
    } catch (error) {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      throw error;
    }

    const loaded = { catalogueId, port, proc };
    current = loaded;
    proc.once("exit", () => {
      if (current?.proc === proc) current = null;
    });

    return loaded;
  })();

  switching = { catalogueId, promise };
  try {
    return await promise;
  } finally {
    if (switching?.promise === promise) switching = null;
  }
};

// One call through this server at a time — local CPU inference on a small
// self-hosted box makes concurrent generation both slower per-call and, for
// the multi-sequence case, not something worth the added complexity here.
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.then(() => {}, () => {});
  return run;
};

const complete = async ({ model: catalogueId, system, prompt, maxTokens, json, schema, schemaName, imageBase64, imageMimeType }) => {
  if (!catalogueId) {
    throw new Error("No built-in model is selected. Download and pick one in AI settings.");
  }

  const entry = CATALOGUE.find((m) => m.id === catalogueId);
  if (imageBase64 && !entry?.vision) {
    throw new Error(
      `"${entry?.label || catalogueId}" is a text-only built-in model and cannot see images. Pick one of the vision models in AI settings for this.`
    );
  }

  return enqueue(async () => {
    const { port } = await ensureRunning(catalogueId);

    // Deferred, not a top-level require: providers/index.js requires this
    // file to register the "embedded" adapter, so a top-level require of
    // providers/index.js here would be a circular import resolved to an
    // incomplete module. By the time complete() actually runs, that module
    // has long finished loading, so this plain require just hits Node's
    // module cache.
    const { ADAPTERS } = require("./providers");
    const openAiCompatible = ADAPTERS.custom;

    const result = await openAiCompatible.complete({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: null,
      model: catalogueId,
      system,
      prompt,
      maxTokens,
      json,
      schema,
      schemaName,
      imageBase64,
      imageMimeType,
    });

    // openAiCompatible reports llama-server's own `model` field, which is
    // the on-disk file path — replaced with the stable catalogue id, same
    // as every other field of `result` (text/promptTokens/completionTokens/
    // finishReason), which pass through unchanged.
    return { ...result, model: catalogueId };
  });
};

const unload = async (catalogueId) => {
  if (!catalogueId || current?.catalogueId === catalogueId) {
    await stopCurrent();
  }
};

// Which catalogue entry (if any) currently has a live llama-server process,
// for the admin panel's "Running" indicator and Stop button — distinct from
// AiConfig.model, which just says what's *selected*; the process itself is
// only spawned lazily on first use and can be stopped without changing
// what's selected (it respawns on the next call that needs it).
const getStatus = () => (current ? { catalogueId: current.catalogueId, port: current.port } : null);

module.exports = { complete, unload, getStatus };
