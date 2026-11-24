import { apiSlice } from "./apiSlice";

// Agents: the admin copilot's requests, plans and the approval inbox.
export const agentApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAgentStatus: builder.query({
      query: () => "/agents/status",
      providesTags: ["AgentRun"],
    }),
    // params: { agent, status, q, page, limit }
    getAgentRuns: builder.query({
      query: (params = {}) => ({ url: "/agents/runs", params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null)) }),
      providesTags: ["AgentRun"],
    }),
    retryAgentRun: builder.mutation({
      query: ({ id, request }) => ({ url: `/agents/runs/${id}/retry`, method: "POST", body: { request } }),
      invalidatesTags: ["AgentRun"],
    }),
    reviseAgentRun: builder.mutation({
      query: ({ id, message }) => ({ url: `/agents/runs/${id}/revise`, method: "POST", body: { message } }),
      invalidatesTags: ["AgentRun"],
    }),
    deleteAgentRun: builder.mutation({
      query: (id) => ({ url: `/agents/runs/${id}`, method: "DELETE" }),
      invalidatesTags: ["AgentRun"],
    }),
    // { ids } or the page's filters ({ agent, status, q }): finished ones only.
    clearAgentRuns: builder.mutation({
      query: ({ ids, ...filters }) => ({ url: "/agents/runs/clear", method: "POST", params: Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), body: ids ? { ids } : {} }),
      invalidatesTags: ["AgentRun"],
    }),
    createAgentRun: builder.mutation({
      query: (body) => ({ url: "/agents/runs", method: "POST", body }),
      invalidatesTags: ["AgentRun"],
    }),
    decideAgentSteps: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/agents/runs/${id}/decide`, method: "POST", body }),
      invalidatesTags: ["AgentRun"],
    }),
    sweepAgent: builder.mutation({
      query: (agent) => ({ url: `/agents/sweep/${agent}`, method: "POST" }),
      invalidatesTags: ["AgentRun"],
    }),
    // Form view: the questions a waiting questions step would draw from.
    previewAgentStep: builder.mutation({
      query: ({ id, stepId, args }) => ({ url: `/agents/runs/${id}/steps/${stepId}/preview`, method: "POST", body: { args } }),
    }),
    editAgentStep: builder.mutation({
      query: ({ id, stepId, args }) => ({ url: `/agents/runs/${id}/steps/${stepId}`, method: "PUT", body: { args } }),
      invalidatesTags: ["AgentRun"],
    }),
    // { action: "remake", prompt? } or { action: "remove" }: a waiting notice's picture.
    changeAgentStepPicture: builder.mutation({
      query: ({ id, stepId, ...body }) => ({ url: `/agents/runs/${id}/steps/${stepId}/picture`, method: "POST", body }),
      invalidatesTags: ["AgentRun"],
    }),
    cancelAgentRun: builder.mutation({
      query: (id) => ({ url: `/agents/runs/${id}/cancel`, method: "POST" }),
      invalidatesTags: ["AgentRun"],
    }),
  }),
});

export const {
  useGetAgentStatusQuery, useGetAgentRunsQuery, useCreateAgentRunMutation, useDecideAgentStepsMutation, useCancelAgentRunMutation, useSweepAgentMutation, useEditAgentStepMutation, usePreviewAgentStepMutation,
  useRetryAgentRunMutation, useReviseAgentRunMutation, useDeleteAgentRunMutation, useClearAgentRunsMutation, useChangeAgentStepPictureMutation,
} = agentApi;
