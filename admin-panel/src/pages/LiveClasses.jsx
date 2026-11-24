import { useState } from "react";
import { Link, useNavigate, useSearchParams, useOutletContext } from "react-router-dom";
import {
  useGetLiveClassesQuery, useDeleteLiveClassMutation, useGetBatchesQuery,
  useStartLiveClassMutation, useEndLiveClassMutation,
} from "../api/contentApi";
import { Plus, Trash2, Pencil, Video, PlayCircle, Square, ExternalLink, Users, Film, NotebookPen, Wallet, UserCog, Copy, Check } from "lucide-react";
import { Loading, ErrorNote, Empty, useConfirm, Pager } from "../components/bits";
import { useTerms } from "../terms";
import TeacherClasses from "./TeacherClasses";
import { useSeen } from "../hooks/useSeen";
import SearchSelect from "../components/SearchSelect";

const STATUS_PILL = {
  scheduled: { label: "Scheduled", className: "pill" },
  live: { label: "Live", className: "pill pill-ok" },
  ended: { label: "Ended", className: "pill" },
  cancelled: { label: "Cancelled", className: "pill pill-warn" },
};

// Same two-step pattern as Notices/Lectures: browse here, edit on its own
// route. Row list rather than cards — nothing here has a cover image to
// justify the extra space a card gives.
// A teacher gets their own "My classes" view on the same route.
export default function LiveClasses() {
  const { me } = useOutletContext() || {};
  return me?.role === "teacher" ? <TeacherClasses /> : <AdminLiveClasses />;
}

