const asyncHandler = require("express-async-handler");
const AppSettings = require("../../models/appSettingsModel");
const { report } = require("../../utils/visitors");
const geo = require("../../utils/geo");

//@desc Visitors report: traffic, sources, funnel, courses (utils/visitors.js)
//@route GET /api/visitors?days=30
const getVisitors = asyncHandler(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  res.json(await report(days));
});

//@desc Switch the city lookup on or off; on downloads the database (utils/geo.js)
//@route POST /api/visitors/location { enabled }
const setLocation = asyncHandler(async (req, res) => {
  const settings = await AppSettings.get();
  const enabled = Boolean(req.body.enabled);
  settings.studentUi = { ...settings.studentUi.toObject(), visitorLocation: enabled };
  await settings.save();
  if (enabled && !geo.status().ready) await geo.download();
  res.json({ enabled, ...geo.status() });
});

module.exports = { getVisitors, setLocation };
