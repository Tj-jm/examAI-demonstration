const asyncHandler = require("express-async-handler");
const { fullQuestionText } = require("../../utils/questionText");
const mongoose = require("mongoose");
const VideoLesson = require("../../models/videoLessonModel");
const Lecture = require("../../models/lectureModel");
const { Question } = require("../../models/questionModel");
const storage = require("../../adapters/storage");
const video = require("../../adapters/video");
const aiService = require("../../ai/service");
const { solutionVideoScript, lectureVideoScript, videoLessonPartPrompt, videoLessonNewPartPrompt, videoHumanizePrompt, videoLessonPlan, videoLessonReview } = require("../../ai/prompts");
const { videoLessonScript, videoLessonPart, videoHumanize, videoLessonPlanSchema, videoLessonReviewSchema } = require("../../ai/schemas");
const { BOARD_PRESETS, pictureLibrary, sourceVideo, solutionOf, lectureMaterial, shapeLesson, questionImageUrl, lessonImages, tidyMath, tidyInline, jobOf, spokenText, sentencesOf, cueFound, lineFiles, lineCurrent } = require("../../utils/videoLesson");
const { diagramPrompt, diagramSchema, sanitizeSvg } = require("../../ai/images");
const tts = require("../../ai/tts");
const aiPicture = require("../../utils/aiPicture");

// AI video lessons (models/videoLessonModel.js): a script of spoken
// segments and board steps for a question's solution or a lecture. Staff
// generate it, edit it, add a voice and publish it; students play it.

const idOr400 = (id, res, what) => {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error(`A valid ${what} is required.`);
  }
  return id;
};

// Which question or lecture a request is about, from query or body.
const targetOf = async (src, res) => {
  if (src.question) {
    const question = await Question.findById(idOr400(src.question, res, "question")).populate("questionImage solutionImage");
    if (!question) { res.status(404); throw new Error("Question not found."); }
    return { kind: "solution", question };
  }
  if (src.lecture) {
    const lecture = await Lecture.findById(idOr400(src.lecture, res, "lecture"));
    if (!lecture) { res.status(404); throw new Error("Lecture not found."); }
    return { kind: "lecture", lecture };
  }
  res.status(400);
  throw new Error("Say which question or lecture.");
};

const filterOf = (t) => (t.question ? { question: t.question._id } : { lecture: t.lecture._id });

// The editor also gets the lecture's (or solution's) own video, for clips.
const respond = async (res, lesson, target, code = 200) => {
  const shaped = await shapeLesson(lesson, await lessonImages(target?.question));
  if (shaped) shaped.sourceVideo = await sourceVideo(lesson).catch(() => null);
  res.status(code).json({ lesson: shaped, voice: await tts.status() });
};

// Files are content-addressed, so two lessons can share one audio file:
// it's deleted only when no other lesson uses it.
const dropFile = async (audio, lessonId) => {
  if (!audio?.key) return;
  if (await VideoLesson.exists({ _id: { $ne: lessonId }, $or: [{ "segments.audio.key": audio.key }, { "segments.parts.key": audio.key }, { "segments.board.lines.key": audio.key }] })) return;
  await storage.remove(audio.key, audio.driver).catch(() => {});
};
// Every audio file a segment holds: its clips, the older whole audio, and
// its video clips' timed lines.
const filesOf = (s) => [...(s.parts || []), ...(s.audio?.key ? [s.audio] : []), ...lineFiles(s)].filter((f) => f?.key);

