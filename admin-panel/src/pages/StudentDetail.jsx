import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useGetStudentQuery,
  useGetBatchesQuery,
  useEnrolStudentMutation,
  useRecordPurchaseMutation,
  useUpdateStudentMutation,
  useResetStudentPasswordMutation,
  useDeleteStudentMutation,
} from "../api/contentApi";
import { useGetMeQuery } from "../api/authApi";
import { ArrowLeft, Gift, Receipt, CheckCircle2, XCircle, Wallet, GraduationCap, Pencil, KeyRound, Bot, Ban, RotateCcw, Trash2, ShieldAlert } from "lucide-react";
import { Loading, ErrorNote, Field, useCan, useConfirm, PasswordInput } from "../components/bits";
import { useTerms } from "../terms";
import StudentPora from "../components/StudentPora";
import SearchSelect from "../components/SearchSelect";

// Enrolment and payment are separate actions on purpose. Granting a
// scholarship should not require inventing a transaction.
export default function StudentDetail() {
  const terms = useTerms();
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: me } = useGetMeQuery();
  const can = useCan(me);
  const confirm = useConfirm();

  const { data, isLoading, error } = useGetStudentQuery(id);
  const { data: batches } = useGetBatchesQuery({});
  const [enrol, enrolState] = useEnrolStudentMutation();
  const [record, recordState] = useRecordPurchaseMutation();
  const [updateStudent, updateState] = useUpdateStudentMutation();
  const [resetPassword, resetState] = useResetStudentPasswordMutation();
  const [deleteStudent, deleteState] = useDeleteStudentMutation();

  const [granting, setGranting] = useState(null);
  const [paying, setPaying] = useState(null);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);

  if (isLoading) return <Loading />;
  if (error) return <div className="page"><ErrorNote error={error} /></div>;

  const { student, access, purchases, submissions, aiCredits, aiUsageRecent, aiUsageSummary } = data;
  // Deleted at the student's own request: a read-only record.
  const editable = !student.deletedAt;
  const selectedBatch = (batches || []).find((b) => b._id === paying?.batchId);

  const toggleActive = async () => {
    const activating = !student.isActive;
    const yes = await confirm({
      title: activating ? "Reactivate this student?" : "Deactivate this student?",
      body: activating
        ? "They'll be able to log in again immediately. Nothing else changes — all history and access stay exactly as they are."
        : "Blocks login immediately. Every record (purchases, submissions, AI usage) stays exactly as it is — this is fully reversible from this same button.",
      confirmLabel: activating ? "Reactivate" : "Deactivate",
      tone: activating ? "neutral" : undefined,
    });
    if (!yes) return;
    await updateStudent({ id, isActive: activating }).unwrap().catch(() => {});
  };

  const handleDelete = async () => {
    const yes = await confirm({
      title: "Permanently delete this student?",
      body: "This removes the account and every record tied to it — purchases, trials, exam submissions, AI usage and credit balances, practice history, doubts, and uploaded files. This cannot be undone. If you only want to stop their access and keep the history, use Deactivate instead.",
      confirmLabel: "Delete permanently",
    });
    if (!yes) return;
    try {
      await deleteStudent(id).unwrap();
      navigate("/students");
    } catch { /* rendered below */ }
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1 className="row-tight" style={{ gap: 8 }}>
            {student.name || "Unnamed student"}
            {student.deletedAt ? (
              <span className="pill row-tight" style={{ gap: 4, fontSize: 12 }}>
                <Ban size={11} /> Deleted by student
              </span>
            ) : !student.isActive && (
              <span className="pill pill-bad row-tight" style={{ gap: 4, fontSize: 12 }}>
                <Ban size={11} /> Deactivated
              </span>
            )}
          </h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {student.deletedAt
              ? `Deleted their account on ${new Date(student.deletedAt).toLocaleDateString()}. Kept read-only: payments and exam results stay for records.`
              : [student.studentId && `ID ${student.studentId}`, student.email || student.phoneNumber].filter(Boolean).join(" · ")}
          </p>
          {!student.deletedAt && (student.guardian?.phone || student.guardian?.email) && (
            <p className="muted small" style={{ margin: "2px 0 0" }}>
              Guardian: {[student.guardian.name && `${student.guardian.name}${student.guardian.relation ? ` (${student.guardian.relation})` : ""}`, student.guardian.phone, student.guardian.email].filter(Boolean).join(" · ")}
              {student.guardian.optOut && <span className="pill" style={{ marginLeft: 6 }}>Reports off</span>}
            </p>
          )}
        </div>
        <div className="row-tight">
          {editable && can("manageStudents") && (
            <>
              <button
                className="btn btn-sm btn-quiet"
                onClick={() => setEditing({ name: student.name || "", studentId: student.studentId || "", email: student.email || "", phoneNumber: student.phoneNumber || "", guardian: { name: "", relation: "", phone: "", email: "", optOut: false, ...(student.guardian || {}) } })}
              >
                <Pencil size={14} /> Edit profile
              </button>
              <button className="btn btn-sm btn-quiet" onClick={() => setResetting({ password: "", name: student.name || "" })}>
                <KeyRound size={14} /> Reset password
              </button>
              <button className="btn btn-sm btn-quiet" onClick={toggleActive} disabled={updateState.isLoading}>
                {student.isActive ? <><Ban size={14} /> Deactivate</> : <><RotateCcw size={14} /> Reactivate</>}
              </button>
            </>
          )}
          {editable && can("manageStudents") && (
            <button className="btn btn-sm btn-quiet" onClick={() => navigate(`/conduct?student=${student._id}`)}>
              <ShieldAlert size={14} /> Conduct record
            </button>
          )}
          {editable && can("deleteStudents") && (
            <button className="btn btn-sm btn-danger" onClick={handleDelete} disabled={deleteState.isLoading}>
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button className="btn btn-sm btn-quiet" onClick={() => navigate("/students")}>
            <ArrowLeft size={14} /> Students
          </button>
        </div>
      </div>

      <div className="stack">
        <ErrorNote error={enrolState.error || recordState.error || updateState.error || resetState.error || deleteState.error} />

        {editing && (
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await updateStudent({ id, ...editing }).unwrap();
                setEditing(null);
              } catch { /* rendered above */ }
            }}
          >
            <h2>Edit profile</h2>
            <Field label="Name">
              <input
                className="input"
                autoFocus
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <div className="row">
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={editing.email}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className="input"
                  value={editing.phoneNumber}
                  onChange={(e) => setEditing({ ...editing, phoneNumber: e.target.value })}
                />
              </Field>
              <Field label="Student ID">
                <input
                  className="input"
                  style={{ fontFamily: "monospace" }}
                  value={editing.studentId}
                  onChange={(e) => setEditing({ ...editing, studentId: e.target.value.toUpperCase() })}
                />
              </Field>
            </div>
            <h3 style={{ margin: "8px 0 0" }}>Guardian</h3>
            <p className="hint" style={{ margin: 0 }}>Gets progress reports by SMS or email when the batch sends them. A local number works; the country comes from Progress reports → Settings.</p>
            <div className="row">
              <Field label="Name">
                <input className="input" value={editing.guardian.name} onChange={(e) => setEditing({ ...editing, guardian: { ...editing.guardian, name: e.target.value } })} />
              </Field>
              <Field label="Relation">
                <input className="input" placeholder="e.g. Father" value={editing.guardian.relation} onChange={(e) => setEditing({ ...editing, guardian: { ...editing.guardian, relation: e.target.value } })} />
              </Field>
            </div>
            <div className="row">
              <Field label="Phone">
                <input className="input" value={editing.guardian.phone} onChange={(e) => setEditing({ ...editing, guardian: { ...editing.guardian, phone: e.target.value } })} />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={editing.guardian.email} onChange={(e) => setEditing({ ...editing, guardian: { ...editing.guardian, email: e.target.value } })} />
              </Field>
            </div>
            <label className="row-tight small"><input type="checkbox" checked={editing.guardian.optOut} onChange={(e) => setEditing({ ...editing, guardian: { ...editing.guardian, optOut: e.target.checked } })} /> Don't send reports to the guardian</label>
            <div className="row">
              <button className="btn btn-sm" disabled={updateState.isLoading || !editing.name}>
                Save
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {resetting && (
          <form
            className="card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await resetPassword({ id, password: resetting.password, name: resetting.name }).unwrap();
                setResetting(null);
              } catch { /* rendered above */ }
            }}
          >
            <h2>Reset password</h2>
            {!student.isProfileComplete && (
              <>
                <p className="hint" style={{ margin: 0 }}>
                  This student registered but never finished signing up — there's
                  no name or password on the account yet, and login refuses any
                  account in that state regardless of password. Enter a name
                  below to activate the account along with the new password.
                </p>
                <Field label="Name">
                  <input
                    className="input"
                    autoFocus
                    value={resetting.name}
                    onChange={(e) => setResetting({ ...resetting, name: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="New password" hint="At least 8 characters. The student isn't notified — tell them yourself.">
              <PasswordInput
                autoFocus={student.isProfileComplete}
                value={resetting.password}
                onChange={(e) => setResetting({ ...resetting, password: e.target.value })}
              />
            </Field>
            <div className="row">
              <button
                className="btn btn-sm"
                disabled={resetState.isLoading || resetting.password.length < 8 || (!student.isProfileComplete && !resetting.name.trim())}
              >
                Set password
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResetting(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="card stack">
          <div className="spread">
            <h2>Access</h2>
            {editable && can("manageStudents") && (
              <div className="row-tight">
                <button className="btn btn-sm btn-quiet" onClick={() => setGranting({ batchId: "", days: 30 })}>
                  <Gift size={14} /> Grant access
                </button>
                <button className="btn btn-sm" onClick={() => setPaying({ batchId: "", planLabel: "", method: "Cash" })}>
                  <Receipt size={14} /> Record payment
                </button>
              </div>
            )}
          </div>

          {granting && (
            <form
              className="card-quiet stack"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await enrol({ id, batchId: granting.batchId, days: Number(granting.days) || null }).unwrap();
                  setGranting(null);
                } catch { /* rendered above */ }
              }}
            >
              <span className="label">Free access, no payment recorded</span>
              <div className="row">
                <Field label="Batch">
                  <SearchSelect
                    className="select"
                    value={granting.batchId}
                    onChange={(e) => setGranting({ ...granting, batchId: e.target.value })}
                  >
                    <option value="">Choose a {terms.batch}</option>
                    {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </SearchSelect>
                </Field>
                <Field label="Days" hint="Blank means never expires.">
                  <input
                    className="input tnum"
                    type="number"
                    min="1"
                    value={granting.days}
                    onChange={(e) => setGranting({ ...granting, days: e.target.value })}
                  />
                </Field>
              </div>
              <div className="row">
                <button className="btn btn-sm" disabled={!granting.batchId}>Grant</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setGranting(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {paying && (
            <form
              className="card-quiet stack"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await record({ id, ...paying }).unwrap();
                  setPaying(null);
                } catch { /* rendered above */ }
              }}
            >
              <span className="label">A payment taken outside the app</span>
              <div className="row">
                <Field label="Batch">
                  <SearchSelect
                    className="select"
                    value={paying.batchId}
                    onChange={(e) => setPaying({ ...paying, batchId: e.target.value, planLabel: "" })}
                  >
                    <option value="">Choose a {terms.batch}</option>
                    {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </SearchSelect>
                </Field>
                <Field label="Plan">
                  <SearchSelect
                    className="select"
                    value={paying.planLabel}
                    onChange={(e) => setPaying({ ...paying, planLabel: e.target.value })}
                    disabled={!selectedBatch}
                  >
                    <option value="">Choose a plan</option>
                    {(selectedBatch?.plans || []).map((p) => (
                      <option key={p._id} value={p.label}>{p.label} — {p.price}</option>
                    ))}
                  </SearchSelect>
                </Field>
              </div>
              <div className="row">
                <Field label="Method">
                  <input
                    className="input"
                    value={paying.method}
                    onChange={(e) => setPaying({ ...paying, method: e.target.value })}
                  />
                </Field>
                <Field label="Reference" hint="Optional, but must be unique.">
                  <input
                    className="input"
                    value={paying.transactionId || ""}
                    onChange={(e) => setPaying({ ...paying, transactionId: e.target.value })}
                  />
                </Field>
              </div>
              <div className="row">
                <button className="btn btn-sm" disabled={!paying.batchId || !paying.planLabel}>
                  Record payment
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPaying(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          {access.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>No access to any batch.</p>
          ) : (
            access.map((entry, index) => (
              <div className="card-quiet spread" key={index} style={{ padding: 11 }}>
                <div className="grow">
                  <strong style={{ fontWeight: 500 }}>{entry.batch?.name || `Unknown ${terms.batch}`}</strong>
                  <div className="muted small">
                    {entry.via === "trial" ? "Trial" : "Purchased"}
                    {entry.expiresAt && new Date(entry.expiresAt).getFullYear() < 9000
                      ? ` · until ${new Date(entry.expiresAt).toLocaleDateString()}`
                      : entry.expiresAt ? " · never expires" : ""}
                  </div>
                </div>
                <span className={`pill row-tight ${entry.isActive ? "pill-ok" : "pill-bad"}`} style={{ gap: 4 }}>
                  {entry.isActive ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                  {entry.isActive ? "Active" : "Expired"}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="card stack">
          <div className="row-tight"><Wallet size={17} className="muted" /><h2>Payments</h2></div>
          {purchases.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>Nothing recorded.</p>
          ) : (
            purchases.map((purchase) => (
              <div className="spread small" key={purchase._id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <span className="grow">
                  {purchase.plan.label}
                  <span className="muted"> · {purchase.batch?.name || ""}</span>
                </span>
                <span className="muted">{new Date(purchase.startDate).toLocaleDateString()}</span>
                <span className="tnum">{purchase.plan.price === 0 ? "Free" : purchase.plan.price}</span>
              </div>
            ))
          )}
        </div>

        <div className="card stack">
          <div className="row-tight"><GraduationCap size={17} className="muted" /><h2>Results</h2></div>
          {submissions.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              No exams taken yet.
            </p>
          ) : (
            submissions.map((submission) => (
              <div className="spread small" key={submission._id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <span className="grow">{submission.exam?.title || "Exam"}</span>
                <span className="tnum">{submission.marks} / {submission.totalMarks}</span>
              </div>
            ))
          )}
        </div>

        <StudentPora studentId={id} />
        <StudentPora studentId={id} kind="tutor" />
        <StudentPora studentId={id} kind="interview" />

        <div className="card stack">
          <div className="row-tight"><Bot size={17} className="muted" /><h2>AI usage</h2></div>

          <div className="row" style={{ gap: 24 }}>
            <div>
              <div className="muted small">Calls</div>
              <div className="tnum" style={{ fontSize: 18 }}>{aiUsageSummary?.calls || 0}</div>
            </div>
            <div>
              <div className="muted small">Cost</div>
              <div className="tnum" style={{ fontSize: 18 }}>${(aiUsageSummary?.cost || 0).toFixed(4)}</div>
            </div>
            <div>
              <div className="muted small">Credits spent</div>
              <div className="tnum" style={{ fontSize: 18 }}>{aiUsageSummary?.creditsSpent || 0}</div>
            </div>
            <div>
              <div className="muted small">Failures</div>
              <div className="tnum" style={{ fontSize: 18 }}>{aiUsageSummary?.failures || 0}</div>
            </div>
          </div>

          {(aiCredits || []).length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="label">Credit balance</span>
              {aiCredits.map((c) => (
                <div className="spread small" key={c._id}>
                  <span className="grow">{c.batch?.name || `General (no ${terms.batch})`}</span>
                  <span className="tnum">{c.balance}</span>
                </div>
              ))}
            </div>
          )}

          <div className="stack" style={{ gap: 0 }}>
            <span className="label">Recent calls</span>
            {(aiUsageRecent || []).length === 0 ? (
              <p className="hint" style={{ margin: 0 }}>No AI calls yet.</p>
            ) : (
              aiUsageRecent.map((u) => (
                <div className="spread small" key={u._id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                  <span className="grow">
                    {u.feature}
                    <span className="muted"> · {u.model}</span>
                  </span>
                  <span className={`pill ${u.ok ? "pill-ok" : "pill-bad"}`} style={{ padding: "1px 6px" }}>
                    {u.ok ? "ok" : "failed"}
                  </span>
                  <span className="tnum">
                    {u.creditsSpent ? `${u.creditsSpent} cr` : `$${(u.estimatedCostUsd || 0).toFixed(4)}`}
                  </span>
                  <span className="muted">{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
