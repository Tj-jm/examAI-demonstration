import { apiSlice } from "./apiSlice";

// "My progress", per batch.
const tz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};

export const progressApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getProgress: builder.query({
      query: (batchId) => `/batches/${batchId}/progress?tz=${encodeURIComponent(tz())}`,
      keepUnusedDataFor: 0,
    }),
  }),
});

export const { useGetProgressQuery } = progressApi;
