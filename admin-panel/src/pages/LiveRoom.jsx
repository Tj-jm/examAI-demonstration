import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Hand, Mic, MicOff, Video, VideoOff, MonitorUp, MonitorOff, UserMinus, Users, Square, Megaphone, ArrowUpFromLine, ArrowDownToLine,
  PenLine, EyeOff, Save, X, Pencil, Eraser, NotebookPen,
} from "lucide-react";
import { LiveKitRoom, useParticipants, useRoomContext } from "@livekit/components-react";
import { useReportQuality } from "../components/liveQuality";
import { RoomEvent } from "livekit-client";
import "@livekit/components-styles";
import {
  useGetLiveRoomTokenMutation, useSetLiveSpeakerMutation, useRemoveLiveParticipantMutation, useEndLiveClassMutation,
  useSetLivePermissionsMutation, useMuteLiveParticipantMutation, useMuteLiveAllMutation, useUpdateLiveRoomSettingsMutation, useGetLiveClassQuery } from "../api/contentApi";
import { useConfirm, ConfirmProvider } from "../components/bits";
import LiveStage from "../components/LiveStage";
import LiveBrandLayer, { PromoBar } from "../components/LiveBrandLayer";
import { useHostTools, QaTab, PollsTab } from "../components/LiveHostTools";
import LiveWhiteboard, { useWhiteboard } from "../components/LiveWhiteboard";
import useBoardFeed from "../components/LiveBoardFeed";
import LiveWritingPad, { useWritingPad } from "../components/LiveWritingPad";
import LivePadImport, { usePadNotes } from "../components/LivePadImport";
import { useCaptions, CaptionsButton, CaptionPreview } from "../components/LiveCaptions";
import {
  useUploadMediaMutation, useSaveLiveBoardMutation, useGetLiveRecordingsQuery, useStartLiveRecordingMutation, useStopLiveRecordingMutation,
} from "../api/contentApi";

// The host's side of the in-app classroom (live class provider "LiveKit").
// Same room the students see, plus a people panel: raised hands first, who
// has mic, camera or screen on; mute or turn them off; allow or stop each
// one's mic, camera and screen; bring someone on stage (webinar); remove;
// mute everyone; who may share their screen; end the class.

const roleOf = (p) => {
  try {
    return JSON.parse(p.metadata || "{}").role || "";
  } catch {
    return "";
  }
};

// livekit-client TrackSource numbers: 1 camera, 2 microphone, 3 screen.
const rightsOf = (p) => {
  const perm = p.permissions;
  if (!perm?.canPublish) return { camera: false, mic: false, screen: false };
  const s = perm.canPublishSources || [];
  if (!s.length) return { camera: true, mic: true, screen: true };
  return { camera: s.includes(1), mic: s.includes(2), screen: s.includes(3) };
};

