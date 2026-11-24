const asyncHandler = require("express-async-handler");
const LiveClass = require("../../models/liveClassModel");
const Batch = require("../../models/batchModel");
const Student = require("../../models/studentModel");
const liveClassAdapter = require("../../adapters/liveClass");
const { notify } = require("../../utils/notify");
const { getActiveBatchStudentIds } = require("../../utils/batchMembers");

const isTeacher = (req) => req.user.role === "teacher";
const assignedTo = (liveClass, user) => (liveClass.teachers || []).some((t) => String(t?._id || t) === String(user._id));

// A teacher sees and joins only the classes they're assigned to; owner and
// admin see every class. Sets res.status itself before throwing, matching
// this project's convention (errorMiddleware reads res.statusCode).
const assertCanSee = (req, res, liveClass) => {
  if (isTeacher(req) && !assignedTo(liveClass, req.user)) {
    res.status(403);
    throw new Error("You are not assigned to this class.");
  }
};

// Scheduling, editing, deleting and publishing stay with owner/admin.
const assertAdmin = (req, res) => {
  if (isTeacher(req)) {
    res.status(403);
    throw new Error("Only an admin can do this.");
  }
};

// Settings → Live classroom: what an assigned teacher may do in the room.
const teacherRules = async () => {
  const AppSettings = require("../../models/appSettingsModel");
  const room = (await AppSettings.get()).liveRoom || {};
  return {
    start: room.teacherCanStart !== false,
    earlyMinutes: Number.isFinite(room.teacherEarlyMinutes) ? room.teacherEarlyMinutes : 10,
    record: room.teacherCanRecord !== false,
    end: room.teacherCanEnd !== false,
  };
};

// Only real, active teacher accounts can be assigned.
const cleanTeachers = async (ids) => {
  if (!Array.isArray(ids)) return [];
  const User = require("../../models/userModel");
  const wanted = [...new Set(ids.map(String))].filter((id) => /^[a-f0-9]{24}$/i.test(id));
  const users = await User.find({ _id: { $in: wanted }, role: "teacher", isDeleted: { $ne: true } }).select("_id");
  return users.map((u) => u._id);
};

// What a teacher gets back: no host link, no other people's join links.
const forTeacher = (liveClass, user) => {
  const doc = liveClass.toObject ? liveClass.toObject() : { ...liveClass };
  delete doc.hostUrl;
  delete doc.registrants;
  delete doc.alternativeHosts;
  const mine = (doc.teacherLinks || []).find((l) => String(l.user) === String(user._id));
  delete doc.teacherLinks;
  if (doc.secured) doc.joinUrl = mine?.joinUrl || null;
  return doc;
};

const pastFilter = (now = new Date()) => ({
  $or: [{ status: "ended" }, { status: { $in: ["scheduled", "live"] }, scheduledAt: { $lt: now } }],
});

