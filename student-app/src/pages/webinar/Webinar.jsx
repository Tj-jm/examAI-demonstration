import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Button, CircularProgress, Paper, TextField, Typography, Alert } from "@mui/material";
import { ArrowLeft, CalendarClock, Radio, Video, PlayCircle } from "lucide-react";
import { LiveKitRoom } from "@livekit/components-react";
import "@livekit/components-styles";
import { GUEST, useGetWebinarQuery, useJoinWebinarMutation, useVerifyWebinarMutation, useGetWebinarRoomTokenMutation, useGoogleWebinarMutation, useGetWebinarReplayMutation } from "../../api/contentApi";
import { setGuestToken } from "../../api/apiSlice";
import { useBranding } from "../../BrandingContext";
import PhoneField from "../../components/PhoneField";
import SafeMarkdown from "../../components/SafeMarkdown";
import LiveStage from "../../components/LiveStage";
import LiveBrandLayer, { PromoBar } from "../../components/LiveBrandLayer";
import LiveWhiteboard, { useWhiteboard } from "../../components/LiveWhiteboard";
import LiveWritingPad, { useWritingPad } from "../../components/LiveWritingPad";
import { useLiveTools, QaButton, Spotlight, PollCard, RecIndicator, useCaptionFeed, CaptionsToggle, CaptionBar } from "../../components/LiveClassTools";
import { StageControls } from "../liveClasses/LiveRoom";
import { useReportQuality } from "../../components/liveQuality";

// A public webinar, from its share link (/w/<slug>). Anyone joins as a
// guest: a name (and a code to their phone or email when the webinar asks
// for one), then the room, audience only. No account, no app chrome.

const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
// This browser, so a guest who comes back keeps their questions (and a
// banned one stays out).
const deviceId = () => {
  let id = store.get("examai.device");
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
    store.set("examai.device", id);
  }
  return id;
};

