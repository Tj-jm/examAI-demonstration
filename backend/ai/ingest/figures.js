// Diagrams, graphs and circuit drawings are part of a question — Engineering
// Q2's "O কেন্দ্র বিশিষ্ট ABC বৃত্ত" means nothing without the circle. A page read
// with AI vision marks each figure with where it sits on the page:
//
//   [FIGURE f1 | box: 120,80,480,300 | circle with diameter AB and radius OC]
//
// (box = left, top, right, bottom in thousandths of the page width/height).
// Models sometimes drop the "box:" word ("[FIGURE f2 | 134,477,397,620 | …]");
// that is read the same way.
// Extraction then says which question, option or solution a figure belongs
// to, and the figure is cut out of the rendered page and attached as that
// field's image.

const FIGURE_MARKER = /\[FIGURE\s+([a-z0-9]+)\s*\|\s*(?:box\s*:?\s*)?(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*,\s*(\d{1,4})\s*(?:\|\s*([^\]]*))?\]/gi;

// Figure ids are only unique within a page ("f1"), so each page's are
// renamed to "p3f1" before its text joins the rest of the document.
const renameFigures = (transcript, pageNumber) =>
  String(transcript || "").replace(FIGURE_MARKER, (m, id, x0, y0, x1, y1, caption) =>
    `[FIGURE p${pageNumber}${id.toLowerCase().replace(/^p\d+/, "")} | box: ${x0},${y0},${x1},${y1}${caption ? ` | ${caption.trim()}` : ""}]`);

// → Map id → { page, box: [x0, y0, x1, y1], caption } for every marker in the
// document's (already renamed) text.
const indexFigures = (text) => {
  const figures = new Map();
  for (const m of String(text || "").matchAll(FIGURE_MARKER)) {
    const id = m[1].toLowerCase();
    const page = Number((id.match(/^p(\d+)/) || [])[1]);
    if (!page) continue;
    figures.set(id, { page, box: [m[2], m[3], m[4], m[5]].map(Number), caption: (m[6] || "").trim() });
  }
  return figures;
};

// A box the model got obviously wrong: inverted, a sliver, or most of the
// page. The question is still saved — only the picture is left for a person.
const checkBox = ([x0, y0, x1, y1]) => {
  if (![x0, y0, x1, y1].every((v) => Number.isFinite(v) && v >= 0 && v <= 1000)) return "the figure's position was out of range";
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return "the figure's position was invalid";
  if (w < 20 || h < 15) return "the figure's box was too small to be a real figure";
  if (w * h > 700000) return "the figure's box covered most of the page";
  return null;
};

// Vision models place boxes roughly; an embedded picture's real position is
// known exactly (pdfPages.imageBoxes). When the model's box clearly means one
// of them — overlapping it well, or centred inside it — the exact one wins.
const iou = (a, b) => {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
  return inter / (area(a) + area(b) - inter);
};

