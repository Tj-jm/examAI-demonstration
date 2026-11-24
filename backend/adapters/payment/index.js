const crypto = require("crypto");
const PaymentGateway = require("../../models/paymentGatewayModel");

// Several gateways can be live at once, chosen per currency — an install in
// Bangladesh runs SSLCommerz for BDT and Stripe for USD simultaneously, and
// the student is offered whichever accept the currency being charged. This
// is why nothing here reads a single PAYMENT_PROVIDER any more: "which
// provider" stopped being one global answer and became a per-charge lookup.
//
// Every driver exposes the same five things:
//   credentials  - what it needs, and which env var supplies each
//   configured(creds)
//   createCheckout({amount, currency, ...}, creds) -> {id, url}
//   verifyWebhook(rawBody, headers, creds)         -> parsed event
//   normaliseEvent(event)                          -> {paid, ref, metadata}
//
// normaliseEvent is the piece that lets one webhook handler serve every
// provider. Each gateway has its own envelope - Stripe nests the useful
// parts under data.object, others put them at the top level, and not all of
// them even call the same concept "metadata" - so each driver flattens its
// own shape into one vocabulary and the controller never branches.
//
// Raw fetch against each provider's REST API, matching every other adapter
// here (video, sms, the AI providers) - no vendor SDK.

// ------------------------------------------------------------- credentials
//
// Environment first, database second. An install that puts secrets in the
// environment gets fields the admin panel cannot overwrite; an install that
// wants no shell access can store them encrypted instead. See
// models/paymentGatewayModel.js for the reasoning behind that precedence.
const resolveCredentials = (driver, gateway) => {
  const out = {};

  for (const field of driver.credentials) {
    const fromEnv = field.envVar ? process.env[field.envVar] : undefined;

    if (fromEnv) {
      out[field.key] = fromEnv;
      continue;
    }

    if (!gateway) continue;

    out[field.key] = field.secret
      ? gateway.getSecret(field.key)
      : gateway.config?.get(field.key) || null;
  }

  return out;
};

const missingCredentials = (driver, creds) =>
  driver.credentials.filter((f) => f.required !== false && !creds[f.key]).map((f) => f.key);

