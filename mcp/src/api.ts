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
