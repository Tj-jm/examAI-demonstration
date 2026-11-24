const mongoose = require("mongoose");

// One live class = one scheduled session on one batch. Unlike a lecture
// (a pool item assigned to many batches), a live class only ever makes
// sense for the one batch it was scheduled on, so `batch` is a single
// required ref, not an array — no assignment step needed.
//
// joinUrl is what a student sees. hostUrl is what the host uses to start
// the session — for the "manual" provider these are the same url (the
// platform never created the meeting, so there's no separate host
// control); for "zoom" they differ (join_url vs start_url). Students are
// never shown hostUrl — see controllers/app/liveClassController.js's
// shape().
const liveClassSchema = new mongoose.Schema(
  {
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      // A marketing webinar (kind "webinar", the Webinars page) has none.
      required: function () { return this.kind !== "webinar"; },
      default: null,
      index: true,
    },
    // "webinar": a public, batch-free session from the Webinars page. No
    // student notices, batch attendance or lectures; guests use its /w/
    // link. countPay: its time counts toward teacher pay.
    kind: { type: String, enum: ["class", "webinar"], default: "class", index: true },
    countPay: { type: Boolean, default: false },
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Teachers who take this class. They see it under "My classes", can
    // join it (LiveKit: as a host; Zoom: with the student link, then the
    // admin makes them co-host in Zoom) and can't edit or delete it.
    teachers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
      index: true,
    },
    // Zoom secured classes only: each teacher's own registered join link.
    teacherLinks: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          registrantId: String,
          joinUrl: { type: String, required: true },
        },
      ],
      default: [],
    },

    title: {
      type: String,
      required: [true, "Please add a title"],
      trim: true,
    },
    description: String,

    scheduledAt: {
      type: Date,
      required: [true, "Please add a scheduled time"],
    },
    durationMinutes: {
      type: Number,
      default: 60,
      min: 1,
    },

    provider: {
      type: String,
      enum: ["manual", "zoom", "livekit"],
      required: true,
      default: "manual",
    },

    // LiveKit only: "class" lets every student use camera and mic;
    // "webinar" keeps students in the audience until the host brings one
    // on stage.
    mode: { type: String, enum: ["class", "webinar"], default: "class" },
    // LiveKit only: who may share their screen besides hosts. Hosts can
    // still allow or stop it for one person from the room.
    screenShare: { type: String, enum: ["hosts", "everyone"], default: "hosts" },
    // When the after-class agent made its plan for this class (once).
    agentAfterClassAt: { type: Date, default: null },
    // Class notes the AI wrote from the captions; the teacher can edit them.
    // They go into the lecture made from the recording.
    notes: {
      markdown: { type: String, default: "" },
      status: { type: String, enum: ["none", "writing", "ready", "failed"], default: "none" },
      error: String,
      generatedAt: Date,
      editedAt: Date,
    },
    // Whiteboards the host saved during the class, as images.
    boards: { type: [{ url: String, savedAt: { type: Date, default: Date.now } }], default: [] },
    // A public webinar (in-app classes only): anyone with the link joins as
    // a guest, audience only. entry: "open" asks only a name; "otp" checks
    // a phone or email with a code. questions: guests' questions go up at
    // once, wait for a host to approve them, or are off. cap: how many
    // guests at a time. closed: the link stops letting people in.
    public: {
      on: { type: Boolean, default: false },
      slug: { type: String, trim: true, lowercase: true, maxlength: 80, default: undefined },
      // "google": Google sign-in only (needs GOOGLE_CLIENT_ID).
      entry: { type: String, enum: ["open", "otp", "google"], default: "otp" },
      // After the webinar, guests can watch its recording on the same link.
      replay: { type: Boolean, default: true },
      questions: { type: String, enum: ["open", "approve", "off"], default: "approve" },
      cap: { type: Number, min: 1, max: 100000, default: 500 },
      blurb: { type: String, trim: true, maxlength: 600, default: "" },
      closed: { type: Boolean, default: false },
    },
    // The writing pad's pages, saved as one PDF. It is attached to the
    // lecture made from the class's recording, and offered on the
    // students' class page.
    padNotes: {
      media: { type: mongoose.Schema.Types.ObjectId, ref: "Media", default: null },
      pages: Number,
      savedAt: Date,
    },

    // Recordings made with LiveKit Egress (utils/liveRecording.js). After
    // class each one is published as a lecture, kept private (staff only)
    // or deleted. With autoPublish and a chapter set, a finished recording
    // becomes a lecture on its own.
    recordings: {
      type: [
        {
          egressId: String,
          key: String, // storage key, recordings/<name>.mp4
          driver: String, // local | s3
          status: { type: String, enum: ["recording", "processing", "ready", "failed"], default: "recording" },
          startedAt: { type: Date, default: Date.now },
          endedAt: { type: Date, default: null },
          sizeBytes: { type: Number, default: null },
          durationSeconds: { type: Number, default: null },
          error: { type: String, default: null },
          decision: { type: String, enum: ["pending", "published", "private", "deleted"], default: "pending" },
          lecture: { type: mongoose.Schema.Types.ObjectId, ref: "Lecture", default: null },
          media: { type: mongoose.Schema.Types.ObjectId, ref: "Media", default: null },
          // Sent to a video provider (Settings → Live classroom): students
          // then watch it in that provider's player. key is the provider's
          // video id; removedCopy once the file on the server is gone.
          sent: {
            to: { type: String, default: null },
            status: { type: String, enum: ["sending", "sent", "failed"], default: null },
            key: { type: String, default: null },
            error: { type: String, default: null },
            startedAt: { type: Date, default: null },
            removedCopy: { type: Boolean, default: false },
          },
        },
      ],
      default: [],
    },
    autoPublish: { type: Boolean, default: false },
    publishChapter: { type: mongoose.Schema.Types.ObjectId, ref: "Chapter", default: null },

    // Zoom-only. Emails of staff granted host controls on this meeting
    // alongside the scheduling host — Zoom's own "alternative hosts"
    // feature. Each must be a licensed user on the same Zoom account or
    // meeting creation fails outright (see ZOOM_SETUP.md). Stored here so
    // the admin panel can show/re-edit who was actually granted this,
    // separately from re-deriving it from the batch's current teacher
    // list, which may have changed since.
    alternativeHosts: { type: [String], default: [] },

    // Tier 3 ("Secured"). Zoom-only, requires provider "zoom". Turns the
    // shared joinUrl into Zoom's registration flow — every active student
    // gets their own personal join link, tied to their email, that only
    // they can use. Closes the "anyone I forward the link to can join"
    // gap the open tiers have. See registrants below for who actually got
    // one and controllers/app/liveClassController.js for how a student's
    // own link is resolved.
    secured: { type: Boolean, default: false },

    // One entry per active student who was registered with Zoom for this
    // meeting — bulk-populated at creation time, and lazily topped up (see
    // the app controller) for anyone who gained batch access afterward.
    // joinUrl here is that student's own personal link — never the shared
    // one, and Zoom only lets that exact link (not any other registrant's)
    // actually join once registration is enabled.
    registrants: {
      type: [
        {
          student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
          registrantId: { type: String, required: true },
          joinUrl: { type: String, required: true },
          registeredAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    joinUrl: { type: String, default: null },
    hostUrl: { type: String, default: null },
    // The provider's own meeting id (Zoom's numeric id) — null for manual,
    // since there's no external meeting the platform itself created. Kept
    // so a later webhook (attendance, auto-end) can be matched back to
    // this document.
    externalId: { type: String, default: null },

    status: {
      type: String,
      enum: ["scheduled", "live", "ended", "cancelled"],
      default: "scheduled",
    },
    // When it went live, and when anyone was last in its room (in-app
    // classes, from the attendance sweep). An in-app class whose room stays
    // empty is ended by the sweep (utils/liveAttendance.js).
    liveSince: { type: Date, default: null },
    occupiedAt: { type: Date, default: null },
    // When it ended or was cancelled, for class pay (utils/classPay.js).
    endedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    // Set once, if the host uploads or links a recording after the fact.
    // Not fetched automatically from any provider — a manual step for now.
    recordingUrl: { type: String, default: null },

    // Populated only for provider "zoom", via Zoom's webhook events
    // (participant_joined/participant_left) — see
    // controllers/webhooks/zoomWebhookController.js. Not authoritative
    // attendance: the join link isn't per-student (no Zoom "registrant"
    // flow), so this is whatever display name/email the participant's own
    // Zoom client happened to report, not a verified match to a Student
    // document. Good enough for an admin eyeballing who showed up; not
    // good enough to auto-mark attendance against a student record.
    attendance: {
      type: [
        {
          participantName: String,
          participantEmail: String,
          externalParticipantId: String, // Zoom's own per-session participant id
          joinedAt: Date,
          leftAt: { type: Date, default: null },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// The one query this collection actually serves on the student side: "what's
// coming up / live on this batch", newest-scheduled first for the admin list.
liveClassSchema.index({ batch: 1, scheduledAt: -1 });
liveClassSchema.index({ "public.slug": 1 }, { unique: true, partialFilterExpression: { "public.slug": { $type: "string" } } });

module.exports = mongoose.model("LiveClass", liveClassSchema);
