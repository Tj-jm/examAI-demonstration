// Video lessons: the inputs a script is written from, and the shape sent
// to the admin and student players. See models/videoLessonModel.js.
const storage = require("../adapters/storage");
const { streamLink } = require("./streamLink");
const { shapeField } = require("./shapeQuestion");

// What the solution video explains: the question's own solution, never
// one the model works out.
const solutionOf = (q) => {
  const parts = [];
  if (q.solutionText?.trim()) parts.push(q.solutionText.trim());
  else if (q.modelAnswer?.trim()) parts.push(q.modelAnswer.trim());
  if (q.type === "mtf" && q.statements?.length) {
    parts.push(q.statements.map((st, i) => `${i + 1}. ${st.text}: ${st.isTrue ? "true" : "false"}`).join("\n"));
  }
  return parts.join("\n\n");
};

// A lecture's material: its description and notes, the text read from its
// attachments, and anything the admin pasted. Capped so a long book chapter
// still fits the model.
const MATERIAL_MAX = 40000;
const lectureMaterial = async (lecture, extra) => {
  const Document = require("../models/documentModel");
  const Media = require("../models/mediaModel");
  const parts = [];
  if (lecture.bodyMarkdown?.trim()) parts.push(lecture.bodyMarkdown.trim());
  const files = await Media.find({ _id: { $in: lecture.attachments || [] } }).select("title key driver").lean();
  for (const f of files) {
    const doc = await Document.findOne({ key: f.key, driver: f.driver }).select("extractedText").lean();
    if (doc?.extractedText?.trim()) parts.push(`# ${f.title || "Attachment"}\n${doc.extractedText.trim()}`);
  }
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join("\n\n").slice(0, MATERIAL_MAX);
};

