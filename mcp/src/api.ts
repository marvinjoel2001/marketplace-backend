/** Cliente de solo lectura del API público del marketplace. */
export const API_URL = (process.env.MARKETPLACE_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
export const WEB_URL = (process.env.MARKETPLACE_WEB_URL || 'http://localhost:3001').replace(/\/$/, '');

export async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`El marketplace respondió ${res.status} en ${path.split('?')[0]}`);
  return (await res.json()) as T;
}

const INTERNAL_KEY = process.env.AUTH_INTERNAL_KEY?.trim();

/** Calls the API as one signed-in user: the backend trusts `x-user-id` only together with the internal key. */
export async function asUser<T = unknown>(userId: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-user-id': userId,
      ...(INTERNAL_KEY ? { 'x-internal-key': INTERNAL_KEY } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    throw new Error(msg || `El marketplace respondió ${res.status}`);
  }
  return data as T;
}

/** Calls an endpoint reserved for the web server (phone codes), not tied to a user yet. */
export async function asServer<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(INTERNAL_KEY ? { 'x-internal-key': INTERNAL_KEY } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    throw new Error(msg || `El marketplace respondió ${res.status}`);
  }
  return data as T;
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
