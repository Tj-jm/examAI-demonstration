import { useState, useEffect } from "react";
import { useOutletContext, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useGetGradingQueueQuery,
  useGetSubmissionForGradingQuery,
  useGradeAnswerMutation,
  useGradeWithAiMutation,
  useReassignAnswerMutation,
  useGetMyGradingStatsQuery,
  useGetGradersQuery,
  useGetGraderStatsQuery,
  useClaimSubmissionMutation,
  useReleaseClaimMutation,
  useReopenSubmissionMutation,
  useGetSubmissionStaffQuery,
  useGetBatchesQuery,
} from "../api/contentApi";
import { PenLine, ArrowLeft, ArrowRight, Check, Sparkles, Pencil, Clock, Wallet, Lock, UserCog, Flag, RotateCcw, AlertTriangle, Search, ChevronUp, ChevronDown, Eye } from "lucide-react";
import { useCtrlS, useUnsaved, StatusStrip, FilterChips, SearchBox, PageTabs } from "../components/ListTools";
import { Loading, ErrorNote, Empty, Field, TypePill, Pager, useConfirm } from "../components/bits";
import Latex from "../components/Latex";
import ScriptDoodler from "../components/ScriptDoodler";
import DisqualifyControl from "../components/DisqualifyControl";
import ExamFlags from "../components/ExamFlags";
import { useSeen } from "../hooks/useSeen";
import NewTag from "../components/NewTag";
import SearchSelect from "../components/SearchSelect";

// This is the whole page for a grader account (see layout/Shell.jsx's
// minimal one-link shell for that role) and one of three for a teacher —
// tabbed rather than separate routes, same reasoning as DoubtQueue.jsx:
// "Queue" is the open work, "My stats" is the date-range graded count both
// a grader and a teacher want for payment, mirroring doubt-solving's own
// payment-summary tab exactly (point 4/5 of the spec).
export default function Grading() {
  const { me } = useOutletContext() || {};
  const isAnonymized = me?.role === "grader";
  const canCheckOthers = ["owner", "admin"].includes(me?.role);
  // /grading/:id opens one script (links from the agents page land here).
  const { id: openId } = useParams();
  const navigate = useNavigate();
  const setOpenId = (id) => navigate(id ? `/grading/${id}` : "/grading");
  const [tab, setTab] = useState("queue");
  const isNew = useSeen("grading");
  // The same count the sidebar shows.
  const { data: waiting } = useGetGradingQueueQuery(undefined);

  if (openId) return <GradeOne key={openId} id={openId} me={me} />;

  const TABS = [
    ["queue", "Queue", PenLine],
    ["stats", "My stats", Wallet],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Grading</h1>
        <p className="muted small" style={{ margin: "2px 0 0" }}>Written answers waiting for a mark. Oldest first.</p>
      </div>

      {isAnonymized && (
        <div className="banner banner-warn" style={{ marginBottom: 12 }}>
          Grading here is anonymous — you won't see the student's name or contact details.
        </div>
      )}

      <PageTabs
        value={tab}
        onChange={setTab}
        tabs={TABS.map(([value, label, Icon]) => ({ value, label, icon: Icon, count: value === "queue" ? waiting?.total : 0 }))}
      />

      {tab === "queue" && <QueueTab onOpen={setOpenId} anonymized={isAnonymized} canFilter={canCheckOthers} isNew={isNew} />}
      {tab === "stats" && <StatsTab canCheckOthers={canCheckOthers} />}
    </div>
  );
}

const STATE_LABEL = {
  untouched: "Not started",
  partial: "Part-marked",
  stuck: "Stuck",
  held: "Held by a grader",
  regrade: "Regrades",
};