// ---------------------------------------------------------------- stripe
const stripe = {
  name: "stripe",
  label: "Stripe",

  credentials: [
    { key: "secretKey", label: "Secret key", secret: true, envVar: "STRIPE_SECRET_KEY" },
    { key: "webhookSecret", label: "Webhook signing secret", secret: true, envVar: "STRIPE_WEBHOOK_SECRET" },
  ],

  configured(creds) {
    return Boolean(creds.secretKey);
  },

  // amount is in the currency's normal decimal units (29.99, not 2999) -
  // Stripe's smallest-unit convention is a Stripe-specific detail, converted
  // here rather than pushed onto every caller. Zero-decimal currencies (JPY,
  // KRW...) would need their own branch if this install ever charges in one;
  // none of the currencies this platform ships with today are zero-decimal.
  async createCheckout({ amount, currency, description, successUrl, cancelUrl, metadata = {}, customerEmail }, creds) {
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][price_data][currency]": String(currency).toLowerCase(),
      "line_items[0][price_data][product_data][name]": description,
      "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
      "line_items[0][quantity]": "1",
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    if (customerEmail) body.set("customer_email", customerEmail);
    for (const [key, value] of Object.entries(metadata)) {
      body.set(`metadata[${key}]`, String(value));
    }

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.message || `Stripe rejected the checkout request (HTTP ${res.status}).`);
    }

    return { id: data.id, url: data.url };
  },

  // Stripe signs the raw, unparsed request body - the route this feeds from
  // must skip the app's normal express.json() and hand over the raw bytes,
  // or every signature here will fail even for a genuine event.
  verifyWebhook(rawBody, headers, creds) {
    const secret = creds.webhookSecret;
    if (!secret) {
      throw new Error("Stripe webhook signing secret is not set - webhook events cannot be verified.");
    }

    const signatureHeader = headers["stripe-signature"];
    if (!signatureHeader) {
      throw new Error("Missing Stripe-Signature header.");
    }

    const parts = Object.fromEntries(
      signatureHeader.split(",").map((p) => p.split("=").map((s) => s.trim()))
    );

    if (!parts.t || !parts.v1) {
      throw new Error("Malformed Stripe-Signature header.");
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${parts.t}.${rawBody}`)
      .digest("hex");

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(parts.v1, "hex");

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Stripe webhook signature did not match.");
    }

    // Five minute tolerance on the timestamp, the same window Stripe's own
    // libraries default to, so a replayed old request is rejected even with
    // a correct signature.
    const age = Math.abs(Date.now() / 1000 - Number(parts.t));
    if (age > 300) {
      throw new Error("Stripe webhook timestamp is too old to trust.");
    }

    return JSON.parse(rawBody);
  },

  // `paid: false` is not an error - it is how the handler knows to
  // acknowledge an event it should ignore (an expired session, an unrelated
  // event type) with a 200 instead of leaving the provider retrying forever.
  normaliseEvent(event) {
    // checkout.session.completed fires as soon as checkout finishes, which
    // is not the same moment as "paid" for a delayed payment method (bank
    // transfers, SEPA debit, etc): that session completes with
    // payment_status "unpaid", and the money only actually arrives later,
    // signalled by its own checkout.session.async_payment_succeeded event.
    // Treating completed as paid unconditionally would grant access to a
    // purchase that can still fail (checkout.session.async_payment_failed)
    // or simply never settle.
    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      return { paid: false, reason: `Ignoring Stripe event type "${event.type}".` };
    }

    const session = event.data.object;

    if (event.type === "checkout.session.completed" && !["paid", "no_payment_required"].includes(session.payment_status)) {
      return { paid: false, reason: `Checkout completed but payment_status is "${session.payment_status}" — waiting for async_payment_succeeded.` };
    }

    return {
      paid: true,
      ref: session.id,
      metadata: session.metadata || {},
      // The gateway's own id for the money movement, distinct from the
      // checkout session id used for dedup. Kept for reconciliation against
      // a provider dashboard later.
      transactionId: session.payment_intent || null,
      amount: typeof session.amount_total === "number" ? session.amount_total / 100 : null,
      currency: session.currency ? String(session.currency).toUpperCase() : null,
    };
  },
};


// -------------------------------------------------------------- razorpay
//
// Payment Links rather than Orders + Checkout.js: Orders would require
// mounting Razorpay's browser SDK in the student app and handling the
// client-side callback, where a Payment Link is a hosted page we can simply
// redirect to — the same shape Stripe Checkout already gave us, so nothing
// upstream of the adapter has to know the difference.
//
// `notes` carries our metadata. Razorpay caps it at 15 key-value pairs of
// 256 characters each, which the batch-purchase payload (11 keys, all short)
// fits inside. Worth re-checking if that payload ever grows.
const razorpay = {
  name: "razorpay",
  label: "Razorpay",

  credentials: [
    { key: "keyId", label: "Key ID", secret: false, envVar: "RAZORPAY_KEY_ID" },
    { key: "keySecret", label: "Key secret", secret: true, envVar: "RAZORPAY_KEY_SECRET" },
    { key: "webhookSecret", label: "Webhook secret", secret: true, envVar: "RAZORPAY_WEBHOOK_SECRET" },
  ],

  configured(creds) {
    return Boolean(creds.keyId && creds.keySecret);
  },

  async createCheckout({ amount, currency, description, successUrl, metadata = {}, customerEmail, customerName, customerPhone }, creds) {
    // Paise, like Stripe's cents. INR is 2-decimal, so the same x100 holds.
    const body = {
      amount: Math.round(amount * 100),
      currency: String(currency).toUpperCase(),
      description,
      // Razorpay has no cancel_url — an abandoned link is simply never paid,
      // and since nothing is created until the webhook fires, there is no
      // dangling record to clean up either way.
      callback_url: successUrl,
      callback_method: "get",
      notes: Object.fromEntries(
        Object.entries(metadata).map(([k, v]) => [k, String(v).slice(0, 256)])
      ),
    };

    // Some accounts (Razorpay US) refuse the payment without an email, and a
    // student who signs in with a phone or student ID may have none: a
    // placeholder then, like SSLCommerz below. No notifications are sent.
    body.customer = {
      email: customerEmail || "student@example.com",
      ...(customerName ? { name: String(customerName).slice(0, 100) } : {}),
      // Only a plain number: Razorpay rejects the whole request over a bad one.
      ...(/^\+?\d{8,15}$/.test(String(customerPhone || "").replace(/[\s-]/g, "")) ? { contact: String(customerPhone).replace(/[\s-]/g, "") } : {}),
    };

    const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");

    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error?.description || `Razorpay rejected the checkout request (HTTP ${res.status}).`);
    }

    return { id: data.id, url: data.short_url };
  },

  // HMAC-SHA256 over the raw body, hex, compared against x-razorpay-signature.
  // Same family as Stripe's, but with no timestamp in the scheme — so unlike
  // Stripe there is no replay window to enforce here, and the dedup guard on
  // providerRef in the controller is what actually stops a replayed event
  // granting access twice.
  verifyWebhook(rawBody, headers, creds) {
    const secret = creds.webhookSecret;
    if (!secret) {
      throw new Error("Razorpay webhook secret is not set - webhook events cannot be verified.");
    }

    const signature = headers["x-razorpay-signature"];
    if (!signature) {
      throw new Error("Missing X-Razorpay-Signature header.");
    }

    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(String(signature), "hex");

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Razorpay webhook signature did not match.");
    }

    return JSON.parse(rawBody);
  },

  normaliseEvent(event) {
    if (event.event !== "payment_link.paid") {
      return { paid: false, reason: `Ignoring Razorpay event "${event.event}".` };
    }

    const link = event.payload?.payment_link?.entity || {};
    const payment = event.payload?.payment?.entity || {};

    return {
      paid: true,
      // The payment link id, not the payment id — this is what createCheckout
      // returned as `id`, so dedup keys on the same value for both providers.
      ref: link.id,
      metadata: link.notes || {},
      amount: typeof link.amount === "number" ? link.amount / 100 : null,
      currency: link.currency ? String(link.currency).toUpperCase() : null,
      transactionId: payment.id || null,
    };
  },
};


// ------------------------------------------------------------ sslcommerz
//
// Bangladesh's aggregator - it fronts bKash, Nagad, Rocket and local cards,
// which is why there is no separate bKash driver here.
//
// Two things make this the odd one out:
//
// 1. It cannot carry our metadata. There are exactly four pass-through
//    fields (value_a..value_d) and a batch purchase needs eleven, so
//    `carriesMetadata: false` tells the controller to park the payload in
//    PendingCheckout and read it back by our own transaction reference.
//
// 2. Its IPN hash is MD5 and is only a first filter. The actual proof that
//    money moved is a server-to-server call back to SSLCommerz's validation
//    endpoint with the val_id it sent us - anyone can POST to an IPN
//    listener, and the hash alone has been treated as insufficient by
//    SSLCommerz's own integration guidance for years. So verifyWebhook here
//    is async and makes a network call, which is why the driver contract
//    awaits it.
const sslcommerz = {
  name: "sslcommerz",
  label: "SSLCommerz",
  carriesMetadata: false,

  credentials: [
    { key: "storeId", label: "Store ID", secret: false, envVar: "SSLCOMMERZ_STORE_ID" },
    { key: "storePassword", label: "Store password", secret: true, envVar: "SSLCOMMERZ_STORE_PASSWORD" },
    { key: "sandbox", label: "Sandbox mode (true/false)", secret: false, required: false, envVar: "SSLCOMMERZ_SANDBOX" },
  ],

  configured(creds) {
    return Boolean(creds.storeId && creds.storePassword);
  },

  baseUrl(creds) {
    return String(creds.sandbox) === "true"
      ? "https://sandbox.sslcommerz.com"
      : "https://securepay.sslcommerz.com";
  },

  // `reference` is generated by the caller, not here - the controller has to
  // know it before this runs so it can write the PendingCheckout row first.
  // It becomes SSLCommerz's tran_id, and comes back on the IPN.
  async createCheckout({ amount, currency, description, successUrl, cancelUrl, ipnUrl, reference, customerEmail }, creds) {
    if (!reference) {
      throw new Error("SSLCommerz needs a transaction reference generated before checkout.");
    }

    const body = new URLSearchParams({
      store_id: creds.storeId,
      store_passwd: creds.storePassword,
      total_amount: String(amount),
      currency: String(currency).toUpperCase(),
      tran_id: reference,
      success_url: successUrl,
      fail_url: cancelUrl,
      cancel_url: cancelUrl,
      product_name: description,
      // Required by the API even for non-physical goods. "non-physical-goods"
      // is the value their own docs use for digital products, and it is what
      // switches off the shipping address requirement.
      product_category: "education",
      product_profile: "non-physical-goods",
      shipping_method: "NO",
      num_of_item: "1",
      cus_name: "Student",
      cus_email: customerEmail || "student@example.com",
      // All mandatory in the session request even when meaningless for a
      // digital purchase. Sending obvious placeholders rather than inventing
      // plausible-looking data.
      cus_add1: "N/A",
      cus_city: "N/A",
      cus_country: "Bangladesh",
      cus_phone: "N/A",
    });

    if (ipnUrl) body.set("ipn_url", ipnUrl);

    const res = await fetch(`${this.baseUrl(creds)}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await res.json();

    // SSLCommerz answers 200 with status FAILED rather than an HTTP error,
    // so the HTTP status alone would let a rejected session through.
    if (!res.ok || data.status !== "SUCCESS") {
      throw new Error(data?.failedreason || `SSLCommerz rejected the session request (status ${data?.status || res.status}).`);
    }

    return { id: reference, url: data.GatewayPageURL };
  },

  // The IPN arrives form-encoded, not JSON.
  async verifyWebhook(rawBody, headers, creds) {
    const fields = Object.fromEntries(new URLSearchParams(rawBody));

    if (!fields.verify_sign || !fields.verify_key) {
      throw new Error("SSLCommerz IPN is missing its verification fields.");
    }

    // Hash check, per SSLCommerz's published scheme: take the parameters
    // named in verify_key, add store_passwd as an md5, sort by key, join as
    // k=v pairs with &, and md5 the result.
    const signed = {};
    for (const key of fields.verify_key.split(",")) {
      if (fields[key] !== undefined) signed[key] = fields[key];
    }
    signed.store_passwd = crypto.createHash("md5").update(creds.storePassword).digest("hex");

    const hashString = Object.keys(signed)
      .sort()
      .map((k) => `${k}=${signed[k]}`)
      .join("&");

    const expected = crypto.createHash("md5").update(hashString).digest("hex");

    if (expected !== fields.verify_sign) {
      throw new Error("SSLCommerz IPN hash did not match.");
    }

    // The hash proves the message was built by someone holding the store
    // password. It does not prove the payment succeeded, and MD5 is not a
    // signature scheme worth trusting money to on its own - so the amount and
    // status below come from SSLCommerz directly, not from the POST body.
    const validationUrl = new URL(`${this.baseUrl(creds)}/validator/api/validationserverAPI.php`);
    validationUrl.searchParams.set("val_id", fields.val_id || "");
    validationUrl.searchParams.set("store_id", creds.storeId);
    validationUrl.searchParams.set("store_passwd", creds.storePassword);
    validationUrl.searchParams.set("format", "json");

    const res = await fetch(validationUrl, { method: "GET" });
    const validated = await res.json();

    if (!["VALID", "VALIDATED"].includes(validated.status)) {
      throw new Error(`SSLCommerz did not validate this transaction (status ${validated.status}).`);
    }

    // Everything downstream reads the validated response, never `fields`.
    return validated;
  },

  normaliseEvent(validated) {
    return {
      paid: true,
      ref: validated.tran_id,
      // Nothing to carry - the controller reads PendingCheckout instead, on
      // the strength of carriesMetadata being false.
      metadata: {},
      amount: validated.amount !== undefined ? Number(validated.amount) : null,
      currency: validated.currency ? String(validated.currency).toUpperCase() : null,
      transactionId: validated.bank_tran_id || validated.val_id || null,
    };
  },
};


