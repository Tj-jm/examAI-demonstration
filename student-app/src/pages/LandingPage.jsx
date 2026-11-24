import { useState, useEffect, useRef } from "react";
import { Box, Typography, Button, Container, Grid, IconButton, Dialog, Chip, Divider, Accordion, AccordionSummary, AccordionDetails, Menu, MenuItem, ListItemIcon, TextField, Paper, Alert } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ChevronLeft, ChevronRight, ExternalLink, ArrowRight, X, Gift, Tag, PlayCircle, Dumbbell, PenLine, HelpCircle, Zap, ChevronDown, Sun, Moon, Monitor } from "lucide-react";
import { useGetPublicLandingPageQuery, useSubmitLeadMutation, useCheckReferralQuery } from "../api/authApi";
import { savedRef } from "../utils/referralRef";
import { useBranding } from "../BrandingContext";
import BatchIcon from "../components/BatchIcon";
import ProgramCoverFallback from "../components/ProgramCoverFallback";
import NoticeCard from "../components/NoticeCard";
import SafeMarkdown from "../components/SafeMarkdown";
import { TeachersSection, TeacherStrip } from "../components/Teachers";
import { useTerms } from "../BrandingContext";
import PickField from "../components/PickField";

// The one page a logged-out visitor sees at the root path instead of being
// bounced straight to /login (see App.jsx's Protected — root is special-
// cased there, every other path still redirects exactly as before). Wrapped
// in the same ThemeProvider as the rest of the app, so whichever theme,
// design and light/dark mode an install has picked just applies here too,
// the same way it applies to every other page — nothing theme-specific
// lives in this file.
export default function LandingPage() {
  const navigate = useNavigate();
  const { siteName, logo, seo } = useBranding();
  const { data, isLoading } = useGetPublicLandingPageQuery();

  const goLogin = () => navigate("/login");

  if (isLoading) return null;

  const sections = data?.sections || [];

  // Every field falls back to something reasonable rather than an empty
  // tag — an install that hasn't touched the SEO settings yet still gets a
  // sane title/OG image (siteName, the platform logo) instead of a blank
  // one, the same "safe default, not broken" pattern settings.seo itself
  // follows.
  const metaTitle = seo?.metaTitle || siteName;
  const metaDescription = seo?.metaDescription || "";
  const ogImage = seo?.ogImage || logo || "";

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "transparent" }}>
      <Helmet>
        <title>{metaTitle}</title>
        {metaDescription && <meta name="description" content={metaDescription} />}
        {seo?.keywords?.length > 0 && <meta name="keywords" content={seo.keywords.join(", ")} />}
        {seo?.canonicalUrl && <link rel="canonical" href={seo.canonicalUrl} />}
        {seo?.noIndex && <meta name="robots" content="noindex, nofollow" />}

        <meta property="og:type" content="website" />
        <meta property="og:title" content={metaTitle} />
        {metaDescription && <meta property="og:description" content={metaDescription} />}
        {ogImage && <meta property="og:image" content={ogImage} />}
        <meta name="twitter:card" content={ogImage ? "summary_large_image" : "summary"} />
        <meta name="twitter:title" content={metaTitle} />
        {metaDescription && <meta name="twitter:description" content={metaDescription} />}

        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "EducationalOrganization",
            name: siteName,
            ...(logo ? { logo } : {}),
            ...(metaDescription ? { description: metaDescription } : {}),
          })}
        </script>
      </Helmet>

      <LandingHeader siteName={siteName} logo={logo} onLogin={goLogin} />
      <ReferralBanner />

      {sections.map((section) => (
        <SectionRenderer key={section._id} section={section} data={data} onLogin={goLogin} />
      ))}
    </Box>
  );
}

