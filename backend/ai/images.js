const { z } = require("zod");

// AI pictures and diagrams for staff.
//
// Pictures (notice covers, landing page images) come from an image model:
// OpenAI, Gemini, OpenRouter, or a self-hosted server with an OpenAI-style picture API
// (LocalAI), set up under Settings → AI → Features → AI pictures.
// Diagrams for questions and solutions are different: image models draw
// science badly (wrong labels, wrong angles, made-up numbers), so the text
// model writes the diagram as SVG instead, and the teacher fixes it in the
// image editor before it is saved.

const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

const SIZES = {
  openai: { wide: "1536x1024", square: "1024x1024", tall: "1024x1536" },
  gemini: { wide: "16:9", square: "1:1", tall: "9:16" },
  // SDXL and FLUX work best near one megapixel, in steps of 64.
  local: { wide: "1216x832", square: "1024x1024", tall: "832x1216" },
  // Cloudflare bills per 512×512 tile: four tiles each.
  cloudflare: { wide: [1024, 576], square: [1024, 1024], tall: [576, 1024] },
};

// Cloudflare Workers AI: "baseUrl" holds the account ID (32 hex), or any
// address with /accounts/<id> in it, as the dashboard shows it.
const cloudflareAccount = (baseUrl) => {
  const s = String(baseUrl || "").trim();
  const m = s.match(/accounts\/([a-f0-9]{32})/i) || s.match(/^([a-f0-9]{32})$/i);
  return m ? m[1] : null;
};

// "http://host:8080" and "http://host:8080/v1" both mean the /v1 API.
const localEndpoint = (baseUrl) => {
  let url;
  try { url = new URL(String(baseUrl || "").trim()); } catch { url = null; }
  if (!url || !/^https?:$/.test(url.protocol)) throw fail("Add the picture server address in Settings → AI → Features → AI pictures first, e.g. http://localhost:8080", 400);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path || "/v1"}/images/generations`;
};

const MAX_PICTURE_BYTES = 20 * 1024 * 1024;

// Local servers may send PNG, JPEG or WebP without saying which.
const sniffType = (buf) => {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "image/png";
};

const readError = async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.error?.message || `${res.status} ${res.statusText}`;
};

// One picture as a PNG/JPEG buffer.
const QUALITIES = ["low", "medium", "high"];

const generateImage = async ({ provider, model, key, baseUrl, quality = "low", prompt, shape = "wide" }) => {
  if (!["openai", "gemini", "openrouter", "local", "cloudflare"].includes(provider)) throw fail("Choose a picture service in Settings → AI → Features → AI pictures first.", 400);
  if (provider === "local") return generateLocal({ model, key, baseUrl, prompt, shape });
  if (provider === "cloudflare") return generateCloudflare({ model, key, baseUrl, prompt, shape });
  if (!key) throw fail("Add an API key for pictures in Settings → AI → Features → AI pictures first.", 400);
  if (provider === "openai") {
    const name = model || "gpt-image-1";
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      // Quality sets the price: low is about a cent, high about 35 times that.
      body: JSON.stringify({
        model: name, prompt, size: SIZES.openai[shape] || SIZES.openai.wide, n: 1,
        // low/medium/high are GPT Image's; older DALL·E models reject them.
        ...(/^gpt-image/i.test(name) ? { quality: QUALITIES.includes(quality) ? quality : "low" } : {}),
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw fail(`The image service said: ${await readError(res)}`);
    const b64 = (await res.json())?.data?.[0]?.b64_json;
    if (!b64) throw fail("The image service sent back no picture.");
    return { buffer: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }
  if (provider === "openrouter") return generateOpenRouter({ model: model || "google/gemini-2.5-flash-image", key, prompt, shape });
  if (provider === "gemini") {
    const name = model || "imagen-4.0-generate-001";
    // Gemini's own picture models ("Nano Banana", e.g. gemini-2.5-flash-image)
    // answer on generateContent; Imagen answers on predict.
    if (/^gemini-/i.test(name)) return generateGeminiImage({ name, key, prompt, shape });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:predict`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: SIZES.gemini[shape] || SIZES.gemini.wide } }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw fail(`The image service said: ${await readError(res)}`);
    const p = (await res.json())?.predictions?.[0];
    if (!p?.bytesBase64Encoded) throw fail("The image service sent back no picture. The prompt may have been blocked by its safety filter.");
    return { buffer: Buffer.from(p.bytesBase64Encoded, "base64"), mimeType: p.mimeType || "image/png" };
  }
};

