const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const AiConfig = require("../../models/aiConfigModel");
const Topic = require("../../models/topicModel");
const Chapter = require("../../models/chapterModel");
const { Question } = require("../../models/questionModel");
const Document = require("../../models/documentModel");
const Media = require("../../models/mediaModel");
const storage = require("../../adapters/storage");
const ai = require("../../ai/service");
const schemas = require("../../ai/schemas");
const prompts = require("../../ai/prompts");
const ingest = require("../../ai/ingest");
const { sourcesFromBody } = require("../../utils/archiveSources");
const figures = require("../../ai/ingest/figures");
const { planPageSteps, splitAtQuestions } = require("../../ai/ingest/pageSteps");
const finalize = require("../../ai/ingest/finalize");
const shared = require("../../utils/shared");

// Generating from a whole document rather than a pasted paragraph. The work is
// in the chunking: a model given sixty pages writes every question from the
// first ten, and nothing in the output admits it.
//
// A run takes minutes, so the request that starts it returns immediately and
// the interface polls. Held in memory by the process running it, and copied
// to utils/shared.js so a poll that reaches another server (with Redis)
// still finds it. A restart loses the progress display; the questions
// already written are safe in the database.

const jobs = new Map();
// One AbortController per running job — kept apart from `jobs`, whose
// entries are sent to the browser as they are.
const queue = require("../../utils/queue");
// How many document runs may go at once across every server.
const ingestLimit = async () => (await require("../../models/performanceSettingsModel").safeGet()).background?.ingestConcurrency || 2;

const aborters = new Map();

// A Stop pressed on any server reaches the one running the job.
shared.onCancel((ns, id) => {
  if (ns !== "ingest") return;
  const job = jobs.get(id);
  if (job && job.status === "running") {
    job.stopRequested = true;
    aborters.get(id)?.abort();
  }
});

const JOB_TTL_MS = 30 * 60 * 1000;

const sweep = () => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) {
      jobs.delete(id);
      aborters.delete(id);
    }
  }
};

// Extension used only for the key on disk/S3 — cosmetic, but a ".bin" library
// full of unreadable filenames is a bad time for whoever browses the bucket
// directly.
// Budget for one page transcription. A dense page of maths in LaTeX runs to
// several thousand tokens; one that still doesn't fit is read again in two
// halves (see transcribe below).
const OCR_MAX_TOKENS = 8000;

// Pages read with AI vision in one run — each is a vision call. Scans, and
// pages whose maths/figures/encoding the text layer can't carry (see
// ingest/pdfPages.js), so a whole Bangla physics paper counts. Transcriptions
// are cached, so a second run over the same pages costs nothing here.
const MAX_SCANS_PER_RUN = 150;
// Below this many non-space characters there is nothing to work from. Low on
// purpose: one short transcribed question is still real content.
const MIN_TEXT_CHARS = 20;

// Formats that keep page (or slide) boundaries, so a page range means something.
const PAGED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

const EXTENSION_FOR = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
};

// A small content-addressed store scoped to the ingest library, rather than
// reusing adapters/storage's ALLOWED list directly. That list is also where
// the question/lecture image picker gets its "accepted file types" from
// (see mediaController.getAccepted) — widening it to docx/pptx/txt/md would
// make the platform advertise those as valid question images too.
const storeDocumentBytes = async (buffer, mimeType) => {
  const driver = storage.getDriver();
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const key = `documents/${hash}.${EXTENSION_FOR[mimeType] || "bin"}`;

  if (!(await driver.exists(key))) {
    await driver.put(key, buffer, mimeType);
  }

  return { key, driver: driver.name };
};

// Replaces a library document's extraction with a fresh one. Its cached
// transcriptions and figure crops came from the old reading, so they go too —
// unless the old reading only differs in which pages it sent to vision.
const applyExtraction = async (document, extracted) => {
  const keepReadings = (document.extractVersion || 1) >= ingest.SAME_READING_FROM && (extracted.extractVersion || 1) >= ingest.SAME_READING_FROM;
  const keepFigures = (document.extractVersion || 1) >= ingest.SAME_FIGURES_FROM || (extracted.extractVersion || 1) < ingest.SAME_FIGURES_FROM;
  await Document.updateOne(
    { _id: document._id },
    {
      $set: {
        extractedText: extracted.text,
        pageTexts: extracted.pageTexts || undefined,
        scanned: extracted.scanned || [],
        visionReasons: extracted.visionReasons,
        imageBoxes: extracted.imageBoxes,
        renderScales: extracted.renderScales,
        bijoyPages: extracted.bijoyPages,
        extractVersion: extracted.extractVersion,
        characters: extracted.text.length,
        sample: extracted.text.slice(0, 400),
      },
      ...(keepReadings
        ? keepFigures ? {} : { $unset: { figures: "" } }
        : { $unset: { transcripts: "", figures: "" } }),
    }
  );
  Object.assign(document, {
    extractedText: extracted.text,
    pageTexts: extracted.pageTexts || undefined,
    scanned: extracted.scanned || [],
    visionReasons: extracted.visionReasons,
    imageBoxes: extracted.imageBoxes,
    renderScales: extracted.renderScales,
    bijoyPages: extracted.bijoyPages,
    extractVersion: extracted.extractVersion,
  });
};

// Looks up a document by the hash of its exact bytes, or creates it. Called
// from both preview and a from-scratch generate, since either one might be
// the first time a given file is seen, and the extraction has already been
// paid for by the time this runs — throwing it away would mean doing it again
// the next time someone wants the same source.
const saveOrReuseDocument = async ({ file, extracted, chunkCount, userId }) => {
  const contentHash = crypto.createHash("sha256").update(file.buffer).digest("hex");

  const existing = await Document.findOne({ contentHash });
  if (existing) {
    // Read by an older extractor (Bijoy fonts left as gibberish, maths and
    // figure pages not sent to vision), or saved before scanned pages were
    // tracked: take this fresh extraction instead.
    if ((extracted.extractVersion || 1) > (existing.extractVersion || 1) || (existing.scanned === undefined && extracted.scanned)) {
      await applyExtraction(existing, extracted);
    }
    return existing;
  }

  const stored = await storeDocumentBytes(file.buffer, file.mimetype);

  return Document.create({
    title: file.originalname.replace(/\.[^./\\]+$/, ""),
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    driver: stored.driver,
    key: stored.key,
    sizeBytes: file.buffer.length,
    contentHash,
    extractedText: extracted.text,
    pageTexts: extracted.pageTexts || undefined,
    scanned: extracted.scanned || [],
    visionReasons: extracted.visionReasons,
    imageBoxes: extracted.imageBoxes,
    renderScales: extracted.renderScales,
    bijoyPages: extracted.bijoyPages,
    extractVersion: extracted.extractVersion,
    pages: extracted.pages,
    characters: extracted.text.length,
    chunkCount,
    looksScanned: extracted.looksScanned,
    sample: extracted.text.slice(0, 400),
    uploadedBy: userId,
  });
};

// { p1: ["maths", "figures"], p2: ["maths"] } → { maths: 2, figures: 1 }
const tallyReasons = (visionReasons) => {
  const tally = {};
  for (const reasons of Object.values(visionReasons || {})) {
    for (const r of reasons) tally[r] = (tally[r] || 0) + 1;
  }
  return tally;
};

