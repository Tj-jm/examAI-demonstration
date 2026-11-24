import { Link, useOutletContext } from "react-router-dom";
import { Flame, Target, ChevronRight, CalendarDays, Palmtree } from "lucide-react";
import { useGetMyHomeQuery, useGetSelfQuery } from "../api/authApi";
import { ErrorNote, Loading } from "../components/bits";
import { ROLE_INFO } from "../constants/roles";
import { Avatar } from "./MyProfile";
import { useGetGradingQueueQuery } from "../api/contentApi";
import { useGetBadgesQuery } from "../api/badgeApi";

// Everyone's own home (not owners and admins, who get the overview): what's
// waiting for them, this week's work against their goal, their streak.

const STATUS = { draft: "Draft", queued: "Waiting for an editor", editing: "Being edited", changes: "Back with you", release: "Waiting to be published", published: "Published", withdrawn: "Withdrawn" };
const PRICE = { proposed: "Price asked", "admin-countered": "Admin's counter-offer", "writer-countered": "Your counter-offer", agreed: "Price agreed", declined: "Price declined", withdrawn: "Price ask withdrawn" };
const hello = () => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };
const CHEERS = ["Small steps every day add up.", "One more and you're ahead of yesterday.", "Steady beats fast.", "Your students notice the care.", "Good work compounds."];

export default function MyHome() {
  const { me } = useOutletContext();
  const { data, isLoading, error } = useGetMyHomeQuery(undefined, { pollingInterval: 120000 });
  const { data: self } = useGetSelfQuery();
  const grading = useGetGradingQueueQuery(undefined, { skip: !["teacher", "grader"].includes(me.role) });
  const badges = useGetBadgesQuery(undefined, { skip: me.role === "representative" });
  if (isLoading || !data) return <div className="page"><ErrorNote error={error} /><Loading /></div>;

  const extra = badges.data?.counts || {};
  const cards = [...data.cards];
  if (["teacher", "grader"].includes(me.role)) cards.unshift({ k: "scripts", n: grading.data?.total || 0, label: "scripts waiting to be marked", to: "/grading" });
  if (["teacher", "grader"].includes(me.role) && extra.assignments) cards.push({ k: "handins", n: extra.assignments, label: "assignment hand-ins waiting", to: "/grading/assignments" });
  if (["teacher", "doubtSolver"].includes(me.role)) cards.unshift({ k: "doubts", n: extra.doubts || 0, label: "doubts waiting", to: "/doubts" });
  if (me.role === "representative") cards.push({ k: "coupons", n: "→", label: "your coupons and sign-ups", to: "/my-coupons" });

  const max = Math.max(1, ...data.days.map((d) => d.n));
  const pct = data.goal ? Math.min(100, Math.round((data.week / data.goal) * 100)) : null;
  const cheer = CHEERS[new Date().getDate() % CHEERS.length];

  return (
    <div className="page">
      <div className="page-head row" style={{ gap: 14, alignItems: "center" }}>
        {self && <Avatar data={self} size={52} />}
        <div className="grow">
          <p className="muted small" style={{ margin: 0 }}>{ROLE_INFO[data.role]?.label || data.role}</p>
          <h1 style={{ margin: 0 }}>{hello()}, {data.name.split(" ")[0]}</h1>
        </div>
        <Link to="/me" className="btn btn-quiet btn-sm">My profile</Link>
      </div>

      {self?.away?.until && (
        <div className="card row-tight" style={{ gap: 8, marginBottom: 12, borderColor: "var(--warning)" }}>
          <Palmtree size={16} /><span className="grow">You're away until {new Date(self.away.until).toLocaleDateString()}. Nothing new is assigned to you.</span>
          <Link className="btn btn-quiet btn-sm" to="/me?tab=settings">Change</Link>
        </div>
      )}

      {/* What's waiting */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, marginBottom: 14 }}>
        {cards.map((c) => {
          const body = (
            <>
              <span className="tnum" style={{ fontSize: 28, fontWeight: 700 }}>{c.money ? Number(c.n).toLocaleString() : c.n}</span>
              <span className="muted small">{c.label}</span>
            </>
          );
          return c.to
            ? <Link key={c.k} to={c.to} className="card stack" style={{ gap: 2, textDecoration: "none", color: "inherit" }}>{body}</Link>
            : <div key={c.k} className="card stack" style={{ gap: 2 }}>{body}</div>;
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        {/* This week */}
        <div className="card stack">
          <div className="spread"><b className="row-tight"><Target size={15} /> This week</b>{data.streak > 0 && <span className="pill row-tight" style={{ gap: 4 }}><Flame size={13} color="#ff7a1a" /> {data.streak}-day streak</span>}</div>
          <div className="row-tight" style={{ gap: 6, alignItems: "baseline" }}>
            <span className="tnum" style={{ fontSize: 30, fontWeight: 700 }}>{data.week}</span>
            <span className="muted small">{data.unit}{data.goal ? ` of ${data.goal}` : ""}</span>
          </div>
          {pct !== null && (
            <div style={{ height: 10, borderRadius: 99, background: "var(--surface-alt)", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "var(--success, #2e9d5b)" : "var(--primary)", transition: "width .4s" }} />
            </div>
          )}
          <span className="small muted">{pct >= 100 ? "Goal reached. 🎉" : cheer}</span>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 70 }} aria-label="Last 14 days">
            {data.days.map((d) => (
              <div key={d.day} title={`${d.day}: ${d.n}`} style={{ flex: 1, height: `${Math.max(4, (d.n / max) * 100)}%`, borderRadius: 3, background: d.n ? "var(--primary)" : "var(--surface-alt)" }} />
            ))}
          </div>
          <span className="hint" style={{ margin: 0 }}>Last 14 days</span>
        </div>

        {/* Their list */}
        {(data.items || []).length > 0 && (
          <div className="card stack" style={{ gap: 6 }}>
            <b className="row-tight"><CalendarDays size={15} /> Coming classes</b>
            {data.items.map((it, i) => (
              <Link key={i} to={it.to} className="spread" style={{ textDecoration: "none", color: "inherit", padding: "6px 0", borderTop: i ? "1px solid var(--border)" : 0 }}>
                <span className="stack" style={{ gap: 0 }}>
                  <span>{it.title}</span>
                  <span className="muted small">
                    {it.at ? new Date(it.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : STATUS[it.status] || it.status}
                    {it.price ? ` · ${PRICE[it.price] || it.price}` : ""}
                    {it.due ? ` · goes back to the queue ${new Date(it.due).toLocaleDateString()}` : ""}
                  </span>
                </span>
                <ChevronRight size={15} className="muted" />
              </Link>
            ))}
          </div>
        )}

        {/* Responsibilities */}
        <div className="card stack" style={{ gap: 6 }}>
          <b>Your responsibilities</b>
          {data.note ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{data.note}</p> : <ul style={{ margin: 0, paddingLeft: 18 }}>{(ROLE_INFO[data.role]?.does || []).map((t) => <li key={t} className="small">{t}</li>)}</ul>}
          <Link to="/me?tab=role" className="small">What my role can and can't do</Link>
        </div>
      </div>
    </div>
  );
}