// A Gemini picture model. It may answer with some text beside the picture,
// or only text when it declines, which is passed on as the reason.
const generateGeminiImage = async ({ name, key, prompt, shape }) => {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: SIZES.gemini[shape] || SIZES.gemini.wide } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw fail(`The image service said: ${await readError(res)}`);
  const body = await res.json().catch(() => ({}));
  const candidate = body?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const image = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (image) {
    const data = image.inlineData || image.inline_data;
    return { buffer: Buffer.from(data.data, "base64"), mimeType: data.mimeType || data.mime_type || "image/png" };
  }
  const said = parts.map((p) => p.text).filter(Boolean).join(" ").trim().slice(0, 300);
  const blocked = body?.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== "STOP" ? candidate.finishReason : "");
  throw fail(`The image service sent back no picture${blocked ? ` (${blocked})` : ""}.${said ? ` It said: ${said}` : " The prompt may have been blocked by its safety filter."}`);
};

// OpenRouter: picture models (e.g. google/gemini-2.5-flash-image) answer on
// its chat API with the picture as a data URL in message.images.
const generateOpenRouter = async ({ model, key, prompt, shape }) => {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: SIZES.gemini[shape] || SIZES.gemini.wide },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw fail(`The image service said: ${await readError(res)}`);
  const body = await res.json().catch(() => ({}));
  const message = body?.choices?.[0]?.message;
  const url = message?.images?.[0]?.image_url?.url || "";
  const data = url.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (data) return { buffer: Buffer.from(data[2], "base64"), mimeType: data[1] };
  const said = typeof message?.content === "string" ? message.content.trim().slice(0, 300) : "";
  throw fail(`The image service sent back no picture.${said ? ` It said: ${said}` : " Check that the model can make pictures."}`);
};

// A self-hosted server (LocalAI and the like). The key is optional, the
// model is the name the server knows it by, and the first picture after a
// model loads can take minutes on a small graphics card.
const generateLocal = async ({ model, key, baseUrl, prompt, shape }) => {
  const endpoint = localEndpoint(baseUrl);
  if (!model) throw fail("Enter the picture model's name as your server knows it, in Settings → AI → Features → AI pictures.", 400);
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, prompt, size: SIZES.local[shape] || SIZES.local.wide, n: 1, response_format: "b64_json" }),
      signal: AbortSignal.timeout(270000),
    });
  } catch (e) {
    throw fail(e.name === "TimeoutError"
      ? "The picture server took over 4 minutes. Try a smaller or faster model."
      : `Couldn't reach the picture server at ${new URL(endpoint).origin}. Is it running?`);
  }
  if (!res.ok) throw fail(`The picture server said: ${await readError(res)}`);
  const item = (await res.json().catch(() => ({})))?.data?.[0];
  if (item?.b64_json) {
    const buffer = Buffer.from(item.b64_json, "base64");
    return { buffer, mimeType: sniffType(buffer) };
  }
  // Some servers only hand back a link to the file they saved.
  if (item?.url) {
    const fileUrl = new URL(item.url, endpoint);
    if (!/^https?:$/.test(fileUrl.protocol)) throw fail("The picture server sent back no picture.");
    const file = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
    const type = file.headers.get("content-type") || "";
    if (!file.ok || !/^image\/(png|jpeg|webp)/.test(type)) throw fail("The picture server's file couldn't be fetched.");
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_PICTURE_BYTES) throw fail("The picture server's file is too big.");
    return { buffer, mimeType: type.split(";")[0] };
  }
  throw fail("The picture server sent back no picture.");
};

// Cloudflare Workers AI picture models (Leonardo Lucid Origin / Phoenix,
// FLUX, SDXL…) on /ai/run/<model>. Most answer JSON with the picture as
// base64 in result.image; some send the picture itself.
const generateCloudflare = async ({ model, key, baseUrl, prompt, shape }) => {
  const account = cloudflareAccount(baseUrl);
  if (!account) throw fail("Add your Cloudflare account ID (32 letters and digits, on the Workers AI page of the Cloudflare dashboard).", 400);
  if (!key) throw fail("Add a Cloudflare API token with Workers AI permission.", 400);
  const name = String(model || "@cf/leonardo/lucid-origin").trim();
  if (!/^@?[\w.-]+(\/[\w.-]+)*$/.test(name) || name.split("/").some((part) => /^\.+$/.test(part))) throw fail("That model name doesn't look right, e.g. @cf/leonardo/lucid-origin.", 400);
  const [width, height] = SIZES.cloudflare[shape] || SIZES.cloudflare.wide;
  let res;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ prompt: String(prompt).slice(0, 2000), width, height }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    throw fail(e.name === "TimeoutError" ? "Cloudflare took over 2 minutes to make the picture." : "Couldn't reach Cloudflare.");
  }
  const type = res.headers.get("content-type") || "";
  if (res.ok && /^image\//.test(type)) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType: type.split(";")[0] };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const said = (body.errors || []).map((e) => e.message).filter(Boolean).join("; ") || `${res.status} ${res.statusText}`;
    throw fail(`Cloudflare said: ${said}`);
  }
  const b64 = body.result?.image || body.image;
  if (!b64) throw fail("Cloudflare sent back no picture. Check that the model makes pictures.");
  const buffer = Buffer.from(b64, "base64");
  return { buffer, mimeType: sniffType(buffer) };
};