//@desc   Read a document and report what would be generated from it
//@route  POST /api/ai/ingest/preview
//@access Private
const preview = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const extracted = await ingest.extract(req.file.buffer, req.file.mimetype);
  const chunks = ingest.chunk(extracted.text);

  // Saved here rather than only once a generation run actually starts — the
  // parsing that just happened is the expensive part, and a person previewing
  // a file is very likely to come back and generate from it, possibly more
  // than once. Content-addressed, so previewing the same file twice reuses
  // the same library entry instead of creating a second one.
  const document = await saveOrReuseDocument({
    file: req.file,
    extracted,
    chunkCount: chunks.length,
    userId: req.user._id,
  });

  // Shown before anything is spent, so a teacher can see that their scanned
  // pdf yielded four hundred characters and stop rather than pay for nonsense.
  res.status(200).json({
    documentId: document._id,
    filename: req.file.originalname,
    pages: extracted.pages,
    characters: extracted.text.length,
    estimatedTokens: ingest.estimateTokens(extracted.text),
    chunks: chunks.length,
    looksScanned: extracted.looksScanned,
    // Page ranges need per-page text — PDF and PowerPoint only.
    pageSelectable: Boolean(extracted.pageTexts?.length),
    // Pages / Word images read with AI vision: scans, plus pages whose maths,
    // figures or font encoding the text layer can't carry.
    scannedPages: (extracted.scanned || []).filter((r) => r.startsWith("p")).map((r) => Number(r.slice(1))),
    visionReasons: tallyReasons(extracted.visionReasons),
    bijoyPages: extracted.bijoyPages || 0,
    scannedImages: (extracted.scanned || []).filter((r) => r.startsWith("img")).length,
    sample: extracted.text.slice(0, 400),
    suggestedQuestions: Math.min(Math.max(chunks.length * 2, 5), 40),
  });
});

