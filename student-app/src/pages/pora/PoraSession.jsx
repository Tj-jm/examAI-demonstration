import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, IconButton, Button, Skeleton, Alert, Tooltip, CircularProgress } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Mic, Square, Send, Lightbulb, SkipForward, X, Volume2, VolumeX, RotateCcw } from "lucide-react";
import {
  useGetPoraSessionQuery, useGetPoraSettingsQuery, usePoraTurnMutation, useEndPoraMutation, useSpeakPoraMutation, useStartPoraMutation,
} from "../../api/contentApi";
import useSpeech from "../../hooks/useSpeech";
import Latex from "../../components/Latex";
import { useBranding } from "../../BrandingContext";
import PoraAllowance, { SessionMeter } from "./PoraAllowance";
import { mascotForSession } from "../../components/Mascot";
import ReportSlip from "./ReportSlip";

// One Oral Quiz session in one of three layouts, all drawn from the theme:
//   call    — a phone call with the teacher, live transcript
//   teacher — the teacher's question large, voice first
//   page    — the lecture line the question is about, highlighted
// and the report slip when it ends.

const BANGLA = /[ঀ-৿]/;
// The admin picks one layout (Settings → AI → Oral Quiz).
const LAYOUTS = ["call", "teacher", "page"];

// What the teacher says now: their turns since the student last spoke.
const latestTeacher = (turns) => {
  const out = [];
  for (let i = turns.length - 1; i >= 0 && turns[i].role === "teacher"; i -= 1) out.unshift(turns[i]);
  return out;
};

