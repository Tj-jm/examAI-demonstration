import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  ChevronUp, ChevronDown, Trash2, Plus, Code2, Save, AlertTriangle,
  Layout, BarChart3, GraduationCap, Info, Megaphone, Sparkles, PanelBottom, HelpCircle, Users, PhoneCall,
} from "lucide-react";
import { useGetLandingPageQuery, useUpdateLandingPageSectionsMutation, useGetBatchesQuery, useGetProfilePeopleQuery } from "../api/contentApi";
import { Loading, ErrorNote, Field } from "../components/bits";
import { ImagePicker } from "../components/MediaPickers";
import AiWrite from "../components/AiWrite";
import MarkdownEditor from "../components/MarkdownEditor";
import { useTerms } from "../terms";

// Human labels and icons for the seven fixed types — customHtml gets its
// own treatment below since, unlike these, there can be any number of them.
const SECTION_META = {
  hero: { label: "Hero", Icon: Layout },
  stats: { label: "Stats", Icon: BarChart3 },
  catalogue: { label: "Course catalogue", Icon: GraduationCap },
  teachers: { label: "Teachers", Icon: Users },
  about: { label: "About us", Icon: Info },
  faq: { label: "FAQ", Icon: HelpCircle },
  notices: { label: "Announcements", Icon: Megaphone },
  updates: { label: "Updates", Icon: Sparkles },
  interest: { label: "Interest form", Icon: PhoneCall },
  footer: { label: "Footer", Icon: PanelBottom },
};