// One page read with AI vision: its text exactly as printed, maths in LaTeX
// and each figure marked with where it sits ([FIGURE p3f1 | box: …]). A page
// too dense for one response is read again as its two columns (or top and
// bottom), each half's figure boxes moved back onto the whole page.
// → { text, split, partial }
const readPage = async ({ image, pageNumber, hint = "", boxes = null, language, user, signal }) => {
  const transcribe = async (img, label, pageHint = "", pageBoxes = null) => {
    const { system, prompt } = prompts.transcribePage({ label, language, hint: pageHint, imageBoxes: pageBoxes });
    const result = await ai.complete({
      feature: "document_ocr",
      system,
      prompt,
      image: img,
      maxTokens: OCR_MAX_TOKENS,
      user,
      signal,
      reasoningEffort: "low",
    });
    let text = String(result.text || "").replace(/^```[a-z]*\s*|\s*```$/g, "").trim();
    // Boxes given in the image's pixels rather than thousandths.
    if (/\[FIGURE/i.test(text)) {
      try {
        text = figures.fixPixelBoxes(text, await figures.imageSize(Buffer.from(img.base64, "base64")));
      } catch {
        // No canvas binding: the boxes are used as given.
      }
    }
    // Cut off: the provider said so, or the output used nearly the whole
    // budget (a reasoning model's hidden thinking counts against it too).
    const cut = /length|max_tokens/i.test(String(result.finishReason || "")) || result.completionTokens >= OCR_MAX_TOKENS * 0.92;
    return { text, cut };
  };

  const first = await transcribe(image, pageNumber ? `page (page ${pageNumber})` : "photographed page", hint, boxes);
  let text = first.text;
  let split = false;
  let partial = false;

  if (first.cut && pageNumber) {
    try {
      const png = Buffer.from(image.base64, "base64");
      const parts = await figures.halves(png);
      const texts = [];
      let next = 1;
      for (const part of parts) {
        const crop = await figures.cropFigure(png, part.region, 0);
        const half = await transcribe(
          { base64: crop.toString("base64"), mimeType: "image/png" },
          `${part.label} of page ${pageNumber} (the text may start or end mid-question — transcribe it anyway)`
        );
        const mapped = figures.mapFigures(half.text, part.region, next);
        next = mapped.next;
        texts.push(mapped.text);
        if (half.cut) partial = true;
      }
      text = texts.join("\n\n");
      split = true;
    } catch (error) {
      if (error.stopped || signal?.aborted) throw error;
      // The first, cut-off reading is still better than nothing.
      partial = true;
    }
  }

  // Figure ids are made document-unique ("f1" on page 3 → "p3f1").
  return { text: pageNumber ? figures.renameFigures(text, pageNumber) : text, split, partial };
};

// Figures cut out of their rendered pages and stored like any uploaded
// question image. `ids` → Map id → { mediaId } or { problem }. With a library
// document, crops are cached on it and reused; `render(page)` gives a page's
// image as a buffer (the caller opens and closes the renderer).
const cutFigures = async ({ ids, figureIndex, imageBoxes = {}, render, document = null, filename, userId }) => {
  const stored = new Map();
  if (document) {
    const cachedDoc = await Document.findById(document._id).select("+figures");
    for (const [k, v] of cachedDoc?.figures ? cachedDoc.figures.entries() : []) stored.set(k, v);
  }
  const media = new Map();
  const renders = new Map();
  for (const id of ids) {
    if (stored.has(id)) {
      media.set(id, { mediaId: stored.get(id) });
      continue;
    }
    const figure = figureIndex.get(id);
    if (!figure) {
      media.set(id, { problem: `figure ${id} was mentioned but not found on the page` });
      continue;
    }
    const drawn = (imageBoxes[`d${figure.page}`] || []).map((b) => String(b).split(",").map(Number));
    const placed = figures.placeFigure(figure.box, imageBoxes[`p${figure.page}`] || [], drawn);
    let box = placed.box;
    const problem = figures.checkBox(box);
    if (problem) {
      media.set(id, { problem });
      continue;
    }
    try {
      if (!renders.has(figure.page)) renders.set(figure.page, await render(figure.page));
      // An embedded picture's box is exact. Any other is fitted to the ink
      // around it, so labels beside a drawing aren't clipped; with no ink
      // there at all, the model's box was in the wrong place.
      let pad = 4;
      if (placed.source !== "image") {
        let fitted;
        try {
          fitted = await figures.fitToInk(renders.get(figure.page), box);
        } catch {
          fitted = undefined;
        }
        if (fitted === null) {
          media.set(id, { problem: "nothing was printed where the figure was said to be" });
          continue;
        }
        if (fitted && !figures.checkBox(fitted)) box = fitted;
        else pad = 15;
      }
      const png = await figures.cropFigure(renders.get(figure.page), box, pad);
      const saved = await storage.store("questions", {
        buffer: png,
        originalname: `${filename}-${id}.png`,
        mimetype: "image/png",
        size: png.length,
      });
      let item = await Media.findOne({ key: saved.key, driver: saved.driver });
      if (!item) {
        item = await Media.create({
          title: `${figure.caption || "Figure"} (${filename}, page ${figure.page})`.slice(0, 200),
          kind: saved.kind,
          driver: saved.driver,
          key: saved.key,
          sizeBytes: png.length,
          mimeType: "image/png",
          uploadedBy: userId,
        });
      }
      media.set(id, { mediaId: item._id });
      if (document) await Document.updateOne({ _id: document._id }, { $set: { [`figures.${id}`]: item._id } });
    } catch (error) {
      media.set(id, { problem: `the figure could not be cut out (${error.message})` });
    }
  }
  return media;
};

//@desc   Generate questions across a whole document
//@route  POST /api/ai/ingest/generate
//@access Private
const generateFromDocument = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();

  if (!config.features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }

  const {
    topicId, chapterId, types = "mcq", difficulty = "medium", documentId, language,
    // "generate" (default, unchanged) writes new questions inspired by the
    // material. "extract" transcribes real questions that already exist in
    // it — digitizing an actual past paper/question bank rather than
    // authoring new content — see prompts.extractQuestions for the exact
    // difference in what the model is told to do.
    mode = "generate",
    // Only meaningful for extract mode: files the whole extracted batch
    // straight into the archive in one step, instead of an admin having to
    // open each digitized question afterward to set these.
    authority, year, paperLabel, isPublic,
  } = req.body;
  const count = Math.min(Number(req.body.count) || 10, 60);
  const typeList = String(types).split(",").map((t) => t.trim()).filter(Boolean);
  const isExtract = mode === "extract";

  if (topicId && chapterId) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }
  if (!topicId && !chapterId) {
    res.status(400);
    throw new Error("Choose a topic, or a chapter for the chapter pool.");
  }
  // No generic "add to archive" — same rule as create/updateQuestion and
  // bulkArchiveQuestions.
  // Every board this paper's questions appeared in, each with its years —
  // or the older single authority/year/paperLabel fields.
  let rawSources = req.body.sources;
  if (typeof rawSources === "string") {
    try { rawSources = JSON.parse(rawSources); } catch { rawSources = undefined; }
  }
  const sources = sourcesFromBody({ sources: rawSources, authority, year, paperLabel }) || [];
  if (isPublic && sources.length === 0) {
    res.status(400);
    throw new Error("Pick a board/exam/book before filing these straight into the archive.");
  }
  // A passage question can only ever be chapter-pool — same rule as
  // aiController.js's generateQuestions and both bulk import paths.
  if (typeList.includes("passage") && topicId) {
    res.status(400);
    throw new Error("Passage questions can only be filed under a chapter, not a topic — choose a chapter to generate them.");
  }

  let topic = null;
  let chapter = null;
  if (topicId) {
    topic = await Topic.findById(topicId)
      .populate("chapter", "title")
      .populate("subject", "title");
    if (!topic) {
      res.status(404);
      throw new Error("Topic not found.");
    }
  } else {
    chapter = await Chapter.findById(chapterId).populate("subject", "title");
    if (!chapter) {
      res.status(404);
      throw new Error("Chapter not found.");
    }
  }

  // Either a fresh upload or a document already sitting in the library — the
  // rest of this run does not care which, since both end up as the same
  // extractedText/filename pair.
  let baseText;
  let filename;
  let document;
  let pageTexts = null;
  let scanned = [];
  let uploadBuffer = null;

  let imageBoxes = {};
  let renderScales = {};

  if (req.file) {
    const extracted = await ingest.extract(req.file.buffer, req.file.mimetype);
    baseText = extracted.text;
    pageTexts = extracted.pageTexts;
    scanned = extracted.scanned || [];
    imageBoxes = extracted.imageBoxes || {};
    renderScales = extracted.renderScales || {};
    uploadBuffer = req.file.buffer;
    filename = req.file.originalname;
    document = await saveOrReuseDocument({
      file: req.file,
      extracted,
      chunkCount: ingest.chunk(extracted.text).length,
      userId: req.user._id,
    });
  } else if (documentId) {
    document = await Document.findById(documentId).select("+pageTexts +transcripts +imageBoxes");
    if (!document) {
      res.status(404);
      throw new Error("That library document was not found.");
    }
    // A PDF read by the older extractor is read again now, once.
    if (document.mimeType === "application/pdf" && (document.extractVersion || 1) < ingest.EXTRACT_VERSION) {
      const bytes = await storage.get(document.key, document.driver);
      await applyExtraction(document, await ingest.extract(bytes, document.mimeType));
    }
    baseText = document.extractedText;
    filename = document.originalFilename;
    pageTexts = document.pageTexts?.length ? document.pageTexts : null;
    scanned = document.scanned || [];
    imageBoxes = document.imageBoxes || {};
    renderScales = document.renderScales || {};
  } else {
    res.status(400);
    throw new Error("Send a file, or choose a document from your library.");
  }

  // Optional page range ("12-20, 35") — only those pages are read, which
  // is both more precise and cheaper than the whole document.
  const pageSpec = String(req.body.pages || "").trim();
  let pageNumbers = null;
  if (pageSpec) {
    if (!PAGED_TYPES.includes(document.mimeType)) {
      res.status(400);
      throw new Error("Page ranges work for PDF and PowerPoint files only. Leave it empty to use the whole document.");
    }
    // A library document saved before page texts were kept: re-read it from
    // storage once and keep the result for next time.
    if (!pageTexts) {
      const bytes = await storage.get(document.key, document.driver);
      const reread = await ingest.extract(bytes, document.mimeType);
      pageTexts = reread.pageTexts;
      scanned = reread.scanned || [];
      imageBoxes = reread.imageBoxes || {};
      renderScales = reread.renderScales || {};
      document.pageTexts = pageTexts || undefined;
      document.scanned = scanned;
    }
    if (!pageTexts?.length) {
      res.status(422);
      throw new Error("Could not read this document page by page.");
    }
    pageNumbers = ingest.parsePageRange(pageSpec, pageTexts.length);
    filename = `${filename} (pages ${pageSpec})`;
  }

  // Scanned pages / photographed Word pages are read with AI vision first
  // (on by default; the form can switch it off). Transcriptions are cached
  // on the document, so each page is only ever paid for once.
  const readScans = !["false", false, "0"].includes(req.body.readScans);
  const inRange = (ref) => !pageNumbers || (ref.startsWith("p") && pageNumbers.includes(Number(ref.slice(1))));
  const neededScans = readScans ? scanned.filter(inRange) : [];
  // Read separately (select: false) so a re-upload of a known file reuses
  // transcriptions paid for through the library, and vice versa.
  const cached = await Document.findById(document._id).select("+transcripts");
  // Page transcripts are renamed again on load (it is idempotent), so one
  // cached before the marker format was widened still yields its figures.
  const transcripts = Object.fromEntries(
    (cached?.transcripts ? [...cached.transcripts.entries()] : []).map(([ref, text]) => {
      const page = Number((ref.match(/^p(\d+)$/) || [])[1]);
      return [ref, page ? figures.renameFigures(text, page) : text];
    })
  );
  const toTranscribe = neededScans.filter((ref) => transcripts[ref] === undefined);

  if (toTranscribe.length > MAX_SCANS_PER_RUN) {
    res.status(400);
    throw new Error(
      `${toTranscribe.length} scanned pages would need reading with AI vision — at most ${MAX_SCANS_PER_RUN} per run. `
      + (PAGED_TYPES.includes(document.mimeType) ? "Choose a page range." : "Split the document, or switch off reading scanned pages.")
    );
  }

  const buildText = () =>
    ingest.assembleText({ text: baseText, pageTexts, scanned: readScans ? scanned : [], transcripts, pageNumbers });

  // Nothing to transcribe: the text is final now, so an empty selection is
  // reported straight away instead of from inside the job.
  if (toTranscribe.length === 0 && buildText().replace(/\s/g, "").length < MIN_TEXT_CHARS) {
    res.status(422);
    throw new Error(
      scanned.length && !readScans
        ? "There's almost no text here without the scanned pages. Switch reading scanned pages back on."
        : pageSpec
          ? "Those pages have almost no readable text."
          : "There was not enough readable text in that file."
    );
  }

  document.usedCount += 1;
  document.lastUsedAt = new Date();
  await document.save();

  // Optional focus ("only Newton's laws"): sections with nothing on it may
  // legitimately return no questions, so generation validates leniently too.
  const focus = String(req.body.focus || "").trim().slice(0, 300);
  // Extract only: AI writes its own worked solution for every question.
  const writeSolutions = isExtract && String(req.body.writeSolutions) === "true";
  const lenient = isExtract || Boolean(focus);

  // Extraction always offers "written" as well: a question bank's numerical
  // questions ("… নির্ণয় কর। উত্তর : 25.2 J") have no options, and without it
  // they were silently skipped whenever only MCQ was ticked. The prompt keeps
  // written to questions with no options, so an MCQ paper still comes back
  // as MCQs.
  const extractTypes = isExtract ? [...new Set([...typeList, "written"])] : typeList;

  // One page's final text: its vision transcription when it has one,
  // otherwise its own (Bijoy-converted) text layer.
  const pageText = (n) => {
    const ref = `p${n}`;
    return readScans && scanned.includes(ref) && transcripts[ref] ? transcripts[ref] : pageTexts?.[n - 1] || "";
  };

  const planSteps = (text) => {
    // Extraction from a paged document goes page by page (see
    // ingest/pageSteps.js): a question is never cut off from its options or
    // printed answer by a chunk boundary, and a dense page is split only
    // where a new question starts. No cap on pages beyond the vision budget —
    // a question bank is hundreds of questions.
    if (isExtract && pageTexts?.length) {
      const numbers = pageNumbers || pageTexts.map((_, i) => i + 1);
      const pageSteps = planPageSteps(numbers.map((n) => ({ number: n, text: pageText(n) })));
      return {
        chunks: pageSteps,
        steps: pageSteps.map((p, i) => ({ chunkIndex: i, count: null, type: null })),
      };
    }

    // Text without pages (Word, plain text): half-size chunks, since
    // extraction transcribes every question in a chunk verbatim plus a
    // solution for each, so its output is about as long as the chunk itself
    // — and non-Latin text (Bangla etc.) costs several tokens per character,
    // far more than chunk()'s 4-chars-a-token estimate.
    const chunks = isExtract
      ? ingest.chunk(text, { targetTokens: 600, overlapTokens: 80 })
      : ingest.chunk(figures.stripFigureMarkers(text));

    // Extraction has no quota to hit — it reports whatever real questions
    // are actually in each chunk, which could be none or several at once, so
    // it gets one step per chunk asking for every requested type together.
    // Capped so a very large upload cannot run an unbounded number of calls.
    const MAX_EXTRACT_CHUNKS = 200;
    if (isExtract) {
      return { chunks, steps: chunks.slice(0, MAX_EXTRACT_CHUNKS).map((c) => ({ chunkIndex: c.index, count: null, type: null })) };
    }

    // Asking for several questions in one response is several chances for
    // the response to be wrong, and on a small model it is also a much
    // longer generation that can run past a timeout. Splitting a step of
    // three into three steps of one is slower in total but far more likely
    // to finish, and a failure then costs one question rather than three.
    //
    // Each single-question step is also assigned exactly one type here,
    // cycled through typeList in order, rather than handing the model the
    // full list and asking it to pick — a model that defaults to the same
    // choice every time otherwise produces a nominally "mixed" batch that is
    // actually all one type.
    const plan = ingest.planCoverage(chunks, count);
    const steps = [];
    let typeCursor = 0;
    for (const step of plan) {
      for (let i = 0; i < step.count; i += 1) {
        steps.push({ chunkIndex: step.chunkIndex, count: 1, type: typeList[typeCursor % typeList.length] });
        typeCursor += 1;
      }
    }
    return { chunks, steps };
  };

  // Planned now when the text is already final, so the response can say how
  // many sections there are; after transcription otherwise.
  let planned = toTranscribe.length === 0 ? planSteps(buildText()) : null;

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Stop button: aborting this ends the AI call in flight and the run stops
  // at the next page or section; what was found so far is kept.
  const aborter = new AbortController();
  aborters.set(jobId, aborter);
  const stopped = () => aborter.signal.aborted;

  jobs.set(jobId, {
    status: "running",
    // "scanning" while pages are read with AI vision, then "questions".
    phase: toTranscribe.length ? "scanning" : "questions",
    scansTotal: toTranscribe.length,
    scansDone: 0,
    filename,
    // Who started it (only they, or an owner/admin, can stop it), and where
    // its questions land in Review.
    owner: String(req.user._id),
    mode: isExtract ? "extract" : "generate",
    review: { topicId: topic ? String(topic._id) : null, chapterId: topic ? null : String(chapter._id), label: topic ? topic.title : `${chapter.title} (chapter pool)` },
    chunks: planned ? planned.chunks.length : 0,
    steps: planned ? planned.steps.length : 0,
    completed: 0,
    written: 0,
    duplicates: 0,
    failures: [],
    // What the run did beyond writing questions, for the report.
    report: {
      visionPages: neededScans.length,
      bijoyPages: document.bijoyPages || 0,
      figuresAttached: 0,
      figuresFlagged: 0,
      garbledDropped: 0,
      answersFromKey: 0,
      solutionsMatched: 0,
      solutionsUnclear: 0,
      answersSolved: 0,
      pagesSplit: 0,
      pagesPartial: [],
    },
    startedAt: Date.now(),
  });

  sweep();
  shared.trackJob("ingest", jobId, jobs.get(jobId));

  const subjectTitle = topic ? topic.subject.title : chapter.subject.title;
  const chapterTitle = topic ? topic.chapter.title : chapter.title;
  const topicTitle = topic ? topic.title : "";

  // One extraction call over `text`. A call that still fails after
  // ai.generate's own retries is tried once more as two halves, split where a
  // question starts — a dense page that is too long or too tangled for one
  // response usually goes through in two.
  const extractFrom = async (text, body, { split = true } = {}) => {
    const run = async (source) => {
      const { system, prompt } = prompts.extractQuestions({
        sourceText: source,
        topicTitle,
        chapterTitle,
        subjectTitle,
        types: extractTypes,
        language,
        focus,
        writeSolutions,
        pageScoped: source.includes(">>> TRANSCRIBE FROM HERE"),
      });
      return ai.generate({
        feature: "document_extraction",
        // Each question is validated on its own and only malformed ones are
        // dropped — one bad question used to fail the whole chunk.
        schema: schemas.questionBatchExtractLenient,
        responseSchema: schemas.questionBatchExtract,
        allowPartial: true,
        onlyTypes: extractTypes,
        system,
        prompt,
        maxTokens: 8000,
        user: req.user._id,
        signal: aborter.signal,
        reasoningEffort: "low",
      });
    };

    try {
      const { data, usage } = await run(text);
      return { questions: data.questions, answerKey: data.answerKey || [], solutions: data.solutions || [], model: usage.model };
    } catch (error) {
      if (error.stopped || stopped()) throw error;
      const halves = split && body ? splitAtQuestions(body, Math.ceil(body.length / 2)) : [];
      if (halves.length < 2) throw error;
      const results = [];
      for (const half of halves) {
        // A function replacement: the text is full of LaTeX "$", which a
        // string replacement would read as "$&"-style patterns.
        const framed = text.includes(body) ? text.replace(body, () => half) : half;
        results.push(await extractFrom(framed, null, { split: false }));
      }
      return {
        questions: results.flatMap((r) => r.questions),
        answerKey: results.flatMap((r) => r.answerKey),
        solutions: results.flatMap((r) => r.solutions),
        model: results[0]?.model,
      };
    }
  };

  // Models sometimes answer with a figure's page-local id ("f1") instead of
  // the document id in the text they were given ("p3f1"). Map it back to the
  // one figure in this step's text it can mean, preferring the step's own
  // pages over the context before them.
  const resolveFigureIds = (question, text, body) => {
    const known = [...figures.indexFigures(text).keys()];
    if (known.length === 0) return;
    const inBody = new Set(figures.indexFigures(body || "").keys());
    const resolve = (id) => {
      if (!id) return id;
      const want = String(id).toLowerCase().trim();
      if (known.includes(want)) return want;
      const local = want.replace(/^p\d+/, "");
      const matches = known.filter((k) => k.replace(/^p\d+/, "") === local);
      return matches.find((k) => inBody.has(k)) || matches[0] || want;
    };
    if (question.figure) question.figure = resolve(question.figure);
    if (question.solutionFigure) question.solutionFigure = resolve(question.solutionFigure);
    for (const o of question.options || []) if (o.figure) o.figure = resolve(o.figure);
  };

  // Figures: cut out of the rendered page and stored like any uploaded
  // question image. Pages are rendered once per run; a crop already stored
  // for this document is reused.
  const attachFigures = async (questions, figureIndex, job) => {
    const referenced = new Set();
    for (const q of questions) {
      if (q.figure) referenced.add(q.figure.toLowerCase());
      if (q.solutionFigure) referenced.add(q.solutionFigure.toLowerCase());
      for (const o of q.options || []) if (o.figure) referenced.add(o.figure.toLowerCase());
    }
    if (referenced.size === 0) return;

    let scans = null;
    let media;
    try {
      media = await cutFigures({
        ids: referenced,
        figureIndex,
        imageBoxes,
        document,
        filename,
        userId: req.user._id,
        render: async (page) => {
          if (!scans) scans = await ingest.openScans(uploadBuffer || (await storage.get(document.key, document.driver)), document.mimeType, { scales: renderScales });
          return Buffer.from((await scans.render(`p${page}`)).base64, "base64");
        },
      });
    } finally {
      if (scans) await scans.close();
    }

    const use = (q, id, apply) => {
      if (!id) return;
      const found = media.get(id.toLowerCase());
      if (found?.mediaId) {
        apply(found.mediaId);
        job.report.figuresAttached += 1;
      } else {
        q._flags.push(`Figure needs checking: ${found?.problem || "not found"}. Add the picture in the editor.`);
        job.report.figuresFlagged += 1;
      }
    };

    for (const q of questions) {
      use(q, q.figure, (id) => { q.questionImage = id; });
      use(q, q.solutionFigure, (id) => { q.solutionImage = id; });
      (q.options || []).forEach((o) => use(q, o.figure, (id) => { o.image = id; }));
    }
  };

  // Not awaited: the caller polls.
  // At most N document runs at once across every server (Pro, Settings →
  // Performance); a run past that waits its turn, shown as "waiting".
  queue.withSlot("ingest", ingestLimit, {
    signal: aborter.signal,
    onWait: () => { const j = jobs.get(jobId); if (j) j.waiting = true; },
    onStart: () => { const j = jobs.get(jobId); if (j) j.waiting = false; },
  }, async () => {
    if (toTranscribe.length) {
      const scans = await ingest.openScans(uploadBuffer || (await storage.get(document.key, document.driver)), document.mimeType, { scales: renderScales });
      const scanFailures = [];
      try {
        for (const ref of toTranscribe) {
          if (stopped()) break;
          try {
            const image = await scans.render(ref);
            const pageNumber = ref.startsWith("p") ? Number(ref.slice(1)) : null;
            const read = await readPage({
              image,
              pageNumber,
              // The text layer (Bijoy converted) gets Bangla spelling right
              // even where its maths is broken; exact picture positions make
              // figure boxes exact.
              hint: pageNumber ? pageTexts?.[pageNumber - 1] : "",
              boxes: pageNumber ? imageBoxes[ref] : null,
              language,
              user: req.user._id,
              signal: aborter.signal,
            });
            const job = jobs.get(jobId);
            if (job && read.split) job.report.pagesSplit += 1;
            if (job && read.partial && pageNumber) job.report.pagesPartial.push(pageNumber);
            transcripts[ref] = read.text;
            // Cached one page at a time, so a run that dies halfway keeps
            // what it already paid for.
            await Document.updateOne({ _id: document._id }, { $set: { [`transcripts.${ref}`]: transcripts[ref] } });
          } catch (error) {
            if (error.stopped || stopped()) break;
            scanFailures.push(`${ref.startsWith("p") ? `Page ${ref.slice(1)}` : `Image ${ref.slice(3)}`}: ${error.message}`);
          }
          const job = jobs.get(jobId);
          if (job) job.scansDone += 1;
        }
      } finally {
        await scans.close();
      }

      const text = buildText();
      if (stopped()) {
        planned = { chunks: [], steps: [] };
      } else {
        if (text.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
          throw new Error(scanFailures[0] || "The scanned pages had no readable text.");
        }
        planned = planSteps(text);
      }
      const job = jobs.get(jobId);
      if (job) {
        job.phase = "questions";
        job.chunks = planned.chunks.length;
        job.steps = planned.steps.length;
        if (scanFailures.length) job.scanWarnings = scanFailures.slice(0, 3);
      }
    }

    const { chunks, steps } = planned;
    const collected = [];
    const answerKey = [];
    const solutions = [];

    for (const step of steps) {
      if (stopped()) break;
      const piece = chunks[step.chunkIndex];
      const chunkText = piece.text;
      const ref = piece.label ? `${filename} · ${piece.label}` : `${filename} · chunk ${step.chunkIndex + 1}/${chunks.length}`;

      try {
        if (isExtract) {
          const result = await extractFrom(chunkText, piece.body);
          answerKey.push(...result.answerKey);
          for (const solution of result.solutions) {
            resolveFigureIds(solution, chunkText, piece.body);
            solutions.push({ ...solution, _order: step.chunkIndex, _page: piece.page });
          }
          for (const question of result.questions) {
            // The lenient extract schema accepts any valid type; keep only
            // the ones on offer.
            if (!extractTypes.includes(question.type)) continue;
            resolveFigureIds(question, chunkText, piece.body);
            // An English page's question with Bangla digits or words was
            // translated by the model, whatever the prompt said.
            const translated = finalize.undoTranslation(question, chunkText);
            collected.push({ ...question, _ref: ref, _model: result.model, _translated: translated, _order: step.chunkIndex });
          }
        } else {
          const { system, prompt } = prompts.generateQuestions({
            sourceText: chunkText,
            topicTitle,
            chapterTitle,
            subjectTitle,
            count: step.count,
            types: [step.type],
            difficulty,
            language,
            focus,
          });

          const { data, usage } = await ai.generate({
            feature: "document_generation",
            // A focused generation run may find nothing in a section.
            schema: lenient ? schemas.questionBatchExtractLenient : schemas.questionBatch,
            responseSchema: lenient ? schemas.questionBatchExtract : undefined,
            // Narrowed to the one type assigned to this step, the cheapest
            // grammar to build since there's no union to choose from.
            onlyTypes: [step.type],
            system,
            prompt,
            maxTokens: Math.min(700 * step.count, 8000),
            user: req.user._id,
            signal: aborter.signal,
          });

          for (const question of data.questions) {
            if (lenient && question.type !== step.type) continue;
            collected.push({ ...question, _ref: ref, _model: usage.model });
          }
        }
      } catch (error) {
        // Stopped: not a failure, just the end of the run.
        if (error.stopped || stopped()) break;
        // One bad chunk must not lose the questions already written from the
        // other twenty.
        const job = jobs.get(jobId);
        if (job) {
          job.failures.push({ chunk: step.chunkIndex, page: piece.page, reason: error.message });
          // Twenty identical messages tell nobody anything. The distinct
          // reasons are what a person needs to act on.
          job.reasons = [...new Set(job.failures.map((f) => f.reason))].slice(0, 3);
          job.failedPages = [...new Set(job.failures.map((f) => f.page).filter(Boolean))];
        }
      }

      const job = jobs.get(jobId);
      if (job) {
        job.completed += 1;
        job.written = collected.length;
      }
    }

    const job = jobs.get(jobId) || { report: {} };

    let finished = collected;
    if (isExtract) {
      // Solutions printed apart from their questions, then an answer key
      // printed on another page, fill in answers the model had to work out
      // itself — a solution printed with its question always wins.
      // With "AI writes the solution" on, a printed solution found elsewhere
      // still gives the answer but not the solution text.
      const ownSolutions = writeSolutions ? new Map(finished.map((q) => [q, q.solutionText])) : null;
      const fromSolutions = finalize.applySolutions(finished, solutions);
      if (ownSolutions) for (const q of finished) if (ownSolutions.get(q)) q.solutionText = ownSolutions.get(q);
      job.report.solutionsMatched = fromSolutions.matched;
      job.report.solutionsUnclear = fromSolutions.unclear;
      job.report.answersFromKey = finalize.applyAnswerKey(finished, answerKey);

      for (const q of finished) {
        q._flags = [...(q._notes || [])];
        if (q.answerSource === "solved") {
          q._flags.push("The answer isn't printed in the document — it was worked out by AI. Check it.");
          job.report.answersSolved += 1;
        }
        if (q._translated) q._flags.push("The page is in English but this question came back with Bangla words — check it wasn't translated.");
        const solutionProblem = finalize.cleanSolution(q);
        if (solutionProblem) q._flags.push(solutionProblem);
        finalize.stripNumber(q);
      }

      // Every figure mentioned in the pages this run read.
      const figureIndex = new Map();
      for (const n of pageNumbers || (pageTexts || []).map((_, i) => i + 1)) {
        for (const [id, f] of figures.indexFigures(pageText(n))) figureIndex.set(id, f);
      }
      await attachFigures(finished, figureIndex, job);

      finished = finished.map(finalize.stripMarkers);
      const garbled = finished.filter(finalize.isGarbled);
      job.report.garbledDropped = garbled.length;
      finished = finished.filter((q) => !finalize.isGarbled(q));
    }

    // The overlap between chunks repeats definitions, so the same question
    // arrives twice from adjacent chunks more often than you would expect.
    const { kept, dropped } = ingest.dedupe(finished);

    let created = [];
    if (kept.length > 0) {
      created = await Question.insertMany(
        kept.map((q) => {
          // Pipeline-only fields never reach the database.
          const { _ref, _model, _flags, _translated, _order, _notes, number, answerSource, figure, solutionFigure, ...question } = q;
          if (question.options) question.options = question.options.map(({ figure: f, ...o }) => o);
          return {
            ...question,
            // insertMany skips document middleware entirely, so a generated
            // passage never runs the model's own pre("validate") hook that
            // sums subQuestions into marks — see aiController.js's
            // generateQuestions for the same gap.
            ...(question.type === "passage" && {
              marks: (question.subQuestions || []).reduce((sum, sq) => sum + (Number(sq.marks) || 0), 0),
            }),
            topic: topic ? topic._id : null,
            chapter: topic ? topic.chapter._id : chapter._id,
            subject: topic ? topic.subject._id : chapter.subject._id,
            status: "pending_review",
            // Transcribed real content is "import" provenance, not "ai" —
            // the model didn't author these questions, it read them off a
            // real document, same distinction the source enum already
            // draws for any other bulk-imported content.
            source: isExtract ? "import" : "ai",
            ...(isExtract && {
              ...(sources.length > 0 && { sources }),
              isPublic: Boolean(isPublic),
            }),
            aiMeta: {
              model: _model,
              promptVersion: prompts.VERSION,
              sourceRef: _ref,
              ...(_flags?.length && { flags: _flags }),
            },
          };
        }),
        { ordered: false }
      );
    }

    if (jobs.get(jobId)) {
      // Nothing written is a failure, whatever the loop did. Reporting it as a
      // completed run with a count of zero is worse than useless — it sends a
      // person to an empty review queue looking for questions.
      job.status = stopped() ? "cancelled" : created.length === 0 && job.failures.length > 0 ? "failed" : "done";
      job.written = created.length;
      job.duplicates = dropped.length;
      job.finishedAt = Date.now();
      aborters.delete(jobId);

      if (job.status === "cancelled") {
        job.error = job.phase === "scanning"
          ? `Stopped while reading page ${Math.min(job.scansDone + 1, job.scansTotal)} of ${job.scansTotal}. Pages already read are remembered for next time.`
          : `Stopped after ${job.completed} of ${job.steps} section${job.steps === 1 ? "" : "s"}. ${created.length} question${created.length === 1 ? "" : "s"} found so far ${created.length === 1 ? "is" : "are"} in Review.`;
      } else if (job.status === "failed") {
        job.error =
          job.reasons?.length === 1
            ? job.reasons[0]
            : `Every section failed. ${job.reasons?.[0] || "No reason was reported."}`;
      } else if (created.length === 0) {
        job.error = focus
          ? `Nothing in ${pageSpec ? "those pages" : "the document"} matched the focus "${focus}".`
          : isExtract
            ? "No complete questions were found to extract."
            : "No questions were written.";
      }
    }
  }).catch((error) => {
    const job = jobs.get(jobId);
    aborters.delete(jobId);
    if (job) {
      job.status = stopped() ? "cancelled" : "failed";
      job.error = stopped() ? "Stopped." : error.message;
      job.finishedAt = Date.now();
    }
  });

  res.status(202).json({
    jobId,
    message: planned
      ? `Reading ${planned.chunks.length} section${planned.chunks.length === 1 ? "" : "s"} of ${filename}.`
      : `Reading ${toTranscribe.length} scanned page${toTranscribe.length === 1 ? "" : "s"} of ${filename} with AI vision first.`,
    chunks: planned ? planned.chunks.length : null,
    steps: planned ? planned.steps.length : null,
    documentId: document._id,
  });
});

