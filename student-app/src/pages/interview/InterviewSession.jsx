import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, IconButton, Button, Skeleton, Alert, Tooltip, CircularProgress, TextField, LinearProgress } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mic, Square, Send, SkipForward, X, Volume2, VolumeX, RotateCcw, Keyboard, Video, VideoOff, Clock } from "lucide-react";
import {
  useGetInterviewSessionQuery, useGetInterviewSettingsQuery, useInterviewTurnMutation, useEndInterviewMutation,
  useSpeakInterviewMutation, useStartInterviewMutation, useUnlockInterviewMutation,
} from "../../api/contentApi";
import useSpeech from "../../hooks/useSpeech";
import { useBranding } from "../../BrandingContext";
import PoraAllowance, { SessionMeter } from "../pora/PoraAllowance";
import { mascotReact } from "../../components/Mascot";
import { KIND_LABEL } from "./InterviewHome";

// One interview practice session in the admin's layout, all drawn from the
// theme:
//   panel — a board of up to three examiners round a table
//   board — the examination desk: dark, formal, the question large
//   video — a video call with one interviewer, captions and a self-view
// and the feedback report when it ends.

const LAYOUTS = ["panel", "board", "video"];

// What the panel says now: their lines since the student last spoke.
const latest = (turns) => {
  const out = [];
  for (let i = turns.length - 1; i >= 0 && turns[i].role === "interviewer"; i -= 1) out.unshift(turns[i]);
  return out;
};
const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s)) % 60).padStart(2, "0")}`;

export default function InterviewSession() {
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { featureNames } = useBranding();
  const title = featureNames?.interview || "Interview practice";
  const { data: session, isLoading } = useGetInterviewSessionQuery({ batchId, id });
  const { data: settings, refetch: refetchSettings } = useGetInterviewSettingsQuery(batchId, { refetchOnMountOrArgChange: true });
  const [turn, { isLoading: sending, error: turnError, reset: resetTurn }] = useInterviewTurnMutation();
  const [endSession, { isLoading: ending }] = useEndInterviewMutation();
  const [startAgain, { isLoading: restarting }] = useStartInterviewMutation();
  const [speak] = useSpeakInterviewMutation();

  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [replays, setReplays] = useState(0);
  const [lang, setLang] = useState(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const audio = useRef(null);
  const spokenFor = useRef(null);
  // The line the student has finished hearing (or that is not spoken at
  // all). Answering, and the answer clock, wait for it.
  const [heard, setHeard] = useState("");

  const turns = useMemo(() => session?.turns || [], [session]);
  const now = latest(turns);
  const nowText = now.map((t) => t.text).filter(Boolean).join(" ");
  const ask = [...turns].reverse().find((t) => t.role === "interviewer" && (t.kind === "question" || t.kind === "followUp"));
  const bangla = session?.language === "Bangla";
  const sttLang = lang || (bangla ? "bn-BD" : "en-US");
  const speech = useSpeech(sttLang);
  const done = session?.status === "done";
  const layout = LAYOUTS.includes(session?.layout) ? session.layout : "panel";
  const panel = session?.interviewers?.length ? session.interviewers : [{ name: "Interviewer" }];

  // Each new line is spoken once.
  useEffect(() => {
    if (!nowText || done) return;
    if (!settings?.voice || muted) { setHeard(nowText); return; }
    if (spokenFor.current === nowText) return;
    spokenFor.current = nowText;
    let cancelled = false;
    const finished = () => { setSpeaking(false); setHeard(nowText); };
    (async () => {
      setVoiceLoading(true);
      const r = await speak({ batchId, text: nowText, language: session?.language });
      setVoiceLoading(false);
      if (cancelled) return;
      if (typeof r.data !== "string") { finished(); return; }
      const url = r.data;
      audio.current?.pause();
      const a = new Audio(url);
      audio.current = a;
      a.onplay = () => setSpeaking(true);
      a.onended = () => { finished(); URL.revokeObjectURL(url); };
      a.onpause = finished;
      a.onerror = finished;
      // Autoplay blocked: the line is on screen, so the student can go on.
      a.play().catch(finished);
    })();
    return () => { cancelled = true; };
  }, [nowText, settings?.voice, muted, done, batchId, speak, replays, session?.language]);
  useEffect(() => () => audio.current?.pause(), []);

  // The answer clock: runs once the examiner has finished the question.
  const limit = session?.answerSeconds || 0;
  const askKey = ask ? `${ask.q}:${turns.length}` : "";
  const listening = Boolean(nowText) && heard !== nowText;
  const ready = Boolean(ask) && !done && !sending && !voiceLoading && !speaking && !listening;
  const [clock, setClock] = useState({ key: "", startedAt: 0, now: 0 });
  useEffect(() => {
    if (ready && clock.key !== askKey) setClock({ key: askKey, startedAt: Date.now(), now: Date.now() });
  }, [ready, askKey, clock.key]);
  useEffect(() => {
    if (!clock.startedAt || done) return undefined;
    const t = setInterval(() => setClock((c) => ({ ...c, now: Date.now() })), 500);
    return () => clearInterval(t);
  }, [clock.startedAt, done]);
  const started = clock.key === askKey && clock.startedAt;
  const elapsed = started ? (clock.now - clock.startedAt) / 1000 : 0;
  const left = limit ? limit - elapsed : null;

  const answerText = typing ? typed.trim() : `${speech.text} ${speech.interim}`.trim();
  const send = async (kind, text, extra = {}) => {
    audio.current?.pause();
    speech.stop();
    resetTurn();
    const r = await turn({ batchId, id, kind, text, seconds: Math.round(elapsed), ...extra });
    if (!r.error) { speech.reset(); setTyped(""); }
    refetchSettings();
    const s = r.data?.session;
    if (s?.status === "done" && (s.report?.score ?? 0) >= 80) mascotReact("great", `${s.report.score}/100!`);
  };

  // Out of time: what was said so far goes in.
  const timedOut = useRef("");
  useEffect(() => {
    if (left === null || left > 0 || !started || sending || timedOut.current === askKey) return;
    timedOut.current = askKey;
    if (answerText) send("answer", answerText, { timedOut: true });
    else send("skip", "", { timedOut: true });
  }, [left, started, sending, askKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading || !settings) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={420} /></Box>;
  if (!session) return <Box sx={{ p: 3 }}><Alert severity="error">Session not found.</Alert></Box>;

  const header = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/interview`)} aria-label="Back"><ArrowLeft size={18} /></IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>{title}</Typography>
        <Typography noWrap variant="caption" color="text.secondary">{session.title}</Typography>
      </Box>
      {!done && settings.voice && (
        <Tooltip title={muted ? "Turn the voice on" : "Mute"}>
          <IconButton size="small" onClick={() => { setMuted(!muted); audio.current?.pause(); }}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</IconButton>
        </Tooltip>
      )}
    </Box>
  );

  if (done) {
    return (
      <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 600, mx: "auto" }}>
        {header}
        <InterviewReport
          session={session}
          restarting={restarting}
          onAgain={async () => {
            const body = session.source === "set" ? { setId: session.set } : session.source === "lecture" ? { lectureId: session.lecture } : { own: { kind: session.kind, description: session.brief } };
            const r = await startAgain({ batchId, ...body, fresh: true });
            if (r.data?.session) navigate(`/batches/${batchId}/interview/${r.data.session._id}`, { replace: true });
          }}
          onBack={() => navigate(`/batches/${batchId}/interview`)}
        />
      </Box>
    );
  }

  const speaker = panel[Math.min(panel.length - 1, ask?.by || 0)] || panel[0];
  const line = now.map((t) => t.text).join(" ") || ask?.text || "";
  const errorBox = turnError && (
    turnError.status === 429
      ? <PoraAllowance batchId={batchId} settings={settings} useUnlock={useUnlockInterviewMutation} onUnlocked={() => { resetTurn(); refetchSettings(); }} />
      : <Alert severity="error" sx={{ mb: 1 }}>{turnError.data?.message || "That didn't go through. Try again."}</Alert>
  );
  const dark = layout === "board" || layout === "video";
  const controls = (
    <AnswerBar
      speech={speech}
      sending={sending}
      answerText={answerText}
      sttLang={sttLang}
      setLang={setLang}
      typingAllowed={settings.typing}
      typing={typing}
      setTyping={setTyping}
      typed={typed}
      setTyped={setTyped}
      onSend={() => answerText && send("answer", answerText)}
      onMic={() => { audio.current?.pause(); setSpeaking(false); }}
      waiting={!sending && !done && !started}
      onSkip={() => send("skip", "")}
      onEnd={async () => { audio.current?.pause(); speech.stop(); await endSession({ batchId, id }); }}
      ending={ending}
      dark={dark}
    />
  );
  const timer = limit ? <AnswerClock left={left} limit={limit} running={Boolean(started)} dark={dark} /> : null;
  const status = sending ? `${speaker.name} is noting that down…` : voiceLoading ? `${speaker.name} is about to speak…` : speaking ? `${speaker.name} is speaking` : "";
  const props = {
    session, panel, speaker, speakerIdx: Math.min(panel.length - 1, ask?.by || 0), line, ask, status, speaking,
    onReplay: settings.voice ? () => { spokenFor.current = null; setMuted(false); setReplays((n) => n + 1); } : null,
    controls, errorBox, timer, theme,
  };
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 680, mx: "auto" }}>
      {header}
      <SessionMeter batchId={batchId} settings={settings} />
      {layout === "board" ? <BoardLayout {...props} /> : layout === "video" ? <VideoLayout {...props} /> : <PanelLayout {...props} />}
    </Box>
  );
}

