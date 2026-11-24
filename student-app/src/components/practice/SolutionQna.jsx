import { useState } from "react";
import { Box, Button, Chip, CircularProgress, MenuItem, TextField, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import { useGetPracticeQnaQuery, useAskPracticeQnaMutation } from "../../api/contentApi";
import Latex from "../Latex";
import AiErrorAlert from "./AiErrorAlert";

// Questions about an answered practice question's solution ("I don't get
// line 4"), answered by AI from that solution only (backend
// utils/practiceQna.js). Closed until asked for, so nothing loads otherwise.
const QUICK = ["Explain this step in more detail", "Where did this number come from?", "Why is this formula used here?"];

// The solution's lines, numbered from 1: the same split as the backend
// (utils/practiceQna.js solutionLines), so "line 4" means the same to both.
export const solutionLines = (text) => {
  const raw = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let block = null;
  for (const l of raw) {
    if (block !== null) {
      block.push(l);
      if (l.endsWith("$$")) { out.push(block.join(" ")); block = null; }
      continue;
    }
    if (l === "$$" || (l.startsWith("$$") && !l.slice(2).includes("$$"))) { block = [l]; continue; }
    out.push(l);
  }
  if (block) out.push(block.join(" "));
  return out;
};

// The worked solution shown a line at a time with its number, so a student
// can say which line they mean.
export function NumberedSolution({ text }) {
  const lines = solutionLines(text);
  return (
    <Box component="ol" sx={{ m: 0, p: 0, listStyle: "none" }}>
      {lines.map((l, i) => (
        <Box component="li" key={i} sx={{ display: "flex", gap: 1, alignItems: "baseline", py: 0.25 }}>
          <Typography component="span" variant="caption" color="text.secondary" sx={{ minWidth: 18, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i + 1}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}><Latex as="div" style={{ fontSize: 13.5 }}>{l}</Latex></Box>
        </Box>
      ))}
    </Box>
  );
}

// A line of the solution as a one-row picker label, maths rendered inline
// ($$...$$ shown as $...$ so it stays on the row).
const LineLabel = ({ n, line }) => (
  <Box component="span" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
    Line {n}: <Latex>{String(line).replace(/\$\$/g, "$")}</Latex>
  </Box>
);

export default function SolutionQna({ batchId, questionId, navigate, sx }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [line, setLine] = useState("");
  const [error, setError] = useState(null);
  const { data, isLoading, error: loadError } = useGetPracticeQnaQuery({ batchId, questionId }, { skip: !open });
  const [ask, { isLoading: asking }] = useAskPracticeQnaMutation();

  if (!open) {
    return (
      <Box sx={sx}>
        <Button size="small" variant="outlined" startIcon={<MessageCircleQuestion size={14} />} onClick={() => setOpen(true)}
          sx={{ borderRadius: 5, textTransform: "none", fontSize: 12.5, py: 0.4, px: 1.4, borderColor: "ai.main", color: "ai.main", "&:hover": { borderColor: "ai.main", bgcolor: "ai.bg" } }}>
          Ask about this solution
        </Button>
      </Box>
    );
  }

  const send = async (text) => {
    const body = String(text ?? message).trim();
    if (!body) return;
    setError(null);
    try {
      await ask({ batchId, questionId, message: body, line: line === "" ? undefined : Number(line) }).unwrap();
      setMessage("");
    } catch (e) {
      setError({ message: e.data?.message || "Couldn't get an answer right now.", capReached: e.status === 429 });
    }
  };

  const lines = data?.lines || [];
  const left = data?.remaining ?? 0;
  const done = data && left === 0;

  return (
    <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, bgcolor: "ai.bg", ...sx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
        <Sparkles size={13} color={theme.palette.ai.main} />
        <Typography variant="caption" sx={{ color: "ai.main", fontWeight: 500, flex: 1 }}>Ask about this solution</Typography>
        {data && <Typography variant="caption" color="text.secondary">{left} of {data.limit} left</Typography>}
      </Box>

      {isLoading && <CircularProgress size={16} />}
      {loadError && <AiErrorAlert error={{ message: loadError.data?.message || "Couldn't load this right now." }} />}

      {(data?.messages || []).map((m, i) => (
        <Box key={i} sx={{ mb: 1, display: "flex", justifyContent: m.role === "student" ? "flex-end" : "flex-start" }}>
          <Box sx={{
            maxWidth: "88%", px: 1.25, py: 0.75, borderRadius: 2, fontSize: 13.5,
            bgcolor: m.role === "student" ? "primary.main" : "background.paper",
            color: m.role === "student" ? "primary.contrastText" : "text.primary",
            opacity: m.refused ? 0.8 : 1,
          }}>
            {m.role === "student" && m.line ? <Typography variant="caption" sx={{ display: "block", opacity: 0.85 }}>Line {m.line}</Typography> : null}
            {m.role === "ai" ? <Latex as="div" style={{ fontSize: 13.5 }}>{m.text}</Latex> : m.text}
          </Box>
        </Box>
      ))}

      {asking && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary", mb: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="caption">Working through it…</Typography>
        </Box>
      )}
      <AiErrorAlert error={error} batchId={batchId} navigate={navigate} sx={{ mb: 1 }} />

      {data && !done && (
        <>
          {lines.length > 0 && (
            <TextField
              select size="small" fullWidth label="About" value={line} onChange={(e) => setLine(e.target.value)} sx={{ mb: 1, bgcolor: "background.paper" }}
              SelectProps={{
                displayEmpty: true,
                renderValue: (v) => (v === "" ? "The whole solution" : <LineLabel n={v} line={lines[Number(v) - 1]} />),
                MenuProps: { PaperProps: { sx: { maxWidth: "calc(100vw - 32px)" } } },
              }}
              InputLabelProps={{ shrink: true }}
            >
              <MenuItem value="">The whole solution</MenuItem>
              {lines.map((l, i) => <MenuItem key={i} value={String(i + 1)} sx={{ display: "block" }}><LineLabel n={i + 1} line={l} /></MenuItem>)}
            </TextField>
          )}
          {!data.messages?.length && (
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
              {QUICK.map((q) => <Chip key={q} size="small" label={q} variant="outlined" disabled={asking} onClick={() => send(q)} />)}
            </Box>
          )}
          <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <TextField
              size="small" fullWidth multiline maxRows={4}
              placeholder={line ? `What about line ${line} don't you follow?` : "e.g. I don't get the calculation in line 4"}
              value={message}
              inputProps={{ maxLength: 400 }}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              sx={{ bgcolor: "background.paper" }}
            />
            <Button variant="contained" disabled={asking || !message.trim()} onClick={() => send()} sx={{ minWidth: 44, px: 1.25 }} aria-label="Ask">
              <Send size={16} />
            </Button>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
            Only about this question's solution: one step or line at a time.
          </Typography>
        </>
      )}
      {done && (
        <Typography variant="caption" color="text.secondary">
          That's all the questions for this one. Still stuck? Ask a teacher through Doubts.
        </Typography>
      )}
    </Box>
  );
}
