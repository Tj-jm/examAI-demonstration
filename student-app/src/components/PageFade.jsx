import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { isNative } from "../native/session";

// A fade-and-rise on every page change. Done with the Web Animations API on
// a wrapper, not a remount, so pages keep their state. A page whose code
// is still loading shows its loader first; the fade then waits for the real
// page to appear (the wrapper's content changing) instead of playing on the
// loader and being over before the page arrives.
const FRAMES = [
  { opacity: 0, transform: "translateY(12px)" },
  { opacity: 1, transform: "none" },
];
// In the mobile app pages slide instead: in from the right going forward,
// from the left going back, like a native stack.
const slide = (back) => [
  { opacity: 0.4, transform: `translateX(${back ? -28 : 28}px)` },
  { opacity: 1, transform: "none" },
];

export default function PageFade({ children }) {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const ref = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (!el?.animate) return undefined;

    const frames = isNative ? slide(navType === "POP") : FRAMES;
    const play = () => el.animate(frames, { duration: isNative ? 240 : 300, easing: "cubic-bezier(.2,.7,.3,1)" });
    let animation = play();
    // The page's own content arriving (a loader swapped for the page once
    // its code is in) restarts the fade, within the first moment after
    // navigating.
    // React hides a page that's waiting for its code (style="display:
    // none") and shows it again when ready, so both the wrapper's children
    // changing and one of them being un-hidden count — nothing deeper.
    const observer = new MutationObserver((mutations) => {
      const arrived = mutations.some((m) =>
        m.type === "childList" ? m.target === el : m.target.parentNode === el && m.target.style?.display !== "none");
      if (!arrived) return;
      animation?.cancel();
      animation = play();
    });
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    const stop = setTimeout(() => observer.disconnect(), 2500);
    return () => {
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [pathname]);

  return <div ref={ref}>{children}</div>;
}
