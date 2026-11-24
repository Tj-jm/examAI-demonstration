const asyncHandler = require("express-async-handler");
const Batch = require("../../models/batchModel");
const Purchase = require("../../models/purchaseModel");
const Coupon = require("../../models/couponModel");
const AppSettings = require("../../models/appSettingsModel");
const Trial = require("../../models/trialModel");
const AiCreditPlan = require("../../models/aiCreditPlanModel");
const AiCredit = require("../../models/aiCreditModel");
const payment = require("../../adapters/payment");
const PendingCheckout = require("../../models/pendingCheckoutModel");
const { envBaseUrl } = require("../../utils/baseUrl");
const crypto = require("crypto");
const referrals = require("../../utils/referrals");
const campaigns = require("../../utils/campaigns");

// Every checkout gets one of these, whether the gateway needs it or not, so
// the reference is available to pass as a transaction id and to correlate
// logs against later.
const newReference = () => `exa_${crypto.randomBytes(12).toString("hex")}`;

// `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder syntax — Stripe
// substitutes it server-side before redirecting the browser back, which is
// why the flow works for Stripe today. No other provider here understands
// that syntax: Razorpay, SSLCommerz and PayPal all treated it as a literal
// string, so a paying student's browser came back to
// "/purchases/success?session_id={CHECKOUT_SESSION_ID}" — a value that
// never matches any purchase, so the success page polled forever and timed
// out even though the webhook had already granted access. Every gateway
// except Stripe gets our own reference instead, known up front (unlike a
// gateway-issued id, which for some of them doesn't exist until after this
// URL is already sent to them) and matched via Purchase.checkoutReference.
const buildSuccessUrl = (base, provider, reference) =>
  provider === "stripe"
    ? `${base}/purchases/success?session_id={CHECKOUT_SESSION_ID}`
    : `${base}/purchases/success?session_id=${encodeURIComponent(reference)}`;

// Gateways that cannot carry our metadata (SSLCommerz has four pass-through
// fields; a batch purchase needs eleven) get it parked under the reference
// instead. Doing this before the checkout call, not after, means a webhook
// that arrives while the redirect is still in flight always finds its row.
const parkMetadata = async ({ provider, reference, metadata, amount, currency }) => {
  const driver = payment.driverFor(provider);
  if (!driver || driver.carriesMetadata !== false) return;

  await PendingCheckout.create({
    reference,
    provider,
    metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])),
    amount,
    currency,
  });
};

// Checkout creates nothing until the webhook confirms real money moved — an
// abandoned checkout session should not leave a dangling "pending" purchase
// behind. Everything the webhook needs to create the real record travels as
// checkout metadata instead, computed once here rather than recomputed (and
// possibly drifting, if a coupon changes in between) when the webhook fires.

//@desc   Pricing for a batch a student does not have access to yet — no
//        batchAccess gate, since by definition they are not past it
//@route  GET /api/app/purchases/batches/:batchId/plans
//@access Private (student)
const getBatchPlans = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.batchId);

  if (!batch || !batch.isActive) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const [existingTrial, settings] = await Promise.all([
    Trial.findOne({ student: req.student._id, batch: batch._id }),
    AppSettings.get(),
  ]);
  // Who looked at the plans (admin Leads page). Never in the way.
  require("../../utils/leads").recordPlanView(req.student._id, batch._id);

  const defaultCurrency = settings.defaultCurrency || "USD";
  const isFreeBatch = batch.accessType === "free";

  // Free batches used to be auto-enrolled without a purchase — now they go
  // through a 0-cost checkout. A free batch with no explicitly priced plans
  // gets a synthetic one so the student always sees a plan to "buy".
  let plans;
  if (isFreeBatch && !batch.plans.some((p) => p.isActive)) {
    plans = [{
      label: "Free",
      price: 0,
      prices: [],
      durationDays: null,
      isInfinite: true,
      isActive: true,
      pricesByCurrency: { [defaultCurrency]: 0 },
    }];
  } else {
    plans = batch.plans.filter((p) => p.isActive).map((plan) => ({
      ...plan.toObject(),
      pricesByCurrency: Object.fromEntries(
        plan.currencies(defaultCurrency)
          .map((c) => [c, plan.priceIn(c, defaultCurrency)])
          .filter(([, amount]) => amount !== null)
      ),
    }));
  }

  // Gateways are irrelevant for free batches — there is nothing to charge.
  const gatewaysByCurrency = {};
  if (!isFreeBatch) {
    const currencies = [...new Set(
      batch.plans.filter((p) => p.isActive).flatMap((p) => p.currencies(defaultCurrency))
    )];
    for (const currency of currencies) {
      const matches = await payment.availableFor(currency);
      gatewaysByCurrency[currency] = matches.map((m) => ({
        provider: m.gateway.provider,
        label: m.driver.label,
      }));
    }
  }

  res.status(200).json({
    _id: batch._id,
    name: batch.name,
    // The checkout screens show which batch is being bought, and an icon is
    // how a student recognises it at a glance from the batch list they just
    // came from.
    icon: batch.icon,
    accessType: batch.accessType,
    defaultCurrency,
    // Each plan carries every price it has, so the student app can switch
    // currency without another round trip.
    plans,
    gatewaysByCurrency,
    trialAvailable: !existingTrial && (batch.trialDays || 0) > 0,
  });
});

