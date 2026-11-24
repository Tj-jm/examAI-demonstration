import { useState } from "react";
import {
  Box, Typography, Button, Dialog, IconButton, Chip, Skeleton, Divider,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import {
  X, CheckCircle2, PlayCircle, Dumbbell, PenLine, HelpCircle, Zap, Gift, Tag, ChevronRight, Video,
} from "lucide-react";
import { useGetBatchesQuery } from "../api/contentApi";
import SafeMarkdown from "./SafeMarkdown";
import { TeacherStrip } from "./Teachers";
import ProgramCoverFallback from "./ProgramCoverFallback";
import BatchIcon from "./BatchIcon";
import { useTerms, useSales, useBranding } from "../BrandingContext";

// Same feature-to-icon mapping BatchHome.jsx uses for its own action tiles
// — a student who already knows what the Zap icon means there shouldn't
// have to learn a second symbol for the same thing here.
const FEATURE_ICONS = [
  ["lectures", "Lectures", PlayCircle],
  ["practice", "Practice", Dumbbell],
  ["exams", "Exams", PenLine],
  ["liveClasses", "Live classes", Video],
  ["doubtSolving", "Doubt solving", HelpCircle],
  ["aiAssist", "AI help", Zap],
];

// Everything on offer, grouped by program — this reuses the exact same
// enrolled/browsable split getBatches already computes for the dashboard
// and the Plans page, rather than a second "is this bought" calculation
// that could quietly disagree with those. hasAccess is what "already
// bought" means here; there's no separate purchase check.
export default function CourseCatalogue() {
  const terms = useTerms();
  const sales = useSales();
  const { data, isLoading } = useGetBatchesQuery();
  const navigate = useNavigate();
  const theme = useTheme();
  // Settings → Student app → Course catalogue: "classic" (program photo
  // banner, logo cards), "photoLogo" (program name as type, each card's
  // cover is the program photo with the logo over it) or "list" (program
  // name as type, one compact row per batch).
  const { catalogueStyle = "classic" } = useBranding();
  const [modalBatch, setModalBatch] = useState(null);
  const [filter, setFilter] = useState("all"); // "all" | "unenrolled" | "free"

  const allBatches = [...(data?.enrolled || []), ...(data?.browsable || [])];

  // Nothing to browse and nothing enrolled either — this section simply
  // doesn't exist rather than showing an empty shell under "Your batches".
  // Nothing is offered where nothing is sold.
  if (!sales || (!isLoading && allBatches.length === 0)) return null;

  const visible = filter === "unenrolled"
    ? allBatches.filter((b) => !b.hasAccess)
    : filter === "free"
      ? allBatches.filter((b) => b.accessType === "free")
      : allBatches;

  const groups = [];
  const byProgramId = new Map();
  for (const batch of visible) {
    if (!batch.program) continue; // shouldn't happen — program is required on Batch — but never crash the page over it
    const pid = batch.program._id;
    if (!byProgramId.has(pid)) {
      const group = { program: batch.program, batches: [] };
      byProgramId.set(pid, group);
      groups.push(group);
    }
    byProgramId.get(pid).batches.push(batch);
  }
  groups.sort((a, b) => (a.program.order ?? 0) - (b.program.order ?? 0) || a.program.title.localeCompare(b.program.title));

  return (
    <Box sx={{ mt: 5 }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", mb: 3, flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 500, mb: 0.5, fontSize: 17 }}>Course catalogue</Typography>
          <Typography variant="body2" color="text.secondary">Everything on offer, grouped by program.</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          {[["all", "All"], ["unenrolled", "Not enrolled"], ["free", "Free", Gift]].map(([value, label, Icon]) => (
            <Chip
              key={value}
              label={label}
              icon={Icon && <Icon size={14} />}
              onClick={() => setFilter(value)}
              variant={filter === value ? "filled" : "outlined"}
              color={filter === value ? "primary" : "default"}
              size="small"
            />
          ))}
        </Box>
      </Box>

      {isLoading ? (
        <Skeleton variant="rounded" height={260} sx={{ mb: 3 }} />
      ) : groups.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {filter === "free" ? `No free ${terms.batches} on offer.` : "Nothing left unenrolled — you're in everything on offer."}
        </Typography>
      ) : (
        groups.map(({ program, batches }) => (
          <ProgramGroup
            key={program._id}
            program={program}
            batches={batches}
            onViewMore={setModalBatch}
            navigate={navigate}
            theme={theme}
            style={catalogueStyle}
          />
        ))
      )}

      <BatchDetailsModal batch={modalBatch} onClose={() => setModalBatch(null)} navigate={navigate} theme={theme} />
    </Box>
  );
}

function ProgramGroup({ program, batches, onViewMore, navigate, theme, style }) {
  if (style === "photoLogo" || style === "list") {
    return (
      <Box sx={{ mb: 4.5 }}>
        <ProgramHeading program={program} count={batches.length} theme={theme} />
        {style === "list" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
            {batches.map((batch) => (
              <BatchCatalogueRow key={batch._id} batch={batch} onViewMore={onViewMore} navigate={navigate} theme={theme} />
            ))}
          </Box>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 2 }}>
            {batches.map((batch) => (
              <BatchCatalogueCard key={batch._id} batch={batch} onViewMore={onViewMore} navigate={navigate} theme={theme} photoCover />
            ))}
          </Box>
        )}
      </Box>
    );
  }
  return (
    <Box sx={{ mb: 4.5 }}>
      <Box sx={{ borderRadius: 3, overflow: "hidden", position: "relative", height: 130, mb: 2 }}>
        {program.image?.url ? (
          <Box component="img" src={program.image.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <ProgramCoverFallback />
        )}
        <Box
          sx={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end",
            background: "linear-gradient(to top, rgba(0,0,0,0.65), transparent 70%)",
            p: 2,
          }}
        >
          <Typography sx={{ color: "#fff", fontWeight: 500, fontSize: 17 }}>{program.title}</Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.8)", fontSize: 12.5 }}>
            {batches.length} batch{batches.length === 1 ? "" : "es"}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 2 }}>
        {batches.map((batch) => (
          <BatchCatalogueCard key={batch._id} batch={batch} onViewMore={onViewMore} navigate={navigate} theme={theme} />
        ))}
      </Box>
    </Box>
  );
}

