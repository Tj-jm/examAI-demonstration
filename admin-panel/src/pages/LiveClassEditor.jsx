import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useGetLiveClassQuery, useCreateLiveClassMutation, useUpdateLiveClassMutation, useGetBatchesQuery, useGetBatchQuery,
  useGetLiveProvidersQuery, useGetUsersQuery,
} from "../api/contentApi";
import { ArrowLeft, Video, Check, Copy, ExternalLink } from "lucide-react";
import { Loading, ErrorNote, Field } from "../components/bits";
import ChapterSelect from "../components/ChapterSelect";
import AiWrite, { AiTranslate } from "../components/AiWrite";
import MarkdownEditor from "../components/MarkdownEditor";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time — see NoticeEditor
// for the same conversion and why toISOString() alone would show the wrong
// time to anyone not in UTC.
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const emptyDraft = (webinar = false) => ({
  batch: "",
  countPay: false,
  title: "",
  description: "",
  scheduledAt: "",
  durationMinutes: 60,
  provider: webinar ? "livekit" : "manual",
  joinUrl: "",
  status: "scheduled",
  secured: false,
  mode: webinar ? "webinar" : "class",
  screenShare: "hosts",
  autoPublish: false,
  publishChapter: null,
  alternativeHostIds: [],
  extraHostEmails: "",
  teachers: null, // null until a batch is picked: then the batch's teachers
  public: { on: webinar, slug: "", entry: "otp", questions: "approve", cap: 500, blurb: "", closed: false, replay: true },
});

