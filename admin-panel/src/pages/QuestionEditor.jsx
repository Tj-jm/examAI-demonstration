import { useEffect, useRef, useState } from "react";
import VideoLessonPanel from "../components/VideoLessonPanel";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  useGetTreeQuery,
  useGetQuestionQuery,
  useCreateQuestionMutation,
  useUpdateQuestionMutation,
  useRescoreQuestionMutation,
  useDeleteQuestionMutation,
  useGetAuthoritiesQuery,
} from "../api/contentApi";
import { useDecideReviewMutation, useWriteModelAnswerMutation } from "../api/aiApi";
import { Trash2, Plus, X, AlertTriangle, ArrowLeft, CheckCircle2, Copy, Sparkles } from "lucide-react";
import SourcesEditor, { sourcesToRows, rowsToSources, hasBoard } from "../components/SourcesEditor";
import { Loading, ErrorNote, Field, FilingSelect, useConfirm } from "../components/bits";
import { SaveBar, useCtrlS, useUnsaved } from "../components/ListTools";
import { ImagePicker, VideoPicker, AttachmentPicker } from "../components/MediaPickers";
import { SKILL_TYPES } from "../constants/skillTypes";
import SearchSelect from "../components/SearchSelect";
import CodingFields, { BLANK_CODING, codingProblems, codingPayload, codingFromQuestion } from "../components/CodingFields";

// One true/false statement's share of the question's marks, as shown to
// the admin (scoring: backend submissionModel's scoreObjectiveAnswer).
const shareText = (marks, count) => {
  const share = count > 0 ? (Number(marks) || 0) / count : 0;
  return String(Math.round(share * 100) / 100);
};

const SKILL_TYPE_OPTIONS = [{ value: "", label: "Not set" }, ...SKILL_TYPES];

// One sub-question under a passage is shaped exactly like a standalone mcq
// (own options, own correctOption, own marks/negativeMarks) — see
// questionModel.js's Passage discriminator — so this is BLANK.options plus
// the two fields a standalone mcq gets from the top-level form instead.
const BLANK_SUB_QUESTION = {
  // "written": answered in text or photos, marked against its rubric.
  kind: "mcq",
  partLabel: "",
  modelAnswer: "",
  question: "",
  questionImage: null,
  questionImageUrl: null,
  options: [
    { key: "A", text: "", image: null, imageUrl: null },
    { key: "B", text: "", image: null, imageUrl: null },
    { key: "C", text: "", image: null, imageUrl: null },
    { key: "D", text: "", image: null, imageUrl: null },
  ],
  correctOption: "",
  marks: 1,
  negativeMarks: 0,
};

const BLANK = {
  type: "mcq",
  question: "",
  questionImage: null,
  questionImageUrl: null,
  solutionImage: null,
  solutionImageUrl: null,
  solutionVideo: null,
  solutionVideoUrl: null,
  solutionAttachments: [],
  // A single value encoding where this question is filed: "topic:<id>" for
  // a normal topic, or "chapter:<id>" for the chapter pool (no topic at
  // all) — see the filingOptions list built below. Kept as one string
  // rather than two separate fields so the dropdown has one obvious
  // selected value, the same way the flat "subject · chapter · topic"
  // dropdown always has.
  filing: "",
  marks: 1,
  negativeMarks: 0,
  difficulty: "medium",
  skillType: "",
  // Public archive fields — all optional, all default to "not archived",
  // so a question created here behaves exactly as before unless an admin
  // opts it into the archive explicitly.
  sources: [],
  isPublic: false,
  solutionText: "",
  options: [
    { key: "A", text: "", image: null, imageUrl: null },
    { key: "B", text: "", image: null, imageUrl: null },
    { key: "C", text: "", image: null, imageUrl: null },
    { key: "D", text: "", image: null, imageUrl: null },
  ],
  correctOption: "",
  statements: [
    { text: "", isTrue: true },
    { text: "", isTrue: false },
  ],
  rubric: [{ criterion: "", marks: 1 }],
  modelAnswer: "",
  subQuestions: [{ ...BLANK_SUB_QUESTION }],
  ...BLANK_CODING,
};

