import { useState } from "react";
import { Box, Typography, Paper, Button, Skeleton, Alert, Chip, Stack, Switch, LinearProgress } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Map as MapIcon, Flame, Dumbbell, PlayCircle, ClipboardList, CheckCircle2, Circle, Target, CalendarClock } from "lucide-react";
import { useGetTutorQuery, useUpdateTutorMutation } from "../api/tutorApi";
import { useGetBatchQuery } from "../api/contentApi";
import { BatchContextCard } from "../components/BatchSwitcher";
import { TutorAgentIcon } from "../components/AgentIcons";
import TutorConsole from "../components/tutor/TutorConsole";
import SprintFields, { sprintStart, sprintBody, sprintReady } from "../components/tutor/SprintFields";
import { useBranding } from "../BrandingContext";

// The student's daily tutor: a short plan for today from their own
// results, ticked off from what they actually do, with a streak and an
// exam-sprint mode.
const ICON = { practice: Dumbbell, lecture: PlayCircle, exam: ClipboardList, plan: MapIcon };

export default function Tutor() {
  const { batchId } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data: batch } = useGetBatchQuery(batchId);
  const { data, isLoading, error } = useGetTutorQuery(batchId, { refetchOnFocus: true });
  const [update, { isLoading: saving }] = useUpdateTutorMutation();
  const [sprintOpen, setSprintOpen] = useState(false);
  const [sprint, setSprint] = useState(sprintStart(null));
  const [sprintError, setSprintError] = useState(null);

  const { tutorStyle = "console" } = useBranding() || {};
  const done = (data?.tasks || []).filter((t) => t.done).length;
  const total = (data?.tasks || []).length;

  return (
    <Box sx={{ maxWidth: 760, mx: "auto", pb: 6 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate(`/batches/${batchId}`)} sx={{ textTransform: "none" }}>Back</Button>
      </Stack>
      {batch && <BatchContextCard batch={batch} pageName="My tutor" />}

      {isLoading && <Skeleton variant="rounded" height={260} sx={{ mt: 2 }} />}
      {error && <Alert severity="info" sx={{ mt: 2 }}>{error.data?.message || "The tutor isn't available right now."}</Alert>}

      {data && tutorStyle === "console" && (
        <TutorConsole
          data={data}
          saving={saving}
          onGo={(link) => navigate(link)}
          onToggle={(enabled) => update({ batchId, enabled })}
          onSprint={(body) => update({ batchId, ...body })}
          onPlanSource={(planSource) => update({ batchId, planSource })}
        />
      )}

      {data && tutorStyle !== "console" && (
        <>
          <Paper sx={{ p: { xs: 2.5, sm: 3 }, mt: 2, borderRadius: 4, background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.14)}, ${alpha(theme.palette.secondary?.main || theme.palette.primary.main, 0.06)})` }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box sx={{ width: 44, height: 44, borderRadius: 3, display: "grid", placeItems: "center", bgcolor: alpha(theme.palette.primary.main, 0.18), color: "primary.main" }}><TutorAgentIcon size={24} /></Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>Today</Typography>
                <Typography variant="body2" color="text.secondary">{data.note || "Tutor is off."}</Typography>
              </Box>
              <Chip icon={<Flame size={16} />} label={`${data.streak} day${data.streak === 1 ? "" : "s"}`} color={data.streak ? "warning" : "default"} variant={data.streak ? "filled" : "outlined"} />
            </Stack>
            {data.enabled && total > 0 && (
              <Box sx={{ mt: 2 }}>
                <LinearProgress variant="determinate" value={(done / total) * 100} sx={{ height: 8, borderRadius: 4 }} />
                <Typography variant="caption" color="text.secondary">{done} of {total} done{data.bestStreak > 1 ? ` · best streak ${data.bestStreak} days` : ""}</Typography>
              </Box>
            )}
          </Paper>

          {data.enabled && (
            <Stack spacing={1.25} sx={{ mt: 2 }}>
              {data.tasks.map((t) => {
                const Icon = ICON[t.kind] || Target;
                return (
                  <Paper key={t.key} variant="outlined" sx={{ p: 2, borderRadius: 3, display: "flex", gap: 1.5, alignItems: "center", opacity: t.done ? 0.7 : 1, borderColor: t.done ? "success.main" : "divider" }}>
                    <Box sx={{ color: t.done ? "success.main" : "text.disabled", display: "flex" }}>{t.done ? <CheckCircle2 size={22} /> : <Circle size={22} />}</Box>
                    <Box sx={{ color: "primary.main", display: "flex" }}><Icon size={20} /></Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, textDecoration: t.done ? "line-through" : "none" }}>{t.title}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t.manual ? "Ticked by you" : <>{t.detail}{t.target > 1 && t.kind !== "lecture" ? ` · ${t.progress}/${t.target} ${t.unit || "questions"}${t.unit === "lectures" ? "" : " today"}` : ""}</>}
                      </Typography>
                    </Box>
                    {!t.done && <Button variant="contained" size="small" onClick={() => navigate(t.link)} sx={{ textTransform: "none", borderRadius: 5 }}>Go</Button>}
                  </Paper>
                );
              })}
              {!data.tasks.length && <Alert severity="success">Nothing to do today.</Alert>}
            </Stack>
          )}

          {data.enabled && data.plan && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2, borderRadius: 3, display: "flex", alignItems: "center", gap: 1.5, borderColor: data.plan.behind ? "warning.main" : "divider" }}>
              <MapIcon size={20} />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>Study plan</Typography>
                <Typography variant="body2" color="text.secondary">
                  {data.plan.paused ? "On hold until your exam" : data.plan.ended ? "Plan time is over" : data.plan.behind && data.plan.next ? `Next: Day ${data.plan.next} of ${data.plan.of}` : `Day ${data.plan.day} of ${data.plan.of}`}
                  {data.plan.behind ? ` · ${data.plan.behind} day${data.plan.behind === 1 ? "" : "s"} behind` : ""}
                </Typography>
                {data.planChoices?.length > 1 && (
                  <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: "wrap" }}>
                    {[["batch", "Batch plan"], ["archive", "Archive plan"]].map(([v, l]) => (
                      <Chip key={v} size="small" label={l} disabled={saving} color={data.plan.source === v ? "primary" : "default"} variant={data.plan.source === v ? "filled" : "outlined"} onClick={() => data.plan.source !== v && update({ batchId, planSource: v })} />
                    ))}
                  </Stack>
                )}
              </Box>
              <Button size="small" onClick={() => navigate(data.plan.link)} sx={{ textTransform: "none" }}>Open</Button>
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 2, mt: 2, borderRadius: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <CalendarClock size={20} />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>Exam sprint</Typography>
                <Typography variant="body2" color="text.secondary">
                  {data.sprint && data.sprint.daysLeft >= 0
                    ? `${data.sprint.daysLeft} day${data.sprint.daysLeft === 1 ? "" : "s"} to ${data.sprint.label || "your exam"}. In the last 3 weeks, tasks focus on the exam.`
                    : data.sprintEnded ? `The date for ${data.sprintEnded} has passed. Set your next exam.` : "Set your exam. In the last 3 weeks, tasks focus on the exam."}
                </Typography>
              </Box>
              <Button size="small" onClick={() => { setSprint(sprintStart(data.sprint)); setSprintOpen(!sprintOpen); }} sx={{ textTransform: "none" }}>{data.sprint ? "Change" : "Set date"}</Button>
            </Stack>
            {sprintOpen && (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
                <SprintFields options={data.sprintOptions} value={sprint} onChange={setSprint} />
                <Button variant="contained" disabled={saving || !sprintReady(sprint)} onClick={async () => { const r = await update({ batchId, ...sprintBody(sprint) }); if (r?.error) setSprintError(r.error.data?.message || "Could not save."); else { setSprintError(null); setSprintOpen(false); } }}>Save</Button>
                {data.sprint && <Button disabled={saving} onClick={async () => { await update({ batchId, sprintExamId: null, sprintDate: null, sprintLabel: "" }); setSprintOpen(false); }}>Clear</Button>}
              </Box>
            )}
            {sprintOpen && sprintError && <Alert severity="warning" sx={{ mt: 1.5 }}>{sprintError}</Alert>}
          </Paper>

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2, px: 0.5 }}>
            <Typography variant="body2" color="text.secondary">Daily plan: tasks every day, reminder in the evening</Typography>
            <Switch checked={data.enabled} disabled={saving} onChange={(e) => update({ batchId, enabled: e.target.checked })} />
          </Stack>
        </>
      )}
    </Box>
  );
}
