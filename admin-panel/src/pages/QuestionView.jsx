import { useState } from "react";
import VideoFrame from "../components/VideoFrame";
import { Link, useLocation, useNavigate, useParams, useOutletContext } from "react-router-dom";
import {
  Pencil, Trash2, ArrowLeft, Check, X, Sparkles, FileDown, AlertTriangle, FileText, Loader2,
  Paperclip, ExternalLink,
} from "lucide-react";
import {
  useGetQuestionQuery,
  useDeleteQuestionMutation,
  useUpdateQuestionMutation,
} from "../api/contentApi";
import {
  useBackfillSolutionsMutation,
  useDecideSolutionReviewMutation,
  useBackfillSkillTypesMutation,
  useReviewQuestionMutation,
} from "../api/aiApi";
import { Loading, ErrorNote, TypePill, useConfirm, typeLabel } from "../components/bits";
import Latex from "../components/Latex";
import { BankFiling, ServingLectures } from "../components/BankFiling";
import VideoLessonPanel from "../components/VideoLessonPanel";
import { skillTypeLabel } from "../constants/skillTypes";

// One true/false statement's share of the question's marks, as shown to
// the admin (scoring: backend submissionModel's scoreObjectiveAnswer).
const shareText = (marks, count) => {
  const share = count > 0 ? (Number(marks) || 0) / count : 0;
  return String(Math.round(share * 100) / 100);
};

const SEVERITY_PILL = { high: "pill-bad", medium: "pill-warn", low: "pill" };
const REVIEW_KIND_LABEL = {
  wrong_answer_key: "Wrong answer key",
  multiple_valid_answers: "Multiple valid answers",
  no_correct_answer: "No correct answer",
  ambiguous_wording: "Ambiguous wording",
  typo: "Typo",
  latex_error: "LaTeX error",
  wrong_skill_type: "Wrong skill type",
  wrong_difficulty: "Wrong difficulty",
  other: "Other issue",
};

