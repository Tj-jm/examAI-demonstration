const asyncHandler = require("express-async-handler");
const LiveClass = require("../../models/liveClassModel");
const Student = require("../../models/studentModel");
const liveClassAdapter = require("../../adapters/liveClass");

// Explicit allowlist, not a raw doc — a student must never see hostUrl,
// externalId, alternativeHosts, or any other student's registrant entry.
// See gotcha #12 in the project notes.
//
// `myJoinUrl` is passed in separately per-request (see getLiveClass) since
// it depends on which student is asking — shape() itself has no way to
// know that from the document alone for a secured class.
const shape = (doc, myJoinUrl) => ({
  _id: doc._id,
  title: doc.title,
  description: doc.description,
  scheduledAt: doc.scheduledAt,
  durationMinutes: doc.durationMinutes,
  status: doc.status,
  secured: doc.secured,
  // Unsecured: the one shared link, unless cancelled. Secured: never the
  // shared link (it's meaningless once registration is on — Zoom's own
  // top-level join_url becomes a generic registration page, not something
  // that gets anyone in) — only ever this student's own personal link,
  // resolved by the caller and passed in as myJoinUrl.
  joinUrl: doc.status === "cancelled" ? null : doc.secured ? myJoinUrl ?? null : doc.joinUrl,
  // A link the host gave (Zoom, manual). An in-app class's own recording is
  // watched as the lecture made from it, in the protected player or the
  // video provider's, never as the raw file.
  recordingUrl: doc.provider === "livekit" ? null : doc.recordingUrl,
  recordingLecture: (doc.recordings || []).find((r) => r.decision === "published" && r.lecture)?.lecture || null,
  // The writing pad's pages as a PDF (getLiveClass resolves the url).
  padNotesUrl: doc.padNotesUrl || null,
  // LiveKit classes open inside the app, not by a link.
  provider: doc.provider,
  mode: doc.provider === "livekit" ? doc.mode : undefined,
});

// Which list a class belongs in. A scheduled class whose time (plus its
// length and an hour's grace) has passed without starting counts as past.
// So does a Zoom or link class still marked live three hours after its end,
// since nothing tells the server those ended unless the host or a Zoom
// webhook does. In-app classes end on their own (utils/liveAttendance.js).
const GRACE_MS = 60 * 60 * 1000;
const STALE_LIVE_MS = 3 * 60 * 60 * 1000;
const phaseOf = (lc, now) => {
  const end = new Date(lc.scheduledAt).getTime() + (lc.durationMinutes || 60) * 60000;
  if (lc.status === "live") return lc.provider !== "livekit" && now > end + STALE_LIVE_MS ? "past" : "live";
  if (lc.status === "scheduled") {
    if (end + GRACE_MS >= now) return "upcoming";
  }
  return "past";
};
const PHASES = ["live", "upcoming", "past"];

