import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { changeAccountEmail, changePassword, getCurrentUser, getTrustedProfile, hasPublicAppwriteConfig, resolveLoginId, sendEmailVerification, signIn, signOut, verifyAccountEmail } from './lib/appwrite/auth';
import type { MemberProfile, SessionState } from './types/domain';
import { apiRequest } from './lib/api';
const CompaniesPage = lazy(() => import('./features/companies/CompaniesPage'));
const LeadsPage = lazy(() => import('./features/leads/LeadsPage'));
const MembersPage = lazy(() => import('./features/members/MembersPage'));
const TemplatesPage = lazy(() => import('./features/templates/TemplatesPage'));
const MeetingNotesPage = lazy(() => import('./features/meeting-notes/MeetingNotesPage'));
const SourceArchivePage = lazy(() => import('./features/source-archive/SourceArchivePage'));
const ContactsPage = lazy(() => import('./features/contacts/ContactsPage'));
const CommunicationsPage = lazy(() => import('./features/communications/CommunicationsPage'));
const FollowupsPage = lazy(() => import('./features/followups/FollowupsPage'));
const OpportunitiesPage = lazy(() => import('./features/opportunities/OpportunitiesPage'));
const StudentsPage = lazy(() => import('./features/students/StudentsPage'));
const AcademicConfirmationsPage = lazy(() => import('./features/confirmations/AcademicConfirmationsPage'));
const ApplicationsPage = lazy(() => import('./features/applications/ApplicationsPage'));
const InterviewsPage = lazy(() => import('./features/interviews/InterviewsPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const AuditPage = lazy(() => import('./features/audit/AuditPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
import { BackendUnavailableScreen, DashboardLoadingScreen, ModuleLoadingScreen, NotFoundScreen } from './features/system/SystemScreens';

const navigation = ['Dashboard', 'Companies', 'Leads', 'Contacts', 'Communications', 'Follow-ups', 'Opportunities', 'Academic confirmations', 'Students', 'Applications', 'Interviews', 'Meeting notes', 'Templates', 'Reports'];
const navAbbreviations: Record<string, string> = { Dashboard: 'Db', Companies: 'Co', Leads: 'Le', Contacts: 'Ct', Communications: 'Cm', 'Follow-ups': 'Fu', Opportunities: 'Op', 'Academic confirmations': 'Ac', Students: 'St', Applications: 'Ap', Interviews: 'In', 'Meeting notes': 'Mn', Templates: 'Te', Reports: 'Re' };
function navShort(page: string) { return navAbbreviations[page] || page.slice(0, 2); }

export default function App() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [activePage, setActivePage] = useState('Dashboard');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [editingPassword, setEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [searchSelection, setSearchSelection] = useState<{ page: string; id: string } | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const isSuperAdmin = session.status === 'signed-in' && session.profile?.role === 'SUPER_ADMIN';
  const allowedNavigation = navigation.filter((item) => isSuperAdmin || session.status !== 'signed-in' || session.profile?.permissions?.[item] !== 'NONE');
  const administrationPages = ['Members', 'Audit history', 'Source archive', 'Settings'];
  const visiblePage = isSuperAdmin && administrationPages.includes(activePage) ? activePage : allowedNavigation.includes(activePage) ? activePage : allowedNavigation[0] || 'Dashboard';
  const visibleAccess = isSuperAdmin ? 'WRITE' : session.status === 'signed-in' ? session.profile?.permissions?.[visiblePage] || 'WRITE' : 'WRITE';

  useEffect(() => {
    getCurrentUser().then(async (user) => {
      if (!user) {
        setSession({ status: 'signed-out' });
        return;
      }
      try {
        const profile = await getTrustedProfile();
        setSession({ status: 'signed-in', userEmail: user.email, profile, profileStatus: 'pending' });
      } catch (profileError) {
        await signOut().catch(() => undefined);
        setError(profileError instanceof Error ? profileError.message : 'Account profile verification failed.');
        setSession({ status: 'signed-out' });
      }
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId'); const secret = params.get('secret');
    if (!userId || !secret) return;
    verifyAccountEmail(userId, secret).then(() => {
      setEmailMessage('Your new email address is verified.');
      params.delete('userId'); params.delete('secret'); params.delete('email_verification');
      const query = params.toString(); window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }).catch((verificationError) => setEmailMessage(verificationError instanceof Error ? verificationError.message : 'Email verification could not be completed.'));
  }, []);

  useEffect(() => {
    const onBackendUnavailable = () => setBackendUnavailable(true);
    window.addEventListener('uktech:backend-unavailable', onBackendUnavailable);
    let active = true;
    const backendUrl = import.meta.env.VITE_BACKEND_URL === undefined ? 'http://localhost:5000' : import.meta.env.VITE_BACKEND_URL;
    fetch(`${backendUrl}/api/status`, { cache: 'no-store' }).then((response) => {
      if (active && !response.ok) onBackendUnavailable();
    }).catch(() => { if (active) onBackendUnavailable(); });
    return () => { active = false; window.removeEventListener('uktech:backend-unavailable', onBackendUnavailable); };
  }, []);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const email = await resolveLoginId(loginId.trim());
      const user = await signIn(email, password);
      const profile = await getTrustedProfile();
      setSession({ status: 'signed-in', userEmail: user.email, profile, profileStatus: 'pending' });
      setPassword('');
    } catch (signInError) {
      await signOut().catch(() => undefined);
      setError(signInError instanceof Error ? signInError.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setSession({ status: 'signed-out' });
  };

  const handleProfileSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (session.status !== 'signed-in' || !session.profile || !profileName.trim()) return;
    setBusy(true); setProfileMessage('');
    try {
      const profile = await apiRequest<MemberProfile>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ full_name: profileName.trim() }) });
      setSession({ status: 'signed-in', userEmail: session.userEmail, profile, profileStatus: session.profileStatus }); setEditingProfile(false); setShowProfile(true);
    } catch (profileError) { setProfileMessage(profileError instanceof Error ? profileError.message : 'Unable to update profile.'); }
    finally { setBusy(false); }
  };

  const handleEmailSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setEmailMessage('');
    if (session.status !== 'signed-in' || !session.profile) return;
    if (emailDraft.trim().toLowerCase() === session.profile.email.toLowerCase()) { setEmailMessage('Enter a different email address.'); return; }
    setBusy(true); setError('');
    try {
      const updatedEmail = await changeAccountEmail(emailDraft, emailPassword);
      const updatedProfile = await apiRequest<typeof session.profile>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ email: updatedEmail }) });
      setSession({ ...session, userEmail: updatedEmail, profile: updatedProfile });
      setEmailPassword(''); setEditingEmail(false);
      try {
        await sendEmailVerification(`${window.location.origin}/?email_verification=1`);
        setEmailMessage(`Verification link sent to ${updatedEmail}. Your Login ID stays the same.`);
      } catch {
        setEmailMessage(`Email saved as ${updatedEmail}, but the verification email could not be sent. Try again later or contact the TPO.`);
      }
    } catch (emailError) {
      setEmailMessage(emailError instanceof Error ? emailError.message : 'Unable to update email.');
    } finally { setBusy(false); }
  };

  const handlePasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setPasswordMessage('');
    if (newPassword.length < 8) { setPasswordMessage('Use at least 8 characters for the new password.'); return; }
    if (newPassword !== confirmPassword) { setPasswordMessage('The new passwords do not match.'); return; }
    setBusy(true);
    try { await changePassword(currentPassword, newPassword); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordMessage('Password updated.'); setEditingPassword(false); }
    catch (e) { setPasswordMessage(e instanceof Error ? e.message : 'Unable to change password.'); }
    finally { setBusy(false); }
  };

  if (!['/', '/index.html'].includes(window.location.pathname)) return <NotFoundScreen />;
  if (backendUnavailable) return <BackendUnavailableScreen />;
  if (session.status === 'loading') return <div className="app-loading-screen"><div className="loading-orbit"><span /></div><div><p className="eyebrow">UKTech T&amp;P</p><strong>Connecting securely</strong><span>Checking your account and placement workspace…</span></div></div>;
  if (session.status === 'signed-out') {
    return <LoginScreen loginId={loginId} password={password} error={error} busy={busy} onLoginIdChange={setLoginId} onPasswordChange={setPassword} onSubmit={handleSignIn} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">UT</div><div><strong>UKTech T&amp;P</strong><span>Central placement desk</span></div></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {allowedNavigation.map((item) => <button className={visiblePage === item ? 'nav-item active' : 'nav-item'} data-short={navShort(item)} title={item} key={item} onClick={() => setActivePage(item)}>{item}</button>)}
      {session.profile?.role === 'SUPER_ADMIN' && <><p className="nav-label nav-admin-label">Administration</p><button className={activePage === 'Members' ? 'nav-item active' : 'nav-item'} data-short="ID" title="Member IDs" onClick={() => setActivePage('Members')}>Member IDs</button><button className={activePage === 'Settings' ? 'nav-item active' : 'nav-item'} data-short="Se" title="Settings" onClick={() => setActivePage('Settings')}><span>⚙</span><span>Settings</span></button><button className={activePage === 'Audit history' ? 'nav-item active' : 'nav-item'} data-short="Au" title="Audit history" onClick={() => setActivePage('Audit history')}>Audit history</button><button className={activePage === 'Source archive' ? 'nav-item active' : 'nav-item'} data-short="Sa" title="Legacy source archive" onClick={() => setActivePage('Source archive')}>Legacy source archive</button></>}
        </nav>
        <div className="sidebar-footer"><span className="secure-dot" />Authenticated workspace</div>
      </aside>
      <main className={`workspace access-${visibleAccess.toLowerCase()}`}>
        <header className="topbar"><div><p className="eyebrow">VMSB Uttarakhand Technical University</p><h1>{visiblePage}</h1></div><div className="user-area"><GlobalSearch onSelect={(page, id) => { setSearchSelection({ page, id }); setActivePage(page); }} /><NotificationCenter onNavigate={setActivePage} /><button className="profile-trigger" onClick={() => { setShowProfile((value) => !value); setProfileName(session.profile?.fullName || ''); }}><div className="avatar">{session.profile?.fullName.slice(0, 1).toUpperCase() || 'U'}</div><div><strong>{session.profile?.fullName || 'Account'}</strong><span>{session.profile?.role === 'SUPER_ADMIN' ? 'Super Admin / TPO' : 'Committee Member'}</span></div></button><button className="text-button" onClick={handleSignOut}>Sign out</button>{showProfile && <div className="profile-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowProfile(false); }}><section className="profile-popover content-panel" role="dialog" aria-modal="true" aria-labelledby="profile-title"><div className="profile-modal-heading"><div><p className="eyebrow">Account settings</p><h2 id="profile-title">My profile</h2><p>Manage your account details and sign-in security.</p></div><button className="profile-close" aria-label="Close profile" onClick={() => setShowProfile(false)}>×</button></div><div className="profile-modal-content">{editingPassword ? <form onSubmit={handlePasswordChange}><label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required /></label><label>New password<input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required /></label><label>Confirm new password<input type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required /></label>{passwordMessage && <span className="profile-message">{passwordMessage}</span>}<div className="member-actions"><button className="primary-button compact" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button><button type="button" className="text-button" onClick={() => { setEditingPassword(false); setPasswordMessage(''); }}>Cancel</button></div></form> : editingEmail ? <form onSubmit={handleEmailSave} className="email-edit-form"><p className="muted">Your Login ID stays the same. Your current password is required to change the sign-in email.</p><label>New email address<input type="email" value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} autoComplete="email" required /></label><label>Current password<input type="password" value={emailPassword} onChange={(event) => setEmailPassword(event.target.value)} autoComplete="current-password" required /></label>{emailMessage && <span className="profile-message" role="status">{emailMessage}</span>}<div className="member-actions"><button className="primary-button compact" disabled={busy}>{busy ? 'Updating...' : 'Update email'}</button><button type="button" className="text-button" onClick={() => { setEditingEmail(false); setEmailPassword(''); }}>Cancel</button></div></form> : editingProfile ? <form onSubmit={handleProfileSave}>{profileMessage && <span className="profile-message profile-message-error" role="alert">{profileMessage}</span>}<label>Full name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} required /></label><div className="member-actions"><button className="primary-button compact" disabled={busy}>{busy ? 'Saving...' : 'Save profile'}</button><button type="button" className="text-button" onClick={() => setEditingProfile(false)}>Cancel</button></div></form> : <><div className="profile-identity"><div className="profile-avatar">{session.profile?.fullName.slice(0, 1).toUpperCase() || 'U'}</div><div><strong>{session.profile?.fullName}</strong><span>{session.profile?.role === 'SUPER_ADMIN' ? 'Super Admin / TPO' : 'Committee Member'}</span></div><b className={session.profile?.isActive ? 'profile-status active' : 'profile-status'}>{session.profile?.isActive ? 'Active' : 'Inactive'}</b></div><dl className="profile-facts"><div><dt>Login ID</dt><dd>{session.profile?.loginId}</dd></div><div><dt>Email</dt><dd className="profile-email-value">{session.profile?.email}<button type="button" className="profile-inline-edit" onClick={() => { setEmailDraft(session.profile?.email || ''); setEmailPassword(''); setEmailMessage(''); setEditingEmail(true); setEditingProfile(false); setEditingPassword(false); }}>Edit</button></dd></div><div><dt>Role</dt><dd>{session.profile?.role === 'SUPER_ADMIN' ? 'Super Admin / TPO' : 'Committee Member'}</dd></div></dl>{passwordMessage && <span className="profile-message">{passwordMessage}</span>}{emailMessage && <span className="profile-message" role="status">{emailMessage}</span>}<div className="profile-actions"><button className="primary-button compact" onClick={() => { setEditingProfile(true); setProfileName(session.profile?.fullName || ''); setProfileMessage(''); setEditingEmail(false); setEditingPassword(false); }}>Edit profile</button><button className="secondary-button compact" onClick={() => { setEditingPassword(true); setEditingProfile(false); setPasswordMessage(''); }}>Change password</button></div></>}</div></section></div>}</div></header>
        {visibleAccess === 'READ' && <div className="inline-warning">This module is view only for your account. Changes are blocked by the server.</div>}
        <Suspense fallback={<ModuleLoadingScreen />}>
        {visiblePage === 'Dashboard' ? <Dashboard onNavigate={setActivePage} isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} /> : visiblePage === 'Companies' ? <CompaniesPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} initialRecordId={searchSelection?.page === 'Companies' ? searchSelection.id : undefined} onSearchTargetHandled={() => setSearchSelection(null)} /> : visiblePage === 'Leads' ? <LeadsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} initialRecordId={searchSelection?.page === 'Leads' ? searchSelection.id : undefined} onSearchTargetHandled={() => setSearchSelection(null)} /> : visiblePage === 'Contacts' ? <ContactsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} initialRecordId={searchSelection?.page === 'Contacts' ? searchSelection.id : undefined} onSearchTargetHandled={() => setSearchSelection(null)} /> : visiblePage === 'Communications' ? <CommunicationsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} /> : visiblePage === 'Follow-ups' ? <FollowupsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} /> : visiblePage === 'Opportunities' ? <OpportunitiesPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} initialRecordId={searchSelection?.page === 'Opportunities' ? searchSelection.id : undefined} onSearchTargetHandled={() => setSearchSelection(null)} /> : visiblePage === 'Academic confirmations' ? <AcademicConfirmationsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} /> : visiblePage === 'Students' ? <StudentsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} initialRecordId={searchSelection?.page === 'Students' ? searchSelection.id : undefined} onSearchTargetHandled={() => setSearchSelection(null)} /> : visiblePage === 'Applications' ? <ApplicationsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} onNavigate={setActivePage} initialRecordId={searchSelection?.page === 'Applications' ? searchSelection.id : undefined} onSearchTargetHandled={() => setSearchSelection(null)} /> : visiblePage === 'Interviews' ? <InterviewsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} /> : visiblePage === 'Meeting notes' ? <MeetingNotesPage /> : visiblePage === 'Source archive' ? <SourceArchivePage /> : visiblePage === 'Members' ? <MembersPage /> : visiblePage === 'Audit history' ? <AuditPage /> : visiblePage === 'Settings' ? <SettingsPage /> : visiblePage === 'Templates' ? <TemplatesPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} /> : visiblePage === 'Reports' ? <ReportsPage isSuperAdmin={session.profile?.role === 'SUPER_ADMIN'} /> : <section className="empty-page"><span className="eyebrow">Workspace</span><h2>{visiblePage}</h2><p>This section is not available in this build.</p></section>}
        </Suspense>
      </main>
    </div>
  );
}

