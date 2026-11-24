import { apiSlice } from "./apiSlice";

// Settings → AI: the connection (provider, key, model), the feature switches
// and the rest of the AI settings document.
export const aiConfigApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAiConfig: builder.query({
      query: () => "/ai/config",
      providesTags: ["AiConfig"],
    }),
    updateAiConfig: builder.mutation({
      query: (body) => ({ url: "/ai/config", method: "PUT", body }),
      // Agent switches live here too, so the Agents page must reload.
      invalidatesTags: ["AiConfig", "AgentRun"],
    }),
    testAiConnection: builder.mutation({
      query: () => ({ url: "/ai/test", method: "POST" }),
      invalidatesTags: ["AiConfig"],
    }),
  }),
});

export const { useGetAiConfigQuery, useUpdateAiConfigMutation, useTestAiConnectionMutation } = aiConfigApi;
