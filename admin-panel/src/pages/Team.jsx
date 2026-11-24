import { useState } from "react";
import { OFF_FEATURES } from "../constants/roles";
import {
  useGetUsersQuery,
  useUpdateUserMutation,
  useGetUserProfileQuery,
  useUpdateUserProfileMutation,
  useUploadMediaMutation,
  useResetUserPasswordMutation,
  useDeleteUserMutation,
  useGetInvitesQuery,
  useCreateInviteMutation,
  useRevokeInviteMutation,
} from "../api/contentApi";
import {
  UserPlus, Copy, Trash2, Check, Clock, ShieldAlert, Mail, Pencil,
  KeyRound, UserX, UserCheck, History, X, Contact,
} from "lucide-react";
import { Loading, ErrorNote, Field, useConfirm, Pager, PasswordInput } from "../components/bits";
import TeacherProfileForm from "../components/TeacherProfileForm";
import { useGetMeQuery } from "../api/authApi";
import { useTerms } from "../terms";

const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  teacher: "Teacher",
  grader: "Grader",
  doubtSolver: "Doubt solver",
  representative: "Representative",
};

const ROLE_OPTIONS = ["teacher", "grader", "doubtSolver", "admin", "representative"];

// Photo, headline, subjects and bio that students and visitors see. Only
// an owner or admin edits it, from the button beside each person.
function PublicProfileModal({ user, onClose }) {
  const terms = useTerms();
  const { data, isLoading, error } = useGetUserProfileQuery(user._id);
  const [save, saveState] = useUpdateUserProfileMutation();
  const [upload] = useUploadMediaMutation();
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog stack" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="spread">
          <h3 style={{ margin: 0 }}>{user.name} · public profile</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Shown on the landing page's teachers section and on the {terms.batches} this person teaches.
        </p>
        <ErrorNote error={error} />
        {isLoading ? <Loading /> : (
          <TeacherProfileForm
            initial={data}
            name={user.name}
            upload={(file) => upload({ file, folder: "teachers" }).unwrap()}
            saving={saveState.isLoading}
            error={saveState.error}
            onSave={async (body) => {
              try {
                await save({ id: user._id, ...body }).unwrap();
                onClose();
              } catch {
                // rendered in the form
              }
            }}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}

// One dialog, both jobs: full profile edit (name/email/role/identifier) and
// changing someone's password, since both are owner/admin-only actions on
// the same account and switching between two separate dialogs for what's
// really one "manage this person" task adds friction for no reason.
// Reuses the exact overlay/dialog classes useConfirm's own dialog uses
// (components/bits.jsx), not an invented modal style.
function EditUserModal({ user, onClose }) {
  const [tab, setTab] = useState("profile");
  const [profile, setProfile] = useState({
    name: user.name,
    email: user.email,
    role: user.role,
    identifier: user.identifier || "",
  });
  const [duty, setDuty] = useState({ note: user.duty?.note || "", goal: user.duty?.goal || 0, off: user.duty?.off || [] });
  const [away, setAway] = useState(user.away?.until ? String(user.away.until).slice(0, 10) : "");
  const [password, setPassword] = useState("");

  const [update, updateState] = useUpdateUserMutation();
  const [resetPassword, resetState] = useResetUserPasswordMutation();

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      await update({ id: user._id, ...profile, identifier: profile.identifier.trim() || null }).unwrap();
      onClose();
    } catch {
      // rendered below
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    try {
      await resetPassword({ id: user._id, password }).unwrap();
      setPassword("");
      onClose();
    } catch {
      // rendered below
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog stack" style={{ maxWidth: 440 }}>
        <div className="spread">
          <h3 style={{ margin: 0 }}>{user.name}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="row-tight">
          <button
            type="button"
            className={`pill pill-btn${tab === "profile" ? " pill-on" : ""}`}
            onClick={() => setTab("profile")}
          >
            Profile
          </button>
          {user.role !== "owner" && <button type="button" className={`pill pill-btn${tab === "duty" ? " pill-on" : ""}`} onClick={() => setTab("duty")}>Duty</button>}
          <button
            type="button"
            className={`pill pill-btn${tab === "password" ? " pill-on" : ""}`}
            onClick={() => setTab("password")}
          >
            Password
          </button>
        </div>

        {tab === "duty" ? (
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { await update({ id: user._id, duty: { ...duty, goal: Number(duty.goal) || 0 }, away: away ? { until: away } : null }).unwrap(); onClose(); } catch { /* shown below */ } }}>
            <ErrorNote error={updateState.error} />
            <div className="row-tight small muted" style={{ gap: 10, flexWrap: "wrap" }}>
              {user.streak > 0 && <span>🔥 {user.streak}-day streak</span>}
              {user.lastActiveAt && <span>Last seen {new Date(user.lastActiveAt).toLocaleString()}</span>}
              {user.phone && <span>☎ {user.phone}</span>}
            </div>
            {user.payout && <span className="small">Pay to: <b>{{ bkash: "bKash", nagad: "Nagad", rocket: "Rocket", bank: "Bank" }[user.payout.method]}</b> {user.payout.account}{user.payout.holder ? ` (${user.payout.holder})` : ""}{user.payout.bank ? ` · ${user.payout.bank}${user.payout.branch ? `, ${user.payout.branch}` : ""}` : ""}</span>}
            <Field label="Responsibilities" hint="They see this on their home and My profile."><textarea className="textarea" rows={4} maxLength={1000} value={duty.note} onChange={(e) => setDuty({ ...duty, note: e.target.value })} placeholder="e.g. Physics for the HSC 2027 batches; mark scripts within 48 hours." /></Field>
            <Field label="Weekly goal" hint={`In ${{ teacher: "scripts marked and doubts solved", grader: "scripts marked", doubtSolver: "doubts solved", editor: "comments and corrections" }[user.role] || "active days"}. 0: no goal.`}><input className="input tnum" type="number" min={0} style={{ width: 120 }} value={duty.goal} onChange={(e) => setDuty({ ...duty, goal: e.target.value })} /></Field>
            {OFF_FEATURES.some(([, , roles]) => roles.includes(user.role)) && (
              <div className="field">
                <span className="label">Turned off for them</span>
                {OFF_FEATURES.filter(([, , roles]) => roles.includes(user.role)).map(([k, l]) => (
                  <label key={k} className="row-tight small"><input type="checkbox" checked={duty.off.includes(k)} onChange={(e) => setDuty({ ...duty, off: e.target.checked ? [...duty.off, k] : duty.off.filter((x) => x !== k) })} /> {l}</label>
                ))}
              </div>
            )}
            <Field label="Away until" hint="Nothing new is assigned to them until then. They can set this themselves too."><div className="row-tight"><input className="input" type="date" value={away} onChange={(e) => setAway(e.target.value)} />{away && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAway("")}>Clear</button>}</div></Field>
            <div className="row"><button className="btn" disabled={updateState.isLoading}>Save</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
          </form>
        ) : tab === "profile" ? (
          <form className="stack" onSubmit={saveProfile}>
            <ErrorNote error={updateState.error} />
            <Field label="Name">
              <input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input
                className="input" type="email" value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              />
            </Field>
            <Field label="Internal identifier" hint="Shown in staff-facing reports instead of their real name. Never seen by students.">
              <input
                className="input" value={profile.identifier}
                placeholder="e.g. Tutor Rahim"
                onChange={(e) => setProfile({ ...profile, identifier: e.target.value })}
              />
            </Field>
            <div className="field">
              <span className="label">Role</span>
              <div className="row-tight" style={{ flexWrap: "wrap" }}>
                {ROLE_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`pill pill-btn${profile.role === value ? " pill-on" : ""}`}
                    onClick={() => setProfile({ ...profile, role: value })}
                  >
                    {ROLE_LABEL[value]}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <button className="btn" disabled={updateState.isLoading || !profile.name || !profile.email}>
                {updateState.isLoading ? "Saving" : "Save changes"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </form>
        ) : (
          <form className="stack" onSubmit={savePassword}>
            <ErrorNote error={resetState.error} />
            <p className="hint" style={{ margin: 0 }}>
              Sets their password directly and signs them out of every device they're
              currently logged into.
            </p>
            <Field label="New password">
              <PasswordInput
                autoFocus
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </Field>
            <div className="row">
              <button className="btn" disabled={resetState.isLoading || password.length < 8}>
                <KeyRound size={14} /> {resetState.isLoading ? "Setting" : "Set new password"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Team() {
  const [filters, setFilters] = useState({ role: "", page: 1 });
  const [showDeleted, setShowDeleted] = useState(false);

  const users = useGetUsersQuery({
    role: filters.role || undefined,
    page: filters.page,
    limit: 20,
    includeDeleted: showDeleted ? "true" : undefined,
  });
  const invites = useGetInvitesQuery();
  const [invite, inviteState] = useCreateInviteMutation();
  const [revoke] = useRevokeInviteMutation();
  const [updateUser] = useUpdateUserMutation();
  const [deleteUser, deleteState] = useDeleteUserMutation();

  const [draft, setDraft] = useState(null);
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(null);
  const [profileOf, setProfileOf] = useState(null);
  const { data: me } = useGetMeQuery();
  const confirm = useConfirm();

  if (users.isLoading) return <Loading />;

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));

  const submit = async (event) => {
    event.preventDefault();
    try {
      const created = await invite(draft).unwrap();
      setLink(created);
      setDraft(null);
    } catch {
      // rendered below
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(new URL(link.inviteUrl, window.location.origin).href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleActive = (user) => updateUser({ id: user._id, isActive: !user.isActive });

  const doDelete = async (user) => {
    const yes = await confirm({
      title: `Delete ${user.name}?`,
      body: "They can no longer sign in and disappear from the everyday team list. Any grading or doubt they already handled stays exactly as it is, just marked as done by a deleted account. This can't be undone from here.",
      confirmLabel: "Delete account",
    });
    if (yes) deleteUser(user._id);
  };

  return (
    <div className="page">
      <div className="page-head spread">
        <div>
          <h1>Team</h1>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            Teachers set their own password from an invitation link.
          </p>
        </div>
        <button className="btn" onClick={() => setDraft({ name: "", email: "", role: "teacher" })}>
          <UserPlus size={15} /> Invite someone
        </button>
      </div>

      <div className="stack">
        <ErrorNote error={users.error || inviteState.error || deleteState.error} />

        {link && (
          <div className="card stack">
            <div className="row-tight">
              <span className="dialog-icon" style={{ background: "var(--warning-bg)", color: "var(--warning)" }}>
                <Mail size={16} />
              </span>
              <h3>Invitation for {link.name}</h3>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              This link is shown once. Send it now — it cannot be retrieved later,
              and it expires in three days.
            </p>
            <div className="row-tight">
              <input className="input" readOnly value={new URL(link.inviteUrl, window.location.origin).href} />
              <button className="btn btn-sm" onClick={copy}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            <button className="btn btn-sm btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setLink(null)}>
              Done
            </button>
          </div>
        )}

        {draft && (
          <form className="card stack" onSubmit={submit}>
            <div className="row">
              <Field label="Name">
                <input
                  className="input"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
            </div>
            <div className="field">
              <span className="label">Role</span>
              <div className="row-tight">
                {[["teacher", "Teacher"], ["grader", "Grader"], ["doubtSolver", "Doubt solver"], ["admin", "Admin"], ["representative", "Representative"]].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`pill pill-btn${draft.role === value ? " pill-on" : ""}`}
                    onClick={() => setDraft({ ...draft, role: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="hint">
                Teachers manage content and students. Graders only grade —
                a minimal, anonymous view for assigned batches, nothing
                else. Doubt solvers answer escalated doubts and nothing
                else. Admins also manage pricing and AI settings.
              </span>
            </div>
            <div className="row">
              <button className="btn" disabled={!draft.name || !draft.email}>
                <UserPlus size={15} /> Create invitation
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </form>
        )}

        <div className="card stack">
          <div className="spread">
            <h2>People</h2>
            <div className="row-tight">
              <select
                className="select"
                value={filters.role}
                onChange={(e) => setFilter({ role: e.target.value })}
              >
                <option value="">Every role</option>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                <option value="owner">Owner</option>
              </select>
              <button
                type="button"
                className="btn btn-sm btn-quiet row-tight"
                style={{ gap: 5 }}
                onClick={() => { setShowDeleted((v) => !v); setFilter({}); }}
                title="Deleted accounts are kept for historical grading/doubt records — they never sign in again"
              >
                <History size={13} /> {showDeleted ? "Hide deleted" : "Show deleted"}
              </button>
            </div>
          </div>

          {(users.data?.users || []).length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>Nothing matches these filters.</p>
          ) : (
            (users.data?.users || []).map((user) => (
              <div className="spread" key={user._id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div className="grow">
                  <div className="row-tight">
                    <span>{user.name}</span>
                    {user.identifier && <span className="muted small">({user.identifier})</span>}
                  </div>
                  <div className="muted small">{user.isDeleted ? "" : user.email}</div>
                </div>

                <span className="pill">{ROLE_LABEL[user.role] || user.role}</span>
                {user.isDeleted ? (
                  <span className="pill pill-bad" title={user.deletedAt ? new Date(user.deletedAt).toLocaleString() : undefined}>
                    Deleted
                  </span>
                ) : !user.isActive ? (
                  <span className="pill pill-warn">Disabled</span>
                ) : null}
                {!user.isDeleted && user.away?.until && <span className="pill pill-warn" title={user.away.note || ""}>Away until {new Date(user.away.until).toLocaleDateString()}</span>}
                {!user.isDeleted && user.streak > 1 && <span className="muted small" title="Days in a row they used the panel">🔥 {user.streak}</span>}

                {!user.isDeleted && ["owner", "admin", "teacher"].includes(user.role) && (user.role !== "owner" || me?.role === "owner") && (
                  <button className="icon-btn" title="Public profile: photo, subjects, bio" onClick={() => setProfileOf(user)}>
                    <Contact size={14} />
                  </button>
                )}
                {user.role !== "owner" && !user.isDeleted && (
                  <div className="row-tight">
                    <button className="icon-btn" title="Edit profile / password" onClick={() => setEditing(user)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title={user.isActive ? "Deactivate" : "Reactivate"}
                      onClick={() => toggleActive(user)}
                    >
                      {user.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                    </button>
                    <button className="icon-btn icon-btn-danger" title="Delete" onClick={() => doDelete(user)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}

          <Pager
            page={users.data?.page || 1}
            pages={users.data?.pages || 1}
            total={users.data?.total || 0}
            onChange={(page) => setFilter({ page })}
          />
        </div>

        {invites.data?.length > 0 && (
          <div className="card stack">
            <h2>Waiting to accept</h2>
            {invites.data.map((entry) => (
              <div className="spread" key={entry._id} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                <div className="grow">
                  <div>{entry.name}</div>
                  <div className="muted small">{entry.email}</div>
                </div>
                {entry.isExpired ? (
                  <span className="pill pill-bad row-tight" style={{ gap: 4 }}>
                    <ShieldAlert size={11} /> Expired
                  </span>
                ) : (
                  <span className="pill row-tight" style={{ gap: 4 }}>
                    <Clock size={11} /> {ROLE_LABEL[entry.role] || entry.role}
                  </span>
                )}
                <button
                  className="icon-btn icon-btn-danger"
                  title="Revoke this invitation"
                  onClick={async () => {
                    const yes = await confirm({
                      title: `Revoke the invitation for ${entry.name}?`,
                      body: "Their link stops working immediately. You can send a new one.",
                      confirmLabel: "Revoke",
                    });
                    if (yes) revoke(entry._id);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <EditUserModal user={editing} onClose={() => setEditing(null)} />}
      {profileOf && <PublicProfileModal user={profileOf} onClose={() => setProfileOf(null)} />}
    </div>
  );
}
