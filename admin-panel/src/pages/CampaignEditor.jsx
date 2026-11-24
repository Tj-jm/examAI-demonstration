import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, Clock, Copy, Trash2, Users, StopCircle, Zap } from "lucide-react";
import {
  useGetCampaignQuery, useCreateCampaignMutation, useUpdateCampaignMutation, useEstimateCampaignMutation,
  useSendCampaignMutation, useCancelCampaignMutation, useDuplicateCampaignMutation, useDeleteCampaignMutation,
  useToggleAutomationMutation,
} from "../api/campaignApi";
import { useGetBatchesQuery } from "../api/contentApi";
import { Loading, ErrorNote, Field, useConfirm } from "../components/bits";
import AiWrite from "../components/AiWrite";
import { STATUS_PILL, AUDIENCE_LABEL, salesText } from "./Campaigns";
import { TRIGGER_LABEL, triggerText } from "./Automations";
import SearchSelect from "../components/SearchSelect";

const BLANK = {
  name: "", audience: { kind: "all", batch: "", days: 7 }, channels: { app: true, sms: false, email: false },
  title: "", message: "", link: "/purchases", couponCode: "",
  trigger: { type: "trialEnding", days: 2, hours: 3, batch: "" },
};

// Automation triggers about one batch: {batch} works in their message and link.
const BATCH_TRIGGERS = ["trialEnding", "checkoutAbandoned", "accessExpiring", "accessExpired"];

const AUDIENCE_HINT = {
  all: "Every active student who hasn't turned off offers.",
  batch: "Students with access to the batch right now.",
  neverBought: "Signed up but never paid for anything.",
  trialEnding: "A free trial ends within the days below and they haven't bought that batch.",
  expired: "Their access to a batch ended within the days below and they haven't renewed.",
  inactive: "No exam, practice, lecture or visit for the days below.",
};

// A <input type="datetime-local"> value for a Date, in local time.
const localInput = (d) => {
  const x = new Date(d);
  const pad = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
};

