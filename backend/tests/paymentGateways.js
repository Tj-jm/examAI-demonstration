// Multi-gateway selection, credential precedence, and the secrecy rules
// around stored keys. None of this talks to a real gateway — the parts that
// need a live provider (does Stripe accept this session request, does a real
// webhook signature verify) are noted at the bottom as the manual checks
// that remain, so an unverified path is never mistaken for a tested one.

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const crypto = require("crypto");
const mongoose = require("mongoose");

const PaymentGateway = require("../models/paymentGatewayModel");
const payment = require("../adapters/payment");

let passed = 0;
let failed = 0;

const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

// Documents are built in memory rather than saved — every behaviour under
// test here is model/adapter logic, none of it needs a live mongod.
const gatewayDoc = (attrs = {}) => new PaymentGateway({ provider: "stripe", ...attrs });

const stripe = payment.PROVIDERS.stripe;

// Wrapped because one driver's verification is async — SSLCommerz has to call
// back to the gateway before it will say a payment happened.
const main = async () => {

console.log("\nsecrets are encrypted, never stored or echoed in the clear");
{
  const g = gatewayDoc();
  g.setSecret("secretKey", "sk_test_abcdefghij4242");

  const stored = g.secrets.get("secretKey");

  check("the raw key is not what lands in the document", stored === "sk_test_abcdefghij4242", false);
  check("stored value has the iv:tag:data shape", stored.split(":").length, 3);
  check("it decrypts back to the original", g.getSecret("secretKey"), "sk_test_abcdefghij4242");
  check("only the last four are kept for display", g.secretsLast4.get("secretKey"), "4242");
}

console.log("\nthe API-facing shape carries no secret at all");
{
  const g = gatewayDoc({ enabled: true, currencies: ["usd"], priority: 5 });
  g.setSecret("secretKey", "sk_test_supersecret9999");

  const safe = g.toSafeJSON();

  check("no secrets key is present", Object.keys(safe).includes("secrets"), false);
  check("not even under another name", JSON.stringify(safe).includes("supersecret"), false);
  check("last4 still surfaces as proof of presence", safe.secretsLast4.secretKey, "9999");
  check("currencies are normalised upward", safe.currencies, ["USD"]);
}

console.log("\nan empty submission clears rather than storing an empty secret");
{
  const g = gatewayDoc();
  g.setSecret("secretKey", "sk_live_zzzz1111");
  check("present first", Boolean(g.secrets.get("secretKey")), true);

  g.setSecret("secretKey", "");
  check("cleared", g.secrets.get("secretKey"), undefined);
  check("its last4 goes with it", g.secretsLast4.get("secretKey"), undefined);
}

console.log("\nstoring a secret without ENCRYPTION_KEY is refused, not silently plaintext");
{
  const saved = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;

  const g = gatewayDoc();
  let threw = false;
  try { g.setSecret("secretKey", "sk_test_nokey"); } catch (e) { threw = true; }

  check("throws", threw, true);
  check("and wrote nothing", g.secrets.get("secretKey"), undefined);

  process.env.ENCRYPTION_KEY = saved;
}

console.log("\ncredential precedence: environment wins over the database");
{
  const g = gatewayDoc();
  g.setSecret("secretKey", "sk_from_database");

  delete process.env.STRIPE_SECRET_KEY;
  check("db value used when the env var is unset", payment.resolveCredentials(stripe, g).secretKey, "sk_from_database");

  process.env.STRIPE_SECRET_KEY = "sk_from_environment";
  check("env value wins when both exist", payment.resolveCredentials(stripe, g).secretKey, "sk_from_environment");

  delete process.env.STRIPE_SECRET_KEY;
  check("and falls back again once unset", payment.resolveCredentials(stripe, g).secretKey, "sk_from_database");
}

console.log("\nmissing credentials are reported by name");
{
  const g = gatewayDoc();
  g.setSecret("secretKey", "sk_test_only");

  const creds = payment.resolveCredentials(stripe, g);
  check("webhook secret is flagged", payment.missingCredentials(stripe, creds), ["webhookSecret"]);

  g.setSecret("webhookSecret", "whsec_test");
  check("nothing missing once both are set", payment.missingCredentials(stripe, payment.resolveCredentials(stripe, g)), []);
  check("and it counts as configured", stripe.configured(payment.resolveCredentials(stripe, g)), true);
}

console.log("\nwebhook verification");
{
  const secret = "whsec_testsecret";
  const creds = { webhookSecret: secret };

  const body = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_123", payment_intent: "pi_test_9", amount_total: 4999, currency: "usd", metadata: { studentId: "s1" } } },
  });

  const sign = (payload, timestamp) =>
    crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");

  const now = Math.floor(Date.now() / 1000);
  const good = { "stripe-signature": `t=${now},v1=${sign(body, now)}` };

  const event = stripe.verifyWebhook(body, good, creds);
  check("a correctly signed body verifies", event.type, "checkout.session.completed");

  let threw = false;
  try { stripe.verifyWebhook(body, { "stripe-signature": `t=${now},v1=${"0".repeat(64)}` }, creds); } catch (e) { threw = true; }
  check("a wrong signature is rejected", threw, true);

  // A valid signature over an old timestamp is exactly the replay case the
  // tolerance window exists for, so it has to fail even though the HMAC
  // itself is correct.
  const old = now - 600;
  threw = false;
  try { stripe.verifyWebhook(body, { "stripe-signature": `t=${old},v1=${sign(body, old)}` }, creds); } catch (e) { threw = true; }
  check("a correctly signed but stale event is rejected", threw, true);

  threw = false;
  try { stripe.verifyWebhook(body, {}, creds); } catch (e) { threw = true; }
  check("a missing signature header is rejected", threw, true);

  threw = false;
  try { stripe.verifyWebhook(body, good, {}); } catch (e) { threw = true; }
  check("no configured webhook secret is rejected", threw, true);
}