// Shared by startCheckout and previewCoupon below — the same reasoning
// this project already applies elsewhere (buildPerformance, countResolved):
// the number shown to a student before they commit to anything and the
// number actually charged must be provably the same calculation, not two
// independently written ones that could quietly disagree. Throws the exact
// same errors startCheckout already threw inline, so error handling at
// both call sites stays identical.
// Only checked for a coupon that opted into limitOnePerStudent (a referral
// code, typically) — most coupons here fund an ordinary purchase (renewing
// or extending a subscription), and a student using the same code again
// later is expected, not abuse. maxRedemptions is what caps a coupon
// overall regardless of this setting.
const hasStudentRedeemedCoupon = async (studentId, couponId) =>
  Boolean(studentId && couponId && (await Purchase.exists({ student: studentId, coupon: couponId, status: "complete" })));

const resolvePriceAndCoupon = async ({ batch, plan, couponCode, currency: currencyParam, studentId }) => {
  let coupon = null;
  let discountAmount = 0;

  if (couponCode) {
    coupon = await Coupon.findOne({ code: String(couponCode).trim().toUpperCase() });
    if (!coupon || !coupon.isValid(batch._id, "subscriptions")) {
      const error = new Error("That coupon is not valid for this plan.");
      error.statusCode = 400;
      throw error;
    }
    await referrals.checkUse(coupon, studentId);
    if (coupon.limitOnePerStudent && (await hasStudentRedeemedCoupon(studentId, coupon._id))) {
      const error = new Error("You've already used this coupon.");
      error.statusCode = 400;
      throw error;
    }
    discountAmount = Math.max(0, plan.price - coupon.apply(plan.price));
  }

  const settings = await AppSettings.get();
  const defaultCurrency = settings.defaultCurrency || "USD";

  // The student picks the currency, from the list getBatchPlans offered. An
  // absent choice means the default, which is what every existing client
  // sends and why nothing breaks for them.
  const currency = String(currencyParam || defaultCurrency).toUpperCase();
  const listPrice = plan.priceIn(currency, defaultCurrency);

  // Refused rather than converted. Falling back to the default price in a
  // currency it was never set for would charge, say, 2499 USD for a plan
  // priced 2499 BDT — the most expensive possible way to be helpful.
  if (listPrice === null) {
    const error = new Error(`"${plan.label}" is not sold in ${currency}.`);
    error.statusCode = 400;
    throw error;
  }

  // Coupons are a percentage or a fixed amount in the default currency. A
  // fixed-amount coupon applied to a different currency would be nonsense,
  // so it is only honoured on the currency it was priced in.
  if (coupon && currency !== defaultCurrency && coupon.discountType !== "percent") {
    const error = new Error(`That coupon can only be used in ${defaultCurrency}.`);
    error.statusCode = 400;
    throw error;
  }

  const discountForCurrency = coupon
    ? (coupon.discountType === "percent" ? listPrice - coupon.apply(listPrice) : discountAmount)
    : 0;

  const amountPaid = Math.max(0, Math.round((listPrice - discountForCurrency) * 100) / 100);
  discountAmount = Math.max(0, Math.round(discountForCurrency * 100) / 100);

  return { coupon, currency, defaultCurrency, listPrice, discountAmount, amountPaid };
};

// AI credit packs are single-currency (always the platform default — see
// startAiCreditCheckout below), so this is deliberately simpler than
// resolvePriceAndCoupon above: no per-currency listPrice lookup, no
// currency-mismatch check, because there is only ever one currency a pack
// is ever sold in to begin with.
const resolveAiCreditCoupon = async ({ batchId, price, couponCode, studentId }) => {
  if (!couponCode) return { coupon: null, discountAmount: 0, amountPaid: price };

  const coupon = await Coupon.findOne({ code: String(couponCode).trim().toUpperCase() });
  if (!coupon || !coupon.isValid(batchId, "aiCredits")) {
    const error = new Error("That coupon is not valid for this pack.");
    error.statusCode = 400;
    throw error;
  }
  await referrals.checkUse(coupon, studentId);
  if (coupon.limitOnePerStudent && (await hasStudentRedeemedCoupon(studentId, coupon._id))) {
    const error = new Error("You've already used this coupon.");
    error.statusCode = 400;
    throw error;
  }

  const discountAmount = Math.max(0, Math.round((price - coupon.apply(price)) * 100) / 100);
  const amountPaid = Math.max(0, Math.round((price - discountAmount) * 100) / 100);
  return { coupon, discountAmount, amountPaid };
};

