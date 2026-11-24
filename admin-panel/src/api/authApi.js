import { apiSlice } from "./apiSlice";

export const authApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getSetupState: builder.query({
      query: () => "/auth/setup-state",
    }),
    createOwner: builder.mutation({
      query: (body) => ({ url: "/auth/setup", method: "POST", body }),
      invalidatesTags: ["Auth"],
    }),
    login: builder.mutation({
      query: (body) => ({ url: "/auth/login", method: "POST", body }),
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
    changePassword: builder.mutation({
      query: (body) => ({ url: "/auth/password", method: "PUT", body }),
    }),
    // My profile, settings and home (backend staffSelfController.js).
    getSelf: builder.query({ query: () => "/auth/self", providesTags: ["Self"] }),
    updateSelf: builder.mutation({ query: (body) => ({ url: "/auth/self", method: "PUT", body }), invalidatesTags: ["Self", "Auth", "MyHome"] }),
    uploadSelfPhoto: builder.mutation({ query: (file) => { const f = new FormData(); f.append("file", file); return { url: "/auth/self/photo", method: "POST", body: f }; }, invalidatesTags: ["Self"] }),
    getMyHome: builder.query({ query: () => "/auth/self/home", providesTags: ["MyHome"] }),
    verifyInvite: builder.query({
      query: (token) => `/invites/verify?token=${encodeURIComponent(token)}`,
    }),
    acceptInvite: builder.mutation({
      query: (body) => ({ url: "/invites/accept", method: "POST", body }),
      invalidatesTags: ["Auth"],
    }),
  }),
});

export const {
  useGetSetupStateQuery,
  useCreateOwnerMutation,
  useLoginMutation,
  useLogoutMutation,
  useGetMeQuery,
  useChangePasswordMutation,
  useGetSelfQuery,
  useUpdateSelfMutation,
  useUploadSelfPhotoMutation,
  useGetMyHomeQuery,
  useVerifyInviteQuery,
  useAcceptInviteMutation,
} = authApi;
