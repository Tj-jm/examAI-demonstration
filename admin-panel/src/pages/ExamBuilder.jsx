import { useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useGetExamQuery,
  useGetQuestionsQuery,
  useSetExamQuestionsMutation,
  useSmartPickExamQuestionsMutation,
  usePublishExamMutation,
  useSetExamActiveMutation,
  useDuplicateExamMutation,
  useDeleteExamMutation,
  useGetBatchesQuery,
  useSetItemBatchesMutation,
  useGetTreeQuery,
  useUpdateExamMutation,
  useGetQuestionTagsQuery,
  useCreateExamSetMutation,
} from "../api/contentApi";
import {
  Trash2, Copy, ArrowLeft, ChevronUp, ChevronDown, X, Plus, Search,
  Play, Pause, Send, EyeOff, AlertTriangle, ClipboardList, Users, Sparkles, Megaphone, Layers, Settings2, ShieldCheck,
} from "lucide-react";
import { noticeDraftFor } from "../utils/noticeDraft";
import { Loading, ErrorNote, Empty, Field, TypePill, useConfirm, Pager, useCan } from "../components/bits";
import { useCtrlS, useUnsaved, PageTabs, SaveBar } from "../components/ListTools";
import { useGetMeQuery } from "../api/authApi";
import Latex from "../components/Latex";
import AwayLimitFields from "../components/AwayLimitFields";
import AiWrite, { AiTranslate } from "../components/AiWrite";
import MarkdownEditor from "../components/MarkdownEditor";
import BatchAssign from "../components/BatchAssign";
import { useTerms } from "../terms";
import SearchSelect from "../components/SearchSelect";

// examModel.js's isOpen() reads a mock's window off opensAt/liveHours, but
// no admin screen ever exposed either field — "Mock" could be picked from
// the Kind dropdown and would then behave exactly like "Test", since the
// one thing that makes mock different could never be set. datetime-local
// wants "YYYY-MM-DDTHH:mm" in local time; the API gives/wants an ISO
// string (or null) — converted only at this boundary so settings.opensAt
// itself stays exactly the shape exam.opensAt is in, which is what lets
// the existing generic settingsDirty/saveSettings diffing (below) keep
// working unmodified for these two new fields.
const isoToLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localInputToIso = (value) => (value ? new Date(value).toISOString() : null);

const ALLOWED_TYPE_LABELS = [
  ["mcq", "Multiple choice"],
  ["mtf", "True / false"],
  ["written", "Written"],
  ["passage", "Passage"],
];

