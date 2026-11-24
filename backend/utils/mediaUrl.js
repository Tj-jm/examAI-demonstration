const StudentUpload = require("../models/studentUploadModel");

// The local storage driver returns a path like "/media/doubt-images/x.jpg"
// — correct for a browser, which resolves it against the page's own
// origin, but meaningless to a server-side fetch() with no such context.
// S3 already returns a full url and passes through untouched.
//
// Extracted from doubtController.js (the first place this was needed) so
// exam written-answer image grading can use the exact same resolution
// logic rather than a second, potentially drifting copy of it.
const toAbsoluteUrl = (req, maybeRelative) => {
  if (!maybeRelative) return maybeRelative;
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return `${req.protocol}://${req.get("host")}${maybeRelative}`;
};

// Recovers the storage key a url was built from, if — and only if — it was
// built by this app's own storage.urlFor() for the currently configured
// driver. Anything else (an attacker's own http(s) url dropped into
// questionImage/answerImages) returns null.
//
// This exists because those fields are free-text on the way in — nothing
// stops a request from skipping the real upload endpoint and setting the
// field straight to e.g. "http://169.254.169.254/latest/meta-data/", which
// ai/service.js used to hand straight to fetch(). Resolving to a key here
// means the eventual read goes through storage.get(key) against *this
// deployment's own configured bucket/disk*, never through a raw network
// fetch of the caller-supplied url — so even a loosely-matched or wrong key
// only ever fails closed (not found), it can never reach attacker-chosen
// infrastructure.
const resolveOwnMediaKey = (urlString) => {
  if (typeof urlString !== "string" || !urlString) return null;

  // Local driver: same-origin relative path, see adapters/storage/local.js.
  const localMatch = urlString.match(/^\/media\/(.+)$/);
  if (localMatch) {
    try {
      return decodeURIComponent(localMatch[1]);
    } catch {
      return null;
    }
  }

  if (!/^https?:\/\//i.test(urlString)) return null;

  let target;
  try {
    target = new URL(urlString);
  } catch {
    return null;
  }

  // Every key this app writes is "<folder>/<32 hex>.<ext>" (storage keyFor),
  // so take it from the end of the path whatever comes before it: a bucket
  // name, an endpoint's own path (Supabase's /storage/v1/s3, an R2 endpoint
  // given with the bucket in it) or a CDN prefix. Safe for the same reason
  // as below: the key is only ever read through storage.get(), never by
  // fetching this url, and assertOwnMediaUrl still needs this student's
  // own upload record for it.
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(target.pathname);
  } catch {
    return null;
  }
  const tail = decodedPath.match(/(?:^|\/)([a-z0-9-]+\/[0-9a-f]{32}\.[a-z0-9]+)$/);
  if (tail) return tail[1];

  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL;
  if (publicBaseUrl) {
    let base;
    try {
      base = new URL(publicBaseUrl);
    } catch {
      return null;
    }
    if (target.host !== base.host) return null;
    const basePath = base.pathname.replace(/\/+$/, "");
    if (!target.pathname.startsWith(`${basePath}/`)) return null;
    try {
      return decodeURIComponent(target.pathname.slice(basePath.length + 1)) || null;
    } catch {
      return null;
    }
  }

  // No public base configured means urlFor() issued a presigned url instead
  // — recognisable by the X-Amz-Signature query param that only credentials
  // this server holds could have produced. A key recovered here still only
  // ever gets read via storage.get() against the configured S3_BUCKET, so a
  // url pointing at some other bucket/host just fails to resolve there.
  if (!target.searchParams.has("X-Amz-Signature")) return null;

  const bucket = process.env.S3_BUCKET;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";
  let key;
  try {
    key = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
  if (forcePathStyle && bucket && key.startsWith(`${bucket}/`)) {
    key = key.slice(bucket.length + 1);
  }
  return key || null;
};

// Write-time guard for questionImage/answerImages fields: rejects anything
// that isn't a url this app itself issued for a file *this student*
// actually uploaded, before it ever reaches the database (let alone the AI
// image fetch later).
//
// resolveOwnMediaKey alone only proves a key exists somewhere in this
// deployment's storage — for local storage (served unauthenticated at
// /media/<key>, see adapters/storage/local.js's isPublic) or an S3 deploy
// without a real signature check on the presigned-url branch, that key
// could belong to any file, not necessarily one this student uploaded (a
// lecture attachment, another student's shared image). Requiring a
// matching StudentUpload record — written by the actual upload endpoints in
// doubtController.js/practiceController.js/submissionController.js right
// after storage.store() — closes that: this checks who put the file there,
// not just whether the file is there.
const assertOwnMediaUrl = async (urlString, studentId, fieldLabel = "image") => {
  const key = resolveOwnMediaKey(urlString);
  if (!key || !(await StudentUpload.exists({ key, student: studentId }))) {
    const error = new Error(`That ${fieldLabel} isn't one you uploaded through the app.`);
    error.statusCode = 400;
    throw error;
  }
};

// Called by the three upload-image endpoints right after storage.store(),
// so assertOwnMediaUrl above has something to check against later. Upserted
// rather than inserted outright: two different students uploading
// byte-identical content land on the same content-addressed key (see
// adapters/storage/index.js's keyFor), and each of them genuinely did
// upload it, so neither should be blocked by the other having done it first.
const recordStudentUpload = async (key, studentId, folder, extra = {}) => {
  await StudentUpload.updateOne(
    { key, student: studentId },
    { $setOnInsert: { key, student: studentId, folder, ...extra } },
    { upsert: true }
  );
};

module.exports = { toAbsoluteUrl, resolveOwnMediaKey, assertOwnMediaUrl, recordStudentUpload };
