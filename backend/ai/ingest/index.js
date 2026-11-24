const mammoth = require("mammoth");
const JSZip = require("jszip");
const { analysePdf } = require("./pdfPages");

// Bumped whenever the PDF reader changes what it stores, so library documents
// read by an older version are read again on next use (Document.extractVersion).
// 2: Bijoy fonts converted, maths/figure pages sent to vision.
// 3: scans no longer mistaken for figures; scans rendered at full resolution.
// 4: pages with drawn (line and shape) diagrams sent to vision too.
// 5: drawn diagrams' positions kept, so their figures are cut exactly.
const EXTRACT_VERSION = 5;
// From this version on, a newer reading only adds pages to read with vision;
// pages already read (and their figures) stay valid and are kept.
const SAME_READING_FROM = 3;
// Figures cut by an older version are cut again: the readings stay, the
// crops are redone with the better positions.
const SAME_FIGURES_FROM = 5;
const { hasBijoyResidue, convertDocx: convertBijoyDocx } = require("./bijoy");

// pdf-parse is required lazily, not at module load. It bundles pdf.js, which
// runs top-level code needing DOMMatrix/ImageData/Path2D and tries to polyfill
// them from the optional native `@napi-rs/canvas` binding. When that binding
// is missing or fails to load for the platform, the require *throws* — and
// because this module is reached from the route tree, a throw here took the
// whole API server down at boot with a wall of minified pdf.js source, on a
// machine that may never upload a single PDF. Deferring it means only the PDF
// path fails, with a message a human can act on.
let PDFParse = null;
const loadPdfParse = () => {
  if (PDFParse) return PDFParse;
  try {
    ({ PDFParse } = require("pdf-parse"));
  } catch (err) {
    const error = new Error(
      "PDF extraction is unavailable on this install: the pdf-parse dependency "
      + `failed to load (${err.message}). Reinstall backend dependencies, or upload `
      + "the document as .docx/.pptx/.txt instead."
    );
    error.statusCode = 503;
    throw error;
  }
  return PDFParse;
};

// A model handed a sixty page pdf writes fifteen questions and every one of
// them comes from the first ten pages. The context window is not the problem —
// attention is. Chunking is what forces even coverage, and it is also what
// makes a local model with an 8k window usable at all.

const extractPdf = async (buffer) => {
  // pdf-parse v2 is a class holding a worker, so it has to be destroyed or the
  // process keeps a handle open and never exits.
  const Parser = loadPdfParse();
  const parser = new Parser({ data: new Uint8Array(buffer) });

  try {
    const result = await parser.getText();
    const plain = Array.isArray(result.pages) ? result.pages.map((p) => p.text || "") : [];

    // Fonts and pictures per page (see pdfPages.js). Best effort: a PDF
    // pdf.js can read text from but not analyse still extracts as before.
    let analysis = [];
    try {
      analysis = await analysePdf(parser);
    } catch {
      analysis = [];
    }

    // Bijoy-font pages use the converted text; everything else keeps
    // pdf-parse's own.
    const pageTexts = plain.map((t, i) => (analysis[i]?.bijoy && analysis[i].text ? analysis[i].text : t));

    // Pages the text layer can't be trusted for, and why. They are read from
    // the rendered page with AI vision (on by default), with the text above as
    // a hint; with vision off, the text is used as is.
    const visionReasons = {};
    pageTexts.forEach((t, i) => {
      const a = analysis[i] || {};
      const reasons = [];
      if (t.replace(/\s/g, "").length < SCANNED_PAGE_CHARS) reasons.push("scan");
      if (a.math) reasons.push("maths");
      if (a.images) reasons.push("figures");
      if (hasBijoyResidue(t)) reasons.push("encoding");
      if (reasons.length) visionReasons[`p${i + 1}`] = reasons;
    });

    const text = pageTexts.join("\n\n");
    return {
      text,
      // Per page, for page-range selection (selectPages below).
      pageTexts,
      // Pages read with AI vision on request — scans, plus pages whose maths,
      // figures or encoding the text layer doesn't carry.
      scanned: Object.keys(visionReasons),
      visionReasons,
      // Exact positions of embedded pictures per page ("p3" → boxes), handed
      // to the vision model and used to straighten the boxes it reports.
      // Drawn diagrams' positions sit beside them under "d3", each as
      // "l,t,r,b": only figure cutting snaps to those, the vision model is not
      // told about them.
      imageBoxes: Object.fromEntries(
        analysis
          .flatMap((a, i) => [[`p${i + 1}`, a?.imageBoxes || []], [`d${i + 1}`, (a?.drawnBoxes || []).map((b) => b.join(","))]])
          .filter(([, b]) => b.length)
      ),
      // Scanned pages rendered above the default resolution ("p1" → 2.77),
      // so the photo isn't shrunk before vision reads it.
      renderScales: Object.fromEntries(analysis.map((a, i) => [`p${i + 1}`, a?.renderScale]).filter(([, v]) => v)),
      bijoyPages: analysis.filter((a) => a?.bijoy).length,
      // See Document.extractVersion.
      extractVersion: analysis.length ? EXTRACT_VERSION : 1,
      pages: result.total || null,
      // A scan has a text layer of almost nothing. Saying so is more useful
      // than generating four questions from page furniture.
      looksScanned:
        Boolean(result.total) && text.replace(/\s/g, "").length < result.total * 40,
    };
  } finally {
    await parser.destroy();
  }
};

