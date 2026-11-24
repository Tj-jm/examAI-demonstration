const fs = require("fs");
const path = require("path");

// Shared by llamaServerBinary.js (the server executable itself) and
// embeddedModelController.js (model/mmproj .gguf files) — both are "fetch a
// big file over HTTPS with progress" and nothing more, so one streaming
// downloader covers both rather than each writing its own.
//
// Downloads to `${destPath}.part` and renames on success, so a killed
// process never leaves a file that looks complete but isn't — callers that
// check "does destPath exist" before re-downloading are safe by construction.
const downloadFile = async (url, destPath, onProgress) => {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  }

  const totalSize = Number(res.headers.get("content-length")) || 0;
  let downloadedSize = 0;

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.part`;
  const out = fs.createWriteStream(tmpPath);

  try {
    // res.body is a web ReadableStream (undici/fetch) — Node's Readable can
    // wrap it directly, which is simpler than manually pumping .getReader().
    const { Readable } = require("stream");
    const { pipeline } = require("stream/promises");
    const nodeStream = Readable.fromWeb(res.body);

    nodeStream.on("data", (chunk) => {
      downloadedSize += chunk.length;
      if (onProgress) onProgress({ totalSize, downloadedSize });
    });

    await pipeline(nodeStream, out);
  } catch (error) {
    try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
    throw error;
  }

  fs.renameSync(tmpPath, destPath);
  return { totalSize: totalSize || downloadedSize };
};

module.exports = { downloadFile };
