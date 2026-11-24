const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const ai = require("../../ai/service");
const { slideTask, SLIDE_LANGUAGES } = require("../../ai/slides");
const SlideDeck = require("../../models/slideDeckModel");
const Batch = require("../../models/batchModel");

// Admin → Batch → Slides (models/slideDeckModel.js). Owner and admin reach
// every batch's decks; a teacher only the batches they teach.

const str = (v, n) => String(v ?? "").slice(0, n);
const oid = (v) => (mongoose.isValidObjectId(v) ? v : null);
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : "");
const FONTS = ["", "inter", "poppins", "serif", "merriweather", "lora", "playfair", "condensed", "hand", "caveat", "archivo"];
const fail = (res, code, msg) => { res.status(code); throw new Error(msg); };

const batchOr403 = async (req, res, batchId) => {
  const batch = oid(batchId) ? await Batch.findById(batchId).select("name teachers") : null;
  if (!batch) fail(res, 404, "Batch not found.");
  if (!["owner", "admin"].includes(req.user.role) && !batch.hasTeacher(req.user._id)) fail(res, 403, "You are not assigned to teach this batch.");
  return batch;
};
const deckOr404 = async (req, res) => {
  const deck = oid(req.params.id) ? await SlideDeck.findById(req.params.id) : null;
  if (!deck) fail(res, 404, "Deck not found.");
  await batchOr403(req, res, deck.batch);
  return deck;
};

const ids = (a, n) => [...new Set((Array.isArray(a) ? a : []).map(String).filter((x) => oid(x)))].slice(0, n);
const list = (a, n, each) => (Array.isArray(a) ? a : []).slice(0, n).map((s) => str(s, each)).filter((s) => s.trim());
const tidySlide = (s = {}) => {
  const quiz = s.quiz || {};
  return {
    ...(oid(s._id) ? { _id: s._id } : {}),
    layout: SlideDeck.LAYOUTS.includes(s.layout) ? s.layout : "bullets",
    title: str(s.title, 300), subtitle: str(s.subtitle, 300),
    bullets: list(s.bullets, 10, 400),
    leftTitle: str(s.leftTitle, 200), rightTitle: str(s.rightTitle, 200),
    left: list(s.left, 8, 400), right: list(s.right, 8, 400),
    image: oid(s.image) ? String(s.image) : "",
    imagePrompt: str(s.imagePrompt, 500),
    code: str(s.code, 6000), codeLang: str(s.codeLang, 30),
    quote: str(s.quote, 1000), by: str(s.by, 200),
    quiz: {
      question: str(quiz.question, 2000),
      options: list(quiz.options, 6, 500),
      answer: Math.max(0, Math.min(5, Math.round(Number(quiz.answer) || 0))),
      from: oid(quiz.from),
    },
    notes: str(s.notes, 5000),
  };
};
const pictureUrl = (v) => (oid(v) ? String(v) : "");

// The deck with its pictures' URLs (slide images, logo, background), by
// Media id. forPrint: addresses the print page's request handler serves.
const withPictures = async (deck, { forPrint = false } = {}) => {
  const d = deck.toObject ? deck.toObject() : deck;
  const ids = [...new Set([d.look?.logo, d.look?.bgImage, ...d.slides.map((s) => s.image), ...(d.outline || []).map((o) => o.image)].filter((x) => oid(x)))];
  const pictures = {};
  if (ids.length) {
    const Media = require("../../models/mediaModel");
    const storage = require("../../adapters/storage");
    const { ORIGIN } = require("../../utils/printServer");
    for (const m of await Media.find({ _id: { $in: ids }, kind: "image" }).select("key driver").lean()) {
      pictures[String(m._id)] = forPrint
        ? `${ORIGIN}/__media/${encodeURIComponent(m.driver || "")}/${m.key.split("/").map(encodeURIComponent).join("/")}`
        : await storage.urlFor(m.key, m.driver).catch(() => "");
    }
  }
  // The institution's logo, for a deck with none of its own (`site`).
  if (!oid(d.look?.logo) && d.look?.siteLogo !== false) {
    const logo = await siteLogo(forPrint);
    if (logo) pictures.site = logo;
  }
  return { ...d, pictures };
};