// The program as type alone: no photo, so the photo appears once, on the cards.
function ProgramHeading({ program, count, theme }) {
  const terms = useTerms();
  return (
    <Box sx={{ display: "flex", alignItems: "stretch", gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 4, borderRadius: 2, flexShrink: 0, background: `linear-gradient(${theme.palette.primary.main}, ${alpha(theme.palette.primary.main, 0.2)})` }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: { xs: 20, sm: 23 }, lineHeight: 1.2, letterSpacing: -0.3 }}>{program.title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 500 }}>
          {count} {count === 1 ? terms.batch : terms.batches}
        </Typography>
      </Box>
    </Box>
  );
}

const statusOf = (batch) => {
  const cheapestPlan = batch.plans?.length > 0 ? Math.min(...batch.plans.map((p) => p.price)) : null;
  return batch.hasAccess
    ? { icon: CheckCircle2, text: "Enrolled" }
    : batch.accessType === "free"
      ? { icon: Gift, text: "Free" }
      : { icon: Tag, text: cheapestPlan !== null ? `From ${cheapestPlan}` : "No plans yet" };
};

// One compact row per batch: many fit on a phone screen. Tapping the row
// opens the details; the button goes straight in.
function BatchCatalogueRow({ batch, onViewMore, navigate, theme }) {
  const terms = useTerms();
  const owned = batch.hasAccess;
  const accent = owned ? theme.palette.success.main : theme.palette.primary.main;
  const { icon: StatusIcon, text } = statusOf(batch);
  return (
    <Box
      onClick={() => onViewMore(batch)}
      sx={{
        display: "flex", alignItems: "center", gap: 1.5, p: 1.25, pr: 1.5, borderRadius: 3, cursor: "pointer",
        bgcolor: "background.paper", border: 1, borderColor: "divider",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        "&:hover": { borderColor: alpha(accent, 0.5), boxShadow: `0 6px 18px ${alpha(accent, 0.12)}` },
      }}
    >
      <Box sx={{
        width: 52, height: 52, borderRadius: 2.5, flexShrink: 0, overflow: "hidden", color: accent,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(160deg, ${alpha(accent, 0.2)}, ${alpha(accent, 0.05)})`,
      }}>
        <BatchIcon icon={batch.icon} size={52} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 15 }} noWrap>{batch.name}</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: accent, mt: 0.25 }}>
          <StatusIcon size={13} />
          <Typography variant="caption" sx={{ fontWeight: 500, color: accent }} noWrap>{text}</Typography>
        </Box>
      </Box>
      <Button
        size="small"
        variant={owned ? "outlined" : "contained"}
        onClick={(e) => { e.stopPropagation(); navigate(owned ? `/batches/${batch._id}` : `/purchases/${batch._id}`); }}
        sx={{ flexShrink: 0, whiteSpace: "nowrap", ...(owned ? { color: accent, borderColor: alpha(accent, 0.5) } : {}) }}
      >
        {owned ? "Open" : "Plans"}
      </Button>
    </Box>
  );
}

function BatchCatalogueCard({ batch, onViewMore, navigate, theme, photoCover = false }) {
  const terms = useTerms();
  const owned = batch.hasAccess;
  // One accent color carries the whole "is this mine" signal — the cover
  // tint and the status line — rather than a badge, a ring and a chip all
  // competing to say the same thing at once.
  const accent = owned ? theme.palette.success.main : theme.palette.primary.main;
  const statusLine = statusOf(batch);
  const StatusIcon = statusLine.icon;

  return (
    <Box
      sx={{
        borderRadius: 3, overflow: "hidden", bgcolor: "background.paper",
        border: 1, borderColor: "divider",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        "&:hover": { transform: "translateY(-3px)", boxShadow: `0 10px 26px ${alpha(accent, 0.18)}` },
      }}
    >
      {/* There's no photo for a batch the way a program has one — the icon
          IS the cover art here, given real room to read as one rather than
          shrunk into a corner badge next to the text. */}
      {photoCover ? (
        // The program's photo behind, the batch's logo in front on its own tile.
        <Box sx={{ height: 128, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          <Box sx={{ position: "absolute", inset: 0 }}>
            {batch.program?.image?.url ? (
              <Box component="img" src={batch.program.image.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <ProgramCoverFallback />
            )}
          </Box>
          <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.45), rgba(0,0,0,0.1))" }} />
          <Box sx={{
            position: "relative", width: 76, height: 76, borderRadius: 3, overflow: "hidden", color: accent,
            bgcolor: "background.paper", boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <BatchIcon icon={batch.icon} size={76} />
          </Box>
        </Box>
      ) : (
      <Box sx={{
        height: 104, position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(160deg, ${alpha(accent, 0.22)}, ${alpha(accent, 0.05)})`,
      }}>
        <Box sx={{
          position: "absolute", width: 130, height: 130, borderRadius: "50%",
          background: `radial-gradient(circle, ${alpha(accent, 0.16)}, transparent 70%)`,
        }} />
        <Box sx={{ position: "relative", color: accent }}>
          <BatchIcon icon={batch.icon} size={92} />
        </Box>
      </Box>
      )}

      <Box sx={{ p: 2.25, display: "flex", flexDirection: "column", gap: 1.25 }}>
        <Box>
          <Typography sx={{ fontWeight: 500, fontSize: 15 }} noWrap>{batch.name}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {batch.program?.title}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.6, color: accent }}>
            <StatusIcon size={14} />
            <Typography variant="body2" sx={{ fontWeight: 500, color: accent }}>{statusLine.text}</Typography>
          </Box>
          <Button
            size="small"
            variant="text"
            onClick={() => onViewMore(batch)}
            sx={{
              minWidth: 0, px: 1, whiteSpace: "nowrap", color: accent, fontWeight: 500,
              "&:hover": { bgcolor: alpha(accent, 0.08) },
            }}
          >
            View more
          </Button>
        </Box>

        <Box sx={{ display: "flex", gap: 0.75 }}>
          {FEATURE_ICONS.filter(([key]) => batch.features?.[key]).map(([key, label, Icon]) => (
            <Box
              key={key}
              title={label}
              sx={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                bgcolor: alpha(theme.palette.text.primary, 0.06),
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Icon size={13} style={{ opacity: 0.65 }} />
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: 0.5 }}>
          <Button
            size="small"
            variant="contained"
            fullWidth
            onClick={() => navigate(owned ? `/batches/${batch._id}` : `/purchases/${batch._id}`)}
            endIcon={<ChevronRight size={14} />}
          >
            {owned ? `Go to ${terms.batch}` : "View plans"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

function BatchDetailsModal({ batch, onClose, navigate, theme }) {
  const terms = useTerms();
  if (!batch) return null;
  const owned = batch.hasAccess;
  const accent = owned ? theme.palette.success.main : theme.palette.primary.main;

  return (
    <Dialog open={Boolean(batch)} onClose={onClose} fullWidth maxWidth="sm">
      <Box sx={{ height: 170, position: "relative" }}>
        {batch.program?.image?.url ? (
          <Box component="img" src={batch.program.image.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <ProgramCoverFallback />
        )}
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ position: "absolute", top: 10, right: 10, bgcolor: "rgba(0,0,0,0.35)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,0.5)" } }}
        >
          <X size={16} />
        </IconButton>
      </Box>

      <Box sx={{ p: 2.5 }}>
        <Typography variant="caption" color="text.secondary">{batch.program?.title}</Typography>
        <Typography sx={{ fontWeight: 500, fontSize: 19, mb: 0.5 }}>{batch.name}</Typography>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.6, color: accent, mb: 2 }}>
          {owned ? <CheckCircle2 size={15} /> : batch.accessType === "free" ? <Gift size={14} /> : <Tag size={14} />}
          <Typography variant="body2" sx={{ fontWeight: 500, color: accent }}>
            {owned ? "Enrolled" : batch.accessType === "free" ? "Free" : "Paid"}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
          {FEATURE_ICONS.filter(([key]) => batch.features?.[key]).map(([key, label, Icon]) => (
            <Chip key={key} size="small" icon={<Icon size={12} />} label={label} variant="outlined" />
          ))}
        </Box>

        {batch.program?.description && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontWeight: 500 }}>
              About the program
            </Typography>
            <SafeMarkdown>{batch.program.description}</SafeMarkdown>
          </Box>
        )}

        {batch.description && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, fontWeight: 500 }}>
              About this batch
            </Typography>
            <SafeMarkdown>{batch.description}</SafeMarkdown>
          </Box>
        )}

        <TeacherStrip teachers={batch.teachers} label={terms.Teachers} sx={{ mb: 2 }} />

        {!owned && batch.plans?.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mb: 2 }}>
              {batch.plans.map((plan) => (
                <Box key={plan._id} sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2">{plan.label}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{plan.price}</Typography>
                </Box>
              ))}
            </Box>
          </>
        )}

        <Button
          fullWidth
          variant="contained"
          onClick={() => { onClose(); navigate(owned ? `/batches/${batch._id}` : `/purchases/${batch._id}`); }}
        >
          {owned ? `Go to ${terms.batch}` : "View plans"}
        </Button>
      </Box>
    </Dialog>
  );
}
