const { z } = require("zod");
const storage = require("../adapters/storage");
const PictureNote = require("../models/pictureNoteModel");

// Pictures offered to the video lesson script writer (utils/videoLesson.js
// pictureLibrary) come with only a caption or the question they belong to.
// Here each is read once by a vision model: what it actually shows, and up
// to four parts worth zooming into. Kept per file (models/pictureNoteModel.js),
// so a picture costs one call ever. A model that can't see, or a call that
// fails, leaves the picture with its old description.
const noteSchema = z.object({
  desc: z.string().min(1).max(600),
  regions: z.array(z.object({
    label: z.string().min(1).max(80),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    w: z.number().min(1).max(100),
    h: z.number().min(1).max(100),
  })).max(4).nullable().optional(),
});

const PROMPT = {
  system: "You describe teaching pictures for a teacher who can't see them and must decide where each fits in a lesson. Be exact and brief. Return only a single JSON object.",
  prompt: `Describe this picture.
- desc: what it shows in 1 to 3 sentences: the kind (photo, diagram, graph, table, handwritten working, apparatus), the subject, and any labels, values or text you can read.
- regions: up to 4 parts worth zooming into (a labelled component, one graph, one step), each with a short label and its box as x, y, w, h in percent of the picture (x, y the top-left corner). Leave out when nothing stands apart.

Shape:
{ "desc": "...", "regions": [ { "label": "...", "x": 10, "y": 20, "w": 30, "h": 25 } ] }`,
};

const RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 3;

const shapeRegions = (regions) => (regions || []).map((r, i) => {
  const x = Math.min(95, Math.max(0, r.x));
  const y = Math.min(95, Math.max(0, r.y));
  return { id: `r${i + 1}`, label: String(r.label).slice(0, 80), x, y, w: Math.min(100 - x, Math.max(5, r.w)), h: Math.min(100 - y, Math.max(5, r.h)) };
});

const read = async (media, { user }) => {
  const bytes = await storage.get(media.key, media.driver || undefined);
  const mimeType = storage.mimeTypeFor(media.key);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeType) || !bytes?.length || bytes.length > MAX_BYTES) throw new Error("Not a readable picture.");
  const ai = require("../ai/service");
  const { data } = await ai.generate({
    feature: "video-lesson-pictures",
    schema: noteSchema,
    ...PROMPT,
    image: { base64: bytes.toString("base64"), mimeType },
    maxTokens: 900,
    user,
    student: null,
    wrapLatex: false,
  });
  return { desc: data.desc.trim(), regions: shapeRegions(data.regions) };
};

// library: [{ id, desc, media }] (pictureLibrary). Returns the same list,
// each with what it shows added to desc and its regions, where known.
const describePictures = async (library, { user = null } = {}) => {
  if (!library?.length) return library || [];
  const notes = new Map((await PictureNote.find({ key: { $in: library.map((p) => p.media.key) } }).lean()).map((n) => [n.key, n]));
  const todo = library.filter((p) => {
    const n = notes.get(p.media.key);
    return !n || (!n.desc && (!n.failedAt || Date.now() - new Date(n.failedAt).getTime() > RETRY_AFTER_MS));
  });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const p = todo[next];
      next += 1;
      try {
        const note = await read(p.media, { user });
        notes.set(p.media.key, note);
        await PictureNote.updateOne({ key: p.media.key }, { $set: { driver: p.media.driver || null, ...note, failedAt: null } }, { upsert: true });
      } catch {
        await PictureNote.updateOne({ key: p.media.key }, { $set: { driver: p.media.driver || null, failedAt: new Date() } }, { upsert: true }).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return library.map((p) => {
    const n = notes.get(p.media.key);
    if (!n?.desc) return p;
    return { ...p, desc: `${p.desc}. It shows: ${n.desc}`, regions: n.regions || [] };
  });
};

module.exports = { describePictures };
