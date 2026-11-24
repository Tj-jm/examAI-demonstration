import { useEffect } from "react";
import { GlobalStyles, useTheme } from "@mui/material";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { isNative } from "./session";
import OfflineBanner from "./OfflineBanner";

const top = "env(safe-area-inset-top, 0px)";
const bottom = "env(safe-area-inset-bottom, 0px)";

// What makes the mobile app feel like an app rather than a web page: content
// kept clear of the notch and home indicator, a status bar that matches the
// theme, no grey flash on tap, no rubber-band page and no text-selection
// menus outside text fields. Renders nothing on the web.
export default function NativeFeel() {
  const theme = useTheme();
  const mode = theme.palette.mode;

  useEffect(() => {
    if (!isNative) return;
    SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isNative) return;
    // DARK means light icons, for a dark background.
    SystemBars.setStyle({ style: mode === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  }, [mode]);

  if (!isNative) return null;

  return (
    <>
    <OfflineBanner />
    <GlobalStyles
      styles={{
        "html, body": { WebkitTapHighlightColor: "transparent", overscrollBehavior: "none" },
        body: { WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" },
        'input, textarea, [contenteditable="true"], [contenteditable="true"] *': {
          WebkitUserSelect: "text", userSelect: "text", WebkitTouchCallout: "default",
        },
        "#root": {
          paddingTop: top,
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        },
        // A solid band behind the status bar, so scrolled content never
        // shows through under the clock and battery.
        "body::before": {
          content: '""', position: "fixed", top: 0, left: 0, right: 0, height: top,
          background: theme.palette.background.paper, zIndex: 2000, pointerEvents: "none",
        },
        ".MuiAppBar-positionSticky": { top },
        ".MuiDialog-paperFullScreen": { paddingTop: top, paddingBottom: bottom },
        ".MuiDrawer-paper": { paddingTop: top, paddingBottom: bottom },
        // Menus and dropdowns open as a sheet from the bottom, like the
        // phone's own action sheets. `translate` animates while the
        // inline transform from MUI's Grow stays switched off.
        ".MuiMenu-paper": {
          top: "auto !important", bottom: 0, left: "0 !important", right: 0,
          width: "100%", maxWidth: "100% !important", maxHeight: "70vh !important",
          borderRadius: "16px 16px 0 0 !important", paddingBottom: bottom,
          transform: "none !important", animation: "examai-sheet-up 220ms cubic-bezier(.2,.7,.3,1)",
        },
        ".MuiMenu-paper .MuiMenuItem-root": { minHeight: 48 },
        ".MuiMenu-root > .MuiBackdrop-root": { backgroundColor: "rgba(0,0,0,0.35) !important" },
        "@keyframes examai-sheet-up": { from: { translate: "0 100%" }, to: { translate: "0 0" } },
      }}
    />
    </>
  );
}
