import { getDb } from './db.js';
import { transitionAgentState } from './state-machine.js';
import type { AgentState } from './state-machine.js';

// ── Config ─────────────────────────────────────────────────────────

const MOVEMENT_SPEED = 5; // units per sim-second
const ARRIVAL_THRESHOLD = 0.3; // distance to consider "arrived"
const RENDER_INTERVAL_MS = 16; // ~60 Hz for smooth client interpolation
const PROXIMITY_RADIUS = 2.5; // units — agents within this can hear speak

// Exit position — south wall center ("front door")
const EXIT_POSITION = { x: 0, y: 0, z: -19 };

// ── Types ──────────────────────────────────────────────────────────

interface MovementTarget {
  agentId: string;
  targetX: number;
  targetZ: number;
  onArrival?: () => void;
}

// ── Active movements ───────────────────────────────────────────────

const activeMovements = new Map<string, MovementTarget>();

// ── Sim clock accessor ─────────────────────────────────────────────

let simSpeedFn: () => number = () => 1;

export function setMovementSimClock(_fn: () => Date, speedFn: () => number): void {
  simSpeedFn = speedFn;
}

// ── WebSocket broadcast for position updates ───────────────────────

type PositionBroadcastFn = (data: {
  agentId: string;
  x: number;
  y: number;
  z: number;
  state: string;
  moving: boolean;
}) => void;

let broadcastPositionFn: PositionBroadcastFn = () => {};

export function setPositionBroadcast(fn: PositionBroadcastFn): void {
  broadcastPositionFn = fn;
}

/** Broadcast a one-off position update (e.g., agent moved off-screen). */
export function broadcastAgentPosition(
  agentId: string,
  x: number,
  y: number,
  z: number,
  state: string,
): void {
  broadcastPositionFn({ agentId, x, y, z, state, moving: false });
}

// ── Start movement render loop (decoupled from sim clock) ──────────
// Runs at ~60Hz real-time for smooth interpolation, regardless of sim speed.

let renderIntervalId: ReturnType<typeof setInterval> | null = null;
// Real-world timer for render loop — intentionally NOT sim time.
// Movement interpolation needs real-world deltas for smooth 60Hz animation.
let lastRenderTime = performance.now();

export function startMovementLoop(): void {
  if (renderIntervalId !== null) return;
  lastRenderTime = performance.now();
  renderIntervalId = setInterval(renderTick, RENDER_INTERVAL_MS);
}

export function stopMovementLoop(): void {
  if (renderIntervalId !== null) {
    clearInterval(renderIntervalId);
    renderIntervalId = null;
  }
}

function renderTick(): void {
  const now = performance.now();
  const realDeltaSec = (now - lastRenderTime) / 1000;
  lastRenderTime = now;

  // Scale movement by sim speed so agents move faster when sim is sped up
  const speed = simSpeedFn();
  const simDeltaSec = realDeltaSec * speed;
  const moveDistance = MOVEMENT_SPEED * simDeltaSec;

  if (activeMovements.size === 0) return;

  const db = getDb();

  for (const [agentId, target] of activeMovements) {
    const agent = db
      .prepare('SELECT position_x, position_z, state FROM agents WHERE id = ?')
      .get(agentId) as { position_x: number; position_z: number; state: string } | undefined;

    if (!agent || agent.state !== 'Walking') {
      activeMovements.delete(agentId);
      continue;
    }

    const dx = target.targetX - agent.position_x;
    const dz = target.targetZ - agent.position_z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= ARRIVAL_THRESHOLD) {
      // Arrived — snap to target and handle arrival
      db.prepare('UPDATE agents SET position_x = ?, position_z = ? WHERE id = ?').run(
        target.targetX,
        target.targetZ,
        agentId,
      );

      activeMovements.delete(agentId);

      // Fire arrival callback (e.g., transition to Idle) BEFORE broadcasting
      // so the broadcast includes the correct post-arrival state.
      if (target.onArrival) {
        target.onArrival();
      } else {
        // Default: transition Walking → Idle
        transitionAgentState(agentId, 'Idle');
      }

      // Read the actual state after transition for the broadcast
      const postState =
        (
          db.prepare('SELECT state FROM agents WHERE id = ?').get(agentId) as
            | { state: string }
            | undefined
        )?.state ?? 'Idle';

      broadcastPositionFn({
        agentId,
        x: target.targetX,
        y: 0,
        z: target.targetZ,
        state: postState,
        moving: false,
      });

      continue;
    }

    // Move toward target
    const ratio = Math.min(moveDistance / dist, 1);
    const newX = agent.position_x + dx * ratio;
    const newZ = agent.position_z + dz * ratio;

    db.prepare('UPDATE agents SET position_x = ?, position_z = ? WHERE id = ?').run(
      newX,
      newZ,
      agentId,
    );

    broadcastPositionFn({
      agentId,
      x: newX,
      y: 0,
      z: newZ,
      state: 'Walking',
      moving: true,
    });
  }
}

// ── Movement tool handlers ─────────────────────────────────────────

