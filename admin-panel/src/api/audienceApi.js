import { apiSlice } from "./apiSlice";

// Visitors report (backend utils/visitors.js).
export const visitorApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getVisitors: builder.query({
      query: (days = 30) => `/visitors?days=${days}`,
      providesTags: ["Settings"],
    }),
    setVisitorLocation: builder.mutation({
      query: (enabled) => ({ url: "/visitors/location", method: "POST", body: { enabled } }),
      invalidatesTags: ["Settings"],
    }),
  }),
});

export const { useGetVisitorsQuery, useSetVisitorLocationMutation } = visitorApi;
