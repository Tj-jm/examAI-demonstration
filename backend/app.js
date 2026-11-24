const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const compression = require("compression");

const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const { apiLimiter, adminApiLimiter } = require("./middleware/rateLimit");

// The express app is built here and started in server.js, so tests can mount
// it without opening a port or a database connection.
const buildApp = () => {
  const app = express();

  // How many proxies stand in front of the app, so req.ip (rate limits,
  // logs) is the visitor's address: 1 for Caddy alone, or a Caddy/Nginx load
  // balancer straight to the app; 2 for a load balancer in front of Caddy.
  const hops = Number.parseInt(process.env.TRUST_PROXY, 10);
  app.set("trust proxy", Number.isInteger(hops) && hops >= 0 ? hops : 1);
  // Defence in depth alongside representativeGate.js's own lowercasing: Express
  // matches routes case-insensitively by default, which is the wrong default
  // for a security gate keyed on path prefixes.
  app.set("case sensitive routing", true);

  // gzip for json and the spa bundles. Skipped below its 1kb threshold, so
  // small api answers are not slowed down.
  app.use(compression());

  // The sales demo: one password in front of everything, never indexed
  // (demo/index.js).
  const demo = require("./demo");
  if (demo.isDemo()) app.use(demo.gate);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      // helmet's own default here is "no-referrer" — strips the referrer on
      // every request this origin makes, including the browser's request
      // for a YouTube embed's iframe. YouTube's embed player treats that
      // missing referrer as a configuration problem and refuses to play
      // (its "Error 153"). This never showed up on localhost because the
      // dev server (Vite) sends no Referrer-Policy header at all, so the
      // browser's own default (which YouTube accepts) was live during any
      // local testing — deploying is what put helmet's header in front of
      // it for the first time. "strict-origin-when-cross-origin" is the
      // browser's own default, so this is really "match what already
      // worked," not a weakening of anything.
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // Google sign-in (public webinars) opens Google's window and talks to
      // it; plain "same-origin" would cut that link.
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    })
  );

  // One mount serves every gateway, with the provider in the path. Adding a
  // driver to adapters/payment therefore needs no change here.
  //
  // The raw parser must stay ahead of express.json() below or signatures in
  // adapters/payment will never match, since by then the body would have
  // been parsed and re-serialised differently than what was actually signed.
  // `type: "*/*"` rather than application/json because not every gateway
  // posts JSON — SSLCommerz and several local providers post form-encoded
  // bodies, and those still have to arrive as untouched bytes.
  app.post(
    "/api/app/purchases/webhook/:provider",
    express.raw({ type: "*/*" }),
    require("./controllers/app/purchaseController").gatewayWebhook
  );

  // Redirect confirmation for gateways with no webhook at all (bKash).
  // Mounted here rather than on the student router because it arrives as a
  // top-level navigation from the gateway's own domain, where a SameSite
  // session cookie is not guaranteed to be sent — so it cannot sit behind
  // studentProtect. It does not need to: nothing in the request is trusted,
  // and the server-to-server confirmation call is what grants access.
  app.get(
    "/api/app/purchases/callback/:provider",
    require("./controllers/app/purchaseController").gatewayCallback
  );

  // Zoom webhook — status sync (meeting started/ended from Zoom's own
  // side, not just this platform's Start/End buttons) and best-effort
  // attendance (see liveClassModel.js's attendance field for why it's
  // best-effort, not authoritative). Same raw-body-ahead-of-json.() reason
  // as the payment webhook above — Zoom's signature covers the exact
  // bytes sent, not a re-serialized copy.
  app.post(
    "/api/webhooks/zoom",
    express.raw({ type: "*/*" }),
    require("./controllers/webhooks/zoomWebhookController").zoomWebhook
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(require("./middleware/stripOperators").stripOperators);
  app.use(cookieParser());
  // AI charges made while serving a request are given back if it fails.
  app.use(require("./ai/chargeScope").aiChargeScope);

  // Runs ahead of every admin route mount below — see the file itself for
  // why this has to be one global gate rather than a per-route exclusion.
  app.use(require("./middleware/representativeGate").representativeGate);

  // With SERVE_STATIC on, both web frontends are same-origin with the api
  // and need no CORS entry of their own — but a Capacitor-wrapped native app
  // (mobile-app/) is cross-origin from this backend no matter what
  // SERVE_STATIC is, since its webview always runs on its own origin
  // (https://localhost on Android, capacitor://localhost on iOS by
  // default). CLIENT_URL_MOBILE is that origin allowlist, so it's included
  // unconditionally rather than gated behind the split-origin check below.
  const origins = [
    process.env.SERVE_STATIC !== "true" && process.env.CLIENT_URL_ADMIN,
    process.env.SERVE_STATIC !== "true" && process.env.CLIENT_URL_STUDENT,
    ...(process.env.CLIENT_URL_MOBILE || "").split(",").map((o) => o.trim()),
  ].filter(Boolean);

  if (origins.length > 0) {
    app.use(cors({ origin: origins, credentials: true }));
  }

  app.use("/api", apiLimiter, adminApiLimiter);

  app.get("/api/health", (req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  // ---------- admin api ----------
  app.use("/api/auth", require("./routes/admin/authRoutes"));
  app.use("/api/users", require("./routes/admin/userRoutes"));
  app.use("/api/invites", require("./routes/admin/inviteRoutes"));
  app.use("/api/taxonomy", require("./routes/admin/taxonomyRoutes"));
  app.use("/api/questions", require("./routes/admin/questionRoutes"));
  app.use("/api/programs", require("./routes/admin/programRoutes"));
  app.use("/api/batches", require("./routes/admin/batchRoutes"));
  app.use("/api/assignments", require("./routes/admin/assignmentRoutes"));
  app.use("/api/lectures", require("./routes/admin/lectureRoutes"));
  app.use("/api/notices", require("./routes/admin/noticeRoutes"));
  app.use("/api/earnings", require("./routes/admin/earningsRoutes"));
  app.use("/api/payslips", require("./routes/admin/payslipRoutes"));
  app.use("/api/campaigns", require("./routes/admin/campaignRoutes"));
  app.use("/api/posters", require("./routes/admin/posterRoutes"));
  app.use("/api/leads", require("./routes/admin/leadRoutes"));
  app.use("/api/visitors", require("./routes/admin/visitorRoutes"));
  app.use("/api/coupons", require("./routes/admin/couponRoutes"));
  app.use("/api/representatives", require("./routes/admin/representativeRoutes"));
  app.use("/api/exams", require("./routes/admin/examRoutes"));
  app.use("/api/exam-sets", require("./routes/admin/examSetRoutes"));
  app.use("/api/students", require("./routes/admin/studentRoutes"));
  app.use("/api/purchases", require("./routes/admin/purchaseRoutes"));
  app.use("/api/ai", require("./routes/admin/aiConfigRoutes"));
  app.use("/api/ai", require("./routes/admin/aiRoutes"));
  app.use("/api/ai-write", require("./routes/admin/aiWritingRoutes"));
  app.use("/api/ai-images", require("./routes/admin/aiImageRoutes"));
  app.use("/api/media", require("./routes/admin/mediaRoutes"));
  app.use("/api/stream", require("./routes/streamRoutes"));
  app.use("/api/settings", require("./routes/admin/settingsRoutes"));
  app.use("/api/interviews", require("./routes/admin/interviewSetRoutes"));
  app.use("/api/grading/assignments", require("./routes/admin/courseworkRoutes"));
  if (demo.isDemo()) app.use("/api/demo", demo.router());
  app.use("/api/grading/gradebook", require("./routes/admin/gradebookRoutes"));
  app.use("/api/grading/offline-exams", require("./routes/admin/offlineExamRoutes"));
  app.use("/api/grading/certificates", require("./routes/admin/certificateRoutes"));
  app.use("/api/grading/progress-reports", require("./routes/admin/progressReportRoutes"));
  app.use("/api/grading", require("./routes/admin/gradingRoutes"));
  app.use("/api/submissions", require("./routes/admin/submissionRoutes"));
  app.use("/api/doubts", require("./routes/admin/doubtRoutes"));
  app.use("/api/short-links", require("./routes/admin/shortLinkRoutes"));
  app.use("/api/landing-page", require("./routes/admin/landingPageRoutes"));
  app.use("/api/updates", require("./routes/admin/updateRoutes"));
  app.use("/api/live-classes", require("./routes/admin/liveClassRoutes"));
  app.use("/api/support", require("./routes/admin/supportRoutes"));
  app.use("/api/conduct", require("./routes/admin/conductRoutes"));
  app.use("/api/deletions", require("./routes/admin/deletionRoutes"));
  app.use("/api/agents", require("./routes/admin/agentRoutes"));
  app.use("/api/badges", require("./routes/admin/badgeRoutes"));
  app.use("/api/performance", require("./routes/admin/performanceRoutes"));
  app.use("/api/video-lessons", require("./routes/admin/videoLessonRoutes"));
  app.use("/api/slides", require("./routes/admin/slideRoutes"));

  // ---------- student api ----------
  app.use("/api/app/auth", require("./routes/app/authRoutes"));
  app.use("/api/app/settings", require("./routes/app/publicRoutes"));
  app.use("/api/app/landing-page", require("./routes/app/publicLandingRoutes"));
  // Public webinars: anyone with the link joins as a guest.
  app.use("/api/app/webinars", require("./routes/app/webinarRoutes"));
  // A course's public page (Settings → SEO → Course pages).
  app.get("/api/app/courses/:slug", require("./controllers/app/publicController").getCoursePage);
  // The landing page's interest form (utils/leads.js): public, rate limited.
  // What a friend's referral code gives (the landing page banner): public.
  app.get("/api/app/referral/:code", require("./controllers/app/referralController").checkReferralCode);
  app.post("/api/app/leads", require("./middleware/rateLimit").leadLimiter, require("./controllers/app/leadController").createLead);
  // A page the student app opened (utils/visitors.js): public, never fails the page.
  // Not called "track": ad blockers drop such requests. The old path stays
  // for apps still running the previous build.
  app.post(["/api/app/pv", "/api/app/track"], (req, res) => {
    res.status(204).end();
    require("./utils/visitors").record(req).catch(() => {});
  });
  app.use("/api/app/purchases", require("./routes/app/purchaseRoutes"));
  // An email's unsubscribe link (utils/campaigns.js): signed, no login.
  app.get("/api/app/unsubscribe", require("./controllers/app/campaignController").unsubscribe);
  app.use("/api/app/batches", require("./routes/app/batchRoutes"));
  app.use("/api/app/notices", require("./routes/app/noticeRoutes"));
  app.use("/api/app/notifications", require("./routes/app/notificationRoutes"));
  app.use("/api/app/support", require("./routes/app/supportRoutes"));
  app.use("/api/app/account", require("./routes/app/accountRoutes"));
  app.use("/api/app/submissions", require("./routes/app/submissionRoutes"));
  app.use("/api/app/video-lessons", require("./routes/app/videoLessonRoutes"));
  app.use("/api/app", require("./routes/app/certificateRoutes"));
  app.use("/api/app/progress", require("./routes/app/progressReportRoutes").report);
  app.use("/api/app/account/guardian", require("./routes/app/progressReportRoutes").guardian);

  // Short referral links (see shortLinkModel.js) — a bare top-level prefix
  // rather than under /api, so the links this actually produces stay as
  // short as possible. Declared before the media and SPA catch-alls below,
  // same reasoning as those: after either, "/r/xyz" would resolve to a
  // 404 file lookup or index.html instead of ever reaching the redirect.
  app.use("/r", require("./routes/shortLinkRedirect"));

  // sitemap.xml / robots.txt — bare top-level, same reasoning as /r above:
  // must be declared before the SPA catch-all or these resolve to
  // index.html instead of an actual sitemap/robots file.
  app.use(require("./routes/seoRoutes"));

  // Uploaded images and pdfs when the local driver is in use. Declared before
  // the spa catch-all so a file request is not answered with index.html.
  if ((process.env.STORAGE_PROVIDER || "local") === "local") {
    app.use(
      "/media",
      express.static(path.resolve(process.env.STORAGE_LOCAL_PATH || "./uploads"), {
        // Keys are content hashes, so a given url can never point at different
        // bytes and is safe to cache forever.
        maxAge: "1y",
        immutable: true,
        index: false,
        dotfiles: "deny",
        // An uploaded file can never run as a page on our domain: no script,
        // no frames. (PDFs are left to the browser's own viewer.)
        setHeaders: (res, filePath) => {
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (!filePath.endsWith(".pdf")) res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
        },
      })
    );
  }

  // ---------- static ----------
  // Order matters. The catch-alls must come after every api route or an api
  // call returns index.html instead of json.
  if (process.env.SERVE_STATIC === "true") {
    const adminDist = path.join(__dirname, "../admin-panel/dist");
    const studentDist = path.join(__dirname, "../student-app/dist");

    // Vite puts a content hash in every file name under assets/, so those
    // can be cached forever. index.html is not hashed and must be checked
    // on every load, or a deploy is not picked up.
    const staticOptions = {
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    };
    const sendIndex = (dist) => (req, res) =>
      res.sendFile(path.join(dist, "index.html"), { headers: { "Cache-Control": "no-cache" } });

    app.use("/admin", express.static(adminDist, staticOptions));
    // index: false — "/" must reach the meta-tag route below, not get the
    // bare index.html from here.
    app.use(express.static(studentDist, { ...staticOptions, index: false }));

    // SSLCommerz sends the student back with a POST (form fields in the
    // body); turn it into a normal page load of the same address.
    app.post(["/purchases/success", "/purchases/cancelled"], (req, res) => res.redirect(303, req.originalUrl));

    app.get("/admin/*", sendIndex(adminDist));
    // The home page and course pages carry their own title, description and
    // preview tags in the HTML, for link previews and crawlers that don't
    // run the app (utils/pageMeta.js).
    const pageMeta = require("./utils/pageMeta");
    app.get(["/", "/courses/:slug", "/w/:slug"], (req, res, next) => pageMeta.send(req, res, path.join(studentDist, "index.html")).catch(next));
    app.get("*", sendIndex(studentDist));
  } else {
    app.get("/", (req, res) => res.send("API is running"));
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = buildApp;
