const Lecture = require("../models/lectureModel");
const Media = require("../models/mediaModel");
const Document = require("../models/documentModel");
const DocChunk = require("../models/docChunkModel");
const storage = require("../adapters/storage");
const ingest = require("../ai/ingest");
const { stripFigureMarkers } = require("../ai/ingest/figures");
const docText = require("./docText");

// Builds document chat's index of one lecture: its notes, and every
// attached file it can read, cut into citable DocChunks (docText.splitText)
// with search terms and — when an embeddings model is set — meaning vectors.
//
// Files are read the way question extraction reads them (ai/ingest: Bijoy
// fonts converted, one text per page). A file already in the document
// library reuses that reading, and any page it already paid to read with AI
// vision. Scanned pages with no text layer can't be searched until they are
// read with vision; they are listed on the lecture (docIndex.pendingScans)
// for an admin to read on purpose, since that costs money.

const READABLE = new Set(ingest.SUPPORTED || []);
// A page with fewer letters than this has no real text layer.
const SCAN_CHARS = 40;
// Pages read with vision in one go (the admin's "Read them" button).
const MAX_SCAN_PAGES = 150;

const running = new Map(); // lectureId → promise, so two saves don't race

const setStatus = (lectureId, fields) =>
  Lecture.updateOne({ _id: lectureId }, { $set: Object.fromEntries(Object.entries(fields).map(([k, v]) => [`docIndex.${k}`, v])) });

// One file's text by page: [{ page, text }] and the scanned pages still
// unread. page is null for files without pages (Word, plain text).
const readFile = async (media) => {
  const transcripts = Object.fromEntries(media.transcripts ? media.transcripts.entries() : []);

  const library = await Document.findOne({ key: media.key, driver: media.driver }).select(
    "+pageTexts +transcripts extractedText scanned extractVersion mimeType"
  );
  for (const [ref, text] of library?.transcripts ? library.transcripts.entries() : []) {
    if (!transcripts[ref]) transcripts[ref] = text;
  }

  let pageTexts = null;
  let fullText = "";
  if (library && library.extractVersion === ingest.EXTRACT_VERSION && (library.pageTexts?.length || library.extractedText)) {
    pageTexts = library.pageTexts?.length ? library.pageTexts : null;
    fullText = library.extractedText || "";
  } else {
    const buffer = await storage.get(media.key, media.driver);
    const extracted = await ingest.extract(buffer, media.mimeType);
    pageTexts = extracted.pageTexts || null;
    fullText = extracted.text || "";
  }

  const pages = [];
  const pending = [];
  if (pageTexts) {
    pageTexts.forEach((layer, i) => {
      const ref = `p${i + 1}`;
      const text = transcripts[ref] ? stripFigureMarkers(transcripts[ref]) : layer || "";
      if (text.replace(/\s/g, "").length < SCAN_CHARS) {
        if (!transcripts[ref]) pending.push(i + 1);
        return;
      }
      pages.push({ page: i + 1, text });
    });
  } else if (fullText.trim()) {
    pages.push({ page: null, text: fullText });
  }
  return { pages, pending };
};

