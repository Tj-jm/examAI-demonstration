const { encrypt, decrypt } = require("./crypto");
const shared = require("./shared");

// Settings → Connections: credentials for outside services kept in the
// database (models/serviceCredentialModel.js) instead of the server's .env.
//
// The environment always wins. A key set in .env when the server started is
// shown as locked and the saved copy is never used for it. Everything else
// typed here is loaded into process.env at start (apply()) and again after
// every change, on every server, so the adapters read it exactly as they
// read .env and nothing else in the app changes.
//
// Values are encrypted with ENCRYPTION_KEY (in the environment, never the
// database), so a database dump alone opens nothing; and no route ever
// returns one: the screen sees a secret's last four characters, or a plain
// setting's value.

// What was in the environment before anything was loaded from the
// database. Read once, when this file is first required (server.js does
// that right after dotenv).
const BOOT_ENV = new Set(Object.keys(process.env).filter((k) => process.env[k] !== undefined && process.env[k] !== ""));
// Keys this process set from the database, so a cleared one can be removed.
const applied = new Set();

const f = (key, label, extra = {}) => ({ key, label, secret: false, ...extra });
const s = (key, label, extra = {}) => ({ key, label, secret: true, ...extra });

const SERVICES = [
  {
    id: "email",
    label: "Email (SMTP)",
    hint: "Sign-up codes, password resets, receipts and campaigns. Gmail, Zoho, Brevo, Amazon SES and others give SMTP details.",
    fields: [
      f("SMTP_HOST", "SMTP host", { placeholder: "smtp.gmail.com" }),
      f("SMTP_PORT", "Port", { placeholder: "587", optional: true }),
      f("SMTP_USER", "User name"),
      s("SMTP_PASS", "Password or app password"),
      f("SMTP_FROM", "From address", { placeholder: "Your School <hello@yourschool.com>", optional: true }),
    ],
  },
  {
    id: "sms",
    label: "SMS",
    hint: "Phone sign-up codes and SMS to students and guardians. Pick the gateway, then fill in its fields.",
    fields: [
      f("SMS_PROVIDER", "Gateway", { options: [["", "Off"], ["twilio", "Twilio"], ["vonage", "Vonage"], ["smsnetbd", "SMS.net.bd"], ["http", "Custom HTTP gateway"]], optional: true }),
      f("TWILIO_ACCOUNT_SID", "Twilio account SID", { optional: true, group: "twilio" }),
      s("TWILIO_AUTH_TOKEN", "Twilio auth token", { optional: true, group: "twilio" }),
      f("TWILIO_FROM_NUMBER", "Twilio from number", { optional: true, group: "twilio" }),
      f("VONAGE_API_KEY", "Vonage API key", { optional: true, group: "vonage" }),
      s("VONAGE_API_SECRET", "Vonage API secret", { optional: true, group: "vonage" }),
      f("VONAGE_FROM", "Vonage sender name", { optional: true, group: "vonage" }),
      s("SMS_API_KEY", "SMS.net.bd API key", { optional: true, group: "smsnetbd" }),
      f("SMS_HTTP_URL", "Gateway URL", { optional: true, group: "http" }),
      s("SMS_HTTP_AUTH_HEADER", "Authorization header", { optional: true, group: "http" }),
    ],
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    hint: "Codes, results and messages on WhatsApp, from your WhatsApp Business number (Meta WhatsApp Cloud API). Meta must approve the templates first.",
    fields: [
      f("MESSAGE_CHANNEL", "Send phone messages by", { options: [["sms", "SMS only"], ["whatsapp", "WhatsApp only"], ["whatsapp_sms", "WhatsApp, SMS if it fails"], ["both", "WhatsApp and SMS"]], optional: true }),
      s("WHATSAPP_TOKEN", "Access token"),
      f("WHATSAPP_PHONE_ID", "Phone number ID"),
      f("WHATSAPP_TEMPLATE", "Message template name", { placeholder: "A Utility template whose body is {{1}}" }),
      f("WHATSAPP_OTP_TEMPLATE", "Code template name", { placeholder: "An Authentication template", optional: true }),
      f("WHATSAPP_TEMPLATE_LANG", "Template language code", { placeholder: "en", optional: true }),
    ],
  },
  {
    id: "zoom",
    label: "Zoom",
    hint: "Make Zoom meetings for live classes from here. A Server-to-Server OAuth app in the Zoom App Marketplace.",
    fields: [
      f("ZOOM_ACCOUNT_ID", "Account ID"),
      f("ZOOM_CLIENT_ID", "Client ID"),
      s("ZOOM_CLIENT_SECRET", "Client secret"),
      s("ZOOM_WEBHOOK_SECRET_TOKEN", "Webhook secret token", { optional: true }),
    ],
  },
  {
    id: "bunny",
    label: "Bunny Stream",
    hint: "Lecture videos on Bunny: Stream → your library → API.",
    fields: [
      f("BUNNY_LIBRARY_ID", "Library ID"),
      s("BUNNY_SECURITY_KEY", "Token authentication key"),
      s("BUNNY_API_KEY", "API key (for uploads)", { optional: true }),
    ],
  },
  {
    id: "vimeo",
    label: "Vimeo",
    hint: "Upload lecture videos to Vimeo from here. An app token with the upload scope.",
    fields: [s("VIMEO_ACCESS_TOKEN", "Access token")],
  },
  {
    id: "vdocipher",
    label: "VdoCipher",
    hint: "DRM-protected lecture videos.",
    fields: [s("VDOCIPHER_API_SECRET", "API secret")],
  },
  {
    id: "storage",
    label: "File storage (S3, R2, MinIO)",
    hint: "Where uploads go. Local disk needs nothing. Changing this later doesn't move files already uploaded.",
    fields: [
      f("STORAGE_PROVIDER", "Where files go", { options: [["", "This server's disk (local)"], ["local", "This server's disk (local)"], ["s3", "S3-compatible bucket"]], optional: true }),
      f("S3_BUCKET", "Bucket", { optional: true, group: "s3" }),
      f("S3_REGION", "Region", { placeholder: "us-east-1 (R2: auto)", optional: true, group: "s3" }),
      f("S3_ENDPOINT", "Endpoint (R2, MinIO)", { placeholder: "https://<account>.r2.cloudflarestorage.com", optional: true, group: "s3" }),
      f("S3_ACCESS_KEY_ID", "Access key ID", { optional: true, group: "s3" }),
      s("S3_SECRET_ACCESS_KEY", "Secret access key", { optional: true, group: "s3" }),
      f("S3_PUBLIC_BASE_URL", "Public base URL", { optional: true, group: "s3" }),
      f("S3_FORCE_PATH_STYLE", "Path-style addresses (true/false)", { placeholder: "true for R2 and MinIO", optional: true, group: "s3" }),
    ],
  },
  {
    id: "google",
    label: "Google sign-in",
    hint: "Lets public webinar guests join with their Google account. In Google Cloud console → APIs & Services → Credentials, make an OAuth client ID (Web application) and add this site's address under Authorised JavaScript origins.",
    fields: [
      f("GOOGLE_CLIENT_ID", "Client ID", { placeholder: "1234…apps.googleusercontent.com" }),
    ],
  },
  {
    id: "livekit",
    label: "LiveKit (in-app classes)",
    hint: "Your LiveKit server for in-app live classes and webinars (LIVEKIT_SETUP.md).",
    fields: [
      f("LIVEKIT_URL", "Server address", { placeholder: "wss://live.yourschool.com" }),
      f("LIVEKIT_API_KEY", "API key"),
      s("LIVEKIT_API_SECRET", "API secret"),
      f("LIVEKIT_METRICS_URL", "Metrics address (monitor)", { placeholder: "http://livekit:6789/metrics", optional: true }),
    ],
  },
];

