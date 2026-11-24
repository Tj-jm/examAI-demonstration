// LaTeX to Office Math (OMML), for real, editable equations in .pptx files
// (utils/slidePptx.js). MathJax parses the LaTeX into its MathML tree; this
// walks that tree and writes the matching OMML. Anything without its own
// OMML form (styles, padding, phantoms, enclosures) keeps just its content,
// so a formula always converts. `rPr` is the DrawingML run style (size,
// colour, Cambria Math) every maths run carries in PowerPoint.

let engine = null;
const load = () => {
  engine ||= Promise.all([
    import("mathjax-full/js/mathjax.js"),
    import("mathjax-full/js/input/tex.js"),
    import("mathjax-full/js/adaptors/liteAdaptor.js"),
    import("mathjax-full/js/handlers/html.js"),
    import("mathjax-full/js/input/tex/AllPackages.js"),
    import("mathjax-full/js/core/MathItem.js"),
  ]).then(([{ mathjax }, { TeX }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }, { STATE }]) => {
    RegisterHTMLHandler(liteAdaptor());
    const doc = mathjax.document("", { InputJax: new TeX({ packages: AllPackages.filter((p) => p !== "bussproofs") }) });
    return (tex, display) => doc.convert(tex, { display, end: STATE.CONVERT });
  });
  return engine;
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BIG = new Set(["∑", "∏", "∐", "∫", "∬", "∭", "∮", "⋃", "⋂", "⋁", "⋀", "⨁", "⨂", "⨀"]);
const ACCENTS = { "^": "̂", "ˆ": "̂", "̂": "̂", "~": "̃", "˜": "̃", "¯": "̅", "‾": "̅", "→": "⃗", "⃗": "⃗", "˙": "̇", "¨": "̈", "ˇ": "̌", "´": "́", "`": "̀" };

const textOf = (node) => {
  if (node.kind === "text") return node.text;
  if (node.isToken) return node.getText();
  return (node.childNodes || []).map((c) => (c ? textOf(c) : "")).join("");
};