//@desc   Validate a coupon against one AI credit pack, without starting a
//        checkout — the AI-credit equivalent of previewCoupon above.
//@route  GET /api/app/purchases/ai-credits/coupon-preview?planId=&code=&batchId=
//@access Private (student)
const previewAiCreditCoupon = asyncHandler(async (req, res) => {
  const { planId, code, batchId } = req.query;

  if (!planId || !code) {
    res.status(400);
    throw new Error("A coupon code and a pack are both required.");
  }

  const plan = await AiCreditPlan.findOne({ _id: planId, batch: batchId || null, isActive: true });
  if (!plan) {
    res.status(400);
    throw new Error("That credit pack is not available.");
  }

  const settings = await AppSettings.get();
  const currency = settings.defaultCurrency || "USD";
  const result = await resolveAiCreditCoupon({ batchId: batchId || null, price: plan.price, couponCode: code, studentId: req.student._id });

  res.status(200).json({
    valid: true,
    currency,
    listPrice: plan.price,
    discountAmount: result.discountAmount,
    amountPaid: result.amountPaid,
  });
});

//@desc   Validate a coupon against one specific plan and currency, and
//        return what it would actually charge — without starting a
//        checkout or touching redemptionCount. What lets the student see
//        the discounted price animate in the moment they type a valid
//        code, rather than only finding out at the payment gateway. Uses
//        resolvePriceAndCoupon, the exact same function startCheckout
//        calls, so a coupon that previews as valid here is provably valid
//        (and priced identically) there too.
//@route  GET /api/app/purchases/batches/:batchId/coupon-preview?code=&planLabel=&currency=
//@access Private (student)
const previewCoupon = asyncHandler(async (req, res) => {
  const { code, planLabel, currency } = req.query;

  if (!code || !planLabel) {
    res.status(400);
    throw new Error("A coupon code and a plan are both required.");
  }

  const batch = await Batch.findById(req.params.batchId);
  if (!batch || !batch.isActive) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const plan = batch.plans.find((p) => p.label === planLabel && p.isActive);
  if (!plan) {
    res.status(400);
    throw new Error(`"${planLabel}" is not an available plan on this batch.`);
  }

  const result = await resolvePriceAndCoupon({ batch, plan, couponCode: code, currency, studentId: req.student._id });

  res.status(200).json({
    valid: true,
    currency: result.currency,
    listPrice: result.listPrice,
    discountAmount: result.discountAmount,
    amountPaid: result.amountPaid,
  });
});

