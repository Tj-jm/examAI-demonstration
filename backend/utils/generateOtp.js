const crypto = require("crypto");

// crypto.randomInt rather than Math.random, and a plain numeric code rather
// than TOTP — the original generated a fresh speakeasy secret on every send
// and then verified against a different field than it signed with.

const generateOtp = (digits = 6) => {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits - 1;
  return String(crypto.randomInt(min, max + 1));
};

const generateUniqueIdentifier = () => crypto.randomUUID();

module.exports = { generateOtp, generateUniqueIdentifier };
