import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, X, Clock, MessageSquareWarning } from "lucide-react";
import { useGetSubmissionForGradingQuery, useDecideReferralMutation, useGetSubmissionStaffQuery } from "../api/contentApi";
import { Loading, ErrorNote, TypePill } from "../components/bits";
import Latex from "../components/Latex";
import SearchSelect from "../components/SearchSelect";

export default function ReferralSubmission() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: submission, isLoading, error } = useGetSubmissionForGradingQuery(id);
  const [decide, { isLoading: deciding, error: decisionError }] = useDecideReferralMutation();
  const [note, setNote] = useState("");
  // Where an approved regrade goes: back to whoever marked each answer
  // first (default), anyone on the batch, or one person.
  const [route, setRoute] = useState("original");
  const { data: staff } = useGetSubmissionStaffQuery(id);

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const referral = submission.referral || {};
  const referredIds = new Set((referral.questionIds || []).map(String));
  const referredAnswers = submission.answers.filter((answer) =>
    referredIds.has(String(answer.question?._id))
  );
  const score = submission.marks ?? submission.answers.reduce(
    (total, answer) => total + (Number(answer.marksAwarded) || 0),
    0
  );

  const handleDecision = async (approve) => {
    try {
      await decide({
        submissionId: id,
        approve,
        comment: approve ? note.trim() || null : null,
        route: approve ? route : undefined,
      }).unwrap();
      navigate("/referrals", { replace: true });
    } catch {}
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="grow">
          <div className="row-tight" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <span className="pill pill-warn row-tight" style={{ gap: 4 }}>
              <Clock size={11} /> Pending regrade request
            </span>
            {submission.status === "graded" && <span className="pill">Final marks</span>}
            {submission.status === "grading" && <span className="pill pill-warn">Re-grading</span>}
          </div>
          <h1>{submission.exam?.title || "Exam submission"}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {submission.student?.name || submission.student?.email || "Student"}
            {submission.batch?.name ? ` · ${submission.batch.name}` : ""}
            {` · attempt ${submission.attempt || 1}`}
          </p>
        </div>
        <button className="btn btn-sm btn-quiet" onClick={() => navigate("/referrals")}>
          <ArrowLeft size={14} /> Regrade requests
        </button>
      </div>

      <div className="stack">
        <ErrorNote error={decisionError} />

        <div className="card-quiet stack" style={{ gap: 6, borderColor: "var(--warning)" }}>
          <div className="row-tight" style={{ gap: 6 }}>
            <MessageSquareWarning size={14} />
            <span className="label" style={{ margin: 0 }}>Student's request</span>
          </div>
          <Latex as="p" className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {referral.reason || "No reason was provided."}
          </Latex>
          <div className="small muted">
            {referredAnswers.length === 1
              ? "1 question flagged for re-checking"
              : `${referredAnswers.length} questions flagged for re-checking`}
          </div>
        </div>

        <div className="card-quiet row-tight" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="label">Current score</span>
          <span className="tnum">{score} / {submission.totalMarks ?? "–"}</span>
          {submission.submittedAt && (
            <span className="muted small">Submitted {new Date(submission.submittedAt).toLocaleString()}</span>
          )}
        </div>

        <div className="stack" style={{ gap: 12 }}>
          {submission.answers.map((answer, index) => (
            <AnswerCard
              key={answer._id}
              answer={answer}
              index={index}
              referred={referredIds.has(String(answer.question?._id))}
            />
          ))}
        </div>

        <div className="card stack" style={{ borderColor: "var(--warning)" }}>
          <div className="row-tight" style={{ gap: 6 }}>
            <Check size={14} />
            <h2 style={{ margin: 0, fontSize: 17 }}>Regrade decision</h2>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Send the submission back to the teacher to re-check the flagged answers, or reject the request and keep the current marks final.
          </p>
          <label className="field">
            <span className="label">Note for the teacher</span>
            <textarea
              className="input"
              rows={3}
              placeholder="Optional guidance about what to re-check…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="label">Who does the regrade</span>
            <SearchSelect className="select" style={{ maxWidth: 360 }} value={route} onChange={(e) => setRoute(e.target.value)}>
              <option value="original">Whoever marked each answer first</option>
              <option value="pool">Anyone on the batch</option>
              {(staff || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
            </SearchSelect>
            <span className="hint">The first marker keeps their pay credit if they do it. If they don't within Settings → Grading's regrade time, or they're deactivated or removed, anyone on the batch can, and the credit goes to whoever does.</span>
          </label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button
              className="btn btn-sm"
              disabled={deciding || Boolean(referral.decision)}
              onClick={() => handleDecision(true)}
            >
              <Check size={13} /> Approve regrade
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={deciding || Boolean(referral.decision)}
              onClick={() => handleDecision(false)}
            >
              <X size={13} /> Reject referral
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnswerCard({ answer, index, referred }) {
  const question = answer.question;
  const type = answer.questionType || question?.type;

  return (
    <div
      className="card stack"
      style={referred ? { borderColor: "var(--warning)", background: "var(--surface-alt)" } : undefined}
    >
      <div className="spread">
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="muted small tnum">Q{index + 1}</span>
          <TypePill type={type} compact />
          {referred && <span className="pill pill-warn">Flagged</span>}
        </div>
        <span className="muted small tnum" style={{ flexShrink: 0 }}>
          {answer.marksAwarded ?? "–"} / {question?.marks ?? "–"}
        </span>
      </div>

      <Latex as="div" className="prose" style={{ fontSize: 15 }}>{question?.question || "Question unavailable"}</Latex>

      {type === "mcq" && (
        <div className="stack" style={{ gap: 5 }}>
          {(question?.options || []).map((option) => {
            const correct = option.key === question.correctOption;
            const selected = option.key === answer.selectedOption;
            return (
              <div
                key={option.key}
                className="small row-tight"
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: correct ? "var(--correct-bg)" : selected ? "var(--incorrect-bg)" : "var(--surface-alt)",
                  color: correct ? "var(--correct)" : selected ? "var(--incorrect)" : undefined,
                }}
              >
                <span style={{ minWidth: 18, opacity: 0.65 }}>{option.key}</span>
                <span className="grow"><Latex>{option.text}</Latex></span>
                {selected && !correct && <X size={13} />}
                {correct && <Check size={13} />}
              </div>
            );
          })}
        </div>
      )}

      {type === "mtf" && (
        <div className="stack" style={{ gap: 5 }}>
          {(question?.statements || []).map((statement, statementIndex) => {
            const response = (answer.statementAnswers || []).find(
              (item) => item.index === statementIndex
            );
            const correct = response?.value === statement.isTrue;
            return (
              <div key={statementIndex} className="small row-tight" style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-alt)" }}>
                <span className={`pill ${statement.isTrue ? "pill-ok" : "pill-bad"} row-tight`} style={{ gap: 4, minWidth: 58 }}>
                  {statement.isTrue ? <Check size={11} /> : <X size={11} />}
                  {statement.isTrue ? "True" : "False"}
                </span>
                <span className="grow"><Latex>{statement.text}</Latex></span>
                <span className="muted">
                  {response?.value === undefined || response?.value === null ? "not answered" : String(response.value)}
                </span>
                {response && (correct ? <Check size={13} /> : <X size={13} />)}
              </div>
            );
          })}
        </div>
      )}

      {type === "passage" && (
        <div className="stack" style={{ gap: 10 }}>
          {(question?.subQuestions || []).map((sq, si) => {
            // A written question under it is marked as its own answer.
            if (sq.type === "written") return null;
            const response = (answer.subAnswers || []).find((item) => item.index === si);
            return (
              <div key={si} className="stack" style={{ gap: 5 }}>
                <Latex as="div" className="small muted">{sq.question}</Latex>
                {(sq.options || []).map((option) => {
                  const correct = option.key === sq.correctOption;
                  const selected = option.key === response?.selectedOption;
                  return (
                    <div
                      key={option.key}
                      className="small row-tight"
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: correct ? "var(--correct-bg)" : selected ? "var(--incorrect-bg)" : "var(--surface-alt)",
                        color: correct ? "var(--correct)" : selected ? "var(--incorrect)" : undefined,
                      }}
                    >
                      <span style={{ minWidth: 18, opacity: 0.65 }}>{option.key}</span>
                      <span className="grow"><Latex>{option.text}</Latex></span>
                      {selected && !correct && <X size={13} />}
                      {correct && <Check size={13} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {type === "written" && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="label">Student's answer</span>
          {answer.annotatedImage && (
            <a href={answer.annotatedImage} target="_blank" rel="noopener noreferrer">
              <img
                src={answer.annotatedImage}
                alt="Annotated answer script"
                style={{ maxWidth: "100%", maxHeight: 340, borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
              />
            </a>
          )}
          {answer.answerText && (
            <div className="card-quiet small" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              <Latex as="div">{answer.answerText}</Latex>
            </div>
          )}
          {answer.answerImages?.length > 0 && (
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
              {answer.answerImages.map((url, imageIndex) => (
                <a key={imageIndex} href={url} target="_blank" rel="noopener noreferrer">
                  <img src={url} alt={`Answer attachment ${imageIndex + 1}`} style={{ height: 110, borderRadius: 8, border: "1px solid var(--border)", display: "block" }} />
                </a>
              ))}
            </div>
          )}
          {!answer.answerText && (!answer.answerImages?.length) && !answer.annotatedImage && (
            <span className="muted small">Left blank.</span>
          )}
        </div>
      )}

      {(question?.rubric || []).length > 0 && (
        <div className="card-quiet stack" style={{ gap: 4 }}>
          <span className="label">Rubric</span>
          {question.rubric.map((row, rowIndex) => (
            <div key={rowIndex} className="spread small">
              <Latex>{row.criterion}</Latex>
              <span className="muted tnum">{row.marks}</span>
            </div>
          ))}
        </div>
      )}

      {question?.modelAnswer && (
        <div className="card-quiet stack" style={{ gap: 4 }}>
          <span className="label">Model answer</span>
          <Latex as="div" className="small">{question.modelAnswer}</Latex>
        </div>
      )}

      {question?.solutionText && (
        <div className="card-quiet stack" style={{ gap: 4 }}>
          <span className="label">Solution</span>
          <Latex as="div" className="small">{question.solutionText}</Latex>
        </div>
      )}

      {answer.teacherComment && (
        <div className="card-quiet stack" style={{ gap: 4, borderColor: "var(--warning)" }}>
          <span className="label">Note shown to the student</span>
          <p className="small" style={{ margin: 0 }}>{answer.teacherComment}</p>
        </div>
      )}

      {answer.gradedBy && (
        <div className="small muted">
          Marked by {answer.gradedBy}
          {answer.gradedAt ? ` on ${new Date(answer.gradedAt).toLocaleString()}` : ""}
        </div>
      )}
    </div>
  );
}
