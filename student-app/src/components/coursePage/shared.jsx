import { Box, Typography, Button, Chip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { PlayCircle, Dumbbell, PenLine, HelpCircle, Zap, Radio, Gift, Tag, Check, ArrowRight, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import BatchIcon from "../BatchIcon";

// Pieces every course page design shares (pages/CoursePage.jsx).

export const FEATURES = [
  ["lectures", "Recorded lectures", "Watch at your pace, as often as you need.", PlayCircle],
  ["practice", "Practice", "Topic-wise questions with instant answers.", Dumbbell],
  ["exams", "Live exams", "Timed exams, results and a leaderboard.", PenLine],
  ["doubtSolving", "Doubt solving", "Ask teachers when you're stuck.", HelpCircle],
  ["aiAssist", "AI help", "Hints, explanations and a study plan.", Zap],
];

export const money = (n, currency) => `${currency} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
export const duration = (p) => (p.isInfinite ? "Lifetime access" : p.durationDays ? `${p.durationDays} days` : "");
export const cheapest = (plans = []) => plans.reduce((a, p) => (a === null || p.price < a.price ? p : a), null);

export const priceLine = (course, currency) => {
  // An institution that doesn't sell shows no prices at all.
  if (course.noSales) return "";
  if (course.accessType === "free") return "Free";
  const low = cheapest(course.plans);
  return low ? `${course.plans.length > 1 ? "From " : ""}${money(low.price, currency)}` : "Paid";
};

export function AccessBadge({ course, color }) {
  if (course.noSales) return null;
  const free = course.accessType === "free";
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.6, px: 1.25, py: 0.4, borderRadius: 5, bgcolor: alpha(color, 0.14), color, fontWeight: 600, fontSize: 13 }}>
      {free ? <Gift size={14} /> : <Tag size={14} />} {free ? "Free" : "Paid"}
    </Box>
  );
}

export function FeatureChips({ course }) {
  const list = FEATURES.filter(([key]) => course.features?.[key]);
  if (!list.length) return null;
  return (
    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
      {list.map(([key, label, , Icon]) => <Chip key={key} size="small" icon={<Icon size={13} />} label={label} variant="outlined" />)}
    </Box>
  );
}

// What's inside, as numbers. Only the ones that aren't zero.
export const statsOf = (course) => [
  ["Lectures", course.stats?.lectures, PlayCircle],
  ["Exams", course.stats?.exams, PenLine],
  ["Live classes coming", course.stats?.liveUpcoming, Radio],
].filter(([, n]) => n > 0);

export function PlanList({ course, currency, onEnroll, accent, compact = false }) {
  if (course.accessType === "free" || !course.plans?.length) return null;
  const best = course.plans.length > 1 ? course.plans.reduce((a, p) => ((p.isInfinite || (p.durationDays || 0) > (a.durationDays || 0)) && !a.isInfinite ? p : a), course.plans[0]) : null;
  return (
    <Box sx={{ display: "grid", gap: 1.25, gridTemplateColumns: compact ? "1fr" : { xs: "1fr", sm: `repeat(${Math.min(3, course.plans.length)}, 1fr)` } }}>
      {course.plans.map((p) => {
        const top = best && p._id === best._id;
        return (
          <Box key={p._id} sx={{ position: "relative", p: compact ? 1.5 : 2.25, borderRadius: 3, border: "1.5px solid", borderColor: top ? accent : "divider", bgcolor: top ? alpha(accent, 0.06) : "background.paper", display: "flex", flexDirection: compact ? "row" : "column", alignItems: compact ? "center" : "stretch", justifyContent: "space-between", gap: 1 }}>
            {top && !compact && <Box sx={{ position: "absolute", top: -11, left: 16, px: 1, py: 0.2, borderRadius: 5, bgcolor: accent, color: "#fff", fontSize: 11, fontWeight: 700 }}>Best value</Box>}
            <Box>
              <Typography sx={{ fontWeight: 600 }}>{p.label}</Typography>
              <Typography variant="body2" color="text.secondary">{duration(p)}</Typography>
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: compact ? 17 : 26, color: top ? accent : "text.primary" }}>{money(p.price, currency)}</Typography>
            {!compact && <Button variant={top ? "contained" : "outlined"} onClick={onEnroll} sx={{ borderRadius: 2, mt: 0.5 }}>Choose</Button>}
          </Box>
        );
      })}
    </Box>
  );
}

export function RelatedCourses({ related, currency, title = "More in this program" }) {
  const navigate = useNavigate();
  if (!related?.length) return null;
  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 20, mb: 1.5 }}>{title}</Typography>
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" } }}>
        {related.map((r) => (
          <Box key={r._id} onClick={() => { navigate(`/courses/${encodeURIComponent(r.slug)}`); window.scrollTo(0, 0); }}
            sx={{ p: 2, borderRadius: 3, border: "1px solid", borderColor: "divider", cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5, transition: "transform 160ms, box-shadow 160ms", "&:hover": { transform: "translateY(-2px)", boxShadow: 3 } }}>
            <BatchIcon icon={r.icon} size={22} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontWeight: 600 }} noWrap>{r.name}</Typography>
              <Typography variant="body2" color="text.secondary">{r.accessType === "free" ? "Free" : r.from !== null ? `From ${money(r.from, currency)}` : "Paid"}</Typography>
            </Box>
            <ArrowRight size={16} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function IncludedList({ course, accent }) {
  const list = FEATURES.filter(([key]) => course.features?.[key]);
  if (!list.length) return null;
  return (
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" } }}>
      {list.map(([key, label, text, Icon]) => (
        <Box key={key} sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
          <Box sx={{ width: 38, height: 38, borderRadius: 2, display: "grid", placeItems: "center", bgcolor: alpha(accent, 0.12), color: accent, flexShrink: 0 }}><Icon size={18} /></Box>
          <Box>
            <Typography sx={{ fontWeight: 600 }}>{label}</Typography>
            <Typography variant="body2" color="text.secondary">{text}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function CheckLine({ children, accent }) {
  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
      <Check size={16} color={accent} /> <Typography variant="body2">{children}</Typography>
    </Box>
  );
}

export function ShareButton({ title, sx }) {
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else await navigator.clipboard.writeText(url);
    } catch { /* cancelled */ }
  };
  return <Button size="small" startIcon={<Share2 size={15} />} onClick={share} sx={{ textTransform: "none", ...sx }}>Share</Button>;
}
