import { Box, Typography, Paper, Chip, Skeleton, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { LifeBuoy, Plus } from "lucide-react";
import { useGetMyTicketsQuery } from "../../api/accountApi";
import EmptyState from "../../components/EmptyState";
import { CATEGORY_LABEL, STATUS_META } from "./supportMeta";

export default function SupportList() {
  const navigate = useNavigate();
  const { data, isLoading } = useGetMyTicketsQuery();
  const tickets = data?.tickets || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 720, mx: "var(--home-mx)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 500, flex: 1 }}>Help & support</Typography>
        <Button size="small" variant="contained" startIcon={<Plus size={15} />} onClick={() => navigate("/support/new")}>
          New ticket
        </Button>
      </Box>

      {isLoading ? (
        <Skeleton variant="rounded" height={180} />
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="No tickets yet"
          description="Problem with a payment, a course or your account? Open a ticket and the team will reply here."
          action={{ label: "New ticket", onClick: () => navigate("/support/new") }}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {tickets.map((t) => {
            const status = STATUS_META[t.status] || STATUS_META.open;
            return (
              <Paper
                key={t._id}
                variant="outlined"
                onClick={() => navigate(`/support/${t._id}`)}
                sx={{ p: 1.75, borderRadius: 3, cursor: "pointer", "&:hover": { borderColor: "primary.main" } }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                  <Typography sx={{ fontWeight: t.unreadByStudent ? 600 : 500, flex: 1, fontSize: 15 }} noWrap>{t.subject}</Typography>
                  {t.unreadByStudent && <Chip size="small" color="primary" label="New reply" />}
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Chip size="small" variant="outlined" color={status.color} label={status.label} />
                  <Typography variant="caption" color="text.secondary">
                    {CATEGORY_LABEL[t.category]}{t.batch?.name ? ` · ${t.batch.name}` : ""} · {new Date(t.lastActivityAt).toLocaleDateString()}
                  </Typography>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
