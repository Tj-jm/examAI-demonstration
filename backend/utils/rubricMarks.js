// Ties an AI grade to the rubric it was marked against. The model returns a
// total (`marks`) and, row by row, what it awarded for each rubric criterion
// (`criteriaMet`). The rows are what the rubric actually allows, so when the
// model sends one per rubric row, the mark is built from them: each row is
// capped at that row's own marks and the total is their sum. A total that
// disagrees with its own rows, or a row given more than the rubric allows,
// can't reach the student or the teacher.
//
// Without a usable breakdown (older or smaller models sometimes omit it) the
// total is used as before, capped at the question's marks.
const toMark = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);

const reconcileRubricMarks = ({ rubric, totalMarks, data }) => {
  const rows = Array.isArray(rubric) ? rubric : [];
  const given = Array.isArray(data?.criteriaMet) ? data.criteriaMet : [];
  const cap = toMark(totalMarks);

  if (rows.length > 0 && given.length === rows.length) {
    const criteria = rows.map((row, i) => {
      const awarded = Math.min(toMark(given[i]?.marksAwarded), toMark(row.marks));
      return { criterion: row.criterion, met: Boolean(given[i]?.met), marksAwarded: awarded, marksAvailable: toMark(row.marks) };
    });
    const sum = criteria.reduce((total, c) => total + c.marksAwarded, 0);
    return { marks: Math.min(sum, cap), criteria, fromRubric: true };
  }

  return { marks: Math.min(toMark(data?.marks), cap), criteria: null, fromRubric: false };
};

module.exports = { reconcileRubricMarks };
