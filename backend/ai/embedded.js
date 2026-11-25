const net = require("net");
const EmbeddedModel = require("../models/embeddedModelModel");
const { CATALOGUE } = require("./embeddedCatalogue");
const fs = require("fs");
const path = require("path");
const { resolveBinary, detectGpu, BIN_ROOT } = require("./llamaServerBinary");
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
let starting = null; // the process while it loads, before it is current
let switching = null;

// The context window: prompt and answer together. Generation asks for up to
// ~9,000 tokens of output and reading documents sends long prompts, so 4,096
// cut answers off. 16,384 fits every catalogue model (each supports 32K or
// more) at a few hundred MB to ~3 GB of extra RAM (most for the 14B).
// EMBEDDED_CONTEXT changes it.
const CONTEXT = Math.max(2048, Number(process.env.EMBEDDED_CONTEXT) || 16384);

// The running server's process id, kept on disk so a backend that died
// without stopping it (a crash, a dev restart) stops the leftover next time
// instead of leaving it holding gigabytes of RAM.
const PID_FILE = path.join(BIN_ROOT, "llama-server.pid");
const writePid = (pid) => { try { fs.mkdirSync(BIN_ROOT, { recursive: true }); fs.writeFileSync(PID_FILE, String(pid)); } catch { /* best effort */ } };
const clearPid = () => { try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ } };

// Only on Linux, where /proc shows the process is really llama-server: a
// recycled id elsewhere could belong to anything.
const stopLeftover = () => {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8"));
    if (pid && process.platform === "linux") {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (cmd.includes("llama-server")) process.kill(pid, "SIGKILL");
    }
  } catch { /* nothing left over */ }
  clearPid();
};
stopLeftover();

// The server must not outlive the backend. "exit" covers a normal exit;
// the signals cover Ctrl+C, docker stop and nodemon restarts, which end
// Node without an "exit" event. Each handler stops the server, then
// re-raises the signal so Node ends exactly as it would have.
const killNow = () => {
  for (const proc of [current?.proc, starting]) {
    if (proc && proc.exitCode === null) { try { proc.kill("SIGKILL"); } catch { /* gone */ } }
  }
  clearPid();
};
let hooked = false;
const hookExit = () => {
  if (hooked) return;
  hooked = true;
  process.once("exit", killNow);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGUSR2"]) {
    if (process.platform === "win32" && sig !== "SIGINT") continue;
    if (process.listenerCount(sig) > 0) continue; // someone else shuts down
    const onSig = () => {
      killNow();
      process.removeListener(sig, onSig);
      process.kill(process.pid, sig);
    };
    process.on(sig, onSig);
  }
};

// Rough token count to keep the answer's budget inside the context window:
// about 3 characters a token for English, about 1 for Bangla and other
// non-Latin text; an image costs up to ~1,500 tokens.
const estimate = (text) => {
  const s = String(text || "");
  const wide = (s.match(/[^\x00-\x7f]/g) || []).length;
  return Math.ceil((s.length - wide) / 3 + wide);
};
const budget = ({ system, prompt, imageBase64, maxTokens }) => {
  const used = estimate(system) + estimate(prompt) + (imageBase64 ? 1500 : 0) + 64;
  const room = CONTEXT - used;
  if (room < 256) {
    throw new Error(`This request is too long for the built-in model (about ${used} tokens; it holds ${CONTEXT}). Set EMBEDDED_CONTEXT higher, or use a hosted AI for this.`);
  }
  return Math.min(maxTokens || room, room);
};

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
      // A per-check limit: one fetch that never answers must not outlast the deadline.
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
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
  if (!proc || proc.killed || proc.exitCode !== null) { clearPid(); return; }
  proc.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      resolve();
    }, 5000);
    proc.once("exit", () => { clearTimeout(timer); resolve(); });
  });
  clearPid();
};

const resolveRecord = async (catalogueId) => {
  const record = await EmbeddedModel.findOne({ catalogueId });
  if (!record) {
    throw new Error(`"${catalogueId}" has not been downloaded on this server yet. Download it in AI settings first.`);
  }
  return record;
};

// Where the model runs: the GPU when there is one (Settings → AI →
// Built-in: GPU "auto", the default) and the CPU otherwise or with "off".
// A GPU build that fails to start (no driver, too little GPU memory, a
// download that failed) is noted and the CPU build started instead; that
// GPU is not tried again until the setting changes or the backend
// restarts, so each start doesn't pay for a failed attempt.
let device = null; // { backend, offload, note } for the running server
let gpuFailed = null; // { backend, reason, at }
const resetGpu = () => { gpuFailed = null; };

