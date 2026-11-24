// Mirrors backend/utils/skillTypes.js and admin-panel/src/constants/skillTypes.js
// — no shared module boundary between the three, so this is a deliberate
// duplicate. Used to label a study-plan day's targeted skill and to badge
// the practice modal opened from it.
export const SKILL_TYPES = [
  { value: "recall", label: "Recall / Definition" },
  { value: "comprehension", label: "Comprehension" },
  { value: "application", label: "Application" },
  { value: "analysis", label: "Analysis" },
  { value: "problemSolving", label: "Problem Solving" },
  { value: "misconception", label: "Misconception" },
];

// "none" is the study plan's miscellaneous-bucket sentinel (see
// studyPlanModel.js and practiceController.js's getPracticeQuestions) —
// questions never tagged with a skill at all, not a real skill value.
export const skillTypeLabel = (value) =>
  value === "none" ? "Miscellaneous" : SKILL_TYPES.find((s) => s.value === value)?.label || value;

// Which existing theme palette key badges a given skill — reusing real
// semantic colors (not new hardcoded hex) so a skill chip stays correct
// under every theme/design combination the app supports, the same way the
// rest of the app never hardcodes a color that a branding swap would break.
const SKILL_TYPE_PALETTE_KEY = {
  recall: "primary",
  comprehension: "ai",
  application: "success",
  analysis: "warning",
  problemSolving: "ai",
  misconception: "error",
};

export const skillTypePaletteKey = (value) => SKILL_TYPE_PALETTE_KEY[value] || "primary";
