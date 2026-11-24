import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { App } from "@capacitor/app";
import { Share } from "@capacitor/share";
import { isNative } from "./session";
import { initNativeCamera } from "./nativeCamera";
import { refreshAll } from "./refresh";

// Runs once before the first render, in the mobile app only. The web build
// calls it too and returns at once.
export function initNativeShell() {
  if (!isNative) return;
  const root = document.documentElement;
  root.classList.add("native", `platform-${Capacitor.getPlatform()}`);

  // Edge to edge: the page draws under the status bar and home indicator,
  // and the env(safe-area-inset-*) values keep content clear of them
  // (NativeFeel.jsx). Set here, not in index.html, so the website is unchanged.
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute("content", "width=device-width, initial-scale=1.0, viewport-fit=cover");

  // The keyboard covers the lower half of the screen; keep the field being
  // typed in visible above it.
  Keyboard.addListener("keyboardDidShow", () => {
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }).catch(() => {});

  // Back from the background after a while: show what changed meanwhile.
  let leftAt = 0;
  App.addListener("pause", () => { leftAt = Date.now(); }).catch(() => {});
  App.addListener("resume", () => {
    if (leftAt && Date.now() - leftAt > 30000) refreshAll().catch(() => {});
  }).catch(() => {});

  initNativeCamera();

  // The webview has no Web Share; the phone's own share sheet stands in.
  if (!navigator.share) {
    navigator.share = ({ title, text, url } = {}) => Share.share({ title, text, url, dialogTitle: title });
  }

  // NativeFeel hides the splash screen once the app has drawn. This is the
  // fallback if it never gets that far.
  setTimeout(() => SplashScreen.hide().catch(() => {}), 6000);
}