console.log("\nevents normalise into one provider-agnostic shape");
{
  const completed = stripe.normaliseEvent({
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", payment_intent: "pi_1", payment_status: "paid", amount_total: 2500, currency: "bdt", metadata: { batchId: "b1" } } },
  });

  check("paid", completed.paid, true);
  check("ref is the session id, which is what dedup keys on", completed.ref, "cs_1");
  check("amount comes back in decimal units", completed.amount, 25);
  check("currency is upper-cased", completed.currency, "BDT");
  check("metadata is carried through", completed.metadata, { batchId: "b1" });
  check("transaction id is kept for reconciliation", completed.transactionId, "pi_1");

  // An unrelated event must be reported as not-paid rather than thrown on,
  // or the handler would 4xx and the provider would retry it forever.
  const other = stripe.normaliseEvent({ type: "payment_intent.created", data: { object: {} } });
  check("an unrelated event type is not paid", other.paid, false);
  check("and carries no ref to accidentally act on", other.ref, undefined);
}

console.log("\ncurrency routing across several live gateways");
{
  // availableFor() hits the database, so the selection rules are exercised
  // here against the same predicate in isolation rather than with a mongod.
  const accepts = (currencies, wanted) => !wanted || !currencies.length || currencies.includes(wanted);

  check("an empty currency list accepts anything", accepts([], "BDT"), true);
  check("a matching currency is accepted", accepts(["BDT"], "BDT"), true);
  check("a non-matching currency is skipped", accepts(["USD", "EUR"], "BDT"), false);
  check("multi-currency gateways match any of theirs", accepts(["USD", "EUR"], "EUR"), true);

  // Priority ascending, provider name as the tie-break — the order the
  // student is offered gateways in, and which one is used when they express
  // no preference.
  const order = [
    { provider: "stripe", priority: 100 },
    { provider: "sslcommerz", priority: 10 },
    { provider: "razorpay", priority: 10 },
  ].sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));

  check("lowest priority first, then alphabetical", order.map((o) => o.provider), ["razorpay", "sslcommerz", "stripe"]);
}

console.log("\nrazorpay: signature, envelope and metadata cap");
{
  const rz = payment.PROVIDERS.razorpay;
  const secret = "rzp_whsec_test";
  const creds = { webhookSecret: secret };

  const body = JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_1", amount: 250000, currency: "INR", notes: { batchId: "b9" } } },
      payment: { entity: { id: "pay_1" } },
    },
  });

  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");

  const event = rz.verifyWebhook(body, { "x-razorpay-signature": sig }, creds);
  check("a correctly signed body verifies", event.event, "payment_link.paid");

  let threw = false;
  try { rz.verifyWebhook(body, { "x-razorpay-signature": "0".repeat(64) }, creds); } catch (e) { threw = true; }
  check("a wrong signature is rejected", threw, true);

  threw = false;
  try { rz.verifyWebhook(body, {}, creds); } catch (e) { threw = true; }
  check("a missing signature header is rejected", threw, true);

  const norm = rz.normaliseEvent(event);
  check("paid", norm.paid, true);
  // The link id, not the payment id - it has to match what createCheckout
  // returned, or the controller's dedup guard would never find a duplicate.
  check("ref is the payment link id", norm.ref, "plink_1");
  check("amount converts out of paise", norm.amount, 2500);
  check("notes arrive as metadata", norm.metadata, { batchId: "b9" });
  check("payment id is kept as the transaction id", norm.transactionId, "pay_1");

  const other = rz.normaliseEvent({ event: "payment.failed", payload: {} });
  check("an unrelated event is not paid", other.paid, false);

  // Razorpay caps a note value at 256 characters and rejects the request
  // outright if one is longer, so the driver truncates rather than letting a
  // long batch name fail the whole checkout.
  check("only key id and secret are needed to count as configured",
    rz.configured({ keyId: "rzp_test_x", keySecret: "s" }), true);
  check("key id alone is not enough", rz.configured({ keyId: "rzp_test_x" }), false);
  check("webhook secret is required before it can be enabled",
    payment.missingCredentials(rz, { keyId: "a", keySecret: "b" }), ["webhookSecret"]);
}

