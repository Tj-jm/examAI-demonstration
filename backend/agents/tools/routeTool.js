// Makes a copilot tool from an admin handler: the roles its route allows,
// what it acts on (load), and the fields it changes, shown to staff as
// "before → after" before it runs. Used by the area files (students.js,
// ...).
//
// spec: { label, drawer, risk, roles, schema, batchesOf?,
//         load(a, ctx) → { id, name, before, link? },
//         after(a, loaded) → { field: value }, labels: { field: "Label" },
//         apply(a, ctx, loaded), summary(a, loaded) }

const show = (v) => (v === undefined || v === null || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

const routeTool = (spec) => ({
  label: spec.label,
  risk: spec.risk,
  drawer: spec.drawer,
  schema: spec.schema,
  internal: ["_changes", "_targetId"],
  batchesOf: spec.batchesOf,
  async prepare(a, ctx) {
    const loaded = await spec.load(a, ctx);
    const next = spec.after(a, loaded);
    const changes = Object.entries(next)
      .filter(([k, v]) => show(loaded.before[k]) !== show(v))
      .map(([k, v]) => ({ label: spec.labels[k] || k, from: show(loaded.before[k]), to: show(v) }));
    return { ...a, _targetId: String(loaded.id), _changes: changes };
  },
  describe: (a) => (a._changes?.length ? a._changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("; ") : spec.label),
  changesOf: (a) => a._changes || [],
  async run(a, ctx) {
    if (spec.roles && !spec.roles.includes(ctx.user.role)) {
      throw Object.assign(new Error(`Only ${spec.roles.join(" or ")} can do this.`), { statusCode: 403 });
    }
    const loaded = await spec.load(a, ctx);
    if (a._targetId && !/^step:\d+$/.test(a._targetId) && String(loaded.id) !== a._targetId) throw new Error("What this step acts on changed since it was planned. Ask again.");
    await spec.apply(a, ctx, loaded);
    return { summary: spec.summary(a, loaded), link: loaded.link || null };
  },
});

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Exactly one record matching what staff wrote: exact fields first, then
// the name in full, then part of it. `what` names the thing in errors.
const findOne = async (Model, ref, { exact = [], nameField = "name", base = {}, select, what = "record", label = (d) => d[nameField] }) => {
  const q = String(ref).trim();
  const ors = exact.map(([f, fn]) => ({ [f]: fn ? fn(q) : q }));
  let found = ors.length ? await Model.find({ ...base, $or: ors }).select(select).limit(2).lean() : [];
  if (!found.length) found = await Model.find({ ...base, [nameField]: new RegExp(`^${esc(q)}$`, "i") }).select(select).limit(5).lean();
  if (!found.length) found = await Model.find({ ...base, [nameField]: new RegExp(esc(q), "i") }).select(select).limit(5).lean();
  if (!found.length) throw new Error(`No ${what} matches "${q}".`);
  if (found.length > 1) throw new Error(`"${q}" matches several: ${found.map(label).join(", ")}. Be more exact.`);
  return found[0];
};

module.exports = { routeTool, findOne, show };
