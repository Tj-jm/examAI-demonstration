const { zodToJsonSchema } = require("zod-to-json-schema");
const AiConfig = require("../models/aiConfigModel");
const AiUsage = require("../models/aiUsageModel");
const mongoose = require("mongoose");
const AiCredit = require("../models/aiCreditModel");
const { track } = require("./chargeScope");
const { getAdapter, StoppedError } = require("./providers");
const router = require("./router");
const { repairJson, restoreLatex } = require("./repairJson");
const { deepWrapLatex } = require("./wrapLatex");
const { sumCostToday, getDailyCap, getCreditBalances } = require("./usage");
const storage = require("../adapters/storage");
const { resolveOwnMediaKey } = require("../utils/mediaUrl");

// Everything that calls a model goes through here. Callers pass a prompt and
// optionally a Zod schema; they never touch an adapter, never see an api key,
// and never have to remember to log usage or enforce a cap.

// An imageUrl is read here, once, provider-agnostic — every adapter takes
// the same base64 + mime type and formats it into whichever shape its own
// API expects. Failing loudly rather than silently continuing text-only: a
// student who attached a photo expects it to be part of the answer, and a
// correct-looking response that quietly ignored their image is worse than
// an error saying so.
//
// This never does a raw network fetch of imageUrl. imageUrl reaches here
// from student-controlled fields (a doubt's questionImage, a written
// answer's answerImages) that used to be handed straight to fetch() — an
// unauthenticated SSRF primitive, since a student could set either to
// "http://169.254.169.254/..." or any other internal address and have the
// server request it on their behalf. Every image is instead read through
// this deployment's own storage driver, keyed off the url this app itself
// issued when the file was uploaded; anything else is refused. Those
// fields are also validated at write time (see mediaUrl.js's
// assertOwnMediaUrl, used in doubtController/practiceController/
// submissionController) so a non-own url is rejected long before it would
// ever reach here — this is the second, independent layer.
const fetchImageAsBase64 = async (imageUrl) => {
  const key = resolveOwnMediaKey(imageUrl);
  if (!key) {
    throw new Error("That image isn't hosted by this app and can't be used.");
  }

  let buffer;
  try {
    buffer = await storage.get(key);
  } catch (error) {
    throw new Error(`Could not read the attached image: ${error.message}`);
  }

  return { base64: buffer.toString("base64"), mimeType: storage.mimeTypeFor(key) };
};

// Rough per-million-token rates, used only for the spend dashboard. Local
// models cost nothing, which is the point of supporting them.
//
// This table will always be behind — a provider can reprice or rename a
// model at any time, and this code doesn't call out to check. It only ever
// covers the handful of models common enough to be worth hardcoding; a model
// released after this table was last touched isn't guessed at (see the
// !key branch below), it's flagged instead (aiController.js's shapeConfig)
// so an admin sees "cost isn't tracked for this model" rather than trusting
// a silent $0. The Pricing override in Settings always wins over this table
// regardless — that's the one number that can't go stale, since the admin
// is the one who typed it in.
const PRICING = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "o3-mini": { in: 1.1, out: 4.4 },
  "claude-opus-4-1": { in: 15, out: 75 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gemini-1.5-pro": { in: 1.25, out: 5 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
};

