// Headless Chromium helpers shared by slide printing (utils/slidePrint.js)
// and lesson video rendering (utils/lessonRender.js): where Chromium is,
// and a request handler that lets the page load only our own files (the
// admin build) and stored pictures.
//
// Needs Chromium (CHROMIUM_PATH, default /usr/bin/chromium; the Docker
// image installs it) and the Noto fonts for Bangla.
const fs = require("fs");
const path = require("path");
const storage = require("../adapters/storage");

const ORIGIN = "http://print.local";
const ADMIN_DIST = path.join(__dirname, "../../admin-panel/dist");

const chromiumPath = () => {
  // CHROMIUM_PATH first (quotes around it in .env are fine), then the usual
  // places on Linux, Windows and macOS.
  const own = (process.env.CHROMIUM_PATH || "").trim().replace(/^["']|["']$/g, "");
  const list = [
    own, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium/chrome-linux/chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return list.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };
const STREAM = /^\/api\/stream\/file\/(lectures|questions)\/([a-f0-9]{32}\.(?:png|jpe?g|webp|gif))$/;

// Only our files: the admin build, stored pictures. Nothing else loads.
const serve = async (req) => {
  let url;
  try { url = new URL(req.url()); } catch { return req.abort(); }
  if (url.protocol === "data:") return req.continue();
  if (url.origin !== ORIGIN) return req.abort();
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith("/admin/")) {
      const file = path.normalize(path.join(ADMIN_DIST, p.slice("/admin/".length)));
      if (!file.startsWith(ADMIN_DIST)) return req.abort();
      return req.respond({ status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body: await fs.promises.readFile(file) });
    }
    if (p.startsWith("/__media/")) {
      const [, , driver, ...rest] = p.split("/");
      const body = await storage.get(rest.join("/"), driver || undefined);
      return req.respond({ status: 200, contentType: TYPES[path.extname(p).toLowerCase()] || "image/png", body });
    }
    const m = STREAM.exec(p);
    if (m) return req.respond({ status: 200, contentType: TYPES[path.extname(m[2]).toLowerCase()] || "image/png", body: await storage.get(`${m[1]}/${m[2]}`) });
  } catch {
    return req.respond({ status: 404, body: "" });
  }
  return req.abort();
};

module.exports = { chromiumPath, serve, ORIGIN, ADMIN_DIST };
