import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

// Relative baseUrl. In development vite proxies /api to the backend, so the
// frontend is same-origin with the api in both environments and the session
// cookie behaves identically. Nothing to configure per install.
const rawBaseQuery = fetchBaseQuery({
  baseUrl: "/api",
  credentials: "include",
});

// 401 and 440 mean the session is gone. Handling it once here means no page
// has to think about it, and a stale tab cannot sit showing empty data.
const baseQuery = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  if (result.error && [401, 440].includes(result.error.status)) {
    const onAuthScreen = ["/login", "/setup", "/accept-invite"].some((p) =>
      window.location.pathname.startsWith(`/admin${p}`)
    );
    if (!onAuthScreen) window.location.href = "/admin/login";
  }

  return result;
};

export const apiSlice = createApi({
  baseQuery,
  tagTypes: ["Self", "SlideDeck", "Media", "ProtectedSummary", "MyHome", "ExamSet", "InterviewSet", "Connections", "Payslip", "ClassPay", "CourseSeo", "Performance", "PerformanceStatus", "SavedAi", "Assignment", "AssignmentHandIn", "Gradebook", "Certificate", "CertificateTemplate", "ProgressReports", "ProgressReportLog",
    "VideoLesson",
    "Auth", "User", "Invite", "Subject", "Chapter", "Topic",
    "Question", "Exam", "Program", "Batch", "Lecture",
    "Student", "Purchase", "AiConfig", "ReviewQueue", "DocumentLibrary",
    "Settings", "Grading", "Submissions", "Doubts", "AiCreditPlan", "Notice", "Earnings", "Cleanup", "Coupon", "Representative", "ShortLink",
    "LandingPage", "Update", "LiveClass", "QuestionAudit", "ExamAuthority", "PredictedPaper", "IngestJobs", "Support", "Conduct", "DeletionRequest", "LiveRecording", "LiveNotes", "AgentRun", "Campaign", "Lead",
  ],
  endpoints: () => ({}),
});
