import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../api/contentApi";
import { ErrorNote, Field, Loading } from "../components/bits";

const DEFAULTS = {
  enabled: false, discountType: "percent", discountValue: 10, newStudentsOnly: true,
  reward: { kind: "coupon", discountType: "percent", discountValue: 10, validDays: 90, credits: 20, maxPerStudent: 0 },
};

function DiscountInput({ type, value, currency, onType, onValue }) {
  return (
    <div className="row-tight" style={{ gap: 6 }}>
      <input className="input tnum" type="number" min="0" step="0.01" style={{ width: 110 }} value={value} onChange={(e) => onValue(e.target.value)} />
      <select className="select" value={type} onChange={(e) => onType(e.target.value)}>
        <option value="percent">% off</option>
        <option value="fixed">{currency} off</option>
      </select>
    </div>
  );
}

// Settings → Referrals (backend utils/referrals.js). Every student gets a
// code to share; a friend using it gets a discount, and once the friend's
// paid purchase completes the student gets a reward.
export default function ReferralSettings() {
  const { data: settings, isLoading } = useGetSettingsQuery();
  const [update, { isLoading: saving, error, isSuccess }] = useUpdateSettingsMutation();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (settings && !form) {
      const r = settings.referrals || {};
      setForm({ ...DEFAULTS, ...r, reward: { ...DEFAULTS.reward, ...(r.reward || {}) } });
    }
  }, [settings, form]);

  if (isLoading || !form) return <Loading />;
  const currency = settings.defaultCurrency || "USD";
  const set = (k, v) => setForm({ ...form, [k]: v });
  const setReward = (k, v) => setForm({ ...form, reward: { ...form.reward, [k]: v } });
  const salesOff = settings.institution?.sales === false;

  return (
    <div className="card stack">
      <div className="row-tight"><Gift size={17} className="muted" /><h2>Referrals</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        Every student gets their own code (on the Plans page in the student app) to share with friends.
        A friend who uses it at checkout gets a discount. When the friend's paid purchase completes, the student gets a reward.
        The Earnings page shows sales made through referrals.
      </p>
      {salesOff && <p className="hint" style={{ margin: 0 }}>Sell access is off (Settings → Institution), so referrals are off too.</p>}

      <label className="row-tight" style={{ gap: 8 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span><strong>Referrals on</strong></span>
      </label>

      <Field label="A friend gets" hint="Off any plan, once per friend. Changing it changes every student's code.">
        <DiscountInput type={form.discountType} value={form.discountValue} currency={currency}
          onType={(v) => set("discountType", v)} onValue={(v) => set("discountValue", v)} />
      </Field>
      <label className="row-tight" style={{ gap: 8 }}>
        <input type="checkbox" checked={form.newStudentsOnly} onChange={(e) => set("newStudentsOnly", e.target.checked)} />
        <span>Only on a friend's first purchase</span>
      </label>

      <Field label="The student gets, per friend who buys">
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
          {[["coupon", "A discount on their next purchase"], ["aiCredits", "AI credits"], ["none", "Nothing"]].map(([v, label]) => (
            <button key={v} type="button" className={`pill pill-btn${form.reward.kind === v ? " pill-on" : ""}`} onClick={() => setReward("kind", v)}>{label}</button>
          ))}
        </div>
      </Field>
      {form.reward.kind === "coupon" && (
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <Field label="Discount" hint="A one-use code only that student can use.">
            <DiscountInput type={form.reward.discountType} value={form.reward.discountValue} currency={currency}
              onType={(v) => setReward("discountType", v)} onValue={(v) => setReward("discountValue", v)} />
          </Field>
          <Field label="Expires after (days)">
            <input className="input tnum" type="number" min="1" max="3650" style={{ width: 100 }} value={form.reward.validDays} onChange={(e) => setReward("validDays", e.target.value)} />
          </Field>
        </div>
      )}
      {form.reward.kind === "aiCredits" && (
        <Field label="AI credits" hint="Added to the student's general AI credits.">
          <input className="input tnum" type="number" min="0" style={{ width: 110 }} value={form.reward.credits} onChange={(e) => setReward("credits", e.target.value)} />
        </Field>
      )}
      {form.reward.kind !== "none" && (
        <Field label="Most rewards one student can earn" hint="0 = no limit.">
          <input className="input tnum" type="number" min="0" style={{ width: 100 }} value={form.reward.maxPerStudent} onChange={(e) => setReward("maxPerStudent", e.target.value)} />
        </Field>
      )}
      <p className="hint" style={{ margin: 0 }}>
        Rewards are given only for paid purchases, never for free ones, and a student can't use their own code.
      </p>

      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button className="btn" disabled={saving} onClick={() => update({
          referrals: {
            enabled: form.enabled,
            discountType: form.discountType,
            discountValue: Number(form.discountValue) || 0,
            newStudentsOnly: form.newStudentsOnly,
            reward: {
              kind: form.reward.kind,
              discountType: form.reward.discountType,
              discountValue: Number(form.reward.discountValue) || 0,
              validDays: Number(form.reward.validDays) || 90,
              credits: Number(form.reward.credits) || 0,
              maxPerStudent: Number(form.reward.maxPerStudent) || 0,
            },
          },
        })}>{saving ? "Saving…" : "Save"}</button>
        {isSuccess && !saving && <span className="small muted">Saved.</span>}
      </div>
    </div>
  );
}
