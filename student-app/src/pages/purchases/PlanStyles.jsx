import { Box, Typography, Paper, Button, Divider, IconButton } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { Check, CreditCard, Clock, Infinity as InfinityIcon, X, Lock, ShieldCheck, Sparkles } from "lucide-react";
import BatchIcon from "../../components/BatchIcon";
import { PaymentShell } from "../../components/PaymentShell";

// The two other looks of the plan page (Settings → Appearance → Plan page).
// PlanPicker keeps all the state and builds the shared pieces (coupon field,
// trial button, currency and gateway choice); these only lay them out.
// Both size themselves on their own width, not the window's, through
// container queries: the app layout keeps pages in a phone-wide column even
// on a laptop, and the web layout gives them the whole screen.

const priceOf = (plan, currency) => plan.pricesByCurrency?.[currency] ?? plan.price;
const money = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(2));

// What a month costs on a timed plan, for comparing plans of different
// lengths. Lifetime and free plans have none.
function perMonth(plan, price) {
  if (plan.isInfinite || !plan.durationDays || plan.durationDays <= 31 || !price) return null;
  const m = (price / plan.durationDays) * 30;
  return m >= 100 ? Math.round(m) : Math.round(m * 100) / 100;
}

// The timed plan with the lowest daily cost, and how much each plan saves
// against the dearest per day. Only when there are two or more to compare.
function valueOf(plans, currency) {
  const timed = plans
    .map((p) => ({ label: p.label, perDay: !p.isInfinite && p.durationDays && priceOf(p, currency) > 0 ? priceOf(p, currency) / p.durationDays : null }))
    .filter((p) => p.perDay);
  if (timed.length < 2) return { best: null, save: {} };
  const max = Math.max(...timed.map((p) => p.perDay));
  const min = Math.min(...timed.map((p) => p.perDay));
  if (max === min) return { best: null, save: {} };
  const save = {};
  for (const p of timed) {
    const pct = Math.round((1 - p.perDay / max) * 100);
    if (pct >= 5) save[p.label] = pct;
  }
  return { best: timed.find((p) => p.perDay === min).label, save };
}

const accessText = (plan) => (plan.isInfinite ? "Lifetime access" : `${plan.durationDays} days of access`);

function payText({ isFree, busy, discount, price, currency }) {
  if (busy) return "Starting checkout";
  if (isFree) return "Get access";
  return `Pay ${discount ? discount.amountPaid : price} ${discount?.currency || currency}`;
}

const reveal = {
  animation: "planStyleReveal 380ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  "@keyframes planStyleReveal": {
    "0%": { opacity: 0, transform: "translateY(3px) scale(0.85)" },
    "60%": { opacity: 1, transform: "translateY(-1px) scale(1.05)" },
    "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
  },
};

// The price, or the old price struck through and the coupon price beside it.
function Price({ price, currency, discount, isFree, size }) {
  if (isFree) return <Typography sx={{ fontSize: size, fontWeight: 700, lineHeight: 1.1 }}>Free</Typography>;
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 1 }}>
      {discount && (
        <Typography sx={{ fontSize: size * 0.45, color: "text.secondary", textDecoration: "line-through", opacity: 0.7 }}>
          {price} {currency}
        </Typography>
      )}
      <Typography
        key={discount ? `${discount.amountPaid}-${discount.currency}` : "full"}
        component="span"
        sx={{
          fontSize: size, fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.02em",
          color: discount ? "success.main" : "text.primary",
          ...(discount ? reveal : {}),
        }}
      >
        {discount ? discount.amountPaid : price}
        <Box component="span" sx={{ fontSize: size * 0.42, fontWeight: 500, ml: 0.75, color: "text.secondary" }}>
          {discount?.currency || currency}
        </Box>
      </Typography>
    </Box>
  );
}

// Activates on Enter and Space too, like a real button.
const pressable = (onPress) => ({
  role: "button",
  tabIndex: 0,
  onClick: onPress,
  onKeyDown: (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPress();
    }
  },
});

