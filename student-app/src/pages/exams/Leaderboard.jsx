import { Box, Typography, Paper, Avatar, IconButton, Skeleton, CircularProgress } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trophy, Crown, Medal } from "lucide-react";
import { useGetLeaderboardQuery, useGetBatchQuery } from "../../api/contentApi";
import { BatchContextCard } from "../../components/BatchSwitcher";
import EmptyState from "../../components/EmptyState";
import FeatureGate from "../../components/FeatureGate";
import { useTerms, useBranding } from "../../BrandingContext";
import { animate, slideUp, growX, useCountUp, meGlow, riseUp } from "../../motion";

// Gold/silver/bronze are treated as fixed, universal medal colors rather
// than derived from the active theme — like a checkmark staying green
// regardless of brand color, a podium is a recognised convention on its
// own, not a piece of this install's branding.
const MEDAL = {
  1: { color: "#F5B93D", label: "1st" },
  2: { color: "#B0B7C3", label: "2nd" },
  3: { color: "#CE8946", label: "3rd" },
};

export default function Leaderboard() {
  const terms = useTerms();
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: batch } = useGetBatchQuery(batchId);
  const { data, isLoading } = useGetLeaderboardQuery(batchId);
  const { leaderboardStyle = "podium" } = useBranding() || {};

  const top10 = data?.top10 || [];
  const podium = top10.slice(0, 3);
  const rest = top10.slice(3);
  const me = data?.me;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={() => navigate(`/batches/${batchId}`)}><ArrowLeft size={18} /></IconButton>
      </Box>

      <BatchContextCard batch={batch} pageName="Leaderboard" />

      <FeatureGate batch={batch} feature="exams" label="Leaderboard">
      {isLoading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Skeleton variant="rounded" height={180} />
          <Skeleton variant="rounded" height={280} />
        </Box>
      ) : top10.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="Nothing to rank yet"
          description="Once exams here are graded, the strongest average scores will show up on this page."
          secondaryAction={{ label: `Back to ${terms.batch}`, onClick: () => navigate(`/batches/${batchId}`) }}
        />
      ) : (
        leaderboardStyle === "scoreboard" ? (
          <Scoreboard entries={top10} me={me} total={data?.totalRanked} theme={theme} />
        ) : leaderboardStyle === "spotlight" ? (
          <Spotlight entries={top10} me={me} total={data?.totalRanked} theme={theme} />
        ) : (
        <>
          <Podium entries={podium} />

          {rest.length > 0 && (
            <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden", mb: 3 }}>
              {rest.map((entry, i) => (
                <Row key={entry.studentId} entry={entry} theme={theme} delay={450 + Math.min(i, 12) * 45} />
              ))}
            </Paper>
          )}

          {/* Only rendered when it's telling the student something the list
              above doesn't already show — inside the top 10, their row is
              already visible and highlighted, so repeating it here would
              just be the same fact twice. */}
          {me && !me.inTopTen && (
            <Paper
              variant="outlined"
              sx={{
                borderRadius: 3, p: 2, display: "flex", alignItems: "center", gap: 1.5,
                borderColor: "primary.main", borderWidth: 1.5,
                bgcolor: alpha(theme.palette.primary.main, 0.06),
              }}
            >
              <Box sx={{
                width: 34, textAlign: "center", fontWeight: 600, fontSize: 15,
                color: "primary.main", flexShrink: 0,
              }}>
                #{me.rank}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 500, fontSize: 14 }}>Your rank</Typography>
                <Typography variant="caption" color="text.secondary">
                  {me.examsCount} exam{me.examsCount === 1 ? "" : "s"} counted
                </Typography>
              </Box>
              <Typography sx={{ fontWeight: 600, fontSize: 17 }} className="tnum">
                {me.avgPercent}%
              </Typography>
            </Paper>
          )}

          {!me && <NotRanked />}
        </>
        )
      )}
      </FeatureGate>
    </Box>
  );
}

