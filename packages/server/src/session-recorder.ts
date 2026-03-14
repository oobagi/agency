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

// ---------- WebSocket broadcast ----------

type BroadcastFn = (agentId: string, event: SessionEvent) => void;

let broadcastFn: BroadcastFn = () => {};

/** Called from index.ts to wire up the WebSocket broadcast function. */
export function setSessionBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

// ---------- Active session tracking ----------

const activeSessions = new Map<string, { agentId: string; abort: () => void }>();

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

    // Track as active
    activeSessions.set(this.sessionId, {
      agentId: this.agentId,
      abort: session.abort,
    });

    // Start consuming events in the background
    this.consumeEvents(session.events).catch((err) => {
      console.error(`[session-recorder] Error consuming events for ${this.sessionId}:`, err);
    });
  }

  private async consumeEvents(events: AsyncIterable<SessionEvent>): Promise<void> {
    try {
      for await (const event of events) {
        this.recordEvent(event);
        broadcastFn(this.agentId, event);
      }
    } finally {
      activeSessions.delete(this.sessionId);
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

        // Try to update existing record by toolUseId, fall back to insert
        const updated = db
          .prepare(
            `UPDATE session_tool_calls SET result = ?, status = ?
             WHERE id = ? AND session_id = ?`,
          )
          .run(JSON.stringify(data.result), status, data.toolUseId, this.dbSessionId);

        if (updated.changes === 0) {
          // No matching start event — insert a complete record
          db.prepare(
            `INSERT INTO session_tool_calls (id, session_id, tool_name, arguments, result, status, sim_time, created_at)
             VALUES (?, ?, ?, '{}', ?, ?, ?, ?)`,
          ).run(
            data.toolUseId || crypto.randomUUID(),
            this.dbSessionId,
            data.toolName,
            JSON.stringify(data.result),
            status,
            simTime,
            now,
          );
        }
        break;
      }

      case 'session_complete': {
        const data = event.data as SessionCompleteData;
        db.prepare(
          `UPDATE sessions SET ended_at = ?, outcome = 'completed', token_estimate = ?
           WHERE id = ?`,
        ).run(simTime, data.tokenEstimate, this.dbSessionId);
        break;
      }

      case 'session_error': {
        const data = event.data as SessionErrorData;
        console.error(`[session-recorder] Session ${this.sessionId} errored:`, data.errors);
        db.prepare(`UPDATE sessions SET ended_at = ?, outcome = 'errored' WHERE id = ?`).run(
          simTime,
          this.dbSessionId,
        );
        break;
      }
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

  active.abort();
  activeSessions.delete(sessionId);

  const simTime = simNow().toISOString();
  getDb()
    .prepare('UPDATE sessions SET ended_at = ?, outcome = ? WHERE id = ?')
    .run(simTime, outcome, sessionId);

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