//@desc   List live classes (teachers see only classes they're assigned to)
//@route  GET /api/live-classes?batch=&status=&teacher=&when=upcoming|past&page=&limit=
//@access Private
const getLiveClasses = asyncHandler(async (req, res) => {
  const { batch, status, teacher, when, kind } = req.query;
  const query = {};
  if (batch) query.batch = batch;
  // Webinars (no batch) have their own page; a teacher's list shows both.
  if (kind === "webinar") query.kind = "webinar";
  else if (!isTeacher(req)) query.kind = { $ne: "webinar" };
  if (status) query.status = status;
  if (isTeacher(req)) query.teachers = req.user._id;
  else if (teacher) query.teachers = teacher;

  const now = new Date();
  if (when === "upcoming") {
    query.status = { $in: ["scheduled", "live"] };
    query.$or = [{ status: "live" }, { scheduledAt: { $gte: new Date(now.getTime() - 6 * 3600000) } }];
  } else if (when === "past") {
    query.status = { $ne: "cancelled" };
    query.$and = [pastFilter(now)];
  }

  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [liveClasses, total] = await Promise.all([
    LiveClass.find(query)
      .populate("batch", "name")
      .populate("host", "name email")
      .populate("teachers", "name email")
      .sort({ scheduledAt: when === "upcoming" ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LiveClass.countDocuments(query),
  ]);

  res.status(200).json({
    liveClasses: isTeacher(req) ? liveClasses.map((lc) => forTeacher(lc, req.user)) : liveClasses,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

//@desc   Get one live class
//@route  GET /api/live-classes/:id
//@access Private
const getLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id)
    .populate("batch", "name")
    .populate("host", "name email")
    .populate("teachers", "name email");

  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }

  assertCanSee(req, res, liveClass);
  if (isTeacher(req)) return res.status(200).json({ ...forTeacher(liveClass, req.user), can: await teacherRules() });
  res.status(200).json(liveClass);
});

//@desc   A teacher's way in. LiveKit: open the room (the panel does that).
//        Zoom or a manual link: the student link, never the host link; on a
//        secured Zoom class, the teacher's own registered link.
//@route  POST /api/live-classes/:id/join
//@access Private
const joinAsTeacher = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id);
  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }
  assertCanSee(req, res, liveClass);
  if (["ended", "cancelled"].includes(liveClass.status)) {
    res.status(409);
    throw new Error(`This class was ${liveClass.status}.`);
  }
  if (liveClass.provider === "livekit") return res.status(200).json({ room: true });
  if (!liveClass.secured) return res.status(200).json({ joinUrl: liveClass.joinUrl });

  const mine = liveClass.teacherLinks.find((l) => String(l.user) === String(req.user._id));
  if (mine) return res.status(200).json({ joinUrl: mine.joinUrl });
  if (!req.user.email) {
    res.status(400);
    throw new Error("Your account has no email, which this secured Zoom class needs. Ask an admin.");
  }
  const [firstName, ...rest] = (req.user.name || "Teacher").split(" ");
  try {
    const result = await liveClassAdapter.get("zoom").registerParticipant({
      meetingId: liveClass.externalId,
      email: req.user.email,
      firstName,
      lastName: rest.join(" "),
    });
    liveClass.teacherLinks.push({ user: req.user._id, registrantId: result.registrantId, joinUrl: result.joinUrl });
    await liveClass.save();
    res.status(200).json({ joinUrl: result.joinUrl });
  } catch (error) {
    res.status(502);
    throw new Error(`Zoom couldn't register you for this class: ${error.message}`);
  }
});

