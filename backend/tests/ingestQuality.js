// Document extraction for real Bangla/maths PDFs: Bijoy fonts converted per
// run, pages sorted into "text is fine" and "read the page image", page-based
// steps that never cut a question off, figure boxes, and the checks between
// the model and the database. No AI calls, no database.

process.env.NODE_ENV = "test";

const bijoy = require("../ai/ingest/bijoy");
const figures = require("../ai/ingest/figures");
const { splitAtQuestions, planPageSteps, QUESTION_START } = require("../ai/ingest/pageSteps");
const finalize = require("../ai/ingest/finalize");
const { dedupe } = require("../ai/ingest");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

console.log("\nBijoy → Unicode (text layers of real SutonnyMJ PDFs)");
{
  const cases = [
    ["c`v_© weÁvb 2q cÎ", "পদার্থ বিজ্ঞান ২য় পত্র"],
    ["DËi :", "উত্তর :"],
    ["Zvc m¤ú~Y©iƒ‡c Kv‡R cwiYZ n‡j KZ Ryj KvR m¤úbœ n‡e?", "তাপ সম্পূর্ণরূপে কাজে পরিণত হলে কত জুল কাজ সম্পন্ন হবে?"],
    // Reph after a vowel sign, and reph before the next consonant.
    ["ga¨eZx© †KvY", "মধ্যবর্তী কোণ"],
    ["†Kvb †f±‡ii Awbw`©ó?", "কোন ভেক্টরের অনির্দিষ্ট?"],
    // pdf.js reports Bijoy's µ (ক্র) as Greek μ.
    ["cÖwμqvq", "প্রক্রিয়ায়"],
    ["01.", "০১."],
  ];
  check("output is NFC (য় as য + nukta)", bijoy.convert("2q") === "২য়".normalize("NFC") && !bijoy.convert("2q").includes(String.fromCharCode(0x9df)));
  for (const [input, expected] of cases) {
    const out = bijoy.convert(input);
    check(`${input} → ${expected}`, out === expected, out);
  }
}

console.log("\nwhich fonts are Bijoy");
{
  check("subset SutonnyMJ", bijoy.isBijoyFont("BCDFEE+SutonnyMJ"));
  check("SutonnyMJBold", bijoy.isBijoyFont("BPUQHL+SutonnyMJBold"));
  check("other …MJ families", bijoy.isBijoyFont("AdorshoLipiMJ") && bijoy.isBijoyFont("SulekhaMJ"));
  check("Times is not", !bijoy.isBijoyFont("TimesNewRomanPSMT"));
  check("Cambria Math is not", !bijoy.isBijoyFont("BCDGEE+CambriaMath"));
  check("a Unicode Bangla font is not", !bijoy.isBijoyFont("Kalpurush") && !bijoy.isBijoyFont("SolaimanLipi"));
}

console.log("\nunconverted Bijoy is recognised");
{
  check("raw Bijoy", bijoy.hasBijoyResidue("P gv‡bi `yBwU e‡ji jwä R"));
  check("DËi", bijoy.hasBijoyResidue("DËi : 25.2 J"));
  check("Unicode Bangla is not", !bijoy.hasBijoyResidue("পদার্থ বিজ্ঞান ২য় পত্র — উত্তর : 25.2 J"));
  check("English + LaTeX is not", !bijoy.hasBijoyResidue("Find $\\vec{A} \\times \\vec{B}$ when m = 22 and (A) 2.2 (B) 22."));
}

