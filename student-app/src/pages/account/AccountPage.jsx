import { Box, Typography, Paper, Chip, Skeleton, Button, Alert } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, MessageSquareWarning, Flag, Ban, ShieldAlert, Sparkles } from "lucide-react";
import { useGetStandingQuery } from "../../api/accountApi";
import DeleteAccountSection from "./DeleteAccountSection";
import GuardianSection from "./GuardianSection";
import ProfileSection from "./ProfileSection";
import MarketingSection from "./MarketingSection";
import MascotSection from "./MascotSection";

// The student's own account page: standing (what's on their conduct
// record, with an appeal for each) and account deletion.

const day = (d) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const describe = (e) => {
  switch (e.kind) {
    case "abuse":
      return { Icon: MessageSquareWarning, title: "A message was flagged as abusive", body: e.text ? `“${e.text}”` : null, appeal: true };
    case "examViolation":
      return { Icon: Flag, title: `${e.count} integrity flag${e.count === 1 ? "" : "s"} during an exam`, body: e.exam?.title || null, appeal: true };
    case "disqualified":
      return { Icon: Ban, title: "An exam attempt was disqualified", body: [e.exam?.title, e.text].filter(Boolean).join(" — ") || null, appeal: true };
    case "warning":
      return { Icon: ShieldAlert, title: "Warning from staff", body: e.text, appeal: true };
    default: {
      const titles = {
        pauseAi: e.until ? `AI features paused until ${day(e.until)}` : "AI features paused",
        resumeAi: "AI features resumed",
        suspend: e.until ? `Account suspended until ${day(e.until)}` : "Account suspended",
        reactivate: "Account reactivated",
      };
      return { Icon: Sparkles, title: titles[e.action] || "Account action", body: e.text, appeal: e.action === "pauseAi" };
    }
  }
};

export default function AccountPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useGetStandingQuery();
  const events = data?.events || [];

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 720, mx: "var(--home-mx)", display: "flex", flexDirection: "column", gap: 3 }}>
      <Typography variant="h6" sx={{ fontWeight: 500 }}>Account</Typography>

      <Box>
        <Typography sx={{ fontWeight: 500, mb: 1 }}>Account standing</Typography>
        {isLoading ? <Skeleton variant="rounded" height={120} /> : (
          <>
            {data?.aiPausedUntil ? (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                AI features are paused on your account{data.aiPausedIndefinitely ? "" : ` until ${day(data.aiPausedUntil)}`}.
              </Alert>
            ) : events.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", alignItems: "center", gap: 1.5 }}>
                <ShieldCheck size={22} color="currentColor" />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>All good</Typography>
                  <Typography variant="caption" color="text.secondary">Nothing on your record.</Typography>
                </Box>
              </Paper>
            ) : null}
            {events.length > 0 && (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {events.map((e) => {
                  const d = describe(e);
                  return (
                    <Paper key={e._id} variant="outlined" sx={{ p: 1.75, borderRadius: 3, display: "flex", gap: 1.5 }}>
                      <Box sx={{ color: "text.secondary", pt: 0.25 }}><d.Icon size={18} /></Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{d.title}</Typography>
                        {d.body && <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{d.body}</Typography>}
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, flexWrap: "wrap" }}>
                          <Typography variant="caption" color="text.secondary">{day(e.createdAt)}</Typography>
                          {e.appealTicket ? (
                            <Chip size="small" label="Appeal sent" onClick={() => navigate(`/support/${e.appealTicket}`)} />
                          ) : d.appeal ? (
                            <Button
                              size="small"
                              sx={{ minWidth: 0, p: 0, fontSize: 12 }}
                              onClick={() => navigate(`/support/new?appeal=${e._id}&subject=${encodeURIComponent(`Appeal: ${d.title}`)}`)}
                            >
                              Appeal
                            </Button>
                          ) : null}
                        </Box>
                      </Box>
                    </Paper>
                  );
                })}
              </Box>
            )}
          </>
        )}
      </Box>

      <ProfileSection />


      <GuardianSection />

      <MarketingSection />

      <MascotSection />

      <DeleteAccountSection />
    </Box>
  );
}