//@desc   Classes taught, for paying teachers: one row per class and teacher,
//        with the minutes each teacher was actually in the class.
//        Teachers get only their own rows. ?format=csv downloads it.
//@route  GET /api/live-classes/taught?teacher=&from=&to=&format=
//@access Private
const getTaught = asyncHandler(async (req, res) => {
  const User = require("../../models/userModel");
  const LiveAttendance = require("../../models/liveAttendanceModel");
  const now = new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = req.query.to ? new Date(req.query.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400);
    throw new Error("from and to must be dates.");
  }

  const teacherId = isTeacher(req) ? String(req.user._id) : req.query.teacher ? String(req.query.teacher) : null;
  if (teacherId && !/^[a-f0-9]{24}$/i.test(teacherId)) {
    res.status(400);
    throw new Error("teacher must be an id.");
  }
  const query = {
    status: { $ne: "cancelled" },
    scheduledAt: { $gte: from, $lte: to },
    ...pastFilter(now),
    teachers: teacherId || { $exists: true, $ne: [] },
  };
  const classes = await LiveClass.find(query)
    .select("title batch provider scheduledAt durationMinutes status teachers attendance liveSince updatedAt")
    .populate("batch", "name")
    .sort({ scheduledAt: 1 })
    .limit(5000)
    .lean();

  const teacherIds = [...new Set(classes.flatMap((c) => c.teachers.map(String)))].filter((id) => !teacherId || id === teacherId);
  const people = await User.find({ _id: { $in: teacherIds } }).select("name email").lean();
  const byId = new Map(people.map((u) => [String(u._id), u]));

  // In-app classes: exact minutes per person, and how many students came.
  const inApp = classes.filter((c) => c.provider === "livekit").map((c) => c._id);
  // Same count as utils/liveAttendance's secondsOf: an open stretch runs to now.
  const secondsOf = (d) => {
    const last = d.sessions[d.sessions.length - 1];
    return (d.totalSeconds || 0) + (last && !last.leftAt ? Math.max(0, Math.round((now - new Date(last.joinedAt)) / 1000)) : 0);
  };
  const hostMinutes = new Map();
  for (const d of await LiveAttendance.find({ liveClass: { $in: inApp }, user: { $in: teacherIds } }).lean()) {
    hostMinutes.set(`${d.liveClass}:${d.user}`, Math.round(secondsOf(d) / 60));
  }
  const studentCounts = new Map(
    (await LiveAttendance.aggregate([{ $match: { liveClass: { $in: inApp }, role: "student" } }, { $group: { _id: "$liveClass", n: { $sum: 1 } } }]))
      .map((r) => [String(r._id), r.n])
  );

  // Zoom: best effort, from the webhook's join/leave times, matched by the
  // teacher's email or name.
  const zoomMinutes = (c, user) => {
    const email = (user.email || "").toLowerCase();
    const name = (user.name || "").trim().toLowerCase();
    const end = c.status === "ended" ? new Date(c.updatedAt) : now;
    const seconds = (c.attendance || [])
      .filter((a) => (email && (a.participantEmail || "").toLowerCase() === email) || (name && (a.participantName || "").trim().toLowerCase() === name))
      .reduce((sum, a) => sum + Math.max(0, (new Date(a.leftAt || end) - new Date(a.joinedAt)) / 1000), 0);
    return Math.round(seconds / 60);
  };

  const rows = [];
  for (const c of classes) {
    for (const t of c.teachers.map(String)) {
      if (!teacherIds.includes(t)) continue;
      const user = byId.get(t) || { name: "Removed teacher" };
      let minutes = null;
      let students = null;
      if (c.provider === "livekit") {
        minutes = hostMinutes.get(`${c._id}:${t}`) || 0;
        students = studentCounts.get(String(c._id)) || 0;
      } else if (c.provider === "zoom") {
        minutes = zoomMinutes(c, user);
        students = new Set((c.attendance || []).map((a) => a.externalParticipantId || a.participantName)).size;
      }
      rows.push({
        liveClass: c._id,
        title: c.title,
        batch: c.batch?.name || "",
        provider: c.provider,
        scheduledAt: c.scheduledAt,
        status: c.status,
        teacher: { _id: t, name: user.name, email: user.email },
        scheduledMinutes: c.durationMinutes || 60,
        minutesTaught: minutes,
        students,
      });
    }
  }

  const summary = {
    classes: rows.length,
    scheduledMinutes: rows.reduce((a, r) => a + r.scheduledMinutes, 0),
    minutesTaught: rows.reduce((a, r) => a + (r.minutesTaught || 0), 0),
  };

  if (req.query.format === "csv") {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Date", "Class", "Batch", "Provider", "Teacher", "Email", "Scheduled minutes", "Minutes taught", "Students", "Status"].join(",")];
    for (const r of rows) {
      lines.push([esc(new Date(r.scheduledAt).toISOString()), esc(r.title), esc(r.batch), r.provider, esc(r.teacher.name), esc(r.teacher.email), r.scheduledMinutes, r.minutesTaught ?? "", r.students ?? "", r.status].join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="classes-taught-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(lines.join("\n"));
  }

  res.status(200).json({ from, to, rows, summary });
});

//@desc   Schedule a live class
//@route  POST /api/live-classes
//@access Private
const createLiveClass = asyncHandler(async (req, res) => {
  const {
    batch, title, description, scheduledAt, durationMinutes, provider, joinUrl, alternativeHosts, secured, mode, screenShare,
    autoPublish, publishChapter, teachers,
  } = req.body;

  const webinar = req.body.kind === "webinar";
  if ((!webinar && !batch) || !title || !scheduledAt) {
    res.status(400);
    throw new Error(webinar ? "title and scheduledAt are required." : "batch, title, and scheduledAt are required.");
  }

  assertAdmin(req, res);

  // A webinar: in-app, public by link, no batch.
  const batchDoc = webinar ? null : await Batch.findById(batch);
  if (!webinar && !batchDoc) {
    res.status(404);
    throw new Error("Batch not found.");
  }
  if (batchDoc && !batchDoc.hasFeature("liveClasses")) {
    res.status(400);
    throw new Error("Live classes are not enabled for this batch.");
  }

  const chosenProvider = webinar ? "livekit" : provider || "manual";
  const adapter = liveClassAdapter.get(chosenProvider);
  if (!adapter.configured()) {
    res.status(400);
    throw new Error(`${adapter.label} is not configured on this platform.`);
  }

  // Secured (Tier 3) only makes sense with a real Zoom meeting behind it —
  // the manual provider has no API to register anyone against.
  const wantsSecured = !webinar && Boolean(secured);
  if (wantsSecured && chosenProvider !== "zoom") {
    res.status(400);
    throw new Error("Secured live classes require the Zoom provider.");
  }

  const cleanAlternativeHosts =
    chosenProvider === "zoom" && Array.isArray(alternativeHosts)
      ? [...new Set(alternativeHosts.map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
      : [];

  // Not given: the batch's teachers take the class.
  const assigned = await cleanTeachers(Array.isArray(teachers) ? teachers : batchDoc?.teachers || []);

  const created = await adapter.createMeeting({
    title,
    scheduledAt,
    durationMinutes: durationMinutes || 60,
    joinUrl,
    alternativeHosts: cleanAlternativeHosts,
    secured: wantsSecured,
  });

  const liveClass = await LiveClass.create({
    batch: webinar ? null : batch,
    kind: webinar ? "webinar" : "class",
    countPay: webinar && Boolean(req.body.countPay),
    host: req.user._id,
    teachers: assigned,
    title,
    description,
    scheduledAt,
    durationMinutes: durationMinutes || 60,
    provider: chosenProvider,
    joinUrl: created.joinUrl,
    hostUrl: created.hostUrl,
    externalId: created.externalId,
    alternativeHosts: cleanAlternativeHosts,
    secured: wantsSecured,
    mode: webinar || (chosenProvider === "livekit" && mode === "webinar") ? "webinar" : "class",
    screenShare: screenShare === "everyone" ? "everyone" : "hosts",
    autoPublish: !webinar && chosenProvider === "livekit" && Boolean(autoPublish) && Boolean(publishChapter),
    publishChapter: !webinar && chosenProvider === "livekit" && publishChapter ? publishChapter : null,
  });
  // A public webinar link, when asked for; a webinar always has one.
  if (webinar || req.body.public?.on) {
    const r = await require("../../utils/webinar").applyPublic(liveClass, { ...(req.body.public || {}), on: true });
    if (!r.error) await liveClass.save();
  }

  let registrationSummary = null;
  if (wantsSecured) {
    registrationSummary = await registerActiveStudents(liveClass, adapter);
  }

  const studentIds = webinar ? [] : await getActiveBatchStudentIds(batch);
  if (studentIds.length) await notify(studentIds, "liveClassScheduled", {
    title: `New live class: ${title}`,
    body: `Scheduled for ${new Date(scheduledAt).toLocaleString()}`,
    link: `/batches/${batch}/live-classes/${liveClass._id}`,
  });

  res.status(201).json({ ...liveClass.toObject(), registrationSummary });
});

// Bulk-registers every currently active student on the batch as a Zoom
// meeting registrant, so the class opens with the roster already in
// place rather than everyone hitting lazy registration on first click.
// Sequential and small-batch-safe on purpose: Zoom's registrant endpoint
// is rate-limited per account, and a class roster in the tens-to-low-
// hundreds is the realistic ceiling here — a large enough batch could
// still take a noticeable few seconds, which is why this happens after
// the LiveClass document already exists rather than blocking its creation
// on every registrant call succeeding.
const registerActiveStudents = async (liveClass, adapter) => {
  const studentIds = await getActiveBatchStudentIds(liveClass.batch);
  const students = await Student.find({ _id: { $in: studentIds } }).select("name email");

  let registered = 0;
  let skippedNoEmail = 0;
  let failed = 0;

  for (const student of students) {
    if (!student.email) {
      skippedNoEmail += 1;
      continue;
    }

    try {
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
      registered += 1;
    } catch (error) {
      // One bad registration (a malformed email Zoom rejects, a transient
      // API error) must not lose every other student's spot — that
      // student falls through to lazy registration on their own first
      // visit instead (see the app controller). Logged (was previously
      // swallowed silently) so a plan/config problem affecting the whole
      // roster is actually visible instead of just a "failed" count with
      // no reason.
      console.error(`Zoom registration failed for live class ${liveClass._id}, student ${student._id}:`, error.message);
      failed += 1;
    }
  }

  await liveClass.save();
  return { registered, skippedNoEmail, failed, totalActive: studentIds.length };
};

//@desc   Update a live class (reschedule, edit, cancel)
//@route  PUT /api/live-classes/:id
//@access Private
const updateLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id);
  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }

  assertAdmin(req, res);

  const webinar = liveClass.kind === "webinar";
  const UPDATABLE = ["title", "description", "scheduledAt", "durationMinutes", "status", ...(webinar ? [] : ["autoPublish", "publishChapter"])];
  const wasStatus = liveClass.status;
  for (const key of UPDATABLE) {
    if (req.body[key] !== undefined) liveClass[key] = req.body[key];
  }
  // When, for class pay (utils/classPay.js).
  if (liveClass.status !== wasStatus) {
    if (liveClass.status === "cancelled") liveClass.cancelledAt = new Date();
    if (liveClass.status === "ended") liveClass.endedAt = liveClass.endedAt || new Date();
  }
  if (req.body.teachers !== undefined) liveClass.teachers = await cleanTeachers(req.body.teachers);
  // The public webinar link and its rules.
  if (webinar && req.body.countPay !== undefined) liveClass.countPay = Boolean(req.body.countPay);
  if (req.body.public !== undefined) {
    // A webinar's link can't be switched off: it's the only way in.
    const r = await require("../../utils/webinar").applyPublic(liveClass, webinar ? { ...req.body.public, on: true } : req.body.public);
    if (r.error) {
      res.status(400);
      throw new Error(r.error);
    }
  }

  await liveClass.save();
  res.status(200).json(liveClass);
});

