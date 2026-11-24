// A base-URL env var (CLIENT_URL_STUDENT, SERVER_URL, …) gets pasted in by
// whoever deploys the app, and nothing stops them from including a trailing
// slash — copying it straight out of a browser address bar does exactly
// that. Every call site in this codebase builds links as `${base}/path`,
// so a trailing slash on the env var silently became a double slash in the
// link (https://example.com//r/abc123) instead of erroring anywhere. Browsers
// and most servers tolerate that, but it looks broken and isn't guaranteed
// to everywhere (an exact-match webhook allowlist, a strict router). Reading
// through this instead of `process.env.X` directly fixes it regardless of
// how the value was entered, rather than only for whichever one env var
// someone happened to report.
const envBaseUrl = (name, fallback = "") => String(process.env[name] || fallback).replace(/\/+$/, "");

module.exports = { envBaseUrl };
