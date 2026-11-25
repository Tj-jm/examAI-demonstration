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
// docs) before being hardcoded here. Only linux/x64 CPU has been exercised
// beyond that — actually downloaded, extracted, and run. The rest follow
// llama.cpp's own documented, consistent asset-naming scheme for the same
// release, but have not been run on this codebase; if one turns out wrong,
// resolveBinary() fails loudly (a 404 or a missing executable) and the
// caller falls back to the CPU build.
//
// One build per backend: "cpu" everywhere; "vulkan" (any GPU with a Vulkan
// driver: NVIDIA, AMD, Intel) on Linux and Windows; "cuda" (NVIDIA, with
// its runtime in a second archive) on Windows — llama.cpp ships no Linux
// CUDA build, so NVIDIA on Linux runs through Vulkan. Apple Silicon's
// build already has Metal, so "metal" is the CPU archive run with layers
// on the GPU.
const BUILDS = {
  "linux-x64": {
    cpu: ["llama-{TAG}-bin-ubuntu-x64.tar.gz"],
    vulkan: ["llama-{TAG}-bin-ubuntu-vulkan-x64.tar.gz"],
  },
  "linux-arm64": {
    cpu: ["llama-{TAG}-bin-ubuntu-arm64.tar.gz"],
    vulkan: ["llama-{TAG}-bin-ubuntu-vulkan-arm64.tar.gz"],
  },
  "darwin-arm64": {
    cpu: ["llama-{TAG}-bin-macos-arm64.tar.gz"],
    metal: ["llama-{TAG}-bin-macos-arm64.tar.gz"],
  },
  "darwin-x64": {
    cpu: ["llama-{TAG}-bin-macos-x64.tar.gz"],
  },
  "win32-x64": {
    cpu: ["llama-{TAG}-bin-win-cpu-x64.zip"],
    cuda: ["llama-{TAG}-bin-win-cuda-12.4-x64.zip", "cudart-llama-bin-win-cuda-12.4-x64.zip"],
    vulkan: ["llama-{TAG}-bin-win-vulkan-x64.zip"],
  },
};

const platformKey = () => `${process.platform}-${process.arch}`;

// Sibling of embedded-models/ under backend/, not inside uploads/ — this is
// platform-specific executable code, not user content, and the two should
// never be swept together by a storage export/migration.
// LLAMA_BIN_DIR moves it onto a kept volume (the Docker image sets
// /data/llama-bin).
const BIN_ROOT = path.resolve(process.env.LLAMA_BIN_DIR || path.join(__dirname, "../llama-bin"));

const extractTarGz = (archivePath, destDir) =>
  execFileAsync("tar", ["-xzf", archivePath, "-C", destDir]);

