// One interface, four adapters. The `custom` adapter speaks the OpenAI chat
// completions protocol against any base URL, which is what Ollama, LM Studio,
// vLLM, llama.cpp, LocalAI, OpenRouter, Groq and Together all expose — so
// every self-hosted option is covered by that one implementation.
//
// Adapters return a normalised shape and never throw provider-specific errors
// upward. Everything above this file is provider-agnostic.

// A local 8B model on a machine without a GPU spends minutes just reading a
// prompt before it emits a token, and a grammar-constrained response is slower
// still. Two minutes cut those requests off mid-generation and reported them as
// failures, which is how a run of ten sections produced nothing at all while
// the model was working the whole time.
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 15 * 60 * 1000;

// Thrown when the caller stops a call (a document run's Stop button) — told
// apart from a timeout, which also aborts, so neither is reported as the other.
class StoppedError extends Error {
  constructor() {
    super("Stopped.");
    this.stopped = true;
  }
}

// `signal` (optional) is the caller's own AbortSignal: aborting it drops the
// request at once instead of letting a long generation run to the end.
// `untrusted`: the address came from a student (their own AI server), so
// it goes through utils/safeUrl.js's guarded fetch instead.
const request = async (url, options, signal, untrusted = false) => {
  if (signal?.aborted) throw new StoppedError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onStop = () => controller.abort();
  signal?.addEventListener("abort", onStop, { once: true });

  // The timer has to be cleared on every path. Left pending it keeps the event
  // loop alive for its full duration after the request has already returned —
  // at fifteen minutes that is a process that will not exit, and in a server it
  // is a leaked timer per call.
  try {
    const response = untrusted
      ? await require("../../utils/safeUrl").safeFetch(url, { ...options, signal: controller.signal })
      : await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      // A local server that is up but misconfigured often returns html.
      throw new Error(
        `The provider returned a non-JSON response (HTTP ${response.status}). Check the base URL.`
      );
    }

    if (!response.ok) {
      // Providers put the useful part in different places, and some return a
      // bare string. "HTTP 400" on its own tells nobody anything.
      // Cloudflare sends { errors: [{ message }] }; vLLM/FastAPI { detail }.
      const listed = Array.isArray(body.errors) ? body.errors.map((e) => (typeof e === "string" ? e : e?.message)).filter(Boolean).join("; ") : "";
      const detail =
        (typeof body.error === "string" && body.error) ||
        (body.error && (body.error.message || body.error.type)) ||
        body.message ||
        listed ||
        (typeof body.detail === "string" && body.detail) ||
        `HTTP ${response.status}`;

      const error = new Error(detail);
      error.status = response.status;
      throw error;
    }

    return body;
  } catch (error) {
    if (signal?.aborted) throw new StoppedError();
    if (error.name === "AbortError") {
      throw new Error(
        `The provider did not respond within ${Math.round(TIMEOUT_MS / 60000)} minutes. ` +
        `A local model on a machine without a GPU can be slower than this — raise AI_TIMEOUT_MS if so.`
      );
    }

    // Node wraps network errors as `TypeError: fetch failed` and buries the
    // real code one or two levels down in `cause`. Surfacing "fetch failed" to
    // someone whose local model server is not running tells them nothing.
    let cause = error;
    const codes = [];
    while (cause) {
      if (cause.code) codes.push(cause.code);
      cause = cause.cause;
    }

    if (codes.includes("ECONNREFUSED")) {
      throw new Error("Could not reach the provider. Is it running at that base URL?");
    }
    if (codes.includes("ENOTFOUND") || codes.includes("EAI_AGAIN")) {
      throw new Error("Could not resolve that host. Check the base URL.");
    }
    if (codes.includes("ECONNRESET") || codes.includes("EPIPE")) {
      throw new Error("The connection to the provider dropped. Try again.");
    }
    if (codes.some((c) => String(c).startsWith("CERT_") || c === "DEPTH_ZERO_SELF_SIGNED_CERT")) {
      throw new Error("The provider's TLS certificate was rejected. Check the base URL.");
    }

    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onStop);
  }
};

// ---------------------------------------------------------------- openai
// Also serves every OpenAI-compatible endpoint, local or hosted.
// Structured output comes in three flavours and no two servers agree.
//
//   json_schema  constrains generation token by token, so the model cannot
//                emit an invalid shape. LM Studio and current OpenAI support
//                it, and it is what makes a small model usable here.
//   json_object  asks for valid json but constrains nothing. Older OpenAI and
//                anything mimicking it.
//   none         the prompt asks and the schema check downstream catches it.
//
// The best mode a given address accepts is discovered once and remembered, so
// a twenty section document does not pay for the same rejection twenty times.
const MODES = ["json_schema", "json_object", "none"];

const structuredMode = new Map();

