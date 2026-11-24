# Voice for AI video lessons (text-to-speech)

AI video lessons are board videos: the AI writes a script of spoken parts,
each with the steps shown on the board while it is spoken. The **voice**
reads each part aloud. Without a voice, lessons still play, with captions
only.

This guide covers choosing a voice service, setting each one up, and fixing
common problems.

- Settings page: **Settings → AI → Video lessons**
- Code: `backend/ai/tts.js` (the services), `backend/controllers/admin/videoLessonController.js` (making the voice)

---

## 1. How it works

1. Open a question (or a lecture) and its **AI video** section, then click
   **Make video with AI**. The script is written in the background.
2. Click **Make voice**. Each part's narration is sent to the voice service,
   one part at a time. The progress bar shows how many parts are done. You
   can leave the page; it carries on on the server.
3. Each part's audio is saved as an MP3 in your file storage (local disk or
   S3, whatever `STORAGE_PROVIDER` is). It is made once and reused: only a
   part whose narration you edit is voiced again.
4. **Redo voice** voices every part again, e.g. after choosing a different
   voice.
5. **Publish** makes it visible to students. **Record video** turns it into
   an MP4 (optional).

### Which voice is used

- **Voice** is used for every lesson.
- **Voice for Bangla lessons** is used instead when the lesson's language is
  Bangla, or when the narration itself is written in Bangla. Leave it empty
  to use the main voice for everything.

Use a voice that speaks the narration's language. An English voice given
Bangla text returns no audio.

### What it costs

A solution video's narration is about 1,000–2,000 characters; a 10-minute
lecture is about 8,000–10,000. Services charge by characters.

---

## 2. Choosing a service

| Service | Cost | Bangla | Reliability | Best for |
|---|---|---|---|---|
| **Azure AI Speech** | Free: 0.5M characters a month, then paid | Yes (bn-BD, bn-IN) | Official | **Recommended** for production |
| **Google Cloud TTS** | Free: 1M WaveNet characters a month | Yes (bn-IN) | Official | Production, more free volume |
| **ElevenLabs** | Free: about 10k characters a month | Yes, varies | Official | The most natural English |
| **OpenAI** | Paid per character | Weak | Official | If you already pay for OpenAI |
| **openai-edge-tts** (self-hosted) | Free | Yes (bn-BD) | Unofficial, can break | Testing, small use |
| **Kokoro** (self-hosted) | Free, offline | No | Fully yours | English only, no outside service |

On the free tiers, Azure covers about 300 solution videos a month and Google
about 600.

---

## 3. Azure AI Speech (recommended)

1. Sign in at <https://portal.azure.com> (a free account works).
2. **Create a resource**, search for **Speech**, and create it:
   - **Region**: one near you, e.g. `southeastasia` or `eastus`.
   - **Pricing tier**: **Free F0**.
3. Open the resource and go to **Keys and Endpoint**. Copy **Key 1** and the
   **Location/Region**.
4. In the app, open **Settings → AI → Video lessons** and fill in:

   | Field | Value |
   |---|---|
   | Voice service | **Azure AI Speech** |
   | Region | your region, e.g. `southeastasia` |
   | API key | Key 1 |
   | Voice | `en-US-AvaMultilingualNeural` |
   | Voice for Bangla lessons | `bn-BD-NabanitaNeural` |

5. Click **Save voice**.

Other voices:
- Bangla: `bn-BD-NabanitaNeural` (female), `bn-BD-PradeepNeural` (male),
  `bn-IN-TanishaaNeural` (female), `bn-IN-BashkarNeural` (male).
- English: `en-US-AvaMultilingualNeural`, `en-US-AndrewMultilingualNeural`,
  `en-GB-SoniaNeural`, `en-IN-NeerjaNeural`.
