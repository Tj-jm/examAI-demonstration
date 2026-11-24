const mongoose = require("mongoose");
const LiveClass = require("../models/liveClassModel");
const LiveAttendance = require("../models/liveAttendanceModel");
const liveClassAdapter = require("../adapters/liveClass");

// Attendance for in-app classes, without webhooks: every 30 seconds the
// rooms of live classes are listed, and each person's connected stretches
// are opened, extended or closed. Accurate to about 30 seconds.

const parseIdentity = (identity) => {
  const [kind, id] = String(identity).split(":");
  const valid = mongoose.isValidObjectId(id) ? id : null;
  return { student: kind === "student" ? valid : null, user: kind === "staff" ? valid : null };
};
// Everyone this platform lets in has a student: or staff: identity. Anything
// else is a LiveKit service in the room, such as the recorder (EG_…).
const isPerson = (identity) => /^(student|staff):/.test(String(identity));
const roleOf = (p) => {
  try {
    return JSON.parse(p.metadata || "{}").role || "student";
  } catch {
    return "student";
  }
};
const close = (doc, at) => {
  const open = doc.sessions[doc.sessions.length - 1];
  if (!open || open.leftAt) return;
  open.leftAt = at;
  doc.totalSeconds += Math.max(0, Math.round((at - open.joinedAt) / 1000));
};

// One class's room, now.
const sweepClass = async (liveClass, now = new Date()) => {
  const lk = liveClassAdapter.get("livekit");
  const listed = await lk.participantsOrNull(liveClass.externalId);
  // Couldn't ask: leave everyone's stretch as it is until the next sweep.
  if (listed === null) return null;
  const present = listed.filter((p) => isPerson(p.identity));
  const seen = new Set();
  for (const p of present) {
    seen.add(p.identity);
    let doc = await LiveAttendance.findOne({ liveClass: liveClass._id, identity: p.identity });
    if (!doc) {
      doc = new LiveAttendance({ liveClass: liveClass._id, identity: p.identity, ...parseIdentity(p.identity) });
    }
    doc.name = p.name || doc.name;
    doc.role = roleOf(p);
    const last = doc.sessions[doc.sessions.length - 1];
    if (!last || last.leftAt) {
      const ms = Number(p.joinedAtMs || 0) || Number(p.joinedAt || 0) * 1000;
      const joined = ms ? new Date(ms) : now;
      doc.sessions.push({ joinedAt: joined > now ? now : joined, leftAt: null });
    }
    doc.lastSeenAt = now;
    await doc.save();
  }
  // Anyone with an open stretch who isn't there any more left around when
  // they were last seen.
  const open = await LiveAttendance.find({ liveClass: liveClass._id, "sessions.leftAt": null });
  for (const doc of open) {
    if (seen.has(doc.identity)) continue;
    close(doc, doc.lastSeenAt || now);
    await doc.save();
  }
  return present.length;
};

// A live in-app class whose room has been empty this long is over: the
// host left without pressing End, or pressed Start and never came in.
const EMPTY_MS = 15 * 60 * 1000;

// Every live in-app class.
const sweep = async (now = new Date()) => {
  if (!liveClassAdapter.get("livekit").configured()) return 0;
  const live = await LiveClass.find({ provider: "livekit", status: "live" });
  let n = 0;
  for (const lc of live) {
    const present = await sweepClass(lc, now).catch(() => null);
    if (present === null) continue;
    n += present;
    if (present > 0) {
      await LiveClass.updateOne({ _id: lc._id }, { $set: { occupiedAt: now } });
    } else if (now - new Date(lc.occupiedAt || lc.liveSince || lc.updatedAt) >= EMPTY_MS) {
      await require("./liveEnd").endClass(lc).catch((error) => console.error(`Ending empty class ${lc._id}: ${error.message}`));
    }
  }
  return n;
};

// The class ended: close everyone's stretch now.
const closeAll = async (liveClassId, at = new Date()) => {
  const open = await LiveAttendance.find({ liveClass: liveClassId, "sessions.leftAt": null });
  for (const doc of open) {
    close(doc, at);
    await doc.save();
  }
};

// Seconds connected, counting a stretch that's still open up to `now`.
const secondsOf = (doc, now = new Date()) => {
  const last = doc.sessions[doc.sessions.length - 1];
  return doc.totalSeconds + (last && !last.leftAt ? Math.max(0, Math.round((now - last.joinedAt) / 1000)) : 0);
};

module.exports = { sweep, sweepClass, closeAll, secondsOf, isPerson, EMPTY_MS };
