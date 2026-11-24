const mongoose = require("mongoose");
const AppSettings = require("../models/appSettingsModel");
const User = require("../models/userModel");
const LiveClass = require("../models/liveClassModel");
const LiveAttendance = require("../models/liveAttendanceModel");
const { range, round2 } = require("./teamPay");

// What teachers earned for live classes in a date range (Payslips → Class
// pay). Each person's rate is on their account (user.classPay: by the hour
// or by the class, and whether overtime is paid); the rules are in
// settings.classPay. Everyone on a class (its host and its teachers) gets
// full pay at their own rate.
//
// A class's length, best source first: when it went live to when it ended;
// for an in-app class, the first join to the last leave in its attendance;
// for Zoom, the same from the webhook's attendance; else its scheduled length.

const RULES = { minMinutes: 10, payEmpty: true, roundMinutes: 15, graceMinutes: 15, lateCancelHours: 2, lateCancelPercent: 0, noShowDeduction: 0 };

const rules = async () => {
  const s = await AppSettings.get();
  const c = s.classPay?.toObject?.() || s.classPay || {};
  return { ...RULES, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== null)), currency: s.defaultCurrency || "" };
};

const PAY_FIELDS = "name identifier email role isActive classPay";
const rateOf = (u) => ({ mode: u.classPay?.mode === "class" ? "class" : "hour", rate: Number(u.classPay?.rate) || 0, overtime: Boolean(u.classPay?.overtime) });

const time = (d) => (d ? new Date(d).getTime() : null);
const spanMinutes = (stretches) => {
  const starts = stretches.map((s) => time(s.joinedAt)).filter(Boolean);
  const ends = stretches.map((s) => time(s.leftAt)).filter(Boolean);
  if (!starts.length || !ends.length) return null;
  const m = (Math.max(...ends) - Math.min(...starts)) / 60000;
  return m > 0 ? m : null;
};

// How long a class really ran, and where that came from.
const lengthOf = (lc, attendance) => {
  if (lc.liveSince && lc.endedAt && time(lc.endedAt) > time(lc.liveSince)) {
    return { minutes: (time(lc.endedAt) - time(lc.liveSince)) / 60000, source: "start to end" };
  }
  if (lc.provider === "livekit") {
    const m = spanMinutes(attendance.flatMap((a) => (a.sessions || []).map((s) => ({ joinedAt: s.joinedAt, leftAt: s.leftAt || a.lastSeenAt }))));
    if (m) return { minutes: m, source: "attendance" };
  }
  if (lc.provider === "zoom") {
    const m = spanMinutes(lc.attendance || []);
    if (m) return { minutes: m, source: "Zoom" };
  }
  return { minutes: Number(lc.durationMinutes) || 60, source: "scheduled" };
};

// Whether any student came. Unknown (a link-only class) counts as yes.
const hadStudents = (lc, attendance, staffEmails) => {
  if (lc.provider === "livekit") return attendance.some((a) => a.student);
  if (lc.provider === "zoom") {
    return (lc.attendance || []).some((a) => !a.participantEmail || !staffEmails.has(String(a.participantEmail).toLowerCase()));
  }
  return true;
};

// One person, one class: what it pays and why.
const priceClass = (lc, user, rate, r, ctx) => {
  const scheduled = Number(lc.durationMinutes) || 60;
  const base = rate.mode === "class" ? rate.rate : (rate.rate * scheduled) / 60;
  const row = {
    _id: lc._id,
    title: lc.title,
    batch: lc.batch ? { _id: lc.batch._id, name: lc.batch.name } : null,
    scheduledAt: lc.scheduledAt,
    scheduledMinutes: scheduled,
    provider: lc.provider,
    status: lc.status,
    minutes: null,
    source: null,
    paidMinutes: 0,
    amount: 0,
    outcome: "paid",
  };

  if (lc.status === "cancelled") {
    const late = lc.cancelledAt && time(lc.scheduledAt) - time(lc.cancelledAt) < r.lateCancelHours * 3600000;
    if (late && r.lateCancelPercent > 0) {
      row.outcome = "lateCancel";
      row.amount = round2((base * r.lateCancelPercent) / 100);
    } else row.outcome = "cancelled";
    return row;
  }
  if (lc.status === "live") { row.outcome = "live"; return row; }
  if (lc.status === "scheduled") {
    row.outcome = time(lc.scheduledAt) + scheduled * 60000 < Date.now() ? "notHeld" : "upcoming";
    return row;
  }

  // Ended. An in-app class knows who joined: someone on it who never did
  // wasn't there.
  if (lc.provider === "livekit" && ctx.attendance.length && !ctx.attendance.some((a) => a.identity === `staff:${user._id}`)) {
    row.outcome = "noShow";
    row.amount = r.noShowDeduction > 0 ? -round2(r.noShowDeduction) : 0;
    return row;
  }

  const { minutes, source } = lengthOf(lc, ctx.attendance);
  row.minutes = Math.round(minutes);
  row.source = source;
  if (minutes < r.minMinutes) { row.outcome = "short"; return row; }
  if (!r.payEmpty && !hadStudents(lc, ctx.attendance, ctx.staffEmails)) { row.outcome = "empty"; return row; }

  if (rate.mode === "class") {
    row.amount = round2(rate.rate);
    return row;
  }
  let paid = rate.overtime ? minutes : Math.min(minutes, scheduled + r.graceMinutes);
  const step = Number(r.roundMinutes) || 1;
  paid = Math.round(paid / step) * step;
  // Rounding up never goes past the cap.
  if (!rate.overtime) paid = Math.min(paid, scheduled + r.graceMinutes);
  row.paidMinutes = paid;
  row.amount = round2((rate.rate * paid) / 60);
  return row;
};

