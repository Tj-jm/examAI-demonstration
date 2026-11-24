const mongoose = require("mongoose");

// One document per student per event — a general notice reaching 500
// students becomes 500 of these, not one shared row every student's read
// state would have to be tracked against separately. Simpler to query
// ("my unread count") at the cost of some duplication, which is the right
// trade at the scale this platform runs at (see utils/notify.js for where
// these get created, and utils/batchMembers.js for how "which students"
// gets resolved for a batch notice).
const notificationSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },

    // Kept to a small, known set rather than a free string — every type has
    // to have a matching admin toggle in AppSettings.notificationSettings,
    // and an unrecognised type would silently never be toggleable.
     type: {
       type: String,
       enum: ["doubtResolved", "examGraded", "examReview", "newNotice", "liveClassScheduled", "studyPlanReady", "examDisqualified", "examReminder", "ticketReply", "accountStanding", "accountDeletion", "aiCredits", "liveClassMissed", "studyNudge", "studyPlanDayDone", "assignmentNew", "assignmentGraded", "assignmentReminder", "certificateIssued", "referralReward", "campaign"],
       required: true,
     },

    title: { type: String, required: true },
    body: { type: String, default: null },

    // Where tapping the notification takes the student — the doubt thread,
    // the exam result, the notice's batch. Absent is valid (nothing to
    // navigate to), never a broken link.
    link: { type: String, default: null },

    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// The two queries this collection actually serves: the list itself (newest
// first) and the unread count (a covered query on student+isRead, so it
// never has to scan a student's full history to answer a badge count).
notificationSchema.index({ student: 1, createdAt: -1 });
notificationSchema.index({ student: 1, isRead: 1 });

// Auto-deleted 15 days after creation, read or not — nothing else in this
// feature ever prunes the collection (see the delete-one endpoint for the
// other way a notification goes away, at the student's own choice, sooner
// than this). Has to be its own single-field ascending index; a TTL index
// cannot piggyback on either compound index above.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 24 * 60 * 60 });

module.exports = mongoose.model("Notification", notificationSchema);
