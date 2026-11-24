import { useState } from "react";
import { Box, Typography, Button } from "@mui/material";
import { useTheme } from "@mui/material/styles";

// --------------------------------------------------------------- report

// The report slip at the end of an Oral Quiz or AI Tutoring session.
export default function ReportSlip({ session, turns, onAgain, onBack, restarting }) {
  const theme = useTheme();
  const [showTranscript, setShowTranscript] = useState(false);
  const r = session.report || {};
  const answered = (session.marks || []).filter((m) => typeof m === "number").length;
  const rule = `1px solid ${theme.palette.divider}`;
  return (
    <Box sx={{ bgcolor: "background.paper", border: rule, borderRadius: 2, overflow: "hidden" }}>
      <Box sx={{ px: 2.5, pt: 2.5, pb: 1.5, borderBottom: `2px solid ${theme.palette.text.primary}` }}>
        <Typography sx={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: "text.secondary" }}>
          Session report · {new Date(session.updatedAt).toLocaleDateString()}
        </Typography>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 22, fontWeight: 600, mt: 0.5 }}>{session.lectureTitle}</Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", px: 2.5, py: 2, borderBottom: rule }}>
        <Typography sx={{ fontFamily: theme.typography.h1.fontFamily, fontSize: 60, lineHeight: 0.9, fontWeight: 600 }}>
          {r.score ?? 0}<Box component="span" sx={{ fontSize: 18, color: "text.secondary", fontWeight: 400 }}> /100</Box>
          {r.criteriaWeight > 0 && (
            <Box component="span" sx={{ display: "block", fontSize: 11, fontWeight: 400, color: "text.secondary", mt: 0.75, fontFamily: "inherit" }}>
              marks {r.marksScore} · criteria {r.criteriaWeight}%
            </Box>
          )}
        </Typography>
        <Typography sx={{ fontSize: 11, textAlign: "right", lineHeight: 1.7, letterSpacing: ".06em", color: "text.secondary" }}>
          {answered} ANSWERED<br />{session.limit} QUESTIONS
        </Typography>
      </Box>
      {(r.criteria || []).map((c) => (
        <Box key={c.name} sx={{ display: "flex", justifyContent: "space-between", px: 2.5, py: 1, borderBottom: rule, fontSize: 14 }}>
          <span>{c.name}</span>
          <Box component="span" sx={{ letterSpacing: 2 }}>{"●".repeat(Math.round(c.score))}{"○".repeat(Math.max(0, 5 - Math.round(c.score)))}</Box>
        </Box>
      ))}
      <Box sx={{ px: 2.5, py: 2, fontSize: 14, lineHeight: 1.6 }}>
        {r.remark && <Typography sx={{ color: "error.main", fontStyle: "italic", fontFamily: theme.typography.h1.fontFamily, fontSize: 17, mb: 1 }}>{r.remark}</Typography>}
        {(r.strengths || []).map((x) => <Typography key={x} sx={{ fontSize: 14 }}>✓ {x}</Typography>)}
        {(r.weaknesses || []).length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "text.secondary" }}>Revise</Typography>
            {r.weaknesses.map((x) => <Typography key={x} sx={{ fontSize: 14 }}>· {x}</Typography>)}
          </Box>
        )}
        {!answered && <Typography color="text.secondary" sx={{ fontSize: 14 }}>No answers in this session.</Typography>}
      </Box>
      {showTranscript && (
        <Box sx={{ px: 2.5, pb: 2, display: "flex", flexDirection: "column", gap: 1 }}>
          {turns.filter((t) => t.text).map((t, i) => (
            <Typography key={i} sx={{ fontSize: 13, color: t.role === "teacher" ? "text.primary" : "text.secondary" }}>
              <b>{t.role === "teacher" ? "T" : "You"}:</b> {t.text}
            </Typography>
          ))}
        </Box>
      )}
      <Box sx={{ display: "flex", gap: 1, px: 2.5, pb: 2.5 }}>
        <Button fullWidth variant="outlined" onClick={() => setShowTranscript(!showTranscript)}>{showTranscript ? "Hide transcript" : "Transcript"}</Button>
        <Button fullWidth variant="contained" disabled={restarting} onClick={onAgain}>{restarting ? "Starting…" : "Again"}</Button>
      </Box>
      <Box sx={{ px: 2.5, pb: 2 }}><Button fullWidth size="small" onClick={onBack}>All lectures</Button></Box>
    </Box>
  );
}
