const mongoose = require("mongoose");

// A certificate issued to a student. The wording is fixed at issue time, so
// later template changes never alter a certificate already handed out. The
// serial is the public check: /verify/<serial> shows it to anyone.
const certificateSchema = new mongoose.Schema(
  {
    serial: { type: String, required: true, unique: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "Batch", required: true, index: true },
    recipientName: { type: String, required: true },
    batchName: { type: String, default: "" },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    grade: { type: String, default: null },
    signatures: [{ _id: false, name: String, role: String, image: { type: String, default: null } }],
    style: { type: String, default: "classic" },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Certificate", certificateSchema);
