// Document chat: text utilities, ranking, quote checking and answer
// labelling offline; indexing and access-scoped retrieval against a real
// MongoDB-compatible server when TEST_MONGO_URL is set.

process.env.NODE_ENV = "test";

const path = require("path");
const os = require("os");
const fs = require("fs");
const docText = require("../utils/docText");
const { verifyAnswer, searchQuery, NOT_COVERED } = require("../controllers/app/docChatController");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

(async () => {
  console.log("\nsearch terms");
  check("English plurals meet their singular", docText.terms("forces")[0] === docText.terms("force")[0]);
  check("Bangla case endings meet the bare word", docText.terms("বলের")[0] === docText.terms("বল")[0]);
  check("question words are dropped", !docText.terms("What is the unit of force?").includes("what"));
  check("Bangla digits are kept", docText.terms("১০ নিউটন").length === 2, docText.terms("১০ নিউটন"));

  console.log("\nsplitting");
  const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} explains a small idea about motion. `).join("");
  const pieces = docText.splitText(long);
  check("long text is cut into pieces", pieces.length > 1, pieces.length);
  check("no piece is far over the size", pieces.every((p) => p.length <= docText.CHUNK_CHARS + 50));
  check("pieces overlap, so a cut sentence is whole somewhere", pieces[1].includes(pieces[0].slice(-120, -60)));
  const sections = docText.splitNotes("Intro line\n# Newton's laws\nF = ma\n## Friction\nOpposes motion");
  check("notes split at headings, keeping them as labels", sections.map((s) => s.heading).join("|") === "Notes|Newton's laws|Friction", sections);

  console.log("\nranking");
  const docs = [
    { terms: docText.terms("Friction opposes motion between surfaces in contact") },
    { terms: docText.terms("Newton's second law: force equals mass times acceleration") },
    { terms: docText.terms("The unit of force is the newton") },
  ];
  const scores = docText.bm25(docText.terms("What is the unit of force?"), docs);
  check("the passage that answers ranks first", scores.indexOf(Math.max(...scores)) === 2, scores);
  check("fusion rewards agreement between rankings", docText.fuse([["a", "b", "c"], ["b", "a", "d"]])[0] === "a" || docText.fuse([["a", "b", "c"], ["b", "a", "d"]])[0] === "b");
  check("cosine of a vector with itself is 1", Math.abs(docText.cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);

  console.log("\nquote checking");
  const source = "Newton's second law states that $F = ma$, where m is the mass of the body and a its acceleration.";
  check("an exact quote holds", docText.quoteIn("F = ma, where m is the mass of the body", source));
  check("spacing and LaTeX differences don't matter", docText.quoteIn("F=ma,  where m is the mass", source));
  check("a shortened quote with … holds when every part is there", docText.quoteIn("Newton's second law states … the mass of the body", source));
  check("an invented quote fails", !docText.quoteIn("where m is the weight of the body", source));
  check("a two-word quote is too short to prove anything", !docText.quoteIn("second law", source));
  check("Bangla quotes hold", docText.quoteIn("বল হলো ভর ও ত্বরণের গুণফল", "নিউটনের দ্বিতীয় সূত্র অনুযায়ী বল হলো ভর ও ত্বরণের গুণফল।"));

  console.log("\nanswer labelling");
  const excerpts = [{ chunk: { text: source, lecture: "L1", source: { kind: "notes", title: "Newton" }, page: null } }];
  let r = verifyAnswer({ answer: "F = ma.", foundInDocuments: true, citations: [{ excerpt: 1, quote: "F = ma, where m is the mass of the body" }] }, excerpts, { allowGeneral: true });
  check("a supported answer is marked as from the documents", r.found && r.citations.length === 1, r);
  r = verifyAnswer({ answer: "F = ma.", foundInDocuments: true, citations: [{ excerpt: 1, quote: "force is the rate of change of momentum" }] }, excerpts, { allowGeneral: true });
  check("an answer whose quotes don't hold is never shown as the course's", !r.found && r.general, r);
  r = verifyAnswer({ answer: "F = ma.", foundInDocuments: true, citations: [{ excerpt: 7, quote: "F = ma, where m is the mass" }] }, excerpts, { allowGeneral: false });
  check("…and with general answers off it becomes 'not covered'", !r.found && r.text === NOT_COVERED, r);
  r = verifyAnswer({ answer: "Photosynthesis makes glucose.", foundInDocuments: false, citations: [] }, excerpts, { allowGeneral: true });
  check("not covered + general allowed: a labelled general answer", !r.found && r.general && r.text.includes("glucose"), r);
  r = verifyAnswer({ answer: "Photosynthesis makes glucose.", foundInDocuments: false, citations: [] }, excerpts, { allowGeneral: false });
  check("not covered + general off: only 'not covered'", !r.found && !r.general && r.text === NOT_COVERED, r);

  console.log("\nfollow-up questions");
  const history = [{ role: "student", text: "What is Newton's second law of motion?" }, { role: "assistant", text: "F = ma" }];
  check("a short follow-up searches with the previous question", searchQuery("why?", history).includes("second law"));
  check("a full question searches on its own", searchQuery("What is the SI unit of acceleration in physics?", history) === "What is the SI unit of acceleration in physics?");

  if (process.env.TEST_MONGO_URL) {
    console.log("\nindexing and access (database)");
    const mongoose = require("mongoose");
    const uploads = fs.mkdtempSync(path.join(os.tmpdir(), "docchat-"));
    process.env.STORAGE_LOCAL_PATH = uploads;
    await mongoose.connect(process.env.TEST_MONGO_URL);
    const Lecture = require("../models/lectureModel");
    const Media = require("../models/mediaModel");
    const DocChunk = require("../models/docChunkModel");
    const AiConfig = require("../models/aiConfigModel");
    const { indexLecture } = require("../utils/docIndex");
    const { retrieve } = require("../utils/docRetrieve");
    await Promise.all([Lecture.deleteMany({}), Media.deleteMany({}), DocChunk.deleteMany({}), AiConfig.deleteMany({})]);

    const pdf = process.env.TEST_DOC_PDF;
    const batch = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    const ids = { subject: new mongoose.Types.ObjectId(), chapter: new mongoose.Types.ObjectId() };

    const attachments = [];
    if (pdf && fs.existsSync(pdf)) {
      fs.writeFileSync(path.join(uploads, "test.pdf"), fs.readFileSync(pdf));
      attachments.push((await Media.create({ title: "Worksheet.pdf", kind: "pdf", driver: "local", key: "test.pdf", mimeType: "application/pdf" }))._id);
    }
    const physics = await Lecture.create({
      ...ids,
      title: "Forces",
      bodyMarkdown: "# Newton's second law\nThe net force on a body equals its mass times its acceleration, F = ma.\n\n# বল\nবল হলো ভর ও ত্বরণের গুণফল। বলের একক নিউটন।",
      attachments,
      batches: [batch],
      isPublished: true,
    });
    const hidden = await Lecture.create({ ...ids, title: "Draft", bodyMarkdown: "# Secret\nThe answer key for tomorrow's exam is B.", batches: [batch], isPublished: false });
    const elsewhere = await Lecture.create({ ...ids, title: "Other batch", bodyMarkdown: "# Optics\nLight bends when it enters glass: refraction.", batches: [other], isPublished: true });
    await Promise.all([physics, hidden, elsewhere].map((l) => indexLecture(l._id)));

    const fresh = await Lecture.findById(physics._id);
    check("the lecture's index is ready", fresh.docIndex.status === "ready" && fresh.docIndex.chunks > 0, fresh.docIndex);
    if (attachments.length) {
      check("a scanned page with no text is listed for reading", (fresh.docIndex.pendingScans[0]?.pages || []).length > 0, fresh.docIndex.pendingScans);
      const filePieces = await DocChunk.countDocuments({ lecture: physics._id, "source.kind": "file", page: { $ne: null } });
      check("the file's text pages are indexed with their page numbers", filePieces > 0, filePieces);
    }

    // What "Ask your course" may search: published lectures of this batch.
    const allowed = (await Lecture.find({ batches: batch, isPublished: true }).select("_id")).map((l) => l._id);
    let found = await retrieve({ lectureIds: allowed, query: "What is the unit of force?" });
    check("the answer's piece is found", found.chunks.some((c) => /নিউটন|newton/i.test(c.text)), found.chunks.map((c) => c.text.slice(0, 40)));
    found = await retrieve({ lectureIds: allowed, query: "answer key for tomorrow's exam" });
    check("an unpublished lecture is never searched", !found.chunks.some((c) => /answer key/.test(c.text)));
    found = await retrieve({ lectureIds: allowed, query: "refraction light glass" });
    check("another batch's lecture is never searched", !found.chunks.some((c) => /refraction/.test(c.text)));
    found = await retrieve({ lectureIds: [physics._id], query: "anything", wholeLecture: true });
    check("a small lecture is sent whole", found.whole && found.chunks.length === fresh.docIndex.chunks);

    // The whole ask flow, with the AI stubbed: what the model sees, what
    // the student gets back, what is saved.
    const aiService = require("../ai/service");
    const ChatThread = require("../models/chatThreadModel");
    await AiConfig.updateOne({ singleton: "ai" }, { $set: { "features.docChat": true } }, { upsert: true });
    AiConfig.clearCache?.();
    let seenPrompt = "";
    let reply = null;
    aiService.embed = async () => null;
    aiService.generate = async ({ prompt }) => {
      seenPrompt = prompt;
      return { data: typeof reply === "function" ? reply(prompt) : reply };
    };
    // The number of the excerpt that holds `text`, as the model would see it.
    const excerptWith = (prompt, text) => {
      const parts = prompt.split(/\n(?=\[\d+\] )/);
      const hit = parts.find((p) => p.includes(text));
      return hit ? Number(hit.match(/^\[(\d+)\]/)?.[1]) : 0;
    };
    const { ask } = require("../controllers/app/docChatController");
    const call = async (body) => {
      const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      const req = { body, student: { _id: new mongoose.Types.ObjectId() }, batch: { _id: batch }, protocol: "http", get: () => "localhost" };
      req.student._id = call.student || (call.student = req.student._id);
      await new Promise((resolve) => ask(req, res, (err) => { if (err) { res.code = res.code === 200 ? 500 : res.code; res.body = { message: err.message }; } resolve(); }).then(resolve));
      return res;
    };
    const quote = "বল হলো ভর ও ত্বরণের গুণফল";
    // A quote pinned to the wrong excerpt is not trusted.
    reply = (prompt) => ({ answer: "Its unit is the newton.", foundInDocuments: true, citations: [{ excerpt: excerptWith(prompt, quote) + 1, quote }] });
    let out = await call({ message: "What is the unit of force?", lectureId: String(physics._id) });
    check("a quote cited against the wrong excerpt is not trusted", out.body?.message?.foundInDocuments === false, out.body?.message);
    await ChatThread.deleteMany({});

    reply = (prompt) => ({ answer: "Its unit is the newton.", foundInDocuments: true, citations: [{ excerpt: excerptWith(prompt, quote), quote }] });
    out = await call({ message: "What is the unit of force?", lectureId: String(physics._id) });
    check("the model is shown the lecture's material", seenPrompt.includes(quote), seenPrompt.slice(0, 200));
    check("the model never sees an unpublished lecture", !/answer key/.test(seenPrompt));
    check("a real quote makes it an answer from the documents, with its source", out.body?.message?.foundInDocuments === true && out.body.message.citations[0]?.kind === "notes", out.body?.message);
    check("the answer is saved in a thread", out.code === 200 && out.body.threadId && (await ChatThread.countDocuments()) === 1, out.body);

    reply = { answer: "Photosynthesis makes glucose.", foundInDocuments: false, citations: [] };
    out = await call({ message: "What does photosynthesis make?", threadId: String(out.body.threadId) });
    check("an uncovered question gets a labelled general answer", out.body.message.foundInDocuments === false && out.body.message.generalAnswer === true, out.body.message);
    const thread = await ChatThread.findOne();
    check("follow-ups continue the same thread, and misses are counted", thread.messages.length === 4 && thread.unanswered === 1, { n: thread.messages.length, u: thread.unanswered });

    out = await call({ message: "anything", lectureId: String(elsewhere._id) });
    check("a lecture from another batch can't be asked", out.code === 404, out);
    out = await call({ message: "anything", lectureId: String(hidden._id) });
    check("an unpublished lecture can't be asked", out.code === 404, out);

    // Extra questions for credits.
    const { unlockPack } = require("../controllers/app/docChatController");
    const AiCredit = require("../models/aiCreditModel");
    const DocChatPack = require("../models/docChatPackModel");
    await AiConfig.updateOne({ singleton: "ai" }, { $set: { "docChat.dailyMessages": 1, "docChat.packSize": 3, "docChat.packCost": 2 } });
    AiConfig.clearCache?.();
    await DocChatPack.deleteMany({});
    await AiCredit.create({ student: call.student, batch, balance: 5 });
    let lastPrepaid = null;
    const packStub = async ({ prepaid }) => {
      lastPrepaid = prepaid;
      return { data: { answer: "x", foundInDocuments: false, citations: [] } };
    };
    aiService.generate = packStub;
    const unlock = async () => {
      const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await new Promise((resolve) => unlockPack({ student: { _id: call.student }, batch: { _id: batch }, body: {} }, res, resolve).then(resolve));
      return res;
    };
    out = await call({ message: "first free question today" });
    check("the day's free question costs no allowance or credit", out.code === 200 && lastPrepaid === true, { code: out.code, lastPrepaid });
    out = await call({ message: "second question today" });
    check("past the free questions, the student is offered a pack", out.code === 429 && out.body.offer?.packSize === 3 && out.body.offer?.packCost === 2, out.body);
    let u = await unlock();
    check("unlocking takes the pack's credits and adds its questions", u.code === 200 && u.body.remaining === 3 && (await AiCredit.findOne({ student: call.student, batch })).balance === 3, u.body);
    out = await call({ message: "second question today" });
    check("a pack question is answered without charging again", out.code === 200 && lastPrepaid === true, { code: out.code, lastPrepaid });
    check("…and uses one pack question", (await DocChatPack.findOne({ student: call.student, batch })).remaining === 2);
    aiService.generate = async () => { throw new Error("provider down"); };
    out = await call({ message: "question when the AI fails" });
    check("a failed answer gives the pack question back", (await DocChatPack.findOne({ student: call.student, batch })).remaining === 2, out.body);
    aiService.generate = packStub;
    u = await unlock();
    check("a second pack can be bought while credits last", u.code === 200 && u.body.remaining === 5, u.body);
    u = await unlock();
    check("without enough credits, unlocking is refused and nothing changes", u.code === 402 && (await DocChatPack.findOne({ student: call.student, batch })).remaining === 5 && (await AiCredit.findOne({ student: call.student, batch })).balance === 1, u.body);

    // Without carry-over (the default), yesterday's unlocked questions are gone.
    const { getChatSettings } = require("../controllers/app/docChatController");
    const settingsNow = async () => {
      const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      await new Promise((resolve) => getChatSettings({ student: { _id: call.student }, batch: { _id: batch } }, res, resolve).then(resolve));
      return res.body;
    };
    let st = await settingsNow();
    check("available today counts free and unlocked questions", st.availableToday === 5 && st.packRemaining === 5, st);
    check("the settings show the student's credit balance", st.credits?.batch === 1 && st.credits?.general === 0, st.credits);
    await DocChatPack.updateOne({ student: call.student, batch }, { $set: { packDay: "2000-01-01", day: "2000-01-01" } });
    st = await settingsNow();
    check("without carry-over, yesterday's unlocked questions don't count", st.packRemaining === 0 && st.availableToday === 1, st);
    await call({ message: "free question on a new day" });
    out = await call({ message: "past the free one on a new day" });
    check("…and can't be used", out.code === 429, out.body);
    await AiCredit.updateOne({ student: call.student, batch }, { $set: { balance: 2 } });
    u = await unlock();
    check("a new day's pack starts from its own size", u.code === 200 && u.body.remaining === 3, u.body);
    await AiCredit.updateOne({ student: call.student, batch }, { $set: { balance: 1 } });
    await AiCredit.create({ student: call.student, balance: 4 });
    u = await unlock();
    const split = await AiCredit.find({ student: call.student }).lean();
    check("a pack can be paid from batch and general credits together", u.code === 200 && u.body.paidFrom === "both" && split.find((c) => c.batch)?.balance === 0 && split.find((c) => !c.batch)?.balance === 3, { body: u.body, split });
    await DocChatPack.updateOne({ student: call.student, batch }, { $set: { remaining: 3 } });
    await AiConfig.updateOne({ singleton: "ai" }, { $set: { "docChat.packCarryOver": true } });
    AiConfig.clearCache?.();
    await DocChatPack.updateOne({ student: call.student, batch }, { $set: { packDay: "2000-01-01" } });
    st = await settingsNow();
    check("with carry-over, unlocked questions last past their day", st.packRemaining === 3, st);
    out = await call({ message: "carried-over question" });
    check("…and can be used", out.code === 200 && (await DocChatPack.findOne({ student: call.student, batch })).remaining === 2, out.body);
    await AiConfig.updateOne({ singleton: "ai" }, { $set: { "docChat.dailyMessages": 0 } });
    AiConfig.clearCache?.();
    out = await call({ message: "no daily limit" });
    check("with no daily limit, answers are charged like any AI call", out.code === 200 && lastPrepaid === false, { code: out.code, lastPrepaid });

    // A question with a photo: read first, searched and answered from its
    // text, and counted as two.
    const StudentUpload = require("../models/studentUploadModel");
    await StudentUpload.create({ key: "chat-images/abc.png", student: call.student, folder: "chat-images" });
    await AiConfig.updateOne({ singleton: "ai" }, { $set: { "docChat.dailyMessages": 3 } });
    AiConfig.clearCache?.();
    await DocChatPack.updateOne({ student: call.student, batch }, { $set: { day: "2000-01-01", usedToday: 0, remaining: 0 } });
    const realComplete = aiService.complete;
    let visionCall = null;
    let answerPrompt = "";
    aiService.complete = async (args) => { visionCall = args; return { text: "Find the tension in the string. Diagram: a 2 kg block hanging" }; };
    aiService.generate = async ({ prompt }) => { answerPrompt = prompt; return { data: { answer: "x", foundInDocuments: false, citations: [] } }; };
    out = await call({ message: "", image: "/media/chat-images/abc.png" });
    check("a photo is read with vision before answering", out.code === 200 && Boolean(visionCall?.imageUrl) && visionCall.prepaid === true, out.body);
    check("…and its text reaches the answer", /tension in the string/.test(answerPrompt));
    const photoThread = await ChatThread.findById(out.body.threadId).lean();
    check("…and the photo is kept on the student's message", photoThread.messages[0].image === "/media/chat-images/abc.png");
    check("…and it counts as two questions", (await DocChatPack.findOne({ student: call.student, batch })).usedToday === 2);
    out = await call({ message: "one more", image: "/media/chat-images/abc.png" });
    check("a photo question with one question left is refused", out.code === 429, out.body);
    out = await call({ message: "someone else's photo", image: "/media/chat-images/other.png" });
    check("a photo the student didn't upload is refused", out.code === 400 || out.code === 500, out.body);
    aiService.complete = realComplete;

    physics.bodyMarkdown = "# Friction\nFriction opposes motion.";
    await physics.save();
    await new Promise((r) => setTimeout(r, 50));
    await indexLecture(physics._id);
    const afterEdit = await DocChunk.find({ lecture: physics._id, "source.kind": "notes" });
    check("editing the notes rebuilds the index", afterEdit.length === 1 && /Friction/.test(afterEdit[0].text), afterEdit.map((c) => c.text));

    await mongoose.disconnect();
    fs.rmSync(uploads, { recursive: true, force: true });
  } else {
    console.log("\ndatabase: skipped (set TEST_MONGO_URL to run)");
  }

  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? "PASS" : "FAIL");
  process.exit(failed === 0 ? 0 : 1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
