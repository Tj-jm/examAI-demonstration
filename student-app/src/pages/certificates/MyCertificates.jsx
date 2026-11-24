import { Box, Typography, Paper, Skeleton } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { Award, ChevronRight } from "lucide-react";
import { useGetMyCertificatesQuery } from "../../api/contentApi";
import EmptyState from "../../components/EmptyState";

export default function MyCertificates() {
  const navigate = useNavigate();
  const { data, isLoading } = useGetMyCertificatesQuery();
  const list = data?.certificates || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx: "var(--home-mx)" }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Certificates</Typography>
      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>{[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={72} />)}</Box>
      ) : list.length === 0 ? (
        <EmptyState icon={Award} title="No certificates yet" description="Certificates you're given show up here, ready to print or share." />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {list.map((c) => (
            <Paper key={c._id} variant="outlined" onClick={() => navigate(`/verify/${c.serial}`)} sx={{ p: 2, borderRadius: 3, display: "flex", alignItems: "center", gap: 2, cursor: "pointer" }}>
              <Box sx={{ color: "warning.main", display: "flex" }}><Award size={28} /></Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }} noWrap>{c.title}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {c.batchName}{c.grade ? ` · ${c.grade}` : ""} · {new Date(c.issuedAt).toLocaleDateString()}
                </Typography>
              </Box>
              <ChevronRight size={18} />
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
