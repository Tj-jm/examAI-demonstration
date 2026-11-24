import { API_ROOT } from "../api/apiBase";
import { isNative } from "../native/session";

// The address to send people to: this site on the web; the real server in
// the app, whose own origin (https://localhost) means nothing to anyone else.
export const siteLink = () => (isNative ? API_ROOT : window.location.origin) || window.location.origin;

export const copyText = async (value) => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Older browsers and plain http: the textarea route.
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
};

// The share sheet where there is one (phones, the app, some desktops);
// otherwise the text is copied. Resolves "shared", "cancelled", "copied" or
// "failed", so the caller can say what happened.
export const shareOrCopy = async ({ title, text, url }) => {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError" || /cancel/i.test(e?.message || "")) return "cancelled";
      // Not allowed here (desktop, an iframe): fall back to copying.
    }
  }
  return (await copyText([text, url].filter(Boolean).join(" "))) ? "copied" : "failed";
};