// Reasoning-family models — o1, o3, o4, and the gpt-5.x line — reject two
// parameters every other model on this endpoint accepts without complaint:
// max_tokens (they want max_completion_tokens instead) and any temperature
// other than their own default (so it has to be omitted, not set to 0.3).
// Naming a fixed list of "reasoning models" here would need updating every
// time OpenAI ships another one, and the codebase has already solved this
// once for structured-output modes — so this reacts to what the api actually
// says instead, the same way, and remembers the answer per model.
const quirks = new Map();

const looksLikeTokenParamRejection = (message) =>
  /max_tokens/i.test(message) && /max_completion_tokens/i.test(message);

const looksLikeTemperatureRejection = (message) =>
  /temperature/i.test(message) && /(not supported|only the default|only support)/i.test(message);

const looksLikeReasoningEffortRejection = (message) => /reasoning[_ ]effort/i.test(message);

const looksLikeFormatRejection = (message) =>
  // "Bad input" / "invalid": Cloudflare's wording when a model can't take
  // the format, e.g. "AiError: Bad input: … required properties …".
  /response_format|json_object|json_schema|schema|unsupported|not supported|must be|bad input|invalid|required propert/i.test(message);

const applyMode = (body, mode, schema, schemaName) => {
  if (mode === "json_schema" && schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: schemaName || "response", strict: true, schema },
    };
    return true;
  }
  if (mode === "json_object") {
    body.response_format = { type: "json_object" };
    return true;
  }
  return false;
};

const openAiCompatible = {
  defaultBaseUrl: "https://api.openai.com/v1",

  // reasoningEffort ("low" …): for a reasoning-family model, how much of the
  // token budget it may spend thinking before it writes. Long transcription
  // and extraction calls ask for "low" — otherwise hidden reasoning eats the
  // budget and the visible output stops early. Only sent once this model is
  // known to be reasoning-family (it asked for max_completion_tokens), and
  // dropped for good if the server rejects it.
  async complete({ baseUrl, apiKey, model, system, prompt, maxTokens, json, schema, schemaName, imageBase64, imageMimeType, reasoningEffort, signal, untrusted = false }) {
    const quirkKey = `${baseUrl}::${model}`;
    let quirk = quirks.get(quirkKey) || { tokenParam: "max_tokens", dropTemperature: false, dropReasoningEffort: false };

    const userContent = imageBase64
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
        ]
      : prompt;

    const buildBody = () => {
      const body = {
        model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: userContent },
        ],
        [quirk.tokenParam]: maxTokens,
      };
      // Omitted rather than set to 1: some reasoning models reject the
      // parameter outright even at their own default value.
      if (!quirk.dropTemperature) body.temperature = 0.3;
      if (reasoningEffort && quirk.tokenParam === "max_completion_tokens" && !quirk.dropReasoningEffort) {
        body.reasoning_effort = reasoningEffort;
      }
      return body;
    };

    const headers = {
      "Content-Type": "application/json",
      // Local servers ignore this, and sending a placeholder is harmless.
      Authorization: `Bearer ${apiKey || "not-needed"}`,
    };

    const url = `${baseUrl}/chat/completions`;

    // Structured output is an optimisation, never a requirement: the prompt
    // asks for json and the schema check downstream is what guarantees it. So
    // a server rejecting a mode must degrade, not fail the call.
    // Remembered per address and model: one weak model on a shared address
    // (Cloudflare, OpenRouter) mustn't downgrade the others.
    const modeKey = `${baseUrl}|${model}`;
    let modes = json
      ? MODES.slice(MODES.indexOf(structuredMode.get(modeKey) || "json_schema"))
      : ["none"];

    // Without a schema there is nothing to constrain against.
    if (!schema) modes = modes.filter((m) => m !== "json_schema");

    const runModesLoop = async (body) => {
      let lastError;
      for (let i = 0; i < modes.length; i += 1) {
        const mode = modes[i];
        delete body.response_format;
        applyMode(body, mode, schema, schemaName);

        try {
          const result = await request(url, { method: "POST", headers, body: JSON.stringify(body) }, signal, untrusted);
          // Only a call that actually asked for JSON teaches this cache
          // anything. A plain call is forced to mode "none" regardless of
          // what the address supports (see `modes` above) — recording that
          // unconditionally would read as "this address can't do
          // json_schema" and wrongly downgrade every later call that does
          // ask for it, for the rest of the process's life.
          if (json) structuredMode.set(modeKey, mode);
          return result;
        } catch (error) {
          lastError = error;
          const isLastMode = i === modes.length - 1;
          // A bare 400 with no reason may be the JSON format too: try the
          // weaker modes before giving up.
          const rejectedFormat = error.status === 400 && (looksLikeFormatRejection(error.message) || /^HTTP 400$/.test(error.message));

          if (isLastMode || !rejectedFormat) throw error;
          // Fall through to the next, weaker mode.
        }
      }
      throw lastError;
    };

    // Up to three attempts: the request as understood today, then one retry
    // per quirk this model turns out to have. OpenAI's api reports only the
    // first violation it finds in a request, so a model needing both
    // corrections only reveals the second one after the first has already
    // been applied and retried.
    let data;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        data = await runModesLoop(buildBody());
        break;
      } catch (error) {
        if (error.status === 400 && looksLikeReasoningEffortRejection(error.message) && !quirk.dropReasoningEffort) {
          quirk = { ...quirk, dropReasoningEffort: true };
          continue;
        }
        if (error.status === 400 && looksLikeTokenParamRejection(error.message) && quirk.tokenParam !== "max_completion_tokens") {
          quirk = { ...quirk, tokenParam: "max_completion_tokens" };
          continue;
        }
        if (error.status === 400 && looksLikeTemperatureRejection(error.message) && !quirk.dropTemperature) {
          quirk = { ...quirk, dropTemperature: true };
          continue;
        }
        throw error;
      }
    }

    quirks.set(quirkKey, quirk);

    const choice = data.choices && data.choices[0];

    if (!choice || !choice.message) {
      throw new Error("The provider returned no completion.");
    }

    return {
      text: choice.message.content || "",
      // Thinking models (local ones especially) report their reasoning
      // apart from the answer; kept for when the answer comes back empty.
      reasoning: choice.message.reasoning_content || choice.message.reasoning || "",
      promptTokens: data.usage ? data.usage.prompt_tokens : 0,
      completionTokens: data.usage ? data.usage.completion_tokens : 0,
      model: data.model || model,
      finishReason: choice.finish_reason,
    };
  },
};