const PURPOSE = {
  notice: "a cover picture for a notice to students",
  landing: "a picture for the public landing page of an education platform",
  course: "a cover picture for a course in an education platform's catalogue",
  lesson: "a picture shown on the board of a teaching video: the subject clear, realistic and accurate, on a plain light background",
  poster: "a picture for a social media post by an education centre, with calm space for text laid on top",
  // Never mention a page, form or sign-in here: image models then draw a
  // login screen. Describe only the scenery, and rule screens out.
  auth: "a calm, softly lit background scene on the theme of learning and study (for example a quiet desk with books, a library, or soft abstract shapes), with plenty of empty, uncluttered space. It must not show any screen, phone, laptop, website, app, form, button, text field or other user interface",
};

// The image model's prompt: the staff member's words, kept to a clean
// editorial style, with no text drawn into the picture (image models spell
// badly, and Bangla worse).
const picturePrompt = ({ prompt, purpose }) =>
  `${String(prompt).trim().slice(0, 900)}. This is ${PURPOSE[purpose] || PURPOSE.notice}. Clean, modern, friendly illustration or photo style, bright natural light, uncluttered composition. Do not include any words, letters, numbers, logos or watermarks in the image.`;

// ---------------------------------------------------------------- diagrams

const diagramSchema = z.object({
  svg: z.string().min(20).max(30000),
  caption: z.string().max(200).optional(),
});

// build: drawn to be shown step by step (the video board reveals each
// <g data-step="n"> group in turn).
const diagramPrompt = ({ prompt, context, build = false }) => ({
  system: [
    "You draw clear, accurate diagrams for exam questions and solutions as SVG, the way a careful teacher draws on a whiteboard.",
    "Physics, chemistry, maths and biology diagrams: circuits, ray diagrams, force diagrams, graphs with labelled axes, geometry, apparatus, simple structures.",
    "Accuracy first: angles, lengths and labels must match the question. Only label values the question gives. Prefer fewer, correct elements over a busy drawing.",
    "Return only a single JSON object. No prose, no markdown fences, no explanation before or after.",
  ].join(" "),
  prompt: `${context ? `Question / solution text:\n${String(context).slice(0, 2500)}\n\n` : ""}What to draw: ${String(prompt || "the diagram this question needs").slice(0, 800)}

SVG rules:
- One <svg> element with xmlns="http://www.w3.org/2000/svg", viewBox="0 0 800 500", width="800" height="500".
- White background: start with <rect width="800" height="500" fill="#ffffff"/>.
- Black strokes (stroke="#111"), stroke-width 2-3. Use one accent colour (#1f6fd1) only to highlight what matters.
- Text: font-family="Arial, sans-serif", font-size 20-26, fill="#111". Short labels only (A, B, θ, 5 Ω, F = 10 N).
- Only these elements: svg, g, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, defs, marker. Arrowheads with <marker>.
- No scripts, no images, no links, no CSS, no foreignObject.${build ? `
- It is revealed step by step, as a teacher would draw it: put each step's elements in its own <g data-step="1">, <g data-step="2">… in drawing order (2 to 6 steps: the main object first, then forces, labels, results). The background rect stays outside every group.` : ""}

Shape:
{ "svg": "<svg ...>...</svg>", "caption": "one short line describing the diagram" }`,
});

// Keeps only drawing elements and attributes, so what reaches the browser
// can't run code or fetch anything. The admin page also only ever loads it
// as an <img>, where SVG scripts never run.
const ALLOWED_TAGS = new Set(["svg", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "defs", "marker"]);
const sanitizeSvg = (raw) => {
  let svg = String(raw || "").trim();
  const start = svg.indexOf("<svg");
  const end = svg.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw fail("The AI didn't return a drawing. Try again, or describe the diagram more simply.");
  svg = svg.slice(start, end + 6);
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  // Elements whose content is code or another document go with their content;
  // then every other tag not on the list goes (its text, if any, stays).
  svg = svg.replace(/<(script|style|foreignObject|iframe|object|embed|image|a|use)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, "");
  svg = svg.replace(/<\/?([a-zA-Z][\w:-]*)\b[^>]*\/?>/g, (m, tag) => (ALLOWED_TAGS.has(tag) ? m : ""));
  // No event handlers, links or style blocks on what remains.
  svg = svg.replace(/\s(on\w+|href|xlink:href|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  if (!/xmlns=/.test(svg.slice(0, 200))) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
};

module.exports = { cloudflareAccount, generateImage, picturePrompt, diagramPrompt, diagramSchema, sanitizeSvg };
