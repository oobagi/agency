import crypto from 'node:crypto';
import { getDb } from './db.js';
import type {
  Session,
  SessionEvent,
  ToolCallStartData,
  ToolCallCompleteData,
  SessionCompleteData,
  SessionErrorData,
} from './providers/types.js';
import { registerSession, addSessionTokens, unregisterSession } from './context-monitor.js';
import {
  registerHungDetectorSession,
  onToolCallComplete,
  unregisterHungDetectorSession,
} from './hung-session-detector.js';
import { transitionAgentState } from './state-machine.js';
import { createBlocker } from './blockers.js';
import { triggerTMBlockerReport } from './team-manager.js';

// ---------- WebSocket broadcast ----------

type BroadcastFn = (agentId: string, event: SessionEvent) => void;

let broadcastFn: BroadcastFn = () => {};

/** Called from index.ts to wire up the WebSocket broadcast function. */
export function setSessionBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

// ---------- Active session tracking ----------

const activeSessions = new Map<string, { agentId: string; abort: () => void }>();

/** Agents currently in the async gap between spawn start and SessionRecorder creation. */
const spawningAgents = new Set<string>();

/**
 * Claim a session slot for an agent. Returns true if the slot was claimed,
 * false if the agent already has an active or spawning session.
 * Must be called synchronously before any async spawn work.
 */
export function claimSessionSlot(agentId: string): boolean {
  if (spawningAgents.has(agentId)) return false;
  if (getActiveSessionForAgent(agentId)) return false;
  spawningAgents.add(agentId);
  return true;
}

/**
 * Release a session slot if the spawn failed before SessionRecorder was created.
 */
export function releaseSessionSlot(agentId: string): void {
  spawningAgents.delete(agentId);
}

export function getActiveSession(sessionId: string) {
  return activeSessions.get(sessionId);
}

export function getActiveSessionForAgent(agentId: string) {
  for (const [sessionId, info] of activeSessions) {
    if (info.agentId === agentId) {
      return { sessionId, ...info };
    }
  }
  return undefined;
}

export function getActiveSessionCount(): number {
  return activeSessions.size;
}

export function getAllActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys());
}

// ---------- SessionRecorder ----------

/**
 * Wraps a provider Session, recording all events to the database
 * and broadcasting them via WebSocket.
 */
export class SessionRecorder {
  private sessionId: string;
  private agentId: string;
  private dbSessionId: string;
  private provider: string;
  private model: string;
  private simNow: () => Date;
  private completionCallbacks: Array<() => void> = [];

