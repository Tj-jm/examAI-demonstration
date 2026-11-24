const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { downloadFile } = require("./download");

const execFileAsync = promisify(execFile);

// Pinned to a specific llama.cpp build rather than "latest" on purpose: a
// silent upstream binary swap is exactly the kind of thing that should be a
// deliberate version bump here (tested against a real GGUF, see comments
// below), not something that changes under a buyer's install without
// anyone deciding that. Bump this only after re-testing against a real
// model, the same way this one was verified.
//
// This exact build (b11183) was downloaded and run for real: the CPU-only
// Ubuntu x64 binary loaded a real GGUF, served /health and the OpenAI-
// compatible /v1/chat/completions (plain and json_schema-constrained) with
// correct output, on the same kind of Linux x64 host this runs on in
// production.
const LLAMA_CPP_TAG = "b11183";

const RELEASE_URL = (assetName) =>
  `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/${assetName}`;

// Every one of these filenames was checked to actually exist for this tag
// (a HEAD request against the real release, not just the naming convention
// docs) before being hardcoded here. Only linux/x64 has been exercised
// beyond that — actually downloaded, extracted, and run. The rest follow
// llama.cpp's own documented, consistent asset-naming scheme for the same
// release, but have not been run on this codebase; if one turns out wrong,
// resolveBinary() fails loudly (a 404 or a missing executable) rather than
// silently falling back to something else.
const ASSET_BY_PLATFORM = {
  "linux-x64": { asset: "llama-{TAG}-bin-ubuntu-x64.tar.gz", archive: "tar.gz", verified: true },
  "linux-arm64": { asset: "llama-{TAG}-bin-ubuntu-arm64.tar.gz", archive: "tar.gz", verified: false },
  "darwin-arm64": { asset: "llama-{TAG}-bin-macos-arm64.tar.gz", archive: "tar.gz", verified: false },
  "darwin-x64": { asset: "llama-{TAG}-bin-macos-x64.tar.gz", archive: "tar.gz", verified: false },
  "win32-x64": { asset: "llama-{TAG}-bin-win-cpu-x64.zip", archive: "zip", verified: false },
};

const platformKey = () => `${process.platform}-${process.arch}`;

// Sibling of embedded-models/ under backend/, not inside uploads/ — this is
// platform-specific executable code, not user content, and the two should
// never be swept together by a storage export/migration.
const BIN_ROOT = path.join(__dirname, "../llama-bin");

const extractTarGz = (archivePath, destDir) =>
  execFileAsync("tar", ["-xzf", archivePath, "-C", destDir]);

const extractZip = async (archivePath, destDir) => {
  // No pure-JS unzip dependency added for the one platform (Windows) this
  // could not be live-tested on — PowerShell's Expand-Archive ships with
  // every Windows version new enough to run this Node backend at all.
  await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
  ]);
};

const findExecutable = (dir, name) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findExecutable(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
};

// Resolves (downloading and extracting on first use) the llama-server
// binary for this host, returning its path and the directory holding its
// shared libraries (they sit next to the binary in every one of these
// release archives, confirmed for linux/x64 by actually running it with
// that directory as LD_LIBRARY_PATH).
const resolveBinary = async () => {
  const key = platformKey();
  const entry = ASSET_BY_PLATFORM[key];
  if (!entry) {
    const supported = Object.keys(ASSET_BY_PLATFORM).join(", ");
    throw new Error(
      `The built-in model feature has no llama.cpp build for this server (${key}). Supported: ${supported}.`
    );
  }

  const exeName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const destDir = path.join(BIN_ROOT, `${LLAMA_CPP_TAG}-${key}`);
  const existing = fs.existsSync(destDir) ? findExecutable(destDir, exeName) : null;
  if (existing) {
    return { binaryPath: existing, libDir: path.dirname(existing) };
  }

  fs.mkdirSync(BIN_ROOT, { recursive: true });
  const assetName = entry.asset.replace("{TAG}", LLAMA_CPP_TAG);
  const archivePath = path.join(BIN_ROOT, assetName);

  if (!fs.existsSync(archivePath)) {
    await downloadFile(RELEASE_URL(assetName), archivePath);
  }

  fs.mkdirSync(destDir, { recursive: true });
  if (entry.archive === "tar.gz") {
    await extractTarGz(archivePath, destDir);
  } else {
    await extractZip(archivePath, destDir);
  }
  try { fs.unlinkSync(archivePath); } catch { /* best effort cleanup */ }

  const binaryPath = findExecutable(destDir, exeName);
  if (!binaryPath) {
    throw new Error(`Downloaded the built-in model server for ${key} but could not find ${exeName} inside it.`);
  }
  if (process.platform !== "win32") {
    try { fs.chmodSync(binaryPath, 0o755); } catch { /* archive usually already sets this */ }
  }

  return { binaryPath, libDir: path.dirname(binaryPath) };
};

module.exports = { resolveBinary, LLAMA_CPP_TAG };
