const asyncHandler = require("express-async-handler");
const AppSettings = require("../../models/appSettingsModel");
const { cleanLead, saveLead } = require("../../utils/leads");
const { looksLikeBot } = require("../../utils/botTrap");

//@desc   The landing page's interest form: name, phone or email, a course
//@route  POST /api/app/leads
//@access Public (rate limited)
const createLead = asyncHandler(async (req, res) => {
  // A bot (utils/botTrap.js) is answered as if fine.
  if (looksLikeBot(req.body)) return res.status(201).json({ ok: true });
  const settings = await AppSettings.get();
  const { lead, error } = cleanLead(req.body, settings);
  if (error) {
    res.status(400);
    throw new Error(error);
  }
  await saveLead(lead);
  res.status(201).json({ ok: true });
});

module.exports = { createLead };