// A page with less text than this is treated as a scan (an image of the
// page with no text layer) and can be read with AI vision instead.
const SCANNED_PAGE_CHARS = 40;
// Embedded Word images smaller than this are logos, icons or bullets, not
// photographed pages — never worth a vision call.
const MIN_SCAN_IMAGE_BYTES = 25 * 1024;
const IMAGE_MARKER = /⟦img:(\d+)⟧/g;

const decodeEntities = (text) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

// Every embedded image in document order, as { base64, mimeType, bytes }.
const docxImages = async (buffer) => {
  const images = [];
  const { value: html } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.read("base64");
        images.push({ base64, mimeType: image.contentType, bytes: Math.floor((base64.length * 3) / 4) });
        return { src: `ocrimg:${images.length}` };
      }),
    }
  );
  return { html, images };
};

const extractDocx = async (original) => {
  // Bangla typed in SutonnyMJ/Bijoy fonts is converted to Unicode first
  // (see bijoy.convertDocx); any other file comes back unchanged.
  const buffer = await convertBijoyDocx(original);
  const { html, images } = await docxImages(buffer);
  const scanned = images
    .map((img, i) => (img.bytes >= MIN_SCAN_IMAGE_BYTES ? `img${i + 1}` : null))
    .filter(Boolean);

  // No photographed pages: plain text extraction, exactly as before.
  if (scanned.length === 0) {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, pages: null, looksScanned: false, scanned: [] };
  }

  // Otherwise keep a marker where each large image sat, so its transcription
  // lands in the right place in the text (assembleText below).
  const text = decodeEntities(
    html
      .replace(/<img[^>]*src="ocrimg:(\d+)"[^>]*>/g, (m, n) => `\n\n⟦img:${n}⟧\n\n`)
      .replace(/<br\s*\/?>/g, "\n")
      .replace(/<\/t[dh]>/g, " | ")
      .replace(/<\/(p|h[1-6]|li|tr|table|ul|ol)>/g, "\n\n")
      .replace(/<[^>]+>/g, "")
  );

  const withoutMarkers = text.replace(IMAGE_MARKER, "").replace(/\s/g, "");
  return { text, pages: null, looksScanned: withoutMarkers.length < 200, scanned };
};

// pptx is a zip of xml. Reading slide text directly avoids another dependency,
// and slide decks are mostly short text anyway.
const extractPptx = async (buffer) => {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const n = (s) => Number(s.match(/slide(\d+)\.xml/)[1]);
      return n(a) - n(b);
    });

  const slides = [];

  for (const name of slideFiles) {
    const xml = await zip.file(name).async("string");
    // <a:t> holds the visible run text.
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    const text = runs
      .join(" ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();

    slides.push(text);
  }

  // Empty slides keep their slot so "Slide N" and page ranges match the
  // numbering the admin sees in PowerPoint; they're just left out of the text.
  const labelled = slides.map((s, i) => (s ? `Slide ${i + 1}\n${s}` : ""));
  const nonEmpty = slides.filter(Boolean);

  return {
    // Slide boundaries are meaningful, so they are kept as paragraph breaks
    // for the chunker to split on.
    text: labelled.filter(Boolean).join("\n\n"),
    pageTexts: labelled,
    pages: slides.length,
    looksScanned: nonEmpty.length > 0 && nonEmpty.join("").length < nonEmpty.length * 20,
  };
};

