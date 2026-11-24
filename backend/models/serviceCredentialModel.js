const mongoose = require("mongoose");

// Credentials for outside services typed into Settings → Connections
// (utils/serviceCredentials.js): email, SMS, Zoom, video hosts, file
// storage, LiveKit. Same model as payment gateways: every value AES-256-GCM
// at rest with ENCRYPTION_KEY from the environment, never selected by
// default, and never sent back to the browser — the screen sees the last
// four characters of a secret, or a plain setting's value.
const serviceCredentialSchema = new mongoose.Schema(
  {
    service: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Env var name -> encrypted value.
    values: { type: Map, of: String, select: false, default: () => new Map() },
    last4: { type: Map, of: String, default: () => new Map() },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Who changed which credential, when, from where. Values are never logged.
const credentialAuditSchema = new mongoose.Schema({
  service: String,
  keys: [String],
  cleared: [String],
  by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  byName: String,
  ip: String,
  at: { type: Date, default: Date.now, index: true },
});

module.exports = {
  ServiceCredential: mongoose.model("ServiceCredential", serviceCredentialSchema),
  CredentialAudit: mongoose.model("CredentialAudit", credentialAuditSchema),
};
