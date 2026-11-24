// Counts behind the status strip on an admin list page: how many rows match
// the page's other filters, overall and for each status. statuses maps a
// status name to the extra query it adds.
const statusCounts = async (Model, base, statuses) => Object.fromEntries(await Promise.all([
  ["all", base],
  ...Object.entries(statuses).map(([key, extra]) => [key, { ...base, ...extra }]),
].map(async ([key, query]) => [key, await Model.countDocuments(query)])));

module.exports = { statusCounts };
