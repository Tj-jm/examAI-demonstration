const path = require("path");
const fs = require("fs/promises");
const AppSettings = require("../models/appSettingsModel");

// The student app is one HTML file whose title and preview tags are filled
// in by the app after it loads. Link previews (WhatsApp, Facebook, X) and
// some crawlers never run it, so for the home page and course pages the
// server writes the right tags into the HTML before sending it.

let cached = { file: null, mtimeMs: 0, html: "" };
const template = async (file) => {
  const stat = await fs.stat(file);
  if (cached.file !== file || cached.mtimeMs !== stat.mtimeMs) {
    cached = { file, mtimeMs: stat.mtimeMs, html: await fs.readFile(file, "utf8") };
  }
  return cached.html;
};

const esc = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Markdown to one plain line, for a description.
const plain = (md, n = 160) => String(md || "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`~|$\\-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, n);

// The student site's public address, for canonical links, share links and
// the sitemap. The admin's canonical URL wins. When this server serves the
// student app itself (SERVE_STATIC), the address it was reached at is the
// site, so CLIENT_URL_STUDENT is left out: it is often still the localhost
// default, and a canonical link to localhost makes Google drop the page.
const isLocal = (url) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url || "");
const siteBase = (req, settings) => {
  const canonical = settings?.seo?.canonicalUrl;
  if (canonical) return canonical.replace(/\/$/, "");
  const proto = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = req.get("x-forwarded-host") || req.get("host");
  const own = host ? `${proto}://${host}` : "";
  const env = process.env.CLIENT_URL_STUDENT || "";
  if (process.env.SERVE_STATIC === "true" || !env || (isLocal(env) && !isLocal(own))) return own.replace(/\/$/, "");
  return env.replace(/\/$/, "");
};

const absolute = (base, url) => (!url ? "" : /^https?:\/\//i.test(url) ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`);

const tagsFor = ({ title, description, keywords, image, url, type = "website", jsonLd, noIndex }) => [
  `<title>${esc(title)}</title>`,
  description && `<meta name="description" content="${esc(description)}">`,
  keywords?.length && `<meta name="keywords" content="${esc(keywords.join(", "))}">`,
  url && `<link rel="canonical" href="${esc(url)}">`,
  noIndex && `<meta name="robots" content="noindex, nofollow">`,
  `<meta property="og:type" content="${type}">`,
  `<meta property="og:title" content="${esc(title)}">`,
  description && `<meta property="og:description" content="${esc(description)}">`,
  image && `<meta property="og:image" content="${esc(image)}">`,
  url && `<meta property="og:url" content="${esc(url)}">`,
  `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
  `<meta name="twitter:title" content="${esc(title)}">`,
  description && `<meta name="twitter:description" content="${esc(description)}">`,
  image && `<meta name="twitter:image" content="${esc(image)}">`,
  ...(jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`) : []),
].filter(Boolean).join("\n    ");

const metaFor = async (req) => {
  const settings = await AppSettings.get();
  const seo = settings.seo || {};
  const base = siteBase(req, settings);
  const siteName = settings.siteName || "ExamAI";
  const logo = settings.logo?.url || settings.logo || "";

  // A public webinar link (/w/:slug), so a pasted link shows its title,
  // time and blurb instead of the site's one line.
  const webinarPath = /^\/w\/([^/]+)\/?$/.exec(req.path || "");
  if (webinarPath) {
    const meta = await webinarMeta({ slug: decodeURIComponent(webinarPath[1]).toLowerCase().slice(0, 80), settings, seo, base, siteName, logo }).catch(() => null);
    if (meta) return meta;
  }

  if (req.params?.slug && !webinarPath) {
    const { buildCoursePage } = require("../controllers/app/publicController");
    const page = await buildCoursePage(req.params.slug).catch(() => null);
    if (page) {
      const c = page.course;
      // The course's own tags (Settings → SEO → Course pages) win; empty
      // ones are made from the course.
      const own = page.seo || {};
      const description = own.metaDescription || plain(c.description || c.program?.description) || seo.metaDescription || "";
      const image = absolute(base, own.ogImage || c.program?.image?.url || seo.ogImage || (typeof logo === "string" ? logo : ""));
      const url = `${base}/courses/${encodeURIComponent(c.slug)}`;
      const prices = (c.plans || []).map((p) => p.price).filter((n) => Number.isFinite(n));
      return {
        title: own.metaTitle || `${c.name}${c.program?.title ? ` · ${c.program.title}` : ""} | ${siteName}`,
        description,
        keywords: own.keywords?.length ? own.keywords : seo.keywords,
        image,
        url,
        noIndex: seo.noIndex,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Course",
          name: c.name,
          description: description || c.name,
          provider: { "@type": "EducationalOrganization", name: siteName, sameAs: base },
          ...(image ? { image } : {}),
          ...(prices.length ? { offers: { "@type": "Offer", price: Math.min(...prices), priceCurrency: page.currency, category: c.accessType === "free" ? "Free" : "Paid", url } } : c.accessType === "free" ? { offers: { "@type": "Offer", price: 0, priceCurrency: page.currency, category: "Free", url } } : {}),
        },
      };
    }
  }

  return {
    title: seo.metaTitle || siteName,
    description: seo.metaDescription || "",
    keywords: seo.keywords,
    image: absolute(base, seo.ogImage || (typeof logo === "string" ? logo : "")),
    url: base,
    noIndex: seo.noIndex,
    jsonLd: { "@context": "https://schema.org", "@type": "EducationalOrganization", name: siteName, url: base, ...(seo.metaDescription ? { description: seo.metaDescription } : {}) },
  };
};

