import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, RefreshCw, Users, UserX, Clock } from "lucide-react";
import { useGetLiveAttendanceQuery, useGetLiveClassQuery } from "../api/contentApi";
import { Loading, ErrorNote, DownloadButton } from "../components/bits";

// Who came to an in-app class and for how long, and who didn't.
const fmt = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");

export default function LiveAttendance() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: liveClassInfo } = useGetLiveClassQuery(id);
  // A webinar goes back to Webinars, else Live classes.
  const backTo = liveClassInfo?.kind === "webinar" ? { to: "/webinars", label: "Webinars" } : { to: "/live-classes", label: "Live classes" };
  const { data, isLoading, error, refetch, isFetching } = useGetLiveAttendanceQuery(id, { pollingInterval: 30000 });

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  const { liveClass, rows, absent, summary } = data;
  const students = rows.filter((r) => r.role === "student");
  const hosts = rows.filter((r) => r.role !== "student");
  const scheduled = liveClass.durationMinutes || 60;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <button className="btn btn-sm btn-quiet" onClick={() => navigate(backTo.to)}><ArrowLeft size={14} /> {backTo.label}</button>
          <h1 style={{ marginTop: 6 }}>Attendance · {liveClass.title}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {new Date(liveClass.scheduledAt).toLocaleString()} · {scheduled} min{liveClass.status === "live" ? " · live now, updates every 30 seconds" : ""}
          </p>
        </div>
        <div className="row-tight">
          <button className="btn btn-sm btn-quiet" disabled={isFetching} onClick={refetch}><RefreshCw size={14} /> Refresh</button>
          <DownloadButton filename="attendance.csv" href={`/api/live-classes/${id}/attendance?format=csv`}><Download size={14} /> Download CSV</DownloadButton>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div className="card-quiet"><div className="muted small row-tight"><Users size={13} /> Attended</div><div className="tnum" style={{ fontSize: 24, fontWeight: 500 }}>{summary.attended}</div></div>
        <div className="card-quiet"><div className="muted small row-tight"><UserX size={13} /> Absent</div><div className="tnum" style={{ fontSize: 24, fontWeight: 500 }}>{summary.absent}</div></div>
        <div className="card-quiet"><div className="muted small row-tight"><Clock size={13} /> Average time</div><div className="tnum" style={{ fontSize: 24, fontWeight: 500 }}>{summary.averageMinutes} min</div></div>
      </div>

      <div className="card stack" style={{ gap: 0 }}>
        <div className="live-att-row live-att-head"><span>Name</span><span>Time in class</span><span>Joined</span><span>Left</span><span>Joins</span></div>
        {[...hosts, ...students].map((r) => {
          const pct = Math.min(100, Math.round((r.minutes / scheduled) * 100));
          return (
            <div key={r.identity} className="live-att-row">
              <span>{r.name || r.identity} {r.role !== "student" && <span className="pill">Host</span>} {r.here && <span className="pill pill-ok">In the room</span>}</span>
              <span className="row-tight" style={{ gap: 8 }}>
                <span className="live-att-bar"><i style={{ width: `${pct}%` }} /></span>
                <span className="tnum small">{r.minutes} min</span>
              </span>
              <span className="small tnum">{fmt(r.firstJoined)}</span>
              <span className="small tnum">{r.here ? "—" : fmt(r.lastLeft)}</span>
              <span className="small tnum">{r.sessions}</span>
            </div>
          );
        })}
        {rows.length === 0 && <p className="hint">Nobody has joined yet.</p>}
      </div>

      {absent.length > 0 && (
        <div className="card stack" style={{ marginTop: 16 }}>
          <strong className="row-tight"><UserX size={15} /> Didn't join · {absent.length}</strong>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
            {absent.map((s) => <span key={s._id} className="pill">{s.name || s.email || s.phoneNumber}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