//@desc   Read pages with AI vision and give their text and figures back: the
//        text exactly as printed (maths in LaTeX), every figure cut out as a
//        picture. Nothing is saved as questions. A PDF (whole or a page
//        range) or one picture of a page.
//@route  POST /api/ai/ingest/transcribe
//@access Private
const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const transcribeDocument = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }
  const language = String(req.body.language || "").trim().slice(0, 40);

  let document = null;
  let buffer = null;
  let filename;
  let pageTexts = null;
  let imageBoxes = {};
  let renderScales = {};
  let pageNumbers;

  const picture = req.file && PICTURE_TYPES.includes(req.file.mimetype);
  if (picture) {
    buffer = req.file.buffer;
    filename = req.file.originalname;
    pageNumbers = [1];
  } else {
    if (req.file) {
      if (req.file.mimetype !== "application/pdf") {
        res.status(400);
        throw new Error("Reading text and figures works for PDF files and pictures (PNG, JPG, WebP).");
      }
      const extracted = await ingest.extract(req.file.buffer, req.file.mimetype).catch((error) => {
        // A scan with no text layer is fine here: every page is read with vision.
        if (error.statusCode === 422) return { text: "", pageTexts: null, scanned: [] };
        throw error;
      });
      buffer = req.file.buffer;
      filename = req.file.originalname;
      pageTexts = extracted.pageTexts;
      imageBoxes = extracted.imageBoxes || {};
      renderScales = extracted.renderScales || {};
      if (extracted.text) {
        document = await saveOrReuseDocument({ file: req.file, extracted, chunkCount: ingest.chunk(extracted.text).length, userId: req.user._id });
      }
    } else if (req.body.documentId) {
      document = await Document.findById(req.body.documentId).select("+pageTexts +imageBoxes");
      if (!document) {
        res.status(404);
        throw new Error("That library document was not found.");
      }
      if (document.mimeType !== "application/pdf") {
        res.status(400);
        throw new Error("Reading text and figures works for PDF files and pictures.");
      }
      buffer = await storage.get(document.key, document.driver);
      filename = document.originalFilename;
      pageTexts = document.pageTexts?.length ? document.pageTexts : null;
      imageBoxes = document.imageBoxes || {};
      renderScales = document.renderScales || {};
    } else {
      res.status(400);
      throw new Error("Send a PDF or a picture, or choose a document from your library.");
    }
    const pageCount = pageTexts?.length || (await ingest.countPdfPages(buffer));
    const spec = String(req.body.pages || "").trim();
    pageNumbers = spec ? ingest.parsePageRange(spec, pageCount) : Array.from({ length: pageCount }, (_, i) => i + 1);
    if (spec) filename = `${filename} (pages ${spec})`;
  }
  if (!pageNumbers.length) {
    res.status(400);
    throw new Error("No pages to read.");
  }
  if (pageNumbers.length > MAX_SCANS_PER_RUN) {
    res.status(400);
    throw new Error(`That's ${pageNumbers.length} pages — at most ${MAX_SCANS_PER_RUN} per run. Choose a page range.`);
  }

  // Pages already read with vision for this document are reused, not paid
  // for again.
  const cached = document ? await Document.findById(document._id).select("+transcripts") : null;
  const transcripts = Object.fromEntries(
    (cached?.transcripts ? [...cached.transcripts.entries()] : []).map(([ref, text]) => {
      const page = Number((ref.match(/^p(\d+)$/) || [])[1]);
      return [ref, page ? figures.renameFigures(text, page) : text];
    })
  );
  const toRead = pageNumbers.filter((n) => transcripts[`p${n}`] === undefined);

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const aborter = new AbortController();
  aborters.set(jobId, aborter);
  const stopped = () => aborter.signal.aborted;
  jobs.set(jobId, {
    status: "running",
    phase: "scanning",
    mode: "transcribe",
    scansTotal: toRead.length,
    scansDone: 0,
    filename,
    owner: String(req.user._id),
    chunks: 0,
    steps: 0,
    completed: 0,
    written: 0,
    failures: [],
    startedAt: Date.now(),
  });
  sweep();

  // At most N document runs at once across every server (Pro, Settings →
  // Performance); a run past that waits its turn, shown as "waiting".
  queue.withSlot("ingest", ingestLimit, {
    signal: aborter.signal,
    onWait: () => { const j = jobs.get(jobId); if (j) j.waiting = true; },
    onStart: () => { const j = jobs.get(jobId); if (j) j.waiting = false; },
  }, async () => {
    const pictureMime = picture ? req.file.mimetype : null;
    const scans = picture
      ? { render: async () => ({ base64: buffer.toString("base64"), mimeType: pictureMime }), close: async () => {} }
      : await ingest.openScans(buffer, "application/pdf", { scales: renderScales });
    const failures = [];
    try {
      for (const n of toRead) {
        if (stopped()) break;
        const ref = `p${n}`;
        try {
          const read = await readPage({
            image: await scans.render(ref),
            pageNumber: n,
            hint: pageTexts?.[n - 1] || "",
            boxes: imageBoxes[ref] || null,
            language,
            user: req.user._id,
            signal: aborter.signal,
          });
          transcripts[ref] = read.text;
          if (read.partial) failures.push({ page: n, reason: "the page was too long to read in full; the end may be missing" });
          if (document) await Document.updateOne({ _id: document._id }, { $set: { [`transcripts.${ref}`]: read.text } });
        } catch (error) {
          if (error.stopped || stopped()) break;
          failures.push({ page: n, reason: error.message });
        }
        const job = jobs.get(jobId);
        if (job) job.scansDone += 1;
      }

      // Every figure on the pages read, cut out.
      const job = jobs.get(jobId);
      if (job) job.phase = "figures";
      const figureIndex = new Map();
      for (const n of pageNumbers) for (const [id, f] of figures.indexFigures(transcripts[`p${n}`] || "")) figureIndex.set(id, f);
      const media = figureIndex.size && !stopped()
        ? await cutFigures({
          ids: [...figureIndex.keys()],
          figureIndex,
          imageBoxes,
          document,
          filename,
          userId: req.user._id,
          render: async (page) => {
            const shot = await scans.render(`p${page}`);
            if (!picture) return Buffer.from(shot.base64, "base64");
            // A picture is drawn into a PNG first, so it crops like a page.
            const { createCanvas, loadImage } = require("@napi-rs/canvas");
            const img = await loadImage(buffer);
            const canvas = createCanvas(img.width, img.height);
            canvas.getContext("2d").drawImage(img, 0, 0);
            return canvas.toBuffer("image/png");
          },
        })
        : new Map();
      const items = await Media.find({ _id: { $in: [...media.values()].map((m) => m.mediaId).filter(Boolean) } });
      // The permanent link (routes/streamRoutes.js), not the storage url: this
      // text is copied into lecture notes, which students read later and in
      // the mobile app, where a signed or admin-relative url doesn't work.
      const urls = new Map(items.map((m) => [String(m._id), `/api/stream/file/${m.key}`]));

      const pages = pageNumbers.map((n) => {
        const text = transcripts[`p${n}`];
        const found = [];
        const body = text === undefined ? null : String(text).replace(figures.FIGURE_MARKER, (m, id) => {
          const key = `p${n}${id.toLowerCase().replace(/^p\d+/, "")}`;
          const f = figureIndex.get(key) || {};
          const got = media.get(key) || {};
          const url = got.mediaId ? urls.get(String(got.mediaId)) : null;
          found.push({ id: key, caption: f.caption || "", url, mediaId: got.mediaId || null, problem: got.problem || null });
          return url ? `![${(f.caption || "Figure").replace(/[[\]]/g, "")}](${url})` : `[Figure: ${f.caption || key} — couldn't be cut out]`;
        });
        return { page: n, text: body, figures: found };
      });

      if (job) {
        job.result = { pages, picture: Boolean(picture) };
        job.failures = failures;
        job.written = pages.filter((p) => p.text).length;
        job.status = stopped() ? "cancelled" : pages.some((p) => p.text) ? "done" : "failed";
        if (job.status === "failed") job.error = failures[0]?.reason || "Nothing could be read from those pages.";
        if (job.status === "cancelled") job.error = "Stopped. Pages already read are kept in the result and remembered for next time.";
        job.finishedAt = Date.now();
      }
    } finally {
      await scans.close();
      aborters.delete(jobId);
    }
  }).catch((error) => {
    const job = jobs.get(jobId);
    aborters.delete(jobId);
    if (job) {
      job.status = stopped() ? "cancelled" : "failed";
      job.error = stopped() ? "Stopped." : error.message;
      job.finishedAt = Date.now();
    }
  });

  res.status(202).json({ jobId, pages: pageNumbers.length, toRead: toRead.length, documentId: document?._id || null });
});

