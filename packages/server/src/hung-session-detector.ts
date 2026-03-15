import { getDb } from './db.js';
import { interruptSession } from './session-recorder.js';
import { transitionAgentState } from './state-machine.js';
import { createBlocker } from './blockers.js';
import { triggerTMBlockerReport } from './team-manager.js';

// ── Configuration ───────────────────────────────────────────────────

const HUNG_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 sim minutes
// LLM calls take real-world time regardless of sim speed.
// Enforce a minimum real-world grace period so sessions aren't killed
// while the LLM is still processing its first response.
const MIN_REAL_WORLD_TIMEOUT_MS = 5 * 60 * 1000; // 5 real minutes

// ── Sim clock accessor ─────────────────────────────────────────────

let simNowFn: () => Date = () => new Date();

export function setHungDetectorSimClock(fn: () => Date): void {
  simNowFn = fn;
}

// ── Per-session tracking ────────────────────────────────────────────

const lastToolCallTime = new Map<
  string,
  { agentId: string; simTimeMs: number; realRegisteredAt: number }
>();

export function registerHungDetectorSession(
  sessionId: string,
  agentId: string,
  simTime: Date,
): void {
  lastToolCallTime.set(sessionId, {
    agentId,
    simTimeMs: simTime.getTime(),
    // eslint-disable-next-line no-restricted-syntax -- real-world tracking for LLM grace period
    realRegisteredAt: Date.now(),
  });
}

export function onToolCallComplete(sessionId: string, simTime: Date): void {
  const entry = lastToolCallTime.get(sessionId);
  if (entry) {
    entry.simTimeMs = simTime.getTime();
  }
}

export function unregisterHungDetectorSession(sessionId: string): void {
  lastToolCallTime.delete(sessionId);
}

// ── Tick handler: check for hung sessions ───────────────────────────

export function processHungSessionChecks(simTime: Date): void {
  const nowMs = simTime.getTime();

  for (const [sessionId, entry] of lastToolCallTime) {
    const elapsed = nowMs - entry.simTimeMs;
    if (elapsed < HUNG_SESSION_TIMEOUT_MS) continue;

    // LLM calls take real-world time regardless of sim speed.
    // Don't kill sessions that haven't had enough real-world time to respond.
    // eslint-disable-next-line no-restricted-syntax -- real-world elapsed check
    const realElapsed = Date.now() - entry.realRegisteredAt;
    if (realElapsed < MIN_REAL_WORLD_TIMEOUT_MS) continue;

    console.warn(
      `[hung-detector] Session ${sessionId} hung (${Math.round(elapsed / 60000)} sim minutes without tool call)`,
    );

    // Interrupt the session
    const interrupted = interruptSession(sessionId, 'hung', simNowFn);
    if (!interrupted) {
      // Session already ended, just clean up
      lastToolCallTime.delete(sessionId);
      continue;
    }

    // Transition agent to Blocked
    transitionAgentState(entry.agentId, 'Blocked');

    // Find the agent's current task
    const db = getDb();
    const task = db
      .prepare("SELECT id FROM tasks WHERE agent_id = ? AND status = 'in_progress' LIMIT 1")
      .get(entry.agentId) as { id: string } | undefined;

    if (task) {
      db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(task.id);
    }

    // Create a blocker record
    const blockerId = createBlocker(
      entry.agentId,
      'Session hung: no tool call completed within 30 sim minutes',
      simTime,
      task?.id,
    );

    // Trigger TM
    const agent = db.prepare('SELECT team_id FROM agents WHERE id = ?').get(entry.agentId) as
      | { team_id: string | null }
      | undefined;

    if (agent?.team_id) {
      triggerTMBlockerReport(
        agent.team_id,
        entry.agentId,
        'Session hung: no tool call completed within 30 sim minutes',
        blockerId,
      );
    }

    lastToolCallTime.delete(sessionId);
  }
}
