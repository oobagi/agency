import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { initDb, closeDb } from './db.js';
import { SimClock } from './sim-clock.js';
import { handleMcpRequest, closeMcpSessions, setSimClock } from './mcp/server.js';
import { fetchAndStorePersonas, getPersonas, refreshPersonas } from './personas.js';
import { getAgents, getAgent, getTeams, getTeam, getDesks } from './handlers/agent-management.js';
import {
  setSessionBroadcast,
  getSessionsForAgent,
  getSessionById,
  interruptSession,
} from './session-recorder.js';
import type { SessionEvent } from './providers/types.js';
import {
  processTick as processSchedulerTick,
  handleMissedJobsOnBoot,
  getScheduledJobs,
  getJobQueue,
} from './scheduler.js';
import {
  initOfficeManager,
  setOfficeManagerSimClock,
  sendUserMessageToAgent,
  getChatLogs,
} from './office-manager.js';
import { setTeamManagerSimClock } from './team-manager.js';
import { setContextSimClock } from './context-assembly.js';
import { setIdleCheckerSimClock, processIdleChecks } from './idle-checker.js';
import {
  setMovementSimClock,
  setPositionBroadcast,
  startMovementLoop,
  stopMovementLoop,
} from './movement.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

initDb();
console.log('Database initialized');

