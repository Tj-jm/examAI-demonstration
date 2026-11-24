import { lookOf, SLIDE_FONTS } from "./slideLooks";
import { SEGMENT, unwrap } from "../components/Latex";

// A deck as an editable PowerPoint file (pptxgenjs, loaded on demand). The
// layout follows SlideView's 1280 x 720 drawing: 96 px to the inch, so the
// 16:9 "wide" slide is 13.33 x 7.5 in. Speaker notes go in each slide's
// notes. Maths becomes real PowerPoint equations: each formula is written
// as a marker, and after pptxgenjs builds the file each marker is swapped
// for its Office Math (utils/mathOmml.js), styled like the text around it.

const IN = (px) => px / 96;
const PT = (px) => Math.round(px * 0.75);
const c = (hex) => String(hex || "#000000").replace("#", "").slice(0, 6);
let maths = [];
const t = (s) => String(s ?? "").replace(SEGMENT, (m) => { maths.push(unwrap(m)); return `\u27E6M${maths.length - 1}\u27E7`; });
const bulletSize = (items, max = 42, min = 24) => {
  const chars = items.reduce((s, b) => s + String(b).length, 0);
  return Math.round(Math.max(min, Math.min(max, max - Math.max(0, items.length - 4) * 2.5 - Math.max(0, chars - 220) / 22)));
};

// A picture from its data URL, with its size (to fit it in a box).
const picture = async (data) => {
  if (!data) return null;
  const size = typeof Image === "undefined" ? [4, 3]
    : await new Promise((ok) => { const img = new Image(); img.onload = () => ok([img.naturalWidth, img.naturalHeight]); img.onerror = () => ok([4, 3]); img.src = data; });
  return { data: String(data).replace(/^data:/, ""), w: size[0], h: size[1] };
};

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const RUN = /<a:r>(<a:rPr\b[^>]*?\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>)<a:t>([^<]*)<\/a:t><\/a:r>/g;
const MARK = /(\u27E6M\d+\u27E7)/;
const mathRpr = (rPr) => {
  const r = rPr.replace(/\s(?:i|b)="[01]"/g, "");
  if (/<a:latin\b/.test(r)) return r.replace(/<a:latin\b[^>]*\/>/, '<a:latin typeface="Cambria Math"/>');
  if (r.endsWith("/>")) return `${r.slice(0, -2)}><a:latin typeface="Cambria Math"/></a:rPr>`;
  return r.replace("</a:rPr>", '<a:latin typeface="Cambria Math"/></a:rPr>');
};
const equation = (omml, rPr, plain) => `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><a14:m><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>${omml}</m:oMathPara></a14:m></mc:Choice><mc:Fallback><a:r>${rPr}<a:t>${xmlEsc(plain)}</a:t></a:r></mc:Fallback></mc:AlternateContent>`;

// Swap every maths marker in the slides for an equation. A formula that
// can't be converted stays as its LaTeX text.
async function addEquations(buf, list) {
  if (!list.length) return buf;
  const [{ default: JSZip }, { texToOmml }] = await Promise.all([import("jszip"), import("./mathOmml")]);
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = await zip.file(name).async("string");
    if (!xml.includes("\u27E6M")) continue;
    const parts = [];
    let last = 0;
    for (const m of xml.matchAll(RUN)) {
      const [whole, rPr, text] = m;
      if (!MARK.test(text)) continue;
      parts.push(xml.slice(last, m.index));
      const mrPr = mathRpr(rPr);
      for (const piece of text.split(MARK).filter(Boolean)) {
        const k = piece.match(/^\u27E6M(\d+)\u27E7$/);
        if (!k) { parts.push(`<a:r>${rPr}<a:t>${piece}</a:t></a:r>`); continue; }
        const { expression } = list[Number(k[1])];
        try {
          const { omml, linear } = await texToOmml(expression, mrPr);
          parts.push(equation(omml, rPr, linear.replace(/\s+/g, " ").trim()));
        } catch {
          parts.push(`<a:r>${rPr}<a:t>${xmlEsc(expression)}</a:t></a:r>`);
        }
      }
      last = m.index + whole.length;
    }
    parts.push(xml.slice(last));
    zip.file(name, parts.join(""));
  }
  return zip.generateAsync({ type: "arraybuffer" });
}
// Fit a picture inside a box, keeping its shape.
const contain = (pic, x, y, w, h) => {
  const s = Math.min(w / pic.w, h / pic.h);
  return { data: pic.data, x: IN(x + (w - pic.w * s) / 2), y: IN(y + (h - pic.h * s) / 2), w: IN(pic.w * s), h: IN(pic.h * s) };
};

