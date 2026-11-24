const asyncHandler = require("express-async-handler");
const ai = require("../../ai/service");
const { diagramPrompt, diagramSchema, sanitizeSvg } = require("../../ai/images");
const AiConfig = require("../../models/aiConfigModel");
const aiPicture = require("../../utils/aiPicture");
const { shape } = require("./mediaController");

// AI pictures and diagrams for staff (ai/images.js).

const assertOn = async (res) => {
  const config = await AiConfig.get(true);
  if (!config.features.aiImages) {
    res.status(403);
    throw new Error("AI images are switched off. Turn them on in Settings → AI → Features.");
  }
  return config;
};

//@desc   An AI picture for a notice or the landing page, saved as an image
//@route  POST /api/ai-images/picture
//@access Private (staff)
const picture = asyncHandler(async (req, res) => {
  await assertOn(res);
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) {
    res.status(400);
    throw new Error("Describe the picture first.");
  }
  const purpose = ["landing", "course", "auth"].includes(req.body.purpose) ? req.body.purpose : "notice";
  const shapeName = ["wide", "square", "tall"].includes(req.body.shape) ? req.body.shape : "wide";
  let media;
  try {
    media = await aiPicture.make({ prompt, purpose, shape: shapeName, user: req.user._id });
  } catch (error) {
    res.status(error.statusCode || 502);
    throw error;
  }
  res.status(201).json(await shape(media));
});

//@desc   An AI diagram for a question or solution, as SVG for the editor
//@route  POST /api/ai-images/diagram
//@access Private (staff)
const diagram = asyncHandler(async (req, res) => {
  await assertOn(res);
  const prompt = String(req.body?.prompt || "").trim();
  const context = String(req.body?.context || "").trim();
  if (!prompt && !context) {
    res.status(400);
    throw new Error("Describe the diagram, or write the question first.");
  }
  const { data } = await ai.generate({
    feature: "ai-diagram",
    schema: diagramSchema,
    ...diagramPrompt({ prompt, context, build: Boolean(req.body?.build) }),
    maxTokens: 6000,
    user: req.user._id,
    wrapLatex: false,
  });
  res.status(200).json({ svg: sanitizeSvg(data.svg), caption: data.caption || "" });
});

module.exports = { picture, diagram };
