import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useGetCouponQuery, useCreateCouponMutation, useUpdateCouponMutation,
  useGetBatchesQuery, useGetRepresentativesQuery,
} from "../api/contentApi";
import { ArrowLeft } from "lucide-react";
import { Loading, ErrorNote, Field } from "../components/bits";
import { useTerms } from "../terms";

const emptyDraft = () => ({
  code: "",
  discountType: "percent",
  discountValue: "",
  batches: [],
  includesGeneral: true,
  products: ["subscriptions", "aiCredits"],
  maxRedemptions: "",
  expiresAt: "",
  isActive: true,
  representative: "",
  limitOnePerStudent: false,
});

// One route for both jobs, same shape as every other editor in this app.
export default function CouponEditor() {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const { data: existing, isLoading } = useGetCouponQuery(id, { skip: isNew });
  const { data: batches } = useGetBatchesQuery({});
  const { data: reps } = useGetRepresentativesQuery();
  const [create, { isLoading: creating, error: createError }] = useCreateCouponMutation();
  const [update, { isLoading: updating, error: updateError }] = useUpdateCouponMutation();

  const [draft, setDraft] = useState(isNew ? emptyDraft() : null);

  useEffect(() => {
    if (!isNew && existing) {
      setDraft({
        code: existing.code,
        discountType: existing.discountType,
        discountValue: String(existing.discountValue),
        batches: (existing.batches || []).map((b) => b._id || b),
        includesGeneral: existing.includesGeneral !== false,
        products: existing.products?.length > 0 ? existing.products : ["subscriptions", "aiCredits"],
        maxRedemptions: existing.maxRedemptions ? String(existing.maxRedemptions) : "",
        expiresAt: existing.expiresAt ? existing.expiresAt.slice(0, 10) : "",
        isActive: existing.isActive,
        representative: existing.representative?._id || existing.representative || "",
        limitOnePerStudent: existing.limitOnePerStudent || false,
      });
    }
  }, [isNew, existing]);

  if (!isNew && isLoading) return <Loading />;
  if (!draft) return null;

  const set = (patch) => setDraft({ ...draft, ...patch });

  const toggleBatch = (batchId) => {
    const next = draft.batches.includes(batchId)
      ? draft.batches.filter((b) => b !== batchId)
      : [...draft.batches, batchId];
    set({ batches: next });
  };

  const toggleProduct = (product) => {
    if (draft.products.includes(product)) {
      if (draft.products.length === 1) return; // always leave at least one checked
      set({ products: draft.products.filter((p) => p !== product) });
    } else {
      set({ products: [...draft.products, product] });
    }
  };

  const valid = draft.code.trim() && draft.discountValue !== "" && Number(draft.discountValue) > 0 &&
    (draft.discountType !== "percent" || Number(draft.discountValue) <= 100);

  const save = async () => {
    const body = {
      code: draft.code.trim().toUpperCase(),
      discountType: draft.discountType,
      discountValue: Number(draft.discountValue),
      batches: draft.batches,
      includesGeneral: draft.includesGeneral,
      products: draft.products,
      maxRedemptions: draft.maxRedemptions ? Number(draft.maxRedemptions) : null,
      expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      isActive: draft.isActive,
      representative: draft.representative || null,
      limitOnePerStudent: draft.limitOnePerStudent,
    };

    const result = isNew ? await create(body) : await update({ id, ...body });
    if (!result.error) navigate("/coupons");
  };

  return (
    <div className="page">
      <div className="page-head row-tight">
        <button className="icon-btn" onClick={() => navigate("/coupons")}><ArrowLeft size={18} /></button>
        <h1>{isNew ? "New coupon" : "Edit coupon"}</h1>
      </div>

      <div className="stack" style={{ maxWidth: 560 }}>
        <ErrorNote error={createError || updateError} />

        <div className="card stack">
          <Field label="Code" hint="Not case-sensitive — always saved and matched in capitals.">
            <input
              className="input"
              style={{ fontFamily: "monospace", letterSpacing: 0.5, textTransform: "uppercase" }}
              value={draft.code}
              onChange={(e) => set({ code: e.target.value })}
              placeholder="SAVE20"
            />
          </Field>

          <div className="row">
            <div className="field">
              <span className="label">Discount type</span>
              <div className="row-tight">
                <button
                  className={`pill pill-btn${draft.discountType === "percent" ? " pill-on" : ""}`}
                  onClick={() => set({ discountType: "percent" })}
                >
                  Percentage
                </button>
                <button
                  className={`pill pill-btn${draft.discountType === "fixed" ? " pill-on" : ""}`}
                  onClick={() => set({ discountType: "fixed" })}
                >
                  Fixed amount
                </button>
              </div>
            </div>

            <Field
              label={draft.discountType === "percent" ? "Percent off" : "Amount off"}
              hint={draft.discountType === "percent" ? "0–100" : "In the purchase's own currency"}
            >
              <input
                className="input tnum"
                type="number"
                min="0"
                max={draft.discountType === "percent" ? 100 : undefined}
                value={draft.discountValue}
                onChange={(e) => set({ discountValue: e.target.value })}
              />
            </Field>
          </div>
        </div>

        <div className="card stack">
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>Where it applies</h2></div>
          <p className="hint" style={{ margin: 0 }}>Leave every {terms.batch} unchecked to cover all of them.</p>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <button
              className={`pill pill-btn${draft.batches.length === 0 ? " pill-on" : ""}`}
              onClick={() => set({ batches: [] })}
            >
              All batches
            </button>
            {(batches || []).map((batch) => (
              <button
                key={batch._id}
                className={`pill pill-btn${draft.batches.includes(batch._id) ? " pill-on" : ""}`}
                onClick={() => toggleBatch(batch._id)}
              >
                {batch.name}
              </button>
            ))}
          </div>
          <label className="row-tight small" style={{ cursor: "pointer", marginTop: 4 }}>
            <input
              type="checkbox"
              checked={draft.includesGeneral}
              onChange={(e) => set({ includesGeneral: e.target.checked })}
            />
            Also cover general AI credit packs (not tied to any batch)
          </label>
        </div>

        <div className="card stack">
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>What it applies to</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            A coupon can be for subscription plans, AI credit packs, or both.
          </p>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
            <button
              className={`pill pill-btn${draft.products.includes("subscriptions") ? " pill-on" : ""}`}
              onClick={() => toggleProduct("subscriptions")}
            >
              Subscription plans
            </button>
            <button
              className={`pill pill-btn${draft.products.includes("aiCredits") ? " pill-on" : ""}`}
              onClick={() => toggleProduct("aiCredits")}
            >
              AI credit packs
            </button>
          </div>
        </div>

        <div className="card stack">
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>Limits</h2></div>
          <div className="row">
            <Field label="Max redemptions" hint="Leave blank for unlimited.">
              <input
                className="input tnum"
                type="number"
                min="1"
                value={draft.maxRedemptions}
                onChange={(e) => set({ maxRedemptions: e.target.value })}
              />
            </Field>
            <Field label="Expires" hint="Leave blank for no expiry.">
              <input
                className="input"
                type="date"
                value={draft.expiresAt}
                onChange={(e) => set({ expiresAt: e.target.value })}
              />
            </Field>
          </div>

          <label className="row-tight" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            <span className="small">Active</span>
          </label>

          <label className="row-tight" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={draft.limitOnePerStudent}
              onChange={(e) => set({ limitOnePerStudent: e.target.checked })}
            />
            <span className="small">Only one redemption per student</span>
          </label>
          <p className="hint" style={{ margin: 0 }}>
            Off by default — a student can use this code again later (e.g. to renew or extend a
            subscription). Turn this on for something like a referral code, where the same student
            redeeming it more than once is the thing you want to prevent. Either way, max redemptions
            above still caps how many times this coupon can be used in total.
          </p>
        </div>

        <div className="card stack">
          <div className="row-tight"><h2 style={{ fontSize: 15 }}>Representative</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            Optional. Attributes this coupon's redemptions and revenue to one representative's
            own performance view — they will see this coupon and nothing else on the admin panel.
          </p>
          <select
            className="select"
            value={draft.representative}
            onChange={(e) => set({ representative: e.target.value })}
          >
            <option value="">Not attached to anyone</option>
            {(reps || []).map((r) => <option key={r._id} value={r._id}>{r.name} ({r.email})</option>)}
          </select>
          {(reps || []).length === 0 && (
            <p className="hint" style={{ margin: 0 }}>
              No representative accounts yet — invite one from Team first.
            </p>
          )}
        </div>

        <div className="row">
          <button className="btn" disabled={!valid || creating || updating} onClick={save}>
            {creating || updating ? "Saving" : isNew ? "Create coupon" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
