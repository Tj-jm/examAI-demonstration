import { Box, Typography, IconButton } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { ArrowLeft, Atom, FlaskConical, Sigma, BookOpen, Calculator, Lightbulb } from "lucide-react";
import { useBranding } from "../../BrandingContext";
import BatchIcon from "../../components/BatchIcon";

// Every auth screen shares this. Settings → Student app → Sign-in page
// design picks one of five looks (branding.authStyle):
//
//   hero     a coloured band with a scattered subject-icon motif, the form
//            card overlapping it (the original)
//   split    brand panel beside the form on a wide screen; a slim coloured
//            strip above it on a phone
//   minimal  logo, title and form on a plain page, nothing else
//   glass    a soft gradient page with a frosted card floating on it
//   bold     the whole page in the brand colour, a big heading, the form
//            in a white sheet rising from the bottom
//
// All of them use the theme's colours only, so changing the site's theme
// in Settings changes every look. An optional picture (branding.authImage)
// sits under the coloured areas, washed with the theme colour.

// A coloured area's background: the picture under a wash of `tint`, or the
// plain colour when there is no picture.
const withPicture = (image, tint, strength = 0.78) => image
  ? { backgroundImage: `linear-gradient(${alpha(tint, strength)}, ${alpha(tint, strength)}), url("${encodeURI(image)}")`, backgroundSize: "cover", backgroundPosition: "center" }
  : { background: tint };

const Motif = ({ scale = 1, opacity = 1 }) => (
  <Box aria-hidden sx={{ position: "absolute", inset: 0, pointerEvents: "none", opacity }}>
    <FlaskConical size={34 * scale} style={{ position: "absolute", top: "8%", right: "10%", opacity: 0.16, transform: "rotate(18deg)" }} />
    <Sigma size={26 * scale} style={{ position: "absolute", bottom: "10%", right: "28%", opacity: 0.14, transform: "rotate(-10deg)" }} />
    <Atom size={64 * scale} style={{ position: "absolute", bottom: -8, left: -8, opacity: 0.12 }} />
    <BookOpen size={22 * scale} style={{ position: "absolute", top: "40%", right: "45%", opacity: 0.12, transform: "rotate(8deg)" }} />
    {scale > 1 && <Calculator size={30 * scale} style={{ position: "absolute", top: "22%", left: "12%", opacity: 0.1, transform: "rotate(-14deg)" }} />}
    {scale > 1 && <Lightbulb size={28 * scale} style={{ position: "absolute", bottom: "26%", left: "40%", opacity: 0.1, transform: "rotate(12deg)" }} />}
  </Box>
);

const Brand = ({ branding, onColor, size = 26 }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.1 }}>
    {branding.logo ? (
      <Box component="img" src={branding.logo} alt="" sx={{ height: size, width: size, borderRadius: 1, objectFit: "cover" }} />
    ) : (
      <Box sx={{
        width: size, height: size, borderRadius: 1.2, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
        bgcolor: onColor ? "rgba(255,255,255,0.2)" : "primary.main", color: onColor ? "inherit" : "primary.contrastText",
      }}>
        <BatchIcon icon={{ kind: "preset", value: "GraduationCap" }} size={Math.round(size * 0.58)} />
      </Box>
    )}
    <Typography sx={{ fontSize: 14.5, fontWeight: 500 }}>{branding.siteName}</Typography>
  </Box>
);

const Back = ({ onBack, onColor }) => onBack ? (
  <IconButton
    onClick={onBack}
    size="small"
    aria-label="Back"
    sx={onColor
      ? { color: "inherit", bgcolor: "rgba(255,255,255,0.15)", mb: 2, "&:hover": { bgcolor: "rgba(255,255,255,0.25)" } }
      : { mb: 2, border: 1, borderColor: "divider" }}
  >
    <ArrowLeft size={16} />
  </IconButton>
) : null;

const Heading = ({ title, subtitle, big, center }) => (
  <Box sx={{ textAlign: center ? "center" : "left" }}>
    <Typography variant={big ? "h4" : "h5"} sx={{ fontWeight: big ? 700 : 500, lineHeight: 1.2 }}>{title}</Typography>
    {subtitle && <Typography sx={{ fontSize: 14, opacity: 0.8, mt: 0.5 }}>{subtitle}</Typography>}
  </Box>
);

