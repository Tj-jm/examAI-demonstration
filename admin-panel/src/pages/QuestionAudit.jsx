import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useGetAuditPoolQuery, useDecideAuditPoolMutation } from "../api/aiApi";
import { useUpdateQuestionMutation } from "../api/contentApi";
import { ArrowLeft, Check, Copy, ExternalLink, X } from "lucide-react";
import { Loading, ErrorNote, Empty, useConfirm } from "../components/bits";
import Latex from "../components/Latex";

const SEVERITY_PILL = { high: "pill-bad", medium: "pill-warn", low: "pill" };
const KIND_LABEL = {
  wrong_answer_key: "Wrong answer key",
  multiple_valid_answers: "Multiple valid answers",
  no_correct_answer: "No correct answer",
  ambiguous_wording: "Ambiguous wording",
  typo: "Typo",
  latex_error: "LaTeX error",
  other: "Other issue",
};

// One AI audit run, on its own page — same reasoning as Review.jsx: a
// result that already cost a real AI call belongs somewhere that survives a
// reload, a back-button, or just clicking away, not in a component's local
// state. The run itself (aiController.js's auditQuestionPool) is triggered
// from Questions.jsx, which lands here with the new audit's id.
export default function QuestionAudit() {
  const { id } = useParams();
  const { data: audit, isLoading, error } = useGetAuditPoolQuery(id, { refetchOnMountOrArgChange: true });
  const [decide, { isLoading: deciding }] = useDecideAuditPoolMutation();
  const [applyFix, applyState] = useUpdateQuestionMutation();
  const [busy, setBusy] = useState(null);
  const confirm = useConfirm();

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!audit) return null;

  const backTo = audit.chapter && audit.topic === "none"
    ? `/questions?chapter=${audit.chapter._id}&topic=none`
    : audit.topicTitle
    ? `/questions?topic=${typeof audit.topic === "object" ? audit.topic._id : audit.topic}`
    : audit.chapter
    ? `/questions?chapter=${audit.chapter._id}`
    : "/questions";

  // A hand-picked selection has no single filing to redisplay — just a
  // count of what went in.
  const scopeLabel = audit.selectionCount
    ? `${audit.selectionCount} selected question${audit.selectionCount === 1 ? "" : "s"}`
    : audit.chapter && audit.topic === "none"
    ? `${audit.chapter.title} — chapter pool`
    : audit.topicTitle || audit.chapter?.title || "Questions";

  const markIssue = async (index, status) => {
    setBusy(`issue-${index}`);
    await decide({ id, itemType: "issue", index, status });
    setBusy(null);
  };

  const markGroup = async (index, status) => {
    setBusy(`group-${index}`);
    await decide({ id, itemType: "duplicate", index, status });
    setBusy(null);
  };

  const applyIssueFix = async (issue, index) => {
    const yes = await confirm({
      title: "Apply this fix?",
      body: "Overwrites the question with the AI-suggested correction. You can still edit it by hand afterward.",
      confirmLabel: "Apply",
    });
    if (!yes) return;
    setBusy(`issue-${index}`);
    try {
      await applyFix({ id: issue.questionId, ...issue.fix }).unwrap();
      await decide({ id, itemType: "issue", index, status: "applied" });
    } catch {
      // rendered below via applyState.error
    }
    setBusy(null);
  };

  const openIssues = audit.issues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) => issue.status === "open");
  const openGroups = audit.duplicateGroups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.status === "open");
  const resolvedCount = audit.issues.length + audit.duplicateGroups.length - openIssues.length - openGroups.length;

  return (
    <div className="page">
      <div className="page-head">
        <Link to={backTo} className="btn btn-sm btn-quiet" style={{ marginBottom: 8 }}>
          <ArrowLeft size={14} /> Back to questions
        </Link>
        <h1>AI audit — {scopeLabel}</h1>
        <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
          Reviewed {audit.reviewed} of {audit.totalInPool}
          {audit.truncated ? " — pool is bigger than one pass covers; narrow the filter and run again for full coverage." : ""}
          {resolvedCount > 0 ? ` · ${resolvedCount} already decided` : ""}
        </p>
      </div>

      <div className="stack">
        <ErrorNote error={applyState.error} />

        {openIssues.length === 0 && openGroups.length === 0 ? (
          <Empty
            icon={Check}
            title={audit.issues.length === 0 && audit.duplicateGroups.length === 0 ? "No issues or duplicates found" : "Nothing left to decide"}
            hint={audit.issues.length === 0 && audit.duplicateGroups.length === 0 ? "This pool looked clean." : "Every flagged item has been applied or dismissed."}
          />
        ) : (
          <>
            {openIssues.map(({ issue, index }) => (
              <div className="card stack" key={`issue-${index}`}>
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  <span className={`pill ${SEVERITY_PILL[issue.severity] || "pill"}`}>{issue.severity}</span>
                  <span className="pill">{KIND_LABEL[issue.kind] || issue.kind}</span>
                  <span className="grow" />
                  <Link className="btn btn-sm btn-quiet" to={`/questions/${issue.questionId}`} state={{ from: "audit", auditId: id }}>
                    <ExternalLink size={13} /> Open
                  </Link>
                </div>

                <Latex as="div" className="prose small">{issue.preview}</Latex>
                <p className="small muted" style={{ margin: 0 }}>{issue.detail}</p>

                {issue.fix && (
                  <div className="card-quiet stack" style={{ gap: 6 }}>
                    <span className="label">Suggested fix</span>
                    {issue.fix.question && <Latex as="div" className="small">{issue.fix.question}</Latex>}
                    {issue.fix.options && (
                      <div className="stack" style={{ gap: 5 }}>
                        {issue.fix.options.map((o) => (
                          <div
                            key={o.key}
                            className={`banner small ${o.key === issue.fix.correctOption ? "banner-ok" : ""}`}
                            style={o.key === issue.fix.correctOption ? undefined : { background: "var(--surface-alt)", color: "var(--text)" }}
                          >
                            <span style={{ opacity: 0.6, marginRight: 8 }}>{o.key}</span>
                            <Latex>{o.text}</Latex>
                          </div>
                        ))}
                      </div>
                    )}
                    {issue.fix.statements && (
                      <div className="stack" style={{ gap: 5 }}>
                        {issue.fix.statements.map((s, i) => (
                          <div key={i} className="row-tight">
                            <span className={`pill ${s.isTrue ? "pill-ok" : "pill-bad"}`} style={{ minWidth: 52 }}>
                              {s.isTrue ? "True" : "False"}
                            </span>
                            <span className="grow small"><Latex>{s.text}</Latex></span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="row">
                  {issue.fix && (
                    <button
                      className="btn btn-sm btn-ok"
                      disabled={deciding || applyState.isLoading}
                      onClick={() => applyIssueFix(issue, index)}
                    >
                      <Check size={14} /> {busy === `issue-${index}` ? "Saving" : "Apply fix"}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-quiet"
                    disabled={deciding}
                    onClick={() => markIssue(index, "dismissed")}
                  >
                    <X size={14} /> Dismiss
                  </button>
                </div>
              </div>
            ))}

            {openGroups.map(({ group, index }) => (
              <div className="card stack" key={`group-${index}`}>
                <div className="row-tight">
                  <span className="label row-tight" style={{ gap: 4 }}><Copy size={12} /> Possible duplicate</span>
                  <span className="grow" />
                  <button
                    className="btn btn-sm btn-quiet"
                    disabled={deciding}
                    onClick={() => markGroup(index, "dismissed")}
                  >
                    <X size={14} /> Dismiss
                  </button>
                </div>
                <p className="small muted" style={{ margin: 0 }}>{group.reason}</p>
                {group.questions.map((q) => (
                  <div className="row-tight" key={q._id}>
                    <Latex as="div" className="grow small">{q.question}</Latex>
                    <Link className="btn btn-sm btn-quiet" to={`/questions/${q._id}`} state={{ from: "audit", auditId: id }}>
                      <ExternalLink size={13} /> Open
                    </Link>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