const SERVICE = new Map(SERVICES.map((sv) => [sv.id, sv]));
const ALL_KEYS = new Set(SERVICES.flatMap((sv) => sv.fields.map((x) => x.key)));

const model = () => require("../models/serviceCredentialModel");

// Cached clients built from the old values start over.
const resetCaches = () => {
  for (const path of ["../adapters/email", "../adapters/liveClass"]) {
    try { const a = require(path); (a.resetCaches || a.reset)?.(); } catch { /* not in this build */ }
  }
};

// Database values into process.env, for keys the environment doesn't set.
const apply = async () => {
  const { ServiceCredential } = model();
  const docs = await ServiceCredential.find({}).select("+values").lean();
  const next = new Map();
  for (const doc of docs) {
    for (const [key, enc] of Object.entries(doc.values || {})) {
      if (!ALL_KEYS.has(key) || BOOT_ENV.has(key)) continue;
      try { next.set(key, decrypt(enc)); } catch { /* wrong ENCRYPTION_KEY: leave it out */ }
    }
  }
  for (const key of applied) if (!next.has(key)) { delete process.env[key]; applied.delete(key); }
  for (const [key, value] of next) { process.env[key] = value; applied.add(key); }
  resetCaches();
  return next.size;
};

// On start, and when another server saves (shared settings broadcast).
let started = false;
const start = () => {
  if (started) return;
  started = true;
  shared.onSettingsChange((name) => { if (name === "ServiceCredential") apply().catch(() => {}); });
  apply().catch((error) => console.error(`Loading saved credentials: ${error.message}`));
};