const build = async (lectureId) => {
  const lecture = await Lecture.findById(lectureId).select("title bodyMarkdown attachments docIndex");
  if (!lecture) return null;
  await setStatus(lecture._id, { status: "indexing", error: null });

  try {
    const pieces = [];
    for (const section of docText.splitNotes(lecture.bodyMarkdown)) {
      for (const text of docText.splitText(section.text)) {
        pieces.push({ source: { kind: "notes", title: section.heading }, page: null, text });
      }
    }

    const attachments = await Media.find({ _id: { $in: lecture.attachments || [] } }).select("+transcripts title key driver mimeType kind");
    const byId = new Map(attachments.map((m) => [String(m._id), m]));
    const pendingScans = [];
    const skipped = [];
    for (const id of lecture.attachments || []) {
      const media = byId.get(String(id));
      if (!media) continue;
      const title = media.title || "Attachment";
      if (!READABLE.has(media.mimeType)) {
        skipped.push(title);
        continue;
      }
      try {
        const { pages, pending } = await readFile(media);
        for (const { page, text } of pages) {
          for (const piece of docText.splitText(text)) {
            pieces.push({ source: { kind: "file", media: media._id, title }, page, text: piece });
          }
        }
        if (pending.length) pendingScans.push({ media: media._id, title, pages: pending });
      } catch {
        skipped.push(title);
      }
    }

    // Vectors already made for an unchanged piece are kept, not paid again.
    const previous = await DocChunk.find({ lecture: lecture._id }).select("+embedding hash embedModel");
    const kept = new Map(previous.filter((c) => c.embedding?.length).map((c) => [c.hash, c]));

    const chunks = pieces.map((p, order) => {
      const terms = docText.terms(`${p.source.title || ""} ${p.text}`);
      const hash = docText.hash(`${p.source.title}|${p.page}|${p.text}`);
      const old = kept.get(hash);
      return {
        lecture: lecture._id,
        source: p.source,
        page: p.page,
        order,
        text: p.text,
        terms: [...new Set(terms)],
        termCount: terms.length,
        hash,
        ...(old ? { embedding: old.embedding, embedModel: old.embedModel } : {}),
      };
    });

    const needVectors = chunks.filter((c) => !c.embedding);
    if (needVectors.length) {
      try {
        const aiService = require("../ai/service");
        const vectors = await aiService.embed(needVectors.map((c) => `${c.source.title || ""}\n${c.text}`));
        if (vectors) {
          const AiConfig = require("../models/aiConfigModel");
          const model = (await AiConfig.get()).docChat?.embeddingModel;
          needVectors.forEach((c, i) => {
            c.embedding = vectors[i];
            c.embedModel = model;
          });
        }
      } catch {
        // Keyword search still works; vectors come on the next index.
      }
    }

    await DocChunk.deleteMany({ lecture: lecture._id });
    if (chunks.length) await DocChunk.insertMany(chunks, { ordered: false });

    await Lecture.updateOne(
      { _id: lecture._id },
      {
        $set: {
          "docIndex.status": "ready",
          "docIndex.indexedAt": new Date(),
          "docIndex.chunks": chunks.length,
          "docIndex.pendingScans": pendingScans,
          "docIndex.skipped": skipped,
          "docIndex.error": null,
        },
        $inc: { "docIndex.version": 1 },
      }
    );
    return { chunks: chunks.length, pendingScans, skipped };
  } catch (error) {
    await setStatus(lecture._id, { status: "failed", error: error.message });
    throw error;
  }
};

// Rebuilds one lecture's index. A second call while one runs waits for it
// and then runs once more, so the index always ends up matching the latest
// save.
const indexLecture = async (lectureId) => {
  const key = String(lectureId);
  const previous = running.get(key);
  const next = (previous ? previous.catch(() => {}) : Promise.resolve()).then(() => build(lectureId));
  running.set(key, next);
  try {
    return await next;
  } finally {
    if (running.get(key) === next) running.delete(key);
  }
};

// Reads a lecture's scanned pages with AI vision (the admin's choice — it
// costs money), caches each page on its Media, then re-indexes. userId is
// billed like any admin AI action. → pages read.
const readScannedPages = async (lectureId, userId) => {
  const lecture = await Lecture.findById(lectureId).select("docIndex");
  const pending = lecture?.docIndex?.pendingScans || [];
  if (!pending.length) return 0;

  const aiService = require("../ai/service");
  const prompts = require("../ai/prompts");
  await setStatus(lectureId, { status: "indexing" });

  let read = 0;
  try {
    for (const entry of pending) {
      if (read >= MAX_SCAN_PAGES) break;
      const media = await Media.findById(entry.media).select("key driver mimeType");
      if (!media) continue;
      const scans = await ingest.openScans(await storage.get(media.key, media.driver), media.mimeType);
      try {
        for (const page of entry.pages) {
          if (read >= MAX_SCAN_PAGES) break;
          const image = await scans.render(`p${page}`);
          const { system, prompt } = prompts.transcribePage({ label: `page (page ${page})` });
          const result = await aiService.complete({
            feature: "document_ocr",
            system,
            prompt,
            image,
            maxTokens: 8000,
            user: userId,
            reasoningEffort: "low",
          });
          const text = String(result.text || "").replace(/^```[a-z]*\s*|\s*```$/g, "").trim();
          await Media.updateOne({ _id: media._id }, { $set: { [`transcripts.p${page}`]: text || " " } });
          read += 1;
        }
      } finally {
        await scans.close();
      }
    }
  } finally {
    await indexLecture(lectureId);
  }
  return read;
};

// Lectures that have never been indexed (made before course chat existed, or
// whose index was lost), one at a time in the background. → how many.
const indexMissing = async (lectureIds = null) => {
  const filter = { $or: [{ "docIndex.status": { $exists: false } }, { "docIndex.status": "none" }] };
  if (lectureIds) filter._id = { $in: lectureIds };
  const missing = await Lecture.find(filter).select("_id").limit(500).lean();
  (async () => {
    for (const { _id } of missing) {
      await indexLecture(_id).catch(() => {});
    }
  })();
  return missing.length;
};

module.exports = { indexLecture, indexMissing, readScannedPages, MAX_SCAN_PAGES };