// --------------------------------------------------------------- pieces

// The board and video layouts are dark in either theme, so their text and
// controls use a fixed light colour (the theme's paper colour is dark in
// dark mode and would vanish).
const DARK_FG = "#f2f3f5";

function AnswerClock({ left, limit, running, dark }) {
  const theme = useTheme();
  const low = left !== null && left <= 15;
  const fg = dark ? DARK_FG : theme.palette.text.primary;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: low ? "error.main" : fg }}>
      <Clock size={14} />
      <Typography sx={{ fontSize: 13, fontVariantNumeric: "tabular-nums", minWidth: 76 }}>
        {running ? `${mmss(left)} left` : `${mmss(limit)} to answer`}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={running ? Math.max(0, Math.min(100, (left / limit) * 100)) : 100}
        color={low ? "error" : "primary"}
        sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: alpha(fg, 0.12) }}
      />
    </Box>
  );
}

function Progress({ session, dark }) {
  const theme = useTheme();
  const fg = dark ? DARK_FG : theme.palette.text.primary;
  return (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
      {Array.from({ length: session.limit }, (_, i) => (
        <Box key={i} sx={{ width: 16, height: 4, borderRadius: 1, bgcolor: i < session.asked ? fg : alpha(fg, 0.18) }} />
      ))}
      <Typography variant="caption" sx={{ ml: 1, opacity: 0.75, color: fg, fontVariantNumeric: "tabular-nums" }}>Q {Math.max(1, session.asked)}/{session.limit}</Typography>
    </Box>
  );
}