//@desc   Delete a live class
//@route  DELETE /api/live-classes/:id
//@access Private
const deleteLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id);
  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }

  assertAdmin(req, res);
  await liveClass.deleteOne();
  res.status(200).json({ id: req.params.id });
});

//@desc   Host starts the class
//@route  PUT /api/live-classes/:id/start
//@access Private
const startLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id);
  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }

  assertAdmin(req, res);

  liveClass.status = "live";
  liveClass.liveSince = liveClass.liveSince || new Date();
  await liveClass.save();
  res.status(200).json(liveClass);
});

//@desc   Host ends the class
//@route  PUT /api/live-classes/:id/end
//@access Private
const endLiveClass = asyncHandler(async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id);
  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }

  assertCanSee(req, res, liveClass);
  if (isTeacher(req) && (liveClass.provider !== "livekit" || !(await teacherRules()).end)) {
    res.status(403);
    throw new Error("Only an admin can end this class.");
  }

  await require("../../utils/liveEnd").endClass(liveClass, { user: req.user._id });
  res.status(200).json(liveClass);
});

//@desc   Which providers this platform offers, and which are set up
//@route  GET /api/live-classes/providers
//@access Private
const getProviders = asyncHandler(async (req, res) => {
  res.status(200).json({ providers: liveClassAdapter.list() });
});

