const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const SupportTicket = require("../../models/supportTicketModel");
const Student = require("../../models/studentModel");
const User = require("../../models/userModel");
const storage = require("../../adapters/storage");
const { notify } = require("../../utils/notify");

// Staff side of support tickets. Owner/admin see and manage every ticket;
// a teacher only the tickets assigned to them.

const MANAGERS = ["owner", "admin"];
const isManager = (user) => MANAGERS.includes(user.role);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findTicket = async (req, res) => {
  const filter = mongoose.isValidObjectId(req.params.id) ? { _id: req.params.id } : null;
  if (filter && !isManager(req.user)) filter.assignedTo = req.user._id;
  const ticket = filter ? await SupportTicket.findOne(filter) : null;
  if (!ticket) {
    res.status(404);
    throw new Error("Ticket not found.");
  }
  return ticket;
};

const populateFull = (ticket) =>
  ticket.populate([
    { path: "student", select: "name email phoneNumber isActive" },
    { path: "batch", select: "name" },
    { path: "assignedTo", select: "name identifier" },
    { path: "messages.author", select: "name identifier" },
  ]);

//@desc   Tickets, filtered
//@route  GET /api/support?status=&category=&batchId=&assigned=me|none|<id>&search=&unread=1&page=
const listTickets = asyncHandler(async (req, res) => {
  const query = {};
  const { status, category, batchId, assigned, search, unread } = req.query;
  if (status === "active") query.status = { $in: ["open", "waiting"] };
  else if (SupportTicket.STATUSES.includes(status)) query.status = status;
  if (SupportTicket.CATEGORIES.includes(category)) query.category = category;
  if (batchId && mongoose.isValidObjectId(batchId)) query.batch = batchId;
  if (unread === "1") query.unreadByStaff = true;

  if (!isManager(req.user)) query.assignedTo = req.user._id;
  else if (assigned === "me") query.assignedTo = req.user._id;
  else if (assigned === "none") query.assignedTo = null;
  else if (assigned && mongoose.isValidObjectId(assigned)) query.assignedTo = assigned;

  if (search && String(search).trim()) {
    const pattern = new RegExp(escapeRegex(String(search).trim()), "i");
    const studentIds = await Student.find({ $or: [{ name: pattern }, { email: pattern }, { phoneNumber: pattern }] }).distinct("_id");
    query.$or = [{ subject: pattern }, { student: { $in: studentIds } }];
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 30;
  const [tickets, total] = await Promise.all([
    SupportTicket.find(query)
      .sort({ status: 1, lastActivityAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("student", "name email phoneNumber")
      .populate("batch", "name")
      .populate("assignedTo", "name")
      .select("subject category status student batch assignedTo lastActivityAt unreadByStaff createdAt")
      .lean(),
    SupportTicket.countDocuments(query),
  ]);
  res.status(200).json({ tickets, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

//@desc   How many tickets wait on staff (nav badge)
//@route  GET /api/support/counts
const ticketCounts = asyncHandler(async (req, res) => {
  const scope = isManager(req.user) ? {} : { assignedTo: req.user._id };
  const [open, unread] = await Promise.all([
    SupportTicket.countDocuments({ ...scope, status: "open" }),
    SupportTicket.countDocuments({ ...scope, unreadByStaff: true, status: { $ne: "resolved" } }),
  ]);
  res.status(200).json({ open, unread });
});

//@desc   One ticket (marks it read for staff)
//@route  GET /api/support/:id
const getTicket = asyncHandler(async (req, res) => {
  const ticket = await findTicket(req, res);
  if (ticket.unreadByStaff) {
    ticket.unreadByStaff = false;
    await ticket.save();
  }
  await populateFull(ticket);
  res.status(200).json({ ticket });
});

//@desc   Reply to the student; status defaults to "waiting" (on them)
//@route  POST /api/support/:id/reply
const replyTicket = asyncHandler(async (req, res) => {
  const ticket = await findTicket(req, res);
  const text = String(req.body.text || "").trim();
  const images = (Array.isArray(req.body.images) ? req.body.images : []).filter(Boolean).map(String).slice(0, 4);
  if (!text && !images.length) {
    res.status(400);
    throw new Error("Write a reply first.");
  }
  const status = ["open", "waiting", "resolved"].includes(req.body.status) ? req.body.status : "waiting";
  ticket.messages.push({ from: "staff", author: req.user._id, text, images });
  ticket.status = status;
  ticket.resolvedAt = status === "resolved" ? new Date() : undefined;
  ticket.unreadByStudent = true;
  ticket.lastActivityAt = new Date();
  if (!ticket.assignedTo) ticket.assignedTo = req.user._id;
  await ticket.save();

  await notify(ticket.student, "ticketReply", {
    title: status === "resolved" ? "Your support ticket was resolved" : "Support replied to your ticket",
    body: ticket.subject,
    link: `/support/${ticket._id}`,
  }).catch(() => {});

  await populateFull(ticket);
  res.status(200).json({ ticket });
});

//@desc   Change status or assignee
//@route  PUT /api/support/:id
const updateTicket = asyncHandler(async (req, res) => {
  const ticket = await findTicket(req, res);
  const { status, assignedTo } = req.body;
  if (status !== undefined) {
    if (!SupportTicket.STATUSES.includes(status)) {
      res.status(400);
      throw new Error("Unknown status.");
    }
    const wasResolved = ticket.status === "resolved";
    ticket.status = status;
    ticket.resolvedAt = status === "resolved" ? new Date() : undefined;
    if (status === "resolved" && !wasResolved) {
      await notify(ticket.student, "ticketReply", {
        title: "Your support ticket was resolved",
        body: ticket.subject,
        link: `/support/${ticket._id}`,
      }).catch(() => {});
    }
  }
  if (assignedTo !== undefined) {
    if (!isManager(req.user)) {
      res.status(403);
      throw new Error("Only an owner or admin can reassign tickets.");
    }
    if (assignedTo && !(await User.exists({ _id: assignedTo, isActive: true, role: { $in: ["owner", "admin", "teacher"] } }))) {
      res.status(400);
      throw new Error("That team member doesn't exist.");
    }
    ticket.assignedTo = assignedTo || null;
  }
  await ticket.save();
  await populateFull(ticket);
  res.status(200).json({ ticket });
});

//@desc   Upload an image for a staff reply
//@route  POST /api/support/upload-image
const uploadStaffImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }
  const stored = await storage.store("support-images", req.file);
  res.status(200).json({ url: await storage.urlFor(stored.key, stored.driver) });
});

//@desc   Team members tickets can be assigned to
//@route  GET /api/support/assignees
const listAssignees = asyncHandler(async (req, res) => {
  const users = await User.find({ isActive: true, role: { $in: ["owner", "admin", "teacher"] }, isDeleted: { $ne: true } }).select("name identifier role").lean();
  res.status(200).json({ users });
});

//@desc   Reopen window setting
//@route  GET/PUT /api/support/settings
const getSupportSettings = asyncHandler(async (req, res) => {
  const AppSettings = require("../../models/appSettingsModel");
  res.status(200).json({ support: (await AppSettings.get()).support || { reopenDays: 7 } });
});
const updateSupportSettings = asyncHandler(async (req, res) => {
  const AppSettings = require("../../models/appSettingsModel");
  const settings = await AppSettings.get();
  const support = settings.support || {};
  if (req.body.reopenDays !== undefined) support.reopenDays = Math.min(365, Math.max(0, Math.round(Number(req.body.reopenDays) || 0)));
  settings.support = support;
  await settings.save();
  res.status(200).json({ support: settings.support });
});

module.exports = { getSupportSettings, updateSupportSettings, listTickets, ticketCounts, getTicket, replyTicket, updateTicket, uploadStaffImage, listAssignees };
