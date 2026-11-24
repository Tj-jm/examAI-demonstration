import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { API_ROOT } from "./apiBase";
import { isNative, nativeHeaders, setSessionToken, clearSessionToken } from "../native/session";
import { withFriendlyMessage } from "../utils/friendlyError";

// A public webinar guest's pass (pages/webinar/Webinar.jsx), sent with
// every request while it's set. The server only reads it on webinar routes.
let guestToken = null;
export const setGuestToken = (token) => { guestToken = token || null; };

// Every student route lives under /api/app — the base url absorbs that
// prefix so every endpoint definition below is written relative to it.
// API_ROOT is "" (same-origin) for every normal web deployment; only the
// Capacitor-wrapped native build points it at a real absolute origin.
const rawBaseQuery = fetchBaseQuery({
  baseUrl: `${API_ROOT}/api/app`,
  credentials: "include",
  // The mobile app's session travels in a header (native/session.js).
  prepareHeaders: (headers) => {
    for (const [k, v] of Object.entries(nativeHeaders())) headers.set(k, v);
    if (guestToken) headers.set("X-Guest-Token", guestToken);
    return headers;
  },
});

// 401 and 440 (session ended, or signed in elsewhere — see studentAuth.js
// on the backend) both mean the session is gone. Handled once here so no
// page has to think about it.
const baseQuery = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  if (isNative) {
    // A login answers with the token; keep it and hand the page the rest.
    if (result.data && typeof result.data === "object" && result.data.sessionToken) {
      const { sessionToken, ...rest } = result.data;
      setSessionToken(sessionToken);
      result = { ...result, data: rest };
    }
    const url = typeof args === "string" ? args : args?.url;
    if (url === "/auth/logout" || (result.error && [401, 440].includes(result.error.status))) clearSessionToken();
  }

  // Only a real auth failure redirects. A FETCH_ERROR carries a string
  // status, not a number, so a backend restart or a dropped connection falls
  // through here untouched — the route guards in App.jsx show a retry
  // instead. This is the difference between "log in again" and "we could not
  // ask", which are not the same problem and do not have the same fix.
  if (result.error && [401, 440].includes(result.error.status)) {
    // Public pages (the auth screens, course pages) stay put.
    const onAuthScreen = ["/", "/login", "/register", "/forgot-password", "/courses/", "/w/"].some(
      (p) => window.location.pathname === p || (p !== "/" && window.location.pathname.startsWith(p))
    );

    // A full location change tears down the app and loses the current page.
    // Kept because the base query has no router to navigate with, but scoped
    // so it cannot fire while the student is already sitting on an auth
    // screen — which previously turned a failed login attempt into a reload
    // that wiped the form.
    if (!onAuthScreen) window.location.href = "/login";
  }

  if (result.error) result = { ...result, error: withFriendlyMessage(result.error) };

  return result;
};

// Exported for "refresh everything" (native/refresh.js).
export const TAG_TYPES = ["Auth", "Settings", "Batch", "Lecture", "Exam", "Submission", "Practice", "PracticeExamRecord", "Purchase", "Doubt", "Favorite", "ArchiveFavorite", "Notice", "Notification", "Leaderboard", "AiCredit", "LiveClass", "StudyPlan", "ArchiveStudyPlan", "ArchiveExamRecord", "DocChat", "Support", "Standing", "AccountDeletion", "Tutor", "Learn", "Assignment", "PracticeQna", "StudentVideo", "Guardian", "Marketing", "Pora", "Tutoring", "Interview", "Coding"];

export const apiSlice = createApi({
  baseQuery,
  tagTypes: TAG_TYPES,
  // The admin panel is a separate app with its own store — publishing or
  // opening an exam there is invisible to an already-open student tab until
  // something here triggers a refetch. Coming back to this tab, or the
  // network reconnecting, is that trigger; setupListeners in store.js is
  // the other half this depends on.
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: () => ({}),
});

// RTK Query reads refetchOnMountOrArgChange only from createApi() or the
// hook call; written on an endpoint definition it's silently ignored. Many
// endpoints here set it there ("always fresh when a page opens": the home
// screen's batches after a purchase, for one), so these two make it count:
// mountRefetch records each endpoint's own value while the endpoints are
// built, and honourMountRefetch passes it to that endpoint's hook. A value
// given at the call site still wins.
const mountRefetch = new Map();

export const withMountRefetch = (endpoints) => (builder) => {
  const defs = endpoints(builder);
  for (const [name, def] of Object.entries(defs)) {
    if (def?.refetchOnMountOrArgChange !== undefined) mountRefetch.set(name, def.refetchOnMountOrArgChange);
  }
  return defs;
};

export const honourMountRefetch = (api) => {
  for (const [name, value] of mountRefetch) {
    const hook = `use${name[0].toUpperCase()}${name.slice(1)}Query`;
    const original = api.endpoints[name]?.useQuery;
    if (!original) continue;
    const fresh = (arg, options) => original(arg, { refetchOnMountOrArgChange: value, ...options });
    api.endpoints[name].useQuery = fresh;
    api[hook] = fresh;
  }
  return api;
};
