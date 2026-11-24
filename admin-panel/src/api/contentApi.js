import { apiSlice } from "./apiSlice";

const qs = (params = {}) => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return clean.length ? `?${new URLSearchParams(Object.fromEntries(clean))}` : "";
};

export const contentApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ---------- taxonomy ----------
    getTree: builder.query({
      query: () => "/taxonomy/tree",
      providesTags: ["Subject", "Chapter", "Topic"],
    }),
    getSubjects: builder.query({
      query: () => "/taxonomy/subjects",
      providesTags: ["Subject"],
    }),
    createSubject: builder.mutation({
      query: (body) => ({ url: "/taxonomy/subjects", method: "POST", body }),
      invalidatesTags: ["Subject"],
    }),
    createChapter: builder.mutation({
      query: (body) => ({ url: "/taxonomy/chapters", method: "POST", body }),
      invalidatesTags: ["Chapter"],
    }),
    createTopic: builder.mutation({
      query: (body) => ({ url: "/taxonomy/topics", method: "POST", body }),
      invalidatesTags: ["Topic"],
    }),

    updateSubject: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/taxonomy/subjects/${id}`, method: "PUT", body }),
      invalidatesTags: ["Subject"],
    }),
    updateChapter: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/taxonomy/chapters/${id}`, method: "PUT", body }),
      invalidatesTags: ["Chapter"],
    }),
    updateTopic: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/taxonomy/topics/${id}`, method: "PUT", body }),
      invalidatesTags: ["Topic"],
    }),

    deleteSubject: builder.mutation({
      query: (id) => ({ url: `/taxonomy/subjects/${id}`, method: "DELETE" }),
      invalidatesTags: ["Subject"],
    }),
    deleteChapter: builder.mutation({
      query: (id) => ({ url: `/taxonomy/chapters/${id}`, method: "DELETE" }),
      invalidatesTags: ["Chapter"],
    }),
    deleteTopic: builder.mutation({
      query: (id) => ({ url: `/taxonomy/topics/${id}`, method: "DELETE" }),
      invalidatesTags: ["Topic"],
    }),

    // ---------- exam authorities (boards/entrance exams/textbooks) ----------
    getAuthorities: builder.query({
      query: (params) => `/taxonomy/authorities${qs(params)}`,
      providesTags: ["ExamAuthority"],
    }),
    // Questions per board and the years they come from, for the archive.
    getArchiveStats: builder.query({
      query: (params) => `/taxonomy/authorities/archive-stats${qs(params)}`,
      providesTags: ["ExamAuthority", "Question"],
    }),
    createAuthority: builder.mutation({
      query: (body) => ({ url: "/taxonomy/authorities", method: "POST", body }),
      invalidatesTags: ["ExamAuthority"],
    }),
    updateAuthority: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/taxonomy/authorities/${id}`, method: "PUT", body }),
      invalidatesTags: ["ExamAuthority"],
    }),
    uploadAuthorityIcon: builder.mutation({
      query: ({ id, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/taxonomy/authorities/${id}/icon`, method: "POST", body };
      },
      invalidatesTags: ["ExamAuthority"],
    }),
    deleteAuthority: builder.mutation({
      query: (id) => ({ url: `/taxonomy/authorities/${id}`, method: "DELETE" }),
      invalidatesTags: ["ExamAuthority"],
    }),

    // Question counts per topic, so a topic can show how much sits under it
    // before anyone tries to delete it.
    getQuestionStats: builder.query({
      query: () => "/questions/stats",
      providesTags: ["Question"],
    }),

    // ---------- questions ----------
    getQuestions: builder.query({
      query: (params) => `/questions${qs(params)}`,
      providesTags: ["Question"],
    }),
    getQuestion: builder.query({
      query: (id) => `/questions/${id}`,
      providesTags: (r, e, id) => [{ type: "Question", id }],
    }),
    createQuestion: builder.mutation({
      query: (body) => ({ url: "/questions", method: "POST", body }),
      invalidatesTags: ["Question"],
    }),
    updateQuestion: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/questions/${id}`, method: "PUT", body }),
      invalidatesTags: ["Question"],
    }),
    // Re-scores a question in every finished exam attempt that used it,
    // after its answer key changed.
    rescoreQuestion: builder.mutation({
      query: (id) => ({ url: `/questions/${id}/rescore`, method: "POST" }),
      invalidatesTags: ["Question", "Submissions", "Grading"],
    }),
    // Copies written questions' model answers into their missing solutions.
    applyModelAnswers: builder.mutation({
      query: () => ({ url: "/questions/bulk/model-answers", method: "POST" }),
      invalidatesTags: ["Question"],
    }),
    deleteQuestion: builder.mutation({
      query: (id) => ({ url: `/questions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Question"],
    }),
    // Reassigns a batch of questions to a different topic (or the chapter
    // pool) in one call, instead of opening each one in the editor — see
    // bulkMoveQuestions' own comment for why this exists. `topic` XOR
    // `chapter` (chapter alone means "move to this chapter's pool"), same
    // convention as createQuestion/updateQuestion's filing fields.
    bulkMoveQuestions: builder.mutation({
      query: (body) => ({ url: "/questions/bulk/move", method: "PUT", body }),
      invalidatesTags: ["Question"],
    }),
    bulkArchiveQuestions: builder.mutation({
      query: (body) => ({ url: "/questions/bulk/archive", method: "PUT", body }),
      invalidatesTags: ["Question"],
    }),
    importQuestionsFile: builder.mutation({
      query: ({ topicId, chapterId, type, file }) => {
        const body = new FormData();
        // Exactly one of these — the chapter pool (topicId omitted) or a
        // normal topic (chapterId omitted). The server rejects both/neither.
        if (topicId) body.append("topicId", topicId);
        if (chapterId) body.append("chapterId", chapterId);
        body.append("type", type);
        body.append("file", file);
        return { url: "/questions/bulk/import", method: "POST", body };
      },
      invalidatesTags: ["Question"],
    }),
    getQuestionTags: builder.query({
      query: () => "/questions/tags",
      providesTags: ["Question"],
    }),

    // ---------- exams ----------
    getExams: builder.query({
      query: (params) => `/exams${qs(params)}`,
      providesTags: ["Exam"],
    }),
    getExam: builder.query({
      query: (id) => `/exams/${id}`,
      providesTags: (r, e, id) => [{ type: "Exam", id }],
    }),
    createExam: builder.mutation({
      query: (body) => ({ url: "/exams", method: "POST", body }),
      invalidatesTags: ["Exam"],
    }),
    setExamQuestions: builder.mutation({
      query: ({ id, questionIds }) => ({
        url: `/exams/${id}/questions`, method: "PUT", body: { questionIds },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: "Exam", id }, "Exam"],
    }),
    smartPickExamQuestions: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/exams/${id}/smart-pick`, method: "POST", body,
      }),
      invalidatesTags: (r, e, { id }) => [{ type: "Exam", id }, "Exam"],
    }),
    publishExam: builder.mutation({
      query: ({ id, isPublished, force }) => ({
        url: `/exams/${id}/publish`, method: "PUT", body: { isPublished, force },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: "Exam", id }, "Exam"],
    }),

    updateExam: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/exams/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Exam", id }, "Exam"],
    }),
    setExamActive: builder.mutation({
      query: ({ id, isActive }) => ({
        url: `/exams/${id}/active`, method: "PUT", body: { isActive },
      }),
      invalidatesTags: (r, e, { id }) => [{ type: "Exam", id }, "Exam"],
    }),
    duplicateExam: builder.mutation({
      query: ({ id, title }) => ({ url: `/exams/${id}/duplicate`, method: "POST", body: { title } }),
      invalidatesTags: ["Exam"],
    }),
    deleteExam: builder.mutation({
      query: (id) => ({ url: `/exams/${id}`, method: "DELETE" }),
      invalidatesTags: ["Exam"],
    }),

    // ---------- paper sets (backend examSetController.js) ----------
    getExamSets: builder.query({
      query: () => "/exam-sets",
      providesTags: ["ExamSet"],
    }),
    getExamSet: builder.query({
      query: (id) => `/exam-sets/${id}`,
      providesTags: (r, e, id) => [{ type: "ExamSet", id }],
    }),
    createExamSet: builder.mutation({
      query: (body) => ({ url: "/exam-sets", method: "POST", body }),
      invalidatesTags: ["ExamSet"],
    }),
    updateExamSet: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/exam-sets/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "ExamSet", id }, "ExamSet", "Exam"],
    }),
    buildExamSet: builder.mutation({
      query: (id) => ({ url: `/exam-sets/${id}/build`, method: "POST" }),
      invalidatesTags: (r, e, id) => [{ type: "ExamSet", id }, "ExamSet", "Exam"],
    }),
    publishExamSet: builder.mutation({
      query: ({ id, isPublished }) => ({ url: `/exam-sets/${id}/publish`, method: "PUT", body: { isPublished } }),
      invalidatesTags: (r, e, { id }) => [{ type: "ExamSet", id }, "ExamSet", "Exam"],
    }),
    getExamSetResults: builder.query({
      query: (id) => `/exam-sets/${id}/results`,
      providesTags: (r, e, id) => [{ type: "ExamSet", id }],
    }),
    deleteExamSet: builder.mutation({
      query: (id) => ({ url: `/exam-sets/${id}`, method: "DELETE" }),
      invalidatesTags: ["ExamSet", "Exam"],
    }),

    // ---------- programs and batches ----------
    getPrograms: builder.query({
      query: ({ includeInactive = false }) => ({
        url: "/programs",
        params: includeInactive ? { includeInactive: "true" } : {},
      }),
      providesTags: ["Program"],
    }),
    createProgram: builder.mutation({
      query: (body) => ({ url: "/programs", method: "POST", body }),
      invalidatesTags: ["Program"],
    }),
    updateProgram: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/programs/${id}`, method: "PUT", body }),
      invalidatesTags: ["Program"],
    }),
    deleteProgram: builder.mutation({
      query: (id) => ({ url: `/programs/${id}`, method: "DELETE" }),
      invalidatesTags: ["Program", "Batch"],
    }),
    reorderPrograms: builder.mutation({
      query: (body) => ({ url: "/programs/reorder", method: "PUT", body }),
      invalidatesTags: ["Program"],
    }),
    getBatches: builder.query({
      query: (params) => `/batches${qs(params)}`,
      providesTags: ["Batch"],
    }),
    getBatch: builder.query({
      query: (id) => `/batches/${id}`,
      providesTags: (r, e, id) => [{ type: "Batch", id }],
    }),
    uploadBatchIcon: builder.mutation({
      query: ({ id, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/batches/${id}/icon`, method: "POST", body };
      },
      invalidatesTags: (r, e, { id }) => ["Batch", { type: "Batch", id }],
    }),
    createBatch: builder.mutation({
      query: (body) => ({ url: "/batches", method: "POST", body }),
      invalidatesTags: ["Batch"],
    }),
    duplicateBatch: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/batches/${id}/duplicate`, method: "POST", body }),
      invalidatesTags: ["Batch"],
    }),
    reorderBatches: builder.mutation({
      query: (body) => ({ url: "/batches/reorder", method: "PUT", body }),
      invalidatesTags: ["Batch"],
    }),
    getPromote: builder.query({
      query: (id) => `/batches/${id}/promote`,
      providesTags: ["Batch"],
    }),
    promoteBatch: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/batches/${id}/promote`, method: "POST", body }),
      invalidatesTags: ["Batch", "Student"],
    }),
    updateBatch: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/batches/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Batch", id }, "Batch"],
    }),
    deleteBatch: builder.mutation({
      query: (id) => ({ url: `/batches/${id}`, method: "DELETE" }),
      invalidatesTags: ["Batch"],
    }),
    addPlan: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/batches/${id}/plans`, method: "POST", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Batch", id }, "Batch"],
    }),
    deletePlan: builder.mutation({
      query: ({ id, planId }) => ({ url: `/batches/${id}/plans/${planId}`, method: "DELETE" }),
      invalidatesTags: (r, e, { id }) => [{ type: "Batch", id }, "Batch"],
    }),
    // Which chapter-pools and topics actually have a question assigned to
    // this batch — tagged under the batch's own id so assigning/unassigning
    // content (which invalidates "Batch") refreshes this alongside it.
    getContentCoverage: builder.query({
      query: (id) => `/batches/${id}/content-coverage`,
      providesTags: (r, e, id) => [{ type: "Batch", id }],
    }),

    // ---------- ai credit plans ----------
    getCreditPlans: builder.query({
      query: (id) => `/batches/${id}/ai-credit-plans`,
      providesTags: (r, e, id) => [{ type: "Batch", id }],
    }),
    addCreditPlan: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/batches/${id}/ai-credit-plans`, method: "POST", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Batch", id }],
    }),
    updateCreditPlan: builder.mutation({
      query: ({ id, planId, ...body }) => ({ url: `/batches/${id}/ai-credit-plans/${planId}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Batch", id }],
    }),
    deleteCreditPlan: builder.mutation({
      query: ({ id, planId }) => ({ url: `/batches/${id}/ai-credit-plans/${planId}`, method: "DELETE" }),
      invalidatesTags: (r, e, { id }) => [{ type: "Batch", id }],
    }),

    // ---------- assignment ----------
    getAssigned: builder.query({
      query: ({ batchId, kind, ...params }) => `/batches/${batchId}/assigned/${kind}${qs(params)}`,
      providesTags: ["Batch"],
    }),
    // The batch's own order and named groups (backend outlineController).
    getOutline: builder.query({
      query: (batchId) => `/batches/${batchId}/outline`,
      providesTags: (r, e, batchId) => [{ type: "Batch", id: `outline-${batchId}` }],
    }),
    saveOutline: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/outline`, method: "PUT", body }),
      invalidatesTags: ["Batch"],
    }),
    getAssignable: builder.query({
      query: ({ batchId, kind, ...params }) => `/batches/${batchId}/assignable/${kind}${qs(params)}`,
      providesTags: ["Batch"],
    }),
    assignToBatch: builder.mutation({
      query: ({ batchId, kind, ids }) => ({
        url: `/batches/${batchId}/assigned/${kind}`, method: "POST", body: { ids },
      }),
      invalidatesTags: ["Batch", "Exam", "Lecture", "Question"],
    }),
    // AI video lessons (backend videoLessonController.js).
    getVideoLesson: builder.query({
      query: ({ question, lecture }) => `/video-lessons${qs(question ? { question } : { lecture })}`,
      providesTags: ["VideoLesson"],
    }),
    // A batch's lectures with their AI video lessons, for the course export.
    getCourseVideoLessons: builder.query({
      query: (batch) => `/video-lessons/course${qs({ batch })}`,
      providesTags: ["VideoLesson"],
    }),
    generateVideoLesson: builder.mutation({
      query: (body) => ({ url: "/video-lessons/generate", method: "POST", body }),
      invalidatesTags: ["VideoLesson"],
    }),
    updateVideoLesson: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/video-lessons/${id}`, method: "PUT", body }),
      invalidatesTags: ["VideoLesson"],
    }),
    voiceVideoLesson: builder.mutation({
      query: (arg) => ({ url: `/video-lessons/${arg.id || arg}/voice`, method: "POST", body: { redo: Boolean(arg.redo) } }),
      invalidatesTags: ["VideoLesson"],
    }),
    // Stops making the voice; what's voiced is kept.
    stopVideoLessonVoice: builder.mutation({
      query: (id) => ({ url: `/video-lessons/${id}/voice/stop`, method: "POST" }),
      invalidatesTags: ["VideoLesson"],
    }),
    // One part done again by AI; returns replacement parts, saves nothing.
    humanizeVideoLessonPart: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/video-lessons/${id}/humanize`, method: "POST", body }),
    }),
    reviseVideoLessonPart: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/video-lessons/${id}/revise`, method: "POST", body }),
    }),
    deleteVideoLesson: builder.mutation({
      query: (id) => ({ url: `/video-lessons/${id}`, method: "DELETE" }),
      invalidatesTags: ["VideoLesson"],
    }),
    assignMatching: builder.mutation({
      query: ({ batchId, kind, ...filters }) => ({
        url: `/batches/${batchId}/assign-matching/${kind}`, method: "POST", body: filters,
      }),
      invalidatesTags: ["Batch", "Exam", "Lecture", "Question"],
    }),
    unassignFromBatch: builder.mutation({
      query: ({ batchId, kind, ids }) => ({
        url: `/batches/${batchId}/assigned/${kind}`, method: "DELETE", body: { ids },
      }),
      invalidatesTags: ["Batch", "Exam", "Lecture", "Question"],
    }),
    setItemBatches: builder.mutation({
      query: ({ kind, itemId, batchIds }) => ({
        url: `/assignments/${kind}/${itemId}/batches`, method: "PUT", body: { batchIds },
      }),
      invalidatesTags: ["Batch", "Exam", "Lecture", "Question"],
    }),
    copyAssignments: builder.mutation({
      query: ({ targetId, sourceId }) => ({
        url: `/batches/${targetId}/copy-from/${sourceId}`, method: "POST", body: {},
      }),
      invalidatesTags: ["Batch", "Exam", "Lecture", "Question"],
    }),

    // ---------- lectures ----------
    getLectures: builder.query({
      query: (params) => `/lectures${qs(params)}`,
      providesTags: ["Lecture"],
    }),
    getLecture: builder.query({
      query: (id) => `/lectures/${id}`,
      providesTags: (result, error, id) => [{ type: "Lecture", id }],
    }),
    createLecture: builder.mutation({
      query: (body) => ({ url: "/lectures", method: "POST", body }),
      invalidatesTags: ["Lecture"],
    }),
    updateLecture: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/lectures/${id}`, method: "PUT", body }),
      invalidatesTags: (result, error, { id }) => ["Lecture", { type: "Lecture", id }],
    }),
    deleteLecture: builder.mutation({
      query: (id) => ({ url: `/lectures/${id}`, method: "DELETE" }),
      invalidatesTags: ["Lecture"],
    }),
    reorderLectures: builder.mutation({
      query: (ids) => ({ url: "/lectures/reorder", method: "PUT", body: { ids } }),
      invalidatesTags: ["Lecture", "Batch"],
    }),
    getLectureStats: builder.query({
      query: (id) => `/lectures/${id}/stats`,
      providesTags: (result, error, id) => [{ type: "Lecture", id }],
    }),
    getLectureOrder: builder.query({
      query: () => "/lectures/order",
    }),
    setLecturesPublished: builder.mutation({
      query: (body) => ({ url: "/lectures/publish", method: "PUT", body }),
      invalidatesTags: ["Lecture"],
    }),
    setLecturePracticeQuestions: builder.mutation({
      query: ({ id, batchId, questionIds }) => ({
        url: `/lectures/${id}/practice-questions`, method: "PUT", body: { batchId, questionIds },
      }),
      invalidatesTags: (result, error, { id }) => [{ type: "Lecture", id }, "Lecture"],
    }),
    generateLecturePracticeQuestions: builder.mutation({
      query: ({ id, batchId, count, types }) => ({
        url: `/lectures/${id}/practice-questions/generate`, method: "POST", body: { batchId, count, types },
      }),
      invalidatesTags: (result, error, { id }) => [{ type: "Lecture", id }, "Lecture", "Question"],
    }),
    // Draft-only, same as suggestSeoMeta — takes the title/notes straight
    // out of the editor's own form rather than a saved lecture id, so it
    // works before the lecture has ever been saved. The editor fills its
    // description field with the result and still needs its own Save.
    // Course chat's index of a lecture's notes and files.
    reindexLecture: builder.mutation({
      query: (id) => ({ url: `/lectures/${id}/doc-index`, method: "POST" }),
      invalidatesTags: (result, error, id) => [{ type: "Lecture", id }],
    }),
    readLectureScans: builder.mutation({
      query: (id) => ({ url: `/lectures/${id}/doc-index/read-scans`, method: "POST" }),
      invalidatesTags: (result, error, id) => [{ type: "Lecture", id }],
    }),
    suggestLectureDescription: builder.mutation({
      query: (body) => ({ url: "/lectures/description/suggest", method: "POST", body }),
    }),

    // ---------- coupons ----------
    getCoupons: builder.query({
      query: (params) => `/coupons${qs(params)}`,
      providesTags: ["Coupon"],
    }),
    getCoupon: builder.query({
      query: (id) => `/coupons/${id}`,
      providesTags: (result, error, id) => [{ type: "Coupon", id }],
    }),
    createCoupon: builder.mutation({
      query: (body) => ({ url: "/coupons", method: "POST", body }),
      invalidatesTags: ["Coupon"],
    }),
    updateCoupon: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/coupons/${id}`, method: "PUT", body }),
      invalidatesTags: (result, error, { id }) => ["Coupon", { type: "Coupon", id }],
    }),
    deleteCoupon: builder.mutation({
      query: (id) => ({ url: `/coupons/${id}`, method: "DELETE" }),
      invalidatesTags: ["Coupon"],
    }),

    // ---------- representatives ----------
    getRepresentatives: builder.query({
      query: () => "/representatives",
      providesTags: ["Representative"],
    }),
    getRepresentativePerformance: builder.query({
      query: ({ id, from, to }) => `/representatives/${id}/coupons${qs({ from, to })}`,
      providesTags: ["Coupon"],
    }),
    getMyCouponPerformance: builder.query({
      query: (params) => `/representatives/me/coupons${qs(params)}`,
      providesTags: ["Coupon"],
    }),
    getAllRepresentativePerformance: builder.query({
      query: (params) => `/representatives/summary${qs(params)}`,
      providesTags: ["Coupon"],
    }),
    getShortLinksForCoupon: builder.query({
      query: (couponCode) => `/short-links?couponCode=${encodeURIComponent(couponCode)}`,
      providesTags: ["ShortLink"],
    }),
    createShortLink: builder.mutation({
      query: (body) => ({ url: "/short-links", method: "POST", body }),
      invalidatesTags: ["ShortLink"],
    }),

    // ---------- landing page ----------
    getLandingPage: builder.query({
      query: () => "/landing-page",
      providesTags: ["LandingPage"],
    }),
    updateLandingPageSections: builder.mutation({
      query: (body) => ({ url: "/landing-page", method: "PUT", body }),
      invalidatesTags: ["LandingPage"],
    }),

    // ---------- updates ----------
    getUpdates: builder.query({
      query: (params) => `/updates${qs(params)}`,
      providesTags: ["Update"],
    }),
    createUpdateItem: builder.mutation({
      query: (body) => ({ url: "/updates", method: "POST", body }),
      invalidatesTags: ["Update"],
    }),
    updateUpdateItem: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/updates/${id}`, method: "PUT", body }),
      invalidatesTags: ["Update"],
    }),
    deleteUpdateItem: builder.mutation({
      query: (id) => ({ url: `/updates/${id}`, method: "DELETE" }),
      invalidatesTags: ["Update"],
    }),

    // ---------- earnings ----------
    getEarningsSummary: builder.query({
      query: (params) => `/earnings/summary${qs(params)}`,
      providesTags: ["Earnings"],
    }),
    // Where completed sales came from (referral, short link, representative, coupon, direct).
    getEarningsSources: builder.query({
      query: (params) => `/earnings/sources${qs(params)}`,
      providesTags: ["Earnings"],
    }),
    getEarningsTrend: builder.query({
      query: (params) => `/earnings/trend${qs(params)}`,
      providesTags: ["Earnings"],
    }),
    getEarningsTransactions: builder.query({
      query: (params) => `/earnings/transactions${qs(params)}`,
      providesTags: ["Earnings"],
    }),
    getEarningsOptions: builder.query({
      query: () => "/earnings/options",
      providesTags: ["Earnings"],
    }),
    getTeamSellers: builder.query({
      query: (params) => `/earnings/team/sellers${qs(params)}`,
      providesTags: ["Earnings"],
    }),
    getTeamDoubtSolvers: builder.query({
      query: (params) => `/earnings/team/doubt-solvers${qs(params)}`,
      providesTags: ["Earnings"],
    }),

    // ---------- notices ----------
    getNotices: builder.query({
      query: (params) => `/notices${qs(params)}`,
      providesTags: ["Notice"],
    }),
    getNotice: builder.query({
      query: (id) => `/notices/${id}`,
      providesTags: (result, error, id) => [{ type: "Notice", id }],
    }),
    createNotice: builder.mutation({
      query: (body) => ({ url: "/notices", method: "POST", body }),
      invalidatesTags: ["Notice"],
    }),
    updateNotice: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/notices/${id}`, method: "PUT", body }),
      invalidatesTags: (result, error, { id }) => ["Notice", { type: "Notice", id }],
    }),
    deleteNotice: builder.mutation({
      query: (id) => ({ url: `/notices/${id}`, method: "DELETE" }),
      invalidatesTags: ["Notice"],
    }),

    // ---------- students and money ----------
    getStudents: builder.query({
      query: (params) => `/students${qs(params)}`,
      providesTags: ["Student"],
    }),
    getStudent: builder.query({
      query: (id) => `/students/${id}`,
      providesTags: (r, e, id) => [{ type: "Student", id }],
    }),
    // Oral Quiz sessions of one student, with transcripts.
    getStudentPora: builder.query({
      query: (id) => `/students/${id}/pora`,
      providesTags: (r, e, id) => [{ type: "Student", id }],
    }),
    // Interview practice sessions of one student, with transcripts.
    getStudentInterview: builder.query({
      query: (id) => `/students/${id}/interview`,
      providesTags: (r, e, id) => [{ type: "Student", id }],
    }),
    // The interviews students can practise (Settings → AI → Interview).
    getInterviewSets: builder.query({
      query: () => "/interviews",
      providesTags: ["InterviewSet"],
    }),
    createInterviewSet: builder.mutation({
      query: (body) => ({ url: "/interviews", method: "POST", body }),
      invalidatesTags: ["InterviewSet"],
    }),
    updateInterviewSet: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/interviews/${id}`, method: "PUT", body }),
      invalidatesTags: ["InterviewSet"],
    }),
    deleteInterviewSet: builder.mutation({
      query: (id) => ({ url: `/interviews/${id}`, method: "DELETE" }),
      invalidatesTags: ["InterviewSet"],
    }),
    // Draft only: the form fills in, Save keeps it.
    draftInterviewSet: builder.mutation({
      query: (body) => ({ url: "/interviews/draft", method: "POST", body }),
    }),
    // AI Tutoring sessions of one student, with transcripts.
    getStudentTutor: builder.query({
      query: (id) => `/students/${id}/tutor`,
      providesTags: (r, e, id) => [{ type: "Student", id }],
    }),
    createStudent: builder.mutation({
      query: (body) => ({ url: "/students", method: "POST", body }),
      invalidatesTags: ["Student"],
    }),
    // Students → Import (rows parsed from the spreadsheet in the browser).
    importStudents: builder.mutation({
      query: (body) => ({ url: "/students/import", method: "POST", body }),
      invalidatesTags: (r, e, { dryRun }) => (dryRun ? [] : ["Student"]),
    }),
    // Settings → Institution: IDs from the pattern for students without one.
    assignStudentIds: builder.mutation({
      query: () => ({ url: "/students/assign-ids", method: "POST" }),
      invalidatesTags: ["Student"],
    }),
    updateStudent: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/students/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Student", id }, "Student"],
    }),
    resetStudentPassword: builder.mutation({
      query: ({ id, password, name }) => ({ url: `/students/${id}/password`, method: "PUT", body: { password, name } }),
      invalidatesTags: (r, e, { id }) => [{ type: "Student", id }],
    }),
    deleteStudent: builder.mutation({
      query: (id) => ({ url: `/students/${id}`, method: "DELETE" }),
      invalidatesTags: ["Student"],
    }),
    enrolStudent: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/students/${id}/enrol`, method: "POST", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Student", id }, "Purchase"],
    }),
    recordPurchase: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/students/${id}/purchases`, method: "POST", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "Student", id }, "Purchase"],
    }),
    getPurchases: builder.query({
      query: (params) => `/purchases${qs(params)}`,
      providesTags: ["Purchase"],
    }),

    // ---------- media ----------
    getMediaProviders: builder.query({
      query: () => "/media/providers",
    }),
    uploadMedia: builder.mutation({
      // FormData rather than json: fetchBaseQuery leaves the content type
      // alone for it, which is what lets the browser set the multipart boundary.
      query: ({ file, folder }) => {
        const body = new FormData();
        body.append("file", file);
        if (folder) body.append("folder", folder);
        return { url: "/media/upload", method: "POST", body };
      },
    }),
    linkVideo: builder.mutation({
      query: (body) => ({ url: "/media/video", method: "POST", body }),
    }),
    attachFromDocument: builder.mutation({
      query: (documentId) => ({ url: `/media/from-document/${documentId}`, method: "POST", body: {} }),
    }),
    getMedia: builder.query({
      query: (id) => `/media/${id}`,
      providesTags: (r, e, id) => [{ type: "Media", id }],
    }),
    protectMedia: builder.mutation({
      query: ({ id, hd }) => ({ url: `/media/${id}/protect`, method: "POST", body: { hd: Boolean(hd) } }),
      invalidatesTags: (r, e, { id }) => [{ type: "Media", id }, "ProtectedSummary"],
    }),
    getProtectedSummary: builder.query({
      query: () => "/media/protected/summary",
      providesTags: ["ProtectedSummary"],
    }),
    protectAllMedia: builder.mutation({
      query: (body) => ({ url: "/media/protected/all", method: "POST", body }),
      invalidatesTags: ["ProtectedSummary"],
    }),
    deleteMedia: builder.mutation({
      query: (id) => ({ url: `/media/${id}`, method: "DELETE" }),
    }),

    // ---------- team ----------
    getUsers: builder.query({
      query: (params) => `/users${qs(params)}`,
      providesTags: ["User"],
    }),
    updateUser: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}`, method: "PUT", body }),
      invalidatesTags: ["User"],
    }),
    getProfilePeople: builder.query({
      query: () => "/users/profiles",
      providesTags: [{ type: "User", id: "profiles" }],
    }),
    getUserProfile: builder.query({
      query: (id) => `/users/${id}/profile`,
      providesTags: (r, e, id) => [{ type: "User", id: `profile-${id}` }],
    }),
    updateUserProfile: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/users/${id}/profile`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "User", id: `profile-${id}` }, { type: "User", id: "profiles" }],
    }),
    resetUserPassword: builder.mutation({
      query: ({ id, password }) => ({ url: `/users/${id}/password`, method: "PUT", body: { password } }),
    }),
    deleteUser: builder.mutation({
      query: (id) => ({ url: `/users/${id}`, method: "DELETE" }),
      invalidatesTags: ["User"],
    }),
    getInvites: builder.query({
      query: () => "/invites",
      providesTags: ["Invite"],
    }),
    createInvite: builder.mutation({
      query: (body) => ({ url: "/invites", method: "POST", body }),
      invalidatesTags: ["Invite"],
    }),
    revokeInvite: builder.mutation({
      query: (id) => ({ url: `/invites/${id}`, method: "DELETE" }),
      invalidatesTags: ["Invite"],
    }),

    // ---------- platform settings (student-facing branding/theme) ----------
    previewEmail: builder.mutation({ query: (body) => ({ url: "/settings/email/preview", method: "POST", body }) }),
    testEmail: builder.mutation({ query: (body) => ({ url: "/settings/email/test", method: "POST", body }) }),
    getSettings: builder.query({
      query: () => "/settings",
      providesTags: ["Settings"],
    }),
    // The student app's public settings. Readable by every staff role (the
    // admin settings above aren't): the institution's words (useTerms).
    getPublicSettings: builder.query({
      query: () => "/app/settings",
      providesTags: ["Settings"],
    }),
    updateSettings: builder.mutation({
      query: (body) => ({ url: "/settings", method: "PUT", body }),
      invalidatesTags: ["Settings", "VideoLesson"],
    }),
    // Owner-only on the server. Secrets travel up here and never come back
    // down — the response carries last-4 evidence only, so the form always
    // treats an untouched field as "keep what is stored".
    updatePaymentGateway: builder.mutation({
      query: ({ provider, ...body }) => ({
        url: `/settings/payment/${provider}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["Settings"],
    }),
    // Owner-only: old logs that grow fast (Settings → Data).
    getCleanup: builder.query({
      query: () => "/settings/cleanup",
      providesTags: ["Cleanup"],
    }),
    runCleanup: builder.mutation({
      query: (body) => ({ url: "/settings/cleanup", method: "POST", body }),
      invalidatesTags: ["Cleanup"],
    }),
    uploadLogo: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/settings/logo", method: "POST", body };
      },
      invalidatesTags: ["Settings"],
    }),
    uploadFavicon: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/settings/favicon", method: "POST", body };
      },
      invalidatesTags: ["Settings"],
    }),
    uploadFeatureIcon: builder.mutation({
      query: ({ feature, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/settings/feature-icon/${feature}`, method: "POST", body };
      },
      invalidatesTags: ["Settings"],
    }),
    // Draft-only — does not touch settings itself, the form applies the
    // result and still requires its own Save, same as any other AI-assist
    // button in this app.
    suggestSeoMeta: builder.mutation({
      query: (body) => ({ url: "/settings/seo/suggest", method: "POST", body }),
    }),
    // The site mascot: the built-in ones, and one AI draws from a
    // description (draft only: Save keeps it).
    getMascotPresets: builder.query({
      query: () => "/settings/mascot/presets",
    }),
    generateMascot: builder.mutation({
      query: (body) => ({ url: "/settings/mascot/generate", method: "POST", body }),
    }),
    // Each course page's own search and share tags.
    getCourseSeo: builder.query({
      query: () => "/settings/seo/courses",
      providesTags: ["CourseSeo"],
    }),
    updateCourseSeo: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/settings/seo/courses/${id}`, method: "PUT", body }),
      invalidatesTags: ["CourseSeo"],
    }),

    // ---------- grading ----------
    // Assignments (coursework), under /grading so teachers and graders reach them.
    getAssignments: builder.query({
      query: (params) => `/grading/assignments${qs(params)}`,
      providesTags: ["Assignment"],
    }),
    getAssignment: builder.query({
      query: (id) => `/grading/assignments/${id}`,
      providesTags: (r, e, id) => [{ type: "Assignment", id }],
    }),
    saveAssignment: builder.mutation({
      query: ({ id, ...body }) => (id ? { url: `/grading/assignments/${id}`, method: "PUT", body } : { url: "/grading/assignments", method: "POST", body }),
      invalidatesTags: ["Assignment"],
    }),
    deleteAssignment: builder.mutation({
      query: ({ id, force }) => ({ url: `/grading/assignments/${id}`, method: "DELETE", params: force ? { force: "true" } : undefined }),
      invalidatesTags: ["Assignment"],
    }),
    uploadAssignmentAttachment: builder.mutation({
      query: (file) => { const body = new FormData(); body.append("file", file); return { url: "/grading/assignments/upload", method: "POST", body }; },
    }),
    getAssignmentHandIns: builder.query({
      query: (id) => `/grading/assignments/${id}/submissions`,
      providesTags: ["AssignmentHandIn"],
    }),
    getAssignmentHandIn: builder.query({
      query: (subId) => `/grading/assignments/submissions/${subId}`,
      providesTags: (r, e, subId) => [{ type: "AssignmentHandIn", id: subId }],
    }),
    gradeAssignmentHandIn: builder.mutation({
      query: ({ subId, ...body }) => ({ url: `/grading/assignments/submissions/${subId}`, method: "PUT", body }),
      invalidatesTags: ["AssignmentHandIn", "Assignment"],
    }),
    aiCheckAssignmentHandIn: builder.mutation({
      query: (subId) => ({ url: `/grading/assignments/submissions/${subId}/ai-check`, method: "POST" }),
      invalidatesTags: (r, e, subId) => [{ type: "AssignmentHandIn", id: subId }],
    }),
    returnAllAssignment: builder.mutation({
      query: (id) => ({ url: `/grading/assignments/${id}/return-all`, method: "POST" }),
      invalidatesTags: ["AssignmentHandIn", "Assignment"],
    }),
    // Progress reports (backend controllers/admin/progressReportController.js).
    getProgressReportSettings: builder.query({ query: () => "/grading/progress-reports/settings", providesTags: ["ProgressReports"] }),
    updateProgressReportSettings: builder.mutation({
      query: (body) => ({ url: "/grading/progress-reports/settings", method: "PUT", body }),
      invalidatesTags: ["ProgressReports"],
    }),
    getProgressReportBatches: builder.query({ query: () => "/grading/progress-reports/batches", providesTags: ["ProgressReports"] }),
    getProgressReportBatch: builder.query({ query: (id) => `/grading/progress-reports/batch/${id}`, providesTags: ["ProgressReports"] }),
    updateProgressReportBatch: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/grading/progress-reports/batch/${id}`, method: "PUT", body }),
      invalidatesTags: ["ProgressReports"],
    }),
    sendProgressReportsNow: builder.mutation({
      query: ({ id, students }) => ({ url: `/grading/progress-reports/batch/${id}/send-now`, method: "POST", body: { students } }),
      invalidatesTags: ["ProgressReports", "ProgressReportLog"],
    }),
    getProgressReportLog: builder.query({
      query: (params) => ({ url: "/grading/progress-reports/log", params }),
      providesTags: ["ProgressReportLog"],
    }),
    resendProgressReport: builder.mutation({
      query: (id) => ({ url: `/grading/progress-reports/log/${id}/resend`, method: "POST" }),
      invalidatesTags: ["ProgressReportLog", "ProgressReports"],
    }),
    // Certificates (backend controllers/admin/certificateController.js).
    // A signature picture (uploaded or drawn), for certificates and report cards.
    uploadSignature: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/grading/certificates/signature", method: "POST", body };
      },
    }),
    getCertificateTemplate: builder.query({
      query: () => "/grading/certificates/template",
      providesTags: ["CertificateTemplate"],
    }),
    updateCertificateTemplate: builder.mutation({
      query: (body) => ({ url: "/grading/certificates/template", method: "PUT", body }),
      invalidatesTags: ["CertificateTemplate", "Certificate"],
    }),
    getCertificates: builder.query({
      query: (params) => `/grading/certificates${qs(params)}`,
      providesTags: ["Certificate"],
    }),
    getCertificateCandidates: builder.query({
      query: (batchId) => `/grading/certificates/candidates/${batchId}`,
      providesTags: ["Certificate"],
    }),
    issueCertificates: builder.mutation({
      query: (body) => ({ url: "/grading/certificates/issue", method: "POST", body }),
      invalidatesTags: ["Certificate"],
    }),
    revokeCertificate: builder.mutation({
      query: ({ id, reason }) => ({ url: `/grading/certificates/${id}/revoke`, method: "PUT", body: { reason } }),
      invalidatesTags: ["Certificate"],
    }),
    restoreCertificate: builder.mutation({
      query: (id) => ({ url: `/grading/certificates/${id}/restore`, method: "PUT" }),
      invalidatesTags: ["Certificate"],
    }),
    // Gradebook (backend utils/gradebook.js).
    getGradebook: builder.query({
      query: (batchId) => `/grading/gradebook/${batchId}`,
      providesTags: (r, e, batchId) => [{ type: "Gradebook", id: batchId }],
    }),
    updateGradebookSettings: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/grading/gradebook/${batchId}/settings`, method: "PUT", body }),
      invalidatesTags: (r, e, { batchId }) => [{ type: "Gradebook", id: batchId }],
    }),
    saveGradeRemark: builder.mutation({
      query: ({ batchId, studentId, text }) => ({ url: `/grading/gradebook/${batchId}/remarks/${studentId}`, method: "PUT", body: { text } }),
      invalidatesTags: (r, e, { batchId }) => [{ type: "Gradebook", id: batchId }],
    }),
    getGradingQueue: builder.query({
      query: (params) => `/grading${qs(params)}`,
      providesTags: ["Grading"],
    }),
    getSubmissionForGrading: builder.query({
      query: (id) => `/grading/${id}`,
      providesTags: (r, e, id) => [{ type: "Grading", id }],
    }),
    reopenSubmission: builder.mutation({
      query: ({ id, graderId }) => ({ url: `/grading/${id}/reopen`, method: "POST", body: { graderId: graderId || undefined } }),
      invalidatesTags: (r, e, { id }) => ["Grading", "Referral", { type: "Grading", id }],
    }),
    getSubmissionStaff: builder.query({
      query: (id) => `/grading/${id}/staff`,
    }),
    claimSubmission: builder.mutation({
      query: (id) => ({ url: `/grading/${id}/claim`, method: "POST" }),
      invalidatesTags: (r, e, id) => ["Grading", { type: "Grading", id }],
    }),
    releaseClaim: builder.mutation({
      query: (id) => ({ url: `/grading/${id}/release`, method: "POST" }),
      invalidatesTags: (r, e, id) => ["Grading", { type: "Grading", id }],
    }),
    gradeAnswer: builder.mutation({
      query: ({ submissionId, answerId, ...body }) => ({
        url: `/grading/${submissionId}/answers/${answerId}`, method: "PUT", body,
      }),
      invalidatesTags: (r, e, { submissionId }) => ["Grading", { type: "Grading", id: submissionId }],
    }),
    gradeWithAi: builder.mutation({
      query: ({ submissionId, answerId }) => ({
        url: `/grading/${submissionId}/answers/${answerId}/ai-grade`, method: "POST",
      }),
      invalidatesTags: (r, e, { submissionId }) => ["Grading", { type: "Grading", id: submissionId }],
    }),
    saveAnnotation: builder.mutation({
      query: ({ submissionId, answerId, file }) => {
        const body = new FormData();
        body.append("file", file);
        return { url: `/grading/${submissionId}/answers/${answerId}/annotation`, method: "POST", body };
      },
       invalidatesTags: (r, e, { submissionId }) => ["Grading", { type: "Grading", id: submissionId }],
     }),
     getPendingReferrals: builder.query({
       query: (params) => `/grading/referrals${qs(params)}`,
       providesTags: ["Referral"],
     }),
     decideReferral: builder.mutation({
       query: ({ submissionId, approve, comment, route }) => ({
         url: `/grading/${submissionId}/referral`, method: "PUT", body: { approve, comment, route },
       }),
       invalidatesTags: ["Referral", "Grading"],
     }),
     // Reused as-is by both Grading.jsx (GradeOne) and Submissions.jsx
     // (general oversight, the only page that can reach a submission that
     // never entered the grading queue at all) — same backend action either
     // way, so both pages' caches need invalidating.
     disqualifySubmission: builder.mutation({
       query: ({ submissionId, reason }) => ({
         url: `/grading/${submissionId}/disqualify`, method: "PUT", body: { reason },
       }),
       invalidatesTags: (r, e, { submissionId }) =>
         ["Grading", "Submissions", { type: "Grading", id: submissionId }, { type: "Submissions", id: submissionId }],
     }),
     reinstateSubmission: builder.mutation({
       query: (submissionId) => ({ url: `/grading/${submissionId}/reinstate`, method: "PUT" }),
       invalidatesTags: (r, e, submissionId) =>
         ["Grading", "Submissions", { type: "Grading", id: submissionId }, { type: "Submissions", id: submissionId }],
     }),
     reassignAnswer: builder.mutation({
       query: ({ submissionId, answerId, graderId }) => ({
         url: `/grading/${submissionId}/answers/${answerId}/reassign`, method: "PUT", body: { graderId: graderId || null },
       }),
       invalidatesTags: (r, e, { submissionId }) => ["Grading", { type: "Grading", id: submissionId }],
     }),
     getMyGradingStats: builder.query({
       query: (params) => `/grading/stats/me${qs(params)}`,
       providesTags: ["Grading"],
     }),
     getGraders: builder.query({
       query: () => "/grading/graders",
       providesTags: ["User"],
     }),
     getGraderStats: builder.query({
       query: ({ id, ...params }) => `/grading/graders/${id}/stats${qs(params)}`,
       providesTags: ["Grading"],
     }),
     // ---------- submissions (general browse, all statuses) ----------
    getSubmissions: builder.query({
      query: (params) => `/submissions${qs(params)}`,
      providesTags: ["Submissions"],
    }),
    getSubmission: builder.query({
      query: (id) => `/submissions/${id}`,
      providesTags: (r, e, id) => [{ type: "Submissions", id }],
    }),
    deleteSubmission: builder.mutation({
      query: (id) => ({ url: `/submissions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Submissions"],
    }),
    // ---------- doubts ----------
    getDoubtQueue: builder.query({
      query: (params) => `/doubts${qs(params)}`,
      providesTags: ["Doubts"],
    }),
    getDoubt: builder.query({
      query: (id) => `/doubts/${id}`,
      providesTags: (r, e, id) => [{ type: "Doubts", id }],
    }),
    resolveDoubt: builder.mutation({
      query: ({ id, answer, answerImage }) => ({
        url: `/doubts/${id}/resolve`, method: "PUT", body: { answer, answerImage },
      }),
      invalidatesTags: (r, e, { id }) => ["Doubts", { type: "Doubts", id }],
    }),
    uploadDoubtAnswerImage: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/doubts/upload-image", method: "POST", body };
      },
    }),
    deleteDoubt: builder.mutation({
      query: (id) => ({ url: `/doubts/${id}`, method: "DELETE" }),
      invalidatesTags: ["Doubts"],
    }),
    getMySolvedDoubts: builder.query({
      query: (params) => `/doubts/mine${qs(params)}`,
      providesTags: ["Doubts"],
    }),
    getMyDoubtStats: builder.query({
      query: (params) => `/doubts/stats/me${qs(params)}`,
      providesTags: ["Doubts"],
    }),
    getDoubtSolvers: builder.query({
      query: () => "/doubts/solvers",
      providesTags: ["User"],
    }),
    getSolverStats: builder.query({
      query: ({ id, ...params }) => `/doubts/solvers/${id}/stats${qs(params)}`,
      providesTags: ["Doubts"],
    }),
    getReviewRequests: builder.query({
      query: (params) => `/doubts/reviews${qs(params)}`,
      providesTags: ["Doubts"],
    }),
    decideDoubtReview: builder.mutation({
      query: ({ id, approve }) => ({ url: `/doubts/${id}/review`, method: "PUT", body: { approve } }),
      invalidatesTags: (r, e, { id }) => ["Doubts", { type: "Doubts", id }],
    }),

    // ---------- live classes ----------
    getLiveClasses: builder.query({
      query: (params) => `/live-classes${qs(params)}`,
      providesTags: ["LiveClass"],
    }),
    getLiveClass: builder.query({
      query: (id) => `/live-classes/${id}`,
      providesTags: (result, error, id) => [{ type: "LiveClass", id }],
    }),
    createLiveClass: builder.mutation({
      query: (body) => ({ url: "/live-classes", method: "POST", body }),
      invalidatesTags: ["LiveClass"],
    }),
    updateLiveClass: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/live-classes/${id}`, method: "PUT", body }),
      invalidatesTags: (result, error, { id }) => ["LiveClass", { type: "LiveClass", id }],
    }),
    deleteLiveClass: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}`, method: "DELETE" }),
      invalidatesTags: ["LiveClass"],
    }),
    startLiveClass: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}/start`, method: "PUT" }),
      invalidatesTags: (result, error, id) => ["LiveClass", { type: "LiveClass", id }],
    }),
    endLiveClass: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}/end`, method: "PUT" }),
      invalidatesTags: (result, error, id) => ["LiveClass", { type: "LiveClass", id }],
    }),
    // In-app classroom: Q&A board and polls (staff side).
    getLiveQaStaff: builder.query({ query: (id) => `/live-classes/${id}/qa` }),
    updateLiveQa: builder.mutation({
      query: ({ id, qid, ...body }) => ({ url: `/live-classes/${id}/qa/${qid}`, method: "PUT", body }),
    }),
    getLivePolls: builder.query({ query: (id) => `/live-classes/${id}/polls` }),
    createLivePoll: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/live-classes/${id}/polls`, method: "POST", body }),
    }),
    updateLivePoll: builder.mutation({
      query: ({ id, pid, ...body }) => ({ url: `/live-classes/${id}/polls/${pid}`, method: "PUT", body }),
    }),
    getLiveRecordings: builder.query({
      query: (id) => `/live-classes/${id}/recordings`,
      providesTags: (r, e, id) => [{ type: "LiveRecording", id }],
    }),
    startLiveRecording: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}/recordings/start`, method: "POST" }),
      invalidatesTags: (r, e, id) => [{ type: "LiveRecording", id }],
    }),
    stopLiveRecording: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}/recordings/stop`, method: "POST" }),
      invalidatesTags: (r, e, id) => [{ type: "LiveRecording", id }],
    }),
    decideLiveRecording: builder.mutation({
      query: ({ id, rid, ...body }) => ({ url: `/live-classes/${id}/recordings/${rid}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "LiveRecording", id }],
    }),
    getLiveNotes: builder.query({
      query: (id) => `/live-classes/${id}/notes`,
      providesTags: (r, e, id) => [{ type: "LiveNotes", id }],
    }),
    generateLiveNotes: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}/notes/generate`, method: "POST" }),
      invalidatesTags: (r, e, id) => [{ type: "LiveNotes", id }],
    }),
    updateLiveNotes: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/live-classes/${id}/notes`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "LiveNotes", id }],
    }),
    addLiveTranscript: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/live-classes/${id}/transcript`, method: "POST", body }),
    }),
    saveLivePadNotes: builder.mutation({
      query: ({ id, media }) => ({ url: `/live-classes/${id}/pad-notes`, method: "POST", body: { media } }),
      invalidatesTags: (r, e, { id }) => [{ type: "LiveClass", id }],
    }),
    saveLiveBoard: builder.mutation({
      query: ({ id, url }) => ({ url: `/live-classes/${id}/boards`, method: "POST", body: { url } }),
      invalidatesTags: (r, e, { id }) => [{ type: "LiveClass", id }],
    }),
    getLiveAttendance: builder.query({
      query: (id) => `/live-classes/${id}/attendance`,
    }),
    getLiveProviders: builder.query({
      query: () => "/live-classes/providers",
    }),
    // A teacher's way into a class (Zoom/manual: the student link).
    joinLiveClass: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}/join`, method: "POST" }),
    }),
    // Classes taught, with minutes per teacher, for paying teachers.
    getLiveTaught: builder.query({
      query: (params) => `/live-classes/taught${qs(params)}`,
      providesTags: ["LiveClass"],
    }),
    // In-app classroom (LiveKit): the host's pass, and host controls.
    getLiveRoomToken: builder.mutation({
      query: (id) => ({ url: `/live-classes/${id}/room-token`, method: "POST" }),
      invalidatesTags: (result, error, id) => ["LiveClass", { type: "LiveClass", id }],
    }),
    setLiveSpeaker: builder.mutation({
      query: ({ id, identity, canSpeak }) => ({
        url: `/live-classes/${id}/room/participants/${encodeURIComponent(identity)}/speaker`, method: "PUT", body: { canSpeak },
      }),
    }),
    setLivePermissions: builder.mutation({
      query: ({ id, identity, ...rights }) => ({
        url: `/live-classes/${id}/room/participants/${encodeURIComponent(identity)}/permissions`, method: "PUT", body: rights,
      }),
    }),
    muteLiveParticipant: builder.mutation({
      query: ({ id, identity, source }) => ({
        url: `/live-classes/${id}/room/participants/${encodeURIComponent(identity)}/mute`, method: "POST", body: { source },
      }),
    }),
    muteLiveAll: builder.mutation({
      query: ({ id, source }) => ({ url: `/live-classes/${id}/room/mute-all`, method: "POST", body: { source } }),
    }),
    updateLiveRoomSettings: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/live-classes/${id}/room/settings`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "LiveClass", id }],
    }),
    removeLiveParticipant: builder.mutation({
      query: ({ id, identity }) => ({ url: `/live-classes/${id}/room/participants/${encodeURIComponent(identity)}`, method: "DELETE" }),
    }),
  }),
});

export const {
  useGetExamSetsQuery, useGetExamSetQuery, useCreateExamSetMutation, useUpdateExamSetMutation, useBuildExamSetMutation,
  usePublishExamSetMutation, useGetExamSetResultsQuery, useDeleteExamSetMutation,
  useGetVideoLessonQuery, useGetCourseVideoLessonsQuery, useGenerateVideoLessonMutation, useUpdateVideoLessonMutation, useVoiceVideoLessonMutation, useStopVideoLessonVoiceMutation, useDeleteVideoLessonMutation, useReviseVideoLessonPartMutation, useHumanizeVideoLessonPartMutation,
  useGetTreeQuery, useGetSubjectsQuery, useGetQuestionStatsQuery,
  useCreateSubjectMutation, useCreateChapterMutation, useCreateTopicMutation,
  useUpdateSubjectMutation, useUpdateChapterMutation, useUpdateTopicMutation,
  useDeleteSubjectMutation, useDeleteChapterMutation, useDeleteTopicMutation,

  useGetQuestionsQuery, useLazyGetQuestionsQuery, useGetQuestionQuery, useCreateQuestionMutation,
  useUpdateQuestionMutation, useRescoreQuestionMutation, useApplyModelAnswersMutation, useDeleteQuestionMutation, useBulkMoveQuestionsMutation, useBulkArchiveQuestionsMutation,
  useImportQuestionsFileMutation,
  useGetQuestionTagsQuery,

  useGetAuthoritiesQuery, useGetArchiveStatsQuery, useCreateAuthorityMutation, useUpdateAuthorityMutation, useUploadAuthorityIconMutation, useDeleteAuthorityMutation,

  useGetExamsQuery, useGetExamQuery, useCreateExamMutation, useUpdateExamMutation,
  useSetExamQuestionsMutation, useSmartPickExamQuestionsMutation, usePublishExamMutation, useSetExamActiveMutation,
  useDuplicateExamMutation, useDeleteExamMutation,

  useGetProgramsQuery, useCreateProgramMutation, useUpdateProgramMutation, useReorderProgramsMutation,
  useDeleteProgramMutation,
  useGetBatchesQuery, useGetBatchQuery, useGetPromoteQuery, usePromoteBatchMutation, useCreateBatchMutation, useDuplicateBatchMutation, useReorderBatchesMutation, useUpdateBatchMutation, useDeleteBatchMutation,
  useUploadBatchIconMutation,
  useAddPlanMutation, useDeletePlanMutation,
  useGetContentCoverageQuery,
  useGetCreditPlansQuery, useAddCreditPlanMutation, useUpdateCreditPlanMutation, useDeleteCreditPlanMutation,

  useGetAssignedQuery, useGetAssignableQuery, useGetOutlineQuery, useSaveOutlineMutation, useAssignToBatchMutation, useAssignMatchingMutation,
  useUnassignFromBatchMutation, useSetItemBatchesMutation, useCopyAssignmentsMutation,

  useGetLecturesQuery, useLazyGetLecturesQuery, useGetLectureQuery,
  useGetLectureStatsQuery, useCreateLectureMutation, useUpdateLectureMutation,
  useDeleteLectureMutation, useReorderLecturesMutation, useLazyGetLectureOrderQuery, useSetLecturesPublishedMutation,
  useSetLecturePracticeQuestionsMutation, useGenerateLecturePracticeQuestionsMutation,
  useSuggestLectureDescriptionMutation, useReindexLectureMutation, useReadLectureScansMutation,
  useGetCouponsQuery, useGetCouponQuery, useCreateCouponMutation, useUpdateCouponMutation, useDeleteCouponMutation,
  useGetRepresentativesQuery, useGetRepresentativePerformanceQuery, useGetMyCouponPerformanceQuery,
  useGetAllRepresentativePerformanceQuery, useGetShortLinksForCouponQuery, useCreateShortLinkMutation,
  useGetLandingPageQuery, useUpdateLandingPageSectionsMutation,
  useGetUpdatesQuery, useCreateUpdateItemMutation, useUpdateUpdateItemMutation, useDeleteUpdateItemMutation,
  useGetEarningsSummaryQuery, useGetEarningsSourcesQuery, useGetEarningsTrendQuery, useGetEarningsTransactionsQuery, useGetEarningsOptionsQuery, useGetTeamSellersQuery, useGetTeamDoubtSolversQuery,
  useGetNoticesQuery, useGetNoticeQuery, useCreateNoticeMutation, useUpdateNoticeMutation, useDeleteNoticeMutation,

  useGetStudentsQuery, useGetStudentQuery, useGetStudentPoraQuery, useGetStudentTutorQuery, useGetStudentInterviewQuery, useGetInterviewSetsQuery, useCreateInterviewSetMutation, useUpdateInterviewSetMutation, useDeleteInterviewSetMutation, useDraftInterviewSetMutation, useCreateStudentMutation, useImportStudentsMutation, useAssignStudentIdsMutation,
  useUpdateStudentMutation, useResetStudentPasswordMutation, useDeleteStudentMutation,
  useEnrolStudentMutation, useRecordPurchaseMutation, useGetPurchasesQuery,

  useGetUsersQuery, useUpdateUserMutation, useGetProfilePeopleQuery, useGetUserProfileQuery, useUpdateUserProfileMutation, useResetUserPasswordMutation, useDeleteUserMutation,
  useGetInvitesQuery, useCreateInviteMutation, useRevokeInviteMutation,

  useGetMediaProvidersQuery, useUploadMediaMutation, useLinkVideoMutation,
  useAttachFromDocumentMutation, useGetMediaQuery, useDeleteMediaMutation,
  useProtectMediaMutation, useGetProtectedSummaryQuery, useProtectAllMediaMutation,

  useUploadSignatureMutation,
  useGetProgressReportSettingsQuery, useUpdateProgressReportSettingsMutation, useGetProgressReportBatchesQuery, useGetProgressReportBatchQuery,
  useUpdateProgressReportBatchMutation, useSendProgressReportsNowMutation, useGetProgressReportLogQuery, useResendProgressReportMutation, useGetCertificateTemplateQuery, useUpdateCertificateTemplateMutation, useGetCertificatesQuery, useGetCertificateCandidatesQuery,
  useIssueCertificatesMutation, useRevokeCertificateMutation, useRestoreCertificateMutation,
  useGetGradebookQuery, useUpdateGradebookSettingsMutation, useSaveGradeRemarkMutation,
  useGetAssignmentsQuery, useGetAssignmentQuery, useSaveAssignmentMutation, useDeleteAssignmentMutation, useUploadAssignmentAttachmentMutation,
  useGetAssignmentHandInsQuery, useGetAssignmentHandInQuery, useGradeAssignmentHandInMutation, useAiCheckAssignmentHandInMutation, useReturnAllAssignmentMutation,
  usePreviewEmailMutation, useTestEmailMutation, useGetSettingsQuery, useGetPublicSettingsQuery, useUpdateSettingsMutation, useUploadLogoMutation, useUploadFaviconMutation, useUploadFeatureIconMutation, useSuggestSeoMetaMutation, useGetMascotPresetsQuery, useGenerateMascotMutation,
  useGetCourseSeoQuery, useUpdateCourseSeoMutation,
  useUpdatePaymentGatewayMutation, useGetCleanupQuery, useRunCleanupMutation,

  useGetGradingQueueQuery, useReopenSubmissionMutation, useGetSubmissionStaffQuery, useGetSubmissionForGradingQuery, useGradeAnswerMutation, useGradeWithAiMutation, useSaveAnnotationMutation,
  useClaimSubmissionMutation, useReleaseClaimMutation,
  useGetPendingReferralsQuery, useDecideReferralMutation, useReassignAnswerMutation,
  useDisqualifySubmissionMutation, useReinstateSubmissionMutation,
  useGetMyGradingStatsQuery, useGetGradersQuery, useGetGraderStatsQuery,

  useGetSubmissionsQuery, useGetSubmissionQuery, useDeleteSubmissionMutation,

  useGetDoubtQueueQuery, useGetDoubtQuery, useResolveDoubtMutation, useDeleteDoubtMutation, useUploadDoubtAnswerImageMutation,
  useGetMySolvedDoubtsQuery, useGetMyDoubtStatsQuery, useGetDoubtSolversQuery,
  useGetSolverStatsQuery, useGetReviewRequestsQuery, useDecideDoubtReviewMutation,

  useGetLiveClassesQuery, useGetLiveClassQuery, useCreateLiveClassMutation, useUpdateLiveClassMutation,
  useDeleteLiveClassMutation, useStartLiveClassMutation, useEndLiveClassMutation,
  useGetLiveProvidersQuery, useJoinLiveClassMutation, useGetLiveTaughtQuery, useGetLiveAttendanceQuery, useSaveLiveBoardMutation, useSaveLivePadNotesMutation,
  useGetLiveNotesQuery, useGenerateLiveNotesMutation, useUpdateLiveNotesMutation, useAddLiveTranscriptMutation,
  useGetLiveRecordingsQuery, useStartLiveRecordingMutation, useStopLiveRecordingMutation, useDecideLiveRecordingMutation,
  useGetLiveQaStaffQuery, useUpdateLiveQaMutation, useGetLivePollsQuery, useCreateLivePollMutation, useUpdateLivePollMutation, useGetLiveRoomTokenMutation, useSetLiveSpeakerMutation, useRemoveLiveParticipantMutation,
  useSetLivePermissionsMutation, useMuteLiveParticipantMutation, useMuteLiveAllMutation, useUpdateLiveRoomSettingsMutation,
} = contentApi;
