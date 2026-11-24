// Languages staff can write and translate in (backend ai/writing.js).
export const LANGUAGES = [
  ["en", "English"],
  ["bn", "বাংলা"],
  ["hi", "हिन्दी"],
  ["ar", "العربية"],
  ["ur", "اردو"],
  ["es", "Español"],
  ["fr", "Français"],
];

// "Write with AI" offers these; translation offers all of them.
export const WRITE_LANGUAGES = LANGUAGES.filter(([v]) => ["en", "bn", "hi"].includes(v));
