import { Alert } from "@mui/material";

// Shown at the top of a practice paper (batch or archive) that contains
// written questions: those are AI-graded at submit and cost AI credits.
// `aiCost` comes straight from the build response (utils/writtenBudget.js).
export default function WrittenCostNote({ aiCost, sx }) {
  if (!aiCost?.writtenCount) return null;
  const { writtenCount, costEach, total, unlimited } = aiCost;
  const plural = writtenCount === 1 ? "" : "s";

  return (
    <Alert severity="info" sx={sx}>
      {unlimited
        ? `This paper has ${writtenCount} written question${plural}. They're graded by AI when you submit — no daily AI limit applies here.`
        : `This paper has ${writtenCount} written question${plural}, graded by AI when you submit: ${costEach} AI credit${costEach === 1 ? "" : "s"} each, up to ${total} in total. A written answer with no text and no photo scores 0 and costs nothing.`}
    </Alert>
  );
}

// Shown on the result: what AI grading of this submission actually cost.
// Blank written answers are never sent to AI, so they are not counted.
export function WrittenCostUsed({ result, sx }) {
  if (!result?.aiGraded) return null;
  const { aiGraded, aiCreditsUsed } = result;
  return (
    <Alert severity="info" sx={sx}>
      {`AI graded ${aiGraded} written answer${aiGraded === 1 ? "" : "s"}: ${aiCreditsUsed} AI credit${aiCreditsUsed === 1 ? "" : "s"} used, from today's free allowance first, then your credits.`}
    </Alert>
  );
}
