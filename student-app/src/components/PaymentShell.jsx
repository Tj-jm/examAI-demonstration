import { Box, Typography, IconButton, Divider, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { X } from "lucide-react";
import { useBranding } from "../BrandingContext";
import { RESTRAINED_DESIGNS, getBoldFill } from "../theme/buildTheme";
import BatchIcon from "./BatchIcon";

// Chrome for the checkout screens, following the sample's structure:
// a solid coloured bar with a close button and a centred title, then a
// single narrow column of content on a plain background.
//
// The one deliberate departure from the sample is colour. The sample
// hardcodes #007bff for the bar and #005CE6 for actions; this uses the
// theme's own primary and accent instead. Hardcoding blue would have looked
// right in exactly one install — the sixteen theme colours, light and dark
// mode and the eight designs are all existing shipped features, and a
// checkout that ignored them would be the only screen in the app that did.
//
// The sample also pins its container to 375px, which is fine for a phone and
// a strip down the middle of a laptop. Here it is a max-width that centres,
// so the phone layout is preserved and the desktop one is not broken.
export function PaymentShell({ title, onClose, children, maxWidth = 420 }) {
  const { design } = useBranding() || {};
  const editorial = RESTRAINED_DESIGNS.has(design);
  const theme = useTheme();
  // Unconditional — this bar stays colored for every design, restrained
  // ones included (see the comment above), so it always reads through
  // getBoldFill rather than only in the bold-fill branch like the other
  // "couple of spots." Restrained designs fall to that function's default
  // case, which is the same flat accent fill this always drew before.
  const fill = getBoldFill(design, theme);

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default", display: "flex", flexDirection: "column" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 1.5,
          background: fill.background,
          color: fill.color,
          ...(fill.border ? { borderBottom: fill.border, boxShadow: fill.boxShadow } : {}),
        }}
      >
        {onClose ? (
          <IconButton size="small" onClick={onClose} sx={{ color: "inherit" }} aria-label="Close checkout">
            <X size={18} />
          </IconButton>
        ) : (
          <Box sx={{ width: 34 }} />
        )}

        <Typography sx={{ fontSize: 15, fontWeight: editorial ? 400 : 500 }}>{title}</Typography>

        {/* Balances the close button so the title sits truly centred. */}
        <Box sx={{ width: 34 }} />
      </Box>

      <Box sx={{ flex: 1, width: "100%", maxWidth, mx: "auto", px: 2, py: 2.5 }}>
        {children}
      </Box>
    </Box>
  );
}

// The sample's "spine": the batch name, with a short vertical rule dropping
// from it to each supporting detail. It reads as one connected object rather
// than a stack of unrelated lines, which is what makes it clear at a glance
// that all of this describes the thing being bought.
export function BatchSpine({ icon, name, rows = [] }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <BatchIcon icon={icon} size={26} />
        <Typography sx={{ fontSize: 18 }}>{name}</Typography>
      </Box>

      {rows.filter(Boolean).map((row, i) => (
        <Box key={i}>
          <Box sx={{ ml: "12px", height: 14, display: "flex", alignItems: "center" }}>
            <Divider
              orientation="vertical"
              flexItem
              sx={{ borderRightWidth: 2, height: "100%", borderColor: "text.secondary", opacity: 0.5 }}
            />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            {row.icon}
            <Typography variant="body2" color="text.secondary">{row.label}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// The sample marks its section heading with a gradient hairline above and
// below. That gradient is two fixed colours; this derives its own from the
// theme's primary and accent so it shifts with the install's palette instead
// of clashing with it.
export function SectionRule({ children }) {
  const theme = useTheme();

  // The sample's gradient runs between two fixed brand colours. This theme
  // exposes only one accent (buildTheme maps it to primary.main; there is no
  // palette.accent), so rather than inventing a second colour that would
  // clash with five of the six palettes, the gradient runs from the accent
  // out to transparent at both ends. Same effect — a rule that reads as
  // deliberate rather than as a plain border — without guessing at a colour
  // the install never chose.
  const line = `linear-gradient(to right, transparent, ${alpha(theme.palette.primary.main, 0.85)}, transparent)`;

  return (
    <Box sx={{ position: "relative", py: 1.5, my: 2, textAlign: "center" }}>
      <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: line }} />
      <Typography sx={{ fontSize: 15 }}>{children}</Typography>
      <Box sx={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "2px", background: line }} />
    </Box>
  );
}

// The tinted information panel the sample uses for both notices and the
// success confirmation. `tone` picks which of the theme's existing status
// tints it borrows, so it stays legible in dark mode — a fixed #E3EEFF would
// not.
export function Notice({ icon, tone = "info", children, sx }) {
  const theme = useTheme();

  const bg = {
    info: theme.palette.action.hover,
    success: theme.palette.correctBg,
    warning: theme.palette.warningBg,
  }[tone];

  const fg = {
    info: "text.primary",
    success: "success.main",
    warning: "warning.main",
  }[tone];

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        bgcolor: bg,
        color: fg,
        borderRadius: 1.5,
        px: 2,
        py: 1.75,
        textAlign: "center",
        lineHeight: 1.6,
        ...sx,
      }}
    >
      {icon}
      <Typography sx={{ fontSize: 15, color: "inherit" }}>{children}</Typography>
    </Box>
  );
}
