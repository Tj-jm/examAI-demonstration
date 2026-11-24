import { apiSlice } from "./apiSlice";

// Campaigns (backend utils/campaigns.js): messages to students in bulk.
export const campaignApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getCampaigns: builder.query({
      query: ({ page = 1, status = "", kind = "" } = {}) => `/campaigns?page=${page}${status ? `&status=${status}` : ""}${kind ? `&kind=${kind}` : ""}`,
      providesTags: ["Campaign"],
    }),
    getCampaign: builder.query({
      query: (id) => `/campaigns/${id}`,
      providesTags: (r, e, id) => [{ type: "Campaign", id }],
    }),
    createCampaign: builder.mutation({
      query: (body) => ({ url: "/campaigns", method: "POST", body }),
      invalidatesTags: ["Campaign"],
    }),
    updateCampaign: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/campaigns/${id}`, method: "PUT", body }),
      invalidatesTags: ["Campaign"],
    }),
    estimateCampaign: builder.mutation({
      query: (body) => ({ url: "/campaigns/estimate", method: "POST", body }),
    }),
    sendCampaign: builder.mutation({
      query: ({ id, at }) => ({ url: `/campaigns/${id}/send`, method: "POST", body: at ? { at } : {} }),
      invalidatesTags: ["Campaign"],
    }),
    // Automations: on or off.
    toggleAutomation: builder.mutation({
      query: ({ id, on }) => ({ url: `/campaigns/${id}/toggle`, method: "POST", body: { on } }),
      invalidatesTags: ["Campaign"],
    }),
    cancelCampaign: builder.mutation({
      query: (id) => ({ url: `/campaigns/${id}/cancel`, method: "POST" }),
      invalidatesTags: ["Campaign"],
    }),
    duplicateCampaign: builder.mutation({
      query: (id) => ({ url: `/campaigns/${id}/duplicate`, method: "POST" }),
      invalidatesTags: ["Campaign"],
    }),
    deleteCampaign: builder.mutation({
      query: (id) => ({ url: `/campaigns/${id}`, method: "DELETE" }),
      invalidatesTags: ["Campaign"],
    }),
  }),
});

export const {
  useGetCampaignsQuery, useGetCampaignQuery, useCreateCampaignMutation, useUpdateCampaignMutation,
  useEstimateCampaignMutation, useSendCampaignMutation, useCancelCampaignMutation,
  useDuplicateCampaignMutation, useDeleteCampaignMutation, useToggleAutomationMutation,
} = campaignApi;
