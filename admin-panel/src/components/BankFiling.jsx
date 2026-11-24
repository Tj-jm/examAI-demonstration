import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Library, BookOpen } from "lucide-react";
import { useGetTreeQuery, useUpdateQuestionMutation } from "../api/contentApi";
import { ErrorNote } from "./bits";
import SearchSelect from "./SearchSelect";

// Subject → chapter → topic pickers and a save button for one question. On a
// lecture-quiz-only question saving also puts it in the question bank
// (addToBank); on a bank question it only moves where it is filed.
// Used by the lecture's practice question window, the Questions page and
// the question page.
export function BankFiling({ question, startChapter = "", startTopic = "", hint, onSaved }) {
  const { data: tree } = useGetTreeQuery();
  const [updateQuestion, { isLoading: saving, error }] = useUpdateQuestionMutation();
  const ownerOf = (chapterId) => (tree || []).find((s) => s.chapters.some((c) => c._id === chapterId));
  const [subjectId, setSubjectId] = useState("");
  const [chapter, setChapter] = useState(startChapter);
  const [topic, setTopic] = useState(startTopic);
  const [done, setDone] = useState(false);
  const subject = subjectId || ownerOf(chapter)?._id || "";
  const chapters = (tree || []).find((s) => s._id === subject)?.chapters || [];
  const topics = chapters.find((c) => c._id === chapter)?.topics || [];
  const inBank = !question.lectureQuizOnly;
  // A passage question is filed under a chapter only (questionController's resolveFiling).
  const chapterOnly = question.type === "passage";

  const save = async () => {
    try {
      await updateQuestion({ id: question._id, chapter, topic: chapterOnly ? null : topic || null, ...(inBank ? {} : { addToBank: true }) }).unwrap();
      setDone(true);
      onSaved?.();
    } catch {
      // rendered below
    }
  };

  return (
    <div className="card-quiet stack" style={{ gap: 8 }}>
      <span className="label">{inBank ? "Filed in the question bank under" : "Add to the question bank"}</span>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <select className="select" value={subject} onChange={(e) => { setSubjectId(e.target.value); setChapter(""); setTopic(""); }}>
          <option value="">Choose a subject</option>
          {(tree || []).map((s) => <option key={s._id} value={s._id}>{s.title}</option>)}
        </select>
        <SearchSelect className="select" value={chapter} disabled={!subject} onChange={(e) => { setChapter(e.target.value); setTopic(""); }}>
          <option value="">Choose a chapter</option>
          {chapters.map((c) => <option key={c._id} value={c._id}>{c.title}</option>)}
        </SearchSelect>
        {!chapterOnly && (
          <SearchSelect className="select" value={topic} disabled={!chapter} onChange={(e) => setTopic(e.target.value)}>
            <option value="">Whole chapter</option>
            {topics.map((t) => <option key={t._id} value={t._id}>{t.title}</option>)}
          </SearchSelect>
        )}
      </div>
      {hint && <p className="hint" style={{ margin: 0 }}>{hint}</p>}
      <ErrorNote error={error} />
      <div className="row-tight">
        <button type="button" className="btn btn-sm btn-primary" disabled={!chapter || saving} onClick={save}>
          <Library size={14} /> {saving ? "Saving…" : inBank ? "Save filing" : "Add to question bank"}
        </button>
        {done && <span className="hint row-tight" style={{ gap: 4 }}><CheckCircle2 size={13} /> Saved.</span>}
      </div>
    </div>
  );
}

// The lectures whose quiz uses a question (questionController's
// servingLectures), each with the batches its quiz is for.
export function ServingLectures({ lectures }) {
  if (!lectures) return null;
  if (!lectures.length) return <span className="muted small">Not in any lecture quiz.</span>;
  return (
    <div className="row-tight small" style={{ flexWrap: "wrap", gap: 6 }}>
      <span className="muted row-tight" style={{ gap: 4 }}><BookOpen size={12} /> In the quiz of</span>
      {lectures.map((l) => (
        <Link key={l._id} to={`/lectures/${l._id}`} className="pill" onClick={(e) => e.stopPropagation()}>
          {l.title}{l.batches?.length ? ` · ${l.batches.map((b) => b.name).join(", ")}` : ""}
        </Link>
      ))}
    </div>
  );
}
