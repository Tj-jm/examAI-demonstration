// Short AI videos students ask for (controllers/app/studentVideoController.js):
// made from the lecture and the part they were watching, voiced a clip per
// sentence in the background, only theirs, an off-topic ask declined, a daily
// count, and the Settings → AI switch. AI and voice are stubbed.
// Needs TEST_MONGO_URL (a throwaway database).

process.env.NODE_ENV = "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const run = (fn, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  fn({ query: {}, params: {}, body: {}, ...req }, res, (e) => resolve({ code: res.code >= 400 ? res.code : 500, err: e?.message }));
});

(async () => {
  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, skipped."); process.exit(0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|video/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const Batch = require("../models/batchModel");
  const Lecture = require("../models/lectureModel");
  const Student = require("../models/studentModel");
  const VideoLesson = require("../models/videoLessonModel");
  const AiConfig = require("../models/aiConfigModel");
  const aiService = require("../ai/service");
  const tts = require("../ai/tts");
  const storage = require("../adapters/storage");
  const ctl = require("../controllers/app/studentVideoController");
  const { settled } = require("../controllers/admin/videoLessonController");

  let reply;
  let lastPrompt = "";
  let lastFeature = "";
  aiService.generate = async (args) => { lastPrompt = args.prompt; lastFeature = args.feature; return { data: reply, usage: { model: "stub" } }; };
  let spoken = 0;
  tts.status = async () => ({ ready: true });
  tts.speak = async () => { spoken += 1; return Buffer.from([0xff, 0xfb, 0x90, 0x00]); };
  tts.mp3Duration = () => 1.5;
  storage.storeGenerated = async () => ({ key: `video-lessons/${new mongoose.Types.ObjectId()}.mp3`, driver: "local" });

  const config = await AiConfig.get();
  config.features.studentVideos = true;
  config.studentVideos.dailyPerStudent = 2;
  config.studentVideos.maxParts = 2;
  await config.save();

  const batch = await Batch.create({ name: "Class 10", accessType: "free", program: new mongoose.Types.ObjectId(), features: { aiAssist: true, studentVideos: true } });
  const other = await Batch.create({ name: "Other", accessType: "free", program: new mongoose.Types.ObjectId(), features: { aiAssist: true, studentVideos: true } });
  const subject = await require("../models/subjectModel").create({ title: "Maths" });
  const chapter = await require("../models/chapterModel").create({ title: "Triangles", subject: subject._id });
  const lecture = await Lecture.create({ subject: subject._id, chapter: chapter._id, title: "Pythagoras", bodyMarkdown: "In a right triangle, $a^2 + b^2 = c^2$. Proof: arrange four copies of the triangle in a square of side a + b; the inner square has area c^2, so (a+b)^2 = c^2 + 2ab, and a^2 + b^2 = c^2.", batches: [batch._id], isPublished: true });
  await VideoLesson.create({ kind: "lecture", lecture: lecture._id, published: true, title: "Pythagoras", segments: [{ say: "Here is the theorem.", board: [] }, { say: "Now the proof with four triangles.", board: [{ type: "math", latex: "(a+b)^2 = c^2 + 2ab" }] }] });
  const sam = await Student.create({ name: "Sam", email: "sam@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const ali = await Student.create({ name: "Ali", email: "ali@example.com", password: "Passw0rd!x", isProfileComplete: true });
  const as = (student, extra) => ({ student, batch, ...extra });

  console.log("asking for a video");
  reply = { onTopic: true, title: "The proof, slowly", segments: [
    { say: "Draw a square with side a plus b. Put four triangles inside it.", board: [{ type: "heading", text: "Four triangles" }, { type: "diagram", prompt: "square" }, { type: "image", src: "question" }] },
    { say: "The big square's area is a plus b squared. It is also c squared plus four triangles.", board: [{ type: "math", latex: "(a+b)^2 = c^2 + 2ab" }] },
    { say: "A third part that is over the limit.", board: [] },
  ] };
  let out = await run(ctl.requestVideo, as(sam, { body: { lecture: String(lecture._id), segment: 1, ask: "please elaborate the proof" } }));
  check("made, billed as student-video", out.code === 201 && lastFeature === "student-video", out);
  check("the prompt has the lecture, the part they watched and their ask", /four copies of the triangle/.test(lastPrompt) && /Now the proof with four triangles/.test(lastPrompt) && /please elaborate the proof/.test(lastPrompt));
  const v = out.body.video;
  check("cut to the parts allowed; no pictures or drawings", v.segments.length === 2 && v.segments.every((sg) => sg.board.every((b) => !["image", "diagram"].includes(b.type))), v.segments);
  check("voice being made in the background", v.job.status === "running", v.job);
  await settled();
  out = await run(ctl.getVideo, as(sam, { params: { id: String(v._id) } }));
  check("…then a clip per sentence", out.body.video.job.status === "done" && spoken === 4 && out.body.video.segments.every((sg) => sg.parts?.length === 2 && sg.parts[0].audioUrl), { spoken, job: out.body.video.job });

  out = await run(ctl.getVideo, as(ali, { params: { id: String(v._id) } }));
  check("another student can't see it", out.code === 404, out);
  out = await run(ctl.listVideos, as(sam, { query: { lecture: String(lecture._id) } }));
  check("listed for that lecture, with what's left today", out.body.videos.length === 1 && out.body.leftToday === 1, out.body);

  console.log("\nrefusals");
  reply = { onTopic: false, title: "x", segments: [{ say: "Sure, here's football.", board: [] }] };
  out = await run(ctl.requestVideo, as(sam, { body: { lecture: String(lecture._id), ask: "tell me about football" } }));
  check("off-topic: said in words (422), no video kept", out.code === 422 && /isn't about this lesson/.test(out.err || out.body?.message || "") && (await VideoLesson.countDocuments({ kind: "student", student: sam._id })) === 1, out);
  out = await run(ctl.listVideos, as(sam, { query: { lecture: String(lecture._id) } }));
  check("…and not counted for today", out.body.videos.length === 1 && out.body.leftToday === 1, out.body);
  reply = { onTopic: true, title: "Recap", segments: [{ say: "The theorem in one line.", board: [] }] };
  out = await run(ctl.requestVideo, as(sam, { body: { lecture: String(lecture._id), ask: "summarise this lecture" } }));
  check("a summary is made", out.code === 201, out);
  await settled();
  out = await run(ctl.requestVideo, as(sam, { body: { lecture: String(lecture._id), ask: "again" } }));
  check("daily count reached: refused (403)", out.code === 403, out);
  out = await run(ctl.requestVideo, { student: ali, batch: other, body: { lecture: String(lecture._id), ask: "proof" } });
  check("a lecture from another batch: not found", out.code === 404, out);
  out = await run(ctl.requestVideo, as(ali, { body: { lecture: String(lecture._id), ask: "" } }));
  check("nothing asked: refused", out.code === 400, out);

  out = await run(ctl.deleteVideo, as(sam, { params: { id: String(v._id) } }));
  check("their own video can be deleted", out.code === 200 && !(await VideoLesson.exists({ _id: v._id })), out);

  config.features.studentVideos = false;
  await config.save();
  out = await run(ctl.requestVideo, as(ali, { body: { lecture: String(lecture._id), ask: "proof" } }));
  check("Settings → AI switch off: refused", out.code === 403, out);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
