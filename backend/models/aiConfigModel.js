const mongoose = require("mongoose");
const singletonCache = require("../utils/singletonCache");
const { encrypt, decrypt } = require("../utils/crypto");
const { FEATURE_COST_KEYS, DEFAULT_FEATURE_COSTS } = require("../ai/featureCosts");

// Built once from FEATURE_COST_KEYS rather than hand-duplicated, so a new
// billable feature only ever needs adding in one place (featureCosts.js).
const featureCostsSchemaDef = {};
FEATURE_COST_KEYS.forEach(({ key }) => {
  // A result served again (a "-saved" key) may be free; a new call costs at least 1.
  const reuse = key.endsWith("-saved");
  featureCostsSchemaDef[key] = { type: Number, default: reuse ? DEFAULT_FEATURE_COSTS[key] : DEFAULT_FEATURE_COSTS[key] || 1, min: reuse ? 0 : 1 };
});

// Provider credentials live here, encrypted at rest, never in .env — a buyer
// changes them from the settings screen without touching a file.
//
// The `custom` provider is an OpenAI-compatible endpoint, which is what Ollama,
// LM Studio, vLLM, llama.cpp, LocalAI, OpenRouter, Groq and Together all
// expose. One adapter covers every self-hosted option.
//
// `embedded` is a different kind of local: a small GGUF model downloaded
// straight onto this server, served by a real llama.cpp server binary that
// this process downloads once and manages as a child process on localhost
// (ai/embedded.js, ai/llamaServerBinary.js) — no Ollama, no hand-install, no
// address to configure. Supports vision (some catalogue entries ship a
// multimodal projector file) unlike a from-scratch in-process binding would.
// `model` holds a catalogue id from ai/embeddedCatalogue.js, not a model
// name string, and is resolved to on-disk file(s) through the EmbeddedModel
// collection.