function Initial({ name, size = 36, fontSize = 14 }) {
  return (
    <Avatar sx={{ width: size, height: size, fontSize, bgcolor: "action.hover", color: "text.primary" }}>
      {(name || "?")[0]?.toUpperCase()}
    </Avatar>
  );
}

// #1 in the middle and tallest, #2 and #3 flanking it lower — the familiar
// podium shape, built from three plain cards rather than anything
// requiring absolute positioning, so it reflows cleanly on a narrow phone
// screen instead of needing its own breakpoint logic.
export function Podium({ entries }) {
  const order = [entries[1], entries[0], entries[2]].filter(Boolean);
  const heights = { 1: 132, 2: 108, 3: 96 };

  return (
    <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.25, mb: 3 }}>
      {order.map((entry) => {
        const medal = MEDAL[entry.rank];
        return (
          <Box key={entry.studentId} sx={{ flex: 1, minWidth: 0 }}>
            <Paper
              variant="outlined"
              sx={{
                height: heights[entry.rank],
                borderRadius: 3,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.5,
                px: 1,
                position: "relative",
                borderColor: entry.isMe ? "primary.main" : "divider",
                borderWidth: entry.isMe ? 1.5 : 1,
                bgcolor: entry.rank === 1 ? alpha(medal.color, 0.08) : "background.paper",
                // Third, then second, then first rise into place.
                animation: `${riseUp} 450ms cubic-bezier(.2,.7,.3,1.2) ${(3 - entry.rank) * 130}ms both${entry.isMe ? `, ${meGlow} 1400ms ease-in-out 800ms` : ""}`,
              }}
            >
              {entry.rank === 1 && (
                <Crown size={16} color={medal.color} fill={medal.color} style={{ position: "absolute", top: 8 }} />
              )}
              <Box sx={{ mt: entry.rank === 1 ? 2 : 0 }}>
                <Initial name={entry.name} size={entry.rank === 1 ? 44 : 36} fontSize={entry.rank === 1 ? 17 : 14} />
              </Box>
              <Typography
                sx={{ fontWeight: 500, fontSize: entry.rank === 1 ? 13.5 : 12.5, textAlign: "center", lineHeight: 1.2, px: 0.5 }}
                noWrap
                title={entry.name}
              >
                {entry.name}{entry.isMe ? " (You)" : ""}
              </Typography>
              <Typography className="tnum" sx={{ fontWeight: 600, fontSize: entry.rank === 1 ? 16 : 14, color: medal.color }}>
                {entry.avgPercent}%
              </Typography>
            </Paper>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, mt: 0.75 }}>
              <Medal size={12} color={medal.color} />
              <Typography variant="caption" sx={{ color: medal.color, fontWeight: 500 }}>{medal.label}</Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function Row({ entry, theme, delay = 0 }) {
  return (
    <Box
      sx={{
        display: "flex", alignItems: "center", gap: 1.5, p: 1.5,
        borderTop: 1, borderColor: "divider",
        bgcolor: entry.isMe ? alpha(theme.palette.primary.main, 0.06) : "transparent",
        ...animate(slideUp, 320, "ease-out", `${delay}ms both`),
        ...(entry.isMe ? { animation: `${slideUp} 320ms ease-out ${delay}ms both, ${meGlow} 1400ms ease-in-out ${delay + 500}ms` } : {}),
      }}
    >
      <Typography className="tnum" sx={{ width: 26, textAlign: "center", fontWeight: 500, color: "text.secondary", flexShrink: 0 }}>
        {entry.rank}
      </Typography>
      <Initial name={entry.name} size={32} fontSize={13} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: entry.isMe ? 600 : 400, fontSize: 14 }} noWrap>
          {entry.name}{entry.isMe ? " (You)" : ""}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {entry.examsCount} exam{entry.examsCount === 1 ? "" : "s"}
        </Typography>
      </Box>
      <Typography className="tnum" sx={{ fontWeight: 600, fontSize: 14.5 }}>
        {entry.avgPercent}%
      </Typography>
    </Box>
  );
}