// Longest match wins. "gpt-4o-mini" contains "gpt-4o", so matching on the
// first key that fits bills the cheap model at the expensive one's rate —
// about sixteen times too high, and silently, since nothing else reads this.
const findPricingRate = (model) => {
  const key = Object.keys(PRICING)
    .filter((k) => String(model).includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICING[key] : null;
};

const estimateCost = (provider, model, promptTokens, completionTokens, pricing) => {
  // Genuinely free — real weights on this server, no metered API on the
  // other end of the call, nothing an admin could override even if they
  // wanted to.
  if (provider === "embedded") return 0;

  // "custom" covers both a free local server (Ollama, LM Studio, vLLM) and a
  // paid API reached the same OpenAI-compatible way (Groq, OpenRouter,
  // DeepSeek, Together) — estimateCost cannot tell those apart from the
  // baseUrl alone, so a manual override (AiConfig.pricing, set in Settings)
  // wins whenever one is present, for any provider, not just "custom": it's
  // also the escape hatch for a hosted model newer than the table below.
  if (pricing && (pricing.inputPerMillion > 0 || pricing.outputPerMillion > 0)) {
    return (promptTokens / 1e6) * pricing.inputPerMillion + (completionTokens / 1e6) * pricing.outputPerMillion;
  }

  const rate = findPricingRate(model);
  if (!rate) return 0;
  return (promptTokens / 1e6) * rate.in + (completionTokens / 1e6) * rate.out;
};

// Settings-screen check, not a billing one: tells the AI config screen
// whether the currently configured model's cost is actually being tracked,
// so "cost shows $0" can be distinguished from "genuinely free" instead of
// looking the same. Mirrors estimateCost's own resolution order rather than
// calling it with fake token counts.
const hasKnownPricing = (provider, model, pricing) => {
  if (provider === "embedded") return true; // correctly free, not a gap
  if (pricing && (pricing.inputPerMillion > 0 || pricing.outputPerMillion > 0)) return true;
  return Boolean(findPricingRate(model));
};

// A "custom" endpoint pointed at a loopback/private address is almost
// certainly the buyer's own hardware (Ollama, LM Studio, vLLM, a rented VPS
// on a private network) rather than a metered public API — genuinely free
// the same way "embedded" is, just reached over HTTP instead of an
// in-process child process. Used only to decide whether the "cost isn't
// tracked" warning is worth showing; a local setup with no pricing set is
// the expected, correct state, not a gap to nag about.
const looksSelfHosted = (baseUrl) => {
  try {
    const { hostname } = new URL(baseUrl);
    return /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(
      hostname
    );
  } catch {
    return false;
  }
};

// Models wrap JSON in prose or fences even when told not to. This pulls the
// object out rather than failing the whole call over formatting.
const extractJson = (text) => {
  let cleaned = String(text).trim();

  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) cleaned = fenced[1].trim();

  // Trimmed to the outermost braces before anything else, so prose either side
  // of the object does not defeat the repair pass.
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));

  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  // The repair runs first, not as a fallback. Escaping mistakes come in two
  // kinds and only one of them fails: "\frac" throws, but "\text" parses
  // cleanly as a tab and the command is gone with nothing to report it. A
  // repair that only runs on failure never sees the second kind.
  //
  // It is safe to run unconditionally because it rewrites an escape only where
  // a known LaTeX command follows, so a genuine tab in prose is untouched.
  try {
    return restoreLatex(JSON.parse(repairJson(cleaned)));
  } catch (repairFailed) {
    try {
      return restoreLatex(JSON.parse(cleaned));
    } catch (original) {
      throw new Error(`The model did not return usable JSON. ${original.message}`);
    }
  }
};

// Trims the question union down to the requested types. A grammar covering
// mcq, mtf and written when only mcq was asked for is work the model pays for
// on every single call.
const narrowToTypes = (jsonSchema, onlyTypes) => {
  if (!Array.isArray(onlyTypes) || onlyTypes.length === 0) return;

  const items = jsonSchema?.properties?.questions?.items;
  if (!items || !Array.isArray(items.anyOf)) return;

  const kept = items.anyOf.filter((branch) => {
    const values = branch?.properties?.type?.enum;
    return Array.isArray(values) && values.some((v) => onlyTypes.includes(v));
  });

  if (kept.length === 0) return;

  if (kept.length === 1) {
    // One type means no union at all, which is the cheapest grammar to build.
    jsonSchema.properties.questions.items = kept[0];
    return;
  }

  items.anyOf = kept;
};

class AiNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 503;
  }
}

class AiCapReachedError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 429;
  }
}

const loadConfig = async () => {
  const config = await AiConfig.get(true);

  if (!config.model) {
    throw new AiNotConfiguredError("No AI model is configured. Set one up in settings.");
  }

  // A key is required for hosted providers. Local servers accept anything
  // (`custom`), and `embedded` has no HTTP endpoint at all to key against,
  // so neither is treated as unconfigured for lacking one.
  const key = config.getApiKey();
  if (config.provider !== "custom" && config.provider !== "embedded" && !key) {
    throw new AiNotConfiguredError("No API key is configured. Add one in settings.");
  }

  const adapter = getAdapter(config.provider);

  // A stored baseUrl belongs to the `custom` provider only. Honouring it for
  // the hosted ones means someone who tried a local model first and then
  // switched to Gemini keeps sending requests to localhost, and every call
  // fails with a connection error that says nothing about the real cause.
  // `embedded` needs no baseUrl at all — it never leaves this process — so
  // it is left empty rather than falling into either branch below.
  const baseUrl =
    config.provider === "embedded"
      ? ""
      : config.provider === "custom"
        ? (config.baseUrl || "").replace(/\/$/, "")
        : (adapter.defaultBaseUrl || "").replace(/\/$/, "");

  if (config.provider === "custom" && !baseUrl) {
    throw new AiNotConfiguredError(
      "A local provider needs an address, such as http://localhost:11434/v1."
    );
  }

  return { config, adapter, baseUrl, apiKey: key };
};