// ---------------------------------------------------------------- anthropic
const anthropic = {
  defaultBaseUrl: "https://api.anthropic.com/v1",

  async complete({ baseUrl, apiKey, model, system, prompt, maxTokens, imageBase64, imageMimeType, signal }) {
    const userContent = imageBase64
      ? [
          { type: "image", source: { type: "base64", media_type: imageMimeType, data: imageBase64 } },
          { type: "text", text: prompt },
        ]
      : prompt;

    const data = await request(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        // Required here, unlike the chat completions protocol.
        max_tokens: maxTokens || 2000,
        temperature: 0.3,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: userContent }],
      }),
    }, signal);

    const block = (data.content || []).find((c) => c.type === "text");

    if (!block) {
      throw new Error("The provider returned no completion.");
    }

    return {
      text: block.text || "",
      promptTokens: data.usage ? data.usage.input_tokens : 0,
      completionTokens: data.usage ? data.usage.output_tokens : 0,
      model: data.model || model,
      finishReason: data.stop_reason,
    };
  },
};

// ---------------------------------------------------------------- gemini
const gemini = {
  defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",

  async complete({ baseUrl, apiKey, model, system, prompt, maxTokens, json, schema, schemaName, imageBase64, imageMimeType, signal }) {
    const parts = imageBase64
      ? [{ text: prompt }, { inline_data: { mime_type: imageMimeType, data: imageBase64 } }]
      : [{ text: prompt }];

    const data = await request(
      `${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: maxTokens,
            ...(json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
      signal
    );

    const candidate = data.candidates && data.candidates[0];

    if (!candidate || !candidate.content) {
      // A safety block returns a candidate with no content rather than an error.
      const reason = candidate ? candidate.finishReason : "unknown";
      throw new Error(`The provider returned no completion (${reason}).`);
    }

    const text = (candidate.content.parts || []).map((p) => p.text || "").join("");
    const usage = data.usageMetadata || {};

    return {
      text,
      promptTokens: usage.promptTokenCount || 0,
      completionTokens: usage.candidatesTokenCount || 0,
      model,
      finishReason: candidate.finishReason,
    };
  },
};

// The zero-install option — a GGUF model running inside this same Node
// process instead of any HTTP endpoint. Its `.complete()` shape matches
// every other adapter's (same inputs, same { text, promptTokens,
// completionTokens, model, finishReason } return), but everything below
// this file treats it as just another provider; only loadConfig() in
// ai/service.js knows it needs neither a baseUrl nor an apiKey.
const embedded = require("../embedded");

const ADAPTERS = {
  openai: openAiCompatible,
  custom: openAiCompatible,
  anthropic,
  gemini,
  embedded,
};

const getAdapter = (provider) => {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`Unknown provider "${provider}".`);
  }
  return adapter;
};

// Cleared when settings change, so a new address is negotiated afresh.
const resetStructuredMode = () => {
  structuredMode.clear();
  quirks.clear();
};

module.exports = { getAdapter, ADAPTERS, resetStructuredMode, structuredMode, quirks, MODES, StoppedError };
