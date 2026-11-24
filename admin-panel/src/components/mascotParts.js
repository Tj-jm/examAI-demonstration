// The mascot builder's parts (MascotSettings.jsx). Each pick is a few simple
// shapes on the mascot's 150 × 180 canvas, in the same named parts as every
// other mascot (backend utils/mascot.js), so the moves, blinking and the
// talking mouth (BoardMascot.jsx) work on anything built here.

const P = (d, stroke, sw, extra = {}) => ({ t: "path", d, stroke, sw, fill: "none", cap: "round", ...extra });
const C = (cx, cy, r, fill, extra = {}) => ({ t: "circle", cx, cy, r, fill, ...extra });
const E = (cx, cy, rx, ry, fill, extra = {}) => ({ t: "ellipse", cx, cy, rx, ry, fill, ...extra });
const R = (x, y, width, height, rx, fill) => ({ t: "rect", x, y, width, height, rx, ry: rx, fill });
const G = (points, fill, extra = {}) => ({ t: "polygon", points, fill, ...extra });

// Each body: its shapes, where the eyes sit (y, half the gap), the shoulder
// (y, half the width there), where the legs start and the top of the head.
export const BODIES = {
  blob: { label: "Blob", eyeY: 96, gap: 15, armY: 110, half: 42, legY: 160, top: 58,
    draw: (c) => [E(75, 112, 44, 54, c.body), ...(c.belly ? [E(75, 128, 26, 26, c.belly)] : [])] },
  round: { label: "Ball", eyeY: 100, gap: 15, armY: 114, half: 46, legY: 154, top: 62,
    draw: (c) => [C(75, 110, 48, c.body), ...(c.belly ? [E(75, 130, 26, 20, c.belly)] : [])] },
  capsule: { label: "Bean", eyeY: 80, gap: 11, armY: 106, half: 28, legY: 158, top: 42,
    draw: (c) => [R(47, 42, 56, 118, 28, c.body), ...(c.belly ? [E(75, 128, 18, 22, c.belly)] : [])] },
  box: { label: "Box", eyeY: 86, gap: 15, armY: 112, half: 37, legY: 150, top: 52,
    draw: (c) => [R(38, 52, 74, 100, 14, c.body), ...(c.belly ? [R(52, 110, 46, 30, 6, c.belly)] : [])] },
  drop: { label: "Drop", eyeY: 110, gap: 14, armY: 126, half: 44, legY: 164, top: 40,
    draw: (c) => [{ t: "path", d: "M75 40 C100 80 122 100 122 128 C122 156 100 166 75 166 C50 166 28 156 28 128 C28 100 50 80 75 40 Z", fill: c.body }, ...(c.belly ? [E(75, 138, 24, 20, c.belly)] : [])] },
  star: { label: "Star", eyeY: 98, gap: 11, armY: 110, half: 32, legY: 148, top: 40,
    draw: (c) => [G("75,40 91,82 136,84 101,112 113,156 75,131 37,156 49,112 14,84 59,82", c.body, { stroke: c.limb, sw: 4, join: "round" })] },
};

const DARK = "#1d1d1f";
export const EYES = {
  dots: { label: "Dots", draw: (x, y) => [E(x, y, 5, 7, DARK), C(x + 1.5, y - 2.5, 2, "#ffffff")] },
  big: { label: "Big", draw: (x, y) => [C(x, y, 8, "#ffffff", { stroke: DARK, sw: 2 }), C(x + 1, y + 1, 4.5, DARK), C(x + 2.5, y - 1, 1.6, "#ffffff")] },
  tall: { label: "Tall", draw: (x, y) => [E(x, y, 7, 9, DARK), C(x + 2, y - 3, 2.5, "#ffffff")] },
  happy: { label: "Happy", draw: (x, y) => [P(`M${x - 6} ${y + 2} Q${x} ${y - 6} ${x + 6} ${y + 2}`, DARK, 3)] },
  sleepy: { label: "Sleepy", draw: (x, y) => [E(x, y + 1, 6, 3.5, DARK), P(`M${x - 7} ${y - 2} L${x + 7} ${y - 2}`, DARK, 2)] },
};

