const crypto = require("crypto");
const path = require("path");

const local = require("./local");
const s3 = require("./s3");

// Local disk by default: a buyer can install and upload an image without an
// account anywhere. S3 is the same interface behind an environment variable.

const DRIVERS = { local, s3 };

const getDriver = () => {
  const name = process.env.STORAGE_PROVIDER || "local";
  const driver = DRIVERS[name];

  if (!driver) {
    throw new Error(
      `Unknown STORAGE_PROVIDER "${name}". Expected one of: ${Object.keys(DRIVERS).join(", ")}.`
    );
  }

  return driver;
};

// Only formats that render in a browser and are cheap to serve, plus the
// document formats the ingest pipeline already knows how to read — a lecture
// attachment and an ingest upload are the same kind of file, so the same
// pipeline that reads a document for question generation can also serve it as
// a downloadable resource for students. Svg is absent on purpose: it can
// carry script, and these files are served from the same origin as the
// session cookie.
const ALLOWED = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  // Browsers report a .ico file's mimetype inconsistently — both show up in
  // practice depending on OS/browser — so both are accepted for the favicon
  // upload rather than picking one and rejecting the other.
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
};

// Declared in megabytes because that is what the limit is reported as. Using
// 1024-based bytes here and dividing by 1e6 to display gives "8.388608 MB".
const MAX_MB = { image: 8, pdf: 25, document: 25 };
const MAX_BYTES = {
  image: MAX_MB.image * 1_000_000,
  pdf: MAX_MB.pdf * 1_000_000,
  document: MAX_MB.document * 1_000_000,
};

const DOCUMENT_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
]);

const kindOf = (mimeType) => {
  if (mimeType === "application/pdf") return "pdf";
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return "document";
  return "image";
};

// The inverse of ALLOWED's mimeType -> extension mapping — used to recover
// a stored file's mimeType from its key alone (keyFor bakes the extension
// in), for callers that only ever kept the key/url, not the original upload.
const EXT_TO_MIME = Object.fromEntries(
  Object.entries(ALLOWED).map(([mimeType, ext]) => [ext, mimeType])
);
const mimeTypeFor = (key) => EXT_TO_MIME[path.extname(key).slice(1).toLowerCase()] || "application/octet-stream";

// Content-addressed: the same file uploaded twice lands on the same key, and a
// key never collides or needs a lookup to be unique.
const keyFor = (folder, buffer, mimeType) => {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  return path.posix.join(folder, `${hash}.${ALLOWED[mimeType]}`);
};

// The file's first bytes must match the type it claims. The browser's
// mimetype and the file name are whatever the uploader says, so a script or
// HTML page renamed to photo.png is refused here instead of being stored
// and served from our own domain. Text must be valid UTF-8 with no NUL
// bytes and no HTML.
const startsWith = (buf, ...bytes) => bytes.every((b, i) => buf[i] === b);
const SIGNATURES = {
  png: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  jpg: (b) => startsWith(b, 0xff, 0xd8, 0xff),
  webp: (b) => startsWith(b, 0x52, 0x49, 0x46, 0x46) && b.toString("latin1", 8, 12) === "WEBP",
  gif: (b) => b.toString("latin1", 0, 6) === "GIF87a" || b.toString("latin1", 0, 6) === "GIF89a",
  ico: (b) => startsWith(b, 0x00, 0x00, 0x01, 0x00),
  pdf: (b) => b.toString("latin1", 0, 5) === "%PDF-",
  docx: (b) => startsWith(b, 0x50, 0x4b, 0x03, 0x04),
  pptx: (b) => startsWith(b, 0x50, 0x4b, 0x03, 0x04),
  txt: (b) => isPlainText(b),
  md: (b) => isPlainText(b),
};
const isPlainText = (b) => {
  if (b.includes(0)) return false;
  const text = b.toString("utf8");
  if (Buffer.from(text, "utf8").length !== b.length) return false;
  return !/<\s*(script|html|iframe|svg|object|embed)\b/i.test(text.slice(0, 64 * 1024));
};
const contentMatches = (file) => {
  const check = SIGNATURES[ALLOWED[file.mimetype]];
  return Boolean(file.buffer?.length) && (!check || check(file.buffer));
};

