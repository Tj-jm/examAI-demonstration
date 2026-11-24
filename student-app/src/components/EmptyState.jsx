import { Box, Typography, Button, Paper, useTheme } from "@mui/material";
import { animateBig, float } from "../motion";
import { useBranding } from "../BrandingContext";
import { RESTRAINED_DESIGNS } from "../theme/buildTheme";

// One shape for every screen that has nothing to show. Before this existed,
// each page invented its own — some a bare grey sentence, some a centered
// icon block, some (PlanPicker with no plans, PracticeSession with no
// questions) rendered literally nothing — so a student hitting a dead end
// got no consistent read on *why* it was empty or what to do next.
//
// Three tones, because "empty" is really three different situations and a
// student needs to tell them apart at a glance:
//   idle    — nothing here yet, and that's normal. Usually actionable.
//   waiting — something is in flight elsewhere (scoring, grading). Come back.
//   blocked — a real stop: not enrolled, no plans published, attempts used up.
//
// Design-aware without per-page branching: a restrained design (see
// RESTRAINED_DESIGNS in buildTheme.js) gets a square hairline medallion and
// a serif-or-whatever-that-design's-heading-font title, a bold design gets
// a soft rounded tinted one — the rest is pulled from the theme rather than
// hardcoded, so a new design added to buildTheme.js flows through here
// automatically without ever touching this file.
const TONE = {
  idle: { fg: "text.secondary", bg: "action.hover" },
  waiting: { fg: "warning.main", bgKey: "warningBg" },
  blocked: { fg: "text.secondary", bg: "action.hover" },
};

export default function EmptyState({
  icon: Icon,
  title,
  description,
  tone = "idle",
  action,
  secondaryAction,
  // "page" stands alone on an otherwise blank screen and needs the vertical
  // room; "inline" sits under a heading or inside a section that already has
  // its own chrome, so it stays tight.
  variant = "page",
  // Wrap in an outlined Paper — for empty states that sit among real cards
  // (the dashboard grid) and would otherwise float without an edge.
  bordered = false,
  sx,
}) {
  const theme = useTheme();
  const { design } = useBranding() || {};
  const editorial = RESTRAINED_DESIGNS.has(design);

  const t = TONE[tone] || TONE.idle;
  const medallionBg = t.bgKey ? theme.palette[t.bgKey] : t.bg;

  const body = (
    <Box
      sx={{
        textAlign: "center",
        px: 2,
        py: variant === "page" ? { xs: 6, md: 8 } : 4,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        ...(bordered ? { py: variant === "page" ? 6 : 4 } : null),
      }}
    >
      {Icon && (
        <Box
          sx={{
            width: 52,
            height: 52,
            mb: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: t.fg,
            ...animateBig(float, 3200, "ease-in-out", "infinite"),
            ...(editorial
              ? { border: 1, borderColor: "divider", borderRadius: 0, bgcolor: "transparent" }
              : { borderRadius: "50%", bgcolor: medallionBg }),
          }}
        >
          <Icon size={22} strokeWidth={1.75} />
        </Box>
      )}

      <Typography
        variant="h6"
        sx={{
          fontSize: 16,
          fontWeight: editorial ? 400 : 500,
          mb: description ? 0.75 : 0,
        }}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          variant="body2"
          color="text.secondary"
          // Kept under ~50 characters per line so a two-line explanation
          // never stretches into an unreadable single band on desktop.
          sx={{ maxWidth: 340, lineHeight: 1.6 }}
        >
          {description}
        </Typography>
      )}

      {(action || secondaryAction) && (
        <Box
          sx={{
            mt: 2.5,
            display: "flex",
            gap: 1,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {action && (
            <Button
              variant="contained"
              size="small"
              startIcon={action.icon ? <action.icon size={15} /> : undefined}
              onClick={action.onClick}
              sx={{ px: 2 }}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="outlined"
              size="small"
              startIcon={secondaryAction.icon ? <secondaryAction.icon size={15} /> : undefined}
              onClick={secondaryAction.onClick}
              sx={{ px: 2 }}
            >
              {secondaryAction.label}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );

  if (bordered) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: editorial ? 0 : 3, ...sx }}>
        {body}
      </Paper>
    );
  }

  return <Box sx={sx}>{body}</Box>;
}
