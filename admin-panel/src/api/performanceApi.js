import { apiSlice } from "./apiSlice";

// Settings → Performance (Pro; backend controllers/admin/performanceController.js).
export const performanceApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPerformance: builder.query({ query: () => "/performance", providesTags: ["Performance"] }),
    updatePerformance: builder.mutation({
      query: (body) => ({ url: "/performance", method: "PUT", body }),
      invalidatesTags: ["Performance", "PerformanceStatus"],
    }),
    getPerformanceStatus: builder.query({ query: () => "/performance/status", providesTags: ["PerformanceStatus"] }),
    clearPerformanceCache: builder.mutation({
      query: () => ({ url: "/performance/cache/clear", method: "POST" }),
      invalidatesTags: ["PerformanceStatus"],
    }),
    getSavedAiResults: builder.query({ query: (params) => ({ url: "/performance/saved", params }), providesTags: ["SavedAi"] }),
    reviewSavedAiResult: builder.mutation({
      query: ({ id, action }) => ({ url: `/performance/saved/${id}/${action}`, method: "POST" }),
      invalidatesTags: ["SavedAi", "PerformanceStatus"],
    }),
    // In-app live classes now, and sampled history (utils/liveMonitor.js).
    getLiveMonitor: builder.query({ query: () => "/performance/live" }),
    getLocalAi: builder.query({ query: () => "/performance/local-ai" }),
    getLiveHistory: builder.query({ query: (days) => `/performance/live/history?days=${days}` }),
    deleteSavedAiResult: builder.mutation({
      query: (id) => ({ url: `/performance/saved/${id}`, method: "DELETE" }),
      invalidatesTags: ["SavedAi", "PerformanceStatus"],
    }),
  }),
});

export const {
  useGetPerformanceQuery, useUpdatePerformanceMutation, useGetPerformanceStatusQuery, useClearPerformanceCacheMutation,
  useGetSavedAiResultsQuery, useReviewSavedAiResultMutation, useDeleteSavedAiResultMutation,
  useGetLiveMonitorQuery, useGetLiveHistoryQuery, useGetLocalAiQuery,
} = performanceApi;