//@desc   Turn text read from pages ("Read text and figures") into
//        questions of one chosen type. Pictures in the text (the read
//        output's ![caption](/api/stream/file/<key>) lines) become the
//        questions' images. Saved for review, like any extraction.
//@route  POST /api/ai/ingest/from-text
//@access Private
const MEDIA_LINE = /!\[([^\]]*)\]\(\/api\/stream\/file\/([^)\s]+)\)/g;
const questionsFromText = asyncHandler(async (req, res) => {
  const config = await AiConfig.get();
  if (!config.features.questionGeneration) {
    res.status(403);
    throw new Error("Question generation is switched off in AI settings.");
  }
  const { topicId, chapterId, type } = req.body;
  const text = String(req.body.text || "").slice(0, 20000);
  const writeSolutions = Boolean(req.body.writeSolutions);
  if (!["mcq", "mtf", "written", "passage"].includes(type)) {
    res.status(400);
    throw new Error("Choose a question type.");
  }
  if (text.trim().length < 10) {
    res.status(400);
    throw new Error("There is no text to make questions from.");
  }
  if (topicId && chapterId) {
    res.status(400);
    throw new Error("Choose a topic or a chapter, not both.");
  }
  if (!topicId && !chapterId) {
    res.status(400);
    throw new Error("Choose a topic, or a chapter for the chapter pool.");
  }
  if (type === "passage" && topicId) {
    res.status(400);
    throw new Error("Passage questions can only be filed under a chapter, not a topic.");
  }
  const topic = topicId ? await Topic.findById(topicId).populate("chapter", "title").populate("subject", "title") : null;
  const chapter = topic ? null : await Chapter.findById(chapterId).populate("subject", "title");
  if (!topic && !chapter) {
    res.status(404);
    throw new Error(topicId ? "Topic not found." : "Chapter not found.");
  }

  // Pictures become figure markers the extraction prompt already knows.
  const keys = new Map();
  const source = text.replace(MEDIA_LINE, (m, caption, key) => {
    const id = `f${keys.size + 1}`;
    keys.set(id, key);
    return `[FIGURE ${id} | 0,0,0,0 | ${caption.replace(/[\]|]/g, " ").trim() || "Figure"}]`;
  });
  const media = keys.size ? await Media.find({ key: { $in: [...keys.values()] } }).select("_id key") : [];
  const mediaFor = (id) => {
    const key = keys.get(String(id || "").toLowerCase().replace(/^p\d+/, ""));
    return key ? media.find((m) => m.key === key)?._id : undefined;
  };

  const types = type === "passage" ? ["passage", "written"] : [type];
  const { system, prompt } = prompts.extractQuestions({
    sourceText: source,
    topicTitle: topic ? topic.title : "",
    chapterTitle: topic ? topic.chapter.title : chapter.title,
    subjectTitle: topic ? topic.subject.title : chapter.subject.title,
    types,
    writeSolutions,
    asType: type,
  });
  const { data, usage } = await ai.generate({
    feature: "document_extraction",
    schema: schemas.questionBatchExtractLenient,
    responseSchema: schemas.questionBatchExtract,
    allowPartial: true,
    onlyTypes: types,
    system,
    prompt,
    maxTokens: 8000,
    user: req.user._id,
    reasoningEffort: "low",
  });

  const questions = (data.questions || []).filter((q) => q.type === type);
  for (const q of questions) {
    q._flags = [];
    if (q.answerSource === "solved") q._flags.push("The answer isn't printed — it was worked out by AI. Check it.");
    const solutionProblem = finalize.cleanSolution(q);
    if (solutionProblem) q._flags.push(solutionProblem);
    finalize.stripNumber(q);
    const image = mediaFor(q.figure);
    if (image) q.questionImage = image;
    const solutionImage = mediaFor(q.solutionFigure);
    if (solutionImage) q.solutionImage = solutionImage;
    for (const o of q.options || []) {
      const optionImage = mediaFor(o.figure);
      if (optionImage) o.image = optionImage;
    }
  }
  const cleaned = questions.map(finalize.stripMarkers).filter((q) => !finalize.isGarbled(q));
  if (cleaned.length === 0) {
    res.status(422);
    throw new Error("No question could be made from that text.");
  }

  const created = await Question.insertMany(
    cleaned.map((q) => {
      const { _flags, number, answerSource, figure, solutionFigure, ...question } = q;
      if (question.options) question.options = question.options.map(({ figure: f, ...o }) => o);
      return {
        ...question,
        ...(question.type === "passage" && {
          marks: (question.subQuestions || []).reduce((sum, sq) => sum + (Number(sq.marks) || 0), 0),
        }),
        topic: topic ? topic._id : null,
        chapter: topic ? topic.chapter._id : chapter._id,
        subject: topic ? topic.subject._id : chapter.subject._id,
        status: "pending_review",
        source: "import",
        aiMeta: {
          model: usage.model,
          promptVersion: prompts.VERSION,
          sourceRef: text.slice(0, 120),
          ...(_flags.length && { flags: _flags }),
        },
      };
    }),
    { ordered: false }
  );

  res.status(201).json({
    message: `Made ${created.length} question${created.length === 1 ? "" : "s"} for review.`,
    created: created.length,
  });
});

