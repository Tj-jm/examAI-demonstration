import { apiSlice, TAG_TYPES } from "../api/apiSlice";

// Refetch everything on screen: pull to refresh, and the app coming back
// from the background. Resolves once nothing is loading any more (or after
// 8 seconds), so a spinner can wait for it.
export const refreshAll = async () => {
  const { store } = await import("../store");
  store.dispatch(apiSlice.util.invalidateTags(TAG_TYPES));
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 400));
  while (Date.now() - started < 8000) {
    const queries = Object.values(store.getState()[apiSlice.reducerPath].queries || {});
    if (!queries.some((q) => q?.status === "pending")) return;
    await new Promise((r) => setTimeout(r, 150));
  }
};