// Windows 10 1803+ ships bsdtar as System32\tar.exe, which reads zip and
// reports errors as a failed exit. PowerShell's Expand-Archive is the
// fallback; its errors are non-terminating by default (exit 0 with files
// missing), so ErrorActionPreference makes them fail the call.
const extractZip = async (archivePath, destDir) => {
  const tarExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (fs.existsSync(tarExe)) {
    try {
      await execFileAsync(tarExe, ["-xf", archivePath, "-C", destDir], { windowsHide: true });
      return;
    } catch { /* fall back to PowerShell */ }
  }
  const q = (s) => s.replace(/'/g, "''");
  await execFileAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '${q(archivePath)}' -DestinationPath '${q(destDir)}' -Force`,
  ], { windowsHide: true });
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

// The GPU backends worth trying on this machine, best first, and why. Only
// cheap checks (a driver tool, a library file, a device node): whether the
// GPU really works is found out by starting the server on it (ai/embedded.js
// falls back to the CPU when it doesn't).
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const detectGpu = async () => {
  const key = platformKey();
  const builds = BUILDS[key] || {};
  const found = [];
  const notes = [];
  if (builds.metal) {
    found.push("metal");
    notes.push("Apple Silicon (Metal)");
  }
  if (builds.cuda) {
    try {
      const { stdout } = await execFileAsync("nvidia-smi", ["-L"], { timeout: 5000, windowsHide: true });
      // "GPU 0: NVIDIA GeForce RTX 3050 (UUID: GPU-…)", with \r\n on Windows.
      const gpu = stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => /^GPU \d/.test(l));
      if (gpu) { found.push("cuda"); notes.push(gpu.replace(/^GPU \d+:\s*/, "").replace(/\s*\(UUID[^)]*\)/, "").trim()); }
    } catch { /* no NVIDIA driver */ }
  }
  if (builds.vulkan) {
    let loader = false;
    let device = false;
    if (process.platform === "win32") {
      loader = exists(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "vulkan-1.dll"));
      device = loader;
    } else {
      loader = ["/usr/lib/x86_64-linux-gnu/libvulkan.so.1", "/usr/lib/aarch64-linux-gnu/libvulkan.so.1", "/usr/lib64/libvulkan.so.1", "/usr/lib/libvulkan.so.1"].some(exists);
      let dri = [];
      try { dri = fs.readdirSync("/dev/dri").filter((n) => n.startsWith("renderD")); } catch { /* none */ }
      device = dri.length > 0 || exists("/dev/nvidia0");
      if (!loader && device) notes.push("a GPU is present but the Vulkan library (libvulkan1) is not installed");
    }
    if (loader && device) { found.push("vulkan"); if (!notes.length) notes.push("Vulkan GPU"); }
  }
  return { backends: found, note: notes.join("; ") || "no GPU found" };
};

const binDir = (key, backend) => path.join(BIN_ROOT, backend === "cpu" || backend === "metal" ? `${LLAMA_CPP_TAG}-${key}` : `${LLAMA_CPP_TAG}-${key}-${backend}`);

// Resolves (downloading and extracting on first use) the llama-server
// binary for this host and backend ("cpu" unless said otherwise),
// returning its path and the directories holding its shared libraries
// (they sit next to the binary in every one of these release archives,
// confirmed for linux/x64 by actually running it with that directory as
// LD_LIBRARY_PATH; the CUDA runtime archive extracts beside it).
// `onStep({ step, downloadedSize, totalSize })`: "download" / "extract", for
// Performance → Local AI.
const resolveBinary = async (backend = "cpu", onStep) => {
  const key = platformKey();
  const builds = BUILDS[key];
  if (!builds) {
    const supported = Object.keys(BUILDS).join(", ");
    throw new Error(
      `The built-in model feature has no llama.cpp build for this server (${key}). Supported: ${supported}.`
    );
  }
  const assets = builds[backend];
  if (!assets) throw new Error(`No ${backend} build of the built-in model server for ${key}.`);

  const exeName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const destDir = binDir(key, backend);
  const done = (binaryPath) => ({ binaryPath, libDirs: [...new Set([path.dirname(binaryPath), destDir])] });
  // Written once every archive of the build is unpacked. A folder without
  // it is incomplete (e.g. the CUDA build without its runtime archive, which
  // still starts, silently on the CPU), so it is fetched again.
  const marker = path.join(destDir, ".complete");
  const existing = fs.existsSync(marker) ? findExecutable(destDir, exeName) : null;
  if (existing) return done(existing);

  // A folder without the executable is a cut-off earlier attempt: start clean.
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (const asset of assets) {
    const assetName = asset.replace("{TAG}", LLAMA_CPP_TAG);
    const archivePath = path.join(BIN_ROOT, assetName);
    if (!fs.existsSync(archivePath)) {
      await downloadFile(RELEASE_URL(assetName), archivePath, (p) => onStep?.({ step: "download", ...p }));
    }
    onStep?.({ step: "extract" });
    if (assetName.endsWith(".tar.gz")) await extractTarGz(archivePath, destDir);
    else await extractZip(archivePath, destDir);
    try { fs.unlinkSync(archivePath); } catch { /* best effort cleanup */ }
  }

  const binaryPath = findExecutable(destDir, exeName);
  if (!binaryPath) {
    let listed = [];
    try { listed = fs.readdirSync(destDir); } catch { /* none */ }
    const blocked = process.platform === "win32" && listed.some((n) => /^llama-server-impl\.dll$/i.test(n));
    fs.rmSync(destDir, { recursive: true, force: true });
    throw new Error(
      `Downloaded the built-in model server for ${key} (${backend}) but could not find ${exeName} inside it` +
      (blocked ? ": the rest of the archive is there, so antivirus most likely removed it. Allow it in Windows Security (Protection history) and try again."
        : `. Extracted: ${listed.length ? listed.slice(0, 8).join(", ") : "nothing"}.`)
    );
  }
  if (process.platform !== "win32") {
    try { fs.chmodSync(binaryPath, 0o755); } catch { /* archive usually already sets this */ }
  }
  fs.writeFileSync(marker, `${LLAMA_CPP_TAG} ${assets.join(" ")}\n`);

  return done(binaryPath);
};

module.exports = { resolveBinary, detectGpu, LLAMA_CPP_TAG, BIN_ROOT };
