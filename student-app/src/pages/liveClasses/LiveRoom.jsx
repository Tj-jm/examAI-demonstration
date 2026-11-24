import { useEffect, useState } from "react";
import { Box, Button, Typography, CircularProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Hand, Mic, PenLine, NotebookPen } from "lucide-react";
import {
  LiveKitRoom, useLocalParticipant, useLocalParticipantPermissions,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { useGetLiveRoomTokenMutation } from "../../api/contentApi";
import LiveStage from "../../components/LiveStage";
import LiveBrandLayer, { PromoBar } from "../../components/LiveBrandLayer";
import { useLiveTools, QaButton, Spotlight, PollCard, RecIndicator, useCaptionFeed, CaptionsToggle, CaptionBar } from "../../components/LiveClassTools";
import LiveWhiteboard, { useWhiteboard } from "../../components/LiveWhiteboard";
import LiveWritingPad, { useWritingPad } from "../../components/LiveWritingPad";
import { useKeepAwake } from "../../native/keepAwake";
import { useReportQuality } from "../../components/liveQuality";

// The in-app classroom (live class provider "LiveKit"). Full screen, outside
// the app's own nav, like an exam. A class lets everyone use camera and mic;
// a webinar keeps students in the audience (watch, listen, chat) with a
// raise-hand button, until the host brings them on stage.

// A webinar student's hand, kept as a participant attribute so a host who
// joins later still sees it. Lowered by the host when they're brought on.
export function StageControls() {
  const { localParticipant } = useLocalParticipant();
  const perms = useLocalParticipantPermissions();
  const [raised, setRaised] = useState(false);

  useEffect(() => {
    const sync = () => setRaised(localParticipant.attributes?.hand === "1");
    sync();
    localParticipant.on("attributesChanged", sync);
    return () => { localParticipant.off("attributesChanged", sync); };
  }, [localParticipant]);

  if (perms?.canPublish) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.5, borderRadius: 5, bgcolor: "rgba(46, 160, 67, 0.25)", color: "#bdf5c8", fontSize: 14 }}>
        <Mic size={15} /> You're on stage — turn on your mic or camera below
      </Box>
    );
  }
  const toggle = () => localParticipant.setAttributes({ hand: raised ? "" : "1" }).catch(() => {});
  return (
    <Button
      size="small"
      variant={raised ? "contained" : "outlined"}
      color="warning"
      startIcon={<Hand size={16} />}
      onClick={toggle}
      sx={{ borderRadius: 5, textTransform: "none", ...(raised ? {} : { color: "#ffc66d", borderColor: "#ffc66d" }) }}
    >
      {raised ? "Hand raised — lower it" : "Raise hand"}
    </Button>
  );
}

// Everything inside the room (needs the room's context).
function RoomBody({ batchId, id, data, back }) {
  const tools = useLiveTools(batchId, id, data.recording);
  const board = useWhiteboard({ isHost: false });
  const [boardHidden, setBoardHidden] = useState(false);
  const pad = useWritingPad({ isHost: false });
  const [padHidden, setPadHidden] = useState(false);
  const captions = useCaptionFeed();
  const [showCaptions, setShowCaptions] = useState(true);
  useReportQuality();
  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1, borderBottom: "1px solid rgba(255,255,255,0.12)", flexWrap: "wrap" }}>
        <Button size="small" onClick={back} startIcon={<ArrowLeft size={16} />} sx={{ color: "inherit", textTransform: "none" }}>Leave</Button>
        {data.branding?.showLogo !== false && data.branding?.logo && <Box component="img" src={data.branding.logo} alt="" sx={{ height: 26, borderRadius: 1 }} />}
        <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>{data.title}</Typography>
        <RecIndicator on={tools.recording} />
        <Box sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, px: 1, py: 0.25, borderRadius: 1, bgcolor: "#e5484d", color: "#fff" }}>LIVE</Box>
        {board.state.open && (
          <Button size="small" variant={boardHidden ? "outlined" : "contained"} startIcon={<PenLine size={15} />} onClick={() => setBoardHidden(!boardHidden)}
            sx={{ borderRadius: 5, textTransform: "none", ...(boardHidden ? { color: "inherit", borderColor: "rgba(255,255,255,0.35)" } : {}) }}>
            {boardHidden ? "Show board" : board.state.canDraw ? "Board · you can draw" : "Board"}
          </Button>
        )}
        {pad.ui.open && (
          <Button size="small" variant={padHidden ? "outlined" : "contained"} startIcon={<NotebookPen size={15} />} onClick={() => setPadHidden(!padHidden)}
            sx={{ borderRadius: 5, textTransform: "none", ...(padHidden ? { color: "inherit", borderColor: "rgba(255,255,255,0.35)" } : {}) }}>
            {padHidden ? "Show pad" : "Writing pad"}
          </Button>
        )}
        <CaptionsToggle feed={captions} show={showCaptions} setShow={setShowCaptions} />
        <QaButton batchId={batchId} id={id} qa={tools.qa} />
        {data.mode === "webinar" && <StageControls />}
      </Box>
      <PromoBar branding={data.branding} />
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        <LiveStage stageOnly={data.mode === "webinar"} />
        <LiveBrandLayer branding={data.branding} nameMark />
        <LiveWhiteboard board={board} hidden={boardHidden} />
        <LiveWritingPad pad={pad} hidden={padHidden} />
        <Spotlight qa={tools.qa} />
        <PollCard batchId={batchId} id={id} poll={tools.poll} />
        <CaptionBar feed={captions} show={showCaptions} />
      </Box>
    </>
  );
}

export default function LiveRoom() {
  useKeepAwake();
  const { batchId, id } = useParams();
  const navigate = useNavigate();
  const [getToken, { data, error, isLoading }] = useGetLiveRoomTokenMutation();
  const back = () => navigate(`/batches/${batchId}/live-classes/${id}`);

  useEffect(() => {
    getToken({ batchId, id });
  }, [getToken, batchId, id]);

  // Not started yet: check again every 10 seconds and let them in once a
  // teacher opens the class.
  const waiting = Boolean(error?.data?.waiting);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => getToken({ batchId, id }), 10000);
    return () => clearInterval(timer);
  }, [waiting, getToken, batchId, id]);

  if (error) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        {waiting && <CircularProgress size={24} sx={{ mb: 2 }} />}
        <Typography sx={{ mb: 2 }}>{error.data?.message || "Couldn't open the classroom."}</Typography>
        <Button variant="outlined" onClick={back}>Back</Button>
      </Box>
    );
  }
  if (isLoading || !data) {
    return <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}><CircularProgress size={28} /></Box>;
  }

  return (
    <LiveKitRoom
      serverUrl={data.url}
      token={data.token}
      connect
      video={false}
      audio={false}
      onDisconnected={back}
      data-lk-theme="default"
      style={{ height: "100dvh", display: "flex", flexDirection: "column", ...(data.branding?.accentColor ? { "--lk-accent-bg": data.branding.accentColor } : {}) }}
    >
      <RoomBody batchId={batchId} id={id} data={data} back={back} />
    </LiveKitRoom>
  );
}
