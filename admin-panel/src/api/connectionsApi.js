import { apiSlice } from "./apiSlice";

// Settings → Connections (backend controllers/admin/connectionsController.js).
// Owner only. Secrets go up and never come back: the screen gets last-4.
export const connectionsApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getConnections: builder.query({ query: () => "/settings/connections", providesTags: ["Connections"] }),
    saveConnection: builder.mutation({
      query: ({ service, values, password }) => ({ url: `/settings/connections/${service}`, method: "PUT", body: { values, password } }),
      invalidatesTags: ["Connections", "Settings"],
    }),
    testConnection: builder.mutation({
      query: (service) => ({ url: `/settings/connections/${service}/test`, method: "POST" }),
    }),
  }),
});

export const { useGetConnectionsQuery, useSaveConnectionMutation, useTestConnectionMutation } = connectionsApi;
