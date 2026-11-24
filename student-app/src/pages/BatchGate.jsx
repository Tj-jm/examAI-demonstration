import { Box, Typography, Paper, Skeleton } from "@mui/material";
import { useNavigate, Navigate } from "react-router-dom";
import { Layers, ShoppingBag } from "lucide-react";
import { useGetBatchesQuery } from "../api/contentApi";
import EmptyState from "../components/EmptyState";
import { useSales, useTerms } from "../BrandingContext";

// Lectures, exams and practice are all scoped to a batch on the backend, but
// the nav that reaches them is not — a student with one batch should never
// have to pick it, and a student with several needs to before going further.
export default function BatchGate({ buildPath, title }) {
  const sales = useSales();
  const terms = useTerms();
  const { data, isLoading } = useGetBatchesQuery();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Skeleton variant="rounded" height={64} />
        <Skeleton variant="rounded" height={64} />
      </Box>
    );
  }

  const enrolled = data?.enrolled || [];

  if (enrolled.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        tone="blocked"
        title={`You are not in a ${terms.batch} yet`}
        description={sales ? `Lectures, exams and practice all live inside a ${terms.batch}. Join one to open this.` : `Your ${terms.org} adds you to your ${terms.batches}. Ask them if you are expecting one.`}
        action={sales ? { label: `Browse ${terms.batches}`, icon: ShoppingBag, onClick: () => navigate("/purchases") } : undefined}
      />
    );
  }

  if (enrolled.length === 1) {
    return <Navigate to={buildPath(enrolled[0]._id)} replace />;
  }

  return <PickBatch batches={enrolled} buildPath={buildPath} title={title} />;
}

function PickBatch({ batches, buildPath, title }) {
  const terms = useTerms();
  const navigate = useNavigate();

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 700, mx: "var(--home-mx)" }}>
      <Typography variant="h6" sx={{ fontWeight: 500, mb: 2, fontSize: 15 }}>
        {title || `Choose a ${terms.batch}`}
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        {batches.map((b) => (
          <Paper
            key={b._id}
            variant="outlined"
            sx={{ p: 2, borderRadius: 2, cursor: "pointer" }}
            onClick={() => navigate(buildPath(b._id))}
          >
            <Typography sx={{ fontWeight: 500 }}>{b.name}</Typography>
            <Typography variant="caption" color="text.secondary">{b.program?.title}</Typography>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
