import { useEffect, useState } from "react";
import TickingNumber from "../../components/TickingNumber";
import {
  Box, Typography, Paper, Button, IconButton, Skeleton, Alert, LinearProgress, TextField, Divider,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Sparkles, Zap, Globe, BatteryCharging, Check, BadgeCheck, X } from "lucide-react";
import {
  useGetAiCreditPlansQuery, useGetGeneralAiCreditPlansQuery, useStartAiCreditCheckoutMutation,
  useGetBatchQuery, useGetAiUsageQuery, useLazyPreviewAiCreditCouponQuery,
} from "../../api/contentApi";
import { BatchContextCard } from "../../components/BatchSwitcher";
import EmptyState from "../../components/EmptyState";
import { useTerms } from "../../BrandingContext";

// Two independent pools shown here — this batch's own packs (checked
// first when AI use runs out) and general packs that work across any
// batch (checked second, as a fallback). Both are real balances a student
// might have at once; nothing here merges them into one number, since
// they're spent in a specific order on the backend, not interchangeably.
export default function AiCredits() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [searchParams] = useSearchParams();
  // Without a batch (/ai-credits): general packs only.
  const noBatch = !batchId;
  const { data: batch, isLoading: batchLoading } = useGetBatchQuery(batchId, { skip: noBatch });
  const { data: batchUsage } = useGetAiUsageQuery(batchId, { skip: noBatch });
  const usage = noBatch ? null : batchUsage;
  const batchQuery = useGetAiCreditPlansQuery(batchId, { skip: noBatch });
  const back = () => (noBatch ? navigate(-1) : navigate(`/batches/${batchId}`));
  const generalQuery = useGetGeneralAiCreditPlansQuery();
  const [startCheckout, { isLoading: checkingOut, error: checkoutError }] = useStartAiCreditCheckoutMutation();
  const [buyingId, setBuyingId] = useState(null);

  // A plan has to be picked before a coupon means anything — same
  // reasoning PlanPicker.jsx uses for batch plans. { id, isGeneral } so
  // checkout and the preview both know which of the two pools it belongs
  // to; a plan id alone doesn't say that.
  const [selected, setSelected] = useState(null);
  // Seeded once from a referral link's ?ref= param (useState's lazy
  // initializer only ever runs on mount) — the coupon still won't preview
  // anything until a pack is picked, same as a hand-typed code would.
  const linkCode = searchParams.get("coupon") || searchParams.get("ref");
  const [coupon, setCoupon] = useState(() => (linkCode || "").toUpperCase());
  // Both read once, alongside coupon — via only ever gets sent to checkout
  // if the coupon field still matches what the short link actually
  // provided (see buy() below), same reasoning PlanPicker.jsx uses.
  const [initialRef] = useState(() => (searchParams.get("ref") || "").toUpperCase());
  const [via] = useState(() => searchParams.get("via") || null);
  const [previewCoupon, { currentData: preview, isFetching: previewLoading, error: previewError }] = useLazyPreviewAiCreditCouponQuery();

  useEffect(() => {
    if (!coupon.trim() || !selected) return;
    const timer = setTimeout(() => {
      previewCoupon({
        planId: selected.id,
        code: coupon.trim(),
        batchId: selected.isGeneral ? undefined : batchId,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [coupon, selected, batchId, previewCoupon]);

  // currentData, not data — data sticks to the last successful result
  // across arg changes, which would keep showing a discount for a coupon
  // that was just changed to an invalid one. See PlanPicker.jsx for the
  // same fix, made for the same reason.
  const activeDiscount = coupon.trim() && preview?.valid ? preview : null;

  // The nav card on BatchHome already hides behind aiAssist, but a direct
  // URL, or the "buy more credits" link surfaced from a doubt-solve cap
  // error (which isn't gated by aiAssist — doubt-solving has its own
  // toggle), can still land here. Bounced back once the batch is known,
  // not blocked with a dead page.
  useEffect(() => {
    if (batch && !batch.features?.aiAssist) {
      navigate(`/batches/${batchId}`, { replace: true });
    }
  }, [batch, batchId, navigate]);

  const buy = async (planId, isGeneral) => {
    setBuyingId(planId);
    try {
      const applyCoupon = selected?.id === planId && coupon.trim();
      const applyVia = applyCoupon && via && coupon.trim().toUpperCase() === initialRef;
      const result = await startCheckout({
        planId,
        ...(isGeneral ? {} : { batchId }),
        ...(applyCoupon ? { couponCode: coupon.trim() } : {}),
        ...(applyVia ? { viaShortLink: via } : {}),
      }).unwrap();
      if (result.free) {
        if (noBatch) back(); else navigate(`/batches/${batchId}`, { replace: true });
      } else {
        window.location.href = result.url;
      }
    } catch {
      // rendered below
    } finally {
      setBuyingId(null);
    }
  };

  const aiAssistOff = Boolean(batch) && !batch.features?.aiAssist;
  const loading = (!noBatch && (batchLoading || aiAssistOff || batchQuery.isLoading)) || generalQuery.isLoading;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 500, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={back}><ArrowLeft size={18} /></IconButton>
      </Box>

      {noBatch ? <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>AI credits</Typography> : <BatchContextCard batch={batch} pageName="AI credits" />}

      {coupon && linkCode && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {searchParams.get("coupon") ? "Code" : "Referral code"} <strong>{coupon}</strong> applied — pick a pack below to see your discount.
        </Alert>
      )}

      {loading ? (
        <Skeleton variant="rounded" height={300} />
      ) : (!noBatch && batchQuery.error) || generalQuery.error ? (
        <Alert severity="error">Could not load AI credit packs.</Alert>
      ) : (
        <>
          {checkoutError && <Alert severity="error" sx={{ mb: 2 }}>{checkoutError.data?.message || "Could not start checkout."}</Alert>}

          {usage && <DailyUsageCard usage={usage} theme={theme} />}

          {!noBatch && <>
          <BalanceCard icon={Zap} label={<><TickingNumber value={batchQuery.data.balance} storageKey={`credits:batch:${batchId}`} /> credit{batchQuery.data.balance === 1 ? "" : "s"} for this {terms.batch}</>} theme={theme} />
          <PlanList
            title={`This ${terms.batch}'s credit packs`}
            plans={batchQuery.data.plans}
            isGeneral={false}
            selected={selected}
            setSelected={setSelected}
            discount={activeDiscount}
            checkingOut={checkingOut}
            buyingId={buyingId}
            onBuy={(id) => buy(id, false)}
          />
          </>}

          <Box sx={{ mt: noBatch ? 0 : 3.5 }}>
            <BalanceCard icon={Globe} label={<><TickingNumber value={generalQuery.data.balance} storageKey="credits:general" /> general credit{generalQuery.data.balance === 1 ? "" : "s"} — works on any batch</>} theme={theme} />
            <PlanList
              title="General credit packs"
              plans={generalQuery.data.plans}
              isGeneral
              selected={selected}
              setSelected={setSelected}
              discount={activeDiscount}
              checkingOut={checkingOut}
              buyingId={buyingId}
              onBuy={(id) => buy(id, true)}
            />
          </Box>

          {selected && (
            <Box sx={{ mt: 3 }}>
              <TextField
                label="Coupon code (optional)"
                size="small"
                fullWidth
                value={coupon}
                onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              />
              {coupon.trim() && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5, minHeight: 20 }}>
                  {previewLoading ? (
                    <Typography variant="caption" color="text.secondary">Checking…</Typography>
                  ) : activeDiscount ? (
                    <>
                      <BadgeCheck size={13} color={theme.palette.success.main} />
                      <Typography variant="caption" sx={{ color: "success.main" }}>
                        Coupon applied — you save {activeDiscount.discountAmount.toFixed(2)} {activeDiscount.currency}
                      </Typography>
                    </>
                  ) : previewError ? (
                    <>
                      <X size={13} color={theme.palette.error.main} />
                      <Typography variant="caption" color="error">
                        {previewError.data?.message || "That coupon isn't valid for this pack."}
                      </Typography>
                    </>
                  ) : null}
                </Box>
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

// The daily free allowance, shown as its own pool distinct from purchased
// credits below — a platform-wide default every student gets on every
// batch, plus this specific batch's own bonus (if it grants one) added on
// top. The bonus portion is what's locked to this batch; the platform
// portion is what still works everywhere else too.
function DailyUsageCard({ usage, theme }) {
  const terms = useTerms();
  const { dailyLimit, usedToday, remainingToday, resetsAt, platformDefault, batchBonus } = usage;
  // ai/usage.js's getUsageSnapshot only ever returns one cost-weighted
  // total, usedToday — it can run past dailyLimit once credits start
  // covering calls (see that file's own comment on sumCostToday). This
  // card wants the free portion and the credit-covered overflow shown
  // separately, so both are derived here rather than assumed to exist on
  // the API response (they previously read `usage.freeUsedToday` and
  // `usage.creditCoveredToday`, fields the backend has never sent —
  // silently rendering "undefined of N free AI calls used today").
  const freeUsedToday = dailyLimit === null ? usedToday : Math.min(usedToday, dailyLimit);
  const creditCoveredToday = dailyLimit === null ? 0 : Math.max(0, usedToday - dailyLimit);

  if (dailyLimit === null) {
    return (
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <BatteryCharging size={18} color={theme.palette.ai.main} />
          <Typography sx={{ fontWeight: 500, fontSize: 14 }}>Unlimited free AI calls on this {terms.batch}</Typography>
        </Box>
      </Paper>
    );
  }

  const atLimit = remainingToday === 0;
  // freeUsedToday, not the raw usedToday total — see ai/usage.js's own
  // comment on why the raw total can run past dailyLimit once credits
  // start covering calls, and why showing that raw number here read as
  // "35 of 24 free calls used", which makes no sense at a glance.
  const pct = Math.min(100, (freeUsedToday / dailyLimit) * 100);
  const resetLabel = resetsAt
    ? new Date(resetsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
        <BatteryCharging size={18} color={theme.palette.ai.main} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 500, fontSize: 14 }}>
            {freeUsedToday} of {dailyLimit} free AI calls used today
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {batchBonus > 0
              ? `${platformDefault} general (works on any batch) + ${batchBonus} bonus for this batch`
              : `${platformDefault} general — works on any batch`}
          </Typography>
        </Box>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 6, borderRadius: 3,
          bgcolor: "action.hover",
          "& .MuiLinearProgress-bar": { borderRadius: 3, bgcolor: atLimit ? "error.main" : theme.palette.ai.main },
        }}
      />
      {creditCoveredToday > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          {creditCoveredToday} more today already covered by credits
        </Typography>
      )}
      {atLimit && resetLabel && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          Next free call ~{resetLabel}, or use a credit below
        </Typography>
      )}
    </Paper>
  );
}

function BalanceCard({ icon: Icon, label, theme }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 1.5, display: "flex", alignItems: "center", gap: 1.5, bgcolor: "ai.bg", borderColor: "ai.main" }}>
      <Icon size={18} color={theme.palette.ai.main} />
      <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{label}</Typography>
    </Paper>
  );
}

