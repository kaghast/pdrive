import { getFirebaseIdToken, getGoogleAccessToken } from './firebase';

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const idToken = await getFirebaseIdToken();
  if (!idToken) {
    throw new Error('Authentication required.');
  }

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${idToken}`);

  const googleToken = getGoogleAccessToken();
  if (googleToken) {
    headers.set('X-Google-Access-Token', googleToken);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMsg = `Request failed (${res.status})`;
    let payload: any = null;
    try {
      payload = await res.json();
      if (payload?.error) errMsg = payload.error;
    } catch {
      // ignore
    }
    const error = new Error(errMsg) as Error & { status?: number; payload?: any };
    error.status = res.status;
    error.payload = payload;
    throw error;
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.blob()) as unknown as T;
}
