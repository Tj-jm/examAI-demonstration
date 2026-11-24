// The site mascot (Settings → Student app → Mascot). A character is plain
// data, never markup: a few named parts, each a list of simple shapes, drawn
// on a 150 × 180 canvas. The apps build the SVG from it element by element,
// so an AI-drawn character can't carry a script, a link or an outside image.
// The moves (wave, cheer, dance…) rotate the arms and move the whole body,
// so they work on any character drawn this way.
//
// Parts, drawn in this order: legs, armL, armR, body, face, eyes.
// armL hangs off the body's left side and its rightmost point is the
// shoulder (it rotates around that); armR is the mirror image.

const PARTS = ["legs", "armL", "armR", "body", "face", "eyes"];
const TAGS = ["path", "circle", "ellipse", "rect", "polygon", "line"];
const NUMS = ["cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "sw", "opacity"];
const MAX_PER_PART = 24;
const MAX_SHAPES = 90;

const COLOR = /^(#[0-9a-fA-F]{3,8}|none)$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,2000}$/;
const POINTS = /^[0-9.,\s-]{1,1000}$/;

const cleanShape = (s) => {
  if (!s || typeof s !== "object" || !TAGS.includes(s.t)) return null;
  const out = { t: s.t };
  for (const k of NUMS) {
    if (s[k] === undefined || s[k] === null) continue;
    const n = Number(s[k]);
    if (!Number.isFinite(n)) continue;
    out[k] = k === "opacity" ? Math.min(1, Math.max(0, n)) : Math.min(400, Math.max(-100, Math.round(n * 10) / 10));
  }
  if (s.t === "path") {
    if (typeof s.d !== "string" || !PATH.test(s.d)) return null;
    out.d = s.d.trim();
  }
  if (s.t === "polygon") {
    if (typeof s.points !== "string" || !POINTS.test(s.points)) return null;
    out.points = s.points.trim();
  }
  for (const k of ["fill", "stroke"]) {
    if (typeof s[k] === "string" && COLOR.test(s[k].trim())) out[k] = s[k].trim();
  }
  if (["round", "butt", "square"].includes(s.cap)) out.cap = s.cap;
  if (["round", "miter", "bevel"].includes(s.join)) out.join = s.join;
  return out;
};

// A character from anywhere (the AI, a saved setting) made safe, or null.
const cleanCharacter = (c) => {
  if (!c || typeof c !== "object") return null;
  const out = {};
  let total = 0;
  for (const part of PARTS) {
    const list = Array.isArray(c[part]) ? c[part] : [];
    out[part] = [];
    for (const s of list.slice(0, MAX_PER_PART)) {
      if (total >= MAX_SHAPES) break;
      const clean = cleanShape(s);
      if (clean) {
        out[part].push(clean);
        total += 1;
      }
    }
  }
  return out.body.length ? out : null;
};

// The builder's picks (admin MascotSettings): short names, on/off and
// colours only; anything else is dropped.
const cleanBuilt = (b) => {
  if (!b || typeof b !== "object") return null;
  const out = {};
  for (const k of ["body", "eyes", "mouth", "arms", "legs", "extra"]) {
    if (typeof b[k] === "string" && /^[a-z]{1,16}$/.test(b[k])) out[k] = b[k];
  }
  for (const k of ["cheeks", "hasBelly"]) if (b[k] !== undefined) out[k] = Boolean(b[k]);
  const colours = {};
  for (const k of ["body", "belly", "limb", "hand", "cheek"]) {
    if (typeof b.colours?.[k] === "string" && /^#[0-9a-f]{6}$/i.test(b.colours[k])) colours[k] = b.colours[k];
  }
  out.colours = colours;
  return out;
};

// ------------------------------------------------------------- built in

const P = (d, stroke, sw, extra = {}) => ({ t: "path", d, stroke, sw, fill: "none", cap: "round", ...extra });
const C = (cx, cy, r, fill) => ({ t: "circle", cx, cy, r, fill });
const E = (cx, cy, rx, ry, fill, opacity) => ({ t: "ellipse", cx, cy, rx, ry, fill, ...(opacity ? { opacity } : {}) });

const PRESETS = {
  pip: {
    label: "Pip: round buddy with pom-poms",
    character: {
      legs: [P("M60 160 v12", "#4a4ac4", 9), P("M90 160 v12", "#4a4ac4", 9)],
      armL: [P("M38 108 Q20 104 14 92", "#4a4ac4", 9), C(13, 88, 13, "#ff8a3d"), C(7, 83, 6, "#ffb27a"), C(19, 82, 6, "#ffb27a")],
      armR: [P("M112 108 Q130 104 136 92", "#4a4ac4", 9), C(137, 88, 13, "#ff8a3d"), C(131, 82, 6, "#ffb27a"), C(143, 83, 6, "#ffb27a")],
      body: [{ t: "path", d: "M52 66 Q75 40 98 66", fill: "#5b5bd6" }, C(75, 52, 7, "#ff8a3d"), E(75, 112, 44, 54, "#5b5bd6"), E(75, 126, 28, 28, "#7b7be6")],
      face: [E(50, 110, 7, 4, "#ff8fb1", 0.7), E(100, 110, 7, 4, "#ff8fb1", 0.7), P("M66 112 Q75 120 84 112", "#1d1d1f", 3)],
      eyes: [E(60, 96, 7, 9, "#1d1d1f"), E(90, 96, 7, 9, "#1d1d1f"), C(62, 93, 2.5, "#ffffff"), C(92, 93, 2.5, "#ffffff")],
    },
  },
  nib: {
    label: "Nib: a pencil",
    character: {
      legs: [],
      armL: [P("M54 104 Q34 100 26 86", "#1d1d1f", 5), { t: "circle", cx: 25, cy: 83, r: 6, fill: "#ffffff", stroke: "#1d1d1f", sw: 3 }],
      armR: [P("M96 104 Q116 100 124 86", "#1d1d1f", 5), { t: "circle", cx: 125, cy: 83, r: 6, fill: "#ffffff", stroke: "#1d1d1f", sw: 3 }],
      body: [
        { t: "rect", x: 52, y: 30, width: 46, height: 18, fill: "#ff8fb1" },
        { t: "rect", x: 52, y: 46, width: 46, height: 10, fill: "#c0c0c8" },
        { t: "rect", x: 52, y: 56, width: 46, height: 88, fill: "#ffd166" },
        { t: "rect", x: 67, y: 56, width: 16, height: 88, fill: "#ffc53d" },
        { t: "polygon", points: "52,144 75,172 98,144", fill: "#f3d9b1" },
        { t: "polygon", points: "68,164 75,172 82,164", fill: "#1d1d1f" },
      ],
      face: [E(58, 96, 5, 3, "#ff8fb1", 0.8), E(92, 96, 5, 3, "#ff8fb1", 0.8), P("M68 98 Q75 105 82 98", "#1d1d1f", 3)],
      eyes: [E(65, 84, 5, 7, "#1d1d1f"), E(85, 84, 5, 7, "#1d1d1f"), C(66.5, 82, 2, "#ffffff"), C(86.5, 82, 2, "#ffffff")],
    },
  },
  spark: {
    label: "Spark: a little star",
    character: {
      legs: [P("M62 150 v18", "#e0a400", 7), P("M88 150 v18", "#e0a400", 7)],
      armL: [P("M44 110 Q26 108 18 96", "#e0a400", 7), C(16, 92, 6, "#ff8a3d")],
      armR: [P("M106 110 Q124 108 132 96", "#e0a400", 7), C(134, 92, 6, "#ff8a3d")],
      body: [{ t: "polygon", points: "75,40 91,82 136,84 101,112 113,156 75,131 37,156 49,112 14,84 59,82", fill: "#ffd166", stroke: "#e0a400", sw: 4, join: "round" }],
      face: [E(55, 110, 6, 3.5, "#ff8fb1", 0.8), E(95, 110, 6, 3.5, "#ff8fb1", 0.8), P("M67 112 Q75 121 83 112", "#1d1d1f", 3)],
      eyes: [E(64, 98, 5.5, 7.5, "#1d1d1f"), E(86, 98, 5.5, 7.5, "#1d1d1f"), C(65.5, 95.5, 2, "#ffffff"), C(87.5, 95.5, 2, "#ffffff")],
    },
  },
};

// What the student app gets (publicController): null when off.
const forStudents = (m) => {
  if (!m?.enabled) return null;
  const character = m.preset === "custom" ? cleanCharacter(m.custom) : PRESETS[m.preset]?.character;
  return {
    name: m.name || "",
    character: character || PRESETS.pip.character,
    peekMinutes: Math.max(0, Number(m.peekMinutes ?? 4)),
    cheer: m.cheer !== false,
  };
};

module.exports = { PARTS, cleanCharacter, PRESETS, forStudents, cleanBuilt };