const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const countdown = (ms) => {
  if (ms <= 0) return "";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m || 1}m`;
};

// Google's own sign-in button (Google Identity Services), loaded once.
let gsi = null;
const loadGsi = () => {
  gsi ||= new Promise((ok, fail) => {
    if (window.google?.accounts?.id) return ok();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = ok;
    s.onerror = () => { gsi = null; fail(); };
    document.head.appendChild(s);
  });
  return gsi;
};

function GoogleButton({ slug, clientId, onIn }) {
  const ref = useRef(null);
  const [send, { isLoading, error }] = useGoogleWebinarMutation();
  const [failed, setFailed] = useState(false);
  const sendRef = useRef(null);
  sendRef.current = async (credential) => {
    const r = await send({ slug, credential, device: deviceId() });
    if (r.data?.token) onIn(r.data);
  };
  useEffect(() => {
    let gone = false;
    loadGsi().then(() => {
      if (gone || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => sendRef.current(r.credential), ux_mode: "popup" });
      window.google.accounts.id.renderButton(ref.current, { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: Math.min(400, ref.current.offsetWidth || 320) });
    }).catch(() => setFailed(true));
    return () => { gone = true; };
  }, [clientId]);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <Box ref={ref} sx={{ width: "100%", display: "flex", justifyContent: "center", minHeight: 44 }} />
      {isLoading && <CircularProgress size={18} />}
      {failed && <Alert severity="warning" sx={{ width: "100%" }}>Google sign-in couldn't load here.</Alert>}
      {error && <Alert severity="error" sx={{ width: "100%" }}>{error.data?.message || "Google sign-in didn't work. Try again."}</Alert>}
    </Box>
  );
}

function JoinForm({ slug, info, onIn }) {
  const { phoneCountries } = useBranding();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState(phoneCountries?.[0]?.code || "BD");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(null); // { guest, to }
  const [join, { isLoading: joining, error: joinError }] = useJoinWebinarMutation();
  const [verify, { isLoading: verifying, error: verifyError }] = useVerifyWebinarMutation();
  const otp = info.entry === "otp";
  const shownAt = useRef(Date.now()); // the bot check: too fast is a bot

  const submit = async (e) => {
    e.preventDefault();
    const r = await join({ slug, name, phone, country, email, website, elapsed: Date.now() - shownAt.current, device: deviceId() });
    if (r.data?.token) onIn(r.data);
    else if (r.data?.codeSent) { setSent({ guest: r.data.guest, to: r.data.to }); if (r.data.devOtp) setCode(r.data.devOtp); }
  };
  const check = async (e) => {
    e.preventDefault();
    const r = await verify({ slug, guest: sent.guest, code });
    if (r.data?.token) onIn(r.data);
  };

  const google = info.google ? <GoogleButton slug={slug} clientId={info.google} onIn={onIn} /> : null;
  if (info.entry === "google") {
    return google || <Alert severity="info">Google sign-in isn't set up yet. Try again later.</Alert>;
  }

  if (sent) {
    return (
      <Box component="form" onSubmit={check} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography>We sent a code to your {sent.to === "phone" ? "phone" : "email"}. Type it here.</Typography>
        <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} inputProps={{ inputMode: "numeric", autoComplete: "one-time-code" }} autoFocus />
        {verifyError && <Alert severity="error">{verifyError.data?.message || "That didn't work. Try again."}</Alert>}
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button onClick={() => { setSent(null); setCode(""); }}>Back</Button>
          <Box sx={{ flex: 1 }} />
          <Button type="submit" variant="contained" disabled={verifying || code.length < 4}>{verifying ? "Checking…" : "Join"}</Button>
        </Box>
      </Box>
    );
  }
  return (
    <Box component="form" onSubmit={submit} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {google && (
        <>
          {google}
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>or</Typography>
        </>
      )}
      <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} required autoComplete="name" />
      <PhoneField country={country} onCountry={setCountry} value={phone} onChange={(e) => setPhone(e.target.value)} label={otp ? "Phone number" : "Phone number (optional)"} />
      <TextField label={otp ? "Or email" : "Email (optional)"} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      {/* For bots: people never see it, and autofill is told to skip it. */}
      <input type="text" name="examai_hp_field" tabIndex={-1} autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" data-form-type="other" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }} />
      {otp && <Typography variant="caption" color="text.secondary">We'll send a code to your phone, or to your email if you give only that.</Typography>}
      {joinError && <Alert severity="error">{joinError.data?.message || "Couldn't join. Try again."}</Alert>}
      <Button type="submit" variant="contained" size="large" disabled={joining || name.trim().length < 2} startIcon={<Video size={16} />}>
        {joining ? "Joining…" : otp ? "Send my code" : "Join the webinar"}
      </Button>
    </Box>
  );
}

function GuestRoomBody({ slug, data, onLeave }) {
  const tools = useLiveTools(GUEST, slug, data.recording);
  const board = useWhiteboard({ isHost: false });
  const [boardHidden, setBoardHidden] = useState(false);
  const pad = useWritingPad({ isHost: false });
  const [padHidden, setPadHidden] = useState(false);
  const captions = useCaptionFeed();
  const [showCaptions, setShowCaptions] = useState(true);
  useReportQuality();
  const pill = (hidden) => ({ borderRadius: 5, textTransform: "none", ...(hidden ? { color: "inherit", borderColor: "rgba(255,255,255,0.35)" } : {}) });
  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1, borderBottom: "1px solid rgba(255,255,255,0.12)", flexWrap: "wrap" }}>
        <Button size="small" onClick={onLeave} startIcon={<ArrowLeft size={16} />} sx={{ color: "inherit", textTransform: "none" }}>Leave</Button>
        {data.branding?.showLogo !== false && data.branding?.logo && <Box component="img" src={data.branding.logo} alt="" sx={{ height: 26, borderRadius: 1 }} />}
        <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>{data.title}</Typography>
        <RecIndicator on={tools.recording} />
        <Box sx={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, px: 1, py: 0.25, borderRadius: 1, bgcolor: "#e5484d", color: "#fff" }}>LIVE</Box>
        {board.state.open && <Button size="small" variant={boardHidden ? "outlined" : "contained"} onClick={() => setBoardHidden(!boardHidden)} sx={pill(boardHidden)}>{boardHidden ? "Show board" : "Board"}</Button>}
        {pad.ui.open && <Button size="small" variant={padHidden ? "outlined" : "contained"} onClick={() => setPadHidden(!padHidden)} sx={pill(padHidden)}>{padHidden ? "Show pad" : "Writing pad"}</Button>}
        <CaptionsToggle feed={captions} show={showCaptions} setShow={setShowCaptions} />
        {data.questions !== "off" && <QaButton batchId={GUEST} id={slug} qa={tools.qa} />}
        <StageControls />
      </Box>
      <PromoBar branding={data.branding} />
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        <LiveStage stageOnly />
        <LiveBrandLayer branding={data.branding} nameMark />
        <LiveWhiteboard board={board} hidden={boardHidden} />
        <LiveWritingPad pad={pad} hidden={padHidden} />
        <Spotlight qa={tools.qa} />
        <PollCard batchId={GUEST} id={slug} poll={tools.poll} />
        <CaptionBar feed={captions} show={showCaptions} />
      </Box>
    </>
  );
}

// The recording, after the webinar.
function Replay({ slug, title }) {
  const [load, { data, error, isLoading }] = useGetWebinarReplayMutation();
  useEffect(() => { load(slug); }, [load, slug]);
  if (isLoading || (!data && !error)) return <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}><CircularProgress size={22} /></Box>;
  if (error) return <Alert severity="info">{error.data?.message || "The recording isn't ready yet."}</Alert>;
  return (
    <Box sx={{ position: "relative", width: "100%", aspectRatio: "16 / 9", bgcolor: "#000", borderRadius: 2, overflow: "hidden" }}>
      {data.file ? (
        <Box component="video" src={data.url} controls playsInline sx={{ width: "100%", height: "100%" }} />
      ) : (
        <Box component="iframe" src={data.url} title={title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen sx={{ border: 0, width: "100%", height: "100%" }} />
      )}
    </Box>
  );
}

export default function Webinar() {
  const { slug } = useParams();
  const key = `examai.webinar.${slug}`;
  const { data: info, error, isLoading, refetch } = useGetWebinarQuery(slug, { pollingInterval: 30000 });
  const [pass, setPass] = useState(() => store.get(key));
  const [getRoom, room] = useGetWebinarRoomTokenMutation();
  const [inRoom, setInRoom] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { setGuestToken(pass?.token); }, [pass]);
  useEffect(() => () => setGuestToken(null), []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);

  const enter = async () => {
    const r = await getRoom(slug);
    if (r.data?.token) setInRoom(true);
    // A pass that no longer works (banned, the link changed): join again.
    if (r.error?.status === 403) { store.del(key); setPass(null); }
  };
  // Waiting for the host to start: check again every 10 seconds.
  const waiting = Boolean(room.error?.data?.waiting);
  useEffect(() => {
    if (!waiting || inRoom) return undefined;
    const t = setInterval(enter, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, inRoom]);

  if (isLoading) return <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}><CircularProgress /></Box>;
  if (error || !info) {
    return <Box sx={{ p: 4, textAlign: "center" }}><Typography>{error?.data?.message || "This webinar link isn't open."}</Typography></Box>;
  }

  if (inRoom && room.data?.token) {
    const accent = room.data.branding?.accentColor;
    return (
      <LiveKitRoom serverUrl={room.data.url} token={room.data.token} connect video={false} audio={false}
        onDisconnected={() => { setInRoom(false); room.reset(); refetch(); }}
        data-lk-theme="default"
        style={{ height: "100dvh", display: "flex", flexDirection: "column", ...(accent ? { "--lk-accent-bg": accent } : {}) }}>
        <GuestRoomBody slug={slug} data={room.data} onLeave={() => { setInRoom(false); room.reset(); refetch(); }} />
      </LiveKitRoom>
    );
  }

  const ended = ["ended", "cancelled"].includes(info.status);
  const replay = info.status === "ended" && info.replay;
  const left = new Date(info.scheduledAt).getTime() - now;
  const brand = info.branding || {};
  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", alignItems: { xs: "stretch", sm: "center" }, justifyContent: "center", p: { xs: 0, sm: 3 }, bgcolor: "background.default" }}>
      <Paper sx={{ width: "100%", maxWidth: replay && pass ? 860 : 520, p: { xs: 2.5, sm: 4 }, borderRadius: { xs: 0, sm: 4 }, display: "flex", flexDirection: "column", gap: 2.5 }}>
        {brand.logo && <Box component="img" src={brand.logo} alt="" sx={{ height: 36, alignSelf: "flex-start", borderRadius: 1 }} />}
        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, color: info.status === "live" ? "#e5484d" : "text.secondary", fontSize: 13, fontWeight: 600 }}>
            {info.status === "live" ? <><Radio size={15} /> LIVE NOW</> : replay ? <><PlayCircle size={15} /> RECORDING · {when(info.scheduledAt)}</> : <><CalendarClock size={15} /> {when(info.scheduledAt)}{!ended && left > 0 ? ` · starts in ${countdown(left)}` : ""}</>}
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{info.title}</Typography>
          {info.blurb && <Typography sx={{ mt: 1, color: "text.secondary", whiteSpace: "pre-wrap" }}>{info.blurb}</Typography>}
          {info.description && <Box sx={{ mt: 1, fontSize: 14, color: "text.secondary" }}><SafeMarkdown>{info.description}</SafeMarkdown></Box>}
        </Box>
        {replay ? (
          pass ? <Replay slug={slug} title={info.title} /> : (
            <>
              <Typography sx={{ fontWeight: 600 }}>Watch the recording</Typography>
              <JoinForm slug={slug} info={info} onIn={(p) => { store.set(key, p); setPass(p); }} />
            </>
          )
        ) : ended ? (
          <Alert severity="info">This webinar has finished. Thanks for your interest.</Alert>
        ) : info.closed && !pass ? (
          <Alert severity="info">This webinar isn't letting anyone new in.</Alert>
        ) : !pass ? (
          <JoinForm slug={slug} info={info} onIn={(p) => { store.set(key, p); setPass(p); }} />
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography>You're in as <b>{pass.name}</b>.</Typography>
            {room.error && !waiting && <Alert severity={room.error.data?.full ? "warning" : "error"}>{room.error.data?.message || "Couldn't open the webinar. Try again."}</Alert>}
            {waiting ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.secondary" }}>
                <CircularProgress size={18} /> Waiting for the host to start. You'll go in automatically.
              </Box>
            ) : (
              <Button variant="contained" size="large" startIcon={<Video size={16} />} disabled={room.isLoading} onClick={enter}>
                {room.isLoading ? "Opening…" : info.status === "live" ? "Enter the webinar" : "Wait in the lobby"}
              </Button>
            )}
            <Button size="small" onClick={() => { store.del(key); setPass(null); room.reset(); }} sx={{ alignSelf: "flex-start", textTransform: "none" }}>Not {pass.name}?</Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