// The server validates all of this too — this exists so a teacher finds out
// while typing rather than after pressing save.
const problems = (form) => {
  const issues = [];

  if (!form.question.trim()) issues.push("Write the question.");
  if (!form.filing) {
    issues.push(form.type === "passage" ? "Choose a chapter." : "Choose a topic, or a chapter for the chapter pool.");
  }

  if (form.type === "mcq") {
    // An option can be a diagram with no words, which is common in physics.
    const filled = form.options.filter((o) => o.text.trim() || o.image);
    if (filled.length < 2) issues.push("Give at least two options.");
    const keys = filled.map((o) => o.key);
    if (new Set(keys).size !== keys.length) issues.push("Option letters must be unique.");
    if (!form.correctOption) issues.push("Mark which option is correct.");
    else if (!keys.includes(form.correctOption)) {
      issues.push("The correct option is not one of the options you have written.");
    }
  }

  if (form.type === "mtf") {
    if (form.statements.filter((s) => s.text.trim()).length < 2) {
      issues.push("Give at least two statements.");
    }
  }

  if (form.type === "written") {
    const rows = form.rubric.filter((r) => r.criterion.trim());
    if (rows.length === 0) {
      issues.push("Add at least one rubric row, or AI grading cannot mark this.");
    } else {
      const total = rows.reduce((sum, r) => sum + Number(r.marks || 0), 0);
      if (total !== Number(form.marks)) {
        issues.push(`Rubric adds up to ${total} but the question is worth ${form.marks}.`);
      }
    }
  }

  if (form.type === "coding") issues.push(...codingProblems(form));

  if (form.type === "passage") {
    if (form.filing && !form.filing.startsWith("chapter:")) {
      issues.push("Passage questions can only be filed under a chapter, not a topic.");
    }
    if (form.subQuestions.length === 0) issues.push("Add at least one question under the passage.");
    form.subQuestions.forEach((sq, i) => {
      const n = i + 1;
      if (!sq.question.trim()) issues.push(`Question ${n}: write the question.`);
      if (sq.kind === "written") {
        if (!(Number(sq.marks) > 0)) issues.push(`Question ${n}: give it marks.`);
        return;
      }
      const filled = sq.options.filter((o) => o.text.trim() || o.image);
      if (filled.length < 2) issues.push(`Question ${n}: give at least two options.`);
      const keys = filled.map((o) => o.key);
      if (new Set(keys).size !== keys.length) issues.push(`Question ${n}: option letters must be unique.`);
      if (!sq.correctOption) issues.push(`Question ${n}: mark which option is correct.`);
      else if (!keys.includes(sq.correctOption)) {
        issues.push(`Question ${n}: the correct option is not one of the options you have written.`);
      }
    });
  }

  return issues;
};