//@desc   Start a checkout at a gateway, or complete instantly if a coupon
//        takes the price to zero
//@route  POST /api/app/purchases/checkout
//@access Private (student)
const startCheckout = asyncHandler(async (req, res) => {
  const { batchId, planLabel, couponCode, viaShortLink } = req.body;

   const batch = await Batch.findById(batchId);
  if (!batch || !batch.isActive) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  // Free batches may have no explicit plans — the synthetic "Free" plan is
  // implied, so accept it at checkout without looking it up on the batch.
  const isFreeBatch = batch.accessType === "free";
  const plan = isFreeBatch && planLabel === "Free"
    ? { label: "Free", price: 0, durationDays: null, isInfinite: true, isActive: true }
    : batch.plans.find((p) => p.label === planLabel && p.isActive);
  if (!plan) {
    res.status(400);
    throw new Error(`"${planLabel}" is not an available plan on this batch.`);
  }

  // Free batches skip price resolution entirely — the synthetic "Free" plan
  // has a fixed 0 price and no coupons or gateways apply.
  let coupon, currency, listPrice, discountAmount, amountPaid;
  if (isFreeBatch) {
    const settings = await AppSettings.get();
    currency = (req.body.currency || settings.defaultCurrency || "USD").toUpperCase();
    listPrice = 0;
    discountAmount = 0;
    amountPaid = 0;
  } else {
    ({ coupon, currency, listPrice, discountAmount, amountPaid } = await resolvePriceAndCoupon({
      batch, plan, couponCode, currency: req.body.currency, studentId: req.student._id,
    }));
  }

  const campaign = await campaigns.attributionFor(req.student._id);
  const snapshot = () => ({
    campaign,
    student: req.student._id,
    batch: batch._id,
    // listPrice, not plan.price — the record has to say what this student was
    // actually charged in the currency they were charged in, or a BDT
    // purchase would be filed at the USD sticker price.
    plan: { label: plan.label, price: listPrice, durationDays: plan.durationDays, isInfinite: plan.isInfinite },
    currency,
    coupon: coupon?._id,
    couponCode: coupon?.code,
    couponSingleUsePerStudent: coupon?.limitOnePerStudent || false,
    viaShortLink: viaShortLink || null,
    referrer: coupon?.referrer || null,
    discountAmount,
    amountPaid,
  });

  // A coupon that covers the whole price never touches a payment gateway —
  // there is nothing to charge, so there is nothing for Stripe to do.
  if (amountPaid <= 0) {
    // Claimed before the purchase is created, not after: two requests
    // racing the coupon's last redemption slot must not both succeed in
    // granting free access. See Coupon.tryRedeem's own comment for why a
    // plain increment-then-save doesn't have this property.
    if (coupon) {
      const redeemed = await Coupon.tryRedeem(coupon._id);
      if (!redeemed) {
        res.status(409);
        throw new Error("This coupon just reached its redemption limit.");
      }
    }
    let purchase;
    try {
      purchase = await Purchase.create({
        ...snapshot(),
        provider: "coupon",
        status: "complete",
      });
    } catch (error) {
      // hasStudentRedeemedCoupon's own check (in resolvePriceAndCoupon,
      // above) is a plain read racing this same create — the partial
      // unique index on {student, coupon} in purchaseModel.js is what
      // actually stops two concurrent requests from this student both
      // redeeming the same coupon. The loser lands here.
      if (error.code === 11000 && coupon) {
        await Coupon.findByIdAndUpdate(coupon._id, { $inc: { redeemedCount: -1 } });
        res.status(409);
        throw new Error("You've already used this coupon.");
      }
      throw error;
    }
    return res.status(201).json({ free: true, purchase });
  }

  // Gateways are now enabled per currency, so "is payment set up" cannot be
  // answered globally — only for the currency actually being charged.
  if (!(await payment.configured(currency))) {
    res.status(503);
    throw new Error("Online payment is not set up yet. Contact your institution to arrange access.");
  }

  const base = envBaseUrl("CLIENT_URL_STUDENT");

  // Resolved before the checkout call, because whether the metadata has to
  // be parked depends on which gateway was picked.
  const provider = await payment.pick(currency, req.body.provider);
  const reference = newReference();

  const metadata = {
    studentId: String(req.student._id),
    batchId: String(batch._id),
    planLabel: plan.label,
    planPrice: listPrice,
    durationDays: plan.durationDays ?? "",
    isInfinite: plan.isInfinite,
    currency,
    couponId: coupon ? String(coupon._id) : "",
    couponCode: coupon ? coupon.code : "",
    viaShortLink: viaShortLink || "",
    discountAmount,
    amountPaid,
    reference,
  };

  await parkMetadata({ provider, reference, metadata, amount: amountPaid, currency });
  // For the "checkout not finished" automation (utils/automations.js).
  await require("../../models/checkoutStartModel").create({ student: req.student._id, batch: batch._id, planLabel: plan.label, reference }).catch(() => {});

  const checkout = await payment.createCheckout({
    provider,
    reference,
    amount: amountPaid,
    currency,
    description: `${batch.name} — ${plan.label}`,
    successUrl: buildSuccessUrl(base, provider, reference),
    cancelUrl: `${base}/purchases/cancelled`,
    ipnUrl: `${envBaseUrl("SERVER_URL")}/api/app/purchases/webhook/${provider}`,
    callbackUrl: `${envBaseUrl("SERVER_URL")}/api/app/purchases/callback/${provider}`,
    customerEmail: req.student.email || undefined,
    customerName: req.student.name || undefined,
    customerPhone: req.student.phoneNumber || undefined,
    metadata,
  });

  res.status(200).json({ free: false, url: checkout.url, provider: checkout.provider });
});

