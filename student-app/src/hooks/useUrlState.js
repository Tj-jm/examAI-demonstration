import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

// A filter kept in the page's URL instead of component state. Going back to
// the page (browser back, or a session's back arrow) brings the filters back;
// arriving fresh (a plain link, "Choose another topic" after a set) starts
// from the defaults. Written with replace, so picking filters adds no
// history entries. The initial value decides the type: string, number or
// a comma-joined string array.
const parse = (raw, initial) => {
  if (raw === null) return initial;
  if (Array.isArray(initial)) return raw ? raw.split(",") : [];
  if (typeof initial === "number") return Number(raw) || initial;
  return raw;
};

const same = (a, b) => (Array.isArray(a) ? Array.isArray(b) && a.join(",") === b.join(",") : a === b);

export default function useUrlState(key, initial) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  // Stable per raw string, so an array value doesn't change identity every render.
  const value = useMemo(() => parse(raw, initial), [raw]); // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          const current = parse(prev.get(key), initial);
          const v = typeof next === "function" ? next(current) : next;
          if (v === "" || v === null || v === undefined || same(v, initial)) out.delete(key);
          else out.set(key, Array.isArray(v) ? v.join(",") : String(v));
          return out;
        },
        { replace: true }
      );
    },
    [key, setParams] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return [value, setValue];
}
