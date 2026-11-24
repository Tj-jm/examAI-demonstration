import { useGetPublicSettingsQuery } from "./api/contentApi";

// The institution's words for its parts (backend utils/institution.js): a
// school's "class", a university's "course", a bootcamp's "cohort". In code
// and in the API it's always a batch; only what staff read changes.
const DEFAULT_TERMS = { batch: "batch", batches: "batches", program: "program", programs: "programs", teacher: "teacher", teachers: "teachers", org: "coaching centre" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const withCaps = (t) => ({
  ...t,
  Batch: cap(t.batch), Batches: cap(t.batches), Program: cap(t.program), Programs: cap(t.programs),
  Teacher: cap(t.teacher), Teachers: cap(t.teachers), Org: cap(t.org),
});

export const useTerms = () => {
  const { data } = useGetPublicSettingsQuery();
  return withCaps(data?.institution?.terms || DEFAULT_TERMS);
};

// Whether this institution sells access (plans, prices, checkout).
export const useSales = () => useGetPublicSettingsQuery().data?.institution?.sales !== false;

// The same presets as the backend's utils/institution.js, for the
// Settings → Institution placeholders.
export const PRESETS = {
  coaching: { label: "Coaching centre", batch: "batch", batches: "batches", program: "program", programs: "programs", teacher: "teacher", teachers: "teachers", org: "coaching centre" },
  school: { label: "School", batch: "class", batches: "classes", program: "grade", programs: "grades", teacher: "teacher", teachers: "teachers", org: "school" },
  college: { label: "College", batch: "course", batches: "courses", program: "department", programs: "departments", teacher: "teacher", teachers: "teachers", org: "college" },
  university: { label: "University", batch: "course", batches: "courses", program: "department", programs: "departments", teacher: "instructor", teachers: "instructors", org: "university" },
  bootcamp: { label: "Bootcamp", batch: "cohort", batches: "cohorts", program: "track", programs: "tracks", teacher: "instructor", teachers: "instructors", org: "bootcamp" },
};