const clock = new SimClock();
setSimClock(() => clock.now());
setOfficeManagerSimClock(() => clock.now());
setTeamManagerSimClock(() => clock.now());
setContextSimClock(() => clock.now());
setIdleCheckerSimClock(() => clock.now());
setMovementSimClock(
  () => clock.now(),
  () => clock.getSpeed(),
);

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

  if (url === '/api/sim/set-time' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const simTime = body.simTime;
      if (typeof simTime !== 'string') {
        return json(res, { error: 'simTime (ISO 8601) is required' }, 400);
      }
      const t = new Date(simTime);
      if (isNaN(t.getTime())) {
        return json(res, { error: 'Invalid ISO 8601 date' }, 400);
      }
      clock.setTime(t);
      return json(res, { simTime: clock.now().toISOString() });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Invalid request';
      return json(res, { error: message }, 400);
    }
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

  // ── Agent and team endpoints ──────────────────────────────────────
  if (url === '/api/agents' && method === 'GET') {
    return json(res, getAgents());
  }

  if (url?.match(/^\/api\/agents\/[^/]+$/) && method === 'GET') {
    const agentId = url.split('/')[3];
    const agent = getAgent(agentId);
    if (!agent) return json(res, { error: 'Agent not found' }, 404);
    return json(res, agent);
  }

  if (url === '/api/teams' && method === 'GET') {
    return json(res, getTeams());
  }

  if (url?.match(/^\/api\/teams\/[^/]+$/) && method === 'GET') {
    const teamId = url.split('/')[3];
    const team = getTeam(teamId);
    if (!team) return json(res, { error: 'Team not found' }, 404);
    return json(res, team);
  }

  if (url === '/api/desks' && method === 'GET') {
    return json(res, getDesks());
  }

  if (url?.match(/^\/api\/teams\/[^/]+\/desks$/) && method === 'GET') {
    const teamId = url.split('/')[3];
    return json(res, getDesks(teamId));
  }

  // ── Chat and message endpoints ───────────────────────────────────
  if (url?.match(/^\/api\/agents\/[^/]+\/chat-logs$/) && method === 'GET') {
    const agentId = url.split('/')[3];
    return json(res, getChatLogs(agentId));
  }

  if (url?.match(/^\/api\/agents\/[^/]+\/messages$/) && method === 'POST') {
    try {
      const agentId = url.split('/')[3];
      const body = JSON.parse(await readBody(req));
      const message = body.message;
      if (typeof message !== 'string' || !message.trim()) {
        return json(res, { error: 'message is required' }, 400);
      }
      sendUserMessageToAgent(agentId, message.trim());
      return json(res, { sent: true, agentId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid request';
      return json(res, { error: msg }, 400);
    }
  }

  // ── Session endpoints ────────────────────────────────────────────
  if (url?.match(/^\/api\/agents\/[^/]+\/sessions$/) && method === 'GET') {
    const agentId = url.split('/')[3];
    return json(res, getSessionsForAgent(agentId));
  }

  if (url?.match(/^\/api\/sessions\/[^/]+$/) && method === 'GET') {
    const sessionId = url.split('/')[3];
    const session = getSessionById(sessionId);
    if (!session) return json(res, { error: 'Session not found' }, 404);
    return json(res, session);
  }

  if (url?.match(/^\/api\/sessions\/[^/]+\/interrupt$/) && method === 'POST') {
    const sessionId = url.split('/')[3];
    const success = interruptSession(sessionId, 'interrupted', () => clock.now());
    if (!success) return json(res, { error: 'Session not found or not active' }, 404);
    return json(res, { interrupted: true, sessionId });
  }

  // ── Scheduler endpoints ──────────────────────────────────────────
  if (url === '/api/scheduled-jobs' && method === 'GET') {
    return json(res, getScheduledJobs());
  }

  if (url?.match(/^\/api\/agents\/[^/]+\/scheduled-jobs$/) && method === 'GET') {
    const agentId = url.split('/')[3];
    return json(res, getScheduledJobs(agentId));
  }

  if (url === '/api/job-queue' && method === 'GET') {
    return json(res, getJobQueue());
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

// ── Session event subscriptions ───────────────────────────────────
// Clients can subscribe to live session events for specific agents.
// Send: {"type": "subscribe_sessions", "agentId": "..."} to subscribe.
// Send: {"type": "unsubscribe_sessions", "agentId": "..."} to unsubscribe.

const sessionSubscriptions = new Map<WebSocket, Set<string>>();

setSessionBroadcast((agentId: string, event: SessionEvent) => {
  const message = JSON.stringify({ type: 'session_event', agentId, event });
  for (const [client, subs] of sessionSubscriptions) {
    if (client.readyState === WebSocket.OPEN && subs.has(agentId)) {
      client.send(message);
    }
  }
});

wss.on('connection', (ws) => {
  sessionSubscriptions.set(ws, new Set());

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'subscribe_sessions' && typeof msg.agentId === 'string') {
        sessionSubscriptions.get(ws)?.add(msg.agentId);
      }
      if (msg.type === 'unsubscribe_sessions' && typeof msg.agentId === 'string') {
        sessionSubscriptions.get(ws)?.delete(msg.agentId);
      }
    } catch {
      // Ignore invalid messages
    }
  });

  ws.on('close', () => {
    sessionSubscriptions.delete(ws);
  });
});

// ── Position broadcast (movement system → WebSocket clients) ──────
setPositionBroadcast((data) => {
  const message = JSON.stringify({ type: 'agent_position', ...data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
});

clock.onTick((simTime) => {
  // Run scheduled jobs on every tick
  processSchedulerTick(simTime);

  // Check for idle agents that need to check in with their TM
  processIdleChecks(simTime);

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

// Initialize the Office Manager (creates if not exists, registers scheduled jobs)
initOfficeManager();

// Handle any jobs that were missed while the server was down
handleMissedJobsOnBoot(clock.now());

clock.start();
startMovementLoop();
console.log(
  `Sim clock started: ${clock.now().toISOString()}, speed=${clock.getSpeed()}x, paused=${clock.isPaused()}`,
);

// Fetch personas in the background so server starts immediately
fetchAndStorePersonas().catch((err) => console.error('[personas] Startup fetch failed:', err));

server.listen(PORT, () => {
  console.log(`Agency server listening on http://localhost:${PORT}`);
});

function shutdown() {
  console.log('Shutting down...');
  clock.stop();
  stopMovementLoop();
  closeMcpSessions();
  wss.close();
  server.close();
  closeDb();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
