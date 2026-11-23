import { createHmac, timingSafeEqual } from 'node:crypto';

/** Small signed tokens (HMAC-SHA256) so the OAuth flow needs no database: clients, codes and sessions are self-contained. */
const SECRET = process.env.MCP_SECRET ?? '';

export const authEnabled = SECRET.length >= 32 && Boolean(process.env.AUTH_INTERNAL_KEY);

type Payload = Record<string, any>;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function sign(type: string, payload: Payload, ttlSeconds: number): string {
  const body = b64(JSON.stringify({ ...payload, t: type, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

export function verify<T extends Payload = Payload>(type: string, token: string): T | null {
  if (!SECRET) return null;
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', SECRET).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.t !== type || data.exp < Date.now() / 1000) return null;
    return data as T;
  } catch {
    return null;
  }
}
