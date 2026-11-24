const asyncHandler = require("express-async-handler");
const Media = require("../../models/mediaModel");
const Document = require("../../models/documentModel");
const storage = require("../../adapters/storage");
const video = require("../../adapters/video");
const { streamLink } = require("../../utils/streamLink");
const protectedVideo = require("../../utils/protectedVideo");

// Uploads land in storage and get a Media document. Everything that carries an
// image or a video — questions, options, solutions, lectures — points at one of
// these rather than storing a url, so changing storage provider does not
// rewrite every document that references a file.

// viewer: the student a protected video's link is made for (a lecture),
// so the link only plays for them.
const shape = async (media, { viewer = null } = {}) => {
  const raw = media.toObject ? media.toObject() : media;
  const { hls, ...doc } = raw;
  const state = protectedVideo.publicState(hls);
  if (state) doc.protection = state;

  // Self-hosted protected video: an expiring playlist, once it's ready.
  if (doc.kind === "video" && doc.driver === "protected") {
    return { ...doc, url: state?.playable ? protectedVideo.playUrl(doc._id, viewer) : null, file: true, hls: true };
  }

  // A video file kept in storage (a live recording, an exported video
  // lesson) plays straight from its storage url; only hosted videos
  // (Bunny, YouTube, Vimeo, a link) go through the video adapter.
  if (doc.kind === "video" && storage.DRIVERS[doc.driver]) {
    // An expiring link that hides the file's own address.
    return { ...doc, url: streamLink(doc.key, doc.driver), file: true };
  }
  if (doc.kind === "video") {
    const resolved = video.resolve(doc, { origin: process.env.PROD_ORIGIN });
    return { ...doc, url: resolved?.url || null, expiresAt: resolved?.expiresAt || null };
  }

  return { ...doc, url: await storage.urlFor(doc.key, doc.driver) };
};

//@desc   Upload an image or pdf
//@route  POST /api/media/upload
//@access Private
const upload = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No file was received.");
  }

  const folder = ["questions", "solutions", "lectures", "notices", "programs", "landing", "teachers", "general"].includes(req.body.folder)
    ? req.body.folder
    : "general";

  const stored = await storage.store(folder, req.file);

  // Content addressing means the same file uploaded twice shares one key, so a
  // second upload reuses the existing document instead of orphaning a row.
  let media = await Media.findOne({ key: stored.key, driver: stored.driver });

  if (!media) {
    media = await Media.create({
      title: req.file.originalname,
      kind: stored.kind,
      driver: stored.driver,
      key: stored.key,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id,
    });
  }

  res.status(201).json({ ...(await shape(media)), deduplicated: stored.deduplicated });
});

//@desc   Turn a document already in the ingest library into an attachable
//        Media item, without storing the bytes a second time
//@route  POST /api/media/from-document/:documentId
//@access Private
const fromDocument = asyncHandler(async (req, res) => {
  const document = await Document.findById(req.params.documentId);

  if (!document) {
    res.status(404);
    throw new Error("That library document was not found.");
  }

  // Same key, same driver — this points at the file the ingest library
  // already stored rather than uploading it again. A document used both to
  // generate questions and as a lecture attachment exists as one file.
  let media = await Media.findOne({ key: document.key, driver: document.driver });

  if (!media) {
    media = await Media.create({
      title: document.title,
      kind: "document",
      driver: document.driver,
      key: document.key,
      sizeBytes: document.sizeBytes,
      mimeType: document.mimeType,
      uploadedBy: req.user._id,
    });
  }

  res.status(201).json(await shape(media));
});

//@desc   Attach a video from a provider
//@route  POST /api/media/video
//@access Private
const linkVideo = asyncHandler(async (req, res) => {
  const { provider, input, title } = req.body;

  if (!provider || !input) {
    res.status(400);
    throw new Error("A provider and a link or id are required.");
  }

  let adapter;
  try {
    adapter = video.get(provider);
  } catch (error) {
    res.status(400);
    throw error;
  }

  if (!adapter.configured()) {
    res.status(400);
    throw new Error(`${adapter.label} needs ${adapter.needs.join(" and ")} set before videos can be added.`);
  }

  // Teachers paste whatever their browser gave them, so the id is extracted
  // from a watch url, a short url or an embed url rather than demanded raw.
  const key = adapter.parse ? adapter.parse(input) : String(input).trim();

  if (!key) {
    res.status(400);
    throw new Error(`That does not look like a ${adapter.label} link or id.`);
  }

  let media = await Media.findOne({ kind: "video", driver: provider, key });

  if (!media) {
    // Best-effort and Bunny-only — YouTube/Vimeo duration would need their
    // own API credentials this project doesn't ask an admin to configure,
    // and "link" videos have no API at all by definition. null here is
    // exactly as valid as any other unknown-duration video to everything
    // downstream (see LectureView.jsx's watched-threshold logic).
    const durationSeconds = adapter.getDuration ? await adapter.getDuration(key) : null;

    media = await Media.create({
      title: title || `${adapter.label} video`,
      kind: "video",
      driver: provider,
      key,
      durationSeconds,
      uploadedBy: req.user._id,
    });
  }

  res.status(201).json(await shape(media));
});

