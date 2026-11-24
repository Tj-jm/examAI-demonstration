import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuditQuestionPoolMutation } from "../api/aiApi";
import { useUpdateQuestionMutation } from "../api/contentApi";
import { Sparkles, Copy, Check, X, ExternalLink } from "lucide-react";
import { ErrorNote, useConfirm } from "./bits";
import Latex from "./Latex";

const SEVERITY_PILL = { high: "pill-bad", medium: "pill-warn", low: "pill" };
const KIND_LABEL = {
  wrong_answer_key: "Wrong answer key",
  multiple_valid_answers: "Multiple valid answers",
  no_correct_answer: "No correct answer",
  ambiguous_wording: "Ambiguous wording",
  typo: "Typo",
  other: "Other issue",
};

// Scoped to one topic or one chapter's pool at a time — same filing
// convention (topic: "none" for the pool) every other filter in Questions.jsx
// uses. Reviews only; nothing is written to a question until "Apply fix" is
// clicked, which goes through the normal PUT /questions/:id endpoint — this
// panel never has write access of its own.
export default function QuestionAuditPanel({ chapter, topic, onClose }) {
  const [runAudit, { isLoading, error }] = useAuditQuestionPoolMutation();
  const [applyFix, applyState] = useUpdateQuestionMutation();
  const [result, setResult] = useState(null);
  // Keyed on questionId+kind+detail rather than just questionId — a single
  // question can carry more than one issue, and dismissing one shouldn't
  // hide the other.
  const [dismissed, setDismissed] = useState(new Set());
  // Per suggestion, not per question: one question can get two fixes.
  const [applied, setApplied] = useState(new Set());
  const confirm = useConfirm();

  const run = async () => {
    setResult(null);
    setDismissed(new Set());
    setApplied(new Set());
    try {
      setResult(await runAudit({ chapter, topic }).unwrap());
    } catch {
      // rendered below via `error`
    }
  };

  const doApplyFix = async (issue) => {
    const yes = await confirm({
      title: "Apply this fix?",
      body: "Overwrites the question with the AI-suggested correction. You can still edit it by hand afterward.",
      confirmLabel: "Apply",
    });
    if (!yes) return;
    try {
      await applyFix({ id: issue.questionId, ...issue.fix }).unwrap();
      setApplied((prev) => new Set(prev).add(issueKey(issue)));
    } catch {
      // rendered below via applyState.error
    }
  };

  const issueKey = (issue) => `${issue.questionId}:${issue.kind}:${issue.detail}`;
  const visibleIssues = (result?.issues || []).filter((i) => !dismissed.has(issueKey(i)));

  return (
    <div className="card-quiet stack">
      <div className="row-tight" style={{ justifyContent: "space-between" }}>
        <p className="hint" style={{ margin: 0 }}>
          Reviews every question in this pool for answer-key errors, ambiguous wording, and near-duplicates.
          Nothing changes until you apply a fix.
        </p>
        <button className="icon-btn" title="Close" onClick={onClose}><X size={15} /></button>
      </div>

      <ErrorNote error={error || applyState.error} />

      <div className="row-tight">
        <button className="btn btn-sm" disabled={isLoading} onClick={run}>
          <Sparkles size={14} /> {isLoading ? "Auditing…" : result ? "Run again" : "Run audit"}
        </button>
        {result && (
          <span className="muted small">
            Reviewed {result.reviewed} of {result.totalInPool}
            {result.truncated ? " — pool is bigger than one pass covers; narrow the filter for full coverage." : ""}
          </span>
        )}
      </div>

      {result && visibleIssues.length === 0 && result.duplicateGroups.length === 0 && (
        <div className="banner banner-ok">No issues or duplicates found.</div>
      )}

      {visibleIssues.map((issue) => {
        const key = issueKey(issue);
        return (
          <div className="card stack" key={key} style={{ gap: 8 }}>
            <div className="row-tight" style={{ flexWrap: "wrap" }}>
              <span className={`pill ${SEVERITY_PILL[issue.severity] || "pill"}`}>{issue.severity}</span>
              <span className="pill">{KIND_LABEL[issue.kind] || issue.kind}</span>
              <span className="grow" />
              <Link className="btn btn-sm btn-quiet" to={`/questions/${issue.questionId}`}>
                <ExternalLink size={13} /> Open
              </Link>
            </div>
            <Latex as="div" className="small">{issue.preview}</Latex>
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
                  disabled={applyState.isLoading || applied.has(issueKey(issue))}
                  onClick={() => doApplyFix(issue)}
                >
                  <Check size={14} /> {applied.has(issueKey(issue)) ? "Applied" : "Apply fix"}
                </button>
              )}
              <button className="btn btn-sm btn-quiet" onClick={() => setDismissed((prev) => new Set(prev).add(key))}>
                Dismiss
              </button>
            </div>
          </div>
        );
      })}

      {result?.duplicateGroups.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="label row-tight" style={{ gap: 4 }}><Copy size={12} /> Possible duplicates</span>
          {result.duplicateGroups.map((group, i) => (
            <div className="card stack" key={i} style={{ gap: 8 }}>
              <p className="small muted" style={{ margin: 0 }}>{group.reason}</p>
              {group.questions.map((q) => (
                <div className="row-tight" key={q._id}>
                  <Latex as="div" className="grow small">{q.question}</Latex>
                  <Link className="btn btn-sm btn-quiet" to={`/questions/${q._id}`}>
                    <ExternalLink size={13} /> Open
                  </Link>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