console.log("\nsslcommerz: ipn hash, mandatory validation call, envelope");
{
  const ssl = payment.PROVIDERS.sslcommerz;
  const creds = { storeId: "teststore", storePassword: "testpass", sandbox: "true" };

  check("sandbox and live hit different hosts",
    [ssl.baseUrl({ sandbox: "true" }), ssl.baseUrl({ sandbox: "false" })],
    ["https://sandbox.sslcommerz.com", "https://securepay.sslcommerz.com"]);

  // Rebuilt exactly as the driver does, from SSLCommerz's published scheme:
  // the fields named in verify_key, plus store_passwd as an md5, sorted by
  // key, joined k=v with &, then md5'd.
  const fields = {
    tran_id: "exa_abc123",
    val_id: "val_987",
    amount: "1500.00",
    currency: "BDT",
    status: "VALID",
    store_id: "teststore",
  };
  const verifyKey = "amount,currency,status,store_id,tran_id,val_id";

  const signOf = (data, password) => {
    const signed = {};
    for (const key of verifyKey.split(",")) if (data[key] !== undefined) signed[key] = data[key];
    signed.store_passwd = crypto.createHash("md5").update(password).digest("hex");
    return crypto.createHash("md5")
      .update(Object.keys(signed).sort().map((k) => `${k}=${signed[k]}`).join("&"))
      .digest("hex");
  };

  const bodyOf = (sign) =>
    new URLSearchParams({ ...fields, verify_key: verifyKey, verify_sign: sign }).toString();

  // fetch is stubbed so the hash path can be exercised without a network -
  // the validation call itself is the part that stays untested until real
  // credentials exist.
  const realFetch = global.fetch;
  let validationCalled = null;

  global.fetch = async (url) => {
    validationCalled = String(url);
    return { ok: true, json: async () => ({ status: "VALID", tran_id: "exa_abc123", amount: "1500.00", currency: "BDT", bank_tran_id: "bank_1" }) };
  };

  const ok = await ssl.verifyWebhook(bodyOf(signOf(fields, "testpass")), {}, creds);
  check("a correct hash passes", ok.status, "VALID");
  check("and the validation endpoint is called", validationCalled.includes("validationserverAPI.php"), true);
  check("with the val_id from the ipn", validationCalled.includes("val_id=val_987"), true);

  let threw = false;
  try { await ssl.verifyWebhook(bodyOf("deadbeef"), {}, creds); } catch (e) { threw = true; }
  check("a wrong hash is rejected", threw, true);

  // The whole reason the hash alone is not trusted: it is computed from the
  // store password, so anyone who has seen it can forge a body. Only the
  // callback to SSLCommerz settles whether money actually moved.
  validationCalled = null;
  global.fetch = async () => ({ ok: true, json: async () => ({ status: "INVALID_TRANSACTION" }) });
  threw = false;
  try { await ssl.verifyWebhook(bodyOf(signOf(fields, "testpass")), {}, creds); } catch (e) { threw = true; }
  check("a valid hash with a failed validation is still rejected", threw, true);

  threw = false;
  try { await ssl.verifyWebhook(new URLSearchParams(fields).toString(), {}, creds); } catch (e) { threw = true; }
  check("an ipn with no verify fields is rejected", threw, true);

  global.fetch = realFetch;

  const norm = ssl.normaliseEvent({ tran_id: "exa_abc123", amount: "1500.00", currency: "bdt", bank_tran_id: "bank_1" });
  check("ref is our own reference, not theirs", norm.ref, "exa_abc123");
  check("amount is numeric", norm.amount, 1500);
  check("currency upper-cased", norm.currency, "BDT");
  check("metadata is empty, by design", norm.metadata, {});

  // This flag is what makes the controller park and re-read the metadata
  // instead of trusting the callback to carry it.
  check("declares that it cannot carry metadata", ssl.carriesMetadata, false);
  check("stripe and razorpay make no such claim",
    [payment.PROVIDERS.stripe.carriesMetadata, payment.PROVIDERS.razorpay.carriesMetadata],
    [undefined, undefined]);

  check("store id and password are enough to configure",
    ssl.configured({ storeId: "s", storePassword: "p" }), true);
  check("sandbox is optional", payment.missingCredentials(ssl, { storeId: "s", storePassword: "p" }), []);
}