// The lesson as the players use it: each segment's audio as a playable url,
// and the question's figure for image items.
// ---- Narration ------------------------------------------------------------
// The voice reads "say" aloud, so maths left in it ($s=\sqrt{...}$) is put
// into words. The prompt asks for words already; this catches what slips.
const GREEK = ["alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "nu", "pi", "rho", "sigma", "tau", "phi", "omega", "eta"];
const WORDS = {
  times: " times ", cdot: " times ", div: " divided by ", pm: " plus or minus ", approx: " is about ",
  neq: " is not equal to ", ne: " is not equal to ", le: " is at most ", leq: " is at most ", ge: " is at least ", geq: " is at least ",
  lt: " is less than ", gt: " is greater than ", infty: " infinity ", parallel: " is parallel to ", perp: " is perpendicular to ",
  therefore: " therefore ", rightarrow: " gives ", Rightarrow: " so ", to: " to ", circ: " degrees ", degree: " degrees ",
  sin: " sine ", cos: " cos ", tan: " tan ", log: " log ", ln: " natural log of ", Delta: " delta ",
};
// The {...} group starting at i (or one character), and where it ends.
const group = (t, i) => {
  while (t[i] === " ") i += 1;
  if (t[i] !== "{") return [t[i] || "", i + 1];
  let depth = 0;
  for (let j = i; j < t.length; j += 1) {
    if (t[j] === "{") depth += 1;
    else if (t[j] === "}" && --depth === 0) return [t.slice(i + 1, j), j + 1];
  }
  return [t.slice(i + 1), t.length];
};
const speakMath = (tex) => {
  let t = String(tex);
  let out = "";
  for (let i = 0; i < t.length;) {
    const c = t[i];
    if (c === "\\") {
      const name = (t.slice(i + 1).match(/^[a-zA-Z]+/) || [""])[0];
      i += 1 + name.length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [a, j] = group(t, i); const [b, k] = group(t, j); i = k;
        out += ` ${speakMath(a)} over ${speakMath(b)} `;
      } else if (name === "sqrt") {
        const [a, j] = group(t, i); i = j;
        out += ` the square root of ${speakMath(a)} `;
      } else if (name === "vec" || name === "overrightarrow") {
        const [a, j] = group(t, i); i = j;
        out += ` vector ${speakMath(a)} `;
      } else if (name === "hat") {
        const [a, j] = group(t, i); i = j;
        out += ` ${speakMath(a)} hat `;
      } else if (["text", "mathrm", "mathbf", "operatorname", "left", "right", "big", "Big"].includes(name)) {
        if (["left", "right", "big", "Big"].includes(name)) continue;
        const [a, j] = group(t, i); i = j;
        out += ` ${a} `;
      } else if (WORDS[name]) out += WORDS[name];
      else if (GREEK.includes(name.toLowerCase())) out += ` ${name.toLowerCase()} `;
      else if (name) out += ` ${name} `;
      continue;
    }
    if (c === "^") {
      if (/^\^\s*\\circ/.test(t.slice(i))) { i += t.slice(i).indexOf("circ") + 4; out += " degrees "; continue; }
      const [a, j] = group(t, i + 1); i = j;
      out += a === "2" ? " squared " : a === "3" ? " cubed " : a === "\\circ" ? " degrees " : ` to the power ${speakMath(a)} `;
      continue;
    }
    if (c === "_") { const [a, j] = group(t, i + 1); i = j; out += ` ${speakMath(a)} `; continue; }
    if (c === "=") out += " equals ";
    else if (c === "+") out += " plus ";
    else if (c === "-" || c === "−") out += " minus ";
    else if (c === "/") out += " over ";
    else if (c === "<") out += " is less than ";
    else if (c === ">") out += " is greater than ";
    else if ("{}()[]&".includes(c)) out += " ";
    else out += c;
    i += 1;
  }
  return out.replace(/\s+/g, " ").trim();
};
// Bangla narration: maths said the way a Bangla teacher says it, and
// Latin letters by their names ("M" as এম), never as Bangla letters.
const BN_MATH = [
  ["the square root of", "রুট"], ["is not equal to", "সমান নয়"], ["is perpendicular to", "লম্ব"],
  ["is parallel to", "সমান্তরাল"], ["plus or minus", "যোগ বিয়োগ"], ["divided by", "ভাগ"],
  ["is less than", "ছোট"], ["is greater than", "বড়"], ["is at most", "এর সমান বা ছোট"], ["is at least", "এর সমান বা বড়"],
  ["is about", "প্রায়"], ["to the power", "টু দি পাওয়ার"], ["natural log of", "লন"], ["equals", "সমান"],
  ["plus", "যোগ"], ["minus", "বিয়োগ"], ["times", "গুণ"], ["over", "বাই"], ["squared", "স্কয়ার"], ["cubed", "কিউব"],
  ["degrees", "ডিগ্রি"], ["vector", "ভেক্টর"], ["hat", "হ্যাট"], ["infinity", "অসীম"], ["therefore", "সুতরাং"],
  ["gives", "পাই"], ["so", "সুতরাং"], ["sine", "সাইন"], ["cos", "কস"], ["tan", "ট্যান"], ["log", "লগ"],
  ["pi", "পাই"], ["theta", "থিটা"], ["alpha", "আলফা"], ["beta", "বিটা"], ["gamma", "গামা"], ["delta", "ডেল্টা"],
  ["lambda", "ল্যামডা"], ["omega", "ওমেগা"], ["mu", "মিউ"], ["sigma", "সিগমা"], ["phi", "ফাই"], ["rho", "রো"], ["epsilon", "এপসাইলন"],
];
const BN_LETTERS = { a: "এ", b: "বি", c: "সি", d: "ডি", e: "ই", f: "এফ", g: "জি", h: "এইচ", i: "আই", j: "জে", k: "কে", l: "এল", m: "এম", n: "এন", o: "ও", p: "পি", q: "কিউ", r: "আর", s: "এস", t: "টি", u: "ইউ", v: "ভি", w: "ডাব্লিউ", x: "এক্স", y: "ওয়াই", z: "জেড" };
// A unit right after a number is said as the unit, not spelt out.
const BN_UNITS = [
  ["m/s^2", "মিটার প্রতি বর্গ সেকেন্ড"], ["m/s", "মিটার প্রতি সেকেন্ড"], ["km/h", "কিলোমিটার প্রতি ঘণ্টা"],
  ["kg", "কিলোগ্রাম"], ["km", "কিলোমিটার"], ["cm", "সেন্টিমিটার"], ["mm", "মিলিমিটার"], ["Hz", "হার্জ"],
  ["m", "মিটার"], ["s", "সেকেন্ড"], ["N", "নিউটন"], ["J", "জুল"], ["W", "ওয়াট"], ["g", "গ্রাম"], ["V", "ভোল্ট"], ["K", "কেলভিন"],
];
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const banglaMath = (spoken) => {
  let out = ` ${spoken} `;
  for (const [en, bn] of BN_MATH) out = out.replace(new RegExp(`(?<![A-Za-z])${escapeRe(en)}(?![A-Za-z])`, "g"), bn);
  return out.trim();
};
const banglaLetters = (text) => {
  let out = text;
  for (const [u, bn] of BN_UNITS) out = out.replace(new RegExp(`(\\d)\\s*${escapeRe(u)}(?![A-Za-z])`, "g"), `$1 ${bn}`);
  // One or two Latin letters are symbols (M, T, mv, 2r): each letter by
  // its name. Longer runs are words, left as they are.
  return out.replace(/(?<![A-Za-z])[A-Za-z]{1,2}(?![A-Za-z])/g, (w) => [...w].map((ch) => BN_LETTERS[ch.toLowerCase()]).join(" "));
};
const BANGLA_SCRIPT = /[ঀ-৿]/;

