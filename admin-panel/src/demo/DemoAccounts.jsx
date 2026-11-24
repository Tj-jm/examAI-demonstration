import { useEffect, useState } from "react";

// Sales demo: one click fills the sign-in email for each demo role
// (backend GET /api/demo/info). Reps are told the passwords.
const LABEL = { owner: "Owner", admin: "Admin", teacher: "Teacher", grader: "Grader", doubtSolver: "Doubt solver", representative: "Seller" };

export default function DemoAccounts({ onPick }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    fetch("/api/demo/info", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then(setInfo).catch(() => {});
  }, []);
  if (!info?.staff?.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">Demo accounts</span>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
        {info.staff.map((u) => (
          <button key={u.email} type="button" className="pill pill-btn" title={u.email} onClick={() => onPick(u.email)}>{LABEL[u.role] || u.role}</button>
        ))}
      </div>
      {info.resetting && <span className="hint">The demo is being reset. Try again in a minute.</span>}
    </div>
  );
}
