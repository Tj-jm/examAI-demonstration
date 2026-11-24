// The level names on "My progress", lowest band first. Admins can rename
// each band (Settings → Student app → Names); the levels where a band
// starts stay fixed.
const LEVEL_BANDS = [
  { from: 1, title: "Rookie" },
  { from: 3, title: "Learner" },
  { from: 5, title: "Explorer" },
  { from: 8, title: "Achiever" },
  { from: 11, title: "Scholar" },
  { from: 15, title: "Expert" },
  { from: 20, title: "Master" },
  { from: 30, title: "Legend" },
];

// The bands with any admin names applied; a blank name keeps the default.
const levelBands = (names = []) => LEVEL_BANDS.map((b, i) => ({
  from: b.from,
  title: (typeof names?.[i] === "string" && names[i].trim()) || b.title,
}));

module.exports = { LEVEL_BANDS, levelBands };
