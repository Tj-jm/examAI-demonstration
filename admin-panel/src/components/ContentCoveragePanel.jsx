import { Layers, AlertTriangle } from "lucide-react";
import { useGetContentCoverageQuery } from "../api/contentApi";
import { Loading, ErrorNote } from "./bits";

// Answers a question the "What this batch can see" picker above never
// answers directly: out of everything this subject actually has, which
// chapter-pools and topics does this batch actually have a question in?
// Assigning content is done one item at a time up there — this is the
// rolled-up view of where that's landed, subject by subject, so a gap
// (a chapter with a pool but no topics touched, or a topic entirely
// skipped) is visible at a glance instead of found by clicking through
// every chapter one at a time.
export default function ContentCoveragePanel({ batchId }) {
  const { data, isLoading, error } = useGetContentCoverageQuery(batchId, { skip: !batchId });

  const subjects = data?.subjects || [];
  const hidden = data?.hidden || [];
  const hiddenTotal = hidden.reduce((n, h) => n + h.count, 0);

  return (
    <div className="card stack">
      <div className="row-tight"><Layers size={17} className="muted" /><h2>Content coverage</h2></div>
      <p className="hint" style={{ margin: 0 }}>
        Every chapter-pool and topic that has at least one question assigned to this
        batch, in the subjects ticked for it. Anything not listed here has nothing
        assigned yet.
      </p>

      {/* Students only see questions in the batch's ticked subjects; assigned
          questions in other subjects are hidden from them until ticked. */}
      {hiddenTotal > 0 && (
        <div className="small" style={{ padding: "8px 10px", borderRadius: 8, background: "var(--warning-bg)", color: "var(--warning)" }}>
          {hiddenTotal} assigned question{hiddenTotal === 1 ? " is" : "s are"} hidden from students because
          {hidden.length === 1 ? " its subject isn't" : " their subjects aren't"} ticked for this batch:{" "}
          {hidden.map((h) => `${h.title} (${h.count})`).join(", ")}. Tick the subject in Overview to show them.
        </div>
      )}

      {isLoading && <Loading />}
      <ErrorNote error={error} />

      {!isLoading && !error && subjects.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          No questions in this batch's subjects yet — assign some above and they will show up here.
        </p>
      )}

      {subjects.map((subject) => (
        <div key={subject._id} className="stack" style={{ gap: 8 }}>
          <strong style={{ fontSize: 13 }}>{subject.title}</strong>

          <div className="stack" style={{ gap: 6 }}>
            {subject.chapters.map((chapter) => (
              <details key={chapter._id} className="card-quiet" style={{ padding: "8px 12px" }}>
                <summary style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 8, listStyle: "none" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{chapter.title}</span>
                  {chapter.chapterPoolCount > 0 && (
                    <span className="pill" title="Questions filed straight under this chapter, not a topic">
                      chapter pool · {chapter.chapterPoolCount}
                    </span>
                  )}
                  {chapter.topics.length > 0 && (
                    <span className="muted small">{chapter.topics.length} topic{chapter.topics.length === 1 ? "" : "s"}</span>
                  )}
                </summary>

                {chapter.topics.length > 0 ? (
                  <div className="row-tight" style={{ flexWrap: "wrap", marginTop: 8 }}>
                    {chapter.topics.map((topic) => (
                      <span key={topic._id} className="pill">
                        {topic.title} · {topic.questionCount}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="muted small" style={{ margin: "8px 0 0" }}>
                    Only the chapter pool has questions here — no topic under it does yet.
                  </p>
                )}
              </details>
            ))}
          </div>
        </div>
      ))}

      {subjects.length > 0 && (
        <p className="hint row-tight" style={{ margin: 0, gap: 6 }}>
          <AlertTriangle size={13} />
          A chapter or topic missing here entirely just means it has no question
          assigned yet — it isn't broken, there's nothing to show.
        </p>
      )}
    </div>
  );
}
