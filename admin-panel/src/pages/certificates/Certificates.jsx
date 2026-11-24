import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { Award, ExternalLink } from "lucide-react";
import {
  useGetBatchesQuery, useGetCertificateTemplateQuery, useUpdateCertificateTemplateMutation, useGetCertificatesQuery,
  useGetCertificateCandidatesQuery, useIssueCertificatesMutation, useRevokeCertificateMutation, useRestoreCertificateMutation,
} from "../../api/contentApi";
import { Loading, ErrorNote, Empty, Field, useConfirm, Pager } from "../../components/bits";
import { useTerms } from "../../terms";
import SignatureFields from "../../components/SignatureFields";
import SearchSelect from "../../components/SearchSelect";

const PLACEHOLDERS = "{name}, {batch}, {program}, {grade}, {date}";

// The default design: title, wording and signatures (owner and admin).
function TemplateCard({ onClose }) {
  const { data } = useGetCertificateTemplateQuery();
  const [form, setForm] = useState(null);
  const [applyToIssued, setApplyToIssued] = useState(false);
  const [save, { isLoading, error }] = useUpdateCertificateTemplateMutation();
  useEffect(() => { if (data && !form) setForm({ title: data.title, body: data.body, style: data.style, signatures: data.signatures.length ? data.signatures : [{ name: "", role: "", image: null }] }); }, [data, form]);
  if (!form) return <Loading />;
  return (
    <div className="card stack">
      <div className="spread"><h2>Certificate design</h2><button className="btn btn-sm btn-quiet" onClick={onClose}>Close</button></div>
      <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <Field label="Wording" hint={`Filled in when issued: ${PLACEHOLDERS}`}>
        <textarea className="textarea" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      </Field>
      <Field label="Style">
        <select className="select" style={{ maxWidth: 220 }} value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })}>
          <option value="classic">Classic (border, serif)</option>
          <option value="modern">Modern (clean, accent bar)</option>
        </select>
      </Field>
      <SignatureFields value={form.signatures} onChange={(signatures) => setForm({ ...form, signatures })} />
      <label className="row-tight" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={applyToIssued} onChange={(e) => setApplyToIssued(e.target.checked)} />
        <span>Also put these signatures on certificates already issued</span>
      </label>
      <ErrorNote error={error} />
      <div className="row-tight"><button className="btn" disabled={isLoading} onClick={async () => { try { await save({ ...form, applyToIssued }).unwrap(); onClose(); } catch { /* shown */ } }}>{isLoading ? "Saving" : "Save design"}</button></div>
      <p className="muted small">Title, wording and style apply to certificates issued from now on. Signatures do too, unless you tick the box above.</p>
    </div>
  );
}

// Choose students (by grade if you like) and issue.
function IssuePanel({ batchId, onDone }) {
  const { data, isLoading, error } = useGetCertificateCandidatesQuery(batchId);
  const { data: template } = useGetCertificateTemplateQuery();
  const [picked, setPicked] = useState(new Set());
  const [min, setMin] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [issue, issueState] = useIssueCertificatesMutation();
  const students = data?.students || [];
  const finalTitle = title || template?.title || "";

  const pickByGrade = () => {
    const n = Number(min);
    setPicked(new Set(students.filter((s) => s.overall !== null && s.overall >= n).map((s) => String(s._id))));
  };
  const toggle = (id) => { const next = new Set(picked); if (next.has(id)) next.delete(id); else next.add(id); setPicked(next); };

  const submit = async () => {
    try {
      const r = await issue({ batch: batchId, students: [...picked], title: title || undefined, body: body || undefined }).unwrap();
      onDone(`${r.issued} issued${r.skipped ? `, ${r.skipped} already had it` : ""}.`);
      setPicked(new Set());
    } catch { /* shown */ }
  };

  if (isLoading) return <Loading />;
  return (
    <div className="card stack">
      <h2>Issue certificates</h2>
      <ErrorNote error={error || issueState.error} />
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 8 }}>
        <button className="btn btn-sm btn-quiet" onClick={() => setPicked(new Set(students.map((s) => String(s._id))))}>Select everyone</button>
        <button className="btn btn-sm btn-quiet" onClick={() => setPicked(new Set())}>Clear</button>
        <span className="muted small">or overall at least</span>
        <input className="input tnum" type="number" min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 80 }} />
        <span className="muted small">%</span>
        <button className="btn btn-sm btn-quiet" disabled={min === ""} onClick={pickByGrade}>Select</button>
      </div>
      {students.length === 0 ? <p className="muted">Nobody on the register yet.</p> : (
        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          <table className="table">
            <thead><tr><th></th><th>Student</th><th>Overall</th><th>Grade</th><th>Already has</th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s._id} onClick={() => toggle(String(s._id))} style={{ cursor: "pointer" }}>
                  <td><input type="checkbox" checked={picked.has(String(s._id))} readOnly /></td>
                  <td>{s.name}{s.studentId && <span className="muted small"> · {s.studentId}</span>}</td>
                  <td className="tnum">{s.overall === null ? "—" : `${s.overall}%`}</td>
                  <td>{s.letter || "—"}</td>
                  <td className="small muted">{s.held.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-tight" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <Field label="Title (optional)" hint={`Default: ${template?.title || ""}`}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={template?.title} /></Field>
        <Field label="Wording (optional)" hint={PLACEHOLDERS}><textarea className="textarea" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder={template?.body} style={{ minWidth: 320 }} /></Field>
      </div>
      <div className="row-tight">
        <button className="btn" disabled={!picked.size || issueState.isLoading} onClick={submit}><Award size={15} /> {issueState.isLoading ? "Issuing" : `Issue "${finalTitle}" to ${picked.size}`}</button>
      </div>
    </div>
  );
}

