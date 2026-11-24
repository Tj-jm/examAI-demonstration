// Turns a host's choice of provider into an actual joinable meeting.
//
// "manual" trusts a url the host already has from Zoom, Meet, Teams, or
// anything else — no credentials, no API call, works everywhere on day
// one. "zoom" calls Zoom's REST API directly (Server-to-Server OAuth, raw
// fetch — no vendor SDK, matching every other adapter in this folder) to
// create a real meeting and get back distinct student/host urls plus an
// id a later webhook can be matched against.
//
// Both providers expose the same three things:
//   configured()
//   createMeeting({ title, scheduledAt, durationMinutes, joinUrl }) -> { joinUrl, hostUrl, externalId }
//   endMeeting(externalId)

// -------------------------------------------------------------- manual
const crypto = require("crypto");

const manual = {
  name: "manual",
  label: "Manual link (Zoom, Meet, Teams, etc.)",

  configured() {
    return true;
  },

  // The host already created the meeting themself and pasted the link in.
  // joinUrl and hostUrl point at the same place — there is no separate
  // "start" control to offer since this platform never created the
  // meeting and has no way to distinguish host access from student access
  // on someone else's link.
  async createMeeting({ joinUrl }) {
    if (!joinUrl) {
      throw new Error("A join link is required for the manual provider.");
    }
    return { joinUrl, hostUrl: joinUrl, externalId: null };
  },

  // Nothing to tell the provider — the host ends it on their own side.
  async endMeeting() {},
};

// ---------------------------------------------------------------- zoom
// Server-to-Server OAuth app. Needs ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID,
// ZOOM_CLIENT_SECRET in env — see PAYMENTS_SETUP.md-style setup doc for the
// equivalent Zoom walkthrough once written.
const TOKEN_CACHE = { token: null, expiresAt: 0 };

const getAccessToken = async () => {
  // 60s buffer so a token doesn't expire mid-request.
  if (TOKEN_CACHE.token && TOKEN_CACHE.expiresAt > Date.now() + 60_000) {
    return TOKEN_CACHE.token;
  }

  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  const basic = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64");

  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` } }
  );

  if (!response.ok) {
    throw new Error(`Zoom OAuth failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  TOKEN_CACHE.token = data.access_token;
  TOKEN_CACHE.expiresAt = Date.now() + data.expires_in * 1000;
  return TOKEN_CACHE.token;
};

