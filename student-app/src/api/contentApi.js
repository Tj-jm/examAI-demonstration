import { apiSlice, withMountRefetch, honourMountRefetch } from "./apiSlice";

// A public webinar's guest uses the classroom's Q&A and polls by the
// webinar's link name instead of a batch and class.
export const GUEST = "@guest";
const roomBase = (batchId, id) => (batchId === GUEST ? `/webinars/${encodeURIComponent(id)}` : `/batches/${batchId}/live-classes/${id}`);

export const contentApi = honourMountRefetch(apiSlice.injectEndpoints({
  endpoints: withMountRefetch((builder) => ({
    // ---------- notifications ----------
    getNotifications: builder.query({
      // A page number, or { page, filter } (filter: unread | important).
      query: (arg) => {
        const { page = 1, filter } = typeof arg === "object" && arg ? arg : { page: arg || 1 };
        return `/notifications?page=${page}${filter ? `&filter=${filter}` : ""}`;
      },
      providesTags: ["Notification"],
    }),
    getUnreadNotificationCount: builder.query({
      query: () => "/notifications/unread-count",
      providesTags: ["Notification"],
    }),
    markNotificationRead: builder.mutation({
      query: (id) => ({ url: `/notifications/${id}/read`, method: "PUT" }),
      invalidatesTags: ["Notification"],
    }),
    markAllNotificationsRead: builder.mutation({
      query: () => ({ url: "/notifications/read-all", method: "PUT" }),
      invalidatesTags: ["Notification"],
    }),
    deleteNotification: builder.mutation({
      query: (id) => ({ url: `/notifications/${id}`, method: "DELETE" }),
      invalidatesTags: ["Notification"],
    }),

    // ---------- notices ----------
    getGeneralNotices: builder.query({
      query: () => "/notices/general",
      providesTags: ["Notice"],
    }),
    getBatchNotices: builder.query({
      query: ({ batchId, page }) => `/batches/${batchId}/notices?page=${page || 1}`,
      providesTags: ["Notice"],
    }),
    getLeaderboard: builder.query({
      query: (batchId) => `/batches/${batchId}/leaderboard`,
      providesTags: ["Leaderboard"],
    }),

    // ---------- batches ----------
    // Published AI video lessons (backend controllers/app/videoLessonController.js).
    getQuestionVideoLesson: builder.query({ query: (id) => `/video-lessons/question/${id}` }),
    getLectureVideoLesson: builder.query({ query: (id) => `/video-lessons/lecture/${id}` }),
    // Which of my batches has this lecture/exam (notice links, /go/...).
    locateItem: builder.query({
      query: ({ kind, id }) => `/batches/locate/${kind}/${id}`,
    }),
    getDashboard: builder.query({
      // The time zone puts "today" (Today style's timeline) on the student's own day.
      query: () => `/batches/dashboard?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "")}`,
      providesTags: ["Batch"],
      refetchOnMountOrArgChange: true,
    }),
    getBatches: builder.query({
      query: () => "/batches",
      providesTags: ["Batch"],
      refetchOnMountOrArgChange: true,
    }),
    getBatch: builder.query({
      query: (id) => `/batches/${id}`,
      providesTags: (r, e, id) => [{ type: "Batch", id }],
      refetchOnMountOrArgChange: true,
    }),
    startTrial: builder.mutation({
      query: (batchId) => ({ url: `/batches/${batchId}/trial`, method: "POST" }),
      invalidatesTags: ["Batch"],
    }),

    // ---------- lectures ----------
    getLectures: builder.query({
      query: (batchId) => `/batches/${batchId}/lectures`,
      providesTags: ["Lecture"],
    }),
    getLecture: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/lectures/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Lecture", id }],
    }),
    updateLectureProgress: builder.mutation({
      query: ({ batchId, id, ...body }) => ({
        url: `/batches/${batchId}/lectures/${id}/progress`, method: "PUT", body,
      }),
      invalidatesTags: ["Lecture", "Batch"],
    }),
    summarizeLecture: builder.mutation({
      query: ({ batchId, id, regenerate }) => ({
        url: `/batches/${batchId}/lectures/${id}/summarize`, method: "POST", body: { regenerate },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: "Lecture", id }, "AiCredit"],
    }),
    summarizeLectureAttachments: builder.mutation({
      query: ({ batchId, id, regenerate }) => ({
        url: `/batches/${batchId}/lectures/${id}/summarize-attachments`, method: "POST", body: { regenerate },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: "Lecture", id }, "AiCredit"],
    }),
    // ---------- Oral Quiz ----------
    getPoraSettings: builder.query({
      query: (batchId) => `/batches/${batchId}/pora/settings`,
      providesTags: ["Pora"],
    }),
    getPoraSessions: builder.query({
      query: ({ batchId, lecture }) => `/batches/${batchId}/pora/sessions${lecture ? `?lecture=${lecture}` : ""}`,
      providesTags: ["Pora"],
    }),
    getPoraSession: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/pora/sessions/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Pora", id }],
    }),
    startPora: builder.mutation({
      query: ({ batchId, lectureId, fresh }) => ({ url: `/batches/${batchId}/pora/start`, method: "POST", body: { lectureId, fresh } }),
      invalidatesTags: ["Pora", "AiCredit"],
    }),
    poraTurn: builder.mutation({
      query: ({ batchId, id, kind, text }) => ({ url: `/batches/${batchId}/pora/sessions/${id}/turn`, method: "POST", body: { kind, text } }),
      invalidatesTags: ["Pora", "AiCredit"],
    }),
    endPora: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/pora/sessions/${id}/end`, method: "POST" }),
      invalidatesTags: ["Pora"],
    }),
    deletePora: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/pora/sessions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Pora"],
    }),
    unlockPora: builder.mutation({
      query: (batchId) => ({ url: `/batches/${batchId}/pora/unlock`, method: "POST" }),
      invalidatesTags: ["Pora", "AiCredit"],
    }),
    // The teacher's line as audio: an object URL to play (revoke when done).
    speakPora: builder.mutation({
      query: ({ batchId, text }) => ({
        url: `/batches/${batchId}/pora/speak`,
        method: "POST",
        body: { text },
        responseHandler: async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : r.json()),
      }),
    }),

    // ---------- Interview practice ----------
    getInterviewSettings: builder.query({
      query: (batchId) => `/batches/${batchId}/interview/settings`,
      providesTags: ["Interview"],
    }),
    getInterviewSessions: builder.query({
      query: ({ batchId }) => `/batches/${batchId}/interview/sessions`,
      providesTags: ["Interview"],
    }),
    getInterviewSession: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/interview/sessions/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Interview", id }],
    }),
    startInterview: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/interview/start`, method: "POST", body }),
      invalidatesTags: ["Interview", "AiCredit"],
    }),
    interviewTurn: builder.mutation({
      query: ({ batchId, id, ...body }) => ({ url: `/batches/${batchId}/interview/sessions/${id}/turn`, method: "POST", body }),
      invalidatesTags: ["Interview", "AiCredit"],
    }),
    endInterview: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/interview/sessions/${id}/end`, method: "POST" }),
      invalidatesTags: ["Interview"],
    }),
    deleteInterview: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/interview/sessions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Interview"],
    }),
    unlockInterview: builder.mutation({
      query: (batchId) => ({ url: `/batches/${batchId}/interview/unlock`, method: "POST" }),
      invalidatesTags: ["Interview", "AiCredit"],
    }),
    speakInterview: builder.mutation({
      query: ({ batchId, text, language }) => ({
        url: `/batches/${batchId}/interview/speak`,
        method: "POST",
        body: { text, language },
        responseHandler: async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : r.json()),
      }),
    }),

    // ---------- AI Tutoring ----------
    getTutorSettings: builder.query({
      query: (batchId) => `/batches/${batchId}/tutoring/settings`,
      providesTags: ["Tutoring"],
    }),
    getTutorSessions: builder.query({
      query: ({ batchId, lecture }) => `/batches/${batchId}/tutoring/sessions${lecture ? `?lecture=${lecture}` : ""}`,
      providesTags: ["Tutoring"],
    }),
    getTutorSession: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/tutoring/sessions/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Tutoring", id }],
    }),
    startTutor: builder.mutation({
      query: ({ batchId, lectureId, fresh }) => ({ url: `/batches/${batchId}/tutoring/start`, method: "POST", body: { lectureId, fresh } }),
      invalidatesTags: ["Tutoring", "AiCredit"],
    }),
    uploadTutorImage: builder.mutation({
      query: ({ batchId, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/batches/${batchId}/tutoring/upload-image`, method: "POST", body };
      },
    }),
    tutorTurn: builder.mutation({
      query: ({ batchId, id, kind, text, part, images }) => ({ url: `/batches/${batchId}/tutoring/sessions/${id}/turn`, method: "POST", body: { kind, text, part, images } }),
      invalidatesTags: ["Tutoring", "AiCredit"],
    }),
    endTutor: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/tutoring/sessions/${id}/end`, method: "POST" }),
      invalidatesTags: ["Tutoring"],
    }),
    deleteTutor: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/tutoring/sessions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Tutoring"],
    }),
    unlockTutor: builder.mutation({
      query: (batchId) => ({ url: `/batches/${batchId}/tutoring/unlock`, method: "POST" }),
      invalidatesTags: ["Tutoring", "AiCredit"],
    }),

    // ---------- document chat ----------
    getDocChatSettings: builder.query({
      query: (batchId) => `/batches/${batchId}/chat/settings`,
      providesTags: ["DocChat"],
    }),
    unlockDocChat: builder.mutation({
      query: (batchId) => ({ url: `/batches/${batchId}/chat/unlock`, method: "POST" }),
      invalidatesTags: ["DocChat", "AiCredit"],
    }),
    getDocChatThreads: builder.query({
      query: ({ batchId, lecture }) => `/batches/${batchId}/chat/threads${lecture ? `?lecture=${lecture}` : ""}`,
      providesTags: ["DocChat"],
    }),
    getDocChatThread: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/chat/threads/${id}`,
      providesTags: (r, e, { id }) => [{ type: "DocChat", id }],
    }),
    uploadDocChatImage: builder.mutation({
      query: ({ batchId, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/batches/${batchId}/chat/upload-image`, method: "POST", body };
      },
    }),
    askDocChat: builder.mutation({
      query: ({ batchId, threadId, lectureId, message, image }) => ({
        url: `/batches/${batchId}/chat`, method: "POST", body: { threadId, lectureId, message, image },
      }),
      invalidatesTags: ["DocChat", "AiCredit"],
    }),
    deleteDocChatThread: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/chat/threads/${id}`, method: "DELETE" }),
      invalidatesTags: ["DocChat"],
    }),

    getLecturePractice: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/lectures/${id}/practice`,
      providesTags: (r, e, { id }) => [{ type: "Lecture", id }],
    }),

    // ---------- exams ----------
    // isActive/isPublished/isOpen live entirely on the admin side — an exam
    // list cached from before an admin opened it would keep showing
    // "Closed" indefinitely without this, since nothing else in this app
    // would ever know to ask again.
    getExams: builder.query({
      query: ({ batchId, page, filter } = {}) => `/batches/${batchId}/exams?page=${page || 1}${filter && filter !== "all" ? `&filter=${filter}` : ""}`,
      providesTags: ["Exam"],
      refetchOnMountOrArgChange: true,
    }),
    getExamRules: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/exams/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Exam", id }],
      refetchOnMountOrArgChange: true,
    }),
    startExam: builder.mutation({
      query: ({ batchId, id, newAttempt }) => ({ url: `/batches/${batchId}/exams/${id}/start`, method: "POST", body: newAttempt ? { newAttempt: true } : {} }),
      invalidatesTags: ["Exam"],
    }),
    // ---------- practice exams (ephemeral — see backend for why) ----------
    getPracticeExamRecord: builder.query({
      query: (batchId) => `/batches/${batchId}/practice-exams/record`,
      providesTags: ["PracticeExamRecord"],
    }),
    buildPracticeExam: builder.mutation({
      // No invalidatesTags — nothing about batch/exam state changes here,
      // since nothing is persisted until submit.
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/practice-exams`, method: "POST", body }),
    }),
    submitPracticeExam: builder.mutation({
      query: ({ batchId, answers }) => ({ url: `/batches/${batchId}/practice-exams/submit`, method: "POST", body: { answers } }),
      // The running average shown on the setup screen only changes once
      // this succeeds, so that's the one thing worth invalidating — plus
      // AiCredit, since a written answer graded here can spend a credit
      // exactly like the standalone grade-written endpoint does.
      invalidatesTags: ["PracticeExamRecord", "AiCredit"],
    }),
    getPracticeExamInsight: builder.mutation({
      // Billable (spends a credit, same as written-answer grading), and
      // invalidates AiCredit for the same reason — the one-time review
      // screen calls this on click, not automatically.
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/practice-exams/insight`, method: "POST", body }),
      invalidatesTags: ["AiCredit"],
    }),

    // ---------- submissions ----------
    saveAnswer: builder.mutation({
      query: ({ submissionId, ...body }) => ({
        url: `/submissions/${submissionId}/answer`, method: "PUT", body,
      }),
    }),
    logViolation: builder.mutation({
      query: ({ submissionId, type }) => ({
        url: `/submissions/${submissionId}/violation`, method: "POST", body: { type },
      }),
    }),
    uploadAnswerImage: builder.mutation({
      query: ({ submissionId, file, drawn, camera }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/submissions/${submissionId}/answer-image${drawn ? "?drawn=1" : camera ? "?camera=1" : ""}`, method: "POST", body };
      },
    }),
    getSlideDecks: builder.query({ query: (batchId) => `/batches/${batchId}/slides` }),
    getSlideDeck: builder.query({ query: ({ batchId, id }) => `/batches/${batchId}/slides/${id}` }),
    getCodingProblems: builder.query({
      query: (batchId) => `/batches/${batchId}/coding`,
      providesTags: ["Coding"],
    }),
    getCodingProblem: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/coding/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Coding", id }],
    }),
    saveCodingDraft: builder.mutation({
      query: ({ batchId, id, ...body }) => ({ url: `/batches/${batchId}/coding/${id}/draft`, method: "PUT", body }),
    }),
    runCodingProblem: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/coding/run`, method: "POST", body }),
    }),
    submitCodingProblem: builder.mutation({
      query: ({ batchId, id, ...body }) => ({ url: `/batches/${batchId}/coding/${id}/submit`, method: "POST", body }),
      invalidatesTags: (r, e, { id }) => ["Coding", { type: "Coding", id }],
    }),
    runCode: builder.mutation({
      query: ({ submissionId, ...body }) => ({ url: `/submissions/${submissionId}/run-code`, method: "POST", body }),
    }),
    submitExam: builder.mutation({
      query: (submissionId) => ({ url: `/submissions/${submissionId}/submit`, method: "POST" }),
      invalidatesTags: ["Exam", "Submission"],
    }),
    getSubmission: builder.query({
      query: (id) => `/submissions/${id}`,
      providesTags: (r, e, id) => [{ type: "Submission", id }],
    }),
    requestExamReview: builder.mutation({
      query: ({ submissionId, reason, questionIds }) => ({
        url: `/submissions/${submissionId}/referral`, method: "POST", body: { reason, questionIds },
      }),
      invalidatesTags: (r, e, { submissionId }) => [{ type: "Submission", id: submissionId }],
    }),
    // params: {examId?, batchId?} — the results page filters by batch, an
    // exam's own history (if ever surfaced there) would filter by examId.
    getSubmissions: builder.query({
      query: (params = {}) => {
        const qs = new URLSearchParams();
        if (params.examId) qs.set("examId", params.examId);
        if (params.batchId) qs.set("batchId", params.batchId);
        if (params.page) qs.set("page", params.page);
        const suffix = qs.toString();
        return `/submissions${suffix ? `?${suffix}` : ""}`;
      },
      providesTags: ["Submission"],
    }),

    // ---------- practice ----------
    getPracticeTopics: builder.query({
      query: ({ batchId, types, skillType }) => {
        const params = [];
        if (types) params.push(`types=${types}`);
        if (skillType) params.push(`skillType=${skillType}`);
        return `/batches/${batchId}/practice/topics${params.length ? `?${params.join("&")}` : ""}`;
      },
      providesTags: ["Practice"],
    }),
    // Learn mode: study cards for written questions.
    getLearnTopics: builder.query({
      query: (batchId) => `/batches/${batchId}/practice/learn/topics`,
      providesTags: ["Learn"],
    }),
    getLearnCards: builder.query({
      query: ({ batchId, scope }) => `/batches/${batchId}/practice/learn/cards/${scope}`,
      // A fresh deck each visit; ratings change the order.
      keepUnusedDataFor: 0,
    }),
    rateLearnCard: builder.mutation({
      query: ({ batchId, questionId, rating }) => ({ url: `/batches/${batchId}/practice/learn/cards/${questionId}/rate`, method: "POST", body: { rating } }),
      invalidatesTags: ["Learn"],
    }),
    getWeakTopics: builder.query({
      query: (batchId) => `/batches/${batchId}/practice/weak-topics`,
      providesTags: ["Practice"],
      refetchOnMountOrArgChange: true,
    }),
    // Both of these shuffle server-side on every call (weighted-random
    // question selection) — refetching mid-session, which the app's global
    // refetchOnFocus otherwise does automatically the moment the tab
    // regains focus, would silently swap in a different random set under
    // whatever question index the student is currently on. Explicitly
    // overriding the global default here: this is a "fetch once, work
    // through it" set, not a live value that should refresh on its own.
    // Note: refetchOnFocus/refetchOnReconnect are NOT valid fields here —
    // they only take effect at createApi()'s global config or at each
    // individual hook call site (the second argument to useXQuery). Setting
    // them on the endpoint definition itself, which used to happen right
    // here, is silently ignored by RTK Query with no error, since this is
    // plain JS with no type system to catch the mistake — confirmed against
    // the actual hook source (buildHooks.ts), not assumed. The real
    // override for these two lives in PracticeSession.jsx, at the hook
    // calls themselves.
    getPracticeQuestions: builder.query({
      // Either topic or chapter, never both — a chapter-pool tile
      // (PracticeTopics.jsx's chapterPools list) sends chapter instead of
      // topic, same "topic XOR chapter" filing the admin side uses.
      query: ({ batchId, topic, chapter, limit, types, skillType, autoSkill }) =>
        `/batches/${batchId}/practice/questions?${topic ? `topic=${topic}` : `chapter=${chapter}`}${limit ? `&limit=${limit}` : ""}${types ? `&types=${types}` : ""}${skillType ? `&skillType=${skillType}` : ""}${autoSkill ? `&autoSkill=true` : ""}`,
    }),
    getPersonalizedQuestions: builder.query({
      query: ({ batchId, limit, types }) => {
        const params = [];
        if (limit) params.push(`limit=${limit}`);
        if (types) params.push(`types=${types}`);
        return `/batches/${batchId}/practice/personalized${params.length ? `?${params.join("&")}` : ""}`;
      },
    }),
    getFavoriteIds: builder.query({
      query: (batchId) => `/batches/${batchId}/practice/favorites/ids`,
      providesTags: ["Favorite"],
    }),
    getFavoriteQuestions: builder.query({
      query: ({ batchId, limit }) =>
        `/batches/${batchId}/practice/favorites${limit ? `?limit=${limit}` : ""}`,
    }),
    toggleFavorite: builder.mutation({
      query: ({ batchId, questionId }) => ({
        url: `/batches/${batchId}/practice/favorites/${questionId}`, method: "POST",
      }),
      invalidatesTags: ["Favorite"],
    }),
    submitPracticeAttempt: builder.mutation({
      query: ({ batchId, ...body }) => ({
        url: `/batches/${batchId}/practice/attempt`, method: "POST", body,
      }),
    }),
    explainPracticeAttempt: builder.mutation({
      query: ({ batchId, ...body }) => ({
        url: `/batches/${batchId}/practice/explain`, method: "POST", body,
      }),
      invalidatesTags: ["AiCredit"],
    }),
    // Short AI videos a student asks for from a lecture or a solution.
    getStudentVideos: builder.query({
      query: ({ batchId, lecture, question }) => `/batches/${batchId}/videos?${lecture ? `lecture=${lecture}` : `question=${question}`}`,
      providesTags: ["StudentVideo"],
    }),
    requestStudentVideo: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/videos`, method: "POST", body }),
      invalidatesTags: ["StudentVideo", "AiCredit"],
    }),
    deleteStudentVideo: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/videos/${id}`, method: "DELETE" }),
      invalidatesTags: ["StudentVideo"],
    }),
    // Follow-up questions on an answered practice question's solution.
    getPracticeQna: builder.query({
      query: ({ batchId, questionId }) => `/batches/${batchId}/practice/qna/${questionId}`,
      providesTags: (r, e, { questionId }) => [{ type: "PracticeQna", id: questionId }],
    }),
    askPracticeQna: builder.mutation({
      query: ({ batchId, questionId, ...body }) => ({
        url: `/batches/${batchId}/practice/qna/${questionId}`, method: "POST", body,
      }),
      async onQueryStarted({ batchId, questionId }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(contentApi.util.upsertQueryData("getPracticeQna", { batchId, questionId }, data));
        } catch { /* shown by the caller */ }
      },
      invalidatesTags: ["AiCredit"],
    }),
    gradeWrittenPracticeAttempt: builder.mutation({
      query: ({ batchId, ...body }) => ({
        url: `/batches/${batchId}/practice/grade-written`, method: "POST", body,
      }),
      invalidatesTags: ["AiCredit"],
    }),
    // Archive practice exams' written-answer photos — same upload as batch
    // practice, on the archive router (no features.practice needed).
    uploadArchiveAnswerImage: builder.mutation({
      query: ({ batchId, file, drawn, camera }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/batches/${batchId}/archive/upload-answer-image${drawn ? "?drawn=1" : camera ? "?camera=1" : ""}`, method: "POST", body };
      },
    }),
    getPracticeHint: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/practice/hint`, method: "POST", body }),
      invalidatesTags: ["AiCredit"],
    }),
    uploadPracticeAnswerImage: builder.mutation({
      query: ({ batchId, file, drawn, camera }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/batches/${batchId}/practice/upload-answer-image${drawn ? "?drawn=1" : camera ? "?camera=1" : ""}`, method: "POST", body };
      },
    }),
    getSimilarQuestions: builder.mutation({
      query: ({ batchId, questionId }) => ({
        url: `/batches/${batchId}/practice/similar`, method: "POST", body: { questionId },
      }),
      invalidatesTags: ["AiCredit"],
    }),

    // ---------- archive (a per-batch module — a batch presents one or
    // more boards/exams/books from the shared, global archive; same
    // practice loop as batch practice, scoped to isPublic questions within
    // that batch's own archiveAuthorities rather than its normal bank) ----------
    // Only options that lead to at least one question, given the other
    // current choices — so board/year/subject chips never offer a dead end.
    getArchiveFilters: builder.query({
      query: ({ batchId, authority, year, subject }) => {
        const params = [];
        if (authority) params.push(`authority=${authority}`);
        if (year) params.push(`year=${year}`);
        if (subject) params.push(`subject=${subject}`);
        return `/batches/${batchId}/archive/filters${params.length ? `?${params.join("&")}` : ""}`;
      },
    }),
    getArchiveTopics: builder.query({
      query: ({ batchId, authority, year, subject, types } = {}) => {
        const params = [];
        if (authority) params.push(`authority=${authority}`);
        if (year) params.push(`year=${year}`);
        if (subject) params.push(`subject=${subject}`);
        if (types) params.push(`types=${types}`);
        return `/batches/${batchId}/archive/topics${params.length ? `?${params.join("&")}` : ""}`;
      },
    }),
    getArchiveQuestions: builder.query({
      query: ({ batchId, topic, chapter, authority, year, limit, types, skillType }) => {
        const params = [topic ? `topic=${topic}` : `chapter=${chapter}`];
        if (authority) params.push(`authority=${authority}`);
        if (year) params.push(`year=${year}`);
        if (limit) params.push(`limit=${limit}`);
        if (types) params.push(`types=${types}`);
        if (skillType) params.push(`skillType=${skillType}`);
        return `/batches/${batchId}/archive/questions?${params.join("&")}`;
      },
    }),
    submitArchiveAttempt: builder.mutation({
      query: ({ batchId, questionId, ...body }) => ({
        url: `/batches/${batchId}/archive/questions/${questionId}/attempt`, method: "POST", body,
      }),
    }),
    explainArchiveAttempt: builder.mutation({
      query: ({ batchId, questionId, ...body }) => ({
        url: `/batches/${batchId}/archive/questions/${questionId}/explain`, method: "POST", body,
      }),
      invalidatesTags: ["AiCredit"],
    }),
    getArchiveHint: builder.mutation({
      query: ({ batchId, questionId, ...body }) => ({
        url: `/batches/${batchId}/archive/questions/${questionId}/hint`, method: "POST", body,
      }),
      invalidatesTags: ["AiCredit"],
    }),
    // A written archive answer, AI-graded (archiveAiAssist). Also returns
    // the printed solution.
    gradeArchiveWritten: builder.mutation({
      query: ({ batchId, questionId, ...body }) => ({
        url: `/batches/${batchId}/archive/questions/${questionId}/grade-written`, method: "POST", body,
      }),
      invalidatesTags: ["AiCredit"],
    }),
    getArchiveSimilarQuestions: builder.mutation({
      query: ({ batchId, questionId }) => ({
        url: `/batches/${batchId}/archive/questions/${questionId}/similar`, method: "POST", body: { questionId },
      }),
      invalidatesTags: ["AiCredit"],
    }),
    getArchiveWeakTopics: builder.query({
      query: (batchId) => `/batches/${batchId}/archive/weak-topics`,
      refetchOnMountOrArgChange: true,
    }),
    // Same shape as getAiUsage above, but scoped to the archive's own
    // batch: null pool (see archiveController.js's getAiUsage) rather than
    // this door's own batch — sharing the "AiCredit" tag with every other
    // AI-credit-invalidating mutation, batch or archive, means either one
    // refetches this the moment a credit gets spent.
    getArchiveAiUsage: builder.query({
      query: (batchId) => `/batches/${batchId}/archive/ai-usage`,
      providesTags: ["AiCredit"],
      refetchOnMountOrArgChange: true,
    }),
    // Shuffles server-side on every call, same reasoning as
    // getPersonalizedQuestions above — refetchOnFocus/refetchOnReconnect are
    // overridden at the hook call site in ArchiveSession.jsx, not here.
    getArchivePersonalizedQuestions: builder.query({
      query: ({ batchId, limit, types }) => {
        const params = [];
        if (limit) params.push(`limit=${limit}`);
        if (types) params.push(`types=${types}`);
        return `/batches/${batchId}/archive/personalized${params.length ? `?${params.join("&")}` : ""}`;
      },
    }),
    getArchiveFavoriteIds: builder.query({
      query: (batchId) => `/batches/${batchId}/archive/favorites/ids`,
      providesTags: ["ArchiveFavorite"],
    }),
    // Predicted papers an admin shared as archive practice sets.
    getArchivePredictedSets: builder.query({
      query: (batchId) => `/batches/${batchId}/archive/predicted`,
      refetchOnMountOrArgChange: true,
    }),
    getArchivePredictedSetQuestions: builder.query({
      query: ({ batchId, setId }) => `/batches/${batchId}/archive/predicted/${setId}/questions`,
    }),
    getArchiveFavoriteQuestions: builder.query({
      query: ({ batchId, limit }) =>
        `/batches/${batchId}/archive/favorites${limit ? `?limit=${limit}` : ""}`,
    }),
    toggleArchiveFavorite: builder.mutation({
      query: ({ batchId, questionId }) => ({
        url: `/batches/${batchId}/archive/favorites/${questionId}`, method: "POST",
      }),
      invalidatesTags: ["ArchiveFavorite"],
    }),
    getArchiveStudyPlan: builder.query({
      query: (batchId) => `/batches/${batchId}/archive/study-plan`,
      providesTags: ["ArchiveStudyPlan"],
      refetchOnMountOrArgChange: true,
    }),
    getArchiveStudyPlanCapacity: builder.query({
      query: (batchId) => `/batches/${batchId}/archive/study-plan/capacity`,
      providesTags: ["ArchiveStudyPlan"],
    }),
    generateArchiveStudyPlan: builder.mutation({
      query: ({ batchId, durationDays }) => ({
        url: `/batches/${batchId}/archive/study-plan/generate`, method: "POST", body: { durationDays },
      }),
      invalidatesTags: ["ArchiveStudyPlan", "AiCredit"],
    }),
    toggleArchiveStudyPlanDay: builder.mutation({
      query: ({ batchId, day, completed }) => ({
        url: `/batches/${batchId}/archive/study-plan/days/${day}/complete`, method: "PATCH", body: { completed },
      }),
      invalidatesTags: ["ArchiveStudyPlan"],
    }),
    getArchiveExamRecord: builder.query({
      query: (batchId) => `/batches/${batchId}/archive/exam-record`,
      providesTags: ["ArchiveExamRecord"],
    }),
    buildArchiveExam: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/archive/exam`, method: "POST", body }),
    }),
    submitArchiveExam: builder.mutation({
      query: ({ batchId, answers }) => ({ url: `/batches/${batchId}/archive/exam/submit`, method: "POST", body: { answers } }),
      invalidatesTags: ["ArchiveExamRecord", "AiCredit"],
    }),
    getArchiveExamInsight: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/archive/exam/insight`, method: "POST", body }),
      invalidatesTags: ["AiCredit"],
    }),

    // ---------- study plan ----------
    getStudyPlan: builder.query({
      // Time zone: plan days tick from today's work (utils/tutor.js syncPlan).
      query: (batchId) => `/batches/${batchId}/study-plan?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`,
      providesTags: ["StudyPlan"],
      // Without this, a plan fetched before an admin turned the feature off
      // can keep rendering straight from cache on remount, instead of
      // re-hitting the (now feature-gated) endpoint — same reasoning as
      // getBatch above.
      refetchOnMountOrArgChange: true,
    }),
    // The longest plan this student's current weak-topic content actually
    // supports — the duration picker uses this to gray out lengths that
    // would just come back shorter than picked (see
    // studyPlanController.js's capacityDays). Invalidated by StudyPlan
    // since it depends on the same practice/exam history a regenerate
    // reflects.
    getStudyPlanCapacity: builder.query({
      query: (batchId) => `/batches/${batchId}/study-plan/capacity`,
      providesTags: ["StudyPlan"],
    }),
    generateStudyPlan: builder.mutation({
      query: ({ batchId, durationDays }) => ({
        url: `/batches/${batchId}/study-plan/generate`, method: "POST", body: { durationDays },
      }),
      invalidatesTags: ["StudyPlan", "AiCredit"],
    }),
    toggleStudyPlanDay: builder.mutation({
      query: ({ batchId, day, completed }) => ({
        url: `/batches/${batchId}/study-plan/days/${day}/complete`, method: "PATCH", body: { completed },
      }),
      invalidatesTags: ["StudyPlan"],
    }),

    // ---------- purchases ----------
    getBatchPlans: builder.query({
      query: (batchId) => `/purchases/batches/${batchId}/plans`,
      refetchOnMountOrArgChange: true,
    }),
    // Lazy on purpose — this fires on a debounced keystroke, not on
    // mount, so the plain (non-lazy) query hook's auto-fetch-on-render
    // behavior would be the wrong shape here regardless of args.
    previewCoupon: builder.query({
      query: ({ batchId, code, planLabel, currency }) =>
        `/purchases/batches/${batchId}/coupon-preview?code=${encodeURIComponent(code)}&planLabel=${encodeURIComponent(planLabel)}${currency ? `&currency=${currency}` : ""}`,
    }),
    startCheckout: builder.mutation({
      query: (body) => ({ url: "/purchases/checkout", method: "POST", body }),
      // A free plan (or a coupon covering the price) grants access at once:
      // the home screen and lists must show the new batch straight away.
      invalidatesTags: (result) => (result?.free ? ["Batch", "Purchase"] : []),
    }),
    getAiCreditPlans: builder.query({
      query: (batchId) => `/purchases/batches/${batchId}/ai-credit-plans`,
      providesTags: ["AiCredit"],
      refetchOnMountOrArgChange: true,
    }),
    getGeneralAiCreditPlans: builder.query({
      query: () => "/purchases/ai-credit-plans",
      providesTags: ["AiCredit"],
      refetchOnMountOrArgChange: true,
    }),
    previewAiCreditCoupon: builder.query({
      query: ({ planId, code, batchId }) =>
        `/purchases/ai-credits/coupon-preview?planId=${planId}&code=${encodeURIComponent(code)}${batchId ? `&batchId=${batchId}` : ""}`,
    }),
    startAiCreditCheckout: builder.mutation({
      query: (body) => ({ url: "/purchases/ai-credits/checkout", method: "POST", body }),
      // Only actually changes the balance on a free (price 0) pack, which
      // grants instantly — a paid one only grants once the gateway
      // webhook lands, well after this call returns. Invalidating here
      // regardless is harmless (a refetch that finds nothing changed yet
      // costs one extra request), and correct for the free-pack case.
      invalidatesTags: ["AiCredit"],
    }),
    verifyCheckout: builder.query({
      query: (sessionId) => `/purchases/verify/${sessionId}`,
    }),
    getPurchases: builder.query({
      query: (page) => `/purchases?page=${page || 1}`,
      providesTags: ["Purchase"],
    }),
    // My referral code and rewards (backend controllers/app/referralController.js).
    getMyReferrals: builder.query({
      query: () => "/purchases/referrals",
      providesTags: ["Purchase"],
    }),
    getPurchase: builder.query({
      query: (id) => `/purchases/${id}`,
      providesTags: (r, e, id) => [{ type: "Purchase", id }],
    }),

    // ---------- ai usage ----------
    // Today's free-call count/limit plus both credit pools, for the meter
    // shown on practice and doubt pages — see aiUsageController.js for why
    // this isn't behind one specific requireFeature.
    getAiUsage: builder.query({
      query: (batchId) => `/batches/${batchId}/ai-usage`,
      providesTags: ["AiCredit"],
      refetchOnMountOrArgChange: true,
    }),

    // ---------- doubts ----------
    getMyDoubts: builder.query({
      query: ({ batchId, page }) => `/batches/${batchId}/doubts?page=${page || 1}`,
      providesTags: ["Doubt"],
      refetchOnMountOrArgChange: true,
    }),
    getDoubtQuota: builder.query({
      query: (batchId) => `/batches/${batchId}/doubts/quota`,
      providesTags: ["Doubt"],
      refetchOnMountOrArgChange: true,
    }),
    getDoubt: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/doubts/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Doubt", id }],
      refetchOnMountOrArgChange: true,
    }),
    createDoubt: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/doubts`, method: "POST", body }),
      // "ai" mode spends against today's allowance or a credit right away;
      // "human" mode doesn't touch AI usage at all, but invalidating either
      // way is a single harmless extra fetch, not a second code path to
      // keep in sync.
      invalidatesTags: ["Doubt", "AiCredit"],
    }),
    uploadDoubtImage: builder.mutation({
      query: ({ batchId, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/batches/${batchId}/doubts/upload-image`, method: "POST", body };
      },
    }),
    regenerateDoubt: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/doubts/${id}/regenerate`, method: "POST" }),
      invalidatesTags: (r, e, { id }) => ["Doubt", { type: "Doubt", id }, "AiCredit"],
    }),
    escalateDoubt: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/doubts/${id}/escalate`, method: "POST" }),
      invalidatesTags: (r, e, { id }) => ["Doubt", { type: "Doubt", id }],
    }),
    requestDoubtReview: builder.mutation({
      query: ({ batchId, id, reason }) => ({
        url: `/batches/${batchId}/doubts/${id}/request-review`, method: "POST", body: { reason },
      }),
      invalidatesTags: (r, e, { id }) => ["Doubt", { type: "Doubt", id }],
    }),

    // ---------- live classes ----------
    // Certificates: mine, and the public check by number.
    getMyCertificates: builder.query({
      query: () => "/certificates",
    }),
    // A progress report from the link in an SMS or email (no login).
    getProgressReport: builder.query({
      query: (token) => `/progress/${encodeURIComponent(token)}`,
    }),
    verifyCertificate: builder.query({
      query: (serial) => `/verify/${encodeURIComponent(serial)}`,
    }),
    // My grades and report card (once the batch's gradebook is published).
    getMyGrades: builder.query({
      query: (batchId) => `/batches/${batchId}/grades`,
      providesTags: ["Assignment"],
    }),
    // Assignments (coursework with a due date).
    getAssignments: builder.query({
      query: (batchId) => `/batches/${batchId}/assignments`,
      providesTags: ["Assignment"],
    }),
    getAssignment: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/assignments/${id}`,
      providesTags: (r, e, { id }) => [{ type: "Assignment", id }],
    }),
    saveAssignmentWork: builder.mutation({
      query: ({ batchId, id, ...body }) => ({ url: `/batches/${batchId}/assignments/${id}/submission`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Assignment", id }],
    }),
    submitAssignment: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/assignments/${id}/submit`, method: "POST" }),
      invalidatesTags: (r, e, { id }) => ["Assignment", { type: "Assignment", id }],
    }),
    uploadAssignmentFile: builder.mutation({
      query: ({ batchId, id, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/batches/${batchId}/assignments/${id}/upload`, method: "POST", body };
      },
    }),
    getLiveClasses: builder.query({
      query: ({ batchId, page, filter } = {}) => `/batches/${batchId}/live-classes?page=${page || 1}${filter && filter !== "all" ? `&filter=${filter}` : ""}`,
      providesTags: ["LiveClass"],
    }),
    getLiveClass: builder.query({
      query: ({ batchId, id }) => `/batches/${batchId}/live-classes/${id}`,
      providesTags: (result, error, { id }) => [{ type: "LiveClass", id }],
    }),
    // The in-app classroom's Q&A board and polls.
    // The classroom's Q&A and polls. A public webinar's guest passes
    // batchId GUEST and the webinar's link name as id.
    getLiveQa: builder.query({
      query: ({ batchId, id }) => `${roomBase(batchId, id)}/qa`,
    }),
    askLiveQa: builder.mutation({
      query: ({ batchId, id, text }) => ({ url: `${roomBase(batchId, id)}/qa`, method: "POST", body: { text } }),
    }),
    upvoteLiveQa: builder.mutation({
      query: ({ batchId, id, qid }) => ({ url: `${roomBase(batchId, id)}/qa/${qid}/upvote`, method: "POST" }),
    }),
    getLivePoll: builder.query({
      query: ({ batchId, id }) => `${roomBase(batchId, id)}/polls/current`,
    }),
    answerLivePoll: builder.mutation({
      query: ({ batchId, id, pid, key }) => ({ url: `${roomBase(batchId, id)}/polls/${pid}/answer`, method: "POST", body: { key } }),
    }),
    // Public webinars (/w/:slug): the page, joining as a guest, the room.
    getWebinar: builder.query({
      query: (slug) => `/webinars/${encodeURIComponent(slug)}`,
    }),
    joinWebinar: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/webinars/${encodeURIComponent(slug)}/join`, method: "POST", body }),
    }),
    verifyWebinar: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/webinars/${encodeURIComponent(slug)}/verify`, method: "POST", body }),
    }),
    googleWebinar: builder.mutation({
      query: ({ slug, ...body }) => ({ url: `/webinars/${encodeURIComponent(slug)}/google`, method: "POST", body }),
    }),
    getWebinarReplay: builder.mutation({
      query: (slug) => ({ url: `/webinars/${encodeURIComponent(slug)}/replay` }),
    }),
    getWebinarRoomToken: builder.mutation({
      query: (slug) => ({ url: `/webinars/${encodeURIComponent(slug)}/room-token`, method: "POST" }),
    }),
    // A pass into an in-app (LiveKit) class.
    getLiveRoomToken: builder.mutation({
      query: ({ batchId, id }) => ({ url: `/batches/${batchId}/live-classes/${id}/room-token`, method: "POST" }),
    }),
  })),
}));

export const {
  useGetWebinarQuery, useJoinWebinarMutation, useVerifyWebinarMutation, useGetWebinarRoomTokenMutation, useGoogleWebinarMutation, useGetWebinarReplayMutation,
  useGetMyGradesQuery, useGetMyCertificatesQuery, useVerifyCertificateQuery, useGetProgressReportQuery,
  useGetAssignmentsQuery, useGetAssignmentQuery, useSaveAssignmentWorkMutation, useSubmitAssignmentMutation, useUploadAssignmentFileMutation,
  useGetNotificationsQuery, useGetUnreadNotificationCountQuery,
  useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation, useDeleteNotificationMutation,
  useGetGeneralNoticesQuery, useGetBatchNoticesQuery, useGetLeaderboardQuery,
  useGetDashboardQuery, useLocateItemQuery, useGetQuestionVideoLessonQuery, useGetLectureVideoLessonQuery, useGetBatchesQuery, useGetBatchQuery, useStartTrialMutation,
  useGetLecturesQuery, useGetLectureQuery, useUpdateLectureProgressMutation, useSummarizeLectureMutation,
  useSummarizeLectureAttachmentsMutation, useGetLecturePracticeQuery,
  useGetDocChatSettingsQuery, useGetDocChatThreadsQuery, useGetDocChatThreadQuery, useAskDocChatMutation,
  useUploadDocChatImageMutation, useDeleteDocChatThreadMutation, useUnlockDocChatMutation,
  useGetPoraSettingsQuery, useGetPoraSessionsQuery, useGetPoraSessionQuery, useStartPoraMutation, usePoraTurnMutation,
  useEndPoraMutation, useUnlockPoraMutation, useDeletePoraMutation, useSpeakPoraMutation,
  useGetTutorSettingsQuery, useGetTutorSessionsQuery, useGetTutorSessionQuery, useStartTutorMutation, useTutorTurnMutation,
  useEndTutorMutation, useUnlockTutorMutation, useDeleteTutorMutation, useUploadTutorImageMutation,
  useGetInterviewSettingsQuery, useGetInterviewSessionsQuery, useGetInterviewSessionQuery, useStartInterviewMutation,
  useInterviewTurnMutation, useEndInterviewMutation, useDeleteInterviewMutation, useUnlockInterviewMutation, useSpeakInterviewMutation,
  useGetExamsQuery, useGetExamRulesQuery, useStartExamMutation,
  useGetPracticeExamRecordQuery, useBuildPracticeExamMutation, useSubmitPracticeExamMutation,
  useSaveAnswerMutation, useLogViolationMutation, useUploadAnswerImageMutation, useRunCodeMutation, useGetCodingProblemsQuery, useGetCodingProblemQuery, useGetSlideDecksQuery, useGetSlideDeckQuery, useSaveCodingDraftMutation, useRunCodingProblemMutation, useSubmitCodingProblemMutation, useSubmitExamMutation, useGetSubmissionQuery,   useGetSubmissionsQuery,
  useRequestExamReviewMutation,
  useGetPracticeTopicsQuery, useGetLearnTopicsQuery, useGetLearnCardsQuery, useRateLearnCardMutation, useGetWeakTopicsQuery, useGetPracticeQuestionsQuery, useGetPersonalizedQuestionsQuery, useSubmitPracticeAttemptMutation,
  useGetPracticeExamInsightMutation,
  useGetFavoriteIdsQuery, useGetFavoriteQuestionsQuery, useToggleFavoriteMutation,
  useGetStudentVideosQuery, useRequestStudentVideoMutation, useDeleteStudentVideoMutation,
  useExplainPracticeAttemptMutation, useGetPracticeQnaQuery, useAskPracticeQnaMutation, useGradeWrittenPracticeAttemptMutation, useUploadPracticeAnswerImageMutation, useUploadArchiveAnswerImageMutation, useGetPracticeHintMutation, useGetSimilarQuestionsMutation,
  useGetArchiveFiltersQuery, useGetArchiveTopicsQuery, useGetArchiveQuestionsQuery, useSubmitArchiveAttemptMutation,
  useExplainArchiveAttemptMutation, useGetArchiveHintMutation, useGradeArchiveWrittenMutation, useGetArchiveSimilarQuestionsMutation, useGetArchiveWeakTopicsQuery,
  useGetArchivePersonalizedQuestionsQuery, useGetArchiveAiUsageQuery,
  useGetArchiveFavoriteIdsQuery, useGetArchiveFavoriteQuestionsQuery, useToggleArchiveFavoriteMutation,
  useGetArchivePredictedSetsQuery, useGetArchivePredictedSetQuestionsQuery,
  useGetArchiveStudyPlanQuery, useGetArchiveStudyPlanCapacityQuery, useGenerateArchiveStudyPlanMutation, useToggleArchiveStudyPlanDayMutation,
  useGetArchiveExamRecordQuery, useBuildArchiveExamMutation, useSubmitArchiveExamMutation, useGetArchiveExamInsightMutation,
  useGetStudyPlanQuery, useGetStudyPlanCapacityQuery, useGenerateStudyPlanMutation, useToggleStudyPlanDayMutation,
  useGetBatchPlansQuery, useLazyPreviewCouponQuery, useStartCheckoutMutation, useVerifyCheckoutQuery, useGetPurchasesQuery, useGetPurchaseQuery, useGetMyReferralsQuery,
  useGetAiCreditPlansQuery, useLazyPreviewAiCreditCouponQuery, useStartAiCreditCheckoutMutation,
  useGetGeneralAiCreditPlansQuery,
  useGetAiUsageQuery,
  useGetMyDoubtsQuery, useGetDoubtQuotaQuery, useGetDoubtQuery, useCreateDoubtMutation, useRegenerateDoubtMutation, useEscalateDoubtMutation,
  useRequestDoubtReviewMutation,
  useUploadDoubtImageMutation,
  useGetLiveClassesQuery, useGetLiveClassQuery, useGetLiveRoomTokenMutation,
  useGetLiveQaQuery, useAskLiveQaMutation, useUpvoteLiveQaMutation, useGetLivePollQuery, useAnswerLivePollMutation,
} = contentApi;
