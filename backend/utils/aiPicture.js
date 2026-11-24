const { generateImage, picturePrompt } = require("../ai/images");
const AiConfig = require("../models/aiConfigModel");
const AiUsage = require("../models/aiUsageModel");
const Media = require("../models/mediaModel");
const storage = require("../adapters/storage");

// An AI picture saved as an image in the media library: for notices, the
// landing page and courses. Used by the picture button (aiImageController)
// and the copilot's notices.

const enabled = async () => Boolean((await AiConfig.get(true)).features?.aiImages);

// One picture for a job (feature: picture-notice, picture-poster…), from
// its routed picture models in turn (ai/router.js pictureTargetsFor): when
// one fails or refuses, the next is tried. Each try is logged.
const generate = async ({ config, feature, prompt, shape = "wide", user }) => {
  const targets = await require("../ai/router").pictureTargetsFor(config, feature);
  if (!targets.length) {
    throw Object.assign(new Error("Choose a picture service in Settings → AI → Features → AI pictures, or route this job to a picture model under AI models."), { statusCode: 400 });
  }
  let lastError;
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];
    const usage = {
      feature: "ai-image", provider: t.provider, model: t.model || "", user,
      fallback: i > 0,
    };
    const started = Date.now();
    try {
      const image = await generateImage({ provider: t.provider, model: t.model, key: t.key, baseUrl: t.baseUrl, quality: t.quality, prompt, shape });
      AiUsage.create({ ...usage, latencyMs: Date.now() - started, ok: true }).catch(() => {});
      return image;
    } catch (error) {
      AiUsage.create({ ...usage, latencyMs: Date.now() - started, ok: false, errorMessage: error.message }).catch(() => {});
      lastError = error;
    }
  }
  if (!lastError.statusCode) lastError.statusCode = 502;
  throw lastError;
};

const make = async ({ prompt, purpose = "notice", shape = "wide", user }) => {
  const config = await AiConfig.get(true);
  if (!config.features?.aiImages) {
    throw Object.assign(new Error("AI images are switched off. Turn them on in Settings → AI → Features."), { statusCode: 403 });
  }
  const image = await generate({ config, feature: `picture-${purpose}`, prompt: picturePrompt({ prompt, purpose }), shape, user });

  const folder = { landing: "landing", course: "programs" }[purpose] || "notices";
  const stored = await storage.storeGenerated(folder, image.buffer, image.mimeType);
  const existing = await Media.findOne({ key: stored.key, driver: stored.driver });
  if (existing) return existing;
  return Media.create({
    title: `AI: ${prompt.slice(0, 80)}`,
    kind: "image",
    driver: stored.driver,
    key: stored.key,
    sizeBytes: stored.sizeBytes,
    mimeType: image.mimeType,
    uploadedBy: user,
  });
};

module.exports = { enabled, make, generate };