const zoom = {
  name: "zoom",
  label: "Zoom (auto-created meeting)",

  // Settings → Connections' test: a fresh token with the current values.
  async check() {
    TOKEN_CACHE.token = null;
    await getAccessToken();
    return { ok: true, message: "Zoom accepted these credentials." };
  },

  configured() {
    return Boolean(
      process.env.ZOOM_ACCOUNT_ID && process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET
    );
  },  async createMeeting({ title, scheduledAt, durationMinutes, alternativeHosts, secured }) {
    const token = await getAccessToken();

    const settings = {
      join_before_host: false,
      waiting_room: true,
    };

    if (alternativeHosts?.length) {
      settings.alternative_hosts = alternativeHosts.join(",");
    }

    // approval_type: 0 (auto-approve) is what turns registration on for a
    // regular scheduled meeting via this API, and is required for the
    // registrant-creation call below to hand back a usable join_url
    // immediately — with manual approval (1) or the meeting-open default
    // (2), Zoom withholds the personal join_url until a separate approval
    // step, which this platform has no admin surface for and doesn't need:
    // "this student is on the active roster" already is the approval.
    if (secured) {
      settings.approval_type = 0;
    }

    const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: title,
        type: 2, // scheduled meeting, not instant
        start_time: new Date(scheduledAt).toISOString(),
        duration: durationMinutes,
        settings,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Zoom meeting creation failed: ${response.status} ${detail}`);
    }

    const data = await response.json();
    return {
      joinUrl: data.join_url,
      hostUrl: data.start_url,
      externalId: String(data.id),
    };
  },

  // Tier 3 only. Registers one student and returns their personal join
  // link. Requires approval_type: 0 on the meeting (set in createMeeting
  // above) — otherwise Zoom withholds join_url from this response
  // entirely, pending a manual approval step this platform doesn't have.
  async registerParticipant({ meetingId, email, firstName, lastName }) {
    const token = await getAccessToken();

    const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/registrants`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        first_name: firstName,
        last_name: lastName || undefined,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Zoom registrant creation failed: ${response.status} ${detail}`);
    }

    const data = await response.json();
    return { registrantId: data.registrant_id, joinUrl: data.join_url };
  },

  // Best-effort — a meeting the host already ended manually, or one Zoom
  // auto-closed, must not block the platform's own status update from
  // going through.
  async endMeeting(externalId) {
    if (!externalId) return;
    try {
      const token = await getAccessToken();
      await fetch(`https://api.zoom.us/v2/meetings/${externalId}/status`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "end" }),
      });
    } catch {
      // Swallowed deliberately — see comment above.
    }
  },

  // ---- webhook handling (Tier 2: status sync + attendance) ----
  //
  // Zoom's handshake: on first saving the endpoint URL in the Zoom app
  // config, Zoom POSTs an "endpoint.url_validation" event with no
  // signature at all — the plainToken it sends back is proof enough for
  // that one request. Every subsequent real event carries
  // x-zm-signature/x-zm-request-timestamp headers that must be verified
  // against ZOOM_WEBHOOK_SECRET_TOKEN before the payload is trusted.
  //
  // rawBody must be the exact bytes Zoom sent (a Buffer/string from
  // express.raw()) — re-serializing a parsed object here would produce
  // different bytes than what was actually signed, the same reason
  // adapters/payment's webhook route stays ahead of express.json().
  isWebhookValidationRequest(payload) {
    return payload?.event === "endpoint.url_validation";
  },

  // Returns the {plainToken, encryptedToken} body Zoom expects back —
  // the caller just needs to res.json() this, no signature check needed
  // for this specific event.
  answerWebhookValidation(payload) {
    const plainToken = payload.payload.plainToken;

    // This handshake has no signature of its own — Zoom's proof that it's
    // really Zoom on the other end IS the encryptedToken response, so
    // anyone who can reach this public endpoint can ask it to HMAC an
    // arbitrary string with the same secret verifyWebhookSignature() uses.
    // Left unchecked, that's a signing oracle: request plainToken =
    // "v0:<timestamp>:<forged body>" here, get back a signature that then
    // authenticates a forged event carrying that exact body and timestamp.
    // Zoom's real plainToken is a short random alphanumeric string with no
    // colons, so refusing anything shaped like the "v0:timestamp:body"
    // message format closes the oracle without touching genuine handshakes.
    if (typeof plainToken !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(plainToken)) {
      throw new Error("Invalid plainToken in Zoom webhook validation request.");
    }

    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET_TOKEN || "")
      .update(plainToken)
      .digest("hex");
    return { plainToken, encryptedToken };
  },

  verifyWebhookSignature(rawBody, headers) {
    const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    if (!secret) throw new Error("ZOOM_WEBHOOK_SECRET_TOKEN is not configured.");

    const signature = headers["x-zm-signature"];
    const timestamp = headers["x-zm-request-timestamp"];
    if (!signature || !timestamp) throw new Error("Missing Zoom signature headers.");

    // A valid signature alone isn't enough — without an age check, a
    // captured request stays replayable forever, since the signature
    // covers the timestamp's value but nothing stops that same
    // (signature, timestamp, body) triple being resent later. 5 minutes
    // comfortably covers normal delivery/retry latency without leaving a
    // meaningfully exploitable window open.
    const ageMs = Date.now() - Number(timestamp);
    if (!Number.isFinite(ageMs) || Math.abs(ageMs) > 5 * 60 * 1000) {
      throw new Error("Zoom webhook timestamp is stale.");
    }

    const message = `v0:${timestamp}:${rawBody}`;
    const expected =
      "v0=" + crypto.createHmac("sha256", secret).update(message).digest("hex");

    // Fixed-length check first — timingSafeEqual throws on a length
    // mismatch rather than returning false, and a forged signature of the
    // wrong length is exactly the case that must fail closed here.
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Zoom webhook signature mismatch.");
    }
  },

  // Normalizes the handful of event types this platform actually acts on
  // into one shape — the controller doesn't need to know Zoom's own event
  // naming beyond this one translation point.
  parseWebhookEvent(payload) {
    const meetingId = payload?.payload?.object?.id ? String(payload.payload.object.id) : null;

    switch (payload.event) {
      case "meeting.started":
        return { type: "meeting.started", meetingId };
      case "meeting.ended":
        return { type: "meeting.ended", meetingId };
      case "meeting.participant_joined": {
        const p = payload.payload.object.participant;
        return {
          type: "participant.joined",
          meetingId,
          participant: {
            externalParticipantId: p.participant_uuid || p.id,
            participantName: p.user_name,
            participantEmail: p.email || null,
            joinedAt: new Date(payload.payload.object.participant.join_time || Date.now()),
          },
        };
      }
      case "meeting.participant_left": {
        const p = payload.payload.object.participant;
        return {
          type: "participant.left",
          meetingId,
          participant: {
            externalParticipantId: p.participant_uuid || p.id,
            leftAt: new Date(payload.payload.object.participant.leave_time || Date.now()),
          },
        };
      }
      default:
        return { type: "ignored", meetingId };
    }
  },
};

