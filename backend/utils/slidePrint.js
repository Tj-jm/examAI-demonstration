const fs = require("fs");
const path = require("path");
const { chromiumPath, serve, ORIGIN, ADMIN_DIST } = require("./printServer");

// A slide deck as a PDF: the admin panel's slide-print.html draws every
// slide (SlideView, the same as the editor and present mode) at 1280 x 720,
// one page each, in headless Chromium. Pictures come through printServer.js.s
// request handler (the panel's files and stored pictures only).

// null when the server can make slide PDFs, else the reason it can't.
const canPrint = () => {
  if (!chromiumPath()) return `This server can't make PDFs: no Chrome or Chromium found${process.env.CHROMIUM_PATH ? ` at CHROMIUM_PATH (${process.env.CHROMIUM_PATH})` : ""}. Set CHROMIUM_PATH to its full path and restart the backend.`;
  if (!fs.existsSync(path.join(ADMIN_DIST, "slide-print.html"))) return "This server can't make PDFs yet: the admin panel isn't built. Run npx vite build in admin-panel, then try again.";
  return null;
};

const printSlides = async (deck) => {
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setRequestInterception(true);
    page.on("request", (req) => { serve(req).catch(() => req.abort().catch(() => {})); });
    page.setDefaultTimeout(120000);
    await page.goto(`${ORIGIN}/admin/slide-print.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => typeof window.__renderSlides === "function");
    await page.evaluate((d) => window.__renderSlides(d), deck);
    return Buffer.from(await page.pdf({ width: "1280px", height: "720px", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
  } finally {
    await browser.close().catch(() => {});
  }
};

module.exports = { canPrint, printSlides };