function PersonRow({ p, id, mode, screenShare, busy, act }) {
  const [setSpeaker] = useSetLiveSpeakerMutation();
  const [setPermissions] = useSetLivePermissionsMutation();
  const [mute] = useMuteLiveParticipantMutation();
  const [removeParticipant] = useRemoveLiveParticipantMutation();
  const rights = rightsOf(p);
  const onStage = rights.camera || rights.mic || rights.screen;
  const live = { mic: p.isMicrophoneEnabled, camera: p.isCameraEnabled, screen: p.isScreenShareEnabled };
  const toggle = (key) => act(p.identity, () => setPermissions({ id, identity: p.identity, ...rights, [key]: !rights[key] }));
  const off = (source) => act(p.identity, () => mute({ id, identity: p.identity, source }));

  return (
    <div className={`live-person ${p.isSpeaking ? "speaking" : ""}`}>
      <div className="row-tight" style={{ gap: 6 }}>
        <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.attributes?.hand === "1" && <Hand size={13} style={{ color: "var(--warning)", marginRight: 4, verticalAlign: -2 }} />}
          {p.name || p.identity}
        </span>
        {roleOf(p) === "guest" && <span className="pill" title="Joined from the public webinar link">Guest</span>}
        {live.mic && <button className="icon-btn" disabled={busy} title="Mute mic" onClick={() => off("mic")}><MicOff size={14} /></button>}
        {live.camera && <button className="icon-btn" disabled={busy} title="Turn camera off" onClick={() => off("camera")}><VideoOff size={14} /></button>}
        {live.screen && (
          <button className="icon-btn" disabled={busy} title="Stop screen share" onClick={() => act(p.identity, () => setPermissions({ id, identity: p.identity, ...rights, screen: false }))}>
            <MonitorOff size={14} />
          </button>
        )}
        <button className="icon-btn icon-btn-danger" disabled={busy} title={roleOf(p) === "guest" ? "Remove and ban from this webinar" : "Remove from class"} onClick={() => act(p.identity, () => removeParticipant({ id, identity: p.identity }))}>
          <UserMinus size={14} />
        </button>
      </div>
      <div className="row-tight live-rights">
        {mode === "webinar" && (
          <button
            className={`live-right ${onStage ? "on" : ""}`}
            disabled={busy}
            title={onStage ? "Send back to the audience" : "Bring on stage"}
            onClick={() => act(p.identity, () => setSpeaker({ id, identity: p.identity, canSpeak: !onStage }))}
          >
            {onStage ? <ArrowDownToLine size={12} /> : <ArrowUpFromLine size={12} />} {onStage ? "On stage" : "Audience"}
          </button>
        )}
        {(mode === "class" || onStage) && (
          <>
            <button className={`live-right ${rights.mic ? "on" : ""}`} disabled={busy} title={rights.mic ? "Block mic" : "Allow mic"} onClick={() => toggle("mic")}>
              {rights.mic ? <Mic size={12} /> : <MicOff size={12} />} Mic
            </button>
            <button className={`live-right ${rights.camera ? "on" : ""}`} disabled={busy} title={rights.camera ? "Block camera" : "Allow camera"} onClick={() => toggle("camera")}>
              {rights.camera ? <Video size={12} /> : <VideoOff size={12} />} Cam
            </button>
            <button className={`live-right ${rights.screen ? "on" : ""}`} disabled={busy} title={rights.screen ? "Stop letting them share their screen" : "Let them share their screen"} onClick={() => toggle("screen")}>
              <MonitorUp size={12} /> Screen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PeoplePanel({ id, mode, screenShare: initialShare, onEnd }) {
  const participants = useParticipants({
    updateOnlyOn: [
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantPermissionsChanged, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
    ],
  });
  const [muteAll, { isLoading: mutingAll }] = useMuteLiveAllMutation();
  const [saveSettings] = useUpdateLiveRoomSettingsMutation();
  const [screenShare, setScreenShare] = useState(initialShare || "hosts");
  const [busy, setBusy] = useState(null);

  // Public webinar guests sit with the students (an audience of their own).
  const students = participants.filter((p) => ["student", "guest"].includes(roleOf(p)));
  const hands = students.filter((p) => p.attributes?.hand === "1");
  const others = participants.filter((p) => !["student", "guest"].includes(roleOf(p)));
  const sorted = [...hands, ...students.filter((p) => p.attributes?.hand !== "1")];

  const act = async (identity, fn) => {
    setBusy(identity);
    await fn().unwrap().catch(() => {});
    setBusy(null);
  };

  return (
    <aside className="live-people">
      <strong className="row-tight" style={{ gap: 6 }}><Users size={15} /> People · {participants.length}</strong>
      <div className="live-tools">
        <label className="row-tight" style={{ gap: 6, justifyContent: "space-between" }}>
          <span className="small">Screen share</span>
          <select
            className="live-select"
            value={screenShare}
            onChange={async (e) => {
              const value = e.target.value;
              setScreenShare(value);
              await saveSettings({ id, screenShare: value }).unwrap().catch(() => setScreenShare(screenShare));
            }}
          >
            <option value="hosts">Hosts only</option>
            <option value="everyone">{mode === "webinar" ? "Hosts + people on stage" : "Everyone"}</option>
          </select>
        </label>
        <button className="live-tool" disabled={mutingAll || !students.length} onClick={() => muteAll({ id, source: "mic" })}>
          <MicOff size={13} /> Mute all students
        </button>
      </div>
      {hands.length > 0 && <div className="pill pill-warn" style={{ alignSelf: "flex-start" }}><Hand size={12} /> {hands.length} hand{hands.length === 1 ? "" : "s"} up</div>}
      <div className="stack" style={{ gap: 6 }}>
        {others.map((p) => (
          <div key={p.identity} className="live-person">
            <div className="row-tight"><span className="grow">{p.name || p.identity}{p.isLocal ? " (you)" : ""}</span><span className="pill">Host</span></div>
          </div>
        ))}
        {sorted.map((p) => (
          <PersonRow key={p.identity} p={p} id={id} mode={mode} screenShare={screenShare} busy={busy === p.identity} act={act} />
        ))}
        {students.length === 0 && <p className="hint" style={{ margin: 0 }}>No students yet.</p>}
      </div>
      {onEnd && (
        <button className="btn btn-danger" style={{ marginTop: "auto" }} onClick={onEnd}>
          <Square size={14} /> End class for everyone
        </button>
      )}
    </aside>
  );
}

// padNotes: the writing pad's pages are saved as class notes first, when
// they changed since the last save.
function useEndClass(id, padNotes) {
  const room = useRoomContext();
  const confirm = useConfirm();
  const [end] = useEndLiveClassMutation();
  return async () => {
    const unsaved = padNotes?.dirty();
    const yes = await confirm({
      title: "End this class?",
      body: `Everyone is disconnected and the class is marked ended.${unsaved ? " The writing pad's pages are saved as class notes first." : ""}`,
      confirmLabel: "End class",
      tone: "danger",
    });
    if (!yes) return;
    if (unsaved && !(await padNotes.save())) {
      const anyway = await confirm({ title: "The notes weren't saved", body: "The writing pad's pages couldn't be saved. End the class anyway? They will be lost.", confirmLabel: "End anyway", tone: "danger" });
      if (!anyway) return;
    }
    await end(id).unwrap().catch(() => {});
    room.disconnect();
  };
}

function BoardToolbar({ id, board, onHide }) {
  const [upload, { isLoading: uploading }] = useUploadMediaMutation();
  const [saveBoard, { isLoading: saving }] = useSaveLiveBoardMutation();
  const [saved, setSaved] = useState(false);
  const confirm = useConfirm();
  const save = async () => {
    const blob = await board.toBlob();
    if (!blob) return;
    const file = new File([blob], `whiteboard-${Date.now()}.png`, { type: "image/png" });
    const media = await upload({ file, folder: "boards" }).unwrap().catch(() => null);
    if (media?.url) {
      await saveBoard({ id, url: media.url }).unwrap().catch(() => {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };
  return (
    <>
      <button className={`live-right ${board.state.canDraw ? "on" : ""}`} onClick={() => board.setBoard({ canDraw: !board.state.canDraw })}>
        <Pencil size={12} /> {board.state.canDraw ? "Students can draw" : "Only you draw"}
      </button>
      <button className="live-right" disabled={uploading || saving} onClick={save}><Save size={12} /> {saved ? "Saved" : uploading || saving ? "Saving…" : "Save image"}</button>
      <button className="live-right" onClick={async () => {
        if (await confirm({ title: "Clear the board for everyone?", body: "Everything on it is erased for every student. Save an image first if you want to keep it.", confirmLabel: "Clear" })) board.clearAll();
      }}><Eraser size={12} /> Clear</button>
      <button className="live-right" onClick={onHide}><EyeOff size={12} /> Hide for me</button>
      <button className="live-right" onClick={() => board.setBoard({ open: false })}><X size={12} /> Close for everyone</button>
    </>
  );
}

// Record / stop, with how long it's been recording.
function RecordButton({ id }) {
  const { data } = useGetLiveRecordingsQuery(id, { pollingInterval: 15000 });
  const [start, { isLoading: starting, error }] = useStartLiveRecordingMutation();
  const [stop, { isLoading: stopping }] = useStopLiveRecordingMutation();
  const [now, setNow] = useState(Date.now());
  const active = (data?.recordings || []).find((r) => r.status === "recording");
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const secs = active ? Math.max(0, Math.floor((now - new Date(active.startedAt)) / 1000)) : 0;
  return (
    <>
      {active ? (
        <button className="live-right live-rec" disabled={stopping} onClick={() => stop(id)} title="Stop recording">
          <span className="live-rec-dot" /> REC {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} · Stop
        </button>
      ) : (
        <button className="live-right" disabled={starting} onClick={() => start(id)} title="Record the class">
          <span className="live-rec-dot off" /> {starting ? "Starting…" : "Record"}
        </button>
      )}
      {error && <span className="small" style={{ color: "#ff8a8a", maxWidth: 260 }} title={error.data?.message}>Recording unavailable</span>}
    </>
  );
}

function HostRoom({ id, data, back }) {
  useReportQuality();
  const tools = useHostTools(id);
  const board = useWhiteboard({ isHost: true });
  const captions = useCaptions(id);
  const [boardHidden, setBoardHidden] = useState(false);
  const pad = useWritingPad({ isHost: true });
  const padNotes = usePadNotes(id, pad);
  const onEnd = useEndClass(id, padNotes);
  const [padHidden, setPadHidden] = useState(false);
  const confirm = useConfirm();
  const { data: recs } = useGetLiveRecordingsQuery(id, { pollingInterval: 15000 });
  const recording = (recs?.recordings || []).some((r) => r.status === "recording");
  // The board, or the writing pad over it, goes into the recording while
  // it's open on the host's screen.
  const padShown = pad.ui.open && !padHidden;
  const boardShown = board.state.open && !boardHidden;
  useBoardFeed({ board: padShown ? pad : board, on: recording && (padShown || boardShown) });
  const [tab, setTab] = useState("people");
  const waiting = (tools.qa.data?.questions || []).filter((q) => ["open", "pending"].includes(q.status)).length;
  const livePoll = (tools.polls.data?.polls || [])[0]?.status === "open";
  const branding = data.branding || {};
  return (
    <>
    <header className="live-head">
      <button className="live-leave" onClick={back}><ArrowLeft size={14} /> Leave</button>
      {branding.showLogo !== false && branding.logo && <img src={branding.logo} alt="" style={{ height: 24, borderRadius: 4 }} />}
      <strong className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.title}</strong>
      <button
        className={`live-right ${board.state.open ? "on" : ""}`}
        onClick={() => {
          if (board.state.open && boardHidden) setBoardHidden(false);
          else {
            board.setBoard({ open: !board.state.open });
            setBoardHidden(false);
          }
        }}
      >
        <PenLine size={12} /> {board.state.open ? (boardHidden ? "Show board" : "Whiteboard on") : "Whiteboard"}
      </button>
      <button
        className={`live-right ${pad.ui.open ? "on" : ""}`}
        onClick={() => {
          if (pad.ui.open && padHidden) setPadHidden(false);
          else {
            pad.setOpen(!pad.ui.open);
            setPadHidden(false);
          }
        }}
      >
        <NotebookPen size={12} /> {pad.ui.open ? (padHidden ? "Show pad" : "Writing pad on") : "Writing pad"}
      </button>
      <CaptionsButton captions={captions} />
      {data.can?.record !== false && <RecordButton id={id} />}
      {branding.promoText && <span className="pill" title="Students see this promo line"><Megaphone size={12} /> Promo on</span>}
      <span className="live-badge">LIVE</span>
      <span className="pill">{data.mode === "webinar" ? "Webinar" : "Class"}</span>
    </header>
    <PromoBar branding={branding} />
    <div className="live-room-body">
      <div className="live-stage">
        <LiveStage stageOnly={data.mode === "webinar"} />
        <LiveBrandLayer branding={data.branding} showWaiting={false} />
        <CaptionPreview captions={captions} />
        <LiveWhiteboard board={board} isHost hidden={boardHidden} toolbar={<BoardToolbar id={id} board={board} onHide={() => setBoardHidden(true)} />} />
        <LiveWritingPad pad={pad} isHost hidden={padHidden} confirm={confirm} onHide={() => setPadHidden(true)} tools={<LivePadImport pad={pad} active={padShown} notes={padNotes} />} />
      </div>
      <div className="live-side">
        <div className="live-tabs">
          <button className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>People</button>
          <button className={tab === "qa" ? "on" : ""} onClick={() => setTab("qa")}>Q&A{waiting ? <span className="live-count">{waiting}</span> : null}</button>
          <button className={tab === "polls" ? "on" : ""} onClick={() => setTab("polls")}>Polls{livePoll ? <span className="live-count">live</span> : null}</button>
        </div>
        <div style={{ display: tab === "people" ? "contents" : "none" }}>
          <PeoplePanel id={id} mode={data.mode} screenShare={data.screenShare} onEnd={data.can?.end !== false ? onEnd : null} />
        </div>
        {tab === "qa" && <div className="live-people"><QaTab id={id} qa={tools.qa} /></div>}
        {tab === "polls" && <div className="live-people"><PollsTab id={id} polls={tools.polls} /></div>}
      </div>
    </div>
    </>
  );
}

// The room page sits outside the admin layout, so it brings its own
// confirm dialogs (end class, remove someone).
export default function LiveRoom() {
  return (
    <ConfirmProvider>
      <LiveRoomPage />
    </ConfirmProvider>
  );
}

function LiveRoomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: liveClassInfo } = useGetLiveClassQuery(id);
  // A webinar goes back to Webinars, else Live classes.
  const backTo = liveClassInfo?.kind === "webinar" ? { to: "/webinars", label: "Webinars" } : { to: "/live-classes", label: "Live classes" };
  const [getToken, { data, error, isLoading }] = useGetLiveRoomTokenMutation();
  const back = () => navigate(backTo.to);

  useEffect(() => {
    getToken(id);
  }, [getToken, id]);

  if (error) {
    return (
      <div className="page stack" style={{ alignItems: "center", paddingTop: 80 }}>
        <p>{error.data?.message || "Couldn't open the classroom."}</p>
        <button className="btn" onClick={back}>Back to live classes</button>
      </div>
    );
  }
  if (isLoading || !data) return <div className="page muted">Opening the classroom…</div>;
  const branding = data.branding || {};
  return (
    <LiveKitRoom
      serverUrl={data.url}
      token={data.token}
      connect
      video
      audio
      onDisconnected={back}
      data-lk-theme="default"
      className="live-room"
      style={branding.accentColor ? { "--lk-accent-bg": branding.accentColor } : undefined}
    >
      <HostRoom id={id} data={data} back={back} />
    </LiveKitRoom>
  );
}
