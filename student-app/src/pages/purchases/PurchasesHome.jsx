import { useState } from "react";
import { Box, Typography, Paper, Chip, Skeleton, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { Receipt, Store } from "lucide-react";
import { useGetBatchesQuery, useGetPurchasesQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import Pager from "../../components/Pager";
import ReferralCard from "../../components/ReferralCard";
import { useTerms, useHomeMx } from "../../BrandingContext";
import { MascotOnce } from "../../components/Mascot";

export default function PurchasesHome() {
  const terms = useTerms();
  const mx = useHomeMx();
  const { data: batches, isLoading: loadingBatches } = useGetBatchesQuery();
  const [page, setPage] = useState(1);
  const { data: purchases, isLoading: loadingPurchases } = useGetPurchasesQuery(page);
  const navigate = useNavigate();

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
      <Typography variant="h6" sx={{ fontWeight: 500, mb: 3, fontSize: 17 }}>Plans</Typography>

      <ReferralCard />

      {(batches?.browsable || []).length > 0 && (
        (batches.browsable.some((b) => b.trialAvailable))
          ? <MascotOnce mood="act" move="point" say="Not sure? Try one free first!" once="plans" delay={1200} />
          : <MascotOnce mood="act" move="thumbs" say="Pick what fits you!" once="plans" delay={1200} />
      )}

      {/* Nothing on sale and nothing bought is the true dead end here — one
          state for it, instead of an invisible section plus a grey line. */}
      {!loadingBatches && !loadingPurchases
        && (batches?.browsable || []).length === 0
        && (purchases?.purchases || []).length === 0 && (
        <EmptyState
          bordered
          icon={Store}
          tone="blocked"
          title="Nothing on sale right now"
          description={`Your ${terms.org} has not opened any ${terms.batch} for enrolment. Ask them to add you directly if you are expecting one.`}
        />
      )}

      {(batches?.browsable || []).length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>Available to enrol</Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mb: 4 }}>
            {loadingBatches ? (
              <Skeleton variant="rounded" height={70} />
            ) : (
              batches.browsable.map((b) => (
                <Paper key={b._id} variant="outlined" sx={{ p: 2, borderRadius: 2, display: "flex", alignItems: "center", gap: 2 }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>{b.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {b.plans?.length > 0 ? `From ${Math.min(...b.plans.map((p) => p.price))}` : "No plans yet"}
                      {b.trialAvailable && " · free trial available"}
                    </Typography>
                  </Box>
                  <Button size="small" variant="contained" onClick={() => navigate(`/purchases/${b._id}`)}>
                    View plans
                  </Button>
                </Paper>
              ))
            )}
          </Box>
        </>
      )}

      {(purchases?.purchases || []).length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.5 }}>Your purchases</Typography>
      )}
      {loadingPurchases ? (
        <Skeleton variant="rounded" height={60} />
      ) : (purchases?.purchases || []).length === 0 ? (
        // Suppressed entirely when the browsable list is empty too, since
        // that case already has its own state above and two stacked empties
        // read as a broken page.
        (batches?.browsable || []).length > 0 && (
          <EmptyState
            icon={Receipt}
            title="No purchases yet"
            description="Anything you buy shows up here with its receipt and access dates."
          />
        )
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {purchases.purchases.map((p) => (
            <Paper
              key={p._id}
              variant="outlined"
              onClick={() => navigate(`/purchases/receipt/${p._id}`)}
              sx={{ p: 2, borderRadius: 2, display: "flex", alignItems: "center", gap: 2, cursor: "pointer" }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 500, fontSize: 14 }} noWrap>
                  {p.batch?.name || (p.kind === "ai-credits" ? "General AI credits" : "Plan")}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {p.plan.label} · {p.currency} {p.amountPaid ?? p.plan.price}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={p.status}
                color={p.status === "complete" ? "success" : p.status === "pending" ? "warning" : "default"}
              />
            </Paper>
          ))}
          <Pager page={purchases?.page || 1} pages={purchases?.pages || 1} total={purchases?.total || 0} onChange={setPage} />
        </Box>
      )}
    </Box>
  );
}