const assertWithinCaps = async (config, { student, batch, feature, spendCap = true }) => {
  const since = new Date(Date.now() - 86400000);
  let useCredit = false;
  let creditScope; // batch id if a batch-specific credit covers this call, null if the general pool does
  const cost = config.getFeatureCost(feature);

  // Every student-facing AI call passes student, and passes batch too — a
  // real id for a batch-scoped call, or explicitly null for the archive
  // (see archiveController.js and friends, all of which call
  // aiService.generate({ ..., batch: null }) on purpose: the archive is its
  // own shared scope, not "no batch context"). `batch !== undefined` routes
  // both through the same daily-allowance + credit-fallback logic —
  // getDailyCap/getCreditBalances (ai/usage.js) are already null-safe by
  // design (a null batch just means "no per-batch bonus, general credit
  // pool only"). This used to read `if (student && batch)`, which is false
  // for `batch: null` — every archive AI call silently skipped both the
  // credit fallback AND ever setting useCredit, so a purchased archive
  // credit was never actually spent, regardless of balance. `undefined`
  // still falls through to the dailyCallsPerStudent-only safety net below,
  // for a hypothetical future caller that omits batch entirely.
  if (student && batch !== undefined) {
    const dailyLimit = await getDailyCap(batch, config);

    if (dailyLimit !== null) {
      const usedToday = await sumCostToday(student, batch);

      // The check is against THIS call's cost fitting in what's left of
      // today's budget, not just "has anything been used" — a cost-1
      // feature and a cost-20 feature both draw from the same 50-point
      // daily allowance, but a cost-20 action has to actually have 20
      // points of room left, not just any room at all. Without the `+
      // cost`, every action only ever cost "1 slot" against the daily
      // counter regardless of its configured cost, which is the exact bug
      // this replaces: a feature priced at 20 would still only move the
      // "used today" number by 1.
      if (usedToday + cost > dailyLimit) {
        // The free allowance for today doesn't have room for this call on
        // this batch specifically — fall back to a purchased credit rather
        // than blocking outright. A batch-specific credit is checked first
        // (use it up before dipping into the general pool), then a
        // general, not-tied-to-any-batch credit as a second fallback. A
        // credit-paid call doesn't count against tomorrow's allowance
        // either; it's a separate pool entirely.
        //
        // Sufficiency is checked against this specific feature's cost, not
        // just "balance > 0" — a pool sitting at 1 credit does not cover a
        // 2-credit call, and the two pools are never combined to make up a
        // shortfall between them.
        const { batchCredits, generalCredits } = await getCreditBalances(student, batch);
        const batchCovers = batchCredits >= cost;
        const generalCovers = !batchCovers && generalCredits >= cost;

        if (!batchCovers && !generalCovers) {
          throw new AiCapReachedError(
            `You have reached today's limit for AI help on this batch. This action costs ${cost} credit${cost === 1 ? "" : "s"} — try again tomorrow, or buy more AI credits.`
          );
        }
        useCredit = true;
        creditScope = batchCovers ? batch : null;
      }
    }
  } else if (student && config.limits.dailyCallsPerStudent > 0) {
    // batch is genuinely undefined here — every current caller passes
    // either a real batch id or explicit null (the archive), so this is a
    // safety net for a hypothetical future caller that omits batch
    // entirely, not a path anything currently takes. No credit fallback on
    // this branch on purpose: there is no meaningful "which pool" to check
    // without knowing whether the caller meant a batch or the archive.
    const usedToday = await sumCostToday(student, undefined);

    if (usedToday + cost > config.limits.dailyCallsPerStudent) {
      throw new AiCapReachedError(
        "You have reached today's limit for AI help. Try again tomorrow."
      );
    }
  }

  if (spendCap && config.limits.dailyCostCapUsd > 0) {
    const spend = await AiUsage.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: "$estimatedCostUsd" } } },
    ]);

    const today = spend.length > 0 ? spend[0].total : 0;

    if (today >= config.limits.dailyCostCapUsd) {
      throw new AiCapReachedError(
        "The daily AI spending limit has been reached. It resets in 24 hours."
      );
    }
  }

  return { useCredit, creditScope, cost };
};

