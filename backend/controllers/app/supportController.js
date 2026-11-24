const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const SupportTicket = require("../../models/supportTicketModel");
const storage = require("../../adapters/storage");
const AppSettings = require("../../models/appSettingsModel");
const { assertOwnMediaUrl, recordStudentUpload } = require("../../utils/mediaUrl");
const { preparePhoto } = require("../../utils/photo");

// A student's support tickets: open one, reply, close it. Staff side is in
// controllers/admin/supportController.js.

const MAX_IMAGES = 4;
const MAX_TEXT = 4000;

const cleanImages = async (images, studentId) => {
  const list = (Array.isArray(images) ? images : []).filter(Boolean).map(String);
  if (list.length > MAX_IMAGES) {
    const error = new Error(`Attach at most ${MAX_IMAGES} images.`);
    error.statusCode = 400;
    throw error;
  }
  for (const url of list) await assertOwnMediaUrl(url, studentId, "image");
  return list;
};

const cleanText = (text) => {
  const value = String(text || "").trim();
  if (value.length > MAX_TEXT) {
    const error = new Error(`Keep it under ${MAX_TEXT} characters.`);
    error.statusCode = 400;
    throw error;
  }
  return value;
};

const findOwn = async (req, res) => {
  const ticket = mongoose.isValidObjectId(req.params.id)
    ? await SupportTicket.findOne({ _id: req.params.id, student: req.student._id })
    : null;
  if (!ticket) {
    res.status(404);
    throw new Error("Ticket not found.");
  }
  return ticket;
};

// A resolved ticket takes replies (which reopen it) only within the
// reopen window. → the date it closes for good, or null if it's open.
const reopenDeadline = async (ticket) => {
  if (ticket.status !== "resolved") return null;
  const days = (await AppSettings.get()).support?.reopenDays ?? 7;
  return new Date(new Date(ticket.resolvedAt || ticket.updatedAt).getTime() + days * 86400000);
};

// Staff names are shown, not their emails or roles.
const shape = (ticket, deadline = null) => {
  const t = ticket.toObject ? ticket.toObject() : ticket;
  return {
    ...t,
    canReply: !deadline || deadline > new Date(),
    reopenUntil: deadline && deadline > new Date() ? deadline : null,
    assignedTo: undefined,
    messages: (t.messages || []).map((m) => ({
      _id: m._id,
      from: m.from,
      author: m.from === "staff" ? { name: m.author?.name || "Support" } : undefined,
      text: m.text,
      images: m.images,
      at: m.at,
    })),
  };
};

//@desc   My tickets, newest activity first
//@route  GET /api/app/support
const listMyTickets = asyncHandler(async (req, res) => {
  const tickets = await SupportTicket.find({ student: req.student._id })
    .sort({ lastActivityAt: -1 })
    .limit(100)
    .populate("batch", "name")
    .select("subject category status batch lastActivityAt unreadByStudent createdAt")
    .lean();
  res.status(200).json({ tickets });
});

//@desc   Open a ticket
//@route  POST /api/app/support
const createTicket = asyncHandler(async (req, res) => {
  const { category, batch, conductEvent } = req.body;
  const subject = String(req.body.subject || "").trim();
  const text = cleanText(req.body.text);
  if (!SupportTicket.CATEGORIES.includes(category)) {
    res.status(400);
    throw new Error("Pick what the ticket is about.");
  }
  if (!subject) {
    res.status(400);
    throw new Error("Give the ticket a short subject.");
  }
  const images = await cleanImages(req.body.images, req.student._id);
  if (!text && !images.length) {
    res.status(400);
    throw new Error("Describe the problem.");
  }

  let appealOf = null;
  if (conductEvent && mongoose.isValidObjectId(conductEvent)) {
    const ConductEvent = require("../../models/conductEventModel");
    const event = await ConductEvent.findOne({ _id: conductEvent, student: req.student._id }).select("_id");
    appealOf = event?._id || null;
  }

  const ticket = await SupportTicket.create({
    student: req.student._id,
    batch: batch && mongoose.isValidObjectId(batch) ? batch : null,
    category: appealOf ? "appeal" : category,
    subject: subject.slice(0, 140),
    conductEvent: appealOf,
    messages: [{ from: "student", text, images }],
  });
  if (appealOf) {
    const ConductEvent = require("../../models/conductEventModel");
    await ConductEvent.updateOne({ _id: appealOf }, { $set: { appealTicket: ticket._id } });
  }
  res.status(201).json({ ticket: shape(ticket) });
});

//@desc   One ticket with its conversation (marks staff replies read)
//@route  GET /api/app/support/:id
const getMyTicket = asyncHandler(async (req, res) => {
  const ticket = await findOwn(req, res);
  if (ticket.unreadByStudent) {
    ticket.unreadByStudent = false;
    await ticket.save();
  }
  await ticket.populate([{ path: "batch", select: "name" }, { path: "messages.author", select: "name" }]);
  res.status(200).json({ ticket: shape(ticket, await reopenDeadline(ticket)) });
});

//@desc   Reply (reopens a resolved ticket within the reopen window)
//@route  POST /api/app/support/:id/reply
const replyToTicket = asyncHandler(async (req, res) => {
  const ticket = await findOwn(req, res);
  const text = cleanText(req.body.text);
  const images = await cleanImages(req.body.images, req.student._id);
  if (!text && !images.length) {
    res.status(400);
    throw new Error("Write a reply first.");
  }
  const deadline = await reopenDeadline(ticket);
  if (deadline && deadline <= new Date()) {
    res.status(409);
    throw new Error("This ticket is closed. Open a new ticket if you still need help.");
  }
  ticket.messages.push({ from: "student", text, images });
  ticket.status = "open";
  ticket.resolvedAt = undefined;
  ticket.unreadByStaff = true;
  ticket.lastActivityAt = new Date();
  await ticket.save();
  await ticket.populate([{ path: "batch", select: "name" }, { path: "messages.author", select: "name" }]);
  res.status(200).json({ ticket: shape(ticket) });
});

//@desc   Close my own ticket
//@route  PUT /api/app/support/:id/resolve
const resolveMyTicket = asyncHandler(async (req, res) => {
  const ticket = await findOwn(req, res);
  ticket.status = "resolved";
  ticket.resolvedAt = new Date();
  await ticket.save();
  res.status(200).json({ ok: true });
});

//@desc   Unread staff replies (for a badge)
//@route  GET /api/app/support/unread-count
const unreadCount = asyncHandler(async (req, res) => {
  const count = await SupportTicket.countDocuments({ student: req.student._id, unreadByStudent: true });
  res.status(200).json({ count });
});

//@desc   Upload an image to attach
//@route  POST /api/app/support/upload-image
const uploadTicketImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }
  const stored = await storage.store("support-images", await preparePhoto(req.file));
  await recordStudentUpload(stored.key, req.student._id, "support-images");
  res.status(200).json({ url: await storage.urlFor(stored.key, stored.driver) });
});

module.exports = { listMyTickets, createTicket, getMyTicket, replyToTicket, resolveMyTicket, unreadCount, uploadTicketImage };
