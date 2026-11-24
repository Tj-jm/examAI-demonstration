// Reading pages back to the admin (ingestController.transcribeDocument) and
// finding drawn diagrams (ingest/pdfPages.hasDrawnFigure). The vision model
// is stubbed: it answers with a transcript that marks one figure.

process.env.NODE_ENV = "test";
process.env.STORAGE_LOCAL_PATH = require("path").join(require("os").tmpdir(), `readpages-${Date.now()}`);

const mongoose = require("mongoose");

let passed = 0;
let failed = 0;
const check = (label, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok    ${label}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`); }
};

// A PDF whose pages are drawn from the given content streams (Helvetica text).
const buildPdf = (streams) => {
  const objects = [];
  const pageIds = streams.map((_, i) => 4 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${streams.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  streams.forEach((stream, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
};
const words = (y) => Array.from({ length: 8 }, (_, i) => `BT /F1 11 Tf 72 ${y - i * 16} Td (Line ${i + 1} of the text about forces, motion and energy.) Tj ET`).join("\n");
const TEXT_PAGE = words(720);
// A table: straight horizontal and vertical lines only.
const TABLE_PAGE = `${words(720)}\n0.5 w 72 400 m 400 400 l S 72 380 m 400 380 l S 72 360 m 400 360 l S 72 360 m 72 400 l S 236 360 m 236 400 l S 400 360 m 400 400 l S`;
// A diagram: a circle (curves), a slanted line and a triangle.
const DIAGRAM_PAGE = `${words(720)}\n1 w 300 400 m 300 455 255 500 200 500 c 145 500 100 455 100 400 c 100 345 145 300 200 300 c 255 300 300 345 300 400 c S 200 400 m 280 460 l S 350 300 m 450 300 l 400 390 l h S`;

const run = async () => {
  await mongoose.connect(process.env.TEST_MONGO_URL || "mongodb://127.0.0.1:27017/examai_test_readpages");
  await mongoose.connection.db.dropDatabase();

  const pdf = buildPdf([TEXT_PAGE, TABLE_PAGE, DIAGRAM_PAGE]);

  console.log("\ndrawn diagrams");
  {
    const { extract } = require("../ai/ingest");
    const r = await extract(pdf, "application/pdf");
    check("a page with a drawn diagram goes to vision for its figures", (r.visionReasons.p3 || []).includes("figures"), r.visionReasons);
    check("a text page and a table page don't", !r.visionReasons.p1 && !r.visionReasons.p2, r.visionReasons);
    check("the reading version moved on", r.extractVersion === 5, r.extractVersion);
    // Circle + slanted line, and the triangle 80 thousandths to its right.
    const drawn = (r.imageBoxes.d3 || []).map((b) => b.split(",").map(Number));
    check("the drawn diagram's position is kept", drawn.length === 2 && drawn.some((b) => b[0] === 163 && b[2] === 490 && b[1] === 369 && b[3] === 621), drawn);
    check("a table has no drawn box", !r.imageBoxes.d2, r.imageBoxes);
  }

  // Stubs: AI switched on, and a vision model that marks one figure.
  const AiConfig = require("../models/aiConfigModel");
  AiConfig.get = async () => ({ features: { questionGeneration: true } });
  const ai = require("../ai/service");
  const calls = [];
  ai.complete = async ({ prompt }) => {
    calls.push(prompt);
    return { text: "1. A circle of radius $r = 2\\,m$.\n[FIGURE f1 | box: 150,300,550,650 | Fig. 1 circle with radius]\nFind its area.", finishReason: "stop", completionTokens: 50 };
  };
  const ctl = require("../controllers/admin/ingestController");
  const call = (handler, req) => new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ code: this.statusCode, body: b }); } };
    handler({ user: { _id: new mongoose.Types.ObjectId(), role: "owner" }, body: {}, params: {}, ...req }, res, (err) => resolve({ code: res.statusCode >= 400 ? res.statusCode : 500, body: { message: err?.message } }));
  });
  const finish = async (jobId) => {
    for (let i = 0; i < 200; i += 1) {
      const s = await call(ctl.getJobStatus, { params: { jobId } });
      if (s.body.status !== "running") return s.body;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };

  console.log("\nreading a pdf back");
  {
    const started = await call(ctl.transcribeDocument, { file: { buffer: pdf, mimetype: "application/pdf", originalname: "book.pdf", size: pdf.length }, body: { pages: "3" } });
    check("starts a run for the chosen page", started.code === 202 && started.body.pages === 1 && started.body.toRead === 1, started.body);
    const job = await finish(started.body.jobId);
    const page = job?.result?.pages?.[0];
    check("gives the page's text back, maths kept", job?.status === "done" && page?.page === 3 && page.text.includes("$r = 2\\,m$"), job);
    check("the figure is cut out and put in the text as a picture",
      page?.figures.length === 1 && Boolean(page.figures[0].url) && page.text.includes(`![Fig. 1 circle with radius](${page.figures[0].url})`), page);
    check("the vision model saw the page's own text as a hint", /Line 1 of the text/.test(calls[0] || ""));

    calls.length = 0;
    const again = await call(ctl.transcribeDocument, { file: { buffer: pdf, mimetype: "application/pdf", originalname: "book.pdf", size: pdf.length }, body: { pages: "3" } });
    const job2 = await finish(again.body.jobId);
    check("a page read before is reused, not paid for again", again.body.toRead === 0 && calls.length === 0 && job2?.result?.pages?.[0]?.figures?.[0]?.url === page?.figures?.[0]?.url, { again: again.body, calls: calls.length });

    const tooMany = await call(ctl.transcribeDocument, { file: { buffer: Buffer.from("hello"), mimetype: "text/plain", originalname: "a.txt", size: 5 } });
    check("only PDFs and pictures", tooMany.code === 400, tooMany);
  }

  console.log("\nreading a picture back");
  {
    const { createCanvas } = require("@napi-rs/canvas");
    const canvas = createCanvas(800, 600);
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, 800, 600);
    g.strokeStyle = "#000"; g.beginPath(); g.arc(300, 300, 120, 0, Math.PI * 2); g.stroke();
    const jpg = canvas.toBuffer("image/jpeg");
    const started = await call(ctl.transcribeDocument, { file: { buffer: jpg, mimetype: "image/jpeg", originalname: "photo.jpg", size: jpg.length } });
    const job = await finish(started.body.jobId);
    const page = job?.result?.pages?.[0];
    check("a photo is read as one page, its figure cut out", job?.status === "done" && page?.figures?.[0]?.url && job.result.picture === true, job);
  }

  console.log("\nextracting questions still attaches figures");
  {
    const Subject = require("../models/subjectModel");
    const Chapter = require("../models/chapterModel");
    const { Question } = require("../models/questionModel");
    const subject = await Subject.create({ title: "Physics RP", name: "Physics RP" });
    const chapter = await Chapter.create({ title: "Circles RP", name: "Circles RP", subject: subject._id });
    ai.generate = async () => ({
      data: {
        questions: [{ type: "written", number: "1", question: "A circle of radius $r = 2\\,m$. Find its area.", figure: "f1", marks: 2, modelAnswer: "AI's answer", answerSource: "solved" }],
        answerKey: [],
        solutions: [{ number: "1", answer: "$4\\pi\\,m^2$", solutionText: "Area $= \\pi r^2 = 4\\pi\\,m^2$" }],
      },
      usage: { model: "stub" },
    });
    // A fresh copy of the PDF (other bytes), so its page isn't already read.
    const fresh = buildPdf([TEXT_PAGE, TABLE_PAGE, `${DIAGRAM_PAGE}\n% fresh`]);
    const started = await call(ctl.generateFromDocument, { file: { buffer: fresh, mimetype: "application/pdf", originalname: "fresh.pdf", size: fresh.length }, body: { chapterId: String(chapter._id), mode: "extract", types: "written", pages: "3" } });
    const job = await finish(started.body.jobId);
    const q = await Question.findOne({ chapter: chapter._id });
    check("a solution printed apart from its question is matched to it", job?.report?.solutionsMatched === 1 && q?.modelAnswer === "$4\\pi\\,m^2$" && (q?.aiMeta?.flags || []).some((f) => /printed apart/.test(f)), { report: job?.report, q: q && { modelAnswer: q.modelAnswer, flags: q.aiMeta?.flags } });
    check("an extract run reads the page and attaches its figure to the question", job?.status === "done" && job.report.figuresAttached === 1 && Boolean(q?.questionImage), { job, q: q && { questionImage: q.questionImage, flags: q.aiMeta?.flags } });
  }

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  require("fs").rmSync(process.env.STORAGE_LOCAL_PATH, { recursive: true, force: true });
  console.log("\n" + "-".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("PASS");
};

run().catch((e) => { console.error(e); process.exit(1); });
