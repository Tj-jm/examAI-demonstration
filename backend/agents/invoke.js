// Calls an existing admin handler exactly as a staff member's click would:
// same validation, same rules, same side effects (notifications and so on).
// The agent never writes to the database by any other route.
const call = async (handler, { user, params = {}, query = {}, body = {} }) => {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  let failure = null;
  await new Promise((resolve) => {
    Promise.resolve(
      handler({
        user, params, query, body, headers: {}, ip: "agent", agent: true,
        protocol: (process.env.PUBLIC_URL || process.env.CLIENT_URL || "http://localhost").split("://")[0],
        get: (h) => (String(h).toLowerCase() === "host" ? (process.env.PUBLIC_URL || process.env.CLIENT_URL || "http://localhost:5000").split("://")[1]?.split("/")[0] : undefined),
      }, res, (err) => {
        if (err) failure = err;
        resolve();
      })
    ).then(resolve, (err) => { failure = err; resolve(); });
  });
  if (failure || res.statusCode >= 400) {
    const err = new Error(failure?.message || res.body?.message || `Request failed (${res.statusCode}).`);
    err.statusCode = res.statusCode >= 400 ? res.statusCode : 500;
    err.body = res.body;
    throw err;
  }
  return res.body;
};

module.exports = { call };