export default function Certificates() {
  const terms = useTerms();
  const { me } = useOutletContext() || {};
  const [params, setParams] = useSearchParams();
  const batchId = params.get("batch") || "";
  const [panel, setPanel] = useState(null); // design | issue
  const [note, setNote] = useState("");
  const [page, setPage] = useState(1);
  const { data: batchData } = useGetBatchesQuery({});
  const batches = batchData?.batches || batchData || [];
  const { data, isLoading, error } = useGetCertificatesQuery({ batch: batchId || undefined, page });
  const confirm = useConfirm();
  const [revoke] = useRevokeCertificateMutation();
  const [restore] = useRestoreCertificateMutation();
  const list = data?.certificates || [];
  const canDesign = ["owner", "admin"].includes(me?.role);
  const batchName = useMemo(() => Object.fromEntries((Array.isArray(batches) ? batches : []).map((b) => [b._id, b.name])), [batches]);

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Certificates</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>Issue certificates to students; anyone can check one by its number at /verify.</p>
        </div>
        <div className="row-tight">
          {canDesign && <button className="btn btn-quiet" onClick={() => setPanel(panel === "design" ? null : "design")}>Design</button>}
          {batchId && <button className="btn" onClick={() => setPanel(panel === "issue" ? null : "issue")}><Award size={15} /> Issue</button>}
        </div>
      </div>
      <div className="stack">
        <SearchSelect className="select" style={{ maxWidth: 320 }} value={batchId} onChange={(e) => { setParams(e.target.value ? { batch: e.target.value } : {}); setPanel(null); setPage(1); }}>
          <option value="">All {terms.batches}</option>
          {(Array.isArray(batches) ? batches : []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </SearchSelect>
        {panel === "design" && <TemplateCard onClose={() => setPanel(null)} />}
        {panel === "issue" && batchId && <IssuePanel batchId={batchId} onDone={(msg) => { setNote(msg); setPanel(null); }} />}
        {note && <div className="card-quiet small">{note}</div>}
        <ErrorNote error={error} />
        {isLoading ? <Loading /> : list.length === 0 ? (
          <Empty icon={Award} title="No certificates yet" hint={batchId ? "Use Issue to give students in this batch a certificate." : `Choose a ${terms.batch} to issue certificates.`} />
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="table">
              <thead><tr><th>Student</th><th>Certificate</th><th>{terms.Batch}</th><th>Number</th><th>Issued</th><th></th></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c._id}>
                    <td><strong>{c.recipientName}</strong></td>
                    <td>{c.title}{c.grade && <span className="muted small"> · {c.grade}</span>}{c.revokedAt && <span className="pill pill-bad" style={{ marginLeft: 6 }}>Revoked</span>}</td>
                    <td className="muted">{c.batchName || batchName[c.batch]}</td>
                    <td className="tnum small">{c.serial}</td>
                    <td className="tnum small">{new Date(c.issuedAt).toLocaleDateString()}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <a className="btn btn-sm btn-quiet" href={c.verifyUrl || `/verify/${c.serial}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> View</a>{" "}
                      {c.revokedAt
                        ? <button className="btn btn-sm btn-quiet" onClick={() => restore(c._id)}>Restore</button>
                        : <button className="btn btn-sm btn-quiet" onClick={async () => { if (await confirm({ title: `Revoke ${c.recipientName}'s certificate?`, body: "Checking its number will show it as revoked, and it leaves the student's list. You can restore it later.", confirmLabel: "Revoke", tone: "danger" })) revoke({ id: c._id, reason: "" }); }}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "0 16px 12px" }}><Pager page={data?.page || 1} pages={data?.pages || 1} total={data?.total || 0} onChange={setPage} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
