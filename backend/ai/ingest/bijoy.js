// Many Bangla PDFs (and most Bangladeshi exam/guide books) are typeset in
// Bijoy-encoded fonts — SutonnyMJ and the other "…MJ" families. They draw
// Bangla glyphs, but the text underneath is ASCII/Latin-1: the PDF's text
// layer for "পদার্থ বিজ্ঞান" is literally "c`v_© weÁvb". Every text extractor
// returns that gibberish, and a model handed it has nothing to work with.
//
// The same codes mean English in an English font ("P" is চ in SutonnyMJ, P in
// Times), so text can only be converted per run of a Bijoy font — never a
// whole page. pdfPages.js does that split; this file only converts.

const { convertBijoyToUnicode } = require("bijoy2unicode");

// "BCDFEE+SutonnyMJ", "SutonnyMJBold", "SulekhaMJ", "AdorshoLipiMJ"… — the
// subset prefix (six capitals and "+") is stripped first.
const isBijoyFont = (fontName) => {
  const name = String(fontName || "").replace(/^[A-Z]{6}\+/, "");
  return /sutonny|bijoy|MJ(?:[-_ ]?(?:bold|italic|regular|normal))*$/i.test(name) || /MJ[A-Z]/.test(name);
};

// Vowel signs that sit after their consonant in Bijoy byte order.
const POST_KARS = "vxyz~\u0192\u201E\u2026\u0160";
const REPH = "\u00A9"; // ©
const ZWNJ = "\u200C";

// bijoy2unicode is right on almost everything; two text-layer quirks trip it:
//  - pdf.js reports Bijoy's ক্র glyph (U+00B5 µ) as Greek mu (U+03BC).
//  - A reph (©) written after a vowel sign ("Zx©" → র্তী) or directly before
//    another consonant ("wbw`©ó" → নির্দিষ্ট) lands on the wrong letter. Moving
//    it in front of the vowel sign, and fencing it off from the next letter
//    with a zero-width non-joiner (removed again after), fixes both.
const convert = (text) =>
  convertBijoyToUnicode(
    String(text || "")
      .replace(/\u03BC/g, "\u00B5")
      .replace(new RegExp(`([${POST_KARS}])${REPH}`, "g"), `${REPH}$1`)
      .replace(new RegExp(`${REPH}(?=.)`, "g"), `${REPH}${ZWNJ}`)
  )
    .replace(new RegExp(ZWNJ, "g"), "")
    // The converter writes য় ড় ঢ় as single precomposed letters; typed Bangla
    // (and every model) uses the NFC form, letter + nukta. One form everywhere,
    // or search and duplicate checks miss matches.
    .normalize("NFC");

// Bijoy text that was never converted — a page from a font this file didn't
// recognise, or a model echoing the raw text layer back. Real Bangla, English
// and LaTeX never contain these runs: ‡/† (ে/ৈ) before a letter, a letter
// followed by ¨ © Ö ª, or common Bijoy words (উত্তর, এবং, হলে, নিচের, কত, …).
const BIJOY_RESIDUE = /(?:\u2021|\u2020)[A-Za-z]|[A-Za-z](?:\u00A8|\u00A9|\u00D6|\u00AA)|\b(?:D\u00CBi|Ges|n\u2021j|wb\u2021Pi|KZ|Kiv|n\u2021e|GKK|mgvb)\b/;
const hasBijoyResidue = (text) => BIJOY_RESIDUE.test(String(text || ""));

// Word files typed in SutonnyMJ have the same problem one layer down: the
// runs' text is Bijoy bytes, and mammoth reads it as is. This rewrites the
// text of every run drawn in a Bijoy font — its own w:rFonts, or the
// document's default font when it sets none — and leaves every other run
// (English, numbers, equations) untouched. → the same bytes back when the
// file has no Bijoy text.
const unescapeXml = (t) =>
  t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const escapeXml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const runFont = (rPr) => {
  const fonts = (rPr || "").match(/<w:rFonts\b[^>]*>/);
  if (!fonts) return null;
  const attr = fonts[0].match(/w:(?:ascii|hAnsi)="([^"]+)"/);
  return attr ? attr[1] : null;
};

const convertDocx = async (buffer) => {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return buffer;

  const stylesXml = zip.file("word/styles.xml") ? await zip.file("word/styles.xml").async("string") : "";
  const defaults = stylesXml.match(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/);
  const defaultFont = runFont(defaults ? defaults[0] : "");

  const xml = await docFile.async("string");
  let changed = false;
  const out = xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const rPr = (run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [""])[0];
    const font = runFont(rPr) || defaultFont;
    if (!isBijoyFont(font)) return run;
    changed = true;
    return run.replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, (m, open, text, close) => `${open}${escapeXml(convert(unescapeXml(text)))}${close}`);
  });

  if (!changed) return buffer;
  zip.file("word/document.xml", out);
  return zip.generateAsync({ type: "nodebuffer" });
};

module.exports = { convert, isBijoyFont, hasBijoyResidue, convertDocx };
