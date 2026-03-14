import crypto from 'node:crypto';
import { getDb } from '../db.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createDailyScheduleForAgent, removeScheduleForAgent } from '../scheduler.js';

// ── Desk layout constants ──────────────────────────────────────────
// Desks are arranged in rows. Each team gets a block of desks.
// We pre-allocate a pool of desks when the server seeds the office.
const DESKS_PER_TEAM_BLOCK = 8;
const DESK_SPACING_X = 3;
const DESK_SPACING_Z = 3;
const DESK_START_X = 5;
const DESK_START_Z = 5;

// Team color palette — visually distinct, avoids red (reserved for Blocked)
const TEAM_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#8B5CF6', // violet
  '#F59E0B', // amber
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#84CC16', // lime
  '#F97316', // orange
];

// ── hire_agent ─────────────────────────────────────────────────────

export async function handleHireAgent(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const personaId = args.persona_id as string;
  if (!personaId) {
    return error('persona_id is required');
  }

  const db = getDb();

  // Look up the persona
  const persona = db.prepare('SELECT * FROM personas WHERE id = ?').get(personaId) as
    | {
        id: string;
        name: string;
        github_username: string;
        bio: string;
        system_prompt: string;
        specialties: string;
      }
    | undefined;

  if (!persona) {
    return error(`Persona "${personaId}" not found`);
  }

  const agentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const simTime = simNow().toISOString();
  const role = (args.role as string) === 'team_manager' ? 'team_manager' : 'agent';

  db.prepare(
    `INSERT INTO agents (id, name, role, persona, team_id, desk_id, state, position_x, position_y, position_z, hired_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'Idle', 0, 0, 0, ?, ?, ?)`,
  ).run(agentId, persona.name, role, persona.system_prompt, simTime, now, now);

  // Create the four daily scheduled jobs (arrive, lunch, return, depart)
  createDailyScheduleForAgent(agentId, simNow());

  console.log(`[hire_agent] Hired "${persona.name}" (${agentId}) by ${callerAgentId}`);

  return ok({
    agent_id: agentId,
    name: persona.name,
    persona_id: personaId,
    state: 'Idle',
    message: `Agent "${persona.name}" has been hired and is idle with no team, no desk, and no knowledge.`,
  });
}

// ── fire_agent ─────────────────────────────────────────────────────

