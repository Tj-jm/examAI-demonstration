import { Box, Typography, Paper, Switch, Skeleton } from "@mui/material";
import { useGetMarketingQuery, useSetMarketingMutation } from "../../api/accountApi";

// Offers and announcements (campaigns) on or off. Messages about exams,
// classes and the account are not affected.
export default function MarketingSection() {
  const { data, isLoading } = useGetMarketingQuery();
  const [save, { isLoading: saving }] = useSetMarketingMutation();
  if (isLoading || !data) return <Skeleton variant="rounded" height={72} />;

  return (
    <Box>
      <Typography sx={{ fontWeight: 500, mb: 1 }}>Offers and announcements</Typography>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", alignItems: "center", gap: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          News, offers and reminders by app notification, SMS and email. Messages about your exams, classes and account still come either way.
        </Typography>
        <Switch
          checked={!data.optOut}
          disabled={saving}
          onChange={(e) => save(!e.target.checked)}
          inputProps={{ "aria-label": "Offers and announcements" }}
        />
      </Paper>
    </Box>
  );
}
