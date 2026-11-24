import { useEffect, useRef, useState } from "react";
import BoardPlayer from "../../components/BoardPlayer";
import AskVideo from "../../components/AskVideo";
import ProtectedVideo from "../../components/ProtectedVideo";
import useWatermark from "../../hooks/useWatermark";
import { useGetLectureVideoLessonQuery } from "../../api/contentApi";
import {
  Box, Typography, IconButton, Chip, Skeleton, Link as MuiLink, Paper, Button, Alert,
  Dialog, DialogContent, CircularProgress, LinearProgress,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Paperclip, ExternalLink, Sparkles, X, Download, RefreshCw, CheckCircle2, Trophy, ChevronRight, MessagesSquare, Mic, PenLine } from "lucide-react";
import {
  useGetLectureQuery, useUpdateLectureProgressMutation, useSummarizeLectureMutation,
  useSummarizeLectureAttachmentsMutation, useGetLecturePracticeQuery,
  useGetBatchQuery, useGetDocChatSettingsQuery, useStartPoraMutation, useStartTutorMutation,
} from "../../api/contentApi";
import DocChat from "../../components/chat/DocChat";
import SafeMarkdown from "../../components/SafeMarkdown";
import Latex from "../../components/Latex";
import AiUsageMeter from "../../components/AiUsageMeter";
import LecturePracticeModal from "../practice/LecturePracticeModal";
import { useHomeMx, useBranding } from "../../BrandingContext";
import { SelectionMenu } from "../../components/lectures/LectureHighlights";
import { useAskVideoOn } from "../../components/AskVideo";

const formatBytes = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// PDFs render natively in an iframe in every real browser — no viewer
// library needed. Images are just an <img>. Everything else (.docx,
// .pptx, .xlsx, and anything else a lecture might attach) has no reliable
// in-browser preview without pulling in a third-party rendering service,
// so those still fall back to opening in a new tab exactly as before.
const previewKind = (mimeType) => {
  if (!mimeType) return null;
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  return null;
};