//@desc   Resolve one media item to a playable or viewable url
//@route  GET /api/media/:id
//@access Private
const getMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id);

  if (!media) {
    res.status(404);
    throw new Error("That file is not on record.");
  }

  res.status(200).json(await shape(media));
});

//@desc   Delete a media record and the file behind it
//@route  DELETE /api/media/:id
//@access Private
const deleteMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id);

  if (!media) {
    res.status(404);
    throw new Error("That file is not on record.");
  }

  // Videos live at the provider. Deleting the record here unlinks it rather
  // than reaching into someone else's account and removing the original.
  // A protected video's encrypted chunks are ours, so they go.
  if (media.driver === "protected") {
    await protectedVideo.removeChunks(media);
  } else if (media.kind !== "video") {
    try {
      await storage.remove(media.key, media.driver);
    } catch (error) {
      // A missing file should not block removing a dangling record.
      console.error("Could not remove stored file:", error.message);
    }
  }

  await media.deleteOne();
  res.status(200).json({ message: "Removed." });
});

//@desc   Upload a video file to play as a protected video
//@route  POST /api/media/protected
//@access Private
const uploadProtected = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No video file was received.");
  }
  const media = await protectedVideo.queueUpload({
    file: req.file,
    title: String(req.body.title || "").trim().slice(0, 200) || undefined,
    hd: req.body.hd === "true" || req.body.hd === true,
    uploadedBy: req.user._id,
  });
  res.status(201).json(await shape(media));
});

//@desc   Protect a video file already in storage (or retry a failed one)
//@route  POST /api/media/:id/protect
//@access Private
const protectMedia = asyncHandler(async (req, res) => {
  const media = await Media.findById(req.params.id);
  if (!media) {
    res.status(404);
    throw new Error("That file is not on record.");
  }
  try {
    res.status(200).json(await shape(await protectedVideo.queueStored(media, { hd: Boolean(req.body?.hd) })));
  } catch (error) {
    res.status(400);
    throw error;
  }
});

const STORED_VIDEO = () => ({ kind: "video", driver: { $in: Object.keys(storage.DRIVERS) } });

//@desc   Protected videos at a glance: how many stored video files aren't
//        protected yet, and how the conversions are going
//@route  GET /api/media/protected/summary
//@access Private
const protectedSummary = asyncHandler(async (req, res) => {
  const [unprotected, counts, recent] = await Promise.all([
    Media.countDocuments({ ...STORED_VIDEO(), "hls.status": { $nin: ["queued", "converting"] } }),
    Media.aggregate([{ $match: { "hls.status": { $exists: true } } }, { $group: { _id: "$hls.status", n: { $sum: 1 } } }]),
    Media.find({ "hls.status": { $in: ["queued", "converting", "failed"] } }).sort({ updatedAt: -1 }).limit(20).select("title hls.status hls.progress hls.error updatedAt"),
  ]);
  res.status(200).json({
    unprotected,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    jobs: recent.map((m) => ({ _id: m._id, title: m.title, ...protectedVideo.publicState(m.hls) })),
  });
});

//@desc   Protect every stored video file that isn't protected yet
//@route  POST /api/media/protected/all
//@access Private
const protectAll = asyncHandler(async (req, res) => {
  const list = await Media.find({ ...STORED_VIDEO(), "hls.status": { $nin: ["queued", "converting"] } }).limit(500);
  let queued = 0;
  for (const media of list) {
    try {
      await protectedVideo.queueStored(media, { hd: Boolean(req.body?.hd) });
      queued += 1;
    } catch {
      // not a stored file after all
    }
  }
  res.status(200).json({ queued });
});

//@desc   Which video providers are available and configured
//@route  GET /api/media/providers
//@access Private
const getProviders = asyncHandler(async (req, res) => {
  res.status(200).json({
    video: video.list(),
    storage: {
      driver: storage.getDriver().name,
      accepts: Object.keys(storage.ALLOWED),
      maxImageMb: storage.MAX_MB.image,
      maxPdfMb: storage.MAX_MB.pdf,
      maxDocumentMb: storage.MAX_MB.document,
    },
  });
});

module.exports = {
  uploadProtected,
  protectMedia,
  protectedSummary,
  protectAll,
  upload,
  linkVideo,
  fromDocument,
  getMedia,
  deleteMedia,
  deleteMediaDoc: deleteMedia,
  getProviders,
  shape,
};