// Turns a verified, paid event into a Purchase. Shared because there are now
// two ways one can arrive: a signed webhook POST (Stripe, Razorpay,
// SSLCommerz, PayPal) and a browser redirect that the server then confirms
// out-of-band (bKash). Both must grant identically or the two paths would
// drift, and the one that drifts is the one nobody tests.
//
// Returns a plain result rather than writing to res, so each caller can
// answer in its own idiom — JSON for a webhook, a redirect for a browser.
const applyPaidEvent = async ({ provider, event }) => {
  // Every gateway redelivers. providerRef is unique per checkout across all
  // of them, so this one guard covers every path in.
  const already = await Purchase.findOne({ providerRef: event.ref });
  if (already) return { ok: true, duplicate: true, purchase: already };

  let meta = event.metadata || {};
  let pending = null;

  if (payment.driverFor(provider)?.carriesMetadata === false) {
    // `reference` is our own id where the gateway keeps its transaction id
    // separate (bKash); everywhere else the two are the same value.
    pending = await PendingCheckout.findOne({ reference: event.reference || event.ref });

    if (!pending) {
      return { ok: false, ignored: true, reason: "no pending checkout" };
    }

    // The gateway reports what it actually charged. If that disagrees with
    // what we quoted, this is not a purchase to honour — it is a tampered or
    // mismatched callback, and granting on it would be the expensive bug.
    const quoted = Number(pending.amount);
    if (event.amount !== null && Math.abs(event.amount - quoted) > 0.01) {
      return { ok: false, error: `Amount mismatch on ${provider} ${event.ref}: charged ${event.amount}, quoted ${quoted}.` };
    }

    if (event.currency && pending.currency && event.currency !== pending.currency) {
      return { ok: false, error: `Currency mismatch on ${provider} ${event.ref}: charged ${event.currency}, quoted ${pending.currency}.` };
    }

    meta = pending.toMetadata();
  }

  if (meta.kind === "ai-credits") {
    if (!meta.studentId || !meta.credits) {
      return { ok: false, ignored: true, reason: "incomplete credit metadata" };
    }

    // batchId arrives as "" (not absent) for a general pack, since gateway
    // metadata values must be strings — normalised to a real null here so
    // both the AiCredit lookup and the Purchase record match what a general
    // (batch: null) balance looks like everywhere else.
    const batchId = meta.batchId || null;

    // Read here, not carried through gateway metadata — some gateways cap
    // how many pass-through fields a checkout can carry (SSLCommerz has
    // four, already spoken for), so this asks the coupon directly instead
    // of growing that payload for every install regardless of whether they
    // ever use this setting.
    const singleUsePerStudent = meta.couponId
      ? Boolean((await Coupon.findById(meta.couponId).select("limitOnePerStudent"))?.limitOnePerStudent)
      : false;

    await AiCredit.updateOne(
      { student: meta.studentId, batch: batchId },
      { $inc: { balance: Number(meta.credits) } },
      { upsert: true }
    );
    await require("../../utils/notify").notify(meta.studentId, "aiCredits", {
      title: `${Number(meta.credits)} AI credits added`,
      body: meta.planLabel || null,
      link: batchId ? `/batches/${batchId}/ai-credits` : null,
    }).catch(() => {});

    let purchase;
    try {
      purchase = await Purchase.create({
        student: meta.studentId,
        batch: batchId,
        plan: { label: meta.planLabel || "AI credits", price: Number(meta.amountPaid) || 0, isInfinite: false },
        currency: meta.currency || "USD",
        amountPaid: Number(meta.amountPaid) || 0,
        credits: Number(meta.credits),
        kind: "ai-credits",
        campaign: await campaigns.attributionFor(meta.studentId),
        coupon: meta.couponId || undefined,
        couponCode: meta.couponCode || undefined,
        couponSingleUsePerStudent: singleUsePerStudent,
        viaShortLink: meta.viaShortLink || undefined,
        discountAmount: Number(meta.discountAmount) || 0,
        provider,
        providerRef: event.ref,
        checkoutReference: meta.reference || null,
        transactionId: event.transactionId || null,
        status: "complete",
      });
    } catch (error) {
      // Money already moved by this point (the gateway confirmed payment
      // before this webhook fired) — there's no "reject the checkout"
      // option left the way the free-path has, only "don't crash the
      // webhook handler over it". A single-use-per-student coupon reused
      // via a genuine race on a *paid* checkout is rare enough (payment
      // itself is real-world friction a free checkout doesn't have) that
      // this is logged for manual follow-up rather than built out further.
      if (error.code === 11000) {
        console.error(`Duplicate coupon redemption on a paid ai-credits purchase: student ${meta.studentId}, coupon ${meta.couponId}, ref ${event.ref}. Needs manual review.`);
        if (pending) await pending.deleteOne();
        return { ok: false, error: "duplicate coupon redemption on an already-paid purchase" };
      }
      throw error;
    }

    if (meta.couponId) {
      // Payment already settled by this point — the purchase is honoured
      // regardless, but tryRedeem (rather than a bare $inc) still keeps
      // redeemedCount from reporting more redemptions than the cap once
      // this same coupon's usage is later reconciled.
      if (!(await Coupon.tryRedeem(meta.couponId))) {
        console.warn(`Coupon ${meta.couponId} redeemed past its cap by purchase for student ${meta.studentId}.`);
      }
    }

    if (pending) await pending.deleteOne();
    return { ok: true, purchase };
  }

  if (!meta.studentId || !meta.batchId || !meta.planLabel) {
    return { ok: false, ignored: true, reason: "incomplete purchase metadata" };
  }

  const usedCoupon = meta.couponId ? await Coupon.findById(meta.couponId).select("limitOnePerStudent referrer") : null;
  const singleUsePerStudent = Boolean(usedCoupon?.limitOnePerStudent);

  let purchase;
  try {
    purchase = await Purchase.create({
      student: meta.studentId,
      batch: meta.batchId,
      plan: {
        label: meta.planLabel,
        price: Number(meta.planPrice),
        durationDays: meta.durationDays ? Number(meta.durationDays) : null,
        isInfinite: meta.isInfinite === "true",
      },
      currency: meta.currency || "USD",
      coupon: meta.couponId || undefined,
      couponCode: meta.couponCode || undefined,
      couponSingleUsePerStudent: singleUsePerStudent,
      viaShortLink: meta.viaShortLink || undefined,
      referrer: usedCoupon?.referrer || null,
      campaign: await campaigns.attributionFor(meta.studentId),
      discountAmount: Number(meta.discountAmount) || 0,
      amountPaid: Number(meta.amountPaid) || 0,
      provider,
      providerRef: event.ref,
      checkoutReference: meta.reference || null,
      transactionId: event.transactionId || null,
      status: "complete",
    });
  } catch (error) {
    // Same reasoning as the ai-credits branch above — money already moved,
    // so this is logged for manual review rather than treated as a request
    // that can still just be rejected outright.
    if (error.code === 11000) {
      console.error(`Duplicate coupon redemption on a paid batch purchase: student ${meta.studentId}, coupon ${meta.couponId}, ref ${event.ref}. Needs manual review.`);
      if (pending) await pending.deleteOne();
      return { ok: false, error: "duplicate coupon redemption on an already-paid purchase" };
    }
    throw error;
  }

  if (meta.couponId) {
    if (!(await Coupon.tryRedeem(meta.couponId))) {
      console.warn(`Coupon ${meta.couponId} redeemed past its cap by purchase for student ${meta.studentId}.`);
    }
  }

  // Consumed only after the Purchase exists — deleting earlier would leave a
  // redelivered event with nothing to build from if the create had failed.
  if (pending) await pending.deleteOne();

  await referrals.rewardReferral(purchase);

  return { ok: true, purchase };
};

