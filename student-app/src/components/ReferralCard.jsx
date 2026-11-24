import { useState } from "react";
import { Box, Typography, Paper, Button, Chip, Snackbar } from "@mui/material";
import { Gift, Share2, Copy, Link2 } from "lucide-react";
import { useGetMyReferralsQuery } from "../api/contentApi";
import { useBranding } from "../BrandingContext";
import { shareOrCopy, siteLink, copyText } from "../utils/share";
import { refLink } from "../utils/referralRef";

const off = (d, currency) => (d?.type === "percent" ? `${d.value}%` : `${currency} ${d?.value}`);

// Plans page: the student's referral code, what it gives a friend and
// them, and their reward codes (backend utils/referrals.js). Shows nothing
// while referrals are off.
export default function ReferralCard() {
  const { data } = useGetMyReferralsQuery();
  const { siteName } = useBranding() || {};
  const [note, setNote] = useState("");
  if (!data?.enabled) return null;

  const reward = data.reward.kind === "coupon"
    ? `${off({ type: data.reward.type, value: data.reward.value }, data.currency)} off your next purchase`
    : data.reward.kind === "aiCredits" ? `${data.reward.credits} AI credits` : null;
  const usable = data.rewards.filter((r) => !r.used && !r.expired);

  const link = refLink(siteLink(), data.code);
  const share = async () => {
    // The link goes inside the text, not as the share's url: some share
    // sheets (Chrome's "Copy") keep only the url and drop the code.
    const out = await shareOrCopy({
      title: siteName || "Join me",
      text: `Use my code ${data.code} for ${off(data.discount, data.currency)} off at ${siteName || "this site"}: ${link}`,
    });
    if (out === "copied") setNote("Copied. Paste it anywhere to share.");
    else if (out === "failed") setNote(`Couldn't share from this browser. Your code is ${data.code}.`);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Gift size={18} />
        <Typography sx={{ fontWeight: 500, fontSize: 15 }}>Invite friends</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        A friend who uses your code gets {off(data.discount, data.currency)} off{data.newStudentsOnly ? " their first purchase" : ""}.
        {reward ? ` When they buy, you get ${reward}.` : ""}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Typography sx={{ fontFamily: "monospace", fontSize: 18, fontWeight: 600, letterSpacing: 1 }}>{data.code}</Typography>
        <Button size="small" variant="outlined" startIcon={<Copy size={15} />}
          onClick={async () => setNote((await copyText(data.code)) ? "Code copied." : `Couldn't copy. Your code is ${data.code}.`)}>
          Copy code
        </Button>
        <Button size="small" variant="outlined" startIcon={<Link2 size={15} />}
          onClick={async () => setNote((await copyText(link)) ? "Link copied. Friends who open it get your code filled in." : `Couldn't copy. Your link is ${link}`)}>
          Copy link
        </Button>
        <Button size="small" variant="contained" startIcon={<Share2 size={15} />} onClick={share}>Share</Button>
        {data.friends > 0 && (
          <Typography variant="caption" color="text.secondary">
            {data.friends} friend{data.friends === 1 ? "" : "s"} bought with your code
          </Typography>
        )}
      </Box>
      {usable.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>
            Your rewards: enter a code at checkout
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {usable.map((r) => (
              <Chip
                key={r.code}
                label={`${r.code} · ${off(r.discount, data.currency)} off${r.expiresAt ? ` · until ${new Date(r.expiresAt).toLocaleDateString()}` : ""}`}
                variant="outlined"
                sx={{ fontFamily: "monospace" }}
              />
            ))}
          </Box>
        </Box>
      )}
      <Snackbar open={Boolean(note)} autoHideDuration={3000} onClose={() => setNote("")} message={note} />
    </Paper>
  );
}