export const MOUTHS = {
  smile: { label: "Smile", draw: (y) => [P(`M66 ${y} Q75 ${y + 8} 84 ${y}`, DARK, 3)] },
  grin: { label: "Grin", draw: (y) => [{ t: "path", d: `M65 ${y} Q75 ${y + 13} 85 ${y} Z`, fill: DARK, stroke: DARK, sw: 2, join: "round" }] },
  small: { label: "Small", draw: (y) => [P(`M71 ${y + 1} Q75 ${y + 5} 79 ${y + 1}`, DARK, 3)] },
  cat: { label: "Cat", draw: (y) => [P(`M67 ${y} Q71 ${y + 6} 75 ${y} Q79 ${y + 6} 83 ${y}`, DARK, 3)] },
  oh: { label: "Oh", draw: (y) => [E(75, y + 3, 3.5, 4.5, DARK)] },
};

// One arm, as the left one (shoulder at sx, y); the right one is its mirror.
const ARM = {
  stick: { label: "Stick", draw: (sx, y, c) => [P(`M${sx + 4} ${y} Q${sx - 14} ${y - 4} ${sx - 20} ${y - 16}`, c.limb, 7), C(sx - 21, y - 20, 6, c.hand)] },
  noodle: { label: "Noodle", draw: (sx, y, c) => [P(`M${sx + 4} ${y} C${sx - 16} ${y + 8} ${sx - 28} ${y - 4} ${sx - 24} ${y - 24}`, c.limb, 6), C(sx - 24, y - 27, 5, c.hand)] },
  mitten: { label: "Mitten", draw: (sx, y, c) => [P(`M${sx + 4} ${y} Q${sx - 12} ${y - 2} ${sx - 18} ${y - 14}`, c.limb, 10), E(sx - 19, y - 20, 9, 8, c.hand)] },
  pompom: { label: "Pom-pom", draw: (sx, y, c) => [P(`M${sx + 4} ${y} Q${sx - 14} ${y - 4} ${sx - 20} ${y - 16}`, c.limb, 8), C(sx - 21, y - 20, 12, c.hand), C(sx - 27, y - 25, 5, "#ffffff", { opacity: 0.35 }), C(sx - 15, y - 26, 5, "#ffffff", { opacity: 0.35 })] },
};
export const ARMS = ARM;

export const LEGS = {
  stubs: { label: "Stubs", draw: (y, c) => [P(`M61 ${y} v12`, c.limb, 9), P(`M89 ${y} v12`, c.limb, 9)] },
  long: { label: "Long", draw: (y, c) => [P(`M63 ${y} v20`, c.limb, 6), P(`M87 ${y} v20`, c.limb, 6), E(59, y + 21, 8, 4, c.limb), E(91, y + 21, 8, 4, c.limb)] },
  none: { label: "None", draw: () => [] },
};

export const EXTRAS = {
  none: { label: "None", body: () => [], face: () => [] },
  antenna: { label: "Antenna", body: (b, c) => [P(`M75 ${b.top + 4} L75 ${b.top - 14}`, c.limb, 4), C(75, b.top - 17, 5, c.hand)], face: () => [] },
  cap: { label: "Graduation cap", body: (b) => [R(60, b.top - 6, 30, 10, 2, "#26262b"), G(`44,${b.top - 6} 75,${b.top - 18} 106,${b.top - 6} 75,${b.top + 6}`, "#26262b"), P(`M75 ${b.top - 6} L98 ${b.top - 2} L98 ${b.top + 12}`, "#ffd166", 2), C(98, b.top + 14, 3, "#ffd166")], face: () => [] },
  bow: { label: "Bow", body: (b, c) => [G(`75,${b.top + 2} 93,${b.top - 8} 93,${b.top + 12}`, c.hand), G(`75,${b.top + 2} 57,${b.top - 8} 57,${b.top + 12}`, c.hand), C(75, b.top + 2, 4, c.hand)], face: () => [] },
  sprout: { label: "Sprout", body: (b) => [P(`M75 ${b.top + 3} Q73 ${b.top - 8} 76 ${b.top - 16}`, "#3a9d5d", 3), E(68, b.top - 14, 7, 3.5, "#4cc27a"), E(84, b.top - 18, 7, 3.5, "#4cc27a")], face: () => [] },
  glasses: { label: "Glasses", body: () => [], face: (b) => [C(75 - b.gap, b.eyeY, 11, "none", { stroke: DARK, sw: 2.5 }), C(75 + b.gap, b.eyeY, 11, "none", { stroke: DARK, sw: 2.5 }), P(`M${75 - b.gap + 11} ${b.eyeY} L${75 + b.gap - 11} ${b.eyeY}`, DARK, 2.5)] },
};

