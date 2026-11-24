// The in-app classroom (live class provider "LiveKit"): who gets what pass,
// when. Passes are checked by decoding them; no LiveKit server is needed.
// Database parts run against a MongoDB-compatible server (TEST_MONGO_URL).

process.env.NODE_ENV = "test";
process.env.LIVEKIT_URL = "ws://127.0.0.1:7880";
process.env.LIVEKIT_API_KEY = "devkey";
process.env.LIVEKIT_API_SECRET = "secret-for-tests-0123456789-0123456789";

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

// Runs an express-async-handler controller with a fake req/res.
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
  console.log("provider");
  const adapter = require("../adapters/liveClass");
  const lk = adapter.get("livekit");
  check("listed and set up from the environment", adapter.list().some((p) => p.name === "livekit" && p.configured));
  const meeting = await lk.createMeeting({});
  check("a class gets its own room name, no link", /^examai-[0-9a-f]{18}$/.test(meeting.externalId) && meeting.joinUrl === null);
  const hostPass = claims((await lk.joinToken({ room: "r1", identity: "staff:1", name: "T", host: true })).token);
  check("a host pass can run the room and publish", hostPass.video.roomAdmin === true && hostPass.video.canPublish === true && hostPass.video.room === "r1");
  const audience = claims((await lk.joinToken({ room: "r1", identity: "student:1", name: "S", canPublish: false })).token);
  check("an audience pass can watch, chat and raise a hand only", audience.video.canPublish === false && audience.video.canSubscribe && audience.video.canPublishData && audience.video.canUpdateOwnMetadata && !audience.video.roomAdmin);
  check("passes name the person", audience.sub === "student:1" && audience.name === "S");
  check("rights read back from a participant", JSON.stringify(lk.rightsOf({ permission: { canPublishSources: [1, 2] } })) === JSON.stringify({ camera: true, mic: true, screen: false }));

  if (!process.env.TEST_MONGO_URL) {
    console.log("database: skipped (set TEST_MONGO_URL to run)");
  } else {
    console.log("\nclasses");
    const mongoose = require("mongoose");
    await mongoose.connect(process.env.TEST_MONGO_URL);
    const Batch = require("../models/batchModel");
    const Program = require("../models/programModel");
    const LiveClass = require("../models/liveClassModel");
    require("../models/studentModel");
    const admin = require("../controllers/admin/liveClassController");
    const app = require("../controllers/app/liveClassController");
    const owner = { _id: new mongoose.Types.ObjectId(), role: "owner", name: "Host" };
    const program = await Program.create({ title: "LK test" });
    const batch = await Batch.create({ name: "LK", program: program._id, isActive: true, features: { liveClasses: true } });
    const student = { _id: new mongoose.Types.ObjectId(), name: "Rafi" };

    let out = await run(admin.createLiveClass, { user: owner, body: { batch: String(batch._id), title: "Webinar", scheduledAt: new Date(Date.now() + 60000), provider: "livekit", mode: "webinar" } });
    check("a webinar is scheduled", out.code === 201 && out.body.provider === "livekit" && out.body.mode === "webinar" && out.body.externalId, out.body);
    const webinar = out.body;
    out = await run(admin.createLiveClass, { user: owner, body: { batch: String(batch._id), title: "Class", scheduledAt: new Date(Date.now() + 60000), provider: "livekit", mode: "anything" } });
    check("anything but webinar is a class", out.body.mode === "class");
    const klass = out.body;

    const params = (lc) => ({ batchId: String(batch._id), id: String(lc._id) });
    out = await run(app.getLiveClass, { student, params: params(webinar) });
    check("students see it opens in the app, with no link", out.body.provider === "livekit" && out.body.mode === "webinar" && out.body.joinUrl === null);
    out = await run(app.getRoomToken, { student, params: params(webinar) });
    check("students can't join before the host starts", out.code === 409 && out.body.waiting === true, out);

    out = await run(admin.getHostToken, { user: owner, params: { id: String(webinar._id) } });
    check("the host's pass starts the class", out.code === 200 && out.body.status === "live" && (await LiveClass.findById(webinar._id)).status === "live");
    check("…and is a host pass for that room", claims(out.body.token).video.roomAdmin === true && claims(out.body.token).video.room === webinar.externalId);

    out = await run(app.getRoomToken, { student, params: params(webinar) });
    check("then a student joins a webinar in the audience", out.code === 200 && claims(out.body.token).video.canPublish === false && claims(out.body.token).sub === `student:${student._id}`);
    await run(admin.getHostToken, { user: owner, params: { id: String(klass._id) } });
    out = await run(app.getRoomToken, { student, params: params(klass) });
    check("and a class with camera and mic", out.code === 200 && claims(out.body.token).video.canPublish === true);
    check("…but not their screen unless the class allows it", JSON.stringify(claims(out.body.token).video.canPublishSources) === JSON.stringify(["camera", "microphone"]), claims(out.body.token).video);
    check("the student's pass carries the classroom's look", out.body.branding && "watermark" in out.body.branding && "siteName" in out.body.branding);
    await LiveClass.updateOne({ _id: klass._id }, { screenShare: "everyone" });
    out = await run(app.getRoomToken, { student, params: params(klass) });
    check("a class that allows screens lets them share", claims(out.body.token).video.canPublishSources.includes("screen_share"));

    out = await run(app.getRoomToken, { student, params: { batchId: String(new mongoose.Types.ObjectId()), id: String(klass._id) } });
    check("only from the class's own batch", out.code === 404);
    await LiveClass.updateOne({ _id: klass._id }, { status: "ended" });
    out = await run(app.getRoomToken, { student, params: params(klass) });
    check("not once it has ended", out.code === 409 && /ended/.test(out.body.message));
    out = await run(admin.getHostToken, { user: owner, params: { id: String(klass._id) } });
    check("not even the host", out.code === 409);
    const teacher = { _id: new mongoose.Types.ObjectId(), role: "teacher", name: "Other" };
    out = await run(admin.getHostToken, { user: teacher, params: { id: String(webinar._id) } });
    check("a teacher not on the batch can't host it", out.code === 403);
    const assigned = { _id: new mongoose.Types.ObjectId(), role: "teacher", name: "Assigned" };
    const taught = await LiveClass.create({ batch: batch._id, host: owner._id, teachers: [assigned._id], title: "Taught", scheduledAt: new Date(), provider: "livekit", externalId: "examai-taught" });
    out = await run(admin.getHostToken, { user: assigned, params: { id: String(taught._id) } });
    check("an assigned teacher opens the class as a host", out.code === 200 && claims(out.body.token).video.roomAdmin === true && out.body.role === "teacher");
    out = await run(admin.getLiveClasses, { user: assigned, query: {} });
    check("a teacher's list holds only their classes, without host links", out.body.liveClasses.length === 1 && out.body.liveClasses[0].hostUrl === undefined);
    out = await run(admin.updateLiveClass, { user: assigned, params: { id: String(taught._id) }, body: { title: "Mine now" } });
    check("a teacher can't edit a class", out.code === 403);
    out = await run(admin.deleteLiveClass, { user: assigned, params: { id: String(taught._id) } });
    check("a teacher can't delete a class", out.code === 403);
    const later = await LiveClass.create({ batch: batch._id, host: owner._id, teachers: [assigned._id], title: "Later", scheduledAt: new Date(Date.now() + 3 * 3600000), provider: "livekit", externalId: "examai-later" });
    out = await run(admin.getHostToken, { user: assigned, params: { id: String(later._id) } });
    check("a teacher can't open a class hours early", out.code === 409);

    console.log("\nattendance");
    const LiveAttendance = require("../models/liveAttendanceModel");
    const attendance = require("../utils/liveAttendance");
    const room = await LiveClass.create({ batch: batch._id, host: owner._id, title: "Att", scheduledAt: new Date(), provider: "livekit", status: "live", externalId: "examai-att" });
    let present = [];
    lk.participants = async () => present;
    lk.participantsOrNull = async () => present;
    const t0 = Date.now();
    present = [
      { identity: `student:${student._id}`, name: "Rafi", metadata: JSON.stringify({ role: "student" }), joinedAt: BigInt(Math.floor((t0 - 600000) / 1000)) },
      { identity: "staff:1", name: "Host", metadata: JSON.stringify({ role: "host" }), joinedAt: BigInt(Math.floor((t0 - 900000) / 1000)) },
    ];
    await attendance.sweepClass(room, new Date(t0));
    let rafi = await LiveAttendance.findOne({ liveClass: room._id, identity: `student:${student._id}` });
    check("a person in the room gets an open stretch from when they joined", rafi && rafi.sessions.length === 1 && !rafi.sessions[0].leftAt && Math.abs(rafi.sessions[0].joinedAt - (t0 - 600000)) < 2000 && String(rafi.student) === String(student._id));
    present = present.filter((p) => p.name !== "Rafi");
    await attendance.sweepClass(room, new Date(t0 + 30000));
    rafi = await LiveAttendance.findOne({ _id: rafi._id });
    check("leaving closes it at when they were last seen", Boolean(rafi.sessions[0].leftAt) && Math.abs(rafi.totalSeconds - 600) <= 2, rafi.totalSeconds);
    present.push({ identity: `student:${student._id}`, name: "Rafi", metadata: JSON.stringify({ role: "student" }), joinedAt: BigInt(Math.floor((t0 + 60000) / 1000)) });
    await attendance.sweepClass(room, new Date(t0 + 90000));
    rafi = await LiveAttendance.findOne({ _id: rafi._id });
    check("coming back opens a second stretch", rafi.sessions.length === 2 && !rafi.sessions[1].leftAt);
    await attendance.closeAll(room._id, new Date(t0 + 120000));
    await LiveClass.updateOne({ _id: room._id }, { status: "ended" });
    rafi = await LiveAttendance.findOne({ _id: rafi._id });
    check("ending the class closes everyone", rafi.sessions.every((x) => x.leftAt) && Math.abs(rafi.totalSeconds - 660) <= 3, rafi.totalSeconds);
    out = await run(admin.getAttendance, { user: owner, params: { id: String(room._id) }, query: {} });
    const row = out.body.rows?.find((r) => r.identity === `student:${student._id}`);
    check("the report shows minutes and joins", out.code === 200 && row && row.minutes === 11 && row.sessions === 2 && out.body.rows[0].role === "host", out.body);
    await LiveAttendance.deleteMany({ liveClass: room._id });

    console.log("\nan empty room ends the class");
    const rooms = {};
    lk.participantsOrNull = async (r) => (r in rooms ? rooms[r] : []);
    const deleted = [];
    const realEndMeeting = lk.endMeeting;
    lk.endMeeting = async (r) => { deleted.push(r); };
    await LiveClass.updateMany({ provider: "livekit", status: "live" }, { status: "ended" });
    const mins = (m) => new Date(t0 + m * 60000);
    const host = { identity: "staff:1", name: "Host", metadata: JSON.stringify({ role: "host" }), joinedAt: BigInt(Math.floor(t0 / 1000)) };
    const neverJoined = await LiveClass.create({ batch: batch._id, host: owner._id, title: "Never", scheduledAt: mins(-30), provider: "livekit", status: "live", externalId: "examai-never", liveSince: mins(-20) });
    const busy = await LiveClass.create({ batch: batch._id, host: owner._id, title: "Busy", scheduledAt: mins(-30), provider: "livekit", status: "live", externalId: "examai-busy", liveSince: mins(-20) });
    rooms["examai-busy"] = [host];
    await attendance.sweep(mins(0));
    check("started 20 minutes ago and nobody came: ended", (await LiveClass.findById(neverJoined._id)).status === "ended" && deleted.includes("examai-never"));
    let b = await LiveClass.findById(busy._id);
    check("someone in the room: still live, occupied now", b.status === "live" && Math.abs(b.occupiedAt - mins(0)) < 1000);
    rooms["examai-busy"] = [];
    await attendance.sweep(mins(10));
    check("empty for 10 minutes: still live", (await LiveClass.findById(busy._id)).status === "live");
    await attendance.sweep(mins(16));
    b = await LiveClass.findById(busy._id);
    check("empty for 16 minutes: ended, everyone's time closed", b.status === "ended" && deleted.includes("examai-busy"));
    const outage = await LiveClass.create({ batch: batch._id, host: owner._id, title: "Outage", scheduledAt: mins(-90), provider: "livekit", status: "live", externalId: "examai-outage", liveSince: mins(-80) });
    lk.participantsOrNull = async () => null;
    await attendance.sweep(mins(0));
    check("LiveKit unreachable: not taken for an empty room", (await LiveClass.findById(outage._id)).status === "live");
    await LiveClass.updateOne({ _id: outage._id }, { status: "ended" });
    lk.endMeeting = realEndMeeting;
    lk.participantsOrNull = async () => present;

    console.log("\nQ&A and polls");
    const roomCtl = require("../controllers/liveRoomController");
    const LiveQuestion = require("../models/liveQuestionModel");
    const LivePoll = require("../models/livePollModel");
    const PracticeAttempt = require("../models/practiceAttemptModel");
    const { Question } = require("../models/questionModel");
    const pings = [];
    lk.broadcast = async (roomName, payload) => { pings.push(payload.type); };
    const qaClass = await LiveClass.create({ batch: batch._id, host: owner._id, title: "QA", scheduledAt: new Date(), provider: "livekit", status: "live", externalId: "examai-qa" });
    const sp = { batchId: String(batch._id), id: String(qaClass._id) };
    const other = { _id: new mongoose.Types.ObjectId(), name: "Nusrat" };
    out = await run(roomCtl.studentAsk, { student, params: sp, body: { text: "What is total internal reflection?" } });
    check("a student asks a question", out.code === 201 && out.body.question.mine === true && pings.includes("qa"));
    const qid = out.body.question._id;
    out = await run(roomCtl.studentUpvote, { student, params: { ...sp, qid } });
    check("…can't upvote their own", out.code === 400);
    out = await run(roomCtl.studentUpvote, { student: other, params: { ...sp, qid } });
    check("others upvote it", out.code === 200 && out.body.question.votes === 1 && out.body.question.votedByMe);
    out = await run(roomCtl.studentUpvote, { student: other, params: { ...sp, qid } });
    check("…and can take it back", out.body.question.votes === 0);
    for (let i = 0; i < 2; i++) await run(roomCtl.studentAsk, { student, params: sp, body: { text: `Q ${i}` } });
    out = await run(roomCtl.studentAsk, { student, params: sp, body: { text: "One more" } });
    check("three waiting questions at a time", out.code === 429);
    out = await run(roomCtl.studentAsk, { student: other, params: sp, body: { text: "you are a bastard" } });
    check("abusive questions are refused", out.code === 400 && /abusive/.test(out.body.message), out.body);
    out = await run(roomCtl.staffUpdateQuestion, { user: owner, params: { id: String(qaClass._id), qid }, body: { spotlight: true } });
    check("the host spotlights one", out.body.question.spotlight === true);
    const second = (await LiveQuestion.findOne({ liveClass: qaClass._id, text: "Q 0" }))._id;
    await run(roomCtl.staffUpdateQuestion, { user: owner, params: { id: String(qaClass._id), qid: String(second) }, body: { spotlight: true } });
    check("…one at a time", (await LiveQuestion.countDocuments({ liveClass: qaClass._id, spotlight: true })) === 1);
    await run(roomCtl.staffUpdateQuestion, { user: owner, params: { id: String(qaClass._id), qid }, body: { status: "dismissed" } });
    out = await run(roomCtl.studentListQuestions, { student: other, params: sp });
    check("dismissed questions disappear for students", out.body.questions.every((q) => q._id !== qid) && out.body.questions.length === 2);

    const mcq = await Question.create({ type: "mcq", question: "Refractive index of glass is about", options: [{ key: "A", text: "1.0" }, { key: "B", text: "1.5" }], correctOption: "B", marks: 1, topic: new mongoose.Types.ObjectId(), chapter: new mongoose.Types.ObjectId(), subject: new mongoose.Types.ObjectId() }).catch((e) => ({ error: e.message }));
    check("(test question created)", mcq && !mcq.error, mcq?.error);
    out = await run(roomCtl.staffCreatePoll, { user: owner, params: { id: String(qaClass._id) }, body: { questionId: String(mcq._id) } });
    check("the host launches a poll from the bank", out.code === 201 && out.body.poll && out.body.poll.options.length === 2 && out.body.poll.correct === "B" && pings.includes("poll"), out.body);
    const pid = out.body.poll._id;
    out = await run(roomCtl.studentCurrentPoll, { student, params: sp });
    check("students see it without the answer or results", String(out.body.poll._id) === String(pid) && out.body.poll.correct === undefined && out.body.poll.counts === undefined);
    out = await run(roomCtl.studentAnswerPoll, { student, params: { ...sp, pid }, body: { key: "B" } });
    check("a student answers", out.code === 200 && out.body.poll.myAnswer === "B");
    out = await run(roomCtl.studentAnswerPoll, { student, params: { ...sp, pid }, body: { key: "A" } });
    check("…once", out.code === 409);
    check("a bank poll counts as practice", Boolean(await PracticeAttempt.findOne({ student: student._id, question: mcq._id, isCorrect: true })));
    await run(roomCtl.studentAnswerPoll, { student: other, params: { ...sp, pid }, body: { key: "A" } });
    out = await run(roomCtl.staffListPolls, { user: owner, params: { id: String(qaClass._id) } });
    check("the host sees live counts", out.body.polls[0].counts.A === 1 && out.body.polls[0].counts.B === 1 && out.body.polls[0].responses === 2);
    await run(roomCtl.staffUpdatePoll, { user: owner, params: { id: String(qaClass._id), pid }, body: { revealed: true } });
    out = await run(roomCtl.studentCurrentPoll, { student: other, params: sp });
    check("revealed: students see results and the answer", out.body.poll.revealed && out.body.poll.correct === "B" && out.body.poll.counts.B === 1 && out.body.poll.myAnswer === "A");
    out = await run(roomCtl.studentAnswerPoll, { student: { _id: new mongoose.Types.ObjectId() }, params: { ...sp, pid }, body: { key: "A" } });
    check("no answers after it closes", out.code === 409);
    out = await run(roomCtl.staffCreatePoll, { user: owner, params: { id: String(qaClass._id) }, body: { text: "Ready for the test?", options: ["Yes", "No", ""] } });
    check("a quick poll with typed options", out.code === 201 && out.body.poll.options.length === 2 && out.body.poll.correct === null);
    await LiveQuestion.deleteMany({ liveClass: qaClass._id });
    await LivePoll.deleteMany({ liveClass: qaClass._id });
    await PracticeAttempt.deleteMany({ question: mcq._id });
    await Question.deleteOne({ _id: mcq._id });

    console.log("\nrecordings");
    const Subject = require("../models/subjectModel");
    const Chapter = require("../models/chapterModel");
    const Lecture = require("../models/lectureModel");
    const Media = require("../models/mediaModel");
    const subject = await Subject.create({ name: "Physics LK", title: "Physics LK" }).catch((e) => ({ error: e.message }));
    const chapter = await Chapter.create({ name: "Optics LK", title: "Optics LK", subject: subject._id }).catch((e) => ({ error: e.message }));
    check("(test chapter created)", subject?._id && chapter?._id, [subject?.error, chapter?.error]);
    const egressState = {};
    lk.startRecording = async (roomName, name) => { egressState.e1 = "recording"; return { egressId: "EG_1", key: `recordings/${name}.mp4`, driver: "local" }; };
    lk.stopRecording = async () => { egressState.e1 = "processing"; };
    lk.recordingStatus = async () => (egressState.e1 === "done" ? { status: "ready", sizeBytes: 1234, durationSeconds: 61 } : { status: egressState.e1 });
    const recClass = await LiveClass.create({ batch: batch._id, host: owner._id, title: "Optics Live", scheduledAt: new Date(), provider: "livekit", status: "scheduled", externalId: "examai-rec" });
    const rp = { id: String(recClass._id) };
    out = await run(admin.startRecording, { user: owner, params: rp });
    check("can't record before the class starts", out.code === 409);
    await LiveClass.updateOne({ _id: recClass._id }, { status: "live" });
    out = await run(admin.startRecording, { user: owner, params: rp });
    check("recording starts", out.code === 200 && out.body.recording === true && out.body.recordings[0].status === "recording" && /^recordings\/optics-live-/.test(out.body.recordings[0].key), out.body);
    const rid = String(out.body.recordings[0]._id);
    out = await run(admin.decideRecording, { user: owner, params: { ...rp, rid }, body: { action: "publish", chapter: String(chapter._id) } });
    check("can't publish while recording", out.code === 409);
    out = await run(admin.stopRecording, { user: owner, params: rp });
    check("stopping leaves it processing", out.body.recording === false && out.body.recordings[0].status === "processing");
    egressState.e1 = "done";
    out = await run(admin.getRecordings, { user: owner, params: rp });
    check("then ready, with size, length and a link", out.body.recordings[0].status === "ready" && out.body.recordings[0].durationSeconds === 61 && /^\/media\/recordings\//.test(out.body.recordings[0].url || ""), out.body.recordings[0]);
    await LiveClass.updateOne({ _id: recClass._id }, { $push: { boards: { url: "/media/boards/b1.png" } } });
    out = await run(admin.decideRecording, { user: owner, params: { ...rp, rid }, body: { action: "publish", chapter: String(chapter._id) } });
    const published = out.body.recordings?.[0];
    const lecture = published?.lecture && (await Lecture.findById(published.lecture));
    check("publishing makes a lecture on the class's batch", out.code === 200 && lecture && String(lecture.batches[0]) === String(batch._id) && lecture.isPublished && String(lecture.chapter) === String(chapter._id) && /b1\.png/.test(lecture.bodyMarkdown || ""), out.body);
    const media = lecture && (await Media.findById(lecture.video));
    check("…with the recording as its video", media && media.kind === "video" && media.key === published.key && media.durationSeconds === 61);
    const shown = await run(app.getLiveClass, { student, params: params(recClass) });
    check("students get the lecture to watch, never the file's address", String(shown.body?.recordingLecture) === String(lecture._id) && !shown.body?.recordingUrl, shown.body);
    out = await run(admin.decideRecording, { user: owner, params: { ...rp, rid }, body: { action: "publish", chapter: String(chapter._id) } });
    check("only once", out.code === 409);

    // Auto-publish
    egressState.e1 = "recording";
    const auto = await LiveClass.create({ batch: batch._id, host: owner._id, title: "Auto", scheduledAt: new Date(), provider: "livekit", status: "live", externalId: "examai-auto", autoPublish: true, publishChapter: chapter._id });
    const recUtil = require("../utils/liveRecording");
    await recUtil.start(auto);
    await recUtil.stop(auto);
    egressState.e1 = "done";
    await recUtil.refreshAll();
    const autoLc = await LiveClass.findById(auto._id);
    check("auto-publish turns a finished recording into a lecture", autoLc.recordings[0].decision === "published" && Boolean(autoLc.recordings[0].lecture));
    // Sending to a video provider
    const video = require("../adapters/video");
    const AppSettings = require("../models/appSettingsModel");
    const sentFiles = [];
    video.PROVIDERS.bunny.upload = async (file, type, title) => { sentFiles.push({ size: file.size ?? file.length, type, title }); return "bunny-guid-1"; };
    const realStorage = require("../adapters/storage");
    const realGet = realStorage.get;
    const realRemove = realStorage.remove;
    const removed = [];
    realStorage.get = async () => Buffer.alloc(2048);
    realStorage.remove = async (key) => { removed.push(key); };
    process.env.BUNNY_LIBRARY_ID = "lib";
    process.env.BUNNY_SECURITY_KEY = "sec";
    out = await run(admin.getRecordings, { user: owner, params: rp });
    check("Bunny with keys can take recordings", out.body.sendTo.some((t) => t.name === "bunny"), out.body.sendTo);
    out = await run(admin.decideRecording, { user: owner, params: { ...rp, rid }, body: { action: "send", to: "vimeo" } });
    check("a provider without keys can't", out.code === 400, out);
    await LiveClass.updateOne({ _id: recClass._id }, { $set: { "recordings.0.driver": "s3" } });
    out = await run(admin.decideRecording, { user: owner, params: { ...rp, rid }, body: { action: "send", to: "bunny" } });
    check("sending starts in the background", out.code === 200 && out.body.recordings[0].sending === true, out.body.recordings?.[0]);
    await recUtil.settled();
    let sentLc = await LiveClass.findById(recClass._id);
    check("…the file goes to Bunny", sentFiles.length === 1 && sentFiles[0].size === 2048 && sentFiles[0].type === "video/mp4" && sentLc.recordings[0].sent.status === "sent" && sentLc.recordings[0].sent.key === "bunny-guid-1", { sentFiles, sent: sentLc.recordings[0].sent });
    const switched = await Media.findById(lecture.video);
    check("…the lecture now plays from Bunny", switched.driver === "bunny" && switched.key === "bunny-guid-1", switched);
    check("…and the server's copy is removed", removed.length === 1 && sentLc.recordings[0].sent.removedCopy === true, removed);
    out = await run(admin.decideRecording, { user: owner, params: { ...rp, rid }, body: { action: "send", to: "bunny" } });
    check("…only once", out.code === 409);

    // Sent on its own when Settings ask for it, then published from there
    const settings = await AppSettings.get();
    settings.liveRoom = { ...(settings.liveRoom?.toObject?.() || {}), recordingsTo: "bunny", recordingsAuto: true, recordingsKeepCopy: true };
    await settings.save();
    egressState.e1 = "recording";
    const auto2 = await LiveClass.create({ batch: batch._id, host: owner._id, title: "Auto send", scheduledAt: new Date(), provider: "livekit", status: "live", externalId: "examai-auto2", autoPublish: true, publishChapter: chapter._id });
    await recUtil.start(auto2);
    await recUtil.stop(auto2);
    await LiveClass.updateOne({ _id: auto2._id }, { $set: { "recordings.0.driver": "s3" } });
    egressState.e1 = "done";
    await recUtil.refreshAll();
    await recUtil.settled();
    const a2 = await LiveClass.findById(auto2._id);
    const a2media = a2.recordings[0].lecture && (await Media.findById((await Lecture.findById(a2.recordings[0].lecture)).video));
    check("auto-send, then the lecture is published playing from Bunny", a2.recordings[0].sent.status === "sent" && a2.recordings[0].decision === "published" && a2media?.driver === "bunny", { sent: a2.recordings[0].sent, decision: a2.recordings[0].decision, a2media });
    check("…keeping the server's copy when asked", removed.length === 1 && !a2.recordings[0].sent.removedCopy);
    settings.liveRoom = { ...settings.liveRoom.toObject(), recordingsAuto: false };
    await settings.save();
    realStorage.get = realGet;
    realStorage.remove = realRemove;

    // Private and delete
    egressState.e1 = "recording";
    await recUtil.start(autoLc);
    out = await run(admin.decideRecording, { user: owner, params: { id: String(auto._id), rid: String(autoLc.recordings[1]._id) }, body: { action: "delete" } });
    check("deleting a recording stops it and hides it", out.code === 200 && out.body.recordings.length === 1 && out.body.recording === false);

    console.log("\nnotes");
    const notesCtl = require("../controllers/admin/liveNotesController");
    const LiveTranscript = require("../models/liveTranscriptModel");
    const ai = require("../ai/service");
    const realComplete = ai.complete;
    const calls = [];
    ai.complete = async (o) => { calls.push(o); return { text: "```markdown\n## Summary\nLenses bend light.\n```" }; };
    const np = { id: String(recClass._id) };
    out = await run(notesCtl.addTranscript, { user: owner, params: np, body: { lines: [{ text: "today we look at lenses", at: Date.now() - 60000 }, { text: "  " }, { text: "a convex lens converges light", at: Date.now() }], lang: "en-US" } });
    check("caption lines are saved (blank ones dropped)", out.code === 200 && out.body.saved === 2, out.body);
    out = await run(notesCtl.getNotes, { user: owner, params: np, query: {} });
    check("the transcript reads back in order", out.body.transcript.length === 2 && /lenses/.test(out.body.transcript[0].text));
    out = await run(notesCtl.generateNotes, { user: owner, params: np });
    check("writing the notes starts in the background", out.code === 202 && out.body.notes.status === "writing");
    for (let i = 0; i < 40 && (await LiveClass.findById(recClass._id)).notes.status === "writing"; i += 1) await new Promise((r) => setTimeout(r, 50));
    let nc = await LiveClass.findById(recClass._id);
    check("AI notes are saved, cleaned of code fences", nc.notes.status === "ready" && nc.notes.markdown.startsWith("## Summary"), nc.notes);
    check("…from the timestamped transcript", /\[1:00\] a convex lens/.test(calls[0]?.prompt || ""), calls[0]?.prompt);
    check("…and go into the lecture made from the recording", /Lenses bend light/.test((await Lecture.findById(lecture._id)).bodyMarkdown) && /b1\.png/.test((await Lecture.findById(lecture._id)).bodyMarkdown));
    out = await run(notesCtl.updateNotes, { user: owner, params: np, body: { markdown: "## Edited", applyToLectures: true } });
    check("edited notes can be put into the lecture", out.body.applied === 1 && /## Edited/.test((await Lecture.findById(lecture._id)).bodyMarkdown));
    await Lecture.updateOne({ _id: lecture._id }, { bodyMarkdown: "teacher wrote this" });
    await require("../utils/liveNotes").write(recClass._id);
    check("rewritten notes leave a hand-edited lecture alone", (await Lecture.findById(lecture._id)).bodyMarkdown === "teacher wrote this");
    const long = Array.from({ length: 600 }, (_, i) => ({ text: `sentence number ${i} about refraction and the lens formula`, at: Date.now() + i * 1000 }));
    await LiveTranscript.insertMany(long.map((l) => ({ ...l, at: new Date(l.at), liveClass: recClass._id })));
    calls.length = 0;
    await require("../utils/liveNotes").write(recClass._id);
    check("a long class is written in parts, then merged", calls.length >= 3 && /merge/i.test(calls[calls.length - 1].system), calls.length);
    ai.complete = realComplete;
    await LiveTranscript.deleteMany({ liveClass: recClass._id });

    await Lecture.deleteMany({ chapter: chapter._id });
    await Media.deleteMany({ key: /^recordings\// });
    await Chapter.deleteOne({ _id: chapter._id });
    await Subject.deleteOne({ _id: subject._id });

    await LiveClass.deleteMany({ batch: batch._id });
    await Batch.deleteOne({ _id: batch._id });
    await Program.deleteOne({ _id: program._id });
    await mongoose.disconnect();
  }

  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exit(1); }
  console.log("PASS");
})();
