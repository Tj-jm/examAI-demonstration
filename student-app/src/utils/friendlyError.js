// Every API error passes through here (api/apiSlice.js) before a page shows
// error.data.message, so a student never reads a stack trace, a database
// error or a raw provider reply. The admin's wording (Settings -> Student
// app -> Error messages, studentUi.errorMessages) is set once settings load.
const DEFAULTS = {
  general: "Something went wrong. Please try again in a moment.",
  network: "Can't reach the server. Check your internet connection and try again.",
};

let custom = { general: "", network: "", rules: [] };

export const setErrorMessages = (cfg) => {
  custom = { general: cfg?.general || "", network: cfg?.network || "", rules: Array.isArray(cfg?.rules) ? cfg.rules : [] };
};

// Text written for a developer, not a student.
const TECHNICAL = new RegExp(
  [
    "Cast to", "ObjectId", "E11000", "duplicate key", "Mongo", "Mongoose", "validation failed",
    "ECONN", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "socket", "fetch failed", "Failed to fetch",
    "TypeError", "ReferenceError", "SyntaxError", "RangeError", "Cannot read", "is not a function",
    "is not defined", "undefined", "Unexpected token", "JSON", "status code", "answered \\d{3}",
    "Internal Server Error", "Bad Gateway", "Service Unavailable", "Gateway Time", "wss?://", "https?://",
    "\\bat \\S+ \\(", "[{}<>]",
  ].join("|"),
  "i"
);

const isTechnical = (msg) => msg.length > 220 || TECHNICAL.test(msg);

const general = () => custom.general || DEFAULTS.general;

export const friendlyMessage = (error) => {
  const original = typeof error?.data?.message === "string" ? error.data.message : "";

  const rule = original && custom.rules.find((r) => r.match && original.toLowerCase().includes(r.match.toLowerCase()));
  if (rule) return rule.text;

  if (error?.status === "FETCH_ERROR" || error?.status === "TIMEOUT_ERROR") return custom.network || DEFAULTS.network;
  if (error?.status === "PARSING_ERROR") return general();
  // No message at all: the page's own fallback ("Could not grade this right now.") says it best.
  if (original && isTechnical(original)) return general();
  return original;
};

// Same error, its message rewritten; every other field (codes a page acts
// on, like needsCredits) is kept as it came.
export const withFriendlyMessage = (error) => {
  const message = friendlyMessage(error);
  if (!message) return error;
  const data = error?.data && typeof error.data === "object" ? error.data : {};
  if (data.message === message) return error;
  return { ...error, data: { ...data, message } };
};
