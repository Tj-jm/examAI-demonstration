import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

// Capacitor's single-Activity Android shell finishes (closes) the app on
// hardware back press unless something calls preventDefault via a listener
// — there's no automatic "go back in the webview" fallback. BrowserRouter
// pushes real history entries, so history.back() already does the right
// thing for in-app navigation; only exit once there's nothing left to go
// back to. No-op on web (isNativePlatform() is false there).
//
// An open dialog, menu, sheet or drawer closes first, as on any Android
// app: it gets an Escape key, which every MUI modal with an onClose obeys.
const topModal = () => {
  const open = [...document.querySelectorAll(".MuiModal-root")].filter((el) => !el.classList.contains("MuiModal-hidden"));
  return open[open.length - 1] || null;
};

export function initNativeBackButton() {
  if (!Capacitor.isNativePlatform()) return;

  App.addListener("backButton", ({ canGoBack }) => {
    const modal = topModal();
    if (modal) {
      modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      return;
    }
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });
}
