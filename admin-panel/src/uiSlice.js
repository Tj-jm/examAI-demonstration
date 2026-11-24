import { createSlice } from "@reduxjs/toolkit";
import { applyTheme } from "./theme/themes";

// Appearance is the buyer's choice and it is persisted per browser. On a real
// install these defaults come from AppSettings; until that endpoint is wired
// the local values stand in.
const KEY = "examai-admin-ui";

const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};

const saved = load();

const initialState = {
  theme: saved.theme || "slate",
  mode: saved.mode || "light",
  layout: saved.layout || "sidebar",
};

applyTheme(initialState.theme, initialState.mode);

const persist = (state) => {
  localStorage.setItem(KEY, JSON.stringify(state));
  applyTheme(state.theme, state.mode);
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setTheme: (state, action) => { state.theme = action.payload; persist(state); },
    setMode: (state, action) => { state.mode = action.payload; persist(state); },
    setLayout: (state, action) => { state.layout = action.payload; persist(state); },
  },
});

export const { setTheme, setMode, setLayout } = uiSlice.actions;
export default uiSlice.reducer;
