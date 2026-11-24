import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useCreateOwnerMutation, useGetSetupStateQuery } from "../api/authApi";
import { ErrorNote, Field, Loading, PasswordInput } from "../components/bits";

export default function Setup() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [createOwner, { isLoading, error }] = useCreateOwnerMutation();
  const { data: setup, isLoading: checking } = useGetSetupStateQuery();
  const navigate = useNavigate();

  if (checking) return <Loading label="Checking this install" />;

  // This endpoint closes itself once an account exists, so the screen goes
  // with it rather than showing a form that will be refused.
  if (setup && !setup.needsSetup) return <Navigate to="/login" replace />;

  const tooShort = form.password.length > 0 && form.password.length < 8;

  const submit = async (event) => {
    event.preventDefault();
    try {
      await createOwner(form).unwrap();
      navigate("/");
    } catch {
      // rendered from `error` below
    }
  };

  return (
    <div className="auth">
      <form className="auth-card stack" onSubmit={submit}>
        <div style={{ marginBottom: 8 }}>
          <h1>Set up ExamAI</h1>
          <p className="muted small" style={{ margin: "4px 0 0", lineHeight: 1.55 }}>
            This creates the owner account. It only works once — after this,
            everyone else joins by invitation.
          </p>
        </div>

        <ErrorNote error={error} />

        <Field label="Your name">
          <input
            className="input"
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>

        <Field label="Email">
          <input
            className="input"
            type="email"
            autoComplete="username"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>

        <Field
          label="Password"
          hint={tooShort ? "At least 8 characters." : "At least 8 characters."}
        >
          <PasswordInput
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>

        <button
          className="btn btn-block"
          disabled={isLoading || form.password.length < 8}
        >
          {isLoading ? "Creating" : "Create owner account"}
        </button>
      </form>
    </div>
  );
}
