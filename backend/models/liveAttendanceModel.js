const mongoose = require("mongoose");

// Who was in an in-app (LiveKit) class, and when — one document per person
// per class, with each stretch they were connected. Filled in by
// utils/liveAttendance.js, which checks the room every 30 seconds.
const liveAttendanceSchema = new mongoose.Schema(
  {
    liveClass: { type: mongoose.Schema.Types.ObjectId, ref: "LiveClass", required: true, index: true },
    identity: { type: String, required: true }, // "student:<id>" or "staff:<id>"
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, default: "" },
    role: { type: String, default: "student" },
    sessions: { type: [{ joinedAt: Date, leftAt: { type: Date, default: null } }], default: [] },
    lastSeenAt: { type: Date, default: null },
    totalSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

liveAttendanceSchema.index({ liveClass: 1, identity: 1 }, { unique: true });

module.exports = mongoose.model("LiveAttendance", liveAttendanceSchema);