// Board items as the model or the editor sent them, tidied: unknown
// fields dropped, an image item only where its picture exists.
const clamp = (n) => Math.min(100, Math.max(0, Number(n) || 0));
const safeSvg = (svg) => {
  if (!svg) return "";
  try { return sanitizeSvg(svg); } catch { return ""; }
};
// say: the segment's narration (spoken form), which cues must be found in.
const ENTERS = ["fade", "slide", "pop", "zoom", "wipe", "write", "draw", "type", "morph"];
const SIZES = ["small", "medium", "large", "full"];
const CODE_LANGS = ["c", "cpp", "python", "java", "javascript", "html", "sql"];
const num = (v, lo, hi, dflt) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? dflt : Math.min(hi, Math.max(lo, Number(v))));
// A part of a picture or item (x, y, w, h in %), or null for the whole.
const box = (c) => {
  if (!c || ![c.x, c.y, c.w, c.h].every((v) => Number.isFinite(Number(v)))) return null;
  const x = clamp(c.x); const y = clamp(c.y);
  const w = Math.min(100 - x, Math.max(5, Number(c.w))); const h = Math.min(100 - y, Math.max(5, Number(c.h)));
  return w >= 5 && h >= 5 && (w < 99.5 || h < 99.5) ? { x, y, w, h } : null;
};
const cleanItem = (b, say = "", language = "") => {
  const item = { type: b.type, text: tidyInline(b.text), latex: tidyMath(b.latex) };
  // Code and program output are kept exactly as written (no maths repair).
  if (b.type === "code" || b.type === "output") {
    item.text = String(b.text || "").replace(/\r/g, "").replace(/\t/g, "    ").replace(/\s+$/, "").slice(0, 4000);
    if (b.type === "code") item.lang = CODE_LANGS.includes(b.lang) ? b.lang : null;
    item.caption = tidyInline(b.caption || "").trim().slice(0, 200);
  }
  if (["left", "center", "right"].includes(b.align)) item.align = b.align;
  if (ENTERS.includes(b.enter) && !["newBoard", "pause", "highlight", "remove", "camera"].includes(b.type)) item.enter = b.enter;
  const spoken = (c) => {
    const x = c ? spokenText(String(c).slice(0, 200), { language }) : "";
    return x && cueFound(say, x) ? x : "";
  };
  // A cue the narration doesn't say is dropped: the item is then timed
  // between its neighbours instead of never appearing.
  const cue = b.cue ? spokenText(String(b.cue).slice(0, 200), { language }) : "";
  item.cue = cue && cueFound(say, cue) ? cue : "";
  item.with = Boolean(b.with);
  if (b.row === true && !["newBoard", "pause", "highlight", "remove", "camera"].includes(b.type)) item.row = true;
  if (b.keep === true && !["newBoard", "pause", "highlight", "remove", "camera"].includes(b.type)) item.keep = true;
  // pause and clip hold the board: before the narration ("^"), after the
  // sentence holding `after`, or at the end.
  const placeAfter = () => {
    const after = b.after === "^" ? "^" : b.after ? spokenText(String(b.after).slice(0, 200), { language }) : "";
    item.after = after === "^" || (after && cueFound(say, after)) ? after : "";
    item.cue = "";
  };
  if (b.type === "pause") {
    item.seconds = Math.min(30, Math.max(0.5, Number(b.seconds) || 2));
    placeAfter();
  }
  if (b.type === "clip") {
    item.media = { key: b.media?.key || null, driver: b.media?.driver || null };
    item.start = Math.max(0, Number(b.start) || 0);
    item.seconds = Math.min(180, Math.max(0.5, Number(b.seconds) || 5));
    item.sound = b.sound !== false;
    item.caption = tidyInline(b.caption || "").trim();
    item.size = SIZES.includes(b.size) ? b.size : null;
    // Over the voice: placed by its cue like any item. Else as before.
    if (b.voice === "over") {
      item.voice = "over";
      item.duck = num(b.duck, 0, 1, 0.25);
      item.after = "";
    } else {
      placeAfter();
      // Lines spoken at set seconds into the clip (the voice waits for it).
      const lines = (Array.isArray(b.lines) ? b.lines : [])
        .map((l) => ({ at: num(l?.at, 0, 600, 0), text: String(l?.text || "").replace(/\s+/g, " ").trim().slice(0, 300) }))
        .filter((l) => l.text)
        .sort((x, y) => x.at - y.at)
        .slice(0, 20);
      if (lines.length) item.lines = lines;
    }
    const freeze = num(b.freeze, 0, 10, 0);
    if (freeze) item.freeze = freeze;
  }
  if (b.type === "diagram") {
    item.prompt = String(b.prompt || "").trim().slice(0, 600);
    item.svg = safeSvg(b.svg);
    item.caption = tidyInline(b.caption || "").trim();
    item.size = SIZES.includes(b.size) ? b.size : null;
    if (b.build) {
      item.build = true;
      // One per step from step 1 (an empty one: timed by `seconds`).
      const cues = (b.stepCues || []).slice(0, 8).map(spoken);
      while (cues.length && !cues[cues.length - 1]) cues.pop();
      item.stepCues = cues;
      if (b.seconds) item.seconds = num(b.seconds, 0.3, 10, 1.5);
    }
  }
  if (b.type === "sequence") {
    item.frames = (b.frames || []).filter((f) => f?.media?.key).slice(0, 12).map((f) => ({
      media: { key: f.media.key, driver: f.media.driver || null },
      cue: spoken(f.cue),
      caption: tidyInline(f.caption || "").trim().slice(0, 200),
    }));
    item.seconds = num(b.seconds, 0.3, 10, 1);
    item.loop = Boolean(b.loop);
    item.transition = b.transition === "cut" ? "cut" : "fade";
    item.caption = tidyInline(b.caption || "").trim();
    item.size = SIZES.includes(b.size) ? b.size : null;
  }
  if (b.type === "remove") {
    item.ref = b.ref || null;
    item.exit = ["fade", "strike", "cross"].includes(b.exit) ? b.exit : "fade";
  }
  if (b.type === "camera") {
    item.ref = b.ref || null;
    item.zoom = item.ref ? num(b.zoom, 1, 3, 1.6) : 1;
    item.seconds = num(b.seconds, 0.3, 5, 1);
    const area = item.ref ? box(b.area) : null;
    if (area) item.area = area;
  }
  if (b.type === "list") {
    item.items = (b.items || []).map((x) => tidyInline(x)).filter(Boolean);
    if (b.check === true) item.check = true;
  }
  // The next step of an earlier line: it takes that line's place.
  if (b.type === "math" && typeof b.from === "string" && /^\d+-\d+$/.test(b.from)) item.from = b.from;
  if (b.type === "graph" || b.type === "numberline") {
    const range = (r, dflt) => (Array.isArray(r) && r.length === 2 && r.every((v) => Number.isFinite(Number(v))) && Number(r[0]) < Number(r[1]) ? [Number(r[0]), Number(r[1])] : dflt);
    item.xRange = range(b.xRange, [-5, 5]);
    if (b.type === "graph") {
      item.fns = (Array.isArray(b.fns) ? b.fns : []).filter((f) => f?.expr && String(f.expr).length <= 120).slice(0, 3)
        .map((f) => ({ expr: String(f.expr).trim(), label: String(f.label || "").trim().slice(0, 40) }));
      const y = range(b.yRange, null);
      if (y) item.yRange = y;
    }
    item.points = (Array.isArray(b.points) ? b.points : []).filter((pt) => Number.isFinite(Number(pt?.x))).slice(0, 8).map((pt) => ({
      x: Number(pt.x),
      ...(Number.isFinite(Number(pt.y)) && pt.y !== null ? { y: Number(pt.y) } : {}),
      label: String(pt.label || "").trim().slice(0, 40),
      ...(pt.open ? { open: true } : {}),
    }));
    if (b.type === "numberline") item.spans = (Array.isArray(b.spans) ? b.spans : []).filter((x) => Number.isFinite(Number(x?.a)) && Number.isFinite(Number(x?.b))).slice(0, 3).map((x) => ({ a: Number(x.a), b: Number(x.b) }));
    item.caption = tidyInline(b.caption || "").trim().slice(0, 200);
  }
  if (b.type === "table") item.rows = (b.rows || []).map((r) => r.map((c) => tidyInline(c))).filter((r) => r.some(Boolean)).map((cells) => ({ cells }));
  if (b.type === "highlight") {
    item.ref = b.ref || null;
    if (["glow", "pulse", "underline", "circle", "arrow", "spotlight", "point"].includes(b.emphasis)) item.emphasis = b.emphasis;
  }
  if (b.type === "callout") item.kind = b.kind || "note";
  if (b.type === "image") {
    item.src = b.src || "question";
    item.caption = (b.caption || "").trim();
    item.size = b.size || null;
    if (item.src === "upload") item.media = { key: b.media?.key || null, driver: b.media?.driver || null };
    item.marks = (b.marks || []).map((m) => ({
      kind: m.kind, x: clamp(m.x), y: clamp(m.y),
      ...(m.x2 !== undefined && m.x2 !== null ? { x2: clamp(m.x2), y2: clamp(m.y2) } : {}),
      ...(m.text ? { text: tidyInline(m.text.trim().slice(0, 120)) } : {}),
      ...(m.old ? { old: true } : {}),
      ...(typeof m.color === "string" && /^#[0-9a-f]{6}$/i.test(m.color) ? { color: m.color.toLowerCase() } : {}),
    }));
    if (b.fit === "contain" && item.size === "full") item.fit = "contain";
    const crop = box(b.crop);
    if (crop) item.crop = crop;
    if (["in", "out", "left", "right"].includes(b.motion)) item.motion = b.motion;
  }
  return item;
};
// A part's own board colour (a preset or #rrggbb) and layout.
const cleanBackground = (v) => (typeof v === "string" && (BOARD_PRESETS[v] || /^#[0-9a-f]{6}$/i.test(v)) ? v : null);
const cleanLayout = (v) => (["stack", "center", "split"].includes(v) ? v : null);
// A picture copied from another video's question or solution arrives as an
// upload with only its address; find the stored file behind it.
const adoptPastedPictures = async (segments) => {
  if (!Array.isArray(segments)) return;
  const { mediaOfUrl } = require("../../utils/videoLesson");
  for (const s of segments) {
    for (const b of Array.isArray(s?.board) ? s.board : []) {
      if (b?.type === "image" && b.src === "upload" && !b.media?.key && typeof b.url === "string" && b.url) {
        b.media = (await mediaOfUrl(b.url).catch(() => null)) || null;
      }
    }
  }
};
// library: pictures the AI was offered (utils/videoLesson.js pictureLibrary);
// one it picked is kept as an upload of that file.
// Items that point at an earlier one (highlight, remove, camera) name it
// "S-K" by place; when items are dropped above, the places move, so each
// is pointed again at the same item (and dropped if that item went). Only
// for a whole lesson (repoint): a part on its own keeps its refs as they are.
const REF_TYPES = ["highlight", "remove", "camera"];
const repoint = (segments, on) => {
  const moved = new Map();
  const known = new Set();
  segments.forEach((s, si) => {
    (s.__all || []).forEach((k) => known.add(`${s.__src}-${k}`));
    (s.__from || []).forEach((k, ki) => moved.set(`${s.__src}-${k}`, `${si}-${ki}`));
  });
  return segments.map((s) => {
    const { __from, __src, __all, ...rest } = s;
    if (!on) return rest;
    const points = (b) => REF_TYPES.includes(b.type) && b.ref && known.has(b.ref);
    // A next step whose line went just appears as a new line.
    const follow = (b) => {
      if (!b.from || !known.has(b.from)) return b;
      const { from, ...plain } = b;
      return moved.has(from) ? { ...b, from: moved.get(from) } : plain;
    };
    return { ...rest, board: rest.board.filter((b) => !points(b) || moved.has(b.ref)).map((b) => (points(b) ? { ...b, ref: moved.get(b.ref) } : follow(b))) };
  });
};
const cleanSegments = (segments, { hasImage, hasSolutionImage, language, library = [], repointRefs = false }) => repoint(
  segments.map((s, si) => {
    const say = spokenText(s.say, { language });
    const picked = new Map(library.map((p) => [p.id, p]));
    // A listed picture's region ("r2"), as a crop of it.
    const regionOf = (p, id) => (p?.regions || []).find((r) => r.id === id);
    const fromLibrary = (b) => {
      const p = picked.get(b.ref);
      if (!p) return null;
      const r = b.focus ? regionOf(p, b.focus) : null;
      return { ...b, src: "upload", ref: null, media: p.media, ...(r ? { crop: { x: r.x, y: r.y, w: r.w, h: r.h } } : {}) };
    };
    const kept = (s.board || [])
        .map((b, k) => (b && typeof b === "object" ? { ...b, __k: k } : null))
        .filter(Boolean)
        .map((b) => (b.type === "image" && b.src === "library" ? fromLibrary(b) : b))
        .filter(Boolean)
        .map((b) => (b.type === "sequence"
          ? { ...b, frames: (b.frames || []).map((f) => (f?.ref && picked.has(f.ref) ? { ...f, media: picked.get(f.ref).media } : f)) }
          : b))
        .filter((b) => b.type !== "sequence" || (b.frames || []).some((f) => f?.media?.key))
        .filter((b) => b.type !== "remove" || b.ref)
        .filter((b) => b.type !== "clip" || b.media?.key)
        .filter((b) => b.type !== "image"
          || ((b.src || "question") === "question" && hasImage)
          || (b.src === "solution" && hasSolutionImage)
          || (b.src === "upload" && b.media?.key))
        .filter((b) => b.type !== "highlight" || b.ref)
        .filter((b) => b.type !== "diagram" || b.prompt || b.svg)
        .filter((b) => b.type !== "graph" || (b.fns || []).length || (b.points || []).length);
    const out = { say, board: kept.map((b) => cleanItem(b, say, language)), __from: kept.map((b) => b.__k), __src: si, __all: (s.board || []).map((_, k) => k) };
    const background = cleanBackground(s.background);
    const layout = cleanLayout(s.layout);
    if (background) out.background = background;
    if (layout && layout !== "stack") out.layout = layout;
    return out;
  }), repointRefs);

// Draws the diagrams a script asks for (items with a prompt and no
// drawing yet), a few at a time; one that fails stays as a prompt the
// editor can draw again.
const MAX_DIAGRAMS = 8;
const drawDiagrams = async (segments, { user, context }) => {
  let n = 0;
  for (const s of segments) {
    for (const b of s.board) {
      if (b.type !== "diagram" || b.svg || !b.prompt || n >= MAX_DIAGRAMS) continue;
      n += 1;
      try {
        const { data } = await aiService.generate({
          feature: "ai-diagram", schema: diagramSchema, ...diagramPrompt({ prompt: b.prompt, context, build: Boolean(b.build) }),
          maxTokens: 6000, user, student: null, wrapLatex: false,
        });
        b.svg = safeSvg(data.svg);
        if (!b.caption && data.caption) b.caption = tidyInline(data.caption);
      } catch {
        // Left undrawn: "Draw with AI" in the editor tries again.
      }
    }
  }
  return segments;
};
// Makes the AI pictures a script asks for ({ src: "ai", prompt }), at most
// two; each becomes an upload of the new picture. One that fails, or when
// AI images are off, is left out.
const MAX_AI_PICTURES = 2;
const makePictures = async (segments, { user }) => {
  let n = 0;
  const on = await aiPicture.enabled();
  for (const s of segments) {
    const board = [];
    for (const b of s.board || []) {
      if (b.type !== "image" || b.src !== "ai") { board.push(b); continue; }
      if (!on || !b.prompt || n >= MAX_AI_PICTURES) continue;
      n += 1;
      try {
        const media = await aiPicture.make({ prompt: String(b.prompt).slice(0, 600), purpose: "lesson", shape: "wide", user });
        board.push({ ...b, src: "upload", prompt: "", media: { key: media.key, driver: media.driver } });
      } catch { /* left out */ }
    }
    s.board = board;
  }
  return segments;
};
const picturesOf = (question) => ({ hasImage: Boolean(question?.questionImage), hasSolutionImage: Boolean(question?.solutionImage) });

//@desc   The video lesson for a question or a lecture, or null
//@route  GET /api/video-lessons?question=&lecture=
//@access Private (owner, admin)
const getLesson = asyncHandler(async (req, res) => {
  const target = await targetOf(req.query, res);
  await respond(res, await VideoLesson.findOne(filterOf(target)), target);
});

// Background work (script, voice), so the editor can be left while it
// runs. The state is kept on the lesson (job); the editor polls it.
// Tests wait on `settled()`.
const running = new Set();
const inBackground = (work) => {
  const p = work().catch(() => {}).finally(() => running.delete(p));
  running.add(p);
};
const settled = () => Promise.all([...running]);
const busy = (lesson) => lesson?.job?.status === "running" && jobOf(lesson.job)?.status === "running";
// The lesson while this same script job still runs (not stopped, not
// replaced by a newer one): its background work may only save into that.
const liveJob = (filter, startedAt) => ({ ...filter, "job.kind": "script", "job.status": "running", "job.startedAt": startedAt });
const failJob = (filter, e) =>
  VideoLesson.updateOne(filter, { $set: { "job.status": "failed", "job.error": e?.message || "Something went wrong. Try again." } });

// A lesson's plan as text for the script prompt (prompts videoLessonPlan).
const planLesson = async ({ title, source, kind, minutes, style, language, user }) => {
  const { data } = await aiService.generate({
    feature: "video-lesson-script", schema: videoLessonPlanSchema, student: null, user, wrapLatex: false, maxTokens: 3000,
    ...videoLessonPlan({ title, source, kind, minutes, style, language }),
  });
  if (!data?.parts?.length) return "";
  return [
    `Goal: ${data.goal}`,
    data.prior?.length ? `Students need first: ${data.prior.join("; ")}` : "",
    data.mistakes?.length ? `Common mistakes to warn about: ${data.mistakes.join("; ")}` : "",
    ...data.parts.map((p, i) => `${i + 1}. ${p.purpose}${p.points?.length ? `: ${p.points.join("; ")}` : ""}`),
  ].filter(Boolean).join("\n");
};
// A written script checked against its source (prompts videoLessonReview):
// the parts it finds wrong come back rewritten and replace them. Board item
// numbers stay the same where the part keeps its items, so refs still hold.
const REVIEW_MAX = 8;
const reviewScript = async ({ title, source, segments, language, user }) => {
  const script = segments.map((s, i) => `PART ${i}\nsay: ${s.say}\nboard: ${JSON.stringify((s.board || []).map(({ svg, ...b }) => b))}`).join("\n\n");
  const { data } = await aiService.generate({
    feature: "video-lesson-script", schema: videoLessonReviewSchema, student: null, user, wrapLatex: false, maxTokens: 8000,
    ...videoLessonReview({ title, source, script, language }),
  });
  const out = [...segments];
  for (const issue of (data?.issues || []).slice(0, REVIEW_MAX)) {
    const i = issue.index;
    if (!(i >= 0 && i < out.length) || !issue.segment?.say) continue;
    const fixed = issue.segment;
    // A fixed part that dropped its items keeps the old board.
    out[i] = { ...out[i], say: fixed.say, board: (fixed.board || []).length >= (out[i].board || []).length ? fixed.board : out[i].board };
  }
  return out;
};

//@desc   Write (or rewrite) the script with AI, in the background. A rewrite
//        clears the voice and unpublishes it until staff look again; the
//        old script stays until the new one is ready.
//@route  POST /api/video-lessons/generate { question | lecture, language?, minutes?, material? }
//@access Private (owner, admin)
const generateLesson = asyncHandler(async (req, res) => {
  const target = await targetOf(req.body || {}, res);
  const language = typeof req.body.language === "string" ? req.body.language.trim().slice(0, 40) : "";
  const style = ["steps", "story", "trick", "concept"].includes(req.body.style) ? req.body.style : null;
  // What the plan and the check read: the question and its solution, or
  // the lecture's material.
  let source = "";
  let planTitle = "";
  let minutes = null;
  // The prompt is built in the background, once the pictures are read
  // (utils/pictureNotes.js: what each really shows, once per picture).
  let buildPrompt;
  let expectSeconds = 60;
  let library = await pictureLibrary(target).catch(() => []);
  const aiPictures = await aiPicture.enabled();
  if (target.question) {
    const q = target.question;
    const solution = solutionOf(q);
    if (!solution) {
      res.status(400);
      throw new Error("This question has no solution yet. Add one first: the video explains it.");
    }
    buildPrompt = (pictures, plan) => solutionVideoScript({
      question: { type: q.type, question: fullQuestionText(q, { withAnswers: true }), options: q.type === "mcq" ? q.options : [], correctOption: q.type === "mcq" ? q.correctOption : null, solution, hasImage: Boolean(q.questionImage), hasSolutionImage: Boolean(q.solutionImage) },
      language,
      pictures,
      aiPictures,
      style,
      plan,
    });
    source = `QUESTION:\n${fullQuestionText(q, { withAnswers: true })}\n\nGIVEN SOLUTION:\n${solution}`;
    planTitle = "Solution walkthrough";
  } else {
    const material = await lectureMaterial(target.lecture, typeof req.body.material === "string" ? req.body.material : "");
    if (material.length < 200) {
      res.status(400);
      throw new Error("Not enough material to teach from. Add notes or readable attachments to the lecture, or paste the material.");
    }
    minutes = Math.min(Math.max(Number(req.body.minutes) || 8, 3), 20);
    buildPrompt = (pictures, plan) => lectureVideoScript({ title: target.lecture.title, description: target.lecture.description, material, minutes, language, pictures, aiPictures, style, plan });
    expectSeconds = 40 + minutes * 15;
    source = material;
    planTitle = target.lecture.title;
  }

  const filter = filterOf(target);
  if (busy(await VideoLesson.findOne(filter).select("job").lean())) {
    res.status(409);
    throw new Error("This video is already being worked on. Wait for it to finish.");
  }
  const lesson = await VideoLesson.findOneAndUpdate(
    filter,
    {
      $set: { job: { kind: "script", status: "running", startedAt: new Date(), expectSeconds: expectSeconds + 40, done: 0, total: 3, error: null } },
      $setOnInsert: { kind: target.kind, createdBy: req.user._id },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const live = liveJob(filter, lesson.job.startedAt);

  inBackground(async () => {
    try {
      library = await require("../../utils/pictureNotes").describePictures(library, { user: req.user._id }).catch(() => library);
      // 1. The plan: goal, mistakes, the parts in order. A failed plan
      // only means the script is written without one.
      const plan = await planLesson({ title: planTitle, source, kind: target.question ? "solution" : "lecture", minutes, style, language, user: req.user._id }).catch(() => "");
      if (!(await VideoLesson.updateOne(live, { $set: { "job.done": 1 } })).matchedCount) return;
      // 2. The script, from the plan.
      const built = buildPrompt(library.map((p) => ({ id: p.id, desc: p.desc, regions: (p.regions || []).map((r) => ({ id: r.id, label: r.label })) })), plan);
      const { data } = await aiService.generate({
        feature: "video-lesson-script",
        schema: videoLessonScript,
        student: null,
        user: req.user._id,
        // Board maths is tidied here (cleanSegments), not wrapped token by token.
        wrapLatex: false,
        maxTokens: target.lecture ? 12000 : 6000,
        ...built,
      });
      if (!(await VideoLesson.updateOne(live, { $set: { "job.done": 2 } })).matchedCount) return;
      // 3. The check: parts with wrong maths, facts not in the source or
      // unclear wording come back rewritten. A failed check keeps the script.
      data.segments = await reviewScript({ title: data.title, source, segments: data.segments, language, user: req.user._id }).catch(() => data.segments);
      await makePictures(data.segments, { user: req.user._id });
      const segments = cleanSegments(data.segments, { ...picturesOf(target.question), language, library, repointRefs: true }).filter((s) => s.say);
      if (segments.length < 2) throw new Error("The AI didn't return a usable script. Try again.");
      await drawDiagrams(segments, { user: req.user._id, context: target.question ? `${target.question.question}\n\n${solutionOf(target.question)}` : `${target.lecture.title}` });
      // Stopped meanwhile: the old script stays as it was.
      const old = await VideoLesson.findOne(live);
      if (!old) return;
      await removeAudio(old);
      await VideoLesson.updateOne(live, {
        $set: {
          title: data.title.trim(),
          language,
          segments,
          published: false,
          voice: { provider: null, voice: null },
          generatedAt: new Date(),
          "job.status": "done",
          "job.error": null,
        },
      });
    } catch (e) {
      await failJob(live, e);
    }
  });
  await respond(res, lesson, target, 202);
});

//@desc   Save edits: title, segments (narration and board), published
//@route  PUT /api/video-lessons/:id
//@access Private (owner, admin)
const updateLesson = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const target = lesson.question ? { question: await Question.findById(lesson.question).populate("questionImage solutionImage") } : { lecture: true };

  if (req.body.segments !== undefined && busy(lesson) && lesson.job.kind === "script") {
    res.status(409);
    throw new Error("A new script is being written. Wait for it, then edit.");
  }
  if (req.body.segments !== undefined) {
    await adoptPastedPictures(req.body.segments);
    const parsed = videoLessonScript.safeParse({ title: req.body.title || lesson.title || "Lesson", segments: req.body.segments });
    if (!parsed.success) {
      res.status(400);
      throw new Error(`The script isn't valid: ${parsed.error.issues[0]?.message || "check each segment"}.`);
    }
    // Audio is kept: a sentence's clip while the sentence is unchanged (the
    // voice job reuses clips by their text), the older whole-segment audio
    // while the narration is.
    const before = new Map(lesson.segments.map((s) => [String(s._id), s]));
    const cleaned = cleanSegments(parsed.data.segments, { ...picturesOf(target.question), language: lesson.language, repointRefs: true });
    const next = cleaned.map((s, i) => {
      const prev = before.get(String(req.body.segments[i]?._id || ""));
      if (!prev) return s;
      const out = { ...s, _id: prev._id };
      if ((prev.parts || []).length) {
        const want = new Set(sentencesOf(s.say));
        const parts = prev.parts.filter((p) => want.has(p.text)).map((p) => (p.toObject ? p.toObject() : p));
        if (parts.length) out.parts = parts;
      }
      if (prev.audio?.key && prev.say === s.say) out.audio = prev.audio;
      return out;
    });
    // A clip's line keeps its voice while its text is unchanged.
    const voiced = new Map();
    for (const s of lesson.segments) for (const l of lineFiles(s)) if (lineCurrent(l)) voiced.set(l.text, l);
    for (const s of next) {
      for (const l of lineFiles(s)) {
        const o = voiced.get(l.text);
        if (o) Object.assign(l, { key: o.key, driver: o.driver, durationSeconds: o.durationSeconds, forText: l.text });
      }
    }
    const kept = new Set(next.flatMap(filesOf).map((f) => f.key));
    for (const s of lesson.segments) {
      for (const f of filesOf(s)) if (!kept.has(f.key)) await dropFile(f, lesson._id);
    }
    lesson.segments = next;
  }
  if (typeof req.body.title === "string" && req.body.title.trim()) lesson.title = req.body.title.trim().slice(0, 160);
  if (req.body.published !== undefined) lesson.published = Boolean(req.body.published);
  if (req.body.look !== undefined) lesson.look = require("../../utils/videoLesson").cleanLook(req.body.look);
  await lesson.save();
  await respond(res, lesson, target);
});

const removeAudio = async (lesson) => {
  for (const s of lesson.segments || []) for (const f of filesOf(s)) await dropFile(f, lesson._id);
};

// One sentence's voice, tried again once after a short wait when the
// service fails (a blip); set-up errors (no key, no voice) fail at once.
const speakRetry = async (text, language) => {
  try {
    return await tts.speakTimed(text, { language });
  } catch (e) {
    if (e.statusCode === 400 || /answered 4(00|01|03)/.test(e.message || "")) throw e;
    await new Promise((r) => setTimeout(r, 2500));
    return tts.speakTimed(text, { language });
  }
};

//@desc   Make the voice for every segment whose narration has no current
//        audio (new, or edited since), in the background. One segment at a
//        time; a failure stops there, and what's done is kept.
//@route  POST /api/video-lessons/:id/voice
//@access Private (owner, admin)
const voiceLesson = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  if (busy(lesson)) { res.status(409); throw new Error("This video is already being worked on. Wait for it to finish."); }
  if (!(await tts.status()).ready) { res.status(400); throw new Error("No voice is set up. Choose one in Settings → AI → Voice."); }
  // Redo: every sentence again (a new voice chosen, or a bad take).
  const redo = Boolean(req.body?.redo);
  const { voiceCurrent } = require("../../utils/videoLesson");
  const todo = lesson.segments.filter((sg) => redo || !voiceCurrent(sg)).reduce((n, sg) => n + sentencesOf(sg.say).length + lineFiles(sg).length, 0);
  lesson.job = { kind: "voice", status: "running", startedAt: new Date(), expectSeconds: null, done: 0, total: todo, error: null };
  await lesson.save();
  const id = lesson._id;
  // Parts done in this run: each is tried once, so a part that can't come
  // out current never keeps the job going round.
  const redone = new Set();
  // Stopped from the editor (stopVoice): end after the sentence in hand.
  const stopped = async () => (await VideoLesson.findById(id).select("job").lean())?.job?.status !== "running";

  inBackground(async () => {
    const AiConfig = require("../../models/aiConfigModel");
    const cfg = (await AiConfig.get()).voice || {};
    let error = null;
    let made = 0;
    try {
      for (;;) {
        // Fresh each time, so an edit saved meanwhile isn't overwritten.
        const doc = await VideoLesson.findById(id);
        if (!doc) return;
        if (doc.job?.status !== "running") return;
        const seg = doc.segments.find((sg) => !redone.has(String(sg._id)) && (redo || !voiceCurrent(sg)));
        if (!seg) break;
        // A clip per sentence; one already made for the same sentence (in
        // any part of this lesson) is reused unless redoing.
        const have = new Map();
        if (!redo) {
          for (const sg of doc.segments) {
            for (const p of sg.parts || []) if (p.key) have.set(p.text, p);
            for (const l of lineFiles(sg)) if (lineCurrent(l)) have.set(l.text, l);
          }
        }
        const old = filesOf(seg);
        // Three sentences at a time, each with its word timings when the
        // voice gives them.
        const sentences = sentencesOf(seg.say);
        const parts = new Array(sentences.length);
        let next = 0;
        let halted = false;
        const worker = async () => {
          while (next < sentences.length && !halted) {
            const i = next++;
            const text = sentences[i];
            const reuse = have.get(text);
            if (reuse) { parts[i] = { text, key: reuse.key, driver: reuse.driver, durationSeconds: reuse.durationSeconds, ...(reuse.marks?.length ? { marks: reuse.marks } : {}) }; continue; }
            if (await stopped()) { halted = true; return; }
            try {
              const { mp3, marks } = await speakRetry(text, doc.language);
              const stored = await storage.storeGenerated("video-lessons", mp3, "audio/mpeg");
              parts[i] = { text, key: stored.key, driver: stored.driver, durationSeconds: tts.mp3Duration(mp3), ...(marks?.length ? { marks } : {}) };
            } catch (e) {
              halted = true;
              throw e;
            }
            made += 1;
            await VideoLesson.updateOne({ _id: id }, { $set: { "job.done": made } });
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (halted) return;
        // Each video clip's timed lines, the same way.
        const clipLines = [];
        for (const [k, b] of (seg.board || []).entries()) {
          if (b.type !== "clip" || !(b.lines || []).length) continue;
          const lines = [];
          for (const l of b.lines) {
            let f = have.get(l.text);
            if (!f) {
              const { mp3 } = await speakRetry(l.text, doc.language);
              const stored = await storage.storeGenerated("video-lessons", mp3, "audio/mpeg");
              f = { key: stored.key, driver: stored.driver, durationSeconds: tts.mp3Duration(mp3) };
              have.set(l.text, f);
              made += 1;
              await VideoLesson.updateOne({ _id: id }, { $set: { "job.done": made } });
            }
            lines.push({ text: l.text, key: f.key, driver: f.driver, durationSeconds: f.durationSeconds, forText: l.text });
          }
          clipLines.push({ k, texts: b.lines.map((l) => l.text).join("\n"), lines });
        }
        redone.add(String(seg._id));
        const fresh = await VideoLesson.findById(id);
        const target = fresh?.segments.id(seg._id);
        if (!target) continue;
        // Edited meanwhile: its new sentences are voiced on the next round.
        if (target.say !== seg.say) continue;
        target.parts = parts;
        target.audio = { key: null, driver: null, durationSeconds: null, forText: null };
        // Lines edited meanwhile are voiced on the next round.
        for (const { k, texts, lines } of clipLines) {
          const tb = target.board[k];
          if (tb?.type === "clip" && (tb.lines || []).map((l) => l.text).join("\n") === texts) tb.lines = lines.map((l, i) => ({ ...l, at: tb.lines[i].at }));
        }
        fresh.job.done = made;
        fresh.job.total = Math.max(fresh.job.total, made);
        await fresh.save();
        const keep = new Set(fresh.segments.flatMap(filesOf).map((f) => f.key));
        for (const f of old) if (!keep.has(f.key)) await dropFile(f, id);
      }
    } catch (e) {
      error = e.message || "The voice service failed.";
    }
    if (await stopped()) return;
    const voice = { provider: cfg.provider || null, voice: (tts.isBangla(lesson.language) && cfg.voiceBangla) || cfg.voice || null };
    await VideoLesson.updateOne({ _id: id }, {
      $set: { voice, "job.status": error ? "failed" : "done", "job.done": made, "job.error": error ? (made ? `Voiced ${made} sentences, then stopped: ${error}` : error) : null },
    });
  });
  const target = lesson.question ? { question: await Question.findById(lesson.question).populate("questionImage solutionImage") } : null;
  await respond(res, lesson, target, 202);
});

//@desc   Stop the work in hand. Voice: what's voiced so far is kept; Make
//        voice carries on from there. Script: the old script is kept; the
//        new one is dropped (an AI call already sent still finishes).
//@route  POST /api/video-lessons/:id/voice/stop
//@access Private (owner, admin)
const stopVoice = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  if (lesson.job?.status === "running") {
    await VideoLesson.updateOne({ _id: lesson._id, "job.status": "running" }, {
      $set: { "job.status": "failed", "job.error": lesson.job.kind === "script" ? "Stopped. Nothing was changed." : "Stopped. What was voiced is kept: press Make voice to carry on." },
    });
  }
  const fresh = await VideoLesson.findById(lesson._id);
  const target = fresh.question ? { question: await Question.findById(fresh.question).populate("questionImage solutionImage") } : null;
  await respond(res, fresh, target);
});

//@desc   One part done again by AI (again, more detail, shorter, simpler,
//        or as told). Returns the part(s) to put in its place in the
//        editor; nothing is saved until the editor saves the script.
//        Action "new": a new part written from the teacher's description,
//        to go after part `index` (-1: at the start).
//@route  POST /api/video-lessons/:id/revise { segment, say, board, action, instruction }
//@access Private (owner, admin)
const REVISE_ACTIONS = ["redo", "elaborate", "concise", "simpler", "custom", "new"];
const reviseSegment = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const action = REVISE_ACTIONS.includes(req.body?.action) ? req.body.action : "redo";
  const instruction = String(req.body?.instruction || "").trim().slice(0, 500);
  if (action === "custom" && !instruction) { res.status(400); throw new Error("Say what to change."); }
  if (action === "new" && !instruction) { res.status(400); throw new Error("Say what this part shows or explains."); }
  // The part as the editor has it now (it may hold unsaved edits).
  const all = Array.isArray(req.body?.segments) ? req.body.segments : lesson.segments.map((sg) => sg.toObject());
  const at = Number(req.body?.index);
  const fresh = action === "new";
  if (fresh && !(Number.isInteger(at) && at >= -1 && at < all.length)) { res.status(400); throw new Error("Pick where the new part goes."); }
  const part = fresh ? { say: "", board: [] } : all[at];
  if (!fresh && !part?.say) { res.status(400); throw new Error("Pick a part of the script."); }
  const board = (part.board || []).map((b, i) => {
    const { media, marks, url, svg, ...rest } = b; // eslint-disable-line no-unused-vars
    return { n: i, ...rest, ...(b.type === "diagram" && svg ? { drawn: true } : {}), ...(marks?.length ? { marks: marks.length } : {}) };
  });

  const question = lesson.question ? await Question.findById(lesson.question).populate("questionImage solutionImage") : null;
  const lecture = lesson.lecture ? await Lecture.findById(lesson.lecture) : null;
  const source = question
    ? `${question.question}\n\nSOLUTION:\n${solutionOf(question)}`
    : lecture ? (await lectureMaterial(lecture, "")).slice(0, 12000) : "";
  const { data } = await aiService.generate({
    feature: "video-lesson-script",
    schema: videoLessonPart,
    student: null,
    user: req.user._id,
    wrapLatex: false,
    maxTokens: 5000,
    ...(fresh
      ? videoLessonNewPartPrompt({
        title: lesson.title, source, instruction, language: lesson.language,
        before: all[at]?.say || "", after: all[at + 1]?.say || "",
      })
      : videoLessonPartPrompt({
        title: lesson.title, source, action, instruction, language: lesson.language,
        before: all[at - 1]?.say || "", after: all[at + 1]?.say || "",
        part: JSON.stringify({ say: part.say, board }, null, 1),
      })),
  });
  // Kept items come back whole (picture, marks, drawing), at their new cue.
  const restored = data.segments.map((sg) => ({
    ...sg,
    board: (sg.board || []).map((b) => {
      const orig = Number.isInteger(b.keep) ? part.board?.[b.keep] : null;
      return orig ? { ...orig, cue: b.cue ?? orig.cue, with: b.with ?? orig.with } : b;
    }),
  }));
  const segments = cleanSegments(restored, { ...picturesOf(question), language: lesson.language }).filter((sg) => sg.say);
  if (!segments.length) { res.status(502); throw new Error("The AI didn't return a usable part. Try again."); }
  await drawDiagrams(segments, { user: req.user._id, context: source.slice(0, 2500) });
  // Pictures shown as the players need them.
  const shaped = await shapeLesson({ segments }, await lessonImages(question));
  res.status(200).json({ segments: shaped.segments.map(({ say, board }) => ({ say, board })) });
});

