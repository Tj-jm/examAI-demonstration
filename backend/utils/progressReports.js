const crypto = require("crypto");
const Batch = require("../models/batchModel");
const Exam = require("../models/examModel");
const Submission = require("../models/submissionModel");
const LiveClass = require("../models/liveClassModel");
const LiveAttendance = require("../models/liveAttendanceModel");
const { Assignment, AssignmentSubmission } = require("../models/assignmentModel");
const Student = require("../models/studentModel");
const ProgressReport = require("../models/progressReportModel");
const AppSettings = require("../models/appSettingsModel");
const sms = require("../adapters/sms");
const email = require("../adapters/email");
const { roster } = require("./roster");
const { studentBase } = require("./certificates");

// Progress reports: a summary of each student's exams, attendance and work
// over a week, a fortnight or a month, sent by SMS and/or email to the
// student and their guardian, plus an instant message as each exam is
// graded. Every report has a private link (/progress/<token>) to the full
// version, no login needed. Schedules are per batch (Batch.progressReports),
// read in the institution's time zone; jobs/progressReports.js runs them.

const DAY = 86400000;
const CATCH_UP_MS = 12 * 3600000; // a send missed by more than this is skipped, not sent late

// ---------- time ----------

const zoneOf = (settings) => {
  const wanted = settings?.progressReports?.timezone || process.env.TZ || (settings?.defaultCurrency === "BDT" ? "Asia/Dhaka" : "UTC");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: wanted });
    return wanted;
  } catch {
    return "UTC";
  }
};

// The wall-clock date and hour in `tz` at instant `date`.
const localParts = (date, tz) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) % 24, min: Number(parts.minute) };
};

// The instant at which it is y-m-d h:00 in `tz` (handles DST shifts).
const zonedTime = (y, m, d, h, tz) => {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 2; i += 1) {
    const p = localParts(new Date(guess), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    guess += Date.UTC(y, m - 1, d, h) - shown;
  }
  return new Date(guess);
};

