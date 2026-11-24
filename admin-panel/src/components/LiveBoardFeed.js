import { useEffect } from "react";
import { useLocalParticipant } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";
import { BOARD_FEED } from "./LiveStage";

// While the class is recorded and the whiteboard is open, the host sends the
// board as a screen share named "whiteboard", so the recording shows it big
// with the cameras beside it, as a screen share would be. Everyone in the
// class skips this feed (LiveStage.jsx): they see the board itself. A real
// screen share wins; the board feed waits until it ends.
const W = 1280;
const H = 720;

export default function useBoardFeed({ board, on }) {
  const { localParticipant } = useLocalParticipant();
  const sharing = [...localParticipant.trackPublications.values()].some(
    (p) => p.source === Track.Source.ScreenShare && p.trackName !== BOARD_FEED,
  );
  const live = on && !sharing;
  const room = board.room;
  const box = board.box;

  useEffect(() => {
    if (!live || !box) return undefined;
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const ctx = out.getContext("2d");
    // Excalidraw draws on a few stacked canvases; paint them all, fitted
    // into the frame on white.
    const draw = () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, H);
      const area = box.getBoundingClientRect();
      if (!area.width || !area.height) return;
      const s = Math.min(W / area.width, H / area.height);
      const ox = (W - area.width * s) / 2;
      const oy = (H - area.height * s) / 2;
      for (const c of box.querySelectorAll("canvas")) {
        const r = c.getBoundingClientRect();
        if (!r.width || !c.width) continue;
        try {
          ctx.drawImage(c, ox + (r.left - area.left) * s, oy + (r.top - area.top) * s, r.width * s, r.height * s);
        } catch { /* a canvas mid-resize */ }
      }
    };
    draw();
    const timer = setInterval(draw, 100);
    const track = out.captureStream(10).getVideoTracks()[0];
    let published = false;
    let done = false;
    room.localParticipant
      .publishTrack(track, { source: Track.Source.ScreenShare, name: BOARD_FEED, simulcast: false })
      .then(() => {
        published = true;
        if (done) room.localParticipant.unpublishTrack(track).catch(() => {});
      })
      .catch(() => {});
    // The share-screen button sees this feed as a share and stops it when
    // pressed: the host meant to share their screen, so start that.
    const onGone = (pub) => {
      if (done || pub.trackName !== BOARD_FEED) return;
      published = false;
      room.localParticipant.setScreenShareEnabled(true).catch(() => {});
    };
    room.on(RoomEvent.LocalTrackUnpublished, onGone);
    return () => {
      done = true;
      room.off(RoomEvent.LocalTrackUnpublished, onGone);
      clearInterval(timer);
      if (published) room.localParticipant.unpublishTrack(track).catch(() => {});
      track.stop();
    };
  }, [live, room, box]);
}