//@desc   One part's narration said like a real teacher, board unchanged
//        except cues moved to the new words. Returned for the editor to
//        review; nothing is saved here.
//@route  POST /api/video-lessons/:id/humanize { index, segments }
//@access Private (owner, admin)
const humanizeSegment = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const all = Array.isArray(req.body?.segments) ? req.body.segments : lesson.segments.map((sg) => sg.toObject());
  const at = Number(req.body?.index);
  const part = all[at];
  if (!part?.say) { res.status(400); throw new Error("Pick a part of the script."); }
  const board = Array.isArray(part.board) ? part.board : [];
  const cues = board.map((b, n) => ({ n, cue: String(b.cue || ""), label: `${b.type}${b.text ? `: ${String(b.text).slice(0, 60)}` : ""}` })).filter((c) => c.cue);
  const { data } = await aiService.generate({
    feature: "video-lesson-script",
    schema: videoHumanize,
    student: null,
    user: req.user._id,
    wrapLatex: false,
    maxTokens: 2500,
    ...videoHumanizePrompt({
      title: lesson.title, language: lesson.language, say: String(part.say).slice(0, 1500), cues,
      before: all[at - 1]?.say || "", after: all[at + 1]?.say || "",
    }),
  });
  const say = String(data.say || "").trim();
  if (!say) { res.status(502); throw new Error("The AI didn't return a usable narration. Try again."); }
  const lower = say.toLowerCase();
  const found = (c) => c && lower.includes(String(c).toLowerCase().trim());
  const fresh = new Map((data.cues || []).map((c) => [c.n, c.cue]));
  // A cue not in the new words is dropped: the item then shows at its
  // default time.
  const next = board.map((b, n) => {
    if (!b.cue) return b;
    const cue = found(fresh.get(n)) ? fresh.get(n).trim() : found(b.cue) ? b.cue : null;
    return { ...b, cue };
  });
  res.status(200).json({ say, board: next, lost: next.filter((b, n) => board[n].cue && !b.cue).length });
});

