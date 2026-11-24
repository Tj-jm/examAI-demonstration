import { apiSlice } from "./apiSlice";

// Lecture slides (backend controllers/admin/slideController.js).
export const slideApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getSlideDecks: builder.query({ query: (batch) => ({ url: "/slides", params: { batch } }), providesTags: ["SlideDeck"] }),
    getSlideDeck: builder.query({ query: (id) => `/slides/${id}`, providesTags: (r, e, id) => [{ type: "SlideDeck", id }] }),
    createSlideDeck: builder.mutation({ query: (body) => ({ url: "/slides", method: "POST", body }), invalidatesTags: ["SlideDeck"] }),
    saveSlideDeck: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/slides/${id}`, method: "PUT", body }),
      invalidatesTags: ["SlideDeck"],
    }),
    deleteSlideDeck: builder.mutation({ query: (id) => ({ url: `/slides/${id}`, method: "DELETE" }), invalidatesTags: ["SlideDeck"] }),
    duplicateSlideDeck: builder.mutation({ query: (id) => ({ url: `/slides/${id}/duplicate`, method: "POST" }), invalidatesTags: ["SlideDeck"] }),
    getSlideItems: builder.query({ query: ({ id, chapter, topic }) => ({ url: `/slides/${id}/items`, params: { ...(chapter ? { chapter } : {}), ...(topic ? { topic } : {}) } }) }),
    slideOutline: builder.mutation({ query: ({ id, ...body }) => ({ url: `/slides/${id}/outline`, method: "POST", body }), invalidatesTags: ["SlideDeck"] }),
    slideGenerate: builder.mutation({ query: ({ id, ...body }) => ({ url: `/slides/${id}/generate`, method: "POST", body }), invalidatesTags: ["SlideDeck"] }),
    slideRewrite: builder.mutation({ query: ({ id, ...body }) => ({ url: `/slides/${id}/rewrite`, method: "POST", body }) }),
    slideFileText: builder.mutation({
      query: (file) => { const body = new FormData(); body.append("file", file); return { url: "/slides/file-text", method: "POST", body }; },
    }),
  }),
});

export const {
  useGetSlideDecksQuery, useGetSlideDeckQuery, useCreateSlideDeckMutation, useSaveSlideDeckMutation, useDeleteSlideDeckMutation,
  useDuplicateSlideDeckMutation, useGetSlideItemsQuery, useSlideOutlineMutation, useSlideGenerateMutation, useSlideRewriteMutation, useSlideFileTextMutation,
} = slideApi;
