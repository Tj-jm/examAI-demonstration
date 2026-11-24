import { useEffect, useRef, useState } from "react";
import { Box, Button, Drawer, IconButton, TextField, Typography, Badge } from "@mui/material";
import { MessageCircleQuestion, ThumbsUp, X, BarChart3, Check, Star, Captions, CaptionsOff } from "lucide-react";
import { useDataChannel } from "@livekit/components-react";
import {
  useGetLiveQaQuery, useAskLiveQaMutation, useUpvoteLiveQaMutation, useGetLivePollQuery, useAnswerLivePollMutation,
} from "../api/contentApi";
import Latex from "./Latex";

// The student's classroom tools: the Q&A board (ask, upvote), the question
// the host put in the spotlight, and the poll card. Each refreshes the
// moment the room says something changed, with a slow refresh as backup.

const decoder = new TextDecoder();
export function useRoomPings(handlers) {
  useDataChannel("examai", (msg) => {
    try {
      const data = JSON.parse(decoder.decode(msg.payload));
      handlers[data.type]?.(data);
    } catch {
      // Not ours.
    }
  });
}

export function useLiveTools(batchId, id, initiallyRecording = false) {
  const qa = useGetLiveQaQuery({ batchId, id }, { pollingInterval: 20000 });
  const poll = useGetLivePollQuery({ batchId, id }, { pollingInterval: 20000 });
  const [recording, setRecording] = useState(initiallyRecording);
  useRoomPings({ qa: () => qa.refetch(), poll: () => poll.refetch(), rec: (d) => setRecording(Boolean(d.on)) });
  return { qa, poll, recording };
}

// Students are always told when the class is being recorded.
export function RecIndicator({ on }) {
  if (!on) return null;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.25, borderRadius: 1, border: "1px solid #e5484d", color: "#ffd6d6", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#e5484d", animation: "recblink 1.2s ease-in-out infinite", "@keyframes recblink": { "50%": { opacity: 0.25 } } }} />
      REC
    </Box>
  );
}

// Live captions from the host's browser, on the "captions" topic: the last
// finished line plus what's being said now. Fades after a few quiet seconds.
export function useCaptionFeed() {
  const [feed, setFeed] = useState({ final: "", interim: "", live: false, at: 0 });
  const timer = useRef(null);
  useDataChannel("captions", (msg) => {
    try {
      const d = JSON.parse(decoder.decode(msg.payload));
      if (d.t === "off") return setFeed({ final: "", interim: "", live: false, at: 0 });
      setFeed((f) => (d.t === "f" ? { final: d.text, interim: "", live: true, at: Date.now() } : { ...f, interim: d.text, live: true, at: Date.now() }));
    } catch {
      // Not ours.
    }
    return undefined;
  });
  useEffect(() => {
    clearTimeout(timer.current);
    if (feed.final || feed.interim) timer.current = setTimeout(() => setFeed((f) => ({ ...f, final: "", interim: "" })), 7000);
    return () => clearTimeout(timer.current);
  }, [feed.at]);
  return feed;
}

export function CaptionsToggle({ feed, show, setShow }) {
  if (!feed.live) return null;
  return (
    <Button size="small" variant={show ? "contained" : "outlined"} startIcon={show ? <Captions size={16} /> : <CaptionsOff size={16} />} onClick={() => setShow(!show)}
      sx={{ borderRadius: 5, textTransform: "none", ...(show ? {} : { color: "inherit", borderColor: "rgba(255,255,255,0.35)" }) }}>
      CC
    </Button>
  );
}

export function CaptionBar({ feed, show }) {
  const text = feed.interim || feed.final;
  if (!show || !text) return null;
  return (
    <Box sx={{ position: "absolute", left: "50%", bottom: 100, transform: "translateX(-50%)", zIndex: 7, maxWidth: "min(860px, 92%)", px: 2, py: 0.75, borderRadius: 2, bgcolor: "rgba(0,0,0,0.78)", color: "#fff", fontSize: { xs: 16, sm: 19 }, lineHeight: 1.4, textAlign: "center", pointerEvents: "none" }}>
      {text}
    </Box>
  );
}