function LoginScreen({ loginId, password, error, busy, onLoginIdChange, onPasswordChange, onSubmit }: { loginId: string; password: string; error: string; busy: boolean; onLoginIdChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <main className="login-screen"><div className="login-art"><p className="eyebrow">Internal operations workspace</p><h1>From first contact to final selection.</h1><p>One trusted system for the Central Training &amp; Placement Committee.</p><div className="login-rule"><span />Company discovery · outreach · recruitment</div></div><section className="login-card"><div className="brand"><div className="brand-mark">UT</div><div><strong>UKTech T&amp;P</strong><span>VMSB Uttarakhand Technical University</span></div></div><div className="login-copy"><p className="eyebrow">Welcome back</p><h2>Sign in to continue</h2><p>Use the Login ID created by the TPO. Public registration is disabled.</p></div>{!hasPublicAppwriteConfig() && <div className="inline-warning">Appwrite public configuration is missing. Create `frontend/.env.local` from `.env.example` before signing in.</div>}{error && <div className="inline-error">{error}</div>}<form onSubmit={onSubmit}><label>Login ID<input value={loginId} onChange={(event) => onLoginIdChange(event.target.value)} autoComplete="username" placeholder="TPO_UTU or MEMBER_1" required /></label><label>Password<input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete="current-password" required /></label><button className="primary-button" disabled={busy || !hasPublicAppwriteConfig()}>{busy ? 'Signing in...' : 'Sign in'}</button></form><small>Access is controlled by Appwrite Auth and the trusted member profile.</small></section></main>;
}

type SearchResult = { id: string; type: string; title: string; subtitle: string; page: string };

function GlobalSearch({ onSelect }: { onSelect: (page: string, id: string) => void }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<SearchResult[]>([]); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); setBusy(false); setError(''); return; }
    setBusy(true); setError('');
    let active = true;
    const timer = window.setTimeout(() => { apiRequest<SearchResult[]>(`/search?q=${encodeURIComponent(term)}`).then((rows) => { if (active) setResults(rows); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Search failed.'); }).finally(() => { if (active) setBusy(false); }); }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);
  return <div className="global-search"><input value={query} aria-label="Search companies, contacts, students or opportunities" placeholder="Search…" onFocus={() => setOpen(true)} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />{open && query.trim().length >= 2 && <div className="global-search-results">{busy ? <p>Searching records...</p> : error ? <p>{error}</p> : results.length ? results.map((result) => <button key={`${result.type}:${result.id}`} onClick={() => { onSelect(result.page, result.id); setOpen(false); }}><strong>{result.title}</strong><span>{result.type} · {result.subtitle || 'Record'}</span></button>) : <p>No matching records.</p>}<button className="search-close" onClick={() => setOpen(false)}>Close</button></div>}</div>;
}

type NotificationItem = { id: string; type: string; title: string; summary: string; context?: string; due_at: string; page: string; read: boolean };

function NotificationCenter({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]); const [open, setOpen] = useState(false); const [error, setError] = useState(''); const loadSequence = useRef(0);
  const load = () => { const sequence = ++loadSequence.current; apiRequest<NotificationItem[]>('/notifications').then((rows) => { if (sequence === loadSequence.current) { setItems(rows); setError(''); } }).catch((e) => { if (sequence === loadSequence.current) setError(e instanceof Error ? e.message : 'Unable to load reminders.'); }); };
  useEffect(() => { load(); const timer = window.setInterval(load, 5 * 60 * 1000); return () => window.clearInterval(timer); }, []);
  const unread = items.filter((item) => !item.read).length;
  const markRead = async (id: string) => { try { await apiRequest('/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [id] }) }); setItems((current) => current.map((item) => item.id === id ? { ...item, read: true } : item)); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to mark reminder read.'); } };
  const markAll = async () => { const ids = items.filter((item) => !item.read).map((item) => item.id); if (!ids.length) return; try { await apiRequest('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }); setItems((current) => current.map((item) => ({ ...item, read: true }))); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to mark reminders read.'); } };
  return <div className="notification-center"><button className="notification-button" aria-label={`Notifications, ${unread} unread`} onClick={() => { setOpen((value) => !value); if (!open) load(); }}>♢{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}</button>{open && <div className="notification-popover"><div className="notification-heading"><strong>Reminders</strong><div><button className="text-button" onClick={load}>Refresh</button><button className="text-button" onClick={() => void markAll()} disabled={!unread}>Mark all read</button></div></div>{error && <div className="notification-error"><p className="inline-error">{error}</p><button className="text-button" onClick={load}>Try again</button></div>}{!error && items.length === 0 ? <p className="muted notification-empty">No pending reminders due this week.</p> : !error && <div className="notification-list">{items.map((item) => <button key={item.id} className={`notification-item ${item.read ? 'read' : ''}`} onClick={() => { void markRead(item.id); onNavigate(item.page); setOpen(false); }}><strong>{item.title}</strong><span>{item.summary}</span>{item.context && <small>{item.context}</small>}<small>{item.due_at ? new Date(item.due_at).toLocaleString() : ''}</small></button>)}</div>}</div>}</div>;
}

type DashboardData = { generated_at: string; metrics: { label: string; count: number; page: string; help: string }[]; lead_statuses: Record<string, number>; opportunity_statuses: Record<string, number>; outreach_channels: Record<string, number>; organization_categories: Record<string, number>; awaiting_replies: { id: string; company_name: string; subject: string; occurred_at: string }[]; recent_activity: { id: string; actor: string; action: string; entity: string; occurred_at: string; changed_fields: string[] }[] };
type DashboardMember = { userId: string; loginId: string; fullName: string; isActive: boolean };
function Dashboard({ onNavigate, isSuperAdmin }: { onNavigate: (page: string) => void; isSuperAdmin: boolean }) {
  const [scope, setScope] = useState<'all' | 'mine'>('all'); const [memberId, setMemberId] = useState(''); const [members, setMembers] = useState<DashboardMember[]>([]); const [data, setData] = useState<DashboardData | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);
  const load = () => { const sequence = ++loadSequence.current; setLoading(true); setError(''); const params = new URLSearchParams({ scope }); if (memberId) params.set('member_id', memberId); apiRequest<DashboardData>(`/dashboard?${params.toString()}`).then((next) => { if (sequence === loadSequence.current) setData(next); }).catch((e) => { if (sequence === loadSequence.current) setError(e instanceof Error ? e.message : 'Unable to load dashboard metrics.'); }).finally(() => { if (sequence === loadSequence.current) setLoading(false); }); };
  useEffect(() => { load(); }, [scope, memberId]);
  useEffect(() => { if (isSuperAdmin) apiRequest<DashboardMember[]>('/members').then((rows) => setMembers(rows.filter((row) => row.isActive))).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load members.')); }, [isSuperAdmin]);
  if (loading && !data) return <DashboardLoadingScreen />;
  if (!data) return <section className="content-panel dashboard-load-error"><p className="eyebrow">Dashboard data</p><h2>Couldn’t load placement activity</h2><p className="muted">{error || 'The dashboard response was empty.'}</p><button className="primary-button compact" onClick={load}>Try loading again</button></section>;
  const organizationMix = (values: Record<string, number>) => { const palette:Record<string,string>={PRIVATE:'#0e7490',GOVERNMENT:'#1d4ed8',OTHER:'#f59e0b',UNSPECIFIED:'#cbd5e1'};const entries=Object.entries(values).sort((a,b)=>b[1]-a[1]);const total=entries.reduce((sum,[,count])=>sum+count,0);let cursor=0;const segments=entries.map(([label,count])=>{const start=cursor;cursor+=total?count/total*100:0;return `${palette[label]||'#64748b'} ${start}% ${cursor}%`;}).join(',');return <article className="content-panel dashboard-breakdown organization-mix"><div className="panel-heading"><div><p className="eyebrow">Employer directory</p><h3>Private &amp; government</h3></div><button className="text-button" onClick={()=>onNavigate('Companies')}>Open</button></div>{total?<div className="organization-chart"><div className="organization-donut" style={{background:`conic-gradient(${segments})`}}><div><strong>{total.toLocaleString()}</strong><small>companies</small></div></div><ul>{entries.map(([label,count])=><li key={label}><i style={{background:palette[label]||'#64748b'}}/><span>{label.replaceAll('_',' ')}</span><strong>{count.toLocaleString()}</strong></li>)}</ul></div>:<p className="muted dashboard-empty">No organization categories yet.</p>}</article>;};
  const bars = (title: string, values: Record<string, number>, page: string) => { const entries = Object.entries(values).sort((a, b) => b[1] - a[1]); const max = Math.max(1, ...entries.map(([, count]) => count)); return <article className="content-panel dashboard-breakdown"><div className="panel-heading"><div><p className="eyebrow">Placement activity</p><h3>{title}</h3></div><button className="text-button" onClick={() => onNavigate(page)}>Open</button></div>{entries.length ? entries.map(([label, count]) => <button className="dashboard-bar-row" key={label} onClick={() => onNavigate(page)} title={`Open ${page}`}><span>{label.replaceAll('_', ' ')}</span><i><b style={{ width: `${Math.max(4, count / max * 100)}%` }} /></i><strong>{count}</strong></button>) : <p className="muted dashboard-empty">No records yet.</p>}</article>; };
  return <><section className="page-intro"><div><p className="eyebrow">Operational overview</p><h2>Placement activity at a glance</h2><p>Live metrics from the authenticated Appwrite database. {data ? `Updated ${new Date(data.generated_at).toLocaleString()}.` : ''}</p></div><div className="dashboard-controls"><div className="scope-toggle"><button className={scope === 'all' ? 'selected' : ''} onClick={() => { setScope('all'); setMemberId(''); }}>All Records</button><button className={scope === 'mine' ? 'selected' : ''} onClick={() => { setScope('mine'); setMemberId(''); }}>My Records</button></div>{isSuperAdmin && <select aria-label="Filter dashboard by member" value={memberId} onChange={(event) => { setScope('all'); setMemberId(event.target.value); }}><option value="">All members</option>{members.map((item) => <option key={item.userId} value={item.userId}>{item.loginId} · {item.fullName}</option>)}</select>}<button className="text-button" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button></div></section>{error && <div className="inline-error">{error}</div>}<section className="metric-grid dashboard-metrics">{data?.metrics.map((metric) => <button className="metric-card dashboard-metric" key={metric.label} onClick={() => onNavigate(metric.page)} title={metric.help}><span>{metric.label}</span><strong>{metric.count.toLocaleString()}</strong><small>{metric.help}</small></button>)}</section>{loading && !data && <div className="empty-state"><strong>Loading placement metrics…</strong></div>}<section className="dashboard-grid">{bars('Lead pipeline', data?.lead_statuses || {}, 'Leads')}{bars('Recruitment pipeline', data?.opportunity_statuses || {}, 'Opportunities')}{bars('Outreach by channel', data?.outreach_channels || {}, 'Communications')}{organizationMix(data?.organization_categories || {})}<article className="content-panel"><div className="panel-heading"><div><p className="eyebrow">Today’s action queue</p><h3>Follow-ups due</h3></div><button className="text-button" onClick={() => onNavigate('Follow-ups')}>Open follow-ups</button></div><p className="dashboard-action-count">{data?.metrics.find((metric) => metric.label === 'Follow-ups due')?.count ?? '…'}</p><p className="muted">Pending tasks due today or overdue (Asia/Kolkata).</p></article><article className="content-panel"><div className="panel-heading"><div><p className="eyebrow">Recruitment progress</p><h3>Student outcomes</h3></div><button className="text-button" onClick={() => onNavigate('Applications')}>Open applications</button></div><p className="dashboard-action-count">{data?.metrics.find((metric) => metric.label === 'Selected students')?.count ?? '…'}</p><p className="muted">Distinct students with at least one selected application.</p></article><article className="content-panel"><div className="panel-heading"><div><p className="eyebrow">Response queue</p><h3>Replies awaiting response</h3></div><button className="text-button" onClick={() => onNavigate('Communications')}>Open communications</button></div>{data?.awaiting_replies.length ? <ul>{data.awaiting_replies.map((item) => <li key={item.id}><strong>{item.company_name}</strong> · {item.subject}<small>{new Date(item.occurred_at).toLocaleString()}</small></li>)}</ul> : <p className="muted">No inbound replies are waiting for a linked response.</p>}</article><article className="content-panel"><div className="panel-heading"><div><p className="eyebrow">Audit activity</p><h3>{isSuperAdmin ? 'Recent team activity' : 'My recent activity'}</h3></div>{isSuperAdmin && <button className="text-button" onClick={() => onNavigate('Audit history')}>Open audit history</button>}</div>{data?.recent_activity.length ? <ul>{data.recent_activity.map((item) => <li key={item.id}><strong>{item.actor}</strong> · {item.action} {item.entity}<small>{new Date(item.occurred_at).toLocaleString()} · {item.changed_fields.join(', ')}</small></li>)}</ul> : <p className="muted">No recent activity.</p>}</article></section></>;
}
