import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Video, ExternalLink, Download, NotebookPen, Film, Users, Clock, CalendarCheck, Info } from "lucide-react";
import { useGetLiveClassesQuery, useGetLiveTaughtQuery, useJoinLiveClassMutation, useGetUsersQuery } from "../api/contentApi";
import { Loading, ErrorNote, Empty, Pager } from "../components/bits";
import SearchSelect from "../components/SearchSelect";

const PROVIDER = { zoom: "Zoom", livekit: "In-app", manual: "Link" };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthRange = (month) => {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 0, 23, 59, 59).toISOString() };
};
const hours = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

// A teacher's "My classes": upcoming classes they take, with a Join button,
// and past classes with the minutes they taught, for payment. Teachers
// can't schedule, edit or delete classes. Admins open the payment half at
// /live-classes/taught, with a teacher picker.
export default function TeacherClasses({ admin = false }) {
  const [tab, setTab] = useState(admin ? "past" : "upcoming");
  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>{admin ? "Classes taught" : "My classes"}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {admin ? "Minutes each teacher spent in their classes, for payment." : "Classes you're assigned to take. An admin schedules and edits them."}
          </p>
        </div>
        {admin && <Link className="btn btn-sm btn-quiet" to="/live-classes">Live classes</Link>}
      </div>
      {!admin && (
        <div className="row-tight" style={{ marginBottom: 12 }}>
          <button className={`pill pill-btn${tab === "upcoming" ? " pill-on" : ""}`} onClick={() => setTab("upcoming")}>Upcoming</button>
          <button className={`pill pill-btn${tab === "past" ? " pill-on" : ""}`} onClick={() => setTab("past")}>Past</button>
        </div>
      )}
      {tab === "upcoming" ? <Upcoming /> : <Past admin={admin} />}
    </div>
  );
}

function Upcoming() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetLiveClassesQuery({ when: "upcoming", page }, { pollingInterval: 60000 });
  const [join, { isLoading: joining, error: joinError }] = useJoinLiveClassMutation();
  const classes = data?.liveClasses || [];

  const open = async (lc) => {
    if (lc.provider === "livekit") return navigate(`/live-classes/${lc._id}/room`);
    // Opened before the request so the browser doesn't block it as a popup.
    const tab = window.open("", "_blank");
    const result = await join(lc._id);
    if (result.data?.joinUrl && tab) tab.location.href = result.data.joinUrl;
    else tab?.close();
  };

  if (isLoading) return <Loading />;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ErrorNote error={error || joinError} />
      {classes.length === 0 ? (
        <Empty icon={Video} title="No upcoming classes" hint="Classes an admin assigns to you show up here." />
      ) : (
        classes.map((lc) => (
          <div key={lc._id} className="card row-tight spread" style={{ padding: 14, flexWrap: "wrap" }}>
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              <div className="row-tight" style={{ flexWrap: "wrap" }}>
                {lc.status === "live" ? <span className="pill pill-ok">Live</span> : <span className="pill">Scheduled</span>}
                <span className="pill">{lc.batch?.name}</span>
                <span className="pill">{PROVIDER[lc.provider]}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{lc.title}</div>
              <div className="muted small">
                {new Date(lc.scheduledAt).toLocaleString()} · {lc.durationMinutes} min
                {lc.teachers?.length > 1 && ` · with ${lc.teachers.map((t) => t.name).join(", ")}`}
              </div>
              {lc.provider === "zoom" && (
                <div className="hint row-tight" style={{ margin: 0, gap: 4 }}>
                  <Info size={12} /> You join with the class link. The admin makes you co-host in Zoom so you can talk and share your screen.
                </div>
              )}
            </div>
            <div className="row-tight">
              <button className="btn btn-sm btn-primary" disabled={joining} onClick={() => open(lc)}>
                {lc.provider === "livekit" ? <Video size={14} /> : <ExternalLink size={14} />}
                {lc.provider === "livekit" ? (lc.status === "live" ? "Join classroom" : "Open classroom") : "Join"}
              </button>
              {lc.provider === "livekit" && lc.status === "live" && (
                <Link className="btn btn-sm btn-quiet" to={`/live-classes/${lc._id}/notes`}><NotebookPen size={14} /> Notes</Link>
              )}
            </div>
          </div>
        ))
      )}
      {classes.length > 0 && <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />}
    </div>
  );
}

