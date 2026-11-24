import { apiSlice } from "./apiSlice";

const qs = (params = {}) => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return clean.length ? `?${new URLSearchParams(Object.fromEntries(clean))}` : "";
};

// Team payslips (backend controllers/admin/payslipController.js).
export const payslipApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPayslips: builder.query({
      query: (params) => `/payslips${qs(params)}`,
      providesTags: ["Payslip"],
    }),
    getPayslipPeople: builder.query({
      query: () => "/payslips/people",
    }),
    previewPayslip: builder.query({
      query: (params) => `/payslips/preview${qs(params)}`,
    }),
    getPayslip: builder.query({
      query: (id) => `/payslips/${id}`,
      providesTags: (r, e, id) => [{ type: "Payslip", id }],
    }),
    getMyPayslips: builder.query({
      query: () => "/payslips/mine",
      providesTags: ["Payslip"],
    }),
    createPayslip: builder.mutation({
      query: (body) => ({ url: "/payslips", method: "POST", body }),
      invalidatesTags: ["Payslip"],
    }),
    updatePayslip: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/payslips/${id}`, method: "PUT", body }),
      invalidatesTags: ["Payslip"],
    }),
    issuePayslip: builder.mutation({
      query: (id) => ({ url: `/payslips/${id}/issue`, method: "POST" }),
      invalidatesTags: ["Payslip"],
    }),
    payPayslip: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/payslips/${id}/pay`, method: "POST", body }),
      invalidatesTags: ["Payslip"],
    }),
    deletePayslip: builder.mutation({
      query: (id) => ({ url: `/payslips/${id}`, method: "DELETE" }),
      invalidatesTags: ["Payslip"],
    }),
    confirmPayslip: builder.mutation({
      query: (id) => ({ url: `/payslips/${id}/confirm`, method: "POST" }),
      invalidatesTags: ["Payslip"],
    }),
    disputePayslip: builder.mutation({
      query: ({ id, note }) => ({ url: `/payslips/${id}/dispute`, method: "POST", body: { note } }),
      invalidatesTags: ["Payslip"],
    }),
    uploadPayslipProof: builder.mutation({
      query: (file) => {
        const body = new FormData();
        body.append("file", file);
        return { url: "/payslips/upload-proof", method: "POST", body };
      },
    }),
    // Class pay (backend utils/classPay.js).
    getClassPay: builder.query({
      query: (params) => `/payslips/class-pay${qs(params)}`,
      providesTags: ["ClassPay"],
    }),
    getMyClassPay: builder.query({
      query: (params) => `/payslips/class-pay/mine${qs(params)}`,
      providesTags: ["ClassPay"],
    }),
    setClassRate: builder.mutation({
      query: ({ userId, ...body }) => ({ url: `/payslips/class-pay/rates/${userId}`, method: "PUT", body }),
      invalidatesTags: ["ClassPay"],
    }),
  }),
});

export const {
  useGetPayslipsQuery, useGetPayslipPeopleQuery, useLazyPreviewPayslipQuery, useGetPayslipQuery, useGetMyPayslipsQuery,
  useCreatePayslipMutation, useUpdatePayslipMutation, useIssuePayslipMutation, usePayPayslipMutation, useDeletePayslipMutation,
  useConfirmPayslipMutation, useDisputePayslipMutation, useUploadPayslipProofMutation,
  useGetClassPayQuery, useGetMyClassPayQuery, useSetClassRateMutation,
} = payslipApi;
