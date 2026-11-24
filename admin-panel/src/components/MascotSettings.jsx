import { useState, createElement } from "react";
import { useGetMascotPresetsQuery, useGenerateMascotMutation } from "../api/contentApi";
import { ErrorNote, Field } from "./bits";
import { BODIES, EYES, MOUTHS, ARMS, LEGS, EXTRAS, COLOURS, DEFAULT_BUILD, buildMascot, randomBuild } from "./mascotParts";

// The builder: pick a body, eyes, mouth, arms, legs, an extra and colours.
// Every pick redraws "Your own" at once; Save keeps it.
const PICKS = [["body", "Body", BODIES], ["eyes", "Eyes", EYES], ["mouth", "Mouth", MOUTHS], ["arms", "Arms", ARMS], ["legs", "Legs", LEGS], ["extra", "Extra", EXTRAS]];
function Builder({ built, onBuild }) {
  const b = { ...DEFAULT_BUILD, ...built, colours: { ...DEFAULT_BUILD.colours, ...(built?.colours || {}) } };
  const set = (patch) => onBuild({ ...b, ...patch });
  return (
    <div className="stack" style={{ gap: 10 }}>
      {PICKS.map(([key, label, table]) => (
        <div key={key} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="small" style={{ width: 52 }}>{label}</span>
          {Object.entries(table).map(([k, v]) => (
            <button key={k} type="button" className={`pill pill-btn row-tight${b[key] === k ? " pill-on" : ""}`} onClick={() => set({ [key]: k })}>
              {key === "body" && <Figure character={buildMascot({ ...b, body: k })} move="idle" width={20} />}
              {v.label}
            </button>
          ))}
        </div>
      ))}
      <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        {COLOURS.map(([k, l]) => (
          <label key={k} className="stack" style={{ gap: 2 }}>
            <span className="small muted">{l}</span>
            <input type="color" value={b.colours[k]} onChange={(e) => set({ colours: { ...b.colours, [k]: e.target.value } })} style={{ width: 52, height: 30, padding: 2, border: "1px solid var(--border)", borderRadius: 8, background: "transparent" }} />
          </label>
        ))}
        <label className="row-tight small"><input type="checkbox" checked={b.hasBelly} onChange={(e) => set({ hasBelly: e.target.checked })} /> Belly</label>
        <label className="row-tight small"><input type="checkbox" checked={b.cheeks} onChange={(e) => set({ cheeks: e.target.checked })} /> Cheeks</label>
      </div>
      <div className="row-tight">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onBuild(randomBuild())}>Surprise me</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onBuild(DEFAULT_BUILD)}>Start over</button>
      </div>
    </div>
  );
}

// Settings → Student app → Mascot. Pick a built-in character or have AI
// draw one from a description, preview its moves, set how often it shows.
// The drawing is shape data (backend utils/mascot.js), drawn here element
// by element: the same as the student app (components/Mascot.jsx).

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

const CSS = `
.mq{transform-origin:50% 100%;transform-box:fill-box}
.mq .mq-armL{transform-origin:right center;transform-box:fill-box}
.mq .mq-armR{transform-origin:left center;transform-box:fill-box}
.mq .mq-eyes{transform-origin:center;transform-box:fill-box}
.mq .mq-zz{opacity:0}
.mq-idle{animation:mqBreathe 2.6s ease-in-out infinite}
.mq-idle .mq-eyes{animation:mqBlink 4s infinite}
.mq-wave{animation:mqBreathe 2.6s ease-in-out infinite}
.mq-wave .mq-armR{animation:mqWave .45s ease-in-out infinite alternate}
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
.mq-sleep .mq-zz{animation:mqZz 2.4s ease-in-out infinite}
@keyframes mqBreathe{50%{transform:scale(1.02,.98)}}
@keyframes mqBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
@keyframes mqWave{from{transform:rotate(-10deg)}to{transform:rotate(-75deg)}}
@keyframes mqHop{0%,100%{transform:translateY(0) scale(1.04,.96)}45%{transform:translateY(-30px) scale(.97,1.04)}}
@keyframes mqPumpL{50%{transform:rotate(70deg)}}
@keyframes mqPumpR{50%{transform:rotate(-70deg)}}
@keyframes mqSway{0%,100%{transform:rotate(-8deg) translateX(-8px)}50%{transform:rotate(8deg) translateX(8px)}}
@keyframes mqNod{50%{transform:rotate(4deg) translateY(3px)}}
@keyframes mqZz{0%{opacity:0;transform:translate(0,0)}30%{opacity:1}100%{opacity:0;transform:translate(14px,-26px)}}
@media (prefers-reduced-motion:reduce){.mq,.mq *{animation:none!important}}
`;