// The LiveKit class behind :id, for its room endpoints below.
const loadRoom = async (req, res) => {
  const liveClass = await LiveClass.findById(req.params.id);
  if (!liveClass) {
    res.status(404);
    throw new Error("Live class not found.");
  }
  assertCanSee(req, res, liveClass);
  if (liveClass.provider !== "livekit") {
    res.status(400);
    throw new Error("This class doesn't use the in-app classroom.");
  }
  return liveClass;
};

//@desc   A host's pass into the classroom. Opening it starts the class.
//@route  POST /api/live-classes/:id/room-token
//@access Private
const getHostToken = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  if (["ended", "cancelled"].includes(liveClass.status)) {
    res.status(409);
    throw new Error(`This class was ${liveClass.status}.`);
  }
  const rules = await teacherRules();
  if (liveClass.status !== "live") {
    if (isTeacher(req)) {
      if (!rules.start) {
        res.status(409);
        throw new Error("The class opens when an admin starts it. Try again in a moment.");
      }
      const opensAt = new Date(liveClass.scheduledAt).getTime() - rules.earlyMinutes * 60000;
      if (Date.now() < opensAt) {
        res.status(409);
        throw new Error(`You can open this class from ${new Date(opensAt).toLocaleString()} (${rules.earlyMinutes} minutes before it starts).`);
      }
    }
    liveClass.status = "live";
    liveClass.liveSince = new Date();
    await liveClass.save();
  }
  const pass = await liveClassAdapter.get("livekit").joinToken({
    room: liveClass.externalId,
    identity: `staff:${req.user._id}`,
    name: req.user.name || "Host",
    host: true,
    metadata: { role: "host" },
  });
  res.status(200).json({
    ...pass,
    mode: liveClass.mode,
    title: liveClass.title,
    status: liveClass.status,
    screenShare: liveClass.screenShare,
    branding: await roomBranding(),
    role: isTeacher(req) ? "teacher" : "admin",
    can: isTeacher(req) ? { record: rules.record, end: rules.end } : { record: true, end: true },
  });
});

// The classroom's look, from Settings → Student app → Live classroom.
const roomBranding = async () => {
  const AppSettings = require("../../models/appSettingsModel");
  const settings = await AppSettings.get();
  const room = settings.liveRoom?.toObject?.() || settings.liveRoom || {};
  return { ...room, logo: room.logo || settings.logo || null, siteName: settings.siteName };
};

const isStudent = (info) => {
  try {
    return JSON.parse(info.metadata || "{}").role === "student";
  } catch {
    return false;
  }
};

//@desc   What one person may share: { camera, mic, screen }
//@route  PUT /api/live-classes/:id/room/participants/:identity/permissions
//@access Private
const setPermissions = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  const rights = { camera: Boolean(req.body.camera), mic: Boolean(req.body.mic), screen: Boolean(req.body.screen) };
  await liveClassAdapter.get("livekit").setPermissions(liveClass.externalId, req.params.identity, rights);
  res.status(200).json({ identity: req.params.identity, ...rights });
});

