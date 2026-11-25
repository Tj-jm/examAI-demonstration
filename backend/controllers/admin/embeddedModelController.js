const fs = require("fs");
const path = require("path");
const asyncHandler = require("express-async-handler");
const EmbeddedModel = require("../../models/embeddedModelModel");
const AiConfig = require("../../models/aiConfigModel");
const embedded = require("../../ai/embedded");
const { CATALOGUE } = require("../../ai/embeddedCatalogue");
const { downloadFile } = require("../../ai/download");

// Where downloaded .gguf files live — a sibling of uploads/, not inside it
// (these are not user-facing storage-adapter files, and are large enough
// that they should never accidentally get swept into a storage export or
// migration meant for lecture attachments and question images).
// EMBEDDED_MODELS_DIR moves it onto a kept volume (the Docker image sets
// /data/embedded-models), so an update does not mean downloading again.
const MODELS_DIR = path.resolve(process.env.EMBEDDED_MODELS_DIR || path.join(__dirname, "../../embedded-models"));
const ensureDir = () => fs.mkdirSync(MODELS_DIR, { recursive: true });

// In-memory download progress. A restart mid-download loses the progress
// display, not the partial file (downloadFile writes to a .part path and
// only renames on success) — the download itself is redone on the next
// click rather than silently continuing unattended.
const pulls = new Map();

const filenameFromUrl = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop());

//@desc   The curated catalogue, plus what's actually downloaded on this
//        server and any download in progress.
//@route  GET /api/ai/embedded/models
//@access Private, admin
const getEmbeddedModels = asyncHandler(async (req, res) => {
  const records = await EmbeddedModel.find({});
  const byId = new Map(records.map((r) => [r.catalogueId, r]));

  // Self-healing: a record whose file was removed by hand (or never
  // finished writing) is not reported as installed, rather than leaving a
  // permanent "Installed" badge on something that would fail the moment
  // it's actually used.
  const installed = [...byId.values()].filter((r) => {
    try {
      return fs.existsSync(r.filePath) && (!r.mmprojPath || fs.existsSync(r.mmprojPath));
    } catch {
      return false;
    }
  });

  res.status(200).json({
    catalogue: CATALOGUE,
    installed: installed.map((r) => ({ id: r.catalogueId, sizeGb: r.sizeBytes ? Number((r.sizeBytes / 1e9).toFixed(1)) : null })),
    pulls: [...pulls.entries()].map(([id, state]) => ({ id, ...state })),
    running: embedded.getStatus()?.catalogueId || null,
    // Where it runs: the GPU found on this server (if any), and the
    // running server's backend and layers on the GPU.
    gpu: await require("../../ai/llamaServerBinary").detectGpu().catch(() => ({ backends: [], note: "could not check" })),
    device: (await embedded.activity()).server?.device || null,
    gpuFailed: (await embedded.activity()).gpuFailed || null,
  });
});

//@desc   How a download is going
//@route  GET /api/ai/embedded/pull-status
//@access Private, admin
const getPullStatus = asyncHandler(async (req, res) => {
  res.status(200).json({ pulls: [...pulls.entries()].map(([id, state]) => ({ id, ...state })) });
});

