import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { ErrorNote, Field } from "./bits";
import MarkdownEditor from "./MarkdownEditor";

// A teacher's public profile: what students and visitors see on the landing
// page's teachers section, in a batch's details and on its home page. Used
// only by an owner or admin, from Team. `upload(file)` stores a photo and
// resolves to { _id, url }.
export default function TeacherProfileForm({ initial, name, onSave, saving, error, upload, onCancel }) {
  const [draft, setDraft] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    if (!initial || draft) return;
    setDraft({ ...initial, subjects: (initial.subjects || []).join(", "), experienceYears: initial.experienceYears ?? "" });
    setPhotoUrl(initial.photoUrl || null);
  }, [initial, draft]);

  if (!draft) return null;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const media = await upload(file);
      set({ photo: media._id });
      setPhotoUrl(media.url);
    } catch (err) {
      setUploadError(err);
    } finally {
      setUploading(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...draft,
      subjects: draft.subjects.split(",").map((s) => s.trim()).filter(Boolean),
      experienceYears: draft.experienceYears === "" ? null : Number(draft.experienceYears),
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <ErrorNote error={error || uploadError} />
      <div className="row-tight" style={{ gap: 14 }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", overflow: "hidden", background: "var(--surface-alt)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 28, fontWeight: 500 }}>
          {photoUrl ? <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (name || "?").trim().charAt(0).toUpperCase()}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={pick} />
          <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 size={14} className="spin" /> : <Camera size={14} />} {photoUrl ? "Change photo" : "Add photo"}
          </button>
          {photoUrl && (
            <button type="button" className="btn btn-sm btn-quiet" onClick={() => { set({ photo: null }); setPhotoUrl(null); }}>
              <X size={14} /> Remove photo
            </button>
          )}
          <span className="hint">A square, face-forward photo looks best.</span>
        </div>
      </div>
      <Field label="Headline" hint="One line under the name, e.g. “Physics · HSC and admission”.">
        <input className="input" maxLength={120} value={draft.headline} onChange={(e) => set({ headline: e.target.value })} />
      </Field>
      <div className="row">
        <Field label="Subjects" hint="Separate with commas.">
          <input className="input" value={draft.subjects} placeholder="Physics, Higher Math" onChange={(e) => set({ subjects: e.target.value })} />
        </Field>
        <Field label="Years teaching">
          <input className="input" type="number" min={0} max={80} value={draft.experienceYears} onChange={(e) => set({ experienceYears: e.target.value })} />
        </Field>
      </div>
      <Field label="Qualifications" hint="e.g. “BSc in Physics, BUET”.">
        <input className="input" maxLength={300} value={draft.qualifications} onChange={(e) => set({ qualifications: e.target.value })} />
      </Field>
      <MarkdownEditor label="About" hint="Experience, achievements, how they teach. Students see this when they open the profile."
        mono={false} minHeight={110} maxLength={2000} value={draft.bio} onChange={(v) => set({ bio: v })} />
      <label className="row-tight small" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={draft.public !== false} onChange={(e) => set({ public: e.target.checked })} />
        Show this profile to students and on the landing page
      </label>
      <div className="row">
        <button className="btn" disabled={saving || uploading}>{saving ? "Saving" : "Save profile"}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