const snapBox = (box, candidates = []) => {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const inside = cx >= c[0] && cx <= c[2] && cy >= c[1] && cy <= c[3];
    const score = Math.max(iou(box, c), inside ? 0.31 : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return bestScore >= 0.3 ? best : box;
};

// Where a figure is cut from: an embedded picture's exact box when the
// model's box means one (snapBox); else a drawn diagram's box
// (pdfPages.drawnBoxes) when it overlaps the model's well, or holds its
// centre without being much bigger — a drawing can sit inside a big frame, and
// the frame isn't the figure; else the model's own box.
// → { box, source: "image" | "drawn" | "model" }
const areaOf = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const placeFigure = (box, images = [], drawn = []) => {
  const image = snapBox(box, images);
  if (image !== box) return { box: image, source: "image" };
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  let best = null;
  let bestScore = 0;
  for (const c of drawn) {
    const inside = cx >= c[0] && cx <= c[2] && cy >= c[1] && cy <= c[3] && areaOf(c) <= areaOf(box) * 3;
    const score = Math.max(iou(box, c), inside ? 0.31 : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return bestScore >= 0.3 ? { box: best, source: "drawn" } : { box, source: "model" };
};

// Some vision models (Qwen2.5-VL among them) give boxes in the image's own
// pixels whatever the prompt asks. A coordinate past 1000 can only be that, so
// every box in that reply is turned into thousandths of the image it read.
const imageSize = async (buffer) => {
  const { loadImage } = require("@napi-rs/canvas");
  const image = await loadImage(buffer);
  return [image.width, image.height];
};
const fixPixelBoxes = (text, [width, height] = []) => {
  const markers = [...String(text || "").matchAll(FIGURE_MARKER)];
  if (!width || !height || !markers.some((m) => [m[2], m[3], m[4], m[5]].some((v) => Number(v) > 1000))) return text;
  return String(text).replace(FIGURE_MARKER, (m, id, x0, y0, x1, y1, caption) => {
    const box = [x0 / width, y0 / height, x1 / width, y1 / height].map((v) => Math.min(1000, Math.round(v * 1000)));
    return `[FIGURE ${id} | box: ${box.join(",")}${caption ? ` | ${caption.trim()}` : ""}]`;
  });
};

// Fits a figure's box to what is printed there: it grows past an edge while
// ink carries on beyond it — a circuit's labels, a graph's axis numbers, a
// drawing the model's box cut through — until a blank strip. It never
// shrinks: a line drawing is mostly white inside, and trimming to the ink
// found in a misplaced box would keep only a fragment. Growth is capped, so a
// paragraph right next to the figure isn't swallowed.
// → box in thousandths, or null when there is no ink in it at all (the model
// put the box in the wrong place).
const INK = 160;
// Going up or down, a row whose ink carries on past the figure's sides is a
// line of the question's text, not a label, and growth stops there.
const fitToInk = async (pagePng, box, { gapX = 10, gapY = 12, grow = 40 } = {}) => {
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const image = await loadImage(pagePng);
  const W = image.width;
  const H = image.height;
  const px = (v, size) => Math.round((v / 1000) * size);
  const reach = [
    Math.max(0, px(box[0] - grow, W)),
    Math.max(0, px(box[1] - grow, H)),
    Math.min(W, px(box[2] + grow, W)),
    Math.min(H, px(box[3] + grow, H)),
  ];
  const rw = reach[2] - reach[0];
  const rh = reach[3] - reach[1];
  if (rw <= 0 || rh <= 0) return null;
  const canvas = createCanvas(rw, rh);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, rw, rh);
  ctx.drawImage(image, reach[0], reach[1], rw, rh, 0, 0, rw, rh);
  const { data } = ctx.getImageData(0, 0, rw, rh);
  const inked = (x, y) => {
    const i = (y * rw + x) * 4;
    return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < INK;
  };
  const rowInk = (y, x0, x1) => {
    let n = 0;
    for (let x = x0; x <= x1; x += 1) if (inked(x, y)) n += 1;
    return n;
  };
  const colInk = (x, y0, y1) => {
    let n = 0;
    for (let y = y0; y <= y1; y += 1) if (inked(x, y)) n += 1;
    return n;
  };

  // The box itself, in local pixels. Fewer than a few dark pixels in all of
  // it is blank paper (a speck or two from a scan aside).
  let l = Math.max(0, px(box[0], W) - reach[0]);
  let t = Math.max(0, px(box[1], H) - reach[1]);
  let r = Math.min(rw - 1, px(box[2], W) - reach[0] - 1);
  let b = Math.min(rh - 1, px(box[3], H) - reach[1] - 1);
  if (l > r || t > b) return null;
  let total = 0;
  for (let y = t; y <= b && total < 8; y += 1) total += rowInk(y, l, r);
  if (total < 8) return null;

  // Grow each side while ink continues within `gap` of the edge.
  const stepX = Math.max(2, px(gapX, W));
  const stepY = Math.max(2, px(gapY, H));
  for (let round = 0; round < 3; round += 1) {
    const before = [l, t, r, b].join();
    // A line of text: across the next few rows, ink on both sides of the
    // figure, and broken into many pieces inside it (glyphs). A wire running
    // on past the box's edge is one solid stroke.
    const band = Math.max(3, Math.round(stepY / 2));
    const textLine = (y, dir) => {
      let left = 0;
      let right = 0;
      let pieces = 0;
      for (let k = 0; k < band; k += 1) {
        const yy = y + dir * k;
        if (yy < 0 || yy >= rh) break;
        left += rowInk(yy, Math.max(0, l - stepX * 3), l - 1);
        right += rowInk(yy, r + 1, Math.min(rw - 1, r + stepX * 3));
        for (let x = l + 1; x <= r; x += 1) if (inked(x, yy) && !inked(x - 1, yy)) pieces += 1;
      }
      // A side already at the edge of what was looked at can't be checked,
      // so it doesn't count against.
      const leftOk = left > 0 || l < stepX;
      const rightOk = right > 0 || r > rw - 1 - stepX;
      return leftOk && rightOk && pieces >= ((r - l) / 40) * band;
    };
    for (let y = t - 1, blank = 0; y >= 0 && blank < stepY; y -= 1) {
      if (!rowInk(y, l, r)) blank += 1;
      else if (textLine(y, -1)) break;
      else { t = y; blank = 0; }
    }
    for (let y = b + 1, blank = 0; y < rh && blank < stepY; y += 1) {
      if (!rowInk(y, l, r)) blank += 1;
      else if (textLine(y, 1)) break;
      else { b = y; blank = 0; }
    }
    for (let x = l - 1, blank = 0; x >= 0 && blank < stepX; x -= 1) { if (colInk(x, t, b)) { l = x; blank = 0; } else blank += 1; }
    for (let x = r + 1, blank = 0; x < rw && blank < stepX; x += 1) { if (colInk(x, t, b)) { r = x; blank = 0; } else blank += 1; }
    if ([l, t, r, b].join() === before) break;
  }

  const back = (v, offset, size) => Math.round(((v + offset) / size) * 1000);
  return [back(l, reach[0], W), back(t, reach[1], H), back(r + 1, reach[0], W), back(b + 1, reach[1], H)];
};

// Cuts one figure out of a rendered page (PNG buffer) with a little padding,
// so a box drawn tight to the lines doesn't clip labels. → PNG buffer.
const cropFigure = async (pagePng, box, pad = 15) => {
  // Required lazily, like pdf-parse: a platform without the native canvas
  // binding still extracts text; only figure cropping is unavailable.
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const image = await loadImage(pagePng);
  const [x0, y0, x1, y1] = box;
  const left = Math.max(0, Math.floor(((x0 - pad) / 1000) * image.width));
  const top = Math.max(0, Math.floor(((y0 - pad) / 1000) * image.height));
  const right = Math.min(image.width, Math.ceil(((x1 + pad) / 1000) * image.width));
  const bottom = Math.min(image.height, Math.ceil(((y1 + pad) / 1000) * image.height));
  const canvas = createCanvas(right - left, bottom - top);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
  return canvas.toBuffer("image/png");
};

// ---------------------------------------------------------------- halves
// A page too dense for one transcription (it came back cut off) is read again
// as two halves: its two columns when it has them — most textbooks and
// question papers do — otherwise top and bottom, with a little overlap so a
// line on the cut isn't lost.

// Finds a two-column page's gutter from the rendered image: a vertical strip,
// near the middle of the printed area, with (almost) no ink from top to
// bottom and real content on both sides. → x in thousandths, or null.
const findGutter = async (pagePng) => {
  const { createCanvas, loadImage } = require("@napi-rs/canvas");
  const image = await loadImage(pagePng);
  const width = 400;
  const height = Math.max(1, Math.round((image.height / image.width) * width));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const ink = new Float64Array(width);
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    let rowInk = false;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 150) {
        ink[x] += 1;
        rowInk = true;
      }
    }
    if (rowInk) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const rows = bottom - top + 1;
  if (rows < height * 0.2) return null;

  // The printed area's own left/right edges, ignoring scanner specks.
  const inked = [...ink.keys()].filter((x) => ink[x] > rows * 0.01);
  if (inked.length < 2) return null;
  const left = inked[0];
  const right = inked[inked.length - 1];
  const span = right - left;

  let best = null;
  let run = null;
  for (let x = Math.round(left + span * 0.3); x <= Math.round(left + span * 0.7); x += 1) {
    if (ink[x] <= rows * 0.004) {
      run = run ? { start: run.start, end: x } : { start: x, end: x };
      if (!best || run.end - run.start > best.end - best.start) best = { ...run };
    } else {
      run = null;
    }
  }
  if (!best || best.end - best.start + 1 < Math.max(2, width * 0.008)) return null;

  const mid = (best.start + best.end) / 2;
  const total = ink.reduce((a, b) => a + b, 0);
  let leftInk = 0;
  for (let x = 0; x < mid; x += 1) leftInk += ink[x];
  if (leftInk < total * 0.15 || total - leftInk < total * 0.15) return null;
  return Math.round((mid / width) * 1000);
};

