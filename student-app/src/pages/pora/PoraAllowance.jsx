import { Box, Typography, Button } from "@mui/material";
import { useUnlockPoraMutation } from "../../api/contentApi";
import AiUsageMeter from "../../components/AiUsageMeter";

// The meter during a session. With free daily questions: how many are left
// (they don't use the AI allowance). Without: the AI allowance meter, since
// every turn is then charged like any AI call.
export function SessionMeter({ batchId, settings }) {
  if (!settings) return null;
  if (!settings.freePerDay) return <AiUsageMeter batchId={batchId} compact />;
  const left = settings.availableToday ?? 0;
  return (
    <Typography variant="caption" color={left > 0 ? "text.secondary" : "warning.main"} sx={{ display: "block", mb: 1, textAlign: "right" }}>
      {left > 0 ? `${left} question${left === 1 ? "" : "s"} left today${settings.packRemaining ? ` (${settings.packRemaining} unlocked)` : ""}` : "Today's free questions are used up"}
    </Typography>
  );
}

// Questions left today, and the unlock button once they run out.
// useUnlock: the feature's unlock mutation (Oral Quiz's by default).
export default function PoraAllowance({ batchId, settings, onUnlocked, useUnlock = useUnlockPoraMutation }) {
  const [unlock, { isLoading, error, data }] = useUnlock();
  if (!settings || settings.availableToday === null) return null;
  const left = settings.availableToday;
  const offer = settings.offer;
  const credits = (settings.credits?.batch || 0) + (settings.credits?.general || 0);

  return (
    <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, mb: 2, px: 1.5, py: 1, borderRadius: 2, bgcolor: "action.hover" }}>
      <Typography variant="body2" sx={{ flex: 1, minWidth: 180 }}>
        {left > 0
          ? `${left} question${left === 1 ? "" : "s"} left today${settings.packRemaining ? ` (${settings.packRemaining} unlocked)` : ""}.`
          : "Today's free questions are used up."}
      </Typography>
      {offer && left < 3 && (
        <Button
          size="small"
          variant={left > 0 ? "text" : "contained"}
          disabled={isLoading || credits < offer.packCost}
          onClick={async () => { const r = await unlock(batchId); if (r.data) onUnlocked?.(); }}
        >
          Unlock {offer.packSize} for {offer.packCost} credit{offer.packCost === 1 ? "" : "s"}
        </Button>
      )}
      {offer && left < 3 && credits < offer.packCost && (
        <Typography variant="caption" color="text.secondary" sx={{ width: "100%" }}>You have {credits} AI credit{credits === 1 ? "" : "s"}. Buy credits to unlock more.</Typography>
      )}
      {error && <Typography variant="caption" color="error" sx={{ width: "100%" }}>{error.data?.message || "Couldn't unlock."}</Typography>}
      {data?.message && <Typography variant="caption" color="success.main" sx={{ width: "100%" }}>{data.message}</Typography>}
    </Box>
  );
}