function NotRanked() {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", mt: 1 }}>
      Take a graded exam in this batch to appear here.
    </Typography>
  );
}

// ---------------------------------------------------------------- scoreboard
// One ranked table: every row has a bar for its average, medals on the top
// three, and the student's own row pinned at the bottom when they're not in
// the top ten.
export function Scoreboard({ entries, me, total, theme }) {
  const best = Math.max(1, ...entries.map((e) => e.avgPercent || 0));
  return (
    <>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden", mb: 2 }}>
        <Box sx={{ display: "flex", px: 1.75, py: 1, bgcolor: "action.hover" }}>
          <Typography variant="caption" color="text.secondary" sx={{ width: 34 }}>#</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Student</Typography>
          <Typography variant="caption" color="text.secondary">Average</Typography>
        </Box>
        {entries.map((entry, i) => (
          <ScoreRow key={entry.studentId} entry={entry} best={best} theme={theme} delay={i * 45} />
        ))}
      </Paper>
      {me && !me.inTopTen && (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: "hidden", borderColor: "primary.main" }}>
          <ScoreRow entry={{ ...me, name: "You", isMe: true, studentId: "me" }} best={best} theme={theme} delay={0} />
        </Paper>
      )}
      {total > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 1.5 }}>
          {total} student{total === 1 ? "" : "s"} ranked
        </Typography>
      )}
      {!me && <NotRanked />}
    </>
  );
}

