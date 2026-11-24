import { useEffect, useState } from "react";
import { useGetSettingsQuery, useUpdateSettingsMutation } from "../api/contentApi";
import { ErrorNote, Field } from "./bits";
import BoardPlayer from "./BoardPlayer";

// Settings → AI → Video lessons: the board's colours and the logo and name
// in a corner (AppSettings.videoBoard; backend utils/videoLesson.js
// boardStyle). Used by every lesson, in the player and recorded videos.
const PRESETS = {
  whiteboard: ["Whiteboard", { board: "#fbfaf6", ink: "#1d2330", accent: "#2f6fdf" }],
  blackboard: ["Blackboard", { board: "#22272b", ink: "#f2f2ee", accent: "#ffd54f" }],
  greenboard: ["Green board", { board: "#1f3d30", ink: "#f4f1e8", accent: "#ffe082" }],
  dark: ["Dark", { board: "#0f172a", ink: "#e2e8f0", accent: "#38bdf8" }],
};
const CORNERS = [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]];

const SAMPLE = {
  title: "Sample",
  segments: [
    { _id: "a", say: "Two vectors are parallel when their parts are in the same ratio.", board: [{ type: "heading", text: "Parallel vectors" }, { type: "text", text: "$\\vec{A} \\parallel \\vec{B}$ when the ratios match:" }] },
    { _id: "b", say: "So m is four.", board: [{ type: "math", latex: "\\frac{2}{m} = \\frac{3}{6} = \\frac{1}{2}" }, { type: "answer", text: "$m = 4$" }] },
    { _id: "c", say: "Why does the ratio matter? Parallel means one is a stretch of the other. A common slip is mixing up the order.", board: [{ type: "newBoard" }, { type: "callout", kind: "think", text: "Why does the ratio matter?" }, { type: "callout", kind: "idea", text: "Parallel means one vector is a stretch of the other." }, { type: "callout", kind: "warning", text: "Keep the parts in the same order on both sides." }] },
  ],
};
const CALLOUT_LOOKS = [["soft", "Soft cards"], ["sticky", "Sticky notes"], ["marker", "Hand-drawn marker"], ["card", "Student bubble + index card"], ["quote", "Handwritten quote + highlighter"], ["plain", "Plain"]];

export default function VideoBoardSettings() {
  const { data: settings } = useGetSettingsQuery();
  const [update, { isLoading: saving, error }] = useUpdateSettingsMutation();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && !form) {
      const vb = settings.videoBoard || {};
      const base = PRESETS[vb.preset]?.[1] || PRESETS.whiteboard[1];
      setForm({ preset: vb.preset || "whiteboard", board: vb.board || base.board, ink: vb.ink || base.ink, accent: vb.accent || base.accent, showLogo: Boolean(vb.showLogo), showName: Boolean(vb.showName), corner: vb.corner || "tr", callouts: vb.callouts || "soft" });
    }
  }, [settings, form]);
  if (!form) return null;

  const set = (patch) => { setForm({ ...form, ...patch }); setSaved(false); };
  const colours = form.preset === "custom" ? form : PRESETS[form.preset][1];
  const style = {
    ...colours, corner: form.corner, callouts: form.callouts, logo: form.showLogo ? settings.logo || null : null, name: form.showName ? settings.siteName || null : null,
  };
  const save = async () => {
    const r = await update({ videoBoard: { preset: form.preset, showLogo: form.showLogo, showName: form.showName, corner: form.corner, callouts: form.callouts, ...(form.preset === "custom" ? { board: form.board, ink: form.ink, accent: form.accent } : {}) } });
    if (!r.error) setSaved(true);
  };

  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}>Video board</h2>
      <p className="hint" style={{ margin: 0 }}>How the board looks in every AI video, in the player and in recorded videos. Record a video again to update it.</p>
      <Field label="Board">
        <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
          {[...Object.entries(PRESETS).map(([v, [l, c]]) => [v, l, c]), ["custom", "Custom", form]].map(([v, l, c]) => (
            <button key={v} type="button" className={`btn btn-sm${form.preset === v ? " btn-primary" : ""}`} onClick={() => set(v === "custom" ? { preset: v, ...colours } : { preset: v })}>
              <span style={{ width: 14, height: 14, borderRadius: 4, background: c.board, border: `2px solid ${c.accent}`, display: "inline-block" }} /> {l}
            </button>
          ))}
        </div>
      </Field>
      {form.preset === "custom" && (
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          {[["board", "Board colour"], ["ink", "Text colour"], ["accent", "Headings and answer box"]].map(([k, l]) => (
            <Field key={k} label={l}>
              <input type="color" value={form[k]} onChange={(e) => set({ [k]: e.target.value })} style={{ width: 64, height: 34, padding: 2, border: "1px solid var(--border)", borderRadius: 8, background: "transparent" }} />
            </Field>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="row-tight" style={{ gap: 6 }}>
          <input type="checkbox" checked={form.showLogo} disabled={!settings.logo} onChange={(e) => set({ showLogo: e.target.checked })} /> Logo
          {!settings.logo && <span className="hint">(upload one under Branding)</span>}
        </label>
        <label className="row-tight" style={{ gap: 6 }}>
          <input type="checkbox" checked={form.showName} onChange={(e) => set({ showName: e.target.checked })} /> Name ({settings.siteName || "site name"})
        </label>
        <Field label="Corner">
          <select className="select" value={form.corner} disabled={!form.showLogo && !form.showName} onChange={(e) => set({ corner: e.target.value })}>
            {CORNERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Thoughts and callouts">
          <select className="select" value={form.callouts} onChange={(e) => set({ callouts: e.target.value })}>
            {CALLOUT_LOOKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ maxWidth: 560 }}>
        <BoardPlayer key={JSON.stringify(style)} lesson={{ ...SAMPLE, style }} showCaptions={false} />
      </div>
      <div className="row-tight" style={{ gap: 10 }}>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save board"}</button>
        {saved && <span className="hint">Saved.</span>}
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