export default function CampaignEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [poll, setPoll] = useState(0);
  const { data: saved, isLoading } = useGetCampaignQuery(id, { skip: isNew, pollingInterval: poll });
  const { data: batches } = useGetBatchesQuery({});
  const [create, createState] = useCreateCampaignMutation();
  const [update, updateState] = useUpdateCampaignMutation();
  const [estimate, estimateState] = useEstimateCampaignMutation();
  const [send, sendState] = useSendCampaignMutation();
  const [cancel, cancelState] = useCancelCampaignMutation();
  const [duplicate] = useDuplicateCampaignMutation();
  const [remove] = useDeleteCampaignMutation();
  const [toggle, toggleState] = useToggleAutomationMutation();
  const [form, setForm] = useState(isNew ? BLANK : null);
  const [when, setWhen] = useState("");
  const [savedNote, setSavedNote] = useState("");
  // Another campaign opened (Duplicate, or a new one saved): start over.
  const [formFor, setFormFor] = useState(id);
  if (formFor !== id) {
    setFormFor(id);
    setForm(isNew ? BLANK : null);
    setSavedNote("");
  }

  // Watch the numbers while it sends.
  useEffect(() => { setPoll(saved?.status === "sending" ? 5000 : 0); }, [saved?.status]);

  useEffect(() => {
    if (saved && saved._id === id && !form) {
      setForm({
        ...BLANK, ...saved,
        audience: { ...BLANK.audience, ...saved.audience, batch: saved.audience?.batch?._id || saved.audience?.batch || "" },
        channels: { ...BLANK.channels, ...saved.channels },
        trigger: { ...BLANK.trigger, ...saved.trigger, batch: saved.trigger?.batch || "" },
      });
      if (saved.scheduledAt) setWhen(localInput(saved.scheduledAt));
    }
  }, [saved, form]);

  if (!isNew && (isLoading || !form || !saved)) return <Loading />;
  // An automation (Automations page) is a campaign with a trigger instead of an audience.
  const auto = saved?.kind === "automation";
  const home = auto ? "/automations" : "/campaigns";
  const editable = isNew || ["draft", "scheduled", "active", "paused"].includes(saved?.status);
  const setTrigger = (patch) => setForm({ ...form, trigger: { ...form.trigger, ...patch } });
  const batchTrigger = auto && BATCH_TRIGGERS.includes(form.trigger.type);
  const set = (patch) => setForm({ ...form, ...patch });
  const setAudience = (patch) => setForm({ ...form, audience: { ...form.audience, ...patch } });
  const setChannel = (k, v) => setForm({ ...form, channels: { ...form.channels, [k]: v } });
  const body = () => ({
    ...form,
    audience: { ...form.audience, batch: form.audience.batch || null },
    trigger: { ...form.trigger, batch: form.trigger.batch || null },
  });
  const kind = form.audience.kind;
  const needsDays = ["trialEnding", "expired", "inactive"].includes(kind);
  const linkPreset = ["/purchases", "/", "/purchases/{batch}"].includes(form.link) ? form.link
    : /^\/purchases\/[a-f0-9]{24}$/.test(form.link) ? "batch" : "custom";

  // Saves and returns the campaign id (a new one is created first).
  const save = async () => {
    if (isNew) {
      const made = await create(body()).unwrap();
      navigate(`/campaigns/${made._id}`, { replace: true });
      return made._id;
    }
    await update({ id, ...body() }).unwrap();
    return id;
  };

  const saveDraft = async () => {
    try { await save(); setSavedNote("Saved."); } catch { /* shown below */ }
  };

  const runEstimate = () => estimate({ ...body(), id: isNew ? undefined : id, kind: auto ? "automation" : undefined }).unwrap().catch(() => null);

  const switchOn = async (on) => {
    try {
      await update({ id, ...body() }).unwrap();
      await toggle({ id, on }).unwrap();
      setSavedNote(on ? "On. It checks every hour." : "Off.");
    } catch { /* shown below */ }
  };

  const sendNow = async () => {
    const e = await runEstimate();
    if (!e) return;
    const parts = [
      form.channels.app ? `${e.app} in the app${e.appOn ? "" : " (campaign notifications are off in Settings → Notifications)"}` : null,
      form.channels.sms ? `${e.sms} by SMS (${e.smsParts} SMS parts${e.smsReady ? "" : "; no SMS gateway is set up"})` : null,
      form.channels.email ? `${e.email} by email${e.emailReady ? "" : " (email is not set up)"}` : null,
    ].filter(Boolean);
    const yes = await confirm({
      title: `Send to ${e.recipients} student${e.recipients === 1 ? "" : "s"}?`,
      body: `${parts.join(", ")}. This can't be undone once messages go out.`,
      confirmLabel: "Send now",
    });
    if (!yes) return;
    try {
      const cid = await save();
      await send({ id: cid }).unwrap();
    } catch { /* shown below */ }
  };

  const schedule = async () => {
    if (!when) return;
    try {
      const cid = await save();
      await send({ id: cid, at: new Date(when).toISOString() }).unwrap();
      setSavedNote(`Scheduled for ${new Date(when).toLocaleString()}.`);
    } catch { /* shown below */ }
  };

  const est = estimateState.data;
  const error = createState.error || updateState.error || sendState.error || cancelState.error || estimateState.error || toggleState.error;

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="row-tight">
          <Link className="btn btn-sm btn-quiet" to={home}><ArrowLeft size={14} /> {auto ? "Automations" : "Campaigns"}</Link>
          <h1 style={{ margin: 0 }}>{isNew ? "New campaign" : form.name || "Campaign"}</h1>
          {!isNew && (auto
            ? <span className={`pill${saved.status === "active" ? " pill-ok" : ""}`}>{saved.status === "active" ? "On" : "Off"}</span>
            : <span className={STATUS_PILL[saved.status]?.className}>{STATUS_PILL[saved.status]?.label}</span>)}
        </div>
        {!isNew && (
          <div className="row-tight">
            <button className="btn btn-sm btn-quiet" onClick={async () => { const c = await duplicate(id).unwrap(); navigate(auto ? `/automations/${c._id}` : `/campaigns/${c._id}`); }}>
              <Copy size={13} /> Duplicate
            </button>
            {(auto ? !(saved.stats?.recipients > 0) : ["draft", "scheduled"].includes(saved.status) || (saved.status === "cancelled" && !saved.startedAt)) && (
              <button className="btn btn-sm btn-quiet" onClick={async () => {
                if (await confirm({ title: `Delete this ${auto ? "automation" : "campaign"}?`, body: "It hasn't sent anything, so nothing is lost.", confirmLabel: "Delete" })) {
                  await remove(id).unwrap();
                  navigate(home);
                }
              }}><Trash2 size={13} /> Delete</button>
            )}
          </div>
        )}
      </div>

      {!isNew && (auto ? saved.stats?.recipients > 0 : !editable) && <Results campaign={saved} onStop={() => cancel(id)} auto={auto} />}

      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="card stack">
          <Field label="Name" hint="For you; students don't see it.">
            <input className="input" value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="HSC admission offer" />
          </Field>

          {auto ? (
            <>
              <Field label="When it sends" hint={triggerText(form.trigger)}>
                <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(TRIGGER_LABEL).map(([value, label]) => (
                    <button key={value} type="button" className={`pill pill-btn${form.trigger.type === value ? " pill-on" : ""}`} onClick={() => setTrigger({ type: value })}>{label}</button>
                  ))}
                </div>
              </Field>
              <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
                {form.trigger.type === "checkoutAbandoned" ? (
                  <Field label="Hours after">
                    <input className="input tnum" type="number" min="1" max="168" style={{ width: 100 }} value={form.trigger.hours} onChange={(e) => setTrigger({ hours: e.target.value })} />
                  </Field>
                ) : (
                  <Field label={["trialEnding", "accessExpiring"].includes(form.trigger.type) ? "Days before" : form.trigger.type === "inactive" ? "Quiet for (days)" : "Days after"}>
                    <input className="input tnum" type="number" min="1" max="365" style={{ width: 100 }} value={form.trigger.days} onChange={(e) => setTrigger({ days: e.target.value })} />
                  </Field>
                )}
                {form.trigger.type !== "noPurchase" && (
                  <Field label="Only for batch (optional)">
                    <SearchSelect className="select" value={form.trigger.batch || ""} onChange={(e) => setTrigger({ batch: e.target.value })}>
                      <option value="">Any batch</option>
                      {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </SearchSelect>
                  </Field>
                )}
              </div>
              <p className="hint" style={{ margin: 0 }}>
                Checked every hour. Each student gets it once per reason (this trial, this time access ran out…).
                Students who turned off offers and announcements never get it.
              </p>
            </>
          ) : (
          <>
          <Field label="Who gets it" hint={AUDIENCE_HINT[kind]}>
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
              {Object.entries(AUDIENCE_LABEL).map(([value, label]) => (
                <button key={value} type="button" className={`pill pill-btn${kind === value ? " pill-on" : ""}`} onClick={() => setAudience({ kind: value })}>{label}</button>
              ))}
            </div>
          </Field>
          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            {kind !== "all" && kind !== "neverBought" && (
              <Field label={kind === "batch" ? "Batch" : "Only for batch (optional)"}>
                <SearchSelect className="select" value={form.audience.batch || ""} onChange={(e) => setAudience({ batch: e.target.value })}>
                  <option value="">{kind === "batch" ? "Choose a batch" : "Any batch"}</option>
                  {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                </SearchSelect>
              </Field>
            )}
            {needsDays && (
              <Field label={kind === "inactive" ? "Quiet for (days)" : kind === "trialEnding" ? "Ends within (days)" : "Ended within (days)"}>
                <input className="input tnum" type="number" min="1" max="365" style={{ width: 100 }} value={form.audience.days} onChange={(e) => setAudience({ days: e.target.value })} />
              </Field>
            )}
          </div>
          <p className="hint" style={{ margin: 0 }}>Students who turned off offers and announcements never get campaigns.</p>
          </>
          )}
        </div>

        <div className="card stack">
          <Field label="Send by">
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 12 }}>
              {[["app", "App notification"], ["sms", "SMS"], ["email", "Email"]].map(([k, label]) => (
                <label key={k} className="row-tight" style={{ gap: 6 }}>
                  <input type="checkbox" checked={form.channels[k]} onChange={(e) => setChannel(k, e.target.checked)} /> {label}
                </label>
              ))}
            </div>
          </Field>

          <AiWrite
            task="campaign"
            prompt="required"
            promptLabel="What's it about?"
            placeholder="20% off the HSC batch for anyone who joins by Friday"
            lead="Write the title and message with AI, in English, Bangla or Hindi."
            input={auto
              ? { audience: form.trigger.type, batch: form.trigger.batch || undefined, couponCode: form.couponCode, sms: form.channels.sms, automation: true }
              : { audience: kind, batch: form.audience.batch || undefined, couponCode: form.couponCode, sms: form.channels.sms }}
            onResult={(d) => set({ title: d.title || form.title, message: d.message || form.message })}
          />
          <Field label="Title" hint="The notification's title and the email's subject.">
            <input className="input" value={form.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label="Message" hint={`{name} becomes the student's first name.${batchTrigger ? " {batch} becomes the batch's name." : ""} The code and the link are added after it.${form.channels.sms ? " Keep it short for SMS: about 300 characters in English or 130 in Bangla is two SMS parts." : ""}`}>
            <textarea className="textarea" rows={4} maxLength={1000} value={form.message} onChange={(e) => set({ message: e.target.value })} placeholder="{name}, the HSC batch is 20% off until Friday." />
            <span className="hint tnum">{form.message.length} characters</span>
          </Field>
          <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
            <Field label="Opens">
              <div className="row-tight" style={{ gap: 6, flexWrap: "wrap" }}>
                <select className="select" value={linkPreset} onChange={(e) => {
                  const v = e.target.value;
                  if (v === "batch") set({ link: `/purchases/${(batches || [])[0]?._id || ""}` });
                  else if (v === "custom") set({ link: "/" === form.link ? "/lectures" : form.link });
                  else set({ link: v });
                }}>
                  <option value="/purchases">Plans page</option>
                  {batchTrigger && <option value="/purchases/{batch}">That batch's plans</option>}
                  <option value="batch">A batch's plans</option>
                  <option value="/">Home</option>
                  <option value="custom">Another page</option>
                </select>
                {linkPreset === "batch" && (
                  <SearchSelect className="select" value={form.link.split("/")[2] || ""} onChange={(e) => set({ link: `/purchases/${e.target.value}` })}>
                    {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </SearchSelect>
                )}
                {linkPreset === "custom" && (
                  <input className="input" style={{ width: 220 }} value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="/lectures" />
                )}
              </div>
            </Field>
            <Field label="Coupon code (optional)" hint="Added as “Code: …”. Make it on the Coupons page first.">
              <input className="input" style={{ width: 160, textTransform: "uppercase" }} value={form.couponCode} maxLength={40} onChange={(e) => set({ couponCode: e.target.value })} />
            </Field>
          </div>
        </div>

        {editable && (
          <div className="card stack">
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="btn btn-quiet" onClick={runEstimate} disabled={estimateState.isLoading}>
                <Users size={14} /> {estimateState.isLoading ? "Counting…" : auto ? "Who would get it now?" : "Who gets it?"}
              </button>
              {est && (
                <span className="small muted">
                  {est.recipients} student{est.recipients === 1 ? "" : "s"}
                  {form.channels.app ? ` · app ${est.app}${est.appOn ? "" : " (off in Settings → Notifications)"}` : ""}
                  {form.channels.sms ? ` · SMS ${est.sms} (${est.smsPartsEach} part${est.smsPartsEach === 1 ? "" : "s"} each, ${est.smsParts} in all)${est.smsReady ? "" : " — no SMS gateway set up"}` : ""}
                  {form.channels.email ? ` · email ${est.email}${est.emailReady ? "" : " — email not set up"}` : ""}
                </span>
              )}
            </div>
            {est?.sampleSms && <p className="hint" style={{ margin: 0 }}>SMS will read: “{est.sampleSms}”</p>}

            <ErrorNote error={error} />
            {auto ? (
              <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
                <button type="button" className="btn" onClick={saveDraft} disabled={updateState.isLoading}>Save</button>
                {saved.status === "active" ? (
                  <button type="button" className="btn" onClick={() => switchOn(false)} disabled={toggleState.isLoading}><StopCircle size={14} /> Switch off</button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => switchOn(true)} disabled={toggleState.isLoading}><Zap size={14} /> Save and switch on</button>
                )}
                {savedNote && <span className="small muted">{savedNote}</span>}
              </div>
            ) : (
            <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="btn" onClick={saveDraft} disabled={createState.isLoading || updateState.isLoading}>Save draft</button>
              <button type="button" className="btn btn-primary" onClick={sendNow} disabled={sendState.isLoading}><Send size={14} /> Send now</button>
              <span className="muted small">or</span>
              <input className="input" type="datetime-local" value={when} min={localInput(Date.now())} onChange={(e) => setWhen(e.target.value)} />
              <button type="button" className="btn" onClick={schedule} disabled={!when || sendState.isLoading}><Clock size={14} /> Schedule</button>
              {saved?.status === "scheduled" && (
                <button type="button" className="btn btn-quiet" onClick={() => cancel(id)}><StopCircle size={14} /> Unschedule</button>
              )}
              {savedNote && <span className="small muted">{savedNote}</span>}
            </div>
            )}
          </div>
        )}
      </fieldset>
    </div>
  );
}

