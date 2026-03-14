import { getDb } from './db.js';
import { triggerTMDeskArrival } from './team-manager.js';

// ── Idle check-in config ───────────────────────────────────────────

const IDLE_CHECKIN_THRESHOLD_MS = 30 * 60 * 1000; // 30 sim minutes in ms

// Track when each agent entered Idle state (sim time)
const idleStartTimes = new Map<string, number>();

// ── Sim clock accessor (kept for consistency with other modules) ───

export function setIdleCheckerSimClock(_fn: () => Date): void {
  // processIdleChecks receives simTime directly from the tick loop
}

// ── Process idle agents on each tick ───────────────────────────────

export function processIdleChecks(simTime: Date): void {
  const db = getDb();

  // Find all regular agents who are Idle with no tasks
  const idleAgents = db
    .prepare(
      `SELECT a.id, a.team_id FROM agents a
       WHERE a.role = 'agent' AND a.state = 'Idle' AND a.fired_at IS NULL
         AND a.team_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
           WHERE t.agent_id = a.id AND t.status IN ('pending', 'in_progress')
         )`,
    )
    .all() as Array<{ id: string; team_id: string }>;

  const simTimeMs = simTime.getTime();

  for (const agent of idleAgents) {
    if (!idleStartTimes.has(agent.id)) {
      // First time seeing this agent idle — record the start time
      idleStartTimes.set(agent.id, simTimeMs);
      continue;
    }

    const idleSince = idleStartTimes.get(agent.id)!;
    const idleDuration = simTimeMs - idleSince;

    if (idleDuration >= IDLE_CHECKIN_THRESHOLD_MS) {
      // Agent has been idle for 30+ sim minutes — trigger check-in
      console.log(
        `[idle-checker] Agent ${agent.id} idle for ${Math.round(idleDuration / 60000)}m, triggering check-in`,
      );

      // The agent "walks to their Team Manager" — in practice, this triggers
      // a TM session via the task_complete-like trigger. The TM will then
      // assign work or brief them.
      const tm = db
        .prepare(
          `SELECT id FROM agents
           WHERE team_id = ? AND role = 'team_manager' AND fired_at IS NULL`,
        )
        .get(agent.team_id) as { id: string } | undefined;

      if (tm) {
        // Trigger TM session for agent check-in
        triggerTMDeskArrival(tm.id);
      }

      // Reset the timer so we don't re-trigger every tick
      idleStartTimes.set(agent.id, simTimeMs);
    }
  }

  // Clean up: remove entries for agents no longer idle
  for (const [agentId] of idleStartTimes) {
    const stillIdle = idleAgents.find((a) => a.id === agentId);
    if (!stillIdle) {
      idleStartTimes.delete(agentId);
    }
  }
}

// ── Reset idle timer for an agent (called on state change) ─────────

export function resetIdleTimer(agentId: string): void {
  idleStartTimes.delete(agentId);
}