const EXTRACTORS = {
  "application/pdf": extractPdf,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": extractDocx,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": extractPptx,
  "text/plain": async (buffer) => ({
    text: buffer.toString("utf8"),
    pages: null,
    looksScanned: false,
  }),
  "text/markdown": async (buffer) => ({
    text: buffer.toString("utf8"),
    pages: null,
    looksScanned: false,
  }),
};

const SUPPORTED = Object.keys(EXTRACTORS);

// Page numbers and running headers on their own line add nothing and eat
// the budget.
const cleanText = (text) =>
  String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const extract = async (buffer, mimeType) => {
  const extractor = EXTRACTORS[mimeType];

  if (!extractor) {
    const error = new Error(
      `${mimeType} cannot be read. Upload a PDF, Word document, PowerPoint or plain text file.`
    );
    error.statusCode = 415;
    throw error;
  }

  const result = await extractor(buffer);

  const clean = cleanText(result.text);
  const scanned = result.scanned || [];

  // A scan is fine now as long as there is something to read with vision.
  if (clean.replace(IMAGE_MARKER, "").length < 200 && scanned.length === 0) {
    const error = new Error(
      result.looksScanned
        ? "This looks like a scan with no text layer. Questions cannot be generated from it yet."
        : "There was not enough readable text in that file."
    );
    error.statusCode = 422;
    throw error;
  }

  return {
    ...result,
    text: clean,
    pageTexts: result.pageTexts ? result.pageTexts.map(cleanText) : null,
    scanned,
  };
};

// How many pages a PDF has, for one with no text layer to count by.
const countPdfPages = async (buffer) => {
  const Parser = loadPdfParse();
  const parser = new Parser({ data: new Uint8Array(buffer) });
  try {
    return (await parser.load()).numPages;
  } finally {
    await parser.destroy();
  }
};

// Opens a document once to render its scanned pages / large images as
// images for AI vision. `render(ref)` → { base64, mimeType } for "p12"
// (PDF page 12) or "img3" (the 3rd embedded Word image). Always close().
// scales: per-page render scale ("p1" → 2.77) for scanned pages, from
// extract()'s renderScales; every other page renders at scale 2.
const openScans = async (buffer, mimeType, { scales = {} } = {}) => {
  if (mimeType === "application/pdf") {
    const Parser = loadPdfParse();
    const parser = new Parser({ data: new Uint8Array(buffer) });
    return {
      render: async (ref) => {
        const page = Number(ref.slice(1));
        // scale 2 ≈ 150 dpi on A4 — enough for small print and Bangla
        // conjuncts without sending a huge image. A scanned page goes higher,
        // so its photo is drawn at its own resolution rather than shrunk.
        const scale = Number(scales[ref]) || 2;
        const shot = await parser.getScreenshot({ partial: [page], scale, imageBuffer: true, imageDataUrl: false });
        const data = shot.pages[0]?.data;
        if (!data) throw new Error(`Could not render page ${page}.`);
        return { base64: Buffer.from(data).toString("base64"), mimeType: "image/png" };
      },
      close: () => parser.destroy(),
    };
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { images } = await docxImages(buffer);
    return {
      render: async (ref) => {
        const image = images[Number(ref.slice(3)) - 1];
        if (!image) throw new Error(`Image ${ref} not found.`);
        return { base64: image.base64, mimeType: image.mimeType };
      },
      close: async () => {},
    };
  }

  throw new Error("This file type has no scanned pages to read.");
};

// The text a run actually uses: scanned pages/images swapped for their AI
// transcriptions (or dropped when there is none), limited to `pageNumbers`
// when a page range was given.
const assembleText = ({ text, pageTexts, scanned = [], transcripts = {}, pageNumbers = null }) => {
  const isScanned = new Set(scanned);
  if (pageTexts?.length) {
    const pages = pageNumbers || pageTexts.map((_, i) => i + 1);
    return pages
      // A page read with vision uses its transcription; without one (vision
      // off, or it failed) it falls back to its own text layer, which for a
      // real scan is (almost) nothing.
      .map((n) => (isScanned.has(`p${n}`) && transcripts[`p${n}`] ? transcripts[`p${n}`] : pageTexts[n - 1] || ""))
      .filter((t) => t.trim())
      .join("\n\n");
  }
  return cleanText(String(text || "").replace(IMAGE_MARKER, (m, n) => transcripts[`img${n}`] || ""));
};

