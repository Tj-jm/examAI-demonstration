const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const { generateUniqueIdentifier } = require("../../utils/generateOtp");
const { applyProfile, adminProfile, hasProfile, PROFILE_ROLES } = require("../../utils/teacherProfile");
const cache = require("../../utils/cache");
const tags = require("../../utils/cacheTags");

// The landing page shows teachers' cards; a change to who is active, or to
// a profile, must show there without waiting for the cache to expire.
const touchPublic = () => cache.touch(tags.LANDING, tags.BATCHES).catch(() => {});

// Only these fields can be written through the update endpoints. Passing
// req.body straight into findByIdAndUpdate is what lets a caller set their own
// role, so the allowlist is not optional.
const UPDATABLE = ["name", "email", "role", "isActive", "identifier"];

const pick = (body, fields) =>
  fields.reduce((acc, key) => {
    if (body[key] !== undefined) acc[key] = body[key];
    return acc;
  }, {});

const shape = (user) => ({
  _id: user._id,
  name: user.name,
  identifier: user.identifier,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  isDeleted: user.isDeleted,
  deletedAt: user.deletedAt,
  lastActiveAt: user.lastActiveAt,
  createdAt: user.createdAt,
  duty: { note: user.duty?.note || "", goal: user.duty?.goal || 0, off: user.duty?.off || [] },
  away: user.away?.until && user.away.until > new Date() ? user.away : null,
  phone: user.phone || "",
  payout: user.payout?.method && user.payout.method !== "none" ? user.payout : null,
  streak: require("./staffSelfController").streakOf(user.activeDays),
  activeDays: (user.activeDays || []).slice(-14),
  logins: (user.logins || []).slice(-1),
});

//@desc   List staff accounts
//@route  GET /api/users
//@access Private, admin
const getUsers = asyncHandler(async (req, res) => {
  const { search, role, includeDeleted } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const query = {};
  // A deleted account is kept forever for the historical references that
  // point at it (see userModel.js's isDeleted comment) but has no business
  // cluttering the everyday team roster — includeDeleted is the explicit
  // opt-in for the one screen that actually needs to audit them.
  if (includeDeleted !== "true") query.isDeleted = { $ne: true };
  if (role) query.role = role;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(query),
  ]);

  res.status(200).json({
    users: users.map(shape),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

//@desc   Everyone who can have a public profile (owner, admins, teachers),
//        for the landing page's teachers picker
//@route  GET /api/users/profiles
//@access Private, admin
const getProfilePeople = asyncHandler(async (req, res) => {
  const users = await User.find({ role: { $in: [...PROFILE_ROLES] }, isActive: true, isDeleted: { $ne: true } })
    .select("name role profile.public")
    .sort({ name: 1 })
    .limit(500)
    .lean();
  res.status(200).json(users.map((u) => ({ _id: u._id, name: u.name, role: u.role, public: u.profile?.public !== false })));
});

//@desc   Get one staff account
//@route  GET /api/users/:id
//@access Private, admin
const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }

  res.status(200).json(shape(user));
});

//@desc   Create a staff account
//@route  POST /api/users
//@access Private, admin
const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("Name, email and password are required.");
  }

  // There is exactly one owner and it is created at setup.
  if (role === "owner") {
    res.status(403);
    throw new Error("The owner role cannot be assigned.");
  }

  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) {
    res.status(409);
    throw new Error("That email is already in use.");
  }

  const user = await User.create({
    name,
    email,
    password,
    role: role === "admin" ? "admin" : "teacher",
    sessionId: generateUniqueIdentifier(),
  });

  res.status(201).json(shape(user));
});

