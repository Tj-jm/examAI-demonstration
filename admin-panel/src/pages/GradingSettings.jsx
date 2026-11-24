import { useEffect, useState } from "react";
import { PenLine, Wallet } from "lucide-react";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../api/contentApi";
import { ErrorNote, Field, Loading } from "../components/bits";

const DEFAULTS = { payMode: "question", ratePerQuestion: 0, ratePerScript: 0, stuckHours: 24, regradeHours: 48 };

// Settings → Grading: how graders are paid, and the timeouts that keep
// scripts and regrades from getting stuck (backend utils/gradingFlow.js).
export default function GradingSettings() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error, isSuccess }] = useUpdateSettingsMutation();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings && !form) setForm({ ...DEFAULTS, ...(settings.grading || {}) });
  }, [settings, form]);

  if (isLoading || !form) return <Loading />;
  const set = (k, v) => setForm({ ...form, [k]: v });
  const byScript = form.payMode === "script";

  return (
    <div className="card stack">
      <div className="row-tight"><PenLine size={17} className="muted" /><h2>Grading</h2></div>

      <Field label="Graders are paid">
        <div className="stack" style={{ gap: 6 }}>
          <label className="row-tight" style={{ gap: 8 }}>
            <input type="radio" checked={!byScript} onChange={() => set("payMode", "question")} />
            <span><strong>By question</strong> — each written answer marked counts. Several graders can share a script.</span>
          </label>
          <label className="row-tight" style={{ gap: 8 }}>
            <input type="radio" checked={byScript} onChange={() => set("payMode", "script")} />
            <span><strong>By script</strong> — each finished script counts. The grader who saves a script's first mark keeps it until it's finished; nobody else can mark it unless an admin reopens it.</span>
          </label>
        </div>
      </Field>

      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <Field label="Rate per answer" hint="0 shows counts only.">
          <input className="input tnum" type="number" min="0" step="0.01" style={{ width: 120 }} value={form.ratePerQuestion} onChange={(e) => set("ratePerQuestion", e.target.value)} disabled={byScript} />
        </Field>
        <Field label="Rate per script" hint="0 shows counts only.">
          <input className="input tnum" type="number" min="0" step="0.01" style={{ width: 120 }} value={form.ratePerScript} onChange={(e) => set("ratePerScript", e.target.value)} disabled={!byScript} />
        </Field>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <Field label="Flag a part-marked script after (hours)" hint="No new marks for this long: it shows as stuck on the grading page, and the admin copilot knows about it. Reopen it from the script.">
          <input className="input tnum" type="number" min="1" max="720" style={{ width: 100 }} value={form.stuckHours} onChange={(e) => set("stuckHours", e.target.value)} />
        </Field>
        <Field label="A regrade waits for its grader (hours)" hint="Then anyone on the batch can do it, and the pay credit goes to whoever does.">
          <input className="input tnum" type="number" min="1" max="720" style={{ width: 100 }} value={form.regradeHours} onChange={(e) => set("regradeHours", e.target.value)} />
        </Field>
      </div>

      <p className="hint" style={{ margin: 0 }}>
        In both modes, an answer one grader marked can't be changed by another; an admin can change it, or reopen the script.
        Changing the pay mode doesn't rewrite history: both counts are kept, and Grading → My stats shows the one in use.
      </p>

      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn" disabled={saving} onClick={() => update({
          grading: {
            payMode: form.payMode,
            ratePerQuestion: Number(form.ratePerQuestion) || 0,
            ratePerScript: Number(form.ratePerScript) || 0,
            stuckHours: Number(form.stuckHours) || 24,
            regradeHours: Number(form.regradeHours) || 48,
          },
        })}>{saving ? "Saving…" : "Save"}</button>
        {isSuccess && !saving && <span className="small muted">Saved.</span>}
      </div>
    </div>
  );
}

// Settings → Grading: pay for doubt solvers and sellers (backend
// utils/teamPay.js). Shown on Earnings → Team and on payslips.
export function TeamPaySettings() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error, isSuccess }] = useUpdateSettingsMutation();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings && !form) setForm({ doubtRate: 0, sellerPercent: 0, ...(settings.teamPay || {}) });
  }, [settings, form]);

  if (isLoading || !form) return <Loading />;
  const set = (k, v) => setForm({ ...form, [k]: v });

  return (
    <div className="card stack">
      <div className="row-tight"><Wallet size={17} className="muted" /><h2>Team pay</h2></div>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <Field label={`Rate per answered doubt${settings?.defaultCurrency ? ` (${settings.defaultCurrency})` : ""}`} hint="0 shows counts only.">
          <input className="input tnum" type="number" min="0" step="0.01" style={{ width: 120 }} value={form.doubtRate} onChange={(e) => set("doubtRate", e.target.value)} />
        </Field>
        <Field label="Seller commission (%)" hint="Of what students paid with the seller's coupons. 0 shows sales only.">
          <input className="input tnum" type="number" min="0" max="100" step="0.1" style={{ width: 120 }} value={form.sellerPercent} onChange={(e) => set("sellerPercent", e.target.value)} />
        </Field>
      </div>
      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn" disabled={saving} onClick={() => update({
          teamPay: { doubtRate: Number(form.doubtRate) || 0, sellerPercent: Number(form.sellerPercent) || 0 },
        })}>{saving ? "Saving…" : "Save"}</button>
        {isSuccess && !saving && <span className="small muted">Saved.</span>}
      </div>
    </div>
  );
}
