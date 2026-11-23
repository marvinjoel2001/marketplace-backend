import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

const app = express();
app.use(express.json({ limit: '256kb' }));

const KEY = process.env.MCP_API_KEY?.trim();

function authorized(header: string | undefined) {
  if (!KEY) return true;
  const given = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const wanted = Buffer.from(KEY);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

app.get('/health', (_req, res) => void res.json({ ok: true }));

// Stateless: each request gets its own server, so it scales and restarts without sessions to lose.
app.post('/mcp', async (req, res) => {
  if (!authorized(req.headers.authorization)) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Clave inválida' }, id: null });
    return;
  }
  const server = createServer();
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

const port = Number(process.env.PORT) || 4100;
app.listen(port, () => console.log(`Vitrina MCP escuchando en :${port}/mcp${KEY ? ' (con clave)' : ' (sin clave: solo datos públicos)'}`));
