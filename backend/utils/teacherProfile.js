const mongoose = require("mongoose");
const Media = require("../models/mediaModel");
const storage = require("../adapters/storage");

// A teacher's public profile (userModel.js's `profile`): cleaning what an
// admin or the teacher sends, and shaping what students and visitors see.
// Only these fields ever leave: never the email, role or anything else.

const SELECT = "name role isActive isDeleted profile";

// Only people who can teach have a public profile: a teacher, or an owner
// or admin who teaches. Graders, doubt solvers and representatives don't.
const PROFILE_ROLES = new Set(["owner", "admin", "teacher"]);
const hasProfile = (u) => PROFILE_ROLES.has(u?.role);

const text = (v, max) => String(v ?? "").trim().slice(0, max);

// The writable part of a profile from a request body. Unknown keys are
// dropped; a field left out stays as it is.
const cleanProfile = (body = {}) => {
  const out = {};
  if (body.headline !== undefined) out.headline = text(body.headline, 120);
  if (body.qualifications !== undefined) out.qualifications = text(body.qualifications, 300);
  if (body.bio !== undefined) out.bio = text(body.bio, 2000);
  if (body.subjects !== undefined) {
    const list = Array.isArray(body.subjects) ? body.subjects : String(body.subjects).split(",");
    out.subjects = [...new Set(list.map((s) => text(s, 40)).filter(Boolean))].slice(0, 12);
  }
  if (body.experienceYears !== undefined) {
    const n = body.experienceYears === null || body.experienceYears === "" ? null : Math.round(Number(body.experienceYears));
    out.experienceYears = n === null || !Number.isFinite(n) ? null : Math.min(80, Math.max(0, n));
  }
  if (body.public !== undefined) out.public = Boolean(body.public);
  if (body.photo !== undefined) out.photo = mongoose.isValidObjectId(body.photo) ? body.photo : null;
  return out;
};

// Copies a cleaned profile onto a user document.
const applyProfile = (user, body) => {
  const patch = cleanProfile(body);
  user.profile = { ...(user.profile?.toObject?.() || user.profile || {}), ...patch };
  return user;
};

const isShown = (u) => u && hasProfile(u) && u.isActive !== false && !u.isDeleted && u.profile?.public !== false;

// Photo urls for many users at once: one Media lookup, not one per user.
const photoUrls = async (users) => {
  const ids = [...new Set(users.map((u) => u.profile?.photo?._id || u.profile?.photo).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const media = await Media.find({ _id: { $in: ids }, kind: "image" }).select("key driver").lean();
  return new Map(await Promise.all(media.map(async (m) => [String(m._id), await storage.urlFor(m.key, m.driver)])));
};

const shapeWith = (urls) => (u) => ({
  _id: u._id,
  name: u.name,
  photo: urls.get(String(u.profile?.photo?._id || u.profile?.photo)) || null,
  headline: u.profile?.headline || "",
  subjects: u.profile?.subjects || [],
  qualifications: u.profile?.qualifications || "",
  experienceYears: u.profile?.experienceYears ?? null,
  bio: u.profile?.bio || "",
});

// Public cards for these users, in the order given, leaving out anyone
// hidden, disabled or deleted.
const shapePublicTeachers = async (users = []) => {
  const shown = users.filter(isShown);
  return shown.map(shapeWith(await photoUrls(shown)));
};

// The same for a list of batches' populated `teachers`, keyed by batch id,
// with one photo lookup for all of them.
const teachersByBatch = async (batches) => {
  const all = batches.flatMap((b) => (b.teachers || []).filter((t) => t && t.name));
  const urls = await photoUrls(all.filter(isShown));
  const shape = shapeWith(urls);
  return new Map(batches.map((b) => [String(b._id), (b.teachers || []).filter((t) => t && t.name && isShown(t)).map(shape)]));
};

// The admin's view of one user's profile: the photo as id and url.
const adminProfile = async (user) => {
  const p = user.profile?.toObject?.() || user.profile || {};
  const urls = await photoUrls([user]);
  return {
    photo: p.photo ? String(p.photo._id || p.photo) : null,
    photoUrl: urls.get(String(p.photo?._id || p.photo)) || null,
    headline: p.headline || "",
    subjects: p.subjects || [],
    qualifications: p.qualifications || "",
    experienceYears: p.experienceYears ?? null,
    bio: p.bio || "",
    public: p.public !== false,
  };
};

module.exports = { SELECT, PROFILE_ROLES, hasProfile, cleanProfile, applyProfile, shapePublicTeachers, teachersByBatch, adminProfile, isShown };
