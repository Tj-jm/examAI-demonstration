const bijoy = require("./bijoy");

// A second look at every PDF page, beyond pdf-parse's plain text: which fonts
// drew it and whether it has pictures. That answers two questions the plain
// text can't —
//
//  1. Is the text layer even Bangla? A Bijoy font (SutonnyMJ…) means the text
//     layer is Latin gibberish; those runs are converted to Unicode here, run
//     by run, leaving English and numbers in their own fonts untouched.
//  2. Can the text layer be trusted to carry the question at all? Maths set in
//     an equation font loses its layout (239° reads "2390", ¹⁄₅ reads "5 1"),
//     and a figure isn't in the text at all. Those pages are read from their
//     rendered image with AI vision instead — the way ChatGPT/Claude read a
//     PDF — with this text passed along as a hint.

// Fonts that only ever draw mathematics.
const MATH_FONT = /math|symbol|mt ?extra|euclid|cmsy|cmmi|cmex|stix|asana/i;
// Combining overline/arrow (vectors), and maths operators that only survive
// in a text layer as loose symbols.
const MATH_CHARS = /[\u0305\u0304\u20D7\u20D1\u2202\u222B\u2211\u220F\u221A\u2207]/;

// pdf.js operator codes for drawing a raster image (OPS.paintImageXObject,
// paintInlineImageXObject, paintImageXObjectRepeat). pdf-parse bundles pdf.js
// without exporting OPS; the values are part of pdf.js's stable operator
// list. Image *masks* (83/84) are left out on purpose — Type 3 fonts draw
// every glyph as one, which would make every such page look illustrated.
const IMAGE_OPS = new Set([85, 86, 88]);

// pdf.js operator codes for the graphics state: save, restore, transform,
// and entering/leaving a form XObject (which carries its own matrix).
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_FORM_BEGIN = 74;
const OP_FORM_END = 75;

// Drawn figures: a path (pdf.js OPS.constructPath, args [paint op, [path],
// box]) that is stroked or filled. Clipping paths (endPath, 28) draw nothing.
const OP_PATH = 91;
const PAINT_OPS = new Set([20, 21, 22, 23, 24, 25, 26, 27]);
// Inside a path: moveTo/lineTo carry a point, curveTo three (pdf.js DrawOPS).
const PATH_MOVE = 0;
const PATH_LINE = 1;
const PATH_CURVE = 2;

const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

// Where each embedded picture is drawn, as [left, top, right, bottom] in
// thousandths of the page — the same units the vision model is asked for —
// with its own pixel size. An image is drawn as the unit square under the
// current transform, so its corners are just that transform applied to
// (0,0)…(1,1).
const imageDraws = (page, ops) => {
  const [vx0, vy0, vx1, vy1] = page.view;
  const width = vx1 - vx0;
  const height = vy1 - vy0;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const draws = [];

  ops.fnArray.forEach((op, i) => {
    const args = ops.argsArray[i];
    if (op === OP_SAVE) stack.push(ctm);
    else if (op === OP_RESTORE) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OP_TRANSFORM) ctm = multiply(ctm, args);
    else if (op === OP_FORM_BEGIN) {
      stack.push(ctm);
      if (Array.isArray(args?.[0])) ctm = multiply(ctm, args[0]);
    } else if (op === OP_FORM_END) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (IMAGE_OPS.has(op)) {
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const box = [
        Math.round(((Math.min(...xs) - vx0) / width) * 1000),
        Math.round(((vy1 - Math.max(...ys)) / height) * 1000),
        Math.round(((Math.max(...xs) - vx0) / width) * 1000),
        Math.round(((vy1 - Math.min(...ys)) / height) * 1000),
      ].map((v) => Math.min(1000, Math.max(0, v)));
      // paintImageXObject carries [id, width, height]; an inline image
      // carries the image itself.
      const px = typeof args?.[1] === "number" ? [args[1], args[2]] : [args?.[0]?.width || 0, args?.[0]?.height || 0];
      // Specks (bullets, rules drawn as images) aren't anything.
      if (box[2] - box[0] >= 20 && box[3] - box[1] >= 15) draws.push({ box, px });
    }
  });

  return draws;
};

const areaOf = (box) => (box[2] - box[0]) * (box[3] - box[1]);

