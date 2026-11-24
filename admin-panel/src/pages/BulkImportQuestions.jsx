import { useState } from "react";
import { Link } from "react-router-dom";
import { useGetTreeQuery, useImportQuestionsFileMutation } from "../api/contentApi";
import { Upload, Download, FileSpreadsheet, Check, AlertTriangle, ArrowLeft } from "lucide-react";
import { Loading, ErrorNote, Field, FilingSelect, DownloadButton } from "../components/bits";
import SearchSelect from "../components/SearchSelect";

const TYPES = [
  { value: "mcq", label: "Multiple choice" },
  { value: "mtf", label: "True / false" },
  { value: "written", label: "Written" },
  { value: "passage", label: "Passage" },
  { value: "coding", label: "Coding" },
];

// A second front door onto POST /questions/bulk — same topic-scoped,
// per-row validation, just fed from an uploaded .xlsx/.csv instead of pasted
// JSON. Type and topic (or chapter, for the chapter pool) are both picked
// here, once, for the whole file: every row in one upload is the same
// question type, and the sheet itself carries no type/topic/chapter column,
// so a teacher can't file half a batch under the wrong shape or chapter by
// mistyping one cell. Passage rows can only ever be chapter-pool (see
// questionModel.js's Passage discriminator), so picking that type restricts
// step 3 to a chapter — no topic option is offered.
export default function BulkImportQuestions() {
  const { data: tree, isLoading } = useGetTreeQuery();
  const [type, setType] = useState("");
  const [subjectId, setSubjectId] = useState("");
  // "topic:<id>" or "chapter:<id>" — same encoding as the question editor's
  // filing field and FilingSelect (bits.jsx).
  const [filing, setFiling] = useState("");
  const [file, setFile] = useState(null);
  const [importFile, { isLoading: importing, data, error }] = useImportQuestionsFileMutation();

  if (isLoading) return <Loading />;

  const subjects = tree || [];
  const currentSubject = subjects.find((s) => s._id === subjectId);
  const chapters = currentSubject ? currentSubject.chapters : [];

  const [filingKind, filingId] = filing.split(":");
  const topicId = filingKind === "topic" ? filingId : undefined;
  const chapterId = filingKind === "chapter" ? filingId : undefined;

  const submit = () => {
    if (!type || !filing || !file) return;
    importFile({ topicId, chapterId, type, file });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/questions" className="row-tight small muted" style={{ textDecoration: "none", marginBottom: 4, width: "fit-content" }}>
            <ArrowLeft size={13} /> Questions
          </Link>
          <h1>Bulk import</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Add many questions at once from a spreadsheet.
          </p>
        </div>
      </div>

      <div className="stack">
        <div className="card stack">
          <div className="row-tight"><FileSpreadsheet size={17} className="muted" /><h2>1. Pick a question type</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            Every row in one file is the same type. Importing more than one type means one file per type.
          </p>
          <div className="row-tight" style={{ flexWrap: "wrap" }}>
            {TYPES.map((t) => (
              <button
                key={t.value}
                className={`pill pill-btn${type === t.value ? " pill-on" : ""}`}
                onClick={() => {
                  setType(t.value);
                  // Passage can only ever be chapter-pool — a topic pick
                  // from a moment ago no longer applies.
                  if (t.value === "passage" && filingKind === "topic") setFiling("");
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card stack">
          <div className="row-tight"><Download size={17} className="muted" /><h2>2. Get the format</h2></div>
          {type ? (
            <>
              <p className="hint" style={{ margin: 0 }}>
                Download the template, delete the example row, keep the header row exactly as it is, then fill in
                your own questions. A "Tags" column lets you label questions for later filtering — e.g.
                "reserved, exam-only" — leave it blank if you don't need it.
              </p>
              <p className="hint" style={{ margin: 0 }}>
                Archive: a question can belong to several boards, each with several years. Separate boards with ";"
                in Authority and give each board's years in the same order in Year — e.g. Authority "Dhaka Board;
                Rajshahi Board" with Year "2015, 2017, 2019; 2018, 2020". One board with one year works as before.
              </p>
              {type === "coding" && (
                <p className="hint" style={{ margin: 0 }}>
                  Coding: list the allowed languages in Languages (e.g. "python, cpp, java"), fill a Starter column only
                  for languages you want starter code in, and up to 10 tests per row. Line breaks inside a cell are kept.
                </p>
              )}
              <div className="row-tight">
                <DownloadButton className="btn btn-quiet" filename={`questions-template.xlsx`} href={`/api/questions/bulk/template?format=xlsx&type=${type}`}>
                  <FileSpreadsheet size={15} /> Excel (.xlsx)
                </DownloadButton>
                <DownloadButton className="btn btn-quiet" filename={`questions-template.csv`} href={`/api/questions/bulk/template?format=csv&type=${type}`}>
                  <FileSpreadsheet size={15} /> CSV
                </DownloadButton>
              </div>
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>Choose a question type above first.</p>
          )}
        </div>

        <div className="card stack">
          <div className="row-tight"><Upload size={17} className="muted" /><h2>3. Choose where it goes</h2></div>
          <p className="hint" style={{ margin: 0 }}>
            {type === "passage"
              ? "Every question in the file is filed under one chapter, as chapter pool — passage questions can't have a topic."
              : "Every question in the file is filed under one subject and topic — or a chapter, for the chapter pool. The file itself has no topic/chapter column."}
          </p>

          <Field label="Subject">
            <SearchSelect
              className="select"
              value={subjectId}
              onChange={(e) => { setSubjectId(e.target.value); setFiling(""); }}
            >
              <option value="">Choose a subject</option>
              {subjects.map((s) => (
                <option key={s._id} value={s._id}>{s.title}</option>
              ))}
            </SearchSelect>
          </Field>

          {subjectId && (
            <Field label={type === "passage" ? "Chapter" : "Topic or chapter"}>
              <FilingSelect
                chapters={chapters}
                value={filing}
                onChange={setFiling}
                passageOnly={type === "passage"}
                placeholder={type === "passage" ? "Choose a chapter" : "Choose a topic, or a chapter for the chapter pool"}
              />
            </Field>
          )}
        </div>

        <div className="card stack">
          <div className="row-tight"><Upload size={17} className="muted" /><h2>4. Upload your file</h2></div>

          <ErrorNote error={error} />

          <input
            className="input"
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />

          <button
            className="btn"
            style={{ alignSelf: "flex-start" }}
            disabled={!type || !filing || !file || importing}
            onClick={submit}
          >
            <Upload size={15} />
            {importing ? "Importing" : "Import questions"}
          </button>

          {(!type || !filing) && <p className="hint" style={{ margin: 0 }}>Pick a type, subject and topic or chapter above first.</p>}

          {data && (
            <div className="stack" style={{ gap: 10 }}>
              <div className={`banner ${data.created > 0 ? "banner-ok" : "banner-warn"} row-tight`}>
                {data.created > 0 ? <Check size={16} /> : <AlertTriangle size={16} />}
                <span>
                  {data.message}{" "}
                  {data.created > 0 && (
                    <Link
                      to={topicId ? `/questions?topic=${topicId}` : `/questions?chapter=${chapterId}&topic=none`}
                      style={{ textDecoration: "underline" }}
                    >
                      View them
                    </Link>
                  )}
                </span>
              </div>

              {data.rejected?.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <p className="label" style={{ margin: 0 }}>
                    {data.rejected.length} row{data.rejected.length === 1 ? "" : "s"} skipped
                  </p>
                  {data.rejected.map((r, i) => (
                    <div key={i} className="card-quiet small" style={{ padding: 9 }}>
                      Row {r.row ?? r.index + 2}: {r.reason}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