//@desc   Turn off someone's mic, camera or screen share
//@route  POST /api/live-classes/:id/room/participants/:identity/mute  { source: "mic" | "camera" | "screen" }
//@access Private
const muteParticipant = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  if (!["mic", "camera", "screen"].includes(req.body.source)) {
    res.status(400);
    throw new Error("source must be mic, camera or screen.");
  }
  const muted = await liveClassAdapter.get("livekit").muteSource(liveClass.externalId, req.params.identity, req.body.source);
  res.status(200).json({ muted });
});

//@desc   Mute every student's mic, or stop every student's screen share
//@route  POST /api/live-classes/:id/room/mute-all  { source: "mic" | "screen" }
//@access Private
const muteAll = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  const source = req.body.source === "screen" ? "screen" : "mic";
  const lk = liveClassAdapter.get("livekit");
  let count = 0;
  for (const p of await lk.participants(liveClass.externalId)) {
    if (!isStudent(p)) continue;
    count += await lk.muteSource(liveClass.externalId, p.identity, source).catch(() => 0);
  }
  res.status(200).json({ muted: count });
});

//@desc   Change who may share their screen; applied to everyone already in
//        the room who can publish (a class, or a webinar's stage)
//@route  PUT /api/live-classes/:id/room/settings  { screenShare: "hosts" | "everyone" }
//@access Private
const updateRoomSettings = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  if (!["hosts", "everyone"].includes(req.body.screenShare)) {
    res.status(400);
    throw new Error("screenShare must be hosts or everyone.");
  }
  liveClass.screenShare = req.body.screenShare;
  await liveClass.save();
  const lk = liveClassAdapter.get("livekit");
  for (const p of await lk.participants(liveClass.externalId)) {
    if (!isStudent(p) || !p.permission?.canPublish) continue;
    const rights = lk.rightsOf(p);
    await lk.setPermissions(liveClass.externalId, p.identity, { ...rights, screen: liveClass.screenShare === "everyone" }).catch(() => {});
  }
  res.status(200).json({ screenShare: liveClass.screenShare });
});

//@desc   Webinar: bring someone on stage, or back to the audience
//@route  PUT /api/live-classes/:id/room/participants/:identity/speaker  { canSpeak }
//@access Private
const setSpeaker = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  await liveClassAdapter.get("livekit").setSpeaker(liveClass.externalId, req.params.identity, req.body.canSpeak, liveClass.screenShare === "everyone");
  res.status(200).json({ identity: req.params.identity, canSpeak: Boolean(req.body.canSpeak) });
});

//@desc   Remove someone from the room
//@route  DELETE /api/live-classes/:id/room/participants/:identity
//@access Private
const removeParticipant = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  // A webinar guest removed is banned too, or they'd just join again.
  const [kind, guestId] = String(req.params.identity).split(":");
  if (kind === "guest" && require("mongoose").isValidObjectId(guestId)) {
    await require("../../models/webinarGuestModel").updateOne({ _id: guestId, liveClass: liveClass._id }, { banned: true });
  }
  await liveClassAdapter.get("livekit").removeParticipant(liveClass.externalId, req.params.identity);
  res.status(200).json({ identity: req.params.identity, removed: true });
});

//@desc   Who attended an in-app class: each person's time in the room,
//        plus the batch's students who never joined. ?format=csv downloads it.
//@route  GET /api/live-classes/:id/attendance
//@access Private
const getAttendance = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  const attendance = require("../../utils/liveAttendance");
  const LiveAttendance = require("../../models/liveAttendanceModel");
  if (liveClass.status === "live") await attendance.sweepClass(liveClass).catch(() => {});
  const now = new Date();
  const docs = await LiveAttendance.find({ liveClass: liveClass._id }).lean();
  const rows = docs
    .filter((d) => attendance.isPerson(d.identity))
    .map((d) => ({
      identity: d.identity,
      student: d.student,
      name: d.name,
      role: d.role,
      firstJoined: d.sessions[0]?.joinedAt || null,
      lastLeft: d.sessions.every((s) => s.leftAt) ? d.sessions[d.sessions.length - 1]?.leftAt : null,
      here: d.sessions.some((s) => !s.leftAt),
      sessions: d.sessions.length,
      minutes: Math.round(attendance.secondsOf(d, now) / 60),
    }))
    .sort((a, b) => (a.role === b.role ? b.minutes - a.minutes : a.role === "host" ? -1 : 1));

  const attended = new Set(rows.filter((r) => r.student).map((r) => String(r.student)));
  const activeIds = await getActiveBatchStudentIds(liveClass.batch);
  const absentIds = activeIds.filter((id) => !attended.has(String(id))).slice(0, 5000);
  const absent = await Student.find({ _id: { $in: absentIds } }).select("name email phoneNumber").lean();
  const scheduledMinutes = liveClass.durationMinutes || 60;

  if (req.query.format === "csv") {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Name", "Role", "Status", "Minutes", "Joined", "Left", "Times joined"].join(",")];
    for (const r of rows) {
      lines.push([esc(r.name), r.role, r.here ? "in the room" : "attended", r.minutes, esc(r.firstJoined?.toISOString?.() || r.firstJoined || ""), esc(r.lastLeft?.toISOString?.() || r.lastLeft || ""), r.sessions].join(","));
    }
    for (const s of absent) lines.push([esc(s.name || s.email || s.phoneNumber), "student", "absent", 0, "", "", 0].join(","));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-${liveClass._id}.csv"`);
    return res.status(200).send(lines.join("\n"));
  }

  res.status(200).json({
    liveClass: { _id: liveClass._id, title: liveClass.title, status: liveClass.status, scheduledAt: liveClass.scheduledAt, durationMinutes: scheduledMinutes },
    rows,
    absent,
    summary: {
      attended: rows.filter((r) => r.role === "student").length,
      absent: absent.length,
      averageMinutes: Math.round(rows.filter((r) => r.role === "student").reduce((a, r) => a + r.minutes, 0) / Math.max(1, rows.filter((r) => r.role === "student").length)),
    },
  });
});

