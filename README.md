# ExamAI

AI-native exam platform. One backend, two frontends.

## Status

Foundation only. Models, auth, middleware and server entry are written and
tested. Controllers and routes are next — the route mounts in `server.js` are
commented out until they exist.

## Layout

```
backend/          one express app, two api namespaces
  config/         db connection, startup env validation
  models/         mongoose schemas
  middleware/     auth, batch access, errors, rate limits
  controllers/
    admin/        staff-facing
    app/          student-facing
  routes/
    admin/        mounted at /api/*
    app/          mounted at /api/app/*
  adapters/       sms, payment, storage — swappable per install
  ai/             providers, prompts, output schemas
  utils/
admin-panel/      react, served at /admin
student-app/      react, served at /
```

## Tests

```bash
npm test     # runs without a database
npm run smoke # requires mongod, a seeded db and a running server
```

`npm test` covers route guarding, question and schema validation, scoring,
purchase stacking, AI output parsing, the provider adapter against a live
fake server, HTTP-level auth and token forgery, and production error
suppression. It does not touch persistence.

`npm run smoke` covers what the offline suite cannot: real controller
behaviour against real data. Run `npm run seed -- --force`, start the server,
then run it.

## Quick start

```bash
cd backend
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
npm install
npm run dev
```

The server refuses to start on a missing or weak secret rather than failing
later at runtime.

## Zero-config defaults

Nothing requires a third-party account to run:

| Concern  | Default        | Upgrades                                |
| -------- | -------------- | --------------------------------------- |
| OTP      | email          | twilio, vonage, aws sns, custom http    |
| Payments | manual entry   | stripe, paypal, razorpay, bkash         |
| Storage  | local disk     | s3 and s3-compatible                    |
| Video    | direct file    | bunny signed urls, youtube, vimeo       |
| Queue    | in-process     | redis + bullmq                          |
| AI       | off            | openai, anthropic, gemini, any local llm|

## Deployment

`SERVE_STATIC=true` serves both builds from the backend on one origin —
student app at `/`, admin at `/admin`, api at `/api`. Same-origin means no
CORS and no cross-domain cookie configuration.

For split origins set `SERVE_STATIC=false`, fill `CLIENT_URL_*`, and set
`COOKIE_DOMAIN=.example.com` with `COOKIE_SAMESITE=none`.

## Notes on the data model

**One question collection.** MCQ, MTF and written are mongoose discriminators
on a single `Question` model, so a mixed exam loads in one query and a fourth
type can be added without touching anything that exists.

**Explicit assignment only.** A batch sees a lecture, exam or question because
it appears in that document's `batches` array. There is no implicit matching by
subject, which is why batches have no `type` or `fullSubject`.

**Scores are withheld until fully graded.** A submission moves
`submitted -> grading -> graded`, and `marks` stays null until every written
answer has a mark. `scoreObjective()` takes an explicit question map rather
than relying on populate, because a missed populate would silently award
undefined.

**Taxonomies are data.** Exam authorities and subjects are collections, not
enums, so the same code serves any curriculum.

## Admin panel

```bash
cd admin-panel
npm install
npm run dev          # http://localhost:5173/admin
```

Vite proxies `/api` to the backend on port 5000, so the panel is same-origin
with the API in development exactly as it is in production. There is no CORS
and no environment variable to set.

For production:

```bash
npm run build        # writes admin-panel/dist
```

With `SERVE_STATIC=true` the backend serves that build at `/admin`.

### Screens

Sign in · first-run setup · invite acceptance · overview · question bank ·
question editor (all three types) · exams · exam builder · content tree ·
lectures · batches · batch detail with the assignment picker · students ·
student detail with enrolment and payments · AI generation · review queue ·
team and invitations · settings.

### Checks

```bash
npm run verify
```

Three things the bundler cannot catch, each of which builds cleanly and then
breaks at runtime with a blank screen:

- a page imports a hook the api slice never exported
- a link points at a route that was never declared
- a query calls an api path the backend does not serve

The third runs the backend's own route audit, so the two halves are checked
against each other rather than against a list that can drift. `npm run build`
runs all three first.
