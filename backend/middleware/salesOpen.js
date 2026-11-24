const asyncHandler = require("express-async-handler");
const AppSettings = require("../models/appSettingsModel");
const { resolveTerms } = require("../utils/institution");

// Refuses buying anything (plans, coupons, checkout, credit packs, a
// self-started trial) when the institution doesn't sell access
// (Settings → Institution → Sell access off). Students are added by staff.
const salesOpen = asyncHandler(async (req, res, next) => {
  const settings = await AppSettings.get();
  if (settings.institution?.sales === false) {
    const { org, batches } = resolveTerms(settings.institution);
    res.status(403);
    throw new Error(`Your ${org} adds you to your ${batches}; nothing is bought here. Ask them if you are expecting one.`);
  }
  next();
});

module.exports = { salesOpen };
