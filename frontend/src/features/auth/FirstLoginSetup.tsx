import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api';
import { signIn, signOut } from '../../lib/appwrite/auth';
import type { MemberProfile } from '../../types/domain';

type Props = {
  profile: MemberProfile;
  onSignOut: () => void;
};

export default function FirstLoginSetup({ profile, onSignOut }: Props) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(profile.email.endsWith('@accounts.uktech.local') ? '' : profile.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('Use a new password with at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('The new passwords do not match.'); return; }
    if (newPassword === currentPassword) { setError('Choose a new password different from your temporary password.'); return; }
    setBusy(true);
    try {
      await apiRequest<MemberProfile>('/auth/complete-first-login', {
        method: 'POST',
        body: JSON.stringify({ full_name: fullName.trim(), email: email.trim(), current_password: currentPassword, new_password: newPassword }),
      });
      // Updating the password through Appwrite's admin API can invalidate the
      // session/JWT created during the initial sign-in. Replace it before any
      // workspace request is made so the new JWT retains the account scope.
      await signOut().catch(() => undefined);
      await signIn(email.trim(), newPassword);
      // Reboot the SDK and request cache with the persisted replacement session.
      // Keeping the old React tree alive can retain a guest-scoped token after
      // Appwrite has revoked the temporary-password session.
      window.location.replace('/');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not secure your account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="first-login-screen">
    <section className="first-login-art">
      <img src="/utulogo.png" alt="VMSB Uttarakhand Technical University" />
      <p className="eyebrow">UKTech T&amp;P · Account security</p>
      <h1>Make this account yours.</h1>
      <p>Set your personal details before entering the placement workspace. This one-time step protects your account and keeps your Login ID unchanged.</p>
      <div className="login-rule"><span /> First sign-in security check</div>
    </section>
    <section className="first-login-panel">
      <div className="first-login-card">
        <p className="eyebrow">Welcome, {profile.loginId}</p>
        <h2>Secure your account</h2>
        <p className="muted">For security reasons, update your name, email address and temporary password to continue.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>Full name<input autoComplete="name" maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)} required /></label>
          <label>Personal or university email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>Temporary password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? 'Securing your account…' : 'Save details and continue'}</button>
        </form>
        <button className="text-button first-login-signout" type="button" onClick={onSignOut}>Sign out</button>
      </div>
    </section>
  </main>;
}
