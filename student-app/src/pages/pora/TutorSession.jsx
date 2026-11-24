import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography, IconButton, Button, Skeleton, TextField, Alert, CircularProgress } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, Lightbulb, SkipForward, X, Check, ChevronDown, ImagePlus } from "lucide-react";
import {
  useGetTutorSessionQuery, useGetTutorSettingsQuery, useTutorTurnMutation, useEndTutorMutation, useStartTutorMutation, useUnlockTutorMutation, useUploadTutorImageMutation,
} from "../../api/contentApi";
import useAnswerDoodle from "../../components/useAnswerDoodle";
import Latex from "../../components/Latex";
import { useBranding } from "../../BrandingContext";
import PoraAllowance, { SessionMeter } from "./PoraAllowance";
import { mascotForSession } from "../../components/Mascot";
import ReportSlip from "./ReportSlip";

// One AI Tutoring session, in the layout it started with, all from the theme:
//   chat  — a tutor chat, feedback under each answer
//   book  — an exercise book, answers marked in red ink
//   paper — a creative question: stimulus, then parts worth 1–4 marks
// and the report slip when it ends.

const BN_PARTS = ["ক", "খ", "গ", "ঘ"];
const EN_PARTS = ["a", "b", "c", "d"];

export default function TutorSession() {
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const { featureNames } = useBranding();
  const title = featureNames?.aiTutor || "AI Tutoring";
  const { data: session, isLoading } = useGetTutorSessionQuery({ batchId, id });
  const { data: settings, refetch: refetchSettings } = useGetTutorSettingsQuery(batchId, { refetchOnMountOrArgChange: true });
  const [turn, { isLoading: sending, error: turnError, reset: resetTurn, originalArgs }] = useTutorTurnMutation();
  const [endSession, { isLoading: ending }] = useEndTutorMutation();
  const [startAgain, { isLoading: restarting }] = useStartTutorMutation();

  const turns = useMemo(() => session?.turns || [], [session]);
  const done = session?.status === "done";
  const tutorName = settings?.tutorName || "Tutor";

  if (isLoading || !settings) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={420} /></Box>;
  if (!session) return <Box sx={{ p: 3 }}><Alert severity="error">Session not found.</Alert></Box>;

  const send = async (kind, text, part, images) => {
    resetTurn();
    const r = await turn({ batchId, id, kind, text, part, images });
    refetchSettings();
    if (kind === "answer") mascotForSession(r.data?.session, part);
    return !r.error;
  };
  const onEnd = () => endSession({ batchId, id });

  const header = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
      <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/tutoring`)} aria-label="Back"><ArrowLeft size={18} /></IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, fontSize: 15 }}>{title}</Typography>
        <Typography noWrap variant="caption" color="text.secondary">{session.lectureTitle}</Typography>
      </Box>
    </Box>
  );

  if (done) {
    const reportTurns = session.layout === "paper" ? paperTurns(session) : turns;
    return (
      <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 560, mx: "auto" }}>
        {header}
        {session.layout === "paper" && session.paper && <Box sx={{ mb: 2 }}><PaperLayout session={session} done /></Box>}
        <ReportSlip
          session={session}
          turns={reportTurns}
          restarting={restarting}
          onAgain={async () => {
            const r = await startAgain({ batchId, lectureId: session.lecture, fresh: true });
            if (r.data?.session) navigate(`/batches/${batchId}/tutoring/${r.data.session._id}`, { replace: true });
          }}
          onBack={() => navigate(`/batches/${batchId}/tutoring`)}
        />
      </Box>
    );
  }

  const errorBox = turnError && (
    turnError.status === 429
      ? <PoraAllowance batchId={batchId} settings={settings} useUnlock={useUnlockTutorMutation} onUnlocked={() => { resetTurn(); refetchSettings(); }} />
      : <Alert severity="error" sx={{ mb: 1 }}>{turnError.data?.message || "That didn't go through. Try again."}</Alert>
  );
  const props = { session, turns, tutorName, sending, send, onEnd, ending, errorBox, sendingPart: originalArgs?.part };
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 680, mx: "auto" }}>
      {header}
      <SessionMeter batchId={batchId} settings={settings} />
      {session.layout === "paper" ? <PaperLayout {...props} /> : session.layout === "book" ? <BookLayout {...props} /> : <ChatLayout {...props} />}
    </Box>
  );
}

// A paper as transcript lines for the report.
const paperTurns = (session) => {
  const out = [{ role: "teacher", text: session.paper?.stimulus }];
  (session.paper?.parts || []).forEach((p) => {
    out.push({ role: "teacher", text: p.question });
    if (p.answer || p.images?.length) out.push({ role: "student", text: p.answer || "(answer in the picture)" });
    if (p.feedback) out.push({ role: "teacher", text: `${p.got ?? 0}/${p.marks}. ${p.feedback}` });
  });
  return out;
};

// The feedback turn right after a student's answer, if any.
const feedbackAfter = (turns, i) => (turns[i + 1]?.kind === "feedback" ? turns[i + 1] : null);

// --------------------------------------------------------------- pieces

// The answer being written: text, and drawn pages or photos.
const MAX_IMAGES = 4;
function useAnswer() {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState([]);
  return { draft, setDraft, images, setImages, clear: () => { setDraft(""); setImages([]); } };
}

function AnswerInput({ answer, onSend, sending, placeholder, variant = "outlined", rows = 1, sx, draftKey }) {
  const { batchId } = useParams();
  const { draft, setDraft, images, setImages } = answer;
  const [uploadImage, { isLoading: uploading }] = useUploadTutorImageMutation();
  const [error, setError] = useState("");
  const file = useRef(null);
  const upload = async (f) => {
    const r = await uploadImage({ batchId, file: f });
    if (r.error) throw new Error(r.error.data?.message || "Couldn't upload that picture.");
    return r.data.url;
  };
  const doodle = useAnswerDoodle({ images, onChange: setImages, upload, maxImages: MAX_IMAGES, draftKey });
  const ready = draft.trim() || images.length;
  const go = () => { if (ready) onSend(draft.trim(), images); };
  const busy = sending || uploading;
  return (
    <Box sx={sx}>
      <Box sx={{ display: "flex", gap: 0.75, alignItems: "flex-end" }}>
        <TextField
          fullWidth
          multiline
          minRows={rows}
          maxRows={8}
          size="small"
          variant={variant}
          placeholder={placeholder || "Write your answer…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && rows === 1) { e.preventDefault(); go(); } }}
          disabled={sending}
        />
        <IconButton color="primary" onClick={go} disabled={busy || !ready} aria-label="Send">
          {sending ? <CircularProgress size={18} /> : <Send size={18} />}
        </IconButton>
      </Box>
      {images.length > 0 && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
          {images.map((u) => (
            <Box key={u} sx={{ position: "relative" }}>
              <Box component="img" src={u} alt="" sx={{ width: 64, height: 64, objectFit: "cover", borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "#fff" }} />
              <IconButton size="small" aria-label="Remove" onClick={() => setImages(images.filter((x) => x !== u))} sx={{ position: "absolute", top: -8, right: -8, bgcolor: "background.paper", boxShadow: 1, width: 22, height: 22, "&:hover": { bgcolor: "background.paper" } }}><X size={11} /></IconButton>
              {doodle.editButton(u)}
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.75, flexWrap: "wrap" }}>
        {doodle.button}
        <Button
          size="small"
          variant="outlined"
          startIcon={uploading ? <CircularProgress size={12} /> : <ImagePlus size={14} />}
          disabled={busy || images.length >= MAX_IMAGES}
          onClick={() => file.current?.click()}
        >
          Upload photo
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setError("");
            try { setImages([...images, await upload(f)].slice(0, MAX_IMAGES)); } catch (err) { setError(err.message); }
          }}
        />
        {error && <Typography variant="caption" color="error">{error}</Typography>}
      </Box>
      {doodle.pad}
    </Box>
  );
}

// The pictures with an answer.
function Pictures({ images }) {
  if (!images?.length) return null;
  return (
    <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 0.5 }}>
      {images.map((u) => (
        <Box key={u} component="a" href={u} target="_blank" rel="noreferrer">
          <Box component="img" src={u} alt="Answer" sx={{ width: 96, maxHeight: 128, objectFit: "cover", borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "#fff", display: "block" }} />
        </Box>
      ))}
    </Box>
  );
}

function Actions({ session, sending, send, onEnd, ending }) {
  return (
    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
      <Button size="small" startIcon={<Lightbulb size={14} />} disabled={sending || session.hintsLeft < 1} onClick={() => send("hint")}>
        Hint{session.hintsLeft < 3 ? ` (${session.hintsLeft})` : ""}{session.hintPenalty > 0 ? ` · −${session.hintPenalty}` : ""}
      </Button>
      <Button size="small" startIcon={<SkipForward size={14} />} disabled={sending} onClick={() => send("skip")}>Skip</Button>
      <Box sx={{ flex: 1 }} />
      <Button size="small" color="inherit" startIcon={ending ? <CircularProgress size={12} /> : <X size={14} />} disabled={sending || ending} onClick={onEnd}>End</Button>
    </Box>
  );
}

// The answer with its wrong words struck out in red.
function Marked({ text, wrong }) {
  const at = wrong ? text.toLowerCase().indexOf(wrong.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Box component="span" sx={{ textDecoration: "line-through", textDecorationColor: (t) => t.palette.error.main, textDecorationThickness: 2 }}>{text.slice(at, at + wrong.length)}</Box>
      {text.slice(at + wrong.length)}
    </>
  );
}

const verdictColor = (v) => (v === "correct" ? "success.main" : v === "wrong" ? "error.main" : v === "skipped" ? "text.secondary" : "warning.main");

// ------------------------------------------------------------ layout: chat

function ChatLayout({ session, turns, tutorName, sending, send, onEnd, ending, errorBox }) {
  const theme = useTheme();
  const answer = useAnswer();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns.length, sending]);
  const pct = Math.round((Math.max(0, session.asked - 1) / session.limit) * 100);
  return (
    <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 4, overflow: "hidden", bgcolor: "background.paper", display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 2, py: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{tutorName}</Typography>
          <Typography variant="caption" color="text.secondary">Question {Math.max(1, session.asked)} of {session.limit}</Typography>
        </Box>
        <Box sx={{ fontSize: 12, px: 1.25, py: 0.25, borderRadius: 99, bgcolor: "action.hover" }}>
          {session.hintsLeft} hint{session.hintsLeft === 1 ? "" : "s"} left
        </Box>
      </Box>
      <Box sx={{ height: 3, bgcolor: "action.hover" }}><Box sx={{ height: 3, width: `${pct}%`, bgcolor: "primary.main", transition: "width .3s" }} /></Box>
      <Box sx={{ px: 2, py: 2, display: "flex", flexDirection: "column", gap: 1.25, minHeight: "45dvh", maxHeight: "58dvh", overflowY: "auto" }}>
        {turns.map((t, i) => {
          if (!t.text || (t.role === "student" && t.kind === "hint")) return null;
          if (t.kind === "feedback") {
            return (
              <Box key={i} sx={{ alignSelf: "flex-start", display: "flex", gap: 0.75, alignItems: "flex-start", fontSize: 13, px: 1.25, py: 0.75, borderRadius: 2, bgcolor: alpha(theme.palette[t.verdict === "correct" ? "success" : t.verdict === "wrong" ? "error" : "warning"].main, 0.1), color: verdictColor(t.verdict), maxWidth: "88%" }}>
                <Box sx={{ mt: "2px" }}>{t.verdict === "correct" ? <Check size={14} /> : <X size={14} />}</Box>
                <Box><Latex>{t.text}</Latex></Box>
              </Box>
            );
          }
          const me = t.role === "student";
          const fb = me ? feedbackAfter(turns, i) : null;
          return (
            <Box
              key={i}
              sx={{
                alignSelf: me ? "flex-end" : "flex-start", maxWidth: "85%", px: 1.5, py: 1, fontSize: 14.5, lineHeight: 1.55,
                borderRadius: me ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                bgcolor: me ? "primary.main" : "action.hover", color: me ? "primary.contrastText" : "text.primary",
                fontStyle: t.kind === "skip" ? "italic" : "normal", opacity: t.kind === "skip" ? 0.7 : 1,
              }}
            >
              {me ? <><Marked text={t.text} wrong={fb?.wrongPart} /><Pictures images={t.images} /></> : <>{t.kind === "hint" && <b>Hint: </b>}<Latex>{t.text}</Latex></>}
            </Box>
          );
        })}
        {sending && <Typography sx={{ fontSize: 13, color: "text.secondary" }}>{tutorName} is reading your answer…</Typography>}
        <div ref={end} />
      </Box>
      <Box sx={{ px: 1.5, pt: 1, pb: 1, borderTop: `1px solid ${theme.palette.divider}` }}>
        {errorBox}
        <AnswerInput answer={answer} draftKey={`tutor:${session._id}`} sending={sending} onSend={async (text, images) => { if (await send("answer", text, undefined, images)) answer.clear(); }} />
        <Actions session={session} sending={sending} send={send} onEnd={onEnd} ending={ending} />
      </Box>
    </Box>
  );
}

// ------------------------------------------------------------ layout: book

function BookLayout({ session, turns, sending, send, onEnd, ending, errorBox }) {
  const theme = useTheme();
  const answer = useAnswer();
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [turns.length, sending]);
  const line = 30;
  const red = theme.palette.error.main;
  const ink = theme.palette.primary.main;
  const ruled = {
    backgroundImage: `linear-gradient(to right, transparent 46px, ${alpha(red, 0.45)} 46px, ${alpha(red, 0.45)} 47px, transparent 47px), repeating-linear-gradient(to bottom, transparent 0, transparent ${line - 1}px, ${alpha(theme.palette.info.main, 0.18)} ${line - 1}px, ${alpha(theme.palette.info.main, 0.18)} ${line}px)`,
    lineHeight: `${line}px`,
  };
  const hand = { color: ink, fontStyle: "italic", fontSize: 16 };
  const note = { color: red, fontStyle: "italic", fontSize: 14 };
  return (
    <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 2, overflow: "hidden", bgcolor: "background.paper", boxShadow: `0 2px 0 ${theme.palette.divider}` }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: `2px solid ${alpha(red, 0.5)}` }}>
        <Typography sx={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "text.secondary" }}>Q {Math.max(1, session.asked)}/{session.limit}</Typography>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontWeight: 600, fontSize: 18 }}>{session.lectureTitle}</Typography>
      </Box>
      <Box sx={{ ...ruled, pl: "58px", pr: 2, py: `${line / 2}px`, minHeight: "45dvh", maxHeight: "58dvh", overflowY: "auto" }}>
        {turns.map((t, i) => {
          if (!t.text || (t.role === "student" && t.kind === "hint")) return null;
          if (t.role === "teacher") {
            if (t.kind === "feedback") {
              return (
                <Box key={i} sx={note}>
                  {t.verdict === "correct" && <Box component="span" sx={{ fontStyle: "normal", fontWeight: 700, mr: 0.75 }}>✓</Box>}
                  <Latex>{t.text}</Latex>
                </Box>
              );
            }
            const main = t.kind === "question";
            return (
              <Box key={i} sx={{ position: "relative", mt: main && i > 0 ? `${line}px` : 0 }}>
                {main && <Box component="span" sx={{ position: "absolute", left: -50, width: 42, textAlign: "right", fontWeight: 700, color: "text.secondary", fontSize: 14 }}>Q{t.q}.</Box>}
                <Box sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 15.5, fontWeight: main ? 600 : 500, ...(t.kind === "hint" || t.kind === "closing" ? note : {}) }}>
                  {t.kind === "hint" && "Hint: "}<Latex>{t.text}</Latex>
                </Box>
              </Box>
            );
          }
          const fb = feedbackAfter(turns, i);
          return (
            <Box key={i} sx={{ ...hand, opacity: t.kind === "skip" ? 0.6 : 1 }}>
              {t.kind === "skip" ? "—" : <><Marked text={t.text} wrong={fb?.wrongPart} /><Pictures images={t.images} /></>}
            </Box>
          );
        })}
        {sending && <Box sx={{ ...note, opacity: 0.8 }}>marking…</Box>}
        <div ref={end} />
      </Box>
      <Box sx={{ px: 1.5, pt: 1, pb: 1, borderTop: `1px solid ${theme.palette.divider}` }}>
        {errorBox}
        <AnswerInput answer={answer} draftKey={`tutor:${session._id}`} sending={sending} placeholder="write your answer…" onSend={async (text, images) => { if (await send("answer", text, undefined, images)) answer.clear(); }} />
        <Actions session={session} sending={sending} send={send} onEnd={onEnd} ending={ending} />
      </Box>
    </Box>
  );
}

// ----------------------------------------------------------- layout: paper

function PaperLayout({ session, sending, send, onEnd, ending, errorBox, sendingPart, done }) {
  const theme = useTheme();
  const answer = useAnswer();
  const [openModel, setOpenModel] = useState({});
  const parts = session.paper?.parts || [];
  const labels = session.language === "Bangla" ? BN_PARTS : EN_PARTS;
  const current = done ? -1 : parts.findIndex((p) => p.got === null);
  const got = parts.reduce((n, p) => n + (p.got || 0), 0);
  const total = parts.reduce((n, p) => n + (p.marks || 0), 0) || 10;
  const rule = `1px solid ${theme.palette.divider}`;
  return (
    <Box sx={{ bgcolor: "background.paper", border: rule, borderRadius: 1, overflow: "hidden", boxShadow: `0 2px 0 ${theme.palette.divider}` }}>
      <Box sx={{ px: 2.5, pt: 2, pb: 1.25, borderBottom: `2px solid ${theme.palette.text.primary}`, textAlign: "center" }}>
        <Typography sx={{ fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase", color: "text.secondary" }}>Practice · creative question</Typography>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontWeight: 600, fontSize: 17, mt: 0.25 }}>{session.lectureTitle}</Typography>
      </Box>
      <Box sx={{ mx: 2, mt: 2, p: 1.5, border: rule, borderRadius: 1, bgcolor: "action.hover" }}>
        <Typography sx={{ fontSize: 10, letterSpacing: ".12em", color: "text.secondary", mb: 0.5 }}>STIMULUS</Typography>
        <Typography component="div" sx={{ fontSize: 14.5, lineHeight: 1.7 }}><Latex>{session.paper?.stimulus || ""}</Latex></Typography>
      </Box>
      <Box sx={{ px: 2, py: 1.5 }}>
        {parts.map((p, i) => {
          const marked = p.got !== null;
          const active = i === current;
          const later = !done && !marked && !active;
          return (
            <Box key={i} sx={{ py: 1.25, borderBottom: i < parts.length - 1 ? rule : 0, opacity: later ? 0.5 : 1 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <Typography sx={{ fontWeight: 700, minWidth: 22, fontSize: 15 }}>{labels[i]}.</Typography>
                <Typography component="div" sx={{ flex: 1, fontSize: 15, lineHeight: 1.6 }}><Latex>{p.question}</Latex></Typography>
                <Typography sx={{ fontSize: 13, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: marked ? (p.got === p.marks ? "success.main" : p.got > 0 ? "warning.main" : "error.main") : "text.secondary", fontWeight: marked ? 600 : 400 }}>
                  {marked ? p.got : "—"}/{p.marks}{marked && p.got === p.marks ? " ✓" : ""}
                </Typography>
              </Box>
              {marked && (
                <Box sx={{ pl: "30px", mt: 0.75 }}>
                  {p.answer && <Typography component="div" sx={{ fontSize: 14, color: "primary.main", fontStyle: "italic", whiteSpace: "pre-wrap" }}><Marked text={p.answer} wrong={p.wrongPart} /></Typography>}
                  <Pictures images={p.images} />
                  {p.feedback && <Typography component="div" sx={{ fontSize: 13.5, color: "error.main", fontStyle: "italic", mt: 0.5 }}><Latex>{p.feedback}</Latex></Typography>}
                  {p.model && (
                    <>
                      <Button size="small" onClick={() => setOpenModel({ ...openModel, [i]: !openModel[i] })} endIcon={<ChevronDown size={14} style={{ transform: openModel[i] ? "rotate(180deg)" : "none" }} />} sx={{ ml: -1, mt: 0.25 }}>Model answer</Button>
                      {openModel[i] && <Typography component="div" sx={{ fontSize: 13.5, color: "text.secondary", whiteSpace: "pre-wrap" }}><Latex>{p.model}</Latex></Typography>}
                    </>
                  )}
                </Box>
              )}
              {active && (
                <Box sx={{ pl: "30px", mt: 1 }}>
                  {errorBox}
                  <AnswerInput
                    answer={answer}
                    draftKey={`tutor:${session._id}:${i}`}
                    rows={3}
                    sending={sending && sendingPart === i}
                    placeholder={`Answer ${labels[i]} here…`}
                    onSend={async (text, images) => { if (await send("answer", text, i, images)) answer.clear(); }}
                  />
                  <Button size="small" startIcon={<SkipForward size={14} />} disabled={sending} onClick={() => send("skip", "", i)} sx={{ mt: 0.25 }}>Skip {labels[i]}</Button>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, borderTop: rule, bgcolor: "action.hover" }}>
        <Typography sx={{ flex: 1, fontSize: 14, fontVariantNumeric: "tabular-nums" }}><b>{got}</b> / {total} {done ? "" : "so far"}</Typography>
        {!done && <Button size="small" color="inherit" startIcon={ending ? <CircularProgress size={12} /> : <X size={14} />} disabled={sending || ending} onClick={onEnd}>Finish</Button>}
      </Box>
    </Box>
  );
}