// Header button + drawer.
export function QaButton({ batchId, id, qa }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [ask, { isLoading: asking, error }] = useAskLiveQaMutation();
  const [upvote] = useUpvoteLiveQaMutation();
  const questions = qa.data?.questions || [];
  const openCount = questions.filter((q) => q.status === "open").length;

  const submit = async () => {
    if (!text.trim()) return;
    const r = await ask({ batchId, id, text: text.trim() });
    if (!r.error) {
      setText("");
      qa.refetch();
    }
  };

  return (
    <>
      <Badge badgeContent={openCount} color="warning" max={99}>
        <Button size="small" variant="outlined" startIcon={<MessageCircleQuestion size={16} />} onClick={() => setOpen(true)}
          sx={{ borderRadius: 5, textTransform: "none", color: "inherit", borderColor: "rgba(255,255,255,0.35)" }}>
          Q&A
        </Button>
      </Badge>
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)} PaperProps={{ sx: { width: { xs: "100%", sm: 380 }, bgcolor: "#16181c", color: "#eef0f2" } }}>
        <Box sx={{ display: "flex", alignItems: "center", p: 2, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <Typography sx={{ fontWeight: 600, flex: 1 }}>Questions for the host</Typography>
          <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: "inherit" }}><X size={18} /></IconButton>
        </Box>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <TextField
            multiline minRows={2} maxRows={5} size="small" placeholder="Ask a question…" value={text}
            onChange={(e) => setText(e.target.value.slice(0, 400))}
            sx={{ "& .MuiInputBase-root": { color: "#eef0f2", bgcolor: "rgba(255,255,255,0.06)" } }}
          />
          {error && <Typography variant="caption" color="error">{error.data?.message || "Couldn't send that."}</Typography>}
          <Button variant="contained" size="small" disabled={asking || !text.trim()} onClick={submit} sx={{ alignSelf: "flex-end" }}>Ask</Button>
        </Box>
        <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1, overflowY: "auto" }}>
          {questions.length === 0 && <Typography variant="body2" sx={{ opacity: 0.6, p: 1 }}>No questions yet. Ask one, or upvote the ones you want answered.</Typography>}
          {questions.map((q) => (
            <Box key={q._id} sx={{ p: 1.25, borderRadius: 2, bgcolor: q.spotlight ? "rgba(255,198,109,0.15)" : "rgba(255,255,255,0.05)", border: q.spotlight ? "1px solid #ffc66d" : "1px solid transparent", opacity: q.status === "answered" ? 0.65 : 1 }}>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>{q.mine ? "You" : q.name}{q.status === "pending" ? " · waiting for the host to approve" : ""}{q.status === "answered" ? " · answered" : ""}{q.spotlight ? " · on screen now" : ""}</Typography>
              <Typography variant="body2" sx={{ my: 0.5, whiteSpace: "pre-wrap" }}>{q.text}</Typography>
              <Button
                size="small"
                disabled={q.mine || q.status !== "open"}
                onClick={async () => { await upvote({ batchId, id, qid: q._id }); qa.refetch(); }}
                startIcon={<ThumbsUp size={14} fill={q.votedByMe ? "currentColor" : "none"} />}
                sx={{ color: q.votedByMe ? "#ffc66d" : "inherit", textTransform: "none", minWidth: 0 }}
              >
                {q.votes}
              </Button>
            </Box>
          ))}
        </Box>
      </Drawer>
    </>
  );
}

