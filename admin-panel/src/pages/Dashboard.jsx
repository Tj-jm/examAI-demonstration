import { Link, useOutletContext } from "react-router-dom";
import CountUp from "../components/CountUp";
import { useGetQuestionsQuery, useGetExamsQuery, useGetBatchesQuery } from "../api/contentApi";
import { useGetReviewQueueQuery, useGetAiUsageQuery } from "../api/aiApi";
import { Sparkles, ClipboardList, FolderTree, Pencil, ChevronRight } from "lucide-react";
import { Loading } from "../components/bits";
import { useGetBadgesQuery } from "../api/badgeApi";
import UsageChart from "../components/UsageChart";
import MyHome from "./MyHome";

// Leads with what needs a decision, not with counts. A teacher opening this
// wants a to-do list; the totals are context, not the point.

// AiUsage stores the raw internal feature key exactly as passed to
// aiService.generate({feature: ...}) — translated here purely for display.
// Pulled from every actual call site rather than guessed, since a plausible-
// looking key that doesn't match reality would just show up as a raw,
// unlabelled string.
const FEATURE_LABEL = {
  question_generation: "Question generation",
  solution_backfill: "Solution writing",
  quality_check: "Quality checks",
  document_generation: "Document generation",
  "lecture-summarize": "Lecture summaries",
  "practice-explain": "Practice: explain",
  "practice-similar": "Practice: similar questions",
  "practice-grade-written": "Practice: grade written",
  "practice-exam-grade-written": "Practice exam grading",
  "doubt-solve": "Doubt solving",
};

// Everyone but owners and admins gets their own home (MyHome.jsx).
export default function Dashboard() {
  const { me } = useOutletContext();
  return ["owner", "admin"].includes(me?.role) ? <Overview me={me} /> : <MyHome />;
}

function Overview({ me }) {

  const questions = useGetQuestionsQuery({ limit: 1 });
  const noSolution = useGetQuestionsQuery({ hasSolution: "false", limit: 1 });
  const exams = useGetExamsQuery({ limit: 1 });
  const batches = useGetBatchesQuery({});
  const review = useGetReviewQueueQuery();
  const usage = useGetAiUsageQuery(30);
  const badges = useGetBadgesQuery(undefined, { skip: !["owner", "admin"].includes(me?.role) });

  if (questions.isLoading) return <Loading />;

  const pendingReview = review.data?.total || 0;
  const missingSolutions = noSolution.data?.total || 0;
  const drafts = (exams.data?.exams || []).filter((e) => !e.isPublished).length;

  const todo = [
    pendingReview > 0 && {
      count: pendingReview,
      label: `generated question${pendingReview === 1 ? "" : "s"} waiting for review`,
      to: "/review",
      tone: "var(--ai)",
    },
    missingSolutions > 0 && {
      count: missingSolutions,
      label: `question${missingSolutions === 1 ? " has" : "s have"} no solution written`,
      to: "/questions?hasSolution=false",
      tone: "var(--warning)",
    },
    drafts > 0 && {
      count: drafts,
      label: `exam${drafts === 1 ? "" : "s"} still in draft`,
      to: "/exams",
      tone: "var(--text-muted)",
    },
  ].filter(Boolean);

  return (
    <div className="page">
      <div className="page-head">
        <p className="muted small" style={{ margin: 0 }}>Signed in as {me.name}</p>
        <h1>Overview</h1>
      </div>

      <div className="stack">
        {todo.length > 0 ? (
          <div className="card-strong">
            <div className="stack" style={{ gap: 0 }}>
              {todo.map((item, index) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="row"
                  style={{
                    padding: "12px 0",
                    borderTop: index === 0 ? "none" : "1px solid color-mix(in srgb, var(--primary-fg) 14%, transparent)",
                  }}
                >
                  <span
                    className="tnum"
                    style={{ fontSize: 21, fontWeight: 500, letterSpacing: "-0.03em", minWidth: 36, color: item.tone }}
                  >
                    {item.count}
                  </span>
                  <span className="grow" style={{ fontSize: 13.5 }}>{item.label}</span>
                  <ChevronRight size={16} style={{ opacity: 0.5 }} />
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="card-strong">
            <div style={{ fontSize: 14 }}>Nothing needs your attention.</div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Stat value={questions.data?.total ?? 0} label="Questions" />
          <Stat value={exams.data?.total ?? 0} label="Exams" />
          <Stat value={batches.data?.length ?? 0} label="Batches" />
          <Stat
            value={usage.data ? `$${(usage.data.totals.cost || 0).toFixed(2)}` : "—"}
            label="AI spend, 30 days"
          />
        </div>

        {/* Both byDay and byFeature already arrive on this page via the
            same /api/ai/usage call the spend stat tile above reads from —
            this only visualises data that was already being fetched, not a
            new query. Renders nothing for teacher/doubtSolver, exactly like
            that stat tile already does, since the endpoint is owner/admin
            only and usage.data is simply undefined for anyone else. */}
        {usage.data?.byDay?.length > 0 && (
          <div className="card">
            <div className="spread" style={{ marginBottom: 4 }}>
              <h3 style={{ margin: 0 }}>AI calls, last 30 days</h3>
              <span className="muted small tnum">{usage.data.totals.calls} total</span>
            </div>
            <UsageChart byDay={usage.data.byDay} />

            {usage.data.byFeature?.length > 0 && (
              <div className="stack" style={{ gap: 6, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                {usage.data.byFeature.slice(0, 5).map((f) => {
                  const share = usage.data.totals.calls > 0 ? (f.calls / usage.data.totals.calls) * 100 : 0;
                  return (
                    <div key={f._id} className="row-tight" style={{ gap: 10 }}>
                      <span className="small" style={{ width: 150, flexShrink: 0 }}>{FEATURE_LABEL[f._id] || f._id}</span>
                      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ width: `${share}%`, height: "100%", background: "var(--ai)" }} />
                      </div>
                      <span className="muted small tnum" style={{ width: 70, textAlign: "right", flexShrink: 0 }}>
                        {f.calls} call{f.calls === 1 ? "" : "s"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Start something</h3>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Link className="btn btn-sm" to="/questions/new"><Pencil size={14} /> Write a question</Link>
            <Link className="btn btn-sm btn-quiet" to="/exams"><ClipboardList size={14} /> Build an exam</Link>
            <Link className="btn btn-sm btn-quiet" to="/content"><FolderTree size={14} /> Add a subject</Link>
            <Link className="btn btn-sm btn-quiet" to="/generate"><Sparkles size={14} /> Generate with AI</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const Stat = ({ value, label }) => (
  <div className="card-quiet">
    <div className="tnum" style={{ fontSize: 25, fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 1 }}>
      <CountUp value={value} />
    </div>
    <div className="muted small" style={{ marginTop: 5 }}>{label}</div>
  </div>
);
