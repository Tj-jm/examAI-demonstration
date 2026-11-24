const express = require("express");
const router = express.Router();
const AppSettings = require("../models/appSettingsModel");
const { siteBase } = require("../utils/pageMeta");

// Bare, top-level routes (not under /api) — a crawler requests these at the
// site root by convention, it never asks for /api/sitemap.xml. Registered
// in app.js ahead of the SPA catch-all, and outside the SERVE_STATIC
// conditional, so this also works in split-origin dev where the backend
// runs standalone on its own port (same reasoning as the /r short-link
// route sitting where it does).
//
// The public pages only: the home page, and each course's page when course
// pages are on. Everything else (batches, exams, lectures) sits behind
// student auth, and listing a login-walled URL in a sitemap only wastes
// crawl budget on a page that will 30x-redirect it.
router.get("/sitemap.xml", async (req, res) => {
  const settings = await AppSettings.get();
  const base = siteBase(req, settings);
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Course pages, when they're on (Settings → SEO → Course pages).
  let courses = [];
  if (settings.seo?.coursePages) {
    const Batch = require("../models/batchModel");
    const { ensureSlugs } = require("../utils/courseSlug");
    const batches = await Batch.find({ isActive: true }).populate({ path: "program", select: "isActive" }).select("name slug updatedAt program");
    courses = await ensureSlugs(batches.filter((b) => b.program?.isActive !== false));
  }

  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${base || "/"}</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
${courses.map((b) => `  <url>
    <loc>${esc(`${base}/courses/${encodeURIComponent(b.slug)}`)}</loc>
    <lastmod>${new Date(b.updatedAt || Date.now()).toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join("\n")}
</urlset>`
  );
});

router.get("/robots.txt", async (req, res) => {
  const settings = await AppSettings.get();
  const base = siteBase(req, settings);

  // noIndex blocks everything — meant for an install still being set up or
  // a private/invite-only institution. Otherwise: allow the one public
  // page, disallow every authenticated area by prefix (nothing behind a
  // login wall should be crawled even if a stray link to it leaks out).
  const body = settings.seo?.noIndex
    ? "User-agent: *\nDisallow: /\n"
    : [
        "User-agent: *",
        "Disallow: /dashboard",
        "Disallow: /batches",
        "Disallow: /purchases",
        "Disallow: /notices",
        "Disallow: /leaderboard",
        "Disallow: /study-plan",
        "Allow: /courses/",
        "Allow: /",
        "",
        `Sitemap: ${base}/sitemap.xml`,
        "",
      ].join("\n");

  res.type("text/plain").send(body);
});

module.exports = router;
