const LiveClass = require("../models/liveClassModel");
const liveClassAdapter = require("../adapters/liveClass");
const storage = require("../adapters/storage");
const video = require("../adapters/video");

// Recording an in-app class and what happens to it afterwards: published
// as a lecture on the class's batch, kept private for staff, or deleted.

const lk = () => liveClassAdapter.get("livekit");
const slug = (s) => String(s || "class").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "class";

const active = (liveClass) => liveClass.recordings.find((r) => r.status === "recording");

const start = async (liveClass) => {
  if (active(liveClass)) return active(liveClass);
  const name = `${slug(liveClass.title)}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
  const { egressId, key, driver } = await lk().startRecording(liveClass.externalId, name);
  liveClass.recordings.push({ egressId, key, driver, status: "recording" });
  await liveClass.save();
  lk().broadcast(liveClass.externalId, { type: "rec", on: true });
  return liveClass.recordings[liveClass.recordings.length - 1];
};

const stop = async (liveClass) => {
  const rec = active(liveClass);
  if (!rec) return null;
  await lk().stopRecording(rec.egressId);
  rec.status = "processing";
  rec.endedAt = new Date();
  await liveClass.save();
  lk().broadcast(liveClass.externalId, { type: "rec", on: false });
  return rec;
};

// ---------------------------------------------------------------- sending
// A finished recording can go to a video provider (VdoCipher, Bunny,
// Vimeo), chosen under Settings → Live classroom, so students watch it in
// that provider's protected player instead of as a file anyone could save.
// The upload runs in the background; rec.sent says how it went. A lecture
// already made from the recording switches to the provider's copy.
const SENDERS = ["vdocipher", "bunny", "vimeo"];
const STALE_MS = 6 * 60 * 60 * 1000; // a send this old was cut off (a restart)

const canTake = (name) => {
  const p = SENDERS.includes(name) ? video.PROVIDERS[name] : null;
  return Boolean(p?.upload) && (p.canUpload ? p.canUpload() : p.configured());
};

const choice = async () => {
  const AppSettings = require("../models/appSettingsModel");
  const room = (await AppSettings.get()).liveRoom || {};
  return { to: room.recordingsTo || "storage", auto: Boolean(room.recordingsAuto), keepCopy: Boolean(room.recordingsKeepCopy) };
};

const isSending = (rec) => rec.sent?.status === "sending" && Date.now() - new Date(rec.sent.startedAt).getTime() < STALE_MS;

// The file, read lazily from disk where possible: recordings run to
// gigabytes.
const fileOf = async (rec) => {
  if ((rec.driver || "local") === "local") {
    const fs = require("fs");
    return fs.openAsBlob(storage.DRIVERS.local.pathOf(rec.key), { type: "video/mp4" });
  }
  return new Blob([await storage.get(rec.key, rec.driver)], { type: "video/mp4" });
};

const setSent = (classId, recId, sent) =>
  LiveClass.updateOne({ _id: classId, "recordings._id": recId }, { $set: Object.fromEntries(Object.entries(sent).map(([k, v]) => [`recordings.$.sent.${k}`, v])) });

const send = async (liveClass, rec, to) => {
  const provider = video.PROVIDERS[to];
  if (!canTake(to)) throw Object.assign(new Error(`${provider?.label || to} isn't set up to take uploads. Add its keys first.`), { statusCode: 400 });
  if (rec.status !== "ready") throw Object.assign(new Error("The recording isn't ready yet."), { statusCode: 409 });
  if (isSending(rec)) throw Object.assign(new Error("It's being sent already."), { statusCode: 409 });
  if (rec.sent?.status === "sent") throw Object.assign(new Error(`Already sent to ${video.PROVIDERS[rec.sent.to]?.label || rec.sent.to}.`), { statusCode: 409 });
  if (rec.sent?.removedCopy || !rec.key) throw Object.assign(new Error("The file is no longer on the server."), { statusCode: 409 });
  rec.sent = { to, status: "sending", key: null, error: null, startedAt: new Date(), removedCopy: false };
  await liveClass.save();

  const classId = liveClass._id;
  const recId = rec._id;
  const title = `${liveClass.title} (recording)`;
  const { keepCopy } = await choice();
  const done = (async () => {
    try {
      const key = await provider.upload(await fileOf(rec), "video/mp4", title);
      await setSent(classId, recId, { status: "sent", key, error: null });
      const fresh = await LiveClass.findById(classId);
      const r = fresh?.recordings.id(recId);
      if (!r) return;
      if (r.media) {
        const Media = require("../models/mediaModel");
        await Media.updateOne({ _id: r.media }, { $set: { driver: to, key } });
      }
      if (!keepCopy && r.key) {
        await storage.remove(r.key, r.driver).catch(() => {});
        r.sent.removedCopy = true;
        await fresh.save();
      }
      // Waited for the send before publishing on its own (see refresh).
      if (fresh.autoPublish && fresh.publishChapter && r.decision === "pending") await publish(fresh, r).catch(() => {});
    } catch (e) {
      await setSent(classId, recId, { status: "failed", error: String(e.message || e).slice(0, 300) }).catch(() => {});
      // Not sent: an auto-published class still gets its lecture, from the server's copy.
      const fresh = await LiveClass.findById(classId).catch(() => null);
      const r = fresh?.recordings.id(recId);
      if (r && fresh.autoPublish && fresh.publishChapter && r.decision === "pending") await publish(fresh, r).catch(() => {});
    }
  })();
  pending.add(done);
  done.finally(() => pending.delete(done));
  return rec;
};