// Every painted path on the page outside its header and footer (the top and
// bottom 7%), as { box, shaped } in thousandths of the page. A path is
// "shaped" when it has a curve or a slanted line; straight horizontal and
// vertical lines and plain boxes are not, since tables, underlines, fraction
// bars and frames are made of those.
const paintedPaths = (page, ops) => {
  const [vx0, , vx1, vy1] = page.view;
  const width = vx1 - vx0;
  const height = vy1 - page.view[1];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const paths = [];

  ops.fnArray.forEach((op, i) => {
    const args = ops.argsArray[i];
    if (op === OP_SAVE) stack.push(ctm);
    else if (op === OP_RESTORE) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OP_TRANSFORM) ctm = multiply(ctm, args);
    else if (op === OP_FORM_BEGIN) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) || ArrayBuffer.isView(args?.[0])) ctm = multiply(ctm, Array.from(args[0]));
    } else if (op === OP_FORM_END) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (op === OP_PATH && PAINT_OPS.has(args?.[0])) {
      const path = args?.[1]?.[0];
      const minMax = args?.[2];
      if (!path || !minMax || path.length === undefined) return;
      let curve = false;
      let slant = false;
      let x = 0;
      let y = 0;
      for (let k = 0; k < path.length;) {
        const code = path[k++];
        if (code === PATH_MOVE) { x = path[k++]; y = path[k++]; }
        else if (code === PATH_LINE) {
          const nx = path[k++];
          const ny = path[k++];
          if (Math.abs(nx - x) > 0.5 && Math.abs(ny - y) > 0.5) slant = true;
          x = nx; y = ny;
        } else if (code === PATH_CURVE) { curve = true; k += 4; x = path[k++]; y = path[k++]; }
        else if (code !== 3) break; // closePath carries nothing; anything else is unknown
      }
      const corners = [[minMax[0], minMax[1]], [minMax[2], minMax[1]], [minMax[0], minMax[3]], [minMax[2], minMax[3]]]
        .map(([px, py]) => [ctm[0] * px + ctm[2] * py + ctm[4], ctm[1] * px + ctm[3] * py + ctm[5]]);
      const xs = corners.map((c) => ((c[0] - vx0) / width) * 1000);
      const ys = corners.map((c) => ((vy1 - c[1]) / height) * 1000);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (box[3] < 70 || box[1] > 930) return;
      paths.push({ box, shaped: curve || slant });
    }
  });
  return paths;
};

// Diagrams drawn with lines and shapes rather than pasted in as a picture
// (most of them, in a Word-made or typeset book). → true when the page has a
// real drawing on it: a few shaped strokes, together big enough to be a
// picture.
const MIN_DRAWN_PATHS = 3;
const hasDrawnFigure = (page, ops, paths = paintedPaths(page, ops)) => {
  const shaped = paths.filter((p) => p.shaped && (p.box[2] - p.box[0] >= 3 || p.box[3] - p.box[1] >= 3));
  if (shaped.length < MIN_DRAWN_PATHS) return false;
  const area = shaped.reduce((a, { box }) => [Math.min(a[0], box[0]), Math.min(a[1], box[1]), Math.max(a[2], box[2]), Math.max(a[3], box[3])], shaped[0].box);
  return area[2] - area[0] >= 40 && area[3] - area[1] >= 30;
};

// Where each drawn diagram sits: the page's paths grouped by nearness, so a
// circuit's wires, plates and battery come out as one box. Long rules and
// frames are left out (they would join everything around them), and a group
// with no curve or slant in it is a table, not a figure. The box covers the
// lines only; labels printed beside them are found when the figure is cut
// (figures.fitToInk). → [[left, top, right, bottom], …] in thousandths.
const DRAWN_GAP = 12;
const MAX_DRAWN_PATHS = 3000;
const drawnBoxes = (paths) => {
  const parts = paths
    .filter(({ box }) => {
      const w = box[2] - box[0];
      const h = box[3] - box[1];
      if (w > 900 || areaOf(box) > 500000) return false;
      if ((w > 450 && h < 3) || (h > 450 && w < 3)) return false;
      return true;
    })
    .slice(0, MAX_DRAWN_PATHS);
  const parent = parts.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a, b) => a[0] - DRAWN_GAP <= b[2] && b[0] - DRAWN_GAP <= a[2] && a[1] - DRAWN_GAP <= b[3] && b[1] - DRAWN_GAP <= a[3];
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      if (near(parts[i].box, parts[j].box)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  parts.forEach((p, i) => {
    const root = find(i);
    const g = groups.get(root) || { box: p.box, shaped: false };
    g.box = [Math.min(g.box[0], p.box[0]), Math.min(g.box[1], p.box[1]), Math.max(g.box[2], p.box[2]), Math.max(g.box[3], p.box[3])];
    g.shaped = g.shaped || p.shaped;
    groups.set(root, g);
  });
  return [...groups.values()]
    .filter((g) => g.shaped && g.box[2] - g.box[0] >= 40 && g.box[3] - g.box[1] >= 30 && areaOf(g.box) <= 700000)
    .map((g) => g.box.map((v) => Math.min(1000, Math.max(0, Math.round(v)))));
};