//@desc   Keep a saved whiteboard image with the class
//@route  POST /api/live-classes/:id/boards  { url }
//@access Private
const saveBoard = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  const url = String(req.body.url || "");
  if (!url) {
    res.status(400);
    throw new Error("url is required.");
  }
  liveClass.boards.push({ url });
  await liveClass.save();
  res.status(201).json({ boards: liveClass.boards });
});

//@desc   The writing pad's pages as one PDF, kept as the class's notes.
//        Saving again replaces the earlier PDF.
//@route  POST /api/live-classes/:id/pad-notes  { media: [image media ids, in order] }
//@access Private
const savePadNotes = asyncHandler(async (req, res) => {
  const mongoose = require("mongoose");
  const Media = require("../../models/mediaModel");
  const storage = require("../../adapters/storage");
  const { PDFDocument } = require("pdf-lib");
  const liveClass = await loadRoom(req, res);
  const ids = (Array.isArray(req.body.media) ? req.body.media : []).map(String).filter((id) => mongoose.isValidObjectId(id)).slice(0, 80);
  const found = new Map((await Media.find({ _id: { $in: ids }, kind: "image" })).map((m) => [String(m._id), m]));
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${liveClass.title} - class notes`);
  for (const id of ids) {
    const m = found.get(id);
    if (!m) continue;
    const bytes = await storage.get(m.key, m.driver).catch(() => null);
    if (!bytes) continue;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpg) continue;
    const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    // A landscape A4 width, the page as tall as the picture needs.
    const w = 842;
    const h = Math.round((w * img.height) / img.width);
    pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  const pages = pdf.getPageCount();
  if (!pages) {
    res.status(400);
    throw new Error("There are no pages to save.");
  }
  const stored = await storage.storeGenerated("lectures", Buffer.from(await pdf.save()), "application/pdf");
  const media = await Media.create({
    title: `${liveClass.title} - class notes.pdf`,
    kind: "pdf",
    driver: stored.driver,
    key: stored.key,
    sizeBytes: stored.sizeBytes,
    mimeType: "application/pdf",
    uploadedBy: req.user._id,
  });
  const old = liveClass.padNotes?.media ? String(liveClass.padNotes.media) : null;
  liveClass.padNotes = { media: media._id, pages, savedAt: new Date() };
  await liveClass.save();

  // Lectures already made from the class's recordings get the new PDF in
  // place of the old one. (One made later gets it when it is made.)
  const Lecture = require("../../models/lectureModel");
  const lectureIds = (liveClass.recordings || []).filter((r) => r.lecture && r.decision !== "deleted").map((r) => r.lecture);
  const lectures = lectureIds.length ? await Lecture.find({ _id: { $in: lectureIds } }) : [];
  for (const lecture of lectures) {
    const kept = (lecture.attachments || []).filter((a) => String(a) !== old && String(a) !== String(media._id));
    lecture.attachments = [...kept, media._id];
    await lecture.save();
  }
  res.status(201).json({ pages, savedAt: liveClass.padNotes.savedAt, url: await storage.urlFor(media.key, media.driver), lectures: lectures.length });
});

const recordingView = async (liveClass) => {
  const storage = require("../../adapters/storage");
  const rec$ = require("../../utils/liveRecording");
  const video = require("../../adapters/video");
  const { to, auto } = await rec$.choice();
  return {
    autoPublish: liveClass.autoPublish,
    publishChapter: liveClass.publishChapter,
    // Where recordings can be sent (set up with keys), and Settings' choice.
    sendTo: rec$.SENDERS.filter(rec$.canTake).map((name) => ({ name, label: video.PROVIDERS[name].label })),
    sendChoice: { to, auto },
    recording: liveClass.recordings.some((r) => r.status === "recording"),
    recordings: await Promise.all(
      liveClass.recordings
        .filter((r) => r.decision !== "deleted")
        .map(async (r) => ({
          ...(r.toObject ? r.toObject() : r),
          url: r.status === "ready" && !r.sent?.removedCopy ? await storage.urlFor(r.key, r.driver).catch(() => null) : null,
          sending: rec$.isSending(r),
        }))
    ),
  };
};

//@desc   Start recording the class (LiveKit Egress)
//@route  POST /api/live-classes/:id/recordings/start
const assertCanRecord = async (req, res) => {
  if (isTeacher(req) && !(await teacherRules()).record) {
    res.status(403);
    throw new Error("Only an admin can record this class.");
  }
};

const startRecording = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  await assertCanRecord(req, res);
  if (liveClass.status !== "live") {
    res.status(409);
    throw new Error("Start the class before recording it.");
  }
  try {
    await require("../../utils/liveRecording").start(liveClass);
  } catch (error) {
    res.status(502);
    throw new Error(`Couldn't start recording: ${error.message}. Is the LiveKit recording service (Egress) running? See LIVEKIT_SETUP.md.`);
  }
  res.status(200).json(await recordingView(liveClass));
});