//@desc Run a prompt and return text.
const complete = async ({
  feature,
  system,
  prompt,
  maxTokens,
  json = false,
  jsonSchema = null,
  schemaName = "response",
  student = null,
  user = null,
  batch = null,
  imageUrl = null,
  // Several of this app's images (an answer written over a few photos):
  // sent as one page, stacked in order (utils/photo.js stitchImages).
  imageUrls = null,
  // An image already in memory ({ base64, mimeType }) — a rendered scanned
  // page, say — rather than one hosted by this app.
  image = null,
  // Optional AbortSignal: a stopped run drops the call in flight at once.
  signal = null,
  // Optional: how much a reasoning-family model may think before writing
  // (see providers/index.js). Long document calls ask for "low".
  reasoningEffort = null,
  // Already paid for another way (a course-chat pack the student bought):
  // logged against the student, but no daily allowance and no credit.
  prepaid = false,
}) => {
  const config = await AiConfig.get(true);
  // AI paused on this student's account (admin → Conduct)?
  if (student) await require("../utils/conduct").assertAiAllowed(student);
  // Which model answers (ai/router.js): the main connection.
  const { targets } = await router.targetsFor(config);
  // Named creditCost, not cost — `cost` a few lines down is the estimated
  // USD spend for the dashboard, a completely different number that this
  // one must never be confused with.
  const { useCredit, creditScope, cost: creditCost } = prepaid
    ? { useCredit: false, creditScope: undefined, cost: 0 }
    : await assertWithinCaps(config, { student, batch, feature });

  let imageBase64 = image?.base64 || null;
  let imageMimeType = image?.mimeType || null;
  const urls = (imageUrls || []).filter(Boolean);
  if (!imageBase64 && !urls.length && imageUrl) urls.push(imageUrl);
  if (!imageBase64 && urls.length) {
    const fetched = [];
    for (const u of urls) fetched.push(await fetchImageAsBase64(u));
    const one = fetched.length > 1
      ? await require("../utils/photo").stitchImages(fetched).catch(() => fetched[0])
      : fetched[0];
    imageBase64 = one.base64;
    imageMimeType = one.mimeType;
  }

  const request = {
    system,
    prompt,
    maxTokens: maxTokens || config.limits.maxTokensPerCall,
    json,
    schema: jsonSchema,
    schemaName,
    imageBase64,
    imageMimeType,
    signal,
    reasoningEffort,
    // For the built-in model's activity log (ai/embedded.js); other
    // adapters ignore it.
    feature,
  };

  // Each target in turn: a failure (not a stop) moves on to the next.
  let lastError;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    // A target's main model is never assumed to see images: a call that
    // attaches one uses its vision model when set (Settings → AI), else its
    // main model.
    const model = (imageBase64 && target.visionModel) || target.model;
    const usage = {
      feature,
      provider: target.provider,
      model,
      student,
      user,
      batch,
      fallback: i > 0,
    };
    const started = Date.now();

    try {
      const result = await callWithRetry(target, model, request, signal);

      const cost = estimateCost(target.provider, result.model, result.promptTokens, result.completionTokens, config.pricing);

      // Logged after the call rather than before, so a failure to log never
      // blocks a response the user is waiting on. Same reasoning for the
      // credit decrement — only spent once the call actually succeeded, so a
      // provider-side failure never costs the student a credit for nothing.
      //
      // featureCost is what makes the daily free allowance itself cost-aware
      // (see sumCostToday in ai/usage.js) — logged regardless of whether this
      // particular call was free or paid with a credit, since it's the
      // "how much of today's budget did this take" number either way.
      const usageId = new mongoose.Types.ObjectId();
      const saved = AiUsage.create({
        _id: usageId,
        ...usage,
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        estimatedCostUsd: cost,
        featureCost: creditCost,
        latencyMs: Date.now() - started,
        ok: true,
        paidWithCredit: useCredit,
        creditsSpent: useCredit ? creditCost : 0,
      }).catch(() => {});

      let debited;
      if (useCredit) {
        debited = AiCredit.updateOne(
          { student, batch: creditScope, balance: { $gte: creditCost } },
          { $inc: { balance: -creditCost } }
        ).catch(() => {});
      }

      // Given back if the request this call serves ends in an error (ai/chargeScope.js).
      if (student && creditCost > 0) {
        track({ saved, debited, usageId, student, useCredit, creditScope, creditCost });
      }

      return result;
    } catch (error) {
      AiUsage.create({
        ...usage,
        latencyMs: Date.now() - started,
        ok: false,
        errorMessage: error.message,
      }).catch(() => {});
      lastError = error;
      if (error.stopped || signal?.aborted) throw error;
    }
  }
  throw lastError;
};

