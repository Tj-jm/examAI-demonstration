import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TrendingUp, ChevronRight, Sparkles } from "lucide-react";
import { useCreatePredictedPaperMutation, useGetPredictedPapersQuery } from "../api/aiApi";
import { useGetAuthoritiesQuery, useGetSubjectsQuery } from "../api/contentApi";
import { Loading, ErrorNote, Empty, Field } from "../components/bits";
import SearchSelect from "../components/SearchSelect";

const STATUS = {
  generating: ["pill", "Generating…"],
  ready: ["pill pill-warn", "Ready for review"],
  failed: ["pill pill-bad", "Failed"],
  exam_created: ["pill pill-ok", "Exam created"],
};

// Predicted next paper: the AI reads which topics a board's real past
// papers covered year by year, weighs them for the next paper, and fills
// that shape with real archive questions plus new ones in the same style.
// The run itself lives on PredictedPaperDetail.jsx.
export default function PredictedPaper() {
  const navigate = useNavigate();
  const { data: authorities } = useGetAuthoritiesQuery();
  const { data: subjects } = useGetSubjectsQuery();
  const { data, isLoading } = useGetPredictedPapersQuery(undefined, { refetchOnMountOrArgChange: true });
  const [create, createState] = useCreatePredictedPaperMutation();
  const [form, setForm] = useState({ authority: "", subject: "", count: 25, realPercent: 60, types: ["mcq"], difficulty: "medium" });

  const toggleType = (type) =>
    setForm((f) => ({
      ...f,
      types: f.types.includes(type) ? f.types.filter((t) => t !== type) : [...f.types, type],
    }));

  const submit = async () => {
    try {
      const paper = await create({
        authority: form.authority,
        subject: form.subject,
        count: Number(form.count),
        realShare: Number(form.realPercent) / 100,
        types: form.types,
        difficulty: form.difficulty,
      }).unwrap();
      navigate(`/predicted-paper/${paper._id}`);
    } catch {
      // shown via createState.error
    }
  };

  const papers = data?.papers || [];
  const canSubmit = form.authority && form.subject && form.types.length > 0 && !createState.isLoading;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Predicted paper</h1>
        <p className="muted small" style={{ margin: "2px 0 0" }}>
          The AI studies which topics a board&apos;s past papers covered, year by year, and builds the most likely
          next paper — real archive questions plus new ones in the same style. New questions go to Review first;
          once approved, turn the paper into an exam and share it with batches.
        </p>
      </div>

      <div className="stack">
        <div className="card stack">
          <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <Field label="Board / exam">
              <SearchSelect className="select" value={form.authority} onChange={(e) => setForm({ ...form, authority: e.target.value })}>
                <option value="">Choose…</option>
                {(authorities || []).map((a) => (
                  <option key={a._id} value={a._id}>{a.name}</option>
                ))}
              </SearchSelect>
            </Field>

            <Field label="Subject">
              <SearchSelect className="select" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                <option value="">Choose…</option>
                {(subjects || []).map((s) => (
                  <option key={s._id} value={s._id}>{s.title}</option>
                ))}
              </SearchSelect>
            </Field>

            <Field label="Questions">
              <input
                className="input tnum"
                type="number"
                min="5"
                max="60"
                style={{ width: 84 }}
                value={form.count}
                onChange={(e) => setForm({ ...form, count: e.target.value })}
              />
            </Field>

            <Field label="Real questions" hint="The rest are written by AI">
              <select className="select" value={form.realPercent} onChange={(e) => setForm({ ...form, realPercent: Number(e.target.value) })}>
                {[100, 80, 60, 40, 20, 0].map((p) => (
                  <option key={p} value={p}>{p}%</option>
                ))}
              </select>
            </Field>

            <Field label="Difficulty of new questions">
              <select className="select" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </Field>
          </div>

          <div className="field">
            <span className="label">Types</span>
            <div className="row-tight">
              {[["mcq", "Multiple choice"], ["mtf", "True / false"], ["written", "Written"]].map(([value, label]) => (
                <button key={value} className={`pill pill-btn${form.types.includes(value) ? " pill-on" : ""}`} onClick={() => toggleType(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ErrorNote error={createState.error} />

          <div>
            <button className="btn" disabled={!canSubmit} onClick={submit}>
              <Sparkles size={15} /> {createState.isLoading ? "Starting…" : "Predict next paper"}
            </button>
          </div>
        </div>

        <h2 style={{ margin: "8px 0 0", fontSize: 15 }}>Past runs</h2>
        {isLoading ? (
          <Loading />
        ) : papers.length === 0 ? (
          <Empty icon={TrendingUp} title="No predicted papers yet" hint="Pick a board and subject above to build one." />
        ) : (
          papers.map((p) => {
            const [pillClass, pillLabel] = STATUS[p.status] || STATUS.ready;
            return (
              <Link className="card row-tight" key={p._id} to={`/predicted-paper/${p._id}`}>
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>
                    {p.authority?.shortName || p.authority?.name} · {p.subject?.title}
                    {p.predictedYear ? ` · ${p.predictedYear}` : ""}
                  </div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    {p.params?.count} questions · {new Date(p.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {p.sharedAsSet && <span className="pill pill-ai">Shared set</span>}
                <span className={pillClass}>{pillLabel}</span>
                <ChevronRight size={16} className="muted" />
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