// The .pptx as an ArrayBuffer. `pictures`: Media id to data URL.
export async function buildPptx(deck, pictures = {}) {
  maths = [];
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title || "Slides";
  const look = lookOf(deck.look);
  const head = SLIDE_FONTS[look.head]?.pptx || "Calibri";
  const body = SLIDE_FONTS[look.body]?.pptx || "Calibri";
  const mono = "Consolas";
  const pics = pictures;
  const [logo, bgImage] = await Promise.all([picture(pics[look.logo] || (deck.look?.siteLogo !== false ? pics.site : undefined)), picture(pics[look.bgImage])]);
  const total = deck.slides.length;
  const footer = deck.footer || {};

  for (const [i, s] of deck.slides.entries()) {
    const slide = pptx.addSlide();
    const cover = s.layout === "title" || s.layout === "section";
    const band = cover && look.titleBg;
    const text = band ? c(look.titleText) : c(look.text);
    if (band) slide.background = { color: c(look.titleBg) };
    else if (bgImage) slide.background = { data: bgImage.data };
    else slide.background = { color: c(look.decor === "chalk" ? "#23362b" : look.bg) };
    if (look.decor === "topbar") slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: IN(1280), h: IN(12), fill: { color: c(look.accent) }, line: { type: "none" } });
    if (look.decor === "block" && !cover) slide.addShape(pptx.ShapeType.rect, { x: 0, y: IN(64), w: IN(22), h: IN(64), fill: { color: c(look.accent) }, line: { type: "none" } });
    const headScale = look.headScale || 1;
    const heading = (title) => slide.addText(`${look.decor === "hash" ? "# " : ""}${t(title)}`, {
      x: IN(80), y: IN(50), w: IN(1120), h: IN(90), fontFace: head, fontSize: PT(58 * headScale), bold: look.head !== "archivo", color: c(look.text), valign: "middle", margin: 0,
    });
    const bullets = (items, x, y, w, h, size) => slide.addText(
      items.map((b) => ({ text: t(b), options: { bullet: { indent: 24 }, paraSpaceAfter: 10 } })),
      { x: IN(x), y: IN(y), w: IN(w), h: IN(h), fontFace: body, fontSize: PT(size), color: c(look.text), valign: "top", margin: 0 },
    );

    if (cover) {
      if (look.decor !== "rules") slide.addShape(pptx.ShapeType.rect, { x: IN(110), y: IN(230), w: IN(90), h: IN(8), fill: { color: band ? text : c(look.accent) }, line: { type: "none" } });
      slide.addText(t(s.title), { x: IN(110), y: IN(260), w: IN(1060), h: IN(190), fontFace: head, fontSize: PT((s.layout === "title" ? 76 : 64) * headScale), bold: look.head !== "archivo", color: text, valign: "bottom", margin: 0 });
      if (look.decor === "rules") slide.addShape(pptx.ShapeType.line, { x: IN(110), y: IN(468), w: IN(240), h: 0, line: { color: c(look.accent), width: 1.5 } });
      if (s.subtitle) slide.addText(t(s.subtitle), { x: IN(110), y: IN(480), w: IN(1060), h: IN(80), fontFace: body, fontSize: PT(34), color: band ? text : c(look.muted), valign: "top", margin: 0 });
    } else if (s.layout === "quote") {
      slide.addText("“", { x: IN(110), y: IN(110), w: IN(120), h: IN(120), fontFace: "Georgia", fontSize: 96, color: c(look.accent), margin: 0 });
      slide.addText(t(s.quote), { x: IN(120), y: IN(220), w: IN(1040), h: IN(300), fontFace: head, fontSize: PT(String(s.quote).length > 160 ? 40 : 54), italic: !["caveat", "archivo"].includes(look.head), color: c(look.text), valign: "middle", margin: 0 });
      if (s.by) slide.addText(t(s.by), { x: IN(120), y: IN(540), w: IN(1040), h: IN(50), fontFace: body, fontSize: PT(30), bold: true, color: c(look.accent), margin: 0 });
    } else if (s.layout === "twoCol") {
      heading(s.title);
      const size = bulletSize([...s.left, ...s.right], 34, 22);
      [[s.leftTitle, s.left, 80], [s.rightTitle, s.right, 668]].forEach(([h, items, x]) => {
        if (h) slide.addText(t(h), { x: IN(x), y: IN(170), w: IN(532), h: IN(50), fontFace: head, fontSize: PT(36), bold: true, color: c(look.accent), margin: 0 });
        bullets(items, x, h ? 230 : 170, 532, 420, size);
      });
    } else if (s.layout === "code") {
      heading(s.title);
      const lines = String(s.code || "").split("\n");
      const size = Math.max(16, Math.min(32, Math.floor(440 / Math.max(lines.length, 1) / 1.5), Math.floor(1700 / Math.max(...lines.map((l) => l.length), 20))));
      slide.addText(s.code || "", {
        x: IN(80), y: IN(170), w: IN(1120), h: IN(470), fontFace: mono, fontSize: PT(size), color: c(look.codeText), valign: "top",
        fill: { color: c(look.panel) }, margin: 18, rectRadius: 0.15, shape: pptx.ShapeType.roundRect,
      });
    } else if (s.layout === "quiz") {
      heading(s.title || "Quick check");
      const q = s.quiz || {};
      slide.addText(t(q.question), { x: IN(80), y: IN(160), w: IN(1120), h: IN(110), fontFace: body, fontSize: PT(38), color: c(look.text), valign: "top", margin: 0 });
      const wide = (q.options || []).some((o) => o.length > 40);
      (q.options || []).forEach((o, j) => {
        const col = wide ? 0 : j % 2;
        const row = wide ? j : Math.floor(j / 2);
        slide.addText([{ text: `${"ABCDEF"[j]}  `, options: { bold: true, color: c(look.accent) } }, { text: t(o) }], {
          shape: pptx.ShapeType.roundRect, rectRadius: 0.12, x: IN(80 + col * 568), y: IN(290 + row * (wide ? 74 : 96)), w: IN(wide ? 1120 : 552), h: IN(wide ? 62 : 80),
          fill: { color: c(look.panel) }, line: { color: c(look.muted), width: 1 }, fontFace: body, fontSize: PT(32), color: c(look.text), valign: "middle", margin: 12,
        });
      });
    } else if (s.layout === "imageText") {
      heading(s.title);
      const pic = await picture(pics[s.image]);
      bullets(s.bullets, 80, 170, pic ? 580 : 1120, 470, bulletSize(s.bullets, 36, 22));
      if (pic) slide.addImage(contain(pic, 700, 170, 500, 470));
    } else {
      heading(s.title);
      bullets(s.bullets || [], 80, 170, 1120, 470, bulletSize(s.bullets || []));
    }

    if (logo) slide.addImage(contain(logo, 1044, 28, 200, 52));
    if (footer.show !== false && !cover) {
      if (footer.text) slide.addText(footer.text, { x: IN(80), y: IN(670), w: IN(800), h: IN(30), fontFace: body, fontSize: 12, color: c(look.muted), margin: 0 });
      if (footer.numbers !== false) slide.addText(`${i + 1} / ${total}`, { x: IN(1000), y: IN(670), w: IN(200), h: IN(30), fontFace: body, fontSize: 12, color: c(look.muted), align: "right", margin: 0 });
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const list = maths;
  return addEquations(await pptx.write({ outputType: "arraybuffer" }), list);
}

// Build it and download it. Pictures come from the server as data, so
// files kept on S3 (or any other host) still make it into the .pptx.
export async function exportPptx(deck) {
  const ids = [...new Set([deck.look?.logo || (deck.look?.siteLogo !== false ? "site" : ""), deck.look?.bgImage, ...deck.slides.map((s) => s.image)].filter(Boolean))];
  let pictures = {};
  if (ids.length) {
    const r = await fetch(`/api/slides/pictures?ids=${ids.join(",")}`, { credentials: "include" });
    if (r.ok) pictures = await r.json();
  }
  const buf = await buildPptx(deck, pictures);
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(deck.title || "slides").replace(/[\\/:*?"<>|]/g, "").trim() || "slides"}.pptx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