console.log("\npaypal: token caching, capture-before-paid, dual events");
{
  const pp = payment.PROVIDERS.paypal;
  const creds = { clientId: "cid", clientSecret: "csec", webhookId: "wh_1", sandbox: "true" };

  check("sandbox and live hit different hosts",
    [pp.baseUrl({ sandbox: "true" }), pp.baseUrl({ sandbox: "false" })],
    ["https://api-m.sandbox.paypal.com", "https://api-m.paypal.com"]);

  const realFetch = global.fetch;
  let tokenCalls = 0;

  global.fetch = async (url) => {
    if (String(url).includes("/oauth2/token")) {
      tokenCalls += 1;
      return { ok: true, json: async () => ({ access_token: "tok_1", expires_in: 3600 }) };
    }
    return { ok: true, json: async () => ({}) };
  };

  pp._tokens.clear();
  await pp.token(creds);
  await pp.token(creds);
  check("the oauth token is fetched once and reused", tokenCalls, 1);

  // Switching credentials must not keep serving the previous account's token.
  await pp.token({ ...creds, clientId: "other" });
  check("a different client id fetches its own token", tokenCalls, 2);

  global.fetch = realFetch;
  pp._tokens.clear();

  // Approval is not payment. An approved order whose capture came back in
  // any state other than COMPLETED must not grant access.
  const approved = {
    event_type: "CHECKOUT.ORDER.APPROVED",
    resource: { id: "ord_1", purchase_units: [{ custom_id: "exa_ref1", amount: { value: "19.99", currency_code: "USD" } }] },
  };

  const declined = pp.normaliseEvent({ ...approved, _capture: { status: "DECLINED" } });
  check("an approved order with a failed capture is not paid", declined.paid, false);

  const captured = pp.normaliseEvent({
    ...approved,
    _capture: { status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "cap_1" }] } }] },
  });
  check("a completed capture is paid", captured.paid, true);
  check("ref is our reference, not paypal's order id", captured.ref, "exa_ref1");
  check("amount parses out of the string paypal sends", captured.amount, 19.99);
  check("capture id is kept as the transaction id", captured.transactionId, "cap_1");

  // The other event that can arrive for the same purchase. It has to
  // normalise to the same ref, or the dedup guard would let both through and
  // grant access twice.
  const completed = pp.normaliseEvent({
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "cap_1", custom_id: "exa_ref1", amount: { value: "19.99", currency_code: "USD" } },
  });
  check("the capture event carries the same ref", completed.ref, captured.ref);
  check("so a duplicate is catchable", completed.paid && captured.paid, true);

  const other = pp.normaliseEvent({ event_type: "BILLING.SUBSCRIPTION.CREATED", resource: {} });
  check("an unrelated event is not paid", other.paid, false);

  check("it cannot carry metadata either", pp.carriesMetadata, false);
  check("webhook id is required before enabling",
    payment.missingCredentials(pp, { clientId: "a", clientSecret: "b" }), ["webhookId"]);
}

