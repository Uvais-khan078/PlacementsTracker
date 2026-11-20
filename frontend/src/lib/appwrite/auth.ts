import { Account, ID, Models } from 'appwrite';
import { appwriteClient } from './client';

const account = new Account(appwriteClient);
let cachedSessionJwt = '';
let cachedSessionJwtExpiresAt = 0;
let sessionJwtPromise: Promise<string> | null = null;
let sessionGeneration = 0;

export function invalidateSessionJwt(): void {
  sessionGeneration += 1;
  cachedSessionJwt = '';
  cachedSessionJwtExpiresAt = 0;
  sessionJwtPromise = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('uktech:session-changed'));
}

function signalBackendProblem(status?: number): void {
  if (status !== undefined && status < 500) return;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('uktech:backend-unavailable'));
}

export type AuthUser = Models.User<Models.Preferences>;

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    return await account.get();
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  invalidateSessionJwt();
  await account.createEmailPasswordSession(email, password);
  return account.get();
}

export async function resolveLoginId(loginId: string): Promise<string> {
  const backendUrl = import.meta.env.VITE_BACKEND_URL === undefined ? 'http://localhost:5000' : import.meta.env.VITE_BACKEND_URL;
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/api/auth/login-target`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login_id: loginId }),
    });
  } catch (error) { signalBackendProblem(); throw error; }
  signalBackendProblem(response.status);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Invalid Login ID or password.');
  return body.data.email;
}

export async function signOut(): Promise<void> {
  invalidateSessionJwt();
  await account.deleteSession('current');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await account.updatePassword(newPassword, currentPassword);
  invalidateSessionJwt();
}

export async function changeAccountEmail(email: string, currentPassword: string): Promise<string> {
  const user = await account.updateEmail(email.trim().toLowerCase(), currentPassword);
  invalidateSessionJwt();
  return user.email;
}

export async function sendEmailVerification(url: string): Promise<void> {
  await account.createVerification(url);
}

export async function verifyAccountEmail(userId: string, secret: string): Promise<void> {
  await account.updateVerification(userId, secret);
  invalidateSessionJwt();
}

export async function createSessionJwt(): Promise<string> {
  if (cachedSessionJwt && cachedSessionJwtExpiresAt > Date.now()) return cachedSessionJwt;
  if (sessionJwtPromise) return sessionJwtPromise;
  const generation = sessionGeneration;
  sessionJwtPromise = account.createJWT().then((result) => {
    if (generation === sessionGeneration) {
      cachedSessionJwt = result.jwt;
      // Appwrite JWTs expire after a short interval; refresh well before that boundary.
      cachedSessionJwtExpiresAt = Date.now() + 10 * 60 * 1000;
    }
    return result.jwt;
  }).finally(() => { if (generation === sessionGeneration) sessionJwtPromise = null; });
  return sessionJwtPromise;
}

export async function getTrustedProfile(): Promise<{ userId: string; loginId: string; fullName: string; email: string; role: 'SUPER_ADMIN' | 'COMMITTEE_MEMBER'; isActive: boolean; permissions: Record<string, 'NONE' | 'READ' | 'WRITE'> }> {
  const jwt = await createSessionJwt();
  const backendUrl = import.meta.env.VITE_BACKEND_URL === undefined ? 'http://localhost:5000' : import.meta.env.VITE_BACKEND_URL;
  let response: Response;
  try { response = await fetch(`${backendUrl}/api/auth/profile`, { headers: { Authorization: `Bearer ${jwt}` } }); }
  catch (error) { signalBackendProblem(); throw error; }
  signalBackendProblem(response.status);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'Unable to load your trusted member profile.');
  return body.data;
}

export function hasPublicAppwriteConfig(): boolean {
  return Boolean(import.meta.env.VITE_APPWRITE_ENDPOINT && import.meta.env.VITE_APPWRITE_PROJECT_ID);
}

export function createLocalAccountId(): string {
  return ID.unique();
}
