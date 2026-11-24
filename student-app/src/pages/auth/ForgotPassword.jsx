import { useState } from "react";
import {
  Box, TextField, Button, Typography, Alert, Link as MuiLink,
  ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import {
  useForgotPasswordMutation, useVerifyResetOtpMutation, useResetPasswordMutation,
} from "../../api/authApi";
import { useBranding } from "../../BrandingContext";
import AuthShell from "./AuthShell";
import { rememberNext, takeNext } from "../../utils/nextPath";
import OtpInput from "../../components/OtpInput";
import PasswordField from "../../components/PasswordField";
import PhoneField from "../../components/PhoneField";
import useCountdown from "../../hooks/useCountdown";

const RESEND_SECONDS = 30;

// Same three-step shape as Register — request a code, prove it was
// received, only then act. forgotPassword tells step 1 outright when there's
// no account for that identifier (no code goes out, so nothing is lost by
// saying so) — cheaper and more useful than a vague "if an account exists"
// hedge, and a chance to point a confused visitor at Register instead.
export default function ForgotPassword() {
  const branding = useBranding();
  const navigate = useNavigate();
  rememberNext(window.location.search);

  const [channel, setChannel] = useState(branding.authIdentifier === "phone" ? "phone" : "email");
  const [identifier, setIdentifier] = useState("");
  const [step, setStep] = useState("request"); // request | verify | newPassword
  const [devOtp, setDevOtp] = useState(null);
  const [devSendError, setDevSendError] = useState(null);
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [noAccount, setNoAccount] = useState(false);
  const [resendCooldown, restartResendCooldown] = useCountdown(RESEND_SECONDS);

  const [forgotPassword, { isLoading: sending, error: sendError }] = useForgotPasswordMutation();
  const [verifyResetOtp, { isLoading: verifying, error: verifyError }] = useVerifyResetOtpMutation();
  const [resetPassword, { isLoading: resetting, error: resetError }] = useResetPasswordMutation();

  const [country, setCountry] = useState(branding.phoneCountries[0].code);
  const idField = channel === "email" ? { email: identifier } : { phoneNumber: identifier, phoneCountry: country };

  const requestCode = async (e) => {
    e.preventDefault();
    try {
      const result = await forgotPassword(idField).unwrap();
      if (result.exists === false) {
        setNoAccount(true);
        return;
      }
      setNoAccount(false);
      setDevOtp(result.devOtp || null);
      setDevSendError(result.devSendError || null);
      setStep("verify");
      restartResendCooldown();
    } catch {
      // rendered below
    }
  };

  const resendCode = async () => {
    try {
      const result = await forgotPassword(idField).unwrap();
      setDevOtp(result.devOtp || null);
      setDevSendError(result.devSendError || null);
      setOtp("");
      restartResendCooldown();
    } catch {
      // rendered below
    }
  };

  const confirmCode = async (e) => {
    e.preventDefault();
    try {
      await verifyResetOtp({ ...idField, otp }).unwrap();
      setStep("newPassword");
    } catch {
      // rendered below
    }
  };

  const finish = async (e) => {
    e.preventDefault();
    try {
      await resetPassword({ ...idField, newPassword }).unwrap();
      navigate(takeNext(), { replace: true });
    } catch {
      // rendered below
    }
  };

  if (step === "verify") {
    return (
      <AuthShell title="Enter the code" subtitle={`Sent to ${identifier}`} onBack={() => setStep("request")}>
        <Box component="form" onSubmit={confirmCode} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {verifyError && <Alert severity="error">{verifyError.data?.message || "That code did not work."}</Alert>}
          {devSendError && (
            <Alert severity="warning">
              Sending the real code failed ({devSendError}) — a server
              config issue, not your input. Using the code below to keep
              testing.
            </Alert>
          )}
          {devOtp && (
            <Alert severity="info">Development mode — your code is <strong>{devOtp}</strong>.</Alert>
          )}
          <OtpInput value={otp} onChange={setOtp} autoFocus disabled={verifying} error={Boolean(verifyError)} />
          <Button type="submit" variant="contained" size="large" disabled={verifying || otp.length < 6}>
            {verifying ? "Verifying" : "Verify"}
          </Button>

          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            {resendCooldown > 0 ? (
              <>Resend code in 0:{String(resendCooldown).padStart(2, "0")}</>
            ) : (
              <MuiLink component="button" type="button" onClick={resendCode} disabled={sending}>
                {sending ? "Sending…" : "Resend code"}
              </MuiLink>
            )}
          </Typography>
        </Box>
      </AuthShell>
    );
  }

  if (step === "newPassword") {
    return (
      <AuthShell title="Set a new password">
        <Box component="form" onSubmit={finish} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {resetError && <Alert severity="error">{resetError.data?.message || "Could not reset your password."}</Alert>}
          <PasswordField
            label="New password"
            helperText="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoFocus
            fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={resetting || newPassword.length < 8}>
            {resetting ? "Saving" : "Reset password"}
          </Button>
        </Box>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll send a code to verify it's you" onBack={() => navigate("/login")}>
      <Box component="form" onSubmit={requestCode} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sendError && <Alert severity="error">{sendError.data?.message || "Could not send a code."}</Alert>}
        {noAccount && (
          <Alert severity="info">
            No account found for that {channel === "email" ? "email" : "phone number"}.{" "}
            <MuiLink
              component={Link}
              to="/register"
              state={{ identifier, channel, country }}
              sx={{ fontWeight: 600 }}
            >
              Create an account
            </MuiLink>
          </Alert>
        )}

        {branding.authIdentifier === "both" && (
          <ToggleButtonGroup value={channel} exclusive onChange={(e, v) => v && setChannel(v)} size="small" fullWidth>
            <ToggleButton value="email">Email</ToggleButton>
            <ToggleButton value="phone">Phone</ToggleButton>
          </ToggleButtonGroup>
        )}

        {channel === "phone" ? (
          <PhoneField
            country={country}
            onCountry={setCountry}
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setNoAccount(false); }}
            autoFocus
            fullWidth
          />
        ) : (
          <TextField
            label="Email"
            type="email"
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setNoAccount(false); }}
            autoFocus
            fullWidth
          />
        )}

        <Button type="submit" variant="contained" size="large" disabled={sending || !identifier}>
          {sending ? "Sending code" : "Send code"}
        </Button>

        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
          Remembered it? <MuiLink component={Link} to="/login">Log in</MuiLink>
        </Typography>
      </Box>
    </AuthShell>
  );
}