// Reading a question and editing one are different jobs. This shows it the way
// a student meets it — options in order, correct answer marked, solution
// underneath — so a teacher can check it at a glance without a form in the way.
export default function QuestionView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  // Set by QuestionAudit.jsx's "Open" link — the only way back to a
  // specific audit run without it, once here, was the browser's own back
  // button, which a click through to Edit (a real navigation, not a modal)
  // throws away. Carried forward onto the Edit link below so the editor's
  // own back button (see QuestionEditor.jsx's cameFromAudit) keeps working
  // too, not just this page's.
  const auditBack = location.state?.from === "audit" ? location.state.auditId : null;
  // Opened from the Archive: Back returns there, with its filters.
  const archiveBack = location.state?.from === "archive" ? location.state.back || "/archive" : null;

  const { data: question, isLoading, error } = useGetQuestionQuery(id);
  const [remove, { error: deleteError }] = useDeleteQuestionMutation();
  const [backfill, backfillState] = useBackfillSolutionsMutation();
  const [decideSolution, { isLoading: decidingSolution }] = useDecideSolutionReviewMutation();
  const [classifySkill, classifySkillState] = useBackfillSkillTypesMutation();
  // A 200 response with the question still unclassified is not success —
  // the endpoint returns written/failed per-id rather than an HTTP error,
  // since one bad question in a batch shouldn't fail the others. Without
  // reading this, a rejected classification looked like nothing happened.
  const [skillFailReason, setSkillFailReason] = useState(null);

  const runClassifySkill = async () => {
    setSkillFailReason(null);
    try {
      const result = await classifySkill({ questionIds: [id] }).unwrap();
      if (result.failed?.length) setSkillFailReason(result.failed[0].reason);
    } catch {
      // network/HTTP-level errors render via classifySkillState.error below
    }
  };

  // One-question AI audit — the single-question sibling of QuestionAudit.jsx's
  // bulk run. Kept in local state rather than a persisted document: it's
  // reviewed right here on the page it was run from, and re-running costs one
  // click, unlike the pool audit which is worth surviving a reload.
  const [review, reviewState] = useReviewQuestionMutation();
  const [reviewResult, setReviewResult] = useState(null);
  const [applyFix, applyFixState] = useUpdateQuestionMutation();

  const runReview = async () => {
    setReviewResult(null);
    try {
      const result = await review(id).unwrap();
      setReviewResult(result);
    } catch {
      // rendered via reviewState.error below
    }
  };

  const applyReviewFix = async () => {
    const yes = await confirm({
      title: "Apply this fix?",
      body: "Overwrites the question with the AI-suggested correction. You can still edit it by hand afterward.",
      confirmLabel: "Apply",
    });
    if (!yes) return;
    try {
      await applyFix({ id, ...reviewResult.fix }).unwrap();
      setReviewResult(null);
    } catch {
      // rendered via applyFixState.error below
    }
  };

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const destroy = async () => {
    const yes = await confirm({
      title: "Delete this question?",
      body: "It will be removed from the bank. Questions used by an exam cannot be deleted.",
    });
    if (!yes) return;

    try {
      await remove(id).unwrap();
      navigate(archiveBack || "/questions");
    } catch {
      // rendered below
    }
  };

  const rubricTotal = (question.rubric || []).reduce((sum, r) => sum + (r.marks || 0), 0);
  const rubricMismatch = question.type === "written" && question.rubric?.length > 0 &&
    rubricTotal !== question.marks;

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="grow">
          <div className="row-tight" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <TypePill type={question.type} />
            <span className="pill">{question.difficulty}</span>
            <span className="pill tnum">
              {question.marks} mark{question.marks === 1 ? "" : "s"}
            </span>
            {question.type === "mcq" && question.negativeMarks > 0 && (
              <span className="pill pill-bad tnum">−{question.negativeMarks} if wrong</span>
            )}
            {question.source === "ai" && (
              <span className="pill pill-ai row-tight" style={{ gap: 4 }}>
                <Sparkles size={11} /> Written by AI
              </span>
            )}
            {question.status === "pending_review" && (
              <span className="pill pill-warn">Awaiting review</span>
            )}
            {question.lectureQuizOnly && <span className="pill">Lecture quiz only</span>}
            {question.skillType && (
              <span className="pill row-tight" style={{ gap: 6 }}>
                {skillTypeLabel(question.skillType)}
                <button
                  className="btn-icon"
                  title="Re-classify with AI"
                  disabled={classifySkillState.isLoading}
                  onClick={runClassifySkill}
                  style={{ border: "none", background: "none", cursor: "pointer", display: "inline-flex", padding: 0 }}
                >
                  {classifySkillState.isLoading
                    ? <Loader2 size={11} className="spin" />
                    : <Sparkles size={11} />}
                </button>
              </span>
            )}
          </div>

          <p className="muted small" style={{ margin: 0 }}>
            {[question.subject?.title, question.chapter?.title, question.topic?.title]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {question.lectures?.length > 0 && (
            <div style={{ marginTop: 6 }}><ServingLectures lectures={question.lectures} /></div>
          )}
          {question.lectureQuizOnly && (
            <div style={{ marginTop: 10, maxWidth: 640 }}>
              <BankFiling
                key={question._id}
                question={question}
                startChapter={question.chapter?._id || ""}
                startTopic={question.topic?._id || ""}
                hint="This question lives only in the lecture quizzes above. Adding it puts it in the question bank: the Questions page, the exam builder and practice. It stays in those quizzes."
              />
            </div>
          )}
        </div>

        <div className="row-tight">
            {auditBack ? (
              <Link className="btn btn-sm btn-quiet" to={`/audit-pool/${auditBack}`}>
                <ArrowLeft size={14} /> Back to audit
              </Link>
            ) : archiveBack ? (
              <Link className="btn btn-sm btn-quiet" to={archiveBack}>
                <ArrowLeft size={14} /> Archive
              </Link>
            ) : (
              <Link className="btn btn-sm btn-quiet" to="/questions">
                <ArrowLeft size={14} /> Bank
              </Link>
            )}
          <Link
            className="btn btn-sm"
            to={`/questions/${id}/edit`}
            state={auditBack ? { from: "audit", auditId: auditBack } : archiveBack ? location.state : undefined}
          >
            <Pencil size={14} /> Edit
          </Link>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={deleteError} />

        {rubricMismatch && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>
              The rubric adds up to {rubricTotal} but the question is worth {question.marks}.
              AI grading will use the rubric.
            </span>
          </div>
        )}

        {question.type === "written" && (!question.rubric || question.rubric.length === 0) && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>No rubric. Every answer to this question needs marking by hand.</span>
          </div>
        )}

        {/* ---------------- the question itself ---------------- */}
        <div className="card stack">
          <Latex as="div" className="prose">{question.question}</Latex>

          {question.questionImage?.url && (
            <img
              src={question.questionImage.url}
              alt=""
              style={{ maxWidth: "100%", borderRadius: 10 }}
            />
          )}

          {question.type === "mcq" && (
            <div className="stack" style={{ gap: 6 }}>
              {question.options?.map((option) => {
                const correct = option.key === question.correctOption;
                return (
                  <div
                    key={option.key}
                    className="row-tight"
                    style={{
                      padding: "11px 13px",
                      borderRadius: 10,
                      background: correct ? "var(--correct-bg)" : "var(--surface-alt)",
                      color: correct ? "var(--correct)" : "var(--text)",
                    }}
                  >
                    <span style={{ opacity: 0.55, minWidth: 16 }}>{option.key}</span>
                    <span className="grow">
                      <Latex>{option.text}</Latex>
                      {option.image?.url && (
                        <img
                          src={option.image.url}
                          alt=""
                          style={{ display: "block", maxHeight: 120, marginTop: 6, borderRadius: 8 }}
                        />
                      )}
                    </span>
                    {correct && <Check size={16} />}
                  </div>
                );
              })}
            </div>
          )}

          {question.type === "mtf" && (
            <div className="stack" style={{ gap: 6 }}>
              {question.statements?.map((statement, index) => (
                <div
                  key={index}
                  className="row-tight"
                  style={{ padding: "10px 13px", borderRadius: 10, background: "var(--surface-alt)" }}
                >
                  <span
                    className={`pill ${statement.isTrue ? "pill-ok" : "pill-bad"} row-tight`}
                    style={{ gap: 4, minWidth: 62 }}
                  >
                    {statement.isTrue ? <Check size={11} /> : <X size={11} />}
                    {statement.isTrue ? "True" : "False"}
                  </span>
                  <span className="grow"><Latex>{statement.text}</Latex></span>
                </div>
              ))}
              <p className="hint" style={{ margin: 0 }}>
                Each statement: +{shareText(question.marks, question.statements.length)} if right, −{shareText(question.marks, question.statements.length)} if wrong, 0 if blank.
              </p>
            </div>
          )}

          {question.type === "written" && question.wordLimit && (
            <p className="hint" style={{ margin: 0 }}>
              Students are asked for about {question.wordLimit} words.
            </p>
          )}
        </div>

        {/* ---------------- AI audit ---------------- */}
        <div className="card stack">
          <div className="spread">
            <div className="row-tight">
              <Sparkles size={14} />
              <h2>AI audit</h2>
            </div>
            <button className="btn btn-sm btn-quiet" disabled={reviewState.isLoading} onClick={runReview}>
              {reviewState.isLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {reviewState.isLoading ? "Checking" : reviewResult ? "Check again" : "Check with AI"}
            </button>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            Checks for a wrong answer key, ambiguous wording, broken LaTeX, and a mismatched skill type or difficulty.
          </p>

          <ErrorNote error={reviewState.error} />
          <ErrorNote error={applyFixState.error} />

          {reviewResult && reviewResult.clean && (
            <div className="banner banner-ok row-tight">
              <Check size={16} /> No issues found.
            </div>
          )}

          {reviewResult && !reviewResult.clean && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="stack" style={{ gap: 6 }}>
                {reviewResult.issues.map((issue, i) => (
                  <div key={i} className="row-tight" style={{ alignItems: "flex-start" }}>
                    <span className={`pill ${SEVERITY_PILL[issue.severity] || "pill"}`}>{issue.severity}</span>
                    <span className="pill">{REVIEW_KIND_LABEL[issue.kind] || issue.kind}</span>
                    <span className="small grow">{issue.detail}</span>
                  </div>
                ))}
              </div>

              {reviewResult.fix && (
                <div className="card-quiet stack" style={{ gap: 6 }}>
                  <span className="label">Suggested fix</span>

                  {reviewResult.fix.question && (
                    <Latex as="div" className="small">{reviewResult.fix.question}</Latex>
                  )}

                  {reviewResult.fix.options && (
                    <div className="stack" style={{ gap: 5 }}>
                      {reviewResult.fix.options.map((o) => (
                        <div
                          key={o.key}
                          className={`banner small ${o.key === reviewResult.fix.correctOption ? "banner-ok" : ""}`}
                          style={o.key === reviewResult.fix.correctOption ? undefined : { background: "var(--surface-alt)", color: "var(--text)" }}
                        >
                          <span style={{ opacity: 0.6, marginRight: 8 }}>{o.key}</span>
                          <Latex>{o.text}</Latex>
                        </div>
                      ))}
                    </div>
                  )}

                  {reviewResult.fix.statements && (
                    <div className="stack" style={{ gap: 5 }}>
                      {reviewResult.fix.statements.map((s, i) => (
                        <div key={i} className="row-tight">
                          <span className={`pill ${s.isTrue ? "pill-ok" : "pill-bad"}`} style={{ minWidth: 52 }}>
                            {s.isTrue ? "True" : "False"}
                          </span>
                          <span className="grow small"><Latex>{s.text}</Latex></span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(reviewResult.fix.difficulty || reviewResult.fix.skillType) && (
                    <div className="row-tight">
                      {reviewResult.fix.difficulty && (
                        <span className="pill">Difficulty → {reviewResult.fix.difficulty}</span>
                      )}
                      {reviewResult.fix.skillType && (
                        <span className="pill">Skill → {skillTypeLabel(reviewResult.fix.skillType)}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="row">
                {reviewResult.fix && (
                  <button className="btn btn-sm btn-ok" disabled={applyFixState.isLoading} onClick={applyReviewFix}>
                    <Check size={14} /> {applyFixState.isLoading ? "Saving" : "Apply fix"}
                  </button>
                )}
                <button className="btn btn-sm btn-quiet" onClick={() => setReviewResult(null)}>
                  <X size={14} /> Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---------------- passage sub-questions ---------------- */}
        {question.type === "passage" && (
          <div className="stack">
            {question.subQuestions?.map((sq, index) => (
              <div key={index} className="card stack">
                <div className="row-tight spread">
                  <strong>{sq.label ? `(${sq.label})` : `Question ${index + 1}`} <span className="muted small">{sq.type === "written" ? "Written" : "MCQ"}</span></strong>
                  <span className="pill tnum">
                    {sq.marks} mark{sq.marks === 1 ? "" : "s"}
                    {sq.negativeMarks > 0 ? ` · −${sq.negativeMarks} if wrong` : ""}
                  </span>
                </div>

                <Latex as="div" className="prose">{sq.question}</Latex>

                {sq.questionImage?.url && (
                  <img
                    src={sq.questionImage.url}
                    alt=""
                    style={{ maxWidth: "100%", borderRadius: 10 }}
                  />
                )}

                {sq.type === "written" && (
                  <div className="stack" style={{ gap: 6 }}>
                    {sq.modelAnswer && <div className="card-quiet"><span className="label">Model answer</span><Latex as="div" className="prose">{sq.modelAnswer}</Latex></div>}
                    {sq.rubric?.map((r, i) => <div key={i} className="row-tight spread small"><span>{r.criterion}</span><span className="tnum">{r.marks}</span></div>)}
                  </div>
                )}

                {sq.type !== "written" && <div className="stack" style={{ gap: 6 }}>
                  {sq.options?.map((option) => {
                    const correct = option.key === sq.correctOption;
                    return (
                      <div
                        key={option.key}
                        className="row-tight"
                        style={{
                          padding: "11px 13px",
                          borderRadius: 10,
                          background: correct ? "var(--correct-bg)" : "var(--surface-alt)",
                          color: correct ? "var(--correct)" : "var(--text)",
                        }}
                      >
                        <span style={{ opacity: 0.55, minWidth: 16 }}>{option.key}</span>
                        <span className="grow">
                          <Latex>{option.text}</Latex>
                          {option.image?.url && (
                            <img
                              src={option.image.url}
                              alt=""
                              style={{ display: "block", maxHeight: 120, marginTop: 6, borderRadius: 8 }}
                            />
                          )}
                        </span>
                        {correct && <Check size={16} />}
                      </div>
                    );
                  })}
                </div>}
              </div>
            ))}
          </div>
        )}

        {/* ---------------- rubric ---------------- */}
        {question.type === "written" && question.rubric?.length > 0 && (
          <div className="card stack">
            <div className="spread">
              <h2>Rubric</h2>
              <span className="pill tnum">{rubricTotal} total</span>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              What AI grading marks against. Each criterion is judged on its own.
            </p>
            {question.rubric.map((row, index) => (
              <div
                key={index}
                className="spread"
                style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}
              >
                <span className="grow"><Latex>{row.criterion}</Latex></span>
                <span className="tnum muted">{row.marks}</span>
              </div>
            ))}
          </div>
        )}

        {question.modelAnswer && (
          <div className="card stack">
            <h2>Model answer</h2>
            <p className="hint" style={{ margin: 0 }}>
              For the marker only. Students never see this, and they are not
              required to match its wording.
            </p>
            <Latex as="div" className="prose">{question.modelAnswer}</Latex>
          </div>
        )}

        {/* ---------------- skill type ---------------- */}
        {!question.skillType && (
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <span className="muted small">
              No skill type set. Filtering and the AI study plan can't target this question by skill yet.
            </span>
            <button
              className="btn btn-sm btn-quiet"
              disabled={classifySkillState.isLoading}
              onClick={runClassifySkill}
            >
              {classifySkillState.isLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {classifySkillState.isLoading ? "Classifying" : "Classify with AI"}
            </button>
          </div>
        )}
        {classifySkillState.error && <ErrorNote error={classifySkillState.error} />}
        {skillFailReason && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>AI could not classify this question: {skillFailReason}</span>
          </div>
        )}

        {/* ---------------- solution ---------------- */}
        {(question.solutionText || question.solutionVideo || question.solutionPdf || question.solutionImage || question.solutionAttachments?.length > 0) && (
          <div className={question.source === "ai" ? "ai-block stack" : "card stack"}>
            <div className="spread">
              <div className="row-tight">
                {question.source === "ai" && <Sparkles size={14} />}
                <h2 style={{ color: "inherit" }}>Solution</h2>
              </div>
              {question.solutionStatus !== "pending_review" && (
                <button
                  className="btn btn-sm btn-quiet"
                  disabled={backfillState.isLoading}
                  onClick={() => backfill({ questionIds: [id] })}
                >
                  <Sparkles size={13} />
                  {backfillState.isLoading ? "Writing" : "Regenerate with AI"}
                </button>
              )}
            </div>

            {question.solutionText && (
              <Latex as="div" className="prose">{question.solutionText}</Latex>
            )}

            {question.solutionImage?.url && (
              <img src={question.solutionImage.url} alt="" style={{ maxWidth: "100%", borderRadius: 10 }} />
            )}

            {question.solutionVideo?.url && (
              <div className="video-frame">
                <VideoFrame url={question.solutionVideo.url} file={question.solutionVideo.file} title="Solution video" />
              </div>
            )}

            <div className="row-tight">
              {question.solutionPdf && (
                <span className="pill row-tight" style={{ gap: 5 }}>
                  <FileDown size={12} /> PDF attached
                </span>
              )}
            </div>

            {question.solutionAttachments?.length > 0 && (
              <div className="stack" style={{ gap: 4 }}>
                {question.solutionAttachments.map((file) => (
                  <div key={file._id} className="row-tight card-quiet" style={{ padding: "6px 10px", gap: 8 }}>
                    <Paperclip size={14} className="muted" style={{ flexShrink: 0 }} />
                    <span className="grow truncate small">{file.title}</span>
                    {file.url && (
                      <a href={file.url} target="_blank" rel="noreferrer" className="icon-btn" title="Open in a new tab">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <VideoLessonPanel question={id} editTo={`/questions/${id}/edit`} />

        {!question.solutionText && !question.solutionVideo && !question.solutionPdf && !question.solutionAttachments?.length && question.solutionStatus !== "pending_review" && (
          <div className="card row" style={{ justifyContent: "space-between" }}>
            <span className="muted small">
              No solution written. Students see nothing after the exam.
            </span>
            <button
              className="btn btn-sm btn-quiet"
              disabled={backfillState.isLoading}
              onClick={() => backfill({ questionIds: [id] })}
            >
              {backfillState.isLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {backfillState.isLoading ? "Writing" : "Write one with AI"}
            </button>
          </div>
        )}

        {backfillState.error && <ErrorNote error={backfillState.error} />}

        {/* ---------------- pending AI solution, awaiting approval ---------------- */}
        {question.solutionStatus === "pending_review" && (
          <div className="card stack">
            <div className="row-tight">
              <FileText size={14} />
              <h2>Proposed solution</h2>
              <span className="pill pill-warn">Awaiting review</span>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              Written by AI. Students still see {question.solutionText ? "the solution above" : "nothing"} until
              you approve this.
            </p>
            <Latex as="div" className="ai-block">{question.pendingSolutionText}</Latex>
            <div className="row">
              <button
                className="btn btn-sm btn-ok"
                disabled={decidingSolution}
                onClick={() => decideSolution({ ids: [id], decision: "approve" })}
              >
                <Check size={14} /> Approve
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={decidingSolution}
                onClick={() => decideSolution({ ids: [id], decision: "reject" })}
              >
                <X size={14} /> Reject
              </button>
            </div>
          </div>
        )}

        {/* ---------------- provenance ---------------- */}
        {question.aiMeta?.model && (
          <div className="card small muted stack" style={{ gap: 4 }}>
            <span>Generated by {question.aiMeta.model}, prompt version {question.aiMeta.promptVersion}.</span>
            {question.aiMeta.reviewedAt && (
              <span>Approved on {new Date(question.aiMeta.reviewedAt).toLocaleDateString()}.</span>
            )}
          </div>
        )}

        <div className="card row">
          <Link className="btn btn-quiet" to={`/questions/${id}/edit`}>
            <Pencil size={15} /> Edit this {typeLabel(question.type).toLowerCase()}
          </Link>
          <span className="grow" />
          <button className="btn btn-danger" onClick={destroy}>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}