// The one place the skill-type taxonomy is defined. Every consumer — the
// Question schema's enum, the AI generation prompts/schemas, the CSV
// import/template columns — reads off this list rather than re-typing the
// six values, so adding a 7th later touches one file instead of five.
const SKILL_TYPES = [
  { value: "recall", label: "Recall / Definition" },
  { value: "comprehension", label: "Comprehension" },
  { value: "application", label: "Application" },
  { value: "analysis", label: "Analysis" },
  { value: "problemSolving", label: "Problem Solving" },
  { value: "misconception", label: "Misconception" },
];

const SKILL_TYPE_VALUES = SKILL_TYPES.map((s) => s.value);

// Mirrors student-app/src/constants/skillTypes.js and
// admin-panel/src/constants/skillTypes.js's own skillTypeLabel — same "no
// shared module boundary across the three apps" duplication as those, kept
// in sync by hand. Used wherever backend-generated prose (a study plan
// entry's note, say) needs to name a skill in words rather than its raw
// value.
const skillTypeLabel = (value) => SKILL_TYPES.find((s) => s.value === value)?.label || value;

// Case/spacing-insensitive lookup for CSV cells ("Problem Solving",
// "problem-solving", "PROBLEMSOLVING" all resolve to "problemSolving").
// A blind .toLowerCase() would break problemSolving's camelCase, which is
// why this exists instead of the one-liner every other CSV column uses.
const normalizeSkillType = (raw) => {
  const cell = String(raw || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!cell) return undefined;
  const match = SKILL_TYPE_VALUES.find((v) => v.toLowerCase() === cell);
  return match || undefined;
};

module.exports = { SKILL_TYPES, SKILL_TYPE_VALUES, normalizeSkillType, skillTypeLabel };
