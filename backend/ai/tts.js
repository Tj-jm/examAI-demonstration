// Text-to-speech for video lessons (AiConfig.voice). Returns MP3 bytes.
//   openai:     any OpenAI-compatible POST {baseUrl}/audio/speech, OpenAI
//               itself or a self-hosted server.
//   elevenlabs: ElevenLabs' text-to-speech API.
//   azure:      Azure AI Speech (baseUrl is the resource's region, or
//               its full endpoint), SSML in, MP3 out.
//   google:     Google Cloud Text-to-Speech with an API key.
// Requests go to the admin-set url, server side, so it must be http(s).
const AiConfig = require("../models/aiConfigModel");

const TIMEOUT_MS = 90000;
const BANGLA_TEXT = /[\u0980-\u09FF]/;
const isBangla = (language) => /bangla|bengali|বাংলা/i.test(language || "");

const httpUrl = (value, fallback) => {
  const url = new URL(value || fallback);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The voice server url must start with http:// or https://.");
  return url.toString().replace(/\/+$/, "");
};

const post = async (url, headers, body) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`The voice service answered ${res.status}${text ? `: ${text}` : ""}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The voice service took too long to answer.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

// A raw (non-JSON) body, for Azure's SSML.
const postRaw = async (url, headers, body) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: ctrl.signal });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new Error(`The voice service answered ${res.status}${text ? `: ${text}` : res.status === 401 ? ": check the key and region" : ""}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e.name === "AbortError") throw new Error("The voice service took too long to answer.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
};
const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
// "bn-BD-NabanitaNeural" -> "bn-BD"
const langOf = (voiceName, fallback) => (String(voiceName).match(/^[a-z]{2,3}-[A-Z]{2}/) || [fallback])[0];

// What's set up, without the key, for the admin page and the lesson editor.
const status = async () => {
  const c = (await AiConfig.get()).voice || {};
  return { provider: c.provider || "none", ready: (c.provider || "none") !== "none" };
};

