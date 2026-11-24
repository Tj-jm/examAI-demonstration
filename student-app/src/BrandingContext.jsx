import { createContext, useContext } from "react";

// Site name, logo, and the layout/theme-mode controls a student is actually
// allowed to touch — read wherever chrome needs to say who this install
// belongs to, without every component re-fetching settings itself.
export const BrandingContext = createContext(null);

export const useBranding = () => useContext(BrandingContext);

// The institution's words for its parts (backend utils/institution.js): a
// school's "class", a university's "course", a bootcamp's "cohort". In code
// it's always a batch; only what the student reads changes.
const DEFAULT_TERMS = { batch: "batch", batches: "batches", program: "program", programs: "programs", teacher: "teacher", teachers: "teachers", org: "coaching centre" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const useTerms = () => {
  const t = useContext(BrandingContext)?.terms || DEFAULT_TERMS;
  return {
    ...t,
    Batch: cap(t.batch), Batches: cap(t.batches), Program: cap(t.program), Programs: cap(t.programs),
    Teacher: cap(t.teacher), Teachers: cap(t.teachers), Org: cap(t.org),
  };
};

// Whether this institution sells access. Off: no plans, prices, checkout
// or credit packs; students are added by staff.
export const useSales = () => useContext(BrandingContext)?.sales !== false;

// Settings → Student app → Home screen position. The home screen and the
// main section pages (lectures, a lecture, exams, results, one result,
// plans, practice, learn, archive) follow it;
// detail pages such as one exam or the notices stay centred.
export const useHomeMx = () => (useContext(BrandingContext)?.homeAlign === "center" ? "auto" : 0);