// One target, retrying rate limits. Free tiers rate limit aggressively —
// Gemini allows fifteen requests a minute — and a document with twenty
// sections will hit it. A 429 is a wait, not a failure, so it is retried
// with a widening pause rather than reported as a section that produced
// nothing.
const callWithRetry = async (target, model, request, signal) => {
  let attempt = 0;
  for (;;) {
    try {
      return await target.adapter.complete({ baseUrl: target.baseUrl, apiKey: target.apiKey, model, ...request, untrusted: Boolean(target.untrusted) });
    } catch (error) {
      if (error.stopped || signal?.aborted) throw error;
      const rateLimited = /rate limit|quota|429|too many requests|resource.exhausted/i.test(error.message);
      if (!rateLimited || attempt >= 3) throw error;
      attempt += 1;
      // The wait itself ends early on a stop.
      await new Promise((r) => {
        const t = setTimeout(r, attempt * 20000);
        signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
      });
      if (signal?.aborted) throw error;
    }
  }
};

//@desc Bill a student for an AI result served again rather than generated
// (utils/aiReuse.pro.js): the same daily allowance and credits as a real
// call, at the cost of `feature` (its "-saved" key, or the full one), or
// nothing when `free`. No model is called, so the daily spending limit
// doesn't apply. Logged like a call, marked reused, with what generating
// it would have cost (savedUsd) for the Performance page.
// label/provider: what the usage log records, when it isn't a saved AI
// result. The charge is always the cost of `feature`.
const chargeReuse = async ({ feature, label, provider = "saved", student, batch = null, free = false, savedUsd = 0 }) => {
  const config = await AiConfig.get(true);
  if (student) await require("../utils/conduct").assertAiAllowed(student);
  const { useCredit, creditScope, cost } = free
    ? { useCredit: false, creditScope: undefined, cost: 0 }
    : await assertWithinCaps(config, { student, batch, feature, spendCap: false });

  const usageId = new mongoose.Types.ObjectId();
  const saved = AiUsage.create({
    _id: usageId,
    feature: label || feature,
    provider,
    model: provider,
    student,
    batch,
    estimatedCostUsd: 0,
    featureCost: cost,
    latencyMs: 0,
    ok: true,
    paidWithCredit: useCredit,
    creditsSpent: useCredit ? cost : 0,
    reused: true,
    savedUsd,
  }).catch(() => {});

  let debited;
  if (useCredit && cost > 0) {
    debited = AiCredit.updateOne({ student, batch: creditScope, balance: { $gte: cost } }, { $inc: { balance: -cost } }).catch(() => {});
  }
  if (student && cost > 0) {
    track({ saved, debited, usageId, student, useCredit, creditScope, creditCost: cost });
  }
  return { cost, paidWithCredit: useCredit };
};

// What a call's tokens cost in USD with the current settings.
const usageCostUsd = async (usage) => {
  if (!usage) return 0;
  const config = await AiConfig.get();
  return estimateCost(config.provider, usage.model, usage.promptTokens || 0, usage.completionTokens || 0, config.pricing) || 0;
};

