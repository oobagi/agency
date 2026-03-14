import { getDb } from './db.js';
import { onAgentStateChange } from './team-manager.js';

// ── Activity broadcast (state changes → WebSocket clients) ─────────

type ActivityBroadcastFn = (data: {
  category: string;
  agentId: string;
  agentName: string;
  description: string;
  simTime: string;
}) => void;

let broadcastActivityFn: ActivityBroadcastFn = () => {};

export function setActivityBroadcast(fn: ActivityBroadcastFn): void {
  broadcastActivityFn = fn;
}

export function broadcastActivity(
  category: string,
  agentId: string,
  description: string,
  simTime: string,
): void {
  const db = getDb();
  const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId) as
    | { name: string }
    | undefined;
  broadcastActivityFn({
    category,
    agentId,
    agentName: agent?.name ?? 'Unknown',
    description,
    simTime,
  });
}

// ── Agent states ───────────────────────────────────────────────────

export type AgentState =
  | 'Idle'
  | 'Arriving'
  | 'Walking'
  | 'Researching'
  | 'Programming'
  | 'Reviewing'
  | 'Meeting'
  | 'Break'
  | 'Departing'
  | 'Blocked';

// ── Transition map (explicit data structure) ───────────────────────

const TRANSITION_MAP: Record<AgentState, AgentState[]> = {
  Idle: [
    'Walking',
    'Programming',
    'Researching',
    'Reviewing',
    'Meeting',
    'Departing',
    'Break',
    'Blocked',
  ],
  Arriving: ['Walking', 'Idle'],
  Walking: ['Idle', 'Meeting', 'Blocked', 'Departing'],
  Researching: ['Idle', 'Walking', 'Blocked', 'Break'],
  Programming: ['Idle', 'Walking', 'Blocked', 'Break'],
  Reviewing: ['Idle', 'Walking', 'Blocked'],
  Meeting: ['Idle', 'Walking', 'Blocked'],
  Break: ['Walking', 'Idle', 'Departing'],
  Departing: ['Arriving'],
  Blocked: ['Idle'],
};

// ── Validate a state transition ────────────────────────────────────

export function isValidTransition(from: AgentState, to: AgentState): boolean {
  const allowed = TRANSITION_MAP[from];
  return allowed ? allowed.includes(to) : false;
}

// ── Transition an agent's state with full validation ───────────────

export function transitionAgentState(
  agentId: string,
  newState: AgentState,
): { success: boolean; error?: string } {
  const db = getDb();

  const agent = db
    .prepare(
      'SELECT state, desk_id, position_x, position_y, position_z FROM agents WHERE id = ? AND fired_at IS NULL',
    )
    .get(agentId) as
    | {
        state: AgentState;
        desk_id: string | null;
        position_x: number;
        position_y: number;
        position_z: number;
      }
    | undefined;

  if (!agent) {
    return { success: false, error: `Agent "${agentId}" not found or fired` };
  }

  const oldState = agent.state;

  // Check transition map
  if (!isValidTransition(oldState, newState)) {
    return {
      success: false,
      error: `Invalid transition: ${oldState} → ${newState}. Allowed from ${oldState}: ${TRANSITION_MAP[oldState].join(', ')}`,
    };
  }

  // Position enforcement: Programming/Researching require being at assigned desk
  if (newState === 'Programming' || newState === 'Researching') {
    if (!agent.desk_id) {
      return { success: false, error: `Cannot enter ${newState}: no desk assigned` };
    }

    const desk = db
      .prepare('SELECT position_x, position_z FROM desks WHERE id = ?')
      .get(agent.desk_id) as { position_x: number; position_z: number } | undefined;

    if (desk) {
      const dx = Math.abs(agent.position_x - desk.position_x);
      const dz = Math.abs(agent.position_z - desk.position_z);
      if (dx > 0.5 || dz > 0.5) {
        return {
          success: false,
          error: `Cannot enter ${newState}: not at desk. Walk to your desk first.`,
        };
      }
    }
  }

  // Position enforcement: Meeting requires being in a meeting room
  if (newState === 'Meeting') {
    const inMeetingRoom = db
      .prepare(
        `SELECT id FROM meeting_rooms
         WHERE ABS(position_x - ?) < 2 AND ABS(position_z - ?) < 2`,
      )
      .get(agent.position_x, agent.position_z);

    if (!inMeetingRoom) {
      return { success: false, error: 'Cannot enter Meeting: not in a meeting room' };
    }
  }

  // Apply the transition
  const now = new Date().toISOString();
  db.prepare('UPDATE agents SET state = ?, updated_at = ? WHERE id = ?').run(
    newState,
    now,
    agentId,
  );

  onAgentStateChange(agentId, oldState, newState);

  // Broadcast state change as activity event
  const agentRow = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId) as
    | { name: string }
    | undefined;
  broadcastActivityFn({
    category: 'state',
    agentId,
    agentName: agentRow?.name ?? 'Unknown',
    description: `${oldState} → ${newState}`,
    simTime: now,
  });

  return { success: true };
}

// ── Exported for reference ─────────────────────────────────────────

export { TRANSITION_MAP };