//@desc   Delete a video lesson and its audio (an exported MP4 stays, as
//        the question's or lecture's video, until replaced there)
//@route  DELETE /api/video-lessons/:id
//@access Private (owner, admin)
const deleteLesson = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  await removeAudio(lesson);
  await lesson.deleteOne();
  res.status(200).json({ ok: true });
});

//@desc   A segment's audio, from this server, for recording the video:
//        audio from another host without CORS headers records as silence.
//@route  GET /api/video-lessons/:id/audio/:segmentId
//@access Private (owner, admin)
const segmentAudio = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson")).select("segments._id segments.audio segments.parts segments.board").lean();
  const seg = lesson?.segments.find((x) => String(x._id) === req.params.segmentId);
  // ?clip=n: that sentence's clip; ?line=k.n: line n of board item k (a
  // video clip's timed line); else the older whole-segment audio.
  const [k, n] = String(req.query.line || "").split(".").map(Number);
  const file = req.query.clip !== undefined ? seg?.parts?.[Number(req.query.clip)]
    : req.query.line !== undefined ? seg?.board?.[k]?.lines?.[n]
      : seg?.audio;
  if (!file?.key) { res.status(404); throw new Error("No audio for that part."); }
  const bytes = await storage.get(file.key, file.driver);
  res.set("Content-Type", "audio/mpeg");
  res.set("Cache-Control", "private, max-age=3600");
  res.send(bytes);
});

