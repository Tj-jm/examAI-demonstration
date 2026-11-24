import { useState } from "react";
import { Box, Typography, Button, Container, Divider, Tabs, Tab } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { Sparkles, ArrowRight } from "lucide-react";
import SafeMarkdown from "../SafeMarkdown";
import ProgramCoverFallback from "../ProgramCoverFallback";
import BatchIcon from "../BatchIcon";
import { TeacherStrip } from "../Teachers";
import { useTerms } from "../../BrandingContext";
import { readableOn } from "../../theme/buildTheme";
import {
  AccessBadge, FeatureChips, PlanList, RelatedCourses, IncludedList, statsOf, priceLine, CheckLine, ShareButton, duration, cheapest,
} from "./shared";

// The three public course page designs (Settings → SEO → Course pages).
// Each gets the same data: { course, related, currency } and onEnroll.

const Cover = ({ course, sx }) => (course.program?.image?.url
  ? <Box component="img" src={course.program.image.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", ...sx }} />
  : <Box sx={{ width: "100%", height: "100%", ...sx }}><ProgramCoverFallback /></Box>);

function About({ course, terms, heading = true }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {course.description && (
        <Box>
          {heading && <Typography sx={{ fontWeight: 700, fontSize: 20, mb: 1 }}>About this {terms.batch}</Typography>}
          <SafeMarkdown>{course.description}</SafeMarkdown>
        </Box>
      )}
      {course.program?.description && (
        <Box>
          {heading && <Typography sx={{ fontWeight: 700, fontSize: 20, mb: 1 }}>About the {terms.program}</Typography>}
          <SafeMarkdown>{course.program.description}</SafeMarkdown>
        </Box>
      )}
    </Box>
  );
}

// A custom theme's banner colours (Settings → SEO → Course pages → Custom,
// or the app's own custom theme) for the Spotlight and Split banners: its
// gradient, when on, with text that reads on it, and any banner text and
// button colours set by hand. Null when there are none: the banners keep
// their own look.
const customBanner = (theme) => {
  const g = theme.examai?.customGradient;
  const b = theme.examai?.banner || {};
  if (!g && !b.text && !b.button && !b.buttonText) return null;
  const stops = g ? [g.from, g.via, g.to].filter(Boolean) : [];
  const out = {
    background: g ? `linear-gradient(${g.angle ?? 135}deg, ${stops.join(", ")})` : null,
    ink: b.text || (g ? readableOn(...stops) : null),
  };
  if (b.button || b.buttonText) {
    const bg = b.button || "#FFFFFF";
    const fg = b.buttonText || readableOn(bg);
    out.button = { bgcolor: bg, color: fg, "&:hover": { bgcolor: alpha(bg, 0.9) } };
  }
  return out;
};
const bannerButton = (custom, accent) => custom?.button || { bgcolor: "#fff", color: accent, "&:hover": { bgcolor: "rgba(255,255,255,0.9)" } };