export default function ExamBuilder() {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();
  // Tabs, in the url so a reload stays put.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "questions";
  const setTab = (value) => setParams(value === "questions" ? {} : { tab: value }, { replace: true });

  const { data, isLoading, error } = useGetExamQuery(id);
  const { data: batches } = useGetBatchesQuery({});
  const { data: me } = useGetMeQuery();
  const can = useCan(me);
  const [setQuestions, { isLoading: saving, error: saveError }] = useSetExamQuestionsMutation();
  const [smartPick, { isLoading: aiPickLoading, error: aiPickError }] = useSmartPickExamQuestionsMutation();
  const [publish, { isLoading: publishing, error: publishError }] = usePublishExamMutation();
  const [setActive] = useSetExamActiveMutation();
  const [duplicate] = useDuplicateExamMutation();
  const [remove, { error: deleteError }] = useDeleteExamMutation();
  const [setItemBatches] = useSetItemBatchesMutation();
  const [updateExam, { isLoading: savingSettings, error: settingsError }] = useUpdateExamMutation();

  const [picking, setPicking] = useState(false);
  const [aiPicking, setAiPicking] = useState(false);
  const [aiForm, setAiForm] = useState({ count: 10, types: ["mcq", "mtf", "written"], subject: "", topic: "", difficulty: "" });
  const [aiResult, setAiResult] = useState(null);
  const [graceDraft, setGraceDraft] = useState(null);
  const [awayDraft, setAwayDraft] = useState(null);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [subjectFilter, setSubjectFilterState] = useState("");
  const [topicFilter, setTopicFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [bankPage, setBankPage] = useState(1);
  const [publishWarning, setPublishWarning] = useState(null);
  const confirm = useConfirm();

  const { data: tree } = useGetTreeQuery(undefined, { skip: !picking && !aiPicking });
  const { data: allTags } = useGetQuestionTagsQuery(undefined, { skip: !picking });

  const subjects = (tree || []).map((subject) => ({ _id: subject._id, title: subject.title }));

  // Once a subject is picked, its own name is redundant in every option —
  // same narrowing Questions.jsx does, so picking a subject here isn't a
  // different mental model from picking one in the bank itself.
  const topicSource = subjectFilter
    ? (tree || []).filter((subject) => subject._id === subjectFilter)
    : (tree || []);
  const topics = topicSource.flatMap((subject) =>
    subject.chapters.flatMap((chapter) =>
      chapter.topics.map((topic) => ({
        _id: topic._id,
        label: subjectFilter ? `${chapter.title} · ${topic.title}` : `${subject.title} · ${topic.title}`,
      }))
    )
  );

  // The AI panel scopes independently of the manual bank filters above — its
  // own subject narrows its own topic list the same way, just against
  // aiForm instead of subjectFilter/topicFilter.
  const aiTopicSource = aiForm.subject
    ? (tree || []).filter((subject) => subject._id === aiForm.subject)
    : (tree || []);
  const aiTopics = aiTopicSource.flatMap((subject) =>
    subject.chapters.flatMap((chapter) =>
      chapter.topics.map((topic) => ({
        _id: topic._id,
        label: aiForm.subject ? `${chapter.title} · ${topic.title}` : `${subject.title} · ${topic.title}`,
      }))
    )
  );
  const patchAiForm = (key, value) => setAiForm((f) => ({ ...f, [key]: value }));
  // Same reasoning as setSubjectFilter above — a topic chosen under a
  // different subject can't stay selected once the subject changes.
  const setAiSubject = (value) => setAiForm((f) => ({ ...f, subject: value, topic: "" }));
  const toggleAiType = (type) => setAiForm((f) => ({
    ...f,
    types: f.types.includes(type) ? f.types.filter((t) => t !== type) : [...f.types, type],
  }));
  const runSmartPick = async () => {
    setAiResult(null);
    try {
      const result = await smartPick({
        id,
        count: Number(aiForm.count) || 1,
        types: aiForm.types,
        subject: aiForm.subject || undefined,
        topic: aiForm.topic || undefined,
        difficulty: aiForm.difficulty || undefined,
      }).unwrap();
      setAiResult(result.message);
    } catch {
      // rendered below via aiPickError
    }
  };

  // Reset to page 1 whenever a filter changes — staying on page 4 of a
  // search that now has one page of results would just show an empty page
  // with no obvious way back.
  const setFilter = (setter) => (value) => { setter(value); setBankPage(1); };

  // A topic already picked under a *different* subject stops applying once
  // the subject changes — keeping it around would silently combine "this
  // subject" with "that other subject's topic" into a filter that can never
  // match anything.
  const setSubjectFilter = (value) => {
    setSubjectFilterState(value);
    setTopicFilter("");
    setBankPage(1);
  };

  const bank = useGetQuestionsQuery(
    {
      search: search || undefined,
      type: typeFilter || undefined,
      subject: subjectFilter || undefined,
      topic: topicFilter || undefined,
      tag: tagFilter || undefined,
      page: bankPage,
      limit: 12,
    },
    { skip: !picking }
  );

  const [makeSets, { isLoading: makingSets, error: setsError }] = useCreateExamSetMutation();

  // Unsaved exam settings: warn before leaving, Ctrl+S saves them.
  const [unsavedSettings, setUnsavedSettings] = useState(false);
  const { leave } = useUnsaved(unsavedSettings);
  const saveSettingsRef = useRef(null);
  useCtrlS(() => saveSettingsRef.current?.());

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const { exam, questions, summary, isLocked, attempts } = data;
  const startSets = async () => {
    const r = await makeSets({ source: id });
    if (r.data?._id) navigate(`/exam-sets/${r.data._id}`);
  };
  const ids = questions.map((q) => q._id);

  const graceValue = graceDraft === null ? String(exam.scriptGraceMinutes || 0) : graceDraft;

  const away = awayDraft || { awayMode: exam.awayMode || "off", awayMinutes: exam.awayMinutes ?? 5 };

  // Everything a title/description/mode/duration/attempts/buffer edit form
  // needs — cosmetic fields (title, description, the two toggles) save any
  // time; the structural ones (mode, durationMinutes, attemptsAllowed,
  // bufferSeconds) are read-only here once isLocked, mirroring the same
  // assertNotSat gate the backend already enforces on PUT /exams/:id.
  const settings = settingsDraft || {
    title: exam.title,
    description: exam.description || "",
    mode: exam.mode,
    durationMinutes: exam.durationMinutes,
    attemptsAllowed: exam.attemptsAllowed,
    bufferSeconds: exam.bufferSeconds,
    shuffleQuestions: exam.shuffleQuestions,
    opensAt: exam.opensAt || null,
    liveHours: exam.liveHours ?? null,
    closesAt: exam.closesAt || null,
    unpublishAt: exam.unpublishAt || null,
  };
  const patchSettings = (key, value) => setSettingsDraft({ ...settings, [key]: value });
  // A test is one attempt by definition — the Kind dropdown has said so
  // since this field existed, but nothing ever enforced it, so an admin
  // could switch Kind to "Test" and still leave attemptsAllowed at
  // whatever it was. Forced back to 1 the moment Test is chosen, and the
  // field below is locked while it's selected so it can't drift again.
  const setKind = (mode) => setSettingsDraft({
    ...settings,
    mode,
    attemptsAllowed: mode === "test" ? 1 : settings.attemptsAllowed,
  });
  // A missing exam[key] normalizes the same way its settings default above
  // does, so an untouched opensAt/liveHours (undefined on the exam, null in
  // settings) doesn't read as "changed" — same reason description falls
  // back to "" instead of comparing against undefined.
  const currentValue = (key) => {
    if (key === "description") return exam.description || "";
    if (key === "opensAt") return exam.opensAt || null;
    if (key === "liveHours") return exam.liveHours ?? null;
    if (key === "closesAt") return exam.closesAt || null;
    if (key === "unpublishAt") return exam.unpublishAt || null;
    return exam[key];
  };
  const settingsDirty = settingsDraft !== null && Object.keys(settings).some(
    (key) => settings[key] !== currentValue(key)
  );
  // Settings and the rules (grace period, leaving the exam) save together,
  // from one bar. Calculator, questions and batches save as you change them.
  const graceDirty = graceDraft !== null && Number(graceValue) !== (exam.scriptGraceMinutes || 0);
  const awayDirty = awayDraft !== null;
  const graceBad = graceDirty && (Number.isNaN(Number(graceValue)) || Number(graceValue) < 0);
  const awayBad = awayDirty && !(away.awayMinutes >= 1);
  const anyDirty = settingsDirty || graceDirty || awayDirty;
  const saveAll = () => {
    if (graceBad || awayBad) return;
    const body = { id };
    if (settingsDirty) {
      for (const key of Object.keys(settings)) {
        if (settings[key] !== currentValue(key)) body[key] = settings[key];
      }
    }
    if (graceDirty) body.scriptGraceMinutes = Number(graceValue);
    if (awayDirty) Object.assign(body, away);
    if (Object.keys(body).length > 1) updateExam(body);
    setSettingsDraft(null);
    setGraceDraft(null);
    setAwayDraft(null);
  };
  const discardAll = () => { setSettingsDraft(null); setGraceDraft(null); setAwayDraft(null); };
  // Kept in step with the drafts (a state update during render is fine
  // here: it only changes when a draft does).
  if (anyDirty !== unsavedSettings) setUnsavedSettings(anyDirty);
  saveSettingsRef.current = () => { if (anyDirty && !savingSettings) saveAll(); };

  const save = (nextIds) => setQuestions({ id, questionIds: nextIds });

  const move = (index, delta) => {
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    save(next);
  };

  const doPublish = async (force = false) => {
    setPublishWarning(null);
    const result = await publish({ id, isPublished: true, force });

    // The backend answers 409 with the list of written questions that have no
    // rubric. That is a warning to act on, not an error to dismiss.
    if (result.error?.status === 409) {
      setPublishWarning(result.error.data);
    }
  };

  // The mirror of doPublish, and the piece that was missing when deleting an
  // exam started requiring it to be unpublished first — there was a button
  // that could publish an exam and one that could open/close it to students,
  // but nothing anywhere ever sent isPublished: false. An admin following
  // the delete tooltip's own instruction had no way to act on it.
  //
  // This also closes the exam to students immediately (setPublished sets
  // isActive to false alongside isPublished — see examController.js), so it
  // is confirmed like any other action that changes what students can
  // reach right now, not treated as a quiet toggle.
  const doUnpublish = async () => {
    const yes = await confirm({
      title: `Unpublish "${exam.title}"?`,
      confirmLabel: "Unpublish",
      tone: "neutral",
      body: attempts > 0
        ? `This closes it to students immediately. Existing submissions and their results are unaffected — this only stops new attempts.`
        : "This closes it to students immediately. You can publish it again at any time.",
    });
    if (!yes) return;

    await publish({ id, isPublished: false });
  };

  const assignedBatchIds = (exam.batches || []).map((b) => b._id || b);

  return (
    <div className="page">
      <div className="page-head spread">
        <div className="grow">
          <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
            <span className="pill">{{ quiz: "Quiz", test: "Test", mock: "Mock" }[exam.mode] || exam.mode}</span>
            {/* Where it is: Draft, then Published, then Open to students. */}
            <span className="exam-steps">
              <span className={`exam-step${!exam.isPublished ? " exam-step-now" : " exam-step-done"}`}>Draft</span>
              <span className={`exam-step${exam.isPublished && !exam.isActive ? " exam-step-now" : exam.isActive ? " exam-step-done" : ""}`}>Published</span>
              <span className={`exam-step${exam.isActive ? " exam-step-now" : ""}`}>Open to students</span>
            </span>
          </div>
          <h1>{exam.title}</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {summary.questionCount} question{summary.questionCount === 1 ? "" : "s"} ·{" "}
            {summary.totalMarks} mark{summary.totalMarks === 1 ? "" : "s"} · {exam.durationMinutes} min
            {summary.byType && Object.keys(summary.byType).length > 1 ? ` · ${Object.entries(summary.byType).map(([t, n]) => `${n} ${{ mcq: "MCQ", mtf: "true/false", written: "written", passage: "passage", coding: "coding" }[t] || t}`).join(", ")}` : ""}
            {assignedBatchIds.length ? ` · ${assignedBatchIds.length} ${assignedBatchIds.length === 1 ? terms.batch : terms.batches}` : ` · no ${terms.batch} yet`}
          </p>
        </div>
        <div className="row-tight">
          {!exam.paperSet?.group && questions.length >= 2 && (
            <button
              className="btn btn-sm btn-quiet"
              disabled={makingSets}
              title="Use these questions as a pool and cut them into several papers, one per student"
              onClick={startSets}
            >
              <Layers size={14} /> {makingSets ? "Making…" : "Make paper sets"}
            </button>
          )}
          <button className="btn btn-sm btn-quiet" title="Post a notice about this exam" onClick={() => navigate("/notices/new", { state: { noticeDraft: noticeDraftFor("exam", exam) } })}>
            <Megaphone size={14} /> Announce
          </button>
          {summary.needsGrading && exam.isPublished && (
            <Link className="btn btn-sm btn-quiet" to="/grading" title="Written answers to this exam are marked on the Grading page">
              <ClipboardList size={14} /> Grading
            </Link>
          )}
          {/* The next step, up here rather than at the bottom of a tab. */}
          {!exam.paperSet?.group && (!exam.isPublished ? (
            <button className="btn btn-sm" onClick={() => doPublish()} disabled={publishing || !questions.length} title={!questions.length ? "Add questions first" : "Students can see it once it's open"}>
              <Send size={14} /> {publishing ? "Publishing" : "Publish"}
            </button>
          ) : (
            <button className={`btn btn-sm${exam.isActive ? " btn-quiet" : ""}`} onClick={() => setActive({ id, isActive: !exam.isActive })}>
              {exam.isActive ? <><Pause size={14} /> Close to students</> : <><Play size={14} /> Open to students</>}
            </button>
          ))}
          <button className="btn btn-sm btn-quiet" onClick={() => leave("/exams")}>
            <ArrowLeft size={14} /> Exams
          </button>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={saveError || publishError || deleteError || settingsError || setsError} />

        {exam.paperSet?.group && (
          <div className="banner row-tight">
            <Layers size={16} style={{ flexShrink: 0 }} />
            <span className="grow">
              This is Set {exam.paperSet.label} of a paper-set group. Publish it, schedule it and pick its batches from the group.
              You can still swap its questions here before anyone sits it.
            </span>
            <button className="btn btn-sm btn-quiet" onClick={() => navigate(`/exam-sets/${exam.paperSet.group}`)}>Open paper sets</button>
          </div>
        )}

        {isLocked && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>
            {attempts} student{attempts === 1 ? " has" : "s have"} started this exam, so its
            questions and timing are locked. Duplicate it to make changes.
            </span>
          </div>
        )}

        {summary.missingRubric > 0 && (
          <div className="banner banner-warn">
            {summary.missingRubric} written question{summary.missingRubric === 1 ? " has" : "s have"} no
            rubric. Those answers will need marking by hand.
          </div>
        )}

        {publishWarning && (
          <div className="banner banner-warn">
            <div style={{ marginBottom: 10 }}>{publishWarning.message}</div>
            <button className="btn btn-sm" onClick={() => doPublish(true)}>
              Publish anyway
            </button>
          </div>
        )}

        <PageTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "questions", label: "Questions", icon: ClipboardList, count: questions.length },
            { value: "settings", label: "Settings", icon: Settings2 },
            { value: "rules", label: "Rules", icon: ShieldCheck },
            { value: "access", label: "Who sits it", icon: Users, count: assignedBatchIds.length },
          ]}
        />
        {anyDirty && tab !== "settings" && tab !== "rules" && (
          <div className="banner banner-warn row-tight" style={{ gap: 8 }}>
            <span className="dirty-dot" />
            <span className="grow small">Settings or rules have unsaved changes.</span>
            <button className="btn btn-sm" onClick={saveAll} disabled={savingSettings || graceBad || awayBad}>Save them</button>
            <button className="btn btn-sm btn-quiet" onClick={discardAll}>Discard</button>
          </div>
        )}

        {/* ---------------- settings ---------------- */}
        {tab === "settings" && (<>
        <div className="card stack">
          <h2>Settings</h2>

          <Field label="Title">
            <input className="input" value={settings.title} onChange={(e) => patchSettings("title", e.target.value)} />
          </Field>

          <MarkdownEditor
            label="Description"
            hint="Students read this on the rules screen before they start."
            minHeight={100}
            mono={false}
            value={settings.description}
            onChange={(v) => patchSettings("description", v)}
            actions={(
              <>
                <AiWrite
                  task="examDescription"
                  input={{ examId: id, exam: settings }}
                  prompt="optional"
                  promptLabel="Anything to add? Topics covered, materials allowed"
                  placeholder="e.g. Covers chapters 3-5. Bring a calculator."
                  title="Write the rules students see before they start, from this exam's settings"
                  onResult={(d) => patchSettings("description", d.description)}
                />
                <AiTranslate value={settings.description} onChange={(v) => patchSettings("description", v)} />
              </>
            )}
          />

          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Kind">
              <select
                className="select"
                value={settings.mode}
                disabled={isLocked}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="quiz">Quiz — short and low stakes</option>
                <option value="test">Test — one attempt</option>
                <option value="mock">Mock — closes after a set time</option>
              </select>
            </Field>
            <Field label="Minutes">
              <input
                className="input tnum" type="number" min="1" style={{ width: 100 }}
                value={settings.durationMinutes} disabled={isLocked}
                onChange={(e) => patchSettings("durationMinutes", Number(e.target.value))}
              />
            </Field>
            <Field
              label="Attempts allowed"
              hint={settings.mode === "test" ? "Locked at 1 — that's what makes it a test." : undefined}
            >
              <input
                className="input tnum" type="number" min="1" style={{ width: 100 }}
                value={settings.mode === "test" ? 1 : settings.attemptsAllowed}
                disabled={isLocked || settings.mode === "test"}
                onChange={(e) => patchSettings("attemptsAllowed", Number(e.target.value))}
              />
            </Field>
            <Field label="Buffer seconds">
              <input
                className="input tnum" type="number" min="0" style={{ width: 100 }}
                value={settings.bufferSeconds} disabled={isLocked}
                onChange={(e) => patchSettings("bufferSeconds", Number(e.target.value))}
              />
            </Field>
          </div>

          {settings.mode === "mock" && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              <Field label="Opens at" hint="Leave blank to open as soon as it's published and active.">
                <input
                  className="input"
                  type="datetime-local"
                  value={isoToLocalInput(settings.opensAt)}
                  onChange={(e) => patchSettings("opensAt", localInputToIso(e.target.value))}
                />
              </Field>
              <Field
                label="Stays open for (hours)"
                hint={
                  settings.opensAt
                    ? "Closes on its own this many hours after it opens."
                    : "Set \"Opens at\" first — without it this counts from when the exam was created, which can already be in the past by the time you publish."
                }
              >
                <input
                  className="input tnum" type="number" min="0" step="0.5" style={{ width: 120 }}
                  value={settings.liveHours ?? ""}
                  disabled={!settings.opensAt}
                  onChange={(e) => patchSettings("liveHours", e.target.value === "" ? null : Number(e.target.value))}
                />
              </Field>
            </div>
          )}

          <div className="row" style={{ flexWrap: "wrap" }}>
            <Field label="Closes at" hint="Optional. Students can't start it after this time.">
              <input
                className="input"
                type="datetime-local"
                value={isoToLocalInput(settings.closesAt)}
                onChange={(e) => patchSettings("closesAt", localInputToIso(e.target.value))}
              />
            </Field>
            <Field label="Unpublish at" hint="Optional. Hidden from students from this time.">
              <input
                className="input"
                type="datetime-local"
                value={isoToLocalInput(settings.unpublishAt)}
                onChange={(e) => patchSettings("unpublishAt", localInputToIso(e.target.value))}
              />
            </Field>
          </div>

          <div className="row-tight" style={{ flexWrap: "wrap", gap: 16 }}>
            <label className="row-tight small" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={Boolean(settings.shuffleQuestions)}
                onChange={(e) => patchSettings("shuffleQuestions", e.target.checked)}
              />
              Shuffle question order per student
            </label>
          </div>

          {isLocked && (
            <p className="hint" style={{ margin: 0 }}>
              Kind, duration, attempts and buffer are locked — students have already started this exam.
              Title, description and the toggles above still save.
            </p>
          )}

        </div>
        </>)}

        {/* ---------------- questions ---------------- */}
        {tab === "questions" && (
        <div className="card stack">
          <div className="spread">
            <h2>Questions</h2>
            {!isLocked && (
              <div className="row-tight">
                <button
                  className="btn btn-sm btn-quiet"
                  onClick={() => { setAiPicking(!aiPicking); setPicking(false); setAiResult(null); }}
                >
                  {aiPicking ? <><X size={14} /> Done</> : <><Sparkles size={14} /> AI pick</>}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => { setPicking(!picking); setAiPicking(false); }}
                >
                  {picking ? <><X size={14} /> Done</> : <><Plus size={14} /> Add questions</>}
                </button>
              </div>
            )}
          </div>

          {aiPicking && (
            <div className="card-quiet stack">
              <p className="hint" style={{ margin: 0 }}>
                Fills a target count of questions from the bank — split across
                the types checked below, chosen by AI from questions matching
                the scope you set. Lands in the list below for you to review
                and remove anything you don't want, same as adding manually.
              </p>

              <ErrorNote error={aiPickError} />
              {aiResult && <div className="banner banner-ok">{aiResult}</div>}

              <div className="row-tight" style={{ flexWrap: "wrap" }}>
                {ALLOWED_TYPE_LABELS.map(([value, label]) => (
                  <label key={value} className="row-tight small" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={aiForm.types.includes(value)}
                      onChange={() => toggleAiType(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="row" style={{ flexWrap: "wrap" }}>
                <Field label="How many">
                  <input
                    className="input tnum" type="number" min="1" max="50" style={{ width: 90 }}
                    value={aiForm.count}
                    onChange={(e) => patchAiForm("count", e.target.value)}
                  />
                </Field>
                {subjects.length > 0 && (
                  <Field label="Subject">
                    <SearchSelect className="select" value={aiForm.subject} onChange={(e) => setAiSubject(e.target.value)}>
                      <option value="">Any subject</option>
                      {subjects.map((s) => (
                        <option key={s._id} value={s._id}>{s.title}</option>
                      ))}
                    </SearchSelect>
                  </Field>
                )}
                <Field label="Topic">
                  <SearchSelect className="select" value={aiForm.topic} onChange={(e) => patchAiForm("topic", e.target.value)}>
                    <option value="">{aiForm.subject ? "Any topic in this subject" : "Any topic"}</option>
                    <option value="none">Chapter pool only (no topic)</option>
                    {aiTopics.map((t) => (
                      <option key={t._id} value={t._id}>{t.label}</option>
                    ))}
                  </SearchSelect>
                </Field>
                <Field label="Difficulty">
                  <select className="select" value={aiForm.difficulty} onChange={(e) => patchAiForm("difficulty", e.target.value)}>
                    <option value="">Any</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </Field>
              </div>

              <div className="row">
                <button
                  className="btn btn-sm"
                  disabled={aiPickLoading || aiForm.types.length === 0}
                  onClick={runSmartPick}
                >
                  <Sparkles size={14} /> {aiPickLoading ? "Picking" : "Pick questions"}
                </button>
              </div>
            </div>
          )}

          {questions.length === 0 && !picking && (
            <Empty
              icon={ClipboardList}
              title="No questions yet"
              hint="An exam can mix multiple choice, true/false and written questions."
              action={<button className="btn" onClick={() => setPicking(true)}><Plus size={15} /> Add questions</button>}
            />
          )}

          {questions.map((question, index) => (
            <div key={question._id} className="row" style={{ alignItems: "flex-start" }}>
              <span className="tnum muted small" style={{ minWidth: 20, paddingTop: 3 }}>
                {index + 1}
              </span>

              <div className="grow">
                <div className="row-tight" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                  <TypePill type={question.type} />
                  <span className="tnum muted small">{question.marks} mark{question.marks === 1 ? "" : "s"}</span>
                  {question.type === "passage" && (
                    <span className="tnum muted small">
                      {question.subQuestions?.length || 0} sub-question{(question.subQuestions?.length || 0) === 1 ? "" : "s"}
                    </span>
                  )}
                  {question.type === "written" && (!question.rubric || question.rubric.length === 0) && (
                    <span className="pill pill-warn">No rubric</span>
                  )}
                </div>
                <div className="row-tight" style={{ alignItems: "flex-start", gap: 10, marginBottom: question.type === "mcq" ? 6 : 0 }}>
                  {question.questionImage?.url && (
                    <img
                      src={question.questionImage.url}
                      alt=""
                      style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
                    />
                  )}
                  <Latex as="div" className="grow small" style={{ lineHeight: 1.5 }}>{question.question}</Latex>
                </div>
                {question.type === "mcq" && question.options?.some((o) => o.image?.url) && (
                  <div className="row-tight" style={{ flexWrap: "wrap", gap: 6 }}>
                    {question.options.map((o) => o.image?.url && (
                      <img
                        key={o.key}
                        src={o.image.url}
                        alt=""
                        title={o.text}
                        style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 6 }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {!isLocked && (
                <div className="row-tight">
                  <button className="icon-btn" title="Move up" onClick={() => move(index, -1)} disabled={index === 0}>
                    <ChevronUp size={15} />
                  </button>
                  <button className="icon-btn" title="Move down" onClick={() => move(index, 1)}
                    disabled={index === questions.length - 1}>
                    <ChevronDown size={15} />
                  </button>
                  <button
                    className="icon-btn icon-btn-danger"
                    title="Take out of this exam"
                    onClick={() => save(ids.filter((qid) => qid !== question._id))}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {picking && (
            <div className="card-quiet stack">
              <div className="search-wrap">
                <Search size={15} className="search-icon" />
                <input
                  className="input"
                  style={{ paddingLeft: 36 }}
                  placeholder="Search the question bank"
                  value={search}
                  onChange={(e) => setFilter(setSearch)(e.target.value)}
                />
              </div>

              <div className="row-tight" style={{ flexWrap: "wrap" }}>
                <select className="select" value={typeFilter} onChange={(e) => setFilter(setTypeFilter)(e.target.value)}>
                  <option value="">All types</option>
                  <option value="mcq">Multiple choice</option>
                  <option value="mtf">True / false</option>
                  <option value="written">Written</option>
                  <option value="passage">Passage</option>
                </select>
                {subjects.length > 0 && (
                  <SearchSelect className="select" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
                    <option value="">All subjects</option>
                    {subjects.map((s) => (
                      <option key={s._id} value={s._id}>{s.title}</option>
                    ))}
                  </SearchSelect>
                )}
                <SearchSelect className="select" value={topicFilter} onChange={(e) => setFilter(setTopicFilter)(e.target.value)}>
                  <option value="">{subjectFilter ? "All topics in this subject" : "All topics"}</option>
                  {/* "none" is the same sentinel getQuestions already accepts
                      ({ topic: null } — every chapter-filed question with no
                      topic of its own). Without this option there was no way
                      to isolate chapter-pool questions at all: leaving the
                      filter on "All topics" mixed them in with every real
                      topic instead of letting them stand apart. */}
                  <option value="none">Chapter pool only (no topic)</option>
                  {topics.map((t) => (
                    <option key={t._id} value={t._id}>{t.label}</option>
                  ))}
                </SearchSelect>
                {allTags?.length > 0 && (
                  <SearchSelect className="select" value={tagFilter} onChange={(e) => setFilter(setTagFilter)(e.target.value)}>
                    <option value="">All tags</option>
                    {allTags.map((tag) => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </SearchSelect>
                )}
              </div>

              {bank.isFetching ? (
                <Loading />
              ) : (bank.data?.questions || []).filter((q) => !ids.includes(q._id)).length === 0 ? (
                <p className="hint" style={{ margin: 0 }}>
                  {bank.data?.total ? "Everything on this page is already added — try another page." : "Nothing matches these filters."}
                </p>
              ) : (
                (bank.data?.questions || [])
                  .filter((q) => !ids.includes(q._id))
                  .map((question) => (
                    <button
                      key={question._id}
                      className="row"
                      style={{
                        background: "var(--surface)", border: "none", borderRadius: 8,
                        padding: 10, font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer",
                      }}
                      disabled={saving}
                      onClick={() => save([...ids, question._id])}
                    >
                      <div className="grow">
                        <div className="row-tight" style={{ marginBottom: 3 }}>
                          <TypePill type={question.type} />
                          <span className="tnum muted small">{question.marks}</span>
                          {question.type === "passage" && (
                            <span className="tnum muted small">
                              {question.subQuestions?.length || 0} sub-question{(question.subQuestions?.length || 0) === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                        <div className="row-tight" style={{ alignItems: "flex-start", gap: 10 }}>
                          {question.questionImage?.url && (
                            <img
                              src={question.questionImage.url}
                              alt=""
                              style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
                            />
                          )}
                          <Latex as="div" className="grow small">{question.question}</Latex>
                        </div>
                      </div>
                      <span className="muted">+</span>
                    </button>
                  ))
              )}

              {bank.data && (
                <Pager page={bank.data.page} pages={bank.data.pages} total={bank.data.total} onChange={setBankPage} />
              )}
            </div>
          )}
        </div>

        )}

        {tab === "rules" && (<>
        {/* ---------------- script upload grace period ---------------- */}
        {summary.needsGrading && (
          <div className="card stack">
            <h2>Script upload grace period</h2>
            <p className="hint" style={{ margin: 0 }}>
              Once the timer ends, every other input locks but students can
              still attach photographed answer scripts for this many extra
              minutes before the attempt submits on its own. 0 turns it off.
            </p>
            {isLocked ? (
              <p className="small" style={{ margin: 0 }}>
                {exam.scriptGraceMinutes || 0} minute{(exam.scriptGraceMinutes || 0) === 1 ? "" : "s"} —
                locked, students have already started this exam.
              </p>
            ) : (
              <div className="row" style={{ alignItems: "flex-end" }}>
                <Field label="Minutes">
                  <input
                    className="input tnum"
                    type="number"
                    min="0"
                    style={{ width: 90 }}
                    value={graceValue}
                    onChange={(e) => setGraceDraft(e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>
        )}

        {/* ---------------- away limit ---------------- */}
        <div className="card stack">
          <h2>Leaving the exam</h2>
          <p className="hint" style={{ margin: 0 }}>
            Time away (another tab or app, or off the exam page) is always
            flagged for staff. This decides what happens when a student is
            away longer than the limit in one go. Students are told on the
            rules screen. A phone call or a lost connection counts as away.
          </p>
          <AwayLimitFields
            mode={away.awayMode}
            minutes={away.awayMinutes}
            disabled={isLocked}
            onChange={(patch) => setAwayDraft({ ...away, ...patch })}
          />
          {isLocked && <p className="small muted" style={{ margin: 0 }}>Locked, students have already started this exam.</p>}
        </div>

        {/* ---------------- calculator ---------------- */}
        <div className="card stack">
          <h2>Calculator</h2>
          <p className="hint" style={{ margin: 0 }}>
            An on-screen scientific calculator students can open during this
            exam. Match the real exam: leave it off where calculators aren't
            allowed.
          </p>
          <select
            className="select"
            style={{ maxWidth: 360 }}
            value={exam.calculator === true ? "on" : exam.calculator === false ? "off" : "batch"}
            disabled={savingSettings}
            onChange={(e) => updateExam({ id, calculator: { on: true, off: false, batch: null }[e.target.value] })}
          >
            <option value="batch">{terms.Batch} default ({terms.Batch} → What is included)</option>
            <option value="on">Allowed</option>
            <option value="off">Not allowed</option>
          </select>
          <span className="hint">Saves as soon as you pick.</span>
        </div>
        </>)}

        {/* ---------------- batches ---------------- */}
        {tab === "access" && (
        <div className="card stack">
          <div className="row-tight"><Users size={17} className="muted" /><h2>Who sits this exam</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            Students see it only if their batch is selected here.
          </p>

          <BatchAssign
            assigned={assignedBatchIds}
            allBatches={batches || []}
            onChange={(batchIds) => setItemBatches({ kind: "exams", itemId: id, batchIds })}
            terms={terms}
          />
        </div>

        )}

        {(tab === "settings" || tab === "rules") && (
          <SaveBar
            type="button"
            dirty={anyDirty}
            saving={savingSettings}
            disabled={!anyDirty || graceBad || awayBad}
            onSave={saveAll}
            onCancel={anyDirty ? discardAll : undefined}
            saveLabel={tab === "rules" ? "Save rules" : "Save settings"}
            note={graceBad ? "Grace minutes must be 0 or more" : awayBad ? "The away limit is at least 1 minute" : undefined}
          />
        )}

        {/* ---------------- actions ---------------- */}
        {tab === "settings" && (
        <div className="card row" style={{ flexWrap: "wrap" }}>
          {!exam.isPublished ? (
            <button className="btn" onClick={() => doPublish()} disabled={publishing}>
              <Send size={15} />
              {publishing ? "Publishing" : "Publish"}
            </button>
          ) : (
            <>
              <button
                className={exam.isActive ? "btn btn-quiet" : "btn"}
                onClick={() => setActive({ id, isActive: !exam.isActive })}
              >
                {exam.isActive
                  ? <><Pause size={15} /> Close to students</>
                  : <><Play size={15} /> Open to students</>}
              </button>

              {/* The only path to isPublished: false — see doUnpublish above
                  for why this exists at all. Deleting is unreachable without
                  it. */}
              <button className="btn btn-quiet" onClick={doUnpublish} disabled={publishing}>
                <EyeOff size={15} /> Unpublish
              </button>
            </>
          )}

          <button
            className="btn btn-quiet"
            onClick={async () => {
              const copy = await duplicate({ id, title: `${exam.title} (copy)` }).unwrap();
              navigate(`/exams/${copy._id}`);
            }}
          >
            <Copy size={15} /> Duplicate
          </button>

          <span className="grow" />

          {/* Owner/admin only, matching the server-side gate — a teacher would
              get a 403 clicking this, so it is not offered to them at all
              rather than offered and refused. */}
          {can("deleteExams") && (
          <button
            className="btn btn-danger"
            disabled={exam.isPublished}
            title={exam.isPublished ? "Unpublish it first (button above), then it can be deleted." : undefined}
            onClick={async () => {
              // Deleting is only reachable once the exam is already
              // unpublished, so attempts no longer decides whether deletion
              // is allowed — only what the warning says is at stake.
              const yes = await confirm({
                title: `Delete "${exam.title}"?`,
                body: attempts > 0
                  ? `This will permanently delete ${attempts} submission${attempts === 1 ? "" : "s"} along with the exam. This cannot be undone.`
                  : "This exam has no submissions and will be removed permanently.",
              });
              if (!yes) return;

              try {
                await remove(id).unwrap();
                navigate("/exams");
              } catch {
                // rendered above
              }
            }}
          >
            <Trash2 size={15} /> Delete
          </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
