import { useState } from "react";
import DemoAccounts from "../../demo/DemoAccounts";
import {
  Box, TextField, Button, Typography, Alert, Link as MuiLink,
  ToggleButtonGroup, ToggleButton,
} from "@mui/material";
import { Link, useNavigate } from "react-router-dom";
import {
  useLoginMutation, useRequestLoginOtpMutation, useLoginWithOtpMutation,
} from "../../api/authApi";
import { useTerms, useBranding } from "../../BrandingContext";
import AuthShell from "./AuthShell";
import { rememberNext, takeNext } from "../../utils/nextPath";
import OtpInput from "../../components/OtpInput";
import PasswordField from "../../components/PasswordField";
import PhoneField from "../../components/PhoneField";
import useCountdown from "../../hooks/useCountdown";

const RESEND_SECONDS = 30;

// Password and one-time-code are two full paths through this one component
// rather than two routes — "mode" picks which, "step" only matters within
// the otp path (request the code, then enter it). branding.authIdentifier
// === "both" needs an explicit channel toggle here the same way Register
// already has one; this used to default to email-only whenever "both" was
// configured, since the old check only ever excluded "phone".
export default function Login() {
  const terms = useTerms();
  const branding = useBranding();
  const navigate = useNavigate();
  rememberNext(window.location.search);

  const [mode, setMode] = useState("password"); // password | otp
  const [step, setStep] = useState("identify"); // identify | verify (otp mode only)
  // Student ID (an institution's own login, Settings → Institution) sits
  // beside email/phone, and is the only way in when neither is offered.
  const byIdOnly = branding.studentIdLogin && branding.authIdentifier === "none";
  const [channel, setChannel] = useState(byIdOnly ? "id" : branding.authIdentifier === "phone" ? "phone" : "email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState(null);
  const [devSendError, setDevSendError] = useState(null);
  const [noAccount, setNoAccount] = useState(false);
  const [resendCooldown, restartResendCooldown] = useCountdown(RESEND_SECONDS);

  const [login, { isLoading: loggingIn, error: loginError }] = useLoginMutation();
  const [requestOtp, { isLoading: sending, error: sendError }] = useRequestLoginOtpMutation();
  const [verifyAndLogin, { isLoading: verifying, error: verifyError }] = useLoginWithOtpMutation();

  const [country, setCountry] = useState(branding.phoneCountries[0].code);
  const idField = channel === "id" ? { studentId: identifier } : channel === "email" ? { email: identifier } : { phoneNumber: identifier, phoneCountry: country };

  const submitPassword = async (e) => {
    e.preventDefault();
    try {
      await login({ ...idField, password }).unwrap();
      navigate(takeNext(), { replace: true });
    } catch {
      // rendered below
    }
  };

  const sendCode = async (e) => {
    e.preventDefault();
    try {
      const result = await requestOtp(idField).unwrap();
      // requestLoginOtp says outright when there's no account for this
      // identifier — no code was sent, so there's nothing to verify. Route
      // straight to a "create an account instead" prompt rather than
      // pretending a code is on its way.
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
      const result = await requestOtp(idField).unwrap();
      setDevOtp(result.devOtp || null);
      setDevSendError(result.devSendError || null);
      setOtp("");
      restartResendCooldown();
    } catch {
      // rendered below
    }
  };

  const confirmAndLogin = async (e) => {
    e.preventDefault();
    try {
      await verifyAndLogin({ ...idField, otp }).unwrap();
      navigate(takeNext(), { replace: true });
    } catch {
      // rendered below
    }
  };

  const channels = [
    ...(["email", "both"].includes(branding.authIdentifier) ? [["email", "Email"]] : []),
    ...(["phone", "both"].includes(branding.authIdentifier) ? [["phone", "Phone"]] : []),
    ...(branding.studentIdLogin ? [["id", "Student ID"]] : []),
  ];
  const channelToggle = channels.length > 1 && (
    <ToggleButtonGroup value={channel} exclusive onChange={(e, v) => { if (v) { setChannel(v); if (v === "id") setMode("password"); } }} size="small" fullWidth>
      {channels.map(([value, label]) => <ToggleButton key={value} value={value}>{label}</ToggleButton>)}
    </ToggleButtonGroup>
  );

  const modeSwitch = (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 2 }}>
        <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
        <Typography variant="caption" color="text.secondary">or</Typography>
        <Box sx={{ flex: 1, height: "1px", bgcolor: "divider" }} />
      </Box>
      <Button
        variant="outlined"
        fullWidth
        onClick={() => { setMode(mode === "password" ? "otp" : "password"); setStep("identify"); }}
      >
        {mode === "password" ? "Log in with a code instead" : "Log in with a password instead"}
      </Button>
    </>
  );

  if (mode === "otp" && step === "verify") {
    return (
      <AuthShell title="Enter your code" subtitle={`Sent to ${identifier}`} onBack={() => setStep("identify")}>
        <Box component="form" onSubmit={confirmAndLogin} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
            {verifying ? "Verifying" : "Log in"}
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
    <AuthShell title="Welcome back" subtitle={`Log in to continue your ${terms.batches}`}>
      <Box component="form" onSubmit={mode === "password" ? submitPassword : sendCode} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <DemoAccounts onPick={(email) => { setMode("password"); setChannel("email"); setIdentifier(email); }} />
        {(loginError || sendError) && (
          <Alert severity="error">{(loginError || sendError).data?.message || "Something went wrong."}</Alert>
        )}
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

        {channelToggle}

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
            label={channel === "id" ? "Student ID" : "Email"}
            type={channel === "id" ? "text" : "email"}
            value={identifier}
            onChange={(e) => { setIdentifier(e.target.value); setNoAccount(false); }}
            autoFocus
            fullWidth
          />
        )}

        {mode === "password" && (
          <>
            <PasswordField
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
            />
            {channel === "id" ? (
              <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "flex-end" }}>
                Forgot it? Your {terms.org} can reset it.
              </Typography>
            ) : (
              <MuiLink component={Link} to="/forgot-password" variant="body2" sx={{ alignSelf: "flex-end" }}>
                Forgot password?
              </MuiLink>
            )}
          </>
        )}

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={mode === "password" ? (loggingIn || !identifier || !password) : (sending || !identifier)}
        >
          {mode === "password" ? (loggingIn ? "Logging in" : "Log in") : (sending ? "Sending code" : "Send code")}
        </Button>

        {channel !== "id" && branding.codeLogin && modeSwitch}

        {(branding.sales || channel !== "id") && branding.authIdentifier !== "none" && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", mt: 1 }}>
            New here? <MuiLink component={Link} to="/register">Create an account</MuiLink>
          </Typography>
        )}
      </Box>
    </AuthShell>
  );
}
