import { lazy, Suspense, useEffect, useMemo, useState, useRef } from "react";
import { ThemeProvider, CssBaseline, Box, Typography, Button, CircularProgress } from "@mui/material";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import ScrollToTop from "./components/ScrollToTop";
import PageViews from "./components/PageViews";
import PageFade from "./components/PageFade";
import { useGetSettingsQuery, useGetMeQuery } from "./api/authApi";
import { setErrorMessages } from "./utils/friendlyError";
import { buildTheme, DESIGN_FONTS } from "./theme/buildTheme";
import { BrandingContext } from "./BrandingContext";
import DemoLayer from "./demo/DemoLayer";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/auth/Login";
import { peekNext, loginTo } from "./utils/nextPath";
import Register from "./pages/auth/Register";
import ForgotPassword from "./pages/auth/ForgotPassword";
import Shell from "./layout/Shell";
import CampaignClick from "./components/CampaignClick";
import Dashboard from "./pages/Dashboard";
import ComingSoon from "./pages/ComingSoon";
import NativeFeel from "./native/NativeFeel";
import CalculatorHost from "./components/calculator/CalculatorHost";
import { isNative } from "./native/session";

// Pages load on first visit, so the landing page and login screen do not
// download the whole app. The pages a visit usually starts on stay eager.
const BatchHome = lazy(() => import("./pages/BatchHome"));
const LectureList = lazy(() => import("./pages/lectures/LectureList"));
const GoToItem = lazy(() => import("./pages/GoToItem"));
const LectureView = lazy(() => import("./pages/lectures/LectureView"));
const ExamList = lazy(() => import("./pages/exams/ExamList"));
const ExamRules = lazy(() => import("./pages/exams/ExamRules"));
const ExamTake = lazy(() => import("./pages/exams/ExamTake"));
const ExamResult = lazy(() => import("./pages/exams/ExamResult"));
const PracticeTopics = lazy(() => import("./pages/practice/PracticeTopics"));
const PracticeSession = lazy(() => import("./pages/practice/PracticeSession"));
const CodingProblems = lazy(() => import("./pages/coding/CodingProblems"));
const SlideDecks = lazy(() => import("./pages/slides/SlideDecks"));
const SlideDeckView = lazy(() => import("./pages/slides/SlideDeckView"));
const CodingProblem = lazy(() => import("./pages/coding/CodingProblem"));
const LearnTopics = lazy(() => import("./pages/learn/LearnTopics"));
const LearnCards = lazy(() => import("./pages/learn/LearnCards"));
const ArchiveHome = lazy(() => import("./pages/archive/ArchiveHome"));
const ArchiveBrowse = lazy(() => import("./pages/archive/ArchiveBrowse"));
const ArchiveStudyPlan = lazy(() => import("./pages/archive/ArchiveStudyPlan"));
const ArchiveCustomExamSetup = lazy(() => import("./pages/archive/ArchiveCustomExamSetup"));
const ArchiveSession = lazy(() => import("./pages/archive/ArchiveSession"));
const CustomExamSetup = lazy(() => import("./pages/exams/CustomExamSetup"));
const Results = lazy(() => import("./pages/results/Results"));
const DoubtList = lazy(() => import("./pages/doubts/DoubtList"));
const LiveClassList = lazy(() => import("./pages/liveClasses/LiveClassList"));
const AssignmentList = lazy(() => import("./pages/assignments/AssignmentList"));
const Grades = lazy(() => import("./pages/grades/Grades"));
const MyCertificates = lazy(() => import("./pages/certificates/MyCertificates"));
const VerifyCertificate = lazy(() => import("./pages/certificates/VerifyCertificate"));
const Webinar = lazy(() => import("./pages/webinar/Webinar"));
const CoursePage = lazy(() => import("./pages/CoursePage"));
const ProgressReport = lazy(() => import("./pages/progress/ProgressReport"));
const AssignmentView = lazy(() => import("./pages/assignments/AssignmentView"));
const LiveClassJoin = lazy(() => import("./pages/liveClasses/LiveClassJoin"));
const LiveRoom = lazy(() => import("./pages/liveClasses/LiveRoom"));
const DoubtAsk = lazy(() => import("./pages/doubts/DoubtAsk"));
const DoubtThread = lazy(() => import("./pages/doubts/DoubtThread"));
const NoticeCentral = lazy(() => import("./pages/NoticeCentral"));
const Leaderboard = lazy(() => import("./pages/exams/Leaderboard"));
const StudyPlan = lazy(() => import("./pages/StudyPlan"));
const Tutor = lazy(() => import("./pages/Tutor"));
const Progress = lazy(() => import("./pages/Progress"));
const CourseChat = lazy(() => import("./pages/chat/CourseChat"));
const PoraHome = lazy(() => import("./pages/pora/PoraHome"));
const PoraSession = lazy(() => import("./pages/pora/PoraSession"));
const TutorSession = lazy(() => import("./pages/pora/TutorSession"));
const InterviewHome = lazy(() => import("./pages/interview/InterviewHome"));
const InterviewSession = lazy(() => import("./pages/interview/InterviewSession"));
const SupportList = lazy(() => import("./pages/support/SupportList"));
const SupportNew = lazy(() => import("./pages/support/SupportNew"));
const SupportThread = lazy(() => import("./pages/support/SupportThread"));
const AccountPage = lazy(() => import("./pages/account/AccountPage"));
const PurchasesHome = lazy(() => import("./pages/purchases/PurchasesHome"));
const PlanPicker = lazy(() => import("./pages/purchases/PlanPicker"));
const AiCredits = lazy(() => import("./pages/purchases/AiCredits"));
const CheckoutSuccess = lazy(() => import("./pages/purchases/CheckoutSuccess"));
const Receipt = lazy(() => import("./pages/purchases/Receipt"));
const CheckoutCancelled = lazy(() => import("./pages/purchases/CheckoutCancelled"));

