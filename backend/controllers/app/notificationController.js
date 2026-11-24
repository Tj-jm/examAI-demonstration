const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notificationModel");

//@desc   Paginated notification list, newest first
//@route  GET /api/app/notifications
//@access Private (student)
// What a student shouldn't miss among the rest.
const IMPORTANT_TYPES = ["accountStanding", "accountDeletion", "examDisqualified", "examReminder", "ticketReply", "examReview"];

const getNotifications = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  const query = { student: req.student._id };
  // ?filter=unread | important (account, exam and support matters).
  if (req.query.filter === "unread") query.isRead = false;
  if (req.query.filter === "important") query.type = { $in: IMPORTANT_TYPES };

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ student: req.student._id, isRead: false }),
  ]);

  res.status(200).json({
    notifications,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    unreadCount,
  });
});

//@desc   Just the unread count — polled for the bell icon's badge without
//        pulling the full list on every check.
//@route  GET /api/app/notifications/unread-count
//@access Private (student)
const getUnreadCount = asyncHandler(async (req, res) => {
  const unreadCount = await Notification.countDocuments({ student: req.student._id, isRead: false });
  res.status(200).json({ unreadCount });
});

//@desc   Mark one notification read — called when a student taps it
//@route  PUT /api/app/notifications/:id/read
//@access Private (student)
const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, student: req.student._id });

  if (!notification) {
    res.status(404);
    throw new Error("Notification not found.");
  }

  notification.isRead = true;
  await notification.save();

  res.status(200).json({ notification });
});

//@desc   Mark every notification read at once
//@route  PUT /api/app/notifications/read-all
//@access Private (student)
const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { student: req.student._id, isRead: false },
    { $set: { isRead: true } }
  );

  res.status(200).json({ message: "All caught up." });
});

//@desc   Delete one notification
//@route  DELETE /api/app/notifications/:id
//@access Private (student)
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({ _id: req.params.id, student: req.student._id });

  if (!notification) {
    res.status(404);
    throw new Error("Notification not found.");
  }

  res.status(200).json({ message: "Notification deleted." });
});

module.exports = { getNotifications, getUnreadCount, markRead, markAllRead, deleteNotification };