const configuredOf = (sv) => sv.fields.filter((x) => !x.optional).every((x) => process.env[x.key]);

// The screen's view. No value of a secret, ever.
const list = async () => {
  const { ServiceCredential, CredentialAudit } = model();
  const docs = await ServiceCredential.find({}).select("+values").lean();
  const byService = new Map(docs.map((d) => [d.service, d]));
  const audit = await CredentialAudit.find({}).sort({ at: -1 }).limit(30).lean();
  return {
    encryption: Boolean(process.env.ENCRYPTION_KEY),
    services: SERVICES.map((sv) => {
      const doc = byService.get(sv.id);
      return {
        id: sv.id,
        label: sv.label,
        hint: sv.hint,
        configured: configuredOf(sv),
        updatedAt: doc?.updatedAt || null,
        fields: sv.fields.map((x) => {
          const envLocked = BOOT_ENV.has(x.key);
          const stored = doc?.values?.[x.key];
          let value = null;
          if (!x.secret && stored && !envLocked) {
            try { value = decrypt(stored); } catch { value = null; }
          }
          return {
            key: x.key,
            label: x.label,
            secret: x.secret,
            optional: Boolean(x.optional),
            placeholder: x.placeholder || "",
            options: x.options || null,
            group: x.group || null,
            envLocked,
            saved: Boolean(stored),
            last4: x.secret && stored ? doc.last4?.[x.key] || "" : null,
            value: envLocked ? (x.secret ? null : process.env[x.key]) : value,
          };
        }),
      };
    }),
    audit: audit.map((a) => ({ service: a.service, keys: a.keys, cleared: a.cleared, by: a.byName, ip: a.ip, at: a.at })),
  };
};

