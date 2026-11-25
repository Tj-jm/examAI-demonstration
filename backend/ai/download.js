const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Shared by llamaServerBinary.js (the server executable itself) and
// embeddedModelController.js (model/mmproj .gguf files) — both are "fetch a
// big file over HTTPS with progress" and nothing more, so one streaming
// downloader covers both rather than each writing its own.
//
// Downloads to `${destPath}.part` and renames on success, so a killed
// process never leaves a file that looks complete but isn't — callers that
// check "does destPath exist" before re-downloading are safe by construction.
//
// Checked before the rename:
// - a stall: no data for STALL_MS aborts the download (it would otherwise
//   hang on "downloading" until the server restarts);
// - the size: fewer bytes than Content-Length means a cut-off file;
// - the SHA-256, when the host states one: Hugging Face sends the file's
//   SHA-256 as X-Linked-Etag on its download redirects.
// `expect(firstBytes)` (optional) checks the file's start, e.g. "GGUF".
const STALL_MS = Number(process.env.DOWNLOAD_STALL_MS) || 90 * 1000;

const statedSha256 = (res) => {
  for (const name of ["x-linked-etag", "etag"]) {
    const v = String(res.headers.get(name) || "").replace(/^W\//, "").replace(/"/g, "").trim();
    if (/^[a-f0-9]{64}$/i.test(v)) return v.toLowerCase();
  }
  return null;
};

// fetch follows redirects itself and only shows the last response, which
// for Hugging Face no longer carries X-Linked-Etag. A HEAD without
// following the first redirect reads it.
const shaFromHead = async (url, signal) => {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "manual", signal });
    return statedSha256(res);
  } catch {
    return null;
  }
};

const downloadFile = async (url, destPath, onProgress, { expect } = {}) => {
  const controller = new AbortController();
  let stalled = false;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { stalled = true; controller.abort(); }, STALL_MS);
  };
  arm();

  const tmpPath = `${destPath}.part`;
  try {
    const wantSha = await shaFromHead(url, controller.signal);
    arm();
    const res = await fetch(url, { redirect: "follow", signal: controller.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
    }
    const sha = wantSha || statedSha256(res);

    const totalSize = Number(res.headers.get("content-length")) || 0;
    let downloadedSize = 0;

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const out = fs.createWriteStream(tmpPath);
    const hash = sha ? crypto.createHash("sha256") : null;

    // res.body is a web ReadableStream (undici/fetch) — Node's Readable can
    // wrap it directly, which is simpler than manually pumping .getReader().
    const { Readable } = require("stream");
    const { pipeline } = require("stream/promises");
    const nodeStream = Readable.fromWeb(res.body);

    nodeStream.on("data", (chunk) => {
      arm();
      downloadedSize += chunk.length;
      if (hash) hash.update(chunk);
      if (onProgress) onProgress({ totalSize, downloadedSize });
    });

    await pipeline(nodeStream, out);
    clearTimeout(timer);

    if (totalSize && downloadedSize !== totalSize) {
      throw new Error(`Download cut off: got ${downloadedSize} of ${totalSize} bytes (${url}). Try again.`);
    }
    if (hash) {
      const got = hash.digest("hex");
      if (got !== sha) throw new Error(`Download damaged: its checksum does not match (${url}). Try again.`);
    }
    if (expect) {
      const fd = fs.openSync(tmpPath, "r");
      const head = Buffer.alloc(expect.length);
      fs.readSync(fd, head, 0, expect.length, 0);
      fs.closeSync(fd);
      if (head.toString("latin1") !== expect) throw new Error(`Downloaded file is not the expected kind (${url}).`);
    }

    fs.renameSync(tmpPath, destPath);
    return { totalSize: totalSize || downloadedSize, sha256: sha };
  } catch (error) {
    clearTimeout(timer);
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    if (stalled) throw new Error(`Download stalled: no data for ${Math.round(STALL_MS / 1000)} seconds (${url}). Try again.`);
    throw error;
  }
};

module.exports = { downloadFile };
