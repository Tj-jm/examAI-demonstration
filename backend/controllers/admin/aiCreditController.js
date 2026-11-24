const asyncHandler = require("express-async-handler");
const AiCreditPlan = require("../../models/aiCreditPlanModel");
const Batch = require("../../models/batchModel");

//@desc   Credit packs available on a batch
//@route  GET /api/batches/:id/ai-credit-plans
//@access Private (owner, admin — same guard as regular batch plans)
const getCreditPlans = asyncHandler(async (req, res) => {
  const plans = await AiCreditPlan.find({ batch: req.params.id }).sort({ price: 1 });
  res.status(200).json(plans);
});

//@desc   Create a credit pack
//@route  POST /api/batches/:id/ai-credit-plans
//@access Private (owner, admin)
const createCreditPlan = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id);
  if (!batch) {
    res.status(404);
    throw new Error("Batch not found.");
  }

  const { label, credits, price } = req.body;
  if (!label || !credits || price === undefined) {
    res.status(400);
    throw new Error("A label, credit amount and price are required.");
  }

  const plan = await AiCreditPlan.create({ batch: batch._id, label, credits, price });
  res.status(201).json(plan);
});

//@desc   Edit a credit pack
//@route  PUT /api/batches/:id/ai-credit-plans/:planId
//@access Private (owner, admin)
const updateCreditPlan = asyncHandler(async (req, res) => {
  const plan = await AiCreditPlan.findOne({ _id: req.params.planId, batch: req.params.id });
  if (!plan) {
    res.status(404);
    throw new Error("Credit pack not found.");
  }

  ["label", "credits", "price", "isActive"].forEach((key) => {
    if (req.body[key] !== undefined) plan[key] = req.body[key];
  });
  await plan.save();

  res.status(200).json(plan);
});

//@desc   Remove a credit pack — students who already bought it keep what
//        they were granted, this only stops new purchases
//@route  DELETE /api/batches/:id/ai-credit-plans/:planId
//@access Private (owner, admin)
const deleteCreditPlan = asyncHandler(async (req, res) => {
  const plan = await AiCreditPlan.findOne({ _id: req.params.planId, batch: req.params.id });
  if (!plan) {
    res.status(404);
    throw new Error("Credit pack not found.");
  }
  await plan.deleteOne();
  res.status(200).json({ message: "Removed." });
});

//@desc   General AI credit packs — not tied to any one batch, usable to
//        cover AI use on whichever batch a student happens to be using
//        when their daily allowance runs out
//@route  GET /api/ai/credit-plans
//@access Private (owner, admin)
const getGeneralCreditPlans = asyncHandler(async (req, res) => {
  const plans = await AiCreditPlan.find({ batch: null }).sort({ price: 1 });
  res.status(200).json(plans);
});

//@desc   Create a general credit pack
//@route  POST /api/ai/credit-plans
//@access Private (owner, admin)
const createGeneralCreditPlan = asyncHandler(async (req, res) => {
  const { label, credits, price } = req.body;
  if (!label || !credits || price === undefined) {
    res.status(400);
    throw new Error("A label, credit amount and price are required.");
  }

  const plan = await AiCreditPlan.create({ batch: null, label, credits, price });
  res.status(201).json(plan);
});

//@desc   Edit a general credit pack
//@route  PUT /api/ai/credit-plans/:planId
//@access Private (owner, admin)
const updateGeneralCreditPlan = asyncHandler(async (req, res) => {
  const plan = await AiCreditPlan.findOne({ _id: req.params.planId, batch: null });
  if (!plan) {
    res.status(404);
    throw new Error("Credit pack not found.");
  }

  ["label", "credits", "price", "isActive"].forEach((key) => {
    if (req.body[key] !== undefined) plan[key] = req.body[key];
  });
  await plan.save();

  res.status(200).json(plan);
});

//@desc   Remove a general credit pack
//@route  DELETE /api/ai/credit-plans/:planId
//@access Private (owner, admin)
const deleteGeneralCreditPlan = asyncHandler(async (req, res) => {
  const plan = await AiCreditPlan.findOne({ _id: req.params.planId, batch: null });
  if (!plan) {
    res.status(404);
    throw new Error("Credit pack not found.");
  }
  await plan.deleteOne();
  res.status(200).json({ message: "Removed." });
});

module.exports = {
  getCreditPlans, createCreditPlan, updateCreditPlan, deleteCreditPlan,
  getGeneralCreditPlans, createGeneralCreditPlan, updateGeneralCreditPlan, deleteGeneralCreditPlan,
};
