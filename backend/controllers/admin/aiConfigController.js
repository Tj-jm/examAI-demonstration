const asyncHandler = require("express-async-handler");
const AiConfig = require("../../models/aiConfigModel");
const ai = require("../../ai/service");

// Settings → AI: the connection (provider, key, model), the feature switches
// and the rest of the AI settings document, and the connection test. Apart
// from the rest of aiController.js, which is AI content generation.

// Models that are reliable enough to mark written work. Anything else gets a
// warning rather than a block: a buyer owns this install and can decide, but
// they should not find out a 7B model cannot grade by reading forty bad marks.
const GRADING_CAPABLE = [
  "gpt-4o", "gpt-4.1", "o1", "o3",
  "claude-sonnet", "claude-opus",
  "gemini-2.0-pro", "gemini-2.5-pro",
  "70b", "72b", "32b", "mixtral", "qwen2.5:32", "qwen2.5:72",
];

const isGradingCapable = (model) => {
  const name = String(model || "").toLowerCase();
  return GRADING_CAPABLE.some((m) => name.includes(m));
};

const shapeConfig = (config) => {
  const warnings = [];

  if (config.features.writtenGrading && !isGradingCapable(config.model)) {
    warnings.push(`"${config.model}" may not be reliable for grading written answers. A larger model is recommended.`);
  }

  // A model this install doesn't have a price for is assumed to cost $0 —
  // correct for a genuinely free local model (embedded, or "custom" on a
  // loopback/private address, i.e. self-hosted on your own box or server —
  // see looksSelfHosted in ai/service.js), silently wrong for anything else,
  // and not just a cosmetic dashboard number: the spend cap below sums the
  // same estimate, so it can never fire either. Only surfaced when a cap is
  // actually set, so a self-hosted setup with no cap isn't nagged about
  // pricing it will never need.
  const priced = ai.hasKnownPricing(config.provider, config.model, config.pricing);
  const selfHosted = config.provider === "embedded" || ai.looksSelfHosted(config.baseUrl);
  if (!priced && !selfHosted && config.limits.dailyCostCapUsd > 0) {
    warnings.push(
      `Your daily spend cap can't take effect: "${config.model}"'s cost isn't tracked, so it's assumed to be $0. Fill in Pricing override below so the cap actually works.`
    );
  }

  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    visionModel: config.visionModel,
    embeddedGpu: config.embeddedGpu || "auto",
    // The key is never returned, only its tail, so a compromised admin
    // session cannot read it back out.
    hasApiKey: Boolean(config.apiKeyLast4),
    apiKeyLast4: config.apiKeyLast4,
    features: config.features,
    limits: config.limits,
    pricing: config.pricing,
    featureCosts: config.featureCosts,
    docChat: config.docChat,
    practiceQna: { maxPerQuestion: config.practiceQna?.maxPerQuestion ?? 5 },
    hints: { matchLanguage: config.hints?.matchLanguage !== false },
    languages: { solutions: config.languages?.solutions !== false, explanations: config.languages?.explanations !== false, qna: config.languages?.qna !== false },
    studentVideos: { dailyPerStudent: config.studentVideos?.dailyPerStudent ?? 3, maxParts: config.studentVideos?.maxParts ?? 3 },
    poraDhora: config.poraDhora,
    aiTutor: config.aiTutor,
    interview: config.interview,
    handwritingCheck: config.handwritingCheck,
    agents: config.agents,
    // The voice key is never returned either, only its tail.
    voice: {
      provider: config.voice?.provider || "none",
      baseUrl: config.voice?.baseUrl || "",
      model: config.voice?.model || "",
      voice: config.voice?.voice || "",
      voiceBangla: config.voice?.voiceBangla || "",
      hasKey: Boolean(config.voice?.keyLast4),
      keyLast4: config.voice?.keyLast4 || "",
    },
    images: {
      provider: config.images?.provider || "none",
      baseUrl: config.images?.baseUrl || "",
      model: config.images?.model || "",
      quality: config.images?.quality || "low",
      useMainKey: config.images?.useMainKey !== false,
      hasKey: Boolean(config.images?.keyLast4),
      keyLast4: config.images?.keyLast4 || "",
    },
    lastTestedAt: config.lastTestedAt,
    lastTestOk: config.lastTestOk,
    lastTestMessage: config.lastTestMessage,
    warnings,
  };
};

