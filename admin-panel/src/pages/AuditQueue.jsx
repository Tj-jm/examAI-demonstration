import { useState } from "react";
import { Link } from "react-router-dom";
import { useGetOpenAuditsQuery } from "../api/aiApi";
import { ShieldAlert, ChevronRight, Sparkles } from "lucide-react";
import { Loading, ErrorNote, Empty, Pager } from "../components/bits";

// The permanent home for every audit run that still has something
// undecided — same role Review.jsx plays for generated questions. An audit
// run used to only exist on the one results page it landed on; opening a
// flagged question and clicking back (or just closing the tab) meant it was
// effectively gone even though the data was safe in the database the whole
// time. This page, and the sidebar badge that counts it, is what makes it
// findable again without knowing its URL.
export default function AuditQueue() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useGetOpenAuditsQuery({ page }, { refetchOnMountOrArgChange: true });
  const audits = data?.audits;

  if (isLoading) return <Loading />;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Audits</h1>
        <p className="muted small" style={{ margin: "2px 0 0" }}>
          AI-flagged question issues and duplicates waiting on a decision. Run a new one from a topic
          or chapter pool in Questions, or from a selection there.
        </p>
      </div>

      <div className="stack">
        <ErrorNote error={error} />

        {audits?.length === 0 ? (
          <Empty
            icon={ShieldAlert}
            title="Nothing waiting"
            hint="Every flagged issue and duplicate has been applied or dismissed."
            action={<Link className="btn" to="/questions"><Sparkles size={15} /> Go run an audit</Link>}
          />
        ) : (
          <>
            {audits?.map((audit) => {
              const scopeLabel = audit.selectionCount
                ? `${audit.selectionCount} selected question${audit.selectionCount === 1 ? "" : "s"}`
                : audit.chapter && audit.topic === "none"
                ? `${audit.chapter.title} — chapter pool`
                : audit.topicTitle || audit.chapter?.title || "Questions";

              return (
                <Link className="card row-tight" key={audit._id} to={`/audit-pool/${audit._id}`}>
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>{scopeLabel}</div>
                    <div className="muted small" style={{ marginTop: 2 }}>
                      {audit.openIssues > 0 && `${audit.openIssues} issue${audit.openIssues === 1 ? "" : "s"}`}
                      {audit.openIssues > 0 && audit.openDuplicateGroups > 0 && " · "}
                      {audit.openDuplicateGroups > 0 && `${audit.openDuplicateGroups} duplicate group${audit.openDuplicateGroups === 1 ? "" : "s"}`}
                      {" "}waiting
                    </div>
                  </div>
                  <ChevronRight size={16} className="muted" />
                </Link>
              );
            })}
            <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
