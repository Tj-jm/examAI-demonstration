import { useMemo, useState } from "react";
import { Box, Typography, Paper, Chip, Skeleton, IconButton, TextField, InputAdornment, LinearProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Search, CheckCircle2, CircleDot, Circle, Code2 } from "lucide-react";
import { useGetCodingProblemsQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { useHomeMx } from "../../BrandingContext";
import goBack from "../../utils/goBack";

const STATUS = { solved: ["Solved", CheckCircle2, "success.main"], tried: ["Tried", CircleDot, "warning.main"], new: ["New", Circle, "text.disabled"] };
const DIFF = { easy: "success", medium: "warning", hard: "error" };

// Coding practice: every coding problem in the batch, by chapter.
export default function CodingProblems() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const mx = useHomeMx();
  const { data, isLoading } = useGetCodingProblemsQuery(batchId);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [diff, setDiff] = useState("");
  const all = data?.problems || [];
  const shown = all.filter((p) => (!status || p.status === status) && (!diff || p.difficulty === diff) && (!q || p.title.toLowerCase().includes(q.toLowerCase())));
  const groups = useMemo(() => {
    const m = new Map();
    for (const p of shown) {
      const k = [p.subject, p.chapter].filter(Boolean).join(" · ") || "Problems";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return [...m.entries()];
  }, [shown]);
  const solved = all.filter((p) => p.status === "solved").length;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => goBack(navigate, `/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
        <Code2 size={20} />
        <Typography variant="h6" fontWeight={700}>Coding practice</Typography>
      </Box>

      {all.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 3 }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
            <Typography variant="body2" fontWeight={600}>{solved} of {all.length} solved</Typography>
            <Typography variant="body2" color="text.secondary">{Math.round((solved / all.length) * 100)}%</Typography>
          </Box>
          <LinearProgress variant="determinate" value={(solved / all.length) * 100} sx={{ height: 6, borderRadius: 3 }} />
        </Paper>
      )}

      <TextField
        size="small" fullWidth placeholder="Search problems" value={q} onChange={(e) => setQ(e.target.value.slice(0, 100))} sx={{ mb: 1.5 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
      />
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
        {[["", "All"], ["new", "New"], ["tried", "Tried"], ["solved", "Solved"]].map(([v, l]) => (
          <Chip key={`s${v}`} label={l} size="small" color={status === v ? "primary" : "default"} variant={status === v ? "filled" : "outlined"} onClick={() => setStatus(v)} />
        ))}
        <Box sx={{ width: 8 }} />
        {[["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]].map(([v, l]) => (
          <Chip key={`d${v}`} label={l} size="small" color={diff === v ? DIFF[v] : "default"} variant={diff === v ? "filled" : "outlined"} onClick={() => setDiff(diff === v ? "" : v)} />
        ))}
      </Box>

      {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={64} sx={{ mb: 1 }} />)}
      {!isLoading && all.length === 0 && <EmptyState icon={Code2} title="No problems yet" description="Coding problems added to this batch show here." />}
      {!isLoading && all.length > 0 && shown.length === 0 && <Typography color="text.secondary" variant="body2">Nothing matches.</Typography>}

      {groups.map(([group, list]) => (
        <Box key={group} sx={{ mb: 2.5 }}>
          <Typography variant="overline" color="text.secondary">{group}</Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {list.map((p) => {
              const [label, Icon, color] = STATUS[p.status];
              return (
                <Paper
                  key={p._id} variant="outlined" onClick={() => navigate(`/batches/${batchId}/coding/${p._id}`)}
                  sx={{ p: 1.5, borderRadius: 2.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 1.5, "&:hover": { borderColor: "primary.main" } }}
                >
                  <Box sx={{ color, display: "flex" }} title={label}><Icon size={18} /></Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{p.title}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.marks} marks{p.tries ? ` · ${p.tries} submission${p.tries === 1 ? "" : "s"}` : ""}</Typography>
                  </Box>
                  {p.difficulty && <Chip size="small" variant="outlined" color={DIFF[p.difficulty]} label={p.difficulty} sx={{ textTransform: "capitalize" }} />}
                </Paper>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
