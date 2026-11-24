import { useEffect, useRef, useState } from "react";
import {
  Upload, FileText, Layers, AlertTriangle, Check, Loader2, X, Library, Trash2, Clock, ScanLine,
} from "lucide-react";
import { useDispatch } from "react-redux";
import {
  usePreviewDocumentMutation,
  useGenerateFromDocumentMutation,
  useGetIngestStatusQuery,
  useGetIngestJobsQuery,
  useCancelIngestJobMutation,
  useGetDocumentsQuery,
  useDeleteDocumentMutation,
} from "../api/aiApi";
// Namespace import rather than a named one: this needs the api slice object
// itself (for .util.invalidateTags), not one of its generated hooks.
import * as aiApiModule from "../api/aiApi";
import { Link } from "react-router-dom";
import { useConfirm, FilingSelect } from "./bits";
import { useGetAuthoritiesQuery } from "../api/contentApi";
import SourcesEditor, { rowsToSources, hasBoard } from "./SourcesEditor";
import SearchSelect from "./SearchSelect";

// Formats whose page/slide boundaries survive extraction, so a page range
// means something — mirrors PAGED_TYPES in backend ingestController.js.
// Mirrors MAX_SCANS_PER_RUN in backend ingestController.js.
// Pages read with AI vision per run — matches MAX_SCANS_PER_RUN on the server.
const MAX_SCANS = 150;

const PAGED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

