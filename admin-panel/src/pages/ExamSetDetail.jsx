import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Layers, Shuffle, CalendarClock, Send, EyeOff, Trash2, AlertTriangle, Trophy } from "lucide-react";
import {
  useGetExamSetQuery, useUpdateExamSetMutation, useBuildExamSetMutation, usePublishExamSetMutation,
  useGetExamSetResultsQuery, useDeleteExamSetMutation, useGetBatchesQuery,
} from "../api/contentApi";
import { Loading, ErrorNote, Field, useConfirm } from "../components/bits";

// One paper-set group (backend examSetController.js): the pool, how each
// paper is drawn, who gets which set (random or by schedule), the batches,
// the sets themselves and one merit list across them.

const toLocal = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const toIso = (v) => (v ? new Date(v).toISOString() : null);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

const SPLITS = [["none", "Whole pool"], ["topic", "By topic"], ["difficulty", "By difficulty"], ["both", "Topic and difficulty"]];
const splitOf = (rules) => {
  if (!rules?.length) return "none";
  const t = rules.some((r) => r.topic || r.noTopic);
  const d = rules.some((r) => r.difficulty);
  return t && d ? "both" : t ? "topic" : d ? "difficulty" : "none";
};
const ruleKey = (r) => `${r.topic || (r.noTopic ? "none" : "-")}|${r.difficulty || "-"}`;

// perPaper shared out over the rows in proportion to their pool size,
// never more than a row holds.
const spread = (rows, perPaper) => {
  const total = rows.reduce((s, r) => s + r.items, 0) || 1;
  const out = rows.map((r) => ({ ...r, count: Math.min(r.items, Math.floor((perPaper * r.items) / total)) }));
  let left = perPaper - out.reduce((s, r) => s + r.count, 0);
  const order = [...out].sort((a, b) => b.items - a.items);
  while (left > 0 && order.some((r) => r.count < r.items)) {
    for (const r of order) {
      if (left <= 0) break;
      if (r.count < r.items) { r.count += 1; left -= 1; }
    }
  }
  return out;
};

