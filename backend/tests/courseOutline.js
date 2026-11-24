// The batch outline's ordering rules (utils/courseOutline.js), without a
// database: grouped chapters first in their group's order, then the rest in
// outline order, and anything the outline doesn't mention after that.

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const { outlineFor, compareKeys } = require("../utils/courseOutline");

let passed = 0;
let failed = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}\n        expected ${e}, got ${a}`); }
};

const id = () => String(new mongoose.Types.ObjectId());

(async () => {
  const [c1, c2, c3, c4, c5] = [id(), id(), id(), id(), id()];
  const [l1, l2, l3] = [id(), id(), id()];
  const g1 = id();
  const g2 = id();
  const batch = {
    outline: {
      groups: [{ _id: g1, name: "Paper 1", chapters: [c3, c1] }, { _id: g2, name: "Paper 2", chapters: [c4, c1] }],
      chapters: [c5, c2],
      lectures: [l2, l1],
    },
  };
  const ol = await outlineFor(batch);
  const name = { [c1]: "c1", [c2]: "c2", [c3]: "c3", [c4]: "c4", [c5]: "c5" };

  check("groups first, then outline order, unknown last",
    [c2, c1, c4, c5, c3].sort(ol.byChapter((x) => x)).map((x) => name[x]),
    ["c3", "c1", "c4", "c5", "c2"]);
  check("a chapter belongs to its first group only", ol.group(c1)?.name, "Paper 1");
  check("ungrouped chapter has no group", ol.group(c5), null);
  check("groups listed in order", ol.groups.map((g) => g.name), ["Paper 1", "Paper 2"]);

  const lectures = [
    { _id: l3, chapter: c3, order: 0, createdAt: "2026-01-01" },
    { _id: l1, chapter: c3, order: 5, createdAt: "2026-01-02" },
    { _id: l2, chapter: c3, order: 9, createdAt: "2026-01-03" },
    { _id: id(), chapter: c5, order: 0, createdAt: "2026-01-01", label: "c5" },
  ];
  check("lectures: chapter first, then outline order, then own order",
    lectures.sort(ol.byLecture()).map((l) => (l._id === l1 ? "l1" : l._id === l2 ? "l2" : l._id === l3 ? "l3" : l.label)),
    ["l2", "l1", "l3", "c5"]);

  const empty = await outlineFor({});
  check("no outline: lectures by own order then age",
    [{ _id: "a", chapter: c1, order: 2 }, { _id: "b", chapter: c1, order: 1 }].sort(empty.byLecture()).map((l) => l._id),
    ["b", "a"]);
  check("compareKeys mixes numbers and text", [[1, "b"], [1, "a"], [0, "z"]].sort(compareKeys), [[0, "z"], [1, "a"], [1, "b"]]);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