// The logo from Settings: its URL, or (for the print page and the .pptx)
// its bytes as a data URL.
const siteLogo = async (asData) => {
  const url = (await require("../../models/appSettingsModel").get())?.logo;
  if (!url || !asData) return url || "";
  let buf = null;
  let type = "";
  const local = /^\/media\/(.+)$/.exec(String(url).split("?")[0]);
  if (local) buf = await require("../../adapters/storage").get(decodeURIComponent(local[1]), "local").catch(() => null);
  else if (/^https?:\/\//.test(url)) {
    const r = await fetch(url).catch(() => null);
    if (r?.ok) { buf = Buffer.from(await r.arrayBuffer()); type = r.headers.get("content-type") || ""; }
  }
  if (!buf) return "";
  const ext = String(url).split("?")[0].split(".").pop().toLowerCase();
  type = type.split(";")[0] || { svg: "image/svg+xml", png: "image/png", webp: "image/webp", gif: "image/gif" }[ext] || "image/jpeg";
  return `data:${type};base64,${buf.toString("base64")}`;
};

// Settings a create or a save may change.
const applyFields = (deck, b) => {
  if (b.title !== undefined) deck.title = str(b.title, 200).trim() || "Untitled deck";
  if (b.brief !== undefined) deck.brief = str(b.brief, 1000);
  if (b.slideCount !== undefined) deck.slideCount = Math.min(40, Math.max(3, Math.round(Number(b.slideCount) || 12)));
  if (SLIDE_LANGUAGES.includes(b.language)) deck.language = b.language;
  if (b.source && typeof b.source === "object") {
    const s = b.source;
    deck.source = {
      kind: ["chapter", "lectures", "questions", "text"].includes(s.kind) ? s.kind : "chapter",
      chapter: oid(s.chapter), topic: oid(s.topic),
      lectures: ids(s.lectures, 60), questions: ids(s.questions, 120),
      questionMode: s.questionMode === "quiz" ? "quiz" : "revision",
      text: str(s.text, 60000),
    };
  }
  if (b.look && typeof b.look === "object") {
    const l = b.look;
    deck.look = {
      preset: SlideDeck.PRESETS.includes(l.preset) ? l.preset : "clean",
      bg: hex(l.bg), text: hex(l.text), accent: hex(l.accent),
      headFont: FONTS.includes(l.headFont) ? l.headFont : "", bodyFont: FONTS.includes(l.bodyFont) ? l.bodyFont : "",
      bgImage: pictureUrl(l.bgImage), logo: pictureUrl(l.logo), siteLogo: l.siteLogo !== false,
    };
  }
  if (b.footer && typeof b.footer === "object") deck.footer = { show: b.footer.show !== false, text: str(b.footer.text, 120), numbers: b.footer.numbers !== false };
  if (Array.isArray(b.outline)) {
    deck.outline = b.outline.slice(0, 45).map((o) => ({
      title: str(o?.title, 300), points: list(o?.points, 8, 300),
      layout: SlideDeck.LAYOUTS.includes(o?.layout) ? o.layout : "bullets",
      image: pictureUrl(o?.image),
    })).filter((o) => o.title.trim());
  }
  if (Array.isArray(b.slides)) deck.slides = b.slides.slice(0, 60).map(tidySlide);
  if (b.published !== undefined) deck.published = Boolean(b.published);
  if (b.allowDownload !== undefined) deck.allowDownload = Boolean(b.allowDownload);
};

//@route  GET /api/slides?batch=
const listDecks = asyncHandler(async (req, res) => {
  await batchOr403(req, res, req.query.batch);
  const decks = await SlideDeck.find({ batch: req.query.batch })
    .select("title look source.kind published updatedAt slides.layout slides.title slides.subtitle")
    .sort({ updatedAt: -1 }).lean();
  res.status(200).json(decks.map((d) => ({
    _id: d._id, title: d.title, look: d.look, kind: d.source?.kind, published: d.published, updatedAt: d.updatedAt,
    count: d.slides.length, first: d.slides[0] || null,
  })));
});