//@desc   Gateway webhook — where an online purchase gets created for every
//        provider that signs and POSTs its result. Mounted directly in
//        app.js with a raw body parser, ahead of the app's normal json()
//        middleware. The provider is named in the path rather than read
//        from the payload, because the payload is exactly what has not been
//        verified yet at this point.
//@route  POST /api/app/purchases/webhook/:provider
//@access Public (verified by signature, not a session)
const gatewayWebhook = asyncHandler(async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();

  if (!payment.driverFor(provider)) {
    res.status(404);
    throw new Error(`Unknown payment provider "${provider}".`);
  }

  let event;
  try {
    event = await payment.verifyWebhook(provider, req.body.toString(), req.headers);
  } catch (error) {
    res.status(400);
    throw new Error(`Webhook signature check failed: ${error.message}`);
  }

  // Not a payment-completed event. Acknowledged so the provider stops
  // retrying — a 4xx here would have it redeliver forever an event we are
  // never going to act on.
  if (!event.paid) {
    return res.status(200).json({ received: true, ignored: true });
  }

  const result = await applyPaidEvent({ provider, event });

  if (result.error) {
    res.status(400);
    throw new Error(result.error);
  }

  if (!result.ok) {
    // Acknowledged rather than retried: nothing about redelivering this will
    // make the missing data appear.
    return res.status(200).json({ received: true, ignored: true, reason: result.reason });
  }

  res.status(200).json({
    received: true,
    duplicate: Boolean(result.duplicate),
    purchaseId: result.purchase._id,
  });
});