const aiConfigSchema = new mongoose.Schema(
  {
    singleton: {
      type: String,
      default: "ai",
      unique: true,
      immutable: true,
    },

    provider: {
      type: String,
      enum: ["openai", "anthropic", "gemini", "custom", "embedded"],
      default: "custom",
    },
    baseUrl: String,
    model: String,
    // vision-capable model, used for pdf/slide extraction. may differ from
    // the text model, and may be unset when the text model handles both.
    visionModel: String,
    // The built-in model (provider "embedded"): run on the GPU when there
    // is one ("auto"), or always on the CPU ("off"). ai/embedded.js.
    embeddedGpu: { type: String, enum: ["auto", "off"], default: "auto" },

    apiKeyEncrypted: {
      type: String,
      select: false,
    },
    apiKeyLast4: String,

    features: {
      questionGeneration: { type: Boolean, default: false },
      solutionBackfill: { type: Boolean, default: false },
      skillTypeBackfill: { type: Boolean, default: false },
      writtenGrading: { type: Boolean, default: false },
      studentExplanations: { type: Boolean, default: false },
      qualityChecks: { type: Boolean, default: false },
      // Whether generating a study plan (studyPlanController.js) skips the
      // student's daily cap/credit check entirely rather than costing
      // featureCosts["study-plan"] once the free daily allowance runs out.
      // Off by default, same treatment as every other billable feature —
      // an admin opts in to making it free, it doesn't start that way.
      studyPlanFree: { type: Boolean, default: false },
      // Whether the exam builder's "AI: pick from bank" panel can call the
      // model at all — off by default like every other generation feature.
      // Admin-triggered and non-billable (see examController.js's
      // smartPickQuestions, called with user only, no student/batch), so
      // this has no counterpart in featureCosts.js, same as
      // questionGeneration.
      smartExamBuilder: { type: Boolean, default: false },
      // Whether the lecture editor's "Write with AI" description button can
      // call the model — deliberately an admin-wide switch, not a batch
      // feature: writing a lecture's description is an authoring aid, not
      // something a batch's students opt into or are billed for, so it
      // doesn't belong in batchModel.js's features next to aiAssist and its
      // siblings. Admin-triggered and non-billable, same as
      // smartExamBuilder above.
      lectureDescription: { type: Boolean, default: false },
      // Landing page settings' "Suggest with AI" for SEO title/description —
      // an admin writing aid, same treatment as lectureDescription.
      seoSuggest: { type: Boolean, default: false },
      // "Write with AI" on exam descriptions, notices, landing page
      // sections and live classes, and the translate button (ai/writing.js).
      // An admin writing aid, same treatment as lectureDescription.
      writingHelp: { type: Boolean, default: false },
      // AI checking for assignments: a suggested grade and feedback per
      // hand-in for staff to accept (ai/assignmentCheck.js).
      assignmentChecking: { type: Boolean, default: false },
      // AI pictures for notices and the landing page, and AI diagrams for
      // questions and solutions (ai/images.js). Pictures also need an image
      // provider below.
      aiImages: { type: Boolean, default: false },
      // Document chat for students (docChatController.js). The platform-wide
      // switch; each batch also turns it on with features.docChat.
      docChat: { type: Boolean, default: false },
      // Follow-up questions on practice solutions (utils/practiceQna.js);
      // batches also turn it on with features.practiceQna.
      practiceQna: { type: Boolean, default: false },
      // Short AI videos students ask for from a lecture or video lesson
      // (utils/studentVideo.js); batches also turn it on with
      // features.studentVideos.
      studentVideos: { type: Boolean, default: false },
      // Oral Quiz for students (poraController.js); batches also turn it on
      // with features.poraDhora.
      poraDhora: { type: Boolean, default: false },
      // AI Tutoring for students (aiTutorController.js); batches also turn it
      // on with features.aiTutor.
      aiTutor: { type: Boolean, default: false },
      // Interview practice for students (interviewController.js); batches
      // also turn it on with features.interview.
      interview: { type: Boolean, default: false },
    },
    // Hints for students (utils/hints.js). matchLanguage: written in the
    // question's own language; off leaves it to the model.
    hints: {
      matchLanguage: { type: Boolean, default: true },
    },
    // The same for AI-written solutions, "Explain why" and questions on
    // practice solutions (on: the question's own language).
    languages: {
      solutions: { type: Boolean, default: true },
      explanations: { type: Boolean, default: true },
      qna: { type: Boolean, default: true },
    },
    // Follow-ups allowed per practice question, per student.
    practiceQna: {
      maxPerQuestion: { type: Number, default: 5, min: 1, max: 20 },
    },
    // Short AI videos students ask for: how many a day, and how long (parts).
    studentVideos: {
      dailyPerStudent: { type: Number, default: 3, min: 1, max: 50 },
      maxParts: { type: Number, default: 3, min: 1, max: 4 },
    },

    // Oral Quiz (poraController.js): billed like course chat, per question
    // answered. Follow-ups and hints inside a question are free.
    poraDhora: {
      // Free questions per student per day; 0 = every AI call is charged
      // like any other (feature "pora-dhora").
      dailyQuestions: { type: Number, default: 10, min: 0 },
      packSize: { type: Number, default: 10, min: 0 },
      packCost: { type: Number, default: 2, min: 1 },
      packCarryOver: { type: Boolean, default: false },
      // Main questions per session, and follow-ups the teacher may ask on one.
      questionsPerSession: { type: Number, default: 5, min: 1, max: 15 },
      followUps: { type: Number, default: 1, min: 0, max: 3 },
      // Layout students see first: call, teacher or page.
      layout: { type: String, enum: ["call", "teacher", "page"], default: "call" },
      // Students may switch layouts themselves.
      layoutSwitch: { type: Boolean, default: true },
      // The teacher speaks (needs a voice under Voice).
      speak: { type: Boolean, default: true },
      // The teacher's name on screen.
      teacherName: { type: String, default: "", maxlength: 40 },
    },

    // AI Tutoring (aiTutorController.js): a written lesson check, billed like
    // Oral Quiz, per question (or question part) answered.
    aiTutor: {
      dailyQuestions: { type: Number, default: 10, min: 0 },
      packSize: { type: Number, default: 10, min: 0 },
      packCost: { type: Number, default: 2, min: 1 },
      packCarryOver: { type: Boolean, default: false },
      questionsPerSession: { type: Number, default: 5, min: 1, max: 15 },
      followUps: { type: Number, default: 1, min: 0, max: 3 },
      // chat: tutor chat; book: exercise book marked in red ink;
      // paper: one creative question (stimulus and four parts).
      layout: { type: String, enum: ["chat", "book", "paper"], default: "chat" },
      tutorName: { type: String, default: "", maxlength: 40 },
      // Scoring. partMarks: the creative question's four parts (1–20 each).
      // strictness: how hard the AI marks. hintPenalty: marks (out of 10)
      // taken off a question for each hint on it, 0 = free. stepMarking:
      // board step marking (a part's marks by levels reached; working gets
      // marks even when the final answer is wrong). criteriaWeight: % of the
      // score taken from the report's criteria, 0 = marks only.
      partMarks: { type: [Number], default: [1, 2, 3, 4] },
      strictness: { type: String, enum: ["lenient", "normal", "strict"], default: "normal" },
      hintPenalty: { type: Number, default: 0, min: 0, max: 5 },
      stepMarking: { type: Boolean, default: false },
      criteriaWeight: { type: Number, default: 0, min: 0, max: 50 },
    },

    // Interview practice (interviewController.js): a viva or interview
    // panel, out loud, billed like Oral Quiz per question answered.
    // layout: panel (a board of examiners), board (an examination desk),
    // video (a video call with one interviewer). answerSeconds: time per
    // answer, 0 = no limit. typing: students may type instead of speaking.
    // ownInterview: students may describe their own interview to practise.
    interview: {
      dailyQuestions: { type: Number, default: 10, min: 0 },
      packSize: { type: Number, default: 10, min: 0 },
      packCost: { type: Number, default: 2, min: 1 },
      packCarryOver: { type: Boolean, default: false },
      followUps: { type: Number, default: 1, min: 0, max: 3 },
      layout: { type: String, enum: ["panel", "board", "video"], default: "panel" },
      answerSeconds: { type: Number, default: 90, min: 0, max: 600 },
      typing: { type: Boolean, default: false },
      speak: { type: Boolean, default: true },
      lectureViva: { type: Boolean, default: true },
      ownInterview: { type: Boolean, default: true },
      strictness: { type: String, enum: ["lenient", "normal", "strict"], default: "normal" },
    },

    // Agents: AI that plans and carries out work in the platform, with a
    // person approving what it does (Settings → AI → Agents). Each agent
    // also has to be switched on for a batch before it may act there.
    // What to do when an answer's photos aren't handwriting (printed text,
    // a screenshot): see utils/handwriting.js.
    handwritingCheck: {
      exam: { type: String, enum: ["off", "flag", "hold", "zero"], default: "hold" },
      practice: { type: String, enum: ["off", "flag", "zero"], default: "flag" },
    },

    agents: {
      enabled: { type: Boolean, default: false },
      // How much an agent may do without asking:
      //   ask  — every action waits for approval
      //   safe — drafts and other reversible actions run; anything students
      //          would see (publishing, notices, classes) waits
      //   auto — everything runs
      copilot: {
        enabled: { type: Boolean, default: true },
        mode: { type: String, enum: ["ask", "safe", "auto"], default: "safe" },
        // Who may give the copilot orders: owner and/or admin. Never other
        // roles — teachers can't create exams or notices themselves, and
        // the copilot can't do more than the person asking.
        roles: { type: [String], default: ["owner", "admin"] },
        // The copilot page: "classic" (one column of requests) or
        // "workspace" (requests, chat and plan side by side).
        view: { type: String, enum: ["classic", "workspace"], default: "classic" },
      },
      // Background: AI-marks written answers, and applies the marks of
      // scripts it's confident about (each script one approval step).
      grading: {
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ["ask", "safe", "auto"], default: "safe" },
        // Every answer in a script at or above this confidence (0–1).
        minConfidence: { type: Number, default: 0.85, min: 0.5, max: 1 },
      },
      // Background: after an in-app class, a quiz from the class notes and a
      // catch-up message for students who missed it.
      // Background: suggests a grade and feedback for every assignment
      // hand-in in the batches that allow it, offers to apply them, and
      // reminds students the day before work is due.
      assignment: {
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ["ask", "safe", "auto"], default: "ask" },
        // Applying also returns the grade to the student.
        returnGrades: { type: Boolean, default: false },
        reminders: { type: Boolean, default: true },
      },
      afterClass: {
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ["ask", "safe", "auto"], default: "safe" },
        quizSize: { type: Number, default: 5, min: 3, max: 8 },
        quiz: { type: Boolean, default: true },
        absentees: { type: Boolean, default: true },
      },
      // Background, weekly: finds students who are slipping (scores
      // falling, gone quiet, missing classes) and offers each a personal
      // check-in with their weakest topic to practise.
      atRisk: {
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ["ask", "safe", "auto"], default: "ask" },
        // A drop this many percentage points between the last three graded
        // exams and the three before.
        scoreDrop: { type: Number, default: 15, min: 5, max: 60 },
        // Below this average over the last three graded exams.
        lowScore: { type: Number, default: 40, min: 10, max: 80 },
        // No practice or exams for this many days, after being active.
        quietDays: { type: Number, default: 10, min: 3, max: 60 },
      },
      // Background: drafts answers to escalated doubts and replies to new
      // support tickets; staff edit and approve them in the inbox.
      support: {
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ["ask", "safe", "auto"], default: "ask" },
        doubts: { type: Boolean, default: true },
        tickets: { type: Boolean, default: true },
        // What the agent may tell students about payments, refunds, access,
        // hours and so on. It doesn't answer ticket questions this doesn't cover.
        knowledge: { type: String, default: "", maxlength: 8000 },
      },
      // For students: a short personal plan each day (weakest topic to
      // practise, next lecture, an exam that's open), ticked off from what
      // they actually do, with a streak and an exam-sprint mode. No AI
      // calls, so no cost per student.
      tutor: {
        enabled: { type: Boolean, default: false },
        // An evening reminder when today's tasks aren't done.
        eveningNudge: { type: Boolean, default: true },
      },
      // Background, weekly: proposes campaigns to students who could buy
      // now (trial ending, access ran out, never bought, gone quiet) and
      // automations that would catch them by themselves (agents/marketing.js).
      marketing: {
        enabled: { type: Boolean, default: false },
        mode: { type: String, enum: ["ask", "safe", "auto"], default: "ask" },
        // Smaller groups aren't worth a campaign.
        minAudience: { type: Number, default: 5, min: 1, max: 1000 },
        channels: {
          app: { type: Boolean, default: true },
          sms: { type: Boolean, default: false },
          email: { type: Boolean, default: false },
        },
      },
      // Requests per staff member per day, across agents. 0 = no limit.
      dailyRunsPerUser: { type: Number, default: 40, min: 0 },
    },

    // How document chat behaves (Settings → AI).
    docChat: {
      // When the documents don't cover a question: answer from general
      // knowledge, clearly labelled as not from the course documents — or
      // only say so and point to a teacher.
      allowGeneral: { type: Boolean, default: true },
      // Where students see it.
      scope: { type: String, enum: ["both", "lecture", "course"], default: "both" },
      // Free questions per student per day: they don't touch the student's
      // AI allowance or credits. 0 = no daily limit, and then every answer
      // is charged like any AI call instead.
      dailyMessages: { type: Number, default: 30, min: 0 },
      // Once those are used up, a student can buy more: packSize questions
      // for packCost AI credits. packSize 0 = no packs on sale.
      packSize: { type: Number, default: 10, min: 0 },
      packCost: { type: Number, default: 2, min: 1 },
      // Unlocked questions left at the end of the day: kept for later days,
      // or gone at midnight with the free ones.
      packCarryOver: { type: Boolean, default: false },
      // An embeddings model (e.g. text-embedding-3-small, text-embedding-004,
      // nomic-embed-text) adds meaning-based search to keyword search.
      // Empty = keyword search only. Only OpenAI-compatible and Gemini
      // providers offer one.
      embeddingModel: { type: String, default: "" },
    },

    limits: {
      dailyCallsPerStudent: { type: Number, default: 20 },
      dailyCostCapUsd: { type: Number, default: 0 },
      maxTokensPerCall: { type: Number, default: 2000 },
      // Give a student's AI charge back when the request it served failed
      // (ai/chargeScope.js).
      refundOnFailure: { type: Boolean, default: true },
    },

    // Manual price override, in USD per million tokens. Exists because
    // `provider: "custom"` (the default provider — see the enum above) can
    // be pointed at anything OpenAI-compatible: a genuinely free local
    // server (Ollama, LM Studio, vLLM) or a metered paid API reached the
    // same way (Groq, OpenRouter, DeepSeek, Together). ai/service.js's
    // estimateCost() has no way to know which one a given baseUrl is, so it
    // used to assume every "custom" call cost nothing — silently wrong for
    // anyone on a paid endpoint, and not just a cosmetic dashboard number:
    // limits.dailyCostCapUsd sums the same estimatedCostUsd field to decide
    // when to stop spending, so a $0 estimate on every call meant that cap
    // could never fire either. Left at 0 (the default, meaning "unset"),
    // estimateCost falls back to its built-in table for known hosted models
    // (openai/anthropic/gemini) and to 0 only when nothing matches — the
    // same behavior as before this field existed. `embedded` never reads
    // this: a locally-run model has no per-token cost to override.
    pricing: {
      inputPerMillion: { type: Number, default: 0, min: 0 },
      outputPerMillion: { type: Number, default: 0, min: 0 },
    },

    // How many purchased AI credits one call costs, once a student's free
    // daily allowance on a batch is used up. Only ever consulted at that
    // point — it has no effect on the free daily count itself, which stays
    // a flat one-call-is-one-call regardless of feature. Admin-tunable only
    // (see admin-panel Settings > AI); a feature missing from this object
    // (e.g. because it predates a schema migration) costs 1 by default,
    // via AiConfig#getFeatureCost rather than a bare property read.
    featureCosts: featureCostsSchemaDef,

    // Text-to-speech for video lessons (ai/tts.js). "openai" is any
    // OpenAI-compatible /audio/speech server: OpenAI itself or a
    // self-hosted one at baseUrl. The key is encrypted like the AI key.
    voice: {
      // azure: baseUrl holds the Speech resource's region (e.g. eastus).
      provider: { type: String, enum: ["none", "openai", "elevenlabs", "azure", "google"], default: "none" },
      baseUrl: { type: String, default: "" },
      model: { type: String, default: "" },
      // Voice name or id; voiceBangla is used for Bangla lessons when set.
      voice: { type: String, default: "" },
      voiceBangla: { type: String, default: "" },
      keyEncrypted: { type: String, select: false },
      keyLast4: { type: String, default: "" },
    },

    // Image model for AI pictures (ai/images.js). Separate from the text
    // provider: Anthropic and LM Studio models can't make pictures. The key
    // is encrypted like the AI key; "useMainKey" reuses the AI key when the
    // text provider is the same company. "local" is a self-hosted server
    // with an OpenAI-style picture API (LocalAI) at baseUrl; its key is
    // optional.
    images: {
      provider: { type: String, enum: ["none", "openai", "gemini", "openrouter", "local", "cloudflare"], default: "none" },
      // local: the server's address. cloudflare: the account ID.
      baseUrl: { type: String, default: "" },
      model: { type: String, default: "" },
      // OpenAI only: low / medium / high. Low is the cheapest by far.
      quality: { type: String, enum: ["low", "medium", "high"], default: "low" },
      useMainKey: { type: Boolean, default: true },
      keyEncrypted: { type: String, select: false },
      keyLast4: { type: String, default: "" },
    },

    lastTestedAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String,
  },
  { timestamps: true }
);

