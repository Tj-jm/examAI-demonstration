const mongoose = require("mongoose");
const Campaign = require("../models/campaignModel");
const Student = require("../models/studentModel");
const Purchase = require("../models/purchaseModel");
const Trial = require("../models/trialModel");
const Batch = require("../models/batchModel");
const CheckoutStart = require("../models/checkoutStartModel");
const AppSettings = require("../models/appSettingsModel");
const sms = require("../adapters/sms");
const email = require("../adapters/email");
const { resolveExpiry } = require("./accessWindow");
const campaigns = require("./campaigns");

// Automations: campaigns (kind "automation") that send themselves to each
// student when their trigger applies. Every hour (jobs/campaigns.js) each
// active one finds who it applies to now, each with a key naming the
// reason (this trial, this expiry date...). The delivery is unique per
// automation, student and key (campaignDeliveryModel.js), so nobody gets
// the same message twice for the same reason, however often it runs or
// however many servers run it.
//
// Windows look back a little further than one run, so a run missed while
// the server was down is caught up by the next one.

const DAY = 86400000;
const HOUR = 3600000;
const CATCH_UP = 2 * DAY;

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

// When each student's access to each batch ends, from their completed
// purchases (the same stacking as batch access: utils/accessWindow.js).
const expiries = async (pairs) => {
  const out = new Map(); // "student:batch" -> Date
  const students = [...new Set(pairs.map((p) => String(p.student)))];
  const batches = [...new Set(pairs.map((p) => String(p.batch)))];
  if (!students.length) return out;
  const purchases = await Purchase.find({
    student: { $in: students.map(oid) }, batch: { $in: batches.map(oid) }, kind: "batch", status: "complete",
  }).select("student batch plan startDate").sort({ startDate: 1 }).lean();
  const grouped = new Map();
  for (const p of purchases) {
    const k = `${p.student}:${p.batch}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(p);
  }
  for (const [k, list] of grouped) out.set(k, resolveExpiry(list));
  return out;
};

const batchFilter = (trigger) => (trigger.batch ? { batch: trigger.batch } : {});

// Who the trigger applies to now: [{ student, key, batch? }].
const candidates = async (trigger, now = new Date()) => {
  const days = Math.max(1, Number(trigger.days) || 1);

  if (trigger.type === "trialEnding") {
    // A trial ending within `days` for a batch they haven't bought.
    const trials = await Trial.find({ endDate: { $gt: now, $lte: new Date(now.getTime() + days * DAY) }, ...batchFilter(trigger) })
      .select("student batch").lean();
    const out = [];
    for (const t of trials) {
      if (await Purchase.exists({ student: t.student, batch: t.batch, status: "complete" })) continue;
      out.push({ student: String(t.student), batch: String(t.batch), key: `trial:${t._id}` });
    }
    return out;
  }

  if (trigger.type === "checkoutAbandoned") {
    // A checkout started `hours` ago (or a little more) with no purchase of
    // that batch since. One message per batch per day of trying.
    const hours = Math.max(1, Number(trigger.hours) || 3);
    const to = new Date(now.getTime() - hours * HOUR);
    const starts = await CheckoutStart.find({ createdAt: { $lte: to, $gte: new Date(to.getTime() - CATCH_UP) }, ...batchFilter(trigger) })
      .select("student batch createdAt").lean();
    const out = new Map();
    for (const s of starts) {
      const key = `checkout:${s.batch}:${dayKey(s.createdAt)}`;
      if (out.has(`${s.student}|${key}`)) continue;
      const bought = await Purchase.exists({ student: s.student, batch: s.batch, status: "complete", createdAt: { $gte: s.createdAt } });
      if (!bought) out.set(`${s.student}|${key}`, { student: String(s.student), batch: String(s.batch), key });
    }
    return [...out.values()];
  }

  if (trigger.type === "accessExpiring" || trigger.type === "accessExpired") {
    // Access that ends within `days` (expiring), or ended `days` ago and
    // wasn't renewed (expired). Keyed by the end date, so a renewal that
    // later runs out again counts as new.
    const expiring = trigger.type === "accessExpiring";
    const from = expiring ? now : new Date(now.getTime() - days * DAY - CATCH_UP);
    const to = expiring ? new Date(now.getTime() + days * DAY) : new Date(now.getTime() - days * DAY);
    const ended = await Purchase.find({ kind: "batch", status: "complete", endDate: { $gt: from, $lte: to }, ...batchFilter(trigger) })
      .select("student batch").lean();
    const ends = await expiries(ended);
    const out = new Map();
    for (const p of ended) {
      const k = `${p.student}:${p.batch}`;
      const end = ends.get(k);
      // Extended by a later purchase (or lifetime): not ending in the window.
      if (!end || end <= from || end > to) continue;
      const key = `${expiring ? "expiring" : "expired"}:${p.batch}:${dayKey(end)}`;
      out.set(`${k}|${key}`, { student: String(p.student), batch: String(p.batch), key });
    }
    return [...out.values()];
  }

  if (trigger.type === "inactive") {
    // Quiet for `days`; at most once a month each.
    const ids = await campaigns.audienceIds({ kind: "inactive", days, batch: trigger.batch }, now);
    const month = `inactive:${now.toISOString().slice(0, 7)}`;
    return ids.map((student) => ({ student, key: month }));
  }

  if (trigger.type === "noPurchase") {
    // Signed up `days` ago and still haven't paid for anything. Once each.
    const to = new Date(now.getTime() - days * DAY);
    const fresh = await Student.distinct("_id", { createdAt: { $lte: to, $gte: new Date(to.getTime() - CATCH_UP) } });
    if (!fresh.length) return [];
    const paid = new Set((await Purchase.distinct("student", { student: { $in: fresh }, status: "complete", amountPaid: { $gt: 0 } })).map(String));
    return fresh.map(String).filter((id) => !paid.has(id)).map((student) => ({ student, key: "noPurchase" }));
  }

  return [];
};

// Runs one automation: sends to everyone it applies to who hasn't had it
// for that reason yet. Returns how many it sent.
const runOne = async (automation, { now = new Date(), adapters = { sms, email }, settings } = {}) => {
  settings = settings || (await AppSettings.get());
  const list = await candidates(automation.trigger || {}, now);
  if (!list.length) return 0;

  const students = await Student.find({ _id: { $in: [...new Set(list.map((c) => c.student))].map(oid) }, ...campaigns.baseQuery })
    .select("name email phoneNumber").lean();
  const byId = new Map(students.map((s) => [String(s._id), s]));
  const batchIds = [...new Set(list.map((c) => c.batch).filter(Boolean))];
  const names = new Map((await Batch.find({ _id: { $in: batchIds.map(oid) } }).select("name").lean()).map((b) => [String(b._id), b.name]));
  const ready = campaigns.readiness(automation, settings, adapters);
  const inc = campaigns.newCounters();
  let sent = 0;

  for (const c of list) {
    const student = byId.get(c.student);
    if (!student) continue; // opted out, suspended or deleted
    const vars = c.batch ? { batchId: c.batch, batchName: names.get(c.batch) } : {};
    if (await campaigns.deliverTo({ campaign: automation, student, settings, adapters, inc, ready, key: c.key, vars })) sent += 1;
  }
  if (sent) await Campaign.updateOne({ _id: automation._id }, { $inc: { ...inc, "stats.recipients": sent } });
  return sent;
};

// Every active automation, once. Called hourly by jobs/campaigns.js.
const runAll = async (now = new Date()) => {
  const settings = await AppSettings.get();
  // Without sales nothing runs (nothing is sold).
  if (settings.institution?.sales === false) return [];
  const list = await Campaign.find({ kind: "automation", status: "active" });
  const done = [];
  for (const a of list) {
    try {
      const sent = await runOne(a, { now, settings });
      if (sent) done.push({ automation: a.name, sent });
    } catch (error) {
      console.error(`Automation "${a.name}" failed:`, error.message);
    }
  }
  return done;
};

// Starting points for the admin's "New automation" (Automations page).
const PRESETS = {
  trialEnding: {
    name: "Trial ending", trigger: { type: "trialEnding", days: 2 },
    title: "Your free trial ends soon",
    message: "{name}, your free trial of {batch} ends in a couple of days. Keep your place by picking a plan.",
    link: "/purchases/{batch}",
  },
  checkoutAbandoned: {
    name: "Checkout not finished", trigger: { type: "checkoutAbandoned", hours: 3 },
    title: "Your enrolment isn't finished",
    message: "{name}, you started joining {batch} but didn't finish paying. You can pick up where you left off.",
    link: "/purchases/{batch}",
  },
  accessExpiring: {
    name: "Access ending", trigger: { type: "accessExpiring", days: 3 },
    title: "Your access ends soon",
    message: "{name}, your access to {batch} ends in a few days. Renew to keep your lectures, exams and progress.",
    link: "/purchases/{batch}",
  },
  accessExpired: {
    name: "Access ended", trigger: { type: "accessExpired", days: 3 },
    title: "We miss you",
    message: "{name}, your access to {batch} ended a few days ago. Renew any time to pick up where you stopped.",
    link: "/purchases/{batch}",
  },
  inactive: {
    name: "Gone quiet", trigger: { type: "inactive", days: 7 },
    title: "Ready for a quick practice?",
    message: "{name}, it's been a week. A 10-minute practice today keeps you on track.",
    link: "/",
  },
  noPurchase: {
    name: "Signed up, not joined", trigger: { type: "noPurchase", days: 3 },
    title: "Find your course",
    message: "{name}, thanks for signing up. Have a look at the courses open now and start with a free trial where there is one.",
    link: "/purchases",
  },
};

module.exports = { candidates, runOne, runAll, PRESETS };