  constructor(session: Session, provider: string, model: string, simNow: () => Date) {
    this.sessionId = session.id;
    this.agentId = session.agentId;
    this.dbSessionId = session.id;
    this.provider = provider;
    this.model = model;
    this.simNow = simNow;

    // Insert initial session record
    const now = new Date().toISOString();
    const simTime = simNow();
    const simDay = simTime.toISOString().split('T')[0];

    getDb()
      .prepare(
        `INSERT INTO sessions (id, agent_id, sim_day, provider, model, started_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.dbSessionId, this.agentId, simDay, provider, model, simTime.toISOString(), now);

    // Track as active and release spawning guard
    activeSessions.set(this.sessionId, {
      agentId: this.agentId,
      abort: session.abort,
    });
    spawningAgents.delete(this.agentId);

    // Register with context monitor and hung detector
    registerSession(this.sessionId, this.agentId, model, 0);
    registerHungDetectorSession(this.sessionId, this.agentId, simNow());

    // Start consuming events in the background
    this.consumeEvents(session.events).catch((err) => {
      console.error(`[session-recorder] Error consuming events for ${this.sessionId}:`, err);
    });
  }

  /** Register a callback that fires when the session completes (normally or with error). */
  onComplete(cb: () => void): void {
    this.completionCallbacks.push(cb);
  }

  private async consumeEvents(events: AsyncIterable<SessionEvent>): Promise<void> {
    try {
      for await (const event of events) {
        this.recordEvent(event);
        broadcastFn(this.agentId, event);
      }
    } finally {
      activeSessions.delete(this.sessionId);
      for (const cb of this.completionCallbacks) {
        try {
          cb();
        } catch (err) {
          console.error(`[session-recorder] Completion callback error:`, err);
        }
      }
    }
  }

  private recordEvent(event: SessionEvent): void {
    const db = getDb();
    const simTime = this.simNow().toISOString();
    const now = new Date().toISOString();

    switch (event.type) {
      case 'tool_call_start': {
        const data = event.data as ToolCallStartData;
        db.prepare(
          `INSERT INTO session_tool_calls (id, session_id, tool_name, arguments, status, sim_time, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
        ).run(
          data.toolUseId || crypto.randomUUID(),
          this.dbSessionId,
          data.toolName,
          JSON.stringify(data.args),
          simTime,
          now,
        );
        break;
      }

      case 'tool_call_complete': {
        const data = event.data as ToolCallCompleteData;
        const status = data.isError ? 'errored' : 'completed';
        const resultJson = JSON.stringify(data.result);

        // Try to update existing record by toolUseId, fall back to insert
        const updated = db
          .prepare(
            `UPDATE session_tool_calls SET result = ?, status = ?
             WHERE id = ? AND session_id = ?`,
          )
          .run(resultJson, status, data.toolUseId, this.dbSessionId);

        if (updated.changes === 0) {
          // No matching start event — insert a complete record
          db.prepare(
            `INSERT INTO session_tool_calls (id, session_id, tool_name, arguments, result, status, sim_time, created_at)
             VALUES (?, ?, ?, '{}', ?, ?, ?, ?)`,
          ).run(
            data.toolUseId || crypto.randomUUID(),
            this.dbSessionId,
            data.toolName,
            resultJson,
            status,
            simTime,
            now,
          );
        }

        // Update context monitor and hung detector
        addSessionTokens(this.sessionId, resultJson.length);
        onToolCallComplete(this.sessionId, this.simNow());
        break;
      }

      case 'session_complete': {
        const data = event.data as SessionCompleteData;
        db.prepare(
          `UPDATE sessions SET ended_at = ?, outcome = 'completed', token_estimate = ?
           WHERE id = ?`,
        ).run(simTime, data.tokenEstimate, this.dbSessionId);
        unregisterSession(this.sessionId);
        unregisterHungDetectorSession(this.sessionId);
        break;
      }

      case 'session_error': {
        const data = event.data as SessionErrorData;
        console.error(`[session-recorder] Session ${this.sessionId} errored:`, data.errors);
        db.prepare(`UPDATE sessions SET ended_at = ?, outcome = 'errored' WHERE id = ?`).run(
          simTime,
          this.dbSessionId,
        );
        unregisterSession(this.sessionId);
        unregisterHungDetectorSession(this.sessionId);
        this.handleSessionError(data.errors);
        break;
      }
    }
  }

  private handleSessionError(errors: string[]): void {
    const db = getDb();
    const errorMsg = `Provider error: ${errors.join('; ') || 'unknown error'}`;

    // Check agent exists and is in a blockable state
    const agent = db
      .prepare('SELECT state, team_id FROM agents WHERE id = ? AND fired_at IS NULL')
      .get(this.agentId) as { state: string; team_id: string | null } | undefined;

    if (!agent) return;

    const blockableStates = new Set([
      'Idle',
      'Walking',
      'Researching',
      'Programming',
      'Reviewing',
      'Meeting',
    ]);
    if (!blockableStates.has(agent.state)) return;

    transitionAgentState(this.agentId, 'Blocked');

    // Mark in-progress task as blocked
    const task = db
      .prepare("SELECT id FROM tasks WHERE agent_id = ? AND status = 'in_progress' LIMIT 1")
      .get(this.agentId) as { id: string } | undefined;

    if (task) {
      db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = ?").run(task.id);
    }

    const simTime = this.simNow();
    const blockerId = createBlocker(this.agentId, errorMsg, simTime, task?.id);

    if (agent.team_id) {
      triggerTMBlockerReport(agent.team_id, this.agentId, errorMsg, blockerId);
    }
  }
}

// ---------- Interrupt support ----------

/**
 * Interrupt a session by ID. Called from REST endpoint or hung session detector.
 */
export function interruptSession(
  sessionId: string,
  outcome: 'interrupted' | 'hung' = 'interrupted',
  simNow: () => Date,
): boolean {
  const active = activeSessions.get(sessionId);
  if (!active) return false;

  const agentId = active.agentId;
  active.abort();
  activeSessions.delete(sessionId);
  unregisterHungDetectorSession(sessionId);

  const simTime = simNow().toISOString();
  getDb()
    .prepare('UPDATE sessions SET ended_at = ?, outcome = ? WHERE id = ?')
    .run(simTime, outcome, sessionId);

  // Broadcast session completion so the UI updates in real time
  broadcastFn(agentId, {
    type: 'session_complete',
    sessionId,
    agentId,
    timestamp: simTime,
    data: {
      result: outcome,
      durationMs: 0,
      numTurns: 0,
      totalCostUsd: 0,
      tokenEstimate: 0,
    },
  });

  // For user-initiated interrupts, transition agent to Idle
  // (hung detector handles its own Blocked transition separately)
  if (outcome === 'interrupted') {
    transitionAgentState(agentId, 'Idle');
  }

  console.log(`[session-recorder] Session ${sessionId} ${outcome}`);
  return true;
}

// ---------- REST query helpers ----------

export function getSessionsForAgent(agentId: string): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.*,
              (SELECT COUNT(*) FROM session_tool_calls stc WHERE stc.session_id = s.id) as tool_call_count
       FROM sessions s
       WHERE s.agent_id = ?
       ORDER BY s.created_at DESC`,
    )
    .all(agentId);
}

export function getSessionById(sessionId: string): unknown | undefined {
  const db = getDb();
  const session = db
    .prepare(
      `SELECT s.*,
              a.name as agent_name
       FROM sessions s
       LEFT JOIN agents a ON s.agent_id = a.id
       WHERE s.id = ?`,
    )
    .get(sessionId);

  if (!session) return undefined;

  const toolCalls = db
    .prepare(
      `SELECT * FROM session_tool_calls
       WHERE session_id = ?
       ORDER BY created_at ASC`,
    )
    .all(sessionId);

  return { ...(session as Record<string, unknown>), tool_calls: toolCalls };
}