// values: { KEY: "new value" | "" (clear) }; a key left out stays as it is.
const save = async (serviceId, values, { user, ip } = {}) => {
  const sv = SERVICE.get(serviceId);
  if (!sv) { const e = new Error("Unknown service."); e.statusCode = 404; throw e; }
  if (!process.env.ENCRYPTION_KEY) {
    const e = new Error("ENCRYPTION_KEY is not set on the server, so credentials can't be stored safely. Set it, or put these in the environment instead.");
    e.statusCode = 400;
    throw e;
  }
  const { ServiceCredential, CredentialAudit } = model();
  const doc = (await ServiceCredential.findOne({ service: sv.id }).select("+values")) || new ServiceCredential({ service: sv.id });
  const changed = [];
  const cleared = [];
  for (const field of sv.fields) {
    if (!(field.key in (values || {}))) continue;
    if (BOOT_ENV.has(field.key)) continue;
    const value = String(values[field.key] ?? "").trim().slice(0, 4000);
    if (field.options && value && !field.options.some(([v]) => v === value)) {
      const e = new Error(`${field.label}: pick one of the choices.`);
      e.statusCode = 400;
      throw e;
    }
    if (!value) {
      if (doc.values.has(field.key)) { doc.values.delete(field.key); doc.last4.delete(field.key); cleared.push(field.key); }
      continue;
    }
    doc.values.set(field.key, encrypt(value));
    if (field.secret) doc.last4.set(field.key, value.slice(-4));
    else doc.last4.delete(field.key);
    changed.push(field.key);
  }
  if (!changed.length && !cleared.length) return { changed, cleared };
  doc.updatedBy = user?._id;
  await doc.save();
  await CredentialAudit.create({ service: sv.id, keys: changed, cleared, by: user?._id, byName: user?.name || user?.email || "", ip: ip || "" });
  await apply();
  shared.settingsChanged("ServiceCredential");
  notifyOwners(sv, changed, cleared, user).catch(() => {});
  return { changed, cleared };
};

// Every owner gets an email when a credential changes, so a stolen admin
// session can't quietly swap one.
const notifyOwners = async (sv, changed, cleared, user) => {
  const email = require("../adapters/email");
  if (!email.configured()) return;
  const User = require("../models/userModel");
  const owners = await User.find({ role: "owner", isDeleted: { $ne: true }, email: { $exists: true, $ne: "" } }).select("email").lean();
  const what = [...changed.map((k) => `changed ${k}`), ...cleared.map((k) => `removed ${k}`)].join(", ");
  for (const o of owners) {
    await email.send(
      o.email,
      `${sv.label} credentials were changed`,
      `${user?.name || "Someone"} ${what} under Settings → Connections at ${new Date().toUTCString()}. If this wasn't you or someone you trust, change your password and these credentials now.`,
    ).catch(() => {});
  }
};

// A real call with the current values, without sending anything to anyone.
// Each adapter knows how to check itself.
const CHECKS = {
  email: () => require("../adapters/email").check(),
  zoom: () => require("../adapters/liveClass").get("zoom").check(),
  livekit: () => require("../adapters/liveClass").get("livekit").check(),
  bunny: () => require("../adapters/video").get("bunny").check(),
  vimeo: () => require("../adapters/video").get("vimeo").check(),
  vdocipher: () => require("../adapters/video").get("vdocipher").check(),
  storage: () => ((process.env.STORAGE_PROVIDER || "local") === "s3"
    ? require("../adapters/storage/s3").check()
    : { ok: true, message: "Files are kept on this server's disk." }),
  whatsapp: () => require("../adapters/whatsapp").check(),
  google: () => (/^[\w-]+\.apps\.googleusercontent\.com$/.test(process.env.GOOGLE_CLIENT_ID || "")
    ? { ok: true, message: "That looks like a Google client ID. Try \"Continue with Google\" on a webinar's link to be sure." }
    : { ok: false, message: "A Google client ID ends in .apps.googleusercontent.com." }),
  sms: () => {
    if (!process.env.SMS_PROVIDER) return { ok: false, message: "Pick a gateway first." };
    const active = require("../adapters/sms").list().find((p) => p.active);
    return active?.configured
      ? { ok: true, message: "Every field is filled in. Send yourself a sign-up code to be sure: a test here would cost a message." }
      : { ok: false, message: "Some of this gateway's fields are missing." };
  },
};

const test = async (serviceId) => {
  const sv = SERVICE.get(serviceId);
  if (!sv || !CHECKS[sv.id]) return { ok: false, message: "Unknown service." };
  if (!configuredOf(sv) && !["sms", "storage"].includes(sv.id)) return { ok: false, message: "Fill in the required fields first." };
  try {
    return await CHECKS[sv.id]();
  } catch (error) {
    return { ok: false, message: String(error?.message || error).slice(0, 300) };
  }
};

module.exports = { start, apply, list, save, test, SERVICES, BOOT_ENV };
