const nodemailer = require("nodemailer");

// Email OTP delivery, independent of the SMS adapter — a student can
// register with either identifier, and this is the always-available side of
// that: once SMTP_* is set, email signup works regardless of whether a real
// SMS gateway is ever configured. No provider registry here, unlike sms and
// payment — SMTP is the one universal mechanism (nodemailer speaks to any
// SMTP host), so there's no second driver a real install would reach for.

let cached = null;

const getTransport = () => {
  if (cached) return cached;

  if (!configured()) {
    throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in the environment.");
  }

  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  return cached;
};

const configured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

// html is optional: mail clients that can't show it fall back to text.
const send = async (to, subject, text, html) => {
  const transport = getTransport();
  // Every email gets the shared look (utils/emailLayout.js): a plain text
  // one becomes a card with the subject as its title.
  const layout = require("../../utils/emailLayout");
  const settings = await require("../../models/appSettingsModel").get().catch(() => ({}));
  if (!layout.isLaidOut(html)) html = layout.render(settings, html ? { title: subject, html } : { title: subject, text });
  // The logo travels inside the email (cid:), so it shows without a public link.
  const { html: withLogo, attachments } = await layout.attachLogo(html, settings);
  html = withLogo;

  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
    ...(attachments.length ? { attachments } : {}),
  });
};

// Cleared in tests so a fresh SMTP_* env is picked up rather than a
// transport built against whatever the previous test set.
const reset = () => {
  cached = null;
};

// Settings → Connections' test: the server accepts the login.
const check = async () => {
  reset();
  await getTransport().verify();
  return { ok: true, message: "The mail server accepted the login." };
};

module.exports = { send, configured, reset, check };
