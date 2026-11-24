import { useEffect, useRef, useState, useId, createElement } from "react";
import { Box, Button } from "@mui/material";
import { useLocation } from "react-router-dom";

// The site mascot (admin → Settings → Student app → Mascot; backend
// utils/mascot.js). The character is shape data, drawn here element by
// element (never as markup), in named parts the moves animate. The props it
// holds (book, pencil, magnifier, trophy) are drawn here, so they work on
// any character.
//
// Anything in the app can make it react: mascotReact("correct" | "wrong" |
// "great" | "wave" | "cheer" | "comfort", "optional words").

const EVENT = "examai:mascot";
const OFF_KEY = "examai_mascot_off";
const HUE_KEY = "examai_mascot_hue";

// mood "act" plays a page move: mascotReact("act", "Words", "thumbs").
export const mascotReact = (mood, say, move) => {
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { mood, say, move } })); } catch { /* old browser */ }
};

// For a screen outside the app shell (payment done): plays on the next
// shell screen.
const LATER_KEY = "examai_mascot_later";
export const mascotLater = (mood, say) => {
  try { sessionStorage.setItem(LATER_KEY, JSON.stringify({ mood, say })); } catch { /* private mode */ }
};
const takeLater = () => {
  try {
    const raw = sessionStorage.getItem(LATER_KEY);
    sessionStorage.removeItem(LATER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const mascotHidden = () => {
  try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; }
};
export const setMascotHidden = (off) => {
  try { off ? localStorage.setItem(OFF_KEY, "1") : localStorage.removeItem(OFF_KEY); } catch { /* private mode */ }
  mascotReact("settings");
};

// The student's colour pick, as a hue turn in degrees (0 = as drawn).
export const MASCOT_HUES = [0, 50, 100, 150, 200, 250, 300];
export const mascotHue = () => {
  try { return Number(localStorage.getItem(HUE_KEY)) || 0; } catch { return 0; }
};
export const setMascotHue = (deg) => {
  try { deg ? localStorage.setItem(HUE_KEY, String(deg)) : localStorage.removeItem(HUE_KEY); } catch { /* private mode */ }
  mascotReact("settings");
};

// Fires one reaction when shown (a result page, say). once: a key, so it
// fires only the first time in this browser session (a nudge, not a nag).
export function MascotOnce({ mood, say, move, once, delay = 600 }) {
  useEffect(() => {
    if (once) {
      try {
        if (sessionStorage.getItem(`examai_mascot_once:${once}`)) return undefined;
        sessionStorage.setItem(`examai_mascot_once:${once}`, "1");
      } catch { /* private mode */ }
    }
    const t = setTimeout(() => mascotReact(mood, say, move), delay);
    return () => clearTimeout(t);
  }, [mood, say, move, once, delay]);
  return null;
}

// A tutoring or oral quiz turn's outcome: the newest marked answer.
export const mascotForSession = (session, part) => {
  if (!session) return;
  if (session.status === "done" && (session.report?.score ?? 0) >= 80) {
    mascotReact("great", `${session.report.score}/100!`);
    return;
  }
  if (typeof part === "number") {
    const p = session.paper?.parts?.[part];
    if (p && typeof p.got === "number" && p.answer) mascotReact(p.got >= p.marks ? "correct" : p.got === 0 ? "wrong" : "wave", p.got > 0 && p.got < p.marks ? "Part marks. Nearly there!" : undefined);
    return;
  }
  const last = [...(session.turns || [])].reverse().find((t) => t.kind === "feedback");
  if (!last || last.verdict === "skipped") return;
  mascotReact(last.verdict === "correct" ? "correct" : last.verdict === "wrong" ? "wrong" : "wave", last.verdict === "partial" ? "Half way there!" : undefined);
};

const PARTS = ["legs", "armL", "armR", "body", "face", "eyes"];
const TAGS = new Set(["path", "circle", "ellipse", "rect", "polygon", "line"]);
const NUMS = ["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "opacity"];
const COLOR = /^(#[0-9a-fA-F]{3,8}|none)$/;

const shapeProps = (s) => {
  const p = {};
  for (const k of NUMS) if (typeof s[k] === "number") p[k] = s[k];
  if (s.t === "path" && typeof s.d === "string") p.d = s.d;
  if (s.t === "polygon" && typeof s.points === "string") p.points = s.points;
  if (COLOR.test(s.fill || "")) p.fill = s.fill;
  if (COLOR.test(s.stroke || "")) p.stroke = s.stroke;
  if (typeof s.sw === "number") p.strokeWidth = s.sw;
  if (s.cap) p.strokeLinecap = s.cap;
  if (s.join) p.strokeLinejoin = s.join;
  return p;
};

// armL rotates around its right end (the shoulder): a positive turn lifts it.
// armR is the mirror image: a negative turn lifts it. .mq-look wraps the
// eyes, so where it looks and the blink don't fight over one transform.
export const MASCOT_CSS = `
.mq{transform-origin:50% 100%;transform-box:fill-box}
.mq .mq-armL{transform-origin:right center;transform-box:fill-box}
.mq .mq-armR{transform-origin:left center;transform-box:fill-box}
.mq .mq-eyes{transform-origin:center;transform-box:fill-box}
.mq .mq-look{transition:transform .5s}
.mq .mq-p{display:none}
.mq .mq-p *{transform-box:fill-box;transform-origin:center}
.mq-side .mq-look{transform:translateX(-3px)}
.mq-up .mq-look{transform:translateY(-3px)}
.mq-idle{animation:mqBreathe 2.6s ease-in-out infinite}
.mq-idle .mq-eyes{animation:mqBlink 4s infinite}
.mq-wave{animation:mqBreathe 2.6s ease-in-out infinite}
.mq-wave .mq-armL{animation:mqWaveL .45s ease-in-out infinite alternate}
.mq-wave .mq-eyes{animation:mqBlink 4s infinite}
.mq-lookabout{animation:mqBreathe 2.6s ease-in-out infinite}
.mq-lookabout .mq-look{animation:mqLook 2.4s ease-in-out infinite}
.mq-lookabout .mq-eyes{animation:mqBlink 3s infinite}
.mq-grip{animation:mqBreathe 2.2s ease-in-out infinite}
.mq-grip .mq-armL{transform:rotate(70deg)}
.mq-grip .mq-armR{transform:rotate(-70deg)}
.mq-grip .mq-eyes{animation:mqBlink 3s infinite}
.mq-cheer{animation:mqHop .5s cubic-bezier(.3,.7,.4,1) infinite}
.mq-cheer .mq-armL{animation:mqPumpL .5s ease-in-out infinite}
.mq-cheer .mq-armR{animation:mqPumpR .5s ease-in-out infinite}
.mq-dance{animation:mqSway .8s ease-in-out infinite}
.mq-dance .mq-armL{animation:mqPumpL .4s ease-in-out infinite alternate}
.mq-dance .mq-armR{animation:mqPumpR .4s ease-in-out infinite alternate-reverse}
.mq-comfort{animation:mqNod 1.4s ease-in-out infinite}
.mq-comfort .mq-armR{transform:rotate(-35deg)}
.mq-sleep{animation:mqBreathe 3.6s ease-in-out infinite}
.mq-sleep .mq-eyes{transform:scaleY(.12)}
.mq-sleep .mq-zz{display:inline}
.mq-sleep .mq-zz text{opacity:0;animation:mqZz 3s ease-in-out infinite}
.mq-sleep .mq-zz text:nth-child(2){animation-delay:1s}
.mq-sleep .mq-zz text:nth-child(3){animation-delay:2s}
.mq-stretch{animation:mqTall 2.4s ease-in-out both}
.mq-stretch .mq-armL{animation:mqReachL 2.4s ease-in-out both}
.mq-stretch .mq-armR{animation:mqReachR 2.4s ease-in-out both}
.mq-stretch .mq-eyes{animation:mqSquint 2.4s ease-in-out both}
.mq-think{animation:mqBreathe 3s ease-in-out infinite}
.mq-think .mq-armR{transform:rotate(-30deg)}
.mq-think .mq-look{transform:translate(2px,-3px)}
.mq-think .mq-ask{display:inline}
.mq-think .mq-ask text{animation:mqPulse 1.2s ease-in-out infinite}
.mq-read{animation:mqBreathe 3s ease-in-out infinite}
.mq-read .mq-armL{transform:rotate(-35deg)}
.mq-read .mq-armR{transform:rotate(35deg)}
.mq-read .mq-look{transform:translateY(2px)}
.mq-read .mq-eyes{animation:mqBlink 3.4s infinite}
.mq-read .mq-book{display:inline}
.mq-read .mq-book > g{animation:mqBob 3s ease-in-out infinite}
.mq-write{animation:mqBreathe 3s ease-in-out infinite}
.mq-write .mq-armL{transform:rotate(-35deg)}
.mq-write .mq-armR{animation:mqScribbleArm .35s ease-in-out infinite alternate}
.mq-write .mq-look{transform:translate(-2px,2px)}
.mq-write .mq-pad{display:inline}
.mq-write .mq-pencil{animation:mqScribble .35s ease-in-out infinite alternate}
.mq-point{animation:mqBreathe 2.6s ease-in-out infinite}
.mq-point .mq-armL{transform:rotate(15deg)}
.mq-point .mq-look{transform:translateX(-4px)}
.mq-point .mq-eyes{animation:mqBlink 4s infinite}
.mq-hop{animation:mqHop .6s cubic-bezier(.3,.7,.4,1) infinite}
.mq-spin{animation:mqSpin 1.4s ease-in-out infinite}
.mq-thumbs{animation:mqHop 1s cubic-bezier(.3,.7,.4,1) infinite}
.mq-thumbs .mq-armL{transform:rotate(60deg)}
.mq-thumbs .mq-spark{display:inline}
.mq-thumbs .mq-spark path{animation:mqTwinkle 1s ease-in-out infinite}
.mq-thumbs .mq-spark path:nth-child(2){animation-delay:.5s}
.mq-magnify{animation:mqBreathe 3s ease-in-out infinite}
.mq-magnify .mq-armR{animation:mqScanArm 2.4s ease-in-out infinite}
.mq-magnify .mq-glass{display:inline}
.mq-magnify .mq-glass > g{animation:mqScan 2.4s ease-in-out infinite}
.mq-magnify .mq-look{animation:mqScanEye 2.4s ease-in-out infinite}
.mq-trophy{animation:mqHop .8s cubic-bezier(.3,.7,.4,1) infinite}
.mq-trophy .mq-armL{transform:rotate(95deg)}
.mq-trophy .mq-armR{transform:rotate(-95deg)}
.mq-trophy .mq-cup{display:inline}
.mq-trophy .mq-spark{display:inline}
.mq-trophy .mq-spark path{animation:mqTwinkle 1s ease-in-out infinite}
.mq-trophy .mq-spark path:nth-child(2){animation-delay:.5s}
@keyframes mqBreathe{50%{transform:scale(1.02,.98)}}
@keyframes mqBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes mqWaveL{from{transform:rotate(10deg)}to{transform:rotate(75deg)}}
@keyframes mqLook{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
@keyframes mqHop{0%,100%{transform:translateY(0) scale(1.04,.96)}45%{transform:translateY(-30px) scale(.97,1.04)}}
@keyframes mqPumpL{50%{transform:rotate(70deg)}}
@keyframes mqPumpR{50%{transform:rotate(-70deg)}}
@keyframes mqSway{0%,100%{transform:rotate(-8deg) translateX(-8px)}50%{transform:rotate(8deg) translateX(8px)}}
@keyframes mqNod{50%{transform:rotate(4deg) translateY(3px)}}
@keyframes mqZz{0%{opacity:0;transform:translate(0,0) scale(.6)}30%{opacity:1}100%{opacity:0;transform:translate(16px,-30px) scale(1.2)}}
@keyframes mqTall{35%,65%{transform:scale(.97,1.06)}}
@keyframes mqReachL{35%,65%{transform:rotate(100deg)}}
@keyframes mqReachR{35%,65%{transform:rotate(-100deg)}}
@keyframes mqSquint{25%,75%{transform:scaleY(.15)}}
@keyframes mqPulse{50%{transform:scale(1.25)}}
@keyframes mqBob{50%{transform:translateY(2px) rotate(-2deg)}}
@keyframes mqScribbleArm{from{transform:rotate(25deg)}to{transform:rotate(38deg)}}
@keyframes mqScribble{from{transform:translate(0,0) rotate(0)}to{transform:translate(-5px,3px) rotate(-6deg)}}
@keyframes mqSpin{0%,100%{transform:scaleX(1)}25%{transform:scaleX(-1)}50%{transform:scaleX(1)}}
@keyframes mqTwinkle{0%,100%{opacity:.2;transform:scale(.6)}50%{opacity:1;transform:scale(1.1)}}
@keyframes mqScan{0%,100%{transform:translate(-14px,4px)}50%{transform:translate(4px,-2px)}}
@keyframes mqScanArm{0%,100%{transform:rotate(-30deg)}50%{transform:rotate(-50deg)}}
@keyframes mqScanEye{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
@media (prefers-reduced-motion:reduce){.mq,.mq *{animation:none!important}}
`;

// What it holds, on the 150 × 180 canvas. Hidden until a move shows one.
function Props() {
  const ink = "#5b5b66";
  return (
    <>
      <g className="mq-p mq-zz" fontWeight="700" fill="#8a8a96">
        <text x="108" y="52" fontSize="14">z</text>
        <text x="114" y="44" fontSize="17">z</text>
        <text x="120" y="36" fontSize="20">z</text>
      </g>
      <g className="mq-p mq-ask"><text x="110" y="34" fontSize="28" fontWeight="800" fill="#8a8a96">?</text></g>
      <g className="mq-p mq-book">
        <g>
          <path d="M48 98 L75 104 L102 98 L102 128 L75 134 L48 128 Z" fill="#b5543c" />
          <path d="M51 99 L75 105 L99 99 L99 125 L75 131 L51 125 Z" fill="#f6f1e7" stroke="#8a6a52" strokeWidth="1.2" />
          <line x1="75" y1="105" x2="75" y2="131" stroke="#8a6a52" strokeWidth="1.5" />
          <path d="M56 107 L70 110 M56 113 L70 116 M56 119 L70 122 M80 110 L94 107 M80 116 L94 113 M80 122 L94 119" stroke="#c9bfae" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      </g>
      <g className="mq-p mq-pad">
        <rect x="40" y="96" width="36" height="42" rx="3" fill="#fffdf6" stroke={ink} strokeWidth="1.5" />
        <rect x="52" y="92" width="12" height="6" rx="2" fill={ink} />
        <path d="M46 106 H70 M46 113 H70 M46 120 H64 M46 127 H67" stroke="#b9c4d6" strokeWidth="1.6" strokeLinecap="round" />
        <g className="mq-pencil">
          <path d="M96 92 L104 98 L84 124 L76 118 Z" fill="#f5c542" stroke="#b58a00" strokeWidth="1" />
          <path d="M76 118 L84 124 L74 128 Z" fill="#f1d7b0" stroke="#b58a00" strokeWidth="1" />
          <path d="M96 92 L104 98 L106 95 L98 89 Z" fill="#e88a8a" />
        </g>
      </g>
      <g className="mq-p mq-glass">
        <g>
          <line x1="117" y1="72" x2="130" y2="88" stroke="#6b4f3a" strokeWidth="5" strokeLinecap="round" />
          <circle cx="108" cy="62" r="13" fill="#cfe8ff" fillOpacity=".45" stroke="#44444c" strokeWidth="3" />
          <path d="M101 56 Q104 52 109 52" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      </g>
      <g className="mq-p mq-cup">
        <path d="M60 -20 H90 V-8 Q90 8 75 10 Q60 8 60 -8 Z" fill="#f5c542" stroke="#b58a00" strokeWidth="1.5" />
        <path d="M60 -16 Q50 -16 51 -8 Q52 0 61 0 M90 -16 Q100 -16 99 -8 Q98 0 89 0" fill="none" stroke="#b58a00" strokeWidth="2.2" />
        <rect x="71" y="10" width="8" height="6" fill="#d9a92a" />
        <rect x="64" y="16" width="22" height="6" rx="1.5" fill="#8a5a2b" />
      </g>
      <g className="mq-p mq-spark" fill="#f5c542">
        <path d="M122 30 L125 38 L133 41 L125 44 L122 52 L119 44 L111 41 L119 38 Z" />
        <path d="M26 46 L28 51 L33 53 L28 55 L26 60 L24 55 L19 53 L24 51 Z" />
      </g>
    </>
  );
}

// The character in one move: idle | wave | lookabout | grip | cheer | dance |
// comfort | sleep | stretch | think | read | write | point | hop | spin |
// thumbs | magnify | trophy. pose "side" looks inward, "up" looks up.
// hue: the student's colour turn (defaults to the saved pick).
export function MascotFigure({ character, move = "idle", width = 110, pose, hue }) {
  const id = useId().replace(/:/g, "");
  if (!character) return null;
  const turn = hue ?? mascotHue();
  return (
    <svg viewBox="0 0 150 180" width={width} height={(width * 180) / 150} style={{ overflow: "visible", display: "block" }} aria-hidden="true">
      <style>{MASCOT_CSS}</style>
      {turn ? (
        <defs>
          <filter id={`mqh${id}`} colorInterpolationFilters="sRGB">
            <feColorMatrix type="hueRotate" values={String(turn)} />
          </filter>
        </defs>
      ) : null}
      <g className={`mq mq-${move}${pose ? ` mq-${pose}` : ""}`}>
        <ellipse cx="75" cy="175" rx="36" ry="4.5" fill="#000" opacity=".12" />
        <g filter={turn ? `url(#mqh${id})` : undefined}>
          {PARTS.map((part) => {
            const shapes = (character[part] || []).filter((s) => TAGS.has(s?.t)).map((s, i) => createElement(s.t, { key: i, ...shapeProps(s) }));
            return part === "eyes"
              ? <g key={part} className="mq-look"><g className="mq-eyes">{shapes}</g></g>
              : <g key={part} className={`mq-${part}`}>{shapes}</g>;
          })}
        </g>
        <Props />
      </g>
    </svg>
  );
}

const PEP = ["Keep going!", "You've got this!", "One more question?", "Nice work today!", "Learning looks good on you!"];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const lateNow = () => { const h = new Date().getHours(); return h >= 23 || h < 5; };
const greeting = () => {
  const h = new Date().getHours();
  if (h >= 23 || h < 5) return "Up late? Don't stay too long!";
  return h < 12 ? "Good morning!" : h < 17 ? "Good afternoon!" : "Good evening!";
};

// Screens where it keeps to itself: a lecture or live class playing, or a
// practice, tutoring, oral quiz or interview session. It still reacts there.
const QUIET = /\/(lectures|live-classes|pora|tutoring|interview)\/[^/]+$|\/practice\/(?!learn$)[^/]+$|\/archive\/session\//;

// What it does on a screen, first match wins.
const ACTS = [
  [/^\/$/, "wave", greeting],
  [/study-plan$/, "write", () => pick(["Planning today?", "One day at a time!"])],
  [/custom-exam-setup$|exam-setup$/, "think", () => "Pick your mix!"],
  [/\/exams\/[^/]+$/, "thumbs", () => pick(["Good luck!", "Read the rules first!"])],
  [/\/exams$/, "thumbs", () => pick(["Good luck!", "Which one today?"])],
  [/\/lectures$/, "read", () => "Watch and learn!"],
  [/\/practice(\/learn(\/[^/]+)?)?$/, "read", () => pick(["Practice makes perfect!", "A little every day!"])],
  [/\/(progress|grades|leaderboard)$|^\/results$/, "magnify", () => pick(["Let's see how you're doing!", "Look at that progress!"])],
  [/\/doubts(\/new)?$|\/chat$/, "think", () => "Ask away!"],
  [/^\/certificates$/, "trophy", () => "Look at these!"],
  [/\/assignments$/, "write", () => "Let's get it done!"],
  [/\/(tutor|pora|tutoring|interview)$/, "point", () => "Pick one to start!"],
];

const SIDES = ["right", "left"];
const SPOTS = ["right", "left", "bottom", "top"];
const ACT_GAP = 45000;

// Where it sits and how far in: "out" (hidden), "peek", "full".
const figureTransform = (spot, pos) => {
  if (spot === "bottom") return pos === "out" ? "translateY(115%)" : pos === "peek" ? "translateY(52%)" : "none";
  if (spot === "top") return pos === "out" ? "translateY(-115%)" : pos === "peek" ? "translateY(-42%)" : "none";
  const dir = spot === "left" ? -1 : 1;
  return pos === "out" ? `translateX(${130 * dir}px)` : pos === "peek" ? `translateX(${34 * dir}px)` : `translateX(${-12 * dir}px)`;
};

// Lives in the app shell: peeks in from an edge now and then, does
// something fitting on each screen, dozes off when left alone, and comes out
// to react. Not on exam or classroom screens (they sit outside the shell).
export default function MascotHost({ mascot, bottom = 24, top = 64 }) {
  const [hidden, setHidden] = useState(mascotHidden);
  const [hue, setHue] = useState(mascotHue);
  const [spot, setSpot] = useState("right"); // right | left | bottom | top
  const [pos, setPos] = useState("out"); // out | peek | full
  const [move, setMove] = useState("idle");
  const [say, setSay] = useState("");
  const [menu, setMenu] = useState(false);
  const timer = useRef(null);
  const enter = useRef(null);
  const busy = useRef(false);
  const sleeping = useRef(false);
  const spotRef = useRef("right");
  const streak = useRef(0);
  const greeted = useRef(false);
  const lastActive = useRef(Date.now());
  const lastAct = useRef(0);
  const path = useRef("/");
  const location = useLocation();
  path.current = location.pathname;
  const ambient = Boolean(mascot?.peekMinutes);
  const ambientRef = useRef(ambient);
  ambientRef.current = ambient;

  const leave = () => {
    setPos("out");
    setSay("");
    setMenu(false);
    busy.current = false;
    sleeping.current = false;
    timer.current = setTimeout(() => setMove("idle"), 600);
  };

  // ms 0: stays until something else moves it (sleep).
  const show = (nextSpot, nextPos, nextMove, words, ms = 2600) => {
    clearTimeout(timer.current);
    clearTimeout(enter.current);
    busy.current = true;
    sleeping.current = false;
    setMenu(false);
    setSay(words || "");
    setMove(nextMove);
    const go = () => {
      setPos(nextPos);
      if (ms) timer.current = setTimeout(leave, ms);
    };
    if (nextSpot !== spotRef.current) {
      // A new edge: start hidden there, then come in.
      spotRef.current = nextSpot;
      setSpot(nextSpot);
      setPos("out");
      enter.current = setTimeout(go, 60);
    } else go();
  };

  const side = () => pick(SIDES);

  // Reactions from anywhere in the app.
  useEffect(() => {
    const on = (e) => {
      const { mood, say: words, move: act } = e.detail || {};
      if (mood === "settings") { setHidden(mascotHidden()); setHue(mascotHue()); return; }
      if (mood === "act") {
        if (!ambientRef.current || mascotHidden()) return;
        lastAct.current = Date.now();
        show(side(), "full", act || "wave", words, 3600);
        return;
      }
      if (!mascot?.cheer || mascotHidden()) return;
      lastActive.current = Date.now();
      if (mood === "correct") {
        streak.current += 1;
        const s = streak.current;
        if (s >= 3 && [3, 5, 10, 15, 20].includes(s)) show(side(), "full", "dance", words || `${s} in a row!`, 3000);
        else show(side(), "full", "cheer", words || "Yes! Correct!");
      } else if (mood === "wrong") {
        streak.current = 0;
        show(side(), "peek", "comfort", words || "Close! You've got this.");
      } else if (mood === "great") show(side(), "full", "dance", words || "Amazing work!", 3200);
      else if (mood === "cheer") show(side(), "full", "cheer", words || "Nice!");
      else if (mood === "comfort") show(side(), "full", "comfort", words || "Next one's yours!", 3200);
      else if (mood === "wave") show(side(), "peek", "wave", words || "Hi!");
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [mascot?.cheer]);

  // Peeks in from an edge every few minutes, while the page is in view.
  useEffect(() => {
    const minutes = mascot?.peekMinutes || 0;
    if (!minutes) return undefined;
    const peek = () => {
      if (busy.current || document.hidden || mascotHidden() || QUIET.test(path.current)) return;
      const hi = !greeted.current && mascot.name ? `Hi, I'm ${mascot.name}!` : pick(PEP);
      greeted.current = true;
      const where = pick(SPOTS);
      const what = where === "bottom" ? "grip" : where === "top" ? "wave" : pick(["wave", "wave", "lookabout"]);
      show(where, "peek", what, hi, 3200);
    };
    const first = setTimeout(peek, 15000);
    const every = setInterval(peek, minutes * 60000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [mascot?.peekMinutes, mascot?.name]);

  // Dozes off when left alone; wakes with a stretch.
  useEffect(() => {
    if (!ambient) return undefined;
    const wake = () => {
      sleeping.current = false;
      show("bottom", "full", "stretch", lateNow() ? "It's late. Sleep soon?" : pick(["Ahh, I dozed off!", "Oh! You're back!"]), 2800);
    };
    const active = (e) => {
      lastActive.current = Date.now();
      if (sleeping.current && !e.target?.closest?.(".mq-host")) wake();
    };
    const kinds = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    kinds.forEach((k) => window.addEventListener(k, active, { passive: true, capture: true }));
    const check = setInterval(() => {
      if (sleeping.current || busy.current || document.hidden || mascotHidden() || QUIET.test(path.current)) return;
      if (Date.now() - lastActive.current < (lateNow() ? 30000 : 60000)) return;
      show("bottom", "peek", "sleep", "", 0);
      sleeping.current = true;
    }, 5000);
    return () => {
      kinds.forEach((k) => window.removeEventListener(k, active, { capture: true }));
      clearInterval(check);
    };
  }, [ambient]);

  // Something fitting on each screen, now and then.
  useEffect(() => {
    setMenu(false);
    const later = takeLater();
    if (later) {
      const t = setTimeout(() => mascotReact(later.mood, later.say), 1200);
      lastAct.current = Date.now();
      return () => clearTimeout(t);
    }
    if (!ambient || QUIET.test(location.pathname)) return undefined;
    const act = ACTS.find(([re]) => re.test(location.pathname));
    if (!act) return undefined;
    const t = setTimeout(() => {
      if (busy.current || document.hidden || mascotHidden() || Date.now() - lastAct.current < ACT_GAP) return;
      lastAct.current = Date.now();
      greeted.current = true;
      show(side(), "full", act[1], act[2](), 3400);
    }, 2500);
    return () => clearTimeout(t);
  }, [location.pathname, ambient]);

  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(enter.current); }, []);

  if (!mascot?.character || hidden) return null;

  const W = 104;
  const H = (W * 180) / 150;
  const onClick = () => {
    if (sleeping.current) { lastActive.current = Date.now(); show("bottom", "full", "stretch", "Oh! Hi!", 2400); return; }
    clearTimeout(timer.current);
    setMenu(true);
    setSay("");
    timer.current = setTimeout(leave, 4000);
  };

  const bubble = (say || menu) && (
    <Box
      sx={{
        position: "absolute", zIndex: 1, px: 1.25, py: 0.5, borderRadius: 2, bgcolor: "text.primary", color: "background.paper",
        fontSize: 13, whiteSpace: "nowrap", boxShadow: 2,
        ...(spot === "right" && { bottom: "100%", right: pos === "peek" ? 40 : 0, mb: 0.5 }),
        ...(spot === "left" && { bottom: "100%", left: pos === "peek" ? 40 : 0, mb: 0.5 }),
        ...(spot === "bottom" && { bottom: pos === "peek" ? H * 0.5 + 6 : H + 6, right: 0 }),
        ...(spot === "top" && { top: pos === "peek" ? H * 0.6 + 6 : H + 6, right: 0 }),
      }}
    >
      {menu ? (
        <Button size="small" sx={{ color: "inherit", p: 0, minWidth: 0, fontSize: 13 }} onClick={() => { setMascotHidden(true); setHidden(true); }}>
          Hide {mascot.name || "me"} (turn back on in Account)
        </Button>
      ) : say}
    </Box>
  );

  const lean = pos === "peek" && (spot === "right" ? "rotate(-14deg)" : spot === "left" ? "rotate(14deg)" : null);
  const figure = (
    <Box
      className="mq-wrap"
      onClick={onClick}
      sx={{
        cursor: "pointer",
        transform: [spot === "left" && "scaleX(-1)", spot === "top" && "rotate(180deg)", lean].filter(Boolean).join(" ") || "none",
        transition: "transform .55s",
      }}
    >
      <MascotFigure
        character={mascot.character}
        move={move}
        width={W}
        hue={hue}
        pose={pos === "peek" ? (spot === "bottom" ? "up" : spot === "top" ? null : "side") : null}
      />
    </Box>
  );

  const slide = { transform: figureTransform(spot, pos), transition: "transform .55s cubic-bezier(.3,1.4,.5,1)" };
  const edge = spot === "left" ? { left: 0 } : { right: 0 };

  return (
    <Box
      key={spot}
      className="mq-host"
      sx={{
        position: "fixed", zIndex: 1200, width: W,
        pointerEvents: pos === "out" ? "none" : "auto",
        ...(spot === "right" || spot === "left" ? { bottom, ...edge } : {}),
        ...(spot === "bottom" ? { bottom, right: 88 } : {}),
        ...(spot === "top" ? { top, right: 88 } : {}),
      }}
    >
      {bubble}
      {spot === "right" || spot === "left" ? (
        <Box sx={slide}>{figure}</Box>
      ) : (
        // Rises from behind the bottom bar, or hangs from the top bar: the
        // box clips it at that edge.
        <Box sx={{ height: H + 8, overflow: "hidden", position: "relative", ...(spot === "top" ? {} : { mt: -1 }) }}>
          <Box sx={{ position: "absolute", left: 0, right: 0, ...(spot === "top" ? { top: 0 } : { bottom: 0 }), ...slide }}>{figure}</Box>
        </Box>
      )}
    </Box>
  );
}
