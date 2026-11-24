import { Box, ToggleButtonGroup, ToggleButton, Typography, ButtonBase } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { Layers, ShoppingBag, ChevronRight } from "lucide-react";
import EmptyState from "./EmptyState";
import BatchIcon from "./BatchIcon";
import { useSales, useTerms, useBranding } from "../BrandingContext";
import PickField from "./PickField";

// The exact chip row Results.jsx already used, pulled out so Lectures, Exams
// and Practice can match it instead of each inventing a slightly different
// one. Deliberately no "All batches" option here, unlike Results — Results
// can show attempts from every batch flattened into one list because a
// submission already carries its own batch reference; a lecture or exam
// list has no equivalent "everything, from every batch" endpoint to show,
// so there is always exactly one batch selected, never "all" of them.
export function BatchSwitcher({ enrolled, batchId, onChange }) {
  const terms = useTerms();
  if (enrolled.length <= 1) return null;
  // Many batches: one searchable field instead of a wall of chips.
  if (enrolled.length > 6) {
    return (
      <PickField label={terms.Batch} value={batchId} onChange={(v) => v && onChange(v)} searchFrom={6}
        options={enrolled.map((b) => ({ value: b._id, label: b.name }))} sx={{ mb: 3, maxWidth: 420 }} fullWidth />
    );
  }

  return (
    <ToggleButtonGroup
      value={batchId}
      exclusive
      onChange={(e, v) => v && onChange(v)}
      size="small"
      sx={{
        mb: 3, flexWrap: "wrap", gap: 1,
        "& .MuiToggleButtonGroup-grouped": { border: 1, borderColor: "divider !important", borderRadius: "16px !important" },
      }}
    >
      {enrolled.map((b) => (
        <ToggleButton key={b._id} value={b._id}>{b.name}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

// "you're already inside this one specific batch, on this one specific
// page" — the batch name is a real click target back to the batch's home
// page (a ButtonBase, not a bare span, so it's keyboard-reachable);
// pageName is plain text — this is a title card, not a switcher, so there
// is deliberately nothing on the right suggesting a dropdown or more
// options to pick from. Three interchangeable looks (studentUi
// .batchContextStyle, admin-picked, see Settings.jsx) share that same
// contract — a batch to link back to and a page name to state — since
// nothing about which one is active should change what a caller passes in.
//
// `section` is optional: a module one level deeper than the batch itself
// (the archive's own hub, say) — {label, to}, rendered as a second clickable
// crumb between the batch name and pageName. Every existing two-level
// caller (Practice, Study Plan, ...) omits it and renders exactly as
// before; a page nested inside a module (ArchiveBrowse, ArchiveStudyPlan,
// ArchiveCustomExamSetup) passes it so the trail reads batch > module > page
// instead of collapsing the module out of the breadcrumb entirely.
//
// Every page that renders this now drops its own "‹ Lectures" /
// "‹ Practice" header text (the ArrowLeft button stays — that's still the
// real "go back" action) since this line already states the page name
// alongside the batch it belongs to.
export function BatchContextCard({ batch, pageName, section }) {
  const { batchContextStyle } = useBranding();
  if (!batch) return null;

  if (batchContextStyle === "solid") return <SolidContextCard batch={batch} pageName={pageName} section={section} />;
  if (batchContextStyle === "minimal") return <MinimalContextCard batch={batch} pageName={pageName} section={section} />;
  return <GlassContextCard batch={batch} pageName={pageName} section={section} />;
}

// Original design, and the default — a floating glass breadcrumb, not a
// card competing with the list below it. Its ring/dot color is a fixed
// indigo on purpose, independent of the active theme, the same way a
// frosted-glass overlay reads the same regardless of what's behind it —
// SolidContextCard below is the theme-matched alternative for an
// institution where that fixed color clashes.
function GlassContextCard({ batch, pageName, section }) {
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        mb: 2, p: "10px 14px", borderRadius: "16px",
        display: "flex", alignItems: "center", gap: 1.125,
        bgcolor: "rgba(255,255,255,0.045)",
        backdropFilter: "blur(18px) saturate(140%)",
        WebkitBackdropFilter: "blur(18px) saturate(140%)",
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 30px -8px rgba(0,0,0,0.55)",
      }}
    >
      <Box sx={{
        width: 32, height: 32, borderRadius: "50%", flexShrink: 0, boxSizing: "border-box",
        border: "1.5px solid rgba(124,143,239,0.55)", bgcolor: "rgba(124,143,239,0.12)",
        display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
      }}>
        <BatchIcon icon={batch.icon} size={17} imgSize={80} />
      </Box>

      <ButtonBase
        onClick={() => navigate(`/batches/${batch._id}`)}
        sx={{
          fontSize: 13, fontWeight: 500, color: "text.secondary", borderRadius: 1, px: 0.5,
          "&:hover": { color: "text.primary" },
        }}
      >
        {batch.name}
      </ButtonBase>

      {section && (
        <>
          <ChevronRight size={13} style={{ opacity: 0.45, flexShrink: 0 }} />
          <ButtonBase
            onClick={() => navigate(section.to)}
            sx={{
              fontSize: 13, fontWeight: 500, color: "text.secondary", borderRadius: 1, px: 0.5,
              "&:hover": { color: "text.primary" },
            }}
          >
            {section.label}
          </ButtonBase>
        </>
      )}

      <ChevronRight size={13} style={{ opacity: 0.45, flexShrink: 0 }} />

      <Box sx={{
        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
        bgcolor: "#93A3F5",
        boxShadow: "0 0 0 3px rgba(124,143,239,0.18), 0 0 10px 1px rgba(124,143,239,0.55)",
      }} />

      <Typography sx={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.01em", minWidth: 0 }} noWrap>
        {pageName}
      </Typography>
    </Box>
  );
}

// A flat, opaque card instead of a translucent floating one — no blur, no
// fixed indigo, everything drawn from the active theme's own accent so it
// never clashes with it the way a hardcoded glass tint can. The batch's
// icon gets real room (28px, filling its own badge) rather than floating
// small inside a ring, matching the fill treatment BatchHome's header and
// the dashboard's rich card already use — a custom-uploaded logo reads as
// itself here instead of as a tiny dot.
function SolidContextCard({ batch, pageName, section }) {
  const navigate = useNavigate();
  const theme = useTheme();

  return (
    <Box sx={{
      mb: 2, p: "10px 14px", borderRadius: 2.5,
      display: "flex", alignItems: "center", gap: 1.25,
      bgcolor: "background.paper", border: 1, borderColor: "divider",
    }}>
      <Box sx={{
        width: 28, height: 28, borderRadius: "22%", overflow: "hidden", flexShrink: 0,
        bgcolor: alpha(theme.palette.primary.main, 0.12), color: theme.palette.primary.main,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <BatchIcon icon={batch.icon} size={28} imgSize={70} />
      </Box>

      <ButtonBase
        onClick={() => navigate(`/batches/${batch._id}`)}
        sx={{
          fontSize: 13, fontWeight: 500, color: "text.secondary", borderRadius: 1, px: 0.5,
          "&:hover": { color: "primary.main" },
        }}
      >
        {batch.name}
      </ButtonBase>

      {section && (
        <>
          <ChevronRight size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
          <ButtonBase
            onClick={() => navigate(section.to)}
            sx={{
              fontSize: 13, fontWeight: 500, color: "text.secondary", borderRadius: 1, px: 0.5,
              "&:hover": { color: "primary.main" },
            }}
          >
            {section.label}
          </ButtonBase>
        </>
      )}

      <ChevronRight size={13} style={{ opacity: 0.5, flexShrink: 0 }} />

      <Typography sx={{ fontSize: 14.5, fontWeight: 700, minWidth: 0 }} noWrap>
        {pageName}
      </Typography>
    </Box>
  );
}

// No card, no icon, no blur — a plain text breadcrumb line for a design
// where a glass pill or a bordered card would fight the restraint that
// design is going for (editorial's hairline rules, mono's flat density).
// Just the two things this component actually promises: a link back to
// the batch, and the current page's name.
function MinimalContextCard({ batch, pageName, section }) {
  const sales = useSales();
  const terms = useTerms();
  const navigate = useNavigate();

  return (
    <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      <ButtonBase
        onClick={() => navigate(`/batches/${batch._id}`)}
        sx={{
          fontSize: 13, color: "text.secondary", borderRadius: 1, px: 0.25,
          textDecoration: "underline", textDecorationColor: "transparent", textUnderlineOffset: 3,
          "&:hover": { color: "text.primary", textDecorationColor: "currentColor" },
        }}
      >
        {batch.name}
      </ButtonBase>
      {section && (
        <>
          <Typography sx={{ fontSize: 13, color: "text.disabled" }}>/</Typography>
          <ButtonBase
            onClick={() => navigate(section.to)}
            sx={{
              fontSize: 13, color: "text.secondary", borderRadius: 1, px: 0.25,
              textDecoration: "underline", textDecorationColor: "transparent", textUnderlineOffset: 3,
              "&:hover": { color: "text.primary", textDecorationColor: "currentColor" },
            }}
          >
            {section.label}
          </ButtonBase>
        </>
      )}
      <Typography sx={{ fontSize: 13, color: "text.disabled" }}>/</Typography>
      <Typography sx={{ fontSize: 14.5, fontWeight: 700, minWidth: 0 }} noWrap>
        {pageName}
      </Typography>
    </Box>
  );
}

// The one thing that actually decides which of the two above to show —
// every page that used to render a bare <BatchSwitcher> unconditionally
// showed it even when the student had just come straight from that one
// batch's own home page, since BatchSwitcher itself only ever checks
// "is there more than one batch to choose from", never how this page was
// reached. fromRoute is what was missing: reached directly (a route with
// its own :batchId, or a bookmarked link) means the choice is already
// made, so a card, not a control, is what belongs here.
export function BatchContext({ batch, enrolled, batchId, fromRoute, pageName, onChange }) {
  if (fromRoute) return <BatchContextCard batch={batch} pageName={pageName} />;
  return <BatchSwitcher enrolled={enrolled} batchId={batchId} onChange={onChange} />;
}

// What used to be BatchGate's only real job once picking a batch stopped
// being a separate page: telling a student with no batch at all why there
// is nothing here yet.
export function NoBatchesGate() {
  const navigate = useNavigate();
  const terms = useTerms();
  const sales = useSales();

  return (
    <EmptyState
      icon={Layers}
      tone="blocked"
      title={`You are not in a ${terms.batch} yet`}
      description={sales ? `Lectures, exams and practice all live inside a ${terms.batch}. Join one to open this.` : `Your ${terms.org} adds you to your ${terms.batches}. Ask them if you are expecting one.`}
      action={sales ? { label: `Browse ${terms.batches}`, icon: ShoppingBag, onClick: () => navigate("/purchases") } : undefined}
    />
  );
}
