const AppSettings = require("../models/appSettingsModel");
const Notification = require("../models/notificationModel");

// The one place that checks whether a notification type is switched on.
// Every trigger site (a doubt resolved, an exam graded, a notice going
// live) calls this instead of creating a Notification directly — a type
// the admin has turned off should mean the document is never written at
// all, not written and then hidden from a list, which is a distinction
// that matters the moment anyone audits the collection directly.
//
// studentIds may be one id or many — a doubt resolves for one student, a
// general notice reaches every student, a batch notice reaches everyone
// with access to it. Silently does nothing for an empty list rather than
// making every call site check first.
const notify = async (studentIds, type, { title, body = null, link = null }) => {
  const settings = await AppSettings.get();

  if (!settings.notificationSettings?.[type]) return;

  const ids = (Array.isArray(studentIds) ? studentIds : [studentIds]).filter(Boolean);
  if (ids.length === 0) return;

  await Notification.insertMany(
    ids.map((student) => ({ student, type, title, body, link }))
  );
};

module.exports = { notify };
