// Archive questions can belong to several boards, each with several years
// (utils/archiveSources.js). These cover the pure parts: cleaning what the
// editor/importer sends, the spreadsheet cell format, and the query clause
// that keeps a year tied to its own board.

process.env.NODE_ENV = "test";

const mongoose = require("mongoose");
const { normalizeSources, sourcesFromBody, hasSource, sourceMatch, parseSourceCells, latestYear, addSource } = require("../utils/archiveSources");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

const dhaka = new mongoose.Types.ObjectId().toString();
const rajshahi = new mongoose.Types.ObjectId().toString();

console.log("\nnormalizeSources");
{
  const out = normalizeSources([
    { authority: dhaka, years: [2017, "2019", 2017, 2015], paperLabel: " Physics 1st Paper " },
    { authority: rajshahi, years: [2020, 2018] },
    { authority: dhaka, years: [2021] },
    { authority: "", years: [2000] },
    { authority: "not-an-id", years: [2000] },
  ]);
  check("two boards kept, bad rows dropped", out.length === 2, out);
  check("repeated board merged, years unique newest first", JSON.stringify(out[0].years) === "[2021,2019,2017,2015]", out[0]);
  check("paper label trimmed", out[0].paperLabel === "Physics 1st Paper", out[0]);
  check("second board years sorted", JSON.stringify(out[1].years) === "[2020,2018]", out[1]);
  check("nonsense years dropped", normalizeSources([{ authority: dhaka, years: [12, "abc", 2019] }])[0].years.join() === "2019");
  check("not an array → empty", normalizeSources(undefined).length === 0);
}

console.log("\nsourcesFromBody");
{
  check("nothing sent → null (leave stored value alone)", sourcesFromBody({ question: "x" }) === null);
  const legacy = sourcesFromBody({ authority: dhaka, year: 2019, paperLabel: "P1" });
  check("old single fields still accepted", legacy.length === 1 && legacy[0].years[0] === 2019 && legacy[0].paperLabel === "P1", legacy);
  check("empty list clears", sourcesFromBody({ sources: [] }).length === 0);
  check("hasSource", hasSource({ sources: legacy }) && !hasSource({ sources: [] }) && !hasSource({}));
}

console.log("\nsourceMatch");
{
  const one = sourceMatch(dhaka);
  check("board only matches sources.authority", String(one["sources.authority"]) === dhaka, one);
  const withYear = sourceMatch(dhaka, "2021");
  check("board + year uses $elemMatch on the same entry", withYear.sources.$elemMatch.years === 2021 && String(withYear.sources.$elemMatch.authority) === dhaka, withYear);
  const many = sourceMatch([dhaka, rajshahi], 2020);
  check("several boards → $in of ObjectIds", many.sources.$elemMatch.authority.$in.length === 2 && many.sources.$elemMatch.authority.$in[0] instanceof mongoose.Types.ObjectId, many);
}

console.log("\nparseSourceCells (spreadsheet)");
{
  const single = parseSourceCells("Dhaka Board", "2019", "Physics 1st Paper");
  check("one board, one year — same as before", single.groups.length === 1 && single.groups[0].years.join() === "2019" && single.groups[0].paperLabel === "Physics 1st Paper", single);
  const multi = parseSourceCells("Dhaka Board; Rajshahi Board", "2015, 2017, 2019; 2018, 2020", "");
  check("two boards with their own years", multi.groups[0].years.join() === "2019,2017,2015" && multi.groups[1].years.join() === "2020,2018", multi);
  const noYears = parseSourceCells("Dhaka Board; Rajshahi Board", "", "");
  check("boards without years are fine", noYears.groups.length === 2 && noYears.groups[1].years.length === 0, noYears);
  const labels = parseSourceCells("A; B", "2019; 2020", "P1; P2");
  check("one label per board", labels.groups[0].paperLabel === "P1" && labels.groups[1].paperLabel === "P2", labels);
  check("year groups not matching boards → error", Boolean(parseSourceCells("A; B", "2019", "").error));
  check("label parts not matching boards → error", Boolean(parseSourceCells("A; B; C", "", "P1; P2").error));
  check("year with no board → error", Boolean(parseSourceCells("", "2019", "").error));
  check("bad year → error", Boolean(parseSourceCells("A", "20x9", "").error));
  check("all blank → no sources", parseSourceCells("", "", "").groups.length === 0);
}

console.log("\nlatestYear");
{
  const q = { sources: [{ authority: dhaka, years: [2019, 2015] }, { authority: rajshahi, years: [2022] }] };
  check("newest across all boards", latestYear(q) === 2022);
  check("newest for one board", latestYear(q, dhaka) === 2019);
  check("no years → 0", latestYear({ sources: [] }) === 0);
}

console.log("\naddSource (bulk add to board + years)");
{
  const existing = [{ authority: dhaka, years: [2019], paperLabel: "P1" }, { authority: rajshahi, years: [2020] }];
  const more = addSource(existing, dhaka, [2021, 2019, "2023"]);
  check("years added to the existing board, unique, newest first", more[0].years.join() === "2023,2021,2019", more);
  check("paper label on that board kept", more[0].paperLabel === "P1", more);
  check("other board untouched", more[1].years.join() === "2020" && more.length === 2, more);
  const other = new mongoose.Types.ObjectId().toString();
  const added = addSource(existing, other, []);
  check("a new board is added with no years", added.length === 3 && added[2].years.length === 0, added);
  check("no existing sources → just this board", addSource(undefined, dhaka, [2019]).length === 1);
  const populated = addSource([{ authority: { _id: dhaka, name: "Dhaka" }, years: [2018] }], dhaka, [2019]);
  check("populated authority objects handled", populated.length === 1 && populated[0].years.join() === "2019,2018", populated);
}

console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log("FAIL"); process.exit(1); }
console.log("PASS");
