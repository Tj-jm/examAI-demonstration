import { apiSlice } from "./apiSlice";

// The daily tutor (agents), per batch.
const tz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};

export const tutorApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTutor: builder.query({
      query: (batchId) => `/batches/${batchId}/tutor?tz=${encodeURIComponent(tz())}`,
      providesTags: ["Tutor"],
      keepUnusedDataFor: 0,
      // Loading the tutor can tick a study plan day and send a notification,
      // so the study plan page and the bell refetch instead of showing an
      // older copy first.
      async onQueryStarted(_, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
          dispatch(apiSlice.util.invalidateTags(["StudyPlan", "Notification"]));
        } catch { /* the page shows the error */ }
      },
    }),
    updateTutor: builder.mutation({
      query: ({ batchId, ...body }) => ({ url: `/batches/${batchId}/tutor`, method: "PUT", body }),
      invalidatesTags: ["Tutor"],
    }),
  }),
});

export const { useGetTutorQuery, useUpdateTutorMutation } = tutorApi;
