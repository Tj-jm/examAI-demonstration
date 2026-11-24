import { useEffect } from "react";

// A drawing surface on iPad/iPhone: a finger or palm held on it would
// otherwise start Safari's text selection, its Copy / Share menu or the
// magnifier, and a long press would open the image menu. CSS covers most of
// it (NO_TOUCH_SELECT); Safari also needs the touch itself cancelled, which
// only a non-passive listener can do. Pointer events still arrive, so
// drawing is unaffected.
export const NO_TOUCH_SELECT = {
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
  WebkitTapHighlightColor: "transparent",
};

// `active` re-attaches when the surface appears (a dialog opening, an
// image loading). `menusOnly` is for the area around a drawing surface,
// where buttons must still get their taps: it stops the long-press menu,
// text selection and image dragging, but not the touches themselves.
export default function useNoTouchSelect(ref, active = true, { menusOnly = false } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return undefined;
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };
    const opts = { passive: false };
    const events = menusOnly
      ? ["contextmenu", "selectstart", "dragstart"]
      : ["touchstart", "touchmove", "contextmenu", "selectstart", "dragstart", "gesturestart"];
    for (const name of events) el.addEventListener(name, stop, opts);
    return () => { for (const name of events) el.removeEventListener(name, stop, opts); };
  }, [ref, active, menusOnly]);
}