// webinars: the Webinars page. Batch-free public sessions, same rows.
export function AdminLiveClasses({ webinars = false }) {
  const terms = useTerms();
  useSeen("recordings");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const confirm = useConfirm();

  const batch = params.get("batch") || "";
  const status = params.get("status") || "";
  const page = Number(params.get("page")) || 1;

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === undefined) next.delete(key);
    else next.set(key, value);
    // Any filter change re-searches from the top — a stale later page could
    // easily be past the end of the new, smaller result set.
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  const { data, isLoading, error } = useGetLiveClassesQuery({
    batch: webinars ? undefined : batch || undefined,
    kind: webinars ? "webinar" : undefined,
    status: status || undefined,
    page,
  });
  const { data: batches } = useGetBatchesQuery({}, { skip: webinars });
  const [copied, setCopied] = useState("");
  const copy = (slug) => {
    navigator.clipboard?.writeText(`${window.location.origin}/w/${slug}`);
    setCopied(slug);
    setTimeout(() => setCopied(""), 1500);
  };
  const [remove] = useDeleteLiveClassMutation();
  const [start] = useStartLiveClassMutation();
  const [end] = useEndLiveClassMutation();

  const classes = data?.liveClasses || [];

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>{webinars ? "Webinars" : "Live Classes"}</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {isLoading ? "…" : `${data?.total ?? classes.length} total`}
          </p>
        </div>
        <div className="row-tight">
          {!webinars && (
            <Link className="btn btn-quiet" to="/live-classes/taught">
              <Wallet size={15} /> Classes taught
            </Link>
          )}
          <Link className="btn" to={webinars ? "/webinars/new" : "/live-classes/new"}>
            <Plus size={15} /> {webinars ? "New webinar" : "Schedule class"}
          </Link>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={error} />

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {!webinars && (batches || []).length > 0 && (
            <SearchSelect
              className="pill pill-btn"
              style={{ maxWidth: 220 }}
              value={batch}
              onChange={(e) => setFilter("batch", e.target.value || undefined)}
            >
              <option value="">Every {terms.batch}</option>
              {batches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </SearchSelect>
          )}

          <select
            className="pill pill-btn"
            value={status}
            onChange={(e) => setFilter("status", e.target.value || undefined)}
          >
            <option value="">Any status</option>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="ended">Ended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        {isLoading ? (
          <Loading />
        ) : classes.length ? (
          <div className="stack" style={{ gap: 8 }}>
            {classes.map((lc) => {
              const pill = STATUS_PILL[lc.status];
              return (
                <div key={lc._id} className="card row-tight spread" style={{ padding: 14 }}>
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="row-tight" style={{ flexWrap: "wrap" }}>
                      <span className={pill.className}>{pill.label}</span>
                      {lc.batch?.name && <span className="pill">{lc.batch.name}</span>}
                      {lc.kind === "webinar" && !webinars && <span className="pill">Webinar · no {terms.batch}</span>}
                      {lc.public?.on && lc.public.closed && <span className="pill pill-warn">Link closed</span>}
                      <span className="pill">{lc.provider === "zoom" ? "Zoom" : lc.provider === "livekit" ? (lc.mode === "webinar" ? "In-app webinar" : "In-app class") : "Manual link"}</span>
                      {lc.secured && <span className="pill pill-ok">Secured</span>}
                      {lc.secured && (
                        <span className="pill" title="Students with a personal registered join link">
                          {lc.registrants?.length ?? 0} registered
                        </span>
                      )}
                      {lc.provider === "zoom" && lc.attendance?.length > 0 && (
                        <span className="pill" title="Best-effort — not matched to student accounts, see ZOOM_SETUP.md">
                          {new Set(lc.attendance.map((a) => a.externalParticipantId)).size} joined
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 500 }}>{lc.title}</div>
                    <div className="muted small">
                      {new Date(lc.scheduledAt).toLocaleString()} · {lc.durationMinutes} min · {lc.teachers?.length ? `taught by ${lc.teachers.map((t) => t.name).join(", ")}` : `hosted by ${lc.host?.name}`}
                    </div>
                    {lc.provider === "zoom" && lc.teachers?.length > 0 && ["scheduled", "live"].includes(lc.status) && (
                      <div className="hint row-tight" style={{ margin: 0, gap: 4 }}>
                        <UserCog size={12} /> In Zoom, make co-host when they join: {lc.teachers.map((t) => t.name).join(", ")}
                      </div>
                    )}
                  </div>

                  <div className="row-tight" style={{ flexWrap: "wrap" }}>
                    {lc.public?.on && lc.public.slug && (
                      <button className="btn btn-sm btn-quiet" title={`${window.location.origin}/w/${lc.public.slug}`} onClick={() => copy(lc.public.slug)}>
                        {copied === lc.public.slug ? <Check size={14} /> : <Copy size={14} />} {copied === lc.public.slug ? "Copied" : "Copy link"}
                      </button>
                    )}
                    {lc.provider === "livekit" && ["scheduled", "live"].includes(lc.status) && (
                      <button className="btn btn-sm btn-primary" onClick={() => navigate(`/live-classes/${lc._id}/room`)}>
                        <Video size={14} /> {lc.status === "live" ? "Rejoin classroom" : "Start in classroom"}
                      </button>
                    )}
                    {lc.status === "scheduled" && lc.provider !== "livekit" && (
                      <button className="btn btn-sm" onClick={() => start(lc._id)}>
                        <PlayCircle size={14} /> Start
                      </button>
                    )}
                    {lc.status === "live" && (
                      <>
                        {lc.hostUrl && (
                          <a className="btn btn-sm" href={lc.hostUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={14} /> Open
                          </a>
                        )}
                        <button
                          className="btn btn-sm"
                          onClick={async () => {
                            const yes = await confirm({
                              title: "End this class?",
                              body: "Students will no longer see it as live.",
                              confirmLabel: "End class",
                            });
                            if (yes) end(lc._id);
                          }}
                        >
                          <Square size={14} /> End
                        </button>
                      </>
                    )}
                    {lc.provider === "livekit" && lc.status !== "scheduled" && (
                      <Link className="btn btn-sm btn-quiet" to={`/live-classes/${lc._id}/attendance`}>
                        <Users size={14} /> Attendance
                      </Link>
                    )}
                    {lc.provider === "livekit" && lc.status !== "scheduled" && (
                      <Link className="btn btn-sm btn-quiet" to={`/live-classes/${lc._id}/recordings`}>
                        <Film size={14} /> Recordings{lc.recordings?.length ? ` · ${lc.recordings.filter((r) => r.decision !== "deleted").length}` : ""}
                        {lc.recordings?.some((r) => r.status === "ready" && r.decision === "pending") && (
                          <span className="tab-count tnum" title="Waiting for you to publish, keep private or delete">{lc.recordings.filter((r) => r.status === "ready" && r.decision === "pending").length}</span>
                        )}
                      </Link>
                    )}
                    {lc.provider === "livekit" && lc.status !== "scheduled" && (
                      <Link className="btn btn-sm btn-quiet" to={`/live-classes/${lc._id}/notes`}>
                        <NotebookPen size={14} /> Notes
                      </Link>
                    )}
                    <Link className="icon-btn" title="Edit" to={lc.kind === "webinar" ? `/webinars/${lc._id}/edit` : `/live-classes/${lc._id}/edit`}>
                      <Pencil size={14} />
                    </Link>
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Delete"
                      onClick={async () => {
                        const yes = await confirm({
                          title: `Delete "${lc.title}"?`,
                          body: "This cannot be undone.",
                          confirmLabel: "Delete",
                        });
                        if (yes) remove(lc._id);
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
            <Pager
              page={data?.page || 1}
              pages={data?.pages || 1}
              total={data?.total || 0}
              onChange={(next) => setFilter("page", String(next))}
            />
          </div>
        ) : (
          <Empty
            icon={Video}
            title={params.toString() ? "Nothing matches" : webinars ? "No webinars yet" : "No live classes yet"}
            hint={params.toString() ? "Try clearing a filter." : webinars ? "A public session anyone can join by link, with no batch. Their details go to Leads." : "Schedule a session for a batch."}
            action={
              !params.toString() && (
                <Link className="btn" to={webinars ? "/webinars/new" : "/live-classes/new"}><Plus size={15} /> {webinars ? "New webinar" : "Schedule class"}</Link>
              )
            }
          />
        )}
      </div>
    </div>
  );
}