const Face = ({ name, size = 44, active, inverted }) => {
  const theme = useTheme();
  const bg = inverted ? theme.palette.background.paper : theme.palette.text.primary;
  const fg = inverted ? theme.palette.text.primary : theme.palette.background.paper;
  return (
    <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {active && <Box sx={{ position: "absolute", inset: -5, borderRadius: "50%", border: `2px solid ${theme.palette.primary.main}`, animation: "ivPulse 1.4s ease-in-out infinite", "@keyframes ivPulse": { "50%": { opacity: 0.35, transform: "scale(1.08)" } } }} />}
      <Box sx={{ width: size, height: size, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: bg, color: fg, fontFamily: theme.typography.h1.fontFamily, fontWeight: 600, fontSize: size * 0.4 }}>
        {String(name || "I").replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, "").trim().charAt(0).toUpperCase()}
      </Box>
    </Box>
  );
};

// Voice first; typing only when the admin allows it.
function AnswerBar({ waiting, speech, sending, answerText, sttLang, setLang, typingAllowed, typing, setTyping, typed, setTyped, onSend, onMic, onSkip, onEnd, ending, dark }) {
  const theme = useTheme();
  const fg = dark ? DARK_FG : theme.palette.text.primary;
  const voiceOk = speech.supported && !typing;
  return (
    <Box>
      {typing ? (
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={6}
          size="small"
          value={typed}
          onChange={(e) => setTyped(e.target.value.slice(0, 3000))}
          placeholder="Type your answer"
          sx={{ mb: 1, "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
        />
      ) : (speech.listening || answerText) ? (
        <Typography sx={{ fontSize: 14, mb: 1, color: fg, opacity: speech.interim ? 0.75 : 1, minHeight: 20 }}>{answerText || "Listening…"}</Typography>
      ) : null}
      {speech.error && !typing && <Typography variant="caption" color="error" sx={{ display: "block", mb: 1 }}>{speech.error}</Typography>}
      {!speech.supported && !typing && (
        <Alert severity="warning" sx={{ mb: 1 }}>This browser can't hear you. Open this page in Chrome, Edge or Safari to answer out loud.</Alert>
      )}
      {(voiceOk || typing) && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Button
            fullWidth
            size="large"
            variant="contained"
            color={speech.listening ? "error" : "primary"}
            disabled={sending || waiting || (typing && !answerText)}
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : typing ? <Send size={17} /> : speech.listening ? <Square size={16} /> : answerText ? <Send size={17} /> : <Mic size={18} />}
            onClick={() => {
              if (typing) onSend();
              else if (speech.listening) speech.stop();
              else if (answerText) onSend();
              else { onMic?.(); speech.start(); }
            }}
            sx={{ borderRadius: 99, py: 1.25 }}
          >
            {sending ? "Sending…" : waiting ? "Listen to the question…" : typing ? "Send answer" : speech.listening ? "Stop" : answerText ? "Send answer" : "Tap to answer"}
          </Button>
          {!typing && <Button size="small" onClick={() => setLang(sttLang === "bn-BD" ? "en-US" : "bn-BD")} sx={{ minWidth: 0, color: fg }}>{sttLang === "bn-BD" ? "বাংলা" : "EN"}</Button>}
        </Box>
      )}
      {answerText && !typing && !speech.listening && (
        <Button size="small" onClick={speech.reset} sx={{ mt: 0.5, color: fg, opacity: 0.8 }} startIcon={<RotateCcw size={13} />}>Say it again</Button>
      )}
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1, flexWrap: "wrap" }}>
        <Button size="small" startIcon={<SkipForward size={14} />} disabled={sending} onClick={onSkip} sx={{ color: fg }}>Pass</Button>
        {typingAllowed && (
          <Button size="small" startIcon={typing ? <Mic size={14} /> : <Keyboard size={14} />} onClick={() => { speech.stop(); setTyping(!typing); }} sx={{ color: fg }}>
            {typing ? "Speak instead" : "Type instead"}
          </Button>
        )}
        <Button size="small" startIcon={ending ? <CircularProgress size={12} /> : <X size={14} />} disabled={sending || ending} onClick={onEnd} sx={{ color: fg }}>End</Button>
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------ layout: panel