//@desc   Current AI settings
//@route  GET /api/ai/config
//@access Private, admin
const getConfig = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  res.status(200).json(shapeConfig(config));
});

//@desc   Update AI settings
//@route  PUT /api/ai/config
//@access Private, admin
const updateConfig = asyncHandler(async (req, res) => {
  const config = await AiConfig.get(true);
  const wasEmbedded = config.provider === "embedded";
  const previousModel = config.model;

  const previousGpu = config.embeddedGpu || "auto";
  const { embeddedGpu } = req.body;
  if (["auto", "off"].includes(embeddedGpu)) config.embeddedGpu = embeddedGpu;
  const { provider, baseUrl, model, visionModel, apiKey, features, limits, pricing, featureCosts, docChat, agents, handwritingCheck, voice, images, practiceQna, studentVideos, hints, languages, poraDhora, aiTutor, interview } = req.body;

  if (provider) config.provider = provider;
  if (baseUrl !== undefined) config.baseUrl = baseUrl;
  if (model !== undefined) config.model = model;
  if (visionModel !== undefined) config.visionModel = visionModel;
  const docChatWasOn = Boolean(config.features.docChat);
  const poraWasOn = Boolean(config.features.poraDhora || config.features.aiTutor || config.features.interview);
  if (features) Object.assign(config.features, features);
  if (limits) Object.assign(config.limits, limits);
  if (pricing) Object.assign(config.pricing, pricing);
  if (featureCosts) Object.assign(config.featureCosts, featureCosts);
  if (handwritingCheck) {
    if (["off", "flag", "hold", "zero"].includes(handwritingCheck.exam)) config.handwritingCheck.exam = handwritingCheck.exam;
    if (["off", "flag", "zero"].includes(handwritingCheck.practice)) config.handwritingCheck.practice = handwritingCheck.practice;
  }
  if (agents) {
    if (agents.enabled !== undefined) config.agents.enabled = Boolean(agents.enabled);
    if (agents.dailyRunsPerUser !== undefined) config.agents.dailyRunsPerUser = Math.max(0, Math.round(Number(agents.dailyRunsPerUser) || 0));
    const g = agents.grading;
    if (g) {
      if (g.enabled !== undefined) config.agents.grading.enabled = Boolean(g.enabled);
      if (["ask", "safe", "auto"].includes(g.mode)) config.agents.grading.mode = g.mode;
      if (g.minConfidence !== undefined) config.agents.grading.minConfidence = Math.min(1, Math.max(0.5, Number(g.minConfidence) || 0.85));
    }
    const as = agents.assignment;
    if (as) {
      if (as.enabled !== undefined) config.agents.assignment.enabled = Boolean(as.enabled);
      if (["ask", "safe", "auto"].includes(as.mode)) config.agents.assignment.mode = as.mode;
      if (as.returnGrades !== undefined) config.agents.assignment.returnGrades = Boolean(as.returnGrades);
      if (as.reminders !== undefined) config.agents.assignment.reminders = Boolean(as.reminders);
    }
    const ac = agents.afterClass;
    if (ac) {
      if (ac.enabled !== undefined) config.agents.afterClass.enabled = Boolean(ac.enabled);
      if (["ask", "safe", "auto"].includes(ac.mode)) config.agents.afterClass.mode = ac.mode;
      if (ac.quizSize !== undefined) config.agents.afterClass.quizSize = Math.min(8, Math.max(3, Math.round(Number(ac.quizSize) || 5)));
      if (ac.quiz !== undefined) config.agents.afterClass.quiz = Boolean(ac.quiz);
      if (ac.absentees !== undefined) config.agents.afterClass.absentees = Boolean(ac.absentees);
    }
    const ar = agents.atRisk;
    if (ar) {
      if (ar.enabled !== undefined) config.agents.atRisk.enabled = Boolean(ar.enabled);
      if (["ask", "safe", "auto"].includes(ar.mode)) config.agents.atRisk.mode = ar.mode;
      const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(v) || d)));
      if (ar.scoreDrop !== undefined) config.agents.atRisk.scoreDrop = clamp(ar.scoreDrop, 5, 60, 15);
      if (ar.lowScore !== undefined) config.agents.atRisk.lowScore = clamp(ar.lowScore, 10, 80, 40);
      if (ar.quietDays !== undefined) config.agents.atRisk.quietDays = clamp(ar.quietDays, 3, 60, 10);
    }
    const sp = agents.support;
    if (sp) {
      if (sp.enabled !== undefined) config.agents.support.enabled = Boolean(sp.enabled);
      if (["ask", "safe", "auto"].includes(sp.mode)) config.agents.support.mode = sp.mode;
      if (sp.doubts !== undefined) config.agents.support.doubts = Boolean(sp.doubts);
      if (sp.tickets !== undefined) config.agents.support.tickets = Boolean(sp.tickets);
      if (sp.knowledge !== undefined) config.agents.support.knowledge = String(sp.knowledge).slice(0, 8000);
    }
    const mk = agents.marketing;
    if (mk) {
      if (mk.enabled !== undefined) config.agents.marketing.enabled = Boolean(mk.enabled);
      if (["ask", "safe", "auto"].includes(mk.mode)) config.agents.marketing.mode = mk.mode;
      if (mk.minAudience !== undefined) config.agents.marketing.minAudience = Math.min(1000, Math.max(1, Math.round(Number(mk.minAudience) || 5)));
      if (mk.channels) for (const k of ["app", "sms", "email"]) if (mk.channels[k] !== undefined) config.agents.marketing.channels[k] = Boolean(mk.channels[k]);
    }
    const tu = agents.tutor;
    if (tu) {
      if (tu.enabled !== undefined) config.agents.tutor.enabled = Boolean(tu.enabled);
      if (tu.eveningNudge !== undefined) config.agents.tutor.eveningNudge = Boolean(tu.eveningNudge);
    }
    const c = agents.copilot;
    if (c) {
      if (c.enabled !== undefined) config.agents.copilot.enabled = Boolean(c.enabled);
      if (["ask", "safe", "auto"].includes(c.mode)) config.agents.copilot.mode = c.mode;
      if (["classic", "workspace"].includes(c.view)) config.agents.copilot.view = c.view;
      if (Array.isArray(c.roles)) config.agents.copilot.roles = c.roles.filter((r) => ["owner", "admin"].includes(r));
    }
  }
  // Switching course chat on indexes every lecture that has never been
  // indexed, in the background.
  if (!poraWasOn && (config.features.poraDhora || config.features.aiTutor || config.features.interview) && !config.features.docChat) {
    require("../../utils/docIndex").indexMissing().catch(() => {});
  }
  if (!docChatWasOn && config.features.docChat) {
    require("../../utils/docIndex").indexMissing().catch(() => {});
  }
  if (hints?.matchLanguage !== undefined) config.set("hints.matchLanguage", Boolean(hints.matchLanguage));
  for (const k of ["solutions", "explanations", "qna"]) if (languages?.[k] !== undefined) config.set(`languages.${k}`, Boolean(languages[k]));
  if (practiceQna?.maxPerQuestion !== undefined) {
    config.practiceQna.maxPerQuestion = Math.min(20, Math.max(1, Math.round(Number(practiceQna.maxPerQuestion) || 5)));
  }
  if (studentVideos) {
    if (studentVideos.dailyPerStudent !== undefined) config.studentVideos.dailyPerStudent = Math.min(50, Math.max(1, Math.round(Number(studentVideos.dailyPerStudent) || 3)));
    if (studentVideos.maxParts !== undefined) config.studentVideos.maxParts = Math.min(4, Math.max(1, Math.round(Number(studentVideos.maxParts) || 3)));
  }
  if (poraDhora && typeof poraDhora === "object") {
    const p = poraDhora;
    const int = (v, min, max, d) => Math.min(max, Math.max(min, Math.round(Number(v) ?? d)));
    if (p.dailyQuestions !== undefined) config.poraDhora.dailyQuestions = int(p.dailyQuestions || 0, 0, 1000, 10);
    if (p.packSize !== undefined) config.poraDhora.packSize = int(p.packSize || 0, 0, 1000, 10);
    if (p.packCost !== undefined) config.poraDhora.packCost = int(p.packCost || 1, 1, 1000, 2);
    if (p.packCarryOver !== undefined) config.poraDhora.packCarryOver = Boolean(p.packCarryOver);
    if (p.questionsPerSession !== undefined) config.poraDhora.questionsPerSession = int(p.questionsPerSession || 5, 1, 15, 5);
    if (p.followUps !== undefined) config.poraDhora.followUps = int(p.followUps || 0, 0, 3, 1);
    if (["call", "teacher", "page"].includes(p.layout)) config.poraDhora.layout = p.layout;
    if (p.layoutSwitch !== undefined) config.poraDhora.layoutSwitch = Boolean(p.layoutSwitch);
    if (p.speak !== undefined) config.poraDhora.speak = Boolean(p.speak);
    if (p.teacherName !== undefined) config.poraDhora.teacherName = String(p.teacherName).trim().slice(0, 40);
  }
  if (aiTutor && typeof aiTutor === "object") {
    const p = aiTutor;
    const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v))));
    if (p.dailyQuestions !== undefined) config.aiTutor.dailyQuestions = int(p.dailyQuestions || 0, 0, 1000);
    if (p.packSize !== undefined) config.aiTutor.packSize = int(p.packSize || 0, 0, 1000);
    if (p.packCost !== undefined) config.aiTutor.packCost = int(p.packCost || 1, 1, 1000);
    if (p.packCarryOver !== undefined) config.aiTutor.packCarryOver = Boolean(p.packCarryOver);
    if (p.questionsPerSession !== undefined) config.aiTutor.questionsPerSession = int(p.questionsPerSession || 5, 1, 15);
    if (p.followUps !== undefined) config.aiTutor.followUps = int(p.followUps || 0, 0, 3);
    if (["chat", "book", "paper"].includes(p.layout)) config.aiTutor.layout = p.layout;
    if (p.tutorName !== undefined) config.aiTutor.tutorName = String(p.tutorName).trim().slice(0, 40);
    if (Array.isArray(p.partMarks) && p.partMarks.length === 4) config.aiTutor.partMarks = p.partMarks.map((m) => int(m || 1, 1, 20));
    if (["lenient", "normal", "strict"].includes(p.strictness)) config.aiTutor.strictness = p.strictness;
    if (p.hintPenalty !== undefined) config.aiTutor.hintPenalty = Math.min(5, Math.max(0, Math.round((Number(p.hintPenalty) || 0) * 2) / 2));
    if (p.stepMarking !== undefined) config.aiTutor.stepMarking = Boolean(p.stepMarking);
    if (p.criteriaWeight !== undefined) config.aiTutor.criteriaWeight = int(p.criteriaWeight || 0, 0, 50);
  }
  if (interview && typeof interview === "object") {
    const p = interview;
    const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v))));
    if (p.dailyQuestions !== undefined) config.interview.dailyQuestions = int(p.dailyQuestions || 0, 0, 1000);
    if (p.packSize !== undefined) config.interview.packSize = int(p.packSize || 0, 0, 1000);
    if (p.packCost !== undefined) config.interview.packCost = int(p.packCost || 1, 1, 1000);
    if (p.packCarryOver !== undefined) config.interview.packCarryOver = Boolean(p.packCarryOver);
    if (p.followUps !== undefined) config.interview.followUps = int(p.followUps || 0, 0, 3);
    if (["panel", "board", "video"].includes(p.layout)) config.interview.layout = p.layout;
    if (p.answerSeconds !== undefined) config.interview.answerSeconds = int(p.answerSeconds || 0, 0, 600);
    for (const k of ["typing", "speak", "lectureViva", "ownInterview"]) if (p[k] !== undefined) config.interview[k] = Boolean(p[k]);
    if (["lenient", "normal", "strict"].includes(p.strictness)) config.interview.strictness = p.strictness;
  }
  if (docChat) {
    const { allowGeneral, scope, dailyMessages, embeddingModel, packSize, packCost, packCarryOver } = docChat;
    if (packCarryOver !== undefined) config.docChat.packCarryOver = Boolean(packCarryOver);
    if (packSize !== undefined) config.docChat.packSize = Math.max(0, Math.round(Number(packSize) || 0));
    if (packCost !== undefined) config.docChat.packCost = Math.max(1, Math.round(Number(packCost) || 1));
    if (allowGeneral !== undefined) config.docChat.allowGeneral = Boolean(allowGeneral);
    if (["both", "lecture", "course"].includes(scope)) config.docChat.scope = scope;
    if (dailyMessages !== undefined) config.docChat.dailyMessages = Math.max(0, Number(dailyMessages) || 0);
    if (embeddingModel !== undefined) config.docChat.embeddingModel = String(embeddingModel).trim();
  }

  // An empty string clears the key. Undefined leaves it alone, so saving other
  // settings does not wipe it.
  if (apiKey !== undefined) config.setApiKey(apiKey);

  if (voice && typeof voice === "object") {
    if (["none", "openai", "elevenlabs", "azure", "google"].includes(voice.provider)) config.voice.provider = voice.provider;
    for (const f of ["baseUrl", "model", "voice", "voiceBangla"]) {
      if (typeof voice[f] === "string") config.voice[f] = voice[f].trim().slice(0, 300);
    }
    // Same rule as the AI key: "" clears it, absent leaves it.
    if (typeof voice.key === "string") config.setVoiceKey(voice.key.trim());
  }

  if (images && typeof images === "object") {
    if (["none", "openai", "gemini", "openrouter", "local", "cloudflare"].includes(images.provider)) config.images.provider = images.provider;
    if (typeof images.baseUrl === "string") {
      const url = images.baseUrl.trim().slice(0, 300);
      // Cloudflare: an account ID, not an address.
      if (config.images.provider === "cloudflare") {
        if (url && !require("../../ai/images").cloudflareAccount(url)) {
          res.status(400);
          throw new Error("That doesn't look like a Cloudflare account ID (32 letters and digits).");
        }
      } else if (url && !/^https?:\/\/[^\s/]+/i.test(url)) {
        res.status(400);
        throw new Error("The picture server address must start with http:// or https://");
      }
      config.images.baseUrl = url;
    }
    if (typeof images.model === "string") config.images.model = images.model.trim().slice(0, 120);
    if (["low", "medium", "high"].includes(images.quality)) config.images.quality = images.quality;
    if (images.useMainKey !== undefined) config.images.useMainKey = Boolean(images.useMainKey);
    if (typeof images.key === "string") config.setImageKey(images.key.trim());
  }

  await config.save();

  // The embedded provider's model runs as a real child process on this
  // server, not a stateless API call — leaving it running after a save that
  // moves away from it (switching provider, or picking a different
  // built-in model) would just leak the RAM it's holding until the next
  // embedded call happens to evict it, or the whole server restarts. Not
  // awaited: this is cleanup, not something the save response should wait
  // on, and a failure here does not make the save itself fail.
  if (wasEmbedded && previousModel && (config.provider !== "embedded" || config.model !== previousModel)) {
    require("../../ai/embedded").unload(previousModel).catch(() => {});
  }
  // GPU on or off: the running server restarts on the next request, on the
  // new choice, and a GPU that failed earlier is tried again.
  if ((config.embeddedGpu || "auto") !== previousGpu) {
    const embedded = require("../../ai/embedded");
    embedded.resetGpu();
    embedded.unload().catch(() => {});
  }

  res.status(200).json(shapeConfig(config));
});

//@desc   Check the provider answers
//@route  POST /api/ai/test
//@access Private, admin
const testConnection = asyncHandler(async (req, res) => {
  const result = await ai.testConnection();

  const config = await AiConfig.get();
  config.lastTestedAt = new Date();
  config.lastTestOk = result.ok;
  config.lastTestMessage = result.message;
  await config.save();

  // Always 200. The request succeeded — it is the *test* that failed, and the
  // result is the answer. Returning 502 put the payload in the client's error
  // branch instead of its data branch, so a failed test rendered nothing at
  // all and the button looked dead.
  res.status(200).json(result);
});

module.exports = { getConfig, updateConfig, testConnection, shapeConfig, isGradingCapable };
