import { useEffect, useRef, useState } from "react";
import {
  useTracks, useCreateLayoutContext, usePinnedTracks, LayoutContextProvider, GridLayout, ParticipantTile,
  FocusLayoutContainer, CarouselLayout, FocusLayout, ControlBar, Chat, RoomAudioRenderer, ConnectionStateToast,
  isTrackReference, useRoomContext,
} from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";

// LiveKit's ready-made conference layout, with one change for webinars:
// only people on stage get a tile. A webinar's audience can't use camera or
// mic, so tiling every viewer would fill the screen with empty boxes.
// Screen shares take the main spot automatically, as in the original.
// The host's whiteboard feed (LiveBoardFeed.js, for the recording only) is
// never shown or downloaded here: everyone already sees the board itself.
const same = (a, b) => a && b && a.participant.identity === b.participant.identity && a.source === b.source;

export const BOARD_FEED = "whiteboard";

export default function LiveStage({ stageOnly = false }) {
  const room = useRoomContext();
  useEffect(() => {
    const skip = (pub) => { if (pub.trackName === BOARD_FEED && pub.setSubscribed) pub.setSubscribed(false); };
    room.remoteParticipants.forEach((p) => p.trackPublications.forEach(skip));
    room.on(RoomEvent.TrackPublished, skip);
    return () => { room.off(RoomEvent.TrackPublished, skip); };
  }, [room]);
  const [widget, setWidget] = useState({ showChat: false, unreadMessages: 0 });
  const autoFocused = useRef(null);
  const all = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantPermissionsChanged], onlySubscribed: false },
  );
  const shown = all.filter((t) => t.publication?.trackName !== BOARD_FEED);
  const tracks = stageOnly ? shown.filter((t) => t.participant.permissions?.canPublish) : shown;
  const layout = useCreateLayoutContext();
  const screens = tracks.filter(isTrackReference).filter((t) => t.publication.source === Track.Source.ScreenShare);
  const focus = usePinnedTracks(layout)?.[0];
  const carousel = tracks.filter((t) => !same(t, focus));

  useEffect(() => {
    if (screens.some((t) => t.publication.isSubscribed) && !autoFocused.current) {
      layout.pin.dispatch?.({ msg: "set_pin", trackReference: screens[0] });
      autoFocused.current = screens[0];
    } else if (autoFocused.current && !screens.some((t) => t.publication.trackSid === autoFocused.current.publication?.trackSid)) {
      layout.pin.dispatch?.({ msg: "clear_pin" });
      autoFocused.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens.map((t) => `${t.publication.trackSid}_${t.publication.isSubscribed}`).join()]);

  return (
    <div className="lk-video-conference">
      <LayoutContextProvider value={layout} onWidgetChange={setWidget}>
        <div className="lk-video-conference-inner">
          {!focus ? (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}><ParticipantTile /></GridLayout>
            </div>
          ) : (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <CarouselLayout tracks={carousel}><ParticipantTile /></CarouselLayout>
                <FocusLayout trackRef={focus} />
              </FocusLayoutContainer>
            </div>
          )}
          <ControlBar controls={{ chat: true }} />
        </div>
        <Chat style={{ display: widget.showChat ? "grid" : "none" }} />
      </LayoutContextProvider>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