//@route  POST /api/slides  { batch, title, source, look, ... }
const createDeck = asyncHandler(async (req, res) => {
  const batch = await batchOr403(req, res, req.body?.batch);
  const deck = new SlideDeck({ batch: batch._id, title: "Untitled deck", createdBy: req.user._id, updatedBy: req.user._id, footer: { text: batch.name } });
  applyFields(deck, req.body || {});
  await deck.save();
  res.status(201).json(await withPictures(deck));
});

//@route  GET /api/slides/:id
const getDeck = asyncHandler(async (req, res) => {
  res.status(200).json(await withPictures(await deckOr404(req, res)));
});

//@route  PUT /api/slides/:id
const saveDeck = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  applyFields(deck, req.body || {});
  deck.updatedBy = req.user._id;
  await deck.save();
  res.status(200).json(await withPictures(deck));
});

//@route  DELETE /api/slides/:id
const deleteDeck = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  await deck.deleteOne();
  res.status(200).json({ ok: true });
});

//@route  POST /api/slides/:id/duplicate
const duplicateDeck = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  const o = deck.toObject();
  delete o._id; delete o.createdAt; delete o.updatedAt;
  const copy = await SlideDeck.create({ ...o, title: `${o.title} (copy)`.slice(0, 200), published: false, createdBy: req.user._id, updatedBy: req.user._id });
  res.status(201).json(await withPictures(copy));
});

// ---------------------------------------------------------------- source material

const MCQ_LIMIT = 25;
const mcqsOf = (qs) => qs.filter((q) => q.type === "mcq" && q.options?.length >= 2).map((q) => ({
  _id: q._id,
  question: String(q.question || ""),
  options: q.options.map((o) => String(o.text || "")),
  answer: Math.max(0, q.options.findIndex((o) => o.key === q.correctOption)),
})).filter((q) => q.question.trim() && q.options.every((o) => o.trim()));

// The text the AI works from, and bank questions for quiz slides.
const materialOf = async (deck, req, res) => {
  const s = deck.source || {};
  if (s.kind === "text") return { material: s.text || "", bank: [], name: "" };
  const Lecture = require("../../models/lectureModel");
  const { Question } = require("../../models/questionModel");
  const { batchQuestionScope } = require("../../utils/batchSubjects");
  const batch = await Batch.findById(deck.batch).select("subjects").lean();
  const lecText = (lectures) => lectures.map((l) => `## ${l.title}\n${l.description || ""}\n${l.bodyMarkdown || ""}`).join("\n\n");
  const pickedQs = async () => (s.questions?.length
    ? inOrder(await Question.find({ _id: { $in: s.questions }, ...batchQuestionScope(batch) }).select(Q_FIELDS).lean(), s.questions)
    : null);

  // Picked questions: the material is the questions and their solutions.
  if (s.kind === "questions") {
    const qs = await questionsOf(deck, batch);
    if (!qs.length) fail(res, 400, "Pick at least one question.");
    const material = qs.map((q, i) => `${i + 1}. ${questionText(q)}\n${q.solutionText || q.modelAnswer || ""}`).join("\n\n");
    return { material, bank: mcqsOf(qs).slice(0, MCQ_LIMIT), name: await sourceName(s, "Revision") };
  }

  // Picked lectures (any chapter of the batch), and picked quiz questions.
  if (s.kind === "lectures") {
    if (!s.lectures?.length) fail(res, 400, "Pick at least one lecture.");
    const lectures = inOrder(await Lecture.find({ _id: { $in: s.lectures }, batches: deck.batch }).select("title description bodyMarkdown chapter").lean(), s.lectures);
    if (!lectures.length) fail(res, 400, "None of the picked lectures is in this batch any more.");
    const qs = await pickedQs() || await Question.find({ chapter: { $in: lectures.map((l) => l.chapter).filter(Boolean) }, ...batchQuestionScope(batch), status: "published", type: "mcq" }).select(Q_FIELDS).limit(60).lean();
    const name = lectures.length === 1 ? lectures[0].title : `${lectures[0].title} and ${lectures.length - 1} more`;
    return { material: `# ${name}\n\n${lecText(lectures)}`, bank: mcqsOf(qs).slice(0, MCQ_LIMIT), name };
  }

  // A chapter (and maybe one topic) of this batch: its lectures and MCQs,
  // or only the ones left ticked.
  if (!s.chapter) fail(res, 400, "Pick a chapter first.");
  const where = { chapter: s.chapter, ...(s.topic ? { topic: s.topic } : {}) };
  const [lectures, qs] = await Promise.all([
    Lecture.find({ ...where, batches: deck.batch, ...(s.lectures?.length ? { _id: { $in: s.lectures } } : {}) }).select("title description bodyMarkdown").sort({ order: 1 }).limit(20).lean(),
    pickedQs().then((p) => p || Question.find({ ...where, ...batchQuestionScope(batch), status: "published", type: "mcq" }).select(Q_FIELDS).limit(60).lean()),
  ]);
  const text = lecText(lectures);
  const bank = mcqsOf(qs).slice(0, MCQ_LIMIT);
  // Few notes: question stems still say what the chapter covers.
  const stems = text.trim().length < 1500 ? `\n\nQuestions students practise in this chapter:\n${mcqsOf(qs).slice(0, 40).map((q) => `- ${q.question.slice(0, 200)}`).join("\n")}` : "";
  const name = await sourceName(s, "Untitled deck");
  if (!name) fail(res, 400, "That chapter wasn't found.");
  return { material: `# ${name}\n\n${text}${stems}`, bank, name };
};