// -------------------------------------------------------------- livekit
// A self-hosted LiveKit server: the classroom runs inside the student app
// and admin panel instead of on another site. Nothing is created ahead of
// time — a "meeting" is just a room name, and LiveKit opens the room when
// the first person joins with a pass signed here. Needs LIVEKIT_URL
// (wss://…, what browsers connect to), LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
//
// Two modes: "class" (everyone may turn on camera and mic) and "webinar"
// (only hosts and students the host promotes; everyone else watches and
// chats).
const {
  AccessToken, RoomServiceClient, EgressClient, TrackSource, DataPacket_Kind,
  EncodedFileOutput, EncodedFileType, S3Upload, EgressStatus,
} = require("livekit-server-sdk");

// What a student may switch on: always camera and mic in a class (or on a
// webinar's stage); their screen only when the class allows it.
const SOURCE = {
  camera: TrackSource.CAMERA,
  mic: TrackSource.MICROPHONE,
  screen: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
};
const toSources = ({ camera = true, mic = true, screen = false } = {}) => [
  ...(camera ? [SOURCE.camera] : []),
  ...(mic ? [SOURCE.mic] : []),
  ...(screen ? SOURCE.screen : []),
];
// The reverse, for showing a person's current rights.
const fromSources = (sources = []) => {
  const names = sources.map((s) => (typeof s === "number" ? s : TrackSource[String(s).toUpperCase()]));
  return {
    camera: names.includes(TrackSource.CAMERA),
    mic: names.includes(TrackSource.MICROPHONE),
    screen: names.includes(TrackSource.SCREEN_SHARE),
  };
};

const lkEnv = () => ({
  url: process.env.LIVEKIT_URL,
  key: process.env.LIVEKIT_API_KEY,
  secret: process.env.LIVEKIT_API_SECRET,
});

// The server API speaks http(s) on the same host the browsers use as ws(s).
const roomService = () => {
  const { url, key, secret } = lkEnv();
  return new RoomServiceClient(url.replace(/^ws/, "http"), key, secret);
};

const egress = () => {
  const { url, key, secret } = lkEnv();
  return new EgressClient(url.replace(/^ws/, "http"), key, secret);
};