const spokenText = (say, { language } = {}) => {
  const text = dollarMath(say);
  // Bangla by the narration itself; the lesson's language only decides for
  // a narration that is all maths.
  const words = text.replace(/\$[^$]*\$/g, "");
  const bangla = BANGLA_SCRIPT.test(text) || (/bangla|bengali|বাংলা/i.test(language || "") && !/[A-Za-z]{2,}/.test(words));
  const hasMath = text.includes("$") || /\\[a-zA-Z]/.test(text);
  let out = text;
  if (hasMath) {
    out = text.split("$")
      .map((part, i) => {
        if (!(i % 2 === 1 || /\\[a-zA-Z]/.test(part))) return part;
        const words = speakMath(part);
        return bangla ? banglaMath(words) : words;
      })
      .join(" ");
  }
  // Letter names only in narration written in Bangla: an English sentence
  // in a Bangla lesson keeps its words.
  if (BANGLA_SCRIPT.test(text)) out = banglaLetters(out);
  return out.replace(/\s+([,.;:!?।])/g, "$1").replace(/\s+/g, " ").trim();
};

// ---- Timing ---------------------------------------------------------------
// The voice is made one sentence at a time (segment.parts), so a board item
// can appear exactly as its cue is spoken. The players split nothing: they
// use the parts' own text. A sentence of one or two words joins the one
// before it, so "e.g." or "So." doesn't become a clip of its own.
const sentencesOf = (say) => {
  const raw = String(say || "").trim().split(/(?<=[.!?।])\s+(?=\S)/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const x of raw) {
    if (out.length && (x.split(/\s+/).length < 3 || out[out.length - 1].split(/\s+/).length < 3)) out[out.length - 1] += ` ${x}`;
    else out.push(x);
  }
  return out;
};

// Words only, for finding a cue in the narration whatever its punctuation.
const plainWords = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
const cueFound = (say, cue) => {
  const c = plainWords(cue);
  return Boolean(c) && ` ${plainWords(say)} `.includes(` ${c} `);
};

// The board's colours and corner mark, from Settings (AppSettings.videoBoard).
const BOARD_PRESETS = {
  whiteboard: { board: "#fbfaf6", ink: "#1d2330", accent: "#2f6fdf" },
  blackboard: { board: "#22272b", ink: "#f2f2ee", accent: "#ffd54f" },
  greenboard: { board: "#1f3d30", ink: "#f4f1e8", accent: "#ffe082" },
  dark: { board: "#0f172a", ink: "#e2e8f0", accent: "#38bdf8" },
};
const boardStyle = async () => {
  const AppSettings = require("../models/appSettingsModel");
  const s = await AppSettings.get();
  const vb = s.videoBoard || {};
  const base = BOARD_PRESETS[vb.preset] || BOARD_PRESETS.whiteboard;
  const colours = vb.preset === "custom"
    ? { board: vb.board || base.board, ink: vb.ink || base.ink, accent: vb.accent || base.accent }
    : base;
  return {
    ...colours,
    logo: vb.showLogo ? s.logo || null : null,
    name: vb.showName ? s.siteName || null : null,
    corner: vb.corner || "tr",
    callouts: vb.callouts || "soft",
  };
};
// A video's own look over the site's: a preset, or custom colours.
const HEX = /^#[0-9a-f]{6}$/i;
const lookOver = (base, look) => lookColours(base, look);
const lookColours = (style, look) => {
  if (!look) return style;
  if (look.preset && BOARD_PRESETS[look.preset]) return { ...style, ...BOARD_PRESETS[look.preset] };
  if (look.preset === "custom") {
    return { ...style, ...(HEX.test(look.board || "") ? { board: look.board } : {}), ...(HEX.test(look.ink || "") ? { ink: look.ink } : {}), ...(HEX.test(look.accent || "") ? { accent: look.accent } : {}) };
  }
  return style;
};
const cleanLook = (look) => {
  const extra = {};
  if (!look || typeof look !== "object" || !look.preset) return { preset: null, board: null, ink: null, accent: null, ...extra };
  if (BOARD_PRESETS[look.preset]) return { preset: look.preset, board: null, ink: null, accent: null, ...extra };
  if (look.preset !== "custom") return { preset: null, board: null, ink: null, accent: null, ...extra };
  const c = (v) => (HEX.test(v || "") ? v : null);
  return { preset: "custom", board: c(look.board), ink: c(look.ink), accent: c(look.accent), ...extra };
};