// Classes in [from, to] for these people, priced. users: lean User docs
// with classPay.
const priceFor = async (users, { from, to } = {}) => {
  const r = await rules();
  const ids = users.map((u) => u._id);
  // Webinars count only when ticked to (countPay).
  const q = { $or: [{ host: { $in: ids } }, { teachers: { $in: ids } }], $nor: [{ kind: "webinar", countPay: { $ne: true } }] };
  const when = range(from, to);
  if (when) q.scheduledAt = when;
  const classes = await LiveClass.find(q)
    .select("title batch host teachers scheduledAt durationMinutes provider status liveSince endedAt cancelledAt attendance")
    .populate("batch", "name")
    .sort({ scheduledAt: -1 })
    .limit(5000)
    .lean();

  const inApp = classes.filter((c) => c.provider === "livekit" && c.status === "ended").map((c) => c._id);
  const att = inApp.length
    ? await LiveAttendance.find({ liveClass: { $in: inApp } }).select("liveClass identity student sessions lastSeenAt").lean()
    : [];
  const attBy = new Map();
  for (const a of att) {
    const k = String(a.liveClass);
    if (!attBy.has(k)) attBy.set(k, []);
    attBy.get(k).push(a);
  }

  // Staff emails, so a Zoom class's own teachers don't count as students.
  const staff = new Set(classes.flatMap((c) => [c.host, ...(c.teachers || [])]).filter(Boolean).map(String));
  const staffEmails = new Set(
    (await User.find({ _id: { $in: [...staff] } }).select("email").lean()).map((u) => String(u.email || "").toLowerCase()).filter(Boolean)
  );

  return {
    rules: r,
    rows: users.map((u) => {
      const rate = rateOf(u);
      const mine = classes.filter((c) => String(c.host) === String(u._id) || (c.teachers || []).some((t) => String(t) === String(u._id)));
      const priced = mine.map((c) => priceClass(c, u, rate, r, { attendance: attBy.get(String(c._id)) || [], staffEmails }));
      const sum = (outcome, key = "amount") => round2(priced.filter((p) => p.outcome === outcome).reduce((n, p) => n + (p[key] || 0), 0));
      const count = (outcome) => priced.filter((p) => p.outcome === outcome).length;
      return {
        user: { _id: u._id, name: u.identifier || u.name, email: u.email, role: u.role, isActive: u.isActive },
        ...rate,
        classes: priced,
        totals: {
          paid: count("paid"),
          paidMinutes: sum("paid", "paidMinutes"),
          paidAmount: sum("paid"),
          lateCancel: count("lateCancel"),
          lateCancelAmount: sum("lateCancel"),
          noShow: count("noShow"),
          noShowAmount: sum("noShow"),
          amount: round2(priced.reduce((n, p) => n + p.amount, 0)),
        },
      };
    }),
  };
};

// The people who can take classes, with their rates.
const people = (id) => {
  const q = id ? { _id: id } : { role: { $in: ["owner", "admin", "teacher"] }, isDeleted: { $ne: true } };
  return User.find(q).select(PAY_FIELDS).sort({ role: 1, name: 1 }).lean();
};

// Everyone who takes classes, or one person: rate and what they earned.
const report = async ({ from, to, user } = {}) => {
  const id = user && mongoose.isValidObjectId(user) ? user : null;
  return priceFor(await people(id), { from, to });
};

// Payslip lines for one person (teamPay.suggestLines).
const linesFor = async (userId, { from, to } = {}) => {
  const users = await people(userId);
  if (!users.length || !rateOf(users[0]).rate) return [];
  const { rows, rules: r } = await priceFor(users, { from, to });
  const row = rows[0];
  const t = row.totals;
  const lines = [];
  if (t.paid) {
    const hours = round2(t.paidMinutes / 60);
    lines.push(row.mode === "class"
      ? { kind: "classes", label: `Live classes taken (${t.paid})`, quantity: t.paid, rate: row.rate, amount: t.paidAmount }
      : { kind: "classes", label: `Live classes taken (${t.paid}, ${hours} h)`, quantity: hours, rate: row.rate, amount: t.paidAmount });
  }
  if (t.lateCancel && t.lateCancelAmount) {
    lines.push({ kind: "classes", label: `Classes cancelled late (${t.lateCancel}, ${r.lateCancelPercent}%)`, quantity: t.lateCancel, rate: null, amount: t.lateCancelAmount });
  }
  if (t.noShow && t.noShowAmount) {
    lines.push({ kind: "deduction", label: `Classes missed (${t.noShow})`, quantity: t.noShow, rate: r.noShowDeduction, amount: t.noShowAmount });
  }
  return lines;
};

module.exports = { rules, report, linesFor, RULES };
