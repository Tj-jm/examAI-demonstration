const jwt = require("jsonwebtoken");
const { COOKIE_NAMES } = require("../utils/generateToken");

// Any role in this map is walled off to exactly its own allowed prefixes,
// full stop — nothing else on the admin panel is reachable, regardless of
// what any individual route's own protect()/allow() would otherwise permit.
// This exists because most admin routes were written under a much looser
// assumption: bare protect() (no allow(...)) means "any authenticated staff
// member". Retrofitting an exclusion onto every one of those route files —
// lectures, questions, batches, students, settings, grading, submissions,
// notices, earnings, users, and whatever gets added next — would mean
// auditing a couple dozen files today and remembering to update every one
// of them again the next time a route is added.
//
// This is the opposite shape: one file, mounted once, ahead of every route.
// A restricted role is allowed to reach exactly the prefixes listed for it;
// everything else is refused here, before it ever reaches an individual
// route's own checks. A new admin route added later with no restricted
// role in mind is automatically covered — refused by default — rather than
// automatically a hole.
//
// This does not replace protect() on the matched routes. It only narrows:
// it never grants access on its own, and an expired or otherwise invalid
// token still gets rejected downstream by the real auth check exactly as
// it always did. Reading the role straight from the JWT rather than
// querying the User document is consistent with how this app already
// treats role — see generateToken.js — and is fine here for the same
// reason it's fine there: this is a narrowing pre-filter, not the
// authoritative check.
// Every role below also reaches /api/payslips/ (their own payslips only;
// payslipController checks ownership and admin-only routes check role).
const RESTRICTED_ROLES = {
  representative: {
    // /api/representatives/me is the actual performance data. /api/batches
    // is read-only in practice for this role (same reasoning doubtSolver's
    // own /api/batches access below has) — needed for the referral-link
    // button's batch picker on a universal (not batch-scoped) coupon,
    // where there's no batch list embedded in the coupon's own data to
    // fall back on. /api/short-links is the same button's "copy a short
    // link instead of the long one" action — createShortLink itself
    // independently checks that the coupon being linked is actually this
    // representative's own, so this prefix alone doesn't let them mint a
    // link for someone else's code.
    prefixes: ["/api/auth/", "/api/representatives/me", "/api/batches", "/api/short-links", "/api/payslips/"],
    message: "Representative accounts can only view their own coupon performance.",
  },
  doubtSolver: {
    // Everything a doubt solver needs to resolve doubts is under
    // /api/doubts (queue, own history, payment stats, resolving, reviews)
    // — but the filter dropdowns on that page also need read access to
    // batch names and subject names, which live under their own admin
    // routes. Both are read-only for this role in practice: every write on
    // either (creating/editing a batch, a subject) already has its own
    // independent allow("owner","admin") check on the actual route, so
    // widening the path prefix here only ever grants what that deeper
    // check would refuse anyway if this role tried to write through it.
    //
    // No trailing slash on /api/doubts — a trailing slash would exclude
    // the bare GET /api/doubts queue list itself, since "/api/doubts"
    // does not start with "/api/doubts/". This was the actual bug: the
    // single most important endpoint for this role was the one being
    // rejected.
    prefixes: ["/api/auth/", "/api/doubts", "/api/batches", "/api/taxonomy/subjects", "/api/payslips/", "/api/badges"],
    message: "Doubt solver accounts can only view the doubt panel.",
  },
  teacher: {
    // A teacher gets exactly three things: their own batches, grading for
    // those batches, and the doubt panel — the last one identical in every
    // way to doubtSolver, not a teacher-flavored variant of it. /api/batches
    // covers the batch list/detail, content assignment, and the taxonomy
    // read access those pages need, same reasoning as doubtSolver above:
    // every write this role shouldn't have already has its own independent
    // allow(...) or requireBatchTeacher check on the actual route, so this
    // prefix only ever grants what those deeper checks would allow anyway.
    // getBatches/getGradingQueue additionally scope their own results to
    // this teacher's assigned batches — the gate only controls which paths
    // are reachable at all, not which rows come back on an allowed one.
    // /api/programs: Batches.jsx groups batches by program, so it can't
    // render anything at all without this — read-only in practice, since
    // create/update/delete on a program are their own independent
    // allow("owner","admin") checks. /api/taxonomy/tree: the same page's
    // content-assignment filter (subject/chapter/topic dropdowns) needs
    // this specific path, and only this one — GET is the only verb that
    // route even has, so there's no write surface to worry about widening
    // into. Deliberately NOT a broader /api/taxonomy prefix: chapters and
    // topics have no allow() restriction on their own create/edit/delete
    // routes at all (a leftover from when "teacher" meant a full content
    // author), which would hand this narrowed-down role far more than the
    // three features it's meant to have. Same reasoning is why this list
    // stops short of /api/lectures (create/update/delete/reorder there are
    // equally unrestricted) and /api/users (the full staff directory) —
    // neither is one of this role's three intended features, so neither
    // is a path prefix it needs at all.
    // /api/questions/tags: exact path, not a broader /api/questions prefix —
    // BatchDetail.jsx's Content tab fetches the platform's full tag list
    // unconditionally (for the tag-filter dropdown on the "questions" kind),
    // with no role check of its own, so a teacher opening any batch's
    // Content tab 403'd on this alone before ever reaching the batch itself.
    // GET-only route (see questionRoutes.js), no allow() gate on it either —
    // it returns distinct tag strings, nothing question-content-specific —
    // so opening exactly this path costs nothing: it still doesn't grant a
    // single byte of read or write access to /api/questions itself.
    prefixes: ["/api/auth/", "/api/batches", "/api/programs", "/api/taxonomy/tree", "/api/taxonomy/subjects", "/api/questions/tags", "/api/grading", "/api/doubts", "/api/support", "/api/live-classes", "/api/payslips/", "/api/badges"],
    message: "Teacher accounts can only view their assigned batches, classes, grading, and the doubt panel.",
  },
  grader: {
    // Narrower than teacher on purpose (point 7 of the spec: "totally
    // different and only minimal view") — a grader gets exactly one
    // feature, grading, and nothing else a teacher's three-item shell has.
    // No /api/batches: gradingController's responses already carry batch
    // name inline (getQueue/getForGrading populate "batch", "name"), so
    // there's nothing on the grading panel that needs a separate batch
    // list/detail fetch the way teacher's Batches page does.
    prefixes: ["/api/auth/", "/api/grading", "/api/payslips/", "/api/badges"],
    message: "Grader accounts can only view the grading panel.",
  },
};

