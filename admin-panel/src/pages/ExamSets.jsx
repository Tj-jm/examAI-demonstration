import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Layers, ChevronRight, ArrowLeft, Plus, Search } from "lucide-react";
import { useGetExamSetsQuery, useCreateExamSetMutation, useGetExamsQuery } from "../api/contentApi";
import { Loading, ErrorNote, Empty } from "../components/bits";

// Paper sets: an exam's questions used as a pool and cut into several
// papers, one per student (backend examSetController.js).

function NewSets({ onCancel }) {
  const [search, setSearch] = useState("");
  const { data, isFetching } = useGetExamsQuery({ search: search || undefined, limit: 20 });
  const [create, { isLoading, error }] = useCreateExamSetMutation();
  const navigate = useNavigate();
  const exams = (data?.exams || []).filter((e) => !e.paperSet?.group && e.questionCount >= 2);
  const pick = async (examId) => {
    const r = await create({ source: examId });
    if (r.data?._id) navigate(`/exam-sets/${r.data._id}`);
  };
  return (
    <div className="card stack">
      <div>
        <strong>Pick the exam that holds the pool</strong>
        <p className="muted small" style={{ margin: "2px 0 0" }}>
          Its questions are the pool, and its settings (minutes, kind, attempts, shuffle, away limit) go to every set. It stays a draft.
        </p>
      </div>
      <div className="search-wrap">
        <Search size={15} className="search-icon" />
        <input className="input" style={{ paddingLeft: 36 }} autoFocus placeholder="Search exams" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorNote error={error} />
      <div className="list" style={{ opacity: isFetching ? 0.6 : 1 }}>
        {exams.map((e) => (
          <button key={e._id} type="button" className="list-row" disabled={isLoading} onClick={() => pick(e._id)} style={{ textAlign: "left", width: "100%" }}>
            <div className="grow">
              <div>{e.title}</div>
              <div className="muted small tnum">{e.questionCount} questions · {e.durationMinutes} min</div>
            </div>
            <ChevronRight size={16} className="muted" />
          </button>
        ))}
        {!exams.length && !isFetching && <span className="muted small">No exam with 2 or more questions matches.</span>}
      </div>
      <div><button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

export default function ExamSets() {
  const { data, isLoading, error } = useGetExamSetsQuery();
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  if (isLoading) return <Loading />;
  const groups = data?.groups || [];
  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Paper sets</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>One pool of questions, several papers. Each student gets one, so neighbours rarely share a paper.</p>
        </div>
        <div className="row-tight">
          <button className="btn btn-quiet" onClick={() => navigate("/exams")}><ArrowLeft size={15} /> Exams</button>
          <button className="btn" onClick={() => setAdding(true)}><Plus size={15} /> New paper sets</button>
        </div>
      </div>
      <div className="stack">
        <ErrorNote error={error} />
        {adding && <NewSets onCancel={() => setAdding(false)} />}
        {!groups.length && !adding ? (
          <Empty
            icon={Layers}
            title="No paper sets yet"
            hint="Build an exam holding the whole pool (say 100 questions), then make paper sets from it: for example 8 papers of 10."
            action={<button className="btn" onClick={() => setAdding(true)}>New paper sets</button>}
          />
        ) : (
          <div className="list">
            {groups.map((g) => (
              <Link key={g._id} className="list-row" to={`/exam-sets/${g._id}`}>
                <div className="grow">
                  <div className="row-tight" style={{ marginBottom: 5, flexWrap: "wrap" }}>
                    <span className={`pill ${g.isPublished ? "pill-ok" : "pill-warn"}`}>{g.isPublished ? "Published" : "Draft"}</span>
                    <span className="pill">{g.assign === "schedule" ? "By schedule" : "Random"}</span>
                    {!g.builtAt && <span className="pill">Not drawn yet</span>}
                  </div>
                  <div style={{ fontSize: 14.5 }}>{g.title}</div>
                  <div className="muted small tnum" style={{ marginTop: 3 }}>
                    {g.setCount} sets · {g.perPaper} per paper · pool of {g.poolSize}
                    {g.batches?.length ? ` · ${g.batches.map((b) => b.name).join(", ")}` : " · no batch"}
                  </div>
                </div>
                <ChevronRight size={16} className="muted" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
