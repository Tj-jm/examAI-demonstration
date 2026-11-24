// Help & account: support tickets, account standing (conduct), deletion.
import { apiSlice, withMountRefetch, honourMountRefetch } from "./apiSlice";

export const accountApi = honourMountRefetch(apiSlice.injectEndpoints({
  endpoints: withMountRefetch((builder) => ({
    // ---------- support tickets ----------
    getMyTickets: builder.query({
      query: () => "/support",
      providesTags: ["Support"],
    }),
    getMyTicket: builder.query({
      query: (id) => `/support/${id}`,
      providesTags: (r, e, id) => [{ type: "Support", id }],
    }),
    getSupportUnread: builder.query({
      query: () => "/support/unread-count",
      providesTags: ["Support"],
    }),
    createTicket: builder.mutation({
      query: (body) => ({ url: "/support", method: "POST", body }),
      invalidatesTags: ["Support", "Standing"],
    }),
    replyTicket: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/support/${id}/reply`, method: "POST", body }),
      invalidatesTags: (r, e, { id }) => ["Support", { type: "Support", id }],
    }),
    resolveTicket: builder.mutation({
      query: (id) => ({ url: `/support/${id}/resolve`, method: "PUT" }),
      invalidatesTags: (r, e, id) => ["Support", { type: "Support", id }],
    }),
    uploadSupportImage: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/support/upload-image", method: "POST", body };
      },
    }),
    // ---------- account ----------
    getStanding: builder.query({
      query: () => "/account/standing",
      providesTags: ["Standing"],
      refetchOnMountOrArgChange: true,
    }),
    getDeletion: builder.query({
      query: () => "/account/deletion",
      providesTags: ["AccountDeletion"],
      refetchOnMountOrArgChange: true,
    }),
    requestDeletion: builder.mutation({
      query: (body) => ({ url: "/account/deletion", method: "POST", body }),
      invalidatesTags: ["AccountDeletion", "Auth"],
    }),
    // The guardian who gets progress reports.
    getGuardian: builder.query({
      query: () => "/account/guardian",
      providesTags: ["Guardian"],
    }),
    updateGuardian: builder.mutation({
      query: (body) => ({ url: "/account/guardian", method: "PUT", body }),
      invalidatesTags: ["Guardian"],
    }),
    // Campaigns: a link with ?c=<campaign> was opened, and the opt-out.
    campaignClick: builder.mutation({
      query: (id) => ({ url: "/account/campaign-click", method: "POST", body: { id } }),
    }),
    getMarketing: builder.query({
      query: () => "/account/marketing",
      providesTags: ["Marketing"],
    }),
    setMarketing: builder.mutation({
      query: (optOut) => ({ url: "/account/marketing", method: "PUT", body: { optOut } }),
      invalidatesTags: ["Marketing"],
    }),
    cancelDeletion: builder.mutation({
      query: () => ({ url: "/account/deletion", method: "DELETE" }),
      invalidatesTags: ["AccountDeletion", "Auth"],
    }),
  })),
}));

export const {
  useGetStandingQuery, useGetGuardianQuery, useUpdateGuardianMutation, useGetDeletionQuery, useRequestDeletionMutation, useCancelDeletionMutation,
  useCampaignClickMutation, useGetMarketingQuery, useSetMarketingMutation,
  useGetMyTicketsQuery, useGetMyTicketQuery, useGetSupportUnreadQuery,
  useCreateTicketMutation, useReplyTicketMutation, useResolveTicketMutation, useUploadSupportImageMutation,
} = accountApi;
