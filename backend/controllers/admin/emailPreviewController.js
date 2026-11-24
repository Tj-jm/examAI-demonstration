const asyncHandler = require("express-async-handler");
const AppSettings = require("../../models/appSettingsModel");
const layout = require("../../utils/emailLayout");
const email = require("../../adapters/email");

// Settings → Brand → Emails: a preview of the shared email look
// (utils/emailLayout.js) with sample words, and a test sent to me.
const SAMPLES = {
  reminder: (name) => ({
    subject: "Your enrolment isn't finished",
    kicker: "Almost there", title: "Finish joining Physics for Bosses",
    text: "Rafi, you started joining Physics for Bosses but didn't finish paying. You can pick up where you left off.",
    button: { label: "Finish enrolment", url: "https://example.com" },
    reason: `You're getting this because you have an account at ${name}.`, unsubscribe: "https://example.com",
  }),
  code: () => ({
    subject: "Your login code", title: "Your login code",
    text: "Enter this login code in the app. It works for 5 minutes.", code: "482 913",
    note: "Didn't ask for it? You can ignore this email.",
  }),
  notice: (name) => ({
    subject: "Model test on Friday", kicker: "Notice", title: "Model test on Friday at 8 pm",
    text: "Chapters 3 and 4. It runs for 60 minutes and opens in the app 10 minutes before.",
    item: { title: "Model test 4", sub: "Friday, 8:00 pm · 60 minutes", price: "50 marks" },
    button: { label: "See the details", url: "https://example.com" },
    reason: `You're getting this because you have an account at ${name}.`,
  }),
};

// Unsaved choices from the Settings form win over the saved ones.
const merged = (saved, body = {}) => {
  const s = saved.toObject ? saved.toObject() : { ...saved };
  if (typeof body.siteName === "string") s.siteName = body.siteName.slice(0, 120);
  if (body.theme) s.studentUi = { ...(s.studentUi || {}), theme: String(body.theme), customTheme: body.customTheme || s.studentUi?.customTheme };
  return s;
};

//@route  POST /api/settings/email/preview { kind, siteName, theme, customTheme }
//@access Owner, admin
const previewEmail = asyncHandler(async (req, res) => {
  const s = merged(await AppSettings.get(), req.body);
  const sample = (SAMPLES[req.body?.kind] || SAMPLES.reminder)(s.siteName || "your academy");
  res.status(200).json({ subject: sample.subject, html: await layout.inlineLogo(layout.render(s, sample), s) });
});

//@route  POST /api/settings/email/test { kind }
//@access Owner, admin
const testEmail = asyncHandler(async (req, res) => {
  if (!email.configured()) { res.status(400); throw new Error("Email isn't set up yet (Settings → Connections)."); }
  const to = req.user?.email;
  if (!to) { res.status(400); throw new Error("Your account has no email address."); }
  const s = await AppSettings.get();
  const sample = (SAMPLES[req.body?.kind] || SAMPLES.reminder)(s.siteName || "your academy");
  await email.send(to, `[Test] ${sample.subject}`, sample.text, layout.render(s, sample));
  res.status(200).json({ to });
});

module.exports = { previewEmail, testEmail };
