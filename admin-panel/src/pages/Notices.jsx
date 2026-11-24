import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  useGetNoticesQuery, useDeleteNoticeMutation, useGetBatchesQuery,
} from "../api/contentApi";
import {
  Plus, Trash2, Pencil, Search, Megaphone, Users, Globe, Link2,
} from "lucide-react";
import { Loading, ErrorNote, Empty, Pager, useConfirm } from "../components/bits";
import NoticeCoverFallback from "../components/NoticeCoverFallback";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";

const STATUS_PILL = {
  draft: { label: "Draft", className: "pill pill-warn" },
  scheduled: { label: "Scheduled", className: "pill" },
  live: { label: "Live", className: "pill pill-ok" },
  expired: { label: "Expired", className: "pill" },
};

// Cards, not rows — the cover image is the whole point of scanning quickly,
// and a table row has nowhere to put one. Same two-step (browse here, edit
// on its own route) every other content type in this app already uses.
export default function Notices() {
  const terms = useTerms();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const confirm = useConfirm();

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === undefined || next.get(key) === value) next.delete(key);
    else next.set(key, value);
    // Any real filter change invalidates the page you were on — same reason
    // Questions.jsx does this: page 4 of a fresh filter is unlikely to still
    // have four pages, and landing there silently reads as "no results".
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  const page = Number(params.get("page")) || 1;
  const type = params.get("type") || "";
  const status = params.get("status") || "";
  const batch = params.get("batch") || "";

  const { data, isLoading, error } = useGetNoticesQuery({
    type: type || undefined,
    status: status || undefined,
    batch: batch || undefined,
    search: params.get("search") || undefined,
    page,
    limit: 12,
  });
  const { data: batches } = useGetBatchesQuery({});
  const [remove] = useDeleteNoticeMutation();

  const submitSearch = (event) => {
    event.preventDefault();
    setFilter("search", search || undefined);
  };

  const notices = data?.notices || [];

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Notices</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {isLoading ? "…" : `${data?.total ?? 0} total`}
          </p>
        </div>
        <Link className="btn" to="/notices/new">
          <Plus size={15} /> New notice
        </Link>
      </div>

      <div className="stack">
        <ErrorNote error={error} />

        <form onSubmit={submitSearch} className="search-wrap">
          <Search size={15} className="search-icon" />
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            placeholder="Search notices"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          <button className={`pill pill-btn${!type ? " pill-on" : ""}`} onClick={() => setFilter("type", undefined)}>
            All
          </button>
          <button
            className={`pill pill-btn row-tight${type === "general" ? " pill-on" : ""}`}
            style={{ gap: 4 }}
            onClick={() => setFilter("type", "general")}
          >
            <Globe size={11} /> General
          </button>
          <button
            className={`pill pill-btn row-tight${type === "batch" ? " pill-on" : ""}`}
            style={{ gap: 4 }}
            onClick={() => setFilter("type", "batch")}
          >
            <Users size={11} /> Batch
          </button>

          {/* Meaningful on its own, even with type left on "All" — picking a
              batch here already implies "batch" notices, since general ones
              have none. */}
          {(batches || []).length > 0 && (
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
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {isLoading ? (
          <Loading />
        ) : notices.length ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              {notices.map((notice) => {
                const pill = STATUS_PILL[notice.status];
                return (
                  <div
                    key={notice._id}
                    className="card stack"
                    style={{ cursor: "pointer", gap: 10, padding: 0, overflow: "hidden" }}
                    onClick={() => navigate(`/notices/${notice._id}/edit`)}
                  >
                    <div style={{ height: 110, background: "var(--surface)" }}>
                      {notice.coverImage?.url ? (
                        <img
                          src={notice.coverImage.url}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <NoticeCoverFallback />
                      )}
                    </div>

                    <div className="stack" style={{ gap: 10, padding: "0 14px 14px" }}>
                      <div className="row-tight" style={{ flexWrap: "wrap" }}>
                        <span className={pill.className}>{pill.label}</span>
                        <span className="pill row-tight" style={{ gap: 4 }}>
                          {notice.noticeType === "general" ? <Globe size={11} /> : <Users size={11} />}
                          {notice.noticeType === "general" ? "General" : `${notice.batches.length} batch${notice.batches.length === 1 ? "" : "es"}`}
                        </span>
                        {notice.link && (
                          <span className="pill row-tight" style={{ gap: 4 }}><Link2 size={11} /> Link</span>
                        )}
                      </div>

                      <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{notice.title}</div>

                      {notice.noticeType === "batch" && notice.batches.length > 0 && (
                        <div className="muted small">
                          {notice.batches.slice(0, 3).map((b) => b.name).join(", ")}
                          {notice.batches.length > 3 ? ` +${notice.batches.length - 3} more` : ""}
                        </div>
                      )}

                      <div
                        className="row-tight spread"
                        style={{ paddingTop: 10, borderTop: "1px solid var(--border)" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="muted small">
                          {new Date(notice.createdAt).toLocaleDateString()}
                        </span>
                        <div className="row-tight">
                          <Link className="icon-btn" title="Edit" to={`/notices/${notice._id}/edit`}>
                            <Pencil size={14} />
                          </Link>
                          <button
                            className="icon-btn icon-btn-danger"
                            title="Delete notice"
                            onClick={async () => {
                              const yes = await confirm({
                                title: `Delete "${notice.title}"?`,
                                body: notice.status === "live"
                                  ? "It is currently live — students will stop seeing it immediately."
                                  : "This cannot be undone.",
                                confirmLabel: "Delete",
                              });
                              if (yes) remove(notice._id);
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Pager page={data.page} pages={data.pages} total={data.total} onChange={(n) => setFilter("page", String(n))} />
          </>
        ) : (
          <Empty
            icon={Megaphone}
            title={params.toString() ? "Nothing matches" : "No notices yet"}
            hint={params.toString() ? "Try clearing a filter." : `Post something for a ${terms.batch}, or everyone at once.`}
            action={
              !params.toString() && (
                <Link className="btn" to="/notices/new"><Plus size={15} /> New notice</Link>
              )
            }
          />
        )}
      </div>
    </div>
  );
}