//@desc   A picture for the board (an image item's upload)
//@route  POST /api/video-lessons/:id/image   (body: the image file)
//@access Private (owner, admin)
const IMAGE_MAGIC = { "image/png": [0x89, 0x50], "image/jpeg": [0xff, 0xd8], "image/webp": [0x52, 0x49] };
const uploadImage = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson")).select("_id");
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim();
  const magic = IMAGE_MAGIC[type];
  if (!magic || !Buffer.isBuffer(req.body) || req.body[0] !== magic[0] || req.body[1] !== magic[1]) {
    res.status(400);
    throw new Error("Send a PNG, JPEG or WebP picture.");
  }
  const stored = await storage.storeGenerated("video-lessons", req.body, type);
  res.status(201).json({ media: { key: stored.key, driver: stored.driver }, url: await storage.urlFor(stored.key, stored.driver) });
});

//@desc   An AI picture for the board (an image item), from a description
//@route  POST /api/video-lessons/:id/ai-image { prompt }
//@access Private (owner, admin)
const aiImage = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson")).select("_id");
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const prompt = String(req.body?.prompt || "").trim().slice(0, 600);
  if (!prompt) { res.status(400); throw new Error("Describe the picture first."); }
  let media;
  try {
    media = await aiPicture.make({ prompt, purpose: "lesson", shape: "wide", user: req.user._id });
  } catch (error) {
    res.status(error.statusCode || 502);
    throw error;
  }
  res.status(201).json({ media: { key: media.key, driver: media.driver }, url: await storage.urlFor(media.key, media.driver) });
});

