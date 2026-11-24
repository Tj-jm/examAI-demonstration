import { useMemo } from "react";
import { Box, Typography, Button, Container, CircularProgress, ThemeProvider, CssBaseline } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams, Link as RouterLink } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft } from "lucide-react";
import { useGetCoursePageQuery, useGetMeQuery } from "../api/authApi";
import { useBranding, useSales } from "../BrandingContext";
import { DESIGNS } from "../components/coursePage/CourseDesigns";
import { buildTheme } from "../theme/buildTheme";

// A course's own public page, /courses/<slug> (Settings → SEO → Course
// pages), in the design picked there. Open to everyone: a visitor is sent
// to sign up, a signed-in student to the course's plans. The server also
// writes this page's meta tags into the HTML (backend utils/pageMeta.js).
export default function CoursePage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { siteName, logo, design, mode, seo } = useBranding();
  const sales = useSales();
  const appTheme = useTheme();
  const { data, isLoading, error } = useGetCoursePageQuery(slug);
  const { data: me } = useGetMeQuery(undefined, { refetchOnMountOrArgChange: false });
  // Settings → SEO → Course pages can give these pages their own theme (a
  // preset or custom colours); otherwise they wear the app's. The app's
  // design, light/dark mode and fonts stay as they are.
  const own = data?.theme;
  const theme = useMemo(
    () => (own?.name ? buildTheme(own.name, mode, design, own.custom, appTheme.examai?.fonts || null) : appTheme),
    [own, mode, design, appTheme]
  );

  if (isLoading) return <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}><CircularProgress size={28} /></Box>;
  if (error || !data) {
    return (
      <Container maxWidth="sm" sx={{ py: 10, textAlign: "center" }}>
        <Typography sx={{ fontWeight: 700, fontSize: 22, mb: 1 }}>Course not found</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>It may have moved or isn't open right now.</Typography>
        <Button variant="contained" component={RouterLink} to="/">See all courses</Button>
      </Container>
    );
  }

  const course = sales ? data.course : { ...data.course, plans: [], noSales: true };
  const Design = DESIGNS[data.design] || DESIGNS.spotlight;
  const enroll = () => {
    if (me) navigate(sales ? `/purchases/${course._id}` : "/");
    else navigate(sales ? "/register" : "/login");
  };
  const ctaLabel = me ? (sales ? (course.accessType === "free" ? "Open course" : "See plans") : "Go to my courses") : sales ? (course.accessType === "free" ? "Join free" : "Enroll now") : "Log in";
  // The course's own tags from Settings → SEO, else made from the course.
  const tags = data.seo || {};
  const title = tags.metaTitle || `${course.name}${course.program?.title ? ` · ${course.program.title}` : ""} | ${siteName}`;
  const ogImage = tags.ogImage || course.program?.image?.url;
  // Same fallbacks as the server's tags (backend utils/pageMeta.js).
  const plain = (md) => String(md || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`~|$\\-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  const description = tags.metaDescription || plain(course.description || course.program?.description) || seo?.metaDescription || "";

  return (
    <ThemeProvider theme={theme}>
    {/* The page behind it too, while this page is open. */}
    {own?.name && <CssBaseline />}
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default", color: "text.primary" }}>
      <Helmet>
        <title>{title}</title>
        <meta property="og:title" content={title} />
        {description && <meta name="description" content={description} />}
        {description && <meta property="og:description" content={description} />}
        {tags.keywords?.length > 0 && <meta name="keywords" content={tags.keywords.join(", ")} />}
        {ogImage && <meta property="og:image" content={ogImage} />}
      </Helmet>
      <Box sx={{ position: "sticky", top: "env(safe-area-inset-top, 0px)", zIndex: 20, height: 64, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider", backdropFilter: "blur(8px)" }}>
        <Container maxWidth="lg" sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Box component={RouterLink} to="/" sx={{ display: "flex", alignItems: "center", gap: 1, color: "inherit", textDecoration: "none", minWidth: 0 }}>
            <ArrowLeft size={18} />
            {logo ? <Box component="img" src={logo} alt={siteName} sx={{ height: 30 }} /> : <Typography sx={{ fontWeight: 700 }} noWrap>{siteName}</Typography>}
          </Box>
          {me ? (
            <Button variant="outlined" component={RouterLink} to="/">My courses</Button>
          ) : (
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button component={RouterLink} to="/login">Log in</Button>
              {sales && <Button variant="contained" component={RouterLink} to="/register">Sign up</Button>}
            </Box>
          )}
        </Container>
      </Box>
      <Design course={course} related={data.related} currency={data.currency} onEnroll={enroll} ctaLabel={ctaLabel} />
    </Box>
    </ThemeProvider>
  );
}