//@desc Run a prompt and return output validated against a Zod schema.
// Retries once with the validation error appended, because a model given the
// specific reason its output was rejected usually fixes it on the second try.
// responseSchema (optional) is what the provider is constrained with, when it
// should differ from the schema the output is validated against — e.g. a
// strict per-item shape for decoding, but lenient validation that drops bad
// items instead of rejecting the whole response. allowPartial returns a
// response that still validates on the last attempt even if it was cut off,
// for callers where some output beats none.
// wrapLatex: false skips the $...$ repair below, for output that places
// its own maths (video lesson scripts keep equations without delimiters).
const generate = async ({ schema, responseSchema, allowPartial, wrapLatex = true, ...options }) => {
  if (!schema) {
    throw new Error("generate() requires a schema. Use complete() for free text.");
  }

  // Handed to the provider so a server that supports json_schema can constrain
  // generation token by token. That is what stops a small model writing
  // correctOption as the option's text instead of its key.
  //
  // Narrowed to the types actually asked for. A three-way anyOf makes
  // llama.cpp build a grammar covering every branch, which costs minutes of
  // prompt processing on a small model for branches that will never be used.
  const jsonSchema = zodToJsonSchema(responseSchema || schema, {
    target: "openApi3",
    $refStrategy: "none",
  });

  narrowToTypes(jsonSchema, options.onlyTypes);

  let lastError;
  // A response cut off mid-JSON fails parsing every time, but the generic
  // "your previous response was rejected" retry prompt looks exactly like a
  // validation failure to the model — it has no way to know the real
  // problem was running out of room, and a same-budget retry on a large
  // pool (many questions, each with a "fix" rewrite, non-Latin scripts
  // costing more tokens per character) just truncates again in the same
  // place. Detected here from the provider's own finishReason (OpenAI-style
  // "length", Anthropic "max_tokens", Gemini "MAX_TOKENS") rather than
  // guessed from the parse error, and answered by actually giving the retry
  // more room instead of just asking more firmly for the same amount.
  // Never left undefined past this point — a concrete number here makes the
  // retry bump (below) a real increase over what attempt 0 actually used,
  // instead of guessing at what complete()'s own fallback default was.
  let effectiveMaxTokens = options.maxTokens || 2000;
  let truncated = false;

  // A response can end up short for reasons finishReason never names: a
  // reasoning-family model (o1/o3/gpt-5-thinking and friends) spends part of
  // its token budget on hidden reasoning before it ever writes the visible
  // JSON, so the visible content trails off mid-sentence while the API still
  // reports a clean "stop" — there was room left in the grammar to close the
  // quote and brace, just not to finish the thought. Some OpenAI-compatible
  // proxies also just misreport finish_reason outright. So truncation is
  // decided from two independent signals, either one enough: the provider's
  // own finishReason, OR the call having used essentially its whole token
  // budget — a completion sitting near the ceiling is exactly what a
  // cut-off response looks like regardless of what the provider called it.
  const NEAR_BUDGET_RATIO = 0.92;

  let onlyThought = false;
  let emptyAnswers = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (options.signal?.aborted) throw new StoppedError();
    const prompt =
      attempt === 0
        ? options.prompt
        : onlyThought
          ? `${options.prompt}\n\nYour previous reply was only thinking, with no answer. Do not think step by step this time: reply at once with only the JSON.`
          : truncated
          ? `${options.prompt}\n\nYour previous response was cut off before it finished — it ran out of room, not wrong content. Return the complete, valid JSON this time, and keep any free-text field noticeably shorter than its stated limit so it can't run out of room again.`
          : `${options.prompt}\n\nYour previous response was rejected: ${lastError}\nReturn only valid JSON that fixes that.`;

    const result = await complete({
      ...options,
      prompt,
      maxTokens: effectiveMaxTokens,
      json: true,
      jsonSchema,
      schemaName: options.schemaName || "questions",
    });

    // Computed before the parse attempt, not just on failure — constrained
    // JSON decoding can close out braces and quotes cleanly even after the
    // provider ran out of room mid-sentence inside a string value, so a
    // response can parse and validate successfully while its actual content
    // still trails off mid-thought (a plan summary ending "...despite a").
    // Checked on the success path too, below, precisely to catch that case.
    const reportedTruncated = /length|max_tokens/i.test(String(result.finishReason || ""));
    const usedNearlyWholeBudget =
      effectiveMaxTokens > 0 && result.completionTokens >= effectiveMaxTokens * NEAR_BUDGET_RATIO;
    const providerTruncated = reportedTruncated || usedNearlyWholeBudget;

    // Bigger than a flat 1.6x, and with a floor: a response that filled a
    // 500-token budget still needs real headroom on retry, not 800 tokens —
    // easy for hidden reasoning tokens to eat on their own.
    const bumpedMaxTokens = () => Math.max(Math.round(effectiveMaxTokens * 2), effectiveMaxTokens + 1500);

    // A thinking model can spend its whole reply reasoning and stop with
    // an empty answer. The JSON is sometimes inside the reasoning; if not,
    // the retry asks it to answer straight away.
    const thoughtOnly = !String(result.text || "").trim() && String(result.reasoning || "").trim();
    if (thoughtOnly) emptyAnswers += 1;
    onlyThought = Boolean(thoughtOnly);

    try {
      const parsed = extractJson(thoughtOnly ? result.reasoning : result.text);
      const validated = schema.parse(parsed);
      if (providerTruncated && !(allowPartial && attempt === 2)) {
        lastError = "the response was cut off before it finished";
        truncated = true;
        effectiveMaxTokens = bumpedMaxTokens();
        continue;
      }
      // The model was told to delimit maths with $...$ and, especially on
      // small local models, often just doesn't. This wraps whatever bare
      // LaTeX made it through so every caller gets renderable text back
      // without each one remembering to repair it.
      const data = wrapLatex ? deepWrapLatex(validated) : validated;
      return { data, usage: result, attempts: attempt + 1 };
    } catch (error) {
      lastError = error.errors
        ? error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")
        : error.message;
      truncated = providerTruncated;
      if (truncated) {
        effectiveMaxTokens = bumpedMaxTokens();
      }
    }
  }

  const error = new Error(
    emptyAnswers >= 2
      ? "The model only thought and never answered (its reply was empty). Turn off thinking for this model (in LM Studio: the model's settings, Thinking), or use a larger model."
      : `The model could not produce valid output after multiple attempts. Last problem: ${lastError}`
  );
  error.statusCode = 502;
  throw error;
};

