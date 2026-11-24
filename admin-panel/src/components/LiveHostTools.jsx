import { useEffect, useState } from "react";
import { Check, Star, X, ThumbsUp, Search, Plus, Eye, Square, BarChart3 } from "lucide-react";
import { useDataChannel } from "@livekit/components-react";
import {
  useGetLiveQaStaffQuery, useUpdateLiveQaMutation, useGetLivePollsQuery, useCreateLivePollMutation, useUpdateLivePollMutation,
  useGetQuestionsQuery, useGetTreeQuery,
} from "../api/contentApi";
import Latex from "./Latex";
import SearchSelect from "./SearchSelect";

// The host's Q&A and Polls tabs in the classroom side panel. Both refresh
// the moment the room says something changed (a question, a vote, an
// answer), with a slow refresh as backup.

const decoder = new TextDecoder();
export function useHostTools(id) {
  const qa = useGetLiveQaStaffQuery(id, { pollingInterval: 15000 });
  const polls = useGetLivePollsQuery(id, { pollingInterval: 15000 });
  useDataChannel("examai", (msg) => {
    try {
      const data = JSON.parse(decoder.decode(msg.payload));
      if (data.type === "qa") qa.refetch();
      if (data.type === "poll" || data.type === "pollAnswer") polls.refetch();
    } catch {
      // Not ours.
    }
  });
  return { qa, polls };
}