// ---------------------------------------------------------------------------
// Columns: a pricing table. Plans side by side on a wide screen, two up on a
// tablet, stacked on a phone; the best value plan is raised and marked.
// ---------------------------------------------------------------------------
export function PlanColumns({
  batch, plans, currency, methods, isFree, selectedPlan, onSelect, discount, busy, onBuy, onClose,
  top, choices, empty, couponField, trialButton, secureLine,
}) {
  const theme = useTheme();
  const { best, save } = valueOf(plans, currency);
  const cols = Math.min(plans.length, 4);

  return (
    <PaymentShell title="Choose a plan" onClose={onClose} maxWidth={1100}>
      <Box sx={{ containerType: "inline-size" }}>
        {top}

        <Box sx={{ textAlign: "center", mb: 3 }}>
          <Box sx={{ display: "inline-flex", mb: 1.25 }}><BatchIcon icon={batch.icon} size={44} /></Box>
          <Typography sx={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em" }}>{batch.name}</Typography>
          {methods.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Pay with {methods.map((m) => m.label).join(", ")}
            </Typography>
          )}
        </Box>

        <Box sx={{ maxWidth: 520, mx: "auto" }}>{choices}</Box>
        {empty}

        <Box
          sx={{
            display: "grid",
            gap: 2,
            mt: 2,
            mx: "auto",
            gridTemplateColumns: "1fr",
            maxWidth: cols === 1 ? 380 : "none",
            alignItems: "stretch",
            "@container (min-width: 560px)": { gridTemplateColumns: cols === 1 ? "1fr" : "repeat(2, 1fr)" },
            "@container (min-width: 880px)": { gridTemplateColumns: `repeat(${cols}, 1fr)` },
          }}
        >
          {plans.map((plan) => {
            const price = priceOf(plan, currency);
            const selected = selectedPlan === plan.label;
            const isBest = best === plan.label;
            const month = perMonth(plan, price);
            const planDiscount = selected ? discount : null;
            return (
              <Paper
                key={plan.label}
                variant="outlined"
                {...pressable(() => onSelect(plan.label))}
                sx={{
                  position: "relative",
                  overflow: "hidden",
                  cursor: "pointer",
                  borderRadius: 3,
                  p: 2.5,
                  pt: isBest ? 3.5 : 2.5,
                  display: "flex",
                  flexDirection: "column",
                  borderWidth: selected || isBest ? 2 : 1,
                  borderColor: selected ? "primary.main" : isBest ? alpha(theme.palette.primary.main, 0.45) : "divider",
                  bgcolor: selected ? alpha(theme.palette.primary.main, 0.06) : "background.paper",
                  boxShadow: selected ? `0 12px 32px -16px ${alpha(theme.palette.primary.main, 0.6)}` : "none",
                  transition: "border-color 150ms, background-color 150ms, box-shadow 150ms, transform 150ms",
                  "&:hover": { transform: "translateY(-2px)" },
                  "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
                  "@media (prefers-reduced-motion: reduce)": { "&:hover": { transform: "none" } },
                }}
              >
                {isBest && (
                  <Box
                    sx={{
                      position: "absolute", top: 0, left: 0, right: 0,
                      py: 0.5, textAlign: "center",
                      bgcolor: "primary.main", color: "primary.contrastText",
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                    }}
                  >
                    Best value
                  </Box>
                )}

                <Typography sx={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "text.secondary" }}>
                  {plan.label}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Price price={price} currency={currency} discount={planDiscount} isFree={isFree} size={32} />
                </Box>
                {!isFree && month && (
                  <Typography variant="caption" color="text.secondary">
                    about {money(month)} {currency} a month
                  </Typography>
                )}

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {plan.isInfinite ? <InfinityIcon size={15} /> : <Clock size={15} />}
                    <Typography variant="body2">{accessText(plan)}</Typography>
                  </Box>
                  {!isFree && save[plan.label] && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "success.main" }}>
                      <Check size={15} />
                      <Typography variant="body2">Save {save[plan.label]}%</Typography>
                    </Box>
                  )}
                </Box>

                <Button
                  variant={selected ? "contained" : "outlined"}
                  fullWidth
                  disabled={selected && busy}
                  startIcon={selected ? (isFree ? <Check size={15} /> : <CreditCard size={15} />) : null}
                  sx={{ mt: "auto" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selected) onBuy(plan.label);
                    else onSelect(plan.label);
                  }}
                >
                  {selected ? payText({ isFree, busy, discount: planDiscount, price, currency }) : "Choose"}
                </Button>
              </Paper>
            );
          })}
        </Box>

        <Box sx={{ maxWidth: 420, mx: "auto", mt: 3, display: "flex", flexDirection: "column", gap: 2 }}>
          {couponField}
          {trialButton}
          {secureLine && (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>{secureLine}</Typography>
          )}
        </Box>
      </Box>
    </PaymentShell>
  );
}

