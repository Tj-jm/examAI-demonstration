// Institution type: the words the apps use, and "no sales" mode.
// Database parts need TEST_MONGO_URL (a throwaway database).

process.env.NODE_ENV = "test";
const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const run = (fn, req) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  fn(req, res, (e) => resolve({ code: res.code, err: e?.message, next: !e }));
});

(async () => {
  const { resolveTerms, publicInstitution } = require("../utils/institution");
  console.log("words");
  check("coaching by default", resolveTerms({}).batch === "batch" && resolveTerms({}).org === "coaching centre");
  check("a school has classes in grades", resolveTerms({ type: "school" }).batches === "classes" && resolveTerms({ type: "school" }).program === "grade");
  check("a university has courses, departments, instructors", (() => { const t = resolveTerms({ type: "university" }); return t.batch === "course" && t.programs === "departments" && t.teacher === "instructor"; })());
  check("a bootcamp has cohorts in tracks", resolveTerms({ type: "bootcamp" }).batch === "cohort" && resolveTerms({ type: "bootcamp" }).program === "track");
  check("the admin's own word wins", resolveTerms({ type: "school", labels: { batch: "section", batches: "" } }).batch === "section" && resolveTerms({ type: "school", labels: { batches: "" } }).batches === "classes");
  check("an unknown type reads as coaching", resolveTerms({ type: "nope" }).batch === "batch");
  check("sells unless switched off", publicInstitution({ institution: {} }).sales === true && publicInstitution({ institution: { sales: false } }).sales === false);

  if (!process.env.TEST_MONGO_URL) { console.log("TEST_MONGO_URL not set, database checks skipped."); console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }
  await mongoose.connect(process.env.TEST_MONGO_URL);
  if (/test|inst/i.test(mongoose.connection.name)) await mongoose.connection.db.dropDatabase();
  const AppSettings = require("../models/appSettingsModel");
  const { updateSettings } = require("../controllers/admin/settingsController");
  const { getPublicSettings } = require("../controllers/app/publicController");
  const { salesOpen } = require("../middleware/salesOpen");

  console.log("\nsettings");
  let out = await run(updateSettings, { body: { institution: { type: "university", labels: { teacher: "Professor" }, sales: false } }, user: { role: "owner" } });
  check("saves type, words and sales", out.code === 200, out);
  out = await run(updateSettings, { body: { institution: { type: "spaceport" } }, user: { role: "owner" } });
  check("refuses an unknown type", out.code === 400, out);
  out = await run(getPublicSettings, { query: {} });
  const inst = out.body?.institution;
  check("the student app gets the words", inst?.terms?.batch === "course" && inst?.terms?.teacher === "Professor" && inst?.sales === false, inst);

  console.log("\nno sales");
  out = await run(salesOpen, {});
  check("buying is refused, in the institution's words", out.code === 403 && /university adds you to your courses/.test(out.err || ""), out);
  const s = await AppSettings.get(); s.institution.sales = true; await s.save();
  out = await run(salesOpen, {});
  check("open again once sales are on", out.next === true, out);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