function PlanList({ title, plans, isGeneral, selected, setSelected, discount, checkingOut, buyingId, onBuy }) {
  return (
    <>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>{title}</Typography>
      {plans.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          variant="inline"
          title="No packs on sale"
          description="Nothing is available in this category yet. Your daily free AI calls still reset every day."
          sx={{ mb: 2 }}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {plans.map((plan) => {
            const isSelected = selected?.id === plan._id;
            const planDiscount = isSelected ? discount : null;
            const payAmount = planDiscount ? planDiscount.amountPaid : plan.price;

            return (
              <Paper
                key={plan._id}
                variant="outlined"
                onClick={() => setSelected(isSelected ? null : { id: plan._id, isGeneral })}
                sx={{
                  p: 2, borderRadius: 3, cursor: "pointer",
                  borderColor: isSelected ? "primary.main" : "divider",
                  bgcolor: isSelected ? "action.hover" : "transparent",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <Box sx={{
                    width: 40, height: 40, borderRadius: 2, flexShrink: 0,
                    bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Sparkles size={18} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{plan.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{plan.credits} AI calls</Typography>
                  </Box>

                  {isSelected ? (
                    <Box sx={{
                      width: 22, height: 22, flexShrink: 0, borderRadius: "50%",
                      bgcolor: "primary.main", color: "primary.contrastText",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Check size={13} strokeWidth={3} />
                    </Box>
                  ) : (
                    <Typography sx={{ fontWeight: 600, fontSize: 15, color: "text.secondary" }}>
                      {plan.price}
                    </Typography>
                  )}
                </Box>

                {isSelected && (
                  <Box sx={{ mt: 1.5 }}>
                    <Divider sx={{ mb: 1.5 }} />

                    {/* Same strikethrough-to-reduced-price reveal
                        PlanPicker.jsx's PlanCard uses — keyed on the
                        discounted amount so a changed coupon replays it
                        rather than sitting static. */}
                    {planDiscount ? (
                      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 1.5 }}>
                        <Typography sx={{ fontSize: 13, color: "text.secondary", opacity: 0.6, textDecoration: "line-through" }}>
                          {plan.price}
                        </Typography>
                        <Typography
                          key={`${planDiscount.amountPaid}`}
                          sx={{
                            fontSize: 17, fontWeight: 700, color: "success.main",
                            animation: "aiPackPriceReveal 380ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                            "@keyframes aiPackPriceReveal": {
                              "0%": { opacity: 0, transform: "translateY(3px) scale(0.85)" },
                              "60%": { opacity: 1, transform: "translateY(-1px) scale(1.05)" },
                              "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
                            },
                          }}
                        >
                          {planDiscount.amountPaid}
                        </Typography>
                      </Box>
                    ) : null}

                    <Button
                      variant="contained"
                      fullWidth
                      disabled={checkingOut && buyingId === plan._id}
                      onClick={(e) => { e.stopPropagation(); onBuy(plan._id); }}
                    >
                      {checkingOut && buyingId === plan._id ? "Starting checkout" : `Pay ${payAmount}`}
                    </Button>
                  </Box>
                )}
              </Paper>
            );
          })}
        </Box>
      )}
    </>
  );
}