export default function PoraSession() {
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { featureNames } = useBranding();
  const title = featureNames?.poraDhora || "Oral Quiz";
  const { data: session, isLoading } = useGetPoraSessionQuery({ batchId, id });
  const { data: settings, refetch: refetchSettings } = useGetPoraSettingsQuery(batchId, { refetchOnMountOrArgChange: true });
  const [turn, { isLoading: sending, error: turnError, reset: resetTurn }] = usePoraTurnMutation();
  const [endSession, { isLoading: ending }] = useEndPoraMutation();
  const [startAgain, { isLoading: restarting }] = useStartPoraMutation();
  const [speak] = useSpeakPoraMutation();

  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  // The voice is being made: the teacher is "about to speak".
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [lang, setLang] = useState(null);
  const [replays, setReplays] = useState(0);
  const audio = useRef(null);
  const spokenFor = useRef(null);

  const turns = useMemo(() => session?.turns || [], [session]);
  const now = latestTeacher(turns);
  const nowText = now.map((t) => t.text).filter(Boolean).join(" ");
  const ask = [...turns].reverse().find((t) => t.role === "teacher" && (t.kind === "question" || t.kind === "followUp"));
  const bangla = session?.language ? session.language === "Bangla" : BANGLA.test(nowText || ask?.text || "");
  const sttLang = lang || (bangla ? "bn-BD" : "en-US");
  const speech = useSpeech(sttLang);
  const done = session?.status === "done";
  const mode = LAYOUTS.includes(settings?.layout) ? settings.layout : "call";
  const teacherName = settings?.teacherName || "Teacher";

  // The teacher speaks each new line once.
  useEffect(() => {
    if (!settings?.voice || muted || done || !nowText || spokenFor.current === nowText) return;
    spokenFor.current = nowText;
    let cancelled = false;
    let url = null;
    (async () => {
      setVoiceLoading(true);
      const r = await speak({ batchId, text: nowText });
      setVoiceLoading(false);
      if (cancelled || typeof r.data !== "string") return;
      url = r.data;
      audio.current?.pause();
      const a = new Audio(url);
      audio.current = a;
      a.onplay = () => setSpeaking(true);
      a.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      a.onpause = () => setSpeaking(false);
      a.play().catch(() => setSpeaking(false));
    })();
    return () => { cancelled = true; };
  }, [nowText, settings?.voice, muted, done, batchId, speak, replays]);

  useEffect(() => () => audio.current?.pause(), []);

  if (isLoading || !settings) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={420} /></Box>;
  if (!session) return <Box sx={{ p: 3 }}><Alert severity="error">Session not found.</Alert></Box>;

  const send = async (kind, text) => {
    audio.current?.pause();
    speech.stop();
    resetTurn();
    const r = await turn({ batchId, id, kind, text });
    if (!r.error) speech.reset();
    if (kind === "answer") mascotForSession(r.data?.session);
    refetchSettings();
  };
  const answerText = `${speech.text} ${speech.interim}`.trim();
  const replay = () => { spokenFor.current = null; setMuted(false); setReplays((n) => n + 1); };

  const header = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/pora`)} aria-label="Back"><ArrowLeft size={18} /></IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>{title}</Typography>
        <Typography noWrap variant="caption" color="text.secondary">{session.lectureTitle}</Typography>
      </Box>
      {!done && settings.voice && (
        <Tooltip title={muted ? "Turn the teacher's voice on" : "Mute the teacher"}>
          <IconButton size="small" onClick={() => { setMuted(!muted); audio.current?.pause(); }}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</IconButton>
        </Tooltip>
      )}
    </Box>
  );

  if (done) {
    return (
      <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 560, mx: "auto" }}>
        {header}
        <ReportSlip
          session={session}
          turns={turns}
          restarting={restarting}
          onAgain={async () => {
            const r = await startAgain({ batchId, lectureId: session.lecture, fresh: true });
            if (r.data?.session) navigate(`/batches/${batchId}/pora/${r.data.session._id}`, { replace: true });
          }}
          onBack={() => navigate(`/batches/${batchId}/pora`)}
        />
      </Box>
    );
  }

  const limited = turnError?.status === 429;
  const controls = (
    <AnswerBar
      speech={speech}
      sending={sending}
      answerText={answerText}
      sttLang={sttLang}
      setLang={setLang}
      hintsLeft={session.hintsLeft}
      onSend={() => answerText && send("answer", answerText)}
      onMic={() => { audio.current?.pause(); setSpeaking(false); }}
      onHint={() => send("hint")}
      onSkip={() => send("skip")}
      onEnd={async () => { audio.current?.pause(); speech.stop(); await endSession({ batchId, id }); }}
      ending={ending}
      dark={mode === "teacher"}
    />
  );
  const progress = { asked: session.asked, limit: session.limit, marks: session.marks };
  const errorBox = turnError && (
    limited
      ? <PoraAllowance batchId={batchId} settings={settings} onUnlocked={() => { resetTurn(); refetchSettings(); }} />
      : <Alert severity="error" sx={{ mb: 1 }}>{turnError.data?.message || "That didn't go through. Try again."}</Alert>
  );

  const props = { turns, now, ask, teacherName, speaking, voiceLoading, onReplay: settings.voice ? replay : null, progress, sending, controls, errorBox, theme };
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 620, mx: "auto" }}>
      {header}
      <SessionMeter batchId={batchId} settings={settings} />
      {mode === "teacher" ? <TeacherLayout {...props} /> : mode === "page" ? <PageLayout {...props} /> : <CallLayout {...props} />}
    </Box>
  );
}

// --------------------------------------------------------------- pieces

function Progress({ progress, dark }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
      {Array.from({ length: progress.limit }, (_, i) => {
        const m = progress.marks?.[i];
        const color = typeof m === "number"
          ? m >= 7 ? theme.palette.success.main : m >= 4 ? theme.palette.warning.main : theme.palette.error.main
          : i < progress.asked ? (dark ? theme.palette.background.paper : theme.palette.text.primary) : alpha(dark ? theme.palette.background.paper : theme.palette.text.primary, 0.18);
        return <Box key={i} sx={{ width: 18, height: 4, borderRadius: 1, bgcolor: color }} />;
      })}
      <Typography variant="caption" sx={{ ml: 1, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>Q {Math.max(1, progress.asked)}/{progress.limit}</Typography>
    </Box>
  );
}

function Waveform({ active, color }) {
  return (
    <Box sx={{ display: "flex", gap: "3px", alignItems: "center", height: 28 }}>
      {[30, 70, 45, 90, 60, 35, 80, 50, 25, 65, 40, 20].map((h, i) => (
        <Box
          key={i}
          sx={{
            width: 3, borderRadius: 1, bgcolor: color, height: active ? `${h}%` : "12%", transition: "height .25s",
            ...(active ? { animation: `poraWave 0.9s ${i * 0.07}s ease-in-out infinite alternate`, "@keyframes poraWave": { from: { transform: "scaleY(.5)" }, to: { transform: "scaleY(1)" } } } : {}),
          }}
        />
      ))}
    </Box>
  );
}

// Voice only: the student answers out loud, like a real oral test.
function AnswerBar({ speech, sending, answerText, sttLang, setLang, hintsLeft, onSend, onMic, onHint, onSkip, onEnd, ending, dark }) {
  const theme = useTheme();
  const fg = dark ? theme.palette.background.paper : theme.palette.text.primary;
  return (
    <Box>
      {(speech.listening || answerText) && (
        <Typography sx={{ fontSize: 14, mb: 1, color: fg, opacity: speech.interim ? 0.75 : 1, minHeight: 20 }}>
          {answerText || "Listening…"}
        </Typography>
      )}
      {speech.error && <Typography variant="caption" color="error" sx={{ display: "block", mb: 1 }}>{speech.error}</Typography>}
      {!speech.supported ? (
        <Alert severity="warning" sx={{ mb: 1 }}>This browser can't hear you. Open this page in Chrome, Edge or Safari to answer out loud.</Alert>
      ) : (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Button
            fullWidth
            size="large"
            variant="contained"
            color={speech.listening ? "error" : answerText ? "success" : "primary"}
            disabled={sending}
            startIcon={sending ? <CircularProgress size={16} color="inherit" /> : speech.listening ? <Square size={16} /> : answerText ? <Send size={17} /> : <Mic size={18} />}
            onClick={() => {
              if (speech.listening) speech.stop();
              else if (answerText) onSend();
              else { onMic?.(); speech.start(); }
            }}
            sx={{ borderRadius: 99, py: 1.25 }}
          >
            {sending ? "Checking…" : speech.listening ? "Stop" : answerText ? "Send answer" : "Tap to answer"}
          </Button>
          <Button size="small" onClick={() => setLang(sttLang === "bn-BD" ? "en-US" : "bn-BD")} sx={{ minWidth: 0, color: fg }}>{sttLang === "bn-BD" ? "বাংলা" : "EN"}</Button>
        </Box>
      )}
      {answerText && !speech.listening && (
        <Button size="small" onClick={speech.reset} sx={{ mt: 0.5, color: fg, opacity: 0.8 }} startIcon={<RotateCcw size={13} />}>Say it again</Button>
      )}
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
        <Button size="small" startIcon={<Lightbulb size={14} />} disabled={sending || hintsLeft < 1} onClick={onHint} sx={{ color: fg }}>Hint{hintsLeft < 3 ? ` (${hintsLeft})` : ""}</Button>
        <Button size="small" startIcon={<SkipForward size={14} />} disabled={sending} onClick={onSkip} sx={{ color: fg }}>Skip</Button>
        <Button size="small" startIcon={ending ? <CircularProgress size={12} /> : <X size={14} />} disabled={sending || ending} onClick={onEnd} sx={{ color: fg }}>End</Button>
      </Box>
    </Box>
  );
}

// While the teacher's voice is being made.
function VoiceWait({ name, color }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: 28, color: color || "text.secondary" }}>
      <CircularProgress size={14} color="inherit" />
      {name && <Typography sx={{ fontSize: 13 }}>{name} is about to speak…</Typography>}
    </Box>
  );
}

const Avatar = ({ name, size = 38, inverted }) => {
  const theme = useTheme();
  return (
    <Box sx={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
      bgcolor: inverted ? theme.palette.background.paper : theme.palette.text.primary,
      color: inverted ? theme.palette.text.primary : theme.palette.background.paper,
      fontFamily: theme.typography.h1.fontFamily, fontWeight: 600, fontSize: size * 0.42,
    }}>
      {String(name || "T").trim().charAt(0).toUpperCase()}
    </Box>
  );
};

// ------------------------------------------------------------ layout: call

function CallLayout({ turns, teacherName, speaking, voiceLoading, onReplay, progress, sending, controls, errorBox, theme }) {
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns.length, sending]);
  const visible = turns.filter((t) => t.text && !(t.role === "student" && t.kind === "hint"));
  return (
    <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 4, overflow: "hidden", bgcolor: "background.paper" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 2, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Avatar name={teacherName} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{teacherName}</Typography>
          <Progress progress={progress} />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 11, letterSpacing: ".08em" }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "error.main" }} /> LIVE
        </Box>
      </Box>
      <Box sx={{ px: 2.5, py: 2, display: "flex", flexDirection: "column", gap: 2, maxHeight: "52dvh", overflowY: "auto" }}>
        {visible.map((t, i) => {
          const teacher = t.role === "teacher";
          const last = i === visible.length - 1 || (teacher && visible.slice(i + 1).every((x) => x.role === "teacher"));
          return (
            <Box key={i} sx={{ opacity: last ? 1 : 0.62 }}>
              <Typography sx={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "text.secondary", mb: 0.25 }}>
                {teacher ? teacherName : t.kind === "skip" ? "You · skipped" : "You"}
                {t.verdict && t.verdict !== "skipped" && <Box component="span" sx={{ ml: 1, color: t.verdict === "correct" ? "success.main" : t.verdict === "wrong" ? "error.main" : "warning.main" }}>· {t.verdict}</Box>}
              </Typography>
              <Typography sx={{
                fontFamily: teacher ? theme.typography.h1.fontFamily : undefined,
                fontSize: teacher && last && (t.kind === "question" || t.kind === "followUp") ? 19 : teacher ? 16 : 15,
                fontWeight: teacher && last ? 600 : 400,
                lineHeight: 1.55,
                color: teacher ? "text.primary" : "text.secondary",
              }}>
                {t.text}
              </Typography>
            </Box>
          );
        })}
        {sending && <Typography sx={{ fontSize: 13, color: "text.secondary" }}>{teacherName} is thinking…</Typography>}
        <div ref={end} />
      </Box>
      <Box sx={{ px: 2, pt: 1.5, pb: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          {voiceLoading ? <VoiceWait name={teacherName} /> : <Waveform active={speaking} color={theme.palette.text.primary} />}
          <Box sx={{ flex: 1 }} />
          {onReplay && <Button size="small" onClick={onReplay} startIcon={<Volume2 size={14} />}>Replay</Button>}
        </Box>
        {errorBox}
        {controls}
      </Box>
    </Box>
  );
}

// --------------------------------------------------------- layout: teacher

function TeacherLayout({ now, ask, teacherName, speaking, voiceLoading, onReplay, progress, sending, controls, errorBox, theme }) {
  const bg = theme.palette.text.primary;
  const fg = theme.palette.background.paper;
  const feedback = now.find((t) => t.kind === "feedback");
  const line = now.filter((t) => t.kind !== "feedback").map((t) => t.text).join(" ") || ask?.text || "";
  return (
    <Box sx={{ bgcolor: bg, color: fg, borderRadius: 4, px: 2.5, pt: 2, pb: 2.5, minHeight: "70dvh", display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", justifyContent: "center" }}><Progress progress={progress} dark /></Box>
      <Box sx={{ display: "flex", justifyContent: "center", mt: 3, mb: 2 }}>
        <Box sx={{ position: "relative" }}>
          <Box sx={{ position: "absolute", inset: -14, borderRadius: "50%", border: `1px solid ${alpha(fg, speaking ? 0.35 : 0.12)}`, transition: "border-color .3s" }} />
          <Box sx={{ position: "absolute", inset: -28, borderRadius: "50%", border: `1px solid ${alpha(fg, speaking ? 0.18 : 0.06)}`, transition: "border-color .3s" }} />
          <Avatar name={teacherName} size={92} inverted />
        </Box>
      </Box>
      <Typography sx={{ textAlign: "center", fontSize: 12, opacity: 0.7, mb: 2 }}>{sending ? `${teacherName} is thinking…` : voiceLoading ? `${teacherName} is about to speak…` : speaking ? `${teacherName} is speaking` : teacherName}</Typography>
      {feedback && (
        <Typography sx={{ textAlign: "center", fontSize: 14, mb: 1.5, color: feedback.verdict === "correct" ? theme.palette.success.light : feedback.verdict === "wrong" ? theme.palette.error.light : theme.palette.warning.light }}>
          {feedback.text}
        </Typography>
      )}
      <Typography sx={{ textAlign: "center", fontFamily: theme.typography.h1.fontFamily, fontSize: { xs: 20, md: 23 }, lineHeight: 1.5, fontWeight: 500, px: 1 }}>
        {line}
      </Typography>
      {onReplay && <Box sx={{ textAlign: "center", mt: 1 }}><Button size="small" onClick={onReplay} startIcon={<Volume2 size={14} />} sx={{ color: alpha(fg, 0.8) }}>Replay</Button></Box>}
      <Box sx={{ flex: 1, minHeight: 24 }} />
      <Box sx={{ display: "flex", justifyContent: "center", mb: 1.5 }}>{voiceLoading ? <VoiceWait color={alpha(fg, 0.8)} /> : <Waveform active={speaking} color={alpha(fg, 0.8)} />}</Box>
      {errorBox}
      {controls}
    </Box>
  );
}

// ------------------------------------------------------------ layout: page

// The lecture line a question was about appears only once the student has
// answered (or skipped) it, beside the teacher's feedback: a correction,
// never a crib.
const answeredAsk = (turns) => {
  let answered = false;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (t.role === "student" && t.kind !== "hint") answered = true;
    if (t.role === "teacher" && (t.kind === "question" || t.kind === "followUp")) {
      if (answered) return t;
    }
  }
  return null;
};

function PageLayout({ turns, now, ask, teacherName, speaking, voiceLoading, onReplay, progress, sending, controls, errorBox, theme }) {
  const feedback = now.find((t) => t.kind === "feedback");
  const line = now.filter((t) => t.kind !== "feedback").map((t) => t.text).join(" ") || ask?.text || "";
  const source = feedback ? answeredAsk(turns) : null;
  const passage = source?.passage || "";
  const quote = source?.quote || "";
  const at = quote ? passage.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  const mark = alpha(theme.palette.warning.main, 0.35);
  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography variant="caption" color="text.secondary">{passage ? `Where this comes from${source.sourceTitle ? ` · ${source.sourceTitle}` : ""}` : ""}</Typography>
        <Progress progress={progress} />
      </Box>
      {passage ? (
        <Box sx={{
          bgcolor: "background.paper", border: `1px solid ${theme.palette.divider}`, borderRadius: 2, px: 2.5, py: 2,
          boxShadow: `0 3px 0 -1px ${theme.palette.background.paper}, 0 4px 0 -1px ${theme.palette.divider}`,
          fontSize: 14, lineHeight: 1.9, color: "text.secondary", maxHeight: "34dvh", overflowY: "auto",
        }}>
          {at >= 0 ? (
            <>
              <Latex>{passage.slice(0, at)}</Latex>
              <Box component="span" sx={{ color: "text.primary", background: `linear-gradient(transparent 55%, ${mark} 55%)` }}><Latex>{passage.slice(at, at + quote.length)}</Latex></Box>
              <Latex>{passage.slice(at + quote.length)}</Latex>
            </>
          ) : <Latex>{passage}</Latex>}
        </Box>
      ) : null}
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", mt: 2.5 }}>
        <Avatar name={teacherName} size={34} />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "text.secondary" }}>
            {sending ? `${teacherName} is thinking…` : voiceLoading ? `${teacherName} · about to speak…` : `${teacherName}${speaking ? " · speaking" : ""}`}
          </Typography>
          {feedback && (
            <Typography sx={{ fontSize: 14, mt: 0.5, color: feedback.verdict === "correct" ? "success.main" : feedback.verdict === "wrong" ? "error.main" : "warning.main" }}>{feedback.text}</Typography>
          )}
          <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 17, lineHeight: 1.55, mt: 0.5 }}>{line}</Typography>
          {onReplay && <Button size="small" onClick={onReplay} startIcon={<Volume2 size={14} />} sx={{ mt: 0.5, ml: -1 }}>Replay</Button>}
        </Box>
      </Box>
      <Box sx={{ mt: 2, p: 2, borderRadius: 3, bgcolor: "action.hover" }}>
        {errorBox}
        {controls}
      </Box>
    </Box>
  );
}