//@desc   A short video for the board (a clip item's upload)
//@route  POST /api/video-lessons/:id/clip   (body: the MP4 or WebM file)
//@access Private (owner, admin)
const isVideo = (type, b) =>
  Buffer.isBuffer(b) && b.length > 32
  && ((type === "video/mp4" && b.toString("latin1", 4, 8) === "ftyp") || (type === "video/webm" && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3));
const uploadClip = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson")).select("_id");
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim();
  if (!isVideo(type, req.body)) {
    res.status(400);
    throw new Error("Send an MP4 or WebM video.");
  }
  const stored = await storage.storeGenerated("video-lessons", req.body, type);
  res.status(201).json({ media: { key: stored.key, driver: stored.driver }, url: await storage.urlFor(stored.key, stored.driver) });
});

//@desc   A clip's video, from this server, for recording the lesson (sound
//        from another host without CORS headers records as silence).
//        Answers range requests, so the player can jump inside it.
//@route  GET /api/video-lessons/:id/clip/:segmentId/:index
//@access Private (owner, admin)
const clipFile = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson")).select("segments._id segments.board").lean();
  const seg = lesson?.segments.find((x) => String(x._id) === req.params.segmentId);
  const item = seg?.board?.[Number(req.params.index)];
  if (item?.type !== "clip" || !item.media?.key) { res.status(404); throw new Error("No clip there."); }
  res.set("Cache-Control", "private, max-age=3600");
  // A file on this server's disk: sent as it is (range requests handled).
  const driver = storage.DRIVERS[item.media.driver];
  if (driver?.pathOf && item.media.driver === "local") return res.sendFile(driver.pathOf(item.media.key));
  const bytes = await storage.get(item.media.key, item.media.driver);
  res.set("Content-Type", /\.webm$/i.test(item.media.key) ? "video/webm" : "video/mp4");
  res.set("Accept-Ranges", "bytes");
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  if (!m || (!m[1] && !m[2])) return res.send(bytes);
  const size = bytes.length;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  if (start >= size || start > end) { res.status(416).set("Content-Range", `bytes */${size}`); return res.end(); }
  res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
  return res.send(bytes.subarray(start, end + 1));
});