aiConfigSchema.methods.setApiKey = function (plain) {
  if (!plain) {
    this.apiKeyEncrypted = undefined;
    this.apiKeyLast4 = undefined;
    return;
  }
  this.apiKeyEncrypted = encrypt(plain);
  this.apiKeyLast4 = plain.slice(-4);
};

aiConfigSchema.methods.setVoiceKey = function (plain) {
  this.voice.keyEncrypted = plain ? encrypt(plain) : undefined;
  this.voice.keyLast4 = plain ? plain.slice(-4) : "";
};

aiConfigSchema.methods.getVoiceKey = function () {
  return this.voice?.keyEncrypted ? decrypt(this.voice.keyEncrypted) : null;
};

aiConfigSchema.methods.setImageKey = function (plain) {
  this.images.keyEncrypted = plain ? encrypt(plain) : undefined;
  this.images.keyLast4 = plain ? plain.slice(-4) : "";
};

// The image model's key: its own, or the AI key when the text provider is
// the same company and "use the AI key" is on. OpenRouter as the text
// provider is a custom provider pointed at openrouter.ai.
aiConfigSchema.methods.imageSharesMainKey = function () {
  const p = this.images?.provider;
  if (!p || ["none", "local", "cloudflare"].includes(p)) return false;
  if (p === "openrouter") return this.provider === "custom" && /openrouter\.ai/i.test(this.baseUrl || "");
  return p === this.provider;
};
aiConfigSchema.methods.getImageKey = function () {
  if (this.images?.useMainKey && this.imageSharesMainKey()) return this.getApiKey();
  return this.images?.keyEncrypted ? decrypt(this.images.keyEncrypted) : null;
};

