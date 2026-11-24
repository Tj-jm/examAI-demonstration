import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Zap, Plus } from "lucide-react";
import { useGetCampaignsQuery, useCreateCampaignMutation, useToggleAutomationMutation } from "../api/campaignApi";
import { Loading, ErrorNote, Empty, Pager } from "../components/bits";
import { salesText } from "./Campaigns";

export const TRIGGER_LABEL = {
  trialEnding: "Trial ending",
  checkoutAbandoned: "Checkout not finished",
  accessExpiring: "Access ending",
  accessExpired: "Access ended",
  inactive: "Gone quiet",
  noPurchase: "Signed up, not joined",
};

export const triggerText = (t = {}) => ({
  trialEnding: `${t.days} day${t.days === 1 ? "" : "s"} before a free trial ends, if they haven't bought`,
  checkoutAbandoned: `${t.hours} hour${t.hours === 1 ? "" : "s"} after a checkout that wasn't finished`,
  accessExpiring: `${t.days} day${t.days === 1 ? "" : "s"} before access to a batch ends, if not renewed`,
  accessExpired: `${t.days} day${t.days === 1 ? "" : "s"} after access ended, if not renewed`,
  inactive: `After ${t.days} day${t.days === 1 ? "" : "s"} with no activity, at most once a month`,
  noPurchase: `${t.days} day${t.days === 1 ? "" : "s"} after signing up, if they haven't bought anything`,
}[t.type] || "");

// Automations: messages that send themselves to each student when a
// trigger applies (backend utils/automations.js). Checked every hour.
export default function Automations() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetCampaignsQuery({ page, kind: "automation" });
  const [create, createState] = useCreateCampaignMutation();
  const [toggle, toggleState] = useToggleAutomationMutation();

  const start = async (preset) => {
    try {
      const made = await create({ kind: "automation", preset, channels: { app: true, sms: false, email: false } }).unwrap();
      navigate(`/automations/${made._id}`);
    } catch { /* shown below */ }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Automations</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Messages that go out by themselves, to each student at the right moment: a trial about to end, a payment left unfinished, access running out.
            Checked every hour. Each student gets each one once per reason.
          </p>
        </div>
      </div>

      <div className="card stack" style={{ marginBottom: 16 }}>
        <span className="label">New automation</span>
        <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
          {Object.entries(TRIGGER_LABEL).map(([preset, label]) => (
            <button key={preset} className="btn btn-sm" disabled={createState.isLoading} onClick={() => start(preset)}>
              <Plus size={13} /> {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ margin: 0 }}>Each starts with a ready message you can change. It stays off until you switch it on.</p>
      </div>

      <ErrorNote error={error || createState.error || toggleState.error} />
      {isLoading ? <Loading /> : !data?.campaigns?.length ? (
        <Empty icon={Zap} title="No automations yet" hint="Pick one above to start." />
      ) : (
        <div className="list">
          {data.campaigns.map((c) => (
            <div key={c._id} className="list-row" style={{ alignItems: "center" }}>
              <Link to={`/automations/${c._id}`} className="grow stack" style={{ gap: 4, color: "inherit", textDecoration: "none" }}>
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  <strong>{c.name}</strong>
                  <span className={`pill${c.status === "active" ? " pill-ok" : ""}`}>{c.status === "active" ? "On" : "Off"}</span>
                </div>
                <span className="muted small">
                  {triggerText(c.trigger)}
                  {" · "}{["app", "sms", "email"].filter((k) => c.channels?.[k]).map((k) => (k === "app" ? "App" : k.toUpperCase())).join(", ")}
                </span>
                <span className="muted small tnum">
                  {c.stats?.recipients || 0} sent · {c.stats?.clicks || 0} opened · Sales: {salesText(c.sales)}
                </span>
              </Link>
              <label className="row-tight small" style={{ gap: 6 }}>
                <input type="checkbox" checked={c.status === "active"} disabled={toggleState.isLoading}
                  onChange={(e) => toggle({ id: c._id, on: e.target.checked })} />
                On
              </label>
            </div>
          ))}
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />}
    </div>
  );
}
