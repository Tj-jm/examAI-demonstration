const asyncHandler = require("express-async-handler");
const LiveClass = require("../../models/liveClassModel");
const WebinarGuest = require("../../models/webinarGuestModel");
const AppSettings = require("../../models/appSettingsModel");
const liveClassAdapter = require("../../adapters/liveClass");
const email = require("../../adapters/email");
const sms = require("../../adapters/sms");
const { generateOtp } = require("../../utils/generateOtp");
const { normalisePhone, phoneCountry } = require("../../utils/guardian");
const { findAbuse } = require("../../utils/abuseWords");
const { looksLikeBot } = require("../../utils/botTrap");
const { saveLead } = require("../../utils/leads");
const { guestToken, readGuestToken, codeHash, replayOf, checkGoogle } = require("../../utils/webinar");

// Public webinars: an in-app class shared by link (/w/<slug> in the student
// app). Anyone joins as a guest, audience only: watch, listen, ask
// questions, answer polls. Their details go to Leads.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_MINUTES = 5;
const OTP_TRIES = 5;

const bySlug = async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase().slice(0, 80);
  const liveClass = slug && (await LiveClass.findOne({ "public.slug": slug, "public.on": true, provider: "livekit" }));
  if (!liveClass) {
    res.status(404);
    throw new Error("This webinar link isn't open.");
  }
  return liveClass;
};

