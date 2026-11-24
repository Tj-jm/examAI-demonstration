import { useState } from "react";
import { Box, TextField, Button, Typography, Alert, Link as MuiLink, ToggleButtonGroup, ToggleButton, FormControlLabel, Checkbox } from "@mui/material";
import { CheckCircle2 } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import {
  useRegisterMutation, useVerifyOtpMutation, useCompleteProfileMutation,
} from "../../api/authApi";
import { useBranding } from "../../BrandingContext";
import AuthShell from "./AuthShell";
import { rememberNext, takeNext } from "../../utils/nextPath";
import OtpInput from "../../components/OtpInput";
import PasswordField from "../../components/PasswordField";
import PhoneField from "../../components/PhoneField";
import useCountdown from "../../hooks/useCountdown";

const RESEND_SECONDS = 30;

// Three steps because a student typing a wrong number should not be able to
// claim someone else's inbox: request a code, prove you received it, only
// then set a name and password. Each step is its own screen rather than one
// long form, matching how the backend itself gates this (register cannot
// succeed until verify-otp has, which cannot succeed until complete-profile
// is reachable).
export default function Register() {
  const branding = useBranding();
  const navigate = useNavigate();
  rememberNext(window.location.search);
  // Arriving from "No account found — Create an account" on Login or
  // ForgotPassword carries the identifier the visitor already typed, so
  // they don't have to type it a second time.
  const prefill = useLocation().state || {};

  const [channel, setChannel] = useState(prefill.channel || (branding.authIdentifier === "phone" ? "phone" : "email"));
  const [identifier, setIdentifier] = useState(prefill.identifier || "");
  const [step, setStep] = useState("request"); // request | verify | profile
  const [devOtp, setDevOtp] = useState(null);
  const [devSendError, setDevSendError] = useState(null);

  const [register, { isLoading: sending, error: sendError }] = useRegisterMutation();
  const [verifyOtp, { isLoading: verifying, error: verifyError }] = useVerifyOtpMutation();
  const [completeProfile, { isLoading: completing, error: completeError }] = useCompleteProfileMutation();

  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [resendCooldown, restartResendCooldown] = useCountdown(RESEND_SECONDS);

  const [country, setCountry] = useState(prefill.country || branding.phoneCountries[0].code);
  // Asked only when codes can go by WhatsApp. Unticked means SMS.
  const [whatsapp, setWhatsapp] = useState(false);
  const askWhatsapp = channel === "phone" && branding.whatsappCodes;
  const idField = channel === "email" ? { email: identifier } : { phoneNumber: identifier, phoneCountry: country, ...(askWhatsapp ? { whatsapp } : {}) };

  const requestCode = async (e) => {
    e.preventDefault();
    try {
      const result = await register(idField).unwrap();
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
      const result = await register(idField).unwrap();
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
      await verifyOtp({ ...idField, otp }).unwrap();
      setStep("profile");
    } catch {
      // rendered below
    }
  };

  const finish = async (e) => {
    e.preventDefault();
    try {
      await completeProfile({ ...idField, name, password }).unwrap();
      navigate(takeNext(), { replace: true });
    } catch {
      // rendered below
    }
  };

  if (step === "request") {
    return (
      <AuthShell title="Create an account" onBack={() => navigate("/login")}>
        <Box component="form" onSubmit={requestCode} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {sendError && <Alert severity="error">{sendError.data?.message || "Could not send a code."}</Alert>}

          {branding.authIdentifier === "both" && (
            <ToggleButtonGroup value={channel} exclusive onChange={(e, v) => v && setChannel(v)} size="small" fullWidth>
              <ToggleButton value="email">Email</ToggleButton>
              <ToggleButton value="phone">Phone</ToggleButton>
            </ToggleButtonGroup>
          )}

          {channel === "phone" ? (
            <>
              <PhoneField country={country} onCountry={setCountry} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus fullWidth />
              {askWhatsapp && (
                <FormControlLabel
                  control={<Checkbox checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />}
                  label={<Typography variant="body2">Send my code and updates on WhatsApp</Typography>}
                />
              )}
            </>
          ) : (
            <TextField label="Email" type="email" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus fullWidth />
          )}

          <Button type="submit" variant="contained" size="large" disabled={sending || !identifier}>
            {sending ? "Sending code" : "Send code"}
          </Button>

          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center" }}>
            Already have an account? <MuiLink component={Link} to="/login">Log in</MuiLink>
          </Typography>
        </Box>
      </AuthShell>
    );
  }

  if (step === "verify") {
    return (
      <AuthShell title="Enter the code" subtitle={`Sent to ${identifier}`} onBack={() => setStep("request")}>
        <Box component="form" onSubmit={confirmCode} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {verifyError && <Alert severity="error">{verifyError.data?.message || "That code did not work."}</Alert>}
          {devSendError && (
            <Alert severity="warning">
              Sending the real code failed ({devSendError}) — this is a
              server config issue (check SMTP/SMS settings), not something
              wrong with what you typed. Using the code below to keep
              testing, since this isn't production.
            </Alert>
          )}
          {devOtp && (
            <Alert severity="info">
              Development mode — no email/SMS provider is required to test. Your code is <strong>{devOtp}</strong>.
            </Alert>
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

  return (
    <AuthShell title="Almost done" subtitle="Set a name and password to finish.">
      <Box component="form" onSubmit={finish} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {completeError && <Alert severity="error">{completeError.data?.message || "Could not finish signing up."}</Alert>}

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "success.main" }}>
          <CheckCircle2 size={18} />
          <Typography variant="body2" sx={{ color: "text.primary" }}>{identifier}</Typography>
          <Typography variant="caption" sx={{ color: "success.main" }}>Verified</Typography>
        </Box>

        <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus fullWidth />
        <PasswordField
          label="Password"
          helperText="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
        />

        <Button type="submit" variant="contained" size="large" disabled={completing || !name || password.length < 8}>
          {completing ? "Creating account" : "Create account"}
        </Button>
      </Box>
    </AuthShell>
  );
}
