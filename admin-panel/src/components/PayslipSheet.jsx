import { useGetPublicSettingsQuery } from "../api/contentApi";

export const money = (amount, currency) =>
  `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const day = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—");

export const STATUS = {
  draft: ["Draft", ""],
  issued: ["Issued", "pill-warn"],
  paid: ["Paid", "pill-ok"],
  confirmed: ["Confirmed", "pill-ok"],
  disputed: ["Disputed", "pill-bad"],
};

export const StatusPill = ({ status }) => {
  const [label, cls] = STATUS[status] || [status, ""];
  return <span className={`pill ${cls}`}>{label}</span>;
};

export const ROLE_LABEL = { admin: "Admin", teacher: "Teacher", grader: "Grader", doubtSolver: "Doubt solver", representative: "Seller", owner: "Owner" };

// The payslip itself, as it prints. Wrapped in .print-area so window.print()
// shows only this (index.css @media print).
export default function PayslipSheet({ slip }) {
  const { data: brand } = useGetPublicSettingsQuery();
  return (
    <div className="print-area stack" style={{ gap: 14, background: "var(--surface)", color: "var(--text)" }}>
      <div className="spread" style={{ alignItems: "flex-start", borderBottom: "2px solid var(--primary)", paddingBottom: 10 }}>
        <div className="row-tight" style={{ gap: 10 }}>
          {brand?.logo && <img src={brand.logo} alt="" style={{ height: 36, width: "auto" }} />}
          <div className="stack" style={{ gap: 0 }}>
            <strong style={{ fontSize: 16 }}>{brand?.siteName || "Payslip"}</strong>
            <span className="muted small">Payslip {slip.number}</span>
          </div>
        </div>
        <StatusPill status={slip.status} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }} className="small">
        <div className="stack" style={{ gap: 2 }}><span className="muted">Paid to</span><strong>{slip.name}</strong><span className="muted">{ROLE_LABEL[slip.role] || slip.role}</span></div>
        <div className="stack" style={{ gap: 2 }}><span className="muted">Period</span><strong>{day(slip.periodFrom)} – {day(slip.periodTo)}</strong></div>
        <div className="stack" style={{ gap: 2 }}><span className="muted">Issued</span><strong>{day(slip.issuedAt || slip.createdAt)}</strong></div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead>
          <tr>
            {["Item", "Qty", "Rate", "Amount"].map((h, i) => (
              <th key={h} style={{ textAlign: i ? "right" : "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slip.lines.map((l, i) => (
            <tr key={i}>
              <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)" }}>{l.label}</td>
              <td className="tnum" style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{l.quantity ?? "—"}</td>
              <td className="tnum" style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{l.rate != null ? (l.kind === "sales" ? `${l.rate}%` : l.rate) : "—"}</td>
              <td className="tnum" style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)", textAlign: "right", color: l.amount < 0 ? "var(--incorrect)" : undefined }}>{money(l.amount, slip.currency)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600 }}>Total</td>
            <td className="tnum" style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700, fontSize: 16 }}>{money(slip.total, slip.currency)}</td>
          </tr>
        </tbody>
      </table>

      {slip.note && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}><span className="muted">Note: </span>{slip.note}</p>}

      {slip.payment?.paidAt && (
        <div className="card-quiet stack small" style={{ gap: 4 }}>
          <strong>Payment</strong>
          <span>{slip.payment.method}{slip.payment.reference ? ` · ${slip.payment.reference}` : ""} · {day(slip.payment.paidAt)}</span>
          {slip.payment.proofUrl && <a href={slip.payment.proofUrl} target="_blank" rel="noreferrer" className="no-print">View proof</a>}
          {slip.confirmedAt && <span className="muted">Received, confirmed {day(slip.confirmedAt)}</span>}
        </div>
      )}

      {slip.dispute?.note && slip.status === "disputed" && (
        <div className="card-quiet stack small" style={{ gap: 4, borderLeft: "3px solid var(--incorrect)" }}>
          <strong>Disputed {day(slip.dispute.at)}</strong>
          <span style={{ whiteSpace: "pre-wrap" }}>{slip.dispute.note}</span>
        </div>
      )}
    </div>
  );
}
