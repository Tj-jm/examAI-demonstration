import { apiSlice } from "./apiSlice";

// "Write with AI" (backend/ai/writing.js): one endpoint, the task in the body.
export const aiWritingApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    aiWrite: builder.mutation({
      query: (body) => ({ url: "/ai-write", method: "POST", body }),
    }),
  }),
});

export const { useAiWriteMutation } = aiWritingApi;
