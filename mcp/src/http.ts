import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { createServer } from './server.js';
import { ACCOUNT_TOOLS } from './account-tools.js';
import { loginRoutes, provider } from './oauth.js';
import { authEnabled } from './tokens.js';

const port = Number(process.env.PORT) || 4100;
const publicUrl = new URL((process.env.MCP_PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ''));
const mcpUrl = new URL('/mcp', publicUrl);
const metadataUrl = getOAuthProtectedResourceMetadataUrl(mcpUrl);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => void res.json({ ok: true, signIn: authEnabled }));

if (authEnabled) {
  // OAuth 2.1 with dynamic client registration: ChatGPT, Claude and Gemini connect with a "sign in" button.
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: publicUrl,
      resourceServerUrl: mcpUrl,
      scopesSupported: ['vitrina'],
      resourceName: 'Vitrina Market',
      clientRegistrationOptions: { clientIdGeneration: false },
    }),
  );
  app.use(loginRoutes());
}

function askSignIn(res: express.Response, message: string) {
  res
    .status(401)
    .set('WWW-Authenticate', `Bearer error="invalid_token", error_description="${message}", resource_metadata="${metadataUrl}"`)
    .json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
}

function callsAccountTool(body: unknown): boolean {
  const list = Array.isArray(body) ? body : [body];
  return list.some((m) => m && (m as any).method === 'tools/call' && ACCOUNT_TOOLS.has((m as any).params?.name));
}

// Stateless: each request gets its own server, so it scales and restarts without sessions to lose.
app.post('/mcp', async (req, res) => {
  let userId = '';
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (bearer && authEnabled) {
    try {
      userId = String((await provider.verifyAccessToken(bearer)).extra?.userId ?? '');
    } catch {
      return askSignIn(res, 'Tu sesión venció: vuelve a entrar');
    }
  }
  if (!userId && authEnabled && callsAccountTool(req.body)) return askSignIn(res, 'Entra a tu cuenta de Vitrina para continuar');

  const server = createServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno' }, id: null });
  }
});

const notAllowed = (_req: express.Request, res: express.Response) =>
  void res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Usa POST /mcp' }, id: null });
app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

app.listen(port, () =>
  console.log(`Vitrina MCP en ${mcpUrl.href} — ${authEnabled ? 'con inicio de sesión (comprar y vender)' : 'solo lectura: define MCP_SECRET y AUTH_INTERNAL_KEY para activar cuentas'}`),
);
