// Drops keys starting with "$" from request bodies and query strings, at
// any depth, so a value like {"email": {"$ne": null}} can never reach a
// Mongo filter as an operator. Controllers mostly String() their inputs
// already; this covers the ones that don't. Values are never touched.
const strip = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 20) return;
  for (const key of Object.keys(value)) {
    if (key.startsWith("$")) delete value[key];
    else strip(value[key], depth + 1);
  }
};

const stripOperators = (req, _res, next) => {
  strip(req.body);
  strip(req.query);
  next();
};

module.exports = { stripOperators, strip };
