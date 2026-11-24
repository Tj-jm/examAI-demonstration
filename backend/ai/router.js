const { getAdapter } = require("./providers");

// Which model answers an AI call (ai/service.js complete()): the main
// connection under Settings → AI. Pictures: the picture setup under
// Settings → AI → Features → AI pictures.

class NotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 503;
  }
}

const baseUrlFor = (provider, baseUrl) => {
  if (provider === "embedded") return "";
  if (provider === "custom") return (baseUrl || "").replace(/\/$/, "");
  return (getAdapter(provider).defaultBaseUrl || "").replace(/\/$/, "");
};

// The main connection (Settings → AI) as a target. Throws when unusable.
const mainTarget = (config) => {
  if (!config.model) throw new NotConfiguredError("No AI model is configured. Set one up in settings.");
  const apiKey = config.getApiKey();
  if (config.provider !== "custom" && config.provider !== "embedded" && !apiKey) {
    throw new NotConfiguredError("No API key is configured. Add one in settings.");
  }
  const baseUrl = baseUrlFor(config.provider, config.baseUrl);
  if (config.provider === "custom" && !baseUrl) {
    throw new NotConfiguredError("A local provider needs an address, such as http://localhost:11434/v1.");
  }
  return {
    label: "Main", connection: null, provider: config.provider, adapter: getAdapter(config.provider),
    baseUrl, apiKey, model: config.model, visionModel: config.visionModel || "",
  };
};

// → { targets } for one call.
const targetsFor = async (config) => ({ targets: [mainTarget(config)] });

// The picture setup under Settings → AI → Features → AI pictures, as a
// target; null when no service is chosen there.
const mainPicture = (config) => {
  const p = config.images?.provider;
  if (!p || p === "none") return null;
  return { label: "Main", connection: null, provider: p, model: config.images?.model || "", key: config.getImageKey(), baseUrl: config.images?.baseUrl || "", quality: config.images?.quality || "low" };
};

const pictureTargetsFor = async (config) => {
  const m = mainPicture(config);
  return m ? [m] : [];
};

module.exports = { pictureTargetsFor, targetsFor, mainTarget };
