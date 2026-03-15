import crypto from 'node:crypto';
import { getDb } from '../db.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createDailyScheduleForAgent, removeScheduleForAgent } from '../scheduler.js';

// ── Desk layout constants ──────────────────────────────────────────
// Desks are arranged in rows. Each team gets a block of desks.
// We pre-allocate a pool of desks when the server seeds the office.
const DESKS_PER_TEAM_BLOCK = 8;

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

// ── Onboarding room grid positions ──────────────────────────────────
// New hires spawn in a grid inside the onboarding room instead of stacking at (0,0,0)
const ONBOARDING_CENTER_X = -15;
const ONBOARDING_CENTER_Z = 15;
const ONBOARDING_GRID_SPACING = 1.8;
const ONBOARDING_GRID_COLS = 4;

function getOnboardingGridPosition(): { x: number; z: number } {
  const db = getDb();
  const count = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM agents
         WHERE desk_id IS NULL AND fired_at IS NULL AND role != 'office_manager'`,
      )
      .get() as { cnt: number }
  ).cnt;

  const col = count % ONBOARDING_GRID_COLS;
  const row = Math.floor(count / ONBOARDING_GRID_COLS);

  // Grid starts from top-left of room, offset from center
  const startX = ONBOARDING_CENTER_X - ((ONBOARDING_GRID_COLS - 1) * ONBOARDING_GRID_SPACING) / 2;
  const startZ = ONBOARDING_CENTER_Z - 2; // slightly above center

  return {
    x: startX + col * ONBOARDING_GRID_SPACING,
    z: startZ + row * ONBOARDING_GRID_SPACING,
  };
}

/** Reposition all unassigned agents into the onboarding grid. Called on boot. */
export function repositionUnassignedAgents(): void {
  const db = getDb();
  const unassigned = db
    .prepare(
      `SELECT id FROM agents
       WHERE desk_id IS NULL AND fired_at IS NULL AND role != 'office_manager'
       ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: string }>;

  if (unassigned.length === 0) return;

  const startX = ONBOARDING_CENTER_X - ((ONBOARDING_GRID_COLS - 1) * ONBOARDING_GRID_SPACING) / 2;
  const startZ = ONBOARDING_CENTER_Z - 2;

  for (let i = 0; i < unassigned.length; i++) {
    const col = i % ONBOARDING_GRID_COLS;
    const row = Math.floor(i / ONBOARDING_GRID_COLS);
    const x = startX + col * ONBOARDING_GRID_SPACING;
    const z = startZ + row * ONBOARDING_GRID_SPACING;
    db.prepare('UPDATE agents SET position_x = ?, position_z = ? WHERE id = ?').run(
      x,
      z,
      unassigned[i].id,
    );
  }
  console.log(`[restore] Positioned ${unassigned.length} unassigned agent(s) in onboarding room`);
}

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

  const spawn = getOnboardingGridPosition();
  db.prepare(
    `INSERT INTO agents (id, name, role, persona, team_id, desk_id, state, position_x, position_y, position_z, hired_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, 'Idle', ?, 0, ?, ?, ?, ?)`,
  ).run(agentId, persona.name, role, persona.system_prompt, spawn.x, spawn.z, simTime, now, now);

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

  const agent = db
    .prepare('SELECT * FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as
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

  const agent = db
    .prepare('SELECT * FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as
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
    return error(
      `No available desks in team "${team.name}". All ${DESKS_PER_TEAM_BLOCK} are occupied.`,
    );
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

  // Claim up to DESKS_PER_TEAM_BLOCK unassigned desks for this team.
  // Desks are pre-seeded at OM init in safe positions (northern grid).
  const available = db
    .prepare(
      `SELECT id FROM desks WHERE team_id IS NULL AND agent_id IS NULL
       ORDER BY position_z ASC, position_x ASC
       LIMIT ?`,
    )
    .all(DESKS_PER_TEAM_BLOCK) as Array<{ id: string }>;

  for (const desk of available) {
    db.prepare('UPDATE desks SET team_id = ? WHERE id = ?').run(teamId, desk.id);
  }

  if (available.length < DESKS_PER_TEAM_BLOCK) {
    console.warn(
      `[create_team] Only ${available.length} unassigned desks available (wanted ${DESKS_PER_TEAM_BLOCK})`,
    );
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

// ── assign desk (user action) ──────────────────────────────────────

export function handleAssignDesk(
  agentId: string,
  deskId: string,
): { success: boolean; error?: string; desk?: { x: number; z: number } } {
  const db = getDb();

  const agent = db
    .prepare('SELECT id, name, desk_id, team_id FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as
    | { id: string; name: string; desk_id: string | null; team_id: string | null }
    | undefined;

  if (!agent) return { success: false, error: 'Agent not found or has been fired' };

  const desk = db
    .prepare('SELECT id, position_x, position_z, agent_id, team_id FROM desks WHERE id = ?')
    .get(deskId) as
    | {
        id: string;
        position_x: number;
        position_z: number;
        agent_id: string | null;
        team_id: string | null;
      }
    | undefined;

  if (!desk) return { success: false, error: 'Desk not found' };

  if (desk.agent_id && desk.agent_id !== agentId) {
    return { success: false, error: 'Desk is already occupied' };
  }

  const now = new Date().toISOString();

  const assignTx = db.transaction(() => {
    // Free old desk if agent had one
    if (agent.desk_id) {
      db.prepare('UPDATE desks SET agent_id = NULL WHERE id = ?').run(agent.desk_id);
    }

    // Assign agent to desk and update position
    db.prepare(
      `UPDATE agents SET desk_id = ?, position_x = ?, position_y = 0, position_z = ?,
       team_id = COALESCE(?, team_id), updated_at = ? WHERE id = ?`,
    ).run(deskId, desk.position_x, desk.position_z, desk.team_id, now, agentId);

    // Mark desk as occupied
    db.prepare('UPDATE desks SET agent_id = ? WHERE id = ?').run(agentId, deskId);
  });

  assignTx();

  console.log(
    `[assign_desk] Assigned "${agent.name}" to desk ${deskId} at (${desk.position_x}, ${desk.position_z})`,
  );

  return { success: true, desk: { x: desk.position_x, z: desk.position_z } };
}

export function getAvailableDesks(teamId?: string): unknown[] {
  const db = getDb();
  if (teamId) {
    return db
      .prepare(
        `SELECT d.*, t.name as team_name, t.color as team_color
         FROM desks d
         LEFT JOIN teams t ON d.team_id = t.id
         WHERE d.agent_id IS NULL AND d.team_id = ?`,
      )
      .all(teamId);
  }
  return db
    .prepare(
      `SELECT d.*, t.name as team_name, t.color as team_color
       FROM desks d
       LEFT JOIN teams t ON d.team_id = t.id
       WHERE d.agent_id IS NULL`,
    )
    .all();
}

// ── delete team (user action) ──────────────────────────────────────

export function deleteTeam(teamId: string): { success: boolean; error?: string } {
  const db = getDb();

  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId) as
    | { id: string; name: string }
    | undefined;

  if (!team) return { success: false, error: 'Team not found' };

  // Check for active agents still on this team
  const activeAgents = (
    db
      .prepare('SELECT COUNT(*) as cnt FROM agents WHERE team_id = ? AND fired_at IS NULL')
      .get(teamId) as { cnt: number }
  ).cnt;

  if (activeAgents > 0) {
    return {
      success: false,
      error: `Cannot delete team "${team.name}" — ${activeAgents} active agent(s) still assigned. Reassign or fire them first.`,
    };
  }

  const deleteTx = db.transaction(() => {
    // Return desks to the unassigned pool (don't delete — they're pre-seeded)
    db.prepare('UPDATE desks SET team_id = NULL, agent_id = NULL WHERE team_id = ?').run(teamId);
    // Delete team
    db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  });

  deleteTx();
  console.log(`[delete_team] Deleted team "${team.name}" (${teamId})`);
  return { success: true };
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