//@desc   Save a video recorded from the player as the question's solution
//        video or the lecture's video (replacing what was there).
//@route  POST /api/video-lessons/:id/export   (body: the video file)
//@access Private (owner, admin)
// A long recording arrives in parts while it's being made (exportPart), so
// the browser never holds the whole video and no single request is huge.
// The parts are appended to a file here; the export call then names the
// upload instead of carrying the video. Parts must come in order.
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXPORT_DIR = path.join(os.tmpdir(), "examai-exports");
const EXPORT_MAX = 2000 * 1e6; // a file read whole must stay under 2 GB
const exportNext = new Map(); // part file -> index expected next
const uploadId = (req, res) => {
  const id = String(req.query.upload || "");
  if (!/^[a-f0-9]{16,64}$/.test(id)) { res.status(400); throw new Error("Bad upload id."); }
  return id;
};
const partFile = (lessonId, upload) => path.join(EXPORT_DIR, `${lessonId}-${upload}.part`);

//@desc   One part of a recording being made (see exportLesson).
//@route  POST /api/video-lessons/:id/export/part?upload=&index=   (body: bytes)
//@access Private (owner, admin)
const exportPart = asyncHandler(async (req, res) => {
  const lessonId = idOr400(req.params.id, res, "video lesson");
  const upload = uploadId(req, res);
  const index = Number(req.query.index);
  if (!Number.isInteger(index) || index < 0 || !Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400);
    throw new Error("Send a part of the recording.");
  }
  await fs.promises.mkdir(EXPORT_DIR, { recursive: true });
  const file = partFile(lessonId, upload);
  if (index === 0) {
    // Parts of recordings abandoned more than a day ago.
    const now = Date.now();
    for (const name of await fs.promises.readdir(EXPORT_DIR).catch(() => [])) {
      const f = path.join(EXPORT_DIR, name);
      const st = await fs.promises.stat(f).catch(() => null);
      if (st && now - st.mtimeMs > 86400000) { await fs.promises.unlink(f).catch(() => {}); exportNext.delete(f); }
    }
    await fs.promises.unlink(file).catch(() => {});
    exportNext.set(file, 0);
  }
  const next = exportNext.get(file);
  // A part sent again because its answer was lost has already landed.
  if (next !== undefined && index === next - 1) return res.json({ ok: true });
  if (next === undefined || index !== next) { res.status(409); throw new Error("A part of the recording went missing. Record it again."); }
  const have = await fs.promises.stat(file).then((st) => st.size).catch(() => 0);
  if (have + req.body.length > EXPORT_MAX) { res.status(413); throw new Error("The recording is over 2 GB. Split the lesson into shorter parts."); }
  await fs.promises.appendFile(file, req.body);
  exportNext.set(file, index + 1);
  res.json({ ok: true });
});

// Where a saved recording goes and what it replaces. `to`: a video provider
// that takes uploads (VdoCipher, Bunny, Vimeo) or "storage"; unset:
// VdoCipher when it's set up, else storage. If the provider refuses it,
// it's kept in storage.
const saveExport = async (lesson, body, type, duration, to, userId) => {
  const Media = require("../../models/mediaModel");
  const title = lesson.title || "AI video";
  let place = null;
  let uploadError = null;
  const ready = (p) => p?.upload && (p.canUpload ? p.canUpload() : p.configured());
  const provider = to === "storage" ? null : to ? video.PROVIDERS[to] : ready(video.PROVIDERS.vdocipher) ? video.PROVIDERS.vdocipher : null;
  if (to && to !== "storage" && !ready(provider)) throw Object.assign(new Error(`${provider?.label || to} isn't set up to take uploads.`), { statusCode: 400 });
  if (provider) {
    try {
      place = { driver: provider.name, key: await provider.upload(body, type, title), sizeBytes: body.length };
    } catch (e) {
      uploadError = e.message;
    }
  }
  if (!place) place = await storage.storeGenerated("video-lessons", body, type);
  const media = await Media.create({
    title,
    kind: "video",
    driver: place.driver,
    key: place.key,
    sizeBytes: place.sizeBytes,
    mimeType: type,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
    uploadedBy: userId,
  });
  if (lesson.question) await Question.updateOne({ _id: lesson.question }, { $set: { solutionVideo: media._id } });
  else await Lecture.updateOne({ _id: lesson.lecture }, { $set: { video: media._id } });
  lesson.exportMedia = media._id;
  lesson.exportedAt = new Date();
  await lesson.save();
  return { media: { _id: media._id, sizeBytes: media.sizeBytes, mimeType: type, driver: media.driver }, exportedAt: lesson.exportedAt, uploadError };
};

