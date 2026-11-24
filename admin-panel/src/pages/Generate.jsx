import { useState } from "react";
import { Link } from "react-router-dom";
import { useGetTreeQuery, useGetQuestionsQuery, useApplyModelAnswersMutation } from "../api/contentApi";
import {
  useGetAiConfigQuery,
  useGenerateQuestionsMutation,
  useBackfillSolutionsMutation,
  useBackfillSkillTypesMutation,
  useGetAiUsageQuery,
} from "../api/aiApi";
import { Sparkles, Wand2, FileText, BarChart3, AlertTriangle, Check } from "lucide-react";
import { Loading, ErrorNote, Field, FilingSelect } from "../components/bits";
import Latex from "../components/Latex";
import DocumentIngest, { Hint } from "../components/DocumentIngest";
import DocumentTranscribe from "../components/DocumentTranscribe";
import SearchSelect from "../components/SearchSelect";

export default function Generate() {
  const { data: config, isLoading, error: configError } = useGetAiConfigQuery();
  const { data: tree } = useGetTreeQuery();
  const usage = useGetAiUsageQuery(30);
  const [generate, genState] = useGenerateQuestionsMutation();
  const [backfill, fillState] = useBackfillSolutionsMutation();
  const [classifySkill, classifyState] = useBackfillSkillTypesMutation();

  const missing = useGetQuestionsQuery({ hasSolution: "false", limit: 25 });
  // Written questions among them that already carry a model answer: those
  // can take it as their solution, no AI needed.
  const withModel = useGetQuestionsQuery({ hasSolution: "false", type: "written", hasModelAnswer: "true", limit: 1 });
  const [applyModelAnswers, modelState] = useApplyModelAnswersMutation();
  const modelCount = withModel.data?.total || 0;
  const missingSkill = useGetQuestionsQuery({ skillType: "unassigned", limit: 25 });

  // filingSubject is UI-only — it narrows which chapters FilingSelect offers,
  // it is never sent to the server. filing carries the actual selection, in
  // the same "topic:<id>"/"chapter:<id>" encoding QuestionEditor.jsx uses.
  const [filingSubject, setFilingSubject] = useState("");
  // A picture dropped on the document card, read on the "Read text" card.
  const [picture, setPicture] = useState(null);
  const [form, setForm] = useState({
    filing: "", sourceText: "", count: 5, types: ["mcq"], difficulty: "medium", language: "",
  });

  if (isLoading) return <Loading />;

  // Reading config.model when the query failed throws, and a thrown render
  // takes the whole page white with nothing to explain it. Teachers cannot
  // reach this endpoint at all, so this is a normal state, not an edge case.
  if (!config) {
    return (
      <div className="page">
        <div className="page-head"><h1>Generate</h1></div>
        <div className="card stack">
          <ErrorNote error={configError} />
          <p className="muted small" style={{ margin: 0 }}>
            AI settings are managed by an owner or admin.
          </p>
        </div>
      </div>
    );
  }

  // Nothing here works without a provider, so the screen says so rather than
  // letting someone fill in a long form and hit a wall.
  if (!config.model) {
    return (
      <div className="page">
        <div className="page-head"><h1>Generate</h1></div>
        <div className="card stack">
          <p style={{ margin: 0 }}>No AI provider is connected yet.</p>
          <Link className="btn" style={{ alignSelf: "flex-start" }} to="/settings">
            <Sparkles size={15} /> Connect one in settings
          </Link>
        </div>
      </div>
    );
  }

  const subjects = (tree || []).map((s) => ({ _id: s._id, title: s.title }));
  const filingSubjectObj = (tree || []).find((s) => s._id === filingSubject);
  const filingChapters = filingSubjectObj?.chapters || [];

  const [filingKind, filingRefId] = (form.filing || "").split(":");
  const topicId = filingKind === "topic" ? filingRefId : undefined;
  const chapterId = filingKind === "chapter" ? filingRefId : undefined;

  // Same lookup shape as the Review link needs below — the chapter a filing
  // resolves to, and (when filing to a topic) that topic within it.
  const filingChapterObj = filingChapters.find(
    (c) => c._id === chapterId || (c.topics || []).some((t) => t._id === topicId)
  );
  const filingLabel = filingSubjectObj && filingChapterObj
    ? topicId
      ? `${filingSubjectObj.title} · ${filingChapterObj.title} · ${(filingChapterObj.topics || []).find((t) => t._id === topicId)?.title || ""}`
      : `${filingSubjectObj.title} · ${filingChapterObj.title} (chapter pool)`
    : "";

  const setFiling = (filing) => {
    const [kind] = filing.split(":");
    setForm({
      ...form,
      filing,
      // A passage can only ever be chapter-pool — dropping it here mirrors
      // QuestionEditor.jsx/BulkImportQuestions.jsx clearing filing the other
      // way around when the type flips to passage.
      types: kind === "topic" ? form.types.filter((t) => t !== "passage") : form.types,
    });
  };

  const toggleType = (type) => {
    if (type === "passage" && filingKind === "topic") return;
    setForm({
      ...form,
      types: form.types.includes(type)
        ? form.types.filter((t) => t !== type)
        : [...form.types, type],
    });
  };

  const ready =
    config.features.questionGeneration &&
    (topicId || chapterId) &&
    form.sourceText.trim().length >= 50 &&
    form.types.length > 0;

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Generate</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Using {config.model}
            {usage.data ? ` · $${usage.data.totals.cost.toFixed(2)} spent in 30 days` : ""}
          </p>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={genState.error || fillState.error || classifyState.error} />

        {!config.features.questionGeneration && (
          <div className="banner banner-warn row-tight">
            <AlertTriangle size={16} />
            <span>Question generation is switched off. Turn it on in settings first.</span>
          </div>
        )}

        <DocumentIngest tree={tree} enabled={config.features.questionGeneration} onPicture={setPicture} />

        <DocumentTranscribe tree={tree} enabled={config.features.questionGeneration} picture={picture} />

        <div className="card stack">
          <div className="row-tight"><Wand2 size={17} className="muted" /><h2>Or paste the text</h2></div>

          <div className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Subject">
              <SearchSelect
                className="select"
                value={filingSubject}
                onChange={(e) => {
                  setFilingSubject(e.target.value);
                  setForm({ ...form, filing: "" });
                }}
              >
                <option value="">Choose a subject</option>
                {subjects.map((s) => (
                  <option key={s._id} value={s._id}>{s.title}</option>
                ))}
              </SearchSelect>
            </Field>

            {filingSubject && (
              <Field label="Topic or chapter">
                <FilingSelect
                  chapters={filingChapters}
                  value={form.filing}
                  onChange={setFiling}
                  placeholder="Choose a topic or chapter"
                />
              </Field>
            )}
          </div>

          <Field
            label="Source material"
            hint="Paste a chapter, your notes, or a worked example. Questions are written only from what is here."
          >
            <textarea
              className="textarea"
              style={{ minHeight: 170 }}
              value={form.sourceText}
              onChange={(e) => setForm({ ...form, sourceText: e.target.value })}
            />
          </Field>

          {/* flex-start, not flex-end: Language's hint ("Matches whatever
              language...") only shows sometimes, which makes that one field
              taller than the other three. Aligning to the bottom of the row
              means the shorter fields' boxes then sit lower than Language's,
              which is the actual box-misalignment bug — aligning to the top
              (where every field starts with a same-height label) keeps every
              control box level regardless of which field has a hint. */}
          <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <div className="field">
              <span className="label">Types</span>
              <div className="row-tight">
                {[["mcq", "Multiple choice"], ["mtf", "True / false"], ["written", "Written"], ["passage", "Passage"]].map(
                  ([value, label]) => (
                    <button
                      key={value}
                      className={`pill pill-btn${form.types.includes(value) ? " pill-on" : ""}`}
                      disabled={value === "passage" && filingKind === "topic"}
                      title={value === "passage" && filingKind === "topic" ? "Passage questions can only be filed under a chapter" : undefined}
                      onClick={() => toggleType(value)}
                    >
                      {label}
                    </button>
                  )
                )}
              </div>
            </div>

            <Field label="How many">
              <input
                className="input tnum"
                type="number"
                min="1"
                max="20"
                style={{ width: 84 }}
                value={form.count}
                onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
              />
            </Field>

            <Field label="Difficulty">
              <select
                className="select"
                value={form.difficulty}
                onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </Field>

            <Field
              label="Language"
              hint={form.language ? undefined : "Matches whatever language the pasted material is written in"}
            >
              <select
                className="select"
                value={form.language}
                onChange={(e) => setForm({ ...form, language: e.target.value })}
              >
                <option value="">Match source</option>
                <option value="English">English</option>
                <option value="Bangla">Bangla</option>
                <option value="Hindi">Hindi</option>
              </select>
            </Field>
          </div>

          <button className="btn" style={{ alignSelf: "flex-start" }} disabled={!ready || genState.isLoading}
            onClick={() => {
              const { filing, ...rest } = form;
              generate({ ...rest, topicId, chapterId });
            }}>
            <Sparkles size={15} />
            {genState.isLoading ? "Writing questions" : `Generate ${form.count}`}
          </button>

          {genState.isLoading && (
            <p className="hint" style={{ margin: 0 }}>
              This takes a few seconds per question. Local models are slower.
            </p>
          )}

          {genState.data && (
            <div className="banner banner-ok row-tight">
              <Check size={16} />
              <span>{genState.data.message}{" "}
              <Link
                to={`/review?${topicId ? `topic=${topicId}` : `chapter=${chapterId}&topic=none`}&topicName=${encodeURIComponent(filingLabel)}`}
                style={{ textDecoration: "underline" }}
              >
                Review them
              </Link></span>
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="spread">
            <div className="row-tight"><FileText size={17} className="muted" /><h2>Missing solutions</h2></div>
            <span className="pill tnum">{missing.data?.total ?? 0}</span>
          </div>

          <p className="hint" style={{ margin: 0 }}>
            Questions with no explanation written. A written solution waits for
            review, same as a newly generated question — it does not reach
            students until you approve it.
          </p>

          {missing.data?.total > 0 ? (
            <>
              <div className="stack" style={{ gap: 5 }}>
                {missing.data.questions.slice(0, 5).map((question) => (
                  <Latex as="div" className="card-quiet small truncate" key={question._id} style={{ padding: 9 }}>
                    {question.question}
                  </Latex>
                ))}
                {missing.data.total > 5 && (
                  <p className="hint" style={{ margin: 0 }}>
                    and {missing.data.total - 5} more
                  </p>
                )}
              </div>

              <div className="row-tight" style={{ flexWrap: "wrap" }}>
                <button
                  className="btn btn-quiet"
                  disabled={!config.features.solutionBackfill || fillState.isLoading}
                  onClick={() =>
                    backfill({ questionIds: missing.data.questions.slice(0, 25).map((q) => q._id) })
                  }
                >
                  {fillState.isLoading
                    ? "Writing solutions"
                    : `Write ${Math.min(missing.data.total, 25)} solutions`}
                </button>
                {modelCount > 0 && (
                  <button
                    className="btn btn-quiet"
                    disabled={modelState.isLoading}
                    title="Uses each written question's model answer as its solution. Goes live straight away; no AI."
                    onClick={() => applyModelAnswers()}
                  >
                    <Check size={14} /> {modelState.isLoading ? "Adding" : `Use ${modelCount} model answer${modelCount === 1 ? "" : "s"}`}
                  </button>
                )}
              </div>

              {!config.features.solutionBackfill && (
                <p className="hint" style={{ margin: 0 }}>
                  Switch this on in settings first.
                </p>
              )}
            </>
          ) : (
            // Not shown alongside a fresh result below: a backfill that just
            // ran is *why* the count is zero, and "nothing missing" next to
            // "N written for review" reads as if they contradict each other.
            !fillState.data && (
              <p className="hint" style={{ margin: 0 }}>Nothing missing a solution right now.</p>
            )
          )}

          {/* Deliberately outside the total > 0 branch above. Writing
              solutions for every currently-missing question makes that count
              drop to zero the moment this succeeds — solutions now pending
              review are correctly no longer "missing" one (see
              questionController's hasSolution filter). Nested inside that
              branch, this banner — and the only link to actually review what
              was just written — would render for a single tick and then
              disappear as soon as the now-empty list came back, which is
              indistinguishable from nothing having happened at all. */}
          {modelState.data?.updated > 0 && (
            <div className="banner banner-ok row-tight">
              <Check size={16} />
              <span>{modelState.data.message}</span>
            </div>
          )}
          {modelState.error && <ErrorNote error={modelState.error} />}

          {fillState.data?.written?.length > 0 && (
            <div className="banner banner-ok row-tight">
              <Check size={16} />
              <span>{fillState.data.message}{" "}
              <Link to="/review" style={{ textDecoration: "underline" }}>Review them</Link></span>
            </div>
          )}

          {/* A request for ten with three written and seven failed used to
              report only "Wrote 3 solutions" — accurate, and indistinguishable
              from an arbitrary cap on how many it would ever do at once. The
              reasons were always in the response; they just never reached the
              screen. */}
          {fillState.data?.failed?.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="banner banner-warn row-tight">
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>
                  {fillState.data.failed.length} did not write
                  {fillState.data.written?.length > 0 ? " — the rest above still went through." : "."}
                </span>
              </div>
              {[...new Set(fillState.data.failed.map((f) => f.reason))].slice(0, 3).map((reason) => (
                <div className="card-quiet small" key={reason} style={{ lineHeight: 1.6 }}>
                  {reason}
                </div>
              ))}
              <Hint reasons={fillState.data.failed.map((f) => f.reason)} />
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="spread">
            <div className="row-tight"><Sparkles size={17} className="muted" /><h2>Missing skill type</h2></div>
            <span className="pill tnum">{missingSkill.data?.total ?? 0}</span>
          </div>

          <p className="hint" style={{ margin: 0 }}>
            Questions with no skill type set — recall, application, analysis, and so
            on. Filtering and the AI study plan can't target these by skill until
            they're classified.
          </p>

          {missingSkill.data?.total > 0 ? (
            <>
              <div className="stack" style={{ gap: 5 }}>
                {missingSkill.data.questions.slice(0, 5).map((question) => (
                  <Latex as="div" className="card-quiet small truncate" key={question._id} style={{ padding: 9 }}>
                    {question.question}
                  </Latex>
                ))}
                {missingSkill.data.total > 5 && (
                  <p className="hint" style={{ margin: 0 }}>
                    and {missingSkill.data.total - 5} more
                  </p>
                )}
              </div>

              <button
                className="btn btn-quiet"
                style={{ alignSelf: "flex-start" }}
                disabled={!config.features.skillTypeBackfill || classifyState.isLoading}
                onClick={() =>
                  classifySkill({ questionIds: missingSkill.data.questions.slice(0, 25).map((q) => q._id) })
                }
              >
                {classifyState.isLoading
                  ? "Classifying"
                  : `Classify ${Math.min(missingSkill.data.total, 25)} with AI`}
              </button>

              {!config.features.skillTypeBackfill && (
                <p className="hint" style={{ margin: 0 }}>
                  Switch this on in settings first.
                </p>
              )}
            </>
          ) : (
            // Same reasoning as the solutions card above — not shown alongside a
            // fresh result, since a classify that just ran is why the count is
            // zero, and "nothing missing" next to "N classified" reads as a
            // contradiction rather than confirmation.
            !classifyState.data && (
              <p className="hint" style={{ margin: 0 }}>Nothing missing a skill type right now.</p>
            )
          )}

          {classifyState.data?.written?.length > 0 && (
            <div className="banner banner-ok row-tight">
              <Check size={16} />
              <span>{classifyState.data.message}</span>
            </div>
          )}

          {classifyState.data?.failed?.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="banner banner-warn row-tight">
                <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                <span>
                  {classifyState.data.failed.length} did not classify
                  {classifyState.data.written?.length > 0 ? " — the rest above still went through." : "."}
                </span>
              </div>
              {[...new Set(classifyState.data.failed.map((f) => f.reason))].slice(0, 3).map((reason) => (
                <div className="card-quiet small" key={reason} style={{ lineHeight: 1.6 }}>
                  {reason}
                </div>
              ))}
              <Hint reasons={classifyState.data.failed.map((f) => f.reason)} />
            </div>
          )}
        </div>

        {usage.data && (
          <div className="card stack">
            <div className="row-tight"><BarChart3 size={17} className="muted" /><h2>Usage</h2></div>
            <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
              <Metric value={usage.data.totals.calls} label="Calls, 30 days" />
              <Metric value={usage.data.totals.tokens.toLocaleString()} label="Tokens" />
              <Metric value={`$${usage.data.totals.cost.toFixed(2)}`} label="Estimated cost" />
              <Metric value={usage.data.totals.failures} label="Failures" />
            </div>
            {usage.data.byFeature.length > 0 && (
              <div className="stack" style={{ gap: 0 }}>
                {usage.data.byFeature.map((row) => (
                  <div className="spread small" key={row._id}
                    style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                    <span className="grow">{row._id.replace(/_/g, " ")}</span>
                    <span className="tnum muted">{row.calls} calls</span>
                    <span className="tnum">${row.cost.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const Metric = ({ value, label }) => (
  <div>
    <div className="tnum" style={{ fontSize: 21, fontWeight: 500, letterSpacing: "-0.03em" }}>{value}</div>
    <div className="muted small">{label}</div>
  </div>
);
