// Text with $...$ maths, turned into a picture a canvas can draw (the
// drawing pad's Text tool). MathJax's SVG output is plain paths with no web
// fonts, so drawing it doesn't lock the canvas against saving. Loaded only
// the first time some text has maths in it.

let engine = null;
const load = () => {
  engine ||= Promise.all([
    import("mathjax-full/js/mathjax.js"),
    import("mathjax-full/js/input/tex.js"),
    import("mathjax-full/js/output/svg.js"),
    import("mathjax-full/js/adaptors/liteAdaptor.js"),
    import("mathjax-full/js/handlers/html.js"),
    import("mathjax-full/js/input/tex/AllPackages.js"),
  ]).then(([{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }]) => {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document("", {
      InputJax: new TeX({ packages: AllPackages.filter((p) => p !== "bussproofs") }),
      OutputJax: new SVG({ fontCache: "none" }),
    });
    return { doc, adaptor };
  });
  return engine;
};

export const hasMath = (text) => /\$[^$]+\$/.test(text || "");

export const FONT = (px) => `600 ${px}px Inter, 'Noto Sans Bengali', system-ui, sans-serif`;

// The text in plain and maths runs: "Force $F = ma$" is
// [{ text: "Force " }, { math: "F = ma" }].
export const runsOf = (text) =>
  text.split(/(\$[^$]+\$)/).filter(Boolean).map((part) => (
    part.length > 2 && part.startsWith("$") && part.endsWith("$") ? { math: part.slice(1, -1) } : { text: part }
  ));

const loadImage = (url) => new Promise((resolve, reject) => {
  const i = new Image();
  i.onload = () => resolve(i);
  i.onerror = () => reject(new Error("That maths couldn't be drawn."));
  i.src = url;
});

// One maths run as a picture: { img, w, h, depth } (depth below the baseline).
const mathRun = async (tex, color, px) => {
  const { doc, adaptor } = await load();
  const node = doc.convert(tex, { display: false, em: px, ex: px / 2, containerWidth: 100 * px });
  const svg = new DOMParser().parseFromString(adaptor.innerHTML(node), "image/svg+xml").documentElement;
  if (svg.querySelector("[data-mjx-error]")) throw new Error("That maths couldn't be drawn.");
  // MathJax sizes in ex; one ex is half the text height here.
  const ex = (value) => (parseFloat(value) || 0) * (px / 2);
  const w = ex(svg.getAttribute("width"));
  const h = ex(svg.getAttribute("height"));
  const depth = -ex((svg.getAttribute("style") || "").match(/vertical-align:\s*([-\d.]+)ex/)?.[1]);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.removeAttribute("style");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const markup = new XMLSerializer().serializeToString(svg).replace(/currentColor/g, color);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    return { img: await loadImage(url), w, h, depth };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
};

// The whole line as one picture, { img, w, h }: words drawn in the pad's
// own font (so Bangla joins up properly), maths from MathJax, all on one
// baseline. `px` is the text size.
export async function mathImage(text, { color = "#111827", px = 32 } = {}) {
  const runs = await Promise.all(runsOf(text).map(async (r) => (r.math ? { ...r, ...(await mathRun(r.math, color, px)) } : r)));
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = FONT(px);
  let ascent = px * 0.8;
  let descent = px * 0.25;
  for (const r of runs) {
    if (r.math) {
      r.width = r.w;
      ascent = Math.max(ascent, r.h - r.depth);
      descent = Math.max(descent, r.depth);
    } else {
      const m = measure.measureText(r.text);
      r.width = m.width;
      ascent = Math.max(ascent, m.actualBoundingBoxAscent || 0);
      descent = Math.max(descent, m.actualBoundingBoxDescent || 0);
    }
  }
  const pad = 2;
  const w = Math.ceil(runs.reduce((sum, r) => sum + r.width, 0)) + pad * 2;
  const h = Math.ceil(ascent + descent) + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.font = FONT(px);
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  const baseline = pad + ascent;
  let x = pad;
  for (const r of runs) {
    if (r.math) ctx.drawImage(r.img, x, baseline - (r.h - r.depth), r.w, r.h);
    else ctx.fillText(r.text, x, baseline);
    x += r.width;
  }
  return { img: canvas, w, h };
}