function Figure({ character, move = "idle", width = 120 }) {
  if (!character) return null;
  return (
    <svg viewBox="0 0 150 180" width={width} height={(width * 180) / 150} style={{ overflow: "visible", display: "block" }} aria-hidden="true">
      <style>{CSS}</style>
      <g className={`mq mq-${move}`}>
        <ellipse cx="75" cy="175" rx="36" ry="4.5" fill="#000" opacity=".12" />
        {PARTS.map((part) => (
          <g key={part} className={`mq-${part}`}>
            {(character[part] || []).filter((s) => TAGS.has(s?.t)).map((s, i) => createElement(s.t, { key: i, ...shapeProps(s) }))}
          </g>
        ))}
        <text className="mq-zz" x="112" y="50" fontSize="18" fontWeight="700" fill="#8a8a96">z</text>
      </g>
    </svg>
  );
}

const MOVES = [["idle", "Idle"], ["wave", "Wave"], ["cheer", "Cheer"], ["dance", "Dance"], ["comfort", "Wrong answer"], ["sleep", "Sleep"]];

export default function MascotSettings({ value, onChange }) {
  const m = { enabled: false, name: "", preset: "pip", custom: null, description: "", peekMinutes: 4, cheer: true, ...value };
  const { data } = useGetMascotPresetsQuery();
  const [generate, { isLoading: drawing, error }] = useGenerateMascotMutation();
  const [move, setMove] = useState("wave");
  const [building, setBuilding] = useState(false);
  const onBuild = (built) => onChange({ built, custom: buildMascot(built), preset: "custom" });
  const presets = data?.presets || [];
  const current = m.preset === "custom" ? m.custom : presets.find((p) => p.key === m.preset)?.character;

  const [shown, setShown] = useState("");
  const [paste, setPaste] = useState(null);
  const [importNote, setImportNote] = useState("");

  const draw = async () => {
    const r = await generate({ description: m.description });
    if (r.data?.character) { onChange({ custom: r.data.character, preset: "custom", built: null }); setShown("ai"); }
  };

  // A mascot file: the same parts the app draws (legs, armL, armR, body,
  // face, eyes). The server checks every shape again on Save.
  const importText = (text) => {
    let c;
    try { c = JSON.parse(text); } catch { setImportNote("That is not a mascot file (not valid JSON)."); return; }
    if (c && typeof c === "object" && c.character) c = c.character;
    const parts = ["legs", "armL", "armR", "body", "face", "eyes"];
    if (!c || typeof c !== "object" || !Array.isArray(c.body) || !c.body.length) { setImportNote("That file has no mascot in it (it needs a body)."); return; }
    const character = Object.fromEntries(parts.map((p) => [p, Array.isArray(c[p]) ? c[p] : []]));
    onChange({ custom: character, preset: "custom", built: null });
    setShown("file");
    setPaste(null);
    setImportNote("");
  };
  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 200000) { setImportNote("That file is too big for a mascot."); return; }
    f.text().then(importText);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(m.name || m.preset || "mascot").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <label className="spread" style={{ cursor: "pointer" }}>
        <span className="grow">
          <span style={{ display: "block" }}>Show a mascot to students</span>
          <span className="hint">It peeks in from the screen edge now and then, cheers right answers and good results, and nods along on wrong ones. Never on exam or live class screens. Students can hide it in their Account.</span>
        </span>
        <input type="checkbox" checked={Boolean(m.enabled)} onChange={(e) => onChange({ enabled: e.target.checked })} />
      </label>

      <div className="row" style={{ alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
        <div style={{ width: 200, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "18px 8px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface-alt, rgba(127,127,127,.06))" }}>
          <div style={{ height: 160, display: "flex", alignItems: "flex-end" }}>
            {current ? <Figure character={current} move={move} width={120} /> : <span className="small muted">Nothing drawn yet.</span>}
          </div>
          <div className="row-tight" style={{ flexWrap: "wrap", justifyContent: "center" }}>
            {MOVES.map(([k, l]) => (
              <button key={k} type="button" className={`pill pill-btn${move === k ? " pill-on" : ""}`} onClick={() => setMove(k)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="stack grow" style={{ gap: 10, minWidth: 260 }}>
          <Field label="Character">
            <div className="row-tight" style={{ flexWrap: "wrap" }}>
              {presets.map((p) => (
                <button key={p.key} type="button" className={`pill pill-btn row-tight${m.preset === p.key ? " pill-on" : ""}`} onClick={() => onChange({ preset: p.key })}>
                  <Figure character={p.character} move="idle" width={22} /> {p.label.split(":")[0]}
                </button>
              ))}
              <button type="button" className={`pill pill-btn${m.preset === "custom" ? " pill-on" : ""}`} disabled={!m.custom} onClick={() => onChange({ preset: "custom" })}>
                Your own{m.custom ? "" : " (build or draw it below)"}
              </button>
            </div>
          </Field>

          <Field label="Build your own" hint="Pick the parts and colours. It always moves, blinks and talks properly. Save to keep it.">
            {building ? <Builder built={m.built} onBuild={onBuild} /> : (
              <div className="row-tight">
                <button type="button" className="btn btn-quiet" onClick={() => { setBuilding(true); if (!m.built) onBuild(DEFAULT_BUILD); else onChange({ custom: buildMascot(m.built), preset: "custom" }); }}>
                  {m.built ? "Edit the built mascot" : "Open the builder"}
                </button>
              </div>
            )}
          </Field>

          <Field label="Draw your own with AI" hint="Describe it: what it is, its colours, anything it holds or wears. AI draws it as simple shapes the app can animate. Try again until you like it, then Save. It must be an original character.">
            <textarea
              className="input"
              rows={3}
              maxLength={600}
              placeholder="e.g. a small green frog in a graduation cap, holding a yellow pencil, big round eyes"
              value={m.description || ""}
              onChange={(e) => onChange({ description: e.target.value })}
            />
            <div className="row-tight" style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-quiet" disabled={drawing || (m.description || "").trim().length < 3} onClick={draw}>
                {drawing ? "Drawing…" : shown === "ai" ? "Draw again" : "Draw it"}
              </button>
              {m.custom && m.preset === "custom" && !m.built && shown === "ai" && <span className="small muted">Showing the AI drawing. Save to keep it.</span>}
            </div>
            {error && <ErrorNote error={error} />}
          </Field>

          <Field label="Import a mascot file" hint="A .json mascot file (the same kind Download gives you). It replaces Your own. Save to keep it.">
            <div className="row-tight" style={{ flexWrap: "wrap" }}>
              <label className="btn btn-quiet" style={{ cursor: "pointer" }}>
                Choose file
                <input type="file" accept=".json,application/json" onChange={onFile} style={{ display: "none" }} />
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => setPaste(paste === null ? "" : null)}>{paste === null ? "Paste instead" : "Cancel paste"}</button>
              {current && <button type="button" className="btn btn-ghost" onClick={download}>Download this mascot</button>}
              {shown === "file" && m.preset === "custom" && <span className="small muted">Showing the imported mascot. Save to keep it.</span>}
            </div>
            {paste !== null && (
              <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                <textarea className="input" rows={5} placeholder='{"legs": [...], "armL": [...], "armR": [...], "body": [...], "face": [...], "eyes": [...]}' value={paste} onChange={(e) => setPaste(e.target.value)} />
                <div><button type="button" className="btn btn-quiet btn-sm" disabled={!paste.trim()} onClick={() => importText(paste)}>Use it</button></div>
              </div>
            )}
            {importNote && <div className="small" style={{ color: "var(--danger, #c23b3b)", marginTop: 6 }}>{importNote}</div>}
          </Field>

          <Field label="Name (optional)" hint="It says hi with it the first time it peeks in.">
            <input className="input" maxLength={30} style={{ maxWidth: 240 }} value={m.name || ""} onChange={(e) => onChange({ name: e.target.value })} />
          </Field>

          <Field label="Peeks in every (minutes)" hint="0 = never; it then only comes out to react.">
            <input className="input" type="number" min="0" max="60" style={{ maxWidth: 110 }} value={m.peekMinutes} onChange={(e) => onChange({ peekMinutes: Number(e.target.value) })} />
          </Field>

          <label className="spread" style={{ cursor: "pointer" }}>
            <span className="grow">
              <span style={{ display: "block" }}>Reacts to answers and results</span>
              <span className="hint">Cheers a right answer and dances on a streak or a score of 80% or more. Practice, quizzes, AI Tutoring, Oral Quiz and exam results.</span>
            </span>
            <input type="checkbox" checked={m.cheer !== false} onChange={(e) => onChange({ cheer: e.target.checked })} />
          </label>
        </div>
      </div>
    </div>
  );
}
