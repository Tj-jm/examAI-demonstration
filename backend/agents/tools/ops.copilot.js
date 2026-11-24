const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");
const { routeTool, findOne } = require("./routeTool");

// Copilot tools for the Lectures, Batches and Payroll drawers.

const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "an ISO date");
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const pickDefined = (a, keys) => Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
const admins = ["owner", "admin"];

const findLecture = (ref) => findOne(require("../../models/lectureModel"), ref, {
  nameField: "title", select: "title description isPublished batches", what: "lecture", label: (l) => l.title,
});
const findStaff = (ref) => findOne(require("../../models/userModel"), ref, {
  exact: [["identifier", (q) => q.toLowerCase()], ["email", (q) => q.toLowerCase()]],
  base: { isDeleted: { $ne: true } }, select: "name identifier role", what: "team member", label: (u) => `${u.name} (${u.role})`,
});
const lectureCtl = () => require("../../controllers/admin/lectureController");
const batchCtl = () => require("../../controllers/admin/batchController");
const payCtl = () => require("../../controllers/admin/payslipController");

const tools = {
  // ---------------------------------------------------------------- Lectures
  publish_lectures: routeTool({
    label: "Publish or hide lectures",
    drawer: "lectures",
    risk: "publish",
    // lectures: their titles as the staff member wrote them.
    schema: z.object({ lectures: z.array(z.string().min(2).max(200)).min(1).max(30), isPublished: z.boolean() }),
    async load(a, ctx) {
      const list = [];
      for (const t of a.lectures) list.push(await findLecture(t));
      await ctx.assertBatches([...new Set(list.flatMap((l) => (l.batches || []).map(String)))]);
      return { list, id: list.map((l) => l._id).join(","), name: `${list.length} lectures`, link: "/lectures", before: Object.fromEntries(list.map((l) => [l.title, Boolean(l.isPublished)])) };
    },
    after: (a, { list }) => Object.fromEntries(list.map((l) => [l.title, a.isPublished])),
    labels: {},
    apply: (a, ctx, { list }) => call(lectureCtl().setPublished, { user: ctx.user, body: { ids: list.map((l) => String(l._id)), isPublished: a.isPublished } }),
    summary: (a, { list }) => `${list.length} lecture${list.length === 1 ? "" : "s"} ${a.isPublished ? "published" : "hidden"}.`,
  }),

  lecture_details: routeTool({
    label: "Change a lecture's title or description",
    drawer: "lectures",
    risk: "publish",
    schema: z.object({ lecture: z.string().min(2).max(200), title: z.string().min(1).max(200).optional(), description: z.string().max(4000).optional() }),
    async load(a, ctx) {
      const l = await findLecture(a.lecture);
      await ctx.assertBatches((l.batches || []).map(String));
      return { lecture: l, id: l._id, name: l.title, link: `/lectures/${l._id}`, before: { title: l.title, description: l.description || "" } };
    },
    after: (a) => pickDefined(a, ["title", "description"]),
    labels: { title: "Title", description: "Description" },
    apply: (a, ctx, { lecture }) => call(lectureCtl().updateLecture, { user: ctx.user, params: { id: String(lecture._id) }, body: pickDefined(a, ["title", "description"]) }),
    summary: (a, { lecture }) => `“${a.title || lecture.title}” is updated.`,
  }),

  // ----------------------------------------------------------------- Batches
  batch_settings: routeTool({
    label: "Change a batch's settings",
    drawer: "batches",
    risk: "publish",
    roles: admins,
    schema: z.object({
      batchId: id, name: z.string().min(1).max(120).optional(), isActive: z.boolean().optional(),
      accessType: z.enum(["free", "paid"]).optional(), trialDays: z.number().int().min(0).max(365).optional(),
    }),
    batchesOf: (a) => [a.batchId],
    async load(a, ctx) {
      await ctx.assertBatches([a.batchId]);
      const b = await require("../../models/batchModel").findById(a.batchId).select("name isActive accessType trialDays").lean();
      if (!b) throw new Error("That batch no longer exists.");
      return { batch: b, id: b._id, name: b.name, link: `/batches/${b._id}`, before: { name: b.name, isActive: b.isActive !== false, accessType: b.accessType, trialDays: b.trialDays || 0 } };
    },
    after: (a) => pickDefined(a, ["name", "isActive", "accessType", "trialDays"]),
    labels: { name: "Name", isActive: "Open to students", accessType: "Access", trialDays: "Free trial days" },
    apply: (a, ctx) => call(batchCtl().updateBatch, { user: ctx.user, params: { id: a.batchId }, body: pickDefined(a, ["name", "isActive", "accessType", "trialDays"]) }),
    summary: (a, { batch }) => `${a.name || batch.name} is updated.`,
  }),

  batch_plan: routeTool({
    label: "Add or change a batch's price plan",
    drawer: "batches",
    risk: "publish",
    roles: admins,
    // plan: the plan's label; a label the batch doesn't have adds a new plan.
    // lifetime true: never expires (durationDays ignored).
    schema: z.object({
      batchId: id, plan: z.string().min(1).max(80), price: z.number().min(0).optional(), durationDays: z.number().int().min(1).max(3650).optional(),
      lifetime: z.boolean().optional(), isActive: z.boolean().optional(),
    }),
    batchesOf: (a) => [a.batchId],
    async load(a, ctx) {
      await ctx.assertBatches([a.batchId]);
      const b = await require("../../models/batchModel").findById(a.batchId).select("name plans").lean();
      if (!b) throw new Error("That batch no longer exists.");
      const p = (b.plans || []).find((x) => x.label.toLowerCase() === a.plan.trim().toLowerCase());
      const length = (x) => (x.isInfinite ? "Lifetime" : x.durationDays ? `${x.durationDays} days` : "—");
      return { batch: b, planDoc: p, id: p?._id || `new:${b._id}`, name: b.name, link: `/batches/${b._id}`, before: p ? { price: p.price, length: length(p), isActive: p.isActive !== false } : { price: "—", length: "—", isActive: "New plan" } };
    },
    after(a, { planDoc: p }) {
      const out = {};
      if (a.price !== undefined || !p) out.price = a.price ?? 0;
      if (a.lifetime) out.length = "Lifetime";
      else if (a.durationDays !== undefined) out.length = `${a.durationDays} days`;
      if (a.isActive !== undefined || !p) out.isActive = a.isActive ?? true;
      return out;
    },
    labels: { price: "Price", length: "Length", isActive: "On sale" },
    apply(a, ctx, { planDoc: p }) {
      const body = { label: p ? p.label : a.plan.trim(), ...pickDefined(a, ["price", "durationDays", "isActive"]) };
      if (a.lifetime !== undefined) body.isInfinite = a.lifetime;
      if (p) return call(batchCtl().updatePlan, { user: ctx.user, params: { id: a.batchId, planId: String(p._id) }, body });
      if (!a.lifetime && !a.durationDays) throw new Error("A new plan needs a length in days, or lifetime.");
      return call(batchCtl().addPlan, { user: ctx.user, params: { id: a.batchId }, body: { price: 0, ...body } });
    },
    summary: (a, { batch, planDoc }) => `${planDoc ? "Changed" : "Added"} plan “${a.plan}” on ${batch.name}.`,
  }),

  // ----------------------------------------------------------------- Payroll
  make_payslip: routeTool({
    label: "Make a payslip from a person's work",
    drawer: "payroll",
    risk: "publish",
    roles: admins,
    // person: name, login or email. from/to: the period. issue true: sent to them now; else a draft.
    schema: z.object({ person: z.string().min(2).max(120), from: isoDate, to: isoDate, issue: z.boolean().optional() }),
    async load(a) {
      const u = await findStaff(a.person);
      const out = await require("../../utils/teamPay").suggestLines(String(u._id), { from: a.from, to: a.to });
      const total = Math.round((out?.lines || []).reduce((n, l) => n + (Number(l.amount) || 0), 0) * 100) / 100;
      return { person: u, lines: out?.lines || [], currency: out?.currency, total, id: u._id, name: u.name, link: "/payslips", before: { payslip: "—" } };
    },
    after: (a, { lines, total, currency }) => ({ payslip: `${total} ${currency || ""} · ${lines.length} line${lines.length === 1 ? "" : "s"} · ${day(a.from)} to ${day(a.to)}${a.issue ? " · issued" : " · draft"}` }),
    labels: { payslip: "Payslip" },
    apply(a, ctx, { person, lines, currency }) {
      if (!lines.length) throw new Error(`${person.name} has no paid work in that period.`);
      return call(payCtl().createPayslip, { user: ctx.user, body: { user: String(person._id), currency, lines, from: a.from, to: a.to, issue: Boolean(a.issue) } });
    },
    summary: (a, { person, total, currency }) => `Payslip for ${person.name}: ${total} ${currency || ""}${a.issue ? ", issued" : ", draft"}.`,
  }),

  pay_payslip: routeTool({
    label: "Mark a person's payslip paid",
    drawer: "payroll",
    risk: "publish",
    roles: admins,
    // Their latest payslip not yet paid. method: how it was paid (bKash, bank...).
    schema: z.object({ person: z.string().min(2).max(120), method: z.string().min(2).max(60), reference: z.string().max(120).optional() }),
    async load(a) {
      const u = await findStaff(a.person);
      const slip = await require("../../models/payslipModel").findOne({ user: u._id, status: { $in: ["draft", "issued", "disputed"] } }).sort({ createdAt: -1 }).select("total currency status periodFrom periodTo").lean();
      if (!slip) throw new Error(`${u.name} has no unpaid payslip.`);
      return { person: u, slip, id: slip._id, name: u.name, link: "/payslips", before: { status: slip.status, amount: `${slip.total} ${slip.currency || ""}` } };
    },
    after: (a, { slip }) => ({ status: "paid", amount: `${slip.total} ${slip.currency || ""} by ${a.method}` }),
    labels: { status: "Status", amount: "Amount" },
    apply: (a, ctx, { slip }) => call(payCtl().payPayslip, { user: ctx.user, params: { id: String(slip._id) }, body: { method: a.method, reference: a.reference || "" } }),
    summary: (a, { person, slip }) => `${person.name}'s payslip (${slip.total} ${slip.currency || ""}) is paid.`,
  }),
};

