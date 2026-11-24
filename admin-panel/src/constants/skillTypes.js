// Mirrors backend/utils/skillTypes.js — the admin panel and backend don't
// share a module boundary, so this is a deliberate duplicate (same pattern
// as Settings.jsx's FEATURE_COSTS mirror of ai/featureCosts.js). Shared
// across every admin-panel page that needs it, so it's still one file to
// update on this side of the boundary, not several.
export const SKILL_TYPES = [
  { value: "recall", label: "Recall / Definition" },
  { value: "comprehension", label: "Comprehension" },
  { value: "application", label: "Application" },
  { value: "analysis", label: "Analysis" },
  { value: "problemSolving", label: "Problem Solving" },
  { value: "misconception", label: "Misconception" },
];

export const skillTypeLabel = (value) =>
  SKILL_TYPES.find((s) => s.value === value)?.label || value;