// → two regions [left, top, right, bottom] (thousandths of the page) and how
// to describe each to the model.
const halves = async (pagePng) => {
  const gutter = await findGutter(pagePng);
  if (gutter) {
    return [
      { region: [0, 0, Math.min(1000, gutter + 10), 1000], label: "left column" },
      { region: [Math.max(0, gutter - 10), 0, 1000, 1000], label: "right column" },
    ];
  }
  return [
    { region: [0, 0, 1000, 530], label: "top half" },
    { region: [0, 470, 1000, 1000], label: "bottom half" },
  ];
};

// A transcription of one half reports figure boxes relative to that half.
// They are moved back onto the whole page, and renumbered from `start` so the
// two halves' f1s don't collide. → { text, next }.
const mapFigures = (text, region, start = 1) => {
  const [rx0, ry0, rx1, ry1] = region;
  const w = (rx1 - rx0) / 1000;
  const h = (ry1 - ry0) / 1000;
  let n = start;
  const out = String(text || "").replace(FIGURE_MARKER, (m, id, x0, y0, x1, y1, caption) => {
    const box = [
      Math.round(rx0 + Number(x0) * w),
      Math.round(ry0 + Number(y0) * h),
      Math.round(rx0 + Number(x1) * w),
      Math.round(ry0 + Number(y1) * h),
    ];
    const marker = `[FIGURE f${n} | box: ${box.join(",")}${caption ? ` | ${caption.trim()}` : ""}]`;
    n += 1;
    return marker;
  });
  return { text: out, next: n };
};

// Markers are for the pipeline, not for students: stripped from any text a
// question ends up with — a malformed one ("[FIGURE f2]", no box) too.
const LOOSE_MARKER = /\[FIGURE\b[^\]]*\]/gi;
const stripFigureMarkers = (text) =>
  typeof text === "string" ? text.replace(FIGURE_MARKER, "").replace(LOOSE_MARKER, "").replace(/[ \t]{2,}/g, " ").trim() : text;

module.exports = { FIGURE_MARKER, renameFigures, indexFigures, checkBox, snapBox, placeFigure, fixPixelBoxes, imageSize, fitToInk, cropFigure, stripFigureMarkers, findGutter, halves, mapFigures };
