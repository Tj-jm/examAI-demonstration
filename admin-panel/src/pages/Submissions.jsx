import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  useGetSubmissionsQuery, useGetSubmissionQuery, useGetBatchesQuery,
  useGetExamsQuery, useGetStudentsQuery, useGradeAnswerMutation, useDeleteSubmissionMutation,
} from "../api/contentApi";
import { ClipboardList, ArrowLeft, Search, X, ChevronLeft, ChevronRight, Trash2, Flag } from "lucide-react";
import { Loading, ErrorNote, Empty, Field, useConfirm } from "../components/bits";
import Latex from "../components/Latex";
import DisqualifyControl from "../components/DisqualifyControl";
import ExamFlags from "../components/ExamFlags";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";

// Tabs over the raw statuses (backend submissionsController.js VIEWS).
const VIEWS = [
  ["", "All"],
  ["live", "Taking now"],
  ["marking", "Waiting for marks"],
  ["done", "Marked"],
  ["regrade", "Regrade asked"],
  ["void", "Not counted"],
];
const VIEW_HINT = {
  void: "Late (rejected), never handed in (abandoned), or disqualified.",
};

// General oversight over every attempt, not just the ones waiting to be
// graded — "what did this student actually do on this exam" is a support
// and review question that the grading queue alone can't answer, since it
// only ever shows submissions stuck at status: grading.
export default function Submissions() {
  const terms = useTerms();
  const { me } = useOutletContext() || {};
  const [openId, setOpenId] = useState(null);
  const [filters, setFilters] = useState({ batchId: "", examId: "", view: "", studentId: "" });
  const [page, setPage] = useState(1);
  const [studentSearch, setStudentSearch] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [studentLabel, setStudentLabel] = useState("");

  const { data: batches } = useGetBatchesQuery({});
  const { data: examData } = useGetExamsQuery({ batch: filters.batchId || undefined, limit: 100 });

  // This box looks like a live-typing autocomplete (a dropdown appears right
  // under it), but it only ever searched on Enter — the only way to discover
  // that was to already know to press it, so typing and watching nothing
  // happen read as "the search doesn't work" rather than "needs Enter".
  // Debounced instead, so the dropdown fills in as you type.
  useEffect(() => {
    const handle = setTimeout(() => setStudentQuery(studentSearch.trim()), 250);
    return () => clearTimeout(handle);
  }, [studentSearch]);

  const { data: studentResults, error: studentError } = useGetStudentsQuery(
    { search: studentQuery, limit: 8 },
    { skip: !studentQuery }
  );

  const { data, isLoading, error } = useGetSubmissionsQuery({
    batchId: filters.batchId || undefined,
    examId: filters.examId || undefined,
    view: filters.view || undefined,
    studentId: filters.studentId || undefined,
    page,
    limit: 30,
  });

  if (openId) return <SubmissionDetail id={openId} onClose={() => setOpenId(null)} me={me} />;

  const set = (patch) => { setFilters({ ...filters, ...patch }); setPage(1); };
  const submissions = data?.submissions || [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Submissions</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {data?.total ?? 0} total
          </p>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={error || studentError} />

        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {VIEWS.map(([key, label]) => (
            <button
              key={key || "all"}
              type="button"
              className={`pill pill-btn row-tight${filters.view === key ? " pill-on" : ""}`}
              style={{ gap: 5 }}
              onClick={() => set({ view: key })}
            >
              {label}
              {data?.counts?.[key || "all"] > 0 && <span className="tnum">({data.counts[key || "all"]})</span>}
            </button>
          ))}
        </div>
        {VIEW_HINT[filters.view] && <p className="hint" style={{ margin: 0 }}>{VIEW_HINT[filters.view]}</p>}

        <div className="card row" style={{ flexWrap: "wrap", gap: 10 }}>
          <Field label="Batch">
            <SearchSelect className="select" value={filters.batchId} onChange={(e) => set({ batchId: e.target.value, examId: "" })}>
              <option value="">All {terms.batches}</option>
              {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </SearchSelect>
          </Field>

          <Field label="Exam">
            <SearchSelect className="select" value={filters.examId} onChange={(e) => set({ examId: e.target.value })}>
              <option value="">All exams</option>
              {(examData?.exams || []).map((e) => <option key={e._id} value={e._id}>{e.title}</option>)}
            </SearchSelect>
          </Field>

          <Field label="Student">
            {filters.studentId ? (
              <div className="row-tight">
                <span className="pill">{studentLabel}</span>
                <button
                  type="button"
                  className="icon-btn"
                  title="Clear"
                  onClick={() => { set({ studentId: "" }); setStudentLabel(""); setStudentSearch(""); setStudentQuery(""); }}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div style={{ position: "relative" }}>
                <form
                  className="search-wrap"
                  onSubmit={(e) => { e.preventDefault(); setStudentQuery(studentSearch); }}
                >
                  <Search size={14} className="search-icon" />
                  <input
                    className="input"
                    placeholder="Search students"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                  />
                </form>
                {studentQuery && studentResults && (studentResults.students || []).length === 0 && (
                  <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, padding: 10 }}>
                    <span className="muted small">No students match "{studentQuery}".</span>
                  </div>
                )}
                {studentQuery && (studentResults?.students || []).length > 0 && (
                  <div className="card" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 5, padding: 6 }}>
                    {studentResults.students.map((s) => (
                      <button
                        key={s._id}
                        type="button"
                        className="list-row"
                        style={{ width: "100%", textAlign: "left" }}
                        onClick={() => {
                          set({ studentId: s._id });
                          setStudentLabel(s.name || s.email || s.phoneNumber);
                          setStudentQuery("");
                          setStudentSearch("");
                        }}
                      >
                        {s.name || s.email || s.phoneNumber}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        </div>

        {isLoading ? (
          <Loading />
        ) : submissions.length ? (
          <>
            <div className="list">
              {submissions.map((s) => (
                <button key={s._id} className="list-row" style={{ textAlign: "left" }} onClick={() => setOpenId(s._id)}>
                  <div className="grow">
                    <div className="row-tight" style={{ marginBottom: 4 }}>
                      <StatusPill status={s.status} />
                      {s.referral?.requested && (
                        <span className="pill pill-warn">
                          regrade {s.referral.decision === "approved" ? "approved" : s.referral.decision === "rejected" ? "declined" : "asked"}
                        </span>
                      )}
                      {s.violationCount > 0 && (
                        <span className="pill pill-warn row-tight" style={{ gap: 3 }}>
                          <Flag size={11} /> {s.violationCount} flag{s.violationCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 14.5 }}>{s.exam?.title}</div>
                    <div className="muted small" style={{ marginTop: 3 }}>
                      {s.student?.name || s.student?.email || s.student?.phoneNumber}
                      {s.batch?.name ? ` · ${s.batch.name}` : ""} · attempt {s.attempt}
                    </div>
                  </div>
                  <div className="muted small tnum" style={{ textAlign: "right" }}>
                    {s.status === "graded" && <div>{s.marks}/{s.totalMarks}</div>}
                    <div>{new Date(s.submittedAt || s.startedAt).toLocaleDateString()}</div>
                  </div>
                </button>
              ))}
            </div>

            {data.pages > 1 && (
              <div className="row-tight" style={{ justifyContent: "center" }}>
                <button className="icon-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft size={15} />
                </button>
                <span className="small muted tnum">{page} / {data.pages}</span>
                <button className="icon-btn" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
          </>
        ) : (
          <Empty icon={ClipboardList} title="No submissions" hint="Nothing matches these filters yet." />
        )}
      </div>
    </div>
  );
}

const STATUS_COLOR = {
  graded: "pill-ok",
  in_progress: "pill",
  submitted: "pill-warn",
  grading: "pill-warn",
  rejected: "pill-bad",
  abandoned: "pill",
  disqualified: "pill-bad",
};

const STATUS_LABEL = {
  in_progress: "taking now",
  submitted: "handed in",
  grading: "waiting for marks",
  graded: "marked",
  rejected: "late, not counted",
  abandoned: "not handed in",
  disqualified: "disqualified",
};

function StatusPill({ status }) {
  return <span className={`pill ${STATUS_COLOR[status] || "pill"}`}>{STATUS_LABEL[status] || status.replace("_", " ")}</span>;
}

function SubmissionDetail({ id, onClose, me }) {
  const { data: submission, isLoading, error, refetch } = useGetSubmissionQuery(id);
  const [grade, { isLoading: saving }] = useGradeAnswerMutation();
  const [deleteSubmission, { isLoading: deleting, error: deleteError }] = useDeleteSubmissionMutation();
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState({});
  const canAct = ["owner", "admin"].includes(me?.role);

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <div className="row-tight" style={{ marginBottom: 4 }}>
            <StatusPill status={submission.status} />
            {submission.status === "graded" && (
              <span className="pill tnum">{submission.marks}/{submission.totalMarks}</span>
            )}
          </div>
          <h1>{submission.exam.title}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {submission.student?.name || submission.student?.email} · {submission.batch?.name} · attempt {submission.attempt}
          </p>
        </div>
        <div className="row-tight">
          {canAct && (
            <button
              className="btn btn-sm btn-quiet"
              disabled={deleting}
              onClick={async () => {
                const yes = await confirm({
                  title: "Delete this submission?",
                  body: "This permanently erases it, including any marks already given, and frees up the attempt slot so the student can attempt again. This cannot be undone.",
                  confirmLabel: "Delete",
                });
                if (!yes) return;
                await deleteSubmission(id).unwrap().then(onClose).catch(() => {});
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button className="btn btn-sm btn-quiet" onClick={onClose}>
            <ArrowLeft size={14} /> Back
          </button>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={deleteError} />
        <ExamFlags submission={submission} onChanged={refetch} />
        <DisqualifyControl
          submissionId={id}
          status={submission.status}
          disqualified={submission.disqualified}
          canAct={canAct}
        />
        {submission.answers.map((answer) => (
          <div className="card stack" key={answer._id}>
            <div className="spread">
              <Latex as="div" className="prose" style={{ flex: 1 }}>{answer.question?.question}</Latex>
              <span className="muted small tnum" style={{ flexShrink: 0 }}>
                {answer.marksAwarded ?? "–"}/{answer.question?.marks}
              </span>
            </div>

            {answer.questionType === "mcq" && (
              <div className="stack" style={{ gap: 4 }}>
                {(answer.question?.options || []).map((opt) => {
                  const isCorrect = opt.key === answer.question.correctOption;
                  const isTheirs = opt.key === answer.selectedOption;
                  return (
                    <div
                      key={opt.key}
                      className="small"
                      style={{ color: isCorrect ? "var(--correct)" : isTheirs ? "var(--incorrect)" : undefined }}
                    >
                      {opt.key}. <Latex>{opt.text}</Latex>
                      {isTheirs && !isCorrect && " (their answer)"}
                    </div>
                  );
                })}
              </div>
            )}

            {answer.questionType === "mtf" && (
              <div className="stack" style={{ gap: 4 }}>
                {(answer.question?.statements || []).map((st, si) => {
                  const theirs = (answer.statementAnswers || []).find((sa) => sa.index === si);
                  const correct = theirs && theirs.value === st.isTrue;
                  return (
                    <div
                      key={si}
                      className="small"
                      style={{ color: theirs ? (correct ? "var(--correct)" : "var(--incorrect)") : undefined }}
                    >
                      <Latex>{st.text}</Latex> — {theirs ? String(theirs.value) : "not answered"}
                    </div>
                  );
                })}
              </div>
            )}

            {answer.questionType === "passage" && (
              <div className="stack" style={{ gap: 10 }}>
                {(answer.question?.subQuestions || []).map((sq, si) => {
            // A written question under it is marked as its own answer.
            if (sq.type === "written") return null;
                  const theirs = (answer.subAnswers || []).find((sa) => sa.index === si);
                  return (
                    <div key={si} className="stack" style={{ gap: 4 }}>
                      <Latex as="div" className="small muted">{sq.question}</Latex>
                      {(sq.options || []).map((opt) => {
                        const isCorrect = opt.key === sq.correctOption;
                        const isTheirs = opt.key === theirs?.selectedOption;
                        return (
                          <div
                            key={opt.key}
                            className="small"
                            style={{ color: isCorrect ? "var(--correct)" : isTheirs ? "var(--incorrect)" : undefined }}
                          >
                            {opt.key}. <Latex>{opt.text}</Latex>
                            {isTheirs && !isCorrect && " (their answer)"}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {answer.questionType === "written" && (
              <>
                {answer.answerText && (
                  <div className="card-quiet small" style={{ whiteSpace: "pre-wrap" }}>
                    <Latex as="div">{answer.answerText}</Latex>
                  </div>
                )}
                {/* Photos, pages drawn in the app, and the teacher's
                    marked-up script once there is one. */}
                {(answer.answerImages?.length > 0 || answer.annotatedImage) && (
                  <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
                    {answer.annotatedImage && (
                      <a href={answer.annotatedImage} target="_blank" rel="noopener noreferrer" style={{ position: "relative", display: "block" }}>
                        <img src={answer.annotatedImage} alt="Marked script" style={{ height: 120, borderRadius: 8, border: "1px solid var(--accent)", display: "block" }} />
                        <span className="pill small" style={{ position: "absolute", left: 4, bottom: 4 }}>Marked</span>
                      </a>
                    )}
                    {(answer.answerImages || []).map((url, i) => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer" style={{ position: "relative", display: "block" }}>
                        <img src={url} alt={`Page ${i + 1}`} style={{ height: 120, borderRadius: 8, border: "1px solid var(--border)", display: "block" }} />
                        {url.includes("/answer-drawings/") && (
                          <span className="pill small" style={{ position: "absolute", left: 4, bottom: 4 }}>Drawn in app</span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
                {!answer.answerText && !answer.answerImages?.length && !answer.annotatedImage && (
                  <div className="card-quiet small"><span className="muted">Left blank.</span></div>
                )}
                {submission.status === "grading" && (
                  <div className="row" style={{ alignItems: "flex-end" }}>
                    <Field label="Marks">
                      <input
                        className="input tnum"
                        type="number"
                        min="0"
                        style={{ width: 90 }}
                        value={drafts[answer._id] ?? ""}
                        onChange={(e) => setDrafts({ ...drafts, [answer._id]: e.target.value })}
                      />
                    </Field>
                    <button
                      className="btn btn-sm"
                      disabled={saving || drafts[answer._id] === undefined || drafts[answer._id] === ""}
                      onClick={() => grade({ submissionId: id, answerId: answer._id, marks: Number(drafts[answer._id]) })}
                    >
                      Save mark
                    </button>
                  </div>
                )}
                {answer.teacherComment && (
                  <p className="muted small" style={{ fontStyle: "italic", margin: 0 }}>{answer.teacherComment}</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
