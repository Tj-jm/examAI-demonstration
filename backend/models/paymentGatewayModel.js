const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../utils/crypto");

// One document per payment provider. Mirrors aiConfigModel's approach to
// credentials rather than inventing a second one: AES-256-GCM at rest via
// utils/crypto, `select: false` so a stray .find() can never carry a secret
// out of the database, and a stored last-4 so the admin UI can show that a
// key is present without ever reading the key itself back.
//
// SECURITY MODEL — read before changing anything here.
//
// Credentials resolve environment-first. If the provider's env var is set,
// that value wins and the database copy is never consulted or writable from
// the UI. This is what makes "most secure" and "admin-configurable" both
// true at once: an install that cares can put every secret in the
// environment and the admin panel becomes read-only for those fields, while
// an install that wants no server access can paste keys into the UI and get
// encryption at rest instead. The two are not in conflict — they are the
// same lookup with a documented precedence.
//
// The encryption key itself (ENCRYPTION_KEY) lives in the environment, so a
// stolen database dump alone decrypts nothing. That is the actual threat
// this defends against. It does NOT defend against a compromised admin
// account or a compromised server process, which is why plaintext secrets
// are never returned over the API under any circumstance — see
// toSafeJSON() below, and note that there is deliberately no route that
// returns a decrypted value.

const paymentGatewaySchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    enabled: {
      type: Boolean,
      default: false,
    },

    // Empty means "any currency". Otherwise this gateway is only offered for
    // the listed ones — the whole point of multi-active: SSLCommerz for BDT,
    // Stripe for USD/EUR, both live at the same time.
    currencies: {
      type: [String],
      default: [],
      set: (list) => (list || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean),
    },

    // Lower sorts first. When more than one enabled gateway accepts the same
    // currency, this decides which is offered as the default; the student is
    // still shown every match so they can pick another.
    priority: {
      type: Number,
      default: 100,
    },

    // Non-secret provider settings (Razorpay key_id, SSLCommerz store_id,
    // sandbox toggles). Safe to return to the admin panel as-is.
    config: {
      type: Map,
      of: String,
      default: () => new Map(),
    },

    // Encrypted values, keyed the same way the driver's `credentials` list
    // declares them. Never selected by default.
    secrets: {
      type: Map,
      of: String,
      select: false,
      default: () => new Map(),
    },

    // Display-only evidence that a secret exists, so the UI can render
    // "•••• 4242" without the server ever decrypting anything for a read.
    secretsLast4: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

// Refusing to store a secret with no ENCRYPTION_KEY is deliberate. The
// alternative — silently writing plaintext into Mongo — is the exact
// failure this whole model exists to prevent, and it would be invisible
// until a dump leaked.
paymentGatewaySchema.methods.setSecret = function (key, plain) {
  if (!process.env.ENCRYPTION_KEY) {
    const error = new Error(
      "ENCRYPTION_KEY is not set, so gateway credentials cannot be stored securely. "
      + "Set ENCRYPTION_KEY in the environment, or supply this provider's credentials "
      + "as environment variables instead."
    );
    error.statusCode = 500;
    throw error;
  }

  if (!this.secrets) this.secrets = new Map();
  if (!this.secretsLast4) this.secretsLast4 = new Map();

  const value = plain == null ? "" : String(plain).trim();

  // An empty submission clears the stored secret rather than writing an
  // encrypted empty string, so "remove this key" is expressible from the UI.
  if (!value) {
    this.secrets.delete(key);
    this.secretsLast4.delete(key);
    return;
  }

  this.secrets.set(key, encrypt(value));
  this.secretsLast4.set(key, value.slice(-4));
};

// Returns null rather than throwing when absent — callers decide whether a
// missing credential is fatal, because for some providers a given field is
// optional (a webhook secret that has not been configured yet, say).
paymentGatewaySchema.methods.getSecret = function (key) {
  if (!this.secrets) return null;
  const stored = this.secrets.get(key);
  if (!stored) return null;
  return decrypt(stored);
};

// The only shape that may cross the API boundary. Note the absence of
// `secrets` entirely — not masked, not partially included: absent.
paymentGatewaySchema.methods.toSafeJSON = function () {
  return {
    provider: this.provider,
    enabled: this.enabled,
    currencies: this.currencies,
    priority: this.priority,
    config: Object.fromEntries(this.config || new Map()),
    secretsLast4: Object.fromEntries(this.secretsLast4 || new Map()),
  };
};

// Secrets are only loaded when a caller explicitly asks, which keeps the
// default read path (settings screens, checkout listing) incapable of
// leaking one even if a future serialiser is careless.
paymentGatewaySchema.statics.forProvider = async function (provider, { withSecrets = false } = {}) {
  const query = this.findOne({ provider: String(provider).toLowerCase() });
  if (withSecrets) query.select("+secrets");
  return query;
};

module.exports = mongoose.model("PaymentGateway", paymentGatewaySchema);