// One route for both jobs, same shape as NoticeEditor/LectureEditor.
// provider is locked after creation — switching it on an existing class
// would orphan whatever meeting (manual link or real Zoom meeting) is
// already stored on it, so a provider change means deleting and
// re-scheduling, not editing in place.
// webinar: the Webinars page's version. In-app, public by link, no batch.
export default function LiveClassEditor({ webinar: asWebinar = false }) {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const { data: existing, isLoading } = useGetLiveClassQuery(id, { skip: isNew });
  const webinar = asWebinar || existing?.kind === "webinar";
  const back = webinar ? "/webinars" : "/live-classes";
  const { data: batches } = useGetBatchesQuery({});
  const { data: providerData } = useGetLiveProvidersQuery();
  const providerReady = (name) => (providerData?.providers || []).find((p) => p.name === name)?.configured !== false;
  const [create, { isLoading: creating, error: createError }] = useCreateLiveClassMutation();
  const [update, { isLoading: updating, error: updateError }] = useUpdateLiveClassMutation();

  const [draft, setDraft] = useState(isNew ? emptyDraft(asWebinar) : null);

  // Only fetched once a batch is actually picked, and only matters for a
  // new Zoom class — this is where the teacher list (with emails) for the
  // alternative-hosts picker comes from.
  const { data: selectedBatch } = useGetBatchQuery(draft?.batch, { skip: !draft?.batch });

  useEffect(() => {
    if (!isNew && existing) {
      setDraft({
        batch: existing.batch?._id || existing.batch || "",
        countPay: Boolean(existing.countPay),
        title: existing.title,
        description: existing.description || "",
        scheduledAt: toLocalInput(existing.scheduledAt),
        durationMinutes: existing.durationMinutes,
        provider: existing.provider,
        joinUrl: existing.joinUrl || "",
        status: existing.status,
        secured: existing.secured || false,
        mode: existing.mode || "class",
        autoPublish: existing.autoPublish || false,
        publishChapter: existing.publishChapter?._id || existing.publishChapter || null,
        alternativeHostIds: [],
        extraHostEmails: "",
        teachers: (existing.teachers || []).map((t) => t._id || t),
        public: { ...emptyDraft().public, ...(existing.public || {}), slug: existing.public?.slug || "" },
      });
    }
  }, [isNew, existing]);

  const { data: teacherData } = useGetUsersQuery({ role: "teacher", limit: 100 });
  // A new class starts with the picked batch's teachers.
  const batchTeacherIds = (selectedBatch?.batch?.teachers || []).map((t) => t._id);
  useEffect(() => {
    if (isNew && draft?.batch && selectedBatch?.batch?._id === draft.batch) {
      setDraft((d) => ({ ...d, teachers: batchTeacherIds }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, draft?.batch, selectedBatch?.batch?._id]);

  if (!isNew && isLoading) return <Loading />;
  if (!draft) return null;

  const set = (patch) => setDraft({ ...draft, ...patch });

  // Only batches with the liveClasses capability switched on are worth
  // offering — scheduling one on a batch where the feature is off would
  // just 400 on submit, same reasoning batchController's own check exists.
  const eligibleBatches = (batches || []).filter((b) => b.features?.liveClasses);

  const valid =
    (webinar || draft.batch) &&
    draft.title.trim() &&
    draft.scheduledAt &&
    (draft.provider !== "manual" || draft.joinUrl.trim()) &&
    (!draft.autoPublish || draft.publishChapter);

  const save = async () => {
    if (isNew) {
      const teacherEmails = draft.provider === "zoom"
        ? (selectedBatch?.batch?.teachers || [])
            .filter((t) => draft.alternativeHostIds.includes(t._id) && t.email)
            .map((t) => t.email)
        : [];
      const extraEmails = draft.extraHostEmails
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      const body = webinar ? {
        kind: "webinar",
        countPay: draft.countPay,
        title: draft.title.trim(),
        description: draft.description,
        scheduledAt: new Date(draft.scheduledAt).toISOString(),
        durationMinutes: Number(draft.durationMinutes) || 60,
        screenShare: draft.screenShare,
        teachers: draft.teachers || [],
        public: draft.public,
      } : {
        batch: draft.batch,
        title: draft.title.trim(),
        description: draft.description,
        scheduledAt: new Date(draft.scheduledAt).toISOString(),
        durationMinutes: Number(draft.durationMinutes) || 60,
        provider: draft.provider,
        joinUrl: draft.provider === "manual" ? draft.joinUrl.trim() : undefined,
        alternativeHosts: draft.provider === "zoom" ? [...teacherEmails, ...extraEmails] : undefined,
        secured: draft.provider === "zoom" ? draft.secured : undefined,
        mode: draft.provider === "livekit" ? draft.mode : undefined,
        screenShare: draft.provider === "livekit" ? draft.screenShare : undefined,
        autoPublish: draft.provider === "livekit" ? draft.autoPublish : undefined,
        publishChapter: draft.provider === "livekit" && draft.autoPublish ? draft.publishChapter : undefined,
        teachers: draft.teachers || [],
        public: draft.provider === "livekit" && draft.public.on ? draft.public : undefined,
      };
      const result = await create(body);
      if (!result.error) navigate(back);
    } else {
      const body = {
        id,
        title: draft.title.trim(),
        description: draft.description,
        scheduledAt: new Date(draft.scheduledAt).toISOString(),
        durationMinutes: Number(draft.durationMinutes) || 60,
        status: draft.status,
        teachers: draft.teachers || [],
        ...(webinar ? { countPay: draft.countPay, public: draft.public } : draft.provider === "livekit" ? { autoPublish: draft.autoPublish, publishChapter: draft.autoPublish ? draft.publishChapter : null, public: draft.public } : {}),
      };
      const result = await update(body);
      if (!result.error) navigate(back);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate(back)}>
          <ArrowLeft size={16} />
        </button>
        <h1>{webinar ? (isNew ? "New webinar" : "Edit webinar") : isNew ? "Schedule live class" : "Edit live class"}</h1>
      </div>

      <div className="stack" style={{ maxWidth: 560 }}>
        <ErrorNote error={createError || updateError} />

        {webinar && isNew && !providerReady("livekit") && (
          <p className="hint" style={{ margin: 0, color: "var(--incorrect)" }}>Webinars run in the in-app classroom (LiveKit), which isn't set up yet. Add it under Settings → Connections first.</p>
        )}

        {!webinar && <Field label="Batch">
          <SearchSelect
            className="input"
            value={draft.batch}
            disabled={!isNew}
            onChange={(e) => set({ batch: e.target.value })}
          >
            <option value="">Select a {terms.batch}…</option>
            {eligibleBatches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
          {isNew && eligibleBatches.length === 0 && (
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              No batch has Live Classes switched on yet — enable it under that batch's features first.
            </p>
          )}
        </Field>}

        <div className="row-tight" style={{ justifyContent: "flex-end" }}>
          <AiWrite
            task="liveClass"
            prompt="required"
            label="Write title and agenda with AI"
            promptLabel="What will the class cover?"
            placeholder="e.g. Newton's laws: inertia, F = ma, action-reaction, with past-paper problems"
            input={{
              batchName: webinar ? undefined : (batches || []).find((b) => b._id === draft.batch)?.name,
              durationMinutes: draft.durationMinutes,
              mode: draft.provider === "livekit" ? draft.mode : "class",
            }}
            onResult={(d) => set({ title: d.title, description: d.description })}
          />
        </div>

        <Field label="Title">
          <input
            className="input"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Weekly doubt-clearing session"
          />
        </Field>

        <MarkdownEditor
          label="Description"
          hint="Optional — shown to students on the join page."
          minHeight={110}
          mono={false}
          value={draft.description}
          onChange={(v) => set({ description: v })}
          actions={<AiTranslate value={draft.description} onChange={(v) => set({ description: v })} />}
        />

        <div className="row-tight">
          <Field label="Scheduled for">
            <input
              type="datetime-local"
              className="input"
              value={draft.scheduledAt}
              onChange={(e) => set({ scheduledAt: e.target.value })}
            />
          </Field>
          <Field label="Duration (minutes)">
            <input
              type="number"
              min={1}
              className="input"
              value={draft.durationMinutes}
              onChange={(e) => set({ durationMinutes: e.target.value })}
            />
          </Field>
        </div>

        {webinar ? null : isNew ? (
          <Field label="Provider">
            <select
              className="input"
              value={draft.provider}
              onChange={(e) => set({ provider: e.target.value })}
            >
              <option value="manual">Manual link (Zoom, Meet, Teams, etc.)</option>
              <option value="zoom" disabled={!providerReady("zoom")}>Zoom (auto-created meeting){providerReady("zoom") ? "" : " (not set up)"}</option>
              <option value="livekit" disabled={!providerReady("livekit")}>In-app classroom (LiveKit){providerReady("livekit") ? "" : " (not set up)"}</option>
            </select>
          </Field>
        ) : (
          <Field label="Provider">
            <div className="pill" style={{ width: "fit-content" }}>
              {draft.provider === "zoom" ? "Zoom (auto-created meeting)" : draft.provider === "livekit" ? `In-app ${draft.mode === "webinar" ? "webinar" : "class"} (LiveKit)` : "Manual link"}
            </div>
          </Field>
        )}

        <TeacherPicker
          teachers={teacherData?.users || []}
          batchTeacherIds={batchTeacherIds}
          value={draft.teachers || []}
          onChange={(teachers) => set({ teachers })}
          provider={draft.provider}
        />

        {draft.provider === "livekit" && isNew && !webinar && (
          <Field label="Format" hint="Runs inside the student app and this panel; open it from Live Classes to start it.">
            <div className="row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              {[
                ["class", "Class", "Everyone can turn on camera and mic."],
                ["webinar", "Webinar", "Students watch, chat and raise a hand; you bring them on stage."],
              ].map(([value, label, hint]) => (
                <label key={value} className="card-quiet" style={{ padding: 12, cursor: "pointer", flex: "1 1 220px", outline: draft.mode === value ? "2px solid var(--primary)" : "none" }}>
                  <input type="radio" name="mode" checked={draft.mode === value} onChange={() => set({ mode: value })} style={{ marginRight: 6 }} />
                  <span className="small" style={{ fontWeight: 500 }}>{label}</span>
                  <div className="hint" style={{ margin: "4px 0 0" }}>{hint}</div>
                </label>
              ))}
            </div>
          </Field>
        )}

        {draft.provider === "livekit" && isNew && (
          <Field label="Who can share their screen" hint="You can change this, or allow it for one person, during the class.">
            <select className="input" value={draft.screenShare} onChange={(e) => set({ screenShare: e.target.value })}>
              <option value="hosts">Hosts only</option>
              <option value="everyone">{draft.mode === "webinar" ? "Hosts and people on stage" : "Everyone"}</option>
            </select>
          </Field>
        )}

        {webinar && (
          <Field label="Teacher pay">
            <label className="row-tight small" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.countPay} onChange={(e) => set({ countPay: e.target.checked })} />
              Count this webinar's time toward the teachers' class pay
            </label>
          </Field>
        )}

        {draft.provider === "livekit" && !webinar && (
          <Field label="Recordings" hint="Record from the classroom. By default each recording waits for you to publish, keep private or delete it.">
            <label className="row-tight small" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={draft.autoPublish} onChange={(e) => set({ autoPublish: e.target.checked })} />
              Publish recordings as lectures automatically
            </label>
            {draft.autoPublish && (
              <div style={{ marginTop: 8 }}>
                <ChapterSelect value={draft.publishChapter} onChange={(v) => set({ publishChapter: v })} placeholder="Chapter for the lecture" />
              </div>
            )}
          </Field>
        )}

        {draft.provider === "livekit" && <PublicWebinar locked={webinar} value={draft.public} onChange={(p) => set({ public: { ...draft.public, ...p } })} saved={!isNew && existing?.public?.on ? existing.public.slug : null} />}

        {draft.provider === "manual" && (
          <Field
            label="Join link"
            hint={isNew ? "Paste the Zoom/Meet/Teams link you already created." : undefined}
          >
            {isNew ? (
              <input
                className="input"
                value={draft.joinUrl}
                onChange={(e) => set({ joinUrl: e.target.value })}
                placeholder="https://zoom.us/j/..."
              />
            ) : (
              <div className="muted small" style={{ wordBreak: "break-all" }}>{draft.joinUrl}</div>
            )}
          </Field>
        )}

        {draft.provider === "zoom" && !isNew && (
          <p className="muted small">
            Zoom join/host links are created automatically and can't be edited here.
          </p>
        )}

        {draft.provider === "zoom" && isNew && (
          <>
            <Field
              label="Alternative hosts"
              hint="Each must be a licensed Zoom user on this same Zoom account, or scheduling will fail — see ZOOM_SETUP.md."
            >
              {(selectedBatch?.batch?.teachers || []).length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>No other teachers assigned to this {terms.batch} yet.</p>
              ) : (
                <div className="stack" style={{ gap: 4 }}>
                  {selectedBatch.batch.teachers.map((t) => (
                    <label key={t._id} className="row-tight small">
                      <input
                        type="checkbox"
                        disabled={!t.email}
                        checked={draft.alternativeHostIds.includes(t._id)}
                        onChange={(e) => {
                          const ids = e.target.checked
                            ? [...draft.alternativeHostIds, t._id]
                            : draft.alternativeHostIds.filter((id) => id !== t._id);
                          set({ alternativeHostIds: ids });
                        }}
                      />
                      {t.name} {!t.email && <span className="muted">(no email on file)</span>}
                    </label>
                  ))}
                </div>
              )}
            </Field>

            <Field label="Other host emails" hint="Comma-separated. Same licensing requirement applies.">
              <input
                className="input"
                value={draft.extraHostEmails}
                onChange={(e) => set({ extraHostEmails: e.target.value })}
                placeholder="ta@example.com, guest.teacher@example.com"
              />
            </Field>

            <label className="card-quiet row-tight" style={{ padding: 12, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={draft.secured}
                onChange={(e) => set({ secured: e.target.checked })}
              />
              <div>
                <div className="small" style={{ fontWeight: 500 }}>Secured (Tier 3)</div>
                <div className="hint" style={{ margin: "2px 0 0" }}>
                  Every active student on this batch gets their own personal join link tied to
                  their email — the shared link can't be forwarded to get someone in. Students
                  with no email on file can't be secured-registered and will see a clear message
                  instead of a broken link.
                </div>
              </div>
            </label>
          </>
        )}

        {!isNew && draft.provider === "zoom" && draft.secured && (
          <div className="card-quiet stack" style={{ gap: 4 }}>
            <div className="small" style={{ fontWeight: 500 }}>Secured (Tier 3)</div>
            <div className="hint" style={{ margin: 0 }}>
              {existing?.registrants?.length ?? 0} student{(existing?.registrants?.length ?? 0) === 1 ? "" : "s"}{" "}
              currently registered with their own personal link. Anyone who gains batch access later gets
              registered automatically the first time they open this class.
            </div>
          </div>
        )}

        {!isNew && (
          <Field label="Status">
            <select className="input" value={draft.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="scheduled">Scheduled</option>
              <option value="live">Live</option>
              <option value="ended">Ended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        )}

        <button className="btn" disabled={!valid || creating || updating} onClick={save}>
          <Video size={15} /> {isNew ? (webinar ? "Schedule webinar" : "Schedule class") : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// Who takes the class. Teachers see it under "My classes" and join it; they
// can't edit or delete it. In-app classes make each of them a host; on Zoom
// they join with the class link and you make them co-host in the meeting.
function TeacherPicker({ teachers, batchTeacherIds, value, onChange, provider }) {
  const hint = provider === "livekit"
    ? "Each teacher opens the classroom as a host: talk, share screen, run the board, polls and Q&A."
    : provider === "zoom"
      ? "Teachers join with the class link. Start the meeting yourself, then make them co-host in Zoom (Participants → More → Make co-host)."
      : "Teachers see the class and its link under My classes.";
  const toggle = (id, on) => onChange(on ? [...value, id] : value.filter((v) => v !== id));
  const sorted = [...teachers].sort((a, b) => Number(batchTeacherIds.includes(b._id)) - Number(batchTeacherIds.includes(a._id)));
  return (
    <Field label="Teachers" hint={hint}>
      {sorted.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>No teacher accounts yet. Add them under Team.</p>
      ) : (
        <div className="stack" style={{ gap: 4, maxHeight: 220, overflowY: "auto" }}>
          {sorted.map((t) => (
            <label key={t._id} className="row-tight small" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={value.includes(t._id)} onChange={(e) => toggle(t._id, e.target.checked)} />
              {t.name}
              {batchTeacherIds.includes(t._id) && <span className="muted">· on this batch</span>}
            </label>
          ))}
        </div>
      )}
    </Field>
  );
}

// A share link anyone can join as a guest: audience only, their details
// going to Leads. `saved`: the link name as saved, for the copy button.
// locked: a webinar, whose link is always on.
function PublicWebinar({ value, onChange, saved, locked = false }) {
  const [copied, setCopied] = useState(false);
  const link = saved ? `${window.location.origin}/w/${saved}` : "";
  return (
    <div className="field">
      <span className="label">{locked ? "Public link" : "Public webinar"}</span>
      {!locked && (
        <label className="row-tight small" style={{ gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={value.on} onChange={(e) => onChange({ on: e.target.checked })} />
          Open this class to the public by link
        </label>
      )}
      {value.on && (
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          {link && (
            <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
              <code className="small" style={{ wordBreak: "break-all" }}>{link}</code>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy link"}
              </button>
              <a className="btn btn-sm btn-quiet" href={link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open</a>
            </div>
          )}
          <div className="row-tight" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 220px" }}>
              <span className="label">Link name</span>
              <input className="input" value={value.slug} placeholder="From the title" onChange={(e) => onChange({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9\u0980-\u09ff-]+/g, "-") })} />
            </label>
            <label className="field" style={{ flex: "0 1 140px" }}>
              <span className="label">Guests at a time</span>
              <input className="input" type="number" min={1} value={value.cap} onChange={(e) => onChange({ cap: e.target.value })} />
            </label>
          </div>
          <div className="row-tight" style={{ gap: 10, flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 220px" }}>
              <span className="label">How guests get in</span>
              <select className="input" value={value.entry} onChange={(e) => onChange({ entry: e.target.value })}>
                <option value="otp">Name + a code to their phone or email</option>
                <option value="open">Just a name (contact optional)</option>
                <option value="google">Google account only</option>
              </select>
              <span className="hint">A "Continue with Google" button shows on every webinar once Google sign-in is set up in Settings → Connections.</span>
            </label>
            <label className="field" style={{ flex: "1 1 220px" }}>
              <span className="label">Guests' questions</span>
              <select className="input" value={value.questions} onChange={(e) => onChange({ questions: e.target.value })}>
                <option value="approve">Shown after you approve them</option>
                <option value="open">Shown straight away</option>
                <option value="off">Off</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span className="label">About this webinar (shown on the link's page)</span>
            <textarea className="textarea" rows={2} maxLength={600} value={value.blurb} onChange={(e) => onChange({ blurb: e.target.value })} />
          </label>
          <label className="row-tight small" style={{ gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={value.replay !== false} onChange={(e) => onChange({ replay: e.target.checked })} />
            After the webinar, let guests watch its recording on the same link
          </label>
          {saved && (
            <label className="row-tight small" style={{ gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={value.closed} onChange={(e) => onChange({ closed: e.target.checked })} />
              Stop letting new people in (those already in stay)
            </label>
          )}
        </div>
      )}
      <span className="hint">A link to share on social media. Anyone who opens it joins as a guest: they watch, ask questions and answer polls, never on camera or mic unless you bring them on stage. Their details go to Leads.</span>
    </div>
  );
}
