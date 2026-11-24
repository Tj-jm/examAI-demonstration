# ExamAI — guide

The admin panel is complete: everything below can be done by clicking. The API
reference at the end is there for scripting and bulk work.

There is no student app yet. Nobody can sit an exam.

---

## 1. Install

**You need:** Node 18 or newer, and a MongoDB you can connect to.

```bash
cd backend
cp .env.example .env
```

Generate the two secrets and paste them into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
```

Set `MONGO_URI`. Then:

```bash
npm install
npm run dev
```

The server refuses to start on a missing or short secret rather than failing
later — a weak `JWT_SECRET` means anyone can forge an admin session.

In a second terminal:

```bash
cd admin-panel
npm install
npm run dev
```

Open **http://localhost:5173/admin**.

### Optional: start with sample content

```bash
cd backend && npm run seed
```

Creates an owner (`owner@example.com` / `changeme123`), two subjects, a
chapter, two topics, one question of each type, a program, a paid and a free
batch, and a lecture already assigned. Change that password before anyone else
can reach the install.

`npm run seed -- --force` wipes and reseeds.

---

## 2. First run

Without the seed, the panel opens on **Set up ExamAI**. Fill in your name,
email and a password.

This creates the owner account and then stops working. There is no public
registration, so there is no window for someone to create an account and
promote it. Everyone else joins by invitation.

The owner cannot be demoted or deleted, including by an admin.

---

## 3. Adding your team → **Team**

Never type a colleague's password. Press **Invite someone**, enter their name,
email and role.

You get a link. **It is shown once.** Only a hash is stored, so it cannot be
retrieved later and a database dump yields nothing usable. Copy it and send it
however you like.

They open it, choose their own password, and land signed in. The role comes
from the invitation, not from what they submit, so a teacher cannot accept as
an admin. Links expire after three days and delete themselves.

**Roles**

| | Content and students | Pricing, AI settings, users |
|---|---|---|
| Owner | yes | yes |
| Admin | yes | yes |
| Teacher | yes | no |

---

## 4. Build your subject tree → **Content**

Everything hangs off **Subject → Chapter → Topic**. Questions attach to topics,
and that is what makes topic-level analysis possible later.

Press **New subject**, then expand it to add chapters, then topics.

Deleting is refused when anything depends on it: a subject with 4 chapters and
218 questions returns a message saying exactly that. Deactivate instead of
deleting if you want to hide something.

---

## 5. Write questions → **Questions**

Press **New question** and pick a type.

**Multiple choice.** Type your options and **tap the letter** to mark the
correct one. Add or remove options freely — four is not fixed. Set marks and,
if you use negative marking, a penalty.

**True / false.** Each statement gets its own True/False toggle. Students earn
partial credit per correct statement.

**Written.** The **rubric** is what AI grading marks against. Each row is a
criterion and its marks. The editor warns if the rows don't add up to the
question's total. Without a rubric every answer needs marking by hand.

Maths goes in as LaTeX: `$v = 2$ m/s`. That is what the student app renders.

The editor checks as you type. It will not let you save an MCQ whose correct
answer is not one of the options you wrote — the mistake that stays invisible
until a student sits the exam.

**Filters** across the top: type, difficulty, topic, and **No solution yet**,
which is the list you feed to AI backfill.

---

## 6. Build an exam → **Exams**

Press **New exam**, give it a title, duration and kind:

- **Quiz** — short, low stakes
- **Test** — one attempt
- **Mock** — closes on its own after a set number of hours

You land in the builder. Press **Add questions**, search the bank, tap to add.
All three types can sit in the same paper. Reorder with the arrows.

**Assign it to batches.** Students see an exam only if their batch is selected
here. Nothing is matched automatically.

Then **Publish**, then **Open to students**. Publishing checks: at least one
question, at least one batch. If any written question has no rubric you get a
warning and a **Publish anyway** button.

### Editing a paper people have sat

You cannot. Duration, marking and the question list lock the moment anyone
starts, because changing them would rescore students against rules they never
saw. Press **Duplicate** — the copy starts unpublished and unassigned so it
cannot go live by accident.

---

## 7. Lectures → **Lectures** (optional)

A pool. Create a lecture once, assign it to as many batches as you like from
the batch page.

**Tag** is for your own grouping. It has no bearing on who can see the lecture
— assignment is the only gate.

The **Not assigned to any batch** filter finds content sitting in the pool with
nowhere to be seen.

Skip this section entirely if you only need exams.

---

## 8. Programs, batches and access → **Batches**

A **Program** groups batches. A **Batch** is what a student joins, and what
content is assigned to.

Create a program, then add batches to it. Choose **Paid** or **Free for
everyone** — free batches skip subscription checks entirely.

The subjects you pick filter the content picker. They do not decide what
students see.

### The core rule

> A batch sees a lecture, exam or question **only** because it is assigned.
> Nothing is matched implicitly by subject.

That is why batches have no "type" or "full subject" setting. One rule, one
place to look when something does or does not appear.

### Batch detail

**What this batch can see** — switch between exams, lectures and questions.
Press **Assign** to see what is available and tap to add.

**Copy from another batch** — brings across every assignment from another
batch. This is the one that turns setting up next term from an afternoon into
two minutes.

**Plans** — name, price, and either a length in days or "never expires".
Purchases snapshot the plan they were bought under, so repricing later never
rewrites what someone already agreed to. A plan that has been sold cannot be
deleted, only deactivated.

**What is included** — capability switches for exams, practice, lectures and
AI help.

Batches with purchases against them cannot be deleted. Deactivate instead.

---

## 9. Students and payments → **Students**

**Add student** creates the account. Email or phone, either works.

On a student's page there are two separate buttons, and the difference matters:

**Grant access** — free access to a batch for a number of days, or forever.
No payment recorded. Use this for scholarships, staff children, or extending
someone who had a problem. It is stored as a zero-price purchase, so it stacks
and expires through exactly the same logic as a paid one.

**Record payment** — a payment you took outside the app. Cash, bank transfer,
anything. Pick the batch and plan, note the method and a reference. Duplicate
references are refused.

The page shows computed access per batch — whether it came from a purchase or
a trial, and when it runs out.

**Purchases stack.** Buy 30 days twice while the first is still running and you
get 60. Buy again after a lapse and it restarts from that date.

Students with submissions cannot be deleted, only deactivated — their exam
history may be a record you are required to keep.

---

## 10. Connect AI → **Settings**

Off until you configure it. Everything above works without it.

### A local model

Nothing leaves your server and it costs nothing per call.

| Field | Value |
|---|---|
| Provider | Local or self-hosted |
| Address | `http://localhost:11434/v1` |
| Model | `qwen2.5:14b` |
| API key | usually blank |