const ymd = (t) => {
  const x = new Date(t);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
};
const keyOf = ({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// The most recent scheduled send at or before `now`: { key, at, from }.
// `from` is the start of the stretch it covers (the send before it).
const lastOccurrence = (cfg, now, tz) => {
  const today = localParts(now, tz);
  const todayUtc = Date.UTC(today.y, today.m - 1, today.d);
  const hour = cfg.hour ?? 20;

  if (cfg.frequency === "monthly") {
    const day = Math.min(28, Math.max(1, cfg.monthDay || 1));
    for (let back = 0; back < 2; back += 1) {
      const y = today.y + Math.floor((today.m - 1 - back) / 12);
      const m = ((today.m - 1 - back) % 12 + 12) % 12 + 1;
      const at = zonedTime(y, m, day, hour, tz);
      if (at <= now) {
        const py = m === 1 ? y - 1 : y;
        const pm = m === 1 ? 12 : m - 1;
        return { key: keyOf({ y, m, d: day }), at, from: zonedTime(py, pm, day, hour, tz) };
      }
    }
    return null;
  }

  const span = cfg.frequency === "biweekly" ? 14 : 7;
  for (let back = 0; back <= 14; back += 1) {
    const dayUtc = todayUtc - back * DAY;
    if (new Date(dayUtc).getUTCDay() !== (cfg.weekday ?? 5)) continue;
    // Fortnightly: every other week, counted from a fixed Sunday so the
    // weeks don't shift when a setting is changed.
    if (span === 14 && Math.floor((dayUtc - Date.UTC(1970, 0, 4)) / (7 * DAY)) % 2 !== 0) continue;
    const d = ymd(dayUtc);
    const at = zonedTime(d.y, d.m, d.d, hour, tz);
    if (at > now) continue;
    const p = ymd(dayUtc - span * DAY);
    return { key: keyOf(d), at, from: zonedTime(p.y, p.m, p.d, hour, tz) };
  }
  return null;
};

// The send due now for this batch, or null.
const dueOccurrence = (cfg, now, tz) => {
  if (!cfg?.enabled) return null;
  const occ = lastOccurrence(cfg, now, tz);
  if (!occ || occ.key === cfg.lastPeriod) return null;
  if (now - occ.at > CATCH_UP_MS) return null;
  return occ;
};

// ---------- numbers ----------

const pct = (marks, total) => (total > 0 ? Math.round((marks / total) * 1000) / 10 : null);
const mean = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null);

// Best graded attempt per exam per student, in a time window.
const bestScores = async (batchId, from, to) => {
  const subs = await Submission.find({ batch: batchId, status: "graded", submittedAt: { $gte: from, $lt: to } })
    .select("exam student marks totalMarks submittedAt").lean();
  const examIds = [...new Set(subs.map((s) => String(s.exam)))];
  const exams = await Exam.find({ _id: { $in: examIds }, createdByStudent: null }).select("title").lean();
  const titles = new Map(exams.map((e) => [String(e._id), e.title]));
  const best = new Map(); // exam -> student -> sub
  for (const s of subs) {
    const e = String(s.exam);
    if (!titles.has(e) || !(s.totalMarks > 0)) continue;
    if (!best.has(e)) best.set(e, new Map());
    const byStudent = best.get(e);
    const prev = byStudent.get(String(s.student));
    if (!prev || s.marks / s.totalMarks > prev.marks / prev.totalMarks) byStudent.set(String(s.student), s);
  }
  return { best, titles };
};

// Everything one batch's reports need for [from, to), per student.
const buildSnapshots = async (batch, students, from, to, { showRank }) => {
  const ids = students.map((s) => String(s._id));
  const idSet = new Set(ids);
  const span = to - from;
  const [{ best, titles }, previous] = await Promise.all([
    bestScores(batch._id, from, to),
    bestScores(batch._id, new Date(from.getTime() - span), from),
  ]);

  const exams = {}; // student -> [{...}]
  for (const [examId, byStudent] of best) {
    const ranked = [...byStudent.values()].map((s) => pct(s.marks, s.totalMarks)).sort((a, b) => b - a);
    for (const [studentId, s] of byStudent) {
      if (!idSet.has(studentId)) continue;
      const p = pct(s.marks, s.totalMarks);
      (exams[studentId] = exams[studentId] || []).push({
        title: titles.get(examId), marks: s.marks, total: s.totalMarks, pct: p, at: s.submittedAt,
        rank: 1 + ranked.filter((x) => x > p).length, of: ranked.length,
      });
    }
  }
  const prevAvg = {};
  for (const byStudent of previous.best.values()) {
    for (const [studentId, s] of byStudent) (prevAvg[studentId] = prevAvg[studentId] || []).push(pct(s.marks, s.totalMarks));
  }

  // Class position over the stretch: by average, among those who sat an exam.
  const averages = ids.map((id) => [id, mean((exams[id] || []).map((e) => e.pct))]).filter(([, a]) => a !== null);
  const sortedAvg = averages.map(([, a]) => a).sort((a, b) => b - a);

  // Exams with a fixed closing time that closed in the stretch, unsat.
  const timed = await Exam.find({
    batches: batch._id, isPublished: true, isActive: true, createdByStudent: null, mode: "mock",
    liveHours: { $gt: 0 }, opensAt: { $lt: to, $gte: new Date(from.getTime() - 30 * DAY) },
  }).select("title opensAt liveHours").lean();
  const closed = timed.filter((e) => {
    const closes = new Date(e.opensAt).getTime() + e.liveHours * 3600000;
    return closes >= from.getTime() && closes < to.getTime();
  });
  const sat = new Map();
  for (const e of closed) {
    sat.set(String(e._id), new Set((await Submission.distinct("student", { exam: e._id, status: { $ne: "in_progress" } })).map(String)));
  }

  const pending = await Submission.aggregate([
    { $match: { batch: batch._id, status: { $in: ["submitted", "grading"] }, submittedAt: { $gte: from, $lt: to } } },
    { $group: { _id: "$student", n: { $sum: 1 } } },
  ]);
  const pendingBy = new Map(pending.map((p) => [String(p._id), p.n]));

  const classes = await LiveClass.find({ batch: batch._id, status: "ended", scheduledAt: { $gte: from, $lt: to } }).select("_id").lean();
  const attended = new Map();
  if (classes.length) {
    const rows = await LiveAttendance.find({ liveClass: { $in: classes.map((c) => c._id) }, student: { $in: ids }, totalSeconds: { $gte: 60 } }).select("student").lean();
    for (const r of rows) attended.set(String(r.student), (attended.get(String(r.student)) || 0) + 1);
  }

  const work = await Assignment.find({ batch: batch._id, isPublished: true, dueAt: { $gte: from, $lt: to } }).select("title").lean();
  const handed = new Map();
  if (work.length) {
    const rows = await AssignmentSubmission.find({ assignment: { $in: work.map((w) => w._id) }, status: { $in: ["submitted", "graded"] } }).select("assignment student").lean();
    for (const r of rows) {
      const k = String(r.student);
      if (!handed.has(k)) handed.set(k, new Set());
      handed.get(k).add(String(r.assignment));
    }
  }

  const out = {};
  for (const s of students) {
    const id = String(s._id);
    const list = (exams[id] || []).sort((a, b) => new Date(a.at) - new Date(b.at));
    const avg = mean(list.map((e) => e.pct));
    const done = handed.get(id) || new Set();
    out[id] = {
      student: { name: s.name, studentId: s.studentId || null },
      batch: { name: batch.name },
      from, to,
      exams: list.map((e) => (showRank ? e : { ...e, rank: null, of: null })),
      avg,
      prevAvg: mean(prevAvg[id] || []),
      rank: showRank && avg !== null ? 1 + sortedAvg.filter((x) => x > avg).length : null,
      of: showRank && avg !== null ? sortedAvg.length : null,
      missed: closed.filter((e) => !sat.get(String(e._id)).has(id)).map((e) => e.title),
      pending: pendingBy.get(id) || 0,
      live: { attended: attended.get(id) || 0, total: classes.length },
      assignments: { total: work.length, handed: work.filter((w) => done.has(String(w._id))).length, missing: work.filter((w) => !done.has(String(w._id))).map((w) => w.title) },
      showRank: Boolean(showRank),
    };
  }
  return out;
};

// ---------- wording ----------

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bnNum = (v) => String(v).replace(/\d/g, (d) => BN_DIGITS[d]);
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BN_MONTHS = ["জানু", "ফেব্রু", "মার্চ", "এপ্রি", "মে", "জুন", "জুলা", "আগ", "সেপ্টে", "অক্টো", "নভে", "ডিসে"];

// "10–16 Oct" for the stretch (its last day is the day before `to`).
const rangeText = (from, to, tz, lang) => {
  const a = localParts(new Date(from), tz);
  const b = localParts(new Date(new Date(to).getTime() - 1), tz);
  const months = lang === "bn" ? BN_MONTHS : EN_MONTHS;
  const n = lang === "bn" ? bnNum : String;
  // A plain hyphen: an en dash would make an English SMS Unicode (70
  // characters a part instead of 160).
  return a.m === b.m ? `${n(a.d)}-${n(b.d)} ${months[b.m - 1]}` : `${n(a.d)} ${months[a.m - 1]}-${n(b.d)} ${months[b.m - 1]}`;
};

const fmtPct = (v, lang) => {
  const s = Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, "");
  return lang === "bn" ? `${bnNum(s)}%` : `${s}%`;
};
const trend = (avg, prev, lang) => {
  if (avg === null || prev === null) return "";
  const d = Math.round(avg - prev);
  if (!d) return "";
  const s = `${d > 0 ? "+" : "-"}${Math.abs(d)}`;
  return ` (${lang === "bn" ? bnNum(s) : s})`;
};
const FIRST_NAME = (name) => String(name || "").trim().split(/\s+/)[0] || "";

