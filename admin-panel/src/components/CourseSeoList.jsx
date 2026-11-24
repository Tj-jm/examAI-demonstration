import { useState } from "react";
import { ChevronDown, ChevronRight, Wand2, ExternalLink } from "lucide-react";
import { useGetCourseSeoQuery, useUpdateCourseSeoMutation, useSuggestSeoMetaMutation } from "../api/contentApi";
import { Loading, ErrorNote, Field } from "./bits";

// Settings → SEO → Course pages: each course page's own title, description,
// keywords and share picture (backend settingsController listCourseSeo).
// A field left empty is made from the course (utils/pageMeta.js); the
// placeholder shows what that is.

const filled = (seo) => Boolean(seo.metaTitle || seo.metaDescription || seo.keywords?.length || seo.ogImage);

// How the page reads in a search result.
function Snippet({ title, description, url }) {
  return (
    <div className="card-quiet stack" style={{ gap: 2, padding: "10px 12px" }}>
      <span className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</span>
      <span style={{ color: "#1a0dab", fontSize: 17, lineHeight: 1.3 }}>{title.length > 62 ? `${title.slice(0, 60)}…` : title}</span>
      <span className="small" style={{ color: "var(--text-muted)" }}>{description ? (description.length > 162 ? `${description.slice(0, 160)}…` : description) : "No description: search engines pick some text from the page."}</span>
    </div>
  );
}

function CourseForm({ course, base, onDone }) {
  const [form, setForm] = useState({ ...course.seo, keywords: (course.seo.keywords || []).join(", ") });
  const [save, { isLoading: saving, error }] = useUpdateCourseSeoMutation();
  const [suggest, { isLoading: drafting, error: draftError }] = useSuggestSeoMetaMutation();
  const set = (k, v) => setForm({ ...form, [k]: v });
  const url = `${base || ""}/courses/${course.slug}`;

  const draft = async () => {
    try {
      const r = await suggest({ batch: course._id }).unwrap();
      setForm({ ...form, metaTitle: r.metaTitle, metaDescription: r.metaDescription, keywords: (r.keywords || []).join(", ") });
    } catch {
      // shown by draftError
    }
  };

  return (
    <div className="stack" style={{ gap: 10, padding: "10px 0 4px 22px" }}>
      <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm btn-quiet" disabled={drafting} onClick={draft}><Wand2 size={13} /> {drafting ? "Drafting…" : "Draft with AI"}</button>
        <span className="hint" style={{ margin: 0 }}>From the course's name and description. Still needs Save.</span>
      </div>
      <ErrorNote error={draftError} />
      <Field label="Title" hint={`${(form.metaTitle || "").length}/60 characters. Empty: ${course.auto.metaTitle}`}>
        <input className="input" value={form.metaTitle} maxLength={120} placeholder={course.auto.metaTitle} onChange={(e) => set("metaTitle", e.target.value)} />
      </Field>
      <Field label="Description" hint={`${(form.metaDescription || "").length}/160 characters. Empty: made from the course description.`}>
        <textarea className="input" rows={3} value={form.metaDescription} maxLength={300} placeholder={course.auto.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} />
      </Field>
      <Field label="Keywords" hint="Comma-separated. Empty: the site's keywords.">
        <input className="input" value={form.keywords} onChange={(e) => set("keywords", e.target.value)} />
      </Field>
      <Field label="Share picture" hint="Shown when the link is shared. Empty: the program's cover.">
        <input className="input" value={form.ogImage} placeholder={course.auto.ogImage || "https://..."} onChange={(e) => set("ogImage", e.target.value)} />
      </Field>
      <Snippet title={form.metaTitle || course.auto.metaTitle} description={form.metaDescription || course.auto.metaDescription} url={url} />
      <ErrorNote error={error} />
      <div className="row-tight" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={saving} onClick={async () => {
          await save({ id: course._id, ...form, keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean) }).unwrap();
          onDone();
        }}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className="btn btn-quiet" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

export default function CourseSeoList() {
  const { data, isLoading, error } = useGetCourseSeoQuery();
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  if (isLoading) return <Loading />;
  const needle = q.trim().toLowerCase();
  const all = data?.courses || [];
  const courses = all.filter((c) => !needle || `${c.name} ${c.program}`.toLowerCase().includes(needle));
  const root = data?.base || "";

  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">Each course's search and share tags</span>
      <p className="hint" style={{ margin: 0 }}>
        Every course page already gets a title, description, picture and course details for Google, made from the course.
        Set your own here to choose the words people see in search results.
      </p>
      <ErrorNote error={error} />
      {all.length > 8 && <input className="input" placeholder="Search courses" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />}
      {!courses.length && <p className="hint" style={{ margin: 0 }}>No courses.</p>}
      {courses.map((c) => {
        const isOpen = open === c._id;
        return (
          <div key={c._id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
            <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="row-tight" onClick={() => setOpen(isOpen ? null : c._id)}
                style={{ background: "none", border: "none", padding: "4px 0", font: "inherit", color: "inherit", cursor: "pointer", gap: 6, textAlign: "left" }}>
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <strong>{c.name}</strong>
                {c.program && <span className="muted small">· {c.program}</span>}
              </button>
              <span className={`pill${filled(c.seo) ? " pill-ok" : ""}`}>{filled(c.seo) ? "Own tags" : "Automatic"}</span>
              {!c.isActive && <span className="pill">Hidden: not active</span>}
              {root ? (
                <a className="small muted row-tight" style={{ gap: 4, marginLeft: "auto" }} href={`${root}/courses/${c.slug}`} target="_blank" rel="noreferrer">
                  /courses/{c.slug} <ExternalLink size={12} />
                </a>
              ) : <span className="small muted" style={{ marginLeft: "auto" }}>/courses/{c.slug}</span>}
            </div>
            {isOpen && <CourseForm course={c} base={root} onDone={() => setOpen(null)} />}
          </div>
        );
      })}
    </div>
  );
}