//@desc   Start downloading one of the curated models (and its mmproj file,
//        for a vision entry). All files for one entry land in their own
//        subfolder of embedded-models/ so a split model's parts, and a
//        vision model's mmproj, never collide with another entry's files
//        of the same generic name.
//@route  POST /api/ai/embedded/pull
//@access Private, admin
const pullModel = asyncHandler(async (req, res) => {
  const { id } = req.body;
  const entry = CATALOGUE.find((m) => m.id === id);

  if (!entry) {
    res.status(400);
    throw new Error("That model is not in the list.");
  }
  if (pulls.get(id)?.status === "downloading") {
    res.status(200).json({ message: "Already downloading.", id });
    return;
  }

  ensureDir();
  const entryDir = path.join(MODELS_DIR, id);
  fs.mkdirSync(entryDir, { recursive: true });
  pulls.set(id, { status: "downloading", percent: 0, startedAt: Date.now() });

  // Deliberately not awaited — a multi-gigabyte download runs for minutes,
  // and the request that starts it returns immediately while the client
  // polls pull-status.
  (async () => {
    try {
      const files = [
        ...entry.modelUrls.map((url) => ({ url, kind: "model" })),
        ...(entry.mmprojUrl ? [{ url: entry.mmprojUrl, kind: "mmproj" }] : []),
      ];

      // Aggregate progress across every file for this entry (model parts +
      // mmproj), not just the one currently downloading — otherwise a
      // split model's progress bar would jump back to 0% at the start of
      // each part.
      const perFile = files.map(() => ({ done: 0, total: 0 }));
      const reportProgress = () => {
        const total = perFile.reduce((sum, f) => sum + f.total, 0);
        const done = perFile.reduce((sum, f) => sum + f.done, 0);
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        pulls.set(id, { status: "downloading", percent });
      };

      let modelPath = null;
      let mmprojPath = null;
      let totalBytes = 0;

      for (let i = 0; i < files.length; i += 1) {
        const { url, kind } = files[i];
        const destPath = path.join(entryDir, filenameFromUrl(url));

        if (!fs.existsSync(destPath)) {
          const { totalSize } = await downloadFile(url, destPath, ({ totalSize, downloadedSize }) => {
            perFile[i] = { done: downloadedSize, total: totalSize || perFile[i].total || downloadedSize };
            reportProgress();
          }, { expect: "GGUF" });
          perFile[i].total = totalSize || perFile[i].total;
        }
        perFile[i].done = perFile[i].total = fs.statSync(destPath).size;
        reportProgress();

        totalBytes += fs.statSync(destPath).size;
        if (kind === "model" && !modelPath) modelPath = destPath; // first part is the entrypoint
        if (kind === "mmproj") mmprojPath = destPath;
      }

      await EmbeddedModel.findOneAndUpdate(
        { catalogueId: id },
        { catalogueId: id, filePath: modelPath, mmprojPath: mmprojPath || undefined, sizeBytes: totalBytes, downloadedAt: new Date() },
        { upsert: true }
      );

      pulls.set(id, { status: "done", percent: 100, finishedAt: Date.now() });
    } catch (error) {
      pulls.set(id, { status: "failed", error: error.message });
    }
  })();

  res.status(202).json({ message: `Downloading ${entry.label}.`, id });
});

//@desc   Remove a downloaded model from disk. Refused while it's the
//        currently selected one — same "pick something else first" rule
//        as deleting anything else actively in use elsewhere in this app,
//        rather than silently leaving AiConfig.model pointing at nothing.
//@route  DELETE /api/ai/embedded/models/:id
//@access Private, admin
const deleteEmbeddedModel = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const config = await AiConfig.get();
  if (config.provider === "embedded" && config.model === id) {
    res.status(400);
    throw new Error("This is the model currently in use — switch to another one first.");
  }

  const record = await EmbeddedModel.findOne({ catalogueId: id });
  if (!record) {
    res.status(404);
    throw new Error("That model is not installed.");
  }

  await embedded.unload(id);

  // Removes the whole per-entry folder (every model part plus its mmproj),
  // not just the tracked filePath, so a failed/partial download's stray
  // .part files don't linger after "Delete" either.
  try {
    fs.rmSync(path.join(MODELS_DIR, id), { recursive: true, force: true });
  } catch {
    // Already gone from disk is fine — the record is still cleaned up below.
  }
  await EmbeddedModel.deleteOne({ catalogueId: id });
  pulls.delete(id);

  res.status(200).json({ message: "Removed." });
});

//@desc   Stop the running built-in model's server process without deleting
//        it or changing what's selected — it respawns automatically the
//        next time an AI call actually needs it. Mainly for freeing the RAM
//        it's holding between uses, or before doing something else memory-
//        heavy on the same box.
//@route  POST /api/ai/embedded/stop
//@access Private, admin
const stopEmbeddedModel = asyncHandler(async (req, res) => {
  const wasRunning = embedded.getStatus()?.catalogueId || null;
  await embedded.unload();
  res.status(200).json({ message: wasRunning ? "Stopped." : "Nothing was running.", stopped: wasRunning });
});

module.exports = { getEmbeddedModels, getPullStatus, pullModel, deleteEmbeddedModel, stopEmbeddedModel };
