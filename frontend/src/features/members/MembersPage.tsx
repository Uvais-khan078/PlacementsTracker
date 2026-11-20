import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { RecordsLoadingState } from '../system/SystemScreens';

type Access = 'NONE' | 'READ' | 'WRITE';
type Member = { id: string; userId: string; loginId: string; fullName: string; email: string; role: 'SUPER_ADMIN' | 'COMMITTEE_MEMBER'; isActive: boolean; permissions: Record<string, Access>; createdAt?: string; updatedAt?: string };
const permissionModules = ['Dashboard', 'Companies', 'Contacts', 'Leads', 'Communications', 'Follow-ups', 'Opportunities', 'Academic confirmations', 'Students', 'Applications', 'Interviews', 'Meeting notes', 'Templates', 'Reports'];
const blankForm = { login_id: '', full_name: '', role: 'COMMITTEE_MEMBER', password: 'utu_2026' };
const labelRole = (role: Member['role']) => role === 'SUPER_ADMIN' ? 'Super Admin / TPO' : 'Committee Member';

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [form, setForm] = useState(blankForm);
  const [editing, setEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => { setLoading(true); try { setMembers(await apiRequest<Member[]>('/members')); setError(''); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load members.'); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const createMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setSuccess('');
    try { await apiRequest<Member>('/members', { method: 'POST', body: JSON.stringify(form) }); setForm(blankForm); setShowForm(false); setSuccess('Login ID created. Share the initial password securely.'); await load(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to create Login ID.'); }
  };
  const saveMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return;
    try { const updated = await apiRequest<Member>(`/members/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ full_name: selected.fullName, role: selected.role, is_active: selected.isActive, permissions: selected.permissions }) }); setSelected(updated); setEditing(false); setSuccess('Member details and access permissions updated.'); await load(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to update member.'); }
  };
  const deleteMember = async (member: Member) => {
    if (!window.confirm(`Delete ${member.loginId} (${member.fullName})? Their login will stop working immediately.`)) return;
    try { await apiRequest(`/members/${member.id}`, { method: 'DELETE' }); setSelected(null); setSuccess(`${member.loginId} deleted.`); await load(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to delete member.'); }
  };
  const openDetails = async (member: Member) => {
    try { setSelected(await apiRequest<Member>(`/members/${member.id}`)); setEditing(false); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Unable to load member details.'); }
  };

  return <section className="module-page">
    <div className="module-header"><div><p className="eyebrow">TPO control center</p><h2>Member Login IDs</h2><p className="muted">Create accounts, open an ID for its full profile, and manage access.</p></div><button className="primary-button compact" onClick={() => setShowForm((value) => !value)}>{showForm ? 'Close form' : 'Create Login ID'}</button></div>
    {error && <div className="inline-error">{error}</div>}{success && <div className="inline-success">{success}</div>}
    {showForm && <form className="content-panel company-form" onSubmit={createMember}><div className="form-grid"><label>Login ID<input required pattern="[A-Za-z0-9_]+" placeholder="MEMBER_7" value={form.login_id} onChange={(event) => setForm({ ...form, login_id: event.target.value })} /></label><label>Full name<input required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label><label>Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="COMMITTEE_MEMBER">Committee Member</option><option value="SUPER_ADMIN">Super Admin / TPO</option></select></label><label>Initial password<input required minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label></div><button className="primary-button compact">Create Login ID</button></form>}
    <div className="content-panel company-table"><div className="panel-heading"><div><p className="eyebrow">Trusted member profiles</p><h3>{loading ? 'Loading…' : `${members.length} accounts`}</h3></div></div>{loading ? <RecordsLoadingState label="member accounts" /> : <div className="table-scroll"><table><thead><tr><th>Login ID</th><th>Record ID</th><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><button className="member-link" onClick={() => openDetails(member)}>{member.loginId}</button></td><td><code className="record-id">{member.id}</code></td><td>{member.fullName}</td><td>{labelRole(member.role)}</td><td>{member.isActive ? 'Active' : 'Inactive'}</td></tr>)}</tbody></table></div>}</div>
    {selected && <div className="member-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="member-detail content-panel" role="dialog" aria-modal="true" aria-labelledby="member-detail-title"><div className="panel-heading"><div><p className="eyebrow">Account profile</p><h3 id="member-detail-title">{selected.loginId}</h3></div><button className="text-button" onClick={() => setSelected(null)}>Close</button></div>
      {editing ? <form onSubmit={saveMember} className="form-grid"><label>Full name<input required value={selected.fullName} onChange={(event) => setSelected({ ...selected, fullName: event.target.value })} /></label><label>Role<select value={selected.role} onChange={(event) => setSelected({ ...selected, role: event.target.value as Member['role'] })}><option value="COMMITTEE_MEMBER">Committee Member</option><option value="SUPER_ADMIN">Super Admin / TPO</option></select></label><label>Access<select value={String(selected.isActive)} onChange={(event) => setSelected({ ...selected, isActive: event.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></label>{selected.role === 'COMMITTEE_MEMBER' && <fieldset className="permission-grid wide"><legend>Module permissions</legend><p className="muted">None hides the page and blocks its API; Read allows viewing; Edit allows create and update.</p>{permissionModules.map((module) => <label key={module}>{module}<select value={selected.permissions?.[module] || 'WRITE'} onChange={(event) => setSelected({ ...selected, permissions: { ...selected.permissions, [module]: event.target.value as Access } })}><option value="NONE">No access</option><option value="READ">View only</option><option value="WRITE">View and edit</option></select></label>)}</fieldset>}{selected.role === 'SUPER_ADMIN' && <p className="muted wide">Super Admin accounts always have full module access.</p>}<div className="member-actions wide"><button className="primary-button compact">Save changes</button><button type="button" className="text-button" onClick={() => { setEditing(false); void openDetails(selected); }}>Cancel</button></div></form> : <><dl className="member-facts"><div><dt>Full name</dt><dd>{selected.fullName}</dd></div><div><dt>Login ID</dt><dd>{selected.loginId}</dd></div><div><dt>Role</dt><dd>{labelRole(selected.role)}</dd></div><div><dt>Module access</dt><dd>{selected.role === 'SUPER_ADMIN' ? 'Full access' : `${permissionModules.filter((module) => selected.permissions?.[module] !== 'NONE').length} modules enabled`}</dd></div><div><dt>Access</dt><dd>{selected.isActive ? 'Active' : 'Inactive'}</dd></div><div><dt>Auth account email</dt><dd>{selected.email}</dd></div><div><dt>Appwrite user ID</dt><dd>{selected.userId}</dd></div><div><dt>Created</dt><dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'}</dd></div><div><dt>Updated</dt><dd>{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '—'}</dd></div></dl><div className="member-actions"><button className="primary-button compact" onClick={() => setEditing(true)}>Edit details</button><button className="danger-button" onClick={() => void deleteMember(selected)}>Delete Login ID</button></div></>}
    </section></div>}
  </section>;
}
