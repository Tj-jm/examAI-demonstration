const { z } = require("zod");
const mongoose = require("mongoose");
const { call } = require("../invoke");
const { routeTool, findOne } = require("./routeTool");

// Copilot tools for the Students drawer. Each is made by routeTool(): the
// admin handler a click would use, the roles its route allows, and the
// fields it changes, shown to staff as "before → after" before it runs.

const id = z.string().refine((v) => mongoose.isValidObjectId(v), "not a valid id");
// A student by name, email, phone or student ID, as the staff member wrote it.
const studentRef = z.string().min(2).max(120);

const handlers = () => require("../../controllers/admin/studentController");

// Exactly one student, by student ID, email, phone or name.
const findStudent = (ref) => findOne(require("../../models/studentModel"), ref, {
  exact: [["studentId", (q) => q.toUpperCase()], ["email", (q) => q.toLowerCase()], ["phoneNumber"]],
  base: { deletedAt: null }, select: "name email phoneNumber studentId isActive", what: "student",
  label: (s) => s.studentId || s.email || s.phoneNumber || s.name,
});

// The Students drawer's tools: each gives routeTool the student it acts on.
const studentTool = (spec) => routeTool({
  ...spec,
  drawer: "students",
  async load(a, ctx) {
    const loaded = await spec.load(a, ctx);
    return { ...loaded, id: loaded.student._id, name: loaded.student.name, link: `/students/${loaded.student._id}` };
  },
});

const accessUntil = async (studentId, batchId) => {
  const Purchase = require("../../models/purchaseModel");
  const { resolveExpiry, FOREVER } = require("../../utils/accessWindow");
  const list = await Purchase.find({ student: studentId, batch: batchId, status: "complete" }).select("plan startDate endedAt").sort({ startDate: 1 }).lean();
  const end = resolveExpiry(list);
  if (!end || end < new Date()) return null;
  return FOREVER && end.getTime() === new Date(FOREVER).getTime() ? "Lifetime" : end;
};
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || "No access");

const tools = {
  grant_access: studentTool({
    label: "Give a student access to a batch",
    risk: "staff",
    roles: ["owner", "admin"],
    // days left out: lifetime access.
    schema: z.object({ student: studentRef, batchId: id, days: z.number().int().min(1).max(3650).optional(), note: z.string().max(200).optional() }),
    batchesOf: (a) => [a.batchId],
    async load(a, ctx) {
      await ctx.assertBatches([a.batchId]);
      const student = await findStudent(a.student);
      return { student, before: { access: day(await accessUntil(student._id, a.batchId)) } };
    },
    after(a, { before }) {
      if (!a.days) return { access: "Lifetime" };
      const from = before.access !== "No access" && before.access !== "Lifetime" ? new Date(before.access) : new Date();
      return { access: day(new Date(from.getTime() + a.days * 86400000)) };
    },
    labels: { access: "Access until" },
    apply: (a, ctx, { student }) => call(handlers().enrolStudent, { user: ctx.user, params: { id: String(student._id) }, body: { batchId: a.batchId, days: a.days ?? null, note: a.note || "Granted by copilot" } }),
    summary: (a, { student }) => `${student.name} has access${a.days ? ` for ${a.days} more days` : " for life"}.`,
  }),

  update_student: studentTool({
    label: "Change a student's details",
    risk: "staff",
    roles: ["owner", "admin"],
    schema: z.object({
      student: studentRef,
      name: z.string().min(1).max(120).optional(),
      email: z.string().email().optional(),
      phoneNumber: z.string().min(6).max(20).optional(),
      studentId: z.string().max(40).optional(),
      isActive: z.boolean().optional(),
    }),
    async load(a) {
      const student = await findStudent(a.student);
      return { student, before: { name: student.name, email: student.email, phoneNumber: student.phoneNumber, studentId: student.studentId, isActive: student.isActive !== false } };
    },
    after: (a, { before }) => Object.fromEntries(Object.keys(before).filter((k) => a[k] !== undefined).map((k) => [k, a[k]])),
    labels: { name: "Name", email: "Email", phoneNumber: "Phone", studentId: "Student ID", isActive: "Can sign in" },
    apply(a, ctx, { student }) {
      const body = Object.fromEntries(["name", "email", "phoneNumber", "studentId", "isActive"].filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));
      return call(handlers().updateStudent, { user: ctx.user, params: { id: String(student._id) }, body });
    },
    summary: (a, { student }) => `${student.name}'s details are updated.`,
  }),

  reset_student_password: studentTool({
    label: "Set a new password for a student",
    risk: "staff",
    roles: ["owner", "admin"],
    schema: z.object({ student: studentRef, password: z.string().min(6).max(100) }),
    async load(a) {
      const student = await findStudent(a.student);
      return { student, before: { password: "current" } };
    },
    after: () => ({ password: "new" }),
    labels: { password: "Password" },
    apply: (a, ctx, { student }) => call(handlers().resetStudentPassword, { user: ctx.user, params: { id: String(student._id) }, body: { password: a.password } }),
    summary: (a, { student }) => `${student.name}'s password is changed.`,
  }),
};

module.exports = { tools, findStudent };