// 1. Spotlight: a bold coloured hero with the cover and a price card, then
// big sections. Feels like a product launch page.
export function Spotlight({ course, related, currency, onEnroll, ctaLabel }) {
  const theme = useTheme();
  const terms = useTerms();
  const accent = theme.palette.primary.main;
  const second = theme.palette.secondary?.main || accent;
  const stats = statsOf(course);
  const custom = customBanner(theme);
  return (
    <Box>
      <Box sx={{ position: "relative", overflow: "hidden", color: custom?.ink || "#fff", background: custom?.background || `linear-gradient(135deg, ${accent} 0%, ${alpha(second, 0.95)} 100%)` }}>
        <Box sx={{ position: "absolute", inset: 0, opacity: 0.18, background: "radial-gradient(circle at 15% 20%, #fff 0, transparent 35%), radial-gradient(circle at 85% 80%, #fff 0, transparent 30%)" }} />
        <Container maxWidth="lg" sx={{ position: "relative", py: { xs: 5, md: 8 }, display: "grid", gap: { xs: 4, md: 6 }, gridTemplateColumns: { xs: "1fr", md: "1.2fr 1fr" }, alignItems: "center" }}>
          <Box>
            <Typography sx={{ opacity: 0.85, fontWeight: 600, letterSpacing: 0.5, mb: 1 }}>{course.program?.title}</Typography>
            <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: 34, md: 50 }, lineHeight: 1.1, mb: 2 }}>{course.name}</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 3 }}>
              {stats.map(([label, n, Icon]) => (
                <Box key={label} sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.6, borderRadius: 5, bgcolor: alpha(custom?.ink || "#fff", 0.16), fontSize: 14 }}><Icon size={15} /> {n} {label.toLowerCase()}</Box>
              ))}
            </Box>
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
              <Button size="large" onClick={onEnroll} endIcon={<ArrowRight size={18} />} sx={{ ...bannerButton(custom, accent), fontWeight: 700, borderRadius: 3, px: 3 }}>{ctaLabel}</Button>
              <Typography sx={{ fontWeight: 700, fontSize: 20 }}>{priceLine(course, currency)}</Typography>
            </Box>
          </Box>
          <Box sx={{ position: "relative" }}>
            <Box sx={{ borderRadius: 4, overflow: "hidden", aspectRatio: "16 / 10", boxShadow: "0 30px 60px rgba(0,0,0,0.25)", transform: { md: "rotate(1.5deg)" } }}>
              <Cover course={course} />
            </Box>
            <Box sx={{ position: "absolute", left: { xs: 12, md: -24 }, bottom: -22, bgcolor: "background.paper", color: "text.primary", borderRadius: 3, px: 2, py: 1.25, boxShadow: 6, display: "flex", alignItems: "center", gap: 1.25 }}>
              <BatchIcon icon={course.icon} size={22} />
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{course.accessType === "free" ? "Free to join" : priceLine(course, currency)}</Typography>
                {cheapest(course.plans) && <Typography variant="caption" color="text.secondary">{duration(cheapest(course.plans))}</Typography>}
              </Box>
            </Box>
          </Box>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 5, md: 7 }, display: "flex", flexDirection: "column", gap: { xs: 5, md: 7 } }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: 24, md: 30 }, mb: 2.5 }}>What you get</Typography>
          <IncludedList course={course} accent={accent} />
        </Box>
        <About course={course} terms={terms} />
        {course.teachers?.length > 0 && <TeacherStrip teachers={course.teachers} label={terms.Teachers} />}
        {course.accessType !== "free" && course.plans?.length > 0 && (
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: 24, md: 30 }, mb: 2.5 }}>Pick your plan</Typography>
            <PlanList course={course} currency={currency} onEnroll={onEnroll} accent={accent} />
          </Box>
        )}
        <Box sx={{ borderRadius: 4, p: { xs: 3, md: 5 }, textAlign: "center", background: alpha(accent, 0.08), border: "1px solid", borderColor: alpha(accent, 0.25) }}>
          <Sparkles size={26} color={accent} />
          <Typography sx={{ fontWeight: 800, fontSize: { xs: 22, md: 28 }, mt: 1 }}>Ready to start {course.name}?</Typography>
          <Button size="large" variant="contained" onClick={onEnroll} sx={{ mt: 2, borderRadius: 3, px: 4 }}>{ctaLabel}</Button>
        </Box>
        <RelatedCourses related={related} currency={currency} />
      </Container>
    </Box>
  );
}

// 2. Magazine: a full-width cover with the title over it, an article on the
// left and a sticky enrolment card on the right. Calm and editorial.
export function Magazine({ course, related, currency, onEnroll, ctaLabel }) {
  const theme = useTheme();
  const terms = useTerms();
  const accent = theme.palette.primary.main;
  const stats = statsOf(course);
  const lead = String(course.description || course.program?.description || "").split(/\n\s*\n/)[0].replace(/[#*_>`]/g, "").trim();
  return (
    <Box>
      <Box sx={{ position: "relative", height: { xs: 300, md: 440 } }}>
        <Cover course={course} />
        <Box sx={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.05) 20%, rgba(0,0,0,0.75) 100%)" }} />
        <Container maxWidth="lg" sx={{ position: "absolute", left: 0, right: 0, bottom: 0, pb: { xs: 3, md: 5 }, color: "#fff" }}>
          <Typography sx={{ textTransform: "uppercase", letterSpacing: 2, fontSize: 12, fontWeight: 700, opacity: 0.85 }}>{course.program?.title}</Typography>
          <Typography component="h1" sx={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: { xs: 32, md: 54 }, lineHeight: 1.08, maxWidth: 820 }}>{course.name}</Typography>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 }, display: "grid", gap: { xs: 4, md: 6 }, gridTemplateColumns: { xs: "1fr", md: "1fr 340px" }, alignItems: "start" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          {lead && (
            <Typography sx={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: { xs: 20, md: 24 }, lineHeight: 1.5, borderLeft: `4px solid ${accent}`, pl: 2.5, color: "text.secondary" }}>
              {lead.length > 260 ? `${lead.slice(0, 260)}…` : lead}
            </Typography>
          )}
          <FeatureChips course={course} />
          <About course={course} terms={terms} />
          {course.teachers?.length > 0 && (
            <>
              <Divider />
              <TeacherStrip teachers={course.teachers} label={terms.Teachers} />
            </>
          )}
          <Divider />
          <RelatedCourses related={related} currency={currency} title="You might also like" />
        </Box>

        <Box sx={{ order: { xs: -1, md: 0 }, position: { md: "sticky" }, top: { md: 88 }, borderRadius: 3, border: "1px solid", borderColor: "divider", bgcolor: "background.paper", p: 2.5, display: "flex", flexDirection: "column", gap: 2, boxShadow: { md: 4 } }}>
          <AccessBadge course={course} color={accent} />
          <Typography sx={{ fontWeight: 800, fontSize: 28 }}>{priceLine(course, currency)}</Typography>
          <PlanList course={course} currency={currency} onEnroll={onEnroll} accent={accent} compact />
          <Button fullWidth size="large" variant="contained" onClick={onEnroll} sx={{ borderRadius: 2 }}>{ctaLabel}</Button>
          {stats.length > 0 && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {stats.map(([label, n]) => <CheckLine key={label} accent={accent}>{n} {label.toLowerCase()}</CheckLine>)}
            </Box>
          )}
          <ShareButton title={course.name} sx={{ alignSelf: "flex-start" }} />
        </Box>
      </Container>
    </Box>
  );
}