const Q_FIELDS = "type question context partLabel options correctOption statements modelAnswer solutionText questionImage subQuestions languages chapter topic";
const inOrder = (docs, order) => {
  const at = new Map(order.map((x, i) => [String(x), i]));
  return docs.sort((a, b) => (at.get(String(a._id)) ?? 1e9) - (at.get(String(b._id)) ?? 1e9));
};
const questionText = (q) => require("../../utils/questionText").fullQuestionText(q);
// "Chapter: topic" for the source, or the fallback.
const sourceName = async (s, fallback) => {
  if (!s.chapter) return fallback;
  const Chapter = require("../../models/chapterModel");
  const Topic = require("../../models/topicModel");
  const [chapter, topic] = await Promise.all([
    Chapter.findById(s.chapter).select("title").lean(),
    s.topic ? Topic.findById(s.topic).select("title").lean() : null,
  ]);
  if (!chapter) return s.kind === "chapter" ? "" : fallback;
  return topic ? `${chapter.title}: ${topic.title}` : chapter.title;
};
// The questions a "questions" deck is made from: the picked ones in their
// order, or every published one in the chosen chapter or topic.
const QUESTION_LIMIT = 80;
const questionsOf = async (deck, batch) => {
  const s = deck.source || {};
  const { Question } = require("../../models/questionModel");
  const { batchQuestionScope } = require("../../utils/batchSubjects");
  const scope = batchQuestionScope(batch);
  const quiz = s.questionMode === "quiz" ? { type: "mcq" } : {};
  if (s.questions?.length) return inOrder(await Question.find({ _id: { $in: s.questions }, ...scope, ...quiz }).select(Q_FIELDS).lean(), s.questions);
  if (!s.chapter) return [];
  return Question.find({ chapter: s.chapter, ...(s.topic ? { topic: s.topic } : {}), ...scope, status: "published", ...quiz })
    .select(Q_FIELDS).sort({ createdAt: 1 }).limit(QUESTION_LIMIT).lean();
};

const run = async (req, res, task, input, maxTokens) => {
  const { schema, system, prompt } = slideTask(task, input);
  try {
    const { data } = await ai.generate({ feature: `slides-${task}`, schema, system, prompt, maxTokens, user: req.user._id });
    return data;
  } catch (e) {
    res.status(e.statusCode || 502);
    throw e;
  }
};

