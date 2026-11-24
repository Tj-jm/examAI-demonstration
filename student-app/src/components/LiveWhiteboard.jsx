import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRoomContext, useConnectionState } from "@livekit/components-react";
import { RoomEvent, ConnectionState } from "livekit-client";

// A shared whiteboard for the in-app classroom, synced over the room's
// data channel (topic "wb"). The host opens it for everyone, chooses
// whether students may draw, and can save it as an image. Each drawing
// change sends only the shapes that changed; whoever joins late asks the
// host for the whole board. A host who rejoins (a reload, a dropped
// connection) gets the board back from a student, so it can still edit
// and erase what everyone sees. Plain styles so both apps share this file.

const Canvas = lazy(() => import("./LiveBoardCanvas"));
const enc = new TextEncoder();
const dec = new TextDecoder();
const CHUNK = 12000; // characters per data message, well under LiveKit's limit

const roleOf = (p) => {
  try {
    return JSON.parse(p?.metadata || "{}").role || "";
  } catch {
    return "";
  }
};

// Splits a list of shapes into messages small enough to send.
const chunks = (elements) => {
  const out = [];
  let batch = [];
  let size = 0;
  for (const el of elements) {
    const s = JSON.stringify(el).length;
    if (batch.length && size + s > CHUNK) {
      out.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(el);
    size += s;
  }
  if (batch.length) out.push(batch);
  return out;
};

export function useWhiteboard({ isHost }) {
  const room = useRoomContext();
  const [state, setState] = useState({ open: false, canDraw: false });
  const apiRef = useRef(null);
  // The board on screen, for the recording feed. State, not a ref: the
  // board mounts after it opens, and the feed must start once it's there.
  const [box, boxRef] = useState(null);
  const helpers = useRef(null);
  const sent = useRef(new Map()); // shape id → last version sent or received
  const pending = useRef([]); // shapes that arrived before the canvas loaded

  // Messages from the room, with LiveKit's own record of who sent them.
  const onData = useRef(null);
  onData.current = (payload, from, topic) => {
    if (topic !== "wb") return;
    let data;
    try {
      data = JSON.parse(dec.decode(payload));
    } catch {
      return;
    }
    const fromHost = roleOf(from) === "host";
    if (data.t === "state" && fromHost) {
      synced.current = true;
      setState({ open: data.open, canDraw: data.canDraw });
    }
    // The host rejoined and lost its board: one student hands it back.
    if (data.t === "recover" && fromHost && !isHost && from?.identity) {
      const to = [from.identity];
      publish({ t: "rstate", open: stateRef.current.open, canDraw: stateRef.current.canDraw }, to);
      const all = apiRef.current?.getSceneElementsIncludingDeleted() || pending.current;
      for (const c of chunks(all)) publish({ t: "el", els: c, r: true }, to);
      return;
    }
    if (data.t === "rstate" && isHost && !recovered.current) {
      recovered.current = true;
      if (data.open) setBoard({ open: true, canDraw: data.canDraw });
      return;
    }
    // The host wiped the board: drop everything, whoever drew it.
    if (data.t === "clear" && fromHost) {
      wipe();
      return;
    }
    const asker = from?.identity || data.id;
    if (data.t === "hello" && isHost && asker) {
      // Someone joined late: send them the board as it is. (A brand-new
      // participant may not be known yet, so the request names itself.)
      const to = [asker];
      publish({ t: "state", open: stateRef.current.open, canDraw: stateRef.current.canDraw }, to);
      const all = apiRef.current?.getSceneElementsIncludingDeleted() || pending.current;
      for (const c of chunks(all)) publish({ t: "el", els: c }, to);
    }
    if (data.t === "el" && (fromHost || stateRef.current.canDraw || (isHost && data.r))) merge(data.els);
  };
  useEffect(() => {
    const handler = (payload, participant, kind, topic) => onData.current(payload, participant, topic);
    room.on(RoomEvent.DataReceived, handler);
    return () => { room.off(RoomEvent.DataReceived, handler); };
  }, [room]);

  const stateRef = useRef(state);
  stateRef.current = state;

  const publish = useCallback((obj, to) => {
    room.localParticipant
      .publishData(enc.encode(JSON.stringify(obj)), { reliable: true, topic: "wb", ...(to ? { destinationIdentities: to } : {}) })
      .catch(() => {});
  }, [room]);

  // Excalidraw loads its starting content a moment after it hands over its
  // API; anything merged before its first change event would be wiped.
  const ready = useRef(false);
  const merge = (incoming) => {
    const api = apiRef.current;
    if (!api || !ready.current) {
      pending.current.push(...incoming);
      return;
    }
    const local = new Map(api.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
    let changed = false;
    for (const el of incoming) {
      const mine = local.get(el.id);
      if (!mine || el.version > mine.version || (el.version === mine.version && el.versionNonce < mine.versionNonce)) {
        local.set(el.id, el);
        changed = true;
      }
      sent.current.set(el.id, Math.max(sent.current.get(el.id) ?? -1, el.version));
    }
    if (changed) api.updateScene({ elements: [...local.values()], captureUpdate: helpers.current?.never });
  };

  // Students ask for the board once connected, and keep asking for a little
  // while until the host answers (the host may still be joining too).
  const connection = useConnectionState();
  const synced = useRef(false);
  useEffect(() => {
    if (isHost || connection !== ConnectionState.Connected) return undefined;
    synced.current = false;
    let tries = 0;
    const ask = () => {
      if (synced.current || tries >= 8) return;
      tries += 1;
      publish({ t: "hello", id: room.localParticipant.identity });
      timer = setTimeout(ask, 2000);
    };
    let timer = setTimeout(ask, 500);
    return () => clearTimeout(timer);
  }, [isHost, connection, publish, room]);

  // Host: once connected, ask one student for the board in case this is a
  // rejoin. Nobody has one on a fresh start, and nothing happens.
  const recovered = useRef(false);
  useEffect(() => {
    if (!isHost || connection !== ConnectionState.Connected) return undefined;
    let tries = 0;
    let timer;
    const ask = () => {
      if (recovered.current || tries >= 3) return;
      const students = [...room.remoteParticipants.values()].filter((p) => roleOf(p) !== "host").map((p) => p.identity).sort();
      const who = students[tries];
      tries += 1;
      if (who) publish({ t: "recover" }, [who]);
      timer = setTimeout(ask, 2500);
    };
    timer = setTimeout(ask, 1200);
    return () => clearTimeout(timer);
  }, [isHost, connection, publish, room]);

  // Marks every shape deleted (a newer version, so it wins everywhere).
  const wipe = () => {
    const api = apiRef.current;
    pending.current = [];
    if (!api) return;
    const all = api.getSceneElementsIncludingDeleted().map((e) =>
      e.isDeleted ? e : { ...e, isDeleted: true, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() }
    );
    for (const e of all) sent.current.set(e.id, e.version);
    api.updateScene({ elements: all, captureUpdate: helpers.current?.never });
  };
  // Host: clear the board for everyone, including anything the host's own
  // copy doesn't have.
  const clearAll = () => {
    wipe();
    publish({ t: "clear" });
  };

  const setBoard = (next) => {
    const s = { ...stateRef.current, ...next };
    setState(s);
    publish({ t: "state", open: s.open, canDraw: s.canDraw });
  };

  const timer = useRef(null);
  // Pending shapes go in once the board has both handed over its API and
  // finished loading, whichever happens last.
  const flush = () => {
    if (apiRef.current && ready.current && pending.current.length) merge(takePending());
  };
  const onChange = (elements) => {
    if (!ready.current) {
      ready.current = true;
      setTimeout(flush, 0);
    }
    if (!isHost && !stateRef.current.canDraw) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const changed = elements.filter((e) => (sent.current.get(e.id) ?? -1) < e.version);
      if (!changed.length) return;
      for (const e of changed) sent.current.set(e.id, e.version);
      for (const c of chunks(changed)) publish({ t: "el", els: c });
    }, 120);
  };

  // Shapes that arrived before the board was ready, handed over once.
  const takePending = () => {
    const p = pending.current;
    pending.current = [];
    for (const el of p) sent.current.set(el.id, Math.max(sent.current.get(el.id) ?? -1, el.version));
    return p;
  };
  const onApi = (api, h) => {
    apiRef.current = api;
    helpers.current = h;
    // A view-only board may never change by itself: treat it as loaded
    // shortly after it starts.
    setTimeout(() => {
      ready.current = true;
      flush();
    }, 700);
  };

  // The board as a PNG (for saving).
  const toBlob = async () => {
    const api = apiRef.current;
    if (!api || !helpers.current) return null;
    const elements = api.getSceneElements();
    if (!elements.length) return null;
    return helpers.current.exportToBlob({
      elements,
      appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
      files: api.getFiles(),
      mimeType: "image/png",
    });
  };

  return { state, setBoard, onChange, onApi, toBlob, takePending, clearAll, room, box, boxRef };
}

// The board over the stage, when open. `hidden` lets someone look at the
// video instead without closing it for everyone.
// Once opened it stays loaded (only hidden), so closing or hiding it
// never loses the drawing.
export default function LiveWhiteboard({ board, isHost, hidden, toolbar }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (board.state.open) setLoaded(true);
  }, [board.state.open]);
  if (!loaded) return null;
  const viewOnly = !isHost && !board.state.canDraw;
  return (
    <div ref={board.boxRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 72, zIndex: 4, background: "#fff", borderRadius: 8, overflow: "hidden", display: board.state.open && !hidden ? "block" : "none" }}>
      <Suspense fallback={<div style={{ padding: 24, color: "#555" }}>Opening the whiteboard…</div>}>
        <Canvas onApi={board.onApi} onChange={board.onChange} viewOnly={viewOnly} />
      </Suspense>
      {toolbar && <div style={{ position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", zIndex: 10, display: "flex", gap: 6, padding: 6, borderRadius: 999, background: "rgba(20,22,26,0.9)", color: "#fff", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}>{toolbar}</div>}
    </div>
  );
}