function QueueTab({ onOpen, anonymized, canFilter, isNew }) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page")) || 1;
  const batch = params.get("batch") || "";
  const state = params.get("state") || "";
  const exam = params.get("exam") || "";
  const q = params.get("q") || "";
  const [search, setSearch] = useState(q);
  const setFilter = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const clearAll = () => { setSearch(""); setParams({}, { replace: true }); };
  const { data: batchData } = useGetBatchesQuery({});
  const batches = Array.isArray(batchData?.batches) ? batchData.batches : Array.isArray(batchData) ? batchData : [];
  const { data, isLoading, isFetching, error } = useGetGradingQueueQuery({
    page,
    batch: batch || undefined,
    state: state || undefined,
    examId: exam || undefined,
    q: canFilter ? q || undefined : undefined,
    counts: "true",
  });

  if (isLoading) return <Loading />;

  const submissions = data?.submissions || [];
  const counts = data?.counts || {};
  const exams = data?.exams || [];
  const filtered = Boolean(batch || state || exam || q);

  return (
    <div className="stack">
      <ErrorNote error={error} />
      <StatusStrip
        value={state}
        onChange={(v) => setFilter("state", v)}
        items={[
          { key: "", label: "All waiting", count: counts.all },
          { key: "untouched", label: STATE_LABEL.untouched, count: counts.untouched },
          { key: "partial", label: STATE_LABEL.partial, count: counts.partial },
          ...(canFilter ? [
            { key: "stuck", label: STATE_LABEL.stuck, count: counts.stuck, tone: counts.stuck ? "warn" : undefined },
            { key: "held", label: STATE_LABEL.held, count: counts.held },
          ] : []),
          { key: "regrade", label: STATE_LABEL.regrade, count: counts.regrade, tone: counts.regrade ? "warn" : undefined },
        ]}
      />
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        {canFilter && !anonymized && (
          <SearchBox value={search} onChange={setSearch} onSubmit={(v) => setFilter("q", v.trim())} placeholder="Student name, email or ID" />
        )}
        {exams.length > 0 && (
          <SearchSelect className="select" style={{ maxWidth: 260 }} value={exam} onChange={(e) => setFilter("exam", e.target.value)}>
            <option value="">Any exam</option>
            {exams.map((x) => <option key={x._id} value={x._id}>{x.title} ({x.count})</option>)}
          </SearchSelect>
        )}
        {batches.length > 1 && (
          <SearchSelect className="select" style={{ maxWidth: 220 }} value={batch} onChange={(e) => setFilter("batch", e.target.value)}>
            <option value="">Any batch</option>
            {batches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
        )}
      </div>
      <FilterChips
        onClearAll={clearAll}
        chips={[
          q && { key: "q", label: `"${q}"`, onClear: () => { setSearch(""); setFilter("q", ""); } },
          exam && { key: "exam", label: exams.find((x) => x._id === exam)?.title || "Exam", onClear: () => setFilter("exam", "") },
          batch && { key: "batch", label: batches.find((b) => b._id === batch)?.name || "Batch", onClear: () => setFilter("batch", "") },
          state && { key: "state", label: STATE_LABEL[state] || state, onClear: () => setFilter("state", "") },
        ]}
      />
      {data?.payMode === "script" && (
        <p className="muted small" style={{ margin: 0 }}>Pay is by script: a script you start stays yours until it's finished.</p>
      )}

      {submissions.length ? (
        <div className="list" style={{ opacity: isFetching ? 0.7 : 1, transition: "opacity 120ms ease" }}>
          {submissions.map((s) => {
            // Two tags at most: the most useful state, then who has it. The
            // rest goes in the muted line under the title.
            const stateTag = s.stuck
              ? <span className="pill pill-bad row-tight" style={{ gap: 4 }}><AlertTriangle size={11} /> Stuck</span>
              : s.regrade
              ? <span className="pill pill-warn row-tight" style={{ gap: 4 }}><RotateCcw size={11} /> Regrade</span>
              : s.heldByMe
              ? <span className="pill pill-on">Yours to finish</span>
              : null;
            const whoTag = s.claimedBy
              ? <span className="pill row-tight" style={{ gap: 4 }} title={`Opened ${new Date(s.claimedBy.claimedAt).toLocaleTimeString()}`}><Eye size={11} /> {s.claimedBy.name} has it open</span>
              : s.heldBy
              ? <span className={`pill row-tight${s.heldBy.gone ? " pill-bad" : ""}`} style={{ gap: 4 }}><Lock size={11} /> {s.heldBy.assigned ? "Assigned to" : "Held by"} {s.heldBy.name}{s.heldBy.gone ? " (inactive)" : ""}</span>
              : null;
            const details = [
              anonymized ? "Anonymous" : [s.student?.name || s.student?.email || s.student?.phoneNumber, !anonymized && s.student?.studentId ? `(${s.student.studentId})` : ""].filter(Boolean).join(" "),
              s.batch?.name,
              `attempt ${s.attempt}`,
              s.violationCount > 0 && `${s.violationCount} flag${s.violationCount === 1 ? "" : "s"}`,
              canFilter && s.lastProgress && s.writtenCount > s.pendingCount && `last marked ${new Date(s.lastProgress).toLocaleString()}`,
            ].filter(Boolean).join(" · ");
            return (
              <button key={s._id} className="list-row" style={{ textAlign: "left" }} onClick={() => onOpen(s._id)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
                    <NewTag show={isNew(s.submittedAt)} />
                    <span style={{ fontSize: 14.5, fontWeight: 500 }}>{s.exam?.title}</span>
                    {stateTag}
                    {whoTag}
                  </div>
                  <div className="muted small truncate" style={{ marginTop: 3 }} title={details}>{details}</div>
                </div>
                <span className="stack" style={{ gap: 2, alignItems: "flex-end", flexShrink: 0 }}>
                  <span className="small tnum" style={{ fontWeight: 600 }}>{s.pendingCount} to grade</span>
                  <span className="muted small tnum">{s.writtenCount > s.pendingCount ? `${s.writtenCount - s.pendingCount} marked · ` : ""}{s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : ""}</span>
                </span>
              </button>
            );
          })}
          <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={(p) => setFilter("page", p > 1 ? String(p) : "")} />
        </div>
      ) : (
        <Empty
          icon={Check}
          title={filtered ? "Nothing matches" : "Nothing waiting"}
          hint={filtered ? "Try other filters." : "Written answers land here once a student submits."}
          action={filtered ? <button className="btn btn-quiet" onClick={clearAll}>Clear filters</button> : undefined}
        />
      )}
    </div>
  );
}

function StatsTab({ canCheckOthers }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [graderId, setGraderId] = useState("");

  // Fresh on every visit and every pick: marks go in all day.
  const { data: graders } = useGetGradersQuery(undefined, { skip: !canCheckOthers, refetchOnMountOrArgChange: true });

  const mine = useGetMyGradingStatsQuery({ from: from || undefined, to: to || undefined }, { refetchOnMountOrArgChange: true });
  const theirs = useGetGraderStatsQuery(
    { id: graderId, from: from || undefined, to: to || undefined },
    { skip: !canCheckOthers || !graderId, refetchOnMountOrArgChange: true }
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--sp-4)", alignItems: "start" }}>
      <div className="card stack">
        <div className="row-tight"><Wallet size={16} className="muted" /><h2 style={{ fontSize: 15 }}>My grading summary</h2></div>
        <p className="hint" style={{ margin: 0 }}>What you've graded in a date range, counted the way pay is (Settings → Grading).</p>

        <div className="row">
          <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        {mine.isLoading ? (
          <Loading />
        ) : (
          <PayResult data={mine.data} ranged={Boolean(from || to)} />
        )}
      </div>

      {canCheckOthers && (
        <div className="card stack">
          <h2 style={{ fontSize: 15 }}>Check someone else</h2>
          <p className="hint" style={{ margin: 0 }}>Pick a teacher or grader (or anyone who's graded an answer) to get their count for the same range.</p>
          <Field label="Teacher / grader">
            <SearchSelect className="select" value={graderId} onChange={(e) => setGraderId(e.target.value)}>
              <option value="">Choose someone</option>
              {(graders || []).map((g) => (
                <option key={g._id} value={g._id}>{g.identifier || g.name}</option>
              ))}
            </SearchSelect>
          </Field>

          {/* currentData: this person's numbers only, never the last pick's. */}
          {graderId && (
            theirs.isError ? (
              <ErrorNote error={theirs.error} />
            ) : !theirs.currentData ? (
              <Loading />
            ) : (
              <PayResult data={theirs.currentData} ranged={Boolean(from || to)} />
            )
          )}
        </div>
      )}
    </div>
  );
}

// Pay counts: by question (answers marked) or by script (scripts finished).
function PayResult({ data, ranged }) {
  const byScript = data?.payMode === "script";
  const n = data?.count ?? 0;
  return (
    <div className="card-quiet" style={{ padding: 16, textAlign: "center" }}>
      <div style={{ fontSize: 32, fontWeight: 600 }} className="tnum">{n}</div>
      <div className="muted small">
        {byScript ? `script${n === 1 ? "" : "s"} finished` : `answer${n === 1 ? "" : "s"} graded`}
        {ranged ? " in this range" : " in total"}
      </div>
      {data?.amount !== null && data?.amount !== undefined && (
        <div style={{ marginTop: 8 }}><strong className="tnum">{data.amount.toLocaleString()}</strong> <span className="muted small">at {data.rate} per {byScript ? "script" : "answer"}</span></div>
      )}
      <div className="muted small" style={{ marginTop: 6 }}>{data?.answers ?? 0} answers marked · {data?.scripts ?? 0} scripts finished</div>
    </div>
  );
}

// Owner/admin: throw away the marking so far and hand the script back, to
// anyone on the batch or one grader. AI suggestions stay.
function ReopenControl({ submission, onDone }) {
  const [open, setOpen] = useState(false);
  const [graderId, setGraderId] = useState("");
  const confirm = useConfirm();
  const [reopen, { isLoading, error, data }] = useReopenSubmissionMutation();
  const { data: staff } = useGetSubmissionStaffQuery(submission._id, { skip: !open });
  if (submission.status !== "grading") return null;
  if (!open) {
    return <button className="btn btn-sm btn-quiet" onClick={() => setOpen(true)}><RotateCcw size={13} /> Reopen script</button>;
  }
  return (
    <div className="card-quiet stack" style={{ gap: 8 }}>
      <strong className="small">Reopen this script</strong>
      <p className="small muted" style={{ margin: 0 }}>
        Clears the marks, notes and annotations saved so far{submission.referral?.decision === "approved" ? " on the regraded answers" : ""}, keeps AI suggestions, and gives the script to:
      </p>
      <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
        <SearchSelect className="select" style={{ maxWidth: 240 }} value={graderId} onChange={(e) => setGraderId(e.target.value)}>
          <option value="">Anyone on the batch</option>
          {(staff || []).map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
        </SearchSelect>
        <button className="btn btn-sm btn-danger" disabled={isLoading} onClick={async () => {
          const yes = await confirm({ title: "Reopen this script?", body: "Marks, notes and annotations saved so far are deleted. This can't be undone.", confirmLabel: "Reopen", tone: "danger" });
          if (!yes) return;
          try { await reopen({ id: submission._id, graderId }).unwrap(); setOpen(false); onDone?.(); } catch { /* shown */ }
        }}>{isLoading ? "Reopening…" : "Reopen"}</button>
        <button className="btn btn-sm btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <ErrorNote error={error} />
      {data?.message && <span className="small">{data.message}</span>}
    </div>
  );
}

function GradeOne({ id, me }) {
  const confirm = useConfirm();
  const { data: submission, isLoading, error, refetch: refetchSubmission } = useGetSubmissionForGradingQuery(id);
  const [grade, { isLoading: saving }] = useGradeAnswerMutation();
  const [gradeWithAi, { isLoading: aiGrading, error: aiError }] = useGradeWithAiMutation();
  const [claimSubmission] = useClaimSubmissionMutation();
  const [releaseClaim] = useReleaseClaimMutation();
  // The open queue, for "Next script".
  const { data: queue } = useGetGradingQueueQuery(undefined);
  const [drafts, setDrafts] = useState({});
  // Unsaved notes for the student, by answer, so "Use this mark" can fill
  // in the AI's note and Save can send it with the mark.
  const [notes, setNotes] = useState({});
  // The mark and note before "Use this mark", for its undo.
  const [beforeAi, setBeforeAi] = useState({});
  // Per answer: "saved" or an error message, shown beside its Save button.
  const [saveState, setSaveState] = useState({});
  const [active, setActive] = useState(0);
  const [aiGradingId, setAiGradingId] = useState(null);
  const [aiErrorFor, setAiErrorFor] = useState(null);
  const [doodlerAnswer, setDoodlerAnswer] = useState(null);
  const canReassign = ["owner", "admin"].includes(me?.role);

  // Reserve this submission the moment it's opened, and give it up on the
  // way out (Queue button or unmount either one) — left claimed, it would
  // sit locked for everyone else until CLAIM_STALE_MS quietly expires it.
  // submission.canGradeSubmission (server truth, refetched after this call
  // via invalidatesTags) is what actually gates the UI below, not whether
  // this claim attempt itself succeeded.
  // Owners and admins don't claim: they can always mark, and opening a
  // script just to look at it shouldn't lock graders out of it.
  const looksOnly = ["owner", "admin"].includes(me?.role);
  useEffect(() => {
    if (looksOnly) return undefined;
    claimSubmission(id);
    return () => releaseClaim(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Same computation ReferralSubmission.jsx (the admin's decision page)
  // uses, so "flagged" means the same thing in both places. A regrade after
  // an approved referral shows only the answers the student flagged.
  const referredIds = new Set((submission?.referral?.questionIds || []).map(String));
  const isReferralRegrade = Boolean(submission?.referral?.requested && submission?.referral?.decision === "approved");
  const written = (submission?.answers || []).filter(
    (a) => a.questionType === "written" && (!isReferralRegrade || referredIds.has(String(a.question?._id)))
  );
  const savedMark = (a) => (a.isGraded ? String(a.marksAwarded) : "");
  const markOf = (a) => drafts[a._id] ?? savedMark(a);
  const noteOf = (a) => notes[a._id] ?? a.teacherComment ?? "";
  const markChanged = (a) => drafts[a._id] !== undefined && drafts[a._id] !== savedMark(a);
  const noteChanged = (a) => notes[a._id] !== undefined && notes[a._id].trim() !== (a.teacherComment || "");
  const changed = written.filter((a) => markChanged(a) || noteChanged(a));
  const { leave } = useUnsaved(changed.length > 0);

  const forget = (answerId) => {
    setDrafts((d) => { const n = { ...d }; delete n[answerId]; return n; });
    setNotes((d) => { const n = { ...d }; delete n[answerId]; return n; });
    setBeforeAi((d) => { const n = { ...d }; delete n[answerId]; return n; });
  };

  // One save per answer: the mark and the note together (or the note alone
  // when there's no mark yet). Returns true when it saved.
  const saveAnswer = async (answer, { ask = true } = {}) => {
    const draft = markOf(answer);
    const max = answer.question?.marks;
    const withMark = markChanged(answer) && draft !== "";
    if (withMark && max > 0 && Number(draft) > max) {
      setSaveState((s) => ({ ...s, [answer._id]: `At most ${max} marks.` }));
      return false;
    }
    const note = notes[answer._id];
    // The note is still the AI's feedback, written for the AI's mark, and
    // this mark is different: ask before it reaches the student saying the
    // opposite.
    const current = noteOf(answer).trim();
    if (ask && withMark && answer.aiFeedback && current === answer.aiFeedback.trim() && answer.aiMarks != null && Number(draft) !== Number(answer.aiMarks)) {
      const edit = await confirm({
        title: "Update the note?",
        body: `The note for the student is the AI's feedback for ${answer.aiMarks} marks. You're giving ${draft}, so it may not match.`,
        confirmLabel: "Edit note",
        cancelLabel: "Save anyway",
      });
      if (edit) {
        document.getElementById(`note-${answer._id}`)?.focus();
        return false;
      }
    }
    const comment = noteChanged(answer) ? note.trim() : undefined;
    if (!withMark && comment === undefined) return true;
    try {
      await grade({ submissionId: id, answerId: answer._id, ...(withMark ? { marks: Number(draft) } : {}), ...(comment !== undefined ? { comment } : {}) }).unwrap();
      forget(answer._id);
      setSaveState((s) => ({ ...s, [answer._id]: "saved" }));
      return true;
    } catch (err) {
      setSaveState((s) => ({ ...s, [answer._id]: err?.data?.message || "Couldn't save. Try again." }));
      return false;
    }
  };

  const saveAll = async () => {
    for (const a of changed) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await saveAnswer(a, { ask: false }))) return false;
    }
    return true;
  };
  useCtrlS(() => { if (changed.length && !saving) saveAll(); });

  const goTo = (index, focusMark = false) => {
    const i = Math.max(0, Math.min(written.length - 1, index));
    setActive(i);
    const el = document.getElementById(`ans-${written[i]?._id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focusMark) setTimeout(() => document.getElementById(`mark-${written[i]?._id}`)?.focus({ preventScroll: true }), 250);
  };

  // J / K: next and previous answer, when not typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (e.key === "j" || e.key === "J") { e.preventDefault(); goTo(active + 1, true); }
      if (e.key === "k" || e.key === "K") { e.preventDefault(); goTo(active - 1, true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  // Whole-submission claim — someone else has this open right now. Marks
  // and comments are blocked server-side too (gradeAnswer's own claim
  // check), this just keeps the UI from pretending a save will work.
  const claimedByOther = !submission.canGradeSubmission;
  const canReopen = ["owner", "admin"].includes(me?.role);
  // Flagged auto-scored answers (mcq/mtf): a note only, no mark.
  const flaggedOther = submission.answers.filter(
    (a) => a.questionType !== "written" && referredIds.has(String(a.question?._id))
  );

  const gradedCount = written.filter((a) => a.isGraded).length;
  const allGraded = written.length > 0 && gradedCount === written.length && changed.length === 0;
  const scored = submission.answers.reduce((sum, a) => sum + (Number(a.marksAwarded) || 0), 0);
  const outOf = submission.totalMarks || submission.answers.reduce((sum, a) => sum + (Number(a.question?.marks) || 0), 0);
  const nextScript = (queue?.submissions || []).find((s) => s._id !== id && !s.claimedBy && (!s.heldBy || s.heldByMe));
  const minutes = submission.totalTimeMs ? Math.round(submission.totalTimeMs / 60000) : null;

  return (
    <div className="page page-wide">
      <div className="page-head spread">
        <div>
          <h1>{submission.exam.title}</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {[
              submission.anonymous ? "Anonymous submission" : submission.student?.name || submission.student?.email,
              submission.batch?.name,
              `attempt ${submission.attempt}`,
              submission.submittedAt && `submitted ${new Date(submission.submittedAt).toLocaleString()}`,
              minutes != null && `${minutes} min taken`,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button className="btn btn-sm btn-quiet" onClick={() => leave("/grading")}>
          <ArrowLeft size={14} /> Queue
        </button>
      </div>

      <div className="stack">
        <ExamFlags submission={submission} onChanged={refetchSubmission} />
        <DisqualifyControl
          submissionId={id}
          status={submission.status}
          disqualified={submission.disqualified}
          canAct={canReassign}
        />
        {submission.heldByOther ? (
          <div className="banner banner-warn row-tight" style={{ gap: 6 }}>
            <Lock size={14} />
            <span>{submission.heldBy?.assigned ? "An admin assigned this script to" : "This script stays with"} {submission.heldBy?.name} until it's finished. You can look, but not mark it.</span>
          </div>
        ) : claimedByOther && (
          <div className="banner banner-warn row-tight" style={{ gap: 6 }}>
            <Lock size={14} />
            <span>{submission.claimedBy?.name || "Someone else"} is grading this right now — you can look, but marks and notes won't save until they're done or it goes stale.</span>
          </div>
        )}
        {submission.heldBy && !submission.heldByOther && submission.heldBy._id === me?._id && (
          <div className="card-quiet small">{submission.heldBy.assigned ? "Assigned to you" : "This script is yours"} until it's finished{submission.payMode === "script" ? " (pay is by script)" : ""}.</div>
        )}
        {canReopen && (submission.stuck || submission.heldBy) && (
          <div className="banner banner-warn row-tight" style={{ gap: 6 }}>
            <AlertTriangle size={14} />
            <span className="grow">
              {submission.stuck ? `Part-marked with no progress since ${submission.lastProgress ? new Date(submission.lastProgress).toLocaleString() : "a while"} (over ${submission.stuckHours} hours).` : ""}
              {submission.heldBy ? ` ${submission.heldBy.assigned ? "Assigned to" : "Held by"} ${submission.heldBy.name}.` : ""}
            </span>
          </div>
        )}
        {canReopen && <ReopenControl submission={submission} />}
        {submission.referral && submission.referral.requested && (
          <div className="card-quiet stack" style={{ gap: 4, borderColor: "var(--warning)" }}>
            <div className="row-tight" style={{ gap: 6 }}>
              <Clock size={14} />
              <span className="label" style={{ margin: 0 }}>
                {submission.referral.decision === "approved"
                  ? "Re-grading after an approved referral"
                  : "Pending referral review"}
              </span>
            </div>
            <Latex as="p" className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{submission.referral.reason}</Latex>
            {submission.referral.decision === "approved" && (
              <p className="small muted" style={{ margin: 0 }}>
                Focus on the {submission.referral.questionIds.length} question{submission.referral.questionIds.length !== 1 ? "s" : ""} the student flagged.
              </p>
            )}
          </div>
        )}

        {written.length > 1 && (
          <p className="hint" style={{ margin: 0 }}>J and K move between answers. Enter in a mark box saves it and goes to the next answer. Ctrl+S saves everything.</p>
        )}

        {written.map((answer, index) => {
          const isGraded = answer.isGraded;
          const draft = markOf(answer);
          const rubric = answer.question?.rubric || [];
          const rubricTotal = rubric.reduce((sum, r) => sum + (r.marks || 0), 0);
          const dirty = markChanged(answer) || noteChanged(answer);
          const state = saveState[answer._id];
          const max = answer.question?.marks;
          const tooHigh = max > 0 && draft !== "" && Number(draft) > max;

          return (
            <div
              className={`card stack grade-card${active === index ? " grade-card-on" : ""}`}
              key={answer._id}
              id={`ans-${answer._id}`}
              onFocusCapture={() => setActive(index)}
              onMouseDown={() => setActive(index)}
            >
              <div className="spread" style={{ gap: 8 }}>
                <span className="label" style={{ margin: 0 }}>Answer {index + 1} of {written.length}{max ? ` · ${max} marks` : ""}</span>
                <div className="row-tight">
                  {isGraded && !dirty && <span className="pill pill-ok">Graded</span>}
                  {dirty && <span className="pill pill-warn row-tight" style={{ gap: 4 }}><span className="dirty-dot" /> Not saved</span>}
                  {referredIds.has(String(answer.question?._id)) && (
                    <span className="pill pill-warn">Flagged</span>
                  )}
                  {answer.gradedByUser && (
                    <span className="muted small" title="Who marked this answer">
                      by {answer.gradedByUser.name}{answer.gradedByUser.isDeleted ? " (deleted)" : ""}
                    </span>
                  )}
                  {answer.answerImages?.length > 0 && (
                    <button type="button" className="btn btn-sm btn-quiet" title="Open the pages full size to mark them up with a pen" onClick={() => setDoodlerAnswer(answer)}>
                      <Pencil size={13} /> Mark up the pages
                    </button>
                  )}
                </div>
              </div>

              <div className="grade-cols">
                <div className="stack" style={{ minWidth: 0 }}>
                  <Latex as="div" className="prose">{answer.question?.question}</Latex>

                  {answer.lockedTo && (
                    <div className="card-quiet row-tight" style={{ gap: 6, borderColor: "var(--warning)" }}>
                      <Lock size={13} className="muted" />
                      <span className="small grow">
                        This regrade is with {answer.lockedTo.name}{answer.lockedTo.until ? ` until ${new Date(answer.lockedTo.until).toLocaleString()}, then anyone on the batch can do it` : ""}.
                      </span>
                      {canReassign && <ReassignControl submissionId={id} answer={answer} />}
                    </div>
                  )}
                  {answer.regradeOf && (
                    <div className="small muted">First marked {answer.regradeOf.marks ?? "—"} by {answer.regradeOf.by?.name || "someone"}{answer.regradeOf.at ? ` on ${new Date(answer.regradeOf.at).toLocaleDateString()}` : ""}. Their credit stays unless someone else does the regrade.</div>
                  )}
                  {answer.markedByOther && !answer.lockedTo && (
                    <div className="small muted row-tight" style={{ gap: 6 }}><Lock size={12} /> Marked by {answer.gradedByUser?.name || "the grading agent"}. Only an admin can change it.</div>
                  )}
                  {!answer.lockedTo && canReassign && referredIds.has(String(answer.question?._id)) && isReferralRegrade && (
                    <div className="row-tight" style={{ justifyContent: "flex-end" }}>
                      <ReassignControl submissionId={id} answer={answer} label="Reassign" />
                    </div>
                  )}

                  <div className="stack" style={{ gap: 4 }}>
                    <span className="label">Student's answer</span>
                    {answer.annotatedImage ? (
                      <a href={answer.annotatedImage} target="_blank" rel="noopener noreferrer">
                        <img
                          src={answer.annotatedImage}
                          alt="Marked answer script"
                          style={{ maxWidth: "100%", maxHeight: 520, borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
                        />
                      </a>
                    ) : (
                      <>
                        {(answer.answerText || !answer.answerImages?.length) && (
                          <div className="card-quiet small" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                            {answer.answerText
                              ? <Latex as="div">{answer.answerText}</Latex>
                              : <span className="muted">Left blank.</span>}
                          </div>
                        )}
                        {answer.answerImages?.length > 0 && (
                          <div className="grade-pages">
                            {answer.answerImages.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer" title="Open full size" style={{ position: "relative", display: "block" }}>
                                <img src={url} alt={`Page ${i + 1}`} loading="lazy" />
                                <span className="pill small" style={{ position: "absolute", right: 6, top: 6 }}>{i + 1}</span>
                                {/* Pages from the student's in-app drawing pad are stored apart. */}
                                {url.includes("/answer-drawings/") && (
                                  <span className="pill small" style={{ position: "absolute", left: 6, bottom: 6 }}>Drawn in app</span>
                                )}
                                {answer.noCameraImages?.includes(url) && (
                                  <span className="pill pill-warn small" title="Not taken with a camera: likely a screenshot, snip or saved image." style={{ position: "absolute", left: 6, bottom: 6 }}>No camera data</span>
                                )}
                              </a>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <aside className="grade-side stack">
                  {rubric.length > 0 && (
                    <div className="card-quiet stack" style={{ gap: 6 }}>
                      <span className="label">Rubric — {rubricTotal} total</span>
                      {rubric.map((r, i) => (
                        <div key={i} className="spread small" style={{ gap: 8 }}>
                          <Latex>{r.criterion}</Latex>
                          <span className="muted tnum">{r.marks}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {answer.question?.modelAnswer && (
                    <details className="card-quiet" style={{ borderColor: "var(--warning)" }}>
                      <summary className="label" style={{ cursor: "pointer" }}>Model answer</summary>
                      <Latex as="div" className="small" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: 6 }}>
                        {answer.question.modelAnswer}
                      </Latex>
                    </details>
                  )}

                  {submission.aiGradingAvailable && answer.gradedBy !== "auto" && (
                    <div className="stack" style={{ gap: 6 }}>
                      {answer.aiMarks !== undefined && answer.aiMarks !== null ? (
                        <div className="card-quiet stack" style={{ gap: 4 }}>
                          <div className="row-tight" style={{ flexWrap: "wrap" }}>
                            <Sparkles size={13} className="muted" />
                            <span className="label" style={{ margin: 0 }}>
                              AI suggests {answer.aiMarks} of {rubricTotal || answer.question?.marks}
                            </span>
                            {answer.aiConfidence !== undefined && answer.aiConfidence < 0.6 && (
                              <span className="pill pill-warn">Low confidence — check this one</span>
                            )}
                            {answer.notHandwritten && (
                              <span className="pill pill-bad" title={answer.handwritingAction === "hold" ? "Held for a teacher: the grading agent won't apply this mark." : answer.handwritingAction === "zero" ? "AI mark set to 0 by the handwriting check." : undefined}>
                                Not handwritten ({answer.notHandwritten})
                              </span>
                            )}
                          </div>
                          <p className="small muted" style={{ margin: 0 }}>{answer.aiReasoning}</p>
                          <div className="row-tight" style={{ gap: 4 }}>
                            <button
                              type="button"
                              className="btn btn-sm btn-quiet"
                              disabled={!answer.canGrade || claimedByOther}
                              onClick={() => {
                                setBeforeAi((b) => ({ ...b, [answer._id]: { mark: drafts[answer._id], note: notes[answer._id] } }));
                                setDrafts((d) => ({ ...d, [answer._id]: String(answer.aiMarks) }));
                                if (answer.aiFeedback && !noteOf(answer).trim()) {
                                  setNotes((n) => ({ ...n, [answer._id]: answer.aiFeedback }));
                                }
                              }}
                            >
                              Use this mark
                            </button>
                            {beforeAi[answer._id] && (
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={() => {
                                  const before = beforeAi[answer._id];
                                  setDrafts((d) => { const n = { ...d }; if (before.mark === undefined) delete n[answer._id]; else n[answer._id] = before.mark; return n; });
                                  setNotes((d) => { const n = { ...d }; if (before.note === undefined) delete n[answer._id]; else n[answer._id] = before.note; return n; });
                                  setBeforeAi((b) => { const n = { ...b }; delete n[answer._id]; return n; });
                                }}
                              >
                                <RotateCcw size={13} /> Undo
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-quiet"
                          style={{ alignSelf: "flex-start" }}
                          disabled={(aiGrading && aiGradingId === answer._id) || claimedByOther}
                          onClick={async () => {
                            setAiGradingId(answer._id);
                            setAiErrorFor(null);
                            try {
                              await gradeWithAi({ submissionId: id, answerId: answer._id }).unwrap();
                            } catch (err) {
                              setAiErrorFor(answer._id);
                            } finally {
                              setAiGradingId(null);
                            }
                          }}
                        >
                          <Sparkles size={13} /> {aiGrading && aiGradingId === answer._id ? "Grading…" : "Grade with AI"}
                        </button>
                      )}
                      {aiErrorFor === answer._id && aiError && <ErrorNote error={aiError} />}
                    </div>
                  )}

                  <WrittenNoteEditor
                    answer={answer}
                    locked={claimedByOther}
                    note={noteOf(answer)}
                    setNote={(value) => setNotes((n) => ({ ...n, [answer._id]: value }))}
                  />

                  <div className="row-tight" style={{ alignItems: "flex-end", gap: 8 }}>
                    <Field label={max ? `Marks (of ${max})` : "Marks"}>
                      <input
                        id={`mark-${answer._id}`}
                        className="input tnum"
                        type="number"
                        min="0"
                        max={max || undefined}
                        style={{ width: 90 }}
                        value={draft}
                        disabled={!answer.canGrade || claimedByOther}
                        onChange={(e) => setDrafts((d) => ({ ...d, [answer._id]: e.target.value }))}
                        onKeyDown={async (e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          if (await saveAnswer(answer)) {
                            const next = written.findIndex((a, j) => j > index && !a.isGraded);
                            if (next >= 0) goTo(next, true);
                          }
                        }}
                      />
                    </Field>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={saving || !dirty || claimedByOther || tooHigh || (markChanged(answer) && !answer.canGrade)}
                      onClick={() => saveAnswer(answer)}
                    >
                      <Check size={13} /> {isGraded && markChanged(answer) ? "Update" : "Save"}
                    </button>
                  </div>
                  {tooHigh && <span className="small" style={{ color: "var(--incorrect)" }}>At most {max} marks.</span>}
                  {state && !dirty && state === "saved" && <span className="small row-tight" style={{ gap: 4, color: "var(--correct)" }}><Check size={12} /> Saved</span>}
                  {state && state !== "saved" && <span className="small" style={{ color: "var(--incorrect)" }}>{state}</span>}
                </aside>
              </div>
            </div>
          );
        })}

        {flaggedOther.length > 0 && (
          <div className="stack" style={{ gap: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>
              Also flagged — these are auto-scored, so there's no mark to change here.
              You can leave the student a note explaining the answer.
            </p>
            {flaggedOther.map((answer) => (
              <FlaggedOtherCard key={answer._id} answer={answer} submissionId={id} grade={grade} saving={saving} locked={claimedByOther} />
            ))}
          </div>
        )}

        {(written.length > 0 || nextScript) && (
          <div className={`save-bar${changed.length ? "" : " save-bar-idle"}`}>
            <span className="row-tight small grow tnum" style={{ gap: 6, flexWrap: "wrap" }}>
              {changed.length > 0 && <><span className="dirty-dot" /> {changed.length} not saved ·</>}
              {written.length > 0 && <span>{gradedCount} of {written.length} graded</span>}
              {outOf > 0 && <span className="muted">· {scored}/{outOf} marks</span>}
            </span>
            {written.length > 1 && (
              <>
                <button type="button" className="btn btn-sm btn-quiet" title="Previous answer (K)" disabled={active === 0} onClick={() => goTo(active - 1, true)}><ChevronUp size={14} /></button>
                <button type="button" className="btn btn-sm btn-quiet" title="Next answer (J)" disabled={active >= written.length - 1} onClick={() => goTo(active + 1, true)}><ChevronDown size={14} /></button>
              </>
            )}
            {changed.length > 0 && (
              <button type="button" className="btn btn-sm" disabled={saving || claimedByOther} onClick={saveAll}>
                <Check size={13} /> Save all
              </button>
            )}
            {nextScript && (
              <button type="button" className={`btn btn-sm${allGraded ? "" : " btn-quiet"}`} onClick={() => leave(`/grading/${nextScript._id}`)}>
                Next script <ArrowRight size={13} />
              </button>
            )}
          </div>
        )}
        {allGraded && !nextScript && (
          <div className="banner banner-ok">Every written answer here is graded. Nothing else is waiting in the queue.</div>
        )}
      </div>

      {doodlerAnswer && (
        <ScriptDoodler
          submission={submission}
          answer={doodlerAnswer}
          onClose={() => setDoodlerAnswer(null)}
          totalMarks={doodlerAnswer.question?.marks || (doodlerAnswer.question?.rubric || []).reduce((sum, r) => sum + (r.marks || 0), 0)}
          draft={drafts[doodlerAnswer._id] ?? (doodlerAnswer.marksAwarded != null ? String(doodlerAnswer.marksAwarded) : "")}
          onDraftChange={(value) => setDrafts((d) => ({ ...d, [doodlerAnswer._id]: value }))}
          onSaveMark={async (marks) => {
            try {
              await grade({ submissionId: id, answerId: doodlerAnswer._id, marks }).unwrap();
              setDrafts((d) => { const n = { ...d }; delete n[doodlerAnswer._id]; return n; });
            } catch { /* the doodler shows its own state */ }
          }}
          savingMark={saving}
          isGraded={doodlerAnswer.marksAwarded != null}
        />
      )}
    </div>
  );
}
// The note for the student on a written answer, saved with its mark (the
// answer's Save button). Also shows the admin's private regrade guidance
// (adminNoteToTeacher) above it when present. That note is teacher-only:
// the backend never sends it to the student.
function WrittenNoteEditor({ answer, locked, note, setNote }) {

  return (
    <div className="stack" style={{ gap: 6 }}>
      {answer.adminNoteToTeacher && (
        <div className="card-quiet small" style={{ borderColor: "var(--warning)", fontStyle: "italic" }}>
          <span className="label" style={{ display: "block", marginBottom: 2 }}>Admin note — not shown to the student</span>
          {answer.adminNoteToTeacher}
        </div>
      )}
      <Field label="Note for the student">
        <textarea
          id={`note-${answer._id}`}
          className="input"
          rows={2}
          value={note}
          disabled={locked}
          placeholder="Explain why this answer was marked the way it was…"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </div>
  );
}

// Owner/admin's escape hatch when the original grader is gone (point 2 of
// the spec) — "Open to anyone" is the common case (deactivated, removed
// from the batch), the picker below it covers handing it to one specific
// person instead. Deliberately not scoped to just this batch's staff —
// reassignAnswer itself refuses anyone not actually assigned to the batch,
// so a bad pick here just comes back as an error rather than silently
// doing the wrong thing.
function ReassignControl({ submissionId, answer, label = "Open to anyone" }) {
  const [open, setOpen] = useState(false);
  const [reassign, { isLoading }] = useReassignAnswerMutation();
  // Only people who can grade this batch now.
  const { data: graders } = useGetSubmissionStaffQuery(submissionId, { skip: !open });

  if (!open) {
    return (
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setOpen(true)}>
        <UserCog size={13} /> Reassign regrade
      </button>
    );
  }

  return (
    <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        disabled={isLoading}
        onClick={() => reassign({ submissionId, answerId: answer._id, graderId: null })}
      >
        {label}
      </button>
      <SearchSelect
        className="select"
        style={{ maxWidth: 180 }}
        disabled={isLoading}
        value=""
        onChange={(e) => e.target.value && reassign({ submissionId, answerId: answer._id, graderId: e.target.value })}
      >
        <option value="">Assign to…</option>
        {(graders || []).map((g) => (
          <option key={g._id} value={g._id}>{g.name} ({g.role})</option>
        ))}
      </SearchSelect>
    </div>
  );
}

// A flagged mcq/mtf answer — shown so the teacher can actually see and
// respond to the complaint, but with no marks field at all: overriding an
// auto-score raises questions (does it change future auto-grading? does
// the total recompute the same way?) that haven't been decided yet, so
// this deliberately stops at "leave a note", the one action that changes
// nothing about scoring.
function FlaggedOtherCard({ answer, submissionId, grade, saving, locked }) {
  const [note, setNote] = useState(answer.teacherComment || "");
  const question = answer.question;
  const type = answer.questionType;

  return (
    <div className="card stack" style={{ borderColor: "var(--warning)" }}>
      <div className="spread">
        <div className="row-tight" style={{ gap: 6 }}>
          <TypePill type={type} compact />
          <span className="pill pill-warn">Flagged</span>
        </div>
      </div>

      <Latex as="div" className="prose">{question?.question}</Latex>

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
                  padding: "8px 10px", borderRadius: 8,
                  background: correct ? "var(--correct-bg)" : selected ? "var(--incorrect-bg)" : "var(--surface-alt)",
                  color: correct ? "var(--correct)" : selected ? "var(--incorrect)" : undefined,
                }}
              >
                <span style={{ minWidth: 18, opacity: 0.65 }}>{option.key}</span>
                <span className="grow"><Latex>{option.text}</Latex></span>
              </div>
            );
          })}
        </div>
      )}

      {type === "mtf" && (
        <div className="stack" style={{ gap: 5 }}>
          {(question?.statements || []).map((statement, i) => {
            const response = (answer.statementAnswers || []).find((s) => s.index === i);
            return (
              <div key={i} className="small row-tight" style={{ padding: "8px 10px", borderRadius: 8, background: "var(--surface-alt)" }}>
                <span className={`pill ${statement.isTrue ? "pill-ok" : "pill-bad"}`} style={{ minWidth: 58 }}>
                  {statement.isTrue ? "True" : "False"}
                </span>
                <span className="grow"><Latex>{statement.text}</Latex></span>
                <span className="muted">
                  {response?.value === undefined || response?.value === null ? "not answered" : String(response.value)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {type === "passage" && (
        <div className="stack" style={{ gap: 10 }}>
          {(question?.subQuestions || []).map((sq, i) => {
            // A written question under it is marked as its own answer.
            if (sq.type === "written") return null;
            const response = (answer.subAnswers || []).find((s) => s.index === i);
            return (
              <div key={i} className="stack" style={{ gap: 5 }}>
                <Latex as="div" className="prose small">{sq.question}</Latex>
                {(sq.options || []).map((option) => {
                  const correct = option.key === sq.correctOption;
                  const selected = option.key === response?.selectedOption;
                  return (
                    <div
                      key={option.key}
                      className="small row-tight"
                      style={{
                        padding: "8px 10px", borderRadius: 8,
                        background: correct ? "var(--correct-bg)" : selected ? "var(--incorrect-bg)" : "var(--surface-alt)",
                        color: correct ? "var(--correct)" : selected ? "var(--incorrect)" : undefined,
                      }}
                    >
                      <span style={{ minWidth: 18, opacity: 0.65 }}>{option.key}</span>
                      <span className="grow"><Latex>{option.text}</Latex></span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div className="stack" style={{ gap: 6 }}>
        <Field label="Note for the student">
          <textarea
            className="input"
            rows={2}
            value={note}
            disabled={locked}
            placeholder="Explain why this answer was marked the way it was…"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <button
          className="btn btn-sm"
          style={{ alignSelf: "flex-start" }}
          disabled={saving || locked || note.trim() === (answer.teacherComment || "")}
          onClick={() => grade({ submissionId, answerId: answer._id, comment: note.trim() })}
        >
          Save note
        </button>
      </div>
    </div>
  );
}
