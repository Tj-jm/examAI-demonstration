const mongoose = require("mongoose");

// An archive question's provenance: every board/exam/book it appeared in,
// each with all the years it appeared there — e.g. Dhaka Board 2015, 2017,
// 2019 and Rajshahi Board 2018, 2020. Stored on Question.sources as
// [{ authority, years: [Number], paperLabel }].

const toObjectId = (id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id)));

const parseYears = (raw) => {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,\s]+/);
  const years = list
    .map((y) => Number(String(y).trim()))
    .filter((y) => Number.isInteger(y) && y >= 1900 && y <= 2200);
  return [...new Set(years)].sort((a, b) => b - a);
};

// Validates and tidies a client-sent sources list: drops rows with no valid
// board, merges repeated boards (years unioned, first non-empty paper label
// kept), de-dupes and sorts years newest first. Always returns an array.
const normalizeSources = (raw) => {
  if (!Array.isArray(raw)) return [];
  const byAuthority = new Map();
  for (const row of raw) {
    const id = row?.authority?._id || row?.authority;
    if (!id || !mongoose.isValidObjectId(String(id))) continue;
    const key = String(id);
    const years = parseYears(row.years);
    const paperLabel = typeof row.paperLabel === "string" ? row.paperLabel.trim() : "";
    const existing = byAuthority.get(key);
    if (existing) {
      existing.years = parseYears([...existing.years, ...years]);
      if (!existing.paperLabel && paperLabel) existing.paperLabel = paperLabel;
    } else {
      byAuthority.set(key, { authority: key, years, paperLabel });
    }
  }
  return [...byAuthority.values()].map((s) => ({
    authority: s.authority,
    years: s.years,
    ...(s.paperLabel ? { paperLabel: s.paperLabel } : {}),
  }));
};

// Accepts either the new `sources` array or the old single
// authority/year/paperLabel fields, so older clients keep working.
const sourcesFromBody = (body) => {
  if (Array.isArray(body?.sources)) return normalizeSources(body.sources);
  if (body?.authority) {
    return normalizeSources([{ authority: body.authority, years: body.year ? [body.year] : [], paperLabel: body.paperLabel }]);
  }
  return null; // nothing sent — leave whatever is stored alone
};

const hasSource = (question) => Array.isArray(question?.sources) && question.sources.some((s) => s?.authority);

// The query clause for "appeared under this board (or one of these boards),
// optionally in this year". The year must belong to the same board entry —
// a question from Dhaka 2019 and Rajshahi 2021 does not match Dhaka 2021.
// authorities: one id or an array of ids. Always returns real ObjectIds so
// the clause works inside Question.aggregate() too, which does not cast.
const sourceMatch = (authorities, year) => {
  const ids = (Array.isArray(authorities) ? authorities : [authorities]).filter(Boolean).map(toObjectId);
  const authority = ids.length === 1 ? ids[0] : { $in: ids };
  // One year, or several ("2019,2021" or an array): any of them.
  const years = yearList(year);
  if (years.length === 1) return { sources: { $elemMatch: { authority, years: years[0] } } };
  if (years.length > 1) return { sources: { $elemMatch: { authority, years: { $in: years } } } };
  return { "sources.authority": authority };
};

// "2019,2021" / ["2019", 2021] / 2019 → [2019, 2021]; anything else dropped.
const yearList = (year) => [...new Set((Array.isArray(year) ? year : String(year ?? "").split(","))
  .map((v) => Number(String(v).trim()))
  .filter((v) => Number.isInteger(v) && v > 0))].slice(0, 30);

// Newest year a question appeared under any board (or one given board).
const latestYear = (question, authorityId) =>
  Math.max(
    0,
    ...(question?.sources || [])
      .filter((s) => !authorityId || String(s.authority?._id || s.authority) === String(authorityId))
      .flatMap((s) => s.years || [])
  );

// Spreadsheet import: the Authority, Year and PaperLabel cells of one row.
// Several boards are separated by ";" and each board's years are a
// comma-separated group in the same position:
//   Authority: "Dhaka Board; Rajshahi Board"
//   Year:      "2015, 2017, 2019; 2018, 2020"
//   PaperLabel "Physics 1st Paper"  (one label for all, or one per board)
// Returns { groups: [{ name, years, paperLabel }] } or { error }.
const split = (v) => String(v ?? "").split(";").map((x) => x.trim());
const parseSourceCells = (authorityCell, yearCell, labelCell) => {
  const names = split(authorityCell).filter(Boolean);
  const yearGroups = String(yearCell ?? "").trim() ? split(yearCell) : [];
  const labels = String(labelCell ?? "").trim() ? split(labelCell) : [];

  if (names.length === 0) {
    if (yearGroups.length > 0) return { error: "Year is filled in but Authority is blank — every year belongs to a board/exam/book." };
    return { groups: [] };
  }
  if (yearGroups.length > 0 && yearGroups.length !== names.length) {
    return { error: `Authority lists ${names.length} board(s) but Year has ${yearGroups.length} group(s). Separate each board's years with ";" in the same order, e.g. "2019, 2021; 2020".` };
  }
  if (labels.length > 1 && labels.length !== names.length) {
    return { error: `PaperLabel has ${labels.length} parts but Authority lists ${names.length} board(s). Give one label for all, or one per board separated by ";".` };
  }
  for (const group of yearGroups) {
    const bad = group.split(",").map((y) => y.trim()).filter((y) => y && parseYears([y]).length === 0);
    if (bad.length > 0) return { error: `"${bad[0]}" is not a valid year.` };
  }

  return {
    groups: names.map((name, i) => ({
      name,
      years: parseYears(yearGroups[i] ? yearGroups[i].split(",") : []),
      paperLabel: (labels.length > 1 ? labels[i] : labels[0]) || undefined,
    })),
  };
};

// Bulk "add to board + years": files a question under one more board (or
// adds years to a board it already has), leaving every other board, year
// and paper label as it is. Returns the new sources list.
const addSource = (existing, authority, years) =>
  normalizeSources([
    ...(existing || []).map((s) => ({ authority: s.authority?._id || s.authority, years: s.years, paperLabel: s.paperLabel })),
    { authority, years: parseYears(years || []) },
  ]);

module.exports = {
  yearList, normalizeSources, sourcesFromBody, hasSource, sourceMatch, parseYears, latestYear, parseSourceCells, addSource };
