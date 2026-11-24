const DocChunk = require("../models/docChunkModel");
const Lecture = require("../models/lectureModel");
const docText = require("./docText");

// Finds the pieces of a batch's lecture material that answer a question
// (utils/docIndex.js builds them). Two rankings merged:
//
//  - keyword (BM25): only chunks sharing a search term with the question
//    are loaded at all, via the indexed `terms` field — cheap at any size;
//  - meaning (cosine on embeddings), when an embeddings model is set: the
//    vectors of the lectures in scope are held in memory per lecture index
//    version, so a question compares against them without a database trip.
//
// A lecture small enough to fit whole is sent whole — no ranking can beat
// the model reading everything.

const WHOLE_LECTURE_TOKENS = 12000;
const KEYWORD_CANDIDATES = 400;
const PER_RANKING = 30;

// lectureId → { version, rows: [{ id, vector: Float32Array }] }
const vectorCache = new Map();
const VECTOR_CACHE_LECTURES = Number(process.env.DOC_CHAT_VECTOR_CACHE || 300);

const vectorsFor = async (lectures) => {
  const stale = lectures.filter((l) => vectorCache.get(String(l._id))?.version !== (l.docIndex?.version || 0));
  if (stale.length) {
    const rows = await DocChunk.find({ lecture: { $in: stale.map((l) => l._id) }, embedModel: { $exists: true } })
      .select("+embedding lecture")
      .lean();
    for (const l of stale) {
      vectorCache.delete(String(l._id));
      vectorCache.set(String(l._id), {
        version: l.docIndex?.version || 0,
        rows: rows
          .filter((r) => String(r.lecture) === String(l._id) && r.embedding?.length)
          .map((r) => ({ id: String(r._id), vector: Float32Array.from(r.embedding) })),
      });
    }
    while (vectorCache.size > VECTOR_CACHE_LECTURES) vectorCache.delete(vectorCache.keys().next().value);
  }
  return lectures.flatMap((l) => vectorCache.get(String(l._id))?.rows || []);
};

const SHAPE = "lecture source page order text terms termCount";

// → { chunks: [{ _id, lecture, source, page, text }], whole: boolean }
// lectureIds: the lectures the student may read (already access-checked).
// wholeLecture: this is "Ask this lecture" — send it whole if it fits.
const retrieve = async ({ lectureIds, query, queryVector = null, limit = 8, wholeLecture = false }) => {
  if (!lectureIds.length) return { chunks: [], whole: false };

  if (wholeLecture && lectureIds.length === 1) {
    const all = await DocChunk.find({ lecture: lectureIds[0] }).sort({ order: 1 }).select(SHAPE).lean();
    const tokens = all.reduce((sum, c) => sum + docText.estimateTokens(c.text), 0);
    if (tokens <= WHOLE_LECTURE_TOKENS) return { chunks: all, whole: true };
  }

  const queryTerms = docText.terms(query);
  const keywordRanking = [];
  const loaded = new Map();
  if (queryTerms.length) {
    const candidates = await DocChunk.find({ lecture: { $in: lectureIds }, terms: { $in: [...new Set(queryTerms)] } })
      .select(SHAPE)
      .limit(KEYWORD_CANDIDATES)
      .lean();
    const scores = docText.bm25(queryTerms, candidates.map((c) => ({ terms: c.terms, length: c.termCount })));
    candidates
      .map((c, i) => ({ c, score: scores[i] }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_RANKING)
      .forEach(({ c }) => {
        keywordRanking.push(String(c._id));
        loaded.set(String(c._id), c);
      });
  }

  const vectorRanking = [];
  if (queryVector?.length) {
    const lectures = await Lecture.find({ _id: { $in: lectureIds } }).select("docIndex.version").lean();
    const q = Float32Array.from(queryVector);
    (await vectorsFor(lectures))
      .map((r) => ({ id: r.id, score: docText.cosine(q, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PER_RANKING)
      .forEach((r) => vectorRanking.push(r.id));
  }

  const ids = docText.fuse([keywordRanking, vectorRanking].filter((r) => r.length)).slice(0, limit);
  const missing = ids.filter((id) => !loaded.has(id));
  if (missing.length) {
    for (const c of await DocChunk.find({ _id: { $in: missing } }).select(SHAPE).lean()) loaded.set(String(c._id), c);
  }
  return { chunks: ids.map((id) => loaded.get(id)).filter(Boolean), whole: false };
};

module.exports = { retrieve, WHOLE_LECTURE_TOKENS };
