import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useGetMyCouponPerformanceQuery, useGetBatchesQuery } from "../api/contentApi";
import { Tag, TrendingUp } from "lucide-react";
import { Loading, ErrorNote, Empty, Field } from "../components/bits";
import ReferralLinkButton from "../components/ReferralLinkButton";
import CouponLinksList from "../components/CouponLinksList";
import { useTerms } from "../terms";

const money = (amount, currency) =>
  `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The only page a representative account can reach — see
// middleware/representativeGate.js on the backend for the actual
// enforcement, and Shell.jsx for why this role gets a completely different,
// minimal layout rather than a filtered version of the normal one.
//
// Calls the exact same buildPerformance() an owner/admin's own oversight
// view uses (GET /:id/coupons) — see representativeController.js — so
// there is provably one set of numbers, not a friendlier one shown here.
export default function MyCouponPerformance() {
  const terms = useTerms();
  const { me } = useOutletContext();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, isLoading, error } = useGetMyCouponPerformanceQuery({ from: from || undefined, to: to || undefined });
  const { data: allBatches } = useGetBatchesQuery({});

  return (
    <div className="page">
      <div className="page-head">
        <h1>My coupon performance</h1>
        <p className="muted small" style={{ margin: "2px 0 0" }}>
          Signed in as {me.name} · {me.email}
        </p>
      </div>

      <div className="stack">
        <div className="row">
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        <ErrorNote error={error} />

        {isLoading ? (
          <Loading />
        ) : !data || data.coupons.length === 0 ? (
          <Empty
            icon={Tag}
            title="No coupons attached to you yet"
            hint="An owner or admin can attach a coupon to your account from the Coupons page."
          />
        ) : (
          <>
            {data.totals.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {data.totals.map((row) => (
                  <div key={row.currency} className="card stack" style={{ gap: 6 }}>
                    <div className="row-tight muted small"><TrendingUp size={13} /> {row.currency}</div>
                    <div style={{ fontSize: 22, fontWeight: 600 }}>{money(row.revenue, row.currency)}</div>
                    <div className="muted small tnum">
                      {row.count} redemption{row.count === 1 ? "" : "s"} · {money(row.discountGiven, row.currency)} discounted
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="card stack" style={{ gap: 0 }}>
              <h2 style={{ marginBottom: 8 }}>Your coupons</h2>
              {data.coupons.map((coupon) => (
                <div key={coupon._id} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                  <div className="row-tight" style={{ marginBottom: 3, flexWrap: "wrap" }}>
                    <strong style={{ fontFamily: "monospace", letterSpacing: 0.5 }}>{coupon.code}</strong>
                    <span className={`pill ${coupon.isActive ? "pill-ok" : ""}`}>{coupon.isActive ? "Active" : "Inactive"}</span>
                    <span className="pill">
                      {coupon.discountType === "percent" ? `${coupon.discountValue}% off` : `${coupon.discountValue} off`}
                    </span>
                  </div>
                  <div className="muted small">
                    {coupon.redeemedCount} redemption{coupon.redeemedCount === 1 ? "" : "s"}
                    {coupon.maxRedemptions ? ` of ${coupon.maxRedemptions}` : ""}
                    {coupon.batches?.length > 0
                      ? ` · ${coupon.batches.map((b) => b.name).join(", ")}${coupon.includesGeneral ? " + general packs" : ""}`
                      : coupon.includesGeneral
                        ? ` · Applied across all ${terms.batches} and general AI packs`
                        : ` · Applied across all ${terms.batches} (not general packs)`}
                    {coupon.expiresAt && ` · expires ${new Date(coupon.expiresAt).toLocaleDateString()}`}
                  </div>
                  {coupon.performance?.length > 0 && (
                    <div className="muted small tnum" style={{ marginTop: 2 }}>
                      {coupon.performance.map((p) => `${money(p.revenue, p.currency)} from ${p.count} sale${p.count === 1 ? "" : "s"}`).join(" · ")}
                    </div>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <ReferralLinkButton coupon={coupon} allBatches={allBatches} />
                    <CouponLinksList couponCode={coupon.code} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