//@desc   List live classes on this batch: live now, then upcoming (soonest
//        first), then past (newest first). filter=live|upcoming|past
//        narrows it; counts has each list's size for the filter chips.
//@route  GET /api/app/batches/:batchId/live-classes?page=&limit=&filter=
//@access Private (student)
const getLiveClasses = asyncHandler(async (req, res) => {
  const query = { batch: req.params.batchId };
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const filter = PHASES.includes(req.query.filter) ? req.query.filter : "all";

  // A batch's classes number in the hundreds at most, so they're ordered
  // and filtered here rather than by one Mongo sort that can't express
  // "upcoming ascending, past descending".
  const now = Date.now();
  const every = await LiveClass.find(query).sort({ scheduledAt: -1 }).limit(2000);
  const groups = { live: [], upcoming: [], past: [] };
  for (const lc of every) groups[phaseOf(lc, now)].push(lc);
  groups.upcoming.reverse(); // soonest first
  const ordered = filter === "all" ? [...groups.live, ...groups.upcoming, ...groups.past] : groups[filter];
  const total = ordered.length;
  const liveClasses = ordered.slice((page - 1) * limit, page * limit);

  // No lazy registration here on purpose — this is a browse view, not an
  // intent to join. A secured class simply shows joinUrl: null in the
  // list; the real link is resolved only when the student opens it (see
  // getLiveClass), which is also the only place a Zoom API call for
  // registration is worth making.
  res.status(200).json({
    liveClasses: liveClasses.map((lc) => ({ ...shape(lc), phase: phaseOf(lc, now) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    filter,
    counts: { all: every.length, live: groups.live.length, upcoming: groups.upcoming.length, past: groups.past.length },
  });
});

//@desc   Get one live class (the join page) — resolves/creates this
//        student's own registration if the class is secured
//@route  GET /api/app/batches/:batchId/live-classes/:id
//@access Private (student)
const getLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findOne({
    _id: req.params.id,
    batch: req.params.batchId,
  });

  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }
  if (liveClass.padNotes?.media) {
    const media = await require("../../models/mediaModel").findById(liveClass.padNotes.media);
    if (media) liveClass.padNotesUrl = await require("../../adapters/storage").urlFor(media.key, media.driver).catch(() => null);
  }

  if (!liveClass.secured) {
    return res.status(200).json(shape(liveClass));
  }

  const existing = liveClass.registrants.find((r) => String(r.student) === String(req.student._id));
  if (existing) {
    return res.status(200).json(shape(liveClass, existing.joinUrl));
  }

  // Lazy path: this student wasn't on the roster at creation time — most
  // likely they gained batch access afterward (a purchase, a trial start)
  // rather than being an active student when the class was scheduled.
  // Registering here rather than leaving them stuck is what makes
  // "secured" track live batch membership instead of a one-time snapshot.
  const student = await Student.findById(req.student._id).select("name email");
  if (!student.email) {
    // No email on file at all — Zoom registration has no path without
    // one. Surfaced as a clear reason rather than a silent null, since a
    // student would otherwise have no way to tell "not started yet" apart
    // from "you can never join this".
    return res.status(200).json({ ...shape(liveClass, null), joinBlockedReason: "no_email_on_file" });
  }

  try {
    const adapter = liveClassAdapter.get("zoom");
    const [firstName, ...rest] = (student.name || "Student").split(" ");
    const result = await adapter.registerParticipant({
      meetingId: liveClass.externalId,
      email: student.email,
      firstName,
      lastName: rest.join(" "),
    });

    liveClass.registrants.push({
      student: student._id,
      registrantId: result.registrantId,
      joinUrl: result.joinUrl,
    });
    await liveClass.save();

    res.status(200).json(shape(liveClass, result.joinUrl));
  } catch (error) {
    // A Zoom-side failure here (rate limit, transient API error) must not
    // read as "this class doesn't exist" — the class is real, only this
    // student's registration attempt failed, and retrying (reloading the
    // page) is the correct next step. The real reason (e.g. Zoom's plan
    // doesn't have registration enabled, the meeting's approval_type isn't
    // 0, the student's email is already registered/is the host's own) was
    // previously swallowed entirely — logged here so it's actually
    // diagnosable instead of a permanent, silent dead end.
    console.error(`Zoom registration failed for live class ${liveClass._id}, student ${student._id}:`, error.message);
    res.status(200).json({ ...shape(liveClass, null), joinBlockedReason: "registration_failed" });
  }
});

//@desc   A student's pass into an in-app (LiveKit) class, once it's live.
//        In a webinar they join as audience: watch, listen, chat and
//        raise a hand; the host can bring them on stage.
//@route  POST /api/app/batches/:batchId/live-classes/:id/room-token
//@access Private (student)
const getRoomToken = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findOne({ _id: req.params.id, batch: req.params.batchId });
  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }
  if (liveClass.provider !== "livekit") {
    res.status(400);
    throw new Error("This class opens with its own join link.");
  }
  if (liveClass.status !== "live") {
    res.status(409);
    // "waiting" lets the app keep checking until the teacher starts it.
    return res.status(409).json({
      message: liveClass.status === "scheduled" ? "Waiting for the teacher to start the class." : `This class has ${liveClass.status === "cancelled" ? "been cancelled" : "ended"}.`,
      waiting: liveClass.status === "scheduled",
    });
  }
  // The LiveKit server's limit (Settings → Performance), when blocking is on.
  if (!(await require("../../utils/liveMonitor").roomFor(`student:${req.student._id}`))) {
    return res.status(409).json({ message: "This class is full right now. Try again in a few minutes.", full: true });
  }
  // One identity per student: joining from a second device replaces the first.
  const pass = await liveClassAdapter.get("livekit").joinToken({
    room: liveClass.externalId,
    identity: `student:${req.student._id}`,
    name: req.student.name || "Student",
    canPublish: liveClass.mode !== "webinar",
    sources: { camera: true, mic: true, screen: liveClass.screenShare === "everyone" },
    metadata: { role: "student" },
  });
  const { roomBranding } = require("../admin/liveClassController");
  res.status(200).json({
    ...pass,
    mode: liveClass.mode,
    title: liveClass.title,
    branding: await roomBranding(),
    recording: liveClass.recordings.some((r) => r.status === "recording"),
  });
});

module.exports = { getLiveClasses, getLiveClass, getRoomToken };