//@desc   Update a staff account
//@route  PUT /api/users/:id
//@access Private, admin
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }

  if (user.role === "owner") {
    res.status(403);
    throw new Error("The owner account cannot be modified here.");
  }

  if (user.isDeleted) {
    res.status(403);
    throw new Error("This account has been deleted and can no longer be edited.");
  }

  const updates = pick(req.body, UPDATABLE);

  if (updates.role === "owner") {
    res.status(403);
    throw new Error("The owner role cannot be assigned.");
  }

  // An admin demoting or deactivating themselves would lock them out mid-session.
  if (String(user._id) === String(req.user._id)) {
    delete updates.role;
    delete updates.isActive;
  }

  // representativeGate.js narrows restricted-role access by reading role
  // straight off the JWT (decoded.role), not from a fresh DB lookup — see
  // its own comment for why. That means a demotion or deactivation here
  // does nothing to an already-issued token: it stays valid, with the old
  // role still embedded, until it expires on its own. Rotating sessionId
  // forces adminAuth.protect()'s per-request DB lookup (which matches on
  // sessionId) to fail on that old token, so the account has to log in
  // again — and any token minted after that carries the current role.
  const roleChanged = "role" in updates && updates.role !== user.role;
  const deactivated = updates.isActive === false && user.isActive !== false;

  Object.assign(user, updates);
  // What they're responsible for, their weekly goal, features turned off,
  // and (if an admin sets it for them) away mode.
  if (req.body.duty && typeof req.body.duty === "object") {
    const d = req.body.duty;
    user.duty = {
      note: String(d.note ?? user.duty?.note ?? "").trim().slice(0, 1000),
      goal: Math.max(0, Math.min(10000, Math.round(Number(d.goal ?? user.duty?.goal) || 0))),
      off: Array.isArray(d.off) ? [...new Set(d.off.filter((k) => ["ai", "claimScripts", "doubts"].includes(k)))] : (user.duty?.off || []),
    };
  }
  if (req.body.away !== undefined) {
    const until = req.body.away?.until ? new Date(req.body.away.until) : null;
    user.away = { until: until && !Number.isNaN(until.getTime()) && until > new Date() ? until : null, note: String(req.body.away?.note || "").trim().slice(0, 200) };
  }

  if (roleChanged || deactivated) {
    user.sessionId = generateUniqueIdentifier();
  }
  // Scripts they had open go back to the queue now rather than in 20
  // minutes. Scripts they held are open to others already (gradingFlow).
  if (deactivated) await require("../../models/submissionModel").updateMany({ claimedBy: user._id }, { claimedBy: null, claimedAt: null });

  await user.save();
  touchPublic();

  res.status(200).json(shape(user));
});

//@desc   A staff account's public profile (photo, headline, subjects, bio)
//@route  GET /api/users/:id/profile
//@access Private, admin
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select("name role profile isDeleted");
  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }
  if (!hasProfile(user)) {
    res.status(400);
    throw new Error("Only an owner, admin or teacher has a public profile.");
  }
  res.status(200).json(await adminProfile(user));
});

//@desc   Edit a staff account's public profile
//@route  PUT /api/users/:id/profile
//@access Private, admin
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }
  if (user.isDeleted) {
    res.status(403);
    throw new Error("This account has been deleted and can no longer be edited.");
  }
  if (user.role === "owner" && String(user._id) !== String(req.user._id)) {
    res.status(403);
    throw new Error("Only the owner can edit the owner's profile.");
  }
  if (!hasProfile(user)) {
    res.status(400);
    throw new Error("Only an owner, admin or teacher has a public profile.");
  }
  applyProfile(user, req.body);
  await user.save();
  touchPublic();
  res.status(200).json(await adminProfile(user));
});

//@desc   Reset another account's password
//@route  PUT /api/users/:id/password
//@access Private, admin
const resetUserPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;

  if (!password) {
    res.status(400);
    throw new Error("A new password is required.");
  }

  const user = await User.findById(req.params.id).select("+password");

  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }

  if (user.role === "owner" && String(user._id) !== String(req.user._id)) {
    res.status(403);
    throw new Error("The owner password can only be changed by the owner.");
  }

  if (user.isDeleted) {
    res.status(403);
    throw new Error("This account has been deleted and can no longer be edited.");
  }

  user.password = password;
  // Ends every session that account has open.
  user.sessionId = generateUniqueIdentifier();
  await user.save();

  res.status(200).json({ message: "Password reset." });
});

//@desc   Delete a staff account
//@route  DELETE /api/users/:id
//@access Private, owner
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found.");
  }

  if (user.role === "owner") {
    res.status(403);
    throw new Error("The owner account cannot be deleted.");
  }

  if (String(user._id) === String(req.user._id)) {
    res.status(400);
    throw new Error("You cannot delete your own account.");
  }

  if (user.isDeleted) {
    res.status(400);
    throw new Error("This account is already deleted.");
  }

  // Soft delete, deliberately — see userModel.js's isDeleted comment. A
  // doubt this person resolved, or an exam answer they graded, keeps
  // showing their name (via identifierOrName()) with a "(deleted)" tag
  // rather than a broken reference or a name that quietly vanishes from
  // historical records.
  user.isDeleted = true;
  user.isActive = false;
  await require("../../models/submissionModel").updateMany({ claimedBy: user._id }, { claimedBy: null, claimedAt: null });
  user.deletedAt = new Date();
  // Frees the email for reuse (re-inviting someone at the same address
  // later) without ever exposing this mangled form anywhere — every
  // staff-facing display already reads identifierOrName(), never email,
  // for exactly this kind of historical reference.
  user.email = `deleted+${Date.now()}+${user.email}`;
  // Ends any session this account currently has open, same as a password
  // reset — a deleted account has no business staying logged in.
  user.sessionId = generateUniqueIdentifier();
  await user.save();
  touchPublic();

  res.status(200).json(shape(user));
});

module.exports = {
  getProfilePeople,
  getUserProfile,
  updateUserProfile,
  getUsers,
  getUser,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
};