// Every fixed type always exists — this only ever reorders, toggles, and
// edits content, matching what the backend's validateSections actually
// enforces (see landingPageController.js): removing one of these entirely
// is not an option here at all, only switching it off.
export default function LandingPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGetLandingPageQuery();
  const [save, { isLoading: saving, error: saveError, isSuccess }] = useUpdateLandingPageSectionsMutation();

  const [draft, setDraft] = useState(null);
  const [openId, setOpenId] = useState(null);

  // Seeded once from the fetched document — after that, this page owns its
  // own copy until Save is pressed, same as every other multi-field editor
  // in this admin panel.
  useEffect(() => {
    if (data && !draft) setDraft(data.sections);
  }, [data, draft]);

  if (isLoading || !draft) return <Loading />;

  const move = (index, direction) => {
    const next = [...draft];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  };

  const toggle = (id) => setDraft(draft.map((s) => (s._id === id ? { ...s, enabled: !s.enabled } : s)));
  const setContent = (id, content) => setDraft(draft.map((s) => (s._id === id ? { ...s, content } : s)));

  const addCustomHtml = () => {
    const section = { _id: `new-${Date.now()}`, type: "customHtml", enabled: true, content: { html: "", label: "" } };
    setDraft([...draft, section]);
    setOpenId(section._id);
  };

  const removeCustomHtml = (id) => {
    setDraft(draft.filter((s) => s._id !== id));
    if (openId === id) setOpenId(null);
  };

  const saveAll = async () => {
    // Temporary ids (assigned above for brand-new customHtml blocks, so
    // React has something to key on before the server assigns a real one)
    // are stripped before sending — sending one back as a real _id would
    // have Mongo try to match an ObjectId that was never actually one.
    const payload = draft.map(({ _id, ...rest }) => (String(_id).startsWith("new-") ? rest : { _id, ...rest }));
    await save({ sections: payload }).unwrap();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Landing page</h1>
        <button className="btn" disabled={saving} onClick={saveAll}>
          <Save size={15} /> {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      <p className="hint" style={{ marginBottom: 16 }}>
        This is what a visitor sees at your site's root before they log in. Reorder, switch sections on or
        off, and edit their content below — nothing here changes what a logged-in student sees.
      </p>

      <ErrorNote error={error || saveError} />
      {isSuccess && <div className="banner banner-ok" style={{ marginBottom: 12 }}>Saved.</div>}

      <div className="stack" style={{ gap: 10 }}>
        {draft.map((section, index) => {
          const meta = SECTION_META[section.type] || { label: "Custom HTML", Icon: Code2 };
          const isOpen = openId === section._id;
          const isCustom = section.type === "customHtml";

          return (
            <div key={section._id} className="card stack" style={{ gap: 10 }}>
              <div className="spread">
                <div className="row-tight grow">
                  <div className="stack" style={{ gap: 0 }}>
                    <button className="icon-btn" title="Move up" disabled={index === 0} onClick={() => move(index, -1)} style={{ height: 18 }}>
                      <ChevronUp size={13} />
                    </button>
                    <button className="icon-btn" title="Move down" disabled={index === draft.length - 1} onClick={() => move(index, 1)} style={{ height: 18 }}>
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <meta.Icon size={16} className="muted" />
                  <span className="small" style={{ fontWeight: 500 }}>
                    {isCustom ? (section.content?.label || "Custom HTML block") : meta.label}
                  </span>
                  {!section.enabled && <span className="pill">Hidden</span>}
                </div>
                <div className="row-tight">
                  <label className="row-tight small" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={section.enabled} onChange={() => toggle(section._id)} />
                    Visible
                  </label>
                  <button className="btn btn-sm btn-quiet" onClick={() => setOpenId(isOpen ? null : section._id)}>
                    {isOpen ? "Close" : "Edit"}
                  </button>
                  {isCustom && (
                    <button className="icon-btn icon-btn-danger" title="Remove this section" onClick={() => removeCustomHtml(section._id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <SectionEditor
                  section={section}
                  onChange={(content) => setContent(section._id, content)}
                  onManageUpdates={() => navigate("/updates")}
                />
              )}
            </div>
          );
        })}

        <button className="btn btn-quiet" onClick={addCustomHtml}>
          <Plus size={15} /> Add a custom HTML section
        </button>
      </div>
    </div>
  );
}

// Shared pill-row control for the "which arrangement" choice every section
// below now has. Kept as one component rather than four near-identical
// blocks so a fifth section can add its own layout choice the same way.
function LayoutPicker({ label, value, defaultValue, options, onChange, hint }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        {options.map(([v, optionLabel]) => (
          <button
            key={v}
            className={`pill pill-btn${(value || defaultValue) === v ? " pill-on" : ""}`}
            onClick={() => onChange(v)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
      {hint && <p className="hint" style={{ margin: "4px 0 0" }}>{hint}</p>}
    </div>
  );
}

// The Split hero layout's right-side panel — picking which live batches
// show there, in what order, so it's not always just "whichever three
// happen to sort first."
function HeroFeaturedBatchesPicker({ content, set }) {
  const { data: batches } = useGetBatchesQuery({});
  const selected = content.featuredBatchIds || [];

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter((b) => b !== id) : [...selected, id];
    set({ featuredBatchIds: next });
  };

  return (
    <div className="field">
      <span className="label">Courses to showcase</span>
      <p className="hint" style={{ margin: "0 0 6px" }}>
        Shown in the Split layout's panel, in the order picked below. Leave
        none checked to fall back to your first three live batches.
      </p>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        {(batches || []).map((batch) => (
          <button
            key={batch._id}
            className={`pill pill-btn${selected.includes(batch._id) ? " pill-on" : ""}`}
            onClick={() => toggle(batch._id)}
          >
            {selected.includes(batch._id) ? `${selected.indexOf(batch._id) + 1}. ` : ""}{batch.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// Which teachers the landing page shows, in order. None picked shows every
// teacher whose profile is public.
function LandingTeachersPicker({ content, set }) {
  const terms = useTerms();
  // Owner, admins and teachers (the only roles with a public profile).
  // A hidden profile can't be picked: the landing page would skip it.
  const { data: people = [] } = useGetProfilePeopleQuery();
  const shown = new Set(people.filter((u) => u.public).map((u) => String(u._id)));
  const selected = (content.teacherIds || []).map(String);
  const toggle = (id) => set({ teacherIds: selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id] });
  // Picked earlier, since hidden, disabled or deleted.
  const stale = selected.filter((id) => !shown.has(id));
  return (
    <div className="field">
      <span className="label">Who to show</span>
      <p className="hint" style={{ margin: "0 0 6px" }}>
        Shown in the order picked. Pick none to show everyone (owner, admins and {terms.teachers}) whose profile is public.
        Photos, subjects, bios and the show/hide switch are on each person in <Link to="/team">Team</Link> (the profile button beside them).
      </p>
      <div className="row-tight" style={{ flexWrap: "wrap" }}>
        {people.map((u) => {
          const id = String(u._id);
          const on = selected.includes(id);
          return u.public ? (
            <button key={id} className={`pill pill-btn${on ? " pill-on" : ""}`} onClick={() => toggle(id)}>
              {on ? `${selected.indexOf(id) + 1}. ` : ""}{u.name}
            </button>
          ) : (
            <span key={id} className="pill muted" title="Profile hidden. Turn it on in Team to show them." style={{ opacity: 0.6 }}>
              {u.name} · hidden
            </span>
          );
        })}
      </div>
      {stale.length > 0 && (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          {stale.length} picked earlier {stale.length === 1 ? "is" : "are"} hidden, disabled or deleted and won't show.{" "}
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => set({ teacherIds: selected.filter((id) => shown.has(id)) })}>Remove</button>
        </p>
      )}
    </div>
  );
}

// What "Write with AI" fills in for each section type (backend/ai/writing.js).
const AI_SECTION = {
  hero: { section: "hero", apply: (d) => ({ heading: d.heading, subheading: d.subheading, ctaLabel: d.ctaLabel }) },
  about: { section: "about", apply: (d) => ({ heading: d.heading, body: d.body }) },
  faq: { section: "faq", apply: (d) => ({ heading: d.heading, items: d.items.map((i) => ({ question: i.q, answer: i.a })) }) },
  catalogue: { section: "catalogue", apply: (d) => ({ heading: d.heading, subheading: d.subheading }) },
  footer: { section: "footer", apply: (d) => ({ text: d.text }) },
  notices: { section: "heading", apply: (d) => ({ heading: d.heading }) },
  teachers: { section: "heading", apply: (d) => ({ heading: d.heading }) },
  updates: { section: "heading", apply: (d) => ({ heading: d.heading }) },
};

function SectionEditor(props) {
  const terms = useTerms();
  const { section, onChange } = props;
  const content = section.content || {};
  const ai = AI_SECTION[section.type];
  if (!ai) return <SectionFields {...props} />;
  const text = Object.fromEntries(["heading", "subheading", "ctaLabel", "body", "text", "items"]
    .filter((k) => content[k] && (!Array.isArray(content[k]) || content[k].length)).map((k) => [k, content[k]]));
  return (
    <div className="stack">
      <div className="row-tight" style={{ justifyContent: "flex-end" }}>
        <AiWrite
          task="landingSection"
          label="Write section with AI"
          promptLabel="About your institution, and what this section should say"
          placeholder={`e.g. HSC and admission coaching in Dhaka since 2012, small ${terms.batches}, weekly mock exams`}
          input={{ section: ai.section, current: Object.keys(text).length ? text : undefined }}
          onResult={(d) => onChange({ ...content, ...ai.apply(d) })}
        />
      </div>
      <SectionFields {...props} />
    </div>
  );
}

function SectionFields({ section, onChange, onManageUpdates }) {
  const terms = useTerms();
  const content = section.content || {};
  const set = (patch) => onChange({ ...content, ...patch });

  switch (section.type) {
    case "hero":
      return (
        <div className="stack">
          <LayoutPicker
            label="Hero layout"
            value={content.heroLayout}
            defaultValue="classic"
            onChange={(v) => set({ heroLayout: v })}
            options={[
              ["classic", "Classic (current)"],
              ["split", "Split"],
              ["centeredCards", "Centered cards"],
            ]}
            hint={`Classic is the current centered layout. Split puts the heading beside a live ${terms.batch} panel; centered cards adds feature cards below a centered heading.`}
          />
          {content.heroLayout === "split" && (
            <HeroFeaturedBatchesPicker content={content} set={set} />
          )}
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <Field label="Subheading">
            <textarea className="textarea" rows={2} value={content.subheading || ""} onChange={(e) => set({ subheading: e.target.value })} />
          </Field>
          <Field label="Button text" hint="Sends a logged-out visitor to log in.">
            <input className="input" value={content.ctaLabel || ""} onChange={(e) => set({ ctaLabel: e.target.value })} placeholder="Get started" />
          </Field>
          <div className="field">
            <span className="label">Background image</span>
            <p className="hint" style={{ margin: "0 0 6px" }}>Optional. A themed background is used if you skip this.</p>
            <ImagePicker
              folder="landing"
              label="Background image"
              ai="picture"
              aiPurpose="landing"
              aiContext={content.heading || ""}
              value={content.backgroundImage}
              url={content.backgroundImageUrl}
              onChange={(id, url) => set({ backgroundImage: id, backgroundImageUrl: url })}
            />
          </div>
        </div>
      );

    case "stats":
      return (
        <div className="stack">
          <LayoutPicker
            label="Stats layout"
            value={content.statsLayout}
            defaultValue="classic"
            onChange={(v) => set({ statsLayout: v })}
            options={[
              ["classic", "Classic (current)"],
              ["cards", "Cards"],
              ["inline", "Inline strip"],
            ]}
            hint="Classic is today's plain number grid. Cards puts each stat in its own bordered tile. Inline strip is a single compact row divided by rules."
          />
          <ListEditor
            items={content.items || []}
            onChange={(items) => set({ items })}
            fields={[{ key: "value", placeholder: "10,000+" }, { key: "label", placeholder: "Students enrolled" }]}
            addLabel="Add a stat"
            emptyLabel="No stats yet — add one below."
          />
        </div>
      );

    case "catalogue":
      return (
        <div className="stack">
          <LayoutPicker
            label="Catalogue layout"
            value={content.catalogueLayout}
            defaultValue="grid"
            onChange={(v) => set({ catalogueLayout: v })}
            options={[
              ["grid", "Grid (current)"],
              ["list", "List"],
              ["carousel", "Carousel"],
            ]}
            hint="Grid is today's wrapped card grid. List shows compact rows. Carousel scrolls the same cards horizontally — best when you have many batches."
          />
          {content.catalogueLayout !== "list" && (
            <LayoutPicker
              label="Card style"
              value={content.catalogueCard}
              defaultValue="classic"
              onChange={(v) => set({ catalogueCard: v })}
              options={[
                ["classic", "Photo + logo (current)"],
                ["logo", "Logo"],
                ["photo", "Photo"],
              ]}
              hint="Photo + logo puts the program's photo above the batch's logo. Logo shows only the batch's logo on a tinted cover. Photo shows only the program's photo, with the batch's name and price over it."
            />
          )}
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <Field label="Subheading" hint="Optional.">
            <input className="input" value={content.subheading || ""} onChange={(e) => set({ subheading: e.target.value })} />
          </Field>
          <p className="hint" style={{ margin: 0 }}>
            The courses shown here are always your live, active batches — nothing about which ones appear is set here.
          </p>
        </div>
      );

    case "about":
      return (
        <div className="stack">
          <LayoutPicker
            label="About layout"
            value={content.aboutLayout}
            defaultValue="classic"
            onChange={(v) => set({ aboutLayout: v })}
            options={[
              ["classic", "Classic (current)"],
              ["imageRight", "Image right"],
              ["centered", "Centered"],
            ]}
            hint="Classic puts the image on the left, text on the right. Image right swaps that order. Centered drops the side-by-side split and shows the image (if any) above centered text."
          />
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <MarkdownEditor label="Body" mono={false} minHeight={130} value={content.body || ""} onChange={(v) => set({ body: v })} />
          <div className="field">
            <span className="label">Image</span>
            <p className="hint" style={{ margin: "0 0 6px" }}>Optional.</p>
            <ImagePicker
              folder="landing"
              label="Image"
              ai="picture"
              aiPurpose="landing"
              aiContext={content.heading || ""}
              value={content.image}
              url={content.imageUrl}
              onChange={(id, url) => set({ image: id, imageUrl: url })}
            />
          </div>
        </div>
      );

    case "faq":
      return (
        <div className="stack">
          <LayoutPicker
            label="FAQ layout"
            value={content.faqLayout}
            defaultValue="accordion"
            onChange={(v) => set({ faqLayout: v })}
            options={[
              ["accordion", "Accordion (current)"],
              ["twoColumn", "Two column"],
              ["cards", "Cards"],
            ]}
            hint="Accordion collapses each question until clicked. Two column and Cards show every answer already expanded — two column is compact side-by-side, Cards is a single column of bordered tiles."
          />
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <ListEditor
            items={content.items || []}
            onChange={(items) => set({ items })}
            fields={[{ key: "question", placeholder: "Question" }, { key: "answer", placeholder: "Answer" }]}
            addLabel="Add a question"
            emptyLabel="No questions yet — add one below."
          />
        </div>
      );


    case "teachers":
      return (
        <div className="stack">
          <LayoutPicker
            label="Teachers layout"
            value={content.teachersLayout}
            defaultValue="grid"
            onChange={(v) => set({ teachersLayout: v })}
            options={[
              ["grid", "Grid"],
              ["carousel", "Carousel"],
              ["list", "List"],
            ]}
            hint="Grid shows photo cards in rows. Carousel scrolls them sideways. List shows each teacher with more of their bio. A visitor taps a teacher to read their full profile."
          />
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <Field label="Subheading" hint="Optional.">
            <input className="input" value={content.subheading || ""} onChange={(e) => set({ subheading: e.target.value })} />
          </Field>
          <LandingTeachersPicker content={content} set={set} />
        </div>
      );

    case "notices":
      return (
        <div className="stack">
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <p className="hint" style={{ margin: 0 }}>
            Shows up to 3 of your live general notices — the same ones logged-in students see on their own
            homepage. Nothing here is editable separately; post or edit a general notice on the Notices page.
          </p>
        </div>
      );

    case "updates":
      return (
        <div className="stack">
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <p className="hint" style={{ margin: 0 }}>
            Shows your most recent updates. Add or edit the actual announcements on a dedicated page.
          </p>
          <button type="button" className="btn btn-sm btn-quiet" onClick={onManageUpdates} style={{ alignSelf: "flex-start" }}>
            Manage updates →
          </button>
        </div>
      );

    case "interest":
      return (
        <div className="stack">
          <p className="hint" style={{ margin: 0 }}>
            Visitors leave their name and phone number; they show up under <Link to="/leads">Leads</Link> for you to follow up.
          </p>
          <Field label="Heading">
            <input className="input" value={content.heading || ""} onChange={(e) => set({ heading: e.target.value })} />
          </Field>
          <Field label="Line under it">
            <input className="input" value={content.subheading || ""} onChange={(e) => set({ subheading: e.target.value })} />
          </Field>
          <Field label="Button">
            <input className="input" value={content.button || ""} onChange={(e) => set({ button: e.target.value })} placeholder="Call me back" />
          </Field>
          <Field label="Thank-you message">
            <input className="input" value={content.thanks || ""} onChange={(e) => set({ thanks: e.target.value })} />
          </Field>
          <label className="row-tight small"><input type="checkbox" checked={content.askBatch !== false} onChange={(e) => set({ askBatch: e.target.checked })} /> Ask which course</label>
          <label className="row-tight small"><input type="checkbox" checked={Boolean(content.askEmail)} onChange={(e) => set({ askEmail: e.target.checked })} /> Ask for an email too (then the phone is optional)</label>
          <label className="row-tight small"><input type="checkbox" checked={Boolean(content.askMessage)} onChange={(e) => set({ askMessage: e.target.checked })} /> Let them write a question</label>
        </div>
      );

    case "footer":
      return (
        <div className="stack">
          <Field label="Footer text" hint="A short line — a copyright notice, a tagline.">
            <textarea className="textarea" rows={2} value={content.text || ""} onChange={(e) => set({ text: e.target.value })} />
          </Field>
          <ListEditor
            items={content.links || []}
            onChange={(links) => set({ links })}
            fields={[{ key: "label", placeholder: "Privacy policy" }, { key: "url", placeholder: "https://…" }]}
            addLabel="Add a link"
            emptyLabel="No footer links yet."
          />
        </div>
      );

    case "customHtml":
      return (
        <div className="stack">
          <Field label="Section name" hint="Just for your own reference in this list — not shown to visitors.">
            <input className="input" value={content.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Testimonials" />
          </Field>
          <div className="banner" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span className="small">
              This renders exactly as written, directly on your public landing page — no sanitizing. Only
              paste HTML you trust completely.
            </span>
          </div>
          <Field label="HTML">
            <textarea
              className="textarea"
              rows={10}
              style={{ fontFamily: "monospace", fontSize: 13 }}
              value={content.html || ""}
              onChange={(e) => set({ html: e.target.value })}
              placeholder="<section>…</section>"
            />
          </Field>
        </div>
      );

    default:
      return null;
  }
}

// A small repeatable {key: value} row editor — used for stats (value/label
// pairs) and footer links (label/url pairs). Two fields per row is the only
// shape either of those needs, so this stays generic rather than being
// split into two near-identical components.
function ListEditor({ items, onChange, fields, addLabel, emptyLabel }) {
  const update = (index, key, value) => {
    const next = items.map((item, i) => (i === index ? { ...item, [key]: value } : item));
    onChange(next);
  };
  const remove = (index) => onChange(items.filter((_, i) => i !== index));
  const add = () => onChange([...items, Object.fromEntries(fields.map((f) => [f.key, ""]))]);

  return (
    <div className="stack" style={{ gap: 6 }}>
      {items.length === 0 && <p className="hint" style={{ margin: 0 }}>{emptyLabel}</p>}
      {items.map((item, index) => (
        <div key={index} className="row-tight">
          {fields.map((f) => (
            <input
              key={f.key}
              className="input"
              style={{ flex: 1 }}
              value={item[f.key] || ""}
              placeholder={f.placeholder}
              onChange={(e) => update(index, f.key, e.target.value)}
            />
          ))}
          <button type="button" className="icon-btn icon-btn-danger" onClick={() => remove(index)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-quiet" onClick={add} style={{ alignSelf: "flex-start" }}>
        <Plus size={13} /> {addLabel}
      </button>
    </div>
  );
}
