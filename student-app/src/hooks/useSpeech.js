import { useCallback, useEffect, useRef, useState } from "react";

// Speech to text with the browser's own recognition (Chrome, Edge, Safari,
// Android). Free and on the device's side; where it isn't available the
// student types instead. lang: "bn-BD" or "en-US".
const Recognition = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export default function useSpeech(lang) {
  const [listening, setListening] = useState(false);
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const rec = useRef(null);
  const finalText = useRef("");
  // Words kept from an earlier stretch of listening, when the student taps
  // the mic again to add to the answer.
  const base = useRef("");

  const stop = useCallback(() => {
    try { rec.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback(() => {
    if (!Recognition) return;
    setError("");
    base.current = finalText.current;
    setInterim("");
    const r = new Recognition();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    // Rebuilt from every result each time rather than added to: Android
    // Chrome re-sends earlier results, and often sends each phrase again
    // grown by a word ("what", "what is", "what is inertia"), which
    // appending turned into the same words several times over.
    r.onresult = (e) => {
      const finals = [];
      let live = "";
      for (let i = 0; i < e.results.length; i += 1) {
        const piece = e.results[i][0].transcript.trim();
        if (!piece) continue;
        if (!e.results[i].isFinal) { live = piece; continue; }
        const last = finals[finals.length - 1];
        const a = piece.toLowerCase();
        const b = last?.toLowerCase();
        const all = finals.join(" ").toLowerCase();
        if (all && a.startsWith(all)) finals.splice(0, finals.length, piece);
        else if (all && all.includes(a)) continue;
        else if (b && a.startsWith(b)) finals[finals.length - 1] = piece;
        else if (b && b.endsWith(a)) continue;
        else finals.push(piece);
      }
      finalText.current = `${base.current} ${finals.join(" ")}`.trim();
      const tail = finalText.current.toLowerCase();
      setText(finalText.current);
      setInterim(live && !tail.endsWith(live.toLowerCase()) ? live : "");
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Microphone access was blocked. Allow it in the browser's site settings.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("Couldn't hear that. Try again.");
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [lang]);

  useEffect(() => () => { try { rec.current?.abort(); } catch { /* gone */ } }, []);

  const reset = useCallback(() => {
    finalText.current = "";
    base.current = "";
    setText("");
    setInterim("");
  }, []);

  return { supported: Boolean(Recognition), listening, text, interim, error, start, stop, reset };
}
