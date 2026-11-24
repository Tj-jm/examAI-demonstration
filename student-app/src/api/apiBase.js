// Same-origin by default ("") — the backend serves this build itself in a
// normal web deployment (SERVE_STATIC=true), or a dev proxy stands in for it
// (vite.config.js), so a relative fetch already lands on the right host.
//
// The one case that isn't same-origin: mobile-app/, this build wrapped in a
// Capacitor native shell. That shell's webview runs its own origin (https://
// localhost on Android, capacitor://localhost on iOS) which is never the
// deployed backend's origin, so a relative "/api/..." would hit nothing.
// mobile-app's own build sets VITE_API_BASE_URL to the real backend origin;
// nothing else ever needs to.
export const API_ROOT = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