// ---------------------------------------------------------------- paypal
//
// Orders v2. Three things make this the most awkward driver of the set:
//
// 1. Every call needs an OAuth2 bearer token, so there is a token fetch
//    before the real request. Cached in-process for its stated lifetime
//    minus a minute, which is enough — a restart just fetches a new one.
//
// 2. Verification is a postback, not a local signature check. PayPal signs
//    with RSA-SHA256 against a rotating certificate; rather than fetching
//    and caching their cert chain, this asks PayPal to verify the event for
//    us. Slower, but there is no certificate expiry to be woken up by.
//
// 3. Approval and capture are separate. The buyer approving an order does
//    not move money — the capture call does. So the driver captures on
//    CHECKOUT.ORDER.APPROVED and only reports paid once that capture
//    succeeds, which is why verifyWebhook here can make two outbound calls.
//
// Like SSLCommerz it cannot carry our metadata: `custom_id` is one field,
// not eleven, so it holds the reference and PendingCheckout holds the rest.
const paypal = {
  name: "paypal",
  label: "PayPal",
  carriesMetadata: false,

  credentials: [
    { key: "clientId", label: "Client ID", secret: false, envVar: "PAYPAL_CLIENT_ID" },
    { key: "clientSecret", label: "Client secret", secret: true, envVar: "PAYPAL_CLIENT_SECRET" },
    { key: "webhookId", label: "Webhook ID", secret: false, envVar: "PAYPAL_WEBHOOK_ID" },
    { key: "sandbox", label: "Sandbox mode (true/false)", secret: false, required: false, envVar: "PAYPAL_SANDBOX" },
  ],

  configured(creds) {
    return Boolean(creds.clientId && creds.clientSecret);
  },

  baseUrl(creds) {
    return String(creds.sandbox) === "true"
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";
  },

  // Keyed by client id so switching credentials in the admin panel cannot
  // leave a stale token from the previous account in play.
  _tokens: new Map(),

  async token(creds) {
    const cached = this._tokens.get(creds.clientId);
    if (cached && cached.expires > Date.now()) return cached.value;

    const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

    const res = await fetch(`${this.baseUrl(creds)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const data = await res.json();

    if (!res.ok || !data.access_token) {
      throw new Error(data?.error_description || `PayPal refused the credentials (HTTP ${res.status}).`);
    }

    this._tokens.set(creds.clientId, {
      value: data.access_token,
      // A minute of headroom so a token cannot expire mid-request.
      expires: Date.now() + (Number(data.expires_in || 0) - 60) * 1000,
    });

    return data.access_token;
  },

  async createCheckout({ amount, currency, description, successUrl, cancelUrl, reference }, creds) {
    if (!reference) {
      throw new Error("PayPal needs a transaction reference generated before checkout.");
    }

    const token = await this.token(creds);

    const res = await fetch(`${this.baseUrl(creds)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Makes a retried create idempotent rather than opening a second
        // order for the same checkout.
        "PayPal-Request-Id": reference,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            // Our reference, and the only thing that comes back to identify
            // this purchase. PendingCheckout holds everything else.
            custom_id: reference,
            description: String(description).slice(0, 127),
            amount: {
              currency_code: String(currency).toUpperCase(),
              value: amount.toFixed(2),
            },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: successUrl,
              cancel_url: cancelUrl,
              user_action: "PAY_NOW",
            },
          },
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.message || `PayPal rejected the order (HTTP ${res.status}).`);
    }

    // The link to send the buyer to is named payer-action on newer responses
    // and approve on older ones; both appear in the wild.
    const link = (data.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");

    if (!link) {
      throw new Error("PayPal created an order but returned no approval link.");
    }

    return { id: reference, url: link.href };
  },

  async verifyWebhook(rawBody, headers, creds) {
    if (!creds.webhookId) {
      throw new Error("PayPal webhook ID is not set - webhook events cannot be verified.");
    }

    const token = await this.token(creds);

    // The event has to be sent back exactly as received, which is why the
    // raw body matters here as much as it does for an HMAC scheme.
    const res = await fetch(`${this.baseUrl(creds)}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: creds.webhookId,
        webhook_event: JSON.parse(rawBody),
      }),
    });

    const verdict = await res.json();

    if (verdict.verification_status !== "SUCCESS") {
      throw new Error(`PayPal did not verify this webhook (${verdict.verification_status || res.status}).`);
    }

    const event = JSON.parse(rawBody);

    // Approval is not payment. Capture now, and let the result of that
    // capture — not the buyer's click — be what reports paid.
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      const captured = await this.capture(event.resource.id, creds);
      return { ...event, _capture: captured };
    }

    return event;
  },

  async capture(orderId, creds) {
    const token = await this.token(creds);

    const res = await fetch(`${this.baseUrl(creds)}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `capture_${orderId}`,
      },
    });

    const data = await res.json();

    // ORDER_ALREADY_CAPTURED is not a failure: it means a duplicate webhook
    // beat us here. The purchase dedup guard downstream handles the rest.
    const alreadyDone = (data?.details || []).some((d) => d.issue === "ORDER_ALREADY_CAPTURED");

    if (!res.ok && !alreadyDone) {
      throw new Error(data?.message || `PayPal capture failed (HTTP ${res.status}).`);
    }

    return data;
  },

  normaliseEvent(event) {
    // Both events can arrive for one purchase. They normalise to the same
    // ref — our own reference — so the second is caught as a duplicate
    // rather than granting access twice.
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      const unit = event.resource?.purchase_units?.[0] || {};
      const capture = event._capture?.purchase_units?.[0]?.payments?.captures?.[0] || {};

      if (event._capture && event._capture.status !== "COMPLETED") {
        return { paid: false, reason: `Capture returned status ${event._capture.status}.` };
      }

      return {
        paid: true,
        ref: unit.custom_id,
        metadata: {},
        amount: unit.amount?.value !== undefined ? Number(unit.amount.value) : null,
        currency: unit.amount?.currency_code ? String(unit.amount.currency_code).toUpperCase() : null,
        transactionId: capture.id || event.resource?.id || null,
      };
    }

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const resource = event.resource || {};

      return {
        paid: true,
        ref: resource.custom_id,
        metadata: {},
        amount: resource.amount?.value !== undefined ? Number(resource.amount.value) : null,
        currency: resource.amount?.currency_code ? String(resource.amount.currency_code).toUpperCase() : null,
        transactionId: resource.id || null,
      };
    }

    return { paid: false, reason: `Ignoring PayPal event "${event.event_type}".` };
  },
};


