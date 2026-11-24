import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useVerifyInviteQuery, useAcceptInviteMutation } from "../api/authApi";
import { ErrorNote, Field, Loading, PasswordInput } from "../components/bits";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");

  const { data: invite, isLoading, error: verifyError } = useVerifyInviteQuery(token, {
    skip: !token,
  });
  const [accept, { isLoading: accepting, error: acceptError }] = useAcceptInviteMutation();
  const navigate = useNavigate();

  if (!token) {
    return (
      <div className="auth">
        <div className="auth-card banner banner-bad">
          This link is missing its token. Ask whoever invited you to send it again.
        </div>
      </div>
    );
  }

  if (isLoading) return <Loading label="Checking your invitation" />;

  if (verifyError) {
    return (
      <div className="auth">
        <div className="auth-card stack">
          <ErrorNote error={verifyError} />
          <p className="hint" style={{ margin: 0 }}>
            Invitations expire after three days. Ask for a new one.
          </p>
        </div>
      </div>
    );
  }

  const submit = async (event) => {
    event.preventDefault();
    try {
      await accept({ token, password }).unwrap();
      navigate("/");
    } catch {
      // rendered from `acceptError` below
    }
  };

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <div style={{ marginBottom: 8 }}>
          <h1>Welcome, {invite.name}</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Choose a password for {invite.email}.
          </p>
        </div>

        <ErrorNote error={acceptError} />

        <Field label="Password" hint="At least 8 characters.">
          <PasswordInput
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <button className="btn btn-block" disabled={accepting || password.length < 8}>
          {accepting ? "Setting up" : "Set password and continue"}
        </button>
      </form>
    </div>
  );
}