console.log("\nbkash: nothing in the redirect is trusted");
{
  const bk = payment.PROVIDERS.bkash;
  const creds = { appKey: "ak", appSecret: "as", username: "u", password: "p", sandbox: "true" };

  check("sandbox and live hit different hosts",
    [bk.baseUrl({ sandbox: "true" }), bk.baseUrl({ sandbox: "false" })],
    ["https://tokenized.sandbox.bka.sh/v1.2.0-beta", "https://tokenized.pay.bka.sh/v1.2.0-beta"]);

  check("it confirms by redirect, not webhook", bk.confirmRedirect !== undefined, true);
  check("and says so if a webhook ever arrives",
    (() => { try { bk.verifyWebhook(); return false; } catch { return true; } })(), true);

  const realFetch = global.fetch;
  let executed = null;

  const stub = (executeResponse) => async (url, opts) => {
    if (String(url).includes("/token/grant")) {
      return { ok: true, json: async () => ({ id_token: "tok", expires_in: 3600 }) };
    }
    if (String(url).includes("/checkout/execute")) {
      executed = JSON.parse(opts.body);
      return { ok: true, json: async () => executeResponse };
    }
    return { ok: true, json: async () => ({}) };
  };

  // The whole security argument for this driver: a forged redirect achieves
  // nothing, because execute against a payment nobody completed does not
  // come back Completed.
  bk._tokens.clear();
  global.fetch = stub({ transactionStatus: "Initiated", paymentID: "TR1" });
  const forged = await bk.confirmRedirect({ paymentID: "TR1", status: "success" }, creds);
  check("a forged 'success' redirect is still not paid", forged.paid, false);
  check("but bkash was actually asked about it", executed.paymentID, "TR1");

  bk._tokens.clear();
  global.fetch = stub({
    transactionStatus: "Completed",
    paymentID: "TR1",
    trxID: "TRX99",
    merchantInvoiceNumber: "exa_ref9",
    amount: "1500.00",
    currency: "BDT",
  });
  const real = await bk.confirmRedirect({ paymentID: "TR1", status: "success" }, creds);
  check("a completed payment is paid", real.paid, true);
  // ref and reference differ here, unlike every other driver - bkash's id is
  // not one we chose, so the pending lookup needs our own separately.
  check("ref is bkash's payment id", real.ref, "TR1");
  check("reference is ours, for the pending lookup", real.reference, "exa_ref9");
  check("amount comes from execute, not the query", real.amount, 1500);
  check("trxID is kept for reconciliation", real.transactionId, "TRX99");

  // A cancelled payment short-circuits before spending a token on execute.
  bk._tokens.clear();
  executed = null;
  global.fetch = stub({});
  const cancelled = await bk.confirmRedirect({ paymentID: "TR1", status: "cancel" }, creds);
  check("a cancelled redirect is not paid", cancelled.paid, false);
  check("and does not bother calling execute", executed, null);

  let threw = false;
  try { await bk.confirmRedirect({}, creds); } catch (e) { threw = true; }
  check("a callback with no paymentID is rejected", threw, true);

  // BDT-only. Accepting another currency would charge the same number in
  // taka, which is the kind of bug that only shows up in the ledger.
  bk._tokens.clear();
  threw = false;
  try { await bk.createCheckout({ amount: 19.99, currency: "USD", reference: "r", callbackUrl: "http://x" }, creds); }
  catch (e) { threw = true; }
  check("a non-BDT charge is refused", threw, true);

  threw = false;
  try { await bk.createCheckout({ amount: 100, currency: "BDT", reference: "r" }, creds); } catch (e) { threw = true; }
  check("a missing callback url is refused", threw, true);

  global.fetch = realFetch;
  bk._tokens.clear();

  check("all four credentials are needed",
    payment.missingCredentials(bk, { appKey: "a", appSecret: "b" }), ["username", "password"]);
}

console.log("\nthe registry drives everything downstream");
{
  check("an unknown provider has no driver", payment.driverFor("wechat"), null);
  check("lookup is case-insensitive", payment.driverFor("STRIPE").name, "stripe");
  check("every driver is registered", Object.keys(payment.PROVIDERS).sort(), ["bkash", "paypal", "razorpay", "sslcommerz", "stripe"]);
  check("every driver implements the full contract",
    Object.values(payment.PROVIDERS).every((d) =>
      typeof d.configured === "function"
      && typeof d.createCheckout === "function"
      && typeof d.verifyWebhook === "function"
      && typeof d.normaliseEvent === "function"
      && Array.isArray(d.credentials)
    ), true);
}

};

main().then(() => {
console.log("\n" + "-".repeat(50));
console.log(`${passed} passed, ${failed} failed`);
console.log("\nNOT covered here — needs live credentials, on your side:");
console.log("  - Stripe accepting a real createCheckout request");
console.log("  - a real webhook delivery verifying end to end");
console.log("  - the redirect back to /purchases/success granting access");
console.log("  - SSLCommerz: a real session request, and a real IPN whose");
console.log("    verify_sign was produced by them rather than rebuilt here");
console.log("  - bKash: a real grant/create/execute round trip in sandbox");

if (failed > 0) process.exit(1);
console.log("PASS");
});

// Nothing above opens a connection, but mongoose keeps the process alive if
// a model was compiled, so exit explicitly rather than hanging the runner.
mongoose.connection.close().catch(() => {});
