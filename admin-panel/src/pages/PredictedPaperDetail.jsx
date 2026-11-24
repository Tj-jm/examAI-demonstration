import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, FileText, RotateCcw, Share2, Sparkles, Trash2 } from "lucide-react";
import {
  useGetPredictedPaperQuery, useCreateExamFromPredictionMutation, useSetPredictedPaperSharedMutation,
  useRetryPredictedPaperMutation, useDeletePredictedPaperMutation,
} from "../api/aiApi";
import { Loading, ErrorNote, TypePill, Spinner, useConfirm } from "../components/bits";
import Latex from "../components/Latex";
import { useTerms } from "../terms";

const LIKELIHOOD_PILL = { high: "pill pill-ok", medium: "pill pill-warn", low: "pill" };

// One predicted-paper run. Polls while the server is still generating, then
// shows the prediction (topic by topic, with the year pattern behind it)
// and the paper itself. "Create exam" stays locked until every AI-written
// question has been approved or rejected in Review.
export default function PredictedPaperDetail() {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();
  // Poll only while the server is still generating.
  const [pollMs, setPollMs] = useState(4000);
  const { data: paper, isLoading, error } = useGetPredictedPaperQuery(id, {
    refetchOnMountOrArgChange: true,
    pollingInterval: pollMs,
    skipPollingIfUnfocused: true,
  });
  useEffect(() => {
    setPollMs(!paper || paper.status === "generating" ? 4000 : 0);
  }, [paper]);
  const [createExam, examState] = useCreateExamFromPredictionMutation();
  const [setShared, shareState] = useSetPredictedPaperSharedMutation();
  const [retry, retryState] = useRetryPredictedPaperMutation();
  const [remove, removeState] = useDeletePredictedPaperMutation();
  const confirm = useConfirm();

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!paper) return null;

  const board = paper.authority?.shortName || paper.authority?.name;
  // A real question can sit on several boards; show where it appeared on this one.
  const onBoard = (q) => (q.sources || []).find((s) => String(s.authority) === String(paper.authority?._id));
  const sourceLabel = (q) => {
    const s = onBoard(q);
    return [board, s?.years?.length ? [...s.years].sort((a, b) => a - b).join(", ") : null, s?.paperLabel].filter(Boolean).join(" · ");
  };
  const title = `${board} · ${paper.subject?.title}${paper.predictedYear ? ` · ${paper.predictedYear}` : ""}`;

  const goToExam = async () => {
    try {
      const { examId } = await createExam(id).unwrap();
      navigate(`/exams/${examId}`);
    } catch {
      // shown via examState.error
    }
  };

  const back = (
    <Link to="/predicted-paper" className="muted small row-tight" style={{ marginBottom: 8 }}>
      <ArrowLeft size={14} /> Predicted papers
    </Link>
  );

  // Same 30 minutes as the server's isStuck: a run killed by a restart.
  const stuck = paper.status === "generating" && Date.now() - new Date(paper.updatedAt).getTime() > 30 * 60 * 1000;

  const doRetry = () => retry(id).unwrap().catch(() => {});
  const doDelete = async () => {
    const ok = await confirm({
      title: "Delete this predicted paper?",
      body: "Its AI-written questions that aren't approved yet are deleted too. Approved questions and any exam made from it stay.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await remove(id).unwrap();
      navigate("/predicted-paper");
    } catch {
      // shown via removeState.error
    }
  };
  const deleteButton = (
    <button className="btn btn-quiet row-tight" onClick={doDelete} disabled={removeState.isLoading}>
      <Trash2 size={14} /> Delete
    </button>
  );
  const failedActions = (
    <>
      <div className="row-tight" style={{ marginTop: 10 }}>
        <button className="btn btn-primary row-tight" onClick={doRetry} disabled={retryState.isLoading}>
          <RotateCcw size={14} /> Try again
        </button>
        {deleteButton}
      </div>
      <ErrorNote error={retryState.error || removeState.error} />
    </>
  );

  if (paper.status === "generating") {
    return (
      <div className="page">
        {back}
        <div className="page-head"><h1>{title}</h1></div>
        <div className="card">
          <div className="row-tight">
            <Spinner />
            <span>
              {stuck
                ? "This run has been going for over 30 minutes. It most likely stopped when the server restarted."
                : "Studying past papers and building the predicted paper. This takes a minute or two — you can leave and come back."}
            </span>
          </div>
          {stuck && failedActions}
        </div>
      </div>
    );
  }

  if (paper.status === "failed") {
    return (
      <div className="page">
        {back}
        <div className="page-head"><h1>{title}</h1></div>
        <div className="card">
          <p style={{ margin: 0 }}>This run failed: {paper.error || "no reason was reported."}</p>
          {failedActions}
        </div>
      </div>
    );
  }

  const aiCount = paper.questions.filter((q) => q.origin === "ai").length;
  const realCount = paper.questions.length - aiCount;

  return (
    <div className="page">
      {back}
      <div className="page-head row-tight" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <h1>{title}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {paper.questions.length} questions — {realCount} real, {aiCount} AI-written · based on{" "}
            {paper.years?.length ? `${paper.years[0]}–${paper.years[paper.years.length - 1]}` : "the archive"}
          </p>
        </div>
        {deleteButton}
      </div>
      <ErrorNote error={removeState.error} />

      <div className="stack">
        {paper.summary && (
          <div className="card">
            <div className="row-tight" style={{ marginBottom: 6 }}>
              <Sparkles size={14} /> <strong>Prediction</strong>
            </div>
            <p style={{ margin: 0 }}>{paper.summary}</p>
          </div>
        )}

        {paper.warnings?.length > 0 && (
          <div className="banner">
            {paper.warnings.map((w, i) => <div key={i} className="small">{w}</div>)}
          </div>
        )}

        <div className="card stack">
          {paper.status === "exam_created" ? (
            <div className="row-tight">
              <CheckCircle2 size={16} />
              <span className="grow">An exam was created from this paper. Assign {terms.batches} and publish it there.</span>
              <Link className="btn btn-sm" to={`/exams/${paper.exam}`}><FileText size={14} /> Open exam</Link>
            </div>
          ) : paper.pendingReview > 0 ? (
            <div className="row-tight">
              <span className="grow">
                {paper.pendingReview} AI-written question{paper.pendingReview === 1 ? " is" : "s are"} waiting in Review.
                Approve or reject {paper.pendingReview === 1 ? "it" : "them"}, then come back to create the exam.
              </span>
              <Link className="btn btn-sm" to="/review">Go to Review</Link>
            </div>
          ) : (
            <div className="row-tight">
              <span className="grow">Everything is reviewed. Create an exam from this paper, then share it with {terms.batches} from the exam page.</span>
              <button className="btn btn-sm" disabled={examState.isLoading} onClick={goToExam}>
                <FileText size={14} /> {examState.isLoading ? "Creating…" : "Create exam"}
              </button>
            </div>
          )}
          <ErrorNote error={examState.error} />

          {/* Second way to share: an untimed practice set in the student
              archive, for every batch whose archive includes this board. */}
          {paper.pendingReview === 0 && (
            <div className="row-tight" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <Share2 size={16} />
              <span className="grow">
                {paper.sharedAsSet
                  ? `Shared as a predicted set in the archive of every batch that includes ${board}.`
                  : `Share as a predicted set — students practise it untimed in the archive (batches that include ${board}), with hints and explanations.`}
              </span>
              <button
                className={`btn btn-sm${paper.sharedAsSet ? " btn-quiet" : ""}`}
                disabled={shareState.isLoading}
                onClick={() => setShared({ id, shared: !paper.sharedAsSet })}
              >
                {shareState.isLoading ? "Saving…" : paper.sharedAsSet ? "Stop sharing" : "Share as predicted set"}
              </button>
            </div>
          )}
          <ErrorNote error={shareState.error} />
        </div>

        <h2 style={{ margin: "8px 0 0", fontSize: 15 }}>Topics</h2>
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Likelihood</th>
                <th>Why</th>
                <th>Years seen</th>
                <th className="tnum">On paper</th>
              </tr>
            </thead>
            <tbody>
              {paper.topics.map((t, i) => (
                <tr key={i}>
                  <td>{t.title}</td>
                  <td><span className={LIKELIHOOD_PILL[t.likelihood] || "pill"}>{t.likelihood}</span></td>
                  <td className="small">{t.reason}</td>
                  <td>
                    <div className="row-tight" style={{ flexWrap: "wrap" }}>
                      {t.yearsSeen.map((y) => (
                        <span key={y.year} className="pill tnum" title={`${y.count} question${y.count === 1 ? "" : "s"}`}>{y.year}</span>
                      ))}
                    </div>
                  </td>
                  <td className="tnum">{t.realCount + t.aiCount}{t.aiCount > 0 ? ` (${t.aiCount} AI)` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ margin: "8px 0 0", fontSize: 15 }}>Questions</h2>
        {paper.questions.map(({ question: q, origin }, i) => (
          <Link className="card" key={q._id} to={`/questions/${q._id}`} style={{ display: "block" }}>
            <div className="row-tight" style={{ marginBottom: 6, flexWrap: "wrap" }}>
              <span className="muted small tnum">{i + 1}.</span>
              <TypePill type={q.type} compact />
              {origin === "real" ? (
                <span className="pill">{sourceLabel(q)}</span>
              ) : (
                <span className="pill pill-ai">AI</span>
              )}
              {q.status === "pending_review" && <span className="pill pill-warn">Needs review</span>}
            </div>
            <Latex as="div" className="prose">{q.question}</Latex>
          </Link>
        ))}
      </div>
    </div>
  );
}
