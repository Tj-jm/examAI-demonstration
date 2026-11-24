import { Capacitor } from "@capacitor/core";

// The session for the mobile app. Its webview runs on its own origin, so the
// API is a third-party site to it and iOS drops the session cookie. The app
// asks for the token instead (X-ExamAI-Client: native), keeps it here and
// sends it as "Authorization: Bearer". On the web none of this runs and the
// httpOnly cookie stays the only session.

export const isNative = Capacitor.isNativePlatform();

const KEY = "examai.session";
let token = null;
try {
  token = isNative ? localStorage.getItem(KEY) : null;
} catch {
  token = null;
}

export const setSessionToken = (value) => {
  token = value || null;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Kept in memory for this run only.
  }
};

export const clearSessionToken = () => setSessionToken(null);

// Headers for a request to the API. Only for the API: a storage link signed
// in its query string rejects a second Authorization.
export const nativeHeaders = () => {
  if (!isNative) return {};
  return { "X-ExamAI-Client": "native", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};
