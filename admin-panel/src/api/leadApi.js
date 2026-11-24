import { apiSlice } from "./apiSlice";

// Leads (backend controllers/admin/leadController.js).
export const leadApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getLeads: builder.query({
      query: ({ page = 1, status = "", batch = "", search = "" } = {}) =>
        `/leads?page=${page}&status=${status}&batch=${batch}&search=${encodeURIComponent(search)}`,
      providesTags: ["Lead"],
    }),
    updateLead: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/leads/${id}`, method: "PUT", body }),
      invalidatesTags: ["Lead"],
    }),
    deleteLead: builder.mutation({
      query: (id) => ({ url: `/leads/${id}`, method: "DELETE" }),
      invalidatesTags: ["Lead"],
    }),
    messageLeads: builder.mutation({
      query: (body) => ({ url: "/leads/message", method: "POST", body }),
      invalidatesTags: ["Lead"],
    }),
    getInterested: builder.query({
      query: ({ page = 1, days = 14, batch = "" } = {}) => `/leads/interested?page=${page}&days=${days}&batch=${batch}`,
    }),
  }),
});

export const { useGetLeadsQuery, useUpdateLeadMutation, useDeleteLeadMutation, useMessageLeadsMutation, useGetInterestedQuery } = leadApi;
