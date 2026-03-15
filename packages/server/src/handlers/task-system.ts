import crypto from 'node:crypto';
import { getDb } from '../db.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { transitionAgentState } from '../state-machine.js';
import { triggerTMTaskComplete, triggerTMBlockerReport } from '../team-manager.js';
import { runCompressionForAgent } from '../memory-compression.js';
import { createBlocker } from '../blockers.js';

// ── create_task (manager-only) ──────────────────────────────────────

export async function handleCreateTask(
  args: Record<string, unknown>,
  _callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const title = args.title as string;
  const description = args.description as string;
  const teamId = args.team_id as string;
  const projectId = args.project_id as string;
  const priority = (args.priority as number) ?? 0;
  const agentId = (args.agent_id as string) || null;

  if (!title) return error('title is required');
  if (!description) return error('description is required');
  if (!teamId) return error('team_id is required');
  if (!projectId) return error('project_id is required');

  const db = getDb();

  // Validate team exists
  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId) as
    | { id: string; name: string }
    | undefined;
  if (!team) return error(`Team "${teamId}" not found`);

  // Validate project exists
  const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as
    | { id: string; name: string }
    | undefined;
  if (!project) return error(`Project "${projectId}" not found`);

  // Validate agent if provided
  if (agentId) {
    const agent = db
      .prepare('SELECT id, name, team_id FROM agents WHERE id = ? AND fired_at IS NULL')
      .get(agentId) as { id: string; name: string; team_id: string | null } | undefined;
    if (!agent) return error(`Agent "${agentId}" not found or fired`);
    if (agent.team_id !== teamId) {
      return error(`Agent "${agent.name}" is not on team "${team.name}"`);
    }
  }

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  const simTime = simNow().toISOString();

  db.prepare(
    `INSERT INTO tasks (id, title, description, agent_id, team_id, project_id, status, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(taskId, title, description, agentId, teamId, projectId, priority, now);

  console.log(
    `[create_task] "${title}" (${taskId}) for team ${team.name}` +
      (agentId ? ` assigned to ${agentId}` : ''),
  );

  return ok({
    task_id: taskId,
    title,
    team: team.name,
    project: project.name,
    status: 'pending',
    assigned_to: agentId,
    sim_time: simTime,
    message: `Task "${title}" created${agentId ? ' and assigned' : ''}.`,
  });
}

// ── begin_task ──────────────────────────────────────────────────────

export async function handleBeginTask(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const taskId = args.task_id as string;
  const mode = (args.mode as string) ?? 'programming';
  if (!taskId) return error('task_id is required');

  const db = getDb();

  // Look up the task
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
    | {
        id: string;
        title: string;
        status: string;
        agent_id: string | null;
        team_id: string;
      }
    | undefined;

  if (!task) return error(`Task "${taskId}" not found`);

  if (task.status !== 'pending' && task.status !== 'blocked') {
    return error(`Task "${task.title}" is ${task.status}, not pending or blocked. Cannot begin.`);
  }

  // Auto-assign if unassigned, or validate assignment
  if (task.agent_id && task.agent_id !== callerAgentId) {
    return error(`Task "${task.title}" is assigned to another agent.`);
  }

  // Transition to Programming or Researching (validates desk position)
  const targetState = mode === 'researching' ? 'Researching' : 'Programming';
  const result = transitionAgentState(callerAgentId, targetState as 'Programming' | 'Researching');

  if (!result.success) {
    return error(result.error!);
  }

  // Update task
  const simTime = simNow().toISOString();

  db.prepare(
    `UPDATE tasks SET status = 'in_progress', agent_id = ?, started_at = ?
     WHERE id = ?`,
  ).run(callerAgentId, simTime, taskId);

  console.log(`[begin_task] Agent ${callerAgentId} started "${task.title}" (${targetState})`);

  return ok({
    task_id: taskId,
    title: task.title,
    status: 'in_progress',
    state: targetState,
    sim_time: simTime,
    message: `Started working on "${task.title}" in ${targetState} mode.`,
  });
}

// ── complete_task ───────────────────────────────────────────────────

export async function handleCompleteTask(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const taskId = args.task_id as string;
  if (!taskId) return error('task_id is required');

  const db = getDb();

  // Look up the task
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
    | {
        id: string;
        title: string;
        status: string;
        agent_id: string | null;
        team_id: string;
      }
    | undefined;

  if (!task) return error(`Task "${taskId}" not found`);
  if (task.status !== 'in_progress') {
    return error(`Task "${task.title}" is ${task.status}, not in_progress. Cannot complete.`);
  }
  if (task.agent_id !== callerAgentId) {
    return error(`Task "${task.title}" is not assigned to you.`);
  }

  // Validate agent is in a working state
  const agent = db
    .prepare('SELECT state, name FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(callerAgentId) as { state: string; name: string } | undefined;

  if (!agent) return error('Agent not found');

  if (agent.state !== 'Programming' && agent.state !== 'Researching') {
    return error(
      `Cannot complete task: you are in ${agent.state} state. Must be Programming or Researching.`,
    );
  }

  // Mark task completed
  const simTime = simNow().toISOString();
  db.prepare(`UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?`).run(
    simTime,
    taskId,
  );

  // Transition agent to Idle
  transitionAgentState(callerAgentId, 'Idle');

  console.log(`[complete_task] ${agent.name} completed "${task.title}"`);

  // Fire Team Manager trigger
  triggerTMTaskComplete(task.team_id, callerAgentId, task.title);

  // Compress agent memory on task completion (fire-and-forget)
  runCompressionForAgent(callerAgentId, simNow()).catch((err) => {
    console.error(`[complete_task] Memory compression failed for ${callerAgentId}:`, err);
  });

  return ok({
    task_id: taskId,
    title: task.title,
    status: 'completed',
    sim_time: simTime,
    message: `Task "${task.title}" completed. Your Team Manager has been notified.`,
  });
}

// ── report_blocker ──────────────────────────────────────────────────

export async function handleReportBlocker(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const description = args.description as string;
  const taskId = (args.task_id as string) || null;
  if (!description) return error('description is required');

  const db = getDb();

  const agent = db
    .prepare('SELECT name, team_id, state FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(callerAgentId) as { name: string; team_id: string | null; state: string } | undefined;

  if (!agent) return error('Agent not found');

  // Transition to Blocked
  const result = transitionAgentState(callerAgentId, 'Blocked');
  if (!result.success) {
    return error(result.error!);
  }

  const simTime = simNow();

  // If a task_id was provided, set it to blocked
  if (taskId) {
    const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(taskId) as
      | { id: string; title: string }
      | undefined;

    if (task) {
      db.prepare(`UPDATE tasks SET status = 'blocked' WHERE id = ?`).run(taskId);
      console.log(`[report_blocker] ${agent.name} blocked on "${task.title}": ${description}`);
    }
  } else {
    console.log(`[report_blocker] ${agent.name} blocked: ${description}`);
  }

  // Create persistent blocker record
  const blockerId = createBlocker(callerAgentId, description, simTime, taskId ?? undefined);

  // Fire Team Manager trigger if agent has a team
  if (agent.team_id) {
    triggerTMBlockerReport(agent.team_id, callerAgentId, description, blockerId);
  }

  return ok({
    blocker_id: blockerId,
    status: 'blocked',
    description,
    task_id: taskId,
    sim_time: simTime.toISOString(),
    message: `Blocker reported. Your Team Manager has been notified.`,
  });
}

// ── REST helpers ────────────────────────────────────────────────────

export function getTasks(filters?: { status?: string; team_id?: string }): unknown[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    conditions.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters?.team_id) {
    conditions.push('t.team_id = ?');
    params.push(filters.team_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return db
    .prepare(
      `SELECT t.*, a.name as agent_name, tm.name as team_name, p.name as project_name
       FROM tasks t
       LEFT JOIN agents a ON t.agent_id = a.id
       LEFT JOIN teams tm ON t.team_id = tm.id
       LEFT JOIN projects p ON t.project_id = p.id
       ${where}
       ORDER BY t.priority DESC, t.created_at DESC`,
    )
    .all(...params);
}

export function getAgentTasks(agentId: string): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.*, tm.name as team_name, p.name as project_name
       FROM tasks t
       LEFT JOIN teams tm ON t.team_id = tm.id
       LEFT JOIN projects p ON t.project_id = p.id
       WHERE t.agent_id = ?
       ORDER BY t.created_at DESC`,
    )
    .all(agentId);
}

// ── Internal helpers ───────────────────────────────────────────────

function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

function error(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
  };
}