That works with Ollama, LM Studio, vLLM, llama.cpp, LocalAI, OpenRouter, Groq
and Together — they all speak the same protocol.

### A hosted provider

Pick OpenAI, Anthropic or Google Gemini, enter the model name and your key.

Keys are encrypted at rest and never shown again — you only see the last four
digits. Saving other settings will not wipe the key.

Press **Test connection** to check it actually answers before you rely on it.

### What AI is allowed to do

Five switches, all off by default. Turn on only what you want.

If you enable **Grade written answers** with a small model you get a warning.
It does not stop you — you own this install — but a 7B model is not reliable at
marking against a rubric, and it is better to know now than after reading forty
bad marks.

### Appearance

Six themes, light/dark/system, and a sidebar or icon-only navigation. Per
browser for now.

---

## 11. Generate questions → **Generate**

Pick a topic, paste your source material — a chapter, your notes, a worked
example. Choose which types and how many, up to 20.

Questions are written only from what you paste. The model is told not to
introduce facts that are not there.

Output is validated before it is stored. An MCQ whose answer key names an
option that does not exist is rejected and the model is asked again with the
specific reason. It gets two attempts before giving up.

**Everything generated goes to the review queue.** Nothing reaches a student
until a person approves it.

### Missing solutions

The same page finds every question with no explanation written and offers to
fill them in, 25 at a time. Solutions save straight onto the question — they
do not go through review, because a solution is attached to a question a person
already approved.

### Usage

Calls, tokens, estimated cost and failures, broken down by feature. Local
models log usage at zero cost.

Spending caps live in the AI settings: daily calls per student, daily cost cap,
max tokens per call. Zero means no cap.

---

## 12. Approve what AI wrote → **Review**

One question per card. **Approve**, **Edit**, or **Reject**.

You see the full question, every option with the correct one marked, the rubric
for written questions, and the generated solution.

**Approve all** is there for when you have read through a batch and they are
fine. Reject deletes.

This screen decides whether generation is worth using at all: if reviewing is
slower than writing questions by hand, the feature is worthless.