export async function texToOmml(tex, rPr, display = false) {
  const convert = await load();
  const root = convert(tex, display);
  const run = (raw, plain) => { const text = String(raw).replace(/[\u2061-\u2064]/g, ""); return text ? `<m:r>${plain ? "<m:rPr><m:sty m:val=\"p\"/></m:rPr>" : ""}${rPr}<m:t xml:space="preserve">${esc(text)}</m:t></m:r>` : ""; };
  const kids = (n) => (n.childNodes || []).filter(Boolean);
  const all = (n) => kids(n).map(walk).join("");
  const at = (n, i) => (n.childNodes?.[i] ? walk(n.childNodes[i]) : "");

  function walk(n) {
    switch (n.kind) {
      case "mi": {
        const t = n.getText();
        const v = n.attributes.get("mathvariant");
        // One letter is italic by default; a word (sin, log) or "normal" is upright.
        return run(t, v === "normal" || (t.length > 1 && v !== "italic"));
      }
      case "mn": case "mtext": case "ms": return run(n.getText(), true);
      case "mo": return run(n.getText(), true);
      case "mspace": return "";
      case "mfrac": return `<m:f>${n.attributes.get("linethickness") === "0" ? "<m:fPr><m:type m:val=\"noBar\"/></m:fPr>" : ""}<m:num>${at(n, 0)}</m:num><m:den>${at(n, 1)}</m:den></m:f>`;
      case "msqrt": return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${all(n)}</m:e></m:rad>`;
      case "mroot": return `<m:rad><m:deg>${at(n, 1)}</m:deg><m:e>${at(n, 0)}</m:e></m:rad>`;
      case "msub": case "msup": case "msubsup": case "munder": case "mover": case "munderover": {
        const base = n.childNodes[n.base];
        const lo = n.sub !== undefined ? n.childNodes[n.sub] : n.under !== undefined ? n.childNodes[n.under] : null;
        const hi = n.sup !== undefined ? n.childNodes[n.sup] : n.over !== undefined ? n.childNodes[n.over] : null;
        const L = lo ? walk(lo) : "";
        const H = hi ? walk(hi) : "";
        const b = base ? walk(base) : "";
        const bt = base ? textOf(base) : "";
        if (base?.kind === "mo" && BIG.has(bt)) {
          return `<m:nary><m:naryPr><m:chr m:val="${esc(bt)}"/>${n.kind.startsWith("msub") || n.kind === "msup" ? "<m:limLoc m:val=\"subSup\"/>" : ""}${lo ? "" : "<m:subHide m:val=\"1\"/>"}${hi ? "" : "<m:supHide m:val=\"1\"/>"}</m:naryPr><m:sub>${L}</m:sub><m:sup>${H}</m:sup><m:e/></m:nary>`;
        }
        if (n.kind === "mover" && hi && (n.attributes.get("accent") || ACCENTS[textOf(hi)]) && ACCENTS[textOf(hi)]) {
          return `<m:acc><m:accPr><m:chr m:val="${ACCENTS[textOf(hi)]}"/></m:accPr><m:e>${b}</m:e></m:acc>`;
        }
        if (n.kind === "munder" && lo && textOf(lo) === "_") return `<m:groupChr><m:groupChrPr><m:chr m:val="⏟"/><m:pos m:val="bot"/></m:groupChrPr><m:e>${b}</m:e></m:groupChr>`;
        if (n.kind === "msub") return `<m:sSub><m:e>${b}</m:e><m:sub>${L}</m:sub></m:sSub>`;
        if (n.kind === "msup") return `<m:sSup><m:e>${b}</m:e><m:sup>${H}</m:sup></m:sSup>`;
        if (n.kind === "msubsup") return `<m:sSubSup><m:e>${b}</m:e><m:sub>${L}</m:sub><m:sup>${H}</m:sup></m:sSubSup>`;
        if (n.kind === "munder") return `<m:limLow><m:e>${b}</m:e><m:lim>${L}</m:lim></m:limLow>`;
        if (n.kind === "mover") return `<m:limUpp><m:e>${b}</m:e><m:lim>${H}</m:lim></m:limUpp>`;
        return `<m:limUpp><m:e><m:limLow><m:e>${b}</m:e><m:lim>${L}</m:lim></m:limLow></m:e><m:lim>${H}</m:lim></m:limUpp>`;
      }
      case "mtable": return `<m:m>${kids(n).map((r) => `<m:mr>${kids(r).filter((c) => c.kind === "mtd").map((c) => `<m:e>${all(c)}</m:e>`).join("")}</m:mr>`).join("")}</m:m>`;
      case "mphantom": case "annotation": case "annotation-xml": return "";
      case "semantics": return kids(n)[0] ? walk(kids(n)[0]) : "";
      case "merror": return run(textOf(n), true);
      case "text": return run(n.text, true);
      // math, mrow, inferred rows, TeXAtom, mstyle, mpadded, menclose, maction...
      default: return all(n);
    }
  }
  const body = walk(root);
  return { omml: `<m:oMath>${body}</m:oMath>`, linear: linear(root) };
}

// The same formula as plain Unicode text, for apps that can't show Office
// Math (Google Slides, Keynote, LibreOffice): x = (−b ± √(b²−4ac))/(2a).
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", i: "ᵢ", j: "ⱼ", n: "ₙ", m: "ₘ", k: "ₖ", t: "ₜ" };
const script = (t, map, mark) => ([...t].every((ch) => map[ch]) ? [...t].map((ch) => map[ch]).join("") : `${mark}${t.length > 1 ? `(${t})` : t}`);
const group = (t) => (t.length > 1 && !/^[\w.]+$/.test(t) ? `(${t})` : t);
function linear(n) {
  if (!n) return "";
  const k = (n.childNodes || []).filter(Boolean);
  const kid = (i) => linear(n.childNodes?.[i]);
  switch (n.kind) {
    case "text": return n.text;
    case "mi": case "mn": case "mtext": case "ms": return n.getText().replace(/[\u2061-\u2064]/g, "");
    case "mo": { const t = n.getText().replace(/[\u2061-\u2064]/g, ""); return /^[=+<>≤≥±×÷→≈≠∓−]$/.test(t) ? ` ${t} ` : t; }
    case "mspace": return " ";
    case "mfrac": return `${group(kid(0).trim())}/${group(kid(1).trim())}`;
    case "msqrt": return `√${group(k.map(linear).join("").trim())}`;
    case "mroot": return `${script(kid(1), SUP, "^")}√${group(kid(0).trim())}`;
    case "msub": case "msup": case "msubsup": case "munder": case "mover": case "munderover": {
      const lo = n.sub !== undefined ? n.childNodes[n.sub] : n.under !== undefined ? n.childNodes[n.under] : null;
      const hi = n.sup !== undefined ? n.childNodes[n.sup] : n.over !== undefined ? n.childNodes[n.over] : null;
      const base = linear(n.childNodes[n.base]);
      const hiText = hi ? linear(hi).trim() : "";
      if (n.kind === "mover" && ACCENTS[hiText]) return `${base}${ACCENTS[hiText]}`;
      return `${base}${lo ? script(linear(lo).replace(/\s+/g, ""), SUB, "_") : ""}${hi ? script(hiText.replace(/\s+/g, ""), SUP, "^") : ""}`;
    }
    case "mtable": return `[${k.map((r) => (r.childNodes || []).filter(Boolean).map(linear).join(", ")).join("; ")}]`;
    case "mphantom": case "annotation": case "annotation-xml": return "";
    default: return k.map(linear).join("");
  }
}


