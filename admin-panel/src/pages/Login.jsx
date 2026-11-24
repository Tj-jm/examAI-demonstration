import { useState } from "react";
import DemoAccounts from "../demo/DemoAccounts";
import { useNavigate, Navigate } from "react-router-dom";
import { useLoginMutation, useGetSetupStateQuery } from "../api/authApi";
import { ErrorNote, Field, Loading, PasswordInput } from "../components/bits";

export default function Login() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [login, { isLoading, error }] = useLoginMutation();
  const { data: setup, isLoading: checking } = useGetSetupStateQuery();
  const navigate = useNavigate();

  if (checking) return <Loading label="Checking this install" />;

  // A fresh install has no account to sign into, so it goes straight to setup
  // rather than showing a form nobody can use.
  if (setup?.needsSetup) return <Navigate to="/setup" replace />;

  const submit = async (event) => {
    event.preventDefault();
    try {
      await login(form).unwrap();
      navigate("/");
    } catch {
      // rendered from `error` below
    }
  };

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <div style={{ marginBottom: 8 }}>
          <h1>Sign in</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            ExamAI admin
          </p>
        </div>

        <ErrorNote error={error} />

        <DemoAccounts onPick={(email) => setForm({ ...form, email })} />

        <Field label="Email">
          <input
            className="input"
            type="email"
            autoComplete="username"
            autoFocus
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>

        <Field label="Password">
          <PasswordInput
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>

        <button className="btn btn-block" disabled={isLoading}>
          {isLoading ? "Signing in" : "Sign in"}
        </button>

        <p className="hint" style={{ textAlign: "center", margin: 0 }}>
          Teachers join by invitation. Ask an admin for a link.
        </p>
      </form>
    </div>
  );
}
