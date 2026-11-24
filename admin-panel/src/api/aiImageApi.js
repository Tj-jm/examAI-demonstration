import { apiSlice } from "./apiSlice";

// AI pictures (saved as images) and diagrams (SVG for the image editor).
export const aiImageApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    aiPicture: builder.mutation({
      query: (body) => ({ url: "/ai-images/picture", method: "POST", body }),
    }),
    aiDiagram: builder.mutation({
      query: (body) => ({ url: "/ai-images/diagram", method: "POST", body }),
    }),
  }),
});

export const { useAiPictureMutation, useAiDiagramMutation } = aiImageApi;
