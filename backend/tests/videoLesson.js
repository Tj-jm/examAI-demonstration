// Video lessons: AI script for a question's solution or a lecture, edits,
// publishing, and a stored video file playing from its storage url. The AI
// is stubbed.
process.env.SETTINGS_CACHE_MS = process.env.SETTINGS_CACHE_MS || "0";
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "11".repeat(32);
let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 600)); }
};
const run = async (handler, req) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await new Promise((resolve) => {
    Promise.resolve(handler({ params: {}, query: {}, body: {}, ...req }, res, (err) => {
      if (err) { res.code = err.statusCode || (res.code === 200 ? 500 : res.code); res.body = { message: err.message }; }
      resolve();
    })).then(resolve);
  });
  return res;
};

(async () => {
  const { videoLessonScript } = require("../ai/schemas");
  const { solutionVideoScript } = require("../ai/prompts");
  console.log("script shape");
  check("a script needs at least two segments", !videoLessonScript.safeParse({ title: "x", segments: [{ say: "a", board: [] }] }).success);
  check("unknown board item types are refused", !videoLessonScript.safeParse({ title: "x", segments: [{ say: "a", board: [{ type: "video" }] }, { say: "b", board: [] }] }).success);
  const p = solutionVideoScript({ question: { type: "mcq", question: "Q?", options: [{ key: "A", text: "1" }], correctOption: "A", solution: "Because." } });
  check("the prompt carries the given solution and forbids solving it another way", /GIVEN SOLUTION:\nBecause\./.test(p.prompt) && /Explain the GIVEN solution only/.test(p.system));

  console.log("\nboard maths");
  const { tidyInline, tidyMath } = require("../utils/videoLesson");
  check("misplaced $ around symbols become one expression", tidyInline("\\vec{A}$=4$\\hat{i}$+3$\\hat{j}") === "$\\vec{A} =4 \\hat{i} +3 \\hat{j}$", tidyInline("\\vec{A}$=4$\\hat{i}$+3$\\hat{j}"));
  check("$$…$$, \\(…\\) and \\[…\\] in text or a list become $…$",
    tidyInline("Mass \\(m = 2\\,kg\\) and $$F = ma$$ and \\[a^2\\]") === "Mass $m = 2\\,kg$ and $F = ma$ and $a^2$", tidyInline("Mass \\(m = 2\\,kg\\) and $$F = ma$$ and \\[a^2\\]"));
  check("sound text is left as it is", tidyInline("Given: $v = u + at$, so t = 2 s.") === "Given: $v = u + at$, so t = 2 s.");
  check("plain words stay plain", tidyInline("Step 1: Compute the cross product") === "Step 1: Compute the cross product");
  check("bare LaTeX is wrapped once", tidyInline("\\vec{A}\\times\\vec{B} = 2") === "$\\vec{A}\\times\\vec{B} = 2$");
  check("equations lose stray $, matrices get their row breaks back",
    tidyMath("\\vec{A}\\times\\vec{B}$ = \\begin{vmatrix}\\hat{i}&\\hat{j}&\\hat{k}\\4&3&0\\-2&-1&1\\end{vmatrix}") === "\\vec{A}\\times\\vec{B} = \\begin{vmatrix}\\hat{i}&\\hat{j}&\\hat{k}\\\\4&3&0\\\\-2&-1&1\\end{vmatrix}");
  check("…and correct row breaks are kept", tidyMath("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}") === "\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}");
  const { spokenText } = require("../utils/videoLesson");
  check("narration maths is put into words", spokenText("the formula $s=\\sqrt{(\\pi r)^2+(2r)^2}$.") === "the formula s equals the square root of pi r squared plus 2r squared.", spokenText("the formula $s=\\sqrt{(\\pi r)^2+(2r)^2}$."));
  check("…plain narration is left alone", spokenText("Use v equals u plus a t.") === "Use v equals u plus a t.");
  check("over-escaped commands get one backslash", tidyInline("$\\\\vec{A} = 4\\\\hat{i}$") === "$\\vec{A} = 4\\hat{i}$", tidyInline("$\\\\vec{A} = 4\\\\hat{i}$"));
  check("a row break before a command stays", tidyMath("\\begin{pmatrix}a&b\\\\\\hat{i}&c\\end{pmatrix}") === "\\begin{pmatrix}a&b\\\\\\hat{i}&c\\end{pmatrix}");

  if (!process.env.TEST_MONGO_URL) {
    console.log("database: skipped (set TEST_MONGO_URL to run)");
  } else {
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.TEST_MONGO_URL);
    if (/test/.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
    const { Question } = require("../models/questionModel");
    const Lecture = require("../models/lectureModel");
    const Media = require("../models/mediaModel");
    const VideoLesson = require("../models/videoLessonModel");
    const ai = require("../ai/service");
    const ctl = require("../controllers/admin/videoLessonController");
    const admin = { _id: new mongoose.Types.ObjectId(), role: "owner" };
    const ids = { subject: new mongoose.Types.ObjectId(), chapter: new mongoose.Types.ObjectId() };

    let lastCall = null;
    const script = {
      title: "Ball thrown up",
      segments: [
        { say: "A ball is thrown up at 20 metres per second.", board: [{ type: "heading", text: "Ball thrown up" }, { type: "image" }] },
        { say: "Use v equals u minus g t.", board: [{ type: "math", latex: "$v = u - gt$" }, { type: "list", items: ["u = 20", " ", "v = 0"] }] },
        { say: "So t is about 2 seconds.", board: [{ type: "answer", text: "$t \\approx 2$ s" }] },
      ],
    };
    ai.generate = async (o) => { lastCall = o; return { data: JSON.parse(JSON.stringify(script)), usage: {} }; };
    // Script and voice run in the background: start, wait, read back.
    const after = async (out, query) => {
      if (out.code !== 202) return out;
      await ctl.settled();
      const read = await run(ctl.getLesson, { user: admin, query });
      return { code: 200, body: { ...read.body, started: out.body } };
    };
    const voiceOf = async (lessonId, query, body = {}) => {
      const out = await run(ctl.voiceLesson, { user: admin, params: { id: String(lessonId) }, body });
      const res = await after(out, query);
      const job = res.body.lesson?.job;
      return { ...res, body: { ...res.body, made: job?.done ?? 0, error: job?.status === "failed" ? job.error : out.body.message || null } };
    };

    console.log("\nsolution video");
    const bare = await Question.create({ type: "mcq", question: "Q?", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], correctOption: "A", marks: 1, status: "published", subject: ids.subject, chapter: ids.chapter });
    let out = await run(ctl.generateLesson, { user: admin, body: { question: String(bare._id) } });
    check("no solution: asks for one first, no AI call", out.code === 400 && /no solution yet/.test(out.body.message) && !lastCall, out.body);
    const q = await Question.create({ type: "mcq", question: "Time to the top?", options: [{ key: "A", text: "2 s" }, { key: "B", text: "4 s" }], correctOption: "A", marks: 1, status: "published", subject: ids.subject, chapter: ids.chapter, solutionText: "t = u/g = 20/9.8 ≈ 2 s" });
    out = await run(ctl.generateLesson, { user: admin, body: { question: String(q._id), language: "English" } });
    check("starts in the background", out.code === 202 && out.body.lesson.job.status === "running" && out.body.lesson.job.expectSeconds > 0, out.body);
    out = await after(out, { question: String(q._id) });
    const lesson = out.body.lesson;
    check("writes a script from the given solution", out.code === 200 && lesson.segments.length === 3 && /20\/9\.8/.test(lastCall.prompt) && lastCall.feature === "video-lesson-script", out.body);
    check("…unpublished until staff look", lesson.published === false);
    check("…no image item when the question has no figure", !lesson.segments[0].board.some((b) => b.type === "image"), lesson.segments[0].board);
    check("…maths without $ signs, empty list items dropped", lesson.segments[1].board[0].latex === "v = u - gt" && lesson.segments[1].board[1].items.length === 2, lesson.segments[1].board);
    out = await run(ctl.getLesson, { user: admin, query: { question: String(q._id) } });
    check("read back by question", out.body.lesson?._id && String(out.body.lesson._id) === String(lesson._id));

    console.log("\nediting");
    const edited = lesson.segments.map((s) => ({ _id: s._id, say: s.say, board: s.board }));
    edited[2].say = "So it takes about 2 seconds to reach the top.";
    out = await run(ctl.updateLesson, { user: admin, params: { id: String(lesson._id) }, body: { title: "Ball thrown up (edited)", segments: edited, published: true } });
    check("edits and publishes", out.code === 200 && out.body.lesson.title === "Ball thrown up (edited)" && out.body.lesson.published && /reach the top/.test(out.body.lesson.segments[2].say), out.body);
    out = await run(ctl.updateLesson, { user: admin, params: { id: String(lesson._id) }, body: { segments: [{ say: "only one", board: [] }] } });
    check("an invalid script isn't saved", out.code === 400 && (await VideoLesson.findById(lesson._id)).segments.length === 3, out.body);
    out = await after(await run(ctl.generateLesson, { user: admin, body: { question: String(q._id) } }), { question: String(q._id) });
    check("a rewrite replaces the same lesson and unpublishes it", out.code === 200 && String(out.body.lesson._id) === String(lesson._id) && !out.body.lesson.published && (await VideoLesson.countDocuments({ question: q._id })) === 1);

    console.log("\ntiming, pauses and diagrams");
    {
      const { sanitizeSvg } = require("../ai/images"); // eslint-disable-line no-unused-vars
      const cur = (await VideoLesson.findById(lesson._id)).segments.map((x) => x.toObject());
      const say0 = cur[0].say;
      const segs = cur.map((x) => ({ _id: String(x._id), say: x.say, board: x.board }));
      segs[0].board = [
        { type: "heading", text: "Up", cue: "thrown up" },
        { type: "text", text: "never said", cue: "the moon is cheese" },
        { type: "math", latex: "v=u", with: true },
        { type: "pause", seconds: 45, after: "^" },
        { type: "diagram", prompt: "a ball going up", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="3" onclick="x()"/></svg>' },
      ];
      out = await run(ctl.updateLesson, { user: admin, params: { id: String(lesson._id) }, body: { segments: segs } });
      const b0 = out.body.lesson?.segments[0].board || [];
      check("a cue the narration says is kept; one it doesn't is dropped", b0[0]?.cue === "thrown up" && b0[1]?.cue === "", b0.map((x) => x.cue));
      check("\"with the item above\" is kept", b0[2]?.with === true);
      check("a pause is capped at 30 s and can go before the narration", b0[3]?.type === "pause" && b0[3].seconds === 30 && b0[3].after === "^", b0[3]);
      check("a diagram's drawing is cleaned of scripts and handlers", b0[4]?.type === "diagram" && /<circle/.test(b0[4].svg) && !/script|onclick/i.test(b0[4].svg), b0[4]?.svg);
      check("the narration itself is unchanged", out.body.lesson.segments[0].say === say0);

      // Asking AI to redo one part: the part, its neighbours and the action
      // go to the AI; a kept item comes back whole.
      const realGen = ai.generate;
      ai.generate = async (o) => { lastCall = o; return { data: { segments: [{ say: "The ball rises and slows down. At the top it stops.", board: [{ keep: 4, type: "diagram", cue: "at the top" }, { type: "text", text: "Top: $v = 0$", cue: "it stops" }] }, { say: "Then it falls back.", board: [] }] }, usage: {} }; };
      const draft = out.body.lesson.segments.map((x) => ({ _id: x._id, say: x.say, board: x.board }));
      out = await run(ctl.reviseSegment, { user: admin, params: { id: String(lesson._id) }, body: { index: 0, action: "elaborate", segments: draft } });
      const r = out.body.segments || [];
      check("redo a part with AI: replacement parts come back, nothing saved", out.code === 200 && r.length === 2 && (await VideoLesson.findById(lesson._id)).segments[0].say === say0, out.body);
      check("…the action and the next part go to the AI", /more detail/i.test(lastCall.prompt) && lastCall.prompt.includes(draft[1].say) && lastCall.prompt.includes(say0), lastCall.prompt.slice(0, 300));
      check("…a kept item comes back whole, at its new cue", r[0]?.board[0]?.type === "diagram" && /<circle/.test(r[0].board[0].svg) && r[0].board[0].cue === "at the top" && r[0].board[1].cue === "it stops", r[0]?.board);
      out = await run(ctl.reviseSegment, { user: admin, params: { id: String(lesson._id) }, body: { index: 0, action: "custom", instruction: " " } });
      check("…\"as I say\" needs an instruction", out.code === 400);

      // A script asking for a diagram gets it drawn.
      ai.generate = async (o) => {
        lastCall = o;
        if (o.feature === "ai-diagram") return { data: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500"><rect width="800" height="500" fill="#fff"/><line x1="0" y1="0" x2="9" y2="9" stroke="#111"/></svg>', caption: "Forces" }, usage: {} };
        const sc = JSON.parse(JSON.stringify(script));
        sc.segments[1].board.push({ type: "diagram", prompt: "free body diagram of the ball", cue: "minus g" });
        return { data: sc, usage: {} };
      };
      out = await after(await run(ctl.generateLesson, { user: admin, body: { question: String(q._id) } }), { question: String(q._id) });
      const dg = out.body.lesson.segments[1].board.find((x) => x.type === "diagram");
      check("a script's diagram is drawn by AI as it's written", dg && /<line/.test(dg.svg) && dg.caption === "Forces" && dg.cue === "minus g", dg);
      ai.generate = realGen;
    }

    console.log("\nvoice");
    const os = require("os");
    const path = require("path");
    process.env.STORAGE_LOCAL_PATH = require("fs").mkdtempSync(path.join(os.tmpdir(), "vl-"));
    const AiConfig = require("../models/aiConfigModel");
    const tts = require("../ai/tts");
    // Ten MPEG-1 Layer III frames, 128 kbps, 44.1 kHz: 0.26 s.
    const frame = Buffer.alloc(417); frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x00;
    const mp3 = Buffer.concat(Array.from({ length: 10 }, () => frame));
    check("MP3 length from its frames", Math.abs(tts.mp3Duration(mp3) - 0.26) < 0.01, tts.mp3Duration(mp3));
    const http = require("http");
    const seen = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
        if (/fail/.test(body)) { res.writeHead(500); res.end("boom"); return; }
        // Different bytes per text, as a real voice would give.
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end(Buffer.concat([mp3, Buffer.from(JSON.parse(body).input)]));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    let cfg = await AiConfig.get(true);
    cfg.voice.provider = "none";
    await cfg.save();
    out = await run(ctl.voiceLesson, { user: admin, params: { id: String(lesson._id) } });
    check("no voice set up: says where to set it", out.code === 400 && /Settings → AI → Voice/.test(out.body.message), out.body);
    cfg = await AiConfig.get(true);
    Object.assign(cfg.voice, { provider: "openai", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: "test-tts", voice: "teacher", voiceBangla: "teacher-bn" });
    cfg.setVoiceKey("sk-voice-1234");
    await cfg.save();
    out = await voiceOf(lesson._id, { question: String(q._id) });
    check("voices every segment through the speech server", out.code === 200 && out.body.made === 3 && out.body.lesson.segments.every((x) => x.parts?.length && x.parts.every((c) => c.audioUrl && c.durationSeconds > 0) && x.audioCurrent), out.body);
    check("…with the model, voice and key set", seen[0].url === "/v1/audio/speech" && seen[0].auth === "Bearer sk-voice-1234" && seen[0].body.model === "test-tts" && seen[0].body.voice === "teacher" && /20 metres/.test(seen[0].body.input), seen[0]);
    const n = seen.length;
    out = await voiceOf(lesson._id, { question: String(q._id) });
    check("nothing new: no calls", out.body.made === 0 && seen.length === n);
    out = await voiceOf(lesson._id, { question: String(q._id) }, { redo: true });
    check("redo voices every part again", out.body.made === 3 && seen.length === n + 3 && out.body.lesson.segments.every((x) => x.audioCurrent), out.body.made);
    check("lessons carry the board style", out.body.lesson.style?.board === "#fbfaf6" && out.body.lesson.style.logo === null, out.body.lesson.style);
    seen.length = n;
    const ed = out.body.lesson.segments.map((x) => ({ _id: x._id, say: x.say, board: x.board }));
    ed[1].say = "Use v equals u minus g times t.";
    out = await run(ctl.updateLesson, { user: admin, params: { id: String(lesson._id) }, body: { segments: ed } });
    check("edited narration needs new audio; the rest keep theirs", !out.body.lesson.segments[1].audioCurrent && out.body.lesson.segments[0].audioCurrent && out.body.lesson.segments[2].audioCurrent, out.body.lesson.segments.map((x) => x.audioCurrent));
    out = await voiceOf(lesson._id, { question: String(q._id) });
    check("…and only that one is voiced again", out.body.made === 1 && seen.length === n + 1 && /times t/.test(seen.at(-1).body.input));
    // A clip per sentence: an added sentence is voiced on its own, the
    // unchanged one keeps its clip.
    const two = out.body.lesson.segments.map((x) => ({ _id: x._id, say: x.say, board: x.board }));
    two[2].say = `${two[2].say} It then falls back down to the ground.`;
    await run(ctl.updateLesson, { user: admin, params: { id: String(lesson._id) }, body: { segments: two } });
    const before2 = seen.length;
    out = await voiceOf(lesson._id, { question: String(q._id) });
    const seg2 = out.body.lesson.segments[2];
    check("voice is a clip per sentence; only the new sentence is voiced", out.body.made === 1 && seen.length === before2 + 1 && /falls back down/.test(seen.at(-1).body.input) && seg2.parts.length === 2 && seg2.audioCurrent && seg2.parts.every((c) => c.audioUrl), { made: out.body.made, parts: seg2.parts });
    const bn = await VideoLesson.findById(lesson._id);
    bn.language = "Bangla"; bn.segments[0].say = "fail please"; await bn.save();
    out = await voiceOf(lesson._id, { question: String(q._id) });
    check("a failing call stops and says why; Bangla uses the Bangla voice", out.body.error && /answered 500/.test(out.body.error) && seen.at(-1).body.voice === "teacher-bn", { err: out.body.error, v: seen.at(-1).body.voice });
    server.close();

    // Azure (SSML) and Google (base64 JSON), against a stand-in server.
    const got = [];
    const cloud = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        got.push({ url: req.url, headers: req.headers, body });
        if (req.url.startsWith("/v1/text:synthesize")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ audioContent: mp3.toString("base64") })); return; }
        res.writeHead(200, { "Content-Type": "audio/mpeg" }); res.end(mp3);
      });
    });
    await new Promise((r) => cloud.listen(0, "127.0.0.1", r));
    const at = `http://127.0.0.1:${cloud.address().port}`;
    cfg = await AiConfig.get(true);
    Object.assign(cfg.voice, { provider: "azure", baseUrl: at, voice: "en-US-AvaMultilingualNeural", voiceBangla: "bn-BD-NabanitaNeural" });
    cfg.setVoiceKey("az-key"); await cfg.save();
    let audio = await tts.speak("Tom & Jerry <run>", { language: "Bangla" });
    check("Azure: SSML with the Bangla voice and its language, key header", audio.equals(mp3) && got[0].url === "/cognitiveservices/v1" && got[0].headers["ocp-apim-subscription-key"] === "az-key" && /xml:lang="bn-BD"/.test(got[0].body) && /name="bn-BD-NabanitaNeural"/.test(got[0].body) && /Tom &amp; Jerry &lt;run&gt;/.test(got[0].body), got[0]);
    cfg = await AiConfig.get(true);
    Object.assign(cfg.voice, { provider: "google", baseUrl: at, voice: "en-US-Wavenet-F", voiceBangla: "bn-IN-Wavenet-A" });
    cfg.setVoiceKey("g-key"); await cfg.save();
    audio = await tts.speak("Hello", { language: "English" });
    const gb = JSON.parse(got[1].body);
    check("Google: voice and language code, key header, audio decoded", audio.equals(mp3) && got[1].headers["x-goog-api-key"] === "g-key" && gb.voice.name === "en-US-Wavenet-F" && gb.voice.languageCode === "en-US" && gb.audioConfig.audioEncoding === "MP3", gb);
    await tts.speak("সমান্তরাল ভেক্টর", { language: "" });
    check("Bangla text gets the Bangla voice even with no language set", JSON.parse(got[2].body).voice.name === "bn-IN-Wavenet-A", got[2].body);
    cloud.close();

    console.log("\nboard items");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
    let up = await run(ctl.uploadImage, { user: admin, params: { id: String(lesson._id) }, headers: { "content-type": "image/png" }, body: png });
    check("a picture is uploaded for the board", up.code === 201 && up.body.media.key.endsWith(".png") && up.body.url, up.body);
    const bad2 = await run(ctl.uploadImage, { user: admin, params: { id: String(lesson._id) }, headers: { "content-type": "image/png" }, body: Buffer.from("<svg onload=alert(1)>") });
    check("…only real PNG, JPEG or WebP", bad2.code === 400);
    const cur = (await run(ctl.getLesson, { user: admin, query: { question: String(q._id) } })).body.lesson;
    const items = cur.segments.map((x) => ({ _id: x._id, say: x.say, board: x.board }));
    items[0].board = [
      { type: "image", src: "upload", media: up.body.media, caption: "Free body", size: "large", marks: [{ kind: "circle", x: 40, y: 50, x2: 48, y2: 58 }, { kind: "label", x: 150, y: -5, text: "mg" }] },
      { type: "image", src: "solution" },
      { type: "table", rows: [["Quantity", "Value"], ["u", "$20$ m/s"], ["", ""]] },
      { type: "text", text: "So ==t = 2 s==" },
    ];
    items[1].board = [{ type: "highlight", ref: "0-3" }, { type: "highlight" }];
    let res2 = await run(ctl.updateLesson, { user: admin, params: { id: String(lesson._id) }, body: { segments: items } });
    const b0 = res2.body.lesson?.segments[0].board || [];
    check("an uploaded picture keeps its caption, size and marks, with a url", res2.code === 200 && b0[0].src === "upload" && b0[0].url && b0[0].caption === "Free body" && b0[0].size === "large" && b0[0].marks.length === 2, res2.body);
    check("…marks are kept inside the picture", b0[0].marks[1].x === 100 && b0[0].marks[1].y === 0, b0[0].marks);
    check("a solution picture that doesn't exist is dropped", !b0.some((b) => b.src === "solution"), b0.map((b) => b.type));
    check("tables drop empty rows", b0[1].type === "table" && b0[1].rows.length === 2, b0[1]);
    check("a highlight needs an item to point at", res2.body.lesson.segments[1].board.length === 1 && res2.body.lesson.segments[1].board[0].ref === "0-3", res2.body.lesson.segments[1].board);
    const { spokenText: sp } = require("../utils/videoLesson");
    check("Bangla narration: Latin symbols by their names, units in full", sp("M ও T এর মান। বেগ 20 m/s।") === "এম ও টি এর মান। বেগ 20 মিটার প্রতি সেকেন্ড।", sp("M ও T এর মান। বেগ 20 m/s।"));
    check("…and maths in Bangla words", sp("দূরত্ব $s = \\sqrt{25}$", { language: "Bangla" }) === "দূরত্ব এস সমান রুট 25", sp("দূরত্ব $s = \\sqrt{25}$", { language: "Bangla" }));

    console.log("\nrecorded video");
    const exp = await run(ctl.exportLesson, { user: admin, params: { id: String(lesson._id) }, headers: { "content-type": "video/mp4" }, body: Buffer.alloc(5000, 7), query: { seconds: "27" } });
    const qAfter = await Question.findById(q._id);
    check("a recorded video is saved as the question's solution video", exp.code === 201 && String(qAfter.solutionVideo) === String(exp.body.media._id), exp.body);
    const bad = await run(ctl.exportLesson, { user: admin, params: { id: String(lesson._id) }, headers: { "content-type": "image/png" }, body: Buffer.alloc(5000) });
    check("…only video files", bad.code === 400);
    delete process.env.VIMEO_ACCESS_TOKEN;
    const noVimeo = await run(ctl.exportLesson, { user: admin, params: { id: String(lesson._id) }, headers: { "content-type": "video/mp4" }, body: Buffer.alloc(5000, 7), query: { to: "vimeo" } });
    check("…not to a video service that can't take uploads", noVimeo.code === 400, noVimeo.body);
    {
      process.env.BUNNY_LIBRARY_ID = "9"; process.env.BUNNY_SECURITY_KEY = "k";
      const realFetch = global.fetch;
      global.fetch = async (u, o = {}) => (o.method === "POST" ? new Response(JSON.stringify({ guid: "bunny-guid" }), { status: 200 }) : new Response(null, { status: 200 }));
      const toBunny = await run(ctl.exportLesson, { user: admin, params: { id: String(lesson._id) }, headers: { "content-type": "video/mp4" }, body: Buffer.alloc(5000, 7), query: { to: "bunny" } });
      global.fetch = async () => new Response("{}", { status: 500 });
      const refused = await run(ctl.exportLesson, { user: admin, params: { id: String(lesson._id) }, headers: { "content-type": "video/mp4" }, body: Buffer.alloc(5000, 7), query: { to: "bunny" } });
      global.fetch = realFetch;
      delete process.env.BUNNY_LIBRARY_ID; delete process.env.BUNNY_SECURITY_KEY;
      const sentTo = await Media.findById(toBunny.body.media?._id);
      check("…or to Bunny, when chosen", toBunny.code === 201 && sentTo?.driver === "bunny" && sentTo.key === "bunny-guid", toBunny.body);
      check("…kept in storage when the service refuses it", refused.code === 201 && refused.body.media.driver === "local" && /500/.test(refused.body.uploadError || ""), refused.body);
    }
    const vl = await VideoLesson.findById(lesson._id);
    const aud = { body: null, headers: {}, set(k, v) { this.headers[k] = v; }, send(b) { this.body = b; } };
    await new Promise((done) => ctl.segmentAudio({ params: { id: String(lesson._id), segmentId: String(vl.segments[2]._id) }, query: { clip: "0" } }, Object.assign(aud, { status() { return this; } }), done).then(done));
    check("a part's audio is served from this server for recording", Buffer.isBuffer(aud.body) && aud.headers["Content-Type"] === "audio/mpeg", aud.headers);

    console.log("\nstudents");
    const appCtl = require("../controllers/app/videoLessonController");
    const Purchase = require("../models/purchaseModel");
    const batchId = new mongoose.Types.ObjectId();
    await Question.updateOne({ _id: q._id }, { $set: { batches: [batchId] } });
    const stud = { _id: new mongoose.Types.ObjectId() };
    await VideoLesson.updateOne({ _id: lesson._id }, { $set: { published: false } });
    let sv = await run(appCtl.getQuestionLesson, { student: stud, params: { id: String(q._id) } });
    check("unpublished: students see nothing", sv.body.lesson === null);
    await VideoLesson.updateOne({ _id: lesson._id }, { $set: { published: true } });
    sv = await run(appCtl.getQuestionLesson, { student: stud, params: { id: String(q._id) } });
    check("published, but not in a batch of theirs: nothing", sv.body.lesson === null);
    await Purchase.collection.insertOne({ student: stud._id, batch: batchId, status: "complete", startDate: new Date(), plan: { label: "x", price: 0, durationDays: 30 } });
    sv = await run(appCtl.getQuestionLesson, { student: stud, params: { id: String(q._id) } });
    check("with access: the lesson, with playable audio", sv.body.lesson?.segments.length === 3 && sv.body.lesson.segments.some((x) => x.parts?.[0]?.audioUrl), sv.body);
    await Question.updateOne({ _id: q._id }, { $set: { batches: [] } });
    sv = await run(appCtl.getQuestionLesson, { student: stud, params: { id: String(q._id) } });
    check("a question with no batch list shows to any enrolled student", sv.body.lesson?.segments.length === 3);
    sv = await run(appCtl.getQuestionLesson, { student: { _id: new mongoose.Types.ObjectId() }, params: { id: String(q._id) } });
    check("…but not to one with no active batch", sv.body.lesson === null);

    console.log("\nlecture video");
    const thin = await Lecture.create({ title: "Thin", subject: ids.subject, chapter: ids.chapter, bodyMarkdown: "Short." });
    lastCall = null;
    out = await run(ctl.generateLesson, { user: admin, body: { lecture: String(thin._id) } });
    check("too little material: says so, no AI call", out.code === 400 && /Not enough material/.test(out.body.message) && !lastCall, out.body);
    out = await after(await run(ctl.generateLesson, { user: admin, body: { lecture: String(thin._id), material: "Projectile motion. ".repeat(30), minutes: 5 } }), { lecture: String(thin._id) });
    check("pasted material is enough, and the length is asked for", out.code === 200 && /about 5 minutes/.test(lastCall.system) && /Projectile motion/.test(lastCall.prompt), out.body);
    out = await run(ctl.deleteLesson, { user: admin, params: { id: String(out.body.lesson._id) } });
    check("deleted", out.code === 200 && !(await VideoLesson.findOne({ lecture: thin._id })));

    console.log("\nstored video files");
    const { shape } = require("../controllers/admin/mediaController");
    const fileVideo = await Media.create({ title: "Export", kind: "video", driver: "local", key: "video-lessons/0123456789abcdef0123456789abcdef.mp4", mimeType: "video/mp4" });
    const shaped = await shape(fileVideo);
    const { readLink } = require("../utils/streamLink");
    check("a video file in storage gets an expiring link that hides its address",
      shaped.file === true && /^\/api\/stream\//.test(shaped.url) && !shaped.url.includes("video-lessons") && readLink(shaped.url.split("/").pop())?.key === fileVideo.key, shaped);
    const linked = await shape(await Media.create({ title: "YT", kind: "video", driver: "youtube", key: "dQw4w9WgXcQ" }));
    check("a hosted video still embeds", !linked.file && /youtube/.test(linked.url || ""), linked);

    await mongoose.disconnect();
  }
  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  console.log(failed ? "FAIL" : "PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