// ----------------------------------------------------------------- bkash
//
// Direct bKash Tokenized Checkout. Note that SSLCommerz above already routes
// bKash — this driver only earns its place if you are avoiding SSLCommerz's
// cut or need bKash-specific pricing.
//
// It is the one gateway here with no signed webhook. The flow is:
//   grant token -> create payment -> send the customer to bkashURL ->
//   bKash redirects their BROWSER back to callbackURL with a paymentID ->
//   the merchant calls execute, and only that answer says money moved.
//
// So nothing in the redirect is trusted. The paymentID in the query string
// is not evidence of payment; it only names which payment to go and ask
// bKash about, over an authenticated server-to-server call. Anyone can forge
// the redirect, and forging it achieves nothing, because execute against a
// payment the customer never completed does not return Completed.
//
// `confirmRedirect: true` is what routes this through the callback handler
// instead of the webhook handler.
const bkash = {
  name: "bkash",
  label: "bKash",
  carriesMetadata: false,
  confirmRedirect: true,

  credentials: [
    { key: "appKey", label: "App key", secret: false, envVar: "BKASH_APP_KEY" },
    { key: "appSecret", label: "App secret", secret: true, envVar: "BKASH_APP_SECRET" },
    { key: "username", label: "Username", secret: false, envVar: "BKASH_USERNAME" },
    { key: "password", label: "Password", secret: true, envVar: "BKASH_PASSWORD" },
    { key: "sandbox", label: "Sandbox mode (true/false)", secret: false, required: false, envVar: "BKASH_SANDBOX" },
  ],

  configured(creds) {
    return Boolean(creds.appKey && creds.appSecret && creds.username && creds.password);
  },

  baseUrl(creds) {
    return String(creds.sandbox) === "true"
      ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta"
      : "https://tokenized.pay.bka.sh/v1.2.0-beta";
  },

  _tokens: new Map(),

  // Grant tokens are short-lived (roughly an hour) and bKash rate-limits the
  // grant endpoint, so this caches rather than fetching per call. Keyed by
  // app key so changing credentials cannot serve a stale token.
  async token(creds) {
    const cached = this._tokens.get(creds.appKey);
    if (cached && cached.expires > Date.now()) return cached.value;

    const res = await fetch(`${this.baseUrl(creds)}/tokenized/checkout/token/grant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // Credentials split across headers and body is bKash's own scheme,
        // not a mistake: username/password go in headers, the app pair in
        // the body.
        username: creds.username,
        password: creds.password,
      },
      body: JSON.stringify({ app_key: creds.appKey, app_secret: creds.appSecret }),
    });

    const data = await res.json();

    if (!res.ok || !data.id_token) {
      throw new Error(data?.statusMessage || `bKash refused the credentials (HTTP ${res.status}).`);
    }

    this._tokens.set(creds.appKey, {
      value: data.id_token,
      expires: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
    });

    return data.id_token;
  },

  authHeaders(token, creds) {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: token,
      "X-App-Key": creds.appKey,
    };
  },

  async createCheckout({ amount, currency, reference, callbackUrl }, creds) {
    if (!reference) {
      throw new Error("bKash needs a transaction reference generated before checkout.");
    }
    if (!callbackUrl) {
      throw new Error("bKash needs a callback URL - set SERVER_URL so one can be built.");
    }

    // bKash is BDT only. Failing here is better than letting it accept a
    // USD-priced plan and silently charge the same number in taka.
    if (String(currency).toUpperCase() !== "BDT") {
      throw new Error(`bKash only accepts BDT, not ${currency}.`);
    }

    const token = await this.token(creds);

    const res = await fetch(`${this.baseUrl(creds)}/tokenized/checkout/create`, {
      method: "POST",
      headers: this.authHeaders(token, creds),
      body: JSON.stringify({
        mode: "0011",
        payerReference: reference,
        callbackURL: callbackUrl,
        amount: amount.toFixed(2),
        currency: "BDT",
        intent: "sale",
        // Comes back on execute, and is how the pending metadata is found
        // again - bKash's own paymentID is not known at checkout time.
        merchantInvoiceNumber: reference,
      }),
    });

    const data = await res.json();

    if (!res.ok || !data.bkashURL) {
      throw new Error(data?.statusMessage || `bKash rejected the payment request (HTTP ${res.status}).`);
    }

    return { id: data.paymentID, url: data.bkashURL };
  },

  // Called with the redirect's query string. Everything returned here comes
  // from the execute response, never from the query.
  async confirmRedirect(query, creds) {
    const paymentID = query.paymentID || query.paymentId;

    if (!paymentID) {
      throw new Error("bKash callback carried no paymentID.");
    }

    // A cancelled or failed payment comes back with a status the customer's
    // browser can carry, but it is only a hint - execute is still what
    // decides, and it will simply not return Completed.
    if (query.status && String(query.status).toLowerCase() !== "success") {
      return { paid: false, reason: `bKash reported status "${query.status}".` };
    }

    const token = await this.token(creds);

    const res = await fetch(`${this.baseUrl(creds)}/tokenized/checkout/execute`, {
      method: "POST",
      headers: this.authHeaders(token, creds),
      body: JSON.stringify({ paymentID }),
    });

    const data = await res.json();

    if (data.transactionStatus !== "Completed") {
      return {
        paid: false,
        reason: `bKash did not complete this payment (${data.transactionStatus || data.statusMessage || res.status}).`,
      };
    }

    return {
      paid: true,
      // bKash's own id, and what the duplicate guard keys on. Distinct from
      // `reference` because unlike every other driver here, the gateway's id
      // is not something we chose.
      ref: data.paymentID || paymentID,
      reference: data.merchantInvoiceNumber || data.payerReference,
      metadata: {},
      amount: data.amount !== undefined ? Number(data.amount) : null,
      currency: data.currency ? String(data.currency).toUpperCase() : "BDT",
      transactionId: data.trxID || null,
    };
  },

  // Present only to satisfy the driver contract. bKash sends no webhook in
  // this flow, so if one ever arrives at that route it is not from bKash.
  verifyWebhook() {
    throw new Error("bKash does not send webhooks - it confirms by redirect.");
  },

  normaliseEvent(event) {
    return event;
  },
};

// ---------------------------------------------------------------- registry
//
// To add a provider: implement the same five members as `stripe` above and
// add it here. The webhook route, the admin settings screen and the student
// picker all read from this registry, so nothing else needs editing to make
// a new gateway selectable.
const PROVIDERS = { stripe, razorpay, sslcommerz, paypal, bkash };

const driverFor = (provider) => PROVIDERS[String(provider || "").toLowerCase()] || null;

// find() cannot select a `select: false` field across a result set and still
// return documents with their methods intact, so secrets are re-fetched per
// document. Deliberately not lean() - getSecret() is a method.
const withSecrets = async (gateways) =>
  Promise.all(gateways.map((g) => PaymentGateway.findById(g._id).select("+secrets")));

// ------------------------------------------------------------------ lookup
//
// Every gateway that could take this charge, best first. The caller decides
// whether to auto-pick the first or offer the whole list to the student.
const availableFor = async (currency) => {
  const wanted = String(currency || "").toUpperCase();
  const enabled = await PaymentGateway.find({ enabled: true }).sort({ priority: 1, provider: 1 });

  const out = [];

  for (const gateway of await withSecrets(enabled)) {
    const driver = driverFor(gateway.provider);
    if (!driver) continue;

    // An empty currency list means the gateway takes anything.
    if (wanted && gateway.currencies.length && !gateway.currencies.includes(wanted)) continue;

    const creds = resolveCredentials(driver, gateway);
    if (!driver.configured(creds)) continue;

    out.push({ gateway, driver, creds });
  }

  return out;
};

const configured = async (currency) => (await availableFor(currency)).length > 0;

// Which gateway would take this charge. Exposed separately because the
// caller sometimes has to know the provider *before* the checkout call —
// SSLCommerz needs its metadata parked under a reference first, and that
// decision depends on which driver was chosen.
const pick = async (currency, preferred) => {
  const matches = await availableFor(currency);
  if (!matches.length) return null;

  const chosen = preferred
    ? matches.find((m) => m.gateway.provider === String(preferred).toLowerCase())
    : matches[0];

  return chosen ? chosen.gateway.provider : null;
};

const createCheckout = async (options) => {
  const matches = await availableFor(options.currency);

  if (!matches.length) {
    throw new Error(
      `No payment gateway is enabled for ${options.currency}. Enable one in Settings, or record the purchase manually.`
    );
  }

  // An explicit choice from the student wins; otherwise the highest-priority
  // gateway that accepts this currency.
  const chosen = options.provider
    ? matches.find((m) => m.gateway.provider === String(options.provider).toLowerCase())
    : matches[0];

  if (!chosen) {
    throw new Error(`"${options.provider}" is not enabled for ${options.currency}.`);
  }

  const result = await chosen.driver.createCheckout(options, chosen.creds);
  return { ...result, provider: chosen.gateway.provider };
};

// Webhooks name their provider in the route, not in the body - the body is
// precisely what is not yet trusted at this point.
const verifyWebhook = async (provider, rawBody, headers) => {
  const driver = driverFor(provider);
  if (!driver) {
    throw new Error(`Unknown payment provider "${provider}".`);
  }

  const gateway = await PaymentGateway.forProvider(provider, { withSecrets: true });

  // An admin can disable a gateway without clearing its credentials (env
  // vars in particular are not theirs to clear from the panel) — a webhook
  // still arriving with a validly signed event for it should not go on
  // granting purchases just because the secret still resolves.
  if (!gateway?.enabled) {
    throw new Error(`"${provider}" is not enabled.`);
  }

  const creds = resolveCredentials(driver, gateway);

  // Awaited: a driver's verification is allowed to be async. SSLCommerz in
  // particular cannot verify from the payload alone — its IPN hash is only a
  // first filter, and the real proof is a server-to-server validation call
  // back to the gateway. Stripe's stays synchronous; awaiting a non-promise
  // costs nothing.
  const event = await driver.verifyWebhook(rawBody, headers, creds);
  return driver.normaliseEvent(event);
};

// The redirect twin of verifyWebhook, for drivers that confirm out-of-band.
const confirmRedirect = async (provider, query) => {
  const driver = driverFor(provider);
  if (!driver?.confirmRedirect) {
    throw new Error(`"${provider}" does not use redirect confirmation.`);
  }

  const gateway = await PaymentGateway.forProvider(provider, { withSecrets: true });

  if (!gateway?.enabled) {
    throw new Error(`"${provider}" is not enabled.`);
  }

  const creds = resolveCredentials(driver, gateway);

  return driver.confirmRedirect(query, creds);
};

// ------------------------------------------------------------------- admin
//
// `envLocked` is what lets the settings screen disable a field instead of
// letting an admin type a value that would then be silently ignored because
// the environment already supplies it.
const list = async () => {
  // secrets has select:false on the schema (see paymentGatewayModel.js), so
  // a plain find() never carries it — resolveCredentials' getSecret() call
  // below would then always see an empty map and return null for every
  // secret field, regardless of what is actually stored. That made a
  // panel-saved gateway (last4 shown, so genuinely saved) report as
  // unconfigured/"0 live" here while availableFor()/checkout — which does
  // select +secrets via withSecrets() — worked fine, a real save with a
  // wrong "still needs credentials" readout on top of it.
  const gateways = await PaymentGateway.find({}).select("+secrets");
  const byProvider = new Map(gateways.map((g) => [g.provider, g]));

  return Object.values(PROVIDERS).map((driver) => {
    const gateway = byProvider.get(driver.name) || null;
    const creds = resolveCredentials(driver, gateway);

    return {
      name: driver.name,
      label: driver.label,
      enabled: Boolean(gateway?.enabled),
      currencies: gateway?.currencies || [],
      priority: gateway?.priority ?? 100,
      configured: driver.configured(creds),
      // Changes what the settings screen tells the admin to register: a
      // webhook URL for most, a callback URL and a SERVER_URL warning for
      // the ones with no webhook at all.
      confirmsByRedirect: Boolean(driver.confirmRedirect),
      missing: missingCredentials(driver, creds),
      config: gateway ? Object.fromEntries(gateway.config || new Map()) : {},
      credentials: driver.credentials.map((f) => ({
        key: f.key,
        label: f.label,
        secret: Boolean(f.secret),
        required: f.required !== false,
        envVar: f.envVar,
        envLocked: Boolean(f.envVar && process.env[f.envVar]),
        last4: gateway?.secretsLast4?.get(f.key) || null,
      })),
    };
  });
};

module.exports = {
  PROVIDERS,
  driverFor,
  resolveCredentials,
  missingCredentials,
  availableFor,
  pick,
  configured,
  createCheckout,
  verifyWebhook,
  confirmRedirect,
  list,
};