export const COLOURS = [["body", "Body"], ["belly", "Belly"], ["limb", "Arms and legs"], ["hand", "Hands and extras"], ["cheek", "Cheeks"]];

export const DEFAULT_BUILD = {
  body: "blob", eyes: "dots", mouth: "smile", arms: "stick", legs: "stubs", extra: "none",
  colours: { body: "#5b5bd6", belly: "#7b7be6", limb: "#4a4ac4", hand: "#ff8a3d", cheek: "#ff8fb1" },
  cheeks: true, hasBelly: true,
};

const pick = (table, key, fallback) => table[key] || table[fallback];
const mirror = (s) => {
  const flip = (x) => 150 - x;
  const out = { ...s };
  if (typeof s.cx === "number") out.cx = flip(s.cx);
  if (typeof s.x === "number" && typeof s.width === "number") out.x = 150 - s.x - s.width;
  if (s.d) out.d = s.d.replace(/([MLQCST])([^MLQCSTZ]*)/g, (_, cmd, nums) => cmd + nums.trim().split(/[\s,]+/).map((n, i) => (i % 2 === 0 ? flip(Number(n)) : n)).join(" ") + " ").trim();
  return out;
};

// The picks as a character.
export function buildMascot(pickIn) {
  const p = { ...DEFAULT_BUILD, ...pickIn, colours: { ...DEFAULT_BUILD.colours, ...(pickIn?.colours || {}) } };
  const c = { ...p.colours, belly: p.hasBelly ? p.colours.belly : null };
  const b = pick(BODIES, p.body, "blob");
  const eye = pick(EYES, p.eyes, "dots");
  const mouth = pick(MOUTHS, p.mouth, "smile");
  const arm = pick(ARM, p.arms, "stick");
  const extra = pick(EXTRAS, p.extra, "none");
  const armL = arm.draw(75 - b.half, b.armY, c);
  return {
    legs: pick(LEGS, p.legs, "stubs").draw(b.legY, c),
    armL,
    armR: armL.map(mirror),
    body: [...b.draw(c), ...extra.body(b, c)],
    face: [
      ...(p.cheeks ? [E(75 - b.gap - 10, b.eyeY + 13, 6, 3.5, c.cheek, { opacity: 0.75 }), E(75 + b.gap + 10, b.eyeY + 13, 6, 3.5, c.cheek, { opacity: 0.75 })] : []),
      ...mouth.draw(b.eyeY + 15),
      ...extra.face(b),
    ],
    eyes: [...eye.draw(75 - b.gap, b.eyeY), ...eye.draw(75 + b.gap, b.eyeY)],
  };
}

const PALETTES = [
  ["#5b5bd6", "#7b7be6", "#4a4ac4", "#ff8a3d"], ["#3fb27f", "#8be0b5", "#2b8a5f", "#ffd166"], ["#ff7a59", "#ffc2a8", "#d9573a", "#5b5bd6"],
  ["#ffd166", "#fff1c2", "#e0a400", "#ff6b6b"], ["#4ab3f4", "#a8dcfb", "#2b8ac4", "#ff8fb1"], ["#b07cff", "#dcc4ff", "#8a55e0", "#ffd166"],
  ["#ef5b8a", "#ffc0d3", "#c93e6c", "#4ab3f4"], ["#8d6e63", "#d7ccc8", "#6d4c41", "#ffb74d"],
];
const any = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
export function randomBuild() {
  const [body, belly, limb, hand] = PALETTES[Math.floor(Math.random() * PALETTES.length)];
  return {
    body: any(BODIES), eyes: any(EYES), mouth: any(MOUTHS), arms: any(ARM), legs: Math.random() < 0.8 ? "stubs" : any(LEGS),
    extra: Math.random() < 0.5 ? "none" : any(EXTRAS), cheeks: Math.random() < 0.8, hasBelly: Math.random() < 0.7,
    colours: { body, belly, limb, hand, cheek: "#ff8fb1" },
  };
}
