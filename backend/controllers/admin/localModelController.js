const asyncHandler = require("express-async-handler");
const AiConfig = require("../../models/aiConfigModel");

// Ollama exposes /api/tags and /api/pull alongside the OpenAI-compatible
// /v1 endpoints, so a model can be installed from the panel rather than the
// buyer being sent to a terminal.
//
// LM Studio and vLLM do not offer this. When the check fails the interface
// falls back to showing the command to run, which is the honest answer rather
// than a button that silently does nothing.

// Curated rather than exhaustive. Each entry says what it is actually good
// for here, because "14b" tells a teacher nothing about whether it can mark an
// essay. Sizes are the quantised download Ollama serves by default.
const CATALOGUE = [
  {
    name: "qwen2.5:3b",
    label: "Qwen 2.5 · 3B",
    sizeGb: 1.9,
    ramGb: 4,
    good: ["Explaining wrong answers (short ones)", "Basic question generation"],
    weak: ["Grading written work", "Long or complex generation"],
    note: "Under 2 GB — for hardware too limited to run anything else on this list. Good enough for basic AI help; expect more retries than the bigger Qwen models below.",
  },
  {
    name: "qwen2.5:7b",
    label: "Qwen 2.5 · 7B",
    sizeGb: 4.7,
    ramGb: 8,
    good: ["Explaining wrong answers", "Simple question generation"],
    weak: ["Grading written work"],
    note: "The smallest all-round option. Fast on a laptop.",
  },
  {
    name: "qwen2.5:14b",
    label: "Qwen 2.5 · 14B",
    sizeGb: 9,
    ramGb: 16,
    good: ["Question generation", "Writing solutions", "Explaining mistakes"],
    weak: ["Grading long written answers"],
    note: "The best balance for most installs. Start here.",
    recommended: true,
  },
  {
    name: "qwen2.5:32b",
    label: "Qwen 2.5 · 32B",
    sizeGb: 20,
    ramGb: 32,
    good: ["Everything, including grading written answers"],
    weak: [],
    note: "Reliable enough to mark against a rubric. Needs a real GPU.",
  },
  {
    name: "llama3.1:8b",
    label: "Llama 3.1 · 8B",
    sizeGb: 4.7,
    ramGb: 8,
    good: ["Explaining wrong answers", "Writing solutions"],
    weak: ["Grading written work", "Maths-heavy subjects"],
    note: "Strong general English. Weaker at mathematics than Qwen.",
  },
  {
    name: "mistral-nemo:12b",
    label: "Mistral Nemo · 12B",
    sizeGb: 7.1,
    ramGb: 16,
    good: ["Question generation", "Translation"],
    weak: ["Grading written work"],
    note: "Good with languages other than English.",
  },
  {
    name: "gemma2:27b",
    label: "Gemma 2 · 27B",
    sizeGb: 16,
    ramGb: 32,
    good: ["Question generation", "Grading with a clear rubric"],
    weak: [],
    note: "Careful and literal. Follows a rubric closely.",
  },
];

// A pull runs for minutes, so the request that starts it returns immediately
// and the interface polls. Held in memory: a restart mid-pull loses the
// progress display, not the download, which Ollama continues on its own.
const pulls = new Map();

const ollamaBase = (config) => {
  const base = (config.baseUrl || "").replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return base || null;
};

const reach = async (url, options = {}, timeoutMs = 4000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

//@desc   Which models are installed locally, and what else is worth having
//@route  GET /api/ai/local/models
//@access Private, admin
const getLocalModels = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  const base = ollamaBase(config);

  if (config.provider !== "custom" || !base) {
    res.status(200).json({
      reachable: false,
      reason: "Set the provider to local and give an address first.",
      catalogue: CATALOGUE,
      installed: [],
    });
    return;
  }

  try {
    const response = await reach(`${base}/api/tags`);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const installed = (data.models || []).map((m) => ({
      name: m.name,
      sizeGb: m.size ? Number((m.size / 1e9).toFixed(1)) : null,
      modifiedAt: m.modified_at,
    }));

    res.status(200).json({
      reachable: true,
      // Anything not recognised as Ollama still works for inference; it just
      // cannot be managed from here.
      manageable: true,
      catalogue: CATALOGUE,
      installed,
      pulls: [...pulls.entries()].map(([name, state]) => ({ name, ...state })),
    });
  } catch (error) {
    res.status(200).json({
      reachable: false,
      reason:
        error.name === "AbortError"
          ? "That address did not respond."
          : "Could not reach a model server at that address.",
      catalogue: CATALOGUE,
      installed: [],
    });
  }
});

//@desc   Start downloading a model
//@route  POST /api/ai/local/pull
//@access Private, admin
const pullModel = asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name) {
    res.status(400);
    throw new Error("Which model?");
  }

  // Only models from the catalogue. This endpoint hands a string to another
  // service on the same host, so it is not a free-text passthrough.
  if (!CATALOGUE.some((m) => m.name === name)) {
    res.status(400);
    throw new Error("That model is not in the list.");
  }

  if (pulls.get(name)?.status === "downloading") {
    res.status(200).json({ message: "Already downloading.", name });
    return;
  }

  const config = await AiConfig.get();
  const base = ollamaBase(config);

  if (!base) {
    res.status(400);
    throw new Error("No local model server address is configured.");
  }

  pulls.set(name, { status: "downloading", percent: 0, startedAt: Date.now() });

  // Deliberately not awaited. Ollama streams NDJSON progress for as long as
  // the download runs, and the caller must not be held open for it.
  (async () => {
    try {
      const response = await reach(
        `${base}/api/pull`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, stream: true }),
        },
        1000 * 60 * 60
      );

      if (!response.ok || !response.body) {
        pulls.set(name, { status: "failed", error: `HTTP ${response.status}` });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.error) {
              pulls.set(name, { status: "failed", error: event.error });
              return;
            }
            const percent =
              event.total && event.completed
                ? Math.round((event.completed / event.total) * 100)
                : pulls.get(name)?.percent || 0;

            pulls.set(name, { status: "downloading", percent, stage: event.status });
          } catch {
            // a partial line, picked up on the next read
          }
        }
      }

      pulls.set(name, { status: "done", percent: 100, finishedAt: Date.now() });
    } catch (error) {
      pulls.set(name, { status: "failed", error: error.message });
    }
  })();

  res.status(202).json({ message: `Downloading ${name}.`, name });
});

//@desc   How a download is going
//@route  GET /api/ai/local/pull-status
//@access Private, admin
const getPullStatus = asyncHandler(async (req, res) => {
  res.status(200).json({
    pulls: [...pulls.entries()].map(([name, state]) => ({ name, ...state })),
  });
});

module.exports = { getLocalModels, pullModel, getPullStatus, CATALOGUE };
