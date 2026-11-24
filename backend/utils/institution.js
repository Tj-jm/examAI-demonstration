// What kind of institution this install serves, and the words the apps use
// for its parts. A coaching centre has batches inside programs; a school has
// classes inside grades; a university has courses inside departments.
// Only the words change: a "class" is still a batch everywhere in the code.

const PRESETS = {
  coaching: { batch: "batch", batches: "batches", program: "program", programs: "programs", teacher: "teacher", teachers: "teachers", org: "coaching centre" },
  school: { batch: "class", batches: "classes", program: "grade", programs: "grades", teacher: "teacher", teachers: "teachers", org: "school" },
  college: { batch: "course", batches: "courses", program: "department", programs: "departments", teacher: "teacher", teachers: "teachers", org: "college" },
  university: { batch: "course", batches: "courses", program: "department", programs: "departments", teacher: "instructor", teachers: "instructors", org: "university" },
  bootcamp: { batch: "cohort", batches: "cohorts", program: "track", programs: "tracks", teacher: "instructor", teachers: "instructors", org: "bootcamp" },
};
const TYPES = Object.keys(PRESETS);
const WORDS = Object.keys(PRESETS.coaching);

// The preset for the type, with the admin's own words on top.
const resolveTerms = (institution = {}) => {
  const base = PRESETS[institution.type] || PRESETS.coaching;
  const own = institution.labels || {};
  return Object.fromEntries(WORDS.map((w) => {
    const v = String(own[w] || "").trim();
    return [w, v ? v.slice(0, 40) : base[w]];
  }));
};

// Shaped for the client: the institution's type, whether it sells, and its words.
const publicInstitution = (settings) => {
  const inst = settings?.institution?.toObject?.() || settings?.institution || {};
  return { type: TYPES.includes(inst.type) ? inst.type : "coaching", sales: inst.sales !== false, studentIdLogin: inst.studentIdLogin === true, terms: resolveTerms(inst) };
};

module.exports = { PRESETS, TYPES, WORDS, resolveTerms, publicInstitution };
