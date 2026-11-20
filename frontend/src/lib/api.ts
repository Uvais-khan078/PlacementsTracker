import { createSessionJwt, invalidateSessionJwt } from './appwrite/auth';

const backendUrl = import.meta.env.VITE_BACKEND_URL === undefined ? 'http://localhost:5000' : import.meta.env.VITE_BACKEND_URL;
const CLIENT_READ_CACHE_TTL_MS = 4000;
const CLIENT_READ_CACHE_MAX_ENTRIES = 150;
type ApiResult<T> = { data: T; meta: Record<string, unknown> };
type ReadCacheEntry = { expiresAt: number; value?: ApiResult<unknown>; pending?: Promise<ApiResult<unknown>> };
const readCache = new Map<string, ReadCacheEntry>();

export function clearApiReadCache(): void { readCache.clear(); }

if (typeof window !== 'undefined') window.addEventListener('uktech:session-changed', clearApiReadCache);

function signalBackendUnavailable(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('uktech:backend-unavailable'));
}

async function performRequest<T>(path: string, options: RequestInit, initialJwt: string): Promise<ApiResult<T>> {
  const send = (jwt: string) => fetch(`${backendUrl}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, ...(options.headers || {}) },
  });
  let response: Response;
  let jwt = initialJwt;
  try {
    response = await send(jwt);
  } catch {
    signalBackendUnavailable();
    throw new Error('The backend is unavailable. Check your connection and try again.');
  }
  if ([502, 503, 504].includes(response.status)) signalBackendUnavailable();
  if (response.status === 401) {
    invalidateSessionJwt();
    try {
      jwt = await createSessionJwt();
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Your sign-in session could not be verified. Please sign in again.');
    }
    try {
      response = await send(jwt);
    } catch {
      signalBackendUnavailable();
      throw new Error('The backend is unavailable. Check your connection and try again.');
    }
    if ([502, 503, 504].includes(response.status)) signalBackendUnavailable();
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || 'The request could not be completed.');
  return { data: body.data as T, meta: body.meta || {} };
}

async function request<T>(path: string, options: RequestInit): Promise<ApiResult<T>> {
  let jwt: string;
  try { jwt = await createSessionJwt(); }
  catch (error) { throw new Error(error instanceof Error ? error.message : 'Your sign-in session could not be verified. Please sign in again.'); }

  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET' || options.body !== undefined) {
    clearApiReadCache();
    return performRequest<T>(path, options, jwt);
  }

  // JWT is included so cached rows can never cross account or permission boundaries.
  const key = `${jwt}:${path}`;
  const cached = readCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.pending) return cached.pending as Promise<ApiResult<T>>;
    if (cached.value) return cached.value as ApiResult<T>;
  }
  readCache.delete(key);
  const pending = performRequest<T>(path, options, jwt);
  const entry: ReadCacheEntry = { expiresAt: Date.now() + CLIENT_READ_CACHE_TTL_MS, pending: pending as Promise<ApiResult<unknown>> };
  readCache.set(key, entry);
  try {
    const result = await pending;
    if (readCache.get(key) === entry) {
      entry.pending = undefined;
      entry.value = result as ApiResult<unknown>;
      entry.expiresAt = Date.now() + CLIENT_READ_CACHE_TTL_MS;
      while (readCache.size > CLIENT_READ_CACHE_MAX_ENTRIES) readCache.delete(readCache.keys().next().value as string);
    }
    return result;
  } catch (error) {
    if (readCache.get(key) === entry) readCache.delete(key);
    throw error;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await request<T>(path, options)).data;
}

export async function apiRequestWithMeta<T>(path: string, options: RequestInit = {}): Promise<{ data: T; meta: Record<string, unknown> }> {
  return request<T>(path, options);
}
