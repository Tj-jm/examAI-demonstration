import { API_ROOT } from "../api/apiBase";
import { isNative, nativeHeaders } from "../native/session";

// Visitor analytics (backend utils/visitors.js, admin → Visitors). A random
// id kept on this device, a visit id that lasts until 30 minutes without a
// page, and the page path. Where the visitor came from (the link's
// utm_source/c/coupon/ref, the page that linked here) goes with a visit's
// first page only. Nothing else, and never anything typed in.

const VISITOR = "examai.vid";
const SESSION = "examai.sid";
const IDLE = 30 * 60 * 1000;
const PARAMS = ["utm_source", "utm_medium", "utm_campaign", "c", "coupon", "ref", "fbclid", "gclid"];

const newId = () => {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch { /* older browser */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

// The link that opened the app, read once: later pages drop its query.
const entry = (() => {
  try {
    const q = new URLSearchParams(window.location.search);
    const picked = {};
    for (const k of PARAMS) if (q.get(k)) picked[k] = q.get(k).slice(0, 80);
    return { q: picked, r: document.referrer || "" };
  } catch {
    return { q: {}, r: "" };
  }
})();

const visitorId = () => {
  try {
    let id = localStorage.getItem(VISITOR);
    if (!id) {
      id = newId();
      localStorage.setItem(VISITOR, id);
    }
    return id;
  } catch {
    return "";
  }
};

// { id, fresh }: a new visit after 30 minutes away, or a new tab.
let memorySession = null;
const session = () => {
  const now = Date.now();
  let s = null;
  try {
    s = JSON.parse(sessionStorage.getItem(SESSION) || "null");
  } catch {
    s = memorySession;
  }
  const fresh = !s?.id || now - s.at > IDLE;
  const next = { id: fresh ? newId() : s.id, at: now };
  memorySession = next;
  try { sessionStorage.setItem(SESSION, JSON.stringify(next)); } catch { /* kept in memory */ }
  return { id: next.id, fresh };
};

let sentEntry = false;
export const trackPage = (path) => {
  const v = visitorId();
  if (!v) return;
  const s = session();
  const body = { v, s: s.id, p: path, n: s.fresh, app: isNative };
  if (!sentEntry) Object.assign(body, entry);
  sentEntry = true;
  try {
    fetch(`${API_ROOT}/api/app/pv`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...nativeHeaders() },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch { /* never get in the page's way */ }
};
