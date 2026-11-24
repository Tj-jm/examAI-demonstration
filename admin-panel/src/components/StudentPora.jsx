import { useState } from "react";
import { Mic, PenLine, Users, ChevronDown, ChevronRight } from "lucide-react";
import { useGetStudentPoraQuery, useGetStudentTutorQuery, useGetStudentInterviewQuery } from "../api/contentApi";

const VERDICT = { correct: "pill-ok", partial: "", wrong: "pill-bad", skipped: "", strong: "pill-ok", ok: "", weak: "pill-bad" };

const KINDS = {
  pora: { useQuery: useGetStudentPoraQuery, title: "Oral Quiz", Icon: Mic },
  tutor: { useQuery: useGetStudentTutorQuery, title: "AI Tutoring", Icon: PenLine },
  interview: { useQuery: useGetStudentInterviewQuery, title: "Interview practice", Icon: Users },
};

// A student's Oral Quiz or AI Tutoring sessions: score per session, and the
// whole exchange (or creative question) on demand. Hidden when they have none.
export default function StudentPora({ studentId, kind = "pora" }) {
  const K = KINDS[kind];
  const { data } = K.useQuery(studentId);
  const [open, setOpen] = useState(null);
  const sessions = data?.sessions || [];
  if (!sessions.length) return null;

  return (
    <div className="card stack">
      <div className="row-tight"><K.Icon size={17} className="muted" /><h2>{K.title}</h2></div>
      {sessions.map((s) => {
        const isOpen = open === s._id;
        const answered = (s.marks || []).filter((m) => typeof m === "number").length;
        return (
          <div key={s._id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <button type="button" className="spread small" style={{ width: "100%", background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", textAlign: "left" }} onClick={() => setOpen(isOpen ? null : s._id)}>
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span className="grow">
                {s.lectureTitle || s.title || "Lecture"}
                <span className="muted"> · {s.batchName} · {answered} answered</span>
              </span>
              <span className="tnum">{s.status === "done" ? `${s.score ?? 0} / 100` : "In progress"}</span>
              <span className="muted">{new Date(s.updatedAt).toLocaleDateString()}</span>
            </button>
            {isOpen && (
              <div className="stack" style={{ gap: 6, margin: "10px 0 6px 20px" }}>
                {s.report?.remark && <div className="card-quiet small">{s.report.remark}</div>}
                {(s.report?.criteria || []).length > 0 && kind === "interview" && (
                  <div className="small">{s.report.criteria.map((c) => `${c.name} ${Math.round(c.score)}/10`).join(" · ")}</div>
                )}
                {(s.report?.weaknesses || []).length > 0 && (
                  <div className="small"><span className="muted">{kind === "interview" ? "Work on" : "To revise"}: </span>{s.report.weaknesses.join(" · ")}</div>
                )}
                {(s.report?.tips || []).length > 0 && (
                  <div className="small"><span className="muted">Tips: </span>{s.report.tips.join(" · ")}</div>
                )}
                {s.paper && (
                  <>
                    <div className="card-quiet small">{s.paper.stimulus}</div>
                    {s.paper.parts.map((p, i) => (
                      <div key={i} className="small stack" style={{ gap: 2 }}>
                        <div className="spread"><span className="grow">{i + 1}. {p.question}</span><span className="tnum">{p.got ?? "—"} / {p.marks}</span></div>
                        {p.answer && <div className="muted">Answer: {p.answer}</div>}
                        {(p.images || []).map((u, k) => <a key={u} href={u} target="_blank" rel="noreferrer" className="small">Picture {k + 1}</a>)}
                        {p.feedback && <div className="muted"><em>{p.feedback}</em></div>}
                      </div>
                    ))}
                  </>
                )}
                {(s.turns || []).map((t, i) => (
                  <div key={i} className="small" style={{ display: "flex", gap: 8 }}>
                    <span className="muted" style={{ minWidth: 64 }}>{t.role === "teacher" ? "Teacher" : t.role === "interviewer" ? (t.kind === "feedback" ? "Note" : s.interviewers?.[t.by]?.name || "Panel") : "Student"}</span>
                    <span className="grow" style={{ fontStyle: t.kind === "skip" || t.kind === "hint" || t.kind === "feedback" ? "italic" : "normal" }}>
                      {t.text}
                      {(t.images || []).map((u, k) => <a key={u} href={u} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>Picture {k + 1}</a>)}
                    </span>
                    {t.verdict && <span className={`pill ${VERDICT[t.verdict] || ""}`} style={{ padding: "1px 6px" }}>{t.verdict}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
