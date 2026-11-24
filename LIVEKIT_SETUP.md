# In-app classroom and webinars (LiveKit)

Live classes can run inside the student app and the admin panel instead of on
Zoom or another site. They need a self-hosted LiveKit server (open source,
free).

**Class:** everyone can turn on camera and mic.
**Webinar:** the host speaks; students watch, chat and raise a hand. The host
can bring a student on stage, send them back to the audience, or remove them.

**Host controls (the People panel in the room):** raised hands first; who has
mic, camera or screen on; mute a mic, turn off a camera, stop a screen share;
allow or block each person's mic, camera and screen; **Mute all students**;
**Screen share: Hosts only / Everyone** for the whole class; remove someone;
end the class for everyone. Screen sharing is hosts-only unless the class
was scheduled with "Everyone" or the host allows it.

**The classroom's look:** Settings → Student app → Live classroom: logo in
the header, logo watermark over the video, each student's name faint across
the video (a screen recording shows who made it), accent colour, a waiting
message and image while the host is away, and a promo line with a button.

---

## 1. Try it on your own computer

1. Download the LiveKit server for your system from
   https://github.com/livekit/livekit/releases, or with Docker:

   ```bash
   docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0 --node-ip 127.0.0.1
   ```

   With Docker, `--bind 0.0.0.0 --node-ip 127.0.0.1` matter: without them
   the browser can't reach the server, or connects with no video.

   Without Docker: `livekit-server --dev`

2. Add to `backend/.env`:

   ```
   LIVEKIT_URL=ws://localhost:7880
   LIVEKIT_API_KEY=devkey
   LIVEKIT_API_SECRET=secret
   ```

3. Restart the backend. In **Live Classes → Schedule**, the provider list now
   offers **In-app classroom (LiveKit)**. Pick Class or Webinar.

4. Press **Start in classroom** on the class. Students see **Join class** /
   **Join webinar** on the class page (it appears within 15 seconds, no
   reload needed).

Open the student app in a second browser (or a private window) to be the
student. Camera and mic work on `localhost` without HTTPS. To test from a
phone on the same Wi-Fi you need HTTPS (a tunnel such as Cloudflare Tunnel or
ngrok).

---

## 2. Production

1. A VPS with a public IP: 4–8 vCPU handles roughly 100–200 people at once.
2. A domain such as `live.example.com` pointing at it.
3. Install with LiveKit's generator, which sets up HTTPS (Caddy) and TURN:

   ```bash
   docker run --rm -it -v$PWD:/output livekit/generate
   ```

   Follow its questions; it prints the API key and secret.

4. Open the firewall: TCP 443, 7881, UDP 50000–60000 (or what the
   generator configured).
5. Set in `backend/.env`:

   ```
   LIVEKIT_URL=wss://live.example.com
   LIVEKIT_API_KEY=<key>
   LIVEKIT_API_SECRET=<secret>
   ```

Students never see the key or secret. The backend hands each person a
short-lived pass, only after checking they have access to the batch and the
class is live. One pass per student: joining from a second device replaces
the first.

---

## 3. Recording (optional)

Recording uses LiveKit Egress, a second service next to the LiveKit server.
It needs Redis, which LiveKit also uses to find Egress.

1. Add Redis to the LiveKit config (`livekit.yaml`):

   ```yaml
   redis:
     address: localhost:6379
   ```

2. Create `egress.yaml`:

   ```yaml
   api_key: <key>
   api_secret: <secret>
   ws_url: ws://localhost:7880
   redis:
     address: localhost:6379
   ```

3. Run it. With local file storage (`STORAGE_PROVIDER=local`), mount the
   backend's `uploads/recordings` folder at `/out`:

   ```bash
   docker run -d --name egress --network host --cap-add SYS_ADMIN \
     -e EGRESS_CONFIG_FILE=/etc/egress.yaml \
     -v $PWD/egress.yaml:/etc/egress.yaml \
     -v /path/to/backend/uploads/recordings:/out \
     livekit/egress
   ```

   With S3 (`STORAGE_PROVIDER=s3`) no mount is needed: Egress uploads
   straight to the bucket using the backend's `S3_*` settings.
   If the container mounts somewhere other than `/out`, set
   `LIVEKIT_EGRESS_DIR` in `backend/.env`.

Egress uses about 2–4 vCPU per recording, so give it its own room on the
server.

**In the classroom:** the host presses **Record**. Students see a REC badge
for as long as it runs. Ending the class stops it.

**After class:** Live classes → **Recordings**. Each recording can be
published as a lecture (pick a chapter; board snapshots are attached), kept
private, or deleted. To skip this step, turn on **Publish recordings as
lectures automatically** in the class settings.

## 4. Captions and class notes

The host presses **Captions** in the classroom and picks the language they
speak (English, বাংলা, and more). Their browser turns speech into text and
everyone in the room sees it as subtitles; students can hide them with
**CC**. Captions need Chrome or Edge on the host's computer and an internet
connection (the browser's speech service). Nothing is installed on the
server.

Every finished line is saved. When the class ends, the AI writes class notes
from it (summary, notes by topic, key points, homework), using the model set
in AI settings. Live classes → **Notes** shows the notes and the transcript:
edit them, download the transcript, or write them again. A lecture made from
the recording includes the notes, so its AI summary and practice questions
work from them.


## 5. Live class monitor (optional)

Performance → Live classes shows every in-app class that is live: students in
each room, their connection quality, cameras and mics on, and how full the
server is against the limit you set there.

For LiveKit's own CPU, memory and traffic, turn on its metrics. Add to
`livekit.yaml`:

```yaml
prometheus_port: 6789
```

Then point the app at it (same machine or private network only; don't expose
this port publicly):

```
LIVEKIT_METRICS_URL=http://livekit:6789/metrics
```

Without it, everything else on the monitor still works.

**Capacity limit.** Set "Most people at once" to what your server can carry.
Rough guide for a 4-core, 8 GB server: about 150 people when students keep
cameras off, 50 to 80 with cameras on. Turn on "Stop new students joining" to
show "This class is full" instead of letting the server slow down for everyone.
