import { useEffect, useState } from "react";
import { useGetAiConfigQuery, useUpdateAiConfigMutation } from "../api/aiConfigApi";
import { ErrorNote, Field } from "./bits";

// Settings → AI → Features: the image model for AI pictures (backend
// ai/images.js). Diagrams use the main AI model and need nothing here.
const PROVIDERS = [
  ["none", "No pictures", "The AI picture button stays off. AI diagrams still work."],
  ["openai", "OpenAI", "gpt-image-1. Good with simple scenes and illustrations."],
  ["gemini", "Google Gemini", "Imagen 4, or Gemini's own picture models (\"Nano Banana\"), which may have a free daily allowance."],
  ["openrouter", "OpenRouter", "One key for many picture models, e.g. google/gemini-2.5-flash-image (Nano Banana). Paid from your OpenRouter credit."],
  ["cloudflare", "Cloudflare Workers AI", "Leonardo Lucid Origin, Phoenix, FLUX and others. Paid per picture from your Cloudflare account, with a small free daily allowance."],
  ["local", "Your own server (LocalAI)", "Free per picture. Runs open models like FLUX.1 schnell or SDXL on your own graphics card."],
];
const MODEL_HINT = {
  openai: "Empty: gpt-image-1. gpt-image-2 is newer and about as cheap at low quality.",
  openrouter: "Empty: google/gemini-2.5-flash-image. Any OpenRouter model that outputs images.",
  gemini: "Empty: imagen-4.0-generate-001 (paid). Or a Gemini picture model, e.g. gemini-2.5-flash-image.",
  cloudflare: "Empty: @cf/leonardo/lucid-origin. Any Workers AI text-to-image model, e.g. @cf/black-forest-labs/flux-1-schnell.",
  local: "Required. The model's name on your server, e.g. flux.1-schnell or stablediffusion.",
};

export default function ImageSettings() {
  const { data: config } = useGetAiConfigQuery();
  const [update, { isLoading: saving, error }] = useUpdateAiConfigMutation();
  const [form, setForm] = useState(null);
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config && !form) setForm({ provider: "none", baseUrl: "", model: "", quality: "low", useMainKey: true, ...(config.images || {}) });
  }, [config, form]);
  if (!form) return null;

  const set = (patch) => {
    setForm({ ...form, ...patch, ...(patch.provider && patch.provider !== form.provider ? { model: "" } : {}) });
    setSaved(false);
  };
  // The AI key works for pictures when the text model is the same company.
  const sameCompany = form.provider === "openrouter"
    ? config.provider === "custom" && /openrouter\.ai/i.test(config.baseUrl || "")
    : !["none", "local"].includes(form.provider) && config.provider === form.provider;
  const reuseKey = sameCompany && form.useMainKey;
  const local = form.provider === "local";

  const save = async () => {
    const body = { provider: form.provider, baseUrl: form.baseUrl, model: form.model, quality: form.quality, useMainKey: form.useMainKey };
    if (key) body.key = key;
    const r = await update({ images: body });
    if (!r.error) { setKey(""); setSaved(true); }
  };

  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>AI pictures</h2>
      <p className="hint" style={{ margin: 0 }}>
        Used by "AI picture" on notice covers and landing page images. Each picture is one paid call to the service you pick here.
      </p>
      <Field label="Picture service">
        <div className="stack" style={{ gap: 8 }}>
          {PROVIDERS.map(([v, l, h]) => (
            <label key={v} className="row-tight" style={{ gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="radio" name="image-provider" checked={form.provider === v} onChange={() => set({ provider: v })} style={{ marginTop: 3 }} />
              <span><span style={{ fontWeight: 500 }}>{l}</span><div className="hint">{h}</div></span>
            </label>
          ))}
        </div>
      </Field>
      {form.provider !== "none" && (
        <>
          {sameCompany && (
            <label className="row-tight" style={{ gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.useMainKey} onChange={(e) => set({ useMainKey: e.target.checked })} />
              <span>Use the AI key from Connection</span>
            </label>
          )}
          {local && (
            <Field label="Server address" hint="Where LocalAI runs, e.g. http://localhost:8080. It must be reachable from this server, not just your computer. Pictures can take a minute or more.">
              <input autoComplete="off" className="input" value={form.baseUrl} placeholder="http://localhost:8080"
                onChange={(e) => set({ baseUrl: e.target.value })} />
            </Field>
          )}
          {form.provider === "cloudflare" && (
            <Field label="Account ID" hint="On the Cloudflare dashboard: Workers AI → Use REST API.">
              <input autoComplete="off" className="input" value={form.baseUrl} placeholder="32 letters and digits"
                onChange={(e) => set({ baseUrl: e.target.value })} />
            </Field>
          )}
          {!reuseKey && (
            <Field label={local ? "API key (optional)" : "API key"} hint={config.images?.hasKey ? `Saved, ends in …${config.images.keyLast4}. Type a new one to replace it.` : local ? "Only if your server asks for one." : form.provider === "cloudflare" ? "Required: an API token with Workers AI permission." : "Required."}>
              <input className="input" type="password" autoComplete="new-password" value={key} placeholder={config.images?.hasKey ? "••••••••" : ""}
                onChange={(e) => { setKey(e.target.value); setSaved(false); }} />
            </Field>
          )}
          <Field label="Model" hint={MODEL_HINT[form.provider]}>
            <input autoComplete="off" className="input" value={form.model} onChange={(e) => set({ model: e.target.value })} />
          </Field>
          {form.provider === "openai" && (
            <Field label="Quality" hint="Sets the price. Roughly per square picture with gpt-image-2: low about $0.006, medium about $0.05, high about $0.21.">
              <select className="select" value={form.quality} onChange={(e) => set({ quality: e.target.value })}>
                <option value="low">Low (cheapest)</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>
          )}
        </>
      )}
      <div className="row-tight" style={{ gap: 10 }}>
        <button className="btn" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save pictures"}</button>
        {saved && <span className="hint">Saved.</span>}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