function Results({ campaign: c, onStop, auto }) {
  const s = c.stats || {};
  const tiles = [
    [auto ? "Sent so far" : "Students", s.recipients],
    ["App", s.app], ["SMS", s.sms ? `${s.sms} (${s.smsParts} parts)` : s.sms], ["Email", s.email],
    ["Failed", s.failed], ["Skipped", s.skipped],
    ["Opened", s.clicks], ["Sales", salesText(c.sales)],
  ];
  return (
    <div className="card stack" style={{ marginBottom: 16 }}>
      <div className="spread">
        <span className="label">Results</span>
        {c.status === "sending" && <button className="btn btn-sm btn-quiet" onClick={onStop}><StopCircle size={13} /> Stop sending</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        {tiles.map(([label, value]) => (
          <div key={label} className="card-quiet stack" style={{ gap: 2 }}>
            <span className="muted small">{label}</span>
            <strong className="tnum">{value ?? 0}</strong>
          </div>
        ))}
      </div>
      {c.error && <p className="hint" style={{ margin: 0, color: "var(--bad, #b91c1c)" }}>{c.error}</p>}
      <p className="hint" style={{ margin: 0 }}>
        Opened: students who followed the link. Sales: purchases by a student within 7 days of opening it.
        Skipped: no phone or email on the account, or that channel isn't set up.
      </p>
    </div>
  );
}
