const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const credentials = require("../../utils/serviceCredentials");

// Settings → Connections (utils/serviceCredentials.js). Owner only, like
// payment gateways. Saving asks for the owner's password again, so an
// unattended signed-in browser can't change where email, files or video go.

//@desc   Every service's fields: locked by the environment, saved (last 4
//        of a secret, or a plain value), or empty; and recent changes
//@route  GET /api/settings/connections
//@access Private (owner)
const getConnections = asyncHandler(async (req, res) => {
  res.status(200).json(await credentials.list());
});

//@desc   Save one service's credentials. A field left out is unchanged; an
//        empty one is removed.
//@route  PUT /api/settings/connections/:service  { values, password }
//@access Private (owner)
const saveConnection = asyncHandler(async (req, res) => {
  const me = await User.findById(req.user._id).select("+password");
  if (!me || !req.body.password || !(await me.matchPassword(String(req.body.password)))) {
    res.status(401);
    throw new Error("That password isn't right.");
  }
  try {
    const out = await credentials.save(req.params.service, req.body.values || {}, { user: req.user, ip: req.ip });
    res.status(200).json({ ...out, ...(await credentials.list()) });
  } catch (error) {
    res.status(error.statusCode || 400);
    throw error;
  }
});

//@desc   Try the saved credentials with a real call that sends nothing
//@route  POST /api/settings/connections/:service/test
//@access Private (owner)
const testConnection = asyncHandler(async (req, res) => {
  res.status(200).json(await credentials.test(req.params.service));
});

module.exports = { getConnections, saveConnection, testConnection };
