// Fails fast on a bad install. Buyers get a clear message instead of a
// runtime crash three screens into the app.

const required = ["MONGO_URI", "JWT_SECRET", "ENCRYPTION_KEY"];

// backend/.env.ready ships in the repo with these two values pre-filled —
// "fine for local work", per its own comment, precisely because every
// clone of this codebase gets the exact same pair, and it says to
// regenerate both before anyone else can reach the install. That comment is
// unenforceable on its own; a live deployment that copied .env.ready
// straight to .env and forgot the regenerate step would otherwise start up
// fine with a JWT-signing secret and an at-rest encryption key that are
// public knowledge (checked into every copy of this source).
const SHIPPED_TEMPLATE_SECRETS = {
  JWT_SECRET: "b668c8d9f3e6b69413c8240275a1a04c424751d8778699a54899846ede6b7454a05f2c38358dbb57fa556d3724f4cfaf",
  ENCRYPTION_KEY: "1ed2c2d85bbb9370b095008dae9211ea358fcff32d20f79b290b2205f3e92f00",
};

const validateEnv = () => {
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.error("JWT_SECRET must be at least 32 characters.");
    console.error(`Generate one: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
    process.exit(1);
  }

  if (!/^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY)) {
    console.error("ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
    console.error(`Generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
    process.exit(1);
  }

  const usingShippedSecret =
    process.env.JWT_SECRET === SHIPPED_TEMPLATE_SECRETS.JWT_SECRET ||
    process.env.ENCRYPTION_KEY === SHIPPED_TEMPLATE_SECRETS.ENCRYPTION_KEY;

  if (usingShippedSecret) {
    const lines = [
      "JWT_SECRET/ENCRYPTION_KEY are still the values shipped in backend/.env.ready.",
      "Those are checked into every copy of this codebase and are not a secret. Generate your own:",
      `  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET`,
      `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY`,
    ];
    // Fine for the local-only quickstart .env.ready itself describes; fatal
    // the moment this might be a live deployment.
    if (process.env.NODE_ENV === "production") {
      lines.forEach((line) => console.error(line));
      process.exit(1);
    } else {
      lines.forEach((line) => console.warn(line));
    }
  }

  if (process.env.COOKIE_DOMAIN && process.env.COOKIE_SAMESITE !== "none") {
    console.warn("COOKIE_DOMAIN is set but COOKIE_SAMESITE is not 'none'.");
    console.warn("Cross-subdomain logins will fail. See .env.example.");
  }

  // The cookie's own Secure flag is tied to NODE_ENV, not to COOKIE_SAMESITE
  // (generateToken.js) — the two are set independently, so it's easy to
  // flip SameSite to 'none' (for COOKIE_DOMAIN above)
  // without also getting NODE_ENV=production. Browsers silently drop a
  // SameSite=None cookie that isn't also Secure: login still returns 200,
  // the cookie is just never stored, and the login screen keeps reopening
  // with no error to explain why.
  if (process.env.COOKIE_SAMESITE === "none" && process.env.NODE_ENV !== "production") {
    console.warn("COOKIE_SAMESITE=none but NODE_ENV is not 'production', so the cookie is not Secure.");
    console.warn("Browsers silently drop a SameSite=None cookie without Secure — logins will appear to succeed and then not stick. Set NODE_ENV=production (requires HTTPS).");
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(`NODE_ENV is "${process.env.NODE_ENV || "unset"}", not "production".`);
    console.warn("If this is a live deployment, set NODE_ENV=production — otherwise dev-only behaviour (verbose errors, OTP echoing if DEV_OTP_ECHO is also set) stays enabled.");
  }
};

module.exports = validateEnv;
