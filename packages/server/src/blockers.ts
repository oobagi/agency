import crypto from 'node:crypto';
import { getDb } from './db.js';
import { transitionAgentState } from './state-machine.js';

// ── Types ───────────────────────────────────────────────────────────

interface EscalationEntry {
  role: string;
  agent_id: string;
  agent_name: string;
  sim_time: string;
  action: string;
  notes: string;
}

interface BlockerRow {
  id: string;
  agent_id: string;
  task_id: string | null;
  description: string;
  status: string;
  resolution: string | null;
  resolved_by: string | null;
  escalation_history: string;
  created_at: string;
  resolved_at: string | null;
}

// ── WebSocket broadcast ─────────────────────────────────────────────

type BlockerBroadcastFn = (data: {
  blockerId: string;
  agentId: string;
  agentName: string;
  description: string;
  escalationHistory: EscalationEntry[];
}) => void;

let broadcastFn: BlockerBroadcastFn = () => {};

export function setBlockerBroadcast(fn: BlockerBroadcastFn): void {
  broadcastFn = fn;
}

// ── Resolution broadcast (agent state changed → UI update) ─────────

type ResolutionBroadcastFn = (data: { agentId: string }) => void;

let resolutionBroadcastFn: ResolutionBroadcastFn = () => {};

export function setBlockerResolutionBroadcast(fn: ResolutionBroadcastFn): void {
  resolutionBroadcastFn = fn;
}

// ── Create a blocker ────────────────────────────────────────────────

export function createBlocker(
  agentId: string,
  description: string,
  simTime: Date,
  taskId?: string,
): string {
  const db = getDb();
  const blockerId = crypto.randomUUID();
  const now = new Date().toISOString();
  const simTimeStr = simTime.toISOString();

  const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId) as
    | { name: string }
    | undefined;

  const history: EscalationEntry[] = [
    {
      role: 'agent',
      agent_id: agentId,
      agent_name: agent?.name ?? 'Unknown',
      sim_time: simTimeStr,
      action: 'reported',
      notes: description,
    },
  ];

  db.prepare(
    `INSERT INTO blockers (id, agent_id, task_id, description, status, escalation_history, created_at)
     VALUES (?, ?, ?, ?, 'escalated_to_tm', ?, ?)`,
  ).run(blockerId, agentId, taskId ?? null, description, JSON.stringify(history), now);

  console.log(`[blockers] Created blocker ${blockerId} for agent ${agentId}: ${description}`);
  return blockerId;
}

// ── Resolve a blocker ───────────────────────────────────────────────

export function resolveBlocker(
  blockerId: string,
  resolvedById: string,
  resolution: string,
  simTime: Date,
): { success: boolean; error?: string } {
  const db = getDb();
  const simTimeStr = simTime.toISOString();

  const blocker = db.prepare('SELECT * FROM blockers WHERE id = ?').get(blockerId) as
    | BlockerRow
    | undefined;

  if (!blocker) return { success: false, error: `Blocker "${blockerId}" not found` };
  if (blocker.status === 'resolved') {
    return { success: false, error: `Blocker "${blockerId}" is already resolved` };
  }

  const resolver = db.prepare('SELECT name, role FROM agents WHERE id = ?').get(resolvedById) as
    | { name: string; role: string }
    | undefined;

  // Append resolution to escalation history
  const history = JSON.parse(blocker.escalation_history) as EscalationEntry[];
  history.push({
    role: resolver?.role ?? 'user',
    agent_id: resolvedById,
    agent_name: resolver?.name ?? 'User',
    sim_time: simTimeStr,
    action: 'resolved',
    notes: resolution,
  });

  db.prepare(
    `UPDATE blockers SET status = 'resolved', resolution = ?, resolved_by = ?,
     escalation_history = ?, resolved_at = ? WHERE id = ?`,
  ).run(resolution, resolvedById, JSON.stringify(history), simTimeStr, blockerId);

  // Transition agent from Blocked to Idle
  transitionAgentState(blocker.agent_id, 'Idle');

  // Reset task to pending if one was associated
  if (blocker.task_id) {
    db.prepare("UPDATE tasks SET status = 'pending' WHERE id = ? AND status = 'blocked'").run(
      blocker.task_id,
    );
  }

  // Broadcast so the UI updates the agent's state
  resolutionBroadcastFn({ agentId: blocker.agent_id });

  console.log(`[blockers] Resolved ${blockerId} by ${resolver?.name ?? resolvedById}`);
  return { success: true };
}