const livekit = {
  name: "livekit",
  label: "LiveKit (in-app classroom or webinar)",

  async check() {
    const rooms = await roomService().listRooms();
    return { ok: true, message: `Connected. ${rooms.length} room${rooms.length === 1 ? "" : "s"} open now.` };
  },

  configured() {
    const { url, key, secret } = lkEnv();
    return Boolean(url && key && secret);
  },

  async createMeeting() {
    return { joinUrl: null, hostUrl: null, externalId: `examai-${crypto.randomBytes(9).toString("hex")}` };
  },

  // Closing the room disconnects everyone still in it. Best-effort, like
  // Zoom's: a room nobody is in no longer exists on the server.
  async endMeeting(room) {
    if (!room) return;
    try {
      await roomService().deleteRoom(room);
    } catch {
      // Already gone.
    }
  },

  // A signed pass into one room for one person. `host` adds room admin
  // rights; `canPublish` decides camera, mic and screen share.
  // `sources` ({camera, mic, screen}) narrows what a non-host may publish.
  async joinToken({ room, identity, name, host = false, canPublish, sources, metadata = {} }) {
    const { url, key, secret } = lkEnv();
    const token = new AccessToken(key, secret, { identity, name, ttl: "6h", metadata: JSON.stringify(metadata) });
    const allowed = !host && canPublish && sources ? toSources(sources) : null;
    token.addGrant({
      room,
      roomJoin: true,
      roomAdmin: host,
      canPublish: host || Boolean(canPublish),
      ...(allowed ? { canPublishSources: allowed } : {}),
      canSubscribe: true,
      canPublishData: true,
      // Lets a student raise or lower their own hand (an attribute).
      canUpdateOwnMetadata: true,
    });
    return { url, token: await token.toJwt() };
  },

  // What one person may publish: { camera, mic, screen }. All off sends
  // them to the audience (in a webinar); anything they were sharing that's
  // no longer allowed stops. Changing it also lowers their hand.
  async setPermissions(room, identity, rights) {
    const sources = toSources(rights);
    await roomService().updateParticipant(room, identity, {
      permission: {
        canPublish: sources.length > 0,
        canPublishSources: sources,
        canSubscribe: true,
        canPublishData: true,
        canUpdateMetadata: true,
      },
      attributes: { hand: "" },
    });
  },

  // Webinar: bring a student on stage (camera, mic, and their screen if
  // the class allows it), or back to the audience.
  async setSpeaker(room, identity, canSpeak, screen = false) {
    await livekit.setPermissions(room, identity, canSpeak ? { camera: true, mic: true, screen } : { camera: false, mic: false, screen: false });
  },

  // Turns off someone's mic or camera (they can turn it back on if they're
  // still allowed to). source: "mic" | "camera" | "screen".
  async muteSource(room, identity, source) {
    const want = { mic: TrackSource.MICROPHONE, camera: TrackSource.CAMERA, screen: TrackSource.SCREEN_SHARE }[source];
    const p = await roomService().getParticipant(room, identity);
    const muted = [];
    for (const t of p.tracks || []) {
      if (t.source === want && !t.muted) {
        await roomService().mutePublishedTrack(room, identity, t.sid, true);
        muted.push(t.sid);
      }
    }
    return muted.length;
  },

  async participants(room) {
    try {
      return await roomService().listParticipants(room);
    } catch {
      return [];
    }
  },

  // The same, but null when the server couldn't be asked: an outage must
  // not read as an empty room. A room that doesn't exist (yet, or any
  // more) is empty.
  async participantsOrNull(room) {
    try {
      return await roomService().listParticipants(room);
    } catch (error) {
      return error?.code === "not_found" || error?.status === 404 ? [] : null;
    }
  },

  rightsOf: (info) => fromSources(info.permission?.canPublishSources || []),

  // ---- recording (LiveKit Egress, a separate service on the server) ----
  //
  // The recording lands where the platform keeps its files: the S3 bucket
  // (STORAGE_PROVIDER=s3), or for local storage the uploads folder, which
  // the egress container must have mounted at LIVEKIT_EGRESS_DIR (default
  // /out) — see LIVEKIT_SETUP.md. Either way the file's storage key is
  // recordings/<name>.mp4, so it plays like any uploaded video.
  async startRecording(room, name, { layout = "speaker" } = {}) {
    const key = `recordings/${name}.mp4`;
    const s3 = (process.env.STORAGE_PROVIDER || "local") === "s3";
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: s3 ? key : `${(process.env.LIVEKIT_EGRESS_DIR || "/out").replace(/\/$/, "")}/${name}.mp4`,
      ...(s3
        ? {
            output: {
              case: "s3",
              value: new S3Upload({
                accessKey: process.env.S3_ACCESS_KEY_ID,
                secret: process.env.S3_SECRET_ACCESS_KEY,
                region: process.env.S3_REGION || "us-east-1",
                bucket: process.env.S3_BUCKET,
                endpoint: process.env.S3_ENDPOINT || "",
                forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
              }),
            },
          }
        : {}),
    });
    const info = await egress().startRoomCompositeEgress(room, { file: output }, { layout });
    return { egressId: info.egressId, key, driver: s3 ? "s3" : "local" };
  },

  async stopRecording(egressId) {
    try {
      await egress().stopEgress(egressId);
    } catch {
      // Already finished.
    }
  },

  // → { status: "recording" | "processing" | "ready" | "failed", sizeBytes, durationSeconds, error }
  async recordingStatus(egressId) {
    const [info] = await egress().listEgress({ egressId });
    if (!info) return { status: "failed", error: "The recording service has no record of it." };
    const file = info.fileResults?.[0];
    const base = {
      sizeBytes: file?.size ? Number(file.size) : null,
      durationSeconds: file?.duration ? Math.round(Number(file.duration) / 1e9) : null,
    };
    switch (info.status) {
      case EgressStatus.EGRESS_STARTING:
      case EgressStatus.EGRESS_ACTIVE:
        return { ...base, status: "recording" };
      case EgressStatus.EGRESS_ENDING:
        return { ...base, status: "processing" };
      case EgressStatus.EGRESS_COMPLETE:
        return { ...base, status: "ready" };
      default:
        return { ...base, status: "failed", error: info.error || "The recording failed." };
    }
  },

  // A small message to everyone in the room (or only `to` identities) on
  // the "examai" topic: the room's own updates — a new poll, the Q&A board
  // changed, the whiteboard opened. Best-effort: clients also refresh on
  // their own.
  async broadcast(room, payload, to) {
    try {
      await roomService().sendData(room, Buffer.from(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, {
        topic: "examai",
        ...(to ? { destinationIdentities: to } : {}),
      });
    } catch {
      // The room may be empty or gone.
    }
  },

  async removeParticipant(room, identity) {
    await roomService().removeParticipant(room, identity);
  },
};

const PROVIDERS = { manual, zoom, livekit };

const get = (name) => {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown live class provider "${name}".`);
  return provider;
};

const list = () =>
  Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    label: p.label,
    configured: p.configured(),
  }));

// Saved credentials changed (utils/serviceCredentials.js): fetch a new Zoom token.
const resetCaches = () => {
  TOKEN_CACHE.token = null;
  TOKEN_CACHE.expiresAt = 0;
};

module.exports = { get, list, PROVIDERS, resetCaches };
