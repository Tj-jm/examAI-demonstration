import { useEffect, useRef, useState } from "react";
import { Captions, CaptionsOff } from "lucide-react";
import { useRoomContext } from "@livekit/components-react";
import { useAddLiveTranscriptMutation } from "../api/contentApi";

// Live captions from the host's own browser (the Web Speech API: Chrome
// and Edge). What it hears goes to everyone in the room on the "captions"
// topic, and each finished line is saved, a few at a time, for the class
// notes after.

const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const CAPTION_LANGS = [
  ["en-US", "English"],
  ["bn-BD", "বাংলা"],
  ["en-IN", "English (India)"],
  ["hi-IN", "हिन्दी"],
];
const enc = new TextEncoder();
const LANG_KEY = "examai.captionLang";

export function useCaptions(id) {
  const room = useRoomContext();
  const [save] = useAddLiveTranscriptMutation();
  const [on, setOn] = useState(false);
  const [error, setError] = useState(null);
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(LANG_KEY) || "en-US"; } catch { return "en-US"; }
  });
  const [line, setLine] = useState({ final: "", interim: "" });
  const buffer = useRef([]);
  const want = useRef(false);
  const lastInterim = useRef(0);

  const send = (payload, reliable) => {
    room?.localParticipant?.publishData(enc.encode(JSON.stringify(payload)), { reliable, topic: "captions" }).catch(() => {});
  };
  const flush = () => {
    if (!buffer.current.length) return;
    const lines = buffer.current.splice(0);
    save({ id, lines, lang }).unwrap().catch(() => buffer.current.unshift(...lines));
  };

  useEffect(() => {
    if (!on || !SR) return undefined;
    want.current = true;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const text = e.results[i][0].transcript.trim();
        if (!text) continue;
        if (e.results[i].isFinal) {
          buffer.current.push({ text, at: new Date().toISOString() });
          send({ t: "f", text }, true);
          setLine({ final: text, interim: "" });
        } else {
          interim += `${text} `;
        }
      }
      interim = interim.trim();
      if (interim && Date.now() - lastInterim.current > 250) {
        lastInterim.current = Date.now();
        send({ t: "i", text: interim }, false);
        setLine((l) => ({ ...l, interim }));
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        want.current = false;
        setError("The browser blocked the microphone for captions.");
        setOn(false);
      } else if (e.error === "network") {
        setError("Captions need an internet connection (the browser's speech service).");
      }
    };
    // Chrome ends recognition every so often; carry on while it's wanted.
    rec.onend = () => {
      if (want.current) setTimeout(() => { try { if (want.current) rec.start(); } catch { /* already started */ } }, 300);
    };
    try { rec.start(); } catch { /* already started */ }
    setError(null);
    const t = setInterval(flush, 8000);
    return () => {
      want.current = false;
      clearInterval(t);
      try { rec.abort(); } catch { /* not started */ }
      flush();
      send({ t: "off" }, true);
      setLine({ final: "", interim: "" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, lang]);

  const setLang = (v) => {
    setLangState(v);
    try { localStorage.setItem(LANG_KEY, v); } catch { /* private window */ }
  };
  return { supported: Boolean(SR), on, setOn, lang, setLang, error, line };
}

export function CaptionsButton({ captions }) {
  const { supported, on, setOn, lang, setLang, error } = captions;
  if (!supported) {
    return <span className="pill" title="Live captions need Chrome or Edge">No captions in this browser</span>;
  }
  return (
    <span className="row-tight" style={{ gap: 4 }}>
      <button className={`live-right ${on ? "on" : ""}`} onClick={() => setOn(!on)} title={on ? "Stop captions" : "Show live captions to everyone, and save them for class notes"}>
        {on ? <Captions size={14} /> : <CaptionsOff size={14} />} {on ? "Captions on" : "Captions"}
      </button>
      <select className="live-input" style={{ width: "auto", padding: "2px 4px" }} value={lang} onChange={(e) => setLang(e.target.value)} title="Language you're speaking">
        {CAPTION_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <span className="small" style={{ color: "#ff8a8a" }}>{error}</span>}
    </span>
  );
}

// What students are seeing, so the host can tell it's working.
export function CaptionPreview({ captions }) {
  const { on, line } = captions;
  if (!on || !(line.final || line.interim)) return null;
  return (
    <div className="live-caption">
      {line.interim || line.final}
    </div>
  );
}