// The host's spotlighted question, across the top of the stage.
export function Spotlight({ qa }) {
  const q = (qa.data?.questions || []).find((x) => x.spotlight);
  if (!q) return null;
  return (
    <Box sx={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5, maxWidth: "min(720px, 92%)", px: 2, py: 1.25, borderRadius: 3, bgcolor: "rgba(20,22,26,0.92)", border: "1px solid #ffc66d", color: "#fff", display: "flex", gap: 1.25, alignItems: "flex-start", boxShadow: 6 }}>
      <Star size={18} color="#ffc66d" fill="#ffc66d" style={{ flexShrink: 0, marginTop: 2 }} />
      <Box>
        <Typography variant="caption" sx={{ opacity: 0.7 }}>{q.name} asked</Typography>
        <Typography sx={{ fontWeight: 500 }}>{q.text}</Typography>
      </Box>
    </Box>
  );
}

// The open poll (or the last one's results, for a minute after reveal).
export function PollCard({ batchId, id, poll }) {
  const [answer, { isLoading, error }] = useAnswerLivePollMutation();
  const [hidden, setHidden] = useState(null);
  const p = poll.data?.poll;
  if (!p || hidden === `${p._id}:${p.revealed}`) return null;
  const total = p.responses || 0;

  return (
    <Box sx={{ position: "absolute", right: 16, bottom: 88, zIndex: 6, width: "min(400px, calc(100% - 32px))", maxHeight: "70%", overflowY: "auto", p: 2, borderRadius: 3, bgcolor: "rgba(20,22,26,0.96)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", boxShadow: 8 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <BarChart3 size={16} />
        <Typography variant="caption" sx={{ flex: 1, fontWeight: 600, letterSpacing: 1 }}>{p.revealed ? "POLL RESULTS" : "POLL"}</Typography>
        <IconButton size="small" onClick={() => setHidden(`${p._id}:${p.revealed}`)} sx={{ color: "inherit" }}><X size={16} /></IconButton>
      </Box>
      <Box sx={{ mb: 1.5 }}><Latex as="div">{p.text}</Latex></Box>
      {p.image && <Box component="img" src={p.image} alt="" sx={{ maxWidth: "100%", borderRadius: 1, mb: 1 }} />}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        {p.options.map((o) => {
          const mine = p.myAnswer === o.key;
          const right = p.revealed && p.correct === o.key;
          const pct = p.revealed && total ? Math.round(((p.counts?.[o.key] || 0) / total) * 100) : 0;
          return (
            <Button
              key={o.key}
              disabled={Boolean(p.myAnswer) || p.status !== "open" || isLoading}
              onClick={() => answer({ batchId, id, pid: p._id, key: o.key }).then(() => poll.refetch())}
              sx={{
                position: "relative", overflow: "hidden", justifyContent: "flex-start", textTransform: "none", color: "#fff !important",
                border: `1px solid ${right ? "#2ea043" : mine ? "#ffc66d" : "rgba(255,255,255,0.2)"}`, borderRadius: 2, py: 1, px: 1.5, textAlign: "left",
              }}
            >
              {p.revealed && <Box sx={{ position: "absolute", inset: 0, width: `${pct}%`, bgcolor: right ? "rgba(46,160,67,0.35)" : "rgba(255,255,255,0.1)" }} />}
              <Box sx={{ position: "relative", display: "flex", gap: 1, alignItems: "center", width: "100%" }}>
                <b>{o.key}.</b>
                <Box sx={{ flex: 1 }}><Latex>{o.text}</Latex></Box>
                {o.image && <Box component="img" src={o.image} alt="" sx={{ height: 36 }} />}
                {right && <Check size={16} />}
                {p.revealed && <span>{pct}%</span>}
              </Box>
            </Button>
          );
        })}
      </Box>
      {error && <Typography variant="caption" color="error">{error.data?.message}</Typography>}
      <Typography variant="caption" sx={{ display: "block", mt: 1, opacity: 0.7 }}>
        {p.revealed
          ? p.correct ? (p.myAnswer === p.correct ? "You got it right." : p.myAnswer ? `The answer was ${p.correct}.` : `The answer was ${p.correct}.`) : `${total} answered.`
          : p.myAnswer ? "Answer sent. Results appear when the host reveals them." : p.status === "open" ? "Tap your answer." : "This poll is closed."}
      </Typography>
    </Box>
  );
}
