import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { initDb, closeDb } from './db.js';
import { SimClock } from './sim-clock.js';
import { handleMcpRequest, closeMcpSessions } from './mcp/server.js';
import { fetchAndStorePersonas, getPersonas, refreshPersonas } from './personas.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

initDb();
console.log('Database initialized');

const clock = new SimClock();

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // MCP endpoint — delegate to StreamableHTTP transport
  if (url?.startsWith('/mcp')) {
    const handled = await handleMcpRequest(req, res);
    if (handled) return;
  }

  if (url === '/api/sim/status' && method === 'GET') {
    return json(res, {
      simTime: clock.now().toISOString(),
      speed: clock.getSpeed(),
      paused: clock.isPaused(),
    });
  }

  if (url === '/api/sim/pause' && method === 'POST') {
    clock.pause();
    return json(res, { paused: true });
  }

  if (url === '/api/sim/resume' && method === 'POST') {
    clock.resume();
    return json(res, { paused: false });
  }

  if (url === '/api/personas' && method === 'GET') {
    return json(res, getPersonas());
  }

  if (url === '/api/personas/refresh' && method === 'POST') {
    try {
      const result = await refreshPersonas();
      return json(res, result);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Refresh failed';
      return json(res, { error: message }, 500);
    }
  }

  if (url === '/api/sim/speed' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const multiplier = body.multiplier;
      if (typeof multiplier !== 'number') {
        return json(res, { error: 'multiplier must be a number' }, 400);
      }
      clock.setSpeed(multiplier);
      return json(res, { speed: multiplier });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid request';
      return json(res, { error: message }, 400);
    }
  }

  json(res, { status: 'ok' });
});

// WebSocket server attached to the HTTP server
const wss = new WebSocketServer({ server });

clock.onTick((simTime) => {
  const message = JSON.stringify({
    type: 'tick',
    simTime: simTime.toISOString(),
    speed: clock.getSpeed(),
    paused: clock.isPaused(),
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
});

clock.start();
console.log(
  `Sim clock started: ${clock.now().toISOString()}, speed=${clock.getSpeed()}x, paused=${clock.isPaused()}`,
);

// Fetch personas in the background so server starts immediately
fetchAndStorePersonas().catch((err) =>
  console.error('[personas] Startup fetch failed:', err),
);

server.listen(PORT, () => {
  console.log(`Agency server listening on http://localhost:${PORT}`);
});

function shutdown() {
  console.log('Shutting down...');
  clock.stop();
  closeMcpSessions();
  wss.close();
  server.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