// A job left "running" by a server that stopped mid-way reads as failed.
const JOB_STALE_MS = 20 * 60 * 1000;
const jobOf = (job) => {
  if (!job?.status) return null;
  const stale = job.status === "running" && Date.now() - new Date(job.startedAt).getTime() > JOB_STALE_MS;
  return {
    kind: job.kind,
    status: stale ? "failed" : job.status,
    startedAt: job.startedAt,
    expectSeconds: job.expectSeconds,
    done: job.done || 0,
    total: job.total || 0,
    error: stale ? "It stopped part way (the server restarted). Try again." : job.error,
  };
};

// Where each image item's picture is: the question's figure, the
// solution's picture, or an upload.
const itemUrl = async (b, { imageUrl, solutionImageUrl }) => {
  if (b.type === "clip") return b.media?.key ? storage.urlFor(b.media.key, b.media.driver).catch(() => null) : null;
  if (b.type !== "image") return undefined;
  if (b.src === "upload") return b.media?.key ? storage.urlFor(b.media.key, b.media.driver).catch(() => null) : null;
  return b.src === "solution" ? solutionImageUrl || null : imageUrl || null;
};

const shapeLesson = async (lesson, { imageUrl, solutionImageUrl } = {}) => {
  if (!lesson) return null;
  const doc = lesson.toObject ? lesson.toObject() : lesson;
  const segments = await Promise.all((doc.segments || []).map(async (s) => ({
    _id: s._id,
    say: s.say,
    // The voice, a clip per sentence (see sentencesOf).
    parts: (s.parts || []).length ? s.parts.map((p, i) => ({ text: p.text, audioUrl: p.key ? streamLink(p.key, p.driver) : null, durationSeconds: p.durationSeconds || null, marks: p.marks?.length ? p.marks : null, index: i })) : null,
    // Tidied on the way out too, so lessons saved before a fix still show.
    board: await Promise.all((s.board || []).map(async (b) => ({
      ...b,
      text: b.type === "code" || b.type === "output" ? b.text : tidyInline(b.text),
      latex: tidyMath(b.latex),
      items: b.items ? b.items.map(tidyInline) : b.items,
      rows: b.rows ? b.rows.map((r) => (r.cells || []).map(tidyInline)) : b.rows,
      url: await itemUrl(b, { imageUrl, solutionImageUrl }),
      // A clip's timed lines, each with its voice once made (no file keys).
      lines: b.lines ? b.lines.map((l, i) => ({ at: l.at, text: l.text, durationSeconds: lineCurrent(l) ? l.durationSeconds || null : null, audioUrl: lineCurrent(l) ? streamLink(l.key, l.driver) : null, index: i })) : b.lines,
      // A sequence's pictures, each with its address.
      ...(b.type === "sequence" ? { frames: await Promise.all((b.frames || []).map(async (f) => ({ ...f, url: f.media?.key ? await storage.urlFor(f.media.key, f.media.driver).catch(() => null) : null }))) } : {}),
    }))),
    background: s.background || null,
    layout: s.layout || null,
    audioUrl: s.audio?.key && !(s.parts || []).length ? streamLink(s.audio.key, s.audio.driver) : null,
    durationSeconds: s.audio?.durationSeconds || null,
    audioCurrent: voiceCurrent(s),
  })));
  return {
    _id: doc._id,
    kind: doc.kind,
    question: doc.question,
    lecture: doc.lecture,
    title: doc.title,
    language: doc.language,
    published: doc.published,
    voice: doc.voice,
    exportMedia: doc.exportMedia,
    exportedAt: doc.exportedAt,
    generatedAt: doc.generatedAt,
    updatedAt: doc.updatedAt,
    job: jobOf(doc.job),
    style: lookOver(await boardStyle(), doc.look),
    look: doc.look?.preset || doc.look?.board ? { preset: doc.look.preset || null, board: doc.look.board || null, ink: doc.look.ink || null, accent: doc.look.accent || null } : null,
    imageUrl: imageUrl || null,
    solutionImageUrl: solutionImageUrl || null,
    segments,
  };
};

