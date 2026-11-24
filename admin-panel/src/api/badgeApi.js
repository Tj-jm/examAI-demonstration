import { apiSlice } from "./apiSlice";

// Sidebar numbers with no other source (doubts, leads, hand-ins,
// recordings), when each badged page's newest item came in, and when this
// person last opened it (backend controllers/admin/badgeController.js).
export const badgeApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getBadges: builder.query({
      query: () => "/badges",
      // Anything that changes one of these lists refreshes the numbers.
      providesTags: ["Doubts", "Lead", "AssignmentHandIn", "LiveRecording", "Support", "Conduct", "DeletionRequest", "ReviewQueue", "Grading", "AgentRun"],
    }),
    markSeen: builder.mutation({
      query: (key) => ({ url: "/badges/seen", method: "POST", body: { key } }),
      // Clear the page's "new" dot at once, without refetching everything.
      async onQueryStarted(key, { dispatch, queryFulfilled }) {
        const patch = dispatch(badgeApi.util.updateQueryData("getBadges", undefined, (d) => {
          d.seen = { ...(d.seen || {}), [key]: new Date().toISOString() };
        }));
        try { await queryFulfilled; } catch { patch.undo(); }
      },
    }),
  }),
});

export const { useGetBadgesQuery, useMarkSeenMutation } = badgeApi;
