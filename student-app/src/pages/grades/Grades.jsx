import { Box, Typography, Paper, Skeleton, IconButton, Button, Chip } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, GraduationCap, Printer } from "lucide-react";
import { useGetMyGradesQuery, useGetBatchQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";
import { BatchContextCard } from "../../components/BatchSwitcher";
import { useTerms } from "../../BrandingContext";
import { isNative } from "../../native/session";

const pct = (n) => (n === null || n === undefined ? "—" : `${n}%`);

const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  #report-card, #report-card * { visibility: visible; }
  #report-card { position: absolute; inset: 0 auto auto 0; width: 100%; box-shadow: none !important; border: none !important; }
  .no-print { display: none !important; }
}`;

// A student's grades in a batch, as a report card they can print or save as
// PDF (on the web). Shown once their teacher publishes the gradebook.
export default function Grades() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const { data: batch } = useGetBatchQuery(batchId);
  const { data, isLoading } = useGetMyGradesQuery(batchId);

  const back = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }} className="no-print">
      <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)} aria-label={`Back to ${terms.batch}`}><ArrowLeft size={18} /></IconButton>
    </Box>
  );

  if (isLoading) return <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx: "var(--home-mx)" }}>{back}<Skeleton variant="rounded" height={320} /></Box>;
  if (!data?.published) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx: "var(--home-mx)" }}>
        {back}
        <BatchContextCard batch={batch} pageName="Grades" />
        <EmptyState icon={GraduationCap} title="Grades aren't out yet" description={`Your ${terms.teacher} shares your grades and report card here.`} />
      </Box>
    );
  }

  const { row, settings, items } = data;
  const categories = Object.keys(row.categories);

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 760, mx: "var(--home-mx)" }}>
      <style>{PRINT_CSS}</style>
      {back}
      <Box className="no-print"><BatchContextCard batch={batch} pageName="Grades" /></Box>

      <Paper id="report-card" variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, pb: 1.5, mb: 2, borderBottom: 2, borderColor: "text.primary" }}>
          {data.brand.logo && <img src={data.brand.logo} alt="" style={{ height: 40 }} />}
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{data.brand.name}</Typography>
            <Typography variant="body2" color="text.secondary">Report card{settings.term ? ` · ${settings.term}` : ""}</Typography>
          </Box>
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 0.5, mb: 2 }}>
          <Typography variant="body2"><Box component="span" sx={{ color: "text.secondary" }}>Student:</Box> <strong>{row.student.name}</strong></Typography>
          {row.student.studentId && <Typography variant="body2"><Box component="span" sx={{ color: "text.secondary" }}>Student ID:</Box> {row.student.studentId}</Typography>}
          <Typography variant="body2"><Box component="span" sx={{ color: "text.secondary" }}>{terms.Batch || "Batch"}:</Box> {data.batch.name}</Typography>
        </Box>

        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", mb: 2 }}>
          <Box><Typography variant="caption" color="text.secondary">Overall</Typography><Typography variant="h4" sx={{ fontWeight: 700 }}>{pct(row.overall)}</Typography></Box>
          <Box><Typography variant="caption" color="text.secondary">Grade</Typography><Typography variant="h4" sx={{ fontWeight: 700 }}>{row.letter || "—"}</Typography>{row.points !== null && row.points !== undefined && <Typography variant="caption" color="text.secondary">{row.points} points</Typography>}</Box>
          {settings.showRank && row.rank && <Box><Typography variant="caption" color="text.secondary">Position</Typography><Typography variant="h4" sx={{ fontWeight: 700 }}>{row.rank}<Typography component="span" color="text.secondary"> of {data.classSize}</Typography></Typography></Box>}
        </Box>

        <Typography variant="overline" color="text.secondary">By category</Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mb: 2 }}>
          {categories.map((c) => {
            const cat = row.categories[c];
            return (
              <Box key={c} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" sx={{ flex: 1 }}>{c} <Box component="span" sx={{ color: "text.secondary" }}>· counts {cat.weight}%</Box></Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>{cat.max ? `${cat.marks} / ${cat.max}` : ""}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 56, textAlign: "right" }}>{pct(cat.pct)}</Typography>
              </Box>
            );
          })}
        </Box>

        {items.length > 0 && (
          <>
            <Typography variant="overline" color="text.secondary">Work</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mb: 2 }}>
              {items.map((i) => {
                const cell = row.cells[i.id];
                return (
                  <Box key={i.id} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{i.title}</Typography>
                    {cell?.status === "graded"
                      ? <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>{cell.marks} / {cell.max}</Typography>
                      : <Chip size="small" label={cell?.status === "pending" ? "Being marked" : "Not handed in"} />}
                  </Box>
                );
              })}
            </Box>
          </>
        )}

        {data.remark && (
          <>
            <Typography variant="overline" color="text.secondary">Remarks</Typography>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 2 }}>{data.remark}</Typography>
          </>
        )}
        {(settings.signatures || []).length > 0 ? (
          <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "flex-end", mt: 3 }}>
            {settings.signatures.map((s, i) => (
              <Box key={i} sx={{ minWidth: 150, textAlign: "center" }}>
                <Box sx={{ height: 48, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                  {s.image && <Box component="img" src={s.image} alt="" sx={{ maxHeight: 48, maxWidth: 170, bgcolor: "#fff" }} />}
                </Box>
                <Box sx={{ borderTop: "1px solid", borderColor: "text.primary", pt: 0.5, fontWeight: 600, fontSize: 13 }}>{s.name || "\u00a0"}</Box>
                {s.role && <Typography variant="caption" color="text.secondary">{s.role}</Typography>}
              </Box>
            ))}
          </Box>
        ) : settings.signedBy && <Typography variant="caption" color="text.secondary">{settings.signedBy}</Typography>}
      </Paper>

      {!isNative && (
        <Button className="no-print" startIcon={<Printer size={16} />} variant="outlined" sx={{ mt: 2 }} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      )}
    </Box>
  );
}