// The browser's recording (uneven timestamps, any size) made into a clean
// course file: H.264 + AAC MP4, 1280x720 or 1920x1080 (?h=1080), a constant 30 fps, the sound
// stretched to stay in step with the picture, the last frame held so the
// picture lasts as long as the sound, index at the front.
const toCourseMp4 = (input, output, height = 720) => new Promise((resolve, reject) => {
  const [w, h, rate] = height === 1080 ? [1920, 1080, "6M"] : [1280, 720, "4M"];
  const { spawn } = require("child_process");
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts", "-i", input,
    "-vf", `fps=30,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,tpad=stop_mode=clone:stop_duration=30`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-maxrate", rate, "-bufsize", `${parseInt(rate, 10) * 2}M`, "-g", "60",
    "-af", "aresample=async=1:first_pts=0,deesser=i=0.4:m=0.5:f=0.5,alimiter=limit=0.85:level=false", "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-shortest", "-movflags", "+faststart", output];
  const p = spawn("ffmpeg", args);
  let err = "";
  p.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
  p.on("error", (e) => reject(e.code === "ENOENT" ? new Error("ffmpeg isn't installed on the server (apt install -y ffmpeg).") : e));
  p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Converting the video failed: ${err.trim().split("\n").pop() || code}`))));
});

// Conversions run in the background (a long lecture takes minutes); the
// browser asks exportStatus until it's done. upload id -> state.
const exportJobs = new Map();

//@desc   Save a video recorded from the player as the question's solution
//        video or the lecture's video (replacing what was there), or (HD,
//        ?upload=) convert the parts already sent into a course MP4 and
//        save it, or keep it for download (?to=download).
//@route  POST /api/video-lessons/:id/export   (body: the video, unless ?upload=)
//@access Private (owner, admin)
const exportLesson = asyncHandler(async (req, res) => {
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const duration = Number(req.query.seconds);
  const to = String(req.query.to || "");
  if (req.query.upload) {
    const upload = uploadId(req, res);
    const file = partFile(lesson._id, upload);
    exportNext.delete(file);
    if (!(await fs.promises.stat(file).catch(() => null))) { res.status(400); throw new Error("The recording's parts didn't arrive. Record it again."); }
    const out = path.join(EXPORT_DIR, `${lesson._id}-${upload}.mp4`);
    const job = { state: "working", lesson: String(lesson._id) };
    exportJobs.set(upload, job);
    (async () => {
      try {
        await toCourseMp4(file, out, Number(req.query.h) === 1080 ? 1080 : 720);
        await fs.promises.unlink(file).catch(() => {});
        if (to === "download") {
          job.download = `/api/video-lessons/${lesson._id}/export/file?upload=${upload}`;
          job.sizeBytes = (await fs.promises.stat(out)).size;
        } else {
          const body = await fs.promises.readFile(out);
          await fs.promises.unlink(out).catch(() => {});
          Object.assign(job, await saveExport(lesson, body, "video/mp4", duration, to, req.user._id));
        }
        job.state = "done";
      } catch (e) {
        job.state = "error";
        job.message = e.message;
        await fs.promises.unlink(file).catch(() => {});
        await fs.promises.unlink(out).catch(() => {});
      }
      setTimeout(() => exportJobs.delete(upload), 86400000).unref?.();
    })();
    return res.status(202).json({ job: upload });
  }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim();
  const body = req.body;
  if (!["video/mp4", "video/webm"].includes(type) || !Buffer.isBuffer(body) || body.length < 1000) {
    res.status(400);
    throw new Error("Send the recorded video (MP4 or WebM).");
  }
  try {
    res.status(201).json(await saveExport(lesson, body, type, duration, to, req.user._id));
  } catch (e) {
    if (e.statusCode) res.status(e.statusCode);
    throw e;
  }
});

//@desc   Optional: the server plays the lesson and makes the MP4 itself (no
//        screen recording in the browser; utils/lessonRender.js). Uses the
//        saved lesson. Runs in the background, one at a time; the browser
//        asks exportStatus with ?upload=<job> as for HD.
//@route  POST /api/video-lessons/:id/render { h: 720|1080, to, captions, captionFile }
//@access Private (owner, admin)
const renderExport = asyncHandler(async (req, res) => {
  const { renderLesson, cannotRender, queued } = require("../../utils/lessonRender");
  const lesson = await VideoLesson.findById(idOr400(req.params.id, res, "video lesson"));
  if (!lesson) { res.status(404); throw new Error("Video lesson not found."); }
  const why = cannotRender();
  if (why) { res.status(503); throw new Error(why); }
  const { voiceCurrent } = require("../../utils/videoLesson");
  if (!lesson.segments.length) { res.status(400); throw new Error("Write the script first."); }
  if ((await tts.status())?.ready && lesson.segments.some((s) => !voiceCurrent(s))) { res.status(400); throw new Error("Make the voice for every part first."); }
  const to = String(req.body?.to || "download");
  const height = Number(req.body?.h) === 1080 ? 1080 : 720;
  const job = require("crypto").randomBytes(16).toString("hex");
  const state = { state: "working", lesson: String(lesson._id), step: "Starting" };
  exportJobs.set(job, state);
  const out = path.join(EXPORT_DIR, `${lesson._id}-${job}.mp4`);
  const question = lesson.question ? await Question.findById(lesson.question).populate("questionImage solutionImage") : null;
  const shaped = await shapeLesson(lesson, await lessonImages(question));
  const raw = lesson.toObject();
  const onStep = (step) => { state.step = step; };
  queued(async () => {
    try {
      const { seconds, captions } = await renderLesson({ shaped, raw, output: out, height, captions: Boolean(req.body?.captions), onStep });
      if (to === "download") {
        state.download = `/api/video-lessons/${lesson._id}/export/file?upload=${job}`;
        state.sizeBytes = (await fs.promises.stat(out)).size;
      } else {
        onStep("Saving");
        const body = await fs.promises.readFile(out);
        await fs.promises.unlink(out).catch(() => {});
        Object.assign(state, await saveExport(lesson, body, "video/mp4", seconds, to, req.user._id));
      }
      if (req.body?.captionFile && captions) state.captions = captions;
      state.state = "done";
    } catch (e) {
      state.state = "error";
      state.message = e.message;
      await fs.promises.unlink(out).catch(() => {});
    }
    setTimeout(() => exportJobs.delete(job), 86400000).unref?.();
  }, onStep).catch(() => {});
  res.status(202).json({ job });
});

//@desc   How a background HD conversion is going.
//@route  GET /api/video-lessons/:id/export/status?upload=
//@access Private (owner, admin)
const exportStatus = asyncHandler(async (req, res) => {
  const job = exportJobs.get(uploadId(req, res));
  if (!job || job.lesson !== String(req.params.id)) { res.status(404); throw new Error("That recording isn't being processed. Record it again."); }
  res.json(job);
});

//@desc   The converted MP4 kept for download; removed once sent. With
//        zip=1: one .zip of the MP4 and, when made, its captions (.srt,
//        .vtt), every file named `name`.
//@route  GET /api/video-lessons/:id/export/file?upload=&name=&zip=
//@access Private (owner, admin)
const exportFile = asyncHandler(async (req, res) => {
  const lessonId = idOr400(req.params.id, res, "video lesson");
  const upload = uploadId(req, res);
  const out = path.join(EXPORT_DIR, `${lessonId}-${upload}.mp4`);
  if (!(await fs.promises.stat(out).catch(() => null))) { res.status(404); throw new Error("That video was already downloaded or has expired."); }
  const base = String(req.query.name || "Lecture").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim().slice(0, 120) || "Lecture";
  if (req.query.zip !== "1") {
    res.download(out, `${base}.mp4`, () => fs.promises.unlink(out).catch(() => {}));
    return;
  }
  const JSZip = require("jszip");
  const zip = new JSZip();
  // Stored, not compressed: an MP4 doesn't shrink, and the file streams.
  zip.file(`${base}.mp4`, fs.createReadStream(out), { binary: true });
  const job = exportJobs.get(upload);
  if (job?.lesson === String(lessonId) && job.captions) {
    zip.file(`${base}.srt`, job.captions.srt || "");
    zip.file(`${base}.vtt`, job.captions.vtt || "");
  }
  res.setHeader("Content-Type", "application/zip");
  res.attachment(`${base}.zip`);
  zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "STORE" })
    .on("error", () => res.destroy())
    .pipe(res)
    .on("finish", () => fs.promises.unlink(out).catch(() => {}));
});

//@desc   A batch's lectures in course order, with each one's AI video lesson
//        (if any) and whether it's ready to record: for exporting a whole
//        course in one go (admin components/CourseVideoExport.jsx).
//@route  GET /api/video-lessons/course?batch=
//@access Private (owner, admin)
const courseLessons = asyncHandler(async (req, res) => {
  const Batch = require("../../models/batchModel");
  const { orderLectures } = require("../../utils/courseOutline");
  const { voiceCurrent } = require("../../utils/videoLesson");
  const batch = await Batch.findById(idOr400(req.query.batch, res, "batch")).select("name outline").lean();
  if (!batch) { res.status(404); throw new Error("Batch not found."); }
  const lectures = await Lecture.find({ batches: batch._id })
    .select("title chapter topic order createdAt")
    .populate("chapter", "title")
    .populate("topic", "title")
    .lean();
  await orderLectures(batch, lectures);
  const lessons = await VideoLesson.find({ lecture: { $in: lectures.map((l) => l._id) } })
    .select("lecture title segments.say segments.parts.key segments.parts.text segments.audio segments.board.type segments.board.lines.key segments.board.lines.text segments.board.lines.forText exportedAt job")
    .lean();
  const byLecture = new Map(lessons.map((v) => [String(v.lecture), v]));
  res.json({
    batch: { _id: batch._id, name: batch.name },
    voiceReady: Boolean((await tts.status())?.ready),
    lectures: lectures.map((l) => {
      const v = byLecture.get(String(l._id));
      const segments = v?.segments || [];
      return {
        _id: l._id,
        title: l.title,
        chapter: l.chapter?.title || "",
        topic: l.topic?.title || "",
        lesson: v && segments.length
          ? { _id: v._id, segments: segments.length, needVoice: segments.filter((s) => !voiceCurrent(s)).length, busy: jobOf(v.job)?.status === "running", exportedAt: v.exportedAt || null }
          : null,
      };
    }),
  });
});

// cleanSegments, inBackground, removeAudio: also used for students' own short
// videos (controllers/app/studentVideoController.js).
module.exports = { courseLessons, getLesson, generateLesson, updateLesson, deleteLesson, voiceLesson, stopVoice, reviseSegment, humanizeSegment, segmentAudio, exportLesson, exportPart, exportStatus, exportFile, renderExport, uploadImage, uploadClip, clipFile, aiImage, settled, cleanSegments, inBackground, removeAudio };