// "12-20, 35" → [12..20, 35], sorted and de-duplicated. Throws a 400 on
// anything malformed or past the last page, so a typo never silently means
// "the whole document".
const parsePageRange = (spec, totalPages) => {
  const fail = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  };

  const pages = new Set();
  for (const part of String(spec).split(",").map((p) => p.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
    if (!match) fail(`"${part}" isn't a page or a range. Use something like 12-20, 35.`);
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (from < 1 || to < from) fail(`"${part}" isn't a valid range.`);
    if (to > totalPages) fail(`This document has ${totalPages} page${totalPages === 1 ? "" : "s"}; "${part}" goes past the end.`);
    for (let n = from; n <= to; n += 1) pages.add(n);
  }

  if (pages.size === 0) fail("Enter at least one page.");
  return [...pages].sort((a, b) => a - b);
};

// Only the chosen pages' text, in page order.
const selectPages = (pageTexts, pageNumbers) =>
  pageNumbers.map((n) => pageTexts[n - 1] || "").filter(Boolean).join("\n\n");

// Roughly four characters to a token for English prose. Deliberately crude:
// the point is to stay comfortably inside a window, not to be exact.
const estimateTokens = (text) => Math.ceil(text.length / 4);

// Splits on structure first and only falls back to cutting mid-paragraph when
// a single paragraph is itself too long. Overlap carries a sentence or two
// across the seam so a definition split across the boundary is still usable.
const chunk = (text, { targetTokens = 1200, overlapTokens = 120 } = {}) => {
  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;

  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const chunks = [];
  let current = "";

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
  };

  for (const paragraph of paragraphs) {
    // A paragraph longer than a whole chunk is split on sentence ends.
    if (paragraph.length > targetChars) {
      push();
      current = "";

      const sentences = paragraph.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [paragraph];
      let piece = "";

      for (const sentence of sentences) {
        if (piece.length + sentence.length > targetChars && piece) {
          chunks.push(piece.trim());
          piece = piece.slice(-overlapChars);
        }
        piece += sentence;
      }

      if (piece.trim()) current = piece;
      continue;
    }

    if (current.length + paragraph.length > targetChars && current) {
      push();
      // Carry the tail forward rather than starting cold.
      current = current.slice(-overlapChars) + "\n\n";
    }

    current += paragraph + "\n\n";
  }

  push();

  return chunks.map((body, index) => ({
    index,
    text: body,
    tokens: estimateTokens(body),
  }));
};

// How many questions to ask of each chunk so the total lands near what was
// requested and every chunk contributes at least one.
const planCoverage = (chunks, totalWanted) => {
  if (chunks.length === 0) return [];

  // More chunks than questions: spread the questions across a sample rather
  // than asking for a fraction of a question from each.
  if (chunks.length >= totalWanted) {
    const step = chunks.length / totalWanted;
    return Array.from({ length: totalWanted }, (_, i) => ({
      chunkIndex: Math.floor(i * step),
      count: 1,
    }));
  }

  const base = Math.floor(totalWanted / chunks.length);
  let remainder = totalWanted % chunks.length;

  return chunks.map((c, index) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return { chunkIndex: index, count: base + extra };
  });
};

// Generated sets repeat themselves across chunk boundaries, because the same
// definition appears in the overlap. Compared on normalised text rather than
// exact match so punctuation differences do not hide a duplicate.
//
// Letters and digits of every script are kept — an a-z-only key reduced every
// Bangla question to its digits, so a Bangla paper lost most of its questions
// as "duplicates". The options (and statements) are part of the key: "নিচের
// কোনটি সঠিক?" / "Which of the following is correct?" is the stem of dozens of
// different questions.
const normalise = (s) =>
  String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\p{M} ]/gu, "").replace(/\s+/g, " ").trim();

const dedupeKey = (question) =>
  [
    question.question,
    ...(question.options || []).map((o) => o.text),
    ...(question.statements || []).map((s) => s.text),
  ].map(normalise).join("|");

const dedupe = (questions) => {
  const seen = new Set();
  const kept = [];
  const dropped = [];

  for (const question of questions) {
    const key = dedupeKey(question);
    if (seen.has(key)) {
      dropped.push(question);
      continue;
    }
    seen.add(key);
    kept.push(question);
  }

  return { kept, dropped };
};

module.exports = {
  extract,
  parsePageRange,
  selectPages,
  openScans,
  assembleText,
  chunk,
  planCoverage,
  dedupe,
  estimateTokens,
  SUPPORTED,
  SAME_READING_FROM,
  countPdfPages,
  EXTRACT_VERSION,
  SAME_FIGURES_FROM,
};