---

## 13. Deploying

### One server, one domain

```bash
cd admin-panel && npm run build
```

Set `SERVE_STATIC=true` in the backend's `.env` and start it. Then:

| | |
|---|---|
| Admin panel | `yoursite.com/admin` |
| API | `yoursite.com/api` |
| Student app | `yoursite.com` (when it exists) |

One origin means no CORS and no cross-domain cookie configuration. This is the
setup to use unless you have a reason not to.

### Separate subdomains

Set `SERVE_STATIC=false`, fill in `CLIENT_URL_ADMIN` and `CLIENT_URL_STUDENT`,
and set `COOKIE_DOMAIN=.yoursite.com` with `COOKIE_SAMESITE=none`.

Miss the cookie settings and login silently fails — the cookie gets set and
never sent back. That is the single most common problem with this setup.

---

## 14. Checking your install

```bash
cd backend && npm test
```

No database needed. Covers route guarding, validation, scoring, purchase
stacking, AI output parsing, the provider adapter, HTTP auth and token forgery,
and production error suppression.

```bash
cd admin-panel && npm run verify
```

Three things a build cannot catch, each of which compiles cleanly and then
shows a blank screen: a page importing a hook that does not exist, a link to a
route that was never declared, and a query calling an API path the backend does
not serve. The last runs the backend's own route audit, so the two halves are
checked against each other.

```bash
cd backend
npm run seed -- --force
npm run dev
npm run smoke        # in another terminal
```

The smoke test is the important one — it exercises real controllers against
real data, which the offline suites cannot.

---

## 15. API reference

Everything above is clickable. This is for scripting, bulk imports, and
anything you would rather not do by hand.

Sign in and keep the cookie:

```bash
curl -c cookies.txt -X POST localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com","password":"changeme123"}'
```

Then pass `-b cookies.txt` on everything.

### Bulk import questions

The one thing genuinely worth doing outside the UI. Up to 200 at a time.

```bash
curl -b cookies.txt -X POST localhost:5000/api/questions/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "topicId":"TOPIC_ID",
    "questions":[
      {"type":"mcq","question":"...","options":[{"key":"A","text":"..."},{"key":"B","text":"..."}],"correctOption":"A","solutionText":"..."},
      {"type":"mtf","question":"...","statements":[{"text":"...","isTrue":true},{"text":"...","isTrue":false}]}
    ]
  }'
```

The response names which rows failed and why:

```json
{ "created": 18, "rejected": [{ "index": 4, "reason": "The correct option \"D\" is not one of the options." }] }
```

### Everything else

| Area | Endpoints |
|---|---|
| Auth | `/api/auth/{setup-state,setup,login,logout,me,password}` |
| Team | `/api/invites`, `/api/users` |
| Taxonomy | `/api/taxonomy/{tree,subjects,chapters,topics}` |
| Questions | `/api/questions`, `/api/questions/bulk`, `/api/questions/stats` |
| Exams | `/api/exams/:id/{questions,publish,active,duplicate}` |
| Programs | `/api/programs`, `/api/batches`, `/api/batches/:id/plans` |
| Assignment | `/api/batches/:id/{assigned,assignable}/:kind`, `/api/batches/:id/copy-from/:sourceId`, `/api/assignments/:kind/:itemId/batches` |
| Lectures | `/api/lectures`, `/api/lectures/{reorder,publish}` |
| Students | `/api/students/:id/{enrol,purchases,password}`, `/api/purchases` |
| AI | `/api/ai/{config,test,generate-questions,backfill-solutions,review-queue,review-question/:id,usage}` |

`:kind` is `exams`, `lectures` or `questions`.

Full list with the guard on each route:

```bash
cd backend && node tests/routeAudit.js
```

---

## What does not exist yet

**The student side.** No student login, no exam taking, no submission, no
results. The models and scoring logic are written and tested, but there are no
student endpoints. **Nobody can sit an exam.**

Also missing:

- **AI grading of written answers.** The prompt and schema exist; the grading
  queue does not.
- **Student-facing AI** — explaining mistakes, weak topic reports, adaptive
  practice.
- **Practice mode** — the attempt-tracking model exists, nothing writes to it.
- **File uploads.** No storage adapter, so images, PDFs and video are
  references with nothing behind them.
- **PDF ingestion.** Generation takes pasted text; there is no file parsing.
- **The student app.**
