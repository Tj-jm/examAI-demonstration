// Where to go after logging in: the page that sent the visitor to log in
// (?next=/purchases/x), kept for this tab so it survives
// a hop from Log in to Sign up or Forgot password. Only paths on this
// site: never another address.
const KEY = "examai_next";
const safe = (p) => typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") && !/^\/(login|register|forgot)/.test(p);

export const rememberNext = (search) => {
  try {
    const n = new URLSearchParams(search || "").get("next");
    if (safe(n)) sessionStorage.setItem(KEY, n);
  } catch { /* storage off */ }
};

export const peekNext = () => {
  try { const n = sessionStorage.getItem(KEY); return safe(n) ? n : "/"; } catch { return "/"; }
};

// Read once: the next login starts fresh.
export const takeNext = () => {
  const n = peekNext();
  try { sessionStorage.removeItem(KEY); } catch { /* storage off */ }
  return n;
};

export const loginTo = (path) => `/login?next=${encodeURIComponent(path)}`;
