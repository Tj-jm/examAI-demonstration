import { useState } from "react";
import { useSearchParams, useOutletContext } from "react-router-dom";
import { useGetReviewQueueQuery, useDecideReviewMutation, useRejectAllReviewMutation, useDecideSolutionReviewMutation } from "../api/aiApi";
import { Check, X, Pencil, Sparkles, CheckCircle2, FileText, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Loading, ErrorNote, Empty, TypePill, useConfirm, Pager } from "../components/bits";
import Latex from "../components/Latex";
import { useTerms } from "../terms";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";

// One question per card, three decisions. If reviewing is slower than writing
// questions by hand, the whole generation feature is worthless — so this
// screen is optimised for deciding quickly, not for reading at length.
export default function Review() {
  const terms = useTerms();
  const { me } = useOutletContext() || {};
  const [params, setParams] = useSearchParams();
  const topicFilter = params.get("topic") || undefined;
  const chapterFilter = params.get("chapter") || undefined;
  const filtered = Boolean(topicFilter || chapterFilter);
  const page = Number(params.get("page")) || 1;
  const solutionsPage = Number(params.get("solutionsPage")) || 1;

  const setPage = (key) => (next) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set(key, String(next));
    setParams(nextParams);
  };

  // refetchOnMountOrArgChange rather than relying on tag invalidation alone:
  // an async job (document ingest) can finish and write questions after this
  // page's own cache entry was last refreshed, and this is the backstop that
  // still shows the current queue when that happens.
  const { data, isLoading, error } = useGetReviewQueueQuery(
    { topic: topicFilter, chapter: chapterFilter, page, solutionsPage },
    { refetchOnMountOrArgChange: true }
  );
  const [decide, { isLoading: deciding }] = useDecideReviewMutation();
  const [rejectAll, { isLoading: rejectingAll }] = useRejectAllReviewMutation();
  const [decideSolution, { isLoading: decidingSolution }] = useDecideSolutionReviewMutation();
  const [busyId, setBusyId] = useState(null);
  const isNew = useSeen("review");
  const confirm = useConfirm();

  // Rejecting deletes the question outright — there is no draft to go back to,
  // unlike approving, which is reversible. Clearing a whole page in one click
  // is therefore an owner/admin action, enforced on the route
  // (PUT /ai/review-queue/reject-all); this is only about not offering a
  // button that would be refused.
  const canRejectAll = ["owner", "admin"].includes(me?.role);

  if (isLoading) return <Loading />;

  const act = async (ids, decision) => {
    setBusyId(ids.length === 1 ? ids[0] : "all");
    await decide({ ids, decision });
    setBusyId(null);
  };

  const runRejectAll = async (ids) => {
    const yes = await confirm({
      title: `Reject all ${ids.length} question${ids.length === 1 ? "" : "s"}?`,
      body:
        `They are deleted outright, not kept as a draft — there is no way to get them back `
        + `afterwards. This clears the page you are looking at; other pages of the queue are left alone.`,
      // Matches the button it came from, and "Approve all" opposite it. The
      // count and the fact that this deletes rather than files are in the
      // title and the body, where there is room for them.
      confirmLabel: "Reject all",
    });
    if (!yes) return;
    setBusyId("all");
    await rejectAll({ ids });
    setBusyId(null);
  };

  const actSolution = async (ids, decision) => {
    setBusyId(ids.length === 1 ? `sol-${ids[0]}` : "all-sol");
    await decideSolution({ ids, decision });
    setBusyId(null);
  };

  const questions = data?.questions || [];
  const solutions = data?.solutions || [];

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Review</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Generated questions. Nothing reaches a student until you approve it.
          </p>
          {filtered && (
            <div className="row-tight" style={{ marginTop: 6 }}>
              <span className="pill">Filtered: {params.get("topicName") || "one topic"}</span>
              <button
                className="btn btn-sm btn-quiet"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("topic");
                  next.delete("chapter");
                  next.delete("topicName");
                  setParams(next);
                }}
              >
                Show everything
              </button>
            </div>
          )}
        </div>
        {questions.length > 1 && (
          <div className="row-tight">
            <button
              className="btn btn-sm btn-quiet"
              disabled={deciding}
              onClick={async () => {
                const yes = await confirm({
                  title: `Approve all ${questions.length} questions?`,
                  body: `They become visible to students in any ${terms.batch} the questions are assigned to.`,
                  confirmLabel: "Approve all",
                });
                if (yes) act(questions.map((q) => q._id), "approve");
              }}
            >
              <CheckCircle2 size={14} /> Approve all {questions.length}
            </button>
            {canRejectAll && (
              <button
                className="btn btn-sm btn-danger"
                disabled={deciding || rejectingAll}
                onClick={() => runRejectAll(questions.map((q) => q._id))}
              >
                <Trash2 size={14} /> Reject all {questions.length}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="stack">
        <ErrorNote error={error} />

        {questions.length === 0 && solutions.length === 0 ? (
          <Empty
            icon={CheckCircle2}
            title="Nothing waiting"
            hint="Questions and solutions you generate with AI arrive here for approval."
          />
        ) : (
          questions.map((question) => (
            <div className="card stack" key={question._id}>
              <div className="row-tight" style={{ flexWrap: "wrap" }}>
                <NewTag show={isNew(question.createdAt)} />
                <TypePill type={question.type} />
                {question.source === "import" ? (
                  <span className="pill row-tight" style={{ gap: 4 }} title={question.aiMeta?.sourceRef || undefined}>
                    <FileText size={11} /> From a document
                  </span>
                ) : (
                  <span className="pill pill-ai row-tight" style={{ gap: 4 }}>
                    <Sparkles size={11} /> Written by AI
                  </span>
                )}
                {question.difficulty && <span className="pill">{question.difficulty}</span>}
                <span className="grow" />
                {question.topic?.title ? (
                  <span className="muted small">{question.topic.title}</span>
                ) : question.chapter?.title ? (
                  <span className="muted small">{question.chapter.title} (chapter pool)</span>
                ) : null}
              </div>

              {question.aiMeta?.flags?.length > 0 && (
                <div className="banner banner-warn stack" style={{ gap: 2 }}>
                  {question.aiMeta.flags.map((flag) => (
                    <span key={flag} className="small">{flag}</span>
                  ))}
                </div>
              )}

              <Latex as="div" className="prose">{question.question}</Latex>
              <ReviewImage media={question.questionImage} />

              {question.type === "mcq" && (
                <div className="stack" style={{ gap: 5 }}>
                  {question.options?.map((option) => {
                    const correct = option.key === question.correctOption;
                    return (
                      <div
                        key={option.key}
                        className={`banner ${correct ? "banner-ok" : ""}`}
                        style={correct ? undefined : { background: "var(--surface-alt)", color: "var(--text)" }}
                      >
                        <span style={{ opacity: 0.6, marginRight: 8 }}>{option.key}</span>
                        <Latex>{option.text}</Latex>
                        <ReviewImage media={option.image} small />
                      </div>
                    );
                  })}
                </div>
              )}

              {question.type === "mtf" && (
                <div className="stack" style={{ gap: 5 }}>
                  {question.statements?.map((statement, index) => (
                    <div key={index} className="row-tight">
                      <span className={`pill ${statement.isTrue ? "pill-ok" : "pill-bad"}`} style={{ minWidth: 52 }}>
                        {statement.isTrue ? "True" : "False"}
                      </span>
                      <span className="grow"><Latex>{statement.text}</Latex></span>
                    </div>
                  ))}
                </div>
              )}

              {question.type === "written" && question.rubric?.length > 0 && (
                <div className="card-quiet stack" style={{ gap: 6 }}>
                  <span className="label">Rubric</span>
                  {question.rubric.map((row, index) => (
                    <div className="spread" key={index}>
                      <span className="grow small"><Latex>{row.criterion}</Latex></span>
                      <span className="tnum small muted">{row.marks}</span>
                    </div>
                  ))}
                </div>
              )}

              {question.type === "written" && question.modelAnswer && (
                <div className="card-quiet stack" style={{ gap: 4 }}>
                  <span className="label">Model answer</span>
                  <Latex as="div" className="small">{question.modelAnswer}</Latex>
                </div>
              )}

              {question.solutionText && (
                <Latex as="div" className="ai-block small">{question.solutionText}</Latex>
              )}
              <ReviewImage media={question.solutionImage} />

              <div className="row">
                <button
                  className="btn btn-sm btn-ok"
                  disabled={deciding}
                  onClick={() => act([question._id], "approve")}
                >
                  <Check size={14} />
                  {busyId === question._id ? "Saving" : "Approve"}
                </button>
                <Link className="btn btn-sm btn-quiet" to={`/questions/${question._id}/edit`} state={{ from: "review" }}>
                  <Pencil size={14} /> Edit first
                </Link>
                <span className="grow" />
                <button
                  className="btn btn-sm btn-danger"
                  disabled={deciding}
                  onClick={async () => {
                    const yes = await confirm({
                      title: "Reject this question?",
                      body: "It is deleted, not kept as a draft.",
                      confirmLabel: "Reject",
                    });
                    if (yes) act([question._id], "reject");
                  }}
                >
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          ))
        )}

        {questions.length > 0 && (
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage("page")} />
        )}

        {solutions.length > 0 && (
          <>
            <div className="page-head" style={{ marginTop: 8 }}>
              <h2 style={{ margin: 0 }}>Proposed solutions</h2>
              <p className="muted small" style={{ margin: "2px 0 0" }}>
                AI-written solutions for existing questions. The question itself is
                already live — only the solution is waiting on you.
              </p>
            </div>

            {solutions.map((question) => (
              <div className="card stack" key={question._id}>
                <div className="row-tight" style={{ flexWrap: "wrap" }}>
                  <TypePill type={question.type} />
                  <span className="pill pill-ai row-tight" style={{ gap: 4 }}>
                    <Sparkles size={11} /> Solution written by AI
                  </span>
                  <span className="grow" />
                  {question.topic?.title ? (
                    <span className="muted small">{question.topic.title}</span>
                  ) : question.chapter?.title ? (
                    <span className="muted small">{question.chapter.title} (chapter pool)</span>
                  ) : null}
                </div>

                <Latex as="div" className="prose small">{question.question}</Latex>

                {question.solutionText && (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="label">Current solution</span>
                    <Latex as="div" className="card-quiet small">{question.solutionText}</Latex>
                  </div>
                )}

                <div className="stack" style={{ gap: 4 }}>
                  <span className="label row-tight" style={{ gap: 4 }}>
                    <FileText size={12} /> Proposed solution
                  </span>
                  <Latex as="div" className="ai-block small">{question.pendingSolutionText}</Latex>
                </div>

                <div className="row">
                  <button
                    className="btn btn-sm btn-ok"
                    disabled={decidingSolution}
                    onClick={() => actSolution([question._id], "approve")}
                  >
                    <Check size={14} />
                    {busyId === `sol-${question._id}` ? "Saving" : "Approve"}
                  </button>
                  <Link className="btn btn-sm btn-quiet" to={`/questions/${question._id}`}>
                    View question
                  </Link>
                  <span className="grow" />
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={decidingSolution}
                    onClick={async () => {
                      const yes = await confirm({
                        title: "Reject this solution?",
                        body: question.solutionText
                          ? "The question keeps the solution it already had."
                          : "The question is left with no solution.",
                        confirmLabel: "Reject",
                      });
                      if (yes) actSolution([question._id], "reject");
                    }}
                  >
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            ))}
            <Pager
              page={data?.solutionsPage || 1}
              pages={data?.solutionsPages || 1}
              total={data?.solutionsTotal || 0}
              onChange={setPage("solutionsPage")}
            />
          </>
        )}
      </div>
    </div>
  );
}

// A figure attached to a question, option or solution — usually one cut out
// of the source document, which the reviewer should compare with it.
function ReviewImage({ media, small }) {
  if (!media?.url) return null;
  return (
    <img
      src={media.url}
      alt=""
      style={{ display: "block", maxWidth: small ? 180 : 360, maxHeight: small ? 120 : 260, objectFit: "contain", borderRadius: 6, background: "#fff", marginTop: small ? 4 : 0 }}
    />
  );
}
