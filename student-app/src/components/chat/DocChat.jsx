import { useEffect, useRef, useState } from "react";
import { Box, Typography, TextField, IconButton, Chip, Paper, Alert, CircularProgress, Button } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { Send, FileText, BookOpen, Globe, HelpCircle, Sparkles, ImagePlus, X } from "lucide-react";
import { useAskDocChatMutation, useGetDocChatThreadQuery, useGetDocChatSettingsQuery, useUnlockDocChatMutation, useUploadDocChatImageMutation } from "../../api/contentApi";
import SafeMarkdown from "../SafeMarkdown";
import { animate, slideUp, typingDot, REDUCED } from "../../motion";
import { useSales } from "../../BrandingContext";

// Three bouncing dots while the answer is being written.
function Typing() {
  return (
    <Box sx={{ display: "inline-flex", gap: 0.5, alignItems: "center", px: 1.25, py: 1, borderRadius: 3, bgcolor: "action.hover" }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 6, height: 6, borderRadius: "50%", bgcolor: "text.secondary",
            animation: `${typingDot} 1.1s ease-in-out ${i * 0.15}s infinite`,
            [REDUCED]: { animation: "none", opacity: 0.6 },
          }}
        />
      ))}
    </Box>
  );
}

// One conversation with the course documents — used by the lecture page's
// "Ask this lecture" panel (lectureId set) and the batch's "Ask your
// course" page. Answers from the documents carry their sources as chips;
// an answer that isn't from them says so, in its own style, so a student
// never mistakes a general answer for what the course teaches.

const citationLabel = (c, showLecture) => {
  const where = c.kind === "notes"
    ? `Notes${c.title && c.title !== "Notes" ? ` · ${c.title}` : ""}`
    : `${c.title || "File"}${c.page ? ` · p.${c.page}` : ""}`;
  return showLecture && c.lectureTitle ? `${c.lectureTitle} — ${where}` : where;
};

function Message({ message, question, showLecture, onCitation, batchId, doubtsOn, fresh = false }) {
  const theme = useTheme();
  const navigate = useNavigate();

  if (message.role === "student") {
    return (
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.5, ...(fresh ? animate(slideUp, 260) : {}) }}>
        <Paper sx={{ px: 1.75, py: 1.1, borderRadius: 3, borderBottomRightRadius: 6, bgcolor: "primary.main", color: "primary.contrastText", maxWidth: "85%" }}>
          {message.image && (
            <Box component="img" src={message.image} alt="" sx={{ display: "block", maxWidth: "100%", maxHeight: 220, borderRadius: 2, mb: 0.75 }} />
          )}
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{message.text}</Typography>
        </Paper>
      </Box>
    );
  }

  const general = !message.foundInDocuments && message.generalAnswer;
  const notCovered = !message.foundInDocuments && !message.generalAnswer;
  return (
    <Box sx={{ mb: 2, maxWidth: "92%", ...(fresh ? animate(slideUp, 320) : {}) }}>
      <Paper
        variant="outlined"
        sx={{
          px: 1.75, py: 1.25, borderRadius: 3, borderBottomLeftRadius: 6,
          ...(general ? { borderStyle: "dashed", bgcolor: "action.hover" } : {}),
        }}
      >
        {general && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75, color: "warning.main" }}>
            <Globe size={14} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Not found in your course documents — general answer
            </Typography>
          </Box>
        )}
        {/* Answers are AI-written Markdown (bold, lists) with maths, so they
            go through the same renderer as lecture text, not plain Latex. */}
        <Typography variant="body2" component="div" sx={{ lineHeight: 1.65, "& > :first-child": { mt: 0 }, "& > :last-child": { mb: 0 }, "& p, & ul, & ol": { my: 0.75 } }}>
          <SafeMarkdown>{message.text}</SafeMarkdown>
        </Typography>

        {message.citations?.length > 0 && (
          <Box sx={{ mt: 1.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>From your course</Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {message.citations.map((c, i) => (
                <Chip
                  key={i}
                  size="small"
                  variant="outlined"
                  icon={c.kind === "notes" ? <BookOpen size={13} /> : <FileText size={13} />}
                  label={citationLabel(c, showLecture)}
                  title={c.quote}
                  onClick={() => onCitation?.(c)}
                  sx={{
                    maxWidth: "100%", borderColor: theme.palette.ai?.main,
                    transition: "transform 120ms, background-color 120ms",
                    "&:active": { transform: "scale(0.94)", bgcolor: "action.selected" },
                  }}
                />
              ))}
            </Box>
          </Box>
        )}
      </Paper>
      {(notCovered || general) && doubtsOn && (
        <Button
          size="small"
          startIcon={<HelpCircle size={14} />}
          sx={{ mt: 0.5 }}
          onClick={() => navigate(`/batches/${batchId}/doubts/new?mode=human&question=${encodeURIComponent(question || "")}`)}
        >
          Ask a teacher
        </Button>
      )}
    </Box>
  );
}

