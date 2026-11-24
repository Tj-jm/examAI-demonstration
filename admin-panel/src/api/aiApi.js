import { apiSlice } from "./apiSlice";

// Matches contentApi.js's own qs() exactly (including the name) — the
// verify script recognises this specific helper and knows to treat
// ${qs(...)} as a query string, not a path parameter. A same-shaped but
// differently-named helper would be functionally identical and still fail
// that check, since verify.js pattern-matches on the literal name qs.
const qs = (params = {}) => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return clean.length ? `?${new URLSearchParams(Object.fromEntries(clean))}` : "";
};

export const aiApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAiUsage: builder.query({
      query: (days = 30) => `/ai/usage?days=${days}`,
    }),
    // What students asked course chat — by default only what the course
    // documents couldn't answer.
    getDocChatQuestions: builder.query({
      query: ({ all = false } = {}) => `/ai/doc-chat/questions?all=${all}`,
    }),
    getGeneralCreditPlans: builder.query({
      query: () => "/ai/credit-plans",
      providesTags: ["AiCreditPlan"],
    }),
    addGeneralCreditPlan: builder.mutation({
      query: (body) => ({ url: "/ai/credit-plans", method: "POST", body }),
      invalidatesTags: ["AiCreditPlan"],
    }),
    updateGeneralCreditPlan: builder.mutation({
      query: ({ planId, ...body }) => ({ url: `/ai/credit-plans/${planId}`, method: "PUT", body }),
      invalidatesTags: ["AiCreditPlan"],
    }),
    deleteGeneralCreditPlan: builder.mutation({
      query: (planId) => ({ url: `/ai/credit-plans/${planId}`, method: "DELETE" }),
      invalidatesTags: ["AiCreditPlan"],
    }),
    generateQuestions: builder.mutation({
      query: (body) => ({ url: "/ai/generate-questions", method: "POST", body }),
      invalidatesTags: ["ReviewQueue", "Question"],
    }),
    // Style-matched generation from a curated set of real "bank" questions
    // — same review queue as generateQuestions, different source material.
    generateFromBank: builder.mutation({
      query: (body) => ({ url: "/ai/generate-from-bank", method: "POST", body }),
      invalidatesTags: ["ReviewQueue", "Question"],
    }),
    getReviewQueue: builder.query({
      // Accepts either a bare topic id (back-compat with existing callers)
      // or a { topic, chapter } filter object — the chapter form is how a
      // chapter-pool generation run's "Review them" link scopes the queue,
      // same topic=none/chapter=<id> convention contentApi's getQuestions
      // filter uses.
      query: (filter) => {
        const { topic, chapter, page, limit, solutionsPage, solutionsLimit } =
          typeof filter === "object" && filter !== null ? filter : { topic: filter };
        return `/ai/review-queue${qs({ topic, chapter, page, limit, solutionsPage, solutionsLimit })}`;
      },
      providesTags: ["ReviewQueue"],
    }),
    decideReview: builder.mutation({
      query: (body) => ({ url: "/ai/review-queue", method: "PUT", body }),
      invalidatesTags: ["ReviewQueue", "Question"],
    }),
    // Owner/admin only, server-side — this is a different route on purpose, not
    // a flag on the one above.
    rejectAllReview: builder.mutation({
      query: (body) => ({ url: "/ai/review-queue/reject-all", method: "PUT", body }),
      invalidatesTags: ["ReviewQueue", "Question"],
    }),
    decideSolutionReview: builder.mutation({
      query: (body) => ({ url: "/ai/review-solutions", method: "PUT", body }),
      invalidatesTags: ["ReviewQueue", "Question"],
    }),
    previewDocument: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/ai/ingest/preview", method: "POST", body };
      },
      invalidatesTags: ["DocumentLibrary"],
    }),
    generateFromDocument: builder.mutation({
      // Either a File (a fresh upload) or a documentId (something already in
      // the library) — the backend accepts both on the same route, so the
      // request shape is the only thing that needs to branch here.
      query: ({ file, documentId, ...fields }) => {
        if (file) {
          const body = new FormData();
          body.append("file", file);
          for (const [key, value] of Object.entries(fields)) body.append(key, value);
          return { url: "/ai/ingest/generate", method: "POST", body };
        }
        return { url: "/ai/ingest/generate", method: "POST", body: { documentId, ...fields } };
      },
      invalidatesTags: ["ReviewQueue", "Question", "DocumentLibrary", "IngestJobs"],
    }),
    // Your document runs (running, and finished in the last half hour), for
    // the progress card shown on every page. Polled by its callers.
    getIngestJobs: builder.query({
      query: () => "/ai/ingest/jobs",
      providesTags: ["IngestJobs"],
    }),
    // Stop a run; questions already found are kept and go to Review.
    cancelIngestJob: builder.mutation({
      query: (jobId) => ({ url: `/ai/ingest/jobs/${jobId}/cancel`, method: "POST" }),
      invalidatesTags: ["IngestJobs", "ReviewQueue", "Question"],
    }),
    // Read pages with AI vision: text as printed and every figure cut out,
    // given back to the admin (nothing saved as questions).
    transcribePages: builder.mutation({
      query: ({ file, documentId, ...fields }) => {
        if (file) {
          const body = new FormData();
          body.append("file", file);
          for (const [key, value] of Object.entries(fields)) body.append(key, value);
          return { url: "/ai/ingest/transcribe", method: "POST", body };
        }
        return { url: "/ai/ingest/transcribe", method: "POST", body: { documentId, ...fields } };
      },
      invalidatesTags: ["DocumentLibrary", "IngestJobs"],
    }),
    // Read text → questions of one chosen type, saved for review.
    questionsFromText: builder.mutation({
      query: (body) => ({ url: "/ai/ingest/from-text", method: "POST", body }),
      invalidatesTags: ["ReviewQueue", "Question"],
    }),
    getIngestStatus: builder.query({
      query: (jobId) => `/ai/ingest/status/${jobId}`,
    }),
    getDocuments: builder.query({
      query: (search) => `/ai/documents?search=${encodeURIComponent(search || "")}`,
      providesTags: ["DocumentLibrary"],
    }),
    deleteDocument: builder.mutation({
      query: (id) => ({ url: `/ai/documents/${id}`, method: "DELETE" }),
      invalidatesTags: ["DocumentLibrary"],
    }),
    getLocalModels: builder.query({
      query: () => "/ai/local/models",
      providesTags: ["AiConfig"],
    }),
    pullModel: builder.mutation({
      query: (body) => ({ url: "/ai/local/pull", method: "POST", body }),
    }),
    getPullStatus: builder.query({
      query: () => "/ai/local/pull-status",
    }),
    // The embedded (in-process, no separate server) provider — its own
    // catalogue/download/delete endpoints, not local/*'s: these pull a
    // .gguf straight onto this server's disk rather than proxying to an
    // Ollama-compatible address.
    getEmbeddedModels: builder.query({
      query: () => "/ai/embedded/models",
      providesTags: ["AiConfig"],
    }),
    pullEmbeddedModel: builder.mutation({
      query: (body) => ({ url: "/ai/embedded/pull", method: "POST", body }),
      invalidatesTags: ["AiConfig"],
    }),
    getEmbeddedPullStatus: builder.query({
      query: () => "/ai/embedded/pull-status",
    }),
    deleteEmbeddedModel: builder.mutation({
      query: (id) => ({ url: `/ai/embedded/models/${id}`, method: "DELETE" }),
      invalidatesTags: ["AiConfig"],
    }),
    stopEmbeddedModel: builder.mutation({
      query: () => ({ url: "/ai/embedded/stop", method: "POST" }),
      invalidatesTags: ["AiConfig"],
    }),
    writeModelAnswer: builder.mutation({
      query: (body) => ({ url: "/ai/model-answer", method: "POST", body }),
    }),
    writeCodingStarter: builder.mutation({
      query: (body) => ({ url: "/ai/coding-starter", method: "POST", body }),
    }),
    backfillSolutions: builder.mutation({
      query: (body) => ({ url: "/ai/backfill-solutions", method: "POST", body }),
      invalidatesTags: ["Question", "ReviewQueue"],
    }),
    backfillSkillTypes: builder.mutation({
      query: (body) => ({ url: "/ai/backfill-skill-types", method: "POST", body }),
      invalidatesTags: ["Question"],
    }),
    // { chapter, topic } or { questionIds } — same "topic: 'none'"
    // chapter-pool convention as every other filing filter. A mutation, not
    // a query: this triggers a real (uncached, costs money) AI call every
    // time it's run, not a value to sit in RTK Query's cache and get
    // silently refetched. Returns the persisted audit document (with its
    // own _id) — the caller navigates to /audit-pool/:id rather than
    // holding the result in local state, so a reload or a stray click away
    // never throws away a run that already cost an AI call.
    auditQuestionPool: builder.mutation({
      query: (body) => ({ url: "/ai/audit-pool", method: "POST", body }),
      invalidatesTags: [{ type: "QuestionAudit", id: "LIST" }],
    }),
    getAuditPool: builder.query({
      query: (id) => `/ai/audit-pool/${id}`,
      providesTags: (r, e, id) => [{ type: "QuestionAudit", id }],
    }),
    // Every run that still has an undecided issue or duplicate group — the
    // sidebar badge's own list, and the permanent queue Questions.jsx's
    // "AI audit" button feeds into instead of a result that only lived on
    // one page.
    getOpenAudits: builder.query({
      query: (params) => `/ai/audit-pool${qs(params)}`,
      providesTags: (result) => [
        { type: "QuestionAudit", id: "LIST" },
        ...((result?.audits) || []).map((a) => ({ type: "QuestionAudit", id: a._id })),
      ],
    }),
    decideAuditPool: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/ai/audit-pool/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => [{ type: "QuestionAudit", id }, { type: "QuestionAudit", id: "LIST" }],
    }),
    // One question, reviewed in place on QuestionView.jsx — the single-question
    // sibling of auditQuestionPool above. A mutation, not a query, for the same
    // reason: a real (uncached, costs money) AI call every run. The result is
    // small enough, and reviewed right where it's shown, that it lives in the
    // page's own local state rather than a persisted document like the pool
    // audit's — nothing here is lost by a reload since re-running costs one click.
    reviewQuestion: builder.mutation({
      query: (id) => ({ url: `/ai/review-question/${id}`, method: "POST" }),
    }),
    // Predicted next paper — runs in the background server-side; the detail
    // page polls getPredictedPaper while status is "generating".
    createPredictedPaper: builder.mutation({
      query: (body) => ({ url: "/ai/predicted-paper", method: "POST", body }),
      invalidatesTags: [{ type: "PredictedPaper", id: "LIST" }],
    }),
    getPredictedPapers: builder.query({
      query: () => "/ai/predicted-paper",
      providesTags: [{ type: "PredictedPaper", id: "LIST" }],
    }),
    getPredictedPaper: builder.query({
      query: (id) => `/ai/predicted-paper/${id}`,
      providesTags: (r, e, id) => [{ type: "PredictedPaper", id }],
    }),
    setPredictedPaperShared: builder.mutation({
      query: ({ id, shared }) => ({ url: `/ai/predicted-paper/${id}/share`, method: "PUT", body: { shared } }),
      invalidatesTags: (r, e, { id }) => [{ type: "PredictedPaper", id }, { type: "PredictedPaper", id: "LIST" }],
    }),
    createExamFromPrediction: builder.mutation({
      query: (id) => ({ url: `/ai/predicted-paper/${id}/exam`, method: "POST" }),
      invalidatesTags: (r, e, id) => [{ type: "PredictedPaper", id }, { type: "PredictedPaper", id: "LIST" }, "Exam"],
    }),
    retryPredictedPaper: builder.mutation({
      query: (id) => ({ url: `/ai/predicted-paper/${id}/retry`, method: "POST" }),
      invalidatesTags: (r, e, id) => [{ type: "PredictedPaper", id }, { type: "PredictedPaper", id: "LIST" }],
    }),
    deletePredictedPaper: builder.mutation({
      query: (id) => ({ url: `/ai/predicted-paper/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "PredictedPaper", id: "LIST" }, "Question"],
    }),
  }),
});

export const {
  useGetAiUsageQuery, useGetDocChatQuestionsQuery, useGenerateQuestionsMutation, useGenerateFromBankMutation, useGetReviewQueueQuery,
  useDecideReviewMutation, useRejectAllReviewMutation, useDecideSolutionReviewMutation, useBackfillSolutionsMutation,
  useWriteModelAnswerMutation, useWriteCodingStarterMutation,
  useBackfillSkillTypesMutation, useAuditQuestionPoolMutation,
  useGetAuditPoolQuery, useDecideAuditPoolMutation, useGetOpenAuditsQuery,
  useGetLocalModelsQuery, usePullModelMutation, useGetPullStatusQuery,
  useGetEmbeddedModelsQuery, usePullEmbeddedModelMutation,
  useGetEmbeddedPullStatusQuery, useDeleteEmbeddedModelMutation, useStopEmbeddedModelMutation,
  usePreviewDocumentMutation, useGenerateFromDocumentMutation, useTranscribePagesMutation, useQuestionsFromTextMutation, useGetIngestStatusQuery, useGetIngestJobsQuery, useCancelIngestJobMutation,
  useGetDocumentsQuery, useDeleteDocumentMutation, useReviewQuestionMutation,
  useCreatePredictedPaperMutation, useGetPredictedPapersQuery, useGetPredictedPaperQuery, useCreateExamFromPredictionMutation, useSetPredictedPaperSharedMutation,
  useRetryPredictedPaperMutation, useDeletePredictedPaperMutation,
  useGetGeneralCreditPlansQuery, useAddGeneralCreditPlanMutation,
  useUpdateGeneralCreditPlanMutation, useDeleteGeneralCreditPlanMutation,
} = aiApi;

// The connection settings have their own file (aiConfigApi.js); re-exported
// so the pages that import them from here keep working.
export { useGetAiConfigQuery, useUpdateAiConfigMutation, useTestAiConnectionMutation } from "./aiConfigApi";