function PanelLayout({ session, panel, speakerIdx, line, ask, status, speaking, onReplay, controls, errorBox, timer, theme }) {
  return (
    <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 4, overflow: "hidden", bgcolor: "background.paper" }}>
      <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.25, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Typography sx={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "text.secondary", flex: 1 }}>
          {KIND_LABEL[session.kind] || "Interview"} · board of {panel.length}
        </Typography>
        <Progress session={session} />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${panel.length}, 1fr)`, gap: 1, px: 2, pt: 2.5, pb: 1.5 }}>
        {panel.map((p, i) => (
          <Box key={i} sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75, opacity: i === speakerIdx ? 1 : 0.55, transition: "opacity .3s" }}>
            <Face name={p.name} size={52} active={i === speakerIdx && speaking} />
            <Typography sx={{ fontSize: 13, fontWeight: 600, textAlign: "center", lineHeight: 1.2 }}>{p.name}</Typography>
            {p.role && <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", lineHeight: 1.2 }}>{p.role}</Typography>}
          </Box>
        ))}
      </Box>
      <Box sx={{ mx: 2, mb: 2, p: 2, borderRadius: 3, bgcolor: "action.hover" }}>
        <Typography sx={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "text.secondary", mb: 0.5 }}>
          {ask?.kind === "followUp" ? "Follow-up" : `Question ${Math.max(1, session.asked)}`} · {panel[speakerIdx]?.name}
        </Typography>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: { xs: 18, md: 20 }, lineHeight: 1.5, fontWeight: 500 }}>{line}</Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, minHeight: 28 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{status}</Typography>
          {onReplay && <Button size="small" onClick={onReplay} startIcon={<Volume2 size={14} />}>Replay</Button>}
        </Box>
      </Box>
      <Box sx={{ px: 2, pt: 1.5, pb: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
        {timer && <Box sx={{ mb: 1.25 }}>{timer}</Box>}
        {errorBox}
        {controls}
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------ layout: board

function BoardLayout({ session, panel, speakerIdx, line, ask, status, speaking, onReplay, controls, errorBox, timer, theme }) {
  const bg = "#16181d";
  const fg = DARK_FG;
  const rule = `1px solid ${alpha(fg, 0.15)}`;
  return (
    <Box sx={{ bgcolor: bg, color: fg, borderRadius: 3, overflow: "hidden", minHeight: "70dvh", display: "flex", flexDirection: "column" }}>
      <Box sx={{ textAlign: "center", pt: 2, pb: 1.5, borderBottom: rule }}>
        <Typography sx={{ fontSize: 10.5, letterSpacing: ".2em", textTransform: "uppercase", opacity: 0.7 }}>Examination board</Typography>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 17, fontWeight: 600, mt: 0.25 }}>{session.title}</Typography>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${panel.length}, 1fr)`, borderBottom: rule }}>
        {panel.map((p, i) => (
          <Box key={i} sx={{ py: 1.25, px: 1, textAlign: "center", borderLeft: i ? rule : 0, bgcolor: i === speakerIdx ? alpha(fg, 0.08) : "transparent", transition: "background-color .3s" }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75 }}>
              {i === speakerIdx && <Box component="span" sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: speaking ? "error.main" : alpha(fg, 0.6) }} />}
              {p.name}
            </Typography>
            {p.role && <Typography sx={{ fontSize: 11, opacity: 0.65 }}>{p.role}</Typography>}
          </Box>
        ))}
      </Box>
      <Box sx={{ px: 3, pt: 3, flex: 1 }}>
        <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}><Progress session={session} dark /></Box>
        <Typography sx={{ textAlign: "center", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", opacity: 0.6, mb: 1 }}>
          {ask?.kind === "followUp" ? "Follow-up" : `Question ${Math.max(1, session.asked)}`}
        </Typography>
        <Typography sx={{ textAlign: "center", fontFamily: theme.typography.h1.fontFamily, fontSize: { xs: 21, md: 24 }, lineHeight: 1.5, fontWeight: 500 }}>{line}</Typography>
        <Typography sx={{ textAlign: "center", fontSize: 12, opacity: 0.65, mt: 1.5, minHeight: 18 }}>{status}</Typography>
        {onReplay && <Box sx={{ textAlign: "center" }}><Button size="small" onClick={onReplay} startIcon={<Volume2 size={14} />} sx={{ color: alpha(fg, 0.8) }}>Replay</Button></Box>}
      </Box>
      <Box sx={{ px: 2.5, pt: 1.5, pb: 2.5, borderTop: rule }}>
        {timer && <Box sx={{ mb: 1.25 }}>{timer}</Box>}
        {errorBox}
        {controls}
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------ layout: video

function VideoLayout({ session, speaker, line, status, speaking, onReplay, controls, errorBox, timer, theme }) {
  const bg = "#14161a";
  const fg = DARK_FG;
  const [cam, setCam] = useState(false);
  const [camError, setCamError] = useState("");
  const video = useRef(null);
  const stream = useRef(null);
  const [since] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  // The self-view never leaves the device: shown here only, not recorded.
  useEffect(() => {
    if (!cam) return undefined;
    let off = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((s) => { if (off) { s.getTracks().forEach((t) => t.stop()); return; } stream.current = s; if (video.current) video.current.srcObject = s; })
      .catch(() => { setCamError("Camera blocked or not found."); setCam(false); });
    return () => { off = true; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [cam]);
  return (
    <Box sx={{ bgcolor: bg, color: fg, borderRadius: 3, overflow: "hidden" }}>
      <Box sx={{ position: "relative", aspectRatio: { xs: "3 / 4", sm: "16 / 10" }, display: "grid", placeItems: "center", background: `radial-gradient(circle at 50% 40%, ${alpha(theme.palette.primary.main, 0.25)}, ${bg} 70%)` }}>
        <Box sx={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 1, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "error.main" }} /> {mmss((Date.now() - since) / 1000)}
          <Box component="span" sx={{ opacity: 0.6, ml: 1, textTransform: "uppercase", letterSpacing: ".1em" }}>{KIND_LABEL[session.kind] || "Interview"}</Box>
        </Box>
        <Box sx={{ position: "absolute", top: 12, right: 12 }}><Progress session={session} dark /></Box>
        <Box sx={{ textAlign: "center" }}>
          <Box sx={{ display: "inline-block", p: speaking ? 0.75 : 0, borderRadius: "50%", boxShadow: speaking ? `0 0 0 3px ${alpha(fg, 0.25)}` : "none", transition: "all .3s" }}>
            <Face name={speaker.name} size={104} inverted />
          </Box>
          <Typography sx={{ mt: 1.25, fontWeight: 600 }}>{speaker.name}</Typography>
          {speaker.role && <Typography sx={{ fontSize: 12, opacity: 0.65 }}>{speaker.role}</Typography>}
        </Box>
        <Box sx={{ position: "absolute", right: 12, bottom: 12, width: { xs: 86, sm: 120 }, aspectRatio: "3 / 4", borderRadius: 2, overflow: "hidden", bgcolor: alpha(fg, 0.08), border: `1px solid ${alpha(fg, 0.2)}`, display: "grid", placeItems: "center" }}>
          {cam ? <video ref={video} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} /> : <Typography sx={{ fontSize: 11, opacity: 0.6 }}>You</Typography>}
        </Box>
        <IconButton size="small" onClick={() => { setCamError(""); setCam(!cam); }} sx={{ position: "absolute", left: 12, bottom: 12, color: fg, bgcolor: alpha(fg, 0.12) }} aria-label={cam ? "Turn camera off" : "Turn camera on"}>
          {cam ? <VideoOff size={16} /> : <Video size={16} />}
        </IconButton>
      </Box>
      <Box sx={{ px: 2.5, py: 1.5, bgcolor: alpha("#000", 0.35), minHeight: 64 }}>
        <Typography sx={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.6 }}>{speaker.name}{status ? ` · ${status.replace(`${speaker.name} `, "")}` : ""}</Typography>
        <Typography sx={{ fontSize: { xs: 16, md: 17 }, lineHeight: 1.5, mt: 0.25 }}>{line}</Typography>
        {onReplay && <Button size="small" onClick={onReplay} startIcon={<Volume2 size={14} />} sx={{ color: alpha(fg, 0.8), ml: -1 }}>Replay</Button>}
        {camError && <Typography sx={{ fontSize: 12, color: "warning.light" }}>{camError}</Typography>}
      </Box>
      <Box sx={{ px: 2.5, pt: 1.5, pb: 2.5 }}>
        {timer && <Box sx={{ mb: 1.25 }}>{timer}</Box>}
        <Typography sx={{ fontSize: 12, opacity: 0.6, mb: 1 }}>Tip: one real example, about a minute. The follow-up comes from your answer.</Typography>
        {errorBox}
        {controls}
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------------ report

function InterviewReport({ session, onAgain, onBack, restarting }) {
  const theme = useTheme();
  const [showTranscript, setShowTranscript] = useState(false);
  const r = session.report || {};
  const answered = (session.marks || []).filter((m) => typeof m === "number").length;
  const rule = `1px solid ${theme.palette.divider}`;
  const names = (session.interviewers || []).map((p) => p.name);
  const label = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "text.secondary", mb: 0.5 };
  return (
    <Box sx={{ bgcolor: "background.paper", border: rule, borderRadius: 2, overflow: "hidden" }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 1.5, borderBottom: `2px solid ${theme.palette.text.primary}` }}>
        <Typography sx={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "text.secondary" }}>
          Interview feedback · {new Date(session.updatedAt).toLocaleDateString()}
        </Typography>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 22, fontWeight: 600, mt: 0.5 }}>{session.title}</Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", px: 2.5, py: 2, borderBottom: rule }}>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 60, lineHeight: 0.9, fontWeight: 600 }}>
          {r.score ?? 0}<Box component="span" sx={{ fontSize: 18, color: "text.secondary", fontWeight: 400 }}> /100</Box>
        </Typography>
        <Typography sx={{ fontSize: 11, textAlign: "right", lineHeight: 1.7, letterSpacing: ".06em", color: "text.secondary" }}>
          {answered} ANSWERED<br />{session.limit} QUESTIONS
        </Typography>
      </Box>
      {(r.criteria || []).map((c) => (
        <Box key={c.name} sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2.5, py: 1, borderBottom: rule }}>
          <Typography sx={{ fontSize: 14, flex: 1 }}>{c.name}</Typography>
          <LinearProgress variant="determinate" value={Math.min(100, (c.score / 10) * 100)} color={c.score >= 7 ? "success" : c.score >= 4 ? "warning" : "error"} sx={{ width: 110, height: 6, borderRadius: 3 }} />
          <Typography sx={{ fontSize: 13, fontVariantNumeric: "tabular-nums", width: 36, textAlign: "right" }}>{Math.round(c.score)}/10</Typography>
        </Box>
      ))}
      <Box sx={{ px: 2.5, py: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
        {r.remark && <Typography sx={{ color: "error.main", fontStyle: "italic", fontFamily: theme.typography.h1.fontFamily, fontSize: 17 }}>{r.remark}</Typography>}
        {(r.strengths || []).length > 0 && <Box><Typography sx={label}>Went well</Typography>{r.strengths.map((x) => <Typography key={x} sx={{ fontSize: 14 }}>✓ {x}</Typography>)}</Box>}
        {(r.weaknesses || []).length > 0 && <Box><Typography sx={label}>Work on</Typography>{r.weaknesses.map((x) => <Typography key={x} sx={{ fontSize: 14 }}>· {x}</Typography>)}</Box>}
        {(r.tips || []).length > 0 && <Box><Typography sx={label}>Next time</Typography>{r.tips.map((x) => <Typography key={x} sx={{ fontSize: 14 }}>→ {x}</Typography>)}</Box>}
        {r.better?.answer && (
          <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: "action.hover" }}>
            <Typography sx={label}>A stronger answer</Typography>
            {r.better.question && <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.5 }}>{r.better.question}</Typography>}
            <Typography sx={{ fontSize: 14, lineHeight: 1.6 }}>{r.better.answer}</Typography>
          </Box>
        )}
        {!answered && <Typography color="text.secondary" sx={{ fontSize: 14 }}>No answers in this session.</Typography>}
      </Box>
      {showTranscript && (
        <Box sx={{ px: 2.5, pb: 2, display: "flex", flexDirection: "column", gap: 1 }}>
          {(session.turns || []).filter((t) => t.text).map((t, i) => (
            t.kind === "feedback"
              ? <Typography key={i} sx={{ fontSize: 12.5, color: t.verdict === "strong" ? "success.main" : t.verdict === "weak" ? "error.main" : "warning.main", pl: 2, fontStyle: "italic" }}>{t.text}</Typography>
              : (
                <Typography key={i} sx={{ fontSize: 13, color: t.role === "interviewer" ? "text.primary" : "text.secondary" }}>
                  <b>{t.role === "interviewer" ? names[t.by] || "Panel" : "You"}:</b> {t.text}{t.timedOut ? " (time ran out)" : ""}
                </Typography>
              )
          ))}
        </Box>
      )}
      <Box sx={{ display: "flex", gap: 1, px: 2.5, pb: 2.5 }}>
        <Button fullWidth variant="outlined" onClick={() => setShowTranscript(!showTranscript)}>{showTranscript ? "Hide transcript" : "Transcript"}</Button>
        <Button fullWidth variant="contained" disabled={restarting} onClick={onAgain}>{restarting ? "Starting…" : "Again"}</Button>
      </Box>
      <Box sx={{ px: 2.5, pb: 2 }}><Button fullWidth size="small" onClick={onBack}>All interviews</Button></Box>
    </Box>
  );
}
