// Walks the real express stack and asserts that no route reaches a controller
// without passing an auth guard first.
//
// The failure this exists to catch is a route added below a `router.use(protect)`
// but on a router that was mounted without one, or a `.route("/:id")` chain
// where the guard was left off a single verb.

process.env.NODE_ENV = "test";
process.env.SERVE_STATIC = "false";
process.env.JWT_SECRET = require("crypto").randomBytes(48).toString("hex");
process.env.ENCRYPTION_KEY = require("crypto").randomBytes(32).toString("hex");

const buildApp = require("../app");

// Routes that are meant to be reachable without a session.
const PUBLIC = [
  "GET /api/health",
  // the sales demo's account list (behind the demo's site-wide password)
  "GET /api/demo/info",
  "GET /api/auth/setup-state",
  "POST /api/auth/setup",
  "POST /api/auth/login",
  // token-bearing: the invite token is the credential
  "GET /api/invites/verify",
  "POST /api/invites/accept",

  // a student has no session yet at any of these — that is the point
  "POST /api/app/auth/register",
  "POST /api/app/auth/verify-otp",
  "POST /api/app/auth/login",
  "POST /api/app/auth/complete-profile",
  "POST /api/app/auth/forgot-password",
  "POST /api/app/auth/verify-reset-otp",
  "POST /api/app/auth/reset-password",
  "POST /api/app/auth/login-otp/request",
  "POST /api/app/auth/login-otp/verify",
  // branding shown before login (logo, theme) has to be readable before login
  "GET /api/app/settings/",
  // the landing page itself is shown to a visitor with no session at all —
  // see publicController.js's getPublicLandingPage. Only ever returns
  // sections an admin has switched on; the editable, full config (including
  // disabled sections) lives behind /api/landing-page instead, which is
  // properly auth-gated below.
  "GET /api/app/landing-page/",
  // the landing page's interest form: a visitor with no account, rate
  // limited (middleware/rateLimit.js leadLimiter) with a bot trap field
  "POST /api/app/leads",
  // what a friend's referral code gives, for the landing page banner; says
  // nothing about whose code it is
  "GET /api/app/referral/:code",
  // an email's unsubscribe link: the HMAC signature in the link is the
  // credential (utils/campaigns.js checkUnsubscribe)
  "GET /api/app/unsubscribe",
  // verified by the gateway's own request signature, not a session — see
  // adapters/payment's verifyWebhook and the raw-body mount in app.js. One
  // mount serves every provider, so this stays a single entry however many
  // gateways get added.
  "POST /api/app/purchases/webhook/:provider",
  // bKash confirms by browser redirect, not a signed POST. Public for the
  // same reason: it arrives cross-site from the gateway's domain. The query
  // string is not trusted — see gatewayCallback.
  "GET /api/app/purchases/callback/:provider",
  // Zoom calls this directly with no session — trust comes from
  // verifyWebhookSignature() in adapters/liveClass, checked against
  // ZOOM_WEBHOOK_SECRET_TOKEN, same reasoning as the payment webhook above.
  "POST /api/webhooks/zoom",
  // Video and voice files by expiring link: the link itself is the access,
  // encrypted and checked for its expiry (utils/streamLink.js). A <video>
  // or <audio> tag in the mobile app can't send the session cookie.
  "GET /api/stream/:token",
  // A picture in lecture notes: the link is written into the notes, so it
  // can't carry a session or expire. Only lectures/<content hash> images.
  "GET /api/stream/file/:folder/:name",
  // A certificate's public check: the 60-bit serial is the credential, and
  // showing the certificate to whoever holds it is the point.
  "GET /api/app/verify/:serial",
  // A progress report's link in an SMS or email to a guardian: the 96-bit
  // token is the credential, it expires, and the guardian has no account.
  "GET /api/app/progress/:token",
  // A public webinar's page and its way in: the link is shared on social
  // media for anyone to join as a guest. Joining is rate limited (a bot
  // trap field too); the room, questions and polls need the guest pass
  // these hand out (controllers/app/webinarController.js).
  "GET /api/app/webinars/:slug",
  "POST /api/app/webinars/:slug/join",
  "POST /api/app/webinars/:slug/verify",
  // Google's ID token is the credential, checked with Google.
  "POST /api/app/webinars/:slug/google",
];

// Guards are identified by a tag on the function, not by name: every handler
// that passes through express-async-handler is renamed to 'asyncUtilWrap'.

const collect = (stack, prefix = "") => {
  const routes = [];

  for (const layer of stack) {
    if (layer.route) {
      // A .route() chain puts every verb's handlers in one stack, each entry
      // tagged with its own method. Filtering by method matters: without it a
      // role guard on .post() looks like it also covers .get().
      for (const method of Object.keys(layer.route.methods)) {
        const handlers = layer.route.stack
          .filter((s) => !s.method || s.method === method)
          .map((s) => s.handle);

        routes.push({
          method: method.toUpperCase(),
          path: prefix + layer.route.path,
          handlers,
        });
      }
      continue;
    }

    if (layer.name === "router" && layer.handle.stack) {
      const mount = layer.regexp.source
        .replace("^\\/", "/")
        .replace("\\/?(?=\\/|$)", "")
        .replace(/\\\//g, "/")
        .replace(/\$$/, "");

      const childPrefix = prefix + (mount === "/" ? "" : mount);

      // router.use() only covers routes registered after it. Walking the stack
      // in order and accumulating as we go is the difference between reporting
      // what express actually does and reporting what the file looks like.
      //
      // Getting this wrong is worse than having no audit: a route declared
      // above a router.use(protect) would be reported as guarded when it is
      // wide open.
      let inherited = [];

      for (const inner of layer.handle.stack) {
        if (inner.route) {
          const sub = collect([inner], childPrefix);
          const carried = [...inherited];
          routes.push(...sub.map((r) => ({ ...r, handlers: [...carried, ...r.handlers] })));
          continue;
        }

        if (inner.name === "router" && inner.handle.stack) {
          const sub = collect([inner], childPrefix);
          const carried = [...inherited];
          routes.push(...sub.map((r) => ({ ...r, handlers: [...carried, ...r.handlers] })));
          continue;
        }

        inherited.push(inner.handle);
      }
    }
  }

  return routes;
};

const app = buildApp();
const routes = collect(app._router.stack).filter((r) => r.path.startsWith("/api"));

let failures = 0;

console.log("route                                      guard");
console.log("-".repeat(70));

for (const route of routes.sort((a, b) => a.path.localeCompare(b.path))) {
  const key = `${route.method} ${route.path}`;
  const authed = route.handlers.some((h) => h && h.isAuthGuard);
  const isPublic = PUBLIC.includes(key);

  // Role guards compose: a router-level allow() and a route-level allow() both
  // run, so the effective permission is their intersection.
  const roleSets = route.handlers.filter((h) => h && h.isRoleGuard).map((h) => h.roles);
  const effective = roleSets.length
    ? roleSets.reduce((a, b) => a.filter((r) => b.includes(r)))
    : null;

  let verdict;
  if (authed) {
    verdict = effective ? `auth + role:${effective.join("/")}` : "auth";
  } else if (isPublic) {
    verdict = "public (declared)";
  } else {
    verdict = "UNGUARDED";
    failures += 1;
  }

  console.log(`${key.padEnd(42)} ${verdict}`);
}

console.log("-".repeat(70));
console.log(`${routes.length} routes checked, ${failures} unguarded`);

if (failures > 0) {
  console.error("\nFAIL: routes above are reachable without authentication.");
  process.exit(1);
}

console.log("PASS");