//@desc   How a generation run is going
//@route  GET /api/ai/ingest/status/:jobId
//@access Private
const getJobStatus = asyncHandler(async (req, res) => {
  const job = jobs.get(req.params.jobId) || (await shared.readJob("ingest", req.params.jobId));

  if (!job) {
    res.status(404);
    throw new Error("That run has finished and its progress is no longer held.");
  }

  res.status(200).json({
    ...job,
    percent: job.steps > 0 ? Math.round((job.completed / job.steps) * 100) : 0,
  });
});

// The browser-facing summary of a job, for the progress chip on every page.
const jobSummary = (id, job) => ({
  jobId: id,
  status: job.status,
  phase: job.phase,
  waiting: Boolean(job.waiting),
  mode: job.mode,
  filename: job.filename,
  percent: job.phase === "figures" ? 100 : job.phase === "scanning" && job.scansTotal
    ? Math.round((job.scansDone / job.scansTotal) * 100)
    : job.steps > 0 ? Math.round((job.completed / job.steps) * 100) : 0,
  scansDone: job.scansDone,
  scansTotal: job.scansTotal,
  completed: job.completed,
  steps: job.steps,
  written: job.written,
  error: job.error,
  review: job.review,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
});

//@desc   Your document runs — running, and finished in the last half hour —
//        so any admin page can show and stop them
//@route  GET /api/ai/ingest/jobs
//@access Private
const getJobs = asyncHandler(async (req, res) => {
  sweep();
  // This server's own jobs are live objects; the rest come from the shared
  // store (with Redis), at most a second behind.
  const all = new Map((await shared.listJobs("ingest")).map(({ id, job }) => [id, job]));
  for (const [id, job] of jobs) all.set(id, job);
  const mine = [...all.entries()]
    .filter(([, job]) => job.owner === String(req.user._id))
    .sort(([, a], [, b]) => new Date(b.startedAt) - new Date(a.startedAt))
    .map(([id, job]) => jobSummary(id, job));
  res.status(200).json({ jobs: mine });
});