//@desc Verify the configured provider actually answers.
// Meaning vectors for document chat's search (utils/docIndex.js,
// docRetrieve.js). → one vector per text, or null when no embeddings model
// is set (Settings → AI → Document chat) or the provider has none — keyword
// search then works alone. Not billed: indexing is the platform's cost, and
// a question's own vector is a fraction of a cent.
// OpenAI's text-embedding-3 and Gemini's models are asked for 256 numbers
// (they support shortening), which keeps every stored chunk small.
const EMBED_DIMS = 256;
const EMBED_BATCH = 64;
const embed = async (texts) => {
  if (!texts.length) return [];
  const config = await AiConfig.get(true);
  const model = String(config.docChat?.embeddingModel || "").trim();
  if (!model) return null;
  const { baseUrl, apiKey } = await loadConfig();

  const post = async (url, body, headers = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || data.error || `HTTP ${response.status}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  };

  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => String(t).slice(0, 8000));
    if (config.provider === "openai" || config.provider === "custom") {
      const data = await post(
        `${baseUrl}/embeddings`,
        { model, input: batch, ...(/text-embedding-3/.test(model) ? { dimensions: EMBED_DIMS } : {}) },
        { Authorization: `Bearer ${apiKey || "not-needed"}` }
      );
      out.push(...(data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding));
    } else if (config.provider === "gemini") {
      const name = model.startsWith("models/") ? model : `models/${model}`;
      const data = await post(`${baseUrl}/${name}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`, {
        requests: batch.map((text) => ({ model: name, content: { parts: [{ text }] }, outputDimensionality: EMBED_DIMS })),
      });
      out.push(...(data.embeddings || []).map((e) => e.values));
    } else {
      return null;
    }
  }
  return out.length === texts.length && out.every((v) => Array.isArray(v) && v.length) ? out : null;
};

const testConnection = async (overrides = {}) => {
  const started = Date.now();

  try {
    const { config, adapter, baseUrl, apiKey } = await loadConfig();

    const result = await adapter.complete({
      baseUrl: overrides.baseUrl || baseUrl,
      apiKey: overrides.apiKey || apiKey,
      model: overrides.model || config.model,
      prompt: "Reply with the single word: ready",
      maxTokens: 10,
    });

    return {
      ok: true,
      message: `Connected in ${Date.now() - started}ms. Replied: ${result.text.trim().slice(0, 40)}`,
      model: result.model,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, message: error.message, latencyMs: Date.now() - started };
  }
};

module.exports = {
  complete,
  generate,
  chargeReuse,
  usageCostUsd,
  embed,
  testConnection,
  extractJson,
  estimateCost,
  hasKnownPricing,
  looksSelfHosted,
  AiNotConfiguredError,
  AiCapReachedError,
};