const store = async (folder, file) => {
  if (ALLOWED[file.mimetype] && !contentMatches(file)) {
    const error = new Error("That file isn't what its type says it is. Upload the original file.");
    error.statusCode = 415;
    throw error;
  }
  if (!ALLOWED[file.mimetype]) {
    const error = new Error(
      `${file.mimetype} is not an accepted file type. Use PNG, JPEG, WebP, GIF, ICO, PDF, Word, PowerPoint, plain text or Markdown.`
    );
    error.statusCode = 415;
    throw error;
  }

  const kind = kindOf(file.mimetype);

  if (file.buffer.length > MAX_BYTES[kind]) {
    const error = new Error(
      `That ${kind} is ${(file.buffer.length / 1e6).toFixed(1)} MB. The limit is ${MAX_MB[kind]} MB.`
    );
    error.statusCode = 413;
    throw error;
  }

  const driver = getDriver();
  const key = keyFor(folder, file.buffer, file.mimetype);

  // Content addressing means a repeat upload is already there.
  if (await driver.exists(key)) {
    return { key, kind, driver: driver.name, deduplicated: true };
  }

  await driver.put(key, file.buffer, file.mimetype);
  return { key, kind, driver: driver.name, deduplicated: false };
};

const remove = async (key, driverName) => {
  const driver = DRIVERS[driverName] || getDriver();
  await driver.remove(key);
};

// Files the server makes itself (video lessons' voice audio and exported
// videos), never a user's upload. Kept apart from ALLOWED so the public
// upload routes stay images and documents only.
const GENERATED = { "audio/mpeg": "mp3", "audio/wav": "wav", "video/mp4": "mp4", "video/webm": "webm", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
const GENERATED_MAX_BYTES = { audio: 30 * 1024 * 1024, video: 500 * 1024 * 1024, image: 10 * 1024 * 1024, application: 200 * 1024 * 1024 };
const storeGenerated = async (folder, buffer, mimeType) => {
  const ext = GENERATED[mimeType];
  if (!ext) throw Object.assign(new Error(`${mimeType} can't be stored here.`), { statusCode: 415 });
  const kind = mimeType.split("/")[0];
  if (buffer.length > GENERATED_MAX_BYTES[kind]) {
    throw Object.assign(new Error(`That ${kind} file is ${(buffer.length / 1e6).toFixed(1)} MB, over the ${GENERATED_MAX_BYTES[kind] / 1024 / 1024} MB limit.`), { statusCode: 413 });
  }
  const driver = getDriver();
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
  const key = path.posix.join(folder, `${hash}.${ext}`);
  if (!(await driver.exists(key))) await driver.put(key, buffer, mimeType);
  return { key, driver: driver.name, sizeBytes: buffer.length };
};

const urlFor = async (key, driverName) => {
  const driver = DRIVERS[driverName] || getDriver();
  return await driver.url(key);
};

// Reads a stored file's raw bytes back out — used to extract text from a
// lecture attachment on demand when it wasn't added through the ingest
// library (see summarizeLectureAttachments in lectureController.js), so
// there's no cached Document.extractedText to reuse instead.
const get = async (key, driverName) => {
  const driver = DRIVERS[driverName] || getDriver();
  return await driver.get(key);
};

const exists = async (key, driverName) => {
  const driver = DRIVERS[driverName] || getDriver();
  return await driver.exists(key);
};

module.exports = {
  contentMatches, getDriver, store, storeGenerated, remove, urlFor, get, exists, mimeTypeFor, ALLOWED, MAX_BYTES, MAX_MB, DRIVERS };