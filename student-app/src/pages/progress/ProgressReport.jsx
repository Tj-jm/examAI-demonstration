import { Box, Typography, Paper, Alert, CircularProgress, Chip, Button } from "@mui/material";
import { useParams } from "react-router-dom";
import { Printer, TrendingUp, TrendingDown } from "lucide-react";
import { useGetProgressReportQuery } from "../../api/contentApi";
import { isNative } from "../../native/session";

// /progress/<token>: the full progress report a student or guardian opens
// from an SMS or email. No login: the link is the key, and it shows what
// the report said when it was sent. In the report's own language.

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const T = {
  en: {
    weekly: "Weekly report", biweekly: "Two-week report", monthly: "Monthly report", result: "Exam result",
    exams: "Exams", exam: "Exam", marks: "Marks", score: "Score", rank: "Rank", avg: "Average", position: "Position in batch",
    missed: "Missed exams", work: "Work not handed in", live: "Live classes attended", pending: "Exams still being marked",
    none: "No exams taken in this period.", print: "Print or save as PDF", gone: "This report link has expired or doesn't exist.",
    vsBefore: "vs the period before", assignments: "Assignments handed in",
  },
  bn: {
    weekly: "সাপ্তাহিক রিপোর্ট", biweekly: "দুই সপ্তাহের রিপোর্ট", monthly: "মাসিক রিপোর্ট", result: "পরীক্ষার ফল",
    exams: "পরীক্ষা", exam: "পরীক্ষা", marks: "নম্বর", score: "শতকরা", rank: "অবস্থান", avg: "গড়", position: "ব্যাচে অবস্থান",
    missed: "মিস করা পরীক্ষা", work: "জমা না দেওয়া কাজ", live: "লাইভ ক্লাসে উপস্থিতি", pending: "খাতা দেখা বাকি",
    none: "এই সময়ে কোনো পরীক্ষা দেয়নি।", print: "প্রিন্ট বা PDF", gone: "এই রিপোর্টের লিংকের মেয়াদ শেষ বা ভুল।",
    vsBefore: "আগের সময়ের তুলনায়", assignments: "জমা দেওয়া কাজ",
  },
};

const PRINT_CSS = "@media print { .no-print { display: none !important; } body { background: #fff !important; } }";

export default function ProgressReport() {
  const { token } = useParams();
  const { data, isLoading, error } = useGetProgressReportQuery(token);
  const lang = data?.language === "bn" ? "bn" : "en";
  const t = T[lang];
  const n = (v) => (lang === "bn" ? String(v).replace(/\d/g, (d) => BN_DIGITS[d]) : String(v));
  const date = (d) => new Date(d).toLocaleDateString(lang === "bn" ? "bn-BD" : undefined, { day: "numeric", month: "short", year: "numeric", timeZone: data?.timezone });

  if (isLoading) return <Box sx={{ display: "flex", justifyContent: "center", mt: 10 }}><CircularProgress /></Box>;
  if (error || !data) return <Box sx={{ p: 3, maxWidth: 560, mx: "auto" }}><Alert severity="error">{T.en.gone}<br />{T.bn.gone}</Alert></Box>;

  const change = data.avg !== null && data.avg !== undefined && data.prevAvg !== null && data.prevAvg !== undefined ? Math.round(data.avg - data.prevAvg) : null;
  const title = data.kind === "result" ? t.result : t[data.frequency] || t.weekly;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, minHeight: "100vh", bgcolor: "background.default" }}>
      <style>{PRINT_CSS}</style>
      <Paper variant="outlined" sx={{ maxWidth: 760, mx: "auto", p: { xs: 2, sm: 4 }, borderRadius: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, pb: 2, mb: 2, borderBottom: "2px solid", borderColor: "text.primary" }}>
          {data.brand.logo && <img src={data.brand.logo} alt="" style={{ height: 44 }} />}
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 20 }}>{data.brand.name}</Typography>
            <Typography color="text.secondary">
              {title}{data.from && data.to ? ` · ${date(data.from)} – ${date(new Date(new Date(data.to).getTime() - 1))}` : ""}
            </Typography>
          </Box>
        </Box>

        <Typography sx={{ fontSize: 22, fontWeight: 600 }}>{data.student.name}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>{data.batch.name}{data.student.studentId ? ` · ${data.student.studentId}` : ""}</Typography>

        {data.kind !== "result" && (
          <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap", mb: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">{t.avg}</Typography>
              <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{data.avg === null ? "—" : `${n(data.avg)}%`}</Typography>
              {change !== null && change !== 0 && (
                <Typography variant="caption" sx={{ color: change > 0 ? "success.main" : "error.main", display: "flex", alignItems: "center", gap: 0.5 }}>
                  {change > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} {change > 0 ? "+" : "−"}{n(Math.abs(change))} {t.vsBefore}
                </Typography>
              )}
            </Box>
            {data.rank && (
              <Box>
                <Typography variant="caption" color="text.secondary">{t.position}</Typography>
                <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{n(data.rank)}<Typography component="span" color="text.secondary"> / {n(data.of)}</Typography></Typography>
              </Box>
            )}
            {data.live?.total > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">{t.live}</Typography>
                <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{n(data.live.attended)}<Typography component="span" color="text.secondary"> / {n(data.live.total)}</Typography></Typography>
              </Box>
            )}
            {data.assignments?.total > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary">{t.assignments}</Typography>
                <Typography sx={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{n(data.assignments.handed)}<Typography component="span" color="text.secondary"> / {n(data.assignments.total)}</Typography></Typography>
              </Box>
            )}
          </Box>
        )}

        <Typography variant="overline" color="text.secondary">{t.exams}</Typography>
        {data.exams.length === 0 ? <Typography sx={{ mb: 2 }}>{t.none}</Typography> : (
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", mb: 2, "& th, & td": { py: 1, px: 1, borderBottom: "1px solid", borderColor: "divider", textAlign: "left" }, "& .num": { textAlign: "right", fontVariantNumeric: "tabular-nums" }, "& th": { fontSize: 12, color: "text.secondary", fontWeight: 600 } }}>
            <thead><tr><th>{t.exam}</th><th className="num">{t.marks}</th><th className="num">{t.score}</th>{data.showRank && <th className="num">{t.rank}</th>}</tr></thead>
            <tbody>
              {data.exams.map((e, i) => (
                <tr key={i}>
                  <td>{e.title}</td>
                  <td className="num">{n(e.marks)}/{n(e.total)}</td>
                  <td className="num"><strong>{n(e.pct)}%</strong></td>
                  {data.showRank && <td className="num">{e.rank ? `${n(e.rank)}/${n(e.of)}` : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </Box>
        )}

        {data.missed?.length > 0 && (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="overline" color="error.main">{t.missed}</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>{data.missed.map((m, i) => <Chip key={i} size="small" color="error" variant="outlined" label={m} />)}</Box>
          </Box>
        )}
        {data.assignments?.missing?.length > 0 && (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="overline" color="warning.main">{t.work}</Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>{data.assignments.missing.map((m, i) => <Chip key={i} size="small" color="warning" variant="outlined" label={m} />)}</Box>
          </Box>
        )}
        {data.pending > 0 && <Typography variant="body2" color="text.secondary">{t.pending}: {n(data.pending)}</Typography>}

        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 3 }}>{date(data.createdAt)}</Typography>
      </Paper>
      {!isNative && (
        <Box className="no-print" sx={{ maxWidth: 760, mx: "auto", mt: 2 }}>
          <Button variant="outlined" startIcon={<Printer size={16} />} onClick={() => window.print()}>{t.print}</Button>
        </Box>
      )}
    </Box>
  );
}