// Tests wait on sends in flight.
const pending = new Set();
const settled = () => Promise.all([...pending]);

// Turns a finished recording into a lecture on the class's batch.
const publish = async (liveClass, rec, { title, chapter, publishNow = true, by = null } = {}) => {
  const Media = require("../models/mediaModel");
  const Lecture = require("../models/lectureModel");
  const Chapter = require("../models/chapterModel");
  const parent = await Chapter.findById(chapter || liveClass.publishChapter);
  if (!parent) throw Object.assign(new Error("Pick a chapter for the lecture."), { statusCode: 400 });
  const when = (rec.startedAt || liveClass.scheduledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const sent = rec.sent?.status === "sent" && rec.sent.key;
  const media = rec.media
    ? await Media.findById(rec.media)
    : await Media.create({
        title: title || liveClass.title,
        kind: "video",
        driver: sent ? rec.sent.to : rec.driver || "local",
        key: sent ? rec.sent.key : rec.key,
        sizeBytes: rec.sizeBytes || undefined,
        durationSeconds: rec.durationSeconds || undefined,
        mimeType: "video/mp4",
        uploadedBy: by || liveClass.host,
      });
  const lecture = await Lecture.create({
    title: title || `${liveClass.title} (recording)`,
    description: `Recording of the live class on ${when}.`,
    bodyMarkdown: require("./liveNotes").lectureBody(liveClass),
    subject: parent.subject,
    chapter: parent._id,
    video: media._id,
    // The writing pad's pages, when the host saved them.
    attachments: liveClass.padNotes?.media ? [liveClass.padNotes.media] : [],
    // A batch-free webinar's lecture waits in the library for a batch.
    batches: liveClass.batch ? [liveClass.batch] : [],
    isPublished: Boolean(publishNow),
  });
  rec.media = media._id;
  rec.lecture = lecture._id;
  rec.decision = "published";
  await liveClass.save();
  return lecture;
};

const discard = async (liveClass, rec) => {
  if (rec.key && !rec.sent?.removedCopy) await storage.remove(rec.key, rec.driver).catch(() => {});
  rec.decision = "deleted";
  await liveClass.save();
};

// Brings unfinished recordings up to date, and publishes finished ones
// when the class asks for that.
const refresh = async (liveClass) => {
  let changed = false;
  const finished = [];
  for (const rec of liveClass.recordings) {
    if (!["recording", "processing"].includes(rec.status)) continue;
    const s = await lk().recordingStatus(rec.egressId).catch(() => null);
    if (!s) continue;
    if (s.status !== rec.status || s.sizeBytes !== rec.sizeBytes) {
      Object.assign(rec, { status: s.status, sizeBytes: s.sizeBytes, durationSeconds: s.durationSeconds, error: s.error || null });
      if (s.status !== "recording" && !rec.endedAt) rec.endedAt = new Date();
      if (s.status === "ready") finished.push(rec);
      changed = true;
    }
  }
  if (changed) await liveClass.save();
  // Just finished: off to the video provider, when Settings ask for that.
  if (finished.length) {
    const { to, auto } = await choice();
    if (auto && canTake(to)) {
      for (const rec of finished) if (rec.decision !== "deleted") await send(liveClass, rec, to).catch(() => {});
    }
  }
  if (liveClass.autoPublish && liveClass.publishChapter) {
    for (const rec of liveClass.recordings) {
      // A recording on its way to the provider is published once it's there.
      if (rec.status === "ready" && rec.decision === "pending" && !isSending(rec)) await publish(liveClass, rec).catch(() => {});
    }
  }
  return liveClass;
};

// Every class with a recording still in progress.
const refreshAll = async () => {
  if (!lk().configured()) return;
  const classes = await LiveClass.find({ provider: "livekit", "recordings.status": { $in: ["recording", "processing"] } });
  for (const lc of classes) await refresh(lc).catch(() => {});
};

module.exports = { start, stop, publish, discard, refresh, refreshAll, active, send, canTake, choice, isSending, settled, SENDERS };
