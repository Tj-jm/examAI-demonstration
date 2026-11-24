const multer = require("multer");
const { ALLOWED } = require("../adapters/storage");

// Files are held in memory rather than written to a temp directory: the
// storage adapter needs the buffer anyway, and a temp file left behind on a
// failed request is a slow leak nobody notices.

const limits = { fileSize: 30 * 1024 * 1024, files: 1 };

// Named for its original purpose (question/option/solution images), but this
// is also the multer instance behind /media/upload generally — lecture
// attachments (pdf, docx, pptx, txt, md) go through the same route with a
// different `folder` value, so the filter reads from the same ALLOWED list
// adapters/storage itself enforces rather than keeping a second copy of it
// that would silently drift out of sync.
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits,
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) {
      const error = new Error(
        `${file.mimetype} is not accepted. Use PNG, JPEG, WebP, GIF, ICO, PDF, Word, PowerPoint, plain text or Markdown.`
      );
      error.statusCode = 415;
      return cb(error);
    }
    cb(null, true);
  },
}).single("file");

// Spreadsheet bulk-import for questions — .csv and .xlsx only. Browsers are
// inconsistent about the mimetype they report for a .csv (Excel-saved ones
// often show up as application/vnd.ms-excel), so the extension is trusted
// as a fallback rather than rejecting a real spreadsheet over a mislabeled
// mimetype.
const uploadSpreadsheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const okMime = [
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(file.mimetype);
    const okExt = /\.(csv|xlsx)$/i.test(file.originalname || "");
    if (!okMime && !okExt) {
      const error = new Error("Upload a .csv or .xlsx file.");
      error.statusCode = 415;
      return cb(error);
    }
    cb(null, true);
  },
}).single("file");

const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = require("../ai/ingest").SUPPORTED;
    if (!allowed.includes(file.mimetype)) {
      const error = new Error(
        "Upload a PDF, Word document, PowerPoint or plain text file."
      );
      error.statusCode = 415;
      return cb(error);
    }
    cb(null, true);
  },
}).single("file");

// A PDF or a picture of a page, for reading text and figures out of it.
const uploadPageFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) {
      const error = new Error("Upload a PDF or a picture (PNG, JPG, WebP).");
      error.statusCode = 415;
      return cb(error);
    }
    cb(null, true);
  },
}).single("file");

// Multer reports its own limits through error codes rather than messages, so
// they are translated into something a person can act on.
const wrap = (handler) => (req, res, next) =>
  handler(req, res, (error) => {
    if (!error) return next();

    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(413);
      return next(new Error("That file is too large."));
    }
    if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(400);
      return next(new Error("Send one file at a time, in a field named 'file'."));
    }

    res.status(error.statusCode || 400);
    return next(error);
  });

// A video for the self-hosted protected player: straight to disk (it can be
// gigabytes), in the protected-video work folder, where the converter picks
// it up (utils/protectedVideo.js).
const uploadProtectedVideo = (req, res, next) => {
  const crypto = require("crypto");
  const maxMb = Number(process.env.PROTECTED_VIDEO_MAX_MB) || 4000;
  require("../utils/protectedVideo").incomingDir().then((dir) => multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (r, file, cb) => cb(null, `${crypto.randomBytes(16).toString("hex")}.upload`),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (r, file, cb) => {
      if (!/^video\//.test(file.mimetype)) {
        const error = new Error("Upload a video file (MP4, MOV, MKV or WebM).");
        error.statusCode = 415;
        return cb(error);
      }
      cb(null, true);
    },
  }).single("file")(req, res, next)).catch(next);
};

module.exports = {
  uploadProtectedVideo: wrap(uploadProtectedVideo),
  uploadImage: wrap(uploadImage),
  uploadDocument: wrap(uploadDocument),
  uploadPageFile: wrap(uploadPageFile),
  uploadSpreadsheet: wrap(uploadSpreadsheet),
};