import { useEffect, useState } from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, CircleCheck } from "lucide-react";
import { apiSlice } from "../../api/apiSlice";
import { API_ROOT } from "../../api/apiBase";
import { nativeHeaders } from "../../native/session";
import { useDispatch } from "react-redux";
import { PaymentShell, Notice } from "../../components/PaymentShell";
import { clearRef } from "../../utils/referralRef";
import { mascotLater } from "../../components/Mascot";

// The gateway redirects here the instant checkout finishes, but the purchase
// itself is only created once the webhook lands — which can arrive a beat
// after this page does. Polling closes that gap rather than showing
// "success" before access has actually been granted.
export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id");
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [ready, setReady] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [purchaseId, setPurchaseId] = useState(null);

  useEffect(() => {
    if (!sessionId || ready) return;

    const check = async () => {
      const res = await fetch(`${API_ROOT}/api/app/purchases/verify/${sessionId}`, { credentials: "include", headers: nativeHeaders() });
      const data = await res.json();
      if (data.ready) {
        setReady(true);
        mascotLater("great", "Welcome aboard!");
        clearRef(); // a friend's code is for one purchase
        setPurchaseId(data.purchase?._id || null);
        dispatch(apiSlice.util.invalidateTags(["Batch", "Purchase"]));
      } else {
        setAttempts((a) => a + 1);
      }
    };

    if (attempts >= 10) return;
    const timer = setTimeout(check, 1500);
    return () => clearTimeout(timer);
  }, [sessionId, ready, attempts, dispatch]);

  // No close button while confirming. There is nothing useful to close to
  // yet, and an escape hatch mid-confirmation invites leaving at the one
  // moment the answer is about to arrive.
  if (!ready) {
    return (
      <PaymentShell title="Confirming payment">
        <Box sx={{ textAlign: "center", py: 8, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <CircularProgress size={30} sx={{ mb: 2.5 }} />
          <Typography sx={{ fontSize: 15 }}>Confirming your payment</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 300, lineHeight: 1.6 }}>
            This usually takes a few seconds. Keep this page open.
          </Typography>

          {attempts >= 10 && (
            <Notice tone="warning" sx={{ mt: 3 }}>
              This is taking longer than expected. Your payment went through — if access does not
              appear shortly, contact your institution with your payment reference.
            </Notice>
          )}
        </Box>
      </PaymentShell>
    );
  }


  return (
    <PaymentShell title="Subscription complete">
      <Notice tone="success" icon={<CircleCheck size={19} />} sx={{ mb: 3 }}>
        Payment received
      </Notice>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: "center", lineHeight: 1.7 }}>
        Your access is active and everything in the batch is open now.
      </Typography>

      <Button
        variant="contained"
        fullWidth
        size="large"
        startIcon={<Check size={16} />}
        sx={{ mt: 2 }}
        onClick={() => navigate("/", { replace: true })}
      >
        Go to my batches
      </Button>

      <Button
        variant="text"
        fullWidth
        sx={{ mt: 1 }}
        onClick={() => navigate(purchaseId ? `/purchases/receipt/${purchaseId}` : "/purchases", { replace: true, state: { fromCheckout: true } })}
      >
        View receipt
      </Button>
    </PaymentShell>
  );
}
