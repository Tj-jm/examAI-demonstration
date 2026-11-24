const { AsyncLocalStorage } = require("async_hooks");
const AiUsage = require("../models/aiUsageModel");
const AiCredit = require("../models/aiCreditModel");

// Every AI charge made while serving one request is remembered here. If that
// request then fails (any 4xx/5xx), the charges are given back: the provider
// answered, but the student got an error — bad JSON, a failed check, a later
// step that broke — so they shouldn't pay for it. Admin → Settings → AI →
// "Refund AI credits when a request fails" turns this off.
//
// Background work (jobs, agents) runs outside any request and keeps its
// charges; a streamed reply that already sent 200 is a success here too.
const store = new AsyncLocalStorage();

const track = (charge) => {
  const charges = store.getStore();
  if (charges) charges.push(charge);
};

const refund = async ({ saved, debited, usageId, student, useCredit, creditScope, creditCost }) => {
  await saved; // the usage row is written fire-and-forget; wait for it
  const debit = await debited;
  await AiUsage.updateOne(
    { _id: usageId },
    { $set: { featureCost: 0, creditsSpent: 0, paidWithCredit: false, refunded: true } }
  );
  if (useCredit && debit?.modifiedCount) {
    await AiCredit.updateOne({ student, batch: creditScope }, { $inc: { balance: creditCost } });
  }
};

const aiChargeScope = (req, res, next) => {
  const charges = [];
  res.on("finish", () => {
    if (!charges.length || res.statusCode < 400) return;
    require("../models/aiConfigModel")
      .get()
      .then((config) => {
        if (config?.limits?.refundOnFailure === false) return;
        return Promise.all(charges.map((c) => refund(c).catch(() => {})));
      })
      .catch(() => {});
  });
  store.run(charges, next);
};

module.exports = { aiChargeScope, track };
