import { apiSlice } from "./apiSlice";

// Posts and posters for social media (backend posterController.js).
export const posterApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPosterOptions: builder.query({ query: () => "/posters/options" }),
    getTopScorers: builder.query({
      query: ({ exam, count = 5 }) => `/posters/top-scorers?exam=${exam}&count=${count}`,
    }),
    writePoster: builder.mutation({
      query: (body) => ({ url: "/posters/write", method: "POST", body }),
    }),
    posterBackground: builder.mutation({
      query: (body) => ({ url: "/posters/background", method: "POST", body }),
    }),
    posterVoice: builder.mutation({
      query: (body) => ({ url: "/posters/voice", method: "POST", body }),
    }),
  }),
});

export const { useGetPosterOptionsQuery, useGetTopScorersQuery, useWritePosterMutation, usePosterBackgroundMutation, usePosterVoiceMutation } = posterApi;