- The full list is at the voice gallery in Speech Studio
  (<https://speech.microsoft.com>).

The Region field also takes a full endpoint URL, for a custom endpoint.

---

## 4. Google Cloud Text-to-Speech

1. Go to <https://console.cloud.google.com> and create a project.
2. Turn on billing for the project. Google asks for a card even for the free
   tier; usage within the free amount isn't charged.
3. Go to **APIs & Services → Library**, search for **Cloud Text-to-Speech
   API**, and **Enable** it.
4. Go to **APIs & Services → Credentials → Create credentials → API key**.
   Then **Edit API key → API restrictions → Restrict key** and choose
   **Cloud Text-to-Speech API** only.
5. In the app, fill in:

   | Field | Value |
   |---|---|
   | Voice service | **Google Cloud Text-to-Speech** |
   | API key | the key |
   | Voice | `en-US-Wavenet-F` |
   | Voice for Bangla lessons | `bn-IN-Wavenet-A` |

6. Click **Save voice**.

Other voices:
- Bangla: `bn-IN-Wavenet-A`, `bn-IN-Wavenet-B` (and `-C`, `-D`).
- English: `en-US-Wavenet-D`, `en-GB-Wavenet-A`, `en-IN-Wavenet-A`.
- WaveNet voices are in the 1M free tier. Neural2, Studio and Chirp voices
  sound better but have smaller free amounts or none.
- The full list: <https://cloud.google.com/text-to-speech/docs/voices>.

---

## 5. ElevenLabs

1. Sign up at <https://elevenlabs.io>.
2. Go to **Profile → API Keys** and create a key.
3. Go to **Voices**, add a voice to **My Voices**, open it, and copy its
   **Voice ID** (a code like `21m00Tcm4TlvDq8ikWAM`, not the name).
4. In the app:

   | Field | Value |
   |---|---|
   | Voice service | **ElevenLabs** |
   | Server address | empty |
   | API key | the key |
   | Model | empty (`eleven_multilingual_v2`), or `eleven_flash_v2_5` for cheaper |
   | Voice id | the Voice ID |
   | Voice for Bangla lessons | another Voice ID, optional |

---

## 6. OpenAI

| Field | Value |
|---|---|
| Voice service | **OpenAI-compatible** |
| Server address | empty |
| API key | your OpenAI key |
| Model | empty (`tts-1`), or `tts-1-hd` / `gpt-4o-mini-tts` |
| Voice | `alloy`, `nova`, `shimmer`, `onyx`, `echo` or `fable` |

---

## 7. Self-hosted, with Docker

Both servers below speak the OpenAI speech API, so the app uses them through
**OpenAI-compatible**.

### 7.1 Install Docker

- **Windows / Mac**: install Docker Desktop from
  <https://www.docker.com/products/docker-desktop>, open it, and wait until it
  says the engine is running.
- **Linux / VPS**: `curl -fsSL https://get.docker.com | sh`

Run the commands below in a terminal (Windows: Command Prompt or
PowerShell). Each command is one line.

### 7.2 openai-edge-tts (free, Bangla, unofficial)

This uses Microsoft Edge's "Read aloud" voices: the same voices as Azure,
without an account. It is unofficial: Microsoft can change or block it at
any time, and it is a grey area for commercial use. Use it for testing, and
Azure for production.

**Start it.** `mysecret` is the key; choose your own, and use the same one
in the app.

```
docker rm -f edge-tts
docker pull travisvn/openai-edge-tts:latest
docker run -d --name edge-tts --restart unless-stopped -p 5050:5050 -e API_KEY=mysecret travisvn/openai-edge-tts:latest
```

(The first command says "No such container" the first time; that's fine.)

**Check that it runs.**

```
docker ps
```

`edge-tts` should show as `Up`.

**Test it.**

Windows (Command Prompt or PowerShell):

```
curl.exe http://localhost:5050/v1/audio/speech -H "Authorization: Bearer mysecret" -H "Content-Type: application/json" -d "{\"model\":\"tts-1\",\"input\":\"Hello test\",\"voice\":\"en-US-AvaNeural\"}" --output test.mp3
```

Mac / Linux:

```
curl http://localhost:5050/v1/audio/speech -H "Authorization: Bearer mysecret" -H "Content-Type: application/json" -d '{"model":"tts-1","input":"Hello test","voice":"en-US-AvaNeural"}' --output test.mp3
```

Play `test.mp3`. If you hear "Hello test", it works. To test Bangla, use
`"input":"পরীক্ষা"` and `"voice":"bn-BD-NabanitaNeural"`.

**Set up the app.**

| Field | Value |
|---|---|
| Voice service | **OpenAI-compatible** |
| Server address | `http://localhost:5050/v1` |
| API key | `mysecret` (the same as `API_KEY` above) |
| Model | `tts-1` |
| Voice | `en-US-AvaNeural` |
| Voice for Bangla lessons | `bn-BD-NabanitaNeural` |

Voice names are the same as Azure's (section 3) without "Multilingual",
e.g. `en-US-AvaNeural`, `en-US-AndrewNeural`, `bn-BD-PradeepNeural`. Spell
them exactly, capitals included.

**Update it** when it stops producing audio. Microsoft changes things, and
new builds follow:

```
docker pull travisvn/openai-edge-tts:latest
docker rm -f edge-tts
docker run -d --name edge-tts --restart unless-stopped -p 5050:5050 -e API_KEY=mysecret travisvn/openai-edge-tts:latest
```

### 7.3 Kokoro (free, offline, English only)

A small open model that runs on your own machine, with no outside service at
all. It sounds natural, in English only.

```
docker run -d --name kokoro --restart unless-stopped -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

The first start downloads the model, so give it a minute. Then:

| Field | Value |
|---|---|
| Voice service | **OpenAI-compatible** |
| Server address | `http://localhost:8880/v1` |
| API key | empty |
| Model | `kokoro` |
| Voice | `af_bella` (others: `af_sky`, `af_heart`, `am_adam`, `bf_emma`) |

With an NVIDIA GPU, `ghcr.io/remsky/kokoro-fastapi-gpu:latest` with
`--gpus all` is much faster.

### 7.4 Where the server address points

The address is reached by the **backend**, not by your browser:

| Backend runs… | Server address |
|---|---|
| Directly on the same machine (`node server.js`) | `http://localhost:5050/v1` |
| In Docker, voice container on the same machine | `http://host.docker.internal:5050/v1` |
| In Docker Compose with the voice service added | `http://edge-tts:5050/v1` (the service name) |
| On a VPS | run the voice container on the same VPS and use `localhost` |

Don't open the voice port (5050 / 8880) to the internet. Only the backend
needs it.

### 7.5 Docker Compose

To run the voice service with the rest of the stack, add it to your
`docker-compose.yml`:

```yaml
services:
  edge-tts:
    image: travisvn/openai-edge-tts:latest
    restart: unless-stopped
    environment:
      - API_KEY=mysecret
    # No "ports:": only the backend reaches it, as http://edge-tts:5050/v1
```

---

## 8. Troubleshooting

The reason for a failure shows under the progress bar in the AI video
section.

| Message | Cause | Fix |
|---|---|---|
| `answered 401: Invalid API key` | The key in the app doesn't match the service | Retype the key in Settings, click **Save voice**. For edge-tts it must equal `API_KEY` in `docker run` |
| `answered 401` (Azure) | Wrong key, or a region that isn't the resource's | Copy Key 1 and the Region again from Keys and Endpoint |
| `answered 403` (Google) | The API isn't enabled, or the key is restricted to another API | Enable Cloud Text-to-Speech API; check the key's API restrictions |
| `answered 400` (Google/Azure) | Unknown voice name | Use a name from the lists above, spelt exactly |
| `answered 500: No audio was received` (edge-tts) | Wrong voice name, a voice in another language than the text, or an outdated image | Check the voice names; update the image (7.2); run the test |
| `fetch failed` / `ECONNREFUSED` | The voice server isn't running or the address is wrong | `docker ps`; check the address (7.4) |
| `took too long to answer` | Slow server (Kokoro on CPU with long parts) | Use the GPU image, or shorter parts |
| `No voice is set up` | Voice service is "No voice" | Choose one in Settings |
| Button says **Redo voice** but you want only changed parts | All parts are already voiced | Edit a part's narration and save: only it needs a voice again |

To see edge-tts or Kokoro errors: `docker logs edge-tts` (or `kokoro`).

---

## 9. Good to know

- **Changing services**: existing audio stays. Click **Redo voice** on a
  lesson to hear the new voice. A recorded MP4 keeps its old sound until you
  record it again.
- **Storage**: audio files are small (about 50 KB per part). They go to the
  storage in use when they are made; switching to S3 later doesn't move old
  files, which keep working.
- **Keys** are stored encrypted, and the settings page shows only their last
  four characters.
- **Bangla quality** varies most between services. Try Azure's
  `bn-BD-NabanitaNeural` first.