export async function handleWalkToDesk(
  args: Record<string, unknown>,
  callerAgentId: string,
  _simNow: () => Date,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const db = getDb();

  const agent = db
    .prepare('SELECT desk_id FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(callerAgentId) as { desk_id: string | null } | undefined;

  if (!agent?.desk_id) {
    return mcpError('You have no assigned desk. Get assigned to a team first.');
  }

  const desk = db
    .prepare('SELECT position_x, position_z FROM desks WHERE id = ?')
    .get(agent.desk_id) as { position_x: number; position_z: number };

  return startWalking(callerAgentId, desk.position_x, desk.position_z, 'desk');
}

export async function handleWalkToAgent(
  args: Record<string, unknown>,
  callerAgentId: string,
  _simNow: () => Date,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const targetAgentId = args.target_agent_id as string;
  if (!targetAgentId) return mcpError('target_agent_id is required');

  const db = getDb();
  const target = db
    .prepare('SELECT position_x, position_z, name FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(targetAgentId) as { position_x: number; position_z: number; name: string } | undefined;

  if (!target) return mcpError(`Agent "${targetAgentId}" not found`);

  return startWalking(callerAgentId, target.position_x, target.position_z, `agent ${target.name}`);
}

export async function handleWalkToMeetingRoom(
  args: Record<string, unknown>,
  callerAgentId: string,
  _simNow: () => Date,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const roomId = args.meeting_room_id as string;
  if (!roomId) return mcpError('meeting_room_id is required');

  const db = getDb();
  const room = db
    .prepare('SELECT position_x, position_z, name FROM meeting_rooms WHERE id = ?')
    .get(roomId) as { position_x: number; position_z: number; name: string } | undefined;

  if (!room) return mcpError(`Meeting room "${roomId}" not found`);

  return startWalking(callerAgentId, room.position_x, room.position_z, `meeting room ${room.name}`);
}

export async function handleWalkToExit(
  _args: Record<string, unknown>,
  callerAgentId: string,
  _simNow: () => Date,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return startWalking(callerAgentId, EXIT_POSITION.x, EXIT_POSITION.z, 'exit');
}

// ── set_state handler ──────────────────────────────────────────────

export async function handleSetState(
  args: Record<string, unknown>,
  callerAgentId: string,
  _simNow: () => Date,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const state = args.state as string;
  if (!state) return mcpError('state is required');

  const result = transitionAgentState(callerAgentId, state as AgentState);

  if (!result.success) {
    return mcpError(result.error!);
  }

  return mcpOk({ state, message: `Transitioned to ${state}.` });
}

// ── Proximity detection ────────────────────────────────────────────

export function getAgentsInProximity(
  agentId: string,
): Array<{ id: string; name: string; distance: number }> {
  const db = getDb();

  const agent = db
    .prepare('SELECT position_x, position_z FROM agents WHERE id = ?')
    .get(agentId) as { position_x: number; position_z: number } | undefined;

  if (!agent) return [];

  const nearby = db
    .prepare(
      `SELECT id, name, position_x, position_z FROM agents
       WHERE id != ? AND fired_at IS NULL`,
    )
    .all(agentId) as Array<{ id: string; name: string; position_x: number; position_z: number }>;

  return nearby
    .map((a) => {
      const dx = a.position_x - agent.position_x;
      const dz = a.position_z - agent.position_z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      return { id: a.id, name: a.name, distance };
    })
    .filter((a) => a.distance <= PROXIMITY_RADIUS)
    .sort((a, b) => a.distance - b.distance);
}

export function isWithinProximity(agentId: string, targetAgentId: string): boolean {
  const db = getDb();

  const agent = db
    .prepare('SELECT position_x, position_z FROM agents WHERE id = ?')
    .get(agentId) as { position_x: number; position_z: number } | undefined;

  const target = db
    .prepare('SELECT position_x, position_z FROM agents WHERE id = ?')
    .get(targetAgentId) as { position_x: number; position_z: number } | undefined;

  if (!agent || !target) return false;

  const dx = agent.position_x - target.position_x;
  const dz = agent.position_z - target.position_z;
  return Math.sqrt(dx * dx + dz * dz) <= PROXIMITY_RADIUS;
}

// ── Internal helpers ───────────────────────────────────────────────

export function startWalking(
  agentId: string,
  targetX: number,
  targetZ: number,
  destination: string,
  onArrival?: () => void,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  // Transition to Walking state
  const result = transitionAgentState(agentId, 'Walking');
  if (!result.success) {
    return mcpError(result.error!);
  }

  // Register the movement target
  activeMovements.set(agentId, {
    agentId,
    targetX,
    targetZ,
    onArrival,
  });

  return mcpOk({
    destination,
    targetX,
    targetZ,
    message: `Walking to ${destination}. You will arrive shortly.`,
  });
}

function mcpOk(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

function mcpError(message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

// ── Retarget a walking agent ────────────────────────────────────────
// Changes the destination and arrival callback for an agent already in
// the activeMovements map without going through a state transition.

export function retargetWalking(
  agentId: string,
  targetX: number,
  targetZ: number,
  onArrival?: () => void,
): boolean {
  const existing = activeMovements.get(agentId);
  if (!existing) return false;
  existing.targetX = targetX;
  existing.targetZ = targetZ;
  existing.onArrival = onArrival;
  return true;
}

export { PROXIMITY_RADIUS, MOVEMENT_SPEED };
