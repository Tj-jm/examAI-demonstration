import { useEffect, useState } from "react";
import { useGetAiConfigQuery, useUpdateAiConfigMutation } from "../api/aiApi";
import { ErrorNote, Field } from "./bits";

// Settings → AI → Voice: the text-to-speech used for video lessons
// (backend ai/tts.js). OpenAI-compatible covers OpenAI and self-hosted
// speech servers that copy its /audio/speech API.
const PROVIDERS = [
  ["none", "No voice", "Video lessons play with captions only."],
  ["azure", "Azure AI Speech", "Microsoft's neural voices, Bangla included. Free tier: 0.5 million characters a month."],
  ["google", "Google Cloud Text-to-Speech", "Google's voices, Bangla (India) included. Free tier: 1 million WaveNet characters a month."],
  ["openai", "OpenAI-compatible", "OpenAI, or a self-hosted speech server with the same /audio/speech API. Leave the address empty for OpenAI."],
  ["elevenlabs", "ElevenLabs", "Natural voices in many languages. Needs an API key and a voice id."],
];

// What each field means for each service.
const FIELDS = {
  openai: {
    address: ["Server address", "https://api.openai.com/v1", "e.g. http://localhost:5050/v1 for a self-hosted server. Empty: https://api.openai.com/v1"],
    key: "Not needed for most self-hosted servers.",
    model: ["Model", "Empty: tts-1"],
    voice: ["Voice", "Empty: alloy", "alloy"],
    bangla: "Optional. A Bangla voice your server has.",
  },
  elevenlabs: {
    address: ["Server address", "https://api.elevenlabs.io", "Empty: https://api.elevenlabs.io"],
    key: "Required.",
    model: ["Model", "Empty: eleven_multilingual_v2"],
    voice: ["Voice id", "From your ElevenLabs voice library.", ""],
    bangla: "Optional. Used when a lesson's language is Bangla; try a few, quality varies a lot.",
  },
  azure: {
    address: ["Region", "eastus", "Your Speech resource's region, as on its Keys and Endpoint page (e.g. eastus, southeastasia)."],
    key: "Key 1 or Key 2 from the resource's Keys and Endpoint page.",
    model: null,
    voice: ["Voice", "Empty: en-US-AvaMultilingualNeural", "en-US-AvaMultilingualNeural"],
    bangla: "e.g. bn-BD-NabanitaNeural, bn-BD-PradeepNeural, bn-IN-TanishaaNeural.",
  },
  google: {
    address: null,
    key: "An API key allowed to use the Cloud Text-to-Speech API.",
    model: null,
    voice: ["Voice", "Empty: en-US-Wavenet-F", "en-US-Wavenet-F"],
    bangla: "e.g. bn-IN-Wavenet-A, bn-IN-Wavenet-B (WaveNet is in the free tier).",
  },
};

export default function VoiceSettings() {
  const { data: config } = useGetAiConfigQuery();
  const [update, { isLoading: saving, error }] = useUpdateAiConfigMutation();
  const [form, setForm] = useState(null);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config && !form) setForm({ provider: "none", baseUrl: "", model: "", voice: "", voiceBangla: "", ...(config.voice || {}) });
  }, [config, form]);
  if (!form) return null;

  // A different service: its own address and model, not the last one's.
  const set = (patch) => {
    setForm({ ...form, ...patch, ...(patch.provider && patch.provider !== form.provider ? { baseUrl: "", model: "" } : {}) });
    setSaved(false);
  };
  const save = async () => {
    const body = { provider: form.provider, baseUrl: form.baseUrl, model: form.model, voice: form.voice, voiceBangla: form.voiceBangla };
    if (key) body.key = key;
    const r = await update({ voice: body });
    if (!r.error) { setKey(""); setSaved(true); }
  };
  const f = FIELDS[form.provider];

  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>Voice for video lessons</h2>
      <p className="hint" style={{ margin: 0 }}>Reads each video lesson's narration aloud. The audio is saved in your file storage.</p>
      <Field label="Voice service">
        <div className="stack" style={{ gap: 8 }}>
          {PROVIDERS.map(([v, l, h]) => (
            <label key={v} className="row-tight" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="radio" name="voice-provider" checked={form.provider === v} onChange={() => set({ provider: v })} style={{ marginTop: 3 }} />
              <span><span style={{ fontWeight: 500 }}>{l}</span><div className="hint">{h}</div></span>
            </label>
          ))}
        </div>
      </Field>
      {form.provider !== "none" && (
        <>
          {f.address && (
            <Field label={f.address[0]} hint={f.address[2]}>
              <input autoComplete="off" className="input" value={form.baseUrl} placeholder={f.address[1]} onChange={(e) => set({ baseUrl: e.target.value })} />
            </Field>
          )}
          <Field label="API key" hint={config.voice?.hasKey ? `Saved, ends in …${config.voice.keyLast4}. Type a new one to replace it.` : f.key}>
            <input className="input" type="password" autoComplete="new-password" value={key} placeholder={config.voice?.hasKey ? "••••••••" : ""} onChange={(e) => { setKey(e.target.value); setSaved(false); }} />
          </Field>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {f.model && (
              <Field label={f.model[0]} hint={f.model[1]}>
                <input autoComplete="off" className="input" value={form.model} onChange={(e) => set({ model: e.target.value })} />
              </Field>
            )}
            <Field label={f.voice[0]} hint={f.voice[1]}>
              <input autoComplete="off" className="input" value={form.voice} placeholder={f.voice[2]} onChange={(e) => set({ voice: e.target.value })} />
            </Field>
            <Field label="Voice for Bangla lessons" hint={f.bangla}>
              <input autoComplete="off" className="input" value={form.voiceBangla} onChange={(e) => set({ voiceBangla: e.target.value })} />
            </Field>
          </div>
        </>
      )}
      <div className="row-tight" style={{ gap: 10 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save voice"}</button>
        {saved && <span className="hint">Saved.</span>}
        {form.provider !== "none" && config.voice?.hasKey && (
          <button className="btn btn-sm btn-quiet" disabled={saving} onClick={async () => { await update({ voice: { key: "" } }); setSaved(true); }}>Remove key</button>
        )}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
