import { useState } from "react";
import { Wallet, Printer, Check, AlertTriangle, X } from "lucide-react";
import { useGetMyPayslipsQuery, useConfirmPayslipMutation, useDisputePayslipMutation } from "../api/payslipApi";
import { Loading, ErrorNote, Empty, Field } from "../components/bits";
import PayslipSheet, { money, day, StatusPill } from "../components/PayslipSheet";
import { MyClassPay } from "../components/ClassPay";

// A team member's own payslips (backend payslipController myPayslips).
// Confirm a paid one, or say what's wrong with it.
export default function MyPayslips() {
  const { data, isLoading, error } = useGetMyPayslipsQuery();
  const [open, setOpen] = useState(null);
  const slip = open && data?.items.find((p) => p._id === open);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My payslips</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>What you've been paid, and what's still to come.</p>
        </div>
      </div>
      <ErrorNote error={error} />
      {/* Live classes taken so far; shows only for someone with a class rate or classes. */}
      <div style={{ marginBottom: 12 }}><MyClassPay /></div>
      {isLoading ? <Loading /> : !data?.items?.length ? (
        <Empty icon={Wallet} title="No payslips yet" hint="They show up here once an admin issues one." />
      ) : (
        <div className="stack">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {data.totals.map((t) => (
              <div key={t.currency} className="stack" style={{ display: "contents" }}>
                <div className="card stack" style={{ gap: 4, borderTop: "3px solid var(--correct)" }}>
                  <span className="muted small">Paid · {t.currency}</span>
                  <strong style={{ fontSize: 22 }} className="tnum">{money(t.paid, t.currency)}</strong>
                </div>
                <div className="card stack" style={{ gap: 4, borderTop: "3px solid var(--warning)" }}>
                  <span className="muted small">Still due · {t.currency}</span>
                  <strong style={{ fontSize: 22 }} className="tnum">{money(t.due, t.currency)}</strong>
                </div>
              </div>
            ))}
          </div>

          <div className="stack" style={{ gap: 8 }}>
            {data.items.map((p) => (
              <button key={p._id} className="card spread" style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", border: "1px solid var(--border)" }} onClick={() => setOpen(p._id)}>
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{day(p.periodFrom)} – {day(p.periodTo)}</strong>
                  <span className="muted small">{p.number}{p.payment?.paidAt ? ` · paid ${day(p.payment.paidAt)} by ${p.payment.method}` : ""}</span>
                </div>
                <div className="row-tight" style={{ gap: 10 }}>
                  <strong className="tnum">{money(p.total, p.currency)}</strong>
                  <StatusPill status={p.status} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      {slip && <MyPayslipDialog slip={slip} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MyPayslipDialog({ slip, onClose }) {
  const [confirmPaid, { isLoading: confirming, error: confirmError }] = useConfirmPayslipMutation();
  const [dispute, { isLoading: disputing, error: disputeError }] = useDisputePayslipMutation();
  const [raising, setRaising] = useState(false);
  const [note, setNote] = useState("");

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog stack" style={{ maxWidth: 640 }}>
        <div className="spread no-print">
          <h3 style={{ margin: 0 }}>Payslip</h3>
          <button className="btn btn-quiet btn-sm" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <PayslipSheet slip={slip} />
        <ErrorNote error={confirmError || disputeError} />
        {raising ? (
          <div className="stack no-print">
            <Field label="What's wrong?" hint="An admin sees this and can fix the payslip or pay again.">
              <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="row-tight" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-quiet" onClick={() => setRaising(false)}>Cancel</button>
              <button className="btn" disabled={disputing || !note.trim()} onClick={async () => { await dispute({ id: slip._id, note }).unwrap(); setRaising(false); }}>Send</button>
            </div>
          </div>
        ) : (
          <div className="row-tight no-print" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn btn-quiet" onClick={() => window.print()}><Printer size={14} /> Print</button>
            {["issued", "paid"].includes(slip.status) && (
              <button className="btn btn-quiet" onClick={() => setRaising(true)}><AlertTriangle size={14} /> Something's wrong</button>
            )}
            {slip.status === "paid" && (
              <button className="btn" disabled={confirming} onClick={() => confirmPaid(slip._id)}><Check size={14} /> I received it</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