//@desc   Stop recording
//@route  POST /api/live-classes/:id/recordings/stop
const stopRecording = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  await assertCanRecord(req, res);
  await require("../../utils/liveRecording").stop(liveClass);
  res.status(200).json(await recordingView(liveClass));
});

//@desc   The class's recordings, brought up to date
//@route  GET /api/live-classes/:id/recordings
const getRecordings = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  await require("../../utils/liveRecording").refresh(liveClass);
  res.status(200).json(await recordingView(liveClass));
});

//@desc   Decide what happens to a recording
//@route  PUT /api/live-classes/:id/recordings/:rid
//        { action: "publish", title?, chapter, publishNow? } | { action: "private" } | { action: "delete" }
//        | { action: "send", to: "vdocipher" | "bunny" | "vimeo" }
const decideRecording = asyncHandler(async (req, res) => {
  const liveClass = await loadRoom(req, res);
  assertAdmin(req, res);
  const rec = liveClass.recordings.id(req.params.rid);
  if (!rec || rec.decision === "deleted") {
    res.status(404);
    throw new Error("Recording not found.");
  }
  const rec$ = require("../../utils/liveRecording");
  const { action } = req.body;
  if (action === "publish") {
    if (rec.status !== "ready") {
      res.status(409);
      throw new Error("The recording isn't ready yet.");
    }
    if (rec.decision === "published") {
      res.status(409);
      throw new Error("Already published.");
    }
    try {
      await rec$.publish(liveClass, rec, { title: req.body.title, chapter: req.body.chapter, publishNow: req.body.publishNow !== false, by: req.user._id });
    } catch (error) {
      res.status(error.statusCode || 400);
      throw error;
    }
  } else if (action === "send") {
    try {
      await rec$.send(liveClass, rec, String(req.body.to || ""));
    } catch (error) {
      res.status(error.statusCode || 400);
      throw error;
    }
  } else if (action === "private") {
    rec.decision = "private";
    await liveClass.save();
  } else if (action === "delete") {
    if (rec.status === "recording") await rec$.stop(liveClass);
    await rec$.discard(liveClass, rec);
  } else {
    res.status(400);
    throw new Error("action must be publish, send, private or delete.");
  }
  res.status(200).json(await recordingView(liveClass));
});

module.exports = {
  loadRoom,
  joinAsTeacher,
  getTaught,
  startRecording,
  stopRecording,
  getRecordings,
  decideRecording,
  saveBoard,
  savePadNotes,
  getAttendance,
  getProviders,
  getHostToken,
  setSpeaker,
  removeParticipant,
  setPermissions,
  muteParticipant,
  muteAll,
  updateRoomSettings,
  roomBranding,
  getLiveClasses,
  getLiveClass,
  createLiveClass,
  updateLiveClass,
  deleteLiveClass,
  startLiveClass,
  endLiveClass,
};
