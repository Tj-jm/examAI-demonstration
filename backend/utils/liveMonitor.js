const os = require("os");
const LiveClass = require("../models/liveClassModel");
const LiveAttendance = require("../models/liveAttendanceModel");
const LiveStat = require("../models/liveStatModel");
const PerformanceSettings = require("../models/performanceSettingsModel");
const liveClassAdapter = require("../adapters/liveClass");
const shared = require("./shared");

// The Performance page's view of in-app (LiveKit) live classes: who's in
// each room now, how the servers are doing, how full the LiveKit server is
// against the limit set in Settings → Performance, and history.
//
// Connection quality comes from the people themselves: each app sets a "q"
// attribute (excellent/good/poor/lost) on its own participant when LiveKit
// reports a change, and the server reads it back here.
//
// LiveKit's machine numbers (CPU, memory, traffic) need its Prometheus
// metrics on (prometheus_port in livekit.yaml) and LIVEKIT_METRICS_URL set
// to that address; without them, everything else still works.

const SAMPLE_MS = 5 * 60 * 1000;

const sourceNames = () => {
  const { TrackSource } = require("livekit-server-sdk");
  return { [TrackSource.CAMERA]: "camera", [TrackSource.MICROPHONE]: "mic", [TrackSource.SCREEN_SHARE]: "screen" };
};

const roleOf = (p) => {
  try {
    return JSON.parse(p.metadata || "{}").role || (String(p.identity).startsWith("staff:") ? "host" : "student");
  } catch {
    return "student";
  }
};

const settings = async () => (await PerformanceSettings.safeGet()).live || { maxParticipants: 0, blockWhenFull: false, alertPercent: 90 };

// People in every live in-app class, from the attendance sweep (every 30
// seconds): cheap enough to check on each join.
const currentPeople = async () => {
  const live = await LiveClass.find({ provider: "livekit", status: "live" }).select("_id").lean();
  if (!live.length) return 0;
  return LiveAttendance.countDocuments({ liveClass: { $in: live.map((l) => l._id) }, "sessions.leftAt": null });
};

// For the student join: false when the limit is set, blocking is on, and
// the server is at it. Someone already in (another device) may rejoin.
const roomFor = async (identity) => {
  const s = await settings();
  if (!s.blockWhenFull || !s.maxParticipants) return true;
  const already = await LiveAttendance.exists({ identity, "sessions.leftAt": null });
  if (already) return true;
  return (await currentPeople()) < s.maxParticipants;
};

// ---- LiveKit's Prometheus metrics ----

let lastMetrics = null;

const parseMetrics = (text) => {
  const out = {};
  for (const line of String(text).split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+([-+eE\d.]+|NaN|\+Inf)/);
    if (!m) continue;
    const value = Number(m[3]);
    if (!Number.isFinite(value)) continue;
    const labels = m[2] || "";
    const dir = (labels.match(/direction="([^"]+)"/) || [])[1];
    const key = dir ? `${m[1]}:${dir}` : m[1];
    out[key] = (out[key] || 0) + value;
  }
  return out;
};

const livekitMachine = async () => {
  const url = process.env.LIVEKIT_METRICS_URL;
  if (!url) return { available: false, reason: "Set LIVEKIT_METRICS_URL to LiveKit's metrics address to see its CPU, memory and traffic." };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const now = Date.now();
    const m = parseMetrics(await res.text());
    const prev = lastMetrics;
    lastMetrics = { at: now, m };
    const rate = (key) => (prev && m[key] !== undefined && prev.m[key] !== undefined && now > prev.at
      ? Math.max(0, (m[key] - prev.m[key]) / ((now - prev.at) / 1000)) : null);
    const cpuRate = rate("process_cpu_seconds_total");
    const packetsIn = rate("livekit_packet_total:incoming");
    const packetsOut = rate("livekit_packet_total:outgoing");
    const lossKey = Object.keys(m).find((k) => /packet_loss|nack_total/.test(k));
    return {
      available: true,
      cpuPercent: cpuRate === null ? null : Math.round((cpuRate / os.cpus().length) * 1000) / 10,
      memoryBytes: m.process_resident_memory_bytes ?? null,
      bytesInPerSec: rate("livekit_bytes_total:incoming"),
      bytesOutPerSec: rate("livekit_bytes_total:outgoing"),
      packetsInPerSec: packetsIn,
      packetsOutPerSec: packetsOut,
      lossPerSec: lossKey ? rate(lossKey) : null,
      rooms: m.livekit_room_total ?? null,
      participants: m.livekit_participant_total ?? null,
      tracksPublished: m.livekit_track_published_total ?? null,
      tracksSubscribed: m.livekit_track_subscribed_total ?? null,
      // Rates need two readings; the page asks again in a few seconds.
      warmingUp: !prev,
    };
  } catch (error) {
    return { available: false, reason: `Couldn't read LiveKit's metrics (${error.message}).` };
  }
};

// This app server's own load. On a one-machine install LiveKit runs here
// too, so it's a fair guide even without LiveKit's metrics.
const appMachine = () => {
  const cores = os.cpus().length || 1;
  const total = os.totalmem();
  return {
    cpuPercent: Math.round((os.loadavg()[0] / cores) * 1000) / 10,
    cores,
    memoryUsedPercent: Math.round(((total - os.freemem()) / total) * 1000) / 10,
    memoryTotalBytes: total,
    uptimeSeconds: Math.round(os.uptime()),
  };
};