//@desc   Redirect confirmation, for gateways with no signed webhook at all.
//        bKash sends the customer's browser back here and expects the
//        merchant to confirm the payment server-to-server; nothing in the
//        query string is trusted, it only names which payment to go and ask
//        about. The answer to that question is what grants access.
//@route  GET /api/app/purchases/callback/:provider
//@access Public (the confirmation call is authenticated, the request is not)
const gatewayCallback = asyncHandler(async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const driver = payment.driverFor(provider);
  const base = envBaseUrl("CLIENT_URL_STUDENT");
  if (!driver?.confirmRedirect) {
    res.status(404);
    throw new Error(`"${provider}" does not use redirect confirmation.`);
  }

  let event;
  try {
    event = await payment.confirmRedirect(provider, req.query);
  } catch (error) {
    // A student who abandoned the payment lands here too. They get the
    // cancelled page, not an error page — from their side nothing went
    // wrong, they just changed their mind.
    console.error(`${provider} callback failed:`, error.message);
    return res.redirect(`${base}/purchases/cancelled`);
  }

  if (!event.paid) {
    return res.redirect(`${base}/purchases/cancelled`);
  }

  const result = await applyPaidEvent({ provider, event });

  if (!result.ok) {
    console.error(`${provider} callback could not be applied:`, result.error || result.reason);
    return res.redirect(`${base}/purchases/cancelled`);
  }

  // Same success page every other gateway lands on, keyed by the reference
  // the verify endpoint already knows how to look up.
  res.redirect(`${base}/purchases/success?session_id=${encodeURIComponent(event.ref)}`);
});

//@desc   Has a checkout completed yet? Polled by the success page, since the
//        webhook that actually creates the purchase can arrive after the
//        browser redirect does.
//@route  GET /api/app/purchases/verify/:sessionId
//@access Private (student)
const verifyCheckout = asyncHandler(async (req, res) => {
  // providerRef for the sessionId still covers Stripe (its session id IS
  // both) and anyone hitting this with a gateway-issued ref directly;
  // checkoutReference covers every provider whose success redirect now
  // carries our own reference instead (see buildSuccessUrl above).
  const purchase = await Purchase.findOne({
    student: req.student._id,
    $or: [{ providerRef: req.params.sessionId }, { checkoutReference: req.params.sessionId }],
  });
  res.status(200).json({ ready: Boolean(purchase), purchase: purchase || null });
});

//@desc   One purchase of my own, in full — for the receipt page, which
//        needs a specific purchase by id and cannot rely on it still being
//        on whatever page of getMyPurchases happens to be cached (a receipt
//        for an old purchase would silently 404 there once it's paged
//        past).
//@route  GET /api/app/purchases/:id
//@access Private (student)
const getPurchase = asyncHandler(async (req, res) => {
  const purchase = await Purchase.findOne({ _id: req.params.id, student: req.student._id }).populate("batch", "name");

  if (!purchase) {
    res.status(404);
    throw new Error("Purchase not found.");
  }

  res.status(200).json({ purchase });
});

//@desc   My purchase history
//@route  GET /api/app/purchases?page=&limit=
//@access Private (student)
const getMyPurchases = asyncHandler(async (req, res) => {
  const query = { student: req.student._id };
  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const [purchases, total] = await Promise.all([
    Purchase.find(query).populate("batch", "name").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Purchase.countDocuments(query),
  ]);

  res.status(200).json({ purchases, total, page, pages: Math.ceil(total / limit) });
});

//@desc   AI credit packs available on a batch, plus this student's current
//        balance — no batchAccess gate, buying credits ahead of needing
//        them (or before access technically starts) is a reasonable thing
//        to let happen
//@route  GET /api/app/purchases/batches/:batchId/ai-credit-plans
//@access Private (student)
const getAiCreditPlans = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.batchId);
  if (!batch || !batch.isActive) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const [plans, credit] = await Promise.all([
    AiCreditPlan.find({ batch: batch._id, isActive: true }).sort({ price: 1 }),
    AiCredit.findOne({ student: req.student._id, batch: batch._id }),
  ]);

  res.status(200).json({
    plans,
    balance: credit?.balance || 0,
  });
});

//@desc   General AI credit packs — not tied to a batch — plus this
//        student's general balance
//@route  GET /api/app/purchases/ai-credit-plans
//@access Private (student)
const getGeneralAiCreditPlans = asyncHandler(async (req, res) => {
  const [plans, credit] = await Promise.all([
    AiCreditPlan.find({ batch: null, isActive: true }).sort({ price: 1 }),
    AiCredit.findOne({ student: req.student._id, batch: null }),
  ]);

  res.status(200).json({
    plans,
    balance: credit?.balance || 0,
  });
});

