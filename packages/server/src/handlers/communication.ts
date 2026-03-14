import crypto from 'node:crypto';
import { getDb } from '../db.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getAgentsInProximity, isWithinProximity, startWalking } from '../movement.js';
import { transitionAgentState } from '../state-machine.js';

// ── Sim clock accessor (needed for onArrival callbacks) ─────────────

let simNowFn: () => Date = () => new Date();

export function setCommunicationSimClock(fn: () => Date): void {
  simNowFn = fn;
}

// ── Speak broadcast (WebSocket → all clients for chat bubbles) ──────

type SpeakBroadcastFn = (data: {
  agentId: string;
  agentName: string;
  message: string;
  listeners: Array<{ id: string; name: string }>;
}) => void;

let broadcastSpeakFn: SpeakBroadcastFn = () => {};

export function setSpeakBroadcast(fn: SpeakBroadcastFn): void {
  broadcastSpeakFn = fn;
}

// ── speak handler ───────────────────────────────────────────────────

export async function handleSpeak(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const message = args.message as string;
  if (!message?.trim()) return error('message is required');

  const db = getDb();

  const speaker = db
    .prepare('SELECT id, name, team_id FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(callerAgentId) as { id: string; name: string; team_id: string | null } | undefined;

  if (!speaker) return error('Speaker agent not found');

  // Enforce proximity — reject if no agents nearby
  const nearby = getAgentsInProximity(callerAgentId);

  if (nearby.length === 0) {
    console.warn(
      `[speak] Proximity violation: ${speaker.name} (${callerAgentId}) spoke with no agents nearby`,
    );
    return error('No agents within proximity. You must walk to an agent before speaking.');
  }

  const simTime = simNow().toISOString();
  const now = new Date().toISOString();

  // Record in chat_logs for the speaker
  db.prepare(
    'INSERT INTO chat_logs (id, agent_id, speaker_id, speaker_type, message, sim_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), callerAgentId, callerAgentId, 'agent', message, simTime, now);

  // Record in chat_logs for each listener
  for (const listener of nearby) {
    db.prepare(
      'INSERT INTO chat_logs (id, agent_id, speaker_id, speaker_type, message, sim_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(crypto.randomUUID(), listener.id, callerAgentId, 'agent', message, simTime, now);
  }

  // Record conversation
  recordConversation(
    callerAgentId,
    nearby.map((n) => n.id),
    message,
    simNow,
  );

  // Broadcast for UI chat bubbles
  broadcastSpeakFn({
    agentId: callerAgentId,
    agentName: speaker.name,
    message,
    listeners: nearby.map((n) => ({ id: n.id, name: n.name })),
  });

  console.log(
    `[speak] ${speaker.name} → ${nearby.map((n) => n.name).join(', ')}: "${message.slice(0, 80)}"`,
  );

  return ok({
    message: `Message delivered to ${nearby.length} agent(s) within proximity.`,
    listeners: nearby.map((n) => n.name),
  });
}

// ── send_to_manager handler ─────────────────────────────────────────

export async function handleSendToManager(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const message = args.message as string;
  if (!message?.trim()) return error('message is required');

  const db = getDb();

  const agent = db
    .prepare('SELECT id, name, team_id FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(callerAgentId) as { id: string; name: string; team_id: string | null } | undefined;

  if (!agent) return error('Agent not found');
  if (!agent.team_id) return error('You are not assigned to a team. Cannot send to manager.');

  const team = db
    .prepare('SELECT id, name, manager_id FROM teams WHERE id = ?')
    .get(agent.team_id) as { id: string; name: string; manager_id: string | null } | undefined;

  if (!team?.manager_id) {
    return error(`Team "${team?.name}" has no manager assigned.`);
  }

  const manager = db
    .prepare(
      'SELECT id, name, position_x, position_z FROM agents WHERE id = ? AND fired_at IS NULL',
    )
    .get(team.manager_id) as
    | { id: string; name: string; position_x: number; position_z: number }
    | undefined;

  if (!manager) return error('Team manager not found or has been fired');

  // If already within proximity, deliver immediately
  if (isWithinProximity(callerAgentId, manager.id)) {
    return deliverMessageToAgent(
      callerAgentId,
      agent.name,
      manager.id,
      manager.name,
      message,
      simNow,
    );
  }

  // Walk to manager, deliver on arrival via callback
  const walkResult = startWalking(
    callerAgentId,
    manager.position_x,
    manager.position_z,
    `manager ${manager.name}`,
    () => {
      // Default arrival behavior: transition Walking → Idle
      transitionAgentState(callerAgentId, 'Idle');
      // Then deliver the message (proximity guaranteed since we just arrived)
      deliverMessageToAgent(callerAgentId, agent.name, manager.id, manager.name, message, () =>
        simNowFn(),
      );
    },
  );

  if (walkResult.isError) return walkResult as CallToolResult;

  return ok({
    message: `Walking to manager ${manager.name}. Message will be delivered on arrival.`,
    manager_id: manager.id,
    manager_name: manager.name,
  });
}

// ── Message delivery helper ─────────────────────────────────────────

function deliverMessageToAgent(
  speakerId: string,
  speakerName: string,
  targetId: string,
  targetName: string,
  message: string,
  simNow: () => Date,
): CallToolResult {
  const db = getDb();
  const simTime = simNow().toISOString();
  const now = new Date().toISOString();

  // Verify proximity (enforced even after walk — manager may have moved)
  if (!isWithinProximity(speakerId, targetId)) {
    console.warn(
      `[send_to_manager] Proximity violation: ${speakerName} not within proximity of ${targetName} after arrival`,
    );
    return error(`Not within proximity of ${targetName}. They may have moved. Try again.`);
  }

  // Record in chat_logs for both agents
  db.prepare(
    'INSERT INTO chat_logs (id, agent_id, speaker_id, speaker_type, message, sim_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), speakerId, speakerId, 'agent', message, simTime, now);

  db.prepare(
    'INSERT INTO chat_logs (id, agent_id, speaker_id, speaker_type, message, sim_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), targetId, speakerId, 'agent', message, simTime, now);

  // Record conversation
  recordConversation(speakerId, [targetId], message, simNow);

  // Broadcast for UI
  broadcastSpeakFn({
    agentId: speakerId,
    agentName: speakerName,
    message,
    listeners: [{ id: targetId, name: targetName }],
  });

  console.log(`[send_to_manager] ${speakerName} → ${targetName}: "${message.slice(0, 80)}"`);

  return ok({
    message: `Message delivered to ${targetName}.`,
    delivered_to: targetName,
  });
}

// ── Conversation recording ──────────────────────────────────────────

function recordConversation(
  speakerId: string,
  listenerIds: string[],
  message: string,
  simNow: () => Date,
): void {
  const db = getDb();
  const simTime = simNow().toISOString();
  const now = new Date().toISOString();
  const allParticipants = [speakerId, ...listenerIds].sort();

  // Look for an active conversation with the same participants
  const activeConversation = findActiveConversation(allParticipants);

  if (activeConversation) {
    // Append message to existing conversation
    db.prepare(
      'INSERT INTO conversation_messages (id, conversation_id, speaker_id, speaker_type, message, sim_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(crypto.randomUUID(), activeConversation.id, speakerId, 'agent', message, simTime, now);
    return;
  }

  // Create a new conversation
  const conversationType = listenerIds.length === 1 ? 'one_on_one' : 'briefing';
  const conversationId = crypto.randomUUID();

  const createTx = db.transaction(() => {
    db.prepare(
      'INSERT INTO conversations (id, type, location, sim_time_start, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(conversationId, conversationType, 'office', simTime, now);

    // Add speaker as participant
    db.prepare(
      'INSERT INTO conversation_participants (id, conversation_id, agent_id, role) VALUES (?, ?, ?, ?)',
    ).run(crypto.randomUUID(), conversationId, speakerId, 'speaker');

    // Add listeners as participants
    for (const listenerId of listenerIds) {
      db.prepare(
        'INSERT INTO conversation_participants (id, conversation_id, agent_id, role) VALUES (?, ?, ?, ?)',
      ).run(crypto.randomUUID(), conversationId, listenerId, 'listener');
    }

    // Add the first message
    db.prepare(
      'INSERT INTO conversation_messages (id, conversation_id, speaker_id, speaker_type, message, sim_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(crypto.randomUUID(), conversationId, speakerId, 'agent', message, simTime, now);
  });

  createTx();
}

function findActiveConversation(participantIds: string[]): { id: string } | undefined {
  const db = getDb();
  const targetKey = participantIds.sort().join(',');

  // Get all active (un-ended) conversations
  const activeConvos = db
    .prepare('SELECT id FROM conversations WHERE sim_time_end IS NULL')
    .all() as Array<{ id: string }>;

  for (const convo of activeConvos) {
    const participants = db
      .prepare('SELECT agent_id FROM conversation_participants WHERE conversation_id = ?')
      .all(convo.id) as Array<{ agent_id: string }>;

    const convoKey = participants
      .map((p) => p.agent_id)
      .sort()
      .join(',');

    if (convoKey === targetKey) {
      return { id: convo.id };
    }
  }

  return undefined;
}

// ── REST helpers ────────────────────────────────────────────────────

export function getConversations(limit = 50, offset = 0): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*)
               FROM conversation_messages cm
               WHERE cm.conversation_id = c.id) as message_count
       FROM conversations c
       ORDER BY c.sim_time_start DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
}

export function getConversation(conversationId: string): unknown | undefined {
  const db = getDb();

  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);

  if (!conversation) return undefined;

  const participants = db
    .prepare(
      `SELECT cp.*, a.name as agent_name
       FROM conversation_participants cp
       JOIN agents a ON cp.agent_id = a.id
       WHERE cp.conversation_id = ?`,
    )
    .all(conversationId);

  const messages = db
    .prepare(
      `SELECT cm.*, a.name as speaker_name
       FROM conversation_messages cm
       LEFT JOIN agents a ON cm.speaker_id = a.id
       WHERE cm.conversation_id = ?
       ORDER BY cm.sim_time ASC`,
    )
    .all(conversationId);

  return {
    ...(conversation as Record<string, unknown>),
    participants,
    messages,
  };
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