const ipOf = (req) => String(req.ip || req.headers["x-forwarded-for"] || "").split(",")[0].trim().slice(0, 64);
const deviceOf = (req) => String(req.body?.device || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

// A guest removed by a host can't come back with that device, phone or
// email. (Not by address: a school or a mobile network shares one.)
const isBanned = (liveClass, { device, phone, email: mail }) => {
  const or = [device && { device }, phone && { phone }, mail && { email: mail }].filter(Boolean);
  return or.length ? WebinarGuest.exists({ liveClass: liveClass._id, banned: true, $or: or }) : false;
};

const shapeWebinar = (lc) => ({
  slug: lc.public.slug,
  title: lc.title,
  blurb: lc.public.blurb || "",
  description: lc.description || "",
  scheduledAt: lc.scheduledAt,
  durationMinutes: lc.durationMinutes,
  status: lc.status,
  entry: lc.public.entry,
  questions: lc.public.questions,
  closed: Boolean(lc.public.closed),
  // Google's button needs the (public) client ID.
  google: process.env.GOOGLE_CLIENT_ID || null,
  replay: hasReplay(lc),
});
// After the webinar: is there a recording guests may watch?
const hasReplay = (lc) => ["ended"].includes(lc.status) && lc.public.replay !== false && Boolean(replayOf(lc));
// Who may still come in: anyone before or during; afterwards, only to
// watch the replay. Errors as a message.
const shut = (lc) => {
  if (lc.status === "cancelled") return "This webinar was cancelled.";
  if (lc.status === "ended" && !hasReplay(lc)) return "This webinar has finished.";
  if (lc.public.closed && lc.status !== "ended") return "This webinar isn't letting anyone new in.";
  return null;
};

//@desc   A public webinar's page: title, time, how to get in
//@route  GET /api/app/webinars/:slug
//@access Public
const getWebinar = asyncHandler(async (req, res) => {
  const liveClass = await bySlug(req, res);
  const { roomBranding } = require("../admin/liveClassController");
  res.status(200).json({ ...shapeWebinar(liveClass), branding: await roomBranding() });
});

// The name and contact a guest gave, checked. { name, phone, email } or { error }.
const cleanDetails = async (body, needContact) => {
  const name = String(body?.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (name.length < 2) return { error: "Please write your name." };
  if (findAbuse(name)) return { error: "Please use your real name." };
  const settings = await AppSettings.get();
  let phone = "";
  const rawPhone = String(body?.phone || "").trim();
  if (rawPhone) {
    phone = normalisePhone(rawPhone, String(body?.country || "") || phoneCountry(settings) || settings?.auth?.countries?.[0]?.code || "BD");
    if (!phone) return { error: "That phone number doesn't look right." };
  }
  const mail = String(body?.email || "").trim().toLowerCase().slice(0, 120);
  if (mail && !EMAIL.test(mail)) return { error: "That email doesn't look right." };
  if (needContact && !phone && !mail) return { error: "Please give a phone number or an email for your code." };
  return { name, phone, email: mail };
};

// Their details go to Leads once (an open webinar only when they gave a
// way to reach them).
const recordLead = async (guest, liveClass) => {
  if (guest.lead || (!guest.phone && !guest.email)) return;
  const lead = await saveLead({
    name: guest.name, phone: guest.phone, email: guest.email, batch: liveClass.batch,
    message: `Joined the webinar "${liveClass.title}".`, source: "webinar", ref: "",
  }).catch(() => null);
  if (lead) {
    guest.lead = lead._id;
    await guest.save();
  }
};

//@desc   Join a public webinar. Open entry: in straight away. Verified
//        entry: a code goes to the phone or email given, and /verify lets
//        them in.
//@route  POST /api/app/webinars/:slug/join  { name, phone?, email?, country?, device, website? }
//@access Public (rate limited)
const joinWebinar = asyncHandler(async (req, res) => {
  // A bot (utils/botTrap.js).
  if (looksLikeBot(req.body)) {
    res.status(400);
    throw new Error("Couldn't join. Try again.");
  }
  const liveClass = await bySlug(req, res);
  if (shut(liveClass)) {
    res.status(409);
    throw new Error(shut(liveClass));
  }
  if (liveClass.public.entry === "google") {
    res.status(400);
    throw new Error("Join this webinar with your Google account.");
  }
  const device = deviceOf(req);
  const ip = ipOf(req);
  const otp = liveClass.public.entry === "otp";
  const details = await cleanDetails(req.body, otp);
  if (details.error) {
    res.status(400);
    throw new Error(details.error);
  }
  if (await isBanned(liveClass, { device, ...details })) {
    res.status(403);
    throw new Error("You can't join this webinar.");
  }
  // The same device joining again keeps its guest (and its questions).
  let guest = device ? await WebinarGuest.findOne({ liveClass: liveClass._id, device }) : null;
  if (!guest) guest = new WebinarGuest({ liveClass: liveClass._id, device });
  const contactChanged = guest.phone !== details.phone || guest.email !== details.email;
  Object.assign(guest, details, { ip });
  if (!otp) {
    guest.verified = false;
    await guest.save();
    await recordLead(guest, liveClass);
    return res.status(200).json({ token: guestToken(guest), name: guest.name });
  }
  if (guest.verified && !contactChanged) {
    await guest.save();
    return res.status(200).json({ token: guestToken(guest), name: guest.name });
  }
  const code = generateOtp();
  guest.verified = false;
  await guest.save();
  guest.otpHash = codeHash(guest._id, code);
  guest.otpExpires = new Date(Date.now() + OTP_MINUTES * 60000);
  guest.otpAttempts = 0;
  await guest.save();
  const message = `Your code for the webinar "${liveClass.title.slice(0, 60)}" is ${code}. It expires in ${OTP_MINUTES} minutes.`;
  try {
    if (guest.phone) await sms.send(guest.phone, message, { code });
    else {
      const settings = await require("../../models/appSettingsModel").get();
      await email.send(guest.email, "Your webinar code", message, require("../../utils/emailLayout").render(settings, {
        title: "Your webinar code", text: `Enter this code to join "${liveClass.title.slice(0, 60)}". It works for ${OTP_MINUTES} minutes.`, code, note: "Didn't ask for it? You can ignore this email.",
      }));
    }
  } catch {
    res.status(502);
    throw new Error("We couldn't send the code just now. Try again in a minute.");
  }
  const devEcho = process.env.DEV_OTP_ECHO === "true" && process.env.NODE_ENV !== "production";
  res.status(200).json({ codeSent: true, to: guest.phone ? "phone" : "email", guest: String(guest._id), ...(devEcho ? { devOtp: code } : {}) });
});

//@desc   The code from /join, for a verified webinar
//@route  POST /api/app/webinars/:slug/verify  { guest, code }
//@access Public (rate limited)
const verifyWebinar = asyncHandler(async (req, res) => {
  const liveClass = await bySlug(req, res);
  const mongoose = require("mongoose");
  const id = String(req.body?.guest || "");
  const guest = mongoose.isValidObjectId(id) && (await WebinarGuest.findOne({ _id: id, liveClass: liveClass._id }).select("+otpHash"));
  if (!guest || guest.banned || !guest.otpHash) {
    res.status(400);
    throw new Error("Ask for a new code.");
  }
  if (guest.otpExpires < new Date() || guest.otpAttempts >= OTP_TRIES) {
    res.status(400);
    throw new Error("That code has expired. Ask for a new one.");
  }
  if (codeHash(guest._id, String(req.body?.code || "").trim()) !== guest.otpHash) {
    guest.otpAttempts += 1;
    await guest.save();
    res.status(400);
    throw new Error("That code isn't right.");
  }
  guest.verified = true;
  guest.otpHash = null;
  guest.otpExpires = null;
  await guest.save();
  await recordLead(guest, liveClass);
  res.status(200).json({ token: guestToken(guest), name: guest.name });
});

//@desc   Join with a Google account: Google's button gives an ID token,
//        checked with Google. The email counts as verified.
//@route  POST /api/app/webinars/:slug/google  { credential, device }
//@access Public (rate limited)
const googleJoin = asyncHandler(async (req, res) => {
  const liveClass = await bySlug(req, res);
  if (shut(liveClass)) {
    res.status(409);
    throw new Error(shut(liveClass));
  }
  const who = await checkGoogle(req.body?.credential);
  if (!who || !who.email || !who.verified) {
    res.status(400);
    throw new Error("Google sign-in didn't work. Try again.");
  }
  const device = deviceOf(req);
  if (await isBanned(liveClass, { device, email: who.email })) {
    res.status(403);
    throw new Error("You can't join this webinar.");
  }
  let guest = await WebinarGuest.findOne({ liveClass: liveClass._id, email: who.email, banned: false });
  if (!guest) guest = new WebinarGuest({ liveClass: liveClass._id, email: who.email });
  Object.assign(guest, { name: (who.name || who.email.split("@")[0]).slice(0, 60), verified: true, ip: ipOf(req), ...(device ? { device } : {}) });
  await guest.save();
  await recordLead(guest, liveClass);
  res.status(200).json({ token: guestToken(guest), name: guest.name });
});

//@desc   The webinar's recording, after it ends
//@route  GET /api/app/webinars/:slug/replay
//@access Guest
const guestReplay = asyncHandler(async (req, res) => {
  const liveClass = req.webinar;
  const replay = hasReplay(liveClass) ? replayOf(liveClass) : null;
  if (!replay) {
    res.status(404);
    throw new Error("There's no recording to watch yet.");
  }
  res.status(200).json({ ...replay, title: liveClass.title });
});

// Guest routes: the pass from /join or /verify in the X-Guest-Token header.
// Sets req.guest, and req.student / req.params the way the classroom's
// shared Q&A and poll handlers expect (controllers/liveRoomController.js).
const guestProtect = asyncHandler(async (req, res, next) => {
  const pass = readGuestToken(req.headers["x-guest-token"]);
  const liveClass = pass && (await bySlug(req, res));
  if (!pass || String(liveClass._id) !== pass.c) {
    // 403, not 401: a guest has no account session to lose.
    res.status(403);
    throw new Error("Join the webinar first.");
  }
  const guest = await WebinarGuest.findOne({ _id: pass.g, liveClass: liveClass._id });
  if (!guest || guest.banned) {
    res.status(403);
    throw new Error("You can't join this webinar.");
  }
  req.guest = guest;
  req.webinar = liveClass;
  req.student = { _id: guest._id, name: guest.name };
  req.params.id = String(liveClass._id);
  req.params.batchId = liveClass.batch ? String(liveClass.batch) : "";
  next();
});
guestProtect.isAuthGuard = true;

//@desc   A guest's pass into the webinar's room: audience only.
//@route  POST /api/app/webinars/:slug/room-token
//@access Guest
const guestRoomToken = asyncHandler(async (req, res) => {
  const liveClass = req.webinar;
  if (liveClass.status !== "live") {
    return res.status(409).json({
      message: liveClass.status === "scheduled" ? "The webinar hasn't started yet." : "This webinar has finished.",
      waiting: liveClass.status === "scheduled",
    });
  }
  const identity = `guest:${req.guest._id}`;
  const lk = liveClassAdapter.get("livekit");
  // The guest limit: people in the room now, guests only.
  const people = await lk.participantsOrNull(liveClass.externalId).catch(() => null);
  const guests = (people || []).filter((p) => String(p.identity).startsWith("guest:") && p.identity !== identity).length;
  if (guests >= (liveClass.public.cap || 500)) {
    return res.status(409).json({ message: "The webinar is full right now. Try again in a few minutes.", full: true });
  }
  if (!(await require("../../utils/liveMonitor").roomFor(identity))) {
    return res.status(409).json({ message: "The webinar is full right now. Try again in a few minutes.", full: true });
  }
  const pass = await lk.joinToken({
    room: liveClass.externalId,
    identity,
    name: req.guest.name,
    canPublish: false,
    metadata: { role: "guest" },
  });
  if (!req.guest.joinedAt) {
    req.guest.joinedAt = new Date();
    await req.guest.save();
  }
  const { roomBranding } = require("../admin/liveClassController");
  res.status(200).json({
    ...pass,
    mode: "webinar",
    title: liveClass.title,
    questions: liveClass.public.questions,
    branding: await roomBranding(),
    recording: liveClass.recordings.some((r) => r.status === "recording"),
  });
});

module.exports = { getWebinar, joinWebinar, verifyWebinar, googleJoin, guestProtect, guestRoomToken, guestReplay };