// ---- Pictures the script writer may show ---------------------------------
// Only the video's own: for a lecture, its attachments and the pictures in
// its notes. A question's figure and solution picture are offered as
// src "question" / "solution" instead, so a question gets no list. Never
// pictures of other questions or lectures (the AI picked wrong ones). The
// model can't see them, so each comes with a caption or file name.
// Listed as p1, p2…; an image item { src: "library", ref } picks one.
const LIBRARY_MAX = 16;
const clipText = (t, n) => String(t || "").replace(/\s+/g, " ").replace(/[$\\]/g, "").trim().slice(0, n);
const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
// A picture's place in storage from its address in lecture notes.
const mediaOfUrl = async (url) => {
  const Media = require("../models/mediaModel");
  const m = /^\/media\/(.+)$/.exec(url);
  if (m) return { key: decodeURIComponent(m[1]), driver: "local" };
  let pathname = "";
  // Full addresses, and the app's own relative ones (/api/stream/file/<key>).
  try { pathname = new URL(url, "http://local").pathname; } catch { return null; }
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const stream = parts[0] === "api" && parts[1] === "stream" && parts[2] === "file" ? parts.slice(3).join("/") : "";
  const keys = [stream, parts.join("/"), parts.slice(1).join("/")].filter(Boolean);
  const hit = await Media.findOne({ key: { $in: keys } }).select("key driver").lean();
  return hit ? { key: hit.key, driver: hit.driver } : null;
};
const pictureLibrary = async ({ lecture }) => {
  if (!lecture?._id) return [];
  const Lecture = require("../models/lectureModel");
  const l = await Lecture.findById(lecture._id).select("title bodyMarkdown attachments").populate("attachments", "title kind key driver").lean();
  if (!l) return [];
  const out = [];
  const seen = new Set();
  const add = (media, desc) => {
    if (!media?.key || seen.has(media.key) || out.length >= LIBRARY_MAX) return;
    seen.add(media.key);
    out.push({ id: `p${out.length + 1}`, desc, media: { key: media.key, driver: media.driver || null } });
  };
  for (const a of l.attachments || []) if (a?.kind === "image") add(a, `Attached to this lecture: ${clipText(a.title, 120) || "a picture"}`);
  for (const [, alt, url] of String(l.bodyMarkdown || "").matchAll(MD_IMAGE)) {
    if (out.length >= LIBRARY_MAX) break;
    add(await mediaOfUrl(url).catch(() => null), `In this lecture's notes: ${clipText(alt, 120) || "a picture"}`);
  }
  return out;
};

// The lecture's (or the question's solution) own video, when it is a file
// in storage: a part of it can be shown on the board as a clip.
const sourceVideo = async (lesson) => {
  if (!lesson) return null;
  const Media = require("../models/mediaModel");
  let id = null;
  if (lesson.lecture) id = (await require("../models/lectureModel").findById(lesson.lecture).select("video").lean())?.video;
  else if (lesson.question) id = (await require("../models/questionModel").Question.findById(lesson.question).select("solutionVideo").lean())?.solutionVideo;
  // Not the video recorded from this lesson itself.
  if (!id || String(id) === String(lesson.exportMedia || "")) return null;
  const m = await Media.findById(id).select("title key driver durationSeconds mimeType").lean();
  if (!m || !storage.DRIVERS[m.driver]) return null;
  return { media: { key: m.key, driver: m.driver }, title: m.title || "", durationSeconds: m.durationSeconds || null, url: await storage.urlFor(m.key, m.driver).catch(() => null) };
};

const lessonImages = async (question) => ({
  imageUrl: await questionImageUrl(question),
  solutionImageUrl: question?.solutionImage ? (await shapeField(question.solutionImage))?.url || null : null,
});
const questionImageUrl = async (question) => (question?.questionImage ? (await shapeField(question.questionImage))?.url || null : null);

// ---- LaTeX on the board -------------------------------------------------
// Models misplace $ signs and lose escapes. Board text is repaired here,
// on generate and on save, rather than trusted.