// highlight: { text, at } — a passage the student highlighted on the
// lecture page, sent along with their next question.
export default function DocChat({ batchId, lectureId = null, threadId: initialThreadId = null, onThread, onCitation, doubtsOn = false, placeholder, height = 420, compact = false, highlight = null }) {
  const sales = useSales();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [draft, setDraft] = useState("");
  const [quote, setQuote] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => {
    if (!highlight?.text) return;
    setQuote(highlight.text);
    inputRef.current?.focus();
  }, [highlight]);
  const [photo, setPhoto] = useState(null); // { url } once uploaded
  const [uploadImage, { isLoading: uploading, error: uploadError, reset: resetUpload }] = useUploadDocChatImageMutation();
  const fileRef = useRef(null);
  const [pending, setPending] = useState(null); // the question being answered
  // The last answer, shown until the refetched thread includes it.
  const [lastExchange, setLastExchange] = useState(null);
  const navigate = useNavigate();
  const [ask, { isLoading, error, reset }] = useAskDocChatMutation();
  const { data: allowance } = useGetDocChatSettingsQuery(batchId);
  const [unlock, { isLoading: unlocking, error: unlockError, data: unlocked, reset: resetUnlock }] = useUnlockDocChatMutation();
  // The pack on sale: from a refused question, or up front once today's
  // questions are used up, so the student can top up before asking.
  const available = allowance?.availableToday ?? null;
  const offer = error?.data?.offer || (available === 0 ? allowance?.offer : null) || null;
  const credits = allowance?.credits || null;
  const creditTotal = credits ? credits.batch + credits.general : null;
  // Batch credits first, the rest from general.
  const canAfford = !offer || !credits || creditTotal >= offer.packCost;
  const { data: thread, isFetching } = useGetDocChatThreadQuery({ batchId, id: threadId }, { skip: !threadId });
  const scrollRef = useRef(null);

  // A different conversation picked outside (the course chat's list, or
  // New chat). Only a change of the prop counts — not the parent echoing
  // back the thread this component just started, and not a re-run for any
  // other reason (the mutation's reset changes identity after every send,
  // which used to start a new conversation each time on the lecture page).
  const threadRef = useRef(threadId);
  const propRef = useRef(initialThreadId);
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    if (initialThreadId === propRef.current) return;
    propRef.current = initialThreadId;
    if (initialThreadId === threadRef.current) return;
    threadRef.current = initialThreadId;
    setThreadId(initialThreadId);
    setLastExchange(null);
    resetRef.current();
  }, [initialThreadId]);

  const saved = threadId ? thread?.messages || [] : [];
  const messages = lastExchange && !saved.some((m) => m._id === lastExchange[1]._id) ? [...saved, ...lastExchange] : saved;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending]);

  const pickPhoto = async (file) => {
    if (!file) return;
    resetUpload();
    try {
      const result = await uploadImage({ batchId, file }).unwrap();
      setPhoto({ url: result.url });
    } catch {
      // shown below
    }
  };

  const send = async () => {
    const typed = draft.trim();
    if ((!typed && !photo && !quote) || isLoading || uploading) return;
    const message = quote ? `About this part of the lecture: "${quote}"\n\n${typed || "Explain this."}` : typed;
    const sentQuote = quote;
    const image = photo?.url;
    setPending({ text: message || "Explain this.", image });
    setDraft("");
    setQuote(null);
    setPhoto(null);
    try {
      const result = await ask({ batchId, threadId, lectureId: threadId ? undefined : lectureId, message, image }).unwrap();
      setLastExchange([{ role: "student", text: message || "Explain this.", image, _id: `local-${Date.now()}` }, result.message]);
      if (!threadId) {
        threadRef.current = result.threadId;
        setThreadId(result.threadId);
        onThread?.(result.threadId);
      }
    } catch {
      setDraft(typed);
      setQuote(sentQuote);
      if (image) setPhoto({ url: image });
    } finally {
      setPending(null);
    }
  };

  const topUpButton = offer && !canAfford ? (!sales ? null : 
    <Button size="small" color="inherit" onClick={() => navigate(`/batches/${batchId}/ai-credits`)}>Buy credits</Button>
  ) : offer ? (
    <Button
      size="small"
      color="inherit"
      disabled={unlocking}
      onClick={async () => {
        try {
          await unlock(batchId).unwrap();
          reset();
        } catch {
          // shown below
        }
      }}
    >
      {unlocking ? "Unlocking…" : `Unlock ${offer.packSize} · ${offer.packCost} credit${offer.packCost === 1 ? "" : "s"}`}
    </Button>
  ) : null;
  const creditLine = offer && credits ? (
    <Typography variant="caption" sx={{ display: "block", mt: 0.5, fontWeight: 600 }}>
      {`You have ${creditTotal} credit${creditTotal === 1 ? "" : "s"}: ${credits.batch} batch · ${credits.general} general`}
      {!canAfford && ` — not enough for ${offer.packCost}.`}
    </Typography>
  ) : null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height, minHeight: 280 }}>
      <Box ref={scrollRef} sx={{ flex: 1, overflowY: "auto", px: compact ? 0.5 : 1, py: 1 }}>
        {messages.length === 0 && !pending && !isFetching && (
          <Box sx={{ textAlign: "center", color: "text.secondary", py: 4, px: 2 }}>
            <Sparkles size={22} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              {lectureId
                ? "Ask anything about this lecture's notes and files. Answers show which page they come from."
                : "Ask anything about your course. Answers come from your lecture notes and files, with the page they come from."}
            </Typography>
          </Box>
        )}
        {isFetching && messages.length === 0 && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={20} /></Box>
        )}
        {messages.map((m, i) => (
          <Message
            key={m._id || i}
            message={m}
            question={m.role === "assistant" ? messages[i - 1]?.text : undefined}
            showLecture={!lectureId}
            onCitation={onCitation}
            batchId={batchId}
            doubtsOn={doubtsOn}
            fresh={i >= saved.length || Boolean(lastExchange && m._id === lastExchange[1]?._id)}
          />
        ))}
        {pending && (
          <>
            <Message message={{ role: "student", ...pending }} fresh />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary", mb: 2, ...animate(slideUp, 260) }}>
              <Typing />
              <Typography variant="caption">Looking through your course…</Typography>
            </Box>
          </>
        )}
      </Box>

      {!error && offer && !unlocked && (
        <Alert severity="info" sx={{ mb: 1 }} action={topUpButton}>
          {`You've used today's questions. Unlock ${offer.packSize} more for ${offer.packCost} AI credit${offer.packCost === 1 ? "" : "s"}.`}
          {creditLine}
        </Alert>
      )}
      {error && (
        <Alert
          severity={error.status === 429 ? "info" : "warning"}
          sx={{ mb: 1 }}
          onClose={reset}
          action={offer ? topUpButton : undefined}
        >
          {error.data?.message || "Could not answer right now. Try again in a moment."}
          {offer && creditLine}
        </Alert>
      )}
      {unlockError && (
        <Alert
          severity="warning"
          sx={{ mb: 1 }}
          onClose={resetUnlock}
          action={sales && unlockError.data?.needCredits ? (
            <Button size="small" color="inherit" onClick={() => navigate(`/batches/${batchId}/ai-credits`)}>Buy credits</Button>
          ) : undefined}
        >
          {unlockError.data?.message || "Could not unlock more questions right now."}
        </Alert>
      )}
      {unlocked && !error && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={resetUnlock}>{unlocked.message}{credits ? ` Credits left: ${creditTotal}.` : ""}</Alert>
      )}
      {available !== null && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
          {`${available} question${available === 1 ? "" : "s"} available today`}
        </Typography>
      )}

      {uploadError && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={resetUpload}>{uploadError.data?.message || "Could not upload that photo."}</Alert>
      )}
      {(photo || uploading) && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
          <Box sx={{ position: "relative", width: 56, height: 56, borderRadius: 2, overflow: "hidden", border: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {photo ? <Box component="img" src={photo.url} alt="" sx={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <CircularProgress size={18} />}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {uploading ? "Uploading…" : "A question with a photo counts as 2."}
          </Typography>
          {photo && (
            <IconButton size="small" onClick={() => setPhoto(null)} aria-label="Remove photo"><X size={15} /></IconButton>
          )}
        </Box>
      )}
      {quote && (
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mb: 0.75 }}>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1, borderLeft: "3px solid", borderColor: "ai.main", maxHeight: 64, overflowY: "auto" }}>
            {quote}
          </Typography>
          <IconButton size="small" onClick={() => setQuote(null)} aria-label="Remove highlighted text"><X size={15} /></IconButton>
        </Box>
      )}
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
        <IconButton onClick={() => fileRef.current?.click()} disabled={uploading || isLoading} aria-label="Add a photo">
          <ImagePlus size={18} />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp,image/heic"
          onChange={(e) => {
            pickPhoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <TextField
          fullWidth
          multiline
          maxRows={5}
          size="small"
          value={draft}
          inputRef={inputRef}
          placeholder={photo || quote ? "What do you want to know about it? (optional)" : placeholder || (lectureId ? "Ask about this lecture…" : "Ask about your course…")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          inputProps={{ maxLength: quote ? Math.max(100, 1900 - quote.length) : 2000 }}
        />
        <IconButton color="primary" onClick={send} disabled={(!draft.trim() && !photo && !quote) || isLoading || uploading} aria-label="Send">
          {isLoading ? <CircularProgress size={18} /> : <Send size={18} />}
        </IconButton>
      </Box>
    </Box>
  );
}