// A public webinar: its title, when it runs, and its blurb or description.
const webinarMeta = async ({ slug, settings, seo, base, siteName, logo }) => {
  const LiveClass = require("../models/liveClassModel");
  const lc = await LiveClass.findOne({ "public.slug": slug, "public.on": true, provider: "livekit" })
    .select("title description scheduledAt durationMinutes status public").lean();
  if (!lc) return null;
  const zone = settings.progressReports?.timezone || process.env.TZ || (settings.defaultCurrency === "BDT" ? "Asia/Dhaka" : "UTC");
  let when = "";
  try {
    when = new Date(lc.scheduledAt).toLocaleString("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    when = new Date(lc.scheduledAt).toUTCString();
  }
  const state = lc.status === "live" ? "Live now" : lc.status === "ended" ? "Replay" : lc.status === "cancelled" ? "Cancelled" : when;
  const about = plain(lc.public?.blurb || lc.description, 200);
  const url = `${base}/w/${encodeURIComponent(lc.public.slug)}`;
  const image = absolute(base, seo.ogImage || (typeof logo === "string" ? logo : ""));
  return {
    title: `${lc.title} · Free webinar | ${siteName}`,
    description: [state, lc.durationMinutes ? `${lc.durationMinutes} min` : "", about].filter(Boolean).join(" · ") || `A free webinar from ${siteName}.`,
    image,
    url,
    type: "website",
    noIndex: seo.noIndex,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Event",
      name: lc.title,
      startDate: new Date(lc.scheduledAt).toISOString(),
      ...(lc.durationMinutes ? { endDate: new Date(new Date(lc.scheduledAt).getTime() + lc.durationMinutes * 60000).toISOString() } : {}),
      eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
      eventStatus: lc.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      location: { "@type": "VirtualLocation", url },
      organizer: { "@type": "Organization", name: siteName, url: base },
      isAccessibleForFree: true,
      ...(about ? { description: about } : {}),
      ...(image ? { image } : {}),
    },
    body: { h1: lc.title, text: [state, about].filter(Boolean).join(". ") },
  };
};

const noscriptFor = (m) => {
  if (!m.body && !m.links) return "";
  const parts = [];
  if (m.body) parts.push(`<h1>${esc(m.body.h1)}</h1><p>${esc(m.body.text)}</p>`);
  if (m.links?.length) parts.push(`<ul>${m.links.map((l) => `<li><a href="${esc(l.href)}">${esc(l.text)}</a></li>`).join("")}</ul>`);
  return `<noscript>${parts.join("")}</noscript>`;
};

const send = async (req, res, file) => {
  let html = await template(file);
  try {
    const meta = await metaFor(req);
    const tags = tagsFor(meta);
    html = html.replace(/<title>[\s\S]*?<\/title>/i, "").replace(/<meta\s+name="description"[^>]*>/i, "").replace("</head>", `    ${tags}\n  </head>`);
    const extra = noscriptFor(meta);
    if (extra) html = html.replace(/<body([^>]*)>/i, `<body$1>\n    ${extra}`);
  } catch {
    // The plain page still works; the app fills its own tags.
  }
  res.set("Cache-Control", "no-cache").type("html").send(html);
};

module.exports = { send, metaFor, plain, siteBase };