const restrictedRoleGate = (req, res, next) => {
  // This gate exists to narrow admin *API* calls — every prefix in
  // RESTRICTED_ROLES above is an "/api/..." path. It must not touch
  // anything else this same origin serves: the student API (/api/app),
  // the /r short-link redirect, uploaded media (/media, served by the
  // local storage driver), or — critically — the static HTML/JS/CSS for
  // BOTH frontends (/admin's own bundle, and the student app's bundle at
  // "/"), all mounted in app.js *after* this middleware.
  //
  // Restricting to "/api/" and then carving out "/api/app" was the
  // original shape, but that only ever exempted the student API, not the
  // static files. Client-side navigation never noticed — React Router
  // doesn't hit the server for a route change — but any actual document
  // request (a hard reload, a fresh tab, a direct link) does, with
  // whatever cookie is on the origin attached. A restricted role's cookie
  // then 403'd its own panel's JS bundle on reload, and — since
  // SERVE_STATIC=true puts admin and student on one origin sharing one
  // cookie jar — the student app's bundle too, for anyone with a
  // restricted-role cookie sitting in that browser. None of that is an
  // access-control question; the bundle is the same public application
  // code for every role. Only "/api/..." (minus /api/app) is this gate's
  // concern at all.
  // Express routing is case-insensitive by default, so a restricted role's
  // cookie could otherwise reach e.g. /API/students and skip every check
  // below — this gate has to match on the same casing the router does.
  const path = req.path.toLowerCase();
  if (!path.startsWith("/api/") || path.startsWith("/api/app")) return next();

  const token = req.cookies?.[COOKIE_NAMES.user];
  if (!token) return next();

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next();
  }

  const restriction = RESTRICTED_ROLES[decoded.role];
  if (!restriction) return next();

  const allowed = restriction.prefixes.some((prefix) => path.startsWith(prefix.toLowerCase()));
  if (!allowed) {
    res.status(403);
    throw new Error(restriction.message);
  }
  // Some prefixes are read-only for the role.
  if (req.method !== "GET" && (restriction.readOnly || []).some((prefix) => path.startsWith(prefix.toLowerCase()))) {
    res.status(403);
    throw new Error(restriction.message);
  }

  return next();
};

// Named export kept as representativeGate too, so app.js's existing mount
// line does not need to change alongside this generalisation.
module.exports = { representativeGate: restrictedRoleGate, restrictedRoleGate };
