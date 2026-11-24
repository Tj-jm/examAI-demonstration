# Zoom setup — live classes (Tier 2)

The "manual link" provider needs none of this — it works with zero
configuration. This doc only applies if you want the "Zoom (auto-created
meeting)" provider: automatic meeting creation, and live status/attendance
sync from Zoom back into the platform.

## 1. Create a Server-to-Server OAuth app

1. Go to https://marketplace.zoom.us/ → **Develop** → **Build App**.
2. Choose **Server-to-Server OAuth**.
3. Under **Scopes**, add:
   - `meeting:write:admin` (or `meeting:write` if scoped to one user)
   - `meeting:read:admin`
4. Activate the app.
5. Copy the **Account ID**, **Client ID**, and **Client Secret** shown on
   the app's Credentials tab.

## 2. Set backend env vars

Add to `backend/.env`:

```
ZOOM_ACCOUNT_ID=...
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...
```

Restart the backend process after saving — `nodemon` does not reload
`.env` changes on a running process (see the project's gotcha #8).

Once these three are set, `adapters/liveClass`'s `zoom.configured()`
returns `true` and the provider becomes selectable when scheduling a live
class.

## 3. (Optional but recommended) Webhooks — status sync + attendance

Without this step, a class only shows "live" once someone clicks **Start**
in this platform, and only shows "ended" once someone clicks **End** — if
the host starts/ends from their own Zoom app or phone instead, the
student-facing status won't update on its own, and no attendance is
recorded at all.

1. In the same Zoom app, go to **Feature** → **Event Subscriptions** → add
   a subscription.
2. Event notification endpoint URL:
   ```
   https://<your-domain>/api/webhooks/zoom
   ```
3. Add these events:
   - `Meeting Started`
   - `Meeting Ended`
   - `Participant/Host joined meeting`
   - `Participant/Host left meeting`
4. Click **Validate** — Zoom sends a one-time handshake request to that
   URL; the backend answers it automatically (`endpoint.url_validation` is
   handled with no secret needed for that specific request). It should go
   green immediately as long as the backend is reachable at that URL.
5. Copy the **Secret Token** shown after adding the subscription.

Add to `backend/.env`:

```
ZOOM_WEBHOOK_SECRET_TOKEN=...
```

Restart the backend again.

### What this actually gets you

- **Status sync**: `meeting.started`/`meeting.ended` events flip the
  `LiveClass.status` field automatically, regardless of which side (this
  platform or Zoom itself) started/ended it.
- **Attendance (best-effort, not authoritative)**: `participant_joined`/
  `participant_left` events are appended to `LiveClass.attendance` —
  whatever display name and email the participant's own Zoom client
  reported, with join/leave timestamps. This is **not** matched against a
  `Student` document — the join link isn't personalized per student (that
  would need Zoom's separate "registrant" flow, not implemented here), so
  a student could join under any name. Treat it as a rough attendance log
  an admin can eyeball, not a source of truth for grading or access
  decisions.

### Security note

The webhook endpoint (`POST /api/webhooks/zoom`) is intentionally public —
Zoom calls it with no session of any kind. Trust comes entirely from the
signature Zoom sends on every real event (`x-zm-signature` /
`x-zm-request-timestamp`), verified against `ZOOM_WEBHOOK_SECRET_TOKEN` in
`adapters/liveClass/index.js`'s `verifyWebhookSignature()`. Never disable
that check to "make it work" — an unverified webhook would let anyone
POST fake `meeting.ended` events (or fake attendance) for any meeting ID
they can guess.

## 4. Rotating credentials

If a Client Secret or Webhook Secret Token is ever regenerated in the Zoom
app dashboard, update the corresponding `.env` value and restart the
backend. Old meetings already created keep working — this only affects
new meeting creation (Client Secret) or new incoming webhook events
(Webhook Secret Token).

## 5. Alternative hosts

When scheduling a Zoom class, you can grant other staff full host
controls on the same meeting (Zoom's own "alternative hosts" feature) —
useful for a co-teacher or TA who should be able to start the class
independently.

**Requirement**: each alternative host must be a **licensed user on the
same Zoom account** — not just anyone with a Zoom account. Add them under
**Admin → User Management → Users** in the Zoom web portal first. An
email that isn't a licensed user on this account fails meeting creation
outright with Zoom error code `1114`.

## 6. Secured tier (Tier 3) — personal join links per student

Adds a third option beyond "manual link" and "Zoom": a **Secured** Zoom
class where every active student gets their **own personal join link**,
tied to their email, instead of one shared link everyone uses.

**What this actually closes**: on the open tiers, any student can forward
the join link to someone outside the batch and that person can generally
get in. On a secured class, only that exact personal link works — Zoom's
registration flow ties each link to one registered email.

**How it works**:
- At scheduling time, every currently active student on the batch is
  bulk-registered as a Zoom meeting registrant.
- A student who gains batch access *after* the class was scheduled (a
  late purchase, a trial that just started) gets registered automatically
  the first time they open the class — not left out.
- A student with no email on file (phone-only signup) can't be
  registered at all — Zoom's registration flow has no path without one.
  They see a clear message asking them to add an email, not a broken
  link.

**No extra setup beyond what's already above** — Tier 3 uses the same
Zoom credentials as Tier 2, just a different API call
(`POST /meetings/{id}/registrants`) under the same Server-to-Server OAuth
app and the same `meeting:write` scope grouping.

**Trade-offs to know about**:
- Bulk-registering a large batch (hundreds of active students) means that
  many sequential Zoom API calls when the class is scheduled — this can
  take a few seconds and is subject to Zoom's per-account rate limits. A
  handful of registrations can silently fail (network blip, a malformed
  email Zoom rejects) — those students simply fall through to the lazy
  per-student registration path the first time they open the class, so a
  failed bulk registration isn't a permanently lost spot.
- This only ever applies to the Zoom provider. There's no equivalent for
  the manual-link provider — a pasted external link has no API this
  platform can register anyone against.