export async function handleFireAgent(
  args: Record<string, unknown>,
  _callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const agentId = args.agent_id as string;
  if (!agentId) {
    return error('agent_id is required');
  }

  const db = getDb();

  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND fired_at IS NULL').get(agentId) as
    | { id: string; name: string; role: string; desk_id: string | null; team_id: string | null }
    | undefined;

  if (!agent) {
    return error(`Agent "${agentId}" not found or already fired`);
  }

  if (agent.role === 'office_manager') {
    return error('Cannot fire the Office Manager');
  }

  const now = new Date().toISOString();
  const simTime = simNow().toISOString();

  const fireTx = db.transaction(() => {
    // Free up the desk
    if (agent.desk_id) {
      db.prepare('UPDATE desks SET agent_id = NULL WHERE id = ?').run(agent.desk_id);
    }

    // Remove team manager reference if this agent is a team manager
    if (agent.role === 'team_manager' && agent.team_id) {
      db.prepare('UPDATE teams SET manager_id = NULL WHERE manager_id = ?').run(agentId);
    }

    // Update agent record
    db.prepare(
      `UPDATE agents SET fired_at = ?, state = 'Departing', team_id = NULL, desk_id = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(simTime, now, agentId);
  });

  fireTx();

  // Remove all scheduled jobs for this agent
  removeScheduleForAgent(agentId);

  console.log(`[fire_agent] Fired "${agent.name}" (${agentId})`);

  return ok({
    agent_id: agentId,
    name: agent.name,
    state: 'Departing',
    message: `Agent "${agent.name}" has been fired and is departing.`,
  });
}

// ── create_team ────────────────────────────────────────────────────

export async function handleCreateTeam(
  args: Record<string, unknown>,
  _callerAgentId: string,
  _simNow: () => Date,
): Promise<CallToolResult> {
  const name = args.name as string;
  const color = args.color as string;

  if (!name) return error('name is required');
  if (!color) return error('color is required');

  // Validate hex color
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    return error('color must be a valid hex color (e.g. #3B82F6)');
  }

  const db = getDb();
  const teamId = crypto.randomUUID();
  const now = new Date().toISOString();

  const createTx = db.transaction(() => {
    db.prepare('INSERT INTO teams (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
      teamId,
      name,
      color,
      now,
    );

    // Allocate a block of desks for this team
    allocateDesksForTeam(teamId);
  });

  createTx();

  console.log(`[create_team] Created team "${name}" (${teamId}) with color ${color}`);

  return ok({
    team_id: teamId,
    name,
    color,
    message: `Team "${name}" created with ${DESKS_PER_TEAM_BLOCK} desk slots.`,
  });
}

// ── assign_agent_to_team ───────────────────────────────────────────

export async function handleAssignAgentToTeam(
  args: Record<string, unknown>,
  _callerAgentId: string,
  _simNow: () => Date,
): Promise<CallToolResult> {
  const agentId = args.agent_id as string;
  const teamId = args.team_id as string;

  if (!agentId) return error('agent_id is required');
  if (!teamId) return error('team_id is required');

  const db = getDb();

  const agent = db.prepare('SELECT * FROM agents WHERE id = ? AND fired_at IS NULL').get(agentId) as
    | { id: string; name: string; role: string; desk_id: string | null; team_id: string | null }
    | undefined;

  if (!agent) {
    return error(`Agent "${agentId}" not found or has been fired`);
  }

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as
    | { id: string; name: string }
    | undefined;

  if (!team) {
    return error(`Team "${teamId}" not found`);
  }

  // Find an available desk in this team's block
  const desk = db
    .prepare('SELECT id, position_x, position_z FROM desks WHERE team_id = ? AND agent_id IS NULL')
    .get(teamId) as { id: string; position_x: number; position_z: number } | undefined;

  if (!desk) {
    return error(`No available desks in team "${team.name}". All ${DESKS_PER_TEAM_BLOCK} are occupied.`);
  }

  const now = new Date().toISOString();

  const assignTx = db.transaction(() => {
    // Free old desk if agent had one
    if (agent.desk_id) {
      db.prepare('UPDATE desks SET agent_id = NULL WHERE id = ?').run(agent.desk_id);
    }

    // Assign agent to team and new desk
    db.prepare(
      `UPDATE agents SET team_id = ?, desk_id = ?, position_x = ?, position_y = 0, position_z = ?, updated_at = ?
       WHERE id = ?`,
    ).run(teamId, desk.id, desk.position_x, desk.position_z, now, agentId);

    // Mark desk as occupied
    db.prepare('UPDATE desks SET agent_id = ? WHERE id = ?').run(agentId, desk.id);

    // If this is a team manager, set them as the team's manager
    if (agent.role === 'team_manager') {
      db.prepare('UPDATE teams SET manager_id = ? WHERE id = ?').run(agentId, teamId);
    }
  });

  assignTx();

  console.log(
    `[assign_agent_to_team] Assigned "${agent.name}" (${agentId}) to team "${team.name}" at desk ${desk.id}`,
  );

  return ok({
    agent_id: agentId,
    team_id: teamId,
    desk_id: desk.id,
    desk_position: { x: desk.position_x, z: desk.position_z },
    message: `Agent "${agent.name}" assigned to team "${team.name}" at desk (${desk.position_x}, ${desk.position_z}).`,
  });
}

// ── Desk allocation ────────────────────────────────────────────────

function allocateDesksForTeam(teamId: string): void {
  const db = getDb();

  // Count existing team blocks to determine row placement
  const teamCount = (
    db.prepare('SELECT COUNT(DISTINCT team_id) as cnt FROM desks WHERE team_id IS NOT NULL').get() as {
      cnt: number;
    }
  ).cnt;

  const rowZ = DESK_START_Z + teamCount * DESK_SPACING_Z * 2;

  for (let i = 0; i < DESKS_PER_TEAM_BLOCK; i++) {
    const deskId = crypto.randomUUID();
    const x = DESK_START_X + i * DESK_SPACING_X;
    db.prepare(
      'INSERT INTO desks (id, position_x, position_y, position_z, team_id) VALUES (?, ?, 0, ?, ?)',
    ).run(deskId, x, rowZ, teamId);
  }
}

// ── REST helpers ───────────────────────────────────────────────────

export function getAgents(): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.*, t.name as team_name, t.color as team_color
       FROM agents a
       LEFT JOIN teams t ON a.team_id = t.id
       ORDER BY a.created_at DESC`,
    )
    .all();
}

export function getAgent(agentId: string): unknown | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.*, t.name as team_name, t.color as team_color
       FROM agents a
       LEFT JOIN teams t ON a.team_id = t.id
       WHERE a.id = ?`,
    )
    .get(agentId);
}

export function getTeams(): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM agents a WHERE a.team_id = t.id AND a.fired_at IS NULL) as agent_count
       FROM teams t
       ORDER BY t.created_at DESC`,
    )
    .all();
}

export function getTeam(teamId: string): unknown | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM agents a WHERE a.team_id = t.id AND a.fired_at IS NULL) as agent_count
       FROM teams t
       WHERE t.id = ?`,
    )
    .get(teamId);
}

export function getDesks(teamId?: string): unknown[] {
  const db = getDb();
  if (teamId) {
    return db
      .prepare(
        `SELECT d.*, a.name as agent_name
         FROM desks d
         LEFT JOIN agents a ON d.agent_id = a.id
         WHERE d.team_id = ?`,
      )
      .all(teamId);
  }
  return db
    .prepare(
      `SELECT d.*, a.name as agent_name, t.name as team_name
       FROM desks d
       LEFT JOIN agents a ON d.agent_id = a.id
       LEFT JOIN teams t ON d.team_id = t.id`,
    )
    .all();
}

/** Exported for use by other modules that need the palette */
export { TEAM_COLORS };

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
