const crypto = require("crypto");
const mongoose = require("mongoose");
const Student = require("../models/studentModel");
const Batch = require("../models/batchModel");
const Purchase = require("../models/purchaseModel");
const AppSettings = require("../models/appSettingsModel");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const { cleanGuardian } = require("./guardian");

// Students → Import: a spreadsheet of students in, accounts and access out.
// Each row is matched to an existing student by student ID, then email,
// then phone; otherwise a new account is made. A row's batches (by name or
// id, separated by ";") are granted the way Students → Grant access does.
// New accounts without a password get a generated one, returned once so it
// can be handed out.

const MAX_ROWS = 2000;

const passwordFor = () => {
  const words = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => words[crypto.randomInt(words.length)]).join("");
};

const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());

const importStudents = async (rows, { dryRun = false, recordedBy = null } = {}) => {
  if (!Array.isArray(rows) || !rows.length) {
    const error = new Error("No rows to import."); error.statusCode = 400; throw error;
  }
  if (rows.length > MAX_ROWS) {
    const error = new Error(`Up to ${MAX_ROWS} rows at a time. Split the file.`); error.statusCode = 400; throw error;
  }

  const batches = await Batch.find({}).select("name").lean();
  const byName = new Map(batches.map((b) => [b.name.trim().toLowerCase(), b]));
  const byId = new Map(batches.map((b) => [String(b._id), b]));
  const settings = await AppSettings.get();
  const currency = settings.defaultCurrency;

  const result = { created: 0, updated: 0, enrolled: 0, unchanged: 0, errors: [], credentials: [], dryRun };
  const seen = new Set(); // the same student twice in one file

  for (let i = 0; i < rows.length; i += 1) {
    const line = i + 2; // row 1 is the header in the spreadsheet
    const r = rows[i] || {};
    const name = clean(r.name);
    const studentId = clean(r.studentId).toUpperCase();
    const email = clean(r.email).toLowerCase();
    const rawPhone = clean(r.phoneNumber);
    const password = clean(r.password);
    const fail = (message) => result.errors.push({ line, message });

    let phoneNumber = "";
    if (rawPhone) {
      const parsed = parsePhoneNumberFromString(rawPhone);
      if (!parsed || !parsed.isValid()) { fail(`"${rawPhone}" isn't a valid phone number (include the country code).`); continue; }
      phoneNumber = parsed.number;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fail(`"${email}" isn't a valid email address.`); continue; }
    if (!studentId && !email && !phoneNumber) { fail("Needs a student ID, email or phone number."); continue; }
    if (password && password.length < 8) { fail("A password needs at least 8 characters."); continue; }

    // Guardian columns: only the ones the file has are applied, so a file
    // without them never wipes contacts already on record.
    const guardianIn = {};
    for (const [col, field] of [["guardianName", "name"], ["guardianRelation", "relation"], ["guardianPhone", "phone"], ["guardianEmail", "email"]]) {
      if (r[col] !== undefined && clean(r[col]) !== "") guardianIn[field] = clean(r[col]);
    }
    const guardianCheck = cleanGuardian(guardianIn, {}, settings);
    if (guardianCheck.error) { fail(guardianCheck.error); continue; }

    const key = studentId || email || phoneNumber;
    if (seen.has(key)) { fail(`${key} appears more than once in the file.`); continue; }
    seen.add(key);

    const wanted = clean(r.batch).split(/[;|]/).map((b) => b.trim()).filter(Boolean);
    const targets = [];
    let missing = null;
    for (const b of wanted) {
      const found = (mongoose.isValidObjectId(b) && byId.get(b)) || byName.get(b.toLowerCase());
      if (!found) { missing = b; break; }
      targets.push(found);
    }
    if (missing) { fail(`No batch called "${missing}".`); continue; }

    const existing = await Student.findOne({
      $or: [
        ...(studentId ? [{ studentId }] : []),
        ...(email ? [{ email }] : []),
        ...(phoneNumber ? [{ phoneNumber }] : []),
      ],
    }).select("+password");

    // Another student already holds one of this row's identifiers.
    if (existing) {
      const clash = (studentId && existing.studentId && existing.studentId !== studentId)
        || (email && existing.email && existing.email !== email && (await Student.exists({ email, _id: { $ne: existing._id } })))
        || (phoneNumber && (await Student.exists({ phoneNumber, _id: { $ne: existing._id } })));
      if (clash) { fail(`${key} matches a different student's details. Check the row.`); continue; }
    }

    let student = existing;
    let isNew = false;
    let givenPassword = null;
    if (!student) {
      if (!name) { fail("A new student needs a name."); continue; }
      isNew = true;
      givenPassword = password || passwordFor();
      student = new Student({
        name, studentId: studentId || undefined, email: email || undefined, phoneNumber: phoneNumber || undefined,
        password: givenPassword, isProfileComplete: true, isOtpVerified: true, isActive: true,
      });
    } else {
      if (name) student.name = name;
      if (studentId && !student.studentId) student.studentId = studentId;
      if (email && !student.email) student.email = email;
      if (phoneNumber && !student.phoneNumber) student.phoneNumber = phoneNumber;
      if (password) { student.password = password; givenPassword = password; }
      if (!student.isProfileComplete) { student.isProfileComplete = true; if (!student.password) { givenPassword = passwordFor(); student.password = givenPassword; } }
    }

    if (Object.keys(guardianIn).length) {
      const merged = cleanGuardian(guardianIn, student.guardian?.toObject?.() || student.guardian || {}, settings).guardian;
      const before = JSON.stringify(student.guardian?.toObject?.() || student.guardian || {});
      if (JSON.stringify({ ...merged }) !== before) student.guardian = merged;
    }

    // Batches the student doesn't already have a lasting grant or purchase for.
    const have = student._id && !isNew
      ? new Set((await Purchase.find({ student: student._id, batch: { $in: targets.map((t) => t._id) }, status: "complete" }).select("batch").lean()).map((p) => String(p.batch)))
      : new Set();
    const grants = targets.filter((t) => !have.has(String(t._id)));

    const changed = isNew || student.isModified();
    if (dryRun) {
      if (isNew) result.created += 1; else if (changed) result.updated += 1; else if (!grants.length) result.unchanged += 1;
      result.enrolled += grants.length;
      continue;
    }
    try {
      if (changed) await student.save();
    } catch (error) {
      fail(error.code === 11000 ? `${key} is already used by another student.` : error.message);
      continue;
    }
    if (grants.length) {
      await Purchase.insertMany(grants.map((t) => ({
        student: student._id, batch: t._id,
        plan: { label: "Imported", price: 0, durationDays: null, isInfinite: true },
        currency, provider: "manual", status: "complete", recordedBy, note: "Students → Import",
      })));
    }
    if (isNew) result.created += 1; else if (changed) result.updated += 1; else if (!grants.length) result.unchanged += 1;
    result.enrolled += grants.length;
    if (givenPassword) result.credentials.push({ name: student.name, studentId: student.studentId || "", email: student.email || "", phoneNumber: student.phoneNumber || "", password: givenPassword });
  }
  return result;
};

module.exports = { importStudents, MAX_ROWS };