//@desc   The AI's outline for the deck, from its source. Saved on the deck.
//@route  POST /api/slides/:id/outline  (unsaved settings may come along)
const makeOutline = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  applyFields(deck, req.body || {});
  if (deck.source?.kind === "questions") fail(res, 400, "A deck from questions needs no outline: make the slides straight away.");
  const { material, bank, name } = await materialOf(deck, req, res);
  if (material.trim().length < 40 && !deck.brief.trim()) fail(res, 400, "There's nothing to make slides from yet: add notes to the chapter's lectures, paste text, or write a brief.");
  const title = deck.title && deck.title !== "Untitled deck" ? deck.title : name;
  const out = await run(req, res, "outline", { title, brief: deck.brief, count: deck.slideCount, material, bank, language: deck.language }, 6000);
  if (!deck.title || deck.title === "Untitled deck") deck.title = str(out.title || name, 200) || "Untitled deck";
  // A picture already picked for a slide stays with the slide of the same title.
  const kept = new Map(deck.outline.filter((o) => o.image).map((o) => [o.title.trim().toLowerCase(), o.image]));
  deck.outline = out.outline.map((o) => ({ title: str(o.title, 300), points: list(o.points, 8, 300), layout: o.layout, image: kept.get(str(o.title, 300).trim().toLowerCase()) || "" }));
  deck.updatedBy = req.user._id;
  await deck.save();
  res.status(200).json(await withPictures(deck));
});

const fromAi = (s, bank) => {
  const b = Number.isInteger(s.bank) ? bank[s.bank - 1] : null;
  return tidySlide({
    ...s,
    layout: s.layout === "quiz" && !b && !(s.quiz?.question && s.quiz?.options?.length >= 2) ? "bullets" : s.layout,
    quiz: b ? { question: b.question, options: b.options, answer: b.answer, from: b._id } : s.quiz,
  });
};

// ---------------------------------------------------------------- slides from questions
// No AI: each question becomes a slide as it is written, and (revision) its
// answer the slide after. The full solution goes in the speaker notes.