export default function QuestionEditor() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // The create route is /questions/new and carries no :id, so useParams gives
  // nothing back. Deriving isNew from the id meant the create form thought it
  // was editing a question called "undefined" and fetched a 404.
  const isNew = !id || location.pathname.endsWith("/new");

  const { data: tree } = useGetTreeQuery();
  const { data: authorities } = useGetAuthoritiesQuery();
  const { data: existing, isLoading } = useGetQuestionQuery(id, { skip: isNew });
  const [create, { isLoading: creating, error: createError }] = useCreateQuestionMutation();
  const [update, { isLoading: updating, error: updateError }] = useUpdateQuestionMutation();
  const [rescore, { error: rescoreError }] = useRescoreQuestionMutation();
  const [remove] = useDeleteQuestionMutation();
  const [decideReview, { isLoading: approving }] = useDecideReviewMutation();

  // Review.jsx's "Edit first" link sets this so a question opened from the
  // review queue returns there — otherwise both the cancel button and the
  // browser's back button dropped a reviewer into the general question view
  // with no path back to the rest of the queue they were working through.
  const cameFromReview = location.state?.from === "review";
  // Same problem, for an audit run: QuestionAudit.jsx's "Open" link, and
  // QuestionView.jsx's own "Edit" link forwarding it, both set this —
  // without it, editing a flagged question and clicking Back (or Cancel)
  // dropped an admin back on the plain question view with no way back to
  // the rest of that run's flagged items except re-navigating to the URL
  // by hand.
  const cameFromAudit = location.state?.from === "audit" ? location.state.auditId : null;
  const backTarget = cameFromAudit
    ? `/audit-pool/${cameFromAudit}`
    : cameFromReview
    ? "/review"
    : isNew
    ? "/questions"
    : `/questions/${id}`;
  // The view keeps where it was opened from (the Archive, say).
  const backState = !cameFromAudit && !cameFromReview && !isNew ? location.state : undefined;

  const [form, setForm] = useState(BLANK);
  // Kept out of `form` as plain text rather than the joined array, so typing
  // "reserved, " doesn't get re-split and re-joined (and the cursor bounced)
  // on every keystroke.
  const [tagsText, setTagsText] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const confirm = useConfirm();

  // Step one of "subject, then topic/chapter" (see bits.jsx's FilingSelect) —
  // never sent to the server itself, form.filing already implies a subject
  // via whichever topic or chapter it names. Kept as its own piece of state
  // purely to scope the second dropdown down to one subject's chapters
  // instead of listing the entire syllabus in one flat control.
  const [filingSubject, setFilingSubject] = useState("");

  // "Add a written part" on a passage opens a new written question with the
  // passage filled in (utils/questionText.js on the server).
  useEffect(() => {
    const prefill = isNew && location.state?.prefill;
    if (!prefill) return;
    setForm((f) => ({ ...f, ...prefill }));
    if (location.state.subject) setFilingSubject(location.state.subject);
  }, [isNew, location.state]);

  useEffect(() => {
    if (!existing) return;
    setTagsText((existing.tags || []).join(", "));
    setFilingSubject(existing.subject?._id || existing.subject || "");
    setForm({
      ...BLANK,
      ...existing,
      // The api returns populated media objects; the form holds ids and keeps
      // the url alongside purely to render a thumbnail.
      questionImage: existing.questionImage?._id || existing.questionImage || null,
      questionImageUrl: existing.questionImage?.url || null,
      solutionImage: existing.solutionImage?._id || existing.solutionImage || null,
      solutionImageUrl: existing.solutionImage?.url || null,
      solutionVideo: existing.solutionVideo?._id || existing.solutionVideo || null,
      solutionVideoUrl: existing.solutionVideo?.url || null,
      sources: sourcesToRows(existing.sources),
      // A saved question has either a topic or (chapter pool) just a
      // chapter — never neither, the server enforces that — so exactly one
      // of these branches applies.
      filing: existing.topic
        ? `topic:${existing.topic._id || existing.topic}`
        : existing.chapter
        ? `chapter:${existing.chapter._id || existing.chapter}`
        : "",
      options: existing.options?.length
        ? existing.options.map((o) => ({
            ...o,
            image: o.image?._id || o.image || null,
            imageUrl: o.image?.url || null,
          }))
        : BLANK.options,
      statements: existing.statements?.length ? existing.statements : BLANK.statements,
      rubric: existing.rubric?.length ? existing.rubric : BLANK.rubric,
      subQuestions: existing.subQuestions?.length
        ? existing.subQuestions.map((sq) => ({
            question: sq.question || "",
            questionImage: sq.questionImage?._id || sq.questionImage || null,
            questionImageUrl: sq.questionImage?.url || null,
            options: (sq.options || []).map((o) => ({
              ...o,
              image: o.image?._id || o.image || null,
              imageUrl: o.image?.url || null,
            })),
            correctOption: sq.correctOption || "",
            marks: sq.marks ?? 1,
            negativeMarks: sq.negativeMarks ?? 0,
            kind: sq.type === "written" ? "written" : "mcq",
            partLabel: sq.label || "",
            modelAnswer: sq.modelAnswer || "",
            rubric: sq.rubric || [],
          }))
        : BLANK.subQuestions,
      solutionText: existing.solutionText || "",
      ...codingFromQuestion(existing),
    });
  }, [existing]);

  // What the form looked like once loaded, to tell whether anything changed.
  const formRef = useRef(null);
  const [initialKey, setInitialKey] = useState(null);
  const formKey = JSON.stringify([form, tagsText], (key, value) => (key && (/Url$/.test(key) || key === "url") ? undefined : value));
  const loaded = isNew || (existing && form._id === existing._id);
  useEffect(() => {
    if (initialKey === null && loaded) setInitialKey(formKey);
  }, [loaded, formKey, initialKey]);
  const dirty = initialKey !== null && formKey !== initialKey;
  const { leave, clear } = useUnsaved(dirty);
  useCtrlS(() => {
    if (!creating && !updating && problems(form).length === 0) formRef.current?.requestSubmit();
  });

  if (!isNew && isLoading) return <Loading />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const issues = problems(form);
  const saving = creating || updating;

  // Step one: which subject. Step two (FilingSelect, rendered below) is
  // scoped to just this subject's chapters — a flat dropdown mixing every
  // topic and every chapter-pool option across the whole syllabus got
  // unreadable past a couple of subjects.
  const subjects = (tree || []).map((s) => ({ _id: s._id, title: s.title }));
  const filingChapters = (tree || []).find((s) => s._id === filingSubject)?.chapters || [];

  const save = async (event) => {
    event.preventDefault();
    if (issues.length) return;

    // form.filing is "topic:<id>" or "chapter:<id>" — split it back into the
    // two separate fields the server's resolveFiling() expects. Sending both
    // (one always empty) rather than omitting the other lets an edit switch
    // a question from a topic to the chapter pool or back, which needs both
    // fields present so the server knows to clear the one being dropped.
    const [filingKind, filingId] = form.filing.split(":");

    // Only the fields that belong to this type are sent, so switching type
    // while drafting does not carry stale options into a written question.
    const payload = {
      type: form.type,
      question: form.question,
      topic: filingKind === "topic" ? filingId : "",
      chapter: filingKind === "chapter" ? filingId : "",
      marks: Number(form.marks),
      negativeMarks: Number(form.negativeMarks),
      difficulty: form.difficulty,
      skillType: form.skillType || "",
      sources: rowsToSources(form.sources),
      // No board left means nowhere in the archive to show it.
      isPublic: !!form.isPublic && hasBoard(form.sources),
      questionImage: form.questionImage || null,
      solutionImage: form.solutionImage || null,
      solutionVideo: form.solutionVideo || null,
      solutionAttachments: (form.solutionAttachments || []).map((a) => a._id),
      // Empty string, not undefined. The server skips undefined keys, so
      // `|| undefined` made clearing a field impossible — the old value simply
      // stayed and the delete looked like it silently failed.
      solutionText: form.solutionText || "",
      tags: tagsText.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      ...(form.type === "mcq" && {
        options: form.options
          .filter((o) => o.text.trim() || o.image)
          // null rather than undefined, so removing an option's image sticks.
          .map((o) => ({ key: o.key, text: o.text || "", image: o.image || null })),
        correctOption: form.correctOption,
      }),
      ...(form.type === "coding" && codingPayload(form)),
      ...(form.type === "mtf" && {
        statements: form.statements.filter((s) => s.text.trim()),
      }),
      ...(form.type === "written" && {
        rubric: form.rubric
          .filter((r) => r.criterion.trim())
          .map((r) => ({ criterion: r.criterion, marks: Number(r.marks) })),
        modelAnswer: form.modelAnswer || "",
        context: form.context || "",
        partLabel: form.partLabel || "",
        group: form.group || "",
      }),
      // marks is sent above too, but the server always overwrites it with
      // the sum of these on save — see questionModel.js's pre("validate")
      // hook on the Passage discriminator.
      ...(form.type === "passage" && {
        subQuestions: form.subQuestions.map((sq) => sq.kind === "written" ? {
          type: "written",
          label: sq.partLabel || "",
          question: sq.question,
          questionImage: sq.questionImage || null,
          marks: Number(sq.marks),
          modelAnswer: sq.modelAnswer || "",
          // A rubric from AI (extraction, generation, "Write model answer")
          // stays; a one-line one follows the marks; none gets one line.
          rubric: sq.rubric?.length > 1
            ? sq.rubric
            : [{ criterion: sq.rubric?.[0]?.criterion || "Matches the model answer", marks: Number(sq.marks) }],
        } : ({
          type: "mcq",
          label: sq.partLabel || "",
          question: sq.question,
          questionImage: sq.questionImage || null,
          options: sq.options
            .filter((o) => o.text.trim() || o.image)
            .map((o) => ({ key: o.key, text: o.text || "", image: o.image || null })),
          correctOption: sq.correctOption,
          marks: Number(sq.marks),
          negativeMarks: Number(sq.negativeMarks),
        })),
      }),
    };

    try {
      if (isNew) {
        const made = await create(payload).unwrap();
        clear();
        navigate(`/questions/${made._id}`);
      } else {
        const saved = await update({ id, ...payload }).unwrap();
        clear();
        // The answer key changed and students have already finished exams
        // with this question: offer to re-score them so everyone is marked
        // against the same key.
        if (saved.rescore) {
          const { submissions, exams } = saved.rescore;
          const yes = await confirm({
            title: "Re-score finished exams?",
            body: `The answer key changed. ${submissions} finished attempt${submissions === 1 ? "" : "s"} in ${exams} exam${exams === 1 ? "" : "s"} were marked with the old one. Re-score them with the new key? Marks a teacher set by hand are kept.`,
            confirmLabel: "Re-score",
            cancelLabel: "Leave as is",
            tone: "neutral",
          });
          if (yes) await rescore(id).unwrap();
        }
        // A reviewer who came here to fix something before deciding wants to
        // get back to the queue, not to this one question's page — that was
        // the whole reason "Edit first" exists on the Review screen.
        navigate(cameFromReview ? "/review" : `/questions/${id}`, { state: backState });
      }
    } catch {
      // rendered below
    }
  };

  const approve = async () => {
    await decideReview({ ids: [id], decision: "approve" });
    navigate(cameFromReview ? "/review" : `/questions/${id}`, { state: backState });
  };

  const destroy = async () => {
    const yes = await confirm({
      title: "Delete this question?",
      body: "It will be removed from the bank. A question used by an exam cannot be deleted.",
    });
    if (!yes) return;

    try {
      await remove(id).unwrap();
      navigate("/questions");
    } catch (error) {
      setDeleteError(error);
    }
  };

  return (
    <form ref={formRef} className="page" onSubmit={save}>
      <div className="page-head spread">
        <div>
          <h1>{isNew ? "New question" : "Edit question"}</h1>
          {!isNew && existing?.status === "pending_review" && (
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              Awaiting review{cameFromReview ? " · editing before you decide" : ""}.
            </p>
          )}
        </div>
        <div className="row-tight">
          {!isNew && existing?.status === "pending_review" && (
            <button
              type="button"
              className="btn btn-sm btn-ok"
              disabled={approving}
              onClick={approve}
            >
              <CheckCircle2 size={14} /> {approving ? "Approving" : "Approve"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => leave(backTarget, { state: backState })}
          >
            <ArrowLeft size={14} /> Back
          </button>
          {!isNew && (
            <button type="button" className="icon-btn icon-btn-danger" title="Delete" onClick={destroy}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={createError || updateError || rescoreError || deleteError} />

        <div className="card stack">
          {isNew && (
            <div className="row" style={{ gap: 6 }}>
              {["mcq", "mtf", "written", "passage", "coding"].map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`pill pill-btn${form.type === type ? " pill-on" : ""}`}
                  onClick={() =>
                    set({
                      type,
                      // Switching to/from passage can strand a topic pick
                      // that's no longer valid (passage is chapter-only) —
                      // clearing it forces a fresh, type-appropriate choice.
                      filing: type === "passage" && !form.filing.startsWith("chapter:") ? "" : form.filing,
                    })
                  }
                >
                  {{ mcq: "Multiple choice", mtf: "True / false", written: "Written", passage: "Passage (chapter pool)", coding: "Coding" }[type]}
                </button>
              ))}
            </div>
          )}

          <Field label="Question" hint="Maths goes in as LaTeX, like $v = 2$ m/s.">
            <textarea
              className="textarea"
              value={form.question}
              onChange={(e) => set({ question: e.target.value })}
            />
          </Field>

          <div className="field">
            <span className="label">Diagram</span>
            <ImagePicker
              value={form.questionImage}
              url={form.questionImageUrl}
              label="Add a diagram"
              ai="diagram"
              aiContext={form.question}
              onChange={(id, url) => set({ questionImage: id, questionImageUrl: url })}
            />
          </div>

          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Subject">
              <SearchSelect
                className="select"
                value={filingSubject || ""}
                onChange={(e) => {
                  setFilingSubject(e.target.value);
                  // A topic/chapter from the old subject no longer applies.
                  set({ filing: "" });
                }}
              >
                <option value="">Choose a subject</option>
                {subjects.map((s) => (
                  <option key={s._id} value={s._id}>{s.title}</option>
                ))}
              </SearchSelect>
            </Field>

            {filingSubject && (
              <Field label={form.type === "passage" ? "Chapter" : "Topic or chapter"}>
                <FilingSelect
                  chapters={filingChapters}
                  value={form.filing}
                  onChange={(filing) => set({ filing })}
                  passageOnly={form.type === "passage"}
                  placeholder={form.type === "passage" ? "Choose a chapter" : "Choose a topic or chapter"}
                />
              </Field>
            )}
          </div>

          <div className="row" style={{ alignItems: "flex-end" }}>
            <Field label="Marks" hint={form.type === "passage" ? "Sum of the sub-questions below." : undefined}>
              {form.type === "passage" ? (
                <input
                  className="input tnum"
                  value={form.subQuestions.reduce((sum, sq) => sum + Number(sq.marks || 0), 0)}
                  disabled
                />
              ) : (
                <input
                  className="input tnum"
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.marks}
                  onChange={(e) => set({ marks: e.target.value })}
                />
              )}
            </Field>

            {/* True/false has no separate penalty: a wrong statement takes
                away its own share of the marks. */}
            {form.type === "mcq" && (
              <Field label="Penalty for a wrong answer">
                <input
                  className="input tnum"
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.negativeMarks}
                  onChange={(e) => set({ negativeMarks: e.target.value })}
                />
              </Field>
            )}

            <Field label="Difficulty">
              <select
                className="select"
                value={form.difficulty || "medium"}
                onChange={(e) => set({ difficulty: e.target.value })}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </Field>

            <Field label="Skill type">
              <select
                className="select"
                value={form.skillType || ""}
                onChange={(e) => set({ skillType: e.target.value })}
              >
                {SKILL_TYPE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <SourcesEditor
              value={form.sources}
              authorities={authorities}
              onChange={(sources) =>
                // Removing the last board while public would leave a question
                // in a generic "archive" that doesn't exist — pull it out.
                set(hasBoard(sources) ? { sources } : { sources, isPublic: false })
              }
            />
            <div>
              <button
                type="button"
                className={`pill pill-btn${form.isPublic ? " pill-ok" : ""}`}
                disabled={!form.isPublic && !hasBoard(form.sources)}
                onClick={() => set({ isPublic: !form.isPublic })}
                title={
                  form.isPublic
                    ? "Visible in the public archive — click to remove"
                    : hasBoard(form.sources)
                    ? "Not in the public archive — click to add"
                    : "Add a board/exam/book above first — there is no generic archive, only a specific one"
                }
              >
                {form.isPublic ? "Public in archive" : "Not in archive"}
              </button>
            </div>
          </div>

          <Field label="Tags" hint="Comma separated — e.g. reserved, exam-only, revision.">
            <input
              className="input"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </Field>
        </div>

        {form.type === "mcq" && (
          <div className="card stack">
            <h3>Options</h3>
            <p className="hint" style={{ margin: 0 }}>Tap the letter to mark the correct one.</p>

            {form.options.map((option, index) => (
              <div key={index} className="row-tight">
                <button
                  type="button"
                  className={`pill pill-btn${form.correctOption === option.key ? " pill-ok" : ""}`}
                  style={{ minWidth: 34 }}
                  onClick={() => set({ correctOption: option.key })}
                >
                  {option.key}
                </button>
                <input
                  className="input"
                  placeholder={`Option ${option.key}`}
                  value={option.text}
                  onChange={(e) => {
                    const options = [...form.options];
                    options[index] = { ...option, text: e.target.value };
                    set({ options });
                  }}
                />

                <ImagePicker
                  compact
                  value={option.image}
                  url={option.imageUrl}
                  label={`Option ${option.key} image`}
                  onChange={(id, url) => {
                    const options = [...form.options];
                    options[index] = { ...option, image: id, imageUrl: url };
                    set({ options });
                  }}
                />
                {form.options.length > 2 && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    title="Remove this option"
                    onClick={() => set({ options: form.options.filter((_, i) => i !== index) })}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="btn btn-sm btn-quiet"
              style={{ alignSelf: "flex-start" }}
              onClick={() =>
                set({
                  options: [
                    ...form.options,
                    { key: String.fromCharCode(65 + form.options.length), text: "" },
                  ],
                })
              }
            >
              <Plus size={13} /> Add an option
            </button>
          </div>
        )}

        {form.type === "mtf" && (
          <div className="card stack">
            <h3>Statements</h3>
            <p className="hint" style={{ margin: 0 }}>
              Students mark each one true or false. Each statement is worth marks ÷ statements = {shareText(form.marks, form.statements.filter((s) => s.text.trim()).length)}: a right answer adds it, a wrong one takes it away, a blank one is 0.
            </p>

            {form.statements.map((statement, index) => (
              <div key={index} className="row-tight">
                <button
                  type="button"
                  className={`pill pill-btn ${statement.isTrue ? "pill-ok" : "pill-bad"}`}
                  style={{ minWidth: 52 }}
                  onClick={() => {
                    const statements = [...form.statements];
                    statements[index] = { ...statement, isTrue: !statement.isTrue };
                    set({ statements });
                  }}
                >
                  {statement.isTrue ? "True" : "False"}
                </button>
                <input
                  className="input"
                  placeholder="Statement"
                  value={statement.text}
                  onChange={(e) => {
                    const statements = [...form.statements];
                    statements[index] = { ...statement, text: e.target.value };
                    set({ statements });
                  }}
                />
                {form.statements.length > 2 && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    title="Remove this statement"
                    onClick={() => set({ statements: form.statements.filter((_, i) => i !== index) })}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="btn btn-sm btn-quiet"
              style={{ alignSelf: "flex-start" }}
              onClick={() => set({ statements: [...form.statements, { text: "", isTrue: true }] })}
            >
              <Plus size={13} /> Add a statement
            </button>
          </div>
        )}

        {form.type === "written" && form.context && (
          <div className="card stack">
            <h3>Part of a passage</h3>
            <p className="hint" style={{ margin: 0 }}>Optional. For a creative question: the passage (উদ্দীপক) shows above this part, and the AI reads both.</p>
            <Field label="Passage">
              <textarea className="textarea" value={form.context || ""} onChange={(e) => set({ context: e.target.value })} />
            </Field>
            <Field label="Part label" hint="ক, খ, গ, ঘ or a, b, c">
              <input className="input" style={{ width: 90 }} maxLength={10} value={form.partLabel || ""} onChange={(e) => set({ partLabel: e.target.value })} />
            </Field>
          </div>
        )}

        {form.type === "written" && (
          <div className="card stack">
            <h3>Rubric</h3>
            <p className="hint" style={{ margin: 0 }}>
              This is what AI grading marks against. Without it, every answer needs marking by hand.
            </p>

            {form.rubric.map((row, index) => (
              <div key={index} className="row-tight">
                <input
                  className="input"
                  placeholder="What earns these marks"
                  value={row.criterion}
                  onChange={(e) => {
                    const rubric = [...form.rubric];
                    rubric[index] = { ...row, criterion: e.target.value };
                    set({ rubric });
                  }}
                />
                <input
                  className="input tnum"
                  type="number"
                  min="0"
                  step="0.5"
                  style={{ width: 78 }}
                  value={row.marks}
                  onChange={(e) => {
                    const rubric = [...form.rubric];
                    rubric[index] = { ...row, marks: e.target.value };
                    set({ rubric });
                  }}
                />
                {form.rubric.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    title="Remove this criterion"
                    onClick={() => set({ rubric: form.rubric.filter((_, i) => i !== index) })}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className="btn btn-sm btn-quiet"
              style={{ alignSelf: "flex-start" }}
              onClick={() => set({ rubric: [...form.rubric, { criterion: "", marks: 1 }] })}
            >
              <Plus size={13} /> Add a criterion
            </button>

            <Field label="Model answer" hint="For the marker's reference. Students never see it.">
              <textarea
                className="textarea"
                value={form.modelAnswer}
                onChange={(e) => set({ modelAnswer: e.target.value })}
              />
            </Field>
            {/* Copies the model answer into the solution students see after
                answering. Asks first if there's already a solution. */}
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              style={{ alignSelf: "flex-start" }}
              disabled={!form.modelAnswer?.trim() || form.modelAnswer === form.solutionText}
              onClick={async () => {
                if (form.solutionText?.trim()) {
                  const yes = await confirm({
                    title: "Replace the solution?",
                    body: "The current solution will be replaced with the model answer. Nothing is saved until you press Save.",
                    confirmLabel: "Replace",
                    tone: "neutral",
                  });
                  if (!yes) return;
                }
                set({ solutionText: form.modelAnswer });
              }}
            >
              <Copy size={13} /> {form.modelAnswer && form.modelAnswer === form.solutionText ? "Used as the solution" : "Use as the solution"}
            </button>
          </div>
        )}

        {form.type === "coding" && <CodingFields form={form} set={set} />}

        {form.type === "passage" && (
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Questions under this passage</h3>
            <p className="hint" style={{ margin: 0 }}>
              Each is MCQ (marked automatically) or written (marked by a grader or AI, like any written question).
            </p>

            {form.subQuestions.map((sq, index) => {
              const setSub = (patch) => {
                const subQuestions = [...form.subQuestions];
                subQuestions[index] = { ...sq, ...patch };
                set({ subQuestions });
              };

              return (
                <div key={index} className="card-quiet stack">
                  <div className="row-tight spread">
                    <div className="row-tight">
                      <strong>Question {index + 1}</strong>
                      {[["mcq", "MCQ"], ["written", "Written"]].map(([v, l]) => (
                        <button key={v} type="button" className={`pill pill-btn${(sq.kind || "mcq") === v ? " pill-on" : ""}`} onClick={() => setSub({ kind: v })}>{l}</button>
                      ))}
                    </div>
                    {form.subQuestions.length > 1 && (
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        title="Remove this question"
                        onClick={() => set({ subQuestions: form.subQuestions.filter((_, i) => i !== index) })}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  <Field label="Question">
                    <textarea
                      className="textarea"
                      value={sq.question}
                      onChange={(e) => setSub({ question: e.target.value })}
                    />
                  </Field>

                  {sq.kind === "written" ? (
                    <>
                      <div className="row" style={{ alignItems: "flex-end" }}>
                        <Field label="Label" hint="ক, খ or a, b">
                          <input className="input" style={{ width: 80 }} maxLength={10} value={sq.partLabel} onChange={(e) => setSub({ partLabel: e.target.value })} />
                        </Field>
                        <Field label="Marks">
                          <input className="input tnum" type="number" min="0" step="0.25" value={sq.marks} onChange={(e) => setSub({ marks: e.target.value })} />
                        </Field>
                      </div>
                      <Field label="Model answer" hint="For the marker and AI grading. Students never see it.">
                        <textarea className="textarea" value={sq.modelAnswer} onChange={(e) => setSub({ modelAnswer: e.target.value })} />
                      </Field>
                      <ModelAnswerAi passage={form.question} sq={sq} onDone={(data) => setSub({ modelAnswer: data.modelAnswer, rubric: data.rubric })} />
                      {sq.rubric?.length > 1 && <span className="hint">Rubric: {sq.rubric.map((r) => `${r.criterion} (${r.marks})`).join(" · ")}</span>}
                    </>
                  ) : (<>
                  <div className="field">
                    <span className="label">Diagram</span>
                    <ImagePicker
                      value={sq.questionImage}
                      url={sq.questionImageUrl}
                      label="Add a diagram"
                      ai="diagram"
                      aiContext={[form.question, sq.question].filter(Boolean).join("\n")}
                      onChange={(id, url) => setSub({ questionImage: id, questionImageUrl: url })}
                    />
                  </div>

                  <p className="hint" style={{ margin: 0 }}>Tap the letter to mark the correct one.</p>
                  {sq.options.map((option, oi) => (
                    <div key={oi} className="row-tight">
                      <button
                        type="button"
                        className={`pill pill-btn${sq.correctOption === option.key ? " pill-ok" : ""}`}
                        style={{ minWidth: 34 }}
                        onClick={() => setSub({ correctOption: option.key })}
                      >
                        {option.key}
                      </button>
                      <input
                        className="input"
                        placeholder={`Option ${option.key}`}
                        value={option.text}
                        onChange={(e) => {
                          const options = [...sq.options];
                          options[oi] = { ...option, text: e.target.value };
                          setSub({ options });
                        }}
                      />
                      <ImagePicker
                        compact
                        value={option.image}
                        url={option.imageUrl}
                        label={`Option ${option.key} image`}
                        onChange={(id, url) => {
                          const options = [...sq.options];
                          options[oi] = { ...option, image: id, imageUrl: url };
                          setSub({ options });
                        }}
                      />
                      {sq.options.length > 2 && (
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          title="Remove this option"
                          onClick={() => setSub({ options: sq.options.filter((_, i) => i !== oi) })}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}

                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    style={{ alignSelf: "flex-start" }}
                    onClick={() =>
                      setSub({
                        options: [
                          ...sq.options,
                          { key: String.fromCharCode(65 + sq.options.length), text: "", image: null, imageUrl: null },
                        ],
                      })
                    }
                  >
                    <Plus size={13} /> Add an option
                  </button>

                  <div className="row" style={{ alignItems: "flex-end" }}>
                    <Field label="Marks">
                      <input
                        className="input tnum"
                        type="number"
                        min="0"
                        step="0.25"
                        value={sq.marks}
                        onChange={(e) => setSub({ marks: e.target.value })}
                      />
                    </Field>
                    <Field label="Penalty for a wrong answer">
                      <input
                        className="input tnum"
                        type="number"
                        min="0"
                        step="0.25"
                        value={sq.negativeMarks}
                        onChange={(e) => setSub({ negativeMarks: e.target.value })}
                      />
                    </Field>
                  </div>
                  </>)}
                </div>
              );
            })}

            <button
              type="button"
              className="btn btn-sm btn-quiet"
              style={{ alignSelf: "flex-start" }}
              onClick={() => set({ subQuestions: [...form.subQuestions, { ...BLANK_SUB_QUESTION }] })}
            >
              <Plus size={13} /> Add a question
            </button>
          </div>
        )}

        <div className="card stack">
          <Field label="Solution" hint="Shown to students after the exam.">
            <textarea
              className="textarea"
              value={form.solutionText}
              onChange={(e) => set({ solutionText: e.target.value })}
            />
          </Field>

          <div className="field">
            <span className="label">Worked diagram</span>
            <ImagePicker
              ai="diagram"
              aiContext={[form.question, form.solutionText].filter(Boolean).join("\n\nSolution:\n")}
              value={form.solutionImage}
              url={form.solutionImageUrl}
              label="Add a diagram"
              onChange={(id, url) => set({ solutionImage: id, solutionImageUrl: url })}
            />
          </div>

          <div className="field">
            <span className="label">Solution video</span>
            <VideoPicker
              value={form.solutionVideo}
              url={form.solutionVideoUrl}
              onChange={(id, url) => set({ solutionVideo: id, solutionVideoUrl: url })}
            />
          </div>

          <div className="field">
            <span className="label">Attachments</span>
            <AttachmentPicker
              value={form.solutionAttachments}
              onChange={(solutionAttachments) => set({ solutionAttachments })}
            />
            <p className="hint" style={{ margin: "4px 0 0" }}>
              Any number of files — PDF, image, or document — upload fresh or
              pick from your library, same as a lecture's own attachments.
              Shown to students alongside the solution once they're reviewing
              a graded exam. Video goes through its own picker above.
            </p>
          </div>
        </div>

        {!isNew && <VideoLessonPanel question={id} />}

        {issues.length > 0 && (
          <div className="banner banner-warn">
            <div className="row-tight" style={{ marginBottom: 6 }}>
              <AlertTriangle size={15} />
              <strong style={{ fontWeight: 500 }}>Not ready to save</strong>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
          </div>
        )}

        <SaveBar
          dirty={dirty}
          saving={saving}
          disabled={issues.length > 0}
          onCancel={() => leave(backTarget, { state: backState })}
          saveLabel={isNew ? "Create question" : "Save changes"}
          note={issues.length > 0 ? "Not ready to save yet" : undefined}
        />
      </div>
    </form>
  );
}

// Writes a written question's model answer and rubric with AI.
function ModelAnswerAi({ passage, sq, onDone }) {
  const [write, { isLoading, error }] = useWriteModelAnswerMutation();
  return (
    <div className="row-tight">
      <button type="button" className="btn btn-sm btn-quiet" disabled={isLoading || !sq.question.trim()}
        onClick={async () => { try { onDone(await write({ passage, question: sq.question, marks: Number(sq.marks) || 1 }).unwrap()); } catch { /* shown below */ } }}>
        <Sparkles size={13} /> {isLoading ? "Writing…" : "Write model answer with AI"}
      </button>
      {error && <ErrorNote error={error} />}
    </div>
  );
}
