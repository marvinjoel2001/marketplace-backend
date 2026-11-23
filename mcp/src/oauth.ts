import { randomUUID } from 'node:crypto';
import express, { type Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { asServer } from './api.js';
import { sign, verify } from './tokens.js';

const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const SCOPE = 'vitrina';

/** Authorization codes already exchanged (one instance; codes live 5 minutes). */
const usedCodes = new Map<string, number>();
function markUsed(jti: string, exp: number) {
  const now = Date.now() / 1000;
  for (const [k, v] of usedCodes) if (v < now) usedCodes.delete(k);
  if (usedCodes.has(jti)) return false;
  usedCodes.set(jti, exp);
  return true;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(body: string, status = 200) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar a Vitrina Market</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;padding:16px}
main{width:100%;max-width:400px;padding:28px;border:1px solid #e2e8f0;border-radius:24px;box-shadow:0 10px 40px rgba(30,20,90,.08)}
h1{font-size:1.4rem;margin:0 0 6px;letter-spacing:-.02em}p{margin:0 0 16px;color:#475569;font-size:.95rem}
label{display:block;font-weight:700;font-size:.9rem;margin-bottom:6px}
input{width:100%;font:inherit;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;margin-bottom:14px}input:focus{outline:3px solid #c7d2fe;border-color:#5b4df0}
button{width:100%;font:inherit;font-weight:700;padding:13px;border:0;border-radius:999px;background:#5b4df0;color:#fff;cursor:pointer}button:hover{background:#4e3fe0}
.err{background:#fef2f2;color:#b91c1c;border-radius:12px;padding:10px 12px;margin-bottom:14px;font-size:.9rem}.ok{color:#047857}
small{display:block;margin-top:14px;color:#64748b}
</style></head><body><main>${body}</main></body></html>`;
  return { html, status };
}

function phoneStep(txn: string, error?: string) {
  return page(`<h1>Entrar a Vitrina Market</h1>
<p>Un asistente de IA quiere buscar, comprar y gestionar tu tienda en tu nombre. Confirma tu celular para dar permiso.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/oauth/phone"><input type="hidden" name="txn" value="${esc(txn)}">
<label for="phone">Tu celular</label><input id="phone" name="phone" inputmode="tel" autocomplete="tel" placeholder="71234567" required autofocus>
<button type="submit">Enviarme el código por WhatsApp</button></form>
<small>Si no quieres dar permiso, cierra esta ventana.</small>`);
}

function codeStep(txn: string, phone: string, error?: string) {
  return page(`<h1>Escribe tu código</h1>
<p class="ok">Te lo enviamos por WhatsApp al ${esc(phone)}.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/oauth/verify"><input type="hidden" name="txn" value="${esc(txn)}"><input type="hidden" name="phone" value="${esc(phone)}">
<label for="code">Código de 6 dígitos</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus>
<button type="submit">Dar permiso</button></form>`);
}

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId) {
    const c = verify<{ ru: string[]; nm?: string }>('client', clientId);
    if (!c) return undefined;
    return {
      client_id: clientId,
      client_name: c.nm,
      redirect_uris: c.ru,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    };
  },
  registerClient(client) {
    const uris = (client.redirect_uris ?? []).map(String);
    if (!uris.length || uris.length > 10) throw new InvalidRequestError('redirect_uris es obligatorio');
    for (const u of uris) {
      let parsed: URL;
      try {
        parsed = new URL(u);
      } catch {
        throw new InvalidRequestError('redirect_uri inválida');
      }
      if (parsed.protocol === 'javascript:' || parsed.protocol === 'data:') throw new InvalidRequestError('redirect_uri inválida');
    }
    const id = sign('client', { ru: uris, nm: client.client_name?.slice(0, 80) }, 365 * 24 * 3600);
    return { ...client, client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000), token_endpoint_auth_method: 'none' };
  },
};

function tokensFor(uid: string, cid: string, resource?: string): OAuthTokens {
  return {
    access_token: sign('access', { uid, cid, rs: resource, jti: randomUUID() }, ACCESS_TTL),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: sign('refresh', { uid, cid, rs: resource, jti: randomUUID() }, REFRESH_TTL),
    scope: SCOPE,
  };
}

export const provider: OAuthServerProvider = {
  clientsStore,

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const txn = sign('txn', { cid: client.client_id, ru: params.redirectUri, st: params.state, cc: params.codeChallenge, rs: params.resource?.href }, 600);
    const { html, status } = phoneStep(txn);
    res.status(status).type('html').set('Cache-Control', 'no-store').send(html);
  },

  async challengeForAuthorizationCode(_client, code) {
    const c = verify<{ cc: string }>('code', code);
    if (!c) throw new InvalidGrantError('Código inválido o vencido');
    return c.cc;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const c = verify<{ uid: string; cid: string; ru: string; rs?: string; jti: string; exp: number }>('code', code);
    if (!c || c.cid !== client.client_id) throw new InvalidGrantError('Código inválido o vencido');
    if (redirectUri && redirectUri !== c.ru) throw new InvalidGrantError('redirect_uri no coincide');
    if (!markUsed(c.jti, c.exp)) throw new InvalidGrantError('Este código ya se usó');
    return tokensFor(c.uid, c.cid, c.rs);
  },

  async exchangeRefreshToken(client, refreshToken) {
    const r = verify<{ uid: string; cid: string; rs?: string }>('refresh', refreshToken);
    if (!r || r.cid !== client.client_id) throw new InvalidGrantError('Sesión vencida: vuelve a entrar');
    return tokensFor(r.uid, r.cid, r.rs);
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    const a = verify<{ uid: string; cid: string; exp: number; rs?: string }>('access', token);
    if (!a) throw new InvalidTokenError('Token inválido o vencido');
    return { token, clientId: a.cid, scopes: [SCOPE], expiresAt: a.exp, extra: { userId: a.uid } };
  },
};

/** The two form posts of the login page: phone → WhatsApp code → redirect back to the assistant with an authorization code. */
export function loginRoutes() {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '8kb' }));

  const hits = new Map<string, number[]>();
  const tooMany = (ip: string) => {
    const now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    list.push(now);
    hits.set(ip, list);
    return list.length > 20;
  };

  const send = (res: Response, p: { html: string; status: number }) => res.status(p.status).type('html').set('Cache-Control', 'no-store').send(p.html);

  router.post('/oauth/phone', async (req, res) => {
    const txn = String(req.body?.txn ?? '');
    if (!verify('txn', txn)) return send(res, page('<h1>Enlace vencido</h1><p>Vuelve al asistente y conéctalo otra vez.</p>', 400));
    if (tooMany(req.ip ?? 'x')) return send(res, page('<h1>Demasiados intentos</h1><p>Espera unos minutos.</p>', 429));
    const phone = String(req.body?.phone ?? '').trim().slice(0, 20);
    try {
      await asServer('/auth/otp/request', { phone });
      send(res, codeStep(txn, phone));
    } catch (e) {
      send(res, phoneStep(txn, e instanceof Error ? e.message : 'No pudimos enviar el código'));
    }
  });

  router.post('/oauth/verify', async (req, res) => {
    const txn = verify<{ cid: string; ru: string; st?: string; cc: string; rs?: string }>('txn', String(req.body?.txn ?? ''));
    if (!txn) return send(res, page('<h1>Enlace vencido</h1><p>Vuelve al asistente y conéctalo otra vez.</p>', 400));
    if (tooMany(req.ip ?? 'x')) return send(res, page('<h1>Demasiados intentos</h1><p>Espera unos minutos.</p>', 429));
    const phone = String(req.body?.phone ?? '').trim().slice(0, 20);
    const code = String(req.body?.code ?? '').trim().slice(0, 8);
    try {
      const login = await asServer<{ user?: { id?: string } }>('/auth/otp/verify', { phone, code });
      const uid = login?.user?.id;
      if (!uid) throw new Error('No pudimos confirmar tu cuenta');
      const authCode = sign('code', { uid, cid: txn.cid, ru: txn.ru, cc: txn.cc, rs: txn.rs, jti: randomUUID() }, 300);
      const target = new URL(txn.ru);
      target.searchParams.set('code', authCode);
      if (txn.st) target.searchParams.set('state', txn.st);
      res.redirect(302, target.toString());
    } catch (e) {
      send(res, codeStep(String(req.body?.txn), phone, e instanceof Error ? e.message : 'Código incorrecto'));
    }
  });

  return router;
}