//@desc   Stop a document run. Questions already found are kept (they are in
//        Review like any others); pages already read stay cached.
//@route  POST /api/ai/ingest/jobs/:jobId/cancel
//@access Private (the person who started it, or an owner/admin)
const cancelJob = asyncHandler(async (req, res) => {
  const job = jobs.get(req.params.jobId) || (await shared.readJob("ingest", req.params.jobId));
  if (!job) {
    res.status(404);
    throw new Error("That run has finished and its progress is no longer held.");
  }
  if (job.owner !== String(req.user._id) && !["owner", "admin"].includes(req.user.role)) {
    res.status(403);
    throw new Error("Only the person who started this run, or an admin, can stop it.");
  }
  if (job.status === "running") {
    await shared.requestCancel("ingest", req.params.jobId);
  }
  res.status(200).json(jobSummary(req.params.jobId, { ...job, stopRequested: job.status === "running" || job.stopRequested }));
});

//@desc   List documents already ingested, for the "from your library" picker
//@route  GET /api/ai/documents?page=&limit=
//@access Private
const getDocuments = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.search) {
    query.$or = [
      { title: { $regex: req.query.search, $options: "i" } },
      { originalFilename: { $regex: req.query.search, $options: "i" } },
    ];
  }

  const page = Number(req.query.page) || 1;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  // Most-recently-used first rather than most-recently-uploaded: a document
  // someone keeps coming back to belongs near the top of a dropdown, a file
  // added once and never touched again does not.
  const [documents, total] = await Promise.all([
    Document.find(query)
      .select("-extractedText -pageTexts")
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Document.countDocuments(query),
  ]);

  res.status(200).json({ documents, total, page, pages: Math.ceil(total / limit) });
});

//@desc   Remove a document from the library
//@route  DELETE /api/ai/documents/:id
//@access Private
const deleteDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.id);

  if (!document) {
    res.status(404);
    throw new Error("Document not found.");
  }

  // Questions already generated from it keep their aiMeta.sourceRef text
  // regardless — removing the source file does not need to touch them.
  //
  // A lecture attachment added "from your library" points at this exact
  // key rather than a copy of it, so the file is only actually removed once
  // nothing else is still using it — otherwise the lecture is left with a
  // link to a file that no longer exists.
  const stillAttached = await Media.countDocuments({ key: document.key, driver: document.driver });

  if (stillAttached === 0) {
    await storage.remove(document.key, document.driver);
  }

  await document.deleteOne();

  res.status(200).json({ message: "Removed from the library." });
});

module.exports = {
  preview,
  generateFromDocument,
  transcribeDocument,
  questionsFromText,
  getJobStatus,
  getJobs,
  cancelJob,
  getDocuments,
  deleteDocument,
  SUPPORTED: ingest.SUPPORTED,
};