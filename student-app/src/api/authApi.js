import { apiSlice } from "./apiSlice";

export const authApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getSettings: builder.query({
      query: () => "/settings",
      providesTags: ["Settings"],
    }),
    getPublicLandingPage: builder.query({
      query: () => "/landing-page",
    }),
    // A course's public page (Settings → SEO → Course pages).
    getCoursePage: builder.query({
      query: (slug) => `/courses/${encodeURIComponent(slug)}`,
    }),
    // What a friend's referral code gives (the landing page banner).
    checkReferral: builder.query({
      query: (code) => `/referral/${encodeURIComponent(code)}`,
    }),
    // The landing page's interest form (backend utils/leads.js).
    submitLead: builder.mutation({
      query: (body) => ({ url: "/leads", method: "POST", body }),
    }),

    register: builder.mutation({
      query: (body) => ({ url: "/auth/register", method: "POST", body }),
    }),
    verifyOtp: builder.mutation({
      query: (body) => ({ url: "/auth/verify-otp", method: "POST", body }),
    }),
    completeProfile: builder.mutation({
      query: (body) => ({ url: "/auth/complete-profile", method: "POST", body }),
      invalidatesTags: ["Auth"],
    }),
    login: builder.mutation({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
      invalidatesTags: ["Auth"],
    }),
    forgotPassword: builder.mutation({
      query: (body) => ({ url: "/auth/forgot-password", method: "POST", body }),
    }),
    verifyResetOtp: builder.mutation({
      query: (body) => ({ url: "/auth/verify-reset-otp", method: "POST", body }),
    }),
    resetPassword: builder.mutation({
      query: (body) => ({ url: "/auth/reset-password", method: "POST", body }),
      invalidatesTags: ["Auth"],
    }),
    requestLoginOtp: builder.mutation({
      query: (body) => ({ url: "/auth/login-otp/request", method: "POST", body }),
    }),
    loginWithOtp: builder.mutation({
      query: (body) => ({ url: "/auth/login-otp/verify", method: "POST", body }),
      invalidatesTags: ["Auth"],
    }),
    logout: builder.mutation({
      query: () => ({ url: "/auth/logout", method: "POST" }),
      invalidatesTags: ["Auth"],
    }),
    getMe: builder.query({
      query: () => "/auth/me",
      providesTags: ["Auth"],
    }),
    updateProfile: builder.mutation({
      query: (body) => ({ url: "/auth/profile", method: "PUT", body }),
      invalidatesTags: ["Auth"],
    }),
  }),
});

export const {
  useGetSettingsQuery,
  useGetPublicLandingPageQuery,
  useGetCoursePageQuery,
  useSubmitLeadMutation,
  useCheckReferralQuery,
  useRegisterMutation,
  useVerifyOtpMutation,
  useCompleteProfileMutation,
  useLoginMutation,
  useForgotPasswordMutation,
  useVerifyResetOtpMutation,
  useResetPasswordMutation,
  useRequestLoginOtpMutation,
  useLoginWithOtpMutation,
  useLogoutMutation,
  useGetMeQuery,
  useUpdateProfileMutation,
  useLazyGetMeQuery,
} = authApi;
