import { Box, Typography, Divider, Chip, Button, Skeleton } from "@mui/material";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Printer, Store, ShieldCheck } from "lucide-react";
import { useGetPurchaseQuery } from "../../api/contentApi";
import { PaymentShell, Notice } from "../../components/PaymentShell";
import EmptyState from "../../components/EmptyState";
import { useBranding } from "../../BrandingContext";

// Escapes Shell's chrome the same way CheckoutSuccess/Cancelled do — a
// receipt is a document, not a screen with navigation, and the bottom nav
// bar has no reason to survive into a print/PDF of it (see the @media print
// rule below, which hides everything PaymentShell doesn't draw).
//
// Its own dedicated GET /purchases/:id rather than re-reading getMyPurchases'
// cache and finding the one row by id, the way this used to work — that
// broke the moment getMyPurchases became paginated (see studentController
// .getMyPurchases), since an old purchase past the first page's worth would
// silently not be in that cache at all, receipt or no receipt.
export default function Receipt() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Straight after paying, "back" is the payment gateway's page — close
  // goes to Plans instead. Opened from inside the app, it goes back there.
  const close = () => {
    if (location.state?.fromCheckout || !(window.history.state?.idx > 0)) navigate("/purchases", { replace: true });
    else navigate(-1);
  };
  const { data, isLoading } = useGetPurchaseQuery(id);
  const { siteName, logo, receiptInfo = {} } = useBranding() || {};

  const purchase = data?.purchase;

  const row = (label, value, opts = {}) =>
    value !== null && value !== undefined && value !== "" && (
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.75 }}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: opts.bold ? 600 : 400, textAlign: "right" }}>
          {value}
        </Typography>
      </Box>
    );

  if (isLoading) {
    return (
      <PaymentShell title="Receipt" onClose={close}>
        <Skeleton variant="rounded" height={280} />
      </PaymentShell>
    );
  }

  if (!purchase) {
    return (
      <PaymentShell title="Receipt" onClose={() => navigate("/purchases")}>
        <EmptyState
          bordered
          icon={Store}
          title="Receipt not found"
          description="This purchase isn't in your history — it may belong to a different account."
        />
      </PaymentShell>
    );
  }

  const money = (n) => `${purchase.currency} ${Number(n ?? 0).toFixed(2)}`;
  const statusTone = purchase.status === "complete" ? "success" : purchase.status === "pending" ? "warning" : "default";
  const itemLabel = purchase.kind === "ai-credits"
    ? `${purchase.credits ?? ""} AI credits`.trim()
    : purchase.plan?.label;
  const itemName = purchase.batch?.name || (purchase.kind === "ai-credits" ? "General AI credits" : "Plan");

  return (
    <PaymentShell title="Receipt" onClose={close}>
      {/* print:only styles — the app chrome (top bar buttons, bottom nav,
          everything PaymentShell itself doesn't render) is already absent on
          this route, so this only needs to drop the close button and shrink
          margins for a clean single page. */}
      <style>{`
        @media print {
          .receipt-no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <Box id="receipt-print-area">
        {/* Business identity, not the platform's app-chrome branding — pulled
            from Settings > Receipt details, all optional. Falls back to
            siteName so a receipt still names someone even before an admin
            fills the rest in. */}
        <Box sx={{ textAlign: "center", mb: 2.5, pb: 2.5, borderBottom: 1, borderColor: "divider" }}>
          {logo && (
            <Box component="img" src={logo} alt="" sx={{ height: 32, mb: 1, mx: "auto", display: "block" }} />
          )}
          <Typography sx={{ fontSize: 16, fontWeight: 600 }}>
            {receiptInfo.legalName || siteName}
          </Typography>
          {receiptInfo.address && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
              {receiptInfo.address}
            </Typography>
          )}
          {(receiptInfo.supportEmail || receiptInfo.supportPhone) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {[receiptInfo.supportEmail, receiptInfo.supportPhone].filter(Boolean).join(" · ")}
            </Typography>
          )}
          {receiptInfo.taxId && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Tax/Reg. ID: {receiptInfo.taxId}
            </Typography>
          )}
        </Box>

        <Box sx={{ textAlign: "center", mb: 2.5 }}>
          {purchase.invoice?.number && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              Tax invoice {purchase.invoice.number} · {new Date(purchase.invoice.issuedAt).toLocaleDateString()}
              {purchase.invoice.creditNote && <><br />Credit note {purchase.invoice.creditNote}</>}
            </Typography>
          )}
          {purchase.invoice?.buyer?.name && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Billed to {[purchase.invoice.buyer.name, purchase.invoice.buyer.contact, purchase.invoice.buyer.taxId && `Tax no. ${purchase.invoice.buyer.taxId}`, purchase.invoice.buyer.state].filter(Boolean).join(" · ")}
              {purchase.invoice.sellerState && <><br />Supplied from {purchase.invoice.sellerState}</>}
            </Typography>
          )}
          <Typography sx={{ fontSize: 20, fontWeight: 600 }}>{itemName}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{itemLabel}</Typography>
          <Chip
            size="small"
            label={purchase.status}
            color={statusTone}
            sx={{ mt: 1.5, textTransform: "capitalize" }}
          />
        </Box>

        {purchase.status === "complete" && (
          <Notice icon={<ShieldCheck size={17} />} tone="success" sx={{ mb: 2.5 }}>
            Payment received
          </Notice>
        )}

        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2, mb: 2.5 }}>
          {row("List price", money(purchase.plan?.price))}
          {purchase.discountAmount > 0 && row(
            "Discount" + (purchase.couponCode ? ` (${purchase.couponCode})` : ""),
            `− ${money(purchase.discountAmount)}`
          )}
          <Divider sx={{ my: 0.75 }} />
          {purchase.invoice?.number && row("Before tax", money(purchase.invoice.net))}
          {purchase.invoice?.number && (purchase.invoice.parts?.length
            ? purchase.invoice.parts.map((p) => <Box key={p.label}>{row(`${p.label} (${p.rate}%, included)`, money(p.amount))}</Box>)
            : row(`${purchase.invoice.label} (${purchase.invoice.rate}%, included)`, money(purchase.invoice.tax)))}
          {row("Amount paid", money(purchase.amountPaid), { bold: true })}
        </Box>

        <Box sx={{ mb: 1 }}>
          {row("Payment method", purchase.provider === "manual" ? "Recorded manually" : capitalise(purchase.provider))}
          {row("Transaction ID", purchase.transactionId || purchase.providerRef || "—")}
          {row("Date", new Date(purchase.createdAt).toLocaleString())}
          {purchase.kind !== "ai-credits" && row(
            "Access",
            purchase.plan?.isInfinite
              ? "Lifetime"
              : purchase.endDate
                ? `Until ${new Date(purchase.endDate).toLocaleDateString()}`
                : "—"
          )}
        </Box>

        <Box className="receipt-no-print" sx={{ display: "flex", gap: 1, mt: 3 }}>
          <Button
            variant="outlined"
            fullWidth
            startIcon={<Printer size={16} />}
            onClick={() => window.print()}
          >
            Print / Save as PDF
          </Button>
        </Box>
      </Box>
    </PaymentShell>
  );
}

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
