import { useState, useEffect } from "react";
import {
  Box, Typography, Paper, Button, TextField, Skeleton, Alert, Chip, Divider,
} from "@mui/material";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { Check, Tag, CreditCard, Clock, Infinity as InfinityIcon, BadgeCheck, X } from "lucide-react";
import { savedRef, clearRef, saveRef } from "../../utils/referralRef";
import { useGetBatchPlansQuery, useLazyPreviewCouponQuery, useStartCheckoutMutation, useStartTrialMutation } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { PaymentShell, BatchSpine, SectionRule } from "../../components/PaymentShell";
import { useTerms, useBranding } from "../../BrandingContext";
import { PlanColumns, PlanAurora } from "./PlanStyles";
import { MascotOnce, mascotReact } from "../../components/Mascot";

export default function PlanPicker() {
  const terms = useTerms();
  const { planStyle = "classic" } = useBranding() || {};
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const [searchParams] = useSearchParams();
  const { data: batch, isLoading } = useGetBatchPlansQuery(batchId);
  const [startCheckout, { isLoading: checkingOut, error: checkoutError }] = useStartCheckoutMutation();
  const [startTrial, { isLoading: startingTrial }] = useStartTrialMutation();

  // Selection and purchase are now two separate acts, following the sample:
  // tapping a plan selects it and reveals its own pay action inside the card,
  // rather than every card carrying a live Buy button. On a list of four
  // plans that turns four equally-weighted buttons into one, and puts the
  // commitment next to the thing being committed to.
  const [selectedPlan, setSelectedPlan] = useState(null);
  // Seeded once from a referral link's ?ref= param (useState's lazy
  // initializer only ever runs on mount), so a shared link's whole point —
  // no typing required — actually holds, while still just being the same
  // coupon field underneath: the debounced preview effect below picks this
  // up exactly like a hand-typed code the moment a plan is selected.
  // A referral link opened earlier on this device (utils/referralRef.js)
  // fills it in too, when the page itself carries no code.
  // A campaign's ?coupon= wins over both.
  const linkCode = searchParams.get("coupon") || searchParams.get("ref");
  const [coupon, setCoupon] = useState(() => (linkCode || savedRef()).toUpperCase());
  const [fromSaved] = useState(() => !linkCode && Boolean(savedRef()));
  // Remember a link's code on this device too. An in-app link (a campaign
  // notification) never passes through captureRef, and without this a
  // remount or refresh that loses the address also loses the code.
  useEffect(() => { if (linkCode) saveRef(linkCode); }, [linkCode]);
  // Both read once, alongside coupon — via only ever gets sent to checkout
  // if the coupon field still matches what the short link actually
  // provided (see buy() below). Someone who clears the field and types a
  // different code shouldn't have that purchase attributed to a link they
  // didn't actually use.
  const [initialRef] = useState(() => (searchParams.get("ref") || "").toUpperCase());
  const [via] = useState(() => searchParams.get("via") || null);
  const [currency, setCurrency] = useState(null);
  const [gateway, setGateway] = useState(null);

  const [previewCoupon, { currentData: preview, isFetching: previewLoading, error: previewError }] = useLazyPreviewCouponQuery();

  // Debounced, and only while there's an actual code and an actual plan
  // selected — a coupon means nothing without knowing which price it's
  // being applied against, so there's nothing to preview before that
  // point regardless of what's typed.
  useEffect(() => {
    if (!coupon.trim() || !selectedPlan || !batch) return;
    const timer = setTimeout(() => {
      previewCoupon({ batchId, code: coupon.trim(), planLabel: selectedPlan, currency: currency || batch.defaultCurrency });
    }, 500);
    return () => clearTimeout(timer);
  }, [coupon, selectedPlan, currency, batch, batchId, previewCoupon]);

  // Stale preview data from before the code was cleared (or the plan/
  // currency changed away from what it was computed for) must never be
  // shown as if it still applied — RTK Query's lazy hook keeps the last
  // result around until a new call actually resolves, so this is checked
  // explicitly rather than trusted to reset itself.
  const activeDiscount = coupon.trim() && preview?.valid
    ? preview
    : null;

  // A remembered code that doesn't apply (their own, not new any more,
  // switched off, not for this plan) is forgotten on this device, but
  // stays in the field with the reason under it: emptying the field made a
  // campaign's code look like it had vanished.
  const savedCode = fromSaved ? savedRef() : "";
  useEffect(() => {
    if (savedCode && coupon === savedCode && previewError) clearRef();
  }, [savedCode, coupon, previewError]);

  if (isLoading || !batch) {
    return (
      <PaymentShell title="Subscribe" onClose={() => navigate("/purchases")}>
        <Skeleton variant="rounded" height={120} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={80} sx={{ mb: 1.5 }} />
        <Skeleton variant="rounded" height={80} />
      </PaymentShell>
    );
  }

  const active = currency || batch.defaultCurrency;
  const plans = batch.plans.filter((p) => p.pricesByCurrency?.[active] !== undefined);
  const methods = batch.gatewaysByCurrency?.[active] || [];
  const isFreeBatch = batch.accessType === "free";

  const buy = async (planLabel) => {
    try {
      const result = await startCheckout({
        batchId,
        planLabel,
        couponCode: coupon || undefined,
        viaShortLink: (via && coupon.trim().toUpperCase() === initialRef) ? via : undefined,
        currency: currency || undefined,
        provider: gateway || undefined,
      }).unwrap();

      if (result.free) {
        if (coupon) clearRef();
        navigate("/purchases", { replace: true });
        return;
      }
      window.location.href = result.url;
    } catch {
      // rendered below
    }
  };

  const linkAlert = coupon && (linkCode || (fromSaved && coupon === savedCode)) && (
    <Alert severity="success" icon={<Tag size={16} />} sx={{ mb: 2 }}>
      {searchParams.get("coupon") ? "Code" : "Referral code"} <strong>{coupon}</strong> applied — pick a plan below to see your discount.
    </Alert>
  );

  const choices = (
    <CurrencyAndGateway
      batch={batch}
      currency={active}
      onCurrency={(next) => { setCurrency(next); setGateway(null); setSelectedPlan(null); }}
      gateway={gateway}
      onGateway={setGateway}
    />
  );

  const errorAlert = checkoutError && (
    <Alert severity="error" sx={{ mb: 2 }}>{checkoutError.data?.message || "Could not start checkout."}</Alert>
  );

  const empty = plans.length === 0 && !batch.trialAvailable && (
    <EmptyState
      bordered
      icon={Tag}
      tone="blocked"
      title="No plans on sale"
      description={`This ${terms.batch} has no pricing published right now. Your ${terms.org} can open enrolment at any time.`}
      secondaryAction={{ label: "Back to plans", onClick: () => navigate("/purchases") }}
    />
  );

  const couponField = !isFreeBatch && plans.length > 0 && (
    <Box>
      <TextField
        label="Coupon code (optional)"
        size="small"
        fullWidth
        value={coupon}
        onChange={(e) => setCoupon(e.target.value.toUpperCase())}
        disabled={!selectedPlan}
        helperText={!selectedPlan ? "Pick a plan above first" : " "}
      />
      {/* A quiet status line under the field, not a full Alert — a
          coupon is a small, low-stakes thing to get right or wrong,
          and the real feedback is the price itself changing on the
          card above. This just confirms why. */}
      {coupon.trim() && selectedPlan && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5, minHeight: 20 }}>
          {previewLoading ? (
            <Typography variant="caption" color="text.secondary">Checking…</Typography>
          ) : activeDiscount ? (
            <>
              <BadgeCheck size={13} color={theme.palette.success.main} />
              <Typography variant="caption" sx={{ color: "success.main" }}>
                Coupon applied — you save {(activeDiscount.discountAmount).toFixed(2)} {activeDiscount.currency}
              </Typography>
            </>
          ) : previewError ? (
            <>
              <X size={13} color={theme.palette.error.main} />
              <Typography variant="caption" color="error">
                {previewError.data?.message || "That coupon isn't valid for this plan."}
              </Typography>
            </>
          ) : null}
        </Box>
      )}
    </Box>
  );

  const trialButton = !isFreeBatch && batch.trialAvailable && (
    <Button
      variant="outlined"
      fullWidth
      startIcon={<Check size={16} />}
      disabled={startingTrial}
      onClick={async () => {
        const r = await startTrial(batchId);
        navigate("/", { replace: true });
        if (!r.error) mascotReact("cheer", "Enjoy your free trial!");
      }}
    >
      {startingTrial ? "Starting trial" : "Start a free trial instead"}
    </Button>
  );

  // The mascot's word on this page, once per browser session.
  // Here it sells the plan, never the trial.
  const pitch = !isFreeBatch && plans.length > 0 && (
    <MascotOnce mood="act" move="thumbs" say="Invest in yourself. You've got this!" once={`plan:${batchId}`} delay={1200} />
  );

  const secureLine = methods.length > 0 && plans.length > 0
    ? `Payments handled securely by ${methods.map((m) => m.label).join(" or ")}`
    : null;

  // The other two looks share every piece above, so a coupon, a referral
  // link or a currency switch behaves the same whichever one is on.
  if (planStyle === "columns" || planStyle === "aurora") {
    const Look = planStyle === "columns" ? PlanColumns : PlanAurora;
    return (
      <Look
        batch={batch}
        plans={plans}
        currency={active}
        methods={methods}
        isFree={isFreeBatch}
        selectedPlan={selectedPlan}
        onSelect={(label) => setSelectedPlan(selectedPlan === label ? null : label)}
        discount={activeDiscount}
        busy={checkingOut}
        onBuy={buy}
        onClose={() => navigate("/purchases")}
        top={<>{pitch}{linkAlert}{errorAlert}</>}
        choices={choices}
        empty={empty}
        couponField={couponField}
        trialButton={trialButton}
        secureLine={secureLine}
      />
    );
  }

  return (
    <PaymentShell title="Subscribe" onClose={() => navigate("/purchases")}>
      {pitch}
      {linkAlert}

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        You are subscribing to
      </Typography>

      <BatchSpine
        icon={batch.icon}
        name={batch.name}
        rows={[
          methods.length > 0 && {
            icon: <CreditCard size={16} style={{ opacity: 0.6 }} />,
            label: methods.map((m) => m.label).join(", "),
          },
        ]}
      />

      {choices}

      {errorAlert}

      {empty}

      {plans.length > 0 && <SectionRule>Choose a plan</SectionRule>}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {plans.map((plan) => (
          <PlanCard
            key={plan.label}
            plan={plan}
            currency={active}
            selected={selectedPlan === plan.label}
            busy={checkingOut}
            isFree={isFreeBatch}
            discount={selectedPlan === plan.label ? activeDiscount : null}
            onSelect={() => setSelectedPlan(selectedPlan === plan.label ? null : plan.label)}
            onBuy={() => buy(plan.label)}
          />
        ))}
      </Box>

      {couponField && <Box sx={{ mt: 3 }}>{couponField}</Box>}

      {trialButton && <Box sx={{ mt: 2 }}>{trialButton}</Box>}

      {secureLine && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", textAlign: "center", mt: 3 }}
        >
          {secureLine}
        </Typography>
      )}
    </PaymentShell>
  );
}