const gpuSetting = async () => {
  try {
    const AiConfig = require("../models/aiConfigModel");
    const config = await AiConfig.get();
    return config?.embeddedGpu === "off" ? "off" : "auto";
  } catch {
    return "auto";
  }
};

// NVIDIA GPU memory in MB ({ used, total }), from nvidia-smi; null without it.
const nvidiaMemory = async () => {
  try {
    const { execFile } = require("child_process");
    const out = await new Promise((resolve, reject) => execFile("nvidia-smi", ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"], { timeout: 5000, windowsHide: true }, (e, so) => (e ? reject(e) : resolve(so))));
    const [used, total] = out.split(/\r?\n/)[0].split(",").map((v) => Number(v.trim()));
    return Number.isFinite(total) && total > 0 ? { used, total } : null;
  } catch {
    return null;
  }
};

// Starts llama-server on one backend; resolves once it answers /health.
// What a start is doing now, for Performance → Local AI: { backend, step:
// "download" | "extract" | "start", downloadedSize, totalSize, at }.
let stage = null;

const launch = async (record, backend) => {
  stage = { backend, step: "prepare", at: Date.now() };
  const { binaryPath, libDirs } = await resolveBinary(backend, (p) => { stage = { backend, ...p, at: stage?.at || Date.now() }; });
  stage = { backend, step: "start", at: Date.now() };
  const port = await findFreePort();
  const gpu = backend !== "cpu";

  const args = [
    "-m", record.filePath,
    "--port", String(port),
    "--host", "127.0.0.1",
    "-c", String(CONTEXT),
    // One request at a time (see enqueue), so one slot gets the whole
    // context; llama-server otherwise splits it across parallel slots.
    "-np", "1",
    // Every layer on the GPU when there is one (llama.cpp keeps what does
    // not fit on the CPU); none otherwise.
    "-ngl", gpu ? "999" : "0",
    "--no-webui",
  ];
  if (record.mmprojPath) args.push("--mmproj", record.mmprojPath);
  // GPU memory is the limit: what does not fit runs on the CPU, many times
  // slower. On CUDA and Metal, flash attention with an 8-bit KV cache halves
  // the context's memory (16K on a 3B model: ~1.7 GB to ~0.9 GB). On a
  // small NVIDIA GPU (6 GB or less) the image reader also stays on the CPU,
  // as it is only used for requests with an image.
  let vram = null;
  if (backend === "cuda" || backend === "metal") args.push("-fa", "on", "-ctk", "q8_0", "-ctv", "q8_0");
  if (backend === "cuda") {
    vram = await nvidiaMemory();
    if (record.mmprojPath && vram && vram.total <= 6144) args.push("--no-mmproj-offload");
  }

  const sep = path.delimiter;
  const env = { ...process.env, LD_LIBRARY_PATH: [...libDirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(sep) };
  if (process.platform === "win32") env.PATH = [...libDirs, process.env.PATH].filter(Boolean).join(sep);

  // A GPU build whose GPU library does not load (an NVIDIA driver too old
  // for its CUDA version, a missing runtime file) still starts, silently on
  // the CPU. Its device list shows that before the model is loaded:
  // "CUDA0: NVIDIA GeForce RTX 3050 Laptop GPU (4095 MiB, 3354 MiB free)".
  let devices = [];
  if (gpu) {
    const { execFile } = require("child_process");
    const out = await new Promise((resolve) => execFile(binaryPath, ["--list-devices"], { env, timeout: 30000, windowsHide: true }, (e, so, se) => resolve(`${so || ""}\n${se || ""}`)));
    devices = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Za-z]+\d+:/.test(l));
    const kind = { cuda: /^CUDA/i, vulkan: /^Vulkan/i, metal: /^(Metal|MTL)/i }[backend];
    if (kind && !devices.some((d) => kind.test(d))) {
      const hint = backend === "cuda" ? " Update the NVIDIA driver (this build needs one made for CUDA 12.4 or newer)." : "";
      throw new Error(`The ${backend} build sees no GPU${devices.length ? ` (only: ${devices.join("; ")})` : ""}.${hint}`);
    }
  }
  const proc = spawn(binaryPath, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  hookExit();
  writePid(proc.pid);
  starting = proc;

  let startupLog = "";
  // "offloaded 29/29 layers to GPU": read as it streams, since the kept
  // tail of the log can be past it by the time the server is ready.
  let offload = null;
  const details = [];
  const capture = (buf) => {
    startupLog = (startupLog + buf.toString()).slice(-16000);
    const m = !offload && startupLog.match(/offloaded (\d+)\/(\d+) layers to GPU/);
    if (m) offload = { layers: Number(m[1]), of: Number(m[2]) };
    // The lines that say where the model went (GPU found, its free memory,
    // layers, buffer sizes, memory fitting), kept for the Local AI tab.
    for (const line of buf.toString().split(/\r?\n/)) {
      if (details.length < 40 && /offload|CUDA|Vulkan|VRAM|fit|device|layers|buffer size|KV|n_ctx|MiB/i.test(line)) details.push(line.trim().slice(0, 240));
    }
  };
  proc.stdout.on("data", capture);
  proc.stderr.on("data", capture);

  const exited = new Promise((resolve) => proc.once("exit", (code) => resolve(code)));

  try {
    await Promise.race([
      waitForHealth(port),
      exited.then((code) => {
        throw new Error(`The built-in model server (${backend}) exited before starting (code ${code}).\n${startupLog.slice(-800)}`);
      }),
    ]);
  } catch (error) {
    try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    clearPid();
    throw error;
  } finally {
    if (starting === proc) starting = null;
  }

  if (backend === "cuda") {
    const after = await nvidiaMemory();
    if (after) details.unshift(`GPU memory: ${after.used} of ${after.total} MB in use after loading (${vram ? `${vram.used} MB before` : "before unknown"}).`);
  }
  if (gpu) details.unshift(...devices.map((d) => `GPU found: ${d}`));
  if (gpu) details.unshift(`Started with: ${args.filter((a, i) => !["-m", "--mmproj"].includes(args[i - 1])).join(" ")}`);
  return { proc, port, offload, details };
};

const ensureRunning = async (catalogueId) => {
  if (current?.catalogueId === catalogueId) return current;
  if (switching?.catalogueId === catalogueId) return switching.promise;

  const promise = (async () => {
    const record = await resolveRecord(catalogueId);
    await stopCurrent();

    const setting = await gpuSetting();
    const detected = setting === "off" ? { backends: [], note: "GPU turned off in settings" } : await detectGpu();
    const tries = [...detected.backends.filter((b) => !gpuFailed || gpuFailed.backend !== b), "cpu"];

    let started = null;
    let lastError = null;
    for (const backend of tries) {
      try {
        started = { backend, ...(await launch(record, backend)) };
        break;
      } catch (error) {
        lastError = error;
        if (backend !== "cpu") {
          gpuFailed = { backend, reason: String(error.message || error).split("\n").slice(0, 3).join(" ").slice(0, 400), at: Date.now() };
          console.error(`Built-in model: the ${backend} GPU build did not start, using the CPU. ${gpuFailed.reason}`);
        }
      }
    }
    if (!started) throw lastError;

    const gpuNote = started.backend === "cpu"
      ? (gpuFailed ? `GPU (${gpuFailed.backend}) failed: ${gpuFailed.reason}` : detected.note)
      : detected.note;
    device = { backend: started.backend, offload: started.offload, note: gpuNote, details: started.details };
    if (started.backend !== "cpu") console.log(`Built-in model: running on the GPU (${started.backend}${started.offload ? `, ${started.offload.layers}/${started.offload.of} layers` : ""}).\n  ${started.details.join("\n  ")}`);

    const { proc, port } = started;
    const loaded = { catalogueId, port, proc };
    current = loaded;
    proc.once("exit", () => {
      if (current?.proc === proc) { current = null; device = null; clearPid(); }
    });

    return loaded;
  })();

  switching = { catalogueId, promise };
  try {
    return await promise;
  } finally {
    if (switching?.promise === promise) { switching = null; stage = null; }
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

// What the built-in model is doing, for Performance → Local AI: the
// requests waiting their turn or running now, and the last LOG_SIZE that
// finished (how long they waited, how long they took, tokens a second).
const LOG_SIZE = 50;
const jobs = new Map(); // id -> { id, feature, model, state, queuedAt, startedAt, promptTokens, maxTokens, image }
const log = [];
let nextId = 1;
let loadedAt = null;

const finish = (job, state, extra = {}) => {
  if (!jobs.has(job.id)) return;
  jobs.delete(job.id);
  const endedAt = Date.now();
  const ms = job.startedAt ? endedAt - job.startedAt : 0;
  const done = { ...job, state, endedAt, waitMs: (job.startedAt || endedAt) - job.queuedAt, ms, ...extra };
  if (done.completionTokens && ms) done.tokensPerSecond = Number((done.completionTokens / (ms / 1000)).toFixed(1));
  log.unshift(done);
  log.length = Math.min(log.length, LOG_SIZE);
};

// `signal`: the caller's stop. A stopped request leaves the queue at once,
// whether it is waiting its turn or already generating.
const complete = async ({ model: catalogueId, system, prompt, maxTokens, json, schema, schemaName, imageBase64, imageMimeType, signal, feature }) => {
  if (!catalogueId) {
    throw new Error("No built-in model is selected. Download and pick one in AI settings.");
  }

  const entry = CATALOGUE.find((m) => m.id === catalogueId);
  if (imageBase64 && !entry?.vision) {
    throw new Error(
      `"${entry?.label || catalogueId}" is a text-only built-in model and cannot see images. Pick one of the vision models in AI settings for this.`
    );
  }

  const answerTokens = budget({ system, prompt, imageBase64, maxTokens });
  const job = {
    id: nextId++, feature: feature || null, model: catalogueId, state: "waiting", queuedAt: Date.now(), startedAt: null,
    promptTokens: estimate(system) + estimate(prompt), maxTokens: answerTokens, image: Boolean(imageBase64),
  };
  jobs.set(job.id, job);
  const onStop = () => { if (job.state === "waiting") finish(job, "stopped"); };
  signal?.addEventListener("abort", onStop, { once: true });

  try {
    return await enqueue(async () => {
      const { StoppedError } = require("./providers");
      if (signal?.aborted) throw new StoppedError();
      job.startedAt = Date.now();
      if (current?.catalogueId !== catalogueId) job.state = "loading";
      const { port } = await ensureRunning(catalogueId);
      if (job.state === "loading") loadedAt = Date.now();
      job.state = "generating";

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
        maxTokens: answerTokens,
        json,
        schema,
        schemaName,
        imageBase64,
        imageMimeType,
        signal,
      });

      finish(job, "done", {
        promptTokens: result.promptTokens || job.promptTokens,
        completionTokens: result.completionTokens || 0,
        finishReason: result.finishReason || null,
      });
      // openAiCompatible reports llama-server's own `model` field, which is
      // the on-disk file path — replaced with the stable catalogue id, same
      // as every other field of `result` (text/promptTokens/completionTokens/
      // finishReason), which pass through unchanged.
      return { ...result, model: catalogueId };
    });
  } catch (error) {
    finish(job, error?.stopped || signal?.aborted ? "stopped" : "failed", { error: String(error?.message || error).slice(0, 300) });
    throw error;
  } finally {
    signal?.removeEventListener("abort", onStop);
  }
};

// llama-server's own view of the running request: tokens written so far.
// Field names moved between llama.cpp versions, so both are read.
const slotProgress = async (port) => {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/slots`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return null;
    const slots = await res.json();
    const busy = (Array.isArray(slots) ? slots : []).find((sl) => sl.is_processing || sl.state === 1);
    if (!busy) return null;
    const next = Array.isArray(busy.next_token) ? busy.next_token[0] : busy.next_token;
    const written = Number(next?.n_decoded ?? busy.n_decoded ?? 0);
    return { written, promptTokens: Number(busy.n_prompt_tokens ?? busy.n_prompt_tokens_processed ?? 0) || null };
  } catch {
    return null;
  }
};

const activity = async () => {
  const os = require("os");
  const now = Date.now();
  const list = [...jobs.values()].sort((a, b) => a.queuedAt - b.queuedAt);
  const running = list.find((j) => j.state !== "waiting") || null;
  let progress = null;
  if (running?.state === "generating" && current?.port) {
    progress = await slotProgress(current.port);
    if (progress && running.startedAt) {
      const secs = (now - running.startedAt) / 1000;
      progress.tokensPerSecond = progress.written && secs ? Number((progress.written / secs).toFixed(1)) : null;
      progress.phase = progress.written ? "writing" : "reading the prompt";
    }
  }
  const recent = log.filter((l) => l.state === "done" && l.tokensPerSecond).slice(0, 10);
  const avg = recent.length ? Number((recent.reduce((t, l) => t + l.tokensPerSecond, 0) / recent.length).toFixed(1)) : null;
  return {
    now,
    server: current ? { model: current.catalogueId, port: current.port, pid: current.proc?.pid || null, loadedAt, device } : null,
    gpuFailed,
    starting: Boolean(starting),
    stage,
    context: CONTEXT,
    machine: { cpus: os.cpus().length, freeMemGb: Number((os.freemem() / 1e9).toFixed(1)), totalMemGb: Number((os.totalmem() / 1e9).toFixed(1)) },
    running: running ? { ...running, progress } : null,
    waiting: list.filter((j) => j.state === "waiting"),
    log,
    averageTokensPerSecond: avg,
  };
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

module.exports = { complete, unload, getStatus, activity, resetGpu };