export default function LectureView() {
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const mx = useHomeMx();
  const { data: lecture, isLoading } = useGetLectureQuery({ batchId, id });
  const [updateProgress] = useUpdateLectureProgressMutation();
  const [summarize, { isLoading: summarizing, error: summarizeError }] = useSummarizeLectureMutation();
  const [summarizeAttachments, { isLoading: summarizingAttachments, error: summarizeAttachmentsError }] = useSummarizeLectureAttachmentsMutation();
  const markedComplete = useRef(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // The part of the AI video lesson playing, for "Ask for a short video".
  const [lessonPart, setLessonPart] = useState(null);
  const { data: batch } = useGetBatchQuery(batchId);
  const chatBatchOn = Boolean(batch?.features?.aiAssist && batch?.features?.docChat);
  const { data: chatSettings } = useGetDocChatSettingsQuery(batchId, { skip: !chatBatchOn, refetchOnMountOrArgChange: true });
  const chatOn = chatBatchOn && chatSettings?.enabled && chatSettings?.scope !== "course";
  const { featureNames } = useBranding();
  const poraOn = Boolean(batch?.features?.aiAssist && batch?.features?.poraDhora && batch?.aiPoraDhora);
  const [startPora, { isLoading: poraStarting, error: poraError }] = useStartPoraMutation();
  const tutorOn = Boolean(batch?.features?.aiAssist && batch?.features?.aiTutor && batch?.aiTutor);
  const [startTutor, { isLoading: tutorStarting, error: tutorError }] = useStartTutorMutation();

  // Highlight a passage of the description or notes and hand it to "Ask
  // this lecture" or the short video panel (components/lectures/
  // LectureHighlights.jsx), each with its own switches and limits.
  const videoOn = useAskVideoOn(batchId);
  const descriptionRef = useRef(null);
  const notesRef = useRef(null);
  const [highlightRefs] = useState(() => [descriptionRef, notesRef]);
  const [chatHighlight, setChatHighlight] = useState(null); // { text, at }
  const [videoHighlight, setVideoHighlight] = useState(null);
  const pickHighlight = (mode, text) => {
    const h = { text, at: Date.now() };
    if (mode === "ask") {
      setChatOpen(true);
      setChatHighlight(h);
      setTimeout(() => document.getElementById("lecture-chat")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    } else {
      setVideoHighlight(h);
      setTimeout(() => document.getElementById("lecture-ask-video")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
  };

  // Opened from a course-chat source chip: ?file=<media>&page=<n> opens that
  // attachment at that page.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const fileId = searchParams.get("file");
    if (!fileId || !lecture?.attachments) return;
    const file = lecture.attachments.find((a) => a._id === fileId);
    const kind = file && previewKind(file.mimeType);
    if (kind) setPreviewFile({ ...file, kind, page: Number(searchParams.get("page")) || null });
    setSearchParams({}, { replace: true });
  }, [lecture?.attachments, searchParams, setSearchParams]);

  // A source chip in "Ask this lecture": open that file at that page, or
  // scroll to the notes.
  const openCitation = (c) => {
    if (c.kind === "file") {
      const file = lecture.attachments?.find((a) => a._id === c.media);
      const kind = file && previewKind(file.mimeType);
      if (kind) setPreviewFile({ ...file, kind, page: c.page || null });
      else if (file?.url) window.open(file.url, "_blank", "noreferrer");
    } else {
      document.getElementById("lecture-notes")?.scrollIntoView({ behavior: "smooth" });
    }
  };
  // Skipped until the lecture itself has loaded (no point asking before we
  // even know this lecture exists in this batch), and quietly ignored on
  // error — a batch with features.practice off, or a lecture with nothing
  // assigned yet, just means no card shows, not something to alarm a
  // student with.
  const practiceQuery = useGetLecturePracticeQuery({ batchId, id }, { skip: !lecture });
  const practiceQuestions = practiceQuery.data?.questions || [];

  // getLecture refetches on window focus (see apiSlice.js) so staff edits
  // show up without a manual reload — but a Bunny embed url is signed with
  // a fresh token and expiry every single time it's resolved (see
  // adapters/video/index.js), even for the exact same video. Binding the
  // iframe straight to lecture.video.url would treat that harmless token
  // refresh as a brand new src, remount the player, and restart it from
  // scratch — which is what "the video keeps autoplaying on its own, even
  // just clicking around the page" actually was. Keyed on the Media
  // document's own stable _id instead: the src only ever updates when the
  // video itself changes, never on a token-only refresh of the same one.
  const [videoSrc, setVideoSrc] = useState(null);
  const watermark = useWatermark();
  const { data: lessonData } = useGetLectureVideoLessonQuery(lecture?._id, { skip: !lecture?._id || Boolean(lecture?.video) });
  const videoIdRef = useRef(null);
  useEffect(() => {
    if (!lecture?.video?.url) return;
    if (videoIdRef.current !== lecture.video._id) {
      videoIdRef.current = lecture.video._id;
      setVideoSrc(lecture.video.url);
    }
  }, [lecture?.video?._id, lecture?.video?.url]);

  // A lecture opened is a lecture in progress — marked complete once the
  // student has spent real, honest time on it, not the instant it loads,
  // and not time spent with the tab in the background either. Previously
  // this was a flat 15 seconds regardless of anything: a two-hour lecture
  // and a two-minute one were marked "watched" identically, and switching
  // tabs and walking away still counted the whole time it was open.
  //
  // The threshold is built from whatever the lecture actually contains,
  // added together rather than picking just one signal — a lecture with
  // both a video and substantial notes asks for time on each, the way a
  // student would actually spend it (watch, then scroll down and read),
  // not just whichever one happens to be shorter.
  //
  // Video: 75% of its own runtime when known (durationSeconds is
  // populated at link time for Bunny videos — see adapters/video/index.js
  // — but stays null for YouTube/Vimeo/plain links, which have no
  // duration API this project asks for credentials to call). 75%, not
  // 100% — a student who's clearly been through nearly the whole thing
  // shouldn't be blocked by the last few seconds of silence or credits.
  //
  // Notes: word count / 200wpm, the same rough "N min read" heuristic
  // used everywhere — an estimate, not a measurement, and it's fine that
  // it is.
  //
  // Attachments: no text is ever pulled from one just to time a page
  // view — that would mean extracting (or fetching a cached extraction
  // for) every attachment on every single lecture open, adding real
  // latency to a page that currently loads instantly. A flat 90s
  // per-file allowance stands in instead: enough to open and skim one
  // document, not a measurement of what's actually in it.
  //
  // If none of the three apply, or the total comes out to nothing
  // meaningful, a flat 60s floor is the fallback — better than the old
  // 15s, and there's genuinely no better signal available at that point.
  // Exposed as state (not just closure variables) so the meter below can
  // show live progress — watchProgress stays null while there's nothing
  // meaningful to show (already watched, or not loaded yet).
  const [watchProgress, setWatchProgress] = useState(null); // { accumulated, threshold } | null

  useEffect(() => {
    // Already watched from a prior visit — no timer, no meter, nothing to
    // accumulate again. Without this check, reopening an already-complete
    // lecture would silently restart the whole threshold from zero and
    // re-fire updateProgress once it re-accumulated enough time, which is
    // harmless to the record itself (marking complete twice is a no-op)
    // but pointless work, and would show a confusing "in progress" meter
    // on something the student already finished.
    if (!lecture || lecture.progress?.watched || markedComplete.current) return;

    const durationSeconds = lecture.video?.durationSeconds;
    const videoThreshold = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.min(Math.max(durationSeconds * 0.75, 30), 1200)
      : 0;

    const wordCount = lecture.bodyMarkdown
      ? lecture.bodyMarkdown.trim().split(/\s+/).filter(Boolean).length
      : 0;
    const readingSeconds = wordCount > 0 ? Math.min((wordCount / 200) * 60, 600) : 0;

    const attachmentSeconds = Math.min((lecture.attachments?.length || 0) * 90, 600);

    const combined = videoThreshold + readingSeconds + attachmentSeconds;
    const threshold = combined > 0 ? Math.min(Math.max(combined, 30), 1500) : 60;

    let accumulated = 0;
    let lastTick = Date.now();
    let intervalId = null;

    setWatchProgress({ accumulated: 0, threshold });

    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === "visible") {
        accumulated += (now - lastTick) / 1000;
      }
      lastTick = now;

      if (accumulated >= threshold) {
        markedComplete.current = true;
        updateProgress({ batchId, id, completed: true });
        setWatchProgress(null);
        clearInterval(intervalId);
      } else {
        setWatchProgress({ accumulated, threshold });
      }
    };

    intervalId = setInterval(tick, 1000);
    // Also resets the clock on a visibility flip so a long background
    // stretch between two visible spells doesn't get silently counted
    // between ticks — belt and suspenders alongside the visible-state
    // check inside tick() itself.
    const onVisibilityChange = () => { lastTick = Date.now(); };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [lecture, batchId, id, updateProgress]);

  if (isLoading || !lecture) {
    return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={240} /></Box>;
  }

  return (
    <Box sx={{ pb: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, p: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}/lectures`)}>
          <ArrowLeft size={18} />
        </IconButton>
        <Typography variant="body2" color="text.secondary" noWrap>
          {[lecture.chapter?.title, lecture.topic?.title].filter(Boolean).join(" · ")}
        </Typography>
      </Box>

      {/* No video, but a published AI video lesson: play that instead. */}
      {!lecture.video && lessonData?.lesson && (
        <Box sx={{ mx: { xs: 0, md: 2 } }}>
          <BoardPlayer lesson={lessonData.lesson} watermark={watermark}
            onPosition={(p) => { if (p.playing || p.item) setLessonPart((x) => (x === p.segment ? x : p.segment)); }} />
        </Box>
      )}

      {/* A protected video still being prepared after upload. */}
      {!videoSrc && lecture.video?.protection && lecture.video.protection.status !== "ready" && (
        <Box sx={{ mx: { xs: 2, md: 2 }, p: 3, borderRadius: 2, bgcolor: "action.hover", textAlign: "center" }}>
          <Typography variant="body2" color="text.secondary">This video is being prepared. Check back soon.</Typography>
        </Box>
      )}

      {videoSrc ? (
        <Box sx={{ position: "relative", pt: "56.25%", bgcolor: "#000", mx: { xs: 0, md: 2 }, borderRadius: { md: 2 }, overflow: "hidden" }}>
          {/* A video file in storage (a live recording, an exported video
              lesson) plays in the browser's own player; hosted ones embed. */}
          <ProtectedVideo src={videoSrc} file={lecture.video?.file} title={lecture.title} />
        </Box>
      ) : null}

      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 800, mx }}>
        {/* Watched is the steady state most lectures end up in, so it rides
            on the title line instead of claiming a whole block below it —
            only a lecture still being timed (watchProgress) needs its own
            row, for the progress bar. */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: lecture.description ? 1 : 2.5, flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ fontWeight: 500 }}>{lecture.title}</Typography>
          {lecture.progress?.watched && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "success.main" }}>
              <CheckCircle2 size={15} />
              <Typography variant="caption" sx={{ fontWeight: 500, color: "success.main" }}>Watched</Typography>
            </Box>
          )}
        </Box>
        <Box id="lecture-ask-video">
          <AskVideo batchId={batchId} lecture={lecture._id} segment={lessonData?.lesson && !lecture.video ? lessonPart : null} highlight={videoHighlight} sx={{ mb: 2 }} />
        </Box>
        {lecture.description && (
          <Typography ref={descriptionRef} variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>{lecture.description}</Typography>
        )}

        {watchProgress && !lecture.progress?.watched && (
          <Box sx={{ mb: 2.5 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">Marks as watched automatically</Typography>
              <Typography variant="caption" color="text.secondary">
                {Math.max(0, Math.ceil(watchProgress.threshold - watchProgress.accumulated))}s left
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (watchProgress.accumulated / watchProgress.threshold) * 100)}
              sx={{ height: 5, borderRadius: 3 }}
            />
          </Box>
        )}

        {(lecture.bodyMarkdown || lecture.attachments?.length > 0) && <AiUsageMeter batchId={batchId} compact />}

        {lecture.bodyMarkdown && (
          <Box sx={{ mb: 2.5 }}>
            {lecture.aiSummary?.length > 0 ? (
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, bgcolor: "ai.bg", borderColor: "ai.main" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                  <Sparkles size={16} color={theme.palette.ai.main} />
                  <Typography sx={{ fontWeight: 500, color: "ai.main", fontSize: 14, flex: 1 }}>Key points</Typography>
                  <IconButton
                    size="small"
                    disabled={summarizing}
                    onClick={() => summarize({ batchId, id, regenerate: true })}
                    title="Regenerate"
                  >
                    {summarizing ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
                  </IconButton>
                </Box>
                {summarizeError && (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>{summarizeError.data?.message || "Could not regenerate this right now."}</Alert>
                )}
                <Box component="ul" sx={{ m: 0, pl: 2.5, display: "flex", flexDirection: "column", gap: 0.75 }}>
                  {lecture.aiSummary.map((point, i) => (
                    <Typography key={i} component="li" variant="body2">
                      <Latex as="span">{point}</Latex>
                    </Typography>
                  ))}
                </Box>
              </Paper>
            ) : (
              <Box>
                {summarizeError && (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>{summarizeError.data?.message || "Could not summarise this right now."}</Alert>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={summarizing ? undefined : <Sparkles size={15} />}
                  disabled={summarizing}
                  onClick={() => summarize({ batchId, id })}
                >
                  {summarizing ? "Summarising…" : "Summarize with AI"}
                </Button>
              </Box>
            )}
          </Box>
        )}

        {practiceQuestions.length > 0 && (
          <Paper
            variant="outlined"
            onClick={() => setPracticeOpen(true)}
            sx={{
              p: 2, borderRadius: 3, mb: 2.5, display: "flex", alignItems: "center", gap: 1.5,
              cursor: "pointer", borderColor: "primary.main",
            }}
          >
            <Box sx={{ width: 36, height: 36, borderRadius: "50%", bgcolor: "primary.main", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Trophy size={17} color={theme.palette.primary.contrastText} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 500, fontSize: 14.5 }}>Ace this lecture</Typography>
              <Typography variant="caption" color="text.secondary">
                {practiceQuestions.length} question{practiceQuestions.length === 1 ? "" : "s"} — check what you remember
              </Typography>
            </Box>
            <ChevronRight size={18} color={theme.palette.text.secondary} />
          </Paper>
        )}

        {lecture.bodyMarkdown && (
          <Box id="lecture-notes" ref={notesRef} sx={{
            mb: 2.5,
            "& h2": { fontSize: 17, fontWeight: 500, mt: 3, mb: 1 },
            "& h3": { fontSize: 15, fontWeight: 500, mt: 2, mb: 1 },
            "& h4, & h5": { fontSize: 14, fontWeight: 500, mt: 2, mb: 1 },
            "& p": { fontSize: 14, lineHeight: 1.7, mb: 1.5 },
            "& code": { bgcolor: "action.hover", px: 0.5, borderRadius: 0.5, fontSize: 13 },
            "& pre": { bgcolor: "action.hover", p: 1.5, borderRadius: 1, overflowX: "auto", mb: 1.5 },
            "& pre code": { bgcolor: "transparent", p: 0 },
            "& a": { color: "primary.main" },
            "& ul, & ol": { fontSize: 14, lineHeight: 1.7, pl: 3, mb: 1.5 },
            "& li": { mb: 0.5 },
            "& li label": { display: "inline-flex", alignItems: "center", gap: 0.5 },
            "& blockquote": {
              m: 0, mb: 1.5, pl: 2, py: 0.5,
              borderLeft: "3px solid", borderColor: "divider",
              color: "text.secondary",
            },
            "& img": { maxWidth: "100%", borderRadius: 1 },
            "& hr": { border: "none", borderTop: "1px solid", borderColor: "divider", my: 2.5 },
            "& del": { opacity: 0.6 },
            "& table": { width: "100%", borderCollapse: "collapse", fontSize: 13, mb: 1.5 },
            "& th, & td": { border: "1px solid", borderColor: "divider", px: 1, py: 0.5, textAlign: "left" },
            "& th": { bgcolor: "action.hover" },
          }}>
            <SafeMarkdown>{lecture.bodyMarkdown}</SafeMarkdown>
          </Box>
        )}

        <SelectionMenu containers={highlightRefs} ask={chatOn && Boolean(lecture.bodyMarkdown || lecture.attachments?.length)} video={videoOn} onPick={pickHighlight} />

        {poraOn && (lecture.bodyMarkdown || lecture.attachments?.length > 0) && (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2.5, display: "flex", alignItems: "center", gap: 1 }}>
            <Mic size={16} color={theme.palette.ai.main} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{featureNames?.poraDhora || "Oral Quiz"}</Typography>
              <Typography variant="caption" color="text.secondary">Read it? Let the teacher ask you.</Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              disabled={poraStarting}
              onClick={async () => {
                const r = await startPora({ batchId, lectureId: id });
                if (r.data?.session) navigate(`/batches/${batchId}/pora/${r.data.session._id}`);
              }}
            >
              {poraStarting ? "Starting…" : "Start"}
            </Button>
          </Paper>
        )}
        {poraError && <Typography variant="caption" color="error" sx={{ display: "block", mt: -1.5, mb: 2 }}>{poraError.data?.message || "Couldn't start."}</Typography>}

        {tutorOn && (lecture.bodyMarkdown || lecture.attachments?.length > 0) && (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2.5, display: "flex", alignItems: "center", gap: 1 }}>
            <PenLine size={16} color={theme.palette.ai.main} />
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 500, fontSize: 14 }}>{featureNames?.aiTutor || "AI Tutoring"}</Typography>
              <Typography variant="caption" color="text.secondary">Check what you understood, with marks.</Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              disabled={tutorStarting}
              onClick={async () => {
                const r = await startTutor({ batchId, lectureId: id });
                if (r.data?.session) navigate(`/batches/${batchId}/tutoring/${r.data.session._id}`);
              }}
            >
              {tutorStarting ? "Starting…" : "Start"}
            </Button>
          </Paper>
        )}
        {tutorError && <Typography variant="caption" color="error" sx={{ display: "block", mt: -1.5, mb: 2 }}>{tutorError.data?.message || "Couldn't start."}</Typography>}

        {chatOn && (lecture.bodyMarkdown || lecture.attachments?.length > 0) && (
          <Paper id="lecture-chat" variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2.5, borderColor: "ai.main" }}>
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer" }}
              onClick={() => { setChatOpen((open) => !open); setChatHighlight(null); }}
            >
              <MessagesSquare size={16} color={theme.palette.ai.main} />
              <Typography sx={{ fontWeight: 500, color: "ai.main", fontSize: 14, flex: 1 }}>Ask this lecture</Typography>
              <Typography variant="caption" color="text.secondary">{chatOpen ? "Hide" : "Answers from these notes and files"}</Typography>
            </Box>
            {chatOpen && (
              <Box sx={{ mt: 1.5 }}>
                <DocChat
                  batchId={batchId}
                  lectureId={id}
                  onCitation={openCitation}
                  highlight={chatHighlight}
                  doubtsOn={Boolean(batch?.features?.doubtSolving)}
                  height="min(440px, calc(100dvh - 240px))"
                  compact
                />
              </Box>
            )}
          </Paper>
        )}


        {lecture.attachments?.length > 0 && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>Attachments</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {lecture.attachments.map((file) => {
                const kind = previewKind(file.mimeType);
                const commonProps = {
                  key: file._id,
                  variant: "outlined",
                  sx: { p: 1.5, borderRadius: 2, display: "flex", alignItems: "center", gap: 1.5, textDecoration: "none", color: "text.primary", cursor: "pointer" },
                };
                return kind ? (
                  <Paper {...commonProps} onClick={() => setPreviewFile({ ...file, kind })}>
                    <Paperclip size={15} />
                    <Typography variant="body2" noWrap sx={{ flex: 1 }}>{file.title}</Typography>
                    {file.sizeBytes != null && (
                      <Typography variant="caption" color="text.secondary">{formatBytes(file.sizeBytes)}</Typography>
                    )}
                  </Paper>
                ) : (
                  <Paper {...commonProps} component="a" href={file.url} target="_blank" rel="noreferrer">
                    <Paperclip size={15} />
                    <Typography variant="body2" noWrap sx={{ flex: 1 }}>{file.title}</Typography>
                    {file.sizeBytes != null && (
                      <Typography variant="caption" color="text.secondary">{formatBytes(file.sizeBytes)}</Typography>
                    )}
                    <ExternalLink size={14} />
                  </Paper>
                );
              })}
            </Box>
          </>
        )}

        {/* Prose recap — a different job from the bullet points above (see
            ai/prompts/index.js's summarizeLectureAttachments), not the
            same content twice, so it gets its own panel and its own
            button rather than a toggle on the one above. Sits below the
            attachments themselves — it's a summary OF them, read after
            seeing what's actually there, not before. */}
        {lecture.attachments?.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            {lecture.aiAttachmentSummary ? (
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, bgcolor: "ai.bg", borderColor: "ai.main" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                  <Sparkles size={16} color={theme.palette.ai.main} />
                  <Typography sx={{ fontWeight: 500, color: "ai.main", fontSize: 14, flex: 1 }}>Attachment summary</Typography>
                  <IconButton
                    size="small"
                    disabled={summarizingAttachments}
                    onClick={() => summarizeAttachments({ batchId, id, regenerate: true })}
                    title="Regenerate"
                  >
                    {summarizingAttachments ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
                  </IconButton>
                </Box>
                {summarizeAttachmentsError && (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>{summarizeAttachmentsError.data?.message || "Could not regenerate this right now."}</Alert>
                )}
                <Typography variant="body2" sx={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>
                  <Latex as="span">{lecture.aiAttachmentSummary}</Latex>
                </Typography>
              </Paper>
            ) : (
              <Box>
                {summarizeAttachmentsError && (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>{summarizeAttachmentsError.data?.message || "Could not summarise this right now."}</Alert>
                )}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={summarizingAttachments ? undefined : <Sparkles size={15} />}
                  disabled={summarizingAttachments}
                  onClick={() => summarizeAttachments({ batchId, id })}
                >
                  {summarizingAttachments ? "Summarising…" : "Summarize attachments"}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Dialog open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} maxWidth="md" fullWidth>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 500 }}>{previewFile?.title}</Typography>
          <IconButton size="small" component="a" href={previewFile?.url} target="_blank" rel="noreferrer" download>
            <Download size={17} />
          </IconButton>
          <IconButton size="small" onClick={() => setPreviewFile(null)}>
            <X size={18} />
          </IconButton>
        </Box>
        <DialogContent sx={{ p: 0, bgcolor: previewFile?.kind === "pdf" ? "#525659" : "background.paper" }}>
          {previewFile?.kind === "pdf" && (
            <Box component="iframe" src={previewFile.page ? `${previewFile.url}#page=${previewFile.page}` : previewFile.url} sx={{ width: "100%", height: "75vh", border: "none", display: "block" }} />
          )}
          {previewFile?.kind === "image" && (
            <Box
              component="img"
              src={previewFile.url}
              alt={previewFile.title}
              sx={{ width: "100%", maxHeight: "75vh", objectFit: "contain", display: "block" }}
            />
          )}
        </DialogContent>
      </Dialog>

      <LecturePracticeModal
        open={practiceOpen}
        onClose={() => setPracticeOpen(false)}
        loading={practiceQuery.isLoading}
        error={practiceQuery.error}
        questions={practiceQuestions}
      />
    </Box>
  );
}