// A page with no text layer whose picture covers a good part of it is a scan
// or a photo of a page: that picture is the page, not a figure on it. Real
// diagrams inside a scan are found by the vision model instead.
const SCAN_TEXT_CHARS = 40;
const SCAN_IMAGE_AREA = 300000; // 30% of the page
// Rendered pages for vision are capped on their long side, so one photo of a
// page never becomes a huge upload.
const MAX_RENDER_PX = 2400;
const DEFAULT_SCALE = 2;

// The render scale (pdf points → pixels) that draws a scan at no less than
// its own resolution. The default 2 (≈150 dpi) shrinks a photo placed on
// three quarters of the page, and small print — exponents, subscripts — is
// the first thing lost.
const scanScale = (page, scans) => {
  const [vx0, vy0, vx1, vy1] = page.view;
  const pageW = vx1 - vx0;
  const pageH = vy1 - vy0;
  const needed = Math.max(
    ...scans.map((d) => {
      const fracW = (d.box[2] - d.box[0]) / 1000;
      return fracW > 0 && d.px[0] ? d.px[0] / fracW / pageW : DEFAULT_SCALE;
    })
  );
  const cap = MAX_RENDER_PX / Math.max(pageW, pageH);
  return Math.round(Math.min(Math.max(DEFAULT_SCALE, needed), Math.max(DEFAULT_SCALE, cap)) * 100) / 100;
};

// Kept for callers that only want the figure boxes.
const imageBoxes = (page, ops) => imageDraws(page, ops).map((d) => d.box).filter((b) => areaOf(b) <= 700000);

const realFontName = (page, id) => {
  try {
    return page.commonObjs.get(id)?.name || id;
  } catch {
    return id;
  }
};

// One page's text, rebuilt from its runs so each Bijoy run can be converted,
// with small raised/lowered runs written as ^{…} / _{…} so "ms–1" stays
// "ms^{–1}" rather than "ms –1".
const pageText = (page, items) => {
  let out = "";
  let base = null; // { y, h } of the last normal-size run on this line
  let script = false;

  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const font = realFontName(page, item.fontName);
    let str = bijoy.isBijoyFont(font) ? bijoy.convert(item.str) : item.str;

    const h = Math.hypot(item.transform[2], item.transform[3]);
    const y = item.transform[5];
    if (str.trim() && base && h > 0 && h < base.h * 0.8) {
      if (y > base.y + base.h * 0.2) { str = `^{${str.trim()}}`; script = true; }
      else if (y < base.y - base.h * 0.1) { str = `_{${str.trim()}}`; script = true; }
    } else if (str.trim() && h > 0) {
      base = { y, h };
    }

    out += str;
    if (item.hasEOL) {
      out += "\n";
      base = null;
    }
  }
  return { text: out, script };
};

// → [{ text, bijoy, math, images, imageBoxes, drawnBoxes, chars }] per page (text is the converted
// page text for Bijoy pages, null otherwise — pdf-parse's own text is kept
// for pages that don't need converting).
const analysePdf = async (parser) => {
  const doc = await parser.load();
  const pages = [];

  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    try {
      const content = await page.getTextContent();
      // Loads the page's fonts (so their real names can be read) and lists
      // its drawing operations (so images can be counted).
      const ops = await page.getOperatorList();

      const fonts = new Set(content.items.filter((i) => i.str && i.str.trim()).map((i) => realFontName(page, i.fontName)));
      const isBijoy = [...fonts].some(bijoy.isBijoyFont);
      const built = pageText(page, content.items);
      const text = built.text;

      const chars = text.replace(/\s/g, "").length;
      const draws = imageDraws(page, ops);
      const paths = paintedPaths(page, ops);
      const scans = chars < SCAN_TEXT_CHARS ? draws.filter((d) => areaOf(d.box) >= SCAN_IMAGE_AREA) : [];
      const figureBoxes = draws
        .filter((d) => !scans.includes(d) && areaOf(d.box) <= 700000)
        .map((d) => d.box);

      pages.push({
        text: isBijoy ? text : null,
        bijoy: isBijoy,
        math: [...fonts].some((f) => MATH_FONT.test(f.replace(/^[A-Z]{6}\+/, ""))) || MATH_CHARS.test(text) || built.script,
        images: figureBoxes.length > 0 || hasDrawnFigure(page, ops, paths),
        imageBoxes: figureBoxes,
        drawnBoxes: drawnBoxes(paths),
        // Only set for a scanned page (see scanScale).
        renderScale: scans.length ? scanScale(page, scans) : null,
        chars,
      });
    } finally {
      page.cleanup();
    }
  }

  return pages;
};

module.exports = {
  hasDrawnFigure, drawnBoxes, paintedPaths, analysePdf, pageText, imageBoxes, imageDraws, scanScale, MATH_FONT, MATH_CHARS, DEFAULT_SCALE };
