import { getDb } from './db.js';
import { runCompressionForAgent } from './memory-compression.js';
import { interruptSession } from './session-recorder.js';

// ── Configuration ───────────────────────────────────────────────────

const DEFAULT_CONTEXT_LIMIT = 200_000; // tokens
const WARN_THRESHOLD = 0.8; // 80% — notify Team Manager
const FORCE_THRESHOLD = 0.95; // 95% — force compression
const CHARS_PER_TOKEN = 4; // rough estimate

// ── Per-session token tracking ──────────────────────────────────────

interface SessionTracking {
  agentId: string;
  model: string;
  estimatedTokens: number;
  alertedAt80: boolean;
}

const sessionTokens = new Map<string, SessionTracking>();

// ── Sim clock accessor ─────────────────────────────────────────────

let simNowFn: () => Date = () => new Date();

export function setContextMonitorSimClock(fn: () => Date): void {
  simNowFn = fn;
}

// ── TM notification callback ────────────────────────────────────────

type ContextAlertFn = (teamId: string, agentId: string, agentName: string, pct: number) => void;

let contextAlertFn: ContextAlertFn = () => {};

export function setContextAlertCallback(fn: ContextAlertFn): void {
  contextAlertFn = fn;
}

// ── Public API ──────────────────────────────────────────────────────

/** Register a new session for tracking. Call when a SessionRecorder is created. */
export function registerSession(
  sessionId: string,
  agentId: string,
  model: string,
  initialContextChars: number,
): void {
  sessionTokens.set(sessionId, {
    agentId,
    model,
    estimatedTokens: Math.ceil(initialContextChars / CHARS_PER_TOKEN),
    alertedAt80: false,
  });
}

/** Update token estimate when a tool call completes. */
export function addSessionTokens(sessionId: string, additionalChars: number): void {
  const tracking = sessionTokens.get(sessionId);
  if (!tracking) return;

  tracking.estimatedTokens += Math.ceil(additionalChars / CHARS_PER_TOKEN);
  checkThresholds(sessionId, tracking);
}

/** Remove tracking when a session ends. */
export function unregisterSession(sessionId: string): void {
  sessionTokens.delete(sessionId);
}

/** Get current token estimate for a session. */
export function getSessionTokenEstimate(sessionId: string): number {
  return sessionTokens.get(sessionId)?.estimatedTokens ?? 0;
}

// ── Threshold checks ────────────────────────────────────────────────

function checkThresholds(sessionId: string, tracking: SessionTracking): void {
  const limit = DEFAULT_CONTEXT_LIMIT;
  const pct = tracking.estimatedTokens / limit;

  // 95% — force compression and interrupt session
  if (pct >= FORCE_THRESHOLD) {
    console.warn(
      `[context-monitor] Session ${sessionId} at ${(pct * 100).toFixed(0)}% context — force compressing`,
    );

    // Fire-and-forget: compress then interrupt
    runCompressionForAgent(tracking.agentId, simNowFn())
      .then(() => {
        interruptSession(sessionId, 'interrupted', simNowFn);
        console.log(`[context-monitor] Force-compressed and interrupted session ${sessionId}`);
      })
      .catch((err) => {
        console.error(`[context-monitor] Force compression failed:`, err);
      });

    sessionTokens.delete(sessionId);
    return;
  }

  // 80% — notify Team Manager (once per session)
  if (pct >= WARN_THRESHOLD && !tracking.alertedAt80) {
    tracking.alertedAt80 = true;
    console.warn(
      `[context-monitor] Session ${sessionId} at ${(pct * 100).toFixed(0)}% context — alerting TM`,
    );

    const db = getDb();
    const agent = db
      .prepare('SELECT name, team_id FROM agents WHERE id = ?')
      .get(tracking.agentId) as { name: string; team_id: string | null } | undefined;

    if (agent?.team_id) {
      contextAlertFn(agent.team_id, tracking.agentId, agent.name, pct);
    }
  }
}
