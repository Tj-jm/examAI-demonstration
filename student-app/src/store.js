import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { apiSlice } from "./api/apiSlice";

export const store = configureStore({
  reducer: { [apiSlice.reducerPath]: apiSlice.reducer },
  middleware: (getDefault) => getDefault().concat(apiSlice.middleware),
});

// Without this, refetchOnFocus/refetchOnReconnect below do nothing — they
// depend on the window focus/online listeners this call wires up. A second
// tab (the admin panel) changing something on the server is invisible to
// this one until it actually refetches, and there was previously no trigger
// for that beyond a full page reload.
setupListeners(store.dispatch);