aiConfigSchema.methods.getApiKey = function () {
  if (!this.apiKeyEncrypted) return null;
  return decrypt(this.apiKeyEncrypted);
};

// Never a bare `config.featureCosts[feature]` read at the call site — a
// feature key with no configured cost (or a corrupted/zero value slipping
// through) must fall back to 1, not undefined/NaN/0, since 0 would make
// that feature free forever off a credit balance without anyone deciding
// that on purpose.
aiConfigSchema.methods.getFeatureCost = function (feature) {
  const cost = this.featureCosts?.[feature];
  if (String(feature).endsWith("-saved")) return Number.isFinite(cost) && cost >= 0 ? cost : 0;
  return Number.isFinite(cost) && cost > 0 ? cost : 1;
};

// Cached for a few seconds, see utils/singletonCache.js. The copy with the
// api key is cached apart from the one without it.
singletonCache.attach(aiConfigSchema, "AiConfig");

aiConfigSchema.statics.get = async function (withKey = false) {
  return this.cachedGet(withKey ? "withKey" : "plain", async () => {
    const query = this.findOne({ singleton: "ai" });
    if (withKey) query.select("+apiKeyEncrypted +voice.keyEncrypted +images.keyEncrypted");

    let config = await query;
    if (!config) {
      config = await this.create({ singleton: "ai" });
    }
    return config;
  });
};

module.exports = mongoose.model("AiConfig", aiConfigSchema);
