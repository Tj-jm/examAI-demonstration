import { useState } from "react";
import { Link, useNavigate, useSearchParams, useOutletContext } from "react-router-dom";
import {
  useGetCouponsQuery, useDeleteCouponMutation, useGetRepresentativesQuery,
  useGetAllRepresentativePerformanceQuery, useGetBatchesQuery,
} from "../api/contentApi";
import { Plus, Trash2, Pencil, Tag, Search, Users } from "lucide-react";
import { Loading, ErrorNote, Empty, Pager, useConfirm, Field, pageSlice } from "../components/bits";
import ReferralLinkButton from "../components/ReferralLinkButton";
import CouponLinksList from "../components/CouponLinksList";
import { useTerms } from "../terms";

const money = (amount, currency) =>
  `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Owner/admin only — see routes/admin/couponRoutes.js. Coupons touch
// pricing directly, and attaching one to a representative is a commercial
// arrangement, so this sits behind the same tighter gate earnings does.
export default function Coupons() {
  const terms = useTerms();
  const navigate = useNavigate();
  const { me } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const confirm = useConfirm();

  const allowed = ["owner", "admin"].includes(me.role);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === undefined || next.get(key) === value) next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  const page = Number(params.get("page")) || 1;
  const status = params.get("status") || "";
  const representative = params.get("representative") || "";

  const { data, isLoading, error } = useGetCouponsQuery({
    status: status || undefined,
    representative: representative || undefined,
    search: params.get("search") || undefined,
    page,
    limit: 15,
  }, { skip: !allowed });
  const { data: reps } = useGetRepresentativesQuery(undefined, { skip: !allowed });
  const { data: allBatches } = useGetBatchesQuery({});
  const [remove] = useDeleteCouponMutation();

  if (!allowed) {
    return (
      <div className="page">
        <Empty icon={Tag} title="Not available" hint="This page is limited to owner and admin accounts." />
      </div>
    );
  }

  const coupons = data?.coupons || [];

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Coupons</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {isLoading ? "…" : `${data?.total ?? 0} total`}
          </p>
        </div>
        <Link className="btn" to="/coupons/new"><Plus size={15} /> New coupon</Link>
      </div>

      <div className="stack">
        <ErrorNote error={error} />

        <form
          onSubmit={(e) => { e.preventDefault(); setFilter("search", search || undefined); }}
          className="search-wrap"
        >
          <Search size={15} className="search-icon" />
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            placeholder="Search by code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <button className={`pill pill-btn${!status ? " pill-on" : ""}`} onClick={() => setFilter("status", undefined)}>
            All
          </button>
          <button className={`pill pill-btn${status === "active" ? " pill-on" : ""}`} onClick={() => setFilter("status", "active")}>
            Active
          </button>
          <button className={`pill pill-btn${status === "inactive" ? " pill-on" : ""}`} onClick={() => setFilter("status", "inactive")}>
            Inactive
          </button>

          {(reps || []).length > 0 && (
            <select
              className="pill pill-btn"
              style={{ maxWidth: 220 }}
              value={representative}
              onChange={(e) => setFilter("representative", e.target.value || undefined)}
            >
              <option value="">Every representative</option>
              {reps.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          )}
        </div>

        {isLoading ? (
          <Loading />
        ) : coupons.length === 0 ? (
          <Empty
            icon={Tag}
            title={params.toString() ? "Nothing matches" : "No coupons yet"}
            hint={params.toString() ? "Try clearing a filter." : "Create one to start offering a discount."}
            action={!params.toString() && <Link className="btn" to="/coupons/new"><Plus size={15} /> New coupon</Link>}
          />
        ) : (
          <>
            <div className="card stack" style={{ gap: 0 }}>
              {coupons.map((coupon) => (
                <div key={coupon._id} style={{ borderTop: "1px solid var(--border)" }}>
                <div
                  className="spread"
                  style={{ padding: "12px 0", cursor: "pointer" }}
                  onClick={() => navigate(`/coupons/${coupon._id}/edit`)}
                >
                  <div className="grow">
                    <div className="row-tight" style={{ marginBottom: 3, flexWrap: "wrap" }}>
                      <strong style={{ fontFamily: "monospace", letterSpacing: 0.5 }}>{coupon.code}</strong>
                      <span className={`pill ${coupon.isActive ? "pill-ok" : ""}`}>{coupon.isActive ? "Active" : "Inactive"}</span>
                      <span className="pill">
                        {coupon.discountType === "percent" ? `${coupon.discountValue}% off` : `${coupon.discountValue} off`}
                      </span>
                      {coupon.products?.length === 1 && (
                        <span className="pill">
                          {coupon.products[0] === "aiCredits" ? "AI credits only" : "Subscriptions only"}
                        </span>
                      )}
                      {coupon.representative && (
                        <span className="pill row-tight" style={{ gap: 4 }}>
                          <Users size={11} /> {coupon.representative.name}
                        </span>
                      )}
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
                        {coupon.performance.map((p) => money(p.revenue, p.currency)).join(" · ")} generated
                      </div>
                    )}
                  </div>

                  <div className="row-tight" onClick={(e) => e.stopPropagation()}>
                    <ReferralLinkButton coupon={coupon} allBatches={allBatches} />
                    <Link className="icon-btn" title="Edit" to={`/coupons/${coupon._id}/edit`}><Pencil size={14} /></Link>
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Delete coupon"
                      onClick={async () => {
                        const yes = await confirm({
                          title: `Delete "${coupon.code}"?`,
                          body: coupon.redeemedCount > 0
                            ? `This has been redeemed ${coupon.redeemedCount} time${coupon.redeemedCount === 1 ? "" : "s"}. Past purchases keep their own record of the discount regardless.`
                            : "This cannot be undone.",
                          confirmLabel: "Delete",
                        });
                        if (yes) remove(coupon._id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 10, cursor: "default" }}>
                  <CouponLinksList couponCode={coupon.code} />
                </div>
                </div>
              ))}
            </div>

            <Pager page={data.page} pages={data.pages} total={data.total} onChange={(n) => setFilter("page", String(n))} />
          </>
        )}

        <RepresentativeEarnings />
      </div>
    </div>
  );
}

// Every representative at once, ranked by revenue, for whatever date range
// is picked here — "who's actually bringing in business", the thing
// getPerformanceFor (one representative at a time) makes tedious to answer
// by hand once there's more than a couple of them.
function RepresentativeEarnings() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { data, isLoading, error } = useGetAllRepresentativePerformanceQuery({ from: from || undefined, to: to || undefined });
  const reps = data?.representatives || [];
  const [page, setPage] = useState(1);
  const shown = pageSlice(reps, page, 20);

  return (
    <div className="card stack" style={{ marginTop: 8 }}>
      <div className="row-tight"><Users size={17} className="muted" /><h2 style={{ fontSize: 15 }}>Earnings by representative</h2></div>

      <div className="row">
        <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      <ErrorNote error={error} />

      {isLoading ? (
        <Loading />
      ) : reps.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>No representative accounts yet.</p>
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          {shown.items.map((rep) => (
            <div key={rep._id} className="spread" style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
              <div className="grow">
                <span className="small">{rep.name}</span>
                {!rep.isActive && <span className="pill" style={{ marginLeft: 6 }}>Inactive</span>}
                <div className="muted small">{rep.email}</div>
              </div>
              {rep.totals.length > 0 ? (
                <div className="muted small tnum" style={{ textAlign: "right" }}>
                  {rep.totals.map((t) => (
                    <div key={t.currency}>
                      {money(t.revenue, t.currency)} · {t.count} sale{t.count === 1 ? "" : "s"}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="muted small">No sales{from || to ? " in this range" : ""}</span>
              )}
            </div>
          ))}
          <Pager page={shown.page} pages={shown.pages} total={shown.total} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