const speak = async (text, { language } = {}) => {
  const config = await AiConfig.get(true);
  const c = config.voice || {};
  const key = config.getVoiceKey();
  // Bangla by the lesson's language, or by the text itself (a lesson left
  // on "same as the source" for a Bangla question).
  const voice = ((isBangla(language) || BANGLA_TEXT.test(text)) && c.voiceBangla) || c.voice;
  if (!c.provider || c.provider === "none") throw Object.assign(new Error("No voice is set up. Choose one in Settings → AI → Voice."), { statusCode: 400 });

  if (c.provider === "openai") {
    const base = httpUrl(c.baseUrl, "https://api.openai.com/v1");
    return post(`${base}/audio/speech`, key ? { Authorization: `Bearer ${key}` } : {}, {
      model: c.model || "tts-1",
      voice: voice || "alloy",
      input: text,
      response_format: "mp3",
    });
  }

  if (c.provider === "elevenlabs") {
    if (!key) throw Object.assign(new Error("ElevenLabs needs an API key."), { statusCode: 400 });
    if (!voice) throw Object.assign(new Error("Pick an ElevenLabs voice id."), { statusCode: 400 });
    const base = httpUrl(c.baseUrl, "https://api.elevenlabs.io");
    return post(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, { "xi-api-key": key }, {
      text,
      model_id: c.model || "eleven_multilingual_v2",
    });
  }

  if (c.provider === "azure") {
    if (!key) throw Object.assign(new Error("Azure Speech needs its resource key."), { statusCode: 400 });
    if (!c.baseUrl) throw Object.assign(new Error("Azure Speech needs its region, e.g. eastus."), { statusCode: 400 });
    const name = voice || "en-US-AvaMultilingualNeural";
    const url = /^https?:/i.test(c.baseUrl)
      ? `${httpUrl(c.baseUrl)}/cognitiveservices/v1`
      : `https://${encodeURIComponent(c.baseUrl.trim())}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = `<speak version="1.0" xml:lang="${langOf(name, "en-US")}"><voice name="${escapeXml(name)}">${escapeXml(text)}</voice></speak>`;
    return postRaw(url, {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "examai",
    }, ssml);
  }

  if (c.provider === "google") {
    if (!key) throw Object.assign(new Error("Google Cloud Text-to-Speech needs an API key."), { statusCode: 400 });
    const name = voice || "en-US-Wavenet-F";
    const base = httpUrl(c.baseUrl, "https://texttospeech.googleapis.com");
    const json = await post(`${base}/v1/text:synthesize`, { "X-Goog-Api-Key": key }, {
      input: { text },
      voice: { languageCode: langOf(name, "en-US"), name },
      audioConfig: { audioEncoding: "MP3" },
    });
    const audio = JSON.parse(json.toString("utf8")).audioContent;
    if (!audio) throw new Error("Google sent no audio back.");
    return Buffer.from(audio, "base64");
  }

  throw new Error(`Unknown voice provider "${c.provider}".`);
};

// The voice with the time each word starts (seconds into the audio), for
// providers that report it: ElevenLabs (character timings) and Google
// (SSML marks). Others give the voice alone (marks null) and the player
// times words from their length. Words are the text split on spaces, the
// same way the players count them (boardTimeline.js).
const wordStarts = (chars, starts) => {
  const out = [];
  let prevSpace = true;
  for (let i = 0; i < chars.length; i += 1) {
    const space = /\s/.test(chars[i]);
    if (!space && prevSpace) out.push(Math.round((starts[i] || 0) * 1000) / 1000);
    prevSpace = space;
  }
  return out;
};
const speakTimed = async (text, { language } = {}) => {
  const config = await AiConfig.get(true);
  const c = config.voice || {};
  const key = config.getVoiceKey();
  const voice = ((isBangla(language) || BANGLA_TEXT.test(text)) && c.voiceBangla) || c.voice;
  const words = String(text).split(/\s+/).filter(Boolean);
  try {
    if (c.provider === "elevenlabs" && key && voice) {
      const base = httpUrl(c.baseUrl, "https://api.elevenlabs.io");
      const json = JSON.parse((await post(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, { "xi-api-key": key }, {
        text,
        model_id: c.model || "eleven_multilingual_v2",
      })).toString("utf8"));
      if (!json.audio_base64) throw new Error("ElevenLabs sent no audio back.");
      const a = json.alignment || json.normalized_alignment;
      const marks = a?.characters?.length ? wordStarts(a.characters, a.character_start_times_seconds || []) : null;
      return { mp3: Buffer.from(json.audio_base64, "base64"), marks: marks && marks.length === words.length ? marks : null };
    }
    if (c.provider === "google" && key) {
      const name = voice || "en-US-Wavenet-F";
      const base = httpUrl(c.baseUrl, "https://texttospeech.googleapis.com");
      const ssml = `<speak>${words.map((w, i) => `<mark name="w${i}"/>${escapeXml(w)}`).join(" ")}</speak>`;
      const json = JSON.parse((await post(`${base}/v1beta1/text:synthesize`, { "X-Goog-Api-Key": key }, {
        input: { ssml },
        voice: { languageCode: langOf(name, "en-US"), name },
        audioConfig: { audioEncoding: "MP3" },
        enableTimePointing: ["SSML_MARK"],
      })).toString("utf8"));
      if (!json.audioContent) throw new Error("Google sent no audio back.");
      const at = new Map((json.timepoints || []).map((t) => [t.markName, Number(t.timeSeconds) || 0]));
      const marks = words.map((_, i) => at.get(`w${i}`));
      return { mp3: Buffer.from(json.audioContent, "base64"), marks: marks.every((m) => Number.isFinite(m)) ? marks.map((m) => Math.round(m * 1000) / 1000) : null };
    }
  } catch (e) {
    // A timing call refused (an older server, a plan without it): the
    // plain voice instead. Key and quota errors fail there just the same.
    if (/answered 4(01|03)/.test(e.message)) throw e;
  }
  return { mp3: await module.exports.speak(text, { language }), marks: null };
};

// Seconds of audio in an MP3, from its frame headers: the Xing/Info frame
// count when there is one (variable bitrate), else size over bitrate.
const BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const mp3Duration = (buf) => {
  let i = 0;
  if (buf.slice(0, 3).toString() === "ID3") i = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
  for (; i < buf.length - 4; i += 1) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (buf[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 3; // 1 = Layer III
    if (version === 1 || layer !== 1) continue;
    const kbps = BITRATES[version === 3 ? 1 : 2][(buf[i + 2] >> 4) & 15];
    const rate = RATES[version]?.[(buf[i + 2] >> 2) & 3];
    if (!kbps || !rate) continue;
    const samples = version === 3 ? 1152 : 576;
    const mono = ((buf[i + 3] >> 6) & 3) === 3;
    const side = version === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17);
    const tag = buf.slice(i + 4 + side, i + 8 + side).toString();
    if ((tag === "Xing" || tag === "Info") && buf.readUInt32BE(i + 8 + side) & 1) {
      return Math.round((buf.readUInt32BE(i + 12 + side) * samples / rate) * 100) / 100;
    }
    return Math.round(((buf.length - i) * 8 / (kbps * 1000)) * 100) / 100;
  }
  return null;
};

module.exports = { speak, speakTimed, status, mp3Duration, isBangla };