function ScoreRow({ entry, best, theme, delay }) {
  const medal = MEDAL[entry.rank];
  const pct = Math.max(0, Math.min(100, ((entry.avgPercent || 0) / best) * 100));
  return (
    <Box
      sx={{
        display: "flex", alignItems: "center", gap: 1.25, px: 1.75, py: 1.25,
        borderTop: 1, borderColor: "divider",
        bgcolor: entry.isMe ? alpha(theme.palette.primary.main, 0.07) : "transparent",
        ...animate(slideUp, 320, "ease-out", `${delay}ms both`),
        ...(entry.isMe ? { animation: `${slideUp} 320ms ease-out ${delay}ms both, ${meGlow} 1400ms ease-in-out ${delay + 500}ms` } : {}),
      }}
    >
      <Box sx={{ width: 34, flexShrink: 0, display: "flex", alignItems: "center", gap: 0.25 }}>
        {medal ? <Medal size={16} color={medal.color} fill={alpha(medal.color, 0.3)} /> : null}
        <Typography className="tnum" sx={{ fontWeight: 600, fontSize: 13.5, color: medal?.color || "text.secondary" }}>
          {entry.rank}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
          <Typography sx={{ fontWeight: entry.isMe ? 600 : 500, fontSize: 14, flex: 1, minWidth: 0 }} noWrap>
            {entry.name}{entry.isMe && entry.name !== "You" ? " (You)" : ""}
          </Typography>
          <Typography className="tnum" sx={{ fontWeight: 600, fontSize: 14 }}>{entry.avgPercent}%</Typography>
        </Box>
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: "action.hover", mt: 0.6, overflow: "hidden" }}>
          <Box
            sx={{
              width: `${pct}%`, height: "100%", borderRadius: 3,
              bgcolor: medal ? medal.color : entry.isMe ? "primary.main" : alpha(theme.palette.primary.main, 0.55),
              transformOrigin: "left",
              animation: `${growX} 800ms cubic-bezier(.2,.7,.3,1) ${delay}ms both`,
            }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {entry.examsCount} exam{entry.examsCount === 1 ? "" : "s"}
        </Typography>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------- spotlight
// The student's own standing first — where they are and how far into the
// top they sit — then the top ten as score cards with a ring each.
export function Spotlight({ entries, me, total, theme }) {
  const topShare = me && total ? Math.max(1, Math.round((me.rank / total) * 100)) : null;
  return (
    <>
      {me ? (
        <Paper
          sx={{
            borderRadius: 4, p: 2.5, mb: 2.5, color: "primary.contrastText",
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${alpha(theme.palette.primary.dark || theme.palette.primary.main, 0.85)})`,
            display: "flex", alignItems: "center", gap: 2,
            ...animate(slideUp, 350),
          }}
        >
          <Ring value={me.avgPercent} size={78} thickness={5} light />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>Your standing</Typography>
            <Typography sx={{ fontSize: 28, fontWeight: 600, lineHeight: 1.15 }} className="tnum">
              #<CountTo value={me.rank} />
              {total ? <Typography component="span" sx={{ fontSize: 15, opacity: 0.8, ml: 0.75 }}>of {total}</Typography> : null}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              {topShare !== null ? `Top ${topShare}% · ` : ""}{me.examsCount} exam{me.examsCount === 1 ? "" : "s"} counted
            </Typography>
          </Box>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 4, p: 2.5, mb: 2.5, textAlign: "center" }}>
          <NotRanked />
        </Paper>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)" }, gap: 1.25 }}>
        {entries.map((entry, i) => {
          const medal = MEDAL[entry.rank];
          return (
            <Paper
              key={entry.studentId}
              variant="outlined"
              sx={{
                borderRadius: 3, p: 1.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 0.75,
                position: "relative",
                borderColor: entry.isMe ? "primary.main" : medal ? alpha(medal.color, 0.6) : "divider",
                borderWidth: entry.isMe || medal ? 1.5 : 1,
                bgcolor: medal ? alpha(medal.color, 0.06) : "background.paper",
                ...animate(slideUp, 320, "ease-out", `${i * 50}ms both`),
                ...(entry.isMe ? { animation: `${slideUp} 320ms ease-out ${i * 50}ms both, ${meGlow} 1400ms ease-in-out ${i * 50 + 500}ms` } : {}),
              }}
            >
              <Box sx={{
                position: "absolute", top: 8, left: 8, minWidth: 22, height: 22, px: 0.5, borderRadius: 11,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                bgcolor: medal ? medal.color : "action.hover", color: medal ? "#fff" : "text.secondary",
              }}>
                {entry.rank}
              </Box>
              {entry.rank === 1 && <Crown size={15} color={MEDAL[1].color} fill={MEDAL[1].color} style={{ position: "absolute", top: 10, right: 10 }} />}
              <Ring value={entry.avgPercent} size={58} thickness={4} color={medal?.color} />
              <Typography sx={{ fontWeight: entry.isMe ? 600 : 500, fontSize: 13, textAlign: "center", width: "100%" }} noWrap title={entry.name}>
                {entry.name}{entry.isMe ? " (You)" : ""}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {entry.examsCount} exam{entry.examsCount === 1 ? "" : "s"}
              </Typography>
            </Paper>
          );
        })}
      </Box>
    </>
  );
}

function CountTo({ value }) {
  return <>{Math.round(useCountUp(value, 700))}</>;
}

// A score ring that fills to its value, with the number inside.
function Ring({ value = 0, size, thickness, color, light = false }) {
  const shown = useCountUp(value, 900);
  return (
    <Box sx={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={thickness}
        sx={{ position: "absolute", color: light ? "rgba(255,255,255,0.25)" : "action.hover" }}
      />
      <CircularProgress
        variant="determinate"
        value={shown}
        size={size}
        thickness={thickness}
        sx={{ position: "absolute", color: light ? "#fff" : color || "primary.main", "& circle": { strokeLinecap: "round" } }}
      />
      <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography className="tnum" sx={{ fontWeight: 600, fontSize: size > 64 ? 17 : 13 }}>{Math.round(shown)}%</Typography>
      </Box>
    </Box>
  );
}