// Weights the design fonts actually come in ("" for a single-weight face).
const FONT_WEIGHTS = {
  "Press Start 2P": "",
  Audiowide: "",
  "Archivo Black": "",
  "Gloria Hallelujah": "",
  "Patrick Hand": "",
  Kalam: "300;400;700",
  "Special Elite": "",
  "Cabin Sketch": "400;700",
  "Inter Tight": "300;400;500;600;700;800;900",
  "Space Grotesk": "300;400;500;600;700",
  "PT Serif": "400;700",
  "Playfair Display": "400;500;600;700",
};

// Branding has to resolve before anything renders, including the login
// screen — an institution's students should never see the default theme
// flash before their own appears. useGetSettingsQuery is public, so this
// works with no session at all.
export default function App() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  // The admin's error wording, read by every API error (utils/friendlyError.js).
  setErrorMessages(settings?.studentUi?.errorMessages);
  // A student's own pick is kept with the admin mode it was made under
  // ("dark|light"), so a new admin default replaces it.
  const [modeOverride, setModeOverride] = useState(() => {
    try { return localStorage.getItem("examai_mode") || null; } catch { return null; }
  });

  const adminMode = settings?.studentUi?.mode || "light";
  const design = settings?.studentUi?.design || "panel";
  // Neon is always dark, so there is nothing to toggle.
  const allowModeOverride = Boolean(settings?.studentUi?.allowModeOverride) && design !== "neon";
  const [pick, pickBase] = (modeOverride || "").split("|");
  const mode = allowModeOverride && pick && pickBase === adminMode ? pick : adminMode;
  const themeName = settings?.studentUi?.theme || "slate";
  const customTheme = settings?.studentUi?.customTheme || null;
  const layout = settings?.studentUi?.layout || "app";
  const fonts = settings?.studentUi?.fonts || null;

  const theme = useMemo(
    () => buildTheme(themeName, mode, design, customTheme, fonts),
    [themeName, mode, design, customTheme, fonts]
  );

  // Admin-typed Google Fonts family names (studentUi.fonts) aren't bundled —
  // they're fetched live by name, same as any other site pulling from
  // fonts.google.com, so a Bangla family works exactly as well as a Latin
  // one with zero build-time setup. A mistyped name just 404s quietly and
  // the CSS fallback chain in buildTheme.js takes over; nothing to catch.
  useEffect(() => {
    // The design's own fonts too, so each design actually looks like itself.
    // One link per family: Google rejects a whole request when one family
    // lacks a weight asked for, so a bad name or a single-weight face (Press
    // Start 2P, Audiowide) can't take the others down with it.
    const families = [...new Set([...(DESIGN_FONTS[design] || []), fonts?.heading, fonts?.body].filter(Boolean))];
    document.querySelectorAll("link[data-examai-font]").forEach((el) => el.remove());
    for (const name of families) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.examaiFont = name;
      const weights = FONT_WEIGHTS[name] ?? "300;400;500;600;700";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}${weights ? `:wght@${weights}` : ""}&display=swap`;
      document.head.appendChild(link);
    }
  }, [design, fonts?.heading, fonts?.body]);

  // Static <link rel="icon"> tags in index.html cover the out-of-the-box
  // icon; an admin-uploaded favicon (Settings.jsx) overrides all of them at
  // runtime with a single link, since the uploaded file (PNG/ICO) doesn't
  // need the svg/size variants the default set ships.
  useEffect(() => {
    if (!settings?.favicon) return;
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => el.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = settings.favicon;
    document.head.appendChild(link);
  }, [settings?.favicon]);

  // Home screen position for pages that don't read useHomeMx: `mx: "var(--home-mx)"`.
  const homeAlign = settings?.studentUi?.homeAlign || "left";
  useEffect(() => {
    document.documentElement.style.setProperty("--home-mx", homeAlign === "center" ? "auto" : "0");
  }, [homeAlign]);

  const setMode = (next) => {
    if (!allowModeOverride) return;
    const value = `${next}|${adminMode}`;
    setModeOverride(value);
    try { localStorage.setItem("examai_mode", value); } catch { /* private mode */ }
  };

  if (isLoading) return null;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <NativeFeel />
      <CalculatorHost />
      <DemoLayer />
      <BrandingContext.Provider
        value={{
          siteName: settings?.siteName || "ExamAI",
          terms: settings?.institution?.terms,
          // Off for a school or university that doesn't sell: no plans, prices or checkout.
          sales: settings?.institution?.sales !== false,
          logo: settings?.logo || null,
          receiptInfo: settings?.receiptInfo || {},
          seo: settings?.seo || {},
          layout,
          design,
          batchHomeStyle: settings?.studentUi?.batchHomeStyle || "list",
          dashboardStyle: settings?.studentUi?.dashboardStyle || "list",
          homeAlign: settings?.studentUi?.homeAlign || "left",
          authStyle: settings?.studentUi?.authStyle || "hero",
          authImage: settings?.studentUi?.authImage || null,
          tagline: settings?.seo?.metaDescription || "",
          compactMobile: settings?.studentUi?.compactMobile !== false,
          compactShort: settings?.studentUi?.compactShort !== false,
          homeNotices: settings?.studentUi?.homeNotices !== false,
          noticeStyle: settings?.studentUi?.noticeStyle || "cards",
          mobileTeachers: settings?.studentUi?.mobileTeachers !== false,
          noticeStrip: Boolean(settings?.studentUi?.noticeStrip),
          catalogueStyle: settings?.studentUi?.catalogueStyle || "classic",
          lectureListStyle: settings?.studentUi?.lectureListStyle || "simple",
          videoWatermark: settings?.studentUi?.videoWatermark || "all",
          videoPlayer: settings?.studentUi?.videoPlayer || {},
          youtubeLock: Boolean(settings?.studentUi?.youtubeLock),
          leaderboardStyle: settings?.studentUi?.leaderboardStyle || "podium",
          tutorStyle: settings?.studentUi?.tutorStyle || "console",
          planStyle: settings?.studentUi?.planStyle || "classic",
          batchContextStyle: settings?.studentUi?.batchContextStyle || "glass",
          featureIcons: settings?.studentUi?.featureIcons || {},
          featureNames: settings?.studentUi?.featureNames || {},
          mascot: settings?.mascot || null,
          mode,
          allowModeOverride,
          setMode,
          authIdentifier: settings?.auth?.identifier || "none",
          whatsappCodes: settings?.auth?.whatsappCodes === true,
          studentIdLogin: Boolean(settings?.auth?.studentIdLogin),
          codeLogin: settings?.auth?.codeLogin !== false,
          phoneCountries: settings?.auth?.countries?.length ? settings.auth.countries : [{ code: "BD", dial: "880", name: "Bangladesh" }],
        }}
      >
        <ScrollToTop />
        <PageViews enabled={settings?.studentUi?.trackVisitors !== false} />
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
          <Route path="/register" element={<RedirectIfAuthed><Register /></RedirectIfAuthed>} />
          <Route path="/forgot-password" element={<RedirectIfAuthed><ForgotPassword /></RedirectIfAuthed>} />
          {/* A certificate's public check: no sign-in, no app chrome. */}
          <Route path="/verify/:serial" element={<VerifyCertificate />} />
          {/* A progress report from an SMS or email: no sign-in, no app chrome. */}
          <Route path="/progress/:token" element={<ProgressReport />} />
          {/* A course's public page (Settings → SEO → Course pages): no sign-in. */}
          <Route path="/courses/:slug" element={<CoursePage />} />
          {/* A public webinar's share link: anyone joins as a guest. */}
          <Route path="/w/:slug" element={<Webinar />} />

          {/* Escapes the normal nav chrome on purpose — a bottom tab bar or
              sidebar sitting next to a running exam timer is one misclick
              away from leaving mid-attempt. Still behind the same auth
              check as everything else, just without Shell wrapping it. */}
          <Route
            path="/batches/:batchId/exams/:id/take"
            element={<RequireAuth><ExamTake /></RequireAuth>}
          />
          {/* The in-app classroom: full screen, like an exam. */}
          <Route
            path="/batches/:batchId/live-classes/:id/room"
            element={<RequireAuth><LiveRoom /></RequireAuth>}
          />
          <Route
            path="/purchases/success"
            element={<RequireAuth><CheckoutSuccess /></RequireAuth>}
          />
          <Route
            path="/purchases/cancelled"
            element={<RequireAuth><CheckoutCancelled /></RequireAuth>}
          />
          {/* Same reasoning as success/cancelled above — a receipt is meant
              to be printed/saved standalone, not viewed inside the app's nav
              chrome. Router v6 ranks this static "/purchases/receipt/:id"
              above the dynamic "/purchases/:batchId" inside Protected below,
              so it matches first regardless of declaration order. */}
          <Route
            path="/purchases/receipt/:id"
            element={<RequireAuth><Receipt /></RequireAuth>}
          />

          <Route path="/*" element={<Protected />} />
        </Routes>
        </Suspense>
      </BrandingContext.Provider>
    </ThemeProvider>
  );
}

// An auth failure and an unreachable server are not the same thing, and
// treating them the same is what sent a perfectly logged-in student to the
// login page every time the backend hiccupped.
//
// RTK Query reports both through `isError`. Only 401 and 440 actually mean
// "your session is gone" — see studentAuth.js. A FETCH_ERROR (backend
// restarting, wifi dropped, tunnel down) or a 5xx means the session is
// probably fine and we simply could not ask. Bouncing to /login there loses
// the page the student was on and invites them to re-enter credentials to
// fix a problem credentials cannot fix.
// Shown for the moment a lazily loaded page's code is downloading.
function PageLoading() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress size={24} />
    </Box>
  );
}

const isAuthError = (error) => [401, 440].includes(error?.status);

// Shown instead of a redirect when the server cannot be reached. Deliberately
// offers a retry rather than a route change: the session is intact, so the
// fix is to ask again, not to log in again.
function Unreachable({ onRetry }) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 4, textAlign: "center", gap: 1 }}>
      <Typography sx={{ fontWeight: 500 }}>Cannot reach the server</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320, lineHeight: 1.6 }}>
        You are still signed in. This is usually a connection problem or the
        server restarting.
      </Typography>
      <Button variant="contained" size="small" sx={{ mt: 1.5 }} onClick={onRetry}>
        Try again
      </Button>
    </Box>
  );
}

// The mirror of RequireAuth, and the reason a signed-in student could still
// land on the login form. These three routes were completely unguarded, so
// anything that put /login in the address bar — a bookmark, the back button
// after signing in, a shared link, or the hard redirect the base query fires
// on a stray 401 — rendered the login page over a perfectly live session.
//
// Nothing was broken about the session itself, which is why it looked like
// the app had forgotten who you were when it had not.
//
// Only a successful identity redirects. An error here means "could not ask",
// and showing the login form is the right answer in that case.
function RedirectIfAuthed({ children }) {
  const { data: me, isLoading, error } = useGetMeQuery();

  // Only the first check hides the form. A re-check (window focus, which
  // Chrome's password popups cause) would otherwise unmount the login page
  // and wipe what was typed and the "wrong password" message.
  const shown = useRef(false);
  if (isLoading && !shown.current) return null;
  shown.current = true;
  // `data` is never cleared on a failed fetch — RTK Query only replaces it
  // on success, so `me` can still be the pre-logout user even though `error`
  // just confirmed the session is gone (401/440). Trusting `me` alone here
  // is what sent a just-logged-out visitor's very first click on "Log in"
  // straight back to "/": stale `me`, fresh auth error, silently bounced.
  // Protected (below) already guards the same way — this now matches it.
  if (me && !isAuthError(error)) return <Navigate to={peekNext()} replace />;

  return children;
}

// Split out from Protected so the exam-taking route can reuse the same auth
// gate without also picking up Shell's navigation chrome.
function RequireAuth({ children }) {
  const { data: me, isLoading, error, refetch } = useGetMeQuery();
  const here = useLocation();
  // Back here once logged in (utils/nextPath.js).
  const toLogin = loginTo(`${here.pathname}${here.search}`);

  if (isLoading) return null;
  if (error && isAuthError(error)) return <Navigate to={toLogin} replace />;
  if (error && !me) return <Unreachable onRetry={refetch} />;
  if (!me) return <Navigate to={toLogin} replace />;

  return children;
}

function Protected() {
  const location = useLocation();
  const { data: me, isLoading, error, refetch } = useGetMeQuery();

  if (isLoading) return null;
  if (error && isAuthError(error)) {
    // The mobile app opens on login; the landing page is for the website.
    if (location.pathname === "/" && !isNative) return <LandingPage />;
    return <Navigate to={location.pathname === "/" ? "/login" : loginTo(`${location.pathname}${location.search}`)} replace />;
  }
  // A cached `me` survives a failed refetch, so a blip while the student is
  // mid-session does not interrupt them at all — this only shows when there
  // is no known identity to fall back on.
  if (error && !me && !isAuthError(error)) return <Unreachable onRetry={refetch} />;
  if (!me) {
    // The website opens on the landing page.
    if (location.pathname === "/" && !isNative) return <LandingPage />;
    return <Navigate to={location.pathname === "/" ? "/login" : loginTo(`${location.pathname}${location.search}`)} replace />;
  }

  return (
    <Shell me={me}>
      <CampaignClick />
      {/* Inside Shell, so the nav stays put while a page's code loads. */}
      <PageFade>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/batches/:batchId" element={<BatchHome />} />

        <Route path="/lectures" element={<LectureList />} />
        <Route path="/batches/:batchId/lectures" element={<LectureList />} />
        <Route path="/batches/:batchId/lectures/:id" element={<LectureView />} />

        <Route path="/exams" element={<ExamList />} />
        <Route path="/go/:kind/:id" element={<GoToItem />} />
        <Route path="/batches/:batchId/exams" element={<ExamList />} />
        <Route path="/batches/:batchId/exams/:id" element={<ExamRules />} />
        <Route path="/submissions/:id" element={<ExamResult />} />

        <Route path="/practice" element={<PracticeTopics />} />
        <Route path="/batches/:batchId/practice" element={<PracticeTopics />} />
        <Route path="/batches/:batchId/slides" element={<SlideDecks />} />
        <Route path="/batches/:batchId/slides/:deckId" element={<SlideDeckView />} />
        <Route path="/batches/:batchId/coding" element={<CodingProblems />} />
        <Route path="/batches/:batchId/coding/:problemId" element={<CodingProblem />} />
        <Route path="/batches/:batchId/practice/learn" element={<LearnTopics />} />
        <Route path="/batches/:batchId/practice/learn/:scope" element={<LearnCards />} />
        <Route path="/batches/:batchId/practice/:topicId" element={<PracticeSession />} />
        <Route path="/batches/:batchId/exams/custom-exam-setup" element={<CustomExamSetup />} />

        {/* Archive — a per-batch module (like Doubts/Live classes/Study
            plan): a batch presents one or more boards/exams/books from the
            shared, global archive, reached from BatchHome, not a global
            tab. ArchiveHome is its own small hub (mirroring BatchHome one
            level in) so browse/study-plan/practice-exam/favorites each get
            their own entry point instead of stacking onto one page. */}
        <Route path="/batches/:batchId/archive" element={<ArchiveHome />} />
        <Route path="/batches/:batchId/archive/browse" element={<ArchiveBrowse />} />
        <Route path="/batches/:batchId/archive/study-plan" element={<ArchiveStudyPlan />} />
        <Route path="/batches/:batchId/archive/exam-setup" element={<ArchiveCustomExamSetup />} />
        <Route path="/batches/:batchId/archive/session/:topicOrChapter" element={<ArchiveSession />} />

        <Route path="/results" element={<Results />} />

        <Route path="/batches/:batchId/doubts" element={<DoubtList />} />
        <Route path="/batches/:batchId/doubts/new" element={<DoubtAsk />} />
        <Route path="/batches/:batchId/doubts/:id" element={<DoubtThread />} />
        <Route path="/batches/:batchId/grades" element={<Grades />} />
        <Route path="/certificates" element={<MyCertificates />} />
        <Route path="/batches/:batchId/assignments" element={<AssignmentList />} />
        <Route path="/batches/:batchId/assignments/:id" element={<AssignmentView />} />
        <Route path="/batches/:batchId/live-classes" element={<LiveClassList />} />
        <Route path="/batches/:batchId/live-classes/:id" element={<LiveClassJoin />} />

        <Route path="/batches/:batchId/notices" element={<NoticeCentral />} />
        <Route path="/batches/:batchId/leaderboard" element={<Leaderboard />} />
        <Route path="/batches/:batchId/study-plan" element={<StudyPlan />} />
        <Route path="/batches/:batchId/tutor" element={<Tutor />} />
        <Route path="/batches/:batchId/progress" element={<Progress />} />
        <Route path="/batches/:batchId/chat" element={<CourseChat />} />
        <Route path="/batches/:batchId/pora" element={<PoraHome key="pora" />} />
        <Route path="/batches/:batchId/pora/:id" element={<PoraSession />} />
        <Route path="/batches/:batchId/tutoring" element={<PoraHome key="tutor" kind="tutor" />} />
        <Route path="/batches/:batchId/tutoring/:id" element={<TutorSession />} />
        <Route path="/batches/:batchId/interview" element={<InterviewHome />} />
        <Route path="/batches/:batchId/interview/:id" element={<InterviewSession />} />
        <Route path="/support" element={<SupportList />} />
        <Route path="/support/new" element={<SupportNew />} />
        <Route path="/support/:id" element={<SupportThread />} />
        <Route path="/account" element={<AccountPage />} />

        <Route path="/purchases" element={<PurchasesHome />} />
        <Route path="/purchases/:batchId" element={<PlanPicker />} />
        <Route path="/batches/:batchId/ai-credits" element={<AiCredits />} />
        <Route path="/ai-credits" element={<AiCredits />} />

        <Route path="*" element={<ComingSoon />} />
      </Routes>
      </Suspense>
      </PageFade>
    </Shell>
  );
}
