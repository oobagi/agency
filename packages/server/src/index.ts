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
import {
  setCommunicationSimClock,
  setSpeakBroadcast,
  getConversations,
  getConversation,
} from './handlers/communication.js';
import { getTasks, getAgentTasks } from './handlers/task-system.js';
import {
  getProjects,
  getProject,
  getProjectPRs,
  getPRDetails,
  getWorktrees,
} from './handlers/git-operations.js';
import { processEndOfDayCompression } from './memory-compression.js';
import { setContextMonitorSimClock, setContextAlertCallback } from './context-monitor.js';
import { triggerTMBlockerReport } from './team-manager.js';
import {
  setBlockerBroadcast,
  getOpenBlockers,
  getBlocker,
  getBlockersForAgent,
  resolveBlocker,
} from './blockers.js';
import { setHungDetectorSimClock, processHungSessionChecks } from './hung-session-detector.js';
import { setMeetingSimClock, initMeetingSystem } from './meetings.js';

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
setCommunicationSimClock(() => clock.now());
setContextMonitorSimClock(() => clock.now());
setHungDetectorSimClock(() => clock.now());
setMeetingSimClock(() => clock.now());

// Wire context monitor alert → Team Manager blocker trigger
setContextAlertCallback((teamId, agentId, agentName, pct) => {
  const desc = `Agent ${agentName} is at ${(pct * 100).toFixed(0)}% context window capacity. Use trigger_compression to compress their memory or checkpoint_agent to have them commit current work.`;
  triggerTMBlockerReport(teamId, agentId, desc);
});

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

  // ── Conversation endpoints ──────────────────────────────────────
  if (url === '/api/conversations' && method === 'GET') {
    return json(res, getConversations());
  }

  if (url?.match(/^\/api\/conversations\/[^/]+$/) && method === 'GET') {
    const conversationId = url.split('/')[3];
    const conversation = getConversation(conversationId);
    if (!conversation) return json(res, { error: 'Conversation not found' }, 404);
    return json(res, conversation);
  }

  // ── Task endpoints ────────────────────────────────────────────────
  if (url?.startsWith('/api/tasks') && method === 'GET' && url === '/api/tasks') {
    const parsedUrl = new URL(url, `http://localhost:${PORT}`);
    const status = parsedUrl.searchParams.get('status') ?? undefined;
    const teamId = parsedUrl.searchParams.get('team_id') ?? undefined;
    return json(res, getTasks({ status, team_id: teamId }));
  }

  if (url?.match(/^\/api\/agents\/[^/]+\/tasks$/) && method === 'GET') {
    const agentId = url.split('/')[3];
    return json(res, getAgentTasks(agentId));
  }

  // ── Project and PR endpoints ────────────────────────────────────
  if (url === '/api/projects' && method === 'GET') {
    return json(res, getProjects());
  }

  if (url?.match(/^\/api\/projects\/[^/]+$/) && method === 'GET') {
    const projectId = url.split('/')[3];
    const project = getProject(projectId);
    if (!project) return json(res, { error: 'Project not found' }, 404);
    return json(res, project);
  }

  if (url?.match(/^\/api\/projects\/[^/]+\/prs$/) && method === 'GET') {
    const projectId = url.split('/')[3];
    return json(res, getProjectPRs(projectId));
  }

  if (url?.match(/^\/api\/projects\/[^/]+\/worktrees$/) && method === 'GET') {
    const projectId = url.split('/')[3];
    return json(res, getWorktrees(projectId));
  }

  if (url?.match(/^\/api\/prs\/[^/]+$/) && method === 'GET') {
    const prId = url.split('/')[3];
    const result = await getPRDetails(prId);
    if (!result) return json(res, { error: 'PR not found' }, 404);
    return json(res, result);
  }

  // ── Blocker endpoints ──────────────────────────────────────────────
  if (url === '/api/blockers' && method === 'GET') {
    return json(res, getOpenBlockers());
  }

  if (url?.match(/^\/api\/blockers\/[^/]+$/) && method === 'GET') {
    const blockerId = url.split('/')[3];
    const blocker = getBlocker(blockerId);
    if (!blocker) return json(res, { error: 'Blocker not found' }, 404);
    return json(res, blocker);
  }

  if (url?.match(/^\/api\/agents\/[^/]+\/blockers$/) && method === 'GET') {
    const agentId = url.split('/')[3];
    return json(res, getBlockersForAgent(agentId));
  }

  if (url?.match(/^\/api\/blockers\/[^/]+\/resolve$/) && method === 'POST') {
    try {
      const blockerId = url.split('/')[3];
      const body = JSON.parse(await readBody(req));
      const resolution = body.resolution;
      if (typeof resolution !== 'string' || !resolution.trim()) {
        return json(res, { error: 'resolution is required' }, 400);
      }
      const result = resolveBlocker(blockerId, 'user', resolution.trim(), clock.now());
      if (!result.success) return json(res, { error: result.error }, 400);
      return json(res, { resolved: true, blockerId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Invalid request';
      return json(res, { error: msg }, 400);
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

// ── Speak broadcast (communication → WebSocket clients for chat bubbles) ──
setSpeakBroadcast((data) => {
  const message = JSON.stringify({ type: 'speak', ...data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
});

// ── Blocker broadcast (user-facing blockers → WebSocket clients) ──
setBlockerBroadcast((data) => {
  const message = JSON.stringify({ type: 'blocker_user_facing', ...data });
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

  // Check for end-of-day memory compression (17:00)
  processEndOfDayCompression(simTime);

  // Check for hung sessions (no tool call for 30+ sim minutes)
  processHungSessionChecks(simTime);

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

// Initialize meeting system (registers the 'meeting' job handler)
initMeetingSystem();

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