// ── Escalate to Office Manager ──────────────────────────────────────

export function escalateBlockerToOM(
  blockerId: string,
  tmAgentId: string,
  notes: string,
  simTime: Date,
): { success: boolean; error?: string; omId?: string } {
  const db = getDb();
  const simTimeStr = simTime.toISOString();

  const blocker = db.prepare('SELECT * FROM blockers WHERE id = ?').get(blockerId) as
    | BlockerRow
    | undefined;

  if (!blocker) return { success: false, error: `Blocker "${blockerId}" not found` };
  if (blocker.status === 'resolved') {
    return { success: false, error: `Blocker "${blockerId}" is already resolved` };
  }

  const tm = db.prepare('SELECT name, role FROM agents WHERE id = ?').get(tmAgentId) as
    | { name: string; role: string }
    | undefined;

  const om = db
    .prepare("SELECT id FROM agents WHERE role = 'office_manager' AND fired_at IS NULL")
    .get() as { id: string } | undefined;

  if (!om) return { success: false, error: 'No Office Manager found' };

  const history = JSON.parse(blocker.escalation_history) as EscalationEntry[];
  history.push({
    role: 'team_manager',
    agent_id: tmAgentId,
    agent_name: tm?.name ?? 'Unknown',
    sim_time: simTimeStr,
    action: 'escalated_to_om',
    notes,
  });

  db.prepare(
    `UPDATE blockers SET status = 'escalated_to_om', escalation_history = ? WHERE id = ?`,
  ).run(JSON.stringify(history), blockerId);

  console.log(`[blockers] ${blockerId} escalated to OM by ${tm?.name ?? tmAgentId}`);
  return { success: true, omId: om.id };
}

// ── Mark as user-facing ─────────────────────────────────────────────

export function markBlockerUserFacing(
  blockerId: string,
  omAgentId: string,
  notes: string,
  simTime: Date,
): { success: boolean; error?: string } {
  const db = getDb();
  const simTimeStr = simTime.toISOString();

  const blocker = db.prepare('SELECT * FROM blockers WHERE id = ?').get(blockerId) as
    | BlockerRow
    | undefined;

  if (!blocker) return { success: false, error: `Blocker "${blockerId}" not found` };
  if (blocker.status === 'resolved') {
    return { success: false, error: `Blocker "${blockerId}" is already resolved` };
  }

  const om = db.prepare('SELECT name FROM agents WHERE id = ?').get(omAgentId) as
    | { name: string }
    | undefined;

  const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(blocker.agent_id) as
    | { name: string }
    | undefined;

  const history = JSON.parse(blocker.escalation_history) as EscalationEntry[];
  history.push({
    role: 'office_manager',
    agent_id: omAgentId,
    agent_name: om?.name ?? 'Unknown',
    sim_time: simTimeStr,
    action: 'marked_user_facing',
    notes,
  });

  db.prepare(`UPDATE blockers SET status = 'user_facing', escalation_history = ? WHERE id = ?`).run(
    JSON.stringify(history),
    blockerId,
  );

  // Broadcast to UI
  broadcastFn({
    blockerId,
    agentId: blocker.agent_id,
    agentName: agent?.name ?? 'Unknown',
    description: blocker.description,
    escalationHistory: history,
  });

  console.log(`[blockers] ${blockerId} marked user-facing: ${notes}`);
  return { success: true };
}

// ── Query helpers ───────────────────────────────────────────────────

export function getBlocker(blockerId: string): unknown | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT b.*, a.name as agent_name
       FROM blockers b
       LEFT JOIN agents a ON b.agent_id = a.id
       WHERE b.id = ?`,
    )
    .get(blockerId);
}

export function getOpenBlockers(): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT b.*, a.name as agent_name
       FROM blockers b
       LEFT JOIN agents a ON b.agent_id = a.id
       WHERE b.status != 'resolved'
       ORDER BY b.created_at DESC`,
    )
    .all();
}

export function getBlockersForAgent(agentId: string): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT b.*, a.name as agent_name
       FROM blockers b
       LEFT JOIN agents a ON b.agent_id = a.id
       WHERE b.agent_id = ?
       ORDER BY b.created_at DESC`,
    )
    .all(agentId);
}