module.exports = { tools };

// Lectures or exams added to, or taken out of, batches: the same handler as
// a batch's "Add content" (controllers/admin/assignmentController.js).
tools.assign_to_batches = routeTool({
  label: "Add lectures or exams to batches, or take them out",
  drawer: "lectures",
  risk: "publish",
  // items: titles as the staff member wrote them. remove true: take them out.
  schema: z.object({ kind: z.enum(["lectures", "exams"]), items: z.array(z.string().min(2).max(200)).min(1).max(30), batchIds: z.array(id).min(1).max(20), remove: z.boolean().optional() }),
  batchesOf: (a) => a.batchIds,
  async load(a, ctx) {
    await ctx.assertBatches(a.batchIds);
    const Model = require(a.kind === "lectures" ? "../../models/lectureModel" : "../../models/examModel");
    const list = [];
    for (const t of a.items) list.push(await findOne(Model, t, { nameField: "title", select: "title batches", what: a.kind === "lectures" ? "lecture" : "exam", label: (x) => x.title }));
    const names = (ids) => ids.map((b) => ctx.batchName(b)).sort().join(", ") || "No batch";
    return { list, names, id: list.map((x) => x._id).join(","), name: `${list.length} ${a.kind}`, link: a.kind === "lectures" ? "/lectures" : "/exams", before: Object.fromEntries(list.map((x) => [x.title, names((x.batches || []).map(String))])) };
  },
  after(a, { list, names }) {
    return Object.fromEntries(list.map((x) => {
      const now = new Set((x.batches || []).map(String));
      for (const b of a.batchIds) (a.remove ? now.delete(b) : now.add(b));
      return [x.title, names([...now])];
    }));
  },
  labels: {},
  async apply(a, ctx, { list }) {
    const { assignToBatch, unassignFromBatch } = require("../../controllers/admin/assignmentController");
    const ids = list.map((x) => String(x._id));
    for (const b of a.batchIds) await call(a.remove ? unassignFromBatch : assignToBatch, { user: ctx.user, params: { id: b, kind: a.kind }, body: { ids } });
  },
  summary: (a, { list }) => `${list.length} ${a.kind} ${a.remove ? "taken out of" : "added to"} ${a.batchIds.length} batch${a.batchIds.length === 1 ? "" : "es"}.`,
});