// 3. Split: a coloured panel that stays put on the left with the essentials
// and the button, and the details on the right in tabs. Feels like an app.
export function Split({ course, related, currency, onEnroll, ctaLabel }) {
  const theme = useTheme();
  const terms = useTerms();
  const accent = theme.palette.primary.main;
  const stats = statsOf(course);
  const [tab, setTab] = useState("overview");
  const hasPlans = course.accessType !== "free" && course.plans?.length > 0;
  const custom = customBanner(theme);
  // Over a gradient the cover fades out instead of into one solid colour.
  const fade = "linear-gradient(180deg, #000 45%, transparent 100%)";
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(340px, 42%) 1fr" }, minHeight: { md: "calc(100dvh - 64px)" } }}>
      <Box sx={{ position: { md: "sticky" }, top: { md: 64 }, height: { md: "calc(100dvh - 64px)" }, ...(custom?.background ? { background: custom.background } : { bgcolor: accent }), color: custom?.ink || "#fff", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Box sx={{ height: { xs: 190, md: "38%" }, position: "relative", flexShrink: 0, ...(custom?.background ? { maskImage: fade, WebkitMaskImage: fade } : {}) }}>
          <Cover course={course} />
          {!custom?.background && <Box sx={{ position: "absolute", inset: 0, background: `linear-gradient(180deg, transparent 40%, ${accent} 100%)` }} />}
        </Box>
        <Box sx={{ p: { xs: 3, md: 4 }, display: "flex", flexDirection: "column", gap: 2, flex: 1, overflowY: "auto" }}>
          <Typography sx={{ opacity: 0.85, fontWeight: 600 }}>{course.program?.title}</Typography>
          <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: 30, md: 38 }, lineHeight: 1.12 }}>{course.name}</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, stats.length)}, 1fr)`, gap: 1 }}>
            {stats.map(([label, n, Icon]) => (
              <Box key={label} sx={{ p: 1.25, borderRadius: 2, bgcolor: alpha(custom?.ink || "#fff", 0.14) }}>
                <Icon size={16} />
                <Typography sx={{ fontWeight: 800, fontSize: 22 }}>{n}</Typography>
                <Typography sx={{ fontSize: 12, opacity: 0.85 }}>{label}</Typography>
              </Box>
            ))}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontWeight: 800, fontSize: 26 }}>{priceLine(course, currency)}</Typography>
          <Button size="large" onClick={onEnroll} endIcon={<ArrowRight size={18} />} sx={{ ...bannerButton(custom, accent), fontWeight: 700, borderRadius: 3 }}>{ctaLabel}</Button>
          <ShareButton title={course.name} sx={{ color: custom?.ink || "#fff", alignSelf: "flex-start" }} />
        </Box>
      </Box>

      <Box sx={{ p: { xs: 2.5, md: 5 }, minWidth: 0 }}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}>
          <Tab value="overview" label="Overview" />
          {hasPlans && <Tab value="plans" label="Plans" />}
          {course.teachers?.length > 0 && <Tab value="teachers" label={terms.Teachers} />}
          {related?.length > 0 && <Tab value="more" label="More courses" />}
        </Tabs>
        {tab === "overview" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <IncludedList course={course} accent={accent} />
            <About course={course} terms={terms} />
          </Box>
        )}
        {tab === "plans" && <PlanList course={course} currency={currency} onEnroll={onEnroll} accent={accent} />}
        {tab === "teachers" && <TeacherStrip teachers={course.teachers} label={terms.Teachers} />}
        {tab === "more" && <RelatedCourses related={related} currency={currency} title="" />}
      </Box>
    </Box>
  );
}

export const DESIGNS = { spotlight: Spotlight, magazine: Magazine, split: Split };
