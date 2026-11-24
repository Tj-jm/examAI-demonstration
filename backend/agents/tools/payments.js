const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");
const { routeTool, findOne } = require("./routeTool");
const { findStudent } = require("./students");

// Copilot tools for the Payments drawer: recording a payment taken by hand,
// and coupons. Money always waits for a person (risk "publish").

const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "an ISO date");
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const findCoupon = (ref) => findOne(require("../../models/couponModel"), ref, {
  exact: [["code", (q) => q.toUpperCase()]], nameField: "code",
  select: "code discountType discountValue maxRedemptions expiresAt isActive", what: "coupon", label: (c) => c.code,
});
const off = (type, value) => (value === undefined || value === null ? null : type === "percent" ? `${value}%` : `${value} off`);

const tools = {
  record_payment: routeTool({
    label: "Record a payment taken by hand",
    drawer: "payments",
    risk: "publish",
    roles: ["owner", "admin"],
    // planLabel: one of the batch's plans, as named on it. method: how it was paid (cash, bkash...).
    schema: z.object({
      student: z.string().min(2).max(120), batchId: id, planLabel: z.string().min(1).max(80),
      method: z.string().max(40).optional(), transactionId: z.string().max(80).optional(), note: z.string().max(200).optional(),
    }),
    batchesOf: (a) => [a.batchId],
    async load(a, ctx) {
      await ctx.assertBatches([a.batchId]);
      const Batch = require("../../models/batchModel");
      const student = await findStudent(a.student);
      const batch = await Batch.findById(a.batchId).select("name plans").lean();
      const plan = (batch?.plans || []).find((p) => p.label.toLowerCase() === a.planLabel.trim().toLowerCase());
      if (!plan) throw new Error(`"${a.planLabel}" isn't a plan on ${batch?.name || "that batch"}. Plans: ${(batch?.plans || []).map((p) => p.label).join(", ") || "none"}.`);
      return { student, batch, plan, id: student._id, name: student.name, link: `/students/${student._id}`, before: { payment: "—" } };
    },
    after: (a, { plan, batch }) => ({ payment: `${plan.label} · ${plan.price} · ${batch.name}${a.method ? ` · ${a.method}` : ""}` }),
    labels: { payment: "Payment" },
    apply: (a, ctx, { student, plan }) => call(require("../../controllers/admin/studentController").recordPurchase, {
      user: ctx.user, params: { id: String(student._id) },
      body: { batchId: a.batchId, planLabel: plan.label, method: a.method, transactionId: a.transactionId, note: a.note },
    }),
    summary: (a, { student, plan }) => `Recorded ${plan.label} (${plan.price}) for ${student.name}.`,
  }),

  create_coupon: routeTool({
    label: "Make a coupon",
    drawer: "payments",
    risk: "publish",
    roles: ["owner", "admin"],
    // batchIds empty: every batch. products: what it applies to.
    schema: z.object({
      code: z.string().min(3).max(40), discountType: z.enum(["percent", "fixed"]), discountValue: z.number().positive(),
      batchIds: z.array(id).optional(), maxRedemptions: z.number().int().positive().optional(), expiresAt: isoDate.optional(),
      limitOnePerStudent: z.boolean().optional(),
    }),
    batchesOf: (a) => a.batchIds || [],
    async load(a, ctx) {
      if (a.batchIds?.length) await ctx.assertBatches(a.batchIds);
      const Coupon = require("../../models/couponModel");
      if (await Coupon.exists({ code: a.code.toUpperCase() })) throw new Error(`A coupon called ${a.code.toUpperCase()} already exists.`);
      return { id: "new", name: a.code.toUpperCase(), link: "/coupons", before: {} };
    },
    after: (a, ctx) => ({ code: a.code.toUpperCase(), discount: off(a.discountType, a.discountValue), uses: a.maxRedemptions || "Unlimited", expires: day(a.expiresAt) || "Never", batches: a.batchIds?.length ? a.batchIds.length : "All" }),
    labels: { code: "Code", discount: "Discount", uses: "Uses", expires: "Expires", batches: "Batches" },
    apply: (a, ctx) => call(require("../../controllers/admin/couponController").createCoupon, {
      user: ctx.user,
      body: { code: a.code.toUpperCase(), discountType: a.discountType, discountValue: a.discountValue, batches: a.batchIds || [], maxRedemptions: a.maxRedemptions, expiresAt: a.expiresAt, limitOnePerStudent: a.limitOnePerStudent, isActive: true },
    }),
    summary: (a) => `Coupon ${a.code.toUpperCase()} is live.`,
  }),

  coupon_settings: routeTool({
    label: "Change a coupon",
    drawer: "payments",
    risk: "publish",
    roles: ["owner", "admin"],
    schema: z.object({
      coupon: z.string().min(2).max(40), isActive: z.boolean().optional(), discountType: z.enum(["percent", "fixed"]).optional(),
      discountValue: z.number().positive().optional(), maxRedemptions: z.number().int().positive().optional(), expiresAt: isoDate.optional(),
    }),
    async load(a) {
      const c = await findCoupon(a.coupon);
      return { coupon: c, id: c._id, name: c.code, link: "/coupons", before: { isActive: c.isActive !== false, discount: off(c.discountType, c.discountValue), maxRedemptions: c.maxRedemptions || "Unlimited", expiresAt: day(c.expiresAt) || "Never" } };
    },
    after(a, { coupon: c }) {
      const out = {};
      if (a.isActive !== undefined) out.isActive = a.isActive;
      if (a.discountType !== undefined || a.discountValue !== undefined) out.discount = off(a.discountType || c.discountType, a.discountValue ?? c.discountValue);
      if (a.maxRedemptions !== undefined) out.maxRedemptions = a.maxRedemptions;
      if (a.expiresAt !== undefined) out.expiresAt = day(a.expiresAt);
      return out;
    },
    labels: { isActive: "On", discount: "Discount", maxRedemptions: "Uses", expiresAt: "Expires" },
    apply(a, ctx, { coupon }) {
      const body = Object.fromEntries(["isActive", "discountType", "discountValue", "maxRedemptions", "expiresAt"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      return call(require("../../controllers/admin/couponController").updateCoupon, { user: ctx.user, params: { id: String(coupon._id) }, body });
    },
    summary: (a, { coupon }) => `Coupon ${coupon.code} is updated.`,
  }),
};

module.exports = { tools };
