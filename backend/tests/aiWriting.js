// "Write with AI" and AI images: prompts carry the real facts, schemas
// accept what the UI expects, SVG diagrams are cleaned, and the picture
// services are called the way their APIs want. Offline: fetch is stubbed.

process.env.NODE_ENV = "test";

const { writingTask, WRITING_TASKS } = require("../ai/writing");
const { generateImage, picturePrompt, sanitizeSvg, diagramSchema } = require("../ai/images");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

(async () => {
  console.log("\nexam description");
  const exam = {
    title: "Physics mock 3", mode: "mock", durationMinutes: 120, attemptsAllowed: 1, questionCount: 40, totalMarks: 100,
    types: ["mcq", "written"], hasWritten: true, scriptGraceMinutes: 10, awayMode: "submit", awayMinutes: 3, showResultImmediately: false,
  };
  let t = writingTask("examDescription", { exam, prompt: "Chapters 3-5", language: "en" });
  check("time is stated in hours", t.prompt.includes("2 hours"), t.prompt);
  check("the leave rule matches the exam", t.prompt.includes("more than 3 minutes submits the exam automatically"));
  check("script upload grace is there for written exams", t.prompt.includes("10 minutes after time is up"));
  check("the teacher's note is passed on", t.prompt.includes("Chapters 3-5"));
  check("the model is told not to invent rules", /Never add a rule/.test(t.system));
  t = writingTask("examDescription", { exam: { ...exam, awayMode: "off", hasWritten: false } });
  check("leave-off says it is only recorded", t.prompt.includes("recorded and teachers can see it"));
  check("no script line without written questions", !t.prompt.includes("after time is up"));
  check("Bangla is asked for when chosen", /Bangla/.test(writingTask("examDescription", { exam, language: "bn" }).system));

  console.log("\nother tasks");
  check("every task builds", WRITING_TASKS.every((k) => writingTask(k, { exam, prompt: "x", text: "Hello", title: "t", body: "b", section: "hero" }).prompt));
  const n = writingTask("notice", { prompt: "Exam moved to Sunday 3 pm", noticeType: "batch", batchNames: ["Physics A"] });
  check("a batch notice names its batch", n.prompt.includes("students in Physics A"));
  check("a notice gives title, body and push line", n.schema.safeParse({ title: "Exam moved", bodyMarkdown: "It's on Sunday.", pushText: "Physics exam now Sunday 3 pm" }).success);
  const faq = writingTask("landingSection", { section: "faq", prompt: "HSC coaching" });
  check("FAQ wants question/answer items", faq.schema.safeParse({ heading: "Questions", items: [{ q: "Fees?", a: "From 2,000 taka." }] }).success);
  check("FAQ rejects a missing heading", !faq.schema.safeParse({ items: [] }).success);
  check("an unknown section falls back to a heading", writingTask("landingSection", { section: "notices" }).schema.safeParse({ heading: "News" }).success);
  check("landing copy may not invent numbers", /Never invent numbers/.test(faq.system));
  const cd = writingTask("courseDescription", { kind: "batch", course: { facts: ["Batch: HSC Physics A", "Recorded lectures: 12"], current: "Old blurb" }, prompt: "HSC 2027" });
  check("a course description is written from the batch's facts", cd.prompt.includes("Recorded lectures: 12") && cd.prompt.includes("HSC 2027"), cd.prompt);
  check("…improving the current text", cd.prompt.includes("Old blurb"));
  check("…and may not invent results, teachers or prices", /Never invent results/.test(cd.system) && /prices/.test(cd.system));
  check("a program description names its batches", /name the batches/.test(writingTask("courseDescription", { kind: "program", course: { facts: [] } }).prompt));
  check("English text translates to Bangla", /Bangla/.test(writingTask("translate", { text: "Hello" }).system));
  check("Bangla text translates to English", /into English/.test(writingTask("translate", { text: "পরীক্ষা রবিবার" }).system));
  let threw = false;
  try { writingTask("nope", {}); } catch { threw = true; }
  check("an unknown task is refused", threw);

  console.log("\ndiagrams");
  const dirty = `Here you go: <svg viewBox="0 0 800 500" onload="x()"><script>alert(1)</script><style>*{}</style><rect width="800" height="500" fill="#fff"/><line x1="0" y1="0" x2="10" y2="10" stroke="#111"/><a href="javascript:x()"><text>bad</text></a><image href="http://evil/x.png"/><foreignObject><div>x</div></foreignObject><text x="5" y="20" onclick="y()">5 Ω</text></svg> hope it helps`;
  const clean = sanitizeSvg(dirty);
  check("text around the svg is dropped", clean.startsWith("<svg") && clean.endsWith("</svg>"), clean);
  check("scripts, styles, links, images and foreignObject go", !/script|style|<a\b|<image|foreignObject|javascript|evil/i.test(clean), clean);
  check("event handlers go", !/on(load|click)=/i.test(clean), clean);
  check("drawing elements and labels stay", clean.includes("<line") && clean.includes("5 Ω"), clean);
  check("xmlns is added so it loads as an image", clean.includes('xmlns="http://www.w3.org/2000/svg"'));
  threw = false;
  try { sanitizeSvg("no drawing here"); } catch { threw = true; }
  check("a reply with no svg is an error", threw);
  check("diagram schema wants an svg", !diagramSchema.safeParse({ caption: "x" }).success);

  console.log("\npictures");
  check("pictures never ask for text in the image", /Do not include any words/.test(picturePrompt({ prompt: "students", purpose: "notice" })));
  check("a course cover says it's for the catalogue", /course in an education platform's catalogue/.test(picturePrompt({ prompt: "physics", purpose: "course" })));
  const realFetch = global.fetch;
  const png = Buffer.from("fakepng").toString("base64");
  let seen;
  global.fetch = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), headers: opts.headers };
    if (url.includes("openai")) return { ok: true, json: async () => ({ data: [{ b64_json: png }] }) };
    return { ok: true, json: async () => ({ predictions: [{ bytesBase64Encoded: png, mimeType: "image/png" }] }) };
  };
  let img = await generateImage({ provider: "openai", key: "k", prompt: "a library", shape: "wide" });
  check("OpenAI: wide size and default model", seen.body.size === "1536x1024" && seen.body.model === "gpt-image-1", seen.body);
  check("OpenAI: bearer key", seen.headers.authorization === "Bearer k");
  check("OpenAI: low quality unless asked", seen.body.quality === "low", seen.body);
  await generateImage({ provider: "openai", key: "k", model: "gpt-image-2", quality: "high", prompt: "x" });
  check("OpenAI: chosen quality and model are sent", seen.body.quality === "high" && seen.body.model === "gpt-image-2", seen.body);
  img = await generateImage({ provider: "openai", key: "k", prompt: "a library", shape: "wide" });
  check("OpenAI: picture decoded", img.buffer.toString() === "fakepng");
  img = await generateImage({ provider: "gemini", key: "g", prompt: "a library", shape: "square" });
  check("Gemini: aspect ratio and key header", seen.body.parameters.aspectRatio === "1:1" && seen.headers["x-goog-api-key"] === "g", seen);
  check("Gemini: default Imagen model", seen.url.includes("imagen-4.0-generate-001"));
  check("Gemini: picture decoded", img.buffer.toString() === "fakepng");
  global.fetch = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Here it is" }, { inlineData: { mimeType: "image/png", data: png } }] } }] }) };
  };
  img = await generateImage({ provider: "gemini", key: "g", model: "gemini-2.5-flash-image", prompt: "a library", shape: "wide" });
  check("Gemini picture model: generateContent, not predict", seen.url.endsWith("/models/gemini-2.5-flash-image:generateContent"), seen.url);
  check("Gemini picture model: asks for an image at the right shape", seen.body.generationConfig.responseModalities.includes("IMAGE") && seen.body.generationConfig.imageConfig.aspectRatio === "16:9", seen.body);
  check("Gemini picture model: picture decoded", img.buffer.toString() === "fakepng" && img.mimeType === "image/png");
  global.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "I can't draw that." }] } }] }) });
  let declined;
  try { await generateImage({ provider: "gemini", key: "g", model: "gemini-2.5-flash-image", prompt: "x" }); } catch (e) { declined = e; }
  check("Gemini picture model: a text-only reply is passed on", /no picture.*I can't draw that/.test(declined?.message), declined?.message);
  global.fetch = async () => ({ ok: false, status: 400, statusText: "Bad", json: async () => ({ error: { message: "quota exceeded" } }) });
  let err;
  try { await generateImage({ provider: "openai", key: "k", prompt: "x" }); } catch (e) { err = e; }
  check("a service error is passed on in plain words", /quota exceeded/.test(err?.message), err?.message);
  err = null;
  try { await generateImage({ provider: "openai", key: null, prompt: "x" }); } catch (e) { err = e; }
  check("no key says where to add one", err?.statusCode === 400 && /Settings/.test(err.message));
  err = null;
  try { await generateImage({ provider: "none", key: "k", prompt: "x" }); } catch (e) { err = e; }
  check("no provider says to choose one", err?.statusCode === 400);

  console.log("\nOpenRouter");
  global.fetch = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return { ok: true, json: async () => ({ choices: [{ message: { content: "", images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }] } }] }) };
  };
  img = await generateImage({ provider: "openrouter", key: "or", prompt: "a library", shape: "square" });
  check("OpenRouter: chat API with image output and Nano Banana by default", seen.url === "https://openrouter.ai/api/v1/chat/completions" && seen.body.modalities.includes("image") && seen.body.model === "google/gemini-2.5-flash-image", seen);
  check("OpenRouter: aspect ratio and bearer key", seen.body.image_config.aspect_ratio === "1:1" && seen.headers.authorization === "Bearer or");
  check("OpenRouter: picture decoded", img.buffer.toString() === "fakepng" && img.mimeType === "image/png");
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "This model only writes text." } }] }) });
  let orErr;
  try { await generateImage({ provider: "openrouter", key: "or", model: "some/text-model", prompt: "x" }); } catch (e) { orErr = e; }
  check("OpenRouter: a text reply is passed on", /no picture.*only writes text/.test(orErr?.message), orErr?.message);

  console.log("\nlocal picture server");
  global.fetch = async (url, opts) => {
    seen = { url: String(url), body: opts?.body && JSON.parse(opts.body), headers: opts?.headers || {} };
    return { ok: true, json: async () => ({ data: [{ b64_json: png }] }) };
  };
  img = await generateImage({ provider: "local", baseUrl: "http://gpu-box:8080", model: "flux.1-schnell", prompt: "a library", shape: "tall" });
  check("local: bare address uses /v1", seen.url === "http://gpu-box:8080/v1/images/generations", seen.url);
  check("local: asks for base64, model and size", seen.body.response_format === "b64_json" && seen.body.model === "flux.1-schnell" && seen.body.size === "832x1216", seen.body);
  check("local: no key, no auth header", !seen.headers.authorization);
  check("local: picture decoded", img.buffer.toString() === "fakepng" && img.mimeType === "image/png");
  await generateImage({ provider: "local", baseUrl: "http://gpu-box:8080/v1/", model: "m", key: "s", prompt: "x" });
  check("local: /v1 address is not doubled", seen.url === "http://gpu-box:8080/v1/images/generations", seen.url);
  check("local: optional key is sent", seen.headers.authorization === "Bearer s");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64");
  global.fetch = async () => ({ ok: true, json: async () => ({ data: [{ b64_json: jpeg }] }) });
  img = await generateImage({ provider: "local", baseUrl: "http://x:8080", model: "m", prompt: "x" });
  check("local: JPEG is recognised", img.mimeType === "image/jpeg");
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return { ok: true, json: async () => ({ data: [{ url: "/generated-images/a.png" }] }) };
    return { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => Buffer.from("fromurl") };
  };
  img = await generateImage({ provider: "local", baseUrl: "http://x:8080", model: "m", prompt: "x" });
  check("local: a returned link is fetched from the server", calls[1] === "http://x:8080/generated-images/a.png" && img.buffer.toString() === "fromurl", calls);
  global.fetch = async () => { throw new TypeError("fetch failed"); };
  err = null;
  try { await generateImage({ provider: "local", baseUrl: "http://x:8080", model: "m", prompt: "x" }); } catch (e) { err = e; }
  check("local: server down says so", /Couldn't reach the picture server at http:\/\/x:8080/.test(err?.message), err?.message);
  err = null;
  try { await generateImage({ provider: "local", baseUrl: "", model: "m", prompt: "x" }); } catch (e) { err = e; }
  check("local: no address says where to add it", err?.statusCode === 400 && /address/.test(err.message));
  err = null;
  try { await generateImage({ provider: "local", baseUrl: "http://x:8080", model: "", prompt: "x" }); } catch (e) { err = e; }
  check("local: no model name is refused", err?.statusCode === 400 && /model/.test(err.message));
  global.fetch = realFetch;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