//@desc   Start a checkout for an AI credit pack
//@route  POST /api/app/purchases/ai-credits/checkout
//@access Private (student)
const startAiCreditCheckout = asyncHandler(async (req, res) => {
  const { batchId, planId, couponCode, viaShortLink } = req.body;

  // batchId is optional here — its absence means the general, not
  // batch-tied pool. Whichever kind, the plan itself has to match: a
  // batch-scoped plan can't be bought as if it were general and vice versa,
  // since AiCreditPlan.batch is what encodes which one a given pack is.
  const [batch, plan] = await Promise.all([
    batchId ? Batch.findById(batchId) : Promise.resolve(null),
    AiCreditPlan.findOne({ _id: planId, batch: batchId || null, isActive: true }),
  ]);

  if (batchId && (!batch || !batch.isActive)) {
    res.status(404);
    throw new Error("Batch not found.");
  }
  if (!plan) {
    res.status(400);
    throw new Error("That credit pack is not available.");
  }

  const settings = await AppSettings.get();
  const currency = settings.defaultCurrency || "USD";

  const { coupon, discountAmount, amountPaid } = await resolveAiCreditCoupon({
    batchId: batch?._id || null, price: plan.price, couponCode, studentId: req.student._id,
  });

  // A naturally free pack, or a coupon that covers the whole price — either
  // way there is nothing for a gateway to do, so credits grant immediately.
  // Always recorded as a Purchase now (a naturally-free pack previously
  // wasn't), since a coupon redemption has to show up somewhere for the
  // representative-earnings dashboard to ever count it.
  if (amountPaid <= 0) {
    if (coupon) {
      const redeemed = await Coupon.tryRedeem(coupon._id);
      if (!redeemed) {
        res.status(409);
        throw new Error("This coupon just reached its redemption limit.");
      }
    }
    // Purchase created before the credit grant, not after: it's the one
    // guarded by purchaseModel.js's partial unique index on
    // {student, coupon}, so a racing duplicate request fails here — before
    // any balance has actually been added — rather than after.
    try {
      await Purchase.create({
        student: req.student._id,
        batch: batch?._id || null,
        plan: { label: plan.label, price: plan.price, isInfinite: false },
        currency,
        amountPaid: 0,
        credits: plan.credits,
        kind: "ai-credits",
        coupon: coupon?._id,
        couponCode: coupon?.code,
        couponSingleUsePerStudent: coupon?.limitOnePerStudent || false,
        viaShortLink: viaShortLink || null,
        discountAmount,
        provider: "coupon",
        status: "complete",
      });
    } catch (error) {
      if (error.code === 11000 && coupon) {
        await Coupon.findByIdAndUpdate(coupon._id, { $inc: { redeemedCount: -1 } });
        res.status(409);
        throw new Error("You've already used this coupon.");
      }
      throw error;
    }
    await AiCredit.updateOne(
      { student: req.student._id, batch: batch?._id || null },
      { $inc: { balance: plan.credits } },
      { upsert: true }
    );
    await require("../../utils/notify").notify(req.student._id, "aiCredits", {
      title: `${plan.credits} AI credits added`,
      body: plan.label || null,
      link: batch ? `/batches/${batch._id}/ai-credits` : null,
    }).catch(() => {});
    return res.status(201).json({ free: true, creditsGranted: plan.credits });
  }

  if (!(await payment.configured(currency))) {
    res.status(503);
    throw new Error("Online payment is not set up yet. Contact your institution to arrange access.");
  }

  const base = envBaseUrl("CLIENT_URL_STUDENT");

  const provider = await payment.pick(currency, req.body.provider);
  const reference = newReference();

  const metadata = {
    kind: "ai-credits",
    studentId: String(req.student._id),
    batchId: batch ? String(batch._id) : "",
    planId: String(plan._id),
    planLabel: plan.label,
    credits: plan.credits,
    couponId: coupon ? String(coupon._id) : "",
    couponCode: coupon ? coupon.code : "",
    viaShortLink: viaShortLink || "",
    discountAmount,
    amountPaid,
    currency,
    reference,
  };

  await parkMetadata({ provider, reference, metadata, amount: amountPaid, currency });

  const checkout = await payment.createCheckout({
    provider,
    reference,
    amount: amountPaid,
    currency,
    description: batch ? `${batch.name} — ${plan.label} (${plan.credits} AI credits)` : `${plan.label} (${plan.credits} AI credits)`,
    successUrl: buildSuccessUrl(base, provider, reference),
    cancelUrl: `${base}/purchases/cancelled`,
    ipnUrl: `${envBaseUrl("SERVER_URL")}/api/app/purchases/webhook/${provider}`,
    callbackUrl: `${envBaseUrl("SERVER_URL")}/api/app/purchases/callback/${provider}`,
    customerEmail: req.student.email || undefined,
    customerName: req.student.name || undefined,
    customerPhone: req.student.phoneNumber || undefined,
    metadata,
  });

  res.status(200).json({ free: false, url: checkout.url, provider: checkout.provider });
});

module.exports = {
  newReference, parkMetadata, buildSuccessUrl,
  getBatchPlans, previewCoupon, startCheckout, gatewayWebhook, gatewayCallback, verifyCheckout, getMyPurchases, getPurchase,
  getAiCreditPlans, getGeneralAiCreditPlans, previewAiCreditCoupon, startAiCreditCheckout,
};