console.log("\nquestion boundaries");
{
  const starts = [..."01. a\n১৫. b\nQ7. c\n7) d\n12.5 x\n(ক) y\n(A) z\nExample 12: w\n3.14 v".matchAll(QUESTION_START)].map((m) => m[0].trim());
  check("numbered starts found", JSON.stringify(starts) === JSON.stringify(["01.", "১৫.", "Q7.", "7)", "Example 12:"]), starts);

  const page = Array.from({ length: 20 }, (_, i) => `${String(i + 1).padStart(2, "0")}. ${"প্রশ্ন ".repeat(30)}উত্তর : ${i} J`).join("\n");
  const parts = splitAtQuestions(page, 1500);
  check("a dense page splits into parts", parts.length > 1, parts.length);
  check("every part starts at a question", parts.every((p) => /^\d{2}\. /.test(p)), parts.map((p) => p.slice(0, 4)));
  check("nothing is lost", parts.join("\n").replace(/\s/g, "") === page.replace(/\s/g, ""));
  check("a short page is one part", splitAtQuestions("01. one\n02. two", 1500).length === 1);
}

console.log("\npage steps");
{
  const steps = planPageSteps([
    { number: 3, text: "01. last question on page three\n(A) 1 (B) 2" },
    { number: 4, text: "02. continues here\nSolution (B)" },
    { number: 5, text: "" },
  ]);
  check("one step per non-empty page", steps.length === 2, steps.map((s) => s.label));
  check("the step marks what to transcribe", steps[1].text.includes(">>> TRANSCRIBE FROM HERE (page 4)") && steps[1].text.includes("<<< TRANSCRIBE TO HERE"));
  check("the page before is context", steps[1].text.indexOf("last question on page three") < steps[1].text.indexOf(">>> TRANSCRIBE"));
  check("the page after is context", steps[0].text.indexOf("continues here") > steps[0].text.indexOf("<<< TRANSCRIBE TO HERE"));
}

console.log("\nfigures");
{
  const text = figures.renameFigures("02.\n[FIGURE f1 | box: 95,200,240,280 | circle ABC]\nO কেন্দ্র …\n(B) [FIGURE f2 | box: 500,400,600,470 | graph]", 7);
  check("ids made page-unique", text.includes("[FIGURE p7f1 |") && text.includes("[FIGURE p7f2 |"), text);
  const index = figures.indexFigures(text);
  check("figures indexed with page and box", index.get("p7f1")?.page === 7 && index.get("p7f1").box.join() === "95,200,240,280");
  check("markers stripped from student text", figures.stripFigureMarkers("O কেন্দ্র [FIGURE p7f1 | box: 1,2,3,4 | x] বৃত্ত") === "O কেন্দ্র বৃত্ত");

  const embedded = [[106, 207, 229, 276], [106, 625, 265, 711]];
  check("a rough box snaps to the embedded picture", figures.snapBox([95, 190, 250, 300], embedded) === embedded[0]);
  check("a box elsewhere is kept", figures.snapBox([500, 500, 600, 600], embedded).join() === "500,500,600,600");
  check("a sliver is rejected", Boolean(figures.checkBox([10, 10, 15, 15])));
  check("most of the page is rejected", Boolean(figures.checkBox([0, 0, 1000, 1000])));
  check("an inverted box is rejected", Boolean(figures.checkBox([300, 300, 200, 200])));
  check("a real figure passes", figures.checkBox([106, 207, 229, 276]) === null);

  const drawn = [[300, 400, 500, 560], [50, 50, 950, 950]];
  check("an embedded picture wins", figures.placeFigure([95, 190, 250, 300], embedded, drawn).source === "image");
  const onDrawn = figures.placeFigure([320, 390, 480, 600], embedded, drawn);
  check("a rough box snaps to the drawn diagram", onDrawn.source === "drawn" && onDrawn.box === drawn[0], onDrawn);
  check("a frame around the figure isn't the figure", figures.placeFigure([700, 700, 800, 780], embedded, drawn).source === "model");
  check("pixel boxes become thousandths", figures.fixPixelBoxes("[FIGURE f1 | box: 124,170,620,1190 | c]", [1240, 1700]) === "[FIGURE f1 | box: 100,100,500,700 | c]");
  check("thousandths are left alone", figures.fixPixelBoxes("[FIGURE f1 | box: 124,170,620,900 | c]", [1240, 1700]) === "[FIGURE f1 | box: 124,170,620,900 | c]");
}