const PERIOD_WORD = {
  en: { weekly: "weekly", biweekly: "2-week", monthly: "monthly" },
  bn: { weekly: "সাপ্তাহিক", biweekly: "দুই সপ্তাহের", monthly: "মাসিক" },
};

// The SMS: short, with the link carrying the rest. Kept to one or two parts.
const periodicSms = (snap, { brand, link, tz, lang, frequency }) => {
  const name = FIRST_NAME(snap.student.name);
  const range = rangeText(snap.from, snap.to, tz, lang);
  const live = snap.live.total ? snap.live : null;
  if (lang === "bn") {
    const parts = [];
    if (snap.exams.length) {
      parts.push(`পরীক্ষা ${bnNum(snap.exams.length)}টি, গড় ${fmtPct(snap.avg, "bn")}${trend(snap.avg, snap.prevAvg, "bn")}`);
      if (snap.rank) parts.push(`অবস্থান ${bnNum(snap.rank)}/${bnNum(snap.of)}`);
    } else parts.push("কোনো পরীক্ষা দেয়নি");
    if (snap.missed.length) parts.push(`মিস ${bnNum(snap.missed.length)}টি`);
    if (live) parts.push(`লাইভ ক্লাস ${bnNum(live.attended)}/${bnNum(live.total)}`);
    if (snap.assignments.missing.length) parts.push(`জমা হয়নি ${bnNum(snap.assignments.missing.length)}টি কাজ`);
    return `${brand ? `${brand}: ` : ""}${name}-এর ${PERIOD_WORD.bn[frequency] || ""} রিপোর্ট (${range}): ${parts.join(", ")}।${link ? ` বিস্তারিত: ${link}` : ""}`;
  }
  const parts = [];
  if (snap.exams.length) {
    parts.push(`${snap.exams.length} exam${snap.exams.length === 1 ? "" : "s"}, avg ${fmtPct(snap.avg, "en")}${trend(snap.avg, snap.prevAvg, "en")}`);
    if (snap.rank) parts.push(`rank ${snap.rank}/${snap.of}`);
  } else parts.push("no exams taken");
  if (snap.missed.length) parts.push(`missed ${snap.missed.length}`);
  if (live) parts.push(`live classes ${live.attended}/${live.total}`);
  if (snap.assignments.missing.length) parts.push(`${snap.assignments.missing.length} assignment${snap.assignments.missing.length === 1 ? "" : "s"} not handed in`);
  return `${brand ? `${brand}: ` : ""}${name} ${PERIOD_WORD.en[frequency] || ""} report (${range}): ${parts.join(", ")}.${link ? ` Details: ${link}` : ""}`;
};