// A model handed a sixty page pdf writes every question from the first ten
// pages. This screen exists to make the chunking visible: the preview says how
// many sections the document became, and the run reports which ones produced
// questions.
export default function DocumentIngest({ tree, enabled, onPicture }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dispatch = useDispatch();

  // "upload" reads a new file (and, as a side effect, adds it to the library
  // below so it doesn't need re-reading next time). "library" skips straight
  // to a document already ingested — no upload, no re-parsing.
  const [mode, setMode] = useState("upload");
  const [libraryDoc, setLibraryDoc] = useState(null);
  const [librarySearch, setLibrarySearch] = useState("");

  // Orthogonal to `mode` above (upload vs library is "where the text comes
  // from"; this is "what to do with it"). "generate" invents new questions
  // inspired by the material, same as before. "extract" transcribes real
  // questions that already exist in it verbatim — for digitizing an actual
  // past paper/question bank into the archive, not authoring new content.
  const [ingestMode, setIngestMode] = useState("generate");

  const [preview, { data: report, isLoading: reading, error: readError, reset }] =
    usePreviewDocumentMutation();
  const [generate, { data: job, isLoading: starting, error: startError }] =
    useGenerateFromDocumentMutation();
  const { data: library, isLoading: loadingLibrary } = useGetDocumentsQuery(librarySearch, {
    skip: mode !== "library",
  });
  const [removeDocument, { isLoading: removing }] = useDeleteDocumentMutation();
  const { data: authorities } = useGetAuthoritiesQuery();
  const confirm = useConfirm();

  // Independent subject/filing state from Generate.jsx's paste-text form —
  // this is its own form entirely, just sharing the same stepwise pattern.
  const [filingSubject, setFilingSubject] = useState("");
  const [form, setForm] = useState({
    filing: "", count: 10, types: ["mcq"], difficulty: "medium", language: "",
    // Optional page range ("12-20, 35") — PDF and PowerPoint only.
    pages: "",
    // Optional "only questions about …" instruction.
    focus: "",
    // Scanned pages / photographed Word pages are read with AI vision.
    readScans: true,
    // Only read in extract mode — files the whole digitized batch straight
    // into the archive instead of an admin setting these per question after.
    // Every board this paper's questions appeared in, each with its years.
    sources: [], isPublic: false,
    // Extract only: AI writes its own worked solution for every question.
    writeSolutions: false,
  });

  // A run keeps going on the server when this page is left. Coming back picks
  // up the latest one still running, instead of an empty form.
  const { data: myJobs } = useGetIngestJobsQuery();
  const [resumedJobId, setResumedJobId] = useState(null);
  useEffect(() => {
    if (job?.jobId || resumedJobId) return;
    const running = myJobs?.jobs?.find((j) => j.status === "running" && j.mode !== "transcribe");
    if (running) setResumedJobId(running.jobId);
  }, [myJobs, job?.jobId, resumedJobId]);
  const activeJobId = job?.jobId || resumedJobId;
  const [cancelJob, { isLoading: stopping }] = useCancelIngestJobMutation();

  // Polls while the run is going, and stops once it reports itself finished.
  const [statusPoll, setStatusPoll] = useState(1500);
  const status = useGetIngestStatusQuery(activeJobId, {
    skip: !activeJobId,
    pollingInterval: statusPoll,
  });

  const running = status.data?.status === "running";
  // currentData, not data: data still holds the previous run while a new
  // one's first status loads, and a finished previous run must not switch
  // polling off for the new one.
  const currentRunning = status.currentData?.status === "running";
  useEffect(() => {
    setStatusPoll(!status.currentData || currentRunning ? 1500 : 0);
  }, [status.currentData, currentRunning]);
  useEffect(() => {
    setStatusPoll(1500);
  }, [activeJobId]);
  const scanAwarePercent = status.data?.phase === "scanning" && status.data.scansTotal
    ? Math.round((status.data.scansDone / status.data.scansTotal) * 100)
    : status.data?.percent || 0;
  // Only a run that actually produced questions is a success. A run that
  // completed its loop and wrote nothing is a failure with a nicer name.
  const finished = status.data?.status === "done" && status.data?.written > 0;
  const failed = status.data?.status === "failed" || (status.data?.status === "done" && status.data?.written === 0);
  const cancelled = status.data?.status === "cancelled";

  // generateFromDocument's own invalidation fires the moment the job starts,
  // long before the questions it will write exist — that only clears out
  // whatever was cached from before this run. Nothing invalidates the review
  // queue again when the background job actually finishes, so a reviewer
  // clicking through right after "Review them" sees the pre-run snapshot:
  // stale results, or nothing at all if this was the first generation. This
  // re-invalidates once the run genuinely has something to show for it.
  useEffect(() => {
    if (finished) {
      dispatch(aiApiModule.aiApi.util.invalidateTags(["ReviewQueue", "Question"]));
    }
  }, [finished, dispatch]);

  const take = async (chosen) => {
    if (!chosen) return;
    // A picture is read on the "Read text and figures" card, where it can
    // then be made into questions.
    if (chosen.type?.startsWith("image/") && onPicture) {
      onPicture(chosen);
      return;
    }
    setFile(chosen);
    await preview(chosen);
  };

  const clear = () => {
    setFile(null);
    reset();
    setResumedJobId(null);
    if (input.current) input.current.value = "";
  };

  const switchMode = (next) => {
    setMode(next);
    clear();
    setLibraryDoc(null);
  };

  const subjects = (tree || []).map((s) => ({ _id: s._id, title: s.title }));
  const filingSubjectObj = (tree || []).find((s) => s._id === filingSubject);
  const filingChapters = filingSubjectObj?.chapters || [];

  const [filingKind, filingRefId] = (form.filing || "").split(":");
  const topicId = filingKind === "topic" ? filingRefId : undefined;
  const chapterId = filingKind === "chapter" ? filingRefId : undefined;

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

  // The two entry points end up needing exactly the same shape downstream —
  // section count, page count, a sample of the text — so everything after
  // this point reads from `source` and does not care which one it came from.
  const source =
    mode === "library"
      ? libraryDoc && {
          documentId: libraryDoc._id,
          filename: libraryDoc.originalFilename || libraryDoc.title,
          pages: libraryDoc.pages,
          characters: libraryDoc.characters,
          chunks: libraryDoc.chunkCount,
          looksScanned: libraryDoc.looksScanned,
          sample: libraryDoc.sample,
          pageSelectable: PAGED_TYPES.includes(libraryDoc.mimeType),
          scanned: libraryDoc.scanned || [],
          visionReasons: tallyReasons(libraryDoc.visionReasons),
          bijoyPages: libraryDoc.bijoyPages || 0,
        }
      : report && {
          ...report,
          scanned: [
            ...(report.scannedPages || []).map((n) => `p${n}`),
            ...Array.from({ length: report.scannedImages || 0 }, (_, i) => `img${i + 1}`),
          ],
        };

  // Scanned pages this run would read — only those inside the page range
  // when one is given (an unparseable range counts everything; the server
  // reports the real error).
  const rangePages = (() => {
    const spec = form.pages.trim();
    if (!spec || !source?.pageSelectable) return null;
    const pages = new Set();
    for (const part of spec.split(",").map((p) => p.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
      if (!m) return null;
      for (let n = Number(m[1]); n <= Number(m[2] || m[1]); n += 1) pages.add(n);
    }
    return pages;
  })();
  const scansInScope = (source?.scanned || []).filter(
    (ref) => !rangePages || (ref.startsWith("p") && rangePages.has(Number(ref.slice(1))))
  );

  const ready = enabled && source && (topicId || chapterId) && form.types.length > 0;

  const runGenerate = () => {
    const { filing, sources, ...rest } = form;
    generate({
      file: mode === "upload" ? file : undefined,
      documentId: mode === "library" ? libraryDoc._id : undefined,
      ...rest,
      // "" rather than undefined: the upload path serializes this into
      // FormData, which turns an undefined value into the literal string
      // "undefined" (still truthy server-side) — "" stays falsy either way.
      topicId: topicId || "",
      chapterId: chapterId || "",
      pages: source.pageSelectable ? form.pages.trim() : "",
      focus: form.focus.trim(),
      readScans: form.readScans ? "true" : "false",
      writeSolutions: ingestMode === "extract" && form.writeSolutions ? "true" : "",
      types: form.types.join(","),
      mode: ingestMode,
      // isPublic must serialize as a real boolean-looking string either way
      // (FormData stringifies everything) — the backend reads it with
      // Boolean(...), so "false" would be truthy there; sent as "" instead
      // when off, same falsy-string convention as topicId/chapterId above.
      isPublic: ingestMode === "extract" && form.isPublic && hasBoard(sources) ? "true" : "",
      // JSON text either way — the upload path is FormData, which can't
      // carry an array of objects.
      sources: ingestMode === "extract" ? JSON.stringify(rowsToSources(sources)) : "",
    });
  };

  return (
    <div className="card stack">
      <div className="row-tight">
        <FileText size={17} className="muted" />
        <h2>From a document</h2>
      </div>

      <p className="hint" style={{ margin: 0 }}>
        A PDF, Word document, PowerPoint or text file. It is read in sections so
        questions come from the whole thing, not just the opening pages.
      </p>

      <div className="row-tight">
        <button
          className={`pill pill-btn${mode === "upload" ? " pill-on" : ""}`}
          onClick={() => switchMode("upload")}
        >
          <Upload size={13} /> Upload a file
        </button>
        <button
          className={`pill pill-btn${mode === "library" ? " pill-on" : ""}`}
          onClick={() => switchMode("library")}
        >
          <Library size={13} /> From your library
        </button>
      </div>

      <div className="row-tight">
        <button
          className={`pill pill-btn${ingestMode === "generate" ? " pill-on" : ""}`}
          onClick={() => setIngestMode("generate")}
        >
          Generate new questions
        </button>
        <button
          className={`pill pill-btn${ingestMode === "extract" ? " pill-on" : ""}`}
          onClick={() => setIngestMode("extract")}
        >
          Extract real questions
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {ingestMode === "generate"
          ? "AI writes new questions inspired by this material."
          : "AI transcribes the real questions already printed in this document, exactly as they appear — for digitizing an actual past paper or question bank, not writing new content."}
      </p>

      {mode === "library" ? (
        <>
          <LibraryPicker
            library={library}
            loading={loadingLibrary}
            search={librarySearch}
            onSearch={setLibrarySearch}
            chosen={libraryDoc}
            onChoose={setLibraryDoc}
            onRemove={async (doc) => {
              const yes = await confirm({
                title: `Remove "${doc.title}" from your library?`,
                body: "Questions already generated from it are unaffected. It would need re-uploading to use again.",
                confirmLabel: "Remove",
              });
              if (!yes) return;
              await removeDocument(doc._id);
              if (libraryDoc?._id === doc._id) setLibraryDoc(null);
            }}
            removing={removing}
          />

          {libraryDoc && (
            <div className="card-quiet stack">
              {libraryDoc.looksScanned && !libraryDoc.scanned?.length && (
                <div className="banner banner-warn row-tight">
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <span>
                    This looked like a scan when it was added. Very little text
                    came out, so the questions will be poor.
                  </span>
                </div>
              )}

              <div className="row" style={{ gap: 20, flexWrap: "wrap" }}>
                {libraryDoc.pages != null && <Stat value={libraryDoc.pages} label="Pages" />}
                <Stat value={(libraryDoc.characters || 0).toLocaleString()} label="Characters" />
                <Stat value={libraryDoc.chunkCount} label="Sections" icon={Layers} />
              </div>

              {libraryDoc.sample && (
                <details>
                  <summary className="hint" style={{ cursor: "pointer" }}>
                    What was read from it
                  </summary>
                  <p className="small muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
                    {libraryDoc.sample}…
                  </p>
                </details>
              )}
            </div>
          )}
        </>
      ) : !file ? (
        <>
          <div
            className={`dropzone${dragging ? " dropzone-active" : ""}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              take(e.dataTransfer.files?.[0]);
            }}
          >
            <Upload size={22} strokeWidth={1.5} style={{ opacity: 0.5, marginBottom: 8 }} />
            <div>Drop a file here, or click to choose one</div>
            <div className="hint" style={{ marginTop: 4 }}>PDF, DOCX, PPTX or TXT · up to 40 MB · a picture is read below, then made into questions</div>
          </div>

          <input
            ref={input}
            type="file"
            accept=".pdf,.docx,.pptx,.txt,.md,image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => take(e.target.files?.[0])}
          />

          <p className="hint" style={{ margin: 0 }}>
            Added to your library automatically, so the same file never needs
            uploading twice.
          </p>
        </>
      ) : (
        <div className="card-quiet stack">
          <div className="spread">
            <div className="row-tight grow">
              <FileText size={16} className="muted" />
              <span className="grow truncate">{file.name}</span>
            </div>
            <button className="icon-btn" onClick={clear} title="Choose a different file">
              <X size={15} />
            </button>
          </div>

          {reading && (
            <div className="row-tight hint">
              <Loader2 size={14} className="spin" /> Reading the document
            </div>
          )}

          {readError && (
            <div className="banner banner-bad row-tight">
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{readError?.data?.message || "That file could not be read."}</span>
            </div>
          )}

          {report && (
            <>
              {report.looksScanned && !(report.scannedPages?.length || report.scannedImages) && (
                <div className="banner banner-warn row-tight">
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <span>
                    This looks like a scan. Very little text came out, so the
                    questions will be poor.
                  </span>
                </div>
              )}

              <div className="row" style={{ gap: 20, flexWrap: "wrap" }}>
                {report.pages != null && <Stat value={report.pages} label="Pages" />}
                <Stat value={report.characters.toLocaleString()} label="Characters" />
                <Stat value={report.chunks} label="Sections" icon={Layers} />
              </div>

              <details>
                <summary className="hint" style={{ cursor: "pointer" }}>
                  What was read from it
                </summary>
                <p className="small muted" style={{ lineHeight: 1.6, marginBottom: 0 }}>
                  {report.sample}…
                </p>
              </details>
            </>
          )}
        </div>
      )}

      {source && (
        <>
          {/* flex-start, not flex-end — see Generate.jsx's matching row for
              why: any field here growing a hint (or wrapping to two lines on
              a narrow screen) pushes its neighbors' boxes out of line when
              aligned to the bottom. Top-aligned, every box starts right
              after its same-height label instead. */}
          <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <label className="field" style={{ minWidth: 160 }}>
              <span className="label">Subject</span>
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
            </label>

            {filingSubject && (
              <label className="field grow" style={{ minWidth: 200 }}>
                <span className="label">Topic or chapter</span>
                <FilingSelect
                  chapters={filingChapters}
                  value={form.filing}
                  onChange={setFiling}
                  placeholder="Choose a topic or chapter"
                />
              </label>
            )}

            {ingestMode === "generate" && (
              <>
                <label className="field">
                  <span className="label">How many</span>
                  <input
                    className="input tnum"
                    type="number"
                    min="1"
                    max="60"
                    style={{ width: 84 }}
                    value={form.count}
                    onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
                  />
                </label>

                <label className="field">
                  <span className="label">Difficulty</span>
                  <select
                    className="select"
                    value={form.difficulty}
                    onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
              </>
            )}

            {ingestMode !== "extract" && (
            <label className="field">
              <span className="label">Language</span>
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
            </label>
            )}

            {ingestMode === "extract" && (
              <>
                <div className="grow" style={{ flexBasis: "100%" }}>
                  <SourcesEditor
                    value={form.sources}
                    authorities={authorities}
                    onChange={(sources) => setForm({ ...form, sources, isPublic: hasBoard(sources) ? form.isPublic : false })}
                  />
                </div>

                <label className="field">
                  <span className="label">&nbsp;</span>
                  <button
                    type="button"
                    className={`pill pill-btn${form.isPublic ? " pill-ok" : ""}`}
                    disabled={!form.isPublic && !hasBoard(form.sources)}
                    title={hasBoard(form.sources) ? undefined : "Add a board/exam/book first"}
                    onClick={() => setForm({ ...form, isPublic: !form.isPublic })}
                  >
                    {form.isPublic ? "Public in archive" : "Not in archive"}
                  </button>
                </label>

                <label className="field">
                  <span className="label">&nbsp;</span>
                  <button
                    type="button"
                    className={`pill pill-btn${form.writeSolutions ? " pill-on" : ""}`}
                    title="On: AI writes its own step-by-step solution for every question. Off: printed solutions are copied; AI writes a short one only where none is printed."
                    onClick={() => setForm({ ...form, writeSolutions: !form.writeSolutions })}
                  >
                    {form.writeSolutions ? "AI writes solutions" : "Printed solutions"}
                  </button>
                </label>
              </>
            )}
          </div>

          {ingestMode === "extract" && (
            <p className="hint" style={{ margin: 0 }}>
              Digitized questions land in Review exactly like generated ones, marked as imported content rather than AI-authored — approve each after checking the transcription against the original.
              Answers and solutions printed in the document are used as they are. Numerical questions that only print a final answer ("উত্তর : 25.2 J") come in as written questions with that answer as the model answer, even if Written isn't ticked.
            </p>
          )}

          {source.pageSelectable && (
            <label className="field">
              <span className="label">Pages (optional)</span>
              <input
                className="input tnum"
                placeholder={`e.g. 12-20, 35${source.pages ? ` — of ${source.pages}` : ""}`}
                style={{ maxWidth: 260 }}
                value={form.pages}
                onChange={(e) => setForm({ ...form, pages: e.target.value })}
              />
              <span className="hint">Only these pages are read — more precise, and cheaper. Leave empty for the whole document.</span>
            </label>
          )}

          {scansInScope.length > 0 && (
            <div className={`banner row-tight${scansInScope.length > MAX_SCANS ? " banner-warn" : ""}`} style={{ flexWrap: "wrap" }}>
              <ScanLine size={16} style={{ flexShrink: 0 }} />
              <span className="grow small">
                {scansInScope.some((r) => r.startsWith("p"))
                  ? `${scansInScope.length} page${scansInScope.length === 1 ? "" : "s"} need${scansInScope.length === 1 ? "s" : ""} AI vision${visionWhy(source.visionReasons)}`
                  : `${scansInScope.length} photographed page${scansInScope.length === 1 ? "" : "s"} (large images) inside the document`}
                {form.readScans
                  ? scansInScope.length > MAX_SCANS
                    ? ` — at most ${MAX_SCANS} can be read per run. ${source.pageSelectable ? "Choose a page range." : "Split the document, or skip them."}`
                    : ". They're read from the page image first, the way ChatGPT reads a PDF — one AI call each (the vision model in AI settings), remembered for next time. Figures are cut out and attached to their questions."
                  : " — their text layer is used as is, so maths and figures may come out wrong."}
                {source.bijoyPages > 0 && ` ${source.bijoyPages} page${source.bijoyPages === 1 ? " uses" : "s use"} an older Bangla font (SutonnyMJ/Bijoy); its text is converted to Unicode automatically.`}
              </span>
              <button
                type="button"
                className={`pill pill-btn${form.readScans ? " pill-on" : ""}`}
                onClick={() => setForm({ ...form, readScans: !form.readScans })}
              >
                {form.readScans ? "Read with AI vision" : "Skip scanned pages"}
              </button>
            </div>
          )}

          <label className="field">
            <span className="label">Focus (optional)</span>
            <input
              className="input"
              placeholder="e.g. only Newton's laws of motion"
              maxLength={300}
              value={form.focus}
              onChange={(e) => setForm({ ...form, focus: e.target.value })}
            />
            <span className="hint">
              {ingestMode === "extract"
                ? "Only questions about this are extracted; everything else is skipped."
                : "Questions are written only about this. Sections with nothing on it are skipped, so you may get fewer than asked."}
            </span>
          </label>

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

          <p className="hint" style={{ margin: 0 }}>
            {source.pageSelectable && form.pages.trim()
              ? ingestMode === "generate"
                ? `${form.count} question${form.count === 1 ? "" : "s"} from pages ${form.pages.trim()}.`
                : `Every real question found on pages ${form.pages.trim()}.`
              : ingestMode === "generate"
              ? `${form.count} question${form.count === 1 ? "" : "s"} spread across ${source.chunks} section${source.chunks === 1 ? "" : "s"}.`
              : `Every real question found across ${source.chunks} section${source.chunks === 1 ? "" : "s"} — however many that turns out to be.`}
          </p>

          <button
            className="btn"
            style={{ alignSelf: "flex-start" }}
            disabled={!ready || starting || running}
            onClick={runGenerate}
          >
            <Upload size={15} />
            {starting || running ? "Reading the document" : ingestMode === "extract" ? "Extract" : "Generate"}
          </button>

          {!enabled && (
            <p className="hint" style={{ margin: 0 }}>
              Question generation is switched off in settings.
            </p>
          )}
        </>
      )}

      {startError && (
        <div className="banner banner-bad row-tight">
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>{startError?.data?.message || "That run could not be started."}</span>
        </div>
      )}

      {status.data && (
        <div className="card-quiet stack">
          {running && (
            <>
              <div className="spread">
                <span className="small">
                  {status.data.waiting
                    ? "Waiting for another document run to finish…"
                    : status.data.phase === "scanning"
                    ? `Reading scanned page ${Math.min(status.data.scansDone + 1, status.data.scansTotal)} of ${status.data.scansTotal} with AI vision`
                    : `Section ${status.data.completed} of ${status.data.steps}`}
                </span>
                <span className="tnum small muted">{scanAwarePercent}%</span>
              </div>
              <div className="progress">
                <div className="progress-bar" style={{ width: `${scanAwarePercent}%` }} />
              </div>
              <div className="spread" style={{ gap: 8 }}>
                <span className="hint">
                  {status.data.written} written so far. This can take several minutes — you can leave this page; it keeps going, and its progress stays in the corner of every page.
                </span>
                <button
                  className="btn btn-sm btn-quiet"
                  style={{ flexShrink: 0 }}
                  disabled={stopping || status.data.stopRequested}
                  onClick={() => cancelJob(activeJobId)}
                  title="Stop the run. Questions already found are kept and go to Review."
                >
                  {stopping || status.data.stopRequested ? "Stopping…" : "Stop"}
                </button>
              </div>
            </>
          )}

          {cancelled && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="banner row-tight">
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>{status.data.error || "Stopped."}</span>
              </div>
              {status.data.written > 0 && (
                <Link
                  className="btn btn-sm"
                  style={{ alignSelf: "flex-start" }}
                  to={`/review?${status.data.review?.topicId ? `topic=${status.data.review.topicId}` : `chapter=${status.data.review?.chapterId}&topic=none`}&topicName=${encodeURIComponent(status.data.review?.label || "")}`}
                >
                  Review them
                </Link>
              )}
            </div>
          )}

          {finished && (
            <>
              <div className="banner banner-ok row-tight">
                <Check size={16} />
                <span>
                  {status.data.written} question{status.data.written === 1 ? "" : "s"} ready for review.
                </span>
              </div>

              {status.data.duplicates > 0 && (
                <span className="hint">
                  {status.data.duplicates} near-identical question
                  {status.data.duplicates === 1 ? " was" : "s were"} dropped where sections overlapped.
                </span>
              )}

              {status.data.failures?.length > 0 && (
                <span className="hint">
                  {status.data.failures.length} section
                  {status.data.failures.length === 1 ? "" : "s"} produced nothing usable
                  {status.data.failedPages?.length ? ` (page${status.data.failedPages.length === 1 ? "" : "s"} ${status.data.failedPages.join(", ")} — try those pages again with a page range)` : ""}.
                </span>
              )}

              <RunReport report={status.data.report} />

              <Link
                className="btn btn-sm"
                style={{ alignSelf: "flex-start" }}
                to={`/review?${topicId ? `topic=${topicId}` : `chapter=${chapterId}&topic=none`}&topicName=${encodeURIComponent(filingLabel)}`}
              >
                Review them
              </Link>
            </>
          )}

          {failed && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="banner banner-bad row-tight">
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>
                  Nothing was generated.
                  {status.data.failures?.length > 0 &&
                    ` All ${status.data.failures.length} section${status.data.failures.length === 1 ? "" : "s"} failed.`}
                </span>
              </div>

              {/* The reason is the whole point of this block. Hiding it behind
                  a count leaves a person with no way to fix anything. */}
              {(status.data.reasons || [status.data.error]).filter(Boolean).map((reason) => (
                <div className="card-quiet small" key={reason} style={{ lineHeight: 1.6 }}>
                  {reason}
                </div>
              ))}

              <Hint reasons={status.data.reasons || [status.data.error]} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Turns a provider's message into the thing to actually go and do. The
// message alone is often accurate and useless: "fetch failed" does not tell a
// teacher that their model settings point at a server that is not running.
// Exported: the solution backfill on the Generate page hits the exact same
// class of per-call failure and benefits from the same translation rather
// than a second copy of it.
export const Hint = ({ reasons }) => {
  const text = (reasons || []).join(" ").toLowerCase();

  let advice = null;

  if (/could not reach|fetch failed|is it running|econnrefused/.test(text)) {
    advice = "The address in AI settings is not answering. If you switched from a local model to a hosted one, clear the address field and save again.";
  } else if (/api key|unauthor|401|permission|invalid.*key/.test(text)) {
    advice = "The API key was rejected. Check it in Settings and press Test connection.";
  } else if (/rate limit|quota|429|resource.exhausted/.test(text)) {
    advice = "The provider's rate limit was reached. Free tiers allow only a few requests a minute — try fewer questions, or wait and run it again.";
  } else if (/not found|404|model/.test(text)) {
    advice = "That model name was not recognised by the provider. Check the spelling in Settings.";
  } else if (/valid output after two attempts|did not return json/.test(text)) {
    advice = "The model could not produce properly structured questions. This usually means it is too small — try a larger one.";
  }

  if (!advice) return null;

  return (
    <div className="banner banner-warn row-tight">
      <AlertTriangle size={15} style={{ flexShrink: 0 }} />
      <span>{advice}</span>
    </div>
  );
};

const Stat = ({ value, label, icon: Icon }) => (
  <div>
    <div className="row-tight tnum" style={{ fontSize: 19, fontWeight: 500, letterSpacing: "-0.03em" }}>
      {Icon && <Icon size={15} className="muted" />}
      {value}
    </div>
    <div className="muted small">{label}</div>
  </div>
);

// A document picked here skips straight past extraction — its text was cached
// the first time it was ever previewed or generated from, so choosing one is
// instant where uploading a fresh file is not.
const LibraryPicker = ({ library, loading, search, onSearch, chosen, onChoose, onRemove, removing }) => {
  const documents = library?.documents || [];

  // Collapsed to just the chosen file once one is picked, rather than
  // leaving the full searchable list open underneath it — the list's job
  // was to help find a file, and it has nothing left to do once that's
  // done. "Change" is the only way back to it, which is also what clears
  // the selection (calling onChoose(null) is exactly what removing the
  // active document elsewhere in this file already does).
  if (chosen) {
    return (
      <div
        className="card-quiet row spread"
        style={{ borderColor: "var(--accent)", alignItems: "flex-start" }}
      >
        <div className="row-tight grow" style={{ alignItems: "flex-start" }}>
          <FileText size={16} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />
          <div className="grow">
            <div className="truncate" style={{ fontWeight: 500 }}>{chosen.title}</div>
            <div className="muted small row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
              <span>{chosen.chunkCount} section{chosen.chunkCount === 1 ? "" : "s"}</span>
              {chosen.pages != null && <span>{chosen.pages} pages</span>}
            </div>
          </div>
        </div>
        <button className="btn btn-sm btn-quiet" onClick={() => onChoose(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="search-wrap">
        <input
          className="input"
          placeholder="Search your library"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="hint" style={{ margin: 0 }}>Loading your library…</p>
      ) : documents.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          {search
            ? "Nothing in your library matches that search."
            : "Nothing here yet — files you upload are added automatically."}
        </p>
      ) : (
        <div className="stack" style={{ gap: 6, maxHeight: 280, overflowY: "auto" }}>
          {documents.map((doc) => (
            <div
              key={doc._id}
              className="card-quiet row spread"
              style={{ cursor: "pointer", alignItems: "flex-start" }}
              onClick={() => onChoose(doc)}
            >
              <div className="row-tight grow" style={{ alignItems: "flex-start" }}>
                <FileText size={16} className="muted" style={{ marginTop: 2, flexShrink: 0 }} />
                <div className="grow">
                  <div className="truncate" style={{ fontWeight: 500 }}>{doc.title}</div>
                  <div className="muted small row-tight" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span>{doc.chunkCount} section{doc.chunkCount === 1 ? "" : "s"}</span>
                    {doc.pages != null && <span>{doc.pages} pages</span>}
                    {doc.usedCount > 0 && (
                      <span className="row-tight" style={{ gap: 3 }}>
                        <Clock size={11} /> used {doc.usedCount}×
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                className="icon-btn icon-btn-danger"
                title="Remove from library"
                disabled={removing}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(doc);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// { p1: ["maths", "figures"], … } → { maths: 1, figures: 1 }. A preview
// already sends the tally; a library document sends the per-page lists.
const tallyReasons = (visionReasons) => {
  if (!visionReasons) return null;
  const tally = {};
  for (const reasons of Object.values(visionReasons)) {
    for (const r of reasons || []) tally[r] = (tally[r] || 0) + 1;
  }
  return tally;
};

const REASON_LABEL = { scan: "no text layer", maths: "maths", figures: "figures", encoding: "unreadable text" };

// " (maths on 53, figures on 13)"
const visionWhy = (tally) => {
  const parts = Object.entries(tally || {}).map(([k, n]) => `${REASON_LABEL[k] || k} on ${n}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
};

// What an extraction run did besides writing questions — so a person knows
// what to check in Review rather than finding out question by question.
function RunReport({ report }) {
  if (!report) return null;
  const lines = [
    report.visionPages > 0 && `${report.visionPages} page${report.visionPages === 1 ? "" : "s"} read from the page image with AI vision.`,
    report.pagesSplit > 0 && `${report.pagesSplit} page${report.pagesSplit === 1 ? " was" : "s were"} too dense to read in one go and ${report.pagesSplit === 1 ? "was" : "were"} read again in two halves.`,
    report.pagesPartial?.length > 0 && `Page${report.pagesPartial.length === 1 ? "" : "s"} ${report.pagesPartial.join(", ")} could only be read in part — check the questions from ${report.pagesPartial.length === 1 ? "it" : "them"}, or run ${report.pagesPartial.length === 1 ? "that page" : "those pages"} again on their own.`,
    report.figuresAttached > 0 && `${report.figuresAttached} figure${report.figuresAttached === 1 ? "" : "s"} cut out and attached to questions.`,
    report.figuresFlagged > 0 && `${report.figuresFlagged} figure${report.figuresFlagged === 1 ? "" : "s"} couldn't be cut out cleanly — those questions are marked "Figure needs checking" in Review.`,
    report.solutionsMatched > 0 && `${report.solutionsMatched} solution${report.solutionsMatched === 1 ? "" : "s"} printed apart from ${report.solutionsMatched === 1 ? "its question" : "their questions"} (a solutions section, or the next page) matched by number — marked in Review to check.`,
    report.solutionsUnclear > 0 && `${report.solutionsUnclear} question${report.solutionsUnclear === 1 ? " has" : "s have"} a printed solution elsewhere that couldn't be matched with certainty — AI's solution kept, marked in Review.`,
    report.answersFromKey > 0 && `${report.answersFromKey} answer${report.answersFromKey === 1 ? "" : "s"} taken from the document's answer key.`,
    report.answersSolved > 0 && `${report.answersSolved} question${report.answersSolved === 1 ? " had" : "s had"} no printed answer, so AI worked ${report.answersSolved === 1 ? "it" : "them"} out — marked in Review to check.`,
    report.garbledDropped > 0 && `${report.garbledDropped} question${report.garbledDropped === 1 ? "" : "s"} came out unreadable and ${report.garbledDropped === 1 ? "was" : "were"} left out.`,
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  );
}
