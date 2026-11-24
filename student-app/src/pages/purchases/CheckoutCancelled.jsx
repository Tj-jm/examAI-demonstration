import { Typography, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import { PaymentShell, Notice } from "../../components/PaymentShell";

// Reached two ways: the student backed out at the gateway, or a redirect
// confirmation came back as anything other than paid. Both are worded the
// same on purpose — from the student's side nothing went wrong either way,
// and an error page for "I changed my mind" is alarming for no reason.
export default function CheckoutCancelled() {
  const navigate = useNavigate();

  return (
    <PaymentShell title="Checkout cancelled" onClose={() => navigate("/purchases", { replace: true })}>
      <Notice tone="warning" icon={<CircleAlert size={19} />} sx={{ mb: 3 }}>
        Payment was not completed
      </Notice>

      <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", lineHeight: 1.7 }}>
        Nothing was charged. You can pick a plan again whenever you are ready.
      </Typography>

      <Button
        variant="contained"
        fullWidth
        size="large"
        sx={{ mt: 3 }}
        onClick={() => navigate("/purchases", { replace: true })}
      >
        Back to plans
      </Button>
    </PaymentShell>
  );
}