function Hero({ branding, title, subtitle, onBack, children }) {
  const theme = useTheme();
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", p: { xs: 0, sm: 3 } }}>
      <Box sx={{ width: "100%", maxWidth: 420, bgcolor: "background.paper", borderRadius: { xs: 0, sm: 4 }, overflow: "hidden", minHeight: { xs: "100dvh", sm: "auto" } }}>
        <Box sx={{ position: "relative", overflow: "hidden", ...withPicture(branding.authImage, theme.palette.primary.main), color: "primary.contrastText", px: 3, pt: onBack ? 2.5 : 4, pb: 6 }}>
          {!branding.authImage && <Motif />}
          <Box sx={{ position: "relative" }}>
            <Back onBack={onBack} onColor />
            <Box sx={{ mb: 2 }}><Brand branding={branding} onColor /></Box>
            <Heading title={title} subtitle={subtitle} />
          </Box>
        </Box>
        <Box sx={{ p: 3, pt: 3.5, mt: -2.5, bgcolor: "background.paper", borderRadius: "20px 20px 0 0", position: "relative" }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function Split({ branding, title, subtitle, onBack, children }) {
  const theme = useTheme();
  const panel = `linear-gradient(150deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark || theme.palette.primary.main})`;
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: { xs: "column", md: "row" }, bgcolor: "background.paper" }}>
      <Box sx={{
        position: "relative", overflow: "hidden", color: "primary.contrastText",
        ...(branding.authImage ? withPicture(branding.authImage, theme.palette.primary.dark || theme.palette.primary.main, 0.55) : { background: panel }),
        flex: { md: "1 1 50%" }, px: { xs: 3, md: 6 }, py: { xs: 2.5, md: 6 },
        display: "flex", flexDirection: "column", justifyContent: { md: "space-between" },
      }}>
        {!branding.authImage && <Box sx={{ display: { xs: "none", md: "block" } }}><Motif scale={1.8} /></Box>}
        <Box sx={{ position: "relative" }}><Brand branding={branding} onColor size={30} /></Box>
        <Box sx={{ position: "relative", display: { xs: "none", md: "block" }, maxWidth: 420 }}>
          <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.15 }}>{branding.siteName}</Typography>
          {branding.tagline && <Typography sx={{ mt: 1.5, fontSize: 17, opacity: 0.85 }}>{branding.tagline}</Typography>}
        </Box>
      </Box>
      <Box sx={{ flex: { md: "1 1 50%" }, display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
        <Box sx={{ width: "100%", maxWidth: 400 }}>
          <Back onBack={onBack} />
          <Box sx={{ mb: 3 }}><Heading title={title} subtitle={subtitle} /></Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function Minimal({ branding, title, subtitle, onBack, children }) {
  const theme = useTheme();
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", p: 3, ...withPicture(branding.authImage, theme.palette.background.default, 0.9) }}>
      <Box sx={{ width: "100%", maxWidth: 380 }}>
        <Back onBack={onBack} />
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, mb: 3 }}>
          <Brand branding={branding} size={40} />
          <Heading title={title} subtitle={subtitle} center />
        </Box>
        <Box sx={{ p: { xs: 0, sm: 3 }, border: { xs: 0, sm: 1 }, borderColor: { sm: "divider" }, borderRadius: 3, bgcolor: { sm: "background.paper" } }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function Glass({ branding, title, subtitle, onBack, children }) {
  const theme = useTheme();
  const p = theme.palette;
  const blob = (color, pos) => ({ position: "absolute", width: 340, height: 340, borderRadius: "50%", background: color, filter: "blur(70px)", opacity: 0.55, ...pos });
  return (
    <Box sx={{
      minHeight: "100dvh", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", p: 2.5,
      ...(branding.authImage
        ? { backgroundImage: `url("${encodeURI(branding.authImage)}")`, backgroundSize: "cover", backgroundPosition: "center" }
        : { background: `linear-gradient(160deg, ${alpha(p.primary.main, 0.25)}, ${alpha(p.secondary?.main || p.primary.main, 0.2)})` }),
    }}>
      {!branding.authImage && <Box aria-hidden sx={blob(p.primary.main, { top: -120, left: -100 })} />}
      {!branding.authImage && <Box aria-hidden sx={blob(p.secondary?.main || p.primary.light, { bottom: -140, right: -100 })} />}
      <Box sx={{
        position: "relative", width: "100%", maxWidth: 410, p: 3.5, borderRadius: 5,
        bgcolor: alpha(p.background.paper, 0.72), backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
        border: `1px solid ${alpha(p.common.white, p.mode === "dark" ? 0.12 : 0.6)}`,
        boxShadow: `0 20px 60px ${alpha(p.common.black, 0.18)}`,
      }}>
        <Back onBack={onBack} />
        <Box sx={{ mb: 2.5 }}><Brand branding={branding} /></Box>
        <Box sx={{ mb: 3 }}><Heading title={title} subtitle={subtitle} /></Box>
        {children}
      </Box>
    </Box>
  );
}

function Bold({ branding, title, subtitle, onBack, children }) {
  const theme = useTheme();
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", ...withPicture(branding.authImage, theme.palette.primary.main, 0.7), color: "primary.contrastText", position: "relative", overflow: "hidden" }}>
      {!branding.authImage && <Motif scale={2.2} />}
      <Box sx={{ position: "relative", width: "100%", maxWidth: 480, mx: "auto", px: 3, pt: onBack ? 2.5 : 5, pb: 4 }}>
        <Back onBack={onBack} onColor />
        <Box sx={{ mb: 4 }}><Brand branding={branding} onColor size={30} /></Box>
        <Heading title={title} subtitle={subtitle} big />
      </Box>
      <Box sx={{
        position: "relative", flex: 1, width: "100%", maxWidth: 480, mx: "auto", color: "text.primary",
        bgcolor: "background.paper", borderRadius: { xs: "28px 28px 0 0", sm: 7 }, mb: { sm: 4 }, p: 3, pt: 4,
      }}>
        {children}
      </Box>
    </Box>
  );
}

const LOOKS = { hero: Hero, split: Split, minimal: Minimal, glass: Glass, bold: Bold };

export default function AuthShell(props) {
  const branding = useBranding();
  const Look = LOOKS[branding?.authStyle] || Hero;
  return <Look branding={branding} {...props} />;
}
