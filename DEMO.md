# Sales demo

This is the sales team's demo of the product, cut down to what is sold:
features that are never sold are not in this code at all. Only sales
representatives use it.

## Run it

On one server with Docker:

1. `cp backend/.env.demo.example deploy/demo.env` and fill it in: fresh
   `JWT_SECRET` and `ENCRYPTION_KEY`, the site password for the team
   (`DEMO_BASIC_USER`, `DEMO_BASIC_PASSWORD`), the owner password
   (`DEMO_OWNER_PASSWORD`) and the site address.
2. `docker compose -f deploy/docker-compose.demo.yml up -d --build`
3. Put HTTPS in front of `127.0.0.1:5000` (Caddy, nginx or a tunnel).

MongoDB runs beside the app with no open port: only the app reaches it.

## What reps see

- The browser asks for the team password before anything loads.
- Sign-in pages list the demo accounts: one click fills the email. The
  owner uses `DEMO_OWNER_PASSWORD`; every other demo account uses
  `123456789`.
- A **Demo** mark and a **Notes** button on every page. Notes (or Alt+N)
  shows the sales notes for that page; hide them while sharing the screen.
- **Reset demo** (in Notes, owners and admins) puts all data back to the
  start. It also resets on every start and every night at 03:17.
- The AI settings (Settings → AI: main connection, picture AI, voice) are
  kept through resets. Set them once.
- No email or SMS is sent. Search engines are told to stay away.

## Sales notes

Edit `admin-panel/src/demo/sales.json` and `student-app/src/demo/sales.json`,
then rebuild. Each page is keyed by its path (`:id` matches any one part):

```json
"/lectures": { "tier": "PRO", "note": "Show the AI video filter.\n\nThen open a lecture.", "features": {} }
```

- `note`: what to say or show. A blank line starts a new paragraph.
- `tier`: the plan the page is in, shown as a badge beside the notes.
- `tiers` (top of the file) and `features`: for the plan tiers, once they
  are decided.

## Updating from the product

The demo is a copy, not a branch. Copy changed files over from the product
by hand, and leave out anything that is not for sale.
