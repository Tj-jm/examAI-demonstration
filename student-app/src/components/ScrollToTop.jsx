import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// React Router keeps the scroll position on every navigation (it's an SPA,
// not a full page load) — this forces every route change back to the top,
// so a click deep in a scrolled list doesn't land the next page mid-scroll.
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