// ---- now ----

const snapshot = async () => {
  const lk = liveClassAdapter.get("livekit");
  const s = await settings();
  if (!lk.configured()) {
    return { configured: false, settings: s, classes: [], totals: { rooms: 0, people: 0, students: 0, hosts: 0 }, app: appMachine(), livekit: { available: false } };
  }

  const live = await LiveClass.find({ provider: "livekit", status: "live" })
    .populate("batch", "name").populate("host", "name identifier").sort({ liveSince: 1 }).lean();
  const names = sourceNames();
  let reachable = true;

  const classes = await Promise.all(live.map(async (lc) => {
    const [listed, joinedSoFar] = await Promise.all([
      lk.participantsOrNull(lc.externalId),
      LiveAttendance.countDocuments({ liveClass: lc._id }),
    ]);
    if (listed === null) reachable = false;
    const people = (listed || []).filter((p) => /^(student|staff):/.test(String(p.identity))).map((p) => {
      const on = { camera: false, mic: false, screen: false };
      for (const t of p.tracks || []) {
        const name = names[t.source];
        if (name && !t.muted) on[name] = true;
      }
      const ms = Number(p.joinedAtMs || 0) || Number(p.joinedAt || 0) * 1000;
      return {
        identity: p.identity,
        name: p.name || "",
        role: roleOf(p),
        joinedAt: ms ? new Date(ms) : null,
        quality: p.attributes?.q || null,
        hand: p.attributes?.hand === "1",
        ...on,
      };
    });
    const students = people.filter((p) => p.role === "student").length;
    return {
      _id: lc._id,
      title: lc.title,
      batch: lc.batch?.name || "",
      host: lc.host ? (lc.host.identifier || lc.host.name) : "",
      mode: lc.mode,
      liveSince: lc.liveSince,
      recording: (lc.recordings || []).some((r) => r.status === "recording"),
      reachable: listed !== null,
      people,
      students,
      hosts: people.length - students,
      joinedSoFar,
      quality: ["excellent", "good", "poor", "lost"].reduce((o, q) => ({ ...o, [q]: people.filter((p) => p.quality === q).length }), {}),
      publishing: { camera: people.filter((p) => p.camera).length, mic: people.filter((p) => p.mic).length, screen: people.filter((p) => p.screen).length },
    };
  }));

  const totals = classes.reduce((t, c) => ({
    rooms: t.rooms + 1,
    people: t.people + c.people.length,
    students: t.students + c.students,
    hosts: t.hosts + c.hosts,
  }), { rooms: 0, people: 0, students: 0, hosts: 0 });
  const usedPercent = s.maxParticipants ? Math.round((totals.people / s.maxParticipants) * 1000) / 10 : null;

  return {
    configured: true,
    reachable,
    settings: s,
    totals,
    capacity: { max: s.maxParticipants || null, usedPercent, alert: usedPercent !== null && usedPercent >= (s.alertPercent || 90), full: Boolean(s.maxParticipants) && totals.people >= s.maxParticipants },
    recordingsRunning: classes.filter((c) => c.recording).length,
    classes,
    app: appMachine(),
    livekit: await livekitMachine(),
  };
};

// ---- history ----

// After each attendance sweep: one sample every few minutes across all
// servers, only while something is live.
const record = async () => {
  if (!liveClassAdapter.get("livekit").configured()) return;
  await shared.runOnce("live-stat", SAMPLE_MS - 5000, async () => {
    const live = await LiveClass.find({ provider: "livekit", status: "live" }).select("_id").lean();
    if (!live.length) return;
    const open = await LiveAttendance.find({ liveClass: { $in: live.map((l) => l._id) }, "sessions.leftAt": null }).select("role").lean();
    const machine = process.env.LIVEKIT_METRICS_URL ? await livekitMachine() : null;
    await LiveStat.create({
      rooms: live.length,
      people: open.length,
      students: open.filter((a) => a.role === "student").length,
      cpu: machine?.cpuPercent ?? null,
    });
  });
};

const history = async (days = 7) => {
  const d = Math.min(90, Math.max(1, days));
  const since = new Date(Date.now() - d * 24 * 3600 * 1000);
  const tz = process.env.TZ || "UTC";
  const [byDay, byHour, top] = await Promise.all([
    LiveStat.aggregate([
      { $match: { at: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$at", timezone: tz } }, peak: { $max: "$people" }, rooms: { $max: "$rooms" }, cpu: { $max: "$cpu" } } },
      { $sort: { _id: 1 } },
    ]),
    LiveStat.aggregate([
      { $match: { at: { $gte: since } } },
      { $group: { _id: { $hour: { date: "$at", timezone: tz } }, avg: { $avg: "$people" }, peak: { $max: "$people" } } },
      { $sort: { _id: 1 } },
    ]),
    LiveStat.findOne({ at: { $gte: since } }).sort({ people: -1 }).lean(),
  ]);
  return {
    days: d,
    byDay: byDay.map((r) => ({ day: r._id, peak: r.peak, rooms: r.rooms, cpu: r.cpu })),
    byHour: byHour.map((r) => ({ hour: r._id, avg: Math.round(r.avg * 10) / 10, peak: r.peak })),
    busiest: top ? { at: top.at, people: top.people, rooms: top.rooms } : null,
  };
};

module.exports = { snapshot, record, history, roomFor, currentPeople, parseMetrics };
