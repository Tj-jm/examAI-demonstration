// Student accounts: support tickets, conduct, deletion requests.
import { apiSlice } from "./apiSlice";

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== "" && v !== null)).toString();
  return s ? `?${s}` : "";
};

export const accountApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ---------- support tickets ----------
    getTickets: builder.query({
      query: (params) => `/support${qs(params)}`,
      providesTags: ["Support"],
    }),
    getTicketCounts: builder.query({
      query: () => "/support/counts",
      providesTags: ["Support"],
    }),
    getTicket: builder.query({
      query: (id) => `/support/${id}`,
      providesTags: (r, e, id) => [{ type: "Support", id }],
    }),
    getSupportSettings: builder.query({
      query: () => "/support/settings",
      providesTags: ["Support"],
    }),
    updateSupportSettings: builder.mutation({
      query: (body) => ({ url: "/support/settings", method: "PUT", body }),
      invalidatesTags: ["Support"],
    }),
    getTicketAssignees: builder.query({
      query: () => "/support/assignees",
    }),
    replyToTicket: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/support/${id}/reply`, method: "POST", body }),
      invalidatesTags: (r, e, { id }) => ["Support", { type: "Support", id }],
    }),
    updateTicket: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/support/${id}`, method: "PUT", body }),
      invalidatesTags: (r, e, { id }) => ["Support", { type: "Support", id }],
    }),
    uploadTicketImage: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/support/upload-image", method: "POST", body };
      },
    }),
    // ---------- conduct ----------
    getConductList: builder.query({
      query: (params) => `/conduct${qs(params)}`,
      providesTags: ["Conduct"],
    }),
    getConductCounts: builder.query({
      query: () => "/conduct/counts",
      providesTags: ["Conduct"],
    }),
    getConductRecord: builder.query({
      query: (id) => `/conduct/students/${id}`,
      providesTags: (r, e, id) => [{ type: "Conduct", id }],
    }),
    actOnStudent: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/conduct/students/${id}/action`, method: "POST", body }),
      invalidatesTags: ["Conduct", "Student"],
    }),
    updateConductEvent: builder.mutation({
      query: ({ id, status }) => ({ url: `/conduct/events/${id}`, method: "PUT", body: { status } }),
      invalidatesTags: ["Conduct"],
    }),
    getConductSettings: builder.query({
      query: () => "/conduct/settings",
      providesTags: ["Conduct"],
    }),
    updateConductSettings: builder.mutation({
      query: (body) => ({ url: "/conduct/settings", method: "PUT", body }),
      invalidatesTags: ["Conduct"],
    }),
    // ---------- account deletion ----------
    getDeletionRequests: builder.query({
      query: (params) => `/deletions${qs(params)}`,
      providesTags: ["DeletionRequest"],
    }),
    getDeletionCounts: builder.query({
      query: () => "/deletions/counts",
      providesTags: ["DeletionRequest"],
    }),
    approveDeletion: builder.mutation({
      query: (id) => ({ url: `/deletions/${id}/approve`, method: "POST" }),
      invalidatesTags: ["DeletionRequest", "Student"],
    }),
    rejectDeletion: builder.mutation({
      query: ({ id, note }) => ({ url: `/deletions/${id}/reject`, method: "POST", body: { note } }),
      invalidatesTags: ["DeletionRequest"],
    }),
    getDeletionSettings: builder.query({
      query: () => "/deletions/settings",
      providesTags: ["DeletionRequest"],
    }),
    updateDeletionSettings: builder.mutation({
      query: (body) => ({ url: "/deletions/settings", method: "PUT", body }),
      invalidatesTags: ["DeletionRequest"],
    }),
  }),
});

export const {
  useGetDeletionRequestsQuery, useGetDeletionCountsQuery, useApproveDeletionMutation, useRejectDeletionMutation,
  useGetDeletionSettingsQuery, useUpdateDeletionSettingsMutation,
  useGetConductListQuery, useGetConductCountsQuery, useGetConductRecordQuery, useActOnStudentMutation,
  useUpdateConductEventMutation, useGetConductSettingsQuery, useUpdateConductSettingsMutation,
  useGetSupportSettingsQuery, useUpdateSupportSettingsMutation,
  useGetTicketsQuery, useGetTicketCountsQuery, useGetTicketQuery, useGetTicketAssigneesQuery,
  useReplyToTicketMutation, useUpdateTicketMutation, useUploadTicketImageMutation,
} = accountApi;