console.log("\nprinted answer keys");
{
  const qs = [
    { type: "mcq", number: "Q০৭", options: [{ key: "ক", text: "a" }, { key: "খ", text: "b" }], correctOption: "ক", answerSource: "solved" },
    { type: "mcq", number: "8", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A", answerSource: "solved" },
    { type: "mcq", number: "9", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A", answerSource: "printed" },
    { type: "mcq", number: "10", options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A", answerSource: "solved" },
  ];
  const applied = finalize.applyAnswerKey(qs, [
    { number: "7", answer: "খ" },
    { number: "08", answer: "(b)" },
    { number: "9", answer: "B" },
    { number: "10", answer: "B" },
    { number: "10", answer: "A" },
  ]);
  check("Bangla option letter from the key", qs[0].correctOption === "খ" && qs[0].answerSource === "printed");
  check("'(b)' means option B", qs[1].correctOption === "B");
  check("a printed answer is never overridden", qs[2].correctOption === "A");
  check("a number that appears twice in the key is skipped", qs[3].correctOption === "A");
  check("count of answers taken", applied === 2, applied);
  check("numbers compare across scripts", finalize.normalizeNumber("Q০৭") === finalize.normalizeNumber("7."));
}

console.log("\nsolutions printed apart from their questions");
{
  const mcq = (number, order, extra = {}) => ({
    type: "mcq", number, _order: order, question: `Q${number}: a body falls ${number}${number} m`,
    options: [{ key: "A", text: "a" }, { key: "B", text: "b" }], correctOption: "A", answerSource: "solved", solutionText: "AI", ...extra,
  });
  const sol = (number, order, page, extra = {}) => ({ number, _order: order, _page: page, answer: "B", solutionText: `printed ${number} @${page}`, ...extra });

  // Chapter 1 questions, chapter 1 solutions, chapter 2 questions, chapter 2 solutions.
  {
    const qs = [mcq("1", 0), mcq("2", 0), mcq("1", 2), mcq("2", 2)];
    const r = finalize.applySolutions(qs, [sol("1", 1, 5), sol("2", 1, 5), sol("1", 3, 9, { answer: "A" }), sol("2", 3, 9)]);
    check("chapter by chapter: each chapter gets its own solutions", qs[0].solutionText === "printed 1 @5" && qs[0].correctOption === "B" && qs[2].correctOption === "A" && qs[2].solutionText === "printed 1 @9" && r.matched === 4, { qs, r });
    check("the printed answer is marked printed, with a note to check", qs[0].answerSource === "printed" && /page 5/.test(qs[0]._notes[0]));
  }
  // All questions first, then all solutions in the same order.
  {
    const qs = [mcq("1", 0), mcq("2", 0), mcq("1", 1), mcq("2", 1)];
    const r = finalize.applySolutions(qs, [sol("1", 4, 20), sol("2", 4, 20), sol("1", 5, 21), sol("2", 5, 21)]);
    check("all questions, then all solutions: paired in order", qs[0].solutionText === "printed 1 @20" && qs[2].solutionText === "printed 1 @21" && qs[2]._notes[0].includes("page 21") && r.matched === 4, { qs, r });
  }
  // Solutions only for chapter 2, told apart by the values they share.
  {
    const qs = [mcq("1", 0, { question: "A car moves at 12 m/s" }), mcq("1", 1, { question: "A ball of 3.5 kg" })];
    const r = finalize.applySolutions(qs, [sol("1", 4, 20, { solutionText: "m = 3.5 kg, so F = 3.5 × 9.8" })]);
    check("a solution goes to the question it shares values with", qs[1].solutionText.includes("3.5") && qs[0].solutionText === "AI" && r.matched === 1, { qs, r });
  }
  // Nothing to tell them apart: left alone, with a note.
  {
    const qs = [mcq("1", 0), mcq("1", 1)];
    const r = finalize.applySolutions(qs, [sol("1", 4, 20, { solutionText: "no values" })]);
    check("an unclear solution is not used", qs[0].solutionText === "AI" && qs[1].solutionText === "AI" && r.unclear === 2 && /wasn't clear/.test(qs[0]._notes[0]), { qs, r });
  }
  // A solution printed with its question always wins; a solution is never
  // paired with a question read after it.
  {
    const qs = [mcq("1", 0, { answerSource: "printed", solutionText: "inline" }), mcq("2", 0), mcq("3", 6)];
    const r = finalize.applySolutions(qs, [sol("1", 2, 3), sol("2", 2, 3), sol("3", 2, 3)]);
    check("an inline printed solution is never replaced", qs[0].solutionText === "inline" && qs[0].correctOption === "A");
    check("a solution before its question isn't used", qs[2].solutionText === "AI" && qs[1].solutionText === "printed 2 @3" && r.matched === 1, { qs, r });
  }
  // A solution running on to the next page.
  {
    const qs = [mcq("14", 0), mcq("15", 0)];
    const r = finalize.applySolutions(qs, [sol("15", 1, 6, { answer: undefined, solutionText: "…continued: 1515 m" })]);
    check("a solution carried to the next page is joined to its question", qs[1].solutionText.includes("continued") && qs[1].answerSource === "solved" && r.matched === 1, { qs, r });
  }
  // Written questions take the printed answer; the same solution read twice counts once.
  {
    const qs = [{ type: "written", number: "3", _order: 0, question: "Find 25.2", modelAnswer: "AI", answerSource: "solved" }];
    const r = finalize.applySolutions(qs, [sol("3", 1, 2, { answer: "25.2 J" }), sol("3", 1, 2, { answer: "25.2 J" })]);
    check("written: printed answer taken, duplicate ignored", qs[0].modelAnswer === "25.2 J" && qs[0].answerSource === "printed" && r.matched === 1, { qs, r });
  }
  check("no solutions, nothing changes", finalize.applySolutions([mcq("1", 0)], []).matched === 0);
}

console.log("\nunreadable questions and duplicates");
{
  check("a Bijoy question is caught", finalize.isGarbled({ question: "c`v_© weÁvb n‡j KZ?", options: [] }));
  check("a Bangla question passes", !finalize.isGarbled({ question: "পদার্থ বিজ্ঞান হলে কত?", options: [{ key: "A", text: "10 J" }] }));
  const { kept, dropped } = dedupe([
    { question: "নিচের কোনটি সঠিক?", options: [{ text: "ক" }] },
    { question: "নিচের কোনটি সঠিক?", options: [{ text: "খ" }] },
    { question: "নিচের কোনটি সঠিক?", options: [{ text: "ক" }] },
    { question: "১০ কেজি ভরের বস্তু" },
    { question: "২০ কেজি ভরের বস্তু" },
  ]);
  check("Bangla questions aren't collapsed into one", kept.length === 4 && dropped.length === 1, { kept: kept.length, dropped: dropped.length });
}

(async () => {
  console.log("\ncropping a figure");
  try {
    const { createCanvas } = require("@napi-rs/canvas");
    const canvas = createCanvas(1000, 1400);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1000, 1400);
    ctx.fillStyle = "#000";
    ctx.fillRect(100, 280, 150, 100);
    const png = await figures.cropFigure(canvas.toBuffer("image/png"), [100, 200, 250, 271], 0);
    const { loadImage } = require("@napi-rs/canvas");
    const crop = await loadImage(png);
    check("crop is the box's size", crop.width === 150 && Math.abs(crop.height - 99) <= 1, [crop.width, crop.height]);

    // A drawing at 100..250 × 280..380 px with a label just right of it
    // (258..266), and a paragraph line well below (440..450).
    ctx.fillRect(258, 320, 8, 12);
    ctx.fillRect(100, 440, 600, 10);
    const page = canvas.toBuffer("image/png");
    const fitted = await figures.fitToInk(page, [120, 210, 230, 260]);
    check("a tight box grows to the drawing and its label", fitted && fitted[0] === 100 && fitted[2] === 266 && Math.abs(fitted[1] - 200) <= 1 && Math.abs(fitted[3] - 271) <= 1, fitted);
    const loose = await figures.fitToInk(page, [60, 150, 400, 300]);
    check("a box is never shrunk", loose && loose[0] === 60 && loose[2] === 400, loose);
    check("a box on blank paper is refused", (await figures.fitToInk(page, [600, 600, 800, 700])) === null);
  } catch (error) {
    check("crop runs", false, error.message);
  }

  console.log("\nscanned pages");
  try {
    const { extract } = require("../ai/ingest");
    // A one-page PDF that is nothing but a picture — a scan or a photo of a
    // page. Uncompressed grey image, 1600 px wide, drawn on 80% of an A4 page.
    const scanPdf = (imgW, imgH, drawW, drawH) => {
      const pixels = Buffer.alloc(imgW * imgH, 200);
      const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
        null, // image, written with its binary stream below
        null, // content stream
      ];
      const content = `q ${drawW} 0 0 ${drawH} 60 100 cm /Im1 Do Q`;
      const parts = [Buffer.from("%PDF-1.4\n")];
      const offsets = [];
      let length = parts[0].length;
      const push = (buf) => { parts.push(buf); length += buf.length; };
      objects.forEach((body, i) => {
        offsets.push(length);
        if (i === 3) {
          push(Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`));
          push(pixels);
          push(Buffer.from("\nendstream\nendobj\n"));
        } else if (i === 4) {
          push(Buffer.from(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`));
        } else {
          push(Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`));
        }
      });
      const xref = length;
      push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
      return Buffer.concat(parts);
    };

    const result = await extract(scanPdf(1600, 2000, 476, 600), "application/pdf");
    check("a picture-only page is read with vision as a scan", JSON.stringify(result.visionReasons) === JSON.stringify({ p1: ["scan"] }), result.visionReasons);
    check("the scan itself is not treated as a figure", !result.imageBoxes.p1, result.imageBoxes);
    const scale = result.renderScales.p1;
    check("it is rendered above the default resolution, capped at 2400 px", scale > 2 && Math.round(842 * scale) <= 2400, scale);
  } catch (error) {
    check("scanned page handling runs", false, error.message);
  }

  console.log("\nreading a dense page in halves");
  try {
    const { createCanvas } = require("@napi-rs/canvas");
    const page = (columns) => {
      const canvas = createCanvas(800, 1100);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 800, 1100);
      ctx.fillStyle = "#000";
      for (let y = 100; y < 1000; y += 30) {
        if (columns === 2) {
          ctx.fillRect(60, y, 300, 12);
          ctx.fillRect(440, y, 300, 12);
        } else {
          ctx.fillRect(60, y, 680, 12);
        }
      }
      return canvas.toBuffer("image/png");
    };
    const gutter = await figures.findGutter(page(2));
    check("a two-column page's gutter is found near the middle", gutter > 450 && gutter < 550, gutter);
    check("a one-column page has none", (await figures.findGutter(page(1))) === null);
    const cols = await figures.halves(page(2));
    check("two columns are read as left and right, overlapping", cols[0].label === "left column" && cols[1].label === "right column" && cols[1].region[0] < cols[0].region[2], cols);
    const rows = await figures.halves(page(1));
    check("otherwise top and bottom, overlapping", rows[0].label === "top half" && rows[1].region[1] < rows[0].region[3], rows);

    const mapped = figures.mapFigures("a [FIGURE f1 | box: 0,500,1000,1000 | graph] b [FIGURE f2 | box: 100,100,200,200]", [500, 0, 1000, 1000], 3);
    check("a half's figure boxes move back onto the whole page", mapped.text.includes("[FIGURE f3 | box: 500,500,1000,1000 | graph]") && mapped.text.includes("[FIGURE f4 | box: 550,100,600,200]"), mapped.text);
    check("and are numbered on from the other half", mapped.next === 5);
  } catch (error) {
    check("halves run", false, error.message);
  }

  console.log("\nWord files typed in Bijoy fonts");
  try {
    const JSZip = require("jszip");
    const { extract } = require("../ai/ingest");
    const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const run = (font, text) =>
      `<w:r>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
    const docx = async (paragraph, defaultFont) => {
      const zip = new JSZip();
      zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      if (defaultFont) zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${defaultFont}" w:hAnsi="${defaultFont}"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
      const filler = `<w:p>${run("Times New Roman", "Some English filler so there is enough text to read. ".repeat(5))}</w:p>`;
      zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body><w:p>${paragraph}</w:p>${filler}</w:body></w:document>`);
      return zip.generateAsync({ type: "nodebuffer" });
    };
    const first = async (buffer) => (await extract(buffer, DOCX)).text.split("\n")[0];

    const own = await first(await docx(run("SutonnyMJ", "01. ga¨eZx© †KvY KZ? ") + run("Times New Roman", "(A) 30 J &amp; P")));
    check("a SutonnyMJ run is converted, the English run kept", own === "০১. মধ্যবর্তী কোণ কত? (A) 30 J & P", own);
    const inherited = await first(await docx(run(null, "Awbw`©ó †f±i ") + run("Times New Roman", "(B) P"), "SutonnyMJ"));
    check("a run using the document's default Bijoy font is converted", inherited === "অনির্দিষ্ট ভেক্টর (B) P", inherited);
    const english = await first(await docx(run("Times New Roman", "Plain English P &lt; Q")));
    check("an English-only file is untouched", english === "Plain English P < Q", english);
  } catch (error) {
    check("docx conversion runs", false, error.message);
  }

  console.log("\nfigure markers without 'box:', translation, solutions");
  {
    const t = figures.renameFigures("(A) [FIGURE f2 | 134,477,397,620 | v vs t]\n[FIGURE f9]", 1);
    check("a marker without 'box:' is renamed and indexed", [...figures.indexFigures(t).keys()].join() === "p1f2", t);
    check("renaming again changes nothing", figures.renameFigures(t, 1) === t);
    check("a malformed marker is stripped too", figures.stripFigureMarkers(t) === "(A)", figures.stripFigureMarkers(t));

    const q = { type: "mcq", number: "2", question: "Q2. A ২ কিগ্রাম block, ১০ cm", options: [{ key: "A", text: "৫.৭৭ cm" }], solutionText: "[No solution text provided for Q2]" };
    const words = finalize.undoTranslation(q, "Q2. A 2 kg block, 10 cm [FIGURE p1f1 | box: 1,2,3,4 | x]");
    check("an English page's question gets its digits back", q.question === "Q2. A 2 কিগ্রাম block, 10 cm" && q.options[0].text === "5.77 cm", q);
    check("…and Bangla words left in it are reported", words === true);
    const bn = { question: "বলটির ভর ১০ kg" };
    check("a Bangla page's question is left alone", finalize.undoTranslation(bn, "বলটির ভর ১০ kg") === false && bn.question === "বলটির ভর ১০ kg");
    check("a placeholder solution is cleared", finalize.cleanSolution(q) === null && q.solutionText === "");
    check("a solution full of the model's working is flagged", Boolean(finalize.cleanSolution({ solutionText: "If R1 = 4 … still not matching. Recheck." })));
    check("a real solution passes", finalize.cleanSolution({ solutionText: "$F = ma$, so $a = 12/2 = 6$ m/s²." }) === null);
    finalize.stripNumber(q);
    check("the printed number is taken off the question text", q.question === "A 2 কিগ্রাম block, 10 cm", q.question);
    const decimal = { question: "2.5 kg of water", number: "2" };
    finalize.stripNumber(decimal);
    check("a number that is part of the question stays", decimal.question === "2.5 kg of water");
  }

  console.log(`\n${"-".repeat(50)}\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("FAIL"); process.exit(1); }
  console.log("PASS");
})();