const resultSms = (snap, { brand, link, lang }) => {
  const name = FIRST_NAME(snap.student.name);
  const e = snap.exams[0];
  if (lang === "bn") {
    return `${brand ? `${brand}: ` : ""}${name} "${e.title}"-এ পেয়েছে ${bnNum(e.marks)}/${bnNum(e.total)} (${fmtPct(e.pct, "bn")})${e.rank ? `, অবস্থান ${bnNum(e.rank)}/${bnNum(e.of)}` : ""}।${link ? ` ${link}` : ""}`;
  }
  return `${brand ? `${brand}: ` : ""}${name} scored ${e.marks}/${e.total} (${fmtPct(e.pct, "en")}) in "${e.title}"${e.rank ? `, rank ${e.rank}/${e.of}` : ""}.${link ? ` ${link}` : ""}`;
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The email: the SMS line as the summary, then the details as a table.
const emailFor = (snap, { brand, link, tz, lang, frequency, kind, smsText, settings }) => {
  const bn = lang === "bn";
  const subject = kind === "result"
    ? (bn ? `${snap.student.name}: "${snap.exams[0].title}"-এর ফল` : `${snap.student.name}: result for ${snap.exams[0].title}`)
    : (bn ? `${snap.student.name}: ${PERIOD_WORD.bn[frequency]} রিপোর্ট (${rangeText(snap.from, snap.to, tz, "bn")})` : `${snap.student.name}: ${PERIOD_WORD.en[frequency]} progress report (${rangeText(snap.from, snap.to, tz, "en")})`);
  const L = bn
    ? { exam: "পরীক্ষা", marks: "নম্বর", score: "শতকরা", rank: "অবস্থান", missed: "মিস করা পরীক্ষা", work: "জমা না দেওয়া কাজ", live: "লাইভ ক্লাস", full: "পুরো রিপোর্ট দেখুন", none: "এই সময়ে কোনো পরীক্ষা দেয়নি।" }
    : { exam: "Exam", marks: "Marks", score: "Score", rank: "Rank", missed: "Missed exams", work: "Work not handed in", live: "Live classes", full: "See the full report", none: "No exams taken in this period." };
  const rows = snap.exams.map((e) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(e.title)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${e.marks}/${e.total}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${e.pct}%</td>${snap.showRank ? `<td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${e.rank ? `${e.rank}/${e.of}` : "—"}</td>` : ""}</tr>`).join("");
  const table = snap.exams.length
    ? `<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #333">${L.exam}</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333">${L.marks}</th><th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333">${L.score}</th>${snap.showRank ? `<th style="text-align:right;padding:6px 8px;border-bottom:2px solid #333">${L.rank}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>`
    : `<p>${L.none}</p>`;
  const extra = [
    snap.missed?.length ? `<p><strong>${L.missed}:</strong> ${snap.missed.map(esc).join(", ")}</p>` : "",
    snap.assignments?.missing?.length ? `<p><strong>${L.work}:</strong> ${snap.assignments.missing.map(esc).join(", ")}</p>` : "",
    snap.live?.total ? `<p><strong>${L.live}:</strong> ${snap.live.attended}/${snap.live.total}</p>` : "",
  ].join("");
  const html = require("./emailLayout").render(settings || { siteName: brand }, {
    title: subject,
    text: smsText.replace(/\s*(Details:|বিস্তারিত:)?\s*https?:\/\/\S+$/, ""),
    html: `<div class="m-text" style="font-size:14px;color:#3c4253">${table}${extra}</div>`,
    button: link ? { label: L.full, url: link } : null,
  });
  const text = [smsText, "", ...snap.exams.map((e) => `${e.title}: ${e.marks}/${e.total} (${e.pct}%)${e.rank ? ` ${L.rank} ${e.rank}/${e.of}` : ""}`), snap.missed?.length ? `${L.missed}: ${snap.missed.join(", ")}` : "", snap.assignments?.missing?.length ? `${L.work}: ${snap.assignments.missing.join(", ")}` : ""].filter((x, i) => i < 2 || x).join("\n");
  return { subject, text, html };
};

// ---------- SMS parts ----------

const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;
const smsParts = (text) => {
  const s = String(text || "");
  if (GSM.test(s)) return s.length <= 160 ? 1 : Math.ceil(s.length / 153);
  const units = [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0);
  return units <= 70 ? 1 : Math.ceil(units / 67);
};

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const smsPartsThisMonth = async (now = new Date()) => {
  const rows = await ProgressReport.aggregate([
    { $match: { "deliveries.at": { $gte: monthStart(now) } } },
    { $unwind: "$deliveries" },
    { $match: { "deliveries.channel": "sms", "deliveries.status": "sent", "deliveries.at": { $gte: monthStart(now) } } },
    { $group: { _id: null, parts: { $sum: "$deliveries.parts" } } },
  ]);
  return rows[0]?.parts || 0;
};

// ---------- sending ----------

const linkFor = (token, settings) => {
  const base = studentBase(settings);
  return /^https?:\/\//.test(base) ? `${base}/progress/${token}` : "";
};

// Who gets this report and how, from the batch's switches.
const targetsFor = (student, cfg) => {
  const out = [];
  if (cfg.student?.sms && student.phoneNumber) out.push({ recipient: "student", channel: "sms", to: student.phoneNumber });
  if (cfg.student?.email && student.email) out.push({ recipient: "student", channel: "email", to: student.email });
  const g = student.guardian || {};
  if (!g.optOut) {
    if (cfg.guardian?.sms && g.phone && g.phone !== student.phoneNumber) out.push({ recipient: "guardian", channel: "sms", to: g.phone });
    if (cfg.guardian?.email && g.email && g.email !== student.email) out.push({ recipient: "guardian", channel: "email", to: g.email });
  }
  return out;
};

// Sends one report to its targets. `budget` is shared across a run so the
// monthly SMS cap holds while a batch is going out.
const deliver = async (report, targets, { settings, budget, adapters = { sms, email } }) => {
  const mail = emailFor(report.snapshot, {
    brand: settings.siteName || "", settings, link: linkFor(report.token, settings), tz: zoneOf(settings),
    lang: report.language, frequency: report.frequency, kind: report.kind, smsText: report.smsText,
  });
  const results = [];
  for (const t of targets) {
    const entry = { ...t, at: new Date(), parts: 0, status: "sent", error: "" };
    try {
      if (t.channel === "sms") {
        if (!adapters.sms.configured()) throw Object.assign(new Error("No SMS gateway is set up."), { skip: true });
        const parts = smsParts(report.smsText);
        if (budget.cap > 0 && budget.used + parts > budget.cap) throw Object.assign(new Error("Monthly SMS limit reached."), { skip: true });
        await adapters.sms.send(t.to, report.smsText);
        entry.parts = parts;
        budget.used += parts;
      } else {
        if (!adapters.email.configured()) throw Object.assign(new Error("Email (SMTP) is not set up."), { skip: true });
        await adapters.email.send(t.to, mail.subject, mail.text, mail.html);
      }
    } catch (error) {
      entry.status = error.skip ? "skipped" : "failed";
      entry.error = String(error.message || error).slice(0, 300);
    }
    results.push(entry);
  }
  return results;
};

const statusOf = (deliveries) => {
  if (!deliveries.length) return "nothing";
  const sent = deliveries.filter((d) => d.status === "sent").length;
  if (sent === deliveries.length) return "sent";
  return sent ? "partial" : "failed";
};

// 96 bits: short enough for an SMS, far too many to guess.
const newToken = () => crypto.randomBytes(12).toString("base64url");

// Make and send one batch's reports for [from, to). Returns counts.
const runBatch = async (batch, { period, from, to, settings, now = new Date(), adapters, onlyStudents = null }) => {
  const cfg = batch.progressReports || {};
  const tz = zoneOf(settings);
  let students = await roster(batch._id);
  if (onlyStudents) students = students.filter((s) => onlyStudents.has(String(s._id)));
  const full = await Student.find({ _id: { $in: students.map((s) => s._id) } }).select("name studentId email phoneNumber guardian").lean();
  const snaps = await buildSnapshots(batch, full, from, to, { showRank: cfg.showRank !== false });
  const budget = { cap: settings.progressReports?.smsMonthlyCap || 0, used: await smsPartsThisMonth(now) };
  const counts = { students: full.length, sent: 0, failed: 0, skipped: 0, nothing: 0, already: 0 };

  for (const student of full) {
    const snapshot = snaps[String(student._id)];
    const token = newToken();
    const smsText = periodicSms(snapshot, { brand: settings.siteName || "", link: linkFor(token, settings), tz, lang: cfg.language || "en", frequency: cfg.frequency || "weekly" });
    let report;
    try {
      report = await ProgressReport.create({
        batch: batch._id, student: student._id, kind: "periodic", period, from, to,
        frequency: cfg.frequency || "weekly", language: cfg.language || "en",
        snapshot, smsText, token, expiresAt: new Date(now.getTime() + (settings.progressReports?.linkDays || 60) * DAY),
      });
    } catch (error) {
      if (error.code === 11000) { counts.already += 1; continue; }
      throw error;
    }
    const deliveries = await deliver(report, targetsFor(student, cfg), { settings, budget, adapters });
    report.deliveries = deliveries;
    report.status = statusOf(deliveries);
    await report.save();
    for (const d of deliveries) counts[d.status] += 1;
    if (!deliveries.length) counts.nothing += 1;
  }
  return counts;
};

// The instant message when an exam is graded. Never throws: grading must
// not fail because a message couldn't go out.
const sendResultMessage = async (submissionId, { adapters, now = new Date() } = {}) => {
  try {
    const settings = await AppSettings.get();
    if (!settings.progressReports?.enabled) return null;
    const sub = await Submission.findById(submissionId).select("exam student batch marks totalMarks status submittedAt").lean();
    if (!sub || sub.status !== "graded" || !(sub.totalMarks > 0)) return null;
    const batch = await Batch.findById(sub.batch).select("name progressReports").lean();
    const cfg = batch?.progressReports;
    if (!cfg?.instantResult) return null;
    const exam = await Exam.findById(sub.exam).select("title createdByStudent showResultImmediately").lean();
    if (!exam || exam.createdByStudent || exam.showResultImmediately === false) return null;
    const student = await Student.findById(sub.student).select("name studentId email phoneNumber guardian").lean();
    if (!student) return null;

    const all = await Submission.find({ exam: sub.exam, batch: sub.batch, status: "graded" }).select("student marks totalMarks").lean();
    const best = new Map();
    for (const s of all) {
      if (!(s.totalMarks > 0)) continue;
      const p = pct(s.marks, s.totalMarks);
      if (!best.has(String(s.student)) || best.get(String(s.student)) < p) best.set(String(s.student), p);
    }
    const scores = [...best.values()].sort((a, b) => b - a);
    const mine = pct(sub.marks, sub.totalMarks);
    const showRank = cfg.showRank !== false;
    const snapshot = {
      student: { name: student.name, studentId: student.studentId || null }, batch: { name: batch.name },
      from: null, to: null,
      exams: [{ title: exam.title, marks: sub.marks, total: sub.totalMarks, pct: mine, at: sub.submittedAt, rank: showRank ? 1 + scores.filter((x) => x > mine).length : null, of: showRank ? scores.length : null }],
      showRank,
    };
    const token = newToken();
    const lang = cfg.language || "en";
    const smsText = resultSms(snapshot, { brand: settings.siteName || "", link: linkFor(token, settings), lang });
    let report;
    try {
      report = await ProgressReport.create({
        batch: batch._id, student: student._id, kind: "result", period: String(sub._id), language: lang,
        snapshot, smsText, token, expiresAt: new Date(now.getTime() + (settings.progressReports?.linkDays || 60) * DAY),
      });
    } catch (error) {
      if (error.code === 11000) return null; // a regrade: the first result already went out
      throw error;
    }
    const budget = { cap: settings.progressReports?.smsMonthlyCap || 0, used: await smsPartsThisMonth(now) };
    report.deliveries = await deliver(report, targetsFor(student, cfg), { settings, budget, adapters });
    report.status = statusOf(report.deliveries);
    await report.save();
    return report;
  } catch (error) {
    console.error(`Result message for ${submissionId} failed: ${error.message}`);
    return null;
  }
};

// The scheduler's pass: every batch with reports on whose send is due.
// Claiming lastPeriod first means only one server sends each one.
const runDue = async ({ now = new Date(), adapters } = {}) => {
  const settings = await AppSettings.get();
  if (!settings.progressReports?.enabled) return [];
  const tz = zoneOf(settings);
  const batches = await Batch.find({ "progressReports.enabled": true }).select("name progressReports");
  const done = [];
  for (const batch of batches) {
    const occ = dueOccurrence(batch.progressReports, now, tz);
    if (!occ) continue;
    const claim = await Batch.updateOne(
      { _id: batch._id, "progressReports.lastPeriod": { $ne: occ.key } },
      { $set: { "progressReports.lastPeriod": occ.key } }
    );
    if (!claim.modifiedCount) continue;
    const counts = await runBatch(batch, { period: occ.key, from: occ.from, to: occ.at, settings, now, adapters });
    done.push({ batch: batch._id, period: occ.key, ...counts });
  }
  return done;
};

// Send now (staff): the stretch that ends now, as long as the schedule's.
const runNow = async (batch, { now = new Date(), adapters, onlyStudents } = {}) => {
  const settings = await AppSettings.get();
  const span = batch.progressReports?.frequency === "monthly" ? 30 : batch.progressReports?.frequency === "biweekly" ? 14 : 7;
  return runBatch(batch, { period: `manual-${now.toISOString()}`, from: new Date(now.getTime() - span * DAY), to: now, settings, now, adapters, onlyStudents });
};

// What a batch's report will look like, without sending: one student's
// message, how many people and SMS parts, and an estimated cost.
const preview = async (batch, { now = new Date() } = {}) => {
  const settings = await AppSettings.get();
  const cfg = batch.progressReports || {};
  const tz = zoneOf(settings);
  const span = cfg.frequency === "monthly" ? 30 : cfg.frequency === "biweekly" ? 14 : 7;
  const from = new Date(now.getTime() - span * DAY);
  const students = await roster(batch._id);
  const full = await Student.find({ _id: { $in: students.map((s) => s._id) } }).select("name studentId email phoneNumber guardian").lean();
  const snaps = await buildSnapshots(batch, full, from, now, { showRank: cfg.showRank !== false });
  const sampleLink = linkFor("SAMPLE", settings);
  let smsCount = 0;
  let parts = 0;
  let emails = 0;
  let sample = null;
  const coverage = { students: full.length, guardianPhone: 0, guardianEmail: 0, studentPhone: 0, studentEmail: 0, noRecipient: 0 };
  for (const s of full) {
    const text = periodicSms(snaps[String(s._id)], { brand: settings.siteName || "", link: sampleLink, tz, lang: cfg.language || "en", frequency: cfg.frequency || "weekly" });
    if (!sample || snaps[String(s._id)].exams.length > sample.exams) sample = { name: s.name, text, parts: smsParts(text), exams: snaps[String(s._id)].exams.length };
    const t = targetsFor(s, cfg);
    for (const x of t) {
      if (x.channel === "sms") { smsCount += 1; parts += smsParts(text); } else emails += 1;
    }
    if (!t.length) coverage.noRecipient += 1;
    if (s.guardian?.phone && !s.guardian.optOut) coverage.guardianPhone += 1;
    if (s.guardian?.email && !s.guardian.optOut) coverage.guardianEmail += 1;
    if (s.phoneNumber) coverage.studentPhone += 1;
    if (s.email) coverage.studentEmail += 1;
  }
  const next = nextOccurrence(cfg, now, tz);
  return {
    sample, sms: smsCount, smsParts: parts, emails, coverage,
    cost: settings.progressReports?.smsPartCost ? Math.round(parts * settings.progressReports.smsPartCost * 100) / 100 : null,
    currency: settings.defaultCurrency || "",
    smsReady: sms.configured(), emailReady: email.configured(), hasLink: Boolean(sampleLink),
    usedThisMonth: await smsPartsThisMonth(now), cap: settings.progressReports?.smsMonthlyCap || 0,
    next: next ? next.toISOString() : null, timezone: tz,
  };
};

// The next scheduled send after `now`.
const nextOccurrence = (cfg, now, tz) => {
  for (let ahead = 1; ahead <= 70; ahead += 1) {
    const probe = new Date(now.getTime() + ahead * DAY);
    const occ = lastOccurrence(cfg, probe, tz);
    if (occ && occ.at > now) return occ.at;
  }
  return null;
};

module.exports = {
  zoneOf, localParts, zonedTime, lastOccurrence, dueOccurrence, nextOccurrence,
  buildSnapshots, periodicSms, resultSms, emailFor, smsParts, smsPartsThisMonth,
  targetsFor, deliver, runBatch, runDue, runNow, preview, sendResultMessage, linkFor, rangeText,
};
