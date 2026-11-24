// Answer photos as the grader sees them: upright, a sensible size, several
// stitched into one page, and a prompt that reads every column first.
const sharp = require("sharp");
const { preparePhoto, stitchImages } = require("../utils/photo");
const { gradeWrittenPractice, gradeWritten } = require("../ai/prompts");
const { gradedAnswer } = require("../ai/schemas");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

(async () => {
  // A 3000x1200 photo the camera tagged "rotate 90° to view" (EXIF 6).
  const raw = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: "#fff" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const out = await preparePhoto({ buffer: raw, mimetype: "image/jpeg", size: raw.length });
  const meta = await sharp(out.buffer).metadata();
  check("turned upright from the camera's tag, then shrunk", meta.width === 800 && meta.height === 2000 && !meta.orientation, { w: meta.width, h: meta.height, o: meta.orientation });
  check("the size field follows the new file", out.size === out.buffer.length && out.size < raw.length);

  const small = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#eee" } }).png().toBuffer();
  const keptPng = await preparePhoto({ buffer: small, mimetype: "image/png", size: small.length });
  const pm = await sharp(keptPng.buffer).metadata();
  check("a small photo isn't enlarged and keeps its format", pm.width === 600 && pm.format === "png");
  const gif = { buffer: Buffer.from("GIF89a"), mimetype: "image/gif", size: 6 };
  check("formats it doesn't handle pass through untouched", (await preparePhoto(gif)) === gif);
  const broken = { buffer: Buffer.from("not an image"), mimetype: "image/jpeg", size: 12 };
  check("an unreadable photo is stored as it came", (await preparePhoto(broken)) === broken);

  const a = (await sharp({ create: { width: 1000, height: 700, channels: 3, background: "#f00" } }).jpeg().toBuffer()).toString("base64");
  const b = (await sharp({ create: { width: 1400, height: 900, channels: 3, background: "#00f" } }).png().toBuffer()).toString("base64");
  const one = await stitchImages([{ base64: a, mimeType: "image/jpeg" }, { base64: b, mimeType: "image/png" }]);
  const sm = await sharp(Buffer.from(one.base64, "base64")).metadata();
  check("several photos become one page, stacked in order", one.mimeType === "image/jpeg" && sm.width === 1400 && sm.height === 700 + 24 + 900, { w: sm.width, h: sm.height });
  const top = await sharp(Buffer.from(one.base64, "base64")).extract({ left: 10, top: 10, width: 1, height: 1 }).raw().toBuffer();
  check("…the first photo on top", top[0] > 200 && top[2] < 60, [...top]);
  const single = { base64: a, mimeType: "image/jpeg" };
  check("one photo goes as it is", (await stitchImages([single])) === single);

  const base = { question: "Find u", rubric: [{ criterion: "Finds u", marks: 2 }], modelAnswer: "", studentAnswer: "(see photo)", totalMarks: 2 };
  const withPhotos = gradeWrittenPractice({ ...base, images: 2 }).prompt;
  check("with photos the grader is told to read every column, any rotation, every photo", /two or more columns/.test(withPhotos) && /rotated/.test(withPhotos) && /2 photos, stacked/.test(withPhotos) && /"transcript"/.test(withPhotos));
  const noPhotos = gradeWrittenPractice(base).prompt;
  check("typed-only answers keep the old prompt", !/transcript/.test(noPhotos) && !/columns/.test(noPhotos));
  check("the exam grader gets the same reading rules", /two or more columns/.test(gradeWritten({ ...base, images: 1 }).prompt));
  check("the schema takes the transcript and still works without it", gradedAnswer.safeParse({ transcript: "4u = 60", marks: 2, reasoning: "ok", confidence: 0.9 }).success && gradedAnswer.safeParse({ marks: 2, reasoning: "ok", confidence: 0.9 }).success);

  if (!process.env.TEST_MONGO_URL) {
    console.log("database: skipped (set TEST_MONGO_URL to run)");
  } else {
    // Through the AI service: two stored photos reach the model as one
    // image, and the transcript comes back.
    const http = require("http");
    const os = require("os");
    const path = require("path");
    const fs = require("fs");
    const mongoose = require("mongoose");
    process.env.STORAGE_PROVIDER = "local";
    process.env.STORAGE_LOCAL_PATH = fs.mkdtempSync(path.join(os.tmpdir(), "answer-photos-"));
    await mongoose.connect(process.env.TEST_MONGO_URL);
    if (/test/.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
    const AiConfig = require("../models/aiConfigModel");
    const storage = require("../adapters/storage");
    const ai = require("../ai/service");
    let seen = null;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const j = JSON.parse(body);
        const parts = j.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
        seen = { images: parts.filter((x) => x.type === "image_url").map((x) => x.image_url.url), prompt: JSON.stringify(j.messages) };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ transcript: "a = F/m = 5\\n100 = 4u + 40 \u21d2 u = 15", marks: 2, reasoning: "Right.", confidence: 0.9 }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
      });
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    await AiConfig.get();
    await AiConfig.updateOne({}, { $set: { provider: "custom", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: "small-vision", "limits.dailyCostCapUsd": 0 } });
    const p1 = await storage.store("answer-images", { buffer: Buffer.from(a, "base64"), mimetype: "image/jpeg", size: 1 });
    const p2 = await storage.store("answer-images", { buffer: Buffer.from(b, "base64"), mimetype: "image/png", size: 1 });
    const urls = [await storage.urlFor(p1.key), await storage.urlFor(p2.key)].map((u) => `http://localhost:5000${u}`);
    const { data } = await ai.generate({ feature: "practice-grade-written", schema: gradedAnswer, imageUrls: urls, ...gradeWrittenPractice({ ...base, images: 2 }) });
    const sent = seen?.images || [];
    const dims = sent.length ? await sharp(Buffer.from(sent[0].split(",")[1], "base64")).metadata() : {};
    check("both photos reach the model, as one stacked image", sent.length === 1 && dims.height === 700 + 24 + 900, { n: sent.length, h: dims.height });
    check("the transcript comes back with the mark", /u = 15/.test(data.transcript) && data.marks === 2, data);
    // Batch practice: a graded written answer also returns the printed
    // solution, as the archive's does.
    const { Question } = require("../models/questionModel");
    const Student = require("../models/studentModel");
    const practiceCtl = require("../controllers/app/practiceController");
    const batchId = new mongoose.Types.ObjectId();
    const subjectId = new mongoose.Types.ObjectId();
    const q = await Question.create({ type: "written", question: "Find u", marks: 2, rubric: [{ criterion: "Finds u", marks: 2 }], modelAnswer: "u = 15", solutionText: "100 = 4u + 40, so u = 15 m/s.", status: "published", batches: [batchId], subject: subjectId, chapter: new mongoose.Types.ObjectId() });
    const st = await Student.create({ name: "Photo Tester", email: `photo${Date.now()}@t.io`, password: "x".repeat(12) });
    // The local test database lacks an operator the student allowance check
    // uses; the AI call itself was covered above.
    const realGenerate = ai.generate;
    ai.generate = async () => ({ data: { marks: 2, reasoning: "Right.", confidence: 0.9, criteriaMet: [{ criterion: "Finds u", met: true, marksAwarded: 2 }] }, usage: {} });
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await new Promise((resolve) => {
      Promise.resolve(practiceCtl.gradeWrittenAttempt({ student: st, batch: { _id: batchId, subjects: [subjectId], features: {} }, body: { questionId: String(q._id), answerText: "u = 15" }, params: { batchId: String(batchId) }, get: () => "localhost", protocol: "http" }, res, (e) => { if (e) res.body = { message: e.message }; resolve(); })).then(resolve);
    });
    ai.generate = realGenerate;
    check("practice grading returns the printed solution with the mark", res.body?.marks === 2 && /u = 15 m\/s/.test(res.body?.solutionText || ""), res.body);
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exit(1); }
  console.log("PASS");
})();
