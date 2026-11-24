import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useGetStudentsQuery, useCreateStudentMutation, useGetBatchesQuery } from "../api/contentApi";
import { useGetMeQuery } from "../api/authApi";
import { useTerms } from "../terms";
import { Plus, Search, Users, ChevronRight, AlertCircle, Ban, Upload } from "lucide-react";
import { Loading, ErrorNote, Empty, Field, useCan, PasswordInput, Pager } from "../components/bits";
import SearchSelect from "../components/SearchSelect";

export default function Students() {
  const { data: me } = useGetMeQuery();
  const can = useCan(me);
  const terms = useTerms();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  // ?batch=<id> (the batch page's student count links here): only students
  // with access to that batch right now.
  const [params, setParams] = useSearchParams();
  const batch = params.get("batch") || "";
  const { data: batches } = useGetBatchesQuery({});
  const { data, isLoading, error } = useGetStudentsQuery({ search: query || undefined, batch: batch || undefined, page });
  const pickBatch = (id) => {
    setParams(id ? { batch: id } : {}, { replace: true });
    setPage(1);
  };
  const [create, createState] = useCreateStudentMutation();
  const [draft, setDraft] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    try {
      await create(draft).unwrap();
      setDraft(null);
    } catch {
      // rendered below
    }
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Students</h1>
          <p className="muted small tnum" style={{ margin: "2px 0 0" }}>
            {isLoading ? "…" : `${data?.total ?? 0} total`}
          </p>
        </div>
        {can("manageStudents") && (
          <div className="row-tight">
          <Link className="btn btn-quiet" to="/students/import"><Upload size={15} /> Import</Link>
          <button
            className="btn"
            onClick={() => setDraft({ name: "", email: "", phoneNumber: "", studentId: "", password: "" })}
          >
            <Plus size={15} /> Add student
          </button>
          </div>
        )}
      </div>

      <div className="stack">
        <ErrorNote error={error || createState.error} />

        {draft && (
          <form className="card stack" onSubmit={submit}>
            <Field label="Name">
              <input
                className="input"
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <div className="row">
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className="input"
                  value={draft.phoneNumber}
                  onChange={(e) => setDraft({ ...draft, phoneNumber: e.target.value })}
                />
              </Field>
              <Field label="Student ID">
                <input
                  className="input"
                  value={draft.studentId}
                  onChange={(e) => setDraft({ ...draft, studentId: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Password" hint="They can change it later. An email, phone number or student ID is required.">
              <PasswordInput
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </Field>
            <div className="row">
              <button
                className="btn"
                disabled={!draft.name || draft.password.length < 8 || (!draft.email && !draft.phoneNumber && !draft.studentId)}
              >
                Add student
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="row" style={{ flexWrap: "wrap" }}>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(search); setPage(1); }} className="search-wrap" style={{ flex: "1 1 240px" }}>
            <Search size={15} className="search-icon" />
            <input
              className="input"
              style={{ paddingLeft: 36 }}
              placeholder="Search by name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          <SearchSelect className="select" style={{ flex: "0 1 260px" }} value={batch} onChange={(e) => pickBatch(e.target.value)}>
            <option value="">All {terms.batches}</option>
            {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </SearchSelect>
        </div>

        {isLoading ? (
          <Loading />
        ) : data?.students?.length ? (
          <div className="list">
            {data.students.map((student) => (
              <Link className="list-row" key={student._id} to={`/students/${student._id}`}>
                <div className="grow">
                  <div style={{ fontSize: 14.5 }}>{student.name || "Unnamed"}</div>
                  <div className="muted small" style={{ marginTop: 2 }}>
                    {[student.studentId, student.email || student.phoneNumber].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {!student.isProfileComplete && (
                  <span className="pill pill-warn row-tight" style={{ gap: 4 }}>
                    <AlertCircle size={11} /> Signup unfinished
                  </span>
                )}
                {student.deletedAt ? (
                  <span className="pill row-tight" style={{ gap: 4 }}>
                    <Ban size={11} /> Deleted by student
                  </span>
                ) : !student.isActive && (
                  <span className="pill pill-bad row-tight" style={{ gap: 4 }}>
                    <Ban size={11} /> Deactivated
                  </span>
                )}
                <ChevronRight size={16} className="muted" />
              </Link>
            ))}
            <Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} />
          </div>
        ) : (
          <Empty
            icon={Users}
            title={batch ? `No students in this ${terms.batch}` : "No students yet"}
            hint="Add them here, or let them sign up themselves once the student app exists."
          />
        )}
      </div>
    </div>
  );
}