// ---------------------------------------------------------------------------
// Aurora: a full-screen checkout. Slow light in the theme's own colour behind
// frosted glass cards; plans on the left and a summary that stays in view on
// the right on a wide screen, one column on a phone.
// ---------------------------------------------------------------------------
export function PlanAurora({
  batch, plans, currency, methods, isFree, selectedPlan, onSelect, discount, busy, onBuy, onClose,
  top, choices, empty, couponField, trialButton, secureLine,
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const p = theme.palette.primary;
  const { best, save } = valueOf(plans, currency);
  const chosen = plans.find((pl) => pl.label === selectedPlan) || null;
  const chosenPrice = chosen ? priceOf(chosen, currency) : null;

  const glass = {
    bgcolor: alpha(theme.palette.background.paper, dark ? 0.42 : 0.62),
    backdropFilter: "blur(18px) saturate(140%)",
    WebkitBackdropFilter: "blur(18px) saturate(140%)",
    border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.1 : 0.08)}`,
  };
  const ring = `linear-gradient(${theme.palette.background.paper}, ${theme.palette.background.paper}) padding-box, linear-gradient(135deg, ${p.light}, ${p.main} 45%, ${p.dark}) border-box`;
  const calm = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } };

  const blob = (color, size, at, delay) => ({
    position: "absolute",
    width: size,
    height: size,
    borderRadius: "50%",
    background: `radial-gradient(circle, ${alpha(color, dark ? 0.55 : 0.38)}, transparent 65%)`,
    filter: "blur(40px)",
    ...at,
    animation: `auroraDrift 22s ease-in-out ${delay}s infinite alternate`,
    "@keyframes auroraDrift": {
      "0%": { transform: "translate(0, 0) scale(1)" },
      "50%": { transform: "translate(6%, 8%) scale(1.15)" },
      "100%": { transform: "translate(-6%, 3%) scale(0.95)" },
    },
    ...calm,
  });

  return (
    <Box sx={{ position: "relative", minHeight: "100dvh", overflow: "hidden", bgcolor: "background.default", containerType: "inline-size" }}>
      <Box aria-hidden sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <Box sx={blob(p.main, "70%", { top: "-25%", left: "-20%" }, 0)} />
        <Box sx={blob(p.light, "60%", { top: "5%", right: "-25%" }, -7)} />
        <Box sx={blob(p.dark, "55%", { bottom: "-20%", left: "20%" }, -14)} />
        <Box
          sx={{
            position: "absolute", inset: 0,
            backgroundImage: `linear-gradient(${alpha(theme.palette.text.primary, 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.palette.text.primary, 0.05)} 1px, transparent 1px)`,
            backgroundSize: "36px 36px",
            maskImage: "radial-gradient(ellipse at 50% 0%, black 20%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(ellipse at 50% 0%, black 20%, transparent 70%)",
          }}
        />
      </Box>

      <Box sx={{ position: "relative", maxWidth: 1080, mx: "auto", px: 2, pt: 2, pb: 5, "@container (min-width: 760px)": { px: 4, pt: 3 } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 4 }}>
          <IconButton onClick={onClose} aria-label="Close checkout" sx={{ ...glass, width: 40, height: 40 }}>
            <X size={18} />
          </IconButton>
          <Box sx={{ ...glass, display: "flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.75, borderRadius: 99 }}>
            <Lock size={13} />
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>Secure checkout</Typography>
          </Box>
        </Box>

        <Box sx={{ mb: 4, maxWidth: 720 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.5 }}>
            <BatchIcon icon={batch.icon} size={32} />
            <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "primary.main" }}>
              Enrol in
            </Typography>
          </Box>
          <Typography
            component="h1"
            sx={{
              fontSize: "clamp(30px, 7cqi, 56px)",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              background: `linear-gradient(120deg, ${theme.palette.text.primary} 30%, ${p.main})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              wordBreak: "break-word",
            }}
          >
            {batch.name}
          </Typography>
          {methods.length > 0 && (
            <Typography color="text.secondary" sx={{ mt: 1.5, fontSize: 14 }}>
              Pay with {methods.map((m) => m.label).join(", ")}
            </Typography>
          )}
        </Box>

        {top}
        {choices && <Box sx={{ ...glass, borderRadius: 4, p: 2, mb: 2, "&:empty": { display: "none" } }}>{choices}</Box>}
        {empty}

        <Box
          sx={{
            display: "grid",
            gap: 2.5,
            gridTemplateColumns: "1fr",
            "@container (min-width: 760px)": { gridTemplateColumns: "1.3fr 1fr", alignItems: "start", gap: 3 },
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {plans.map((plan, i) => {
              const price = priceOf(plan, currency);
              const selected = selectedPlan === plan.label;
              const month = perMonth(plan, price);
              return (
                <Box
                  key={plan.label}
                  {...pressable(() => onSelect(plan.label))}
                  aria-pressed={selected}
                  sx={{
                    ...glass,
                    ...(selected ? { border: "1.5px solid transparent", background: ring } : {}),
                    position: "relative",
                    cursor: "pointer",
                    borderRadius: "22px",
                    p: 2.25,
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    boxShadow: selected ? `0 18px 44px -18px ${alpha(p.main, 0.7)}` : "none",
                    transition: "box-shadow 200ms, transform 200ms",
                    animation: `auroraUp 520ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 70}ms both`,
                    "@keyframes auroraUp": {
                      "0%": { opacity: 0, transform: "translateY(14px)" },
                      "100%": { opacity: 1, transform: "translateY(0)" },
                    },
                    "&:hover": { transform: "translateY(-2px)" },
                    "&:focus-visible": { outline: `2px solid ${p.main}`, outlineOffset: 3 },
                    ...calm,
                    "@media (prefers-reduced-motion: reduce)": { animation: "none", "&:hover": { transform: "none" } },
                  }}
                >
                  <Box
                    sx={{
                      width: 22, height: 22, flexShrink: 0, borderRadius: "50%",
                      border: `2px solid ${selected ? p.main : alpha(theme.palette.text.primary, 0.25)}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      bgcolor: selected ? "primary.main" : "transparent",
                      color: "primary.contrastText",
                      transition: "all 150ms",
                    }}
                  >
                    {selected && <Check size={13} strokeWidth={3} />}
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 16 }}>{plan.label}</Typography>
                      {best === plan.label && (
                        <Box
                          sx={{
                            display: "inline-flex", alignItems: "center", gap: 0.5,
                            px: 1, py: 0.25, borderRadius: 99,
                            fontSize: 11, fontWeight: 700,
                            color: "primary.contrastText",
                            background: `linear-gradient(135deg, ${p.light}, ${p.dark})`,
                          }}
                        >
                          <Sparkles size={11} /> Best value
                        </Box>
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}>
                      {plan.isInfinite ? <InfinityIcon size={12} /> : <Clock size={12} />}
                      {accessText(plan)}
                      {!isFree && save[plan.label] ? ` · save ${save[plan.label]}%` : ""}
                    </Typography>
                  </Box>

                  <Box sx={{ textAlign: "right", flexShrink: 0 }}>
                    <Typography sx={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                      {isFree ? "Free" : money(price)}
                    </Typography>
                    {!isFree && (
                      <Typography variant="caption" color="text.secondary">
                        {month ? `${money(month)}/mo` : currency}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>

          <Box
            sx={{
              ...glass,
              borderRadius: "26px",
              p: 2.75,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              "@container (min-width: 760px)": { position: "sticky", top: 24 },
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "text.secondary" }}>
              Your plan
            </Typography>

            {chosen ? (
              <Box>
                <Typography sx={{ fontWeight: 600, mb: 0.5 }}>{chosen.label}</Typography>
                <Price price={chosenPrice} currency={currency} discount={discount} isFree={isFree} size={40} />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{accessText(chosen)}</Typography>
              </Box>
            ) : (
              <Typography color="text.secondary" sx={{ fontSize: 15 }}>Pick a plan to see your total.</Typography>
            )}

            {couponField}

            <Button
              fullWidth
              disabled={!chosen || busy}
              onClick={() => chosen && onBuy(chosen.label)}
              startIcon={chosen ? (isFree ? <Check size={16} /> : <CreditCard size={16} />) : null}
              sx={{
                position: "relative",
                overflow: "hidden",
                height: 52,
                borderRadius: "16px",
                fontWeight: 700,
                fontSize: 15,
                color: "primary.contrastText",
                background: `linear-gradient(135deg, ${p.dark}, ${p.main} 50%, ${p.light})`,
                boxShadow: `0 14px 30px -12px ${alpha(p.main, 0.8)}`,
                "&:hover": { background: `linear-gradient(135deg, ${p.dark}, ${p.main} 50%, ${p.light})`, filter: "brightness(1.07)" },
                "&.Mui-disabled": { color: alpha(theme.palette.text.primary, 0.4), background: alpha(theme.palette.text.primary, 0.08), boxShadow: "none" },
                "&::after": chosen && !busy ? {
                  content: '""',
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                  transform: "translateX(-100%)",
                  animation: "auroraShine 2.8s ease-in-out infinite",
                  "@keyframes auroraShine": { "0%": { transform: "translateX(-100%)" }, "60%, 100%": { transform: "translateX(100%)" } },
                  ...calm,
                } : {},
              }}
            >
              {chosen ? payText({ isFree, busy, discount, price: chosenPrice, currency }) : "Choose a plan"}
            </Button>

            {trialButton}

            {secureLine && (
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75, color: "text.secondary" }}>
                <ShieldCheck size={14} />
                <Typography variant="caption">{secureLine}</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