const MATRIX_ENVS = /\\begin\{(p|b|v|V|B)?matrix\}|\\begin\{(cases|aligned|array|align\*?|gathered)\}/;
// Inside matrix-like environments a row break "\\" often arrives as a
// single "\" (lost in JSON escaping): "\\hat{k}\\4&3&0" -> rows.
const fixRowBreaks = (tex) => {
  if (!MATRIX_ENVS.test(tex)) return tex;
  return tex.replace(/(\\begin\{[^}]+\})([\s\S]*?)(\\end\{[^}]+\})/g, (m, open, body, close) =>
    open + body.replace(/\\+(?=[\s0-9.+\-(\[]|$)/g, (run) => (run.length === 1 ? "\\\\" : run)) + close);
};

// A command written with two backslashes ("\\\\vec", over-escaped) reads
// as a line break plus the word "vec"; it's put back to one. Exactly two,
// so a row break before a command ("\\\\\\hat") stays.
const singleCommands = (tex) => String(tex || "").replace(/(^|[^\\])\\\\(?=[a-zA-Z])/g, "$1\\");

// One display equation: no $ at all.
const tidyMath = (tex) => fixRowBreaks(singleCommands(tex).replace(/\$/g, "").trim());

const COMMAND = /\\[a-zA-Z]+/;
// Sound already: $ in pairs, and no LaTeX command outside them.
const inlineIsSound = (text) => {
  const parts = text.split("$");
  if (parts.length % 2 === 0) return false;
  return parts.every((part, i) => i % 2 === 1 || !COMMAND.test(part));
};
// A token that reads as maths: a command, an operator, a digit next to a
// symbol, or a single letter.
const MATHY = /\\|[=^_{}<>|+*/×÷·]|^[A-Za-z]$|^[-−]?\d+([.,]\d+)?$|^[()\[\],.;:-]+$/;
// Removes stray $ and wraps each stretch of maths in one pair.
// Other ways models write inline maths, made $…$: $$…$$, \(…\), \[…\].
const dollarMath = (text) =>
  String(text || "")
    .replace(/\$\$([^$]+?)\$\$/g, (m, x) => `$${x.trim()}$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (m, x) => `$${x.trim()}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, x) => `$${x.trim()}$`);

const tidyInline = (text) => {
  const t = singleCommands(dollarMath(text)).trim();
  if (!t.includes("$") && !COMMAND.test(t)) return t;
  if (inlineIsSound(t)) return fixRowBreaks(t);
  const tokens = t.replace(/\$/g, " ").replace(/\s+/g, " ").trim().split(" ");
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    // Trailing punctuation stays outside the maths.
    let tail = "";
    const last = run[run.length - 1];
    const m = /^(.*?)([.,;:]+)$/.exec(last);
    if (m && m[1] && !last.startsWith("\\")) { run[run.length - 1] = m[1]; tail = m[2]; }
    const body = run.join(" ").trim();
    if (/^[A-Za-z]$/.test(body) && !COMMAND.test(body)) out.push(body + tail);
    else out.push(`$${fixRowBreaks(body)}$${tail}`);
    run = [];
  };
  for (const tok of tokens) {
    if (MATHY.test(tok) && (COMMAND.test(tok) || run.length || /[=^_{}\\]/.test(tok) || /\d/.test(tok))) run.push(tok);
    else { flush(); out.push(tok); }
  }
  flush();
  return out.join(" ").replace(/\$\$/g, "");
};

// The voice matches the narration: every sentence has its clip (or, for a
// lesson voiced before clips, the whole-segment audio matches).
// A clip's timed lines each have their own file too.
const lineFiles = (s) => (s.board || []).flatMap((b) => (b.type === "clip" ? b.lines || [] : []));
const lineCurrent = (l) => Boolean(l.key && l.forText === l.text);
const voiceCurrent = (s) => {
  if (!lineFiles(s).every(lineCurrent)) return false;
  // No words to say: nothing to voice.
  if (!sentencesOf(s.say).length) return true;
  if ((s.parts || []).length) {
    const want = sentencesOf(s.say);
    return s.parts.length === want.length && s.parts.every((p, i) => p.key && p.text === want[i]);
  }
  return Boolean(s.audio?.key && s.audio.forText === s.say);
};

module.exports = { cleanLook, mediaOfUrl, pictureLibrary, sourceVideo, sentencesOf, plainWords, cueFound, voiceCurrent, lineFiles, lineCurrent, solutionOf, lectureMaterial, shapeLesson, questionImageUrl, lessonImages, MATERIAL_MAX, tidyMath, tidyInline, jobOf, boardStyle, BOARD_PRESETS, spokenText };