function Past({ admin }) {
  const [month, setMonth] = useState(thisMonth());
  const [teacher, setTeacher] = useState("");
  const range = monthRange(month);
  const params = { ...range, ...(admin && teacher ? { teacher } : {}) };
  const { data, isLoading, error } = useGetLiveTaughtQuery(params);
  const { data: users } = useGetUsersQuery({ role: "teacher", limit: 100 }, { skip: !admin });
  const csv = `/api/live-classes/taught?${new URLSearchParams({ ...params, format: "csv" })}`;
  const rows = data?.rows || [];

  return (
    <div className="stack">
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        <input type="month" className="input" style={{ width: "auto" }} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        {admin && (
          <SearchSelect className="input" style={{ width: "auto" }} value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">Every teacher</option>
            {(users?.users || []).map((u) => <option key={u.id || u._id} value={u.id || u._id}>{u.name}</option>)}
          </SearchSelect>
        )}
        <div style={{ flex: 1 }} />
        <a className="btn btn-sm" href={csv}><Download size={14} /> Download CSV</a>
      </div>
      <ErrorNote error={error} />
      {isLoading ? <Loading /> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <div className="card-quiet"><div className="muted small row-tight"><CalendarCheck size={13} /> Classes</div><div className="tnum" style={{ fontSize: 24, fontWeight: 500 }}>{data?.summary.classes ?? 0}</div></div>
            <div className="card-quiet"><div className="muted small row-tight"><Clock size={13} /> Scheduled</div><div className="tnum" style={{ fontSize: 24, fontWeight: 500 }}>{hours(data?.summary.scheduledMinutes || 0)}</div></div>
            <div className="card-quiet"><div className="muted small row-tight"><Users size={13} /> Taught</div><div className="tnum" style={{ fontSize: 24, fontWeight: 500 }}>{hours(data?.summary.minutesTaught || 0)}</div></div>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            In-app classes count the exact time each teacher was in the room. Zoom matches the teacher's name or email from Zoom's join records, so check it. Manual links have no record.
          </p>
          {rows.length === 0 ? (
            <Empty icon={CalendarCheck} title="No classes this month" hint="Past classes show up here once their time has passed." />
          ) : (
            <div className="card" style={{ padding: 0, overflowX: "auto" }}>
              <table className="table">
                <thead>
                  <tr><th>Date</th><th>Class</th>{admin && <th>Teacher</th>}<th>Scheduled</th><th>Taught</th><th>Students</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.liveClass}:${r.teacher._id}`}>
                      <td className="tnum small" style={{ whiteSpace: "nowrap" }}>{new Date(r.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td>{r.title}<div className="muted small">{r.batch} · {PROVIDER[r.provider]}{r.status !== "ended" ? ` · ${r.status}` : ""}</div></td>
                      {admin && <td>{r.teacher.name}</td>}
                      <td className="tnum">{r.scheduledMinutes} min</td>
                      <td className="tnum">{r.minutesTaught === null ? "—" : `${r.minutesTaught} min`}</td>
                      <td className="tnum">{r.students ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {r.provider === "livekit" && (
                          <>
                            <Link className="icon-btn" title="Notes" to={`/live-classes/${r.liveClass}/notes`}><NotebookPen size={14} /></Link>
                            <Link className="icon-btn" title="Recordings" to={`/live-classes/${r.liveClass}/recordings`}><Film size={14} /></Link>
                            <Link className="icon-btn" title="Attendance" to={`/live-classes/${r.liveClass}/attendance`}><Users size={14} /></Link>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
