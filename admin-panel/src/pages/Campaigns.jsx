import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Send } from "lucide-react";
import { useGetCampaignsQuery } from "../api/campaignApi";
import { Loading, ErrorNote, Empty, Pager } from "../components/bits";

export const STATUS_PILL = {
  draft: { label: "Draft", className: "pill pill-warn" },
  scheduled: { label: "Scheduled", className: "pill" },
  sending: { label: "Sending", className: "pill pill-ai" },
  sent: { label: "Sent", className: "pill pill-ok" },
  failed: { label: "Failed", className: "pill pill-bad" },
  cancelled: { label: "Stopped", className: "pill" },
};

export const AUDIENCE_LABEL = {
  all: "Every student",
  batch: "Students in a batch",
  neverBought: "Signed up, never bought",
  trialEnding: "Trial ending soon",
  expired: "Access ran out recently",
  inactive: "Gone quiet",
};

export const salesText = (sales = []) =>
  sales.length ? sales.map((s) => `${s.count} · ${s.currency} ${Number(s.total || 0).toLocaleString()}`).join(", ") : "—";

// Campaigns: messages to a group of students by app notification, SMS and
// email (backend utils/campaigns.js). Owner and admin only.
export default function Campaigns() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { data, isLoading, error } = useGetCampaignsQuery({ page, status });

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Campaigns</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Send an offer, reminder or news to a group of students, now or later, and see who opened it and bought.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate("/campaigns/new")}><Plus size={15} /> New campaign</button>
      </div>

      <div className="row-tight" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {[["", "All"], ...Object.entries(STATUS_PILL).map(([k, v]) => [k, v.label])].map(([value, label]) => (
          <button key={value} className={`pill pill-btn${status === value ? " pill-on" : ""}`} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>
        ))}
      </div>

      <ErrorNote error={error} />
      {isLoading ? <Loading /> : !data?.campaigns?.length ? (
        <Empty icon={Send} title="No campaigns yet" hint="Write one, pick who gets it, and send it now or schedule it."
          action={<button className="btn" onClick={() => navigate("/campaigns/new")}><Plus size={15} /> New campaign</button>} />
      ) : (
        <div className="list">
          {data.campaigns.map((c) => (
            <Link key={c._id} to={`/campaigns/${c._id}`} className="list-row">
              <div className="grow stack" style={{ gap: 4 }}>
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  <strong>{c.name}</strong>
                  <span className={STATUS_PILL[c.status]?.className || "pill"}>{STATUS_PILL[c.status]?.label || c.status}</span>
                </div>
                <span className="muted small">
                  {AUDIENCE_LABEL[c.audience?.kind] || "Students"}{c.audience?.batch?.name ? ` · ${c.audience.batch.name}` : ""}
                  {" · "}{["app", "sms", "email"].filter((k) => c.channels?.[k]).map((k) => (k === "app" ? "App" : k.toUpperCase())).join(", ")}
                  {c.status === "scheduled" && c.scheduledAt ? ` · ${new Date(c.scheduledAt).toLocaleString()}` : ""}
                  {c.finishedAt && c.status === "sent" ? ` · sent ${new Date(c.finishedAt).toLocaleDateString()}` : ""}
                </span>
              </div>
              {["sending", "sent", "cancelled", "failed"].includes(c.status) && (
                <div className="small muted tnum" style={{ textAlign: "right" }}>
                  <div>{c.stats?.recipients || 0} students · {c.stats?.clicks || 0} opened</div>
                  <div>Sales: {salesText(c.sales)}</div>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
    </div>
  );
}
