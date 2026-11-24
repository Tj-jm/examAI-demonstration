import { configureStore } from "@reduxjs/toolkit";
import { apiSlice } from "./api/apiSlice";
import uiReducer from "./uiSlice";
import { savedTickMiddleware } from "./savedTick";

export const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,
    ui: uiReducer,
  },
  middleware: (getDefault) => getDefault().concat(apiSlice.middleware, savedTickMiddleware),
});