// Tap to select, and the pay action appears inside the card behind a divider
// — the sample's central interaction. Keeping the action inside the selected
// card is what stops a long plan list becoming a wall of identical buttons.
function PlanCard({ plan, currency, selected, busy, isFree, discount, onSelect, onBuy }) {
  const price = plan.pricesByCurrency?.[currency] ?? plan.price;
  const payAmount = discount ? discount.amountPaid : price;

  return (
    <Paper
      variant="outlined"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // A div that behaves like a button has to answer the keyboard like
        // one, or the whole plan list is unreachable without a mouse.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      sx={{
        cursor: "pointer",
        borderRadius: 2,
        overflow: "hidden",
        transition: "border-color 120ms, background-color 120ms",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "action.hover" : "transparent",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2, p: 2 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {plan.label}
          </Typography>

          {/* The strikethrough-to-reduced-price reveal — keyed on the
              discount amount so a different coupon (or the same one
              re-typed) replays the animation instead of sitting static
              once already shown once. */}
          {discount ? (
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 0.25 }}>
              <Typography
                sx={{
                  fontSize: 14, color: "text.secondary", opacity: 0.6,
                  textDecoration: "line-through", textDecorationThickness: "1.5px",
                }}
              >
                {price} {currency}
              </Typography>
              <Typography
                key={`${discount.amountPaid}-${discount.currency}`}
                sx={{
                  fontSize: 19, fontWeight: 700, color: "success.main",
                  animation: "planPriceReveal 380ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                  "@keyframes planPriceReveal": {
                    "0%": { opacity: 0, transform: "translateY(3px) scale(0.85)" },
                    "60%": { opacity: 1, transform: "translateY(-1px) scale(1.05)" },
                    "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
                  },
                }}
              >
                {discount.amountPaid} {discount.currency}
              </Typography>
            </Box>
          ) : (
            <Typography sx={{ fontSize: 18, mt: 0.25 }}>
              {isFree ? "Free" : `${price} ${currency}`}
            </Typography>
          )}

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.75, color: "text.secondary" }}>
            {plan.isInfinite ? <InfinityIcon size={13} /> : <Clock size={13} />}
            <Typography variant="caption">
              {plan.isInfinite ? "Lifetime access" : `${plan.durationDays} days of access`}
            </Typography>
          </Box>
        </Box>

        {selected && (
          <Box
            sx={{
              width: 22, height: 22, flexShrink: 0, mt: 0.5,
              borderRadius: "50%",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <Check size={13} strokeWidth={3} />
          </Box>
        )}
      </Box>

      {selected && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Divider sx={{ mb: 1.5 }} />
          <Button
            variant="contained"
            fullWidth
            disabled={busy}
            startIcon={isFree ? <Check size={15} /> : <CreditCard size={15} />}
            onClick={(e) => {
              // The card itself is clickable, so without this the pay click
              // also toggles the selection back off on its way up.
              e.stopPropagation();
              onBuy();
            }}
          >
            {busy ? "Starting checkout" : isFree ? "Get access" : `Pay ${payAmount} ${discount?.currency || currency}`}
          </Button>
        </Box>
      )}
    </Paper>
  );
}

// Only rendered when there is an actual choice to make. A batch sold in one
// currency through one gateway shows nothing here — an institution running
// the common single-market setup should never see a control it can only
// answer one way.
function CurrencyAndGateway({ batch, currency, onCurrency, gateway, onGateway }) {
  const currencies = Object.keys(batch.gatewaysByCurrency || {});
  const gateways = batch.gatewaysByCurrency?.[currency] || [];

  const showCurrency = currencies.length > 1;
  const showGateway = gateways.length > 1;

  if (!showCurrency && !showGateway) return null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mb: 1 }}>
      {showCurrency && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Pay in
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {currencies.map((code) => (
              <Chip
                key={code}
                label={code}
                size="small"
                onClick={() => onCurrency(code)}
                variant={code === currency ? "filled" : "outlined"}
                color={code === currency ? "primary" : "default"}
              />
            ))}
          </Box>
        </Box>
      )}

      {showGateway && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Pay with
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {gateways.map((g) => (
              <Chip
                key={g.provider}
                label={g.label}
                size="small"
                onClick={() => onGateway(g.provider === gateway ? null : g.provider)}
                variant={g.provider === gateway ? "filled" : "outlined"}
                color={g.provider === gateway ? "primary" : "default"}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
