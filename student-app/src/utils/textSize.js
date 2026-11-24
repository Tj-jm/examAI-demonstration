// The student's own text size (Shell.jsx's text size menu), kept on this
// device. Applied as the root font size: every rem in the app follows it,
// and sx font sizes are turned into rem by the theme (buildTheme.js). Not
// page zoom, which threw MUI's menus off screen.
export const TEXT_SIZES = [
  ["small", "Small", 0.9],
  ["default", "Default", 1],
  ["large", "Large", 1.12],
  ["xlarge", "Extra large", 1.25],
];

const KEY = "examai_text_size";

export const getTextSize = () => {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZES.some(([k]) => k === v) ? v : "default";
  } catch {
    return "default";
  }
};

export const applyTextSize = (value = getTextSize()) => {
  const scale = (TEXT_SIZES.find(([k]) => k === value) || TEXT_SIZES[1])[2];
  document.documentElement.style.fontSize = scale === 1 ? "" : `${scale * 100}%`;
};

export const setTextSize = (value) => {
  try { localStorage.setItem(KEY, value); } catch { /* private mode */ }
  applyTextSize(value);
};
