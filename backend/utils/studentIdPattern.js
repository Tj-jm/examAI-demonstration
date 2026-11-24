const crypto = require("crypto");
const mongoose = require("mongoose");

// Student IDs from Settings → Institution → Student ID pattern. Tokens:
//   {INIT}   name initials (up to 3 letters)
//   {H4}     4 characters keyed from the phone or email (HMAC with the
//            server secret, so the contact can't be read back or rebuilt)
//   {P2}     last 2 digits of the phone
//   {YY} {YYYY}  year joined
//   {###...} running number, padded to as many #s as given (1 to 8)
// An ID once given never changes, even if the name or contact does.

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.models.Counter || mongoose.model("Counter", counterSchema);

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O, 1/I
const TOKEN = /\{(INIT|H4|P2|YYYY|YY|#{1,8})\}/g;

const validPattern = (p) => {
  const s = String(p || "").trim().toUpperCase();
  if (!s) return "";
  if (s.length > 60) throw new Error("The student ID pattern is at most 60 characters.");
  if (!/\{#{1,8}\}/.test(s)) throw new Error("The student ID pattern needs a running number, like {####}.");
  const rest = s.replace(TOKEN, "");
  if (/[{}]/.test(rest)) throw new Error("Unknown token in the student ID pattern. Use {INIT}, {H4}, {P2}, {YY}, {YYYY} or {####}.");
  if (!/^[A-Z0-9\-_/.]*$/.test(rest)) throw new Error("The student ID pattern may use letters, digits and - _ / . only.");
  return s;
};

const initials = (name) => String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 3)
  .map((w) => w.normalize("NFKD").replace(/[^A-Za-z]/g, "").charAt(0)).join("").toUpperCase() || "X";

const hash4 = (s) => {
  const key = String(s.phoneNumber || s.email || s._id);
  const buf = crypto.createHmac("sha256", `student-id:${process.env.JWT_SECRET || ""}`).update(key).digest();
  let out = "";
  for (let i = 0; i < 4; i += 1) out += ALPHABET[buf[i] % 32];
  return out;
};

const render = (pattern, s, seq, year) => pattern.replace(TOKEN, (_, t) => {
  if (t === "INIT") return initials(s.name);
  if (t === "H4") return hash4(s);
  if (t === "P2") return (String(s.phoneNumber || "").replace(/\D/g, "").slice(-2) || "00").padStart(2, "0");
  if (t === "YYYY") return String(year);
  if (t === "YY") return String(year).slice(-2);
  return String(seq).padStart(t.length, "0");
});

// The next free ID for this student under the pattern (counter per year when
// the pattern has a year in it). Skips any already taken.
const nextStudentId = async (pattern, s) => {
  const year = new Date(s.createdAt || Date.now()).getFullYear();
  const key = /\{YY(YY)?\}/.test(pattern) ? `studentId:${year}` : "studentId";
  const Student = mongoose.model("Student");
  for (let i = 0; i < 20; i += 1) {
    const { seq } = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, new: true });
    const id = render(pattern, s, seq, year);
    if (!(await Student.exists({ studentId: id, _id: { $ne: s._id } }))) return id;
  }
  throw new Error("Couldn't find a free student ID.");
};

const currentPattern = async () => {
  const st = await require("../models/appSettingsModel").get();
  return st?.institution?.studentIdPattern || "";
};

const examplePreview = (pattern) => render(pattern, { name: "Turjo Jaman", phoneNumber: "+8801711111158", _id: "x" }, 42, new Date().getFullYear());

module.exports = { validPattern, nextStudentId, currentPattern, examplePreview };
