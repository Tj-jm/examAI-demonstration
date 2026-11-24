import { Box, Typography, LinearProgress } from "@mui/material";
import TickingNumber from "./TickingNumber";
import { useTheme } from "@mui/material/styles";
import { Sparkles } from "lucide-react";
import { useGetAiUsageQuery, useGetArchiveAiUsageQuery } from "../api/contentApi";

// Same shape as DoubtQuotaMeter (doubts/DoubtQuotaMeter.jsx) on purpose —
// one visual language for "here's a capacity you're drawing down, here's
// what's left". Renders nothing when there's truly nothing to report: an
// unlimited daily allowance and zero credits in either pool is the common
// case for a batch that hasn't set anything up, and a meter with nothing
// to measure isn't a meter.
//
// `archive: true` switches to the archive's own usage snapshot (batch:
// null — a shared scope across every batch's archive door, see
// archiveController.js's getAiUsage) instead of this batch's own. Every
// archive AI call is logged and billed under that shared scope, never this
// batch's, so showing the batch-scoped query here would silently report a
// number that never matches what an archive call actually draws down —
// both hooks are called unconditionally (Rules of Hooks) and the unused one
// is skipped, rather than picking which hook to call at the call site.
export default function AiUsageMeter({ batchId, archive = false, compact = false }) {
  const theme = useTheme();
  const batchUsage = useGetAiUsageQuery(batchId, { skip: archive });
  const archiveUsage = useGetArchiveAiUsageQuery(batchId, { skip: !archive });
  const { data } = archive ? archiveUsage : batchUsage;

  if (!data) return null;

  const { dailyLimit, usedToday, remainingToday, resetsAt, batchCredits, generalCredits } = data;
  const totalCredits = (batchCredits || 0) + (generalCredits || 0);

  if (dailyLimit === null && totalCredits === 0) return null;

  // usedToday is a cost-weighted running total that keeps climbing past
  // dailyLimit once credits start covering calls (see ai/usage.js's own
  // comment on sumCostToday) — showing it raw reads as "35 of 24 free AI
  // calls today", which makes no sense at a glance. Same fix AiCredits.jsx's
  // DailyUsageCard already applies: clamp the free portion, and surface the
  // credit-covered overflow as its own line instead of folding it into a
  // number that's supposed to top out at dailyLimit.
  const freeUsedToday = dailyLimit === null ? usedToday : Math.min(usedToday, dailyLimit);
  const creditCoveredToday = dailyLimit === null ? 0 : Math.max(0, usedToday - dailyLimit);
  // Out of free calls is only really "at limit" when there's also nothing
  // in reserve to cover the next one — remainingToday alone ignores
  // credits, so a student with a full credit balance saw a red bar and
  // "Next free call ~X" as if they were blocked, when they could keep
  // asking doubts right away off credits.
  const atLimit = dailyLimit !== null && remainingToday === 0 && totalCredits === 0;
  const pct = dailyLimit ? Math.min(100, (freeUsedToday / dailyLimit) * 100) : 0;

  const resetLabel = resetsAt
    ? new Date(resetsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;

  const creditsLabel = totalCredits > 0
    ? <>+ <TickingNumber value={totalCredits} storageKey={`credits:total:${archive ? "archive" : batchId}`} /> credit{totalCredits === 1 ? "" : "s"} in reserve</>
    : null;

  return (
    <Box sx={{ mb: compact ? 1.5 : 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
        <Sparkles size={13} style={{ opacity: 0.6 }} />
        {dailyLimit !== null ? (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {freeUsedToday} of {dailyLimit} free AI calls today{creditsLabel && <> ({creditsLabel})</>}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            Unlimited free AI calls{creditsLabel && <> — {creditsLabel}</>}
          </Typography>
        )}
        {atLimit && resetLabel && (
          <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.75 }}>
            Next free call ~{resetLabel}
          </Typography>
        )}
      </Box>
      {dailyLimit !== null && (
        <LinearProgress
          variant="determinate"
          value={pct}
          sx={{
            height: 6, borderRadius: 3,
            bgcolor: "action.hover",
            "& .MuiLinearProgress-bar": { borderRadius: 3, bgcolor: atLimit ? "error.main" : theme.palette.ai?.main || theme.palette.primary.main },
          }}
        />
      )}
      {creditCoveredToday > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, opacity: 0.75 }}>
          {creditCoveredToday} more today already covered by credits
        </Typography>
      )}
    </Box>
  );
}
