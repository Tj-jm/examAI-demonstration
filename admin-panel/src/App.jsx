import { lazy, Suspense, useEffect, useRef } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Shell from "./layout/Shell";
import { Loading } from "./components/bits";
import Login from "./pages/Login";
import { useGetMeQuery } from "./api/authApi";
import { useGetSettingsQuery } from "./api/contentApi";
import Dashboard from "./pages/Dashboard";
import DemoLayer from "./demo/DemoLayer";

// Pages load on first visit, so signing in does not download the whole panel.
// Login and Dashboard stay in the main bundle because almost every visit
// starts on one of them.
const Setup = lazy(() => import("./pages/Setup"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const Questions = lazy(() => import("./pages/Questions"));
const Archive = lazy(() => import("./pages/Archive"));
const BulkImportQuestions = lazy(() => import("./pages/BulkImportQuestions"));
const QuestionEditor = lazy(() => import("./pages/QuestionEditor"));
const QuestionView = lazy(() => import("./pages/QuestionView"));
const Exams = lazy(() => import("./pages/Exams"));
const ExamBuilder = lazy(() => import("./pages/ExamBuilder"));
const ExamSets = lazy(() => import("./pages/ExamSets"));
const ExamSetDetail = lazy(() => import("./pages/ExamSetDetail"));
const Content = lazy(() => import("./pages/Content"));
const Lectures = lazy(() => import("./pages/Lectures"));
const Grading = lazy(() => import("./pages/Grading"));
const ReferralReviews = lazy(() => import("./pages/ReferralReviews"));
const ReferralSubmission = lazy(() => import("./pages/ReferralSubmission"));
const Submissions = lazy(() => import("./pages/Submissions"));
const DoubtQueue = lazy(() => import("./pages/DoubtQueue"));
const SupportTickets = lazy(() => import("./pages/SupportTickets"));
const Conduct = lazy(() => import("./pages/Conduct"));
const AccountDeletions = lazy(() => import("./pages/AccountDeletions"));
const LectureView = lazy(() => import("./pages/LectureView"));
const LectureEditor = lazy(() => import("./pages/LectureEditor"));
const Notices = lazy(() => import("./pages/Notices"));
const LiveClasses = lazy(() => import("./pages/LiveClasses"));
const LiveClassEditor = lazy(() => import("./pages/LiveClassEditor"));
const Webinars = lazy(() => import("./pages/LiveClasses").then((m) => ({ default: () => <m.AdminLiveClasses webinars /> })));
const LiveRoom = lazy(() => import("./pages/LiveRoom"));
const LiveAttendance = lazy(() => import("./pages/LiveAttendance"));
const LiveRecordings = lazy(() => import("./pages/LiveRecordings"));
const LiveNotes = lazy(() => import("./pages/LiveNotes"));
const TeacherClasses = lazy(() => import("./pages/TeacherClasses"));
const Agents = lazy(() => import("./pages/Agents"));
const NoticeEditor = lazy(() => import("./pages/NoticeEditor"));
const Earnings = lazy(() => import("./pages/Earnings"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignEditor = lazy(() => import("./pages/CampaignEditor"));
const Automations = lazy(() => import("./pages/Automations"));
const Posters = lazy(() => import("./pages/Posters"));
const Leads = lazy(() => import("./pages/Leads"));
const Visitors = lazy(() => import("./pages/Visitors"));
const Coupons = lazy(() => import("./pages/Coupons"));
const SlideEditor = lazy(() => import("./pages/SlideEditor"));
const SlidePresent = lazy(() => import("./pages/SlidePresent"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const Updates = lazy(() => import("./pages/Updates"));
const CouponEditor = lazy(() => import("./pages/CouponEditor"));
const MyCouponPerformance = lazy(() => import("./pages/MyCouponPerformance"));
const Payslips = lazy(() => import("./pages/Payslips"));
const MyPayslips = lazy(() => import("./pages/MyPayslips"));
const MyProfile = lazy(() => import("./pages/MyProfile"));
const Batches = lazy(() => import("./pages/Batches"));
const Performance = lazy(() => import("./pages/Performance"));
const BatchDetail = lazy(() => import("./pages/BatchDetail"));
const Students = lazy(() => import("./pages/Students"));
const StudentImport = lazy(() => import("./pages/StudentImport"));
const Assignments = lazy(() => import("./pages/assignments/Assignments"));
const AssignmentEditor = lazy(() => import("./pages/assignments/AssignmentEditor"));
const AssignmentHandIns = lazy(() => import("./pages/assignments/AssignmentHandIns"));
const AssignmentGrade = lazy(() => import("./pages/assignments/AssignmentGrade"));
const Gradebook = lazy(() => import("./pages/gradebook/Gradebook"));
const OfflineMarks = lazy(() => import("./pages/gradebook/OfflineMarks"));
const ReportCards = lazy(() => import("./pages/gradebook/ReportCards"));
const Certificates = lazy(() => import("./pages/certificates/Certificates"));
const ProgressReports = lazy(() => import("./pages/ProgressReports"));
const StudentDetail = lazy(() => import("./pages/StudentDetail"));
const Generate = lazy(() => import("./pages/Generate"));
const Review = lazy(() => import("./pages/Review"));
const QuestionAudit = lazy(() => import("./pages/QuestionAudit"));
const AuditQueue = lazy(() => import("./pages/AuditQueue"));
const PredictedPaper = lazy(() => import("./pages/PredictedPaper"));
const PredictedPaperDetail = lazy(() => import("./pages/PredictedPaperDetail"));
const Team = lazy(() => import("./pages/Team"));
const Settings = lazy(() => import("./pages/Settings"));

// Same gap the student app had: /login was reachable with a live session, so
// a bookmark or the back button after signing in put the login form in front
// of someone who was already through it.
//
// Setup and accept-invite stay unguarded on purpose. Setup is only reachable
// when no owner exists at all, and an invite link is meant to be openable by
// someone already signed in as a different user.
function RedirectIfAuthed({ children }) {
  const { data: me, isLoading } = useGetMeQuery();

  // Only the first check hides the form. A re-check (window focus, which
  // Chrome's password popups cause) would otherwise unmount the login page
  // and wipe what was typed and the "wrong password" message.
  const shown = useRef(false);
  if (isLoading && !shown.current) return null;
  shown.current = true;
  if (me) return <Navigate to="/" replace />;

  return children;
}

export default function App() {
  // Only resolves once signed in (this endpoint sits behind auth), so the
  // login screen keeps the default icon — same tradeoff as everywhere else
  // in this file assuming an authenticated context.
  const { data: settings } = useGetSettingsQuery();

  useEffect(() => {
    if (!settings?.favicon) return;
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => el.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = settings.favicon;
    document.head.appendChild(link);
  }, [settings?.favicon]);

  return (
    <>
    <DemoLayer />
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><Login /></RedirectIfAuthed>} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      {/* The in-app classroom fills the screen, outside the panel's nav. */}
      <Route path="/live-classes/:id/room" element={<LiveRoom />} />
      <Route path="/slides/:id/present" element={<SlidePresent />} />

      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />

        <Route path="questions" element={<Questions />} />
        <Route path="archive" element={<Archive />} />
        {/* "new" and "import" are matched before ":id" so neither is read as an id. */}
        <Route path="questions/new" element={<QuestionEditor />} />
        <Route path="questions/import" element={<BulkImportQuestions />} />
        <Route path="questions/:id" element={<QuestionView />} />
        <Route path="questions/:id/edit" element={<QuestionEditor />} />

        <Route path="exams" element={<Exams />} />
        <Route path="exams/:id" element={<ExamBuilder />} />
        <Route path="exam-sets" element={<ExamSets />} />
        <Route path="exam-sets/:id" element={<ExamSetDetail />} />

        <Route path="content" element={<Content />} />
        <Route path="lectures" element={<Lectures />} />
        <Route path="grading/gradebook" element={<Gradebook />} />
        <Route path="grading/offline-marks" element={<OfflineMarks />} />
        <Route path="grading/certificates" element={<Certificates />} />
        <Route path="grading/progress-reports" element={<ProgressReports />} />
        <Route path="grading/gradebook/:batchId/report-cards" element={<ReportCards />} />
        <Route path="grading/assignments" element={<Assignments />} />
        <Route path="grading/assignments/new" element={<AssignmentEditor />} />
        <Route path="grading/assignments/hand-ins/:subId" element={<AssignmentGrade />} />
        <Route path="grading/assignments/:id" element={<AssignmentEditor />} />
        <Route path="grading/assignments/:id/hand-ins" element={<AssignmentHandIns />} />
        <Route path="grading" element={<Grading />} />
        <Route path="grading/:id" element={<Grading />} />
        <Route path="referrals" element={<ReferralReviews />} />
        <Route path="referrals/:id" element={<ReferralSubmission />} />
        <Route path="submissions" element={<Submissions />} />
        <Route path="doubts" element={<DoubtQueue />} />
        <Route path="support" element={<SupportTickets />} />
        <Route path="conduct" element={<Conduct />} />
        <Route path="account-deletions" element={<AccountDeletions />} />
        <Route path="live-classes" element={<LiveClasses />} />
        <Route path="live-classes/new" element={<LiveClassEditor />} />
        <Route path="live-classes/taught" element={<TeacherClasses admin />} />
        <Route path="live-classes/:id/edit" element={<LiveClassEditor />} />
        <Route path="live-classes/:id/attendance" element={<LiveAttendance />} />
        <Route path="live-classes/:id/recordings" element={<LiveRecordings />} />
        <Route path="live-classes/:id/notes" element={<LiveNotes />} />
        <Route path="webinars" element={<Webinars />} />
        <Route path="webinars/new" element={<LiveClassEditor webinar />} />
        <Route path="webinars/:id/edit" element={<LiveClassEditor webinar />} />
        <Route path="agents" element={<Agents />} />
        <Route path="lectures/new" element={<LectureEditor />} />
        <Route path="lectures/:id" element={<LectureView />} />
        <Route path="lectures/:id/edit" element={<LectureEditor />} />

        <Route path="notices" element={<Notices />} />
        <Route path="notices/new" element={<NoticeEditor />} />
        <Route path="notices/:id/edit" element={<NoticeEditor />} />

        <Route path="earnings" element={<Earnings />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="campaigns/:id" element={<CampaignEditor />} />
        <Route path="automations" element={<Automations />} />
        <Route path="automations/:id" element={<CampaignEditor />} />
        <Route path="posters" element={<Posters />} />
        <Route path="leads" element={<Leads />} />
        <Route path="visitors" element={<Visitors />} />

        <Route path="coupons" element={<Coupons />} />
        <Route path="coupons/new" element={<CouponEditor />} />
        <Route path="coupons/:id/edit" element={<CouponEditor />} />

        <Route path="my-coupons" element={<MyCouponPerformance />} />
        <Route path="payslips" element={<Payslips />} />
        <Route path="my-payslips" element={<MyPayslips />} />
        <Route path="me" element={<MyProfile />} />

        <Route path="landing-page" element={<LandingPage />} />
        <Route path="updates" element={<Updates />} />

        <Route path="batches" element={<Batches />} />
        <Route path="batches/:id" element={<BatchDetail />} />
        <Route path="slides/:id" element={<SlideEditor />} />

        <Route path="students" element={<Students />} />
        <Route path="students/import" element={<StudentImport />} />
        <Route path="students/:id" element={<StudentDetail />} />

        <Route path="generate" element={<Generate />} />
        <Route path="review" element={<Review />} />
        <Route path="audits" element={<AuditQueue />} />
        <Route path="audit-pool/:id" element={<QuestionAudit />} />
        <Route path="predicted-paper" element={<PredictedPaper />} />
        <Route path="predicted-paper/:id" element={<PredictedPaperDetail />} />

        <Route path="team" element={<Team />} />
        <Route path="performance" element={<Performance />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </>
  );
}