const lineList = (t, n = 6) => String(t || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, n);
const FENCE = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)```/;
const KEYS = "ABCDEF";

const questionSlides = (q, n, mode) => {
  const head = `Question ${n}`;
  const solution = String(q.solutionText || "").trim();
  const notes = str([solution, q.modelAnswer].filter(Boolean).join("\n\n"), 5000);
  const opts = (q.options || []).slice(0, 6);
  const image = oid(q.questionImage) ? String(q.questionImage) : "";
  const stem = questionText(q);
  const out = [];

  if (q.type === "mcq" && opts.length >= 2 && opts.every((o) => String(o.text || "").trim())) {
    out.push(tidySlide({ layout: "quiz", title: head, quiz: { question: stem, options: opts.map((o) => o.text), answer: Math.max(0, opts.findIndex((o) => o.key === q.correctOption)), from: q._id }, notes }));
  } else {
    const body = q.type === "mcq"
      ? [...lineList(stem, 4), ...opts.map((o, i) => `${KEYS[i]}. ${o.text || "(picture)"}`)]
      : q.type === "mtf"
        ? [...lineList(stem, 3), ...(q.statements || []).slice(0, 6).map((st, i) => `${i + 1}. ${st.text}`)]
        : q.type === "passage"
          ? [...lineList(stem, 3).map((x) => x.slice(0, 400)), ...(q.subQuestions || []).slice(0, 5).map((sq, i) => `${sq.label || i + 1}. ${sq.question}`)]
          : lineList(stem, 8);
    out.push(tidySlide({ layout: image ? "imageText" : "bullets", title: head, bullets: body, image, notes }));
  }
  if (mode === "quiz") return out;

  // The answer slide.
  const fence = solution.match(FENCE);
  if (fence) {
    const idea = solution.replace(FENCE, "").trim();
    out.push(tidySlide({ layout: "code", title: `Solution ${n}`, code: fence[2].replace(/\n$/, ""), codeLang: fence[1] || (q.languages || [])[0] || "", notes: idea || notes }));
    return out;
  }
  const answer = q.type === "mcq"
    ? [`Answer: ${q.correctOption}${opts.find((o) => o.key === q.correctOption)?.text ? `. ${opts.find((o) => o.key === q.correctOption).text}` : ""}`, ...lineList(solution, 5)]
    : q.type === "mtf"
      ? (q.statements || []).slice(0, 6).map((st, i) => `${i + 1}. ${st.isTrue ? "True" : "False"}: ${st.text}`)
      : lineList(solution || q.modelAnswer, 7);
  if (answer.length) out.push(tidySlide({ layout: "bullets", title: `Answer ${n}`, bullets: answer, notes }));
  return out;
};

const slidesFromQuestions = (deck, qs, name) => {
  const quiz = deck.source?.questionMode === "quiz";
  const slides = [tidySlide({ layout: "title", title: deck.title && deck.title !== "Untitled deck" ? deck.title : name, subtitle: `${qs.length} question${qs.length === 1 ? "" : "s"}${quiz ? ": a quick quiz" : ", with answers"}` })];
  for (const [i, q] of qs.entries()) {
    const next = questionSlides(q, i + 1, quiz ? "quiz" : "revision");
    if (slides.length + next.length > 60) break;
    slides.push(...next);
  }
  return slides;
};

//@desc   Every slide, from the deck's outline (or, for a questions deck,
//        straight from its questions). Replaces the slides.
//@route  POST /api/slides/:id/generate
const generate = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  applyFields(deck, req.body || {});
  if (deck.source?.kind === "questions") {
    const batch = await Batch.findById(deck.batch).select("subjects").lean();
    const qs = await questionsOf(deck, batch);
    if (!qs.length) fail(res, 400, deck.source.questionMode === "quiz" ? "Pick at least one multiple-choice question." : "Pick at least one question.");
    const name = await sourceName(deck.source, "Revision");
    if (!deck.title || deck.title === "Untitled deck") deck.title = str(name, 200);
    deck.slides = slidesFromQuestions(deck, qs, name);
    deck.updatedBy = req.user._id;
    await deck.save();
    return res.status(200).json(await withPictures(deck));
  }
  if (deck.outline.length < 2) fail(res, 400, "Make the outline first.");
  const { material, bank } = await materialOf(deck, req, res);
  const out = await run(req, res, "slides", { title: deck.title, brief: deck.brief, outline: deck.outline, material, bank, language: deck.language }, 16000);
  deck.slides = out.slides.map((s) => fromAi(s, bank));
  // Pictures picked in the outline: onto the slide of the same title, else
  // the slide in the same place.
  const byTitle = (t) => deck.slides.findIndex((s) => s.title.trim().toLowerCase() === String(t || "").trim().toLowerCase());
  deck.outline.forEach((o, i) => {
    if (!o.image) return;
    const at = byTitle(o.title) >= 0 ? byTitle(o.title) : i;
    const s = deck.slides[at];
    if (!s) return;
    s.image = o.image;
    if (!["imageText"].includes(s.layout)) s.layout = "imageText";
  });
  deck.updatedBy = req.user._id;
  await deck.save();
  res.status(200).json(await withPictures(deck));
});

//@desc   One slide rewritten as asked. Not saved: the editor shows it.
//@route  POST /api/slides/:id/rewrite  { slide, ask }
const rewrite = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  const slide = tidySlide(req.body?.slide || {});
  const { material } = await materialOf(deck, req, res).catch(() => ({ material: "" }));
  const out = await run(req, res, "rewrite", { title: deck.title, slide, ask: str(req.body?.ask, 600), material, language: deck.language }, 3000);
  const next = fromAi(out.slide, []);
  if (slide.image && next.layout === "imageText") next.image = slide.image;
  res.status(200).json({ slide: next });
});

//@desc   What a deck can be made from in its batch: the lectures (all of
//        them, or one chapter's), and one chapter's published questions.
//@route  GET /api/slides/:id/items?chapter=&topic=
const items = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  const Lecture = require("../../models/lectureModel");
  const { Question } = require("../../models/questionModel");
  const { batchQuestionScope } = require("../../utils/batchSubjects");
  const batch = await Batch.findById(deck.batch).select("subjects").lean();
  const chapter = oid(req.query.chapter);
  const topic = oid(req.query.topic);
  const where = chapter ? { chapter, ...(topic ? { topic } : {}) } : {};
  const [lectures, questions] = await Promise.all([
    Lecture.find({ ...where, batches: deck.batch }).select("title chapter bodyMarkdown description order").populate("chapter", "title order").sort({ order: 1 }).limit(400).lean(),
    chapter
      ? Question.find({ ...where, ...batchQuestionScope(batch), status: "published" }).select("type question options statements solutionText modelAnswer").sort({ createdAt: 1 }).limit(300).lean()
      : [],
  ]);
  res.status(200).json({
    lectures: lectures.map((l) => ({
      _id: l._id, title: l.title, chapter: l.chapter ? { _id: l.chapter._id, title: l.chapter.title, order: l.chapter.order } : null,
      notes: String(l.bodyMarkdown || l.description || "").trim().length,
    })).sort((a, b) => (a.chapter?.order ?? 1e9) - (b.chapter?.order ?? 1e9) || String(a.chapter?.title || "").localeCompare(String(b.chapter?.title || ""))),
    questions: questions.map((q) => ({
      _id: q._id, type: q.type, question: String(q.question || "").slice(0, 220),
      solved: Boolean(String(q.solutionText || q.modelAnswer || "").trim()),
    })),
  });
});

//@desc   Pictures as data URLs, for the .pptx the browser builds (a
//        picture on S3 or a CDN can't always be fetched from the page).
//@route  GET /api/slides/pictures?ids=a,b
const pictures = asyncHandler(async (req, res) => {
  const all = String(req.query.ids || "").split(",");
  const ids = all.filter((x) => oid(x)).slice(0, 40);
  const Media = require("../../models/mediaModel");
  const storage = require("../../adapters/storage");
  const out = {};
  for (const m of await Media.find({ _id: { $in: ids }, kind: "image" }).select("key driver mimeType").lean()) {
    const buf = await storage.get(m.key, m.driver).catch(() => null);
    if (buf) out[String(m._id)] = `data:${m.mimeType || "image/png"};base64,${Buffer.from(buf).toString("base64")}`;
  }
  if (all.includes("site")) { const logo = await siteLogo(true); if (logo) out.site = logo; }
  res.status(200).json(out);
});

//@desc   Text from an uploaded PDF, Word file or PowerPoint, for the
//        deck's pasted-text source. Nothing saved.
//@route  POST /api/slides/file-text  (file)
const fileText = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) fail(res, 400, "Choose a file.");
  try {
    const { text } = await require("../../ai/ingest").extract(req.file.buffer, req.file.mimetype);
    res.status(200).json({ text: String(text || "").replace(/⟦img:\d+⟧/g, "").slice(0, 60000) });
  } catch (e) {
    fail(res, e.statusCode || 400, e.statusCode ? e.message : "That file couldn't be read.");
  }
});

//@desc   The deck as a PDF, one 16:9 page a slide (headless Chromium, the
//        admin panel's slide-print.html). Speaker notes left out.
//@route  GET /api/slides/:id/pdf
const pdf = asyncHandler(async (req, res) => {
  const deck = await deckOr404(req, res);
  if (!deck.slides.length) fail(res, 400, "Make the slides first.");
  const { printSlides, canPrint } = require("../../utils/slidePrint");
  const why = canPrint();
  if (why) fail(res, 503, why);
  const buf = await printSlides(await withPictures(deck, { forPrint: true }));
  const name = (deck.title || "slides").replace(/[^\p{L}\p{N} _.-]/gu, "").trim() || "slides";
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="slides.pdf"; filename*=UTF-8''${encodeURIComponent(name)}.pdf`, "Cache-Control": "no-store" });
  res.send(buf);
});

module.exports = {
  items, withPictures, pictures, listDecks, createDeck, getDeck, saveDeck, deleteDeck, duplicateDeck, makeOutline, generate, rewrite, fileText, pdf };
