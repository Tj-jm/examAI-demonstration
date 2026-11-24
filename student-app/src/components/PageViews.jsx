import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPage } from "../utils/visits";

// Reports each page opened for the admin Visitors page (utils/visits.js),
// unless the institution switched it off.
export default function PageViews({ enabled }) {
  const { pathname } = useLocation();
  useEffect(() => {
    if (enabled) trackPage(pathname);
  }, [enabled, pathname]);
  return null;
}