function Results({ id }) {
  const { data, isLoading, error } = useGetExamSetResultsQuery(id);
  if (isLoading) return <span className="muted small">Loading…</span>;
  if (error) return <ErrorNote error={error} />;
  const rows = data?.rows || [];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
        {(data?.perSet || []).map((s) => (
          <span key={s.label} className="pill tnum" title="Average score on this set">
            Set {s.label}: {s.average === null ? "—" : `${s.average}%`} · {s.students}
          </span>
        ))}
      </div>
      <p className="muted small" style={{ margin: 0 }}>Ranked by percentage, because sets can differ a little in total marks. Each student's best graded attempt counts.</p>
      {!rows.length ? <span className="muted small">No graded attempts yet.</span> : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>#</th><th>Student</th><th>Set</th><th>Marks</th><th>%</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student._id}>
                  <td className="tnum">{r.rank}</td>
                  <td>{r.student.name}{r.student.studentId ? <span className="muted small"> · {r.student.studentId}</span> : null}</td>
                  <td>{r.set}</td>
                  <td className="tnum">{r.marks} / {r.totalMarks}</td>
                  <td className="tnum">{r.percent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ExamSetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: g, isLoading, error } = useGetExamSetQuery(id);
  const { data: batches } = useGetBatchesQuery({ includeInactive: "true" });
  const [update, { isLoading: saving, error: saveError }] = useUpdateExamSetMutation();
  const [build, { isLoading: building, error: buildError }] = useBuildExamSetMutation();
  const [publish, { isLoading: publishing, error: publishError }] = usePublishExamSetMutation();
  const [remove, { error: deleteError }] = useDeleteExamSetMutation();
  const [form, setForm] = useState(null);
  const [showResults, setShowResults] = useState(false);

  // The editable copy, reset whenever the server's copy changes.
  useEffect(() => {
    if (!g) return;
    setForm({
      title: g.title,
      perPaper: g.perPaper,
      setCount: g.setCount,
      split: splitOf(g.rules),
      rules: g.rules || [],
      assign: g.assign,
      opensAt: toLocal(g.opensAt),
      closesAt: toLocal(g.closesAt),
      batches: (g.batches || []).map((b) => b._id || b),
      windows: Object.fromEntries((g.sets || []).map((s) => [s.exam, { opensAt: toLocal(s.opensAt), closesAt: toLocal(s.closesAt) }])),
    });
  }, [g]);

  if (isLoading || (!form && !error)) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const set = (patch) => setForm({ ...form, ...patch });
  const pool = g.pool;
  const locked = g.locked;
  const splitRows = { topic: pool.byTopic, difficulty: pool.byDifficulty, both: pool.byBoth }[form.split] || [];
  const countOf = new Map(form.rules.map((r) => [ruleKey(r), r.count]));
  const rules = form.split === "none" ? [] : splitRows.map((r) => ({ ...r, count: countOf.get(ruleKey(r)) ?? 0 }));
  const ruleSum = rules.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const rulesOff = form.split !== "none" && ruleSum !== Number(form.perPaper);

  const body = () => ({
    id,
    title: form.title,
    ...(locked ? {} : {
      perPaper: Number(form.perPaper),
      setCount: Number(form.setCount),
      rules: rules.map(({ topic, noTopic, difficulty, label, count }) => ({ topic, noTopic, difficulty, label, count: Number(count) || 0 })),
    }),
    assign: form.assign,
    batches: form.batches,
    opensAt: toIso(form.opensAt),
    closesAt: toIso(form.closesAt),
    windows: Object.entries(form.windows).map(([exam, w]) => ({ exam, opensAt: toIso(w.opensAt), closesAt: toIso(w.closesAt) })),
  });
  const save = () => update(body());
  const draw = async () => {
    if (g.sets.length && !(await confirm({
      title: "Draw the sets again?",
      body: "The current sets are replaced by new ones. Any edits made to a set's questions are lost.",
      confirmLabel: "Draw again",
      tone: "neutral",
    }))) return;
    const r = await update(body());
    if (!r.error) await build(id);
  };
  const spreadEvenly = () => set({ rules: spread(splitRows, Number(form.perPaper) || 0) });
  const setRule = (r, count) => set({ rules: [...rules.filter((x) => ruleKey(x) !== ruleKey(r)), { ...r, count }] });
  const setWindow = (examId, patch) => set({ windows: { ...form.windows, [examId]: { ...form.windows[examId], ...patch } } });

  // Schedule warnings: sets with no window, and times with no set open.
  const windows = g.sets.map((s) => ({ label: s.label, ...form.windows[s.exam] }));
  const noWindow = form.assign === "schedule" ? windows.filter((w) => !w.opensAt || !w.closesAt).map((w) => w.label) : [];
  const uses = Number(form.perPaper) * Number(form.setCount);

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="grow">
          <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
            <span className="pill row-tight" style={{ gap: 4 }}><Layers size={11} /> Paper sets</span>
            <span className={`pill ${g.isPublished ? "pill-ok" : "pill-warn"}`}>{g.isPublished ? "Published" : "Draft"}</span>
          </div>
          <h1>{g.title}</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            Pool from <Link to={`/exams/${g.source?._id || g.source}`}>{g.source?.title || "an exam"}</Link> · {pool.questions} questions · {pool.items} items
          </p>
        </div>
        <div className="row-tight" style={{ flexWrap: "wrap" }}>
          {g.isPublished ? (
            <button className="btn btn-sm btn-quiet" disabled={publishing} onClick={async () => {
              if (await confirm({ title: "Unpublish the paper sets?", body: "Students can't start them until you publish again. Attempts already made stay.", confirmLabel: "Unpublish", tone: "neutral" })) publish({ id, isPublished: false });
            }}><EyeOff size={14} /> Unpublish</button>
          ) : (
            <button className="btn btn-sm" disabled={publishing || !g.sets.length} onClick={() => publish({ id, isPublished: true })}><Send size={14} /> Publish</button>
          )}
          {!g.isPublished && !locked && (
            <button className="btn btn-sm btn-quiet" aria-label="Delete" onClick={async () => {
              if (await confirm({ title: `Delete "${g.title}"?`, body: "The sets are deleted too. The pool exam stays.", confirmLabel: "Delete" })) {
                const r = await remove(id);
                if (!r.error) navigate("/exam-sets");
              }
            }}><Trash2 size={14} /></button>
          )}
          <button className="btn btn-sm btn-quiet" onClick={() => navigate("/exam-sets")}><ArrowLeft size={14} /> Paper sets</button>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={saveError || buildError || publishError || deleteError} />
        {locked && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>Students have sat these sets, so the papers are fixed. You can still change the schedule, batches and title.</span>
          </div>
        )}
        {!pool.equalMarks && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>Pool questions carry different marks, so sets may differ in total. The merit list ranks by percentage.</span>
          </div>
        )}
        {pool.unapproved > 0 && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{pool.unapproved} pool question{pool.unapproved === 1 ? " is" : "s are"} not approved. Approve or remove {pool.unapproved === 1 ? "it" : "them"} in the pool exam before publishing.</span>
          </div>
        )}

        <div className="card stack">
          <strong>Papers</strong>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Title (students see this)">
              <input className="input" maxLength={160} value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Items per paper" hint="A passage with its parts counts as one item.">
              <input className="input tnum" type="number" min="1" max={pool.items} style={{ maxWidth: 110 }} disabled={locked} value={form.perPaper} onChange={(e) => set({ perPaper: e.target.value })} />
            </Field>
            <Field label="Number of sets">
              <input className="input tnum" type="number" min="2" max="30" style={{ maxWidth: 110 }} disabled={locked} value={form.setCount} onChange={(e) => set({ setCount: e.target.value })} />
            </Field>
          </div>
          {pool.items > 0 && uses > pool.items && (
            <span className="small muted">
              {Number(form.setCount)} sets × {Number(form.perPaper)} items needs {Number(form.setCount) * Number(form.perPaper)} item uses from a pool of {pool.items}, so sets will share questions. Every item is used before any is used twice.
            </span>
          )}
          <Field label="How each paper is drawn" hint="Split the pool so every paper has the same mix.">
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
              {SPLITS.map(([v, l]) => (
                <button key={v} type="button" disabled={locked} className={`pill pill-btn${form.split === v ? " pill-on" : ""}`}
                  onClick={() => set({ split: v, rules: v === "none" ? [] : spread({ topic: pool.byTopic, difficulty: pool.byDifficulty, both: pool.byBoth }[v], Number(form.perPaper) || 0) })}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          {form.split !== "none" && (
            <div className="stack" style={{ gap: 6 }}>
              {rules.map((r) => (
                <div key={ruleKey(r)} className="row-tight">
                  <span className="grow">{r.label}</span>
                  <span className="muted small tnum">{r.items} in pool</span>
                  <input className="input tnum" type="number" min="0" max={r.items} style={{ maxWidth: 80 }} disabled={locked} value={r.count} onChange={(e) => setRule(r, Number(e.target.value))} />
                </div>
              ))}
              <div className="row-tight">
                <span className={`small tnum grow ${rulesOff ? "" : "muted"}`} style={rulesOff ? { color: "var(--danger)" } : undefined}>
                  {ruleSum} of {form.perPaper} per paper{rulesOff ? " — must add up exactly" : ""}
                </span>
                <button type="button" className="btn btn-sm btn-quiet" disabled={locked} onClick={spreadEvenly}>Share out evenly</button>
              </div>
            </div>
          )}
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            {!locked && (
              <button className="btn" disabled={building || saving || rulesOff || g.isPublished} onClick={draw}>
                <Shuffle size={15} /> {building ? "Drawing…" : g.sets.length ? "Draw the sets again" : "Draw the sets"}
              </button>
            )}
            {g.isPublished && !locked && <span className="muted small">Unpublish to draw again.</span>}
            {g.overlap && (
              <span className="muted small tnum">Sets share {g.overlap.average}% of questions on average (at most {g.overlap.most}% between two).</span>
            )}
          </div>
        </div>

        <div className="card stack">
          <strong>Who gets which set</strong>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
            <button type="button" className={`pill pill-btn${form.assign === "random" ? " pill-on" : ""}`} onClick={() => set({ assign: "random" })}>
              <Shuffle size={11} /> Random
            </button>
            <button type="button" className={`pill pill-btn${form.assign === "schedule" ? " pill-on" : ""}`} onClick={() => set({ assign: "schedule" })}>
              <CalendarClock size={11} /> By schedule
            </button>
          </div>
          {form.assign === "random" ? (
            <>
              <p className="muted small" style={{ margin: 0 }}>Every set opens together. Each student gets a set at random (the least-used first), kept for every attempt.</p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <Field label="Opens (optional)"><input className="input" type="datetime-local" value={form.opensAt} onChange={(e) => set({ opensAt: e.target.value })} /></Field>
                <Field label="Closes (optional)"><input className="input" type="datetime-local" value={form.closesAt} onChange={(e) => set({ closesAt: e.target.value })} /></Field>
              </div>
            </>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                Each set opens in its own window. A student gets a set open when they start; when several are open together, one of them at random. Give each day or shift its own sets so early students can't pass questions on.
              </p>
              {!g.sets.length ? <span className="muted small">Draw the sets first, then give each one its window.</span> : (
                <div className="stack" style={{ gap: 6 }}>
                  {g.sets.map((s) => (
                    <div key={s.exam} className="row-tight" style={{ flexWrap: "wrap" }}>
                      <span className="pill" style={{ minWidth: 52, justifyContent: "center" }}>Set {s.label}</span>
                      <input className="input" type="datetime-local" style={{ maxWidth: 220 }} value={form.windows[s.exam]?.opensAt || ""} onChange={(e) => setWindow(s.exam, { opensAt: e.target.value })} aria-label={`Set ${s.label} opens`} />
                      <span className="muted small">to</span>
                      <input className="input" type="datetime-local" style={{ maxWidth: 220 }} value={form.windows[s.exam]?.closesAt || ""} onChange={(e) => setWindow(s.exam, { closesAt: e.target.value })} aria-label={`Set ${s.label} closes`} />
                    </div>
                  ))}
                  {noWindow.length > 0 && (
                    <span className="small" style={{ color: "var(--warn, var(--danger))" }}>
                      Set {noWindow.join(", ")} {noWindow.length === 1 ? "has" : "have"} no full window, so {noWindow.length === 1 ? "it is" : "they are"} open whenever the group is published.
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="card stack">
          <strong>Batches</strong>
          <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
            {(batches || []).map((b) => {
              const on = form.batches.includes(b._id);
              return (
                <button key={b._id} type="button" className={`pill pill-btn${on ? " pill-on" : ""}`} onClick={() => set({ batches: on ? form.batches.filter((x) => x !== b._id) : [...form.batches, b._id] })}>
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="row-tight">
          <button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          <span className="muted small">Saves the title, schedule and batches{locked ? "" : ", and the paper settings for the next draw"}.</span>
        </div>

        {g.sets.length > 0 && (
          <div className="card stack">
            <strong>Sets</strong>
            <div style={{ overflowX: "auto" }}>
              <table className="table">
                <thead><tr><th>Set</th><th>Questions</th><th>Marks</th>{g.assign === "schedule" && <th>Window</th>}<th>Given</th><th>Sat</th><th /></tr></thead>
                <tbody>
                  {g.sets.map((s) => (
                    <tr key={s.exam}>
                      <td>{s.label}</td>
                      <td className="tnum">{s.questions}</td>
                      <td className="tnum">{s.totalMarks}</td>
                      {g.assign === "schedule" && <td className="small">{when(s.opensAt)} – {when(s.closesAt)}</td>}
                      <td className="tnum">{s.given}</td>
                      <td className="tnum">{s.sat}</td>
                      <td><Link to={`/exams/${s.exam}`} className="small">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="muted small">Grading and each student's result work as for any exam. Open a set to see or swap its questions before anyone sits it.</span>
          </div>
        )}

        {g.sets.length > 0 && (
          <div className="card stack">
            <button type="button" className="row-tight" style={{ background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", textAlign: "left" }} onClick={() => setShowResults(!showResults)}>
              <Trophy size={15} /> <strong>Merit list across all sets</strong>
            </button>
            {showResults && <Results id={id} />}
          </div>
        )}
      </div>
    </div>
  );
}
