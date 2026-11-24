# ExamAI — student app

The student-facing side of ExamAI: log in, watch lectures, take exams,
practice, and buy access. Talks to the same backend the admin panel does,
under `/api/app/*`.

## Install

```bash
npm install
npm run dev
```

Runs on port 5174, proxying `/api` and `/media` to the backend on 5000 (see
`vite.config.js`) — same-origin in development, so the session cookie
behaves exactly as it will in production.

The backend needs to be running first (`cd ../backend && npm run dev`). If
`SMS_PROVIDER` and `SMTP_*` are both unset, registration still works: the
verification code is echoed straight into the API response outside
production, so you can sign up without configuring anything.

## What's built

- **Auth** — three-step registration (request a code → verify it → set a
  name and password), login, single-session enforcement.
- **Branding** — theme, layout (`app` bottom-tabs or `web` sidebar), logo
  and default light/dark mode are all read from the backend's
  `AppSettings`, set once by an admin. Nothing here is hardcoded; changing
  it in the admin panel's Settings page changes what every student sees.
- **Lectures** — video (every driver the admin can configure — Bunny,
  YouTube, Vimeo, a direct link — just plays, since the admin side already
  resolved which one), notes rendered from Markdown, attachments.
- **Exams** — the full flow: rules screen, start/resume (a page refresh
  mid-exam picks up exactly where it left off), a sticky timer that
  auto-submits on expiry, autosaved answers across all three question types
  with LaTeX rendering, an explicit confirm-before-submit, and a result
  screen with per-question review. Deliberately rendered without the normal
  navigation chrome while an exam is in progress.
- **Practice** — one question at a time with immediate feedback, biased
  toward topics you have not already answered correctly.
- **Purchases** — Stripe checkout (coupon-aware), a free-trial path where a
  batch offers one, and purchase history. The success page polls rather than
  trusting the redirect alone, since the purchase itself is only created
  once Stripe's webhook lands.

## What isn't built yet

- A dedicated Results list (currently the exam list itself shows last score
  per exam and links into the same result screen — a real "all your results
  across every batch" view would be a small addition on top of what's here).
- AI features — weak-topic reports, adaptive practice, the tutor chat,
  photo-based doubt solving. All were scoped as later work; nothing here
  blocks adding them, since the submission and practice-attempt data they'd
  read from already exists.
- Written-answer grading is admin-only for now (Grading page in the admin
  panel). AI-assisted grading has a prompt and schema already but nothing
  wired to call them yet.

## Structure

```
src/
  api/            RTK Query slices (authApi, contentApi)
  theme/          the 6 shared theme tokens + MUI theme builder
  layout/Shell    both layouts (app / web), switched by admin setting
  pages/
    auth/         Login, Register (+ AuthShell wrapper)
    lectures/     list + detail
    exams/        list, rules, take, result
    practice/     topic picker, one-question-at-a-time session
    purchases/    plan picker, checkout success/cancelled, history
  components/     Latex.jsx and SafeMarkdown.jsx, ported from the admin
                  panel so content renders identically in both places
```
