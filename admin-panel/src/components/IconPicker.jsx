import { X, UploadCloud, RotateCcw } from "lucide-react";
import BatchIcon, { ICON_PRESETS } from "./BatchIcon";
import AiImageButton from "./AiImage";
import { useTerms } from "../terms";

// Shared between BatchDetail (editing an existing batch's icon), Batches
// (picking one while creating a new batch), and Settings (per-feature
// student-UI icon overrides) — same picker every time, just called with
// whatever the current draft icon is and however the caller wants to
// receive the result.
//
// "Reset to default" is opt-in via `onReset`/`isDefault` rather than
// something this component decides on its own, because "default" means a
// different thing to each caller: a batch's icon always holds *some* value
// (GraduationCap, per Batch.icon's schema default), so its reset re-picks
// that preset — but a feature-icon override's default is *no override at
// all* (undefined, falling back to that feature's own built-in icon), which
// picking any preset — including GraduationCap — would NOT reproduce. Only
// each caller knows which of those it means, so each passes its own
// `onReset`. Previously there was no reset affordance at all: the grid could
// only ever set a value, never clear back to "unchanged", which is exactly
// what made a feature-icon override impossible to undo once picked.
export default function IconPicker({ currentIcon, uploading, isDefault, onPickPreset, onUpload, onReset, onClose, onAiPicture, aiContext = "" }) {
  const terms = useTerms();
  return (
    <div className="card stack" style={{ marginTop: 8 }}>
      <div className="spread">
        <span className="label">Choose an icon</span>
        {onClose && <button className="icon-btn" onClick={onClose}><X size={15} /></button>}
      </div>

      {/* A custom image is shown big enough to judge, with a full-size link:
          the batch header only shows it as a small icon. */}
      {currentIcon?.kind === "custom" && currentIcon.value && (
        <div className="stack" style={{ gap: 6 }}>
          <img
            src={currentIcon.value}
            alt={`Current ${terms.batch} image`}
            style={{ width: "100%", maxWidth: 260, aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-alt, transparent)" }}
          />
          <a href={currentIcon.value} target="_blank" rel="noreferrer" className="hint">Open full size</a>
        </div>
      )}

      {onReset && !isDefault && (
        <button
          type="button"
          className="btn btn-sm btn-quiet"
          style={{ alignSelf: "flex-start" }}
          onClick={onReset}
        >
          <RotateCcw size={13} /> Reset to default
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 6 }}>
        {ICON_PRESETS.map((name) => (
          <button
            key={name}
            type="button"
            className="icon-btn"
            title={name}
            style={{
              height: 40,
              border: currentIcon?.kind === "preset" && currentIcon.value === name ? "2px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: 8,
            }}
            onClick={() => onPickPreset(name)}
          >
            <BatchIcon icon={{ kind: "preset", value: name }} size={18} />
          </button>
        ))}
      </div>

      {onUpload ? (
        <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
          <label className="btn btn-sm btn-quiet" style={{ cursor: "pointer" }}>
            <UploadCloud size={13} /> {uploading ? "Uploading" : "Upload a custom image"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
            />
          </label>
          {onAiPicture && (
            <AiImageButton kind="picture" purpose="course" defaultShape="square" label="Make one with AI" context={aiContext} onPicture={onAiPicture} />
          )}
        </div>
      ) : (
        <span className="hint">A custom uploaded image can be added once the {terms.batch} is created.</span>
      )}
    </div>
  );
}