// A simple sticky top bar — logo/site name on the left, "Log in" on the
// right. This is "the auth section" a logged-out visitor reaches the
// existing login flow through; nothing about the auth pages themselves
// changes.
function LandingHeader({ siteName, logo, onLogin }) {
  return (
    <Box sx={{
      position: "sticky", top: "env(safe-area-inset-top, 0px)", zIndex: 10,
      bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider",
      backdropFilter: "blur(8px)",
    }}>
      <Container maxWidth="lg" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {logo ? (
            <Box component="img" src={logo} alt={siteName} sx={{ height: 32 }} />
          ) : (
            <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{siteName}</Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <LandingModeToggle />
          <Button variant="contained" onClick={onLogin}>Log in</Button>
        </Box>
      </Container>
    </Box>
  );
}

// Same toggle Shell.jsx's own ModeMenu gives a logged-in student (light /
// dark / system, reading and writing the same mode/setMode/allowModeOverride
// out of BrandingContext) — kept as its own small copy rather than exported
// and shared, since Shell.jsx renders inside the authenticated app chrome
// and has no reason to be imported by the public, logged-out landing page.
// Institutions that never turned studentUi.allowModeOverride on keep the
// landing page exactly as before — this renders nothing for them.
function LandingModeToggle() {
  const branding = useBranding();
  const [anchor, setAnchor] = useState(null);
  if (!branding.allowModeOverride) return null;

  const options = [["light", "Light", Sun], ["dark", "Dark", Moon], ["system", "System", Monitor]];
  const current = options.find(([v]) => v === branding.mode) || options[0];
  const CurrentIcon = current[2];

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Change color mode">
        <CurrentIcon size={18} />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {options.map(([value, label, Icon]) => (
          <MenuItem key={value} selected={branding.mode === value} onClick={() => { branding.setMode(value); setAnchor(null); }}>
            <ListItemIcon><Icon size={16} /></ListItemIcon>
            {label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function SectionRenderer({ section, data, onLogin }) {
  switch (section.type) {
    case "hero":
      return <HeroSection content={section.content} batches={data.catalogue} onLogin={onLogin} />;
    case "stats":
      return <StatsSection content={section.content} />;
    case "catalogue":
      return <CatalogueSection content={section.content} batches={data.catalogue} currency={data.defaultCurrency} onLogin={onLogin} />;
    case "teachers":
      return <TeachersSection content={section.content} teachers={data.teachers} />;
    case "about":
      return <AboutSection content={section.content} />;
    case "faq":
      return <FaqSection content={section.content} />;
    case "notices":
      return <NoticesSection content={section.content} notices={data.notices} />;
    case "updates":
      return <UpdatesSection content={section.content} updates={data.updates} />;
    case "footer":
      return <FooterSection content={section.content} />;
    case "interest":
      return <InterestSection content={section.content} batches={data.catalogue} />;
    case "customHtml":
      return <CustomHtmlSection content={section.content} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------- hero

// Three admin-selectable arrangements of the same content — content.heroLayout,
// default "classic" (today's centered layout, unchanged). None of the three
// invent numbers: "split" and "centeredCards" both draw their decorative
// panels from real, live data (data.catalogue's batches, or the same fixed
// feature set CatalogueSection's modal already shows), never a fabricated
// stat.
function HeroSection({ content, batches, onLogin }) {
  const theme = useTheme();
  const layout = content.heroLayout || "classic";

  if (layout === "split") return <HeroSplit content={content} batches={batches} onLogin={onLogin} theme={theme} />;
  if (layout === "centeredCards") return <HeroCenteredCards content={content} onLogin={onLogin} theme={theme} />;
  return <HeroClassic content={content} onLogin={onLogin} theme={theme} />;
}

function HeroClassic({ content, onLogin, theme }) {
  const bg = content.backgroundImageUrl;

  return (
    <Box
      sx={{
        position: "relative",
        py: { xs: 10, md: 16 },
        textAlign: "center",
        overflow: "hidden",
        backgroundImage: bg ? `url(${bg})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* A gradient wash, always present — over an admin's image (for
          contrast against whatever it happens to contain) or on its own
          (as the section's actual background when no image is set). */}
      <Box sx={{
        position: "absolute", inset: 0,
        background: bg
          ? `linear-gradient(180deg, ${alpha(theme.palette.background.default, 0.55)}, ${alpha(theme.palette.background.default, 0.92)})`
          : `radial-gradient(circle at 50% 0%, ${alpha(theme.palette.primary.main, 0.16)}, transparent 60%)`,
      }} />
      <Container maxWidth="md" sx={{ position: "relative" }}>
        <Typography
          variant="h2"
          sx={{ fontWeight: 700, fontSize: { xs: 32, sm: 44, md: 54 }, lineHeight: 1.15, mb: 2 }}
        >
          {content.heading || "Learn without limits"}
        </Typography>
        {content.subheading && (
          <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 400, mb: 4, maxWidth: 560, mx: "auto" }}>
            {content.subheading}
          </Typography>
        )}
        <Button variant="contained" size="large" endIcon={<ArrowRight size={18} />} onClick={onLogin} sx={{ px: 4, py: 1.25 }}>
          {content.ctaLabel || "Get started"}
        </Button>
      </Container>
    </Box>
  );
}

// Headline/CTA on the left, a decorative preview of up to three live batches
// on the right — real names, icons and prices pulled from the same
// data.catalogue the catalogue section renders below, never invented.
function HeroSplit({ content, batches, onLogin, theme }) {
  const bg = content.backgroundImageUrl;
  // An admin's chosen courses, in the order picked; falls back to the first
  // three live batches when none are picked (or a picked batch is no longer
  // live).
  const featuredIds = content.featuredBatchIds || [];
  const byId = new Map((batches || []).map((b) => [b._id, b]));
  const picked = featuredIds.map((id) => byId.get(id)).filter(Boolean);
  const preview = picked.length > 0 ? picked : (batches || []).slice(0, 3);

  return (
    <Box
      sx={{
        position: "relative", py: { xs: 8, md: 12 }, overflow: "hidden",
        backgroundImage: bg ? `url(${bg})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    >
      <Box sx={{
        position: "absolute", inset: 0,
        background: bg
          ? `linear-gradient(180deg, ${alpha(theme.palette.background.default, 0.55)}, ${alpha(theme.palette.background.default, 0.92)})`
          : `radial-gradient(circle at 0% 0%, ${alpha(theme.palette.primary.main, 0.14)}, transparent 55%)`,
      }} />
      <Container maxWidth="lg" sx={{ position: "relative" }}>
        <Grid container spacing={5} alignItems="center">
          <Grid item xs={12} md={6}>
            <Typography variant="h2" sx={{ fontWeight: 700, fontSize: { xs: 32, sm: 42, md: 48 }, lineHeight: 1.15, mb: 2 }}>
              {content.heading || "Learn without limits"}
            </Typography>
            {content.subheading && (
              <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 400, mb: 4, maxWidth: 480 }}>
                {content.subheading}
              </Typography>
            )}
            <Button variant="contained" size="large" endIcon={<ArrowRight size={18} />} onClick={onLogin} sx={{ px: 4, py: 1.25 }}>
              {content.ctaLabel || "Get started"}
            </Button>
          </Grid>

          {preview.length > 0 && (
            <Grid item xs={12} md={6}>
              <Box className="examai-card" sx={{
                borderRadius: 3, bgcolor: "background.paper",
                boxShadow: 3, p: 2, display: "flex", flexDirection: "column", gap: 1.25,
              }}>
                <Typography variant="caption" color="text.secondary" sx={{ px: 0.5, fontWeight: 500 }}>
                  Featured courses
                </Typography>
                {preview.map((batch) => (
                  <Box
                    key={batch._id}
                    sx={{
                      display: "flex", alignItems: "center", gap: 1.5, p: 1.25, borderRadius: 2,
                      bgcolor: alpha(theme.palette.primary.main, 0.06),
                    }}
                  >
                    <BatchLogo batch={batch} size={36} theme={theme} />
                    <Typography sx={{ flex: 1, fontWeight: 500, fontSize: 14 }} noWrap>{batch.name}</Typography>
                    {batch.plans?.length > 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        From {Math.min(...batch.plans.map((p) => p.price))}
                      </Typography>
                    ) : (
                      <Chip size="small" label={batch.accessType === "free" ? "Free" : "Paid"} sx={{ height: 20 }} />
                    )}
                  </Box>
                ))}
              </Box>
            </Grid>
          )}
        </Grid>
      </Container>
    </Box>
  );
}

// A centered headline/CTA over a wash, with four feature cards below in
// place of a numeric stats strip — the same fixed lectures/practice/exams/
// AI-help feature set FEATURE_ICONS already uses in the catalogue modal, so
// nothing here is a made-up figure.
function HeroCenteredCards({ content, onLogin, theme }) {
  const highlights = FEATURE_ICONS.filter(([key]) => key !== "doubtSolving");
  const bg = content.backgroundImageUrl;

  return (
    <Box
      sx={{
        position: "relative", py: { xs: 8, md: 12 }, textAlign: "center", overflow: "hidden",
        backgroundImage: bg ? `url(${bg})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}
    >
      <Box sx={{
        position: "absolute", inset: 0,
        background: bg
          ? `linear-gradient(180deg, ${alpha(theme.palette.background.default, 0.55)}, ${alpha(theme.palette.background.default, 0.92)})`
          : `radial-gradient(circle at 50% 0%, ${alpha(theme.palette.primary.main, 0.18)}, transparent 60%)`,
      }} />
      <Container maxWidth="md" sx={{ position: "relative" }}>
        <Typography variant="h2" sx={{ fontWeight: 700, fontSize: { xs: 32, sm: 44, md: 52 }, lineHeight: 1.15, mb: 2 }}>
          {content.heading || "Learn without limits"}
        </Typography>
        {content.subheading && (
          <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 400, mb: 4, maxWidth: 560, mx: "auto" }}>
            {content.subheading}
          </Typography>
        )}
        <Button variant="contained" size="large" endIcon={<ArrowRight size={18} />} onClick={onLogin} sx={{ px: 4, py: 1.25, mb: 6 }}>
          {content.ctaLabel || "Get started"}
        </Button>

        <Grid container spacing={2}>
          {highlights.map(([key, label, Icon]) => (
            <Grid item xs={6} sm={3} key={key}>
              <Box className="examai-card" sx={{
                borderRadius: 2.5, bgcolor: "background.paper",
                py: 2.5, px: 1.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
              }}>
                <Icon size={22} color={theme.palette.primary.main} />
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{label}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- stats

function StatsSection({ content }) {
  const items = content.items || [];
  if (items.length === 0) return null;
  const layout = content.statsLayout || "classic";

  if (layout === "cards") return <StatsCards items={items} />;
  if (layout === "inline") return <StatsInline items={items} />;
  return <StatsClassic items={items} />;
}

function StatsClassic({ items }) {
  return (
    <Box sx={{ py: { xs: 6, md: 8 } }}>
      <Container maxWidth="lg">
        <Grid container spacing={4} justifyContent="center">
          {items.map((item, i) => (
            <Grid item xs={6} sm={3} key={i} sx={{ textAlign: "center" }}>
              <Typography variant="h3" color="primary" sx={{ fontWeight: 700, fontSize: { xs: 28, md: 40 } }}>
                {item.value}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {item.label}
              </Typography>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

function StatsCards({ items }) {
  return (
    <Box sx={{ py: { xs: 6, md: 8 } }}>
      <Container maxWidth="lg">
        <Grid container spacing={2.5} justifyContent="center">
          {items.map((item, i) => (
            <Grid item xs={6} sm={3} key={i}>
              <Box className="examai-card" sx={{
                borderRadius: 3, bgcolor: "background.paper",
                textAlign: "center", py: 3, px: 1.5,
              }}>
                <Typography variant="h4" color="primary" sx={{ fontWeight: 700, fontSize: { xs: 24, md: 32 } }}>
                  {item.value}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {item.label}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

function StatsInline({ items }) {
  return (
    <Box sx={{ py: { xs: 3, md: 4 }, borderTop: "1px solid", borderBottom: "1px solid", borderColor: "divider" }}>
      <Container maxWidth="lg">
        <Box sx={{ display: "flex", justifyContent: "center", flexWrap: "wrap" }}>
          {items.map((item, i) => (
            <Box
              key={i}
              sx={{
                display: "flex", alignItems: "baseline", gap: 1, px: { xs: 2, md: 3 }, py: 1,
                borderLeft: i > 0 ? "1px solid" : "none", borderColor: "divider",
              }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: 20 }} color="primary">{item.value}</Typography>
              <Typography variant="body2" color="text.secondary">{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- catalogue

// Same feature-to-icon mapping CourseCatalogue.jsx (the logged-in version)
// uses — a student who already knows what these mean from that view
// shouldn't see different symbols for the same thing here.
const FEATURE_ICONS = [
  ["lectures", "Lectures", PlayCircle],
  ["practice", "Practice", Dumbbell],
  ["exams", "Exams", PenLine],
  ["doubtSolving", "Doubt solving", HelpCircle],
  ["aiAssist", "AI help", Zap],
];

// A public-facing cousin of CourseCatalogue.jsx's card style, not the
// component itself — that one is keyed entirely on this student's
// enrollment status (a concept that doesn't exist for a logged-out
// visitor). Clicking a card opens the same kind of details view that
// component shows via "View more", just always in its not-yet-owned
// shape, with every action inside it leading to login rather than a
// purchase page.
function CatalogueSection({ content, batches, currency, onLogin }) {
  const theme = useTheme();
  const [modalBatch, setModalBatch] = useState(null);
  // Course pages on (Settings → SEO): a card opens the course's own page
  // instead of the pop-up.
  const { seo } = useBranding();
  const navigate = useNavigate();
  const open = (batch) => (seo?.coursePages && batch?.slug ? navigate(`/courses/${encodeURIComponent(batch.slug)}`) : setModalBatch(batch));
  if (!batches || batches.length === 0) return null;
  const layout = content.catalogueLayout || "grid";
  const cardStyle = content.catalogueCard || "classic";

  const byProgram = new Map();
  for (const batch of batches) {
    const key = batch.program?._id || "none";
    if (!byProgram.has(key)) byProgram.set(key, { program: batch.program, batches: [] });
    byProgram.get(key).batches.push(batch);
  }
  const groups = [...byProgram.values()];

  return (
    <Box sx={{ py: { xs: 6, md: 10 } }}>
      <Container maxWidth="lg">
        <Box sx={{ textAlign: "center", mb: 5 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            {content.heading || "Explore our courses"}
          </Typography>
          {content.subheading && <Typography color="text.secondary">{content.subheading}</Typography>}
        </Box>

        {groups.map(({ program, batches: programBatches }) => (
          <Box key={program?._id || "none"} sx={{ mb: 5 }}>
            {program && (
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>{program.title}</Typography>
            )}
            {layout === "list" ? (
              <CatalogueList batches={programBatches} currency={currency} onOpen={open} theme={theme} />
            ) : layout === "carousel" ? (
              <CatalogueCarousel batches={programBatches} currency={currency} onOpen={open} theme={theme} cardStyle={cardStyle} />
            ) : (
              <CatalogueGrid batches={programBatches} currency={currency} onOpen={open} theme={theme} cardStyle={cardStyle} />
            )}
          </Box>
        ))}
      </Container>

      <PublicBatchDetailsModal batch={modalBatch} onClose={() => setModalBatch(null)} onLogin={onLogin} theme={theme} />
    </Box>
  );
}

// A batch's logo at a size that reads: an uploaded logo fills the whole
// tile edge to edge; a preset icon sits in a tinted tile. (BatchIcon draws
// a preset at 55% of its size, so a 18px call gave a 10px icon.)
function BatchLogo({ batch, size, theme }) {
  const custom = batch.icon?.kind === "custom" && batch.icon.value;
  return (
    <Box sx={{
      width: size, height: size, flexShrink: 0, borderRadius: size >= 44 ? 2.5 : 2, overflow: "hidden",
      bgcolor: custom ? "transparent" : alpha(theme.palette.primary.main, 0.1),
      color: "primary.main", display: "flex", alignItems: "center", justifyContent: "center",
      border: custom ? "1px solid" : "none", borderColor: "divider",
    }}>
      <BatchIcon icon={batch.icon} size={size} />
    </Box>
  );
}

// The card the grid and carousel layouts share — only the container around
// it differs (a wrapping Grid vs. a horizontally scrolling flex row).
// The icon badge used to overlap the image/content boundary via a negative
// offset — a fixed-pixel trick that assumed a fixed text line height. A
// visitor with larger system text (common on phones) gets a taller title
// line without the padding around it growing to match, and the two would
// sometimes collide. Keeping the icon inline with the title instead removes
// the assumption entirely: whatever the title's line height turns out to
// be, there's nothing positioned to land on top of it.
// The card's look (catalogue section → Card style): "classic" (the
// program's photo over the batch's logo), "logo" (the batch's logo alone on
// a tinted cover) or "photo" (the program's photo alone, words over it).
// The two alternatives never show both pictures at once.
const priceLine = (batch, currency) =>
  batch.accessType === "free" ? "Free" : batch.plans?.length > 0 ? `From ${Math.min(...batch.plans.map((p) => p.price))} ${currency}` : null;

function CatalogueCard({ batch, currency, onOpen, theme, cardStyle = "classic" }) {
  if (cardStyle === "logo") return <LogoCatalogueCard batch={batch} currency={currency} onOpen={onOpen} theme={theme} />;
  if (cardStyle === "photo") return <PhotoCatalogueCard batch={batch} currency={currency} onOpen={onOpen} theme={theme} />;
  return (
    <Box
      onClick={() => onOpen(batch)}
      className="examai-card"
      sx={{
        cursor: "pointer", borderRadius: 3, overflow: "hidden", height: "100%",
        bgcolor: "background.paper",
        transition: "transform 150ms ease, box-shadow 150ms ease",
        "&:hover": { transform: "translateY(-3px)", boxShadow: 4 },
      }}
    >
      <Box sx={{ height: 120, bgcolor: alpha(theme.palette.primary.main, 0.08), display: "flex", alignItems: "center", justifyContent: "center" }}>
        {batch.program?.image?.url ? (
          <Box component="img" src={batch.program.image.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : batch.icon?.value ? (
          // No program photo: the batch's own logo is the cover.
          <BatchLogo batch={batch} size={80} theme={theme} />
        ) : (
          <ProgramCoverFallback />
        )}
      </Box>
      <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
        <BatchLogo batch={batch} size={48} theme={theme} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }} noWrap>{batch.name}</Typography>
          {batch.plans?.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              From {Math.min(...batch.plans.map((p) => p.price))} {currency}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// The batch's logo is the whole cover: no photo competing with it.
function LogoCatalogueCard({ batch, currency, onOpen, theme }) {
  const accent = theme.palette.primary.main;
  const price = priceLine(batch, currency);
  return (
    <Box
      onClick={() => onOpen(batch)}
      className="examai-card"
      sx={{
        cursor: "pointer", borderRadius: 3, overflow: "hidden", height: "100%",
        bgcolor: "background.paper", display: "flex", flexDirection: "column",
        transition: "transform 150ms ease, box-shadow 150ms ease",
        "&:hover": { transform: "translateY(-3px)", boxShadow: 4 },
      }}
    >
      <Box sx={{
        height: 140, position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
        background: `linear-gradient(150deg, ${alpha(accent, 0.24)}, ${alpha(accent, 0.05)})`,
      }}>
        <Box sx={{ position: "absolute", width: 170, height: 170, borderRadius: "50%", background: `radial-gradient(circle, ${alpha(accent, 0.18)}, transparent 70%)` }} />
        {batch.program?.title && (
          <Box sx={{
            position: "absolute", top: 10, left: 10, px: 1, py: 0.25, borderRadius: 99, maxWidth: "70%",
            bgcolor: alpha(theme.palette.background.paper, 0.85), fontSize: 11.5, fontWeight: 500, color: "text.secondary",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{batch.program.title}</Box>
        )}
        <Box sx={{ position: "relative", boxShadow: `0 8px 24px ${alpha(accent, 0.25)}`, borderRadius: 2.5 }}>
          <BatchLogo batch={batch} size={84} theme={theme} />
        </Box>
      </Box>
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15.5, lineHeight: 1.3 }}>{batch.name}</Typography>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          {FEATURE_ICONS.filter(([key]) => batch.features?.[key]).map(([key, label, Icon]) => (
            <Box key={key} title={label} sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: alpha(theme.palette.text.primary, 0.06), display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon size={12} style={{ opacity: 0.7 }} />
            </Box>
          ))}
        </Box>
        <Box sx={{ mt: "auto", pt: 0.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: accent }}>{price || ""}</Typography>
          <ChevronRight size={16} color={theme.palette.text.secondary} />
        </Box>
      </Box>
    </Box>
  );
}

// The program's photo is the whole card, with the batch's name over it.
function PhotoCatalogueCard({ batch, currency, onOpen, theme }) {
  const price = priceLine(batch, currency);
  return (
    <Box
      onClick={() => onOpen(batch)}
      className="examai-card"
      sx={{
        cursor: "pointer", borderRadius: 3, overflow: "hidden", position: "relative", height: "100%", minHeight: 230,
        bgcolor: alpha(theme.palette.primary.main, 0.1),
        transition: "transform 150ms ease, box-shadow 150ms ease",
        "&:hover": { transform: "translateY(-3px)", boxShadow: 4 },
        "&:hover img": { transform: "scale(1.04)" },
      }}
    >
      <Box sx={{ position: "absolute", inset: 0 }}>
        {batch.program?.image?.url ? (
          <Box component="img" src={batch.program.image.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 400ms ease" }} />
        ) : (
          <ProgramCoverFallback />
        )}
      </Box>
      <Box sx={{
        position: "absolute", inset: 0, p: 2, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 0.5,
        background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.35) 45%, transparent 75%)",
      }}>
        {batch.program?.title && (
          <Typography sx={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.6 }} noWrap>
            {batch.program.title}
          </Typography>
        )}
        <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 18, lineHeight: 1.25 }}>{batch.name}</Typography>
        {price && (
          <Box sx={{ mt: 0.75, alignSelf: "flex-start", px: 1.25, py: 0.4, borderRadius: 99, bgcolor: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)", color: "#fff", fontSize: 12.5, fontWeight: 600 }}>
            {price}
          </Box>
        )}
      </Box>
    </Box>
  );
}

function CatalogueGrid({ batches, currency, onOpen, theme, cardStyle }) {
  return (
    <Grid container spacing={2.5}>
      {batches.map((batch) => (
        <Grid item xs={12} sm={6} md={4} key={batch._id}>
          <CatalogueCard batch={batch} currency={currency} onOpen={onOpen} theme={theme} cardStyle={cardStyle} />
        </Grid>
      ))}
    </Grid>
  );
}

function CatalogueCarousel({ batches, currency, onOpen, theme, cardStyle }) {
  const trackRef = useRef(null);
  const scrollBy = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: "smooth" });
  };

  return (
    <Box sx={{ position: "relative", mx: { xs: -2, sm: 0 } }}>
      <Box
        ref={trackRef}
        sx={{
          display: "flex", gap: 2.5, overflowX: "auto",
          scrollSnapType: "x mandatory", scrollPadding: "0 4px",
          px: { xs: 2, sm: 0.5 }, py: 1,
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {batches.map((batch) => (
          <Box key={batch._id} sx={{ flex: "0 0 auto", width: { xs: 250, sm: 280 }, scrollSnapAlign: "start" }}>
            <CatalogueCard batch={batch} currency={currency} onOpen={onOpen} theme={theme} cardStyle={cardStyle} />
          </Box>
        ))}
      </Box>

      {batches.length > 2 && (
        <>
          <IconButton
            size="small" onClick={() => scrollBy(-1)} aria-label="Scroll left"
            sx={{
              display: { xs: "none", sm: "inline-flex" },
              position: "absolute", top: "38%", left: -18, transform: "translateY(-50%)",
              bgcolor: "background.paper", border: "1px solid", borderColor: "divider", boxShadow: 2,
              "&:hover": { bgcolor: "background.paper" },
            }}
          >
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton
            size="small" onClick={() => scrollBy(1)} aria-label="Scroll right"
            sx={{
              display: { xs: "none", sm: "inline-flex" },
              position: "absolute", top: "38%", right: -18, transform: "translateY(-50%)",
              bgcolor: "background.paper", border: "1px solid", borderColor: "divider", boxShadow: 2,
              "&:hover": { bgcolor: "background.paper" },
            }}
          >
            <ChevronRight size={18} />
          </IconButton>
        </>
      )}
    </Box>
  );
}

function CatalogueList({ batches, currency, onOpen, theme }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {batches.map((batch) => (
        <Box
          key={batch._id}
          onClick={() => onOpen(batch)}
          sx={{
            cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5, p: 1.5,
            borderRadius: 2, border: "1px solid", borderColor: "divider", bgcolor: "background.paper",
            transition: "border-color 150ms ease",
            "&:hover": { borderColor: alpha(theme.palette.primary.main, 0.4) },
          }}
        >
          <BatchLogo batch={batch} size={44} theme={theme} />
          <Typography sx={{ flex: 1, fontWeight: 500, fontSize: 14 }} noWrap>{batch.name}</Typography>
          {batch.plans?.length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              From {Math.min(...batch.plans.map((p) => p.price))} {currency}
            </Typography>
          )}
          <ChevronRight size={16} color={theme.palette.text.secondary} />
        </Box>
      ))}
    </Box>
  );
}

// The same layout as CourseCatalogue.jsx's BatchDetailsModal — cover image,
// feature chips, program/batch descriptions, plan prices — but always in
// its not-yet-owned shape (there's no "already enrolled" for a logged-out
// visitor) and with the closing action leading to login instead of a
// purchase page, since actually buying requires an account either way.
function PublicBatchDetailsModal({ batch, onClose, onLogin, theme }) {
  if (!batch) return null;
  const accent = theme.palette.primary.main;

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
          {batch.accessType === "free" ? <Gift size={14} /> : <Tag size={14} />}
          <Typography variant="body2" sx={{ fontWeight: 500, color: accent }}>
            {batch.accessType === "free" ? "Free" : "Paid"}
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

        <PublicBatchTeachers teachers={batch.teachers} />

        {batch.plans?.length > 0 && (
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

        <Button fullWidth variant="contained" onClick={onLogin}>
          Log in to view plans
        </Button>
      </Box>
    </Dialog>
  );
}

function PublicBatchTeachers({ teachers }) {
  const terms = useTerms();
  return <TeacherStrip teachers={teachers} label={terms.Teachers} sx={{ mb: 2 }} />;
}

function AboutSection({ content }) {
  if (!content.heading && !content.body) return null;
  const layout = content.aboutLayout || "classic";

  if (layout === "centered") return <AboutCentered content={content} />;

  // "classic" and "imageRight" are the same two-column layout, just with the
  // image column on the other side.
  const imageFirst = layout !== "imageRight";
  const textCol = (
    <Grid item xs={12} sm={content.imageUrl ? 7 : 12}>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>{content.heading || "About us"}</Typography>
      {content.body && <SafeMarkdown>{content.body}</SafeMarkdown>}
    </Grid>
  );
  const imageCol = content.imageUrl && (
    <Grid item xs={12} sm={5}>
      <Box component="img" src={content.imageUrl} alt="" sx={{ width: "100%", borderRadius: 3, display: "block" }} />
    </Grid>
  );

  return (
    <Box sx={{ py: { xs: 6, md: 10 } }}>
      <Container maxWidth="md">
        <Grid container spacing={4} alignItems="center" direction={imageFirst ? "row" : "row-reverse"}>
          {imageCol}
          {textCol}
        </Grid>
      </Container>
    </Box>
  );
}

function AboutCentered({ content }) {
  return (
    <Box sx={{ py: { xs: 6, md: 10 }, textAlign: "center" }}>
      <Container maxWidth="sm">
        {content.imageUrl && (
          <Box component="img" src={content.imageUrl} alt="" sx={{ width: "100%", maxWidth: 420, mx: "auto", borderRadius: 3, display: "block", mb: 3 }} />
        )}
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>{content.heading || "About us"}</Typography>
        {content.body && <SafeMarkdown>{content.body}</SafeMarkdown>}
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- referral banner

// A visitor who came by a friend's link (site/r/CODE): what the code gives
// them and how to use it. Nothing when there's no code or it doesn't apply.
function ReferralBanner() {
  const navigate = useNavigate();
  const code = savedRef();
  const { data } = useCheckReferralQuery(code, { skip: !code });
  if (!data?.valid) return null;
  const off = data.discountType === "percent" ? `${data.discountValue}%` : `${data.currency} ${data.discountValue}`;
  return (
    <Container maxWidth="md" sx={{ pt: 2 }}>
      <Alert
        severity="success"
        icon={<Gift size={20} />}
        action={<Button color="inherit" size="small" onClick={() => navigate("/register")}>Sign up</Button>}
      >
        A friend invited you: <strong>{off} off</strong> {data.newStudentsOnly ? "your first course" : "a course"}. Sign up and code <strong>{data.code}</strong> is filled in when you pick a plan.
      </Alert>
    </Container>
  );
}

// ---------------------------------------------------------------- interest form

// Name and number (or email), optionally a course: saved as a lead for
// staff to follow up (backend utils/leads.js).
function InterestSection({ content, batches = [] }) {
  const [submit, { isLoading, isSuccess, error }] = useSubmitLeadMutation();
  const [form, setForm] = useState({ name: "", phone: "", email: "", batch: "", message: "", website: "" });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const options = batches.filter((b) => b?._id && b?.name);
  const shownAt = useRef(Date.now()); // the bot check: too fast is a bot

  const send = (e) => {
    e.preventDefault();
    submit({ ...form, elapsed: Date.now() - shownAt.current, source: "landing", ref: savedRef() || undefined }).catch(() => {});
  };

  return (
    <Box id="interest" sx={{ py: { xs: 6, md: 10 } }}>
      <Container maxWidth="sm">
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>{content.heading || "Want to know more?"}</Typography>
          {content.subheading && <Typography color="text.secondary" sx={{ mb: 3 }}>{content.subheading}</Typography>}
          {isSuccess ? (
            <Alert severity="success">{content.thanks || "Thanks! We'll be in touch soon."}</Alert>
          ) : (
            <Box component="form" onSubmit={send} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField label="Your name" value={form.name} onChange={(e) => set({ name: e.target.value })} required inputProps={{ maxLength: 80 }} />
              <TextField label="Phone number" type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })}
                required={!content.askEmail} inputProps={{ maxLength: 20 }} />
              {content.askEmail && (
                <TextField label="Email (optional)" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} inputProps={{ maxLength: 120 }} />
              )}
              {content.askBatch !== false && options.length > 0 && (
                <PickField label="Course you're interested in" value={form.batch} onChange={(v) => set({ batch: v })}
                  emptyLabel="Not sure yet" options={options.map((b) => ({ value: b._id, label: b.name }))} fullWidth />
              )}
              {content.askMessage && (
                <TextField label="Anything you'd like to ask (optional)" multiline minRows={2} value={form.message} onChange={(e) => set({ message: e.target.value })} inputProps={{ maxLength: 500 }} />
              )}
              {/* Hidden from people; bots fill it in. */}
              <input type="text" name="examai_hp_field" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" value={form.website}
                onChange={(e) => set({ website: e.target.value })} style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} aria-hidden="true" />
              {error && <Alert severity="error">{error.data?.message || "Couldn't send. Please try again."}</Alert>}
              <Button type="submit" variant="contained" size="large" disabled={isLoading}>
                {isLoading ? "Sending…" : content.button || "Call me back"}
              </Button>
            </Box>
          )}
        </Paper>
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- faq

function FaqSection({ content }) {
  const items = content.items || [];
  if (items.length === 0) return null;
  const layout = content.faqLayout || "accordion";

  if (layout === "twoColumn") return <FaqTwoColumn heading={content.heading} items={items} />;
  if (layout === "cards") return <FaqCards heading={content.heading} items={items} />;
  return <FaqAccordion heading={content.heading} items={items} />;
}

function FaqAccordion({ heading, items }) {
  return (
    <Box sx={{ py: { xs: 6, md: 8 } }}>
      <Container maxWidth="sm">
        {heading && (
          <Typography variant="h4" sx={{ fontWeight: 700, textAlign: "center", mb: 3 }}>{heading}</Typography>
        )}
        {items.map((item, i) => (
          <Accordion
            key={i}
            disableGutters
            elevation={0}
            sx={{
              bgcolor: "transparent", "&:before": { display: "none" },
              borderBottom: "1px solid", borderColor: "divider",
            }}
          >
            <AccordionSummary expandIcon={<ChevronDown size={18} />}>
              <Typography sx={{ fontWeight: 500, fontSize: 15 }}>{item.question}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary">{item.answer}</Typography>
            </AccordionDetails>
          </Accordion>
        ))}
      </Container>
    </Box>
  );
}

function FaqTwoColumn({ heading, items }) {
  return (
    <Box sx={{ py: { xs: 6, md: 8 } }}>
      <Container maxWidth="md">
        {heading && (
          <Typography variant="h4" sx={{ fontWeight: 700, textAlign: "center", mb: 4 }}>{heading}</Typography>
        )}
        <Grid container spacing={3}>
          {items.map((item, i) => (
            <Grid item xs={12} sm={6} key={i}>
              <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 0.75 }}>{item.question}</Typography>
              <Typography variant="body2" color="text.secondary">{item.answer}</Typography>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

function FaqCards({ heading, items }) {
  return (
    <Box sx={{ py: { xs: 6, md: 8 } }}>
      <Container maxWidth="sm">
        {heading && (
          <Typography variant="h4" sx={{ fontWeight: 700, textAlign: "center", mb: 3 }}>{heading}</Typography>
        )}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {items.map((item, i) => (
            <Box key={i} className="examai-card" sx={{
              display: "flex", gap: 1.5, p: 2.5, borderRadius: 2,
              bgcolor: "background.paper",
            }}>
              <HelpCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <Box>
                <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 0.5 }}>{item.question}</Typography>
                <Typography variant="body2" color="text.secondary">{item.answer}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- notices

const NOTICE_AUTO_ADVANCE_MS = 6000;

// The same hand-rolled carousel GeneralNoticeCarousel.jsx uses for logged-in
// students, reusing the exact same NoticeCard — not duplicated logic, just
// fed from the public data this page already fetched instead of that
// component's own (authenticated) query.
function NoticesSection({ content, notices }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!notices || notices.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % notices.length), NOTICE_AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
  }, [notices?.length]);

  if (!notices || notices.length === 0) return null;

  const go = (delta) => setIndex((i) => (i + delta + notices.length) % notices.length);

  return (
    <Box sx={{ py: { xs: 6, md: 8 } }}>
      <Container maxWidth="sm">
        {content.heading && (
          <Typography variant="h5" sx={{ fontWeight: 700, textAlign: "center", mb: 3 }}>{content.heading}</Typography>
        )}
        <Box sx={{ position: "relative" }}>
          <NoticeCard notice={notices[index]} />
          {notices.length > 1 && (
            <>
              <IconButton
                size="small" onClick={() => go(-1)} aria-label="Previous notice"
                sx={{ position: "absolute", top: "56px", left: 4, transform: "translateY(-50%)", bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "background.paper" } }}
              >
                <ChevronLeft size={16} />
              </IconButton>
              <IconButton
                size="small" onClick={() => go(1)} aria-label="Next notice"
                sx={{ position: "absolute", top: "56px", right: 4, transform: "translateY(-50%)", bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "background.paper" } }}
              >
                <ChevronRight size={16} />
              </IconButton>
            </>
          )}
        </Box>
        {notices.length > 1 && (
          <Box sx={{ display: "flex", justifyContent: "center", gap: 0.75, mt: 1.25 }}>
            {notices.map((n, i) => (
              <Box
                key={i}
                component="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to notice ${i + 1}`}
                sx={{
                  width: i === index ? 16 : 6, height: 6, borderRadius: 3, border: "none", cursor: "pointer", p: 0,
                  bgcolor: i === index ? "primary.main" : "action.disabled", transition: "width 200ms ease",
                }}
              />
            ))}
          </Box>
        )}
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- updates

function UpdatesSection({ content, updates }) {
  if (!updates || updates.length === 0) return null;

  const isExternal = (url) => {
    try { return new URL(url, window.location.origin).origin !== window.location.origin; } catch { return false; }
  };

  return (
    <Box sx={{ py: { xs: 6, md: 8 }, bgcolor: "action.hover" }}>
      <Container maxWidth="md">
        {content.heading && (
          <Typography variant="h5" sx={{ fontWeight: 700, textAlign: "center", mb: 3 }}>{content.heading}</Typography>
        )}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {updates.map((u, i) => (
            <Box key={i} className="examai-card" sx={{ p: 2.5, borderRadius: 2, bgcolor: "background.paper" }}>
              <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2, flexWrap: "wrap" }}>
                <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{u.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(u.publishedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </Typography>
              </Box>
              {u.body && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{u.body}</Typography>}
              {u.link && (
                <Button
                  size="small" endIcon={isExternal(u.link) ? <ExternalLink size={13} /> : <ArrowRight size={13} />}
                  href={u.link} target={isExternal(u.link) ? "_blank" : undefined} rel="noopener noreferrer"
                  sx={{ mt: 1, px: 0 }}
                >
                  Read more
                </Button>
              )}
            </Box>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- footer

// Same content shape as before (content.text, content.links — see the
// admin editor's FooterEditor and landingPageModel.js's default section),
// just laid out with more structure: brand mark on its own row, links given
// room to breathe instead of squeezed onto one line with the tagline, a
// real divider, and a dated copyright line closing it out. Nothing new to
// configure — an install that never touched this section gets the same
// upgrade automatically.
function FooterSection({ content }) {
  const { siteName, logo } = useBranding();
  const links = content.links || [];
  const year = new Date().getFullYear();

  return (
    <Box component="footer" sx={{ borderTop: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}>
      <Container maxWidth="lg" sx={{ py: { xs: 5, sm: 6 } }}>
        <Box sx={{
          display: "flex", flexDirection: { xs: "column", sm: "row" },
          justifyContent: "space-between", alignItems: { xs: "flex-start", sm: "center" },
          gap: 3, pb: content.text || links.length > 0 ? 4 : 0,
        }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            {logo ? (
              <Box component="img" src={logo} alt={siteName} sx={{ height: 28 }} />
            ) : (
              <Typography sx={{ fontWeight: 700, fontSize: 17 }}>{siteName}</Typography>
            )}
          </Box>

          {links.length > 0 && (
            <Box sx={{ display: "flex", gap: { xs: 2, sm: 4 }, flexWrap: "wrap" }}>
              {links.map((link, i) => (
                <Typography
                  key={i} component="a" href={link.url} target="_blank" rel="noopener noreferrer"
                  variant="body2" color="text.secondary"
                  sx={{ textDecoration: "none", fontWeight: 500, "&:hover": { color: "text.primary" } }}
                >
                  {link.label}
                </Typography>
              ))}
            </Box>
          )}
        </Box>

        {content.text && (
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mb: 3, lineHeight: 1.7 }}>
            {content.text}
          </Typography>
        )}

        <Divider sx={{ mb: 3 }} />

        <Typography variant="caption" color="text.secondary">
          © {year} {siteName}. All rights reserved.
        </Typography>
      </Container>
    </Box>
  );
}

// ---------------------------------------------------------------- custom html

// Rendered exactly as an admin wrote it — no sanitizing, matching what the
// admin editor itself warns about (see LandingPage.jsx's SectionEditor in
// the admin panel). This is the one place in the whole student app that
// touches dangerouslySetInnerHTML, and deliberately so: it exists
// specifically to let an admin embed markup this app has no built-in way
// to express, at the cost of trusting whoever has owner/admin access not
// to paste something malicious.
//
// A browser never executes a <script> tag that arrives via innerHTML —
// true of plain DOM, not a React quirk — so a block with a <script> in it
// (a quiz, a countdown, anything interactive) rendered inert: the markup
// and <style> showed up, nothing it scripted ever ran. Fixed by walking
// the injected DOM after it mounts, and for every <script> tag replacing
// it with a freshly created one (script elements only run when created and
// appended this way, whether inline or via src) with the same attributes
// and body. Runs once per distinct `content.html` — not on every render —
// so a script that sets up its own state (like the quiz's timer) doesn't
// get torn down and restarted on an unrelated re-render.
function CustomHtmlSection({ content }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.querySelectorAll("script").forEach((oldScript) => {
      const newScript = document.createElement("script");
      for (const attr of oldScript.attributes) {
        newScript.setAttribute(attr.name, attr.value);
      }
      newScript.text = oldScript.text;
      oldScript.replaceWith(newScript);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.html]);

  if (!content.html) return null;
  return <Box ref={hostRef} dangerouslySetInnerHTML={{ __html: content.html }} />;
}