export function QaTab({ id, qa }) {
  const [update] = useUpdateLiveQaMutation();
  const [show, setShow] = useState("open");
  const all = qa.data?.questions || [];
  // Public webinar guests' questions wait for approval when the webinar
  // asks for it; they show first.
  const pending = all.filter((q) => q.status === "pending");
  const list = show === "pending" ? pending : all.filter((q) => (show === "open" ? q.status === "open" : !["dismissed", "pending"].includes(q.status)));
  const set = (qid, body) => update({ id, qid, ...body }).then(() => qa.refetch());

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row-tight" style={{ gap: 4 }}>
        {[...(pending.length || show === "pending" ? [["pending", `To approve (${pending.length})`]] : []), ["open", "Waiting"], ["all", "All"]].map(([v, l]) => (
          <button key={v} className={`live-right ${show === v ? "on" : ""}`} onClick={() => setShow(v)}>{l}</button>
        ))}
      </div>
      {list.length === 0 && <p className="hint" style={{ margin: 0 }}>{show === "pending" ? "Nothing to approve." : show === "open" ? "No questions waiting." : "No questions yet."}</p>}
      {list.map((q) => (
        <div key={q._id} className="live-person" style={q.spotlight ? { boxShadow: "inset 0 0 0 2px #ffc66d" } : undefined}>
          <div className="row-tight small" style={{ gap: 6, opacity: 0.75 }}>
            <span className="grow">{q.name}{q.guest ? " · guest" : ""}{q.status === "answered" ? " · answered" : ""}</span>
            <ThumbsUp size={12} /> {q.votes}
          </div>
          <div style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{q.text}</div>
          {q.status === "pending" ? (
            <div className="row-tight live-rights">
              <button className="live-right on" title="Everyone sees it" onClick={() => set(q._id, { status: "open" })}><Check size={12} /> Approve</button>
              <button className="live-right" onClick={() => set(q._id, { status: "dismissed" })}><X size={12} /> Dismiss</button>
            </div>
          ) : (
          <div className="row-tight live-rights">
            <button className={`live-right ${q.spotlight ? "on" : ""}`} title="Show it on everyone's screen" onClick={() => set(q._id, { spotlight: !q.spotlight })}>
              <Star size={12} /> {q.spotlight ? "On screen" : "Spotlight"}
            </button>
            {q.status === "open" && <button className="live-right" onClick={() => set(q._id, { status: "answered" })}><Check size={12} /> Answered</button>}
            {q.status !== "open" && <button className="live-right" onClick={() => set(q._id, { status: "open" })}>Reopen</button>}
            <button className="live-right" onClick={() => set(q._id, { status: "dismissed" })}><X size={12} /> Dismiss</button>
          </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PollResults({ poll }) {
  const total = poll.responses || 0;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {poll.options.map((o) => {
        const n = poll.counts?.[o.key] || 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        const right = poll.correct === o.key;
        return (
          <div key={o.key} className="live-poll-row">
            <i style={{ width: `${pct}%`, background: right ? "rgba(46,160,67,0.45)" : "rgba(255,255,255,0.14)" }} />
            <span><b>{o.key}.</b> <Latex>{o.text}</Latex> {right && <Check size={12} />}</span>
            <span className="tnum">{n} · {pct}%</span>
          </div>
        );
      })}
      <span className="small" style={{ opacity: 0.7 }}>{total} answered</span>
    </div>
  );
}

export function PollsTab({ id, polls }) {
  const [create, { isLoading: creating, error }] = useCreateLivePollMutation();
  const [update] = useUpdateLivePollMutation();
  const [mode, setMode] = useState(null); // "bank" | "quick"
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [quick, setQuick] = useState({ text: "", options: ["", ""], correct: "" });
  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  // The bank: every MCQ, lecture quiz ones too. "Tagged poll" shows the
  // ones set aside for polls; "All" filters by subject, chapter and topic.
  const [scope, setScope] = useState("poll"); // "poll" | "all"
  const [where, setWhere] = useState({ subject: "", chapter: "", topic: "" });
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [term, scope, where]);
  const tree = useGetTreeQuery(undefined, { skip: mode !== "bank" || scope !== "all" });
  const subjects = tree.data || [];
  const chapters = subjects.find((x) => String(x._id) === where.subject)?.chapters || [];
  const topics = chapters.find((x) => String(x._id) === where.chapter)?.topics || [];
  const bank = useGetQuestionsQuery({
    type: "mcq", quizOnly: "any", search: term || undefined, page, limit: 20,
    ...(scope === "poll" ? { tag: "poll" } : { subject: where.subject || undefined, chapter: where.chapter || undefined, topic: where.topic || undefined }),
  }, { skip: mode !== "bank" });
  const total = bank.data?.total || 0;
  const pages = bank.data?.pages || 1;

  const list = polls.data?.polls || [];
  const current = list[0];
  const launch = async (body) => {
    const r = await create({ id, ...body });
    if (!r.error) {
      setMode(null);
      setQuick({ text: "", options: ["", ""], correct: "" });
      polls.refetch();
    }
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {current && (
        <div className="live-person">
          <div className="row-tight small" style={{ gap: 6, opacity: 0.75 }}>
            <BarChart3 size={12} /><span className="grow">{current.status === "open" ? "Live poll" : current.revealed ? "Results shown" : "Closed"}</span>
          </div>
          <div style={{ margin: "4px 0 6px" }}><Latex as="div">{current.text}</Latex></div>
          <PollResults poll={current} />
          <div className="row-tight live-rights" style={{ marginTop: 6 }}>
            {current.status === "open" && <button className="live-right" onClick={() => update({ id, pid: current._id, status: "closed" }).then(() => polls.refetch())}><Square size={12} /> Close</button>}
            {!current.revealed && <button className="live-right on" onClick={() => update({ id, pid: current._id, revealed: true }).then(() => polls.refetch())}><Eye size={12} /> Show results to everyone</button>}
          </div>
        </div>
      )}

      {!mode && (
        <div className="row-tight" style={{ gap: 6 }}>
          <button className="live-tool" onClick={() => setMode("bank")}><Search size={13} /> From question bank</button>
          <button className="live-tool" onClick={() => setMode("quick")}><Plus size={13} /> Quick poll</button>
        </div>
      )}

      {mode === "bank" && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row-tight" style={{ gap: 6 }}>
            <input className="live-input grow" autoFocus placeholder="Search multiple-choice questions" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className="icon-btn" onClick={() => setMode(null)}><X size={14} /></button>
          </div>
          <div className="row-tight" style={{ gap: 6 }}>
            <button className={`live-tool${scope === "poll" ? " on" : ""}`} style={scope === "poll" ? { borderColor: "#2fa58e", background: "rgba(47,165,142,0.18)" } : undefined} onClick={() => setScope("poll")}>Tagged poll</button>
            <button className={`live-tool${scope === "all" ? " on" : ""}`} style={scope === "all" ? { borderColor: "#2fa58e", background: "rgba(47,165,142,0.18)" } : undefined} onClick={() => setScope("all")}>All</button>
          </div>
          {scope === "all" && (
            <div className="stack" style={{ gap: 6 }}>
              <SearchSelect className="live-input" value={where.subject} onChange={(e) => setWhere({ subject: e.target.value, chapter: "", topic: "" })}>
                <option value="">Any subject</option>
                {subjects.map((x) => <option key={x._id} value={x._id}>{x.title}</option>)}
              </SearchSelect>
              {chapters.length > 0 && (
                <SearchSelect className="live-input" value={where.chapter} onChange={(e) => setWhere({ ...where, chapter: e.target.value, topic: "" })}>
                  <option value="">Any chapter</option>
                  {chapters.map((x) => <option key={x._id} value={x._id}>{x.title}</option>)}
                </SearchSelect>
              )}
              {topics.length > 0 && (
                <SearchSelect className="live-input" value={where.topic} onChange={(e) => setWhere({ ...where, topic: e.target.value })}>
                  <option value="">Any topic</option>
                  {topics.map((x) => <option key={x._id} value={x._id}>{x.title}</option>)}
                </SearchSelect>
              )}
            </div>
          )}
          {total > 0 && <span className="hint small" style={{ margin: 0 }}>{(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}</span>}
          {(bank.data?.questions || []).map((q) => (
            <button key={q._id} className="live-bank-q" disabled={creating} onClick={() => launch({ questionId: q._id })}>
              <Latex as="div">{q.question}</Latex>
            </button>
          ))}
          {bank.data && !(bank.data.questions || []).length && (
            <p className="hint" style={{ margin: 0 }}>
              {scope === "poll" && !term ? <>No question is tagged “poll” yet. In the question bank, add the tag <strong>poll</strong> to the ones you want, or pick All.</> : "No matching questions."}
            </p>
          )}
          {pages > 1 && (
            <div className="row-tight" style={{ gap: 6, justifyContent: "center" }}>
              <button className="live-tool" disabled={page <= 1 || bank.isFetching} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="small">Page {page} of {pages}</span>
              <button className="live-tool" disabled={page >= pages || bank.isFetching} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
          <span className="hint" style={{ margin: 0 }}>Answers count as practice for each student's weak topics.</span>
        </div>
      )}

      {mode === "quick" && (
        <div className="stack" style={{ gap: 6 }}>
          <input className="live-input" autoFocus placeholder="Question" value={quick.text} onChange={(e) => setQuick({ ...quick, text: e.target.value })} />
          {quick.options.map((o, i) => {
            const key = "ABCDEF"[i];
            return (
              <div key={i} className="row-tight" style={{ gap: 6 }}>
                <label title="Correct answer" className="row-tight" style={{ gap: 2 }}>
                  <input type="radio" name="correct" checked={quick.correct === key} onChange={() => setQuick({ ...quick, correct: key })} /> {key}
                </label>
                <input className="live-input grow" placeholder={`Option ${key}`} value={o} onChange={(e) => setQuick({ ...quick, options: quick.options.map((x, j) => (j === i ? e.target.value : x)) })} />
              </div>
            );
          })}
          <div className="row-tight" style={{ gap: 6 }}>
            {quick.options.length < 6 && <button className="live-tool" onClick={() => setQuick({ ...quick, options: [...quick.options, ""] })}><Plus size={13} /> Option</button>}
            <span className="grow" />
            <button className="live-tool" onClick={() => setMode(null)}>Cancel</button>
            <button className="live-tool live-tool-on" disabled={creating || !quick.text.trim() || quick.options.filter((o) => o.trim()).length < 2} onClick={() => launch(quick)}>Launch</button>
          </div>
          <span className="hint" style={{ margin: 0 }}>Marking a correct answer is optional.</span>
        </div>
      )}
      {error && <p className="small" style={{ color: "#ff8a8a", margin: 0 }}>{error.data?.message}</p>}

      {list.length > 1 && (
        <details>
          <summary className="small" style={{ cursor: "pointer", opacity: 0.8 }}>Earlier polls · {list.length - 1}</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            {list.slice(1).map((p) => (
              <div key={p._id} className="live-person">
                <div style={{ marginBottom: 4 }}><Latex as="div">{p.text}</Latex></div>
                <PollResults poll={p} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
