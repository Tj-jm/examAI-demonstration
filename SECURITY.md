# Security

What this install actually does to protect student data, staff accounts, and
payments — and, just as importantly, what it doesn't do. Written for anyone
running or evaluating an install, not just the person who wrote the code.

## Authentication & sessions

- Passwords (staff and student) are hashed with bcrypt (cost factor 10, via
  `userModel.js` / `studentModel.js`'s pre-save hooks). Nothing stores or logs
  a plaintext password.
- Sessions are a signed JWT (`JWT_SECRET`, HS256) carrying a `sessionId` that's
  also stored on the account document. Logging out, changing a password,
  resetting a password, or an admin changing a staff account's role/active
  state all rotate `sessionId` — the old token stops matching on the very next
  request (`middleware/adminAuth.js`, `middleware/studentAuth.js`), so it
  can't keep working after any of those events even though the JWT itself is
  still cryptographically valid until its 30-day expiry.
- Cookies are `httpOnly`, `sameSite=strict` by default, and `secure` whenever
  `NODE_ENV=production` (`utils/generateToken.js`). Admin and student sessions
  use separate cookies and separate JWT audiences (`aud: "user"` vs
  `"student"`), so a student token can never be replayed against a staff
  route or vice versa.
- Login and OTP verification are both attempt-limited per account
  (`loginAttempts`/`otpAttempts` with a lockout window), on top of IP-based
  rate limiting (`authLimiter`: 10/15min, `otpLimiter`: 5/hour —
  `middleware/rateLimit.js`) — an attacker rotating IPs against one known
  email still hits the per-account lock.
- OTPs are never sent back to the caller in a normal response. The one
  exception (`devOtp`, for developing signup with no SMS/email provider
  configured) requires both `NODE_ENV != production` **and** an explicit
  `DEV_OTP_ECHO=true` — unset `NODE_ENV` alone (the default on a server
  nobody configured) is not enough to leak a live OTP.

## Authorization

- Every restricted staff role (`representative`, `doubtSolver`, `teacher`,
  `grader`) is walled off to an explicit allow-list of path prefixes in
  `middleware/representativeGate.js`, mounted ahead of every route — a new
  admin route added later with no role check of its own is refused by
  default instead of silently becoming reachable. That gate reads role off
  the JWT as a narrowing pre-filter only; it never *grants* access — the
  authoritative check is `req.user.role`, re-read from the database on every
  request in `adminAuth.js`'s `protect()`, so a demotion/deactivation takes
  effect immediately (enforced by the `sessionId` rotation above, since the
  gate's own JWT-role read would otherwise still show the old role until the
  token naturally expires).
- Student-facing data is scoped to the requesting student at the query level
  throughout (`Doubt.findOne({..., student: req.student._id})`,
  `Submission` ownership checks, etc.) — there's no student endpoint that
  takes an arbitrary ID and trusts it without an ownership filter.
- Case-sensitive routing is enforced (`app.set("case sensitive routing",
  true)` in `app.js`) alongside the gate's own lowercase normalization, so a
  differently-cased path can't route around either check.

## Input handling & SSRF

- All persistence goes through Mongoose with typed schemas and parameterized
  queries — no raw string-built queries, so standard NoSQL-injection payloads
  in JSON bodies don't have anywhere to land.
- Student-submitted image references (a doubt's reference image, a written
  answer's attached images) are restricted to files this app itself stored:
  the URL is resolved back to a storage key and checked against a record of
  which student actually uploaded that key (`utils/mediaUrl.js`,
  `models/studentUploadModel.js`) before it's saved, and the AI pipeline
  reads the file directly off the configured storage driver
  (`ai/service.js`) rather than making an outbound HTTP request to
  whatever URL was submitted. A student can't point either field at an
  internal address, cloud metadata endpoint, or another student's file.
- File uploads are restricted by MIME type and size per kind (image/PDF/
  document, `adapters/storage/index.js`), and stored content-addressed by
  hash — the same key never resolves to two different files.
- Local file storage keys are resolved through a path-traversal guard
  (`adapters/storage/local.js`'s `safePath`) before ever touching the
  filesystem.

## AI-specific handling

- The written-answer grading prompt puts the student's answer text inside an
  explicit delimited block with an instruction to treat it as data, not
  instructions (`ai/prompts/index.js`) — mitigating, not eliminating, prompt
  injection attempts that try to get the model to change its own mark or
  reveal the reference answer.
- Feedback text shown to a student is scanned for verbatim overlap with the
  question's model answer before being returned (`ai/leakGuard.js`) and
  withheld if it matches — a second, independent layer behind the prompt
  instruction above, in case the model is talked past it anyway.
- AI provider API keys are stored encrypted at rest (`ENCRYPTION_KEY`), set
  from the admin panel rather than a plaintext config file, and are never
  echoed back in any response.
- Per-feature and daily spend caps (`ai/usage.js`) bound what a compromised
  or bulk-abused student account can cost, independent of any of the above.

## Payments

- Every gateway webhook/callback is signature-verified against that
  provider's own secret before its payload is trusted at all
  (`adapters/payment/index.js`); a disabled gateway refuses its webhook even
  if its credentials are still technically resolvable.
- Stripe's `checkout.session.completed` is only treated as paid when
  `payment_status` actually says so, with `async_payment_succeeded` handled
  separately — a delayed payment method's checkout "completing" doesn't by
  itself grant access.
- Coupon redemption is enforced atomically at the database layer
  (`Coupon.tryRedeem`, a conditional `findOneAndUpdate`) rather than a
  read-then-increment, closing the race where two concurrent checkouts could
  both land the last redemption slot. A per-student, per-coupon limit is
  enforced the same way, backed by a partial unique index on
  `Purchase{student, coupon}` — the database rejects a second concurrent
  redemption outright rather than relying on an application-level check
  alone.

## Secrets & configuration

- The server refuses to start on a missing, short, or malformed
  `JWT_SECRET`/`ENCRYPTION_KEY` (`config/validateEnv.js`), and separately
  refuses to start **in production** if either still matches the value
  shipped in `backend/.env.ready` (a local-dev quickstart file checked into
  every copy of this codebase — fine for local work, never for a live
  install).
- Payment gateway credentials and AI provider keys can be set via
  environment variables (authoritative, read-only in the panel) or stored
  encrypted in the database — never in plaintext config committed to the
  repo.
- The seed script (`npm run seed`) generates a random owner password printed
  once to the console, rather than a fixed value every install would share,
  and flags the account to require a password change.

## Dependency hygiene

- `npm audit` is run against the backend as part of maintenance; direct
  fixes are applied where available, and majors are evaluated for breaking
  changes before upgrading (e.g. `nodemailer` was moved to v10 to close a
  chain of SMTP-injection and SSRF-adjacent advisories after confirming the
  app's usage — a plain `createTransport`/`sendMail` call — was unaffected
  by the breaking changes in between).

## What this does not cover

Being direct about this matters more than a list of features:

- **No independent penetration test or formal audit** has been done against
  this codebase. What's above is what the code visibly does, not a
  third-party attestation.
- **Prompt injection mitigation is best-effort.** The delimiter instruction
  and the answer-leak scanner reduce risk; they cannot guarantee a language
  model never deviates from its system prompt. Don't treat AI-graded output
  as tamper-proof for anything high-stakes.
- **The S3 storage driver's presigned-URL recognition checks for the
  presence of a signature parameter, not that the signature is
  cryptographically valid**, when deciding a URL was issued by this
  deployment. Combined with the per-student upload-ownership check, this is
  low-risk in practice, but it is not equivalent to verifying the signature
  itself.
- **Content Security Policy is disabled** (`contentSecurityPolicy: false` in
  `app.js`'s helmet config) to keep third-party embeds (YouTube, etc.)
  working. This trades a defense-in-depth layer against XSS for embed
  compatibility — it does not mean XSS bugs are acceptable elsewhere.
- **Rate limiting is in-memory by default** (`express-rate-limit`'s default
  store) unless a shared store is wired up — fine for a single-process
  install, not a distributed one.
- Denial-of-service resistance, at the network or infrastructure level, is
  out of scope for anything in this repo — that's a hosting/CDN concern.

## Before going live

- [ ] Regenerate `JWT_SECRET` and `ENCRYPTION_KEY` — never ship
      `backend/.env.ready`'s values past local development.
- [ ] Set `NODE_ENV=production`.
- [ ] Set `DEV_OTP_ECHO` unset or `false`.
- [ ] Change the seeded owner password (or use `/api/auth/setup` to create
      the real owner account directly instead of seeding demo data first).
- [ ] Configure a real webhook secret for every payment gateway actually
      enabled, and confirm disabled gateways are actually marked disabled in
      Settings, not just missing credentials.
- [ ] Configure `SERVER_URL`/`CLIENT_URL_*` to real domains — several checks
      (webhook URLs, CORS origins) are built from these.
- [ ] If running behind multiple origins, set `COOKIE_DOMAIN` and
      `COOKIE_SAMESITE=none` deliberately, and confirm HTTPS is actually
      terminated in front of the app (`secure` cookies require it).
- [ ] Run `npm audit` in `backend/`, `admin-panel/`, and `student-app/` and
      review anything new.

## Reporting a vulnerability

Open an issue or contact the repository owner directly rather than
disclosing publicly, if a real vulnerability (not one of the known
limitations above) is found.
