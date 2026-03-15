import crypto from 'node:crypto';
import { getDb } from './db.js';
import { startWalking, retargetWalking } from './movement.js';
import { transitionAgentState } from './state-machine.js';
import { registerJobHandler } from './scheduler.js';
import { providerManager } from './providers/manager.js';
import { SessionRecorder, getActiveSessionForAgent } from './session-recorder.js';
import { TOOL_DEFINITIONS, MANAGER_ONLY_TOOLS } from './mcp/tool-registry.js';

// ── Sim clock accessor ──────────────────────────────────────────────

let simNowFn: () => Date = () => new Date();

export function setMeetingSimClock(fn: () => Date): void {
  simNowFn = fn;
}

// ── Pending meeting state ────────────────────────────────────────────

interface PendingMeeting {
  id: string;
  facilitatorId: string;
  meetingRoomId: string;
  allParticipantIds: string[];
  arrivedAgentIds: Set<string>;
  agenda: string;
  conversationId: string;
}

const pendingMeetings = new Map<string, PendingMeeting>();
const agentToMeetingId = new Map<string, string>();

// ── Initialize meeting system ────────────────────────────────────────

export function initMeetingSystem(): void {
  registerJobHandler('meeting', handleMeetingJob);
}

// ── Meeting job handler ──────────────────────────────────────────────
// Fires when the scheduled meeting sim_time is reached.

function handleMeetingJob(
  agentId: string,
  payload: Record<string, unknown>,
  _simTime: Date,
): boolean {
  const meetingRoomId = payload.meeting_room_id as string;
  const invitedAgentIds = payload.invited_agent_ids as string[];
  const agenda = (payload.agenda as string) || 'Team meeting';

  if (!meetingRoomId || !invitedAgentIds || !Array.isArray(invitedAgentIds)) {
    console.error('[meetings] Invalid meeting payload:', payload);
    return true; // consumed — don't retry with bad data
  }

  const db = getDb();

  // Verify meeting room exists
  const room = db
    .prepare('SELECT id, name, position_x, position_z FROM meeting_rooms WHERE id = ?')
    .get(meetingRoomId) as
    | { id: string; name: string; position_x: number; position_z: number }
    | undefined;

  if (!room) {
    console.error(`[meetings] Meeting room "${meetingRoomId}" not found`);
    return true;
  }

  // If facilitator has an active session, queue the meeting for later
  if (getActiveSessionForAgent(agentId)) {
    console.log(`[meetings] Facilitator ${agentId} busy, queueing meeting`);
    return false;
  }

  // All participants = facilitator + invited (deduplicated)
  const participantSet = new Set([agentId, ...invitedAgentIds]);
  const allParticipantIds = [...participantSet];

  // Create the meeting conversation record
  const conversationId = crypto.randomUUID();
  const simTime = simNowFn().toISOString();
  const now = new Date().toISOString();

  const createTx = db.transaction(() => {
    db.prepare(
      'INSERT INTO conversations (id, type, location, sim_time_start, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(conversationId, 'meeting', room.name, simTime, now);

    for (const pid of allParticipantIds) {
      const role = pid === agentId ? 'facilitator' : 'speaker';
      db.prepare(
        'INSERT INTO conversation_participants (id, conversation_id, agent_id, role) VALUES (?, ?, ?, ?)',
      ).run(crypto.randomUUID(), conversationId, pid, role);
    }
  });
  createTx();

  // Create pending meeting
  const meetingId = crypto.randomUUID();
  const meeting: PendingMeeting = {
    id: meetingId,
    facilitatorId: agentId,
    meetingRoomId,
    allParticipantIds,
    arrivedAgentIds: new Set(),
    agenda,
    conversationId,
  };
  pendingMeetings.set(meetingId, meeting);

  for (const pid of allParticipantIds) {
    agentToMeetingId.set(pid, meetingId);
  }

  console.log(
    `[meetings] Meeting ${meetingId} in ${room.name}: walking ${allParticipantIds.length} agents`,
  );

  // Walk all participants to the meeting room
  for (const pid of allParticipantIds) {
    walkAgentToMeeting(pid, room.position_x, room.position_z, room.name, meetingId);
  }

  // Check if everyone already arrived (edge case: all failed to walk)
  checkAllArrived(meetingId);

  return true;
}

// ── Walk a single agent to the meeting room ──────────────────────────

function walkAgentToMeeting(
  agentId: string,
  roomX: number,
  roomZ: number,
  roomName: string,
  meetingId: string,
): void {
  const db = getDb();
  const agent = db
    .prepare('SELECT state FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as { state: string } | undefined;

  if (!agent) {
    markArrived(meetingId, agentId, 'not found');
    return;
  }

  const { state } = agent;

  // Already walking — retarget to meeting room
  if (state === 'Walking') {
    const retargeted = retargetWalking(agentId, roomX, roomZ, () =>
      onAgentArrivedAtMeeting(meetingId, agentId),
    );
    if (!retargeted) {
      // Not in active movements — force walk
      const result = startWalking(agentId, roomX, roomZ, `meeting room ${roomName}`, () =>
        onAgentArrivedAtMeeting(meetingId, agentId),
      );
      if (result.isError) markArrived(meetingId, agentId, `walk failed: ${state}`);
    }
    return;
  }

  // States that can't walk — skip agent, don't block meeting
  if (state === 'Blocked' || state === 'Departing') {
    markArrived(meetingId, agentId, `skipped: ${state}`);
    return;
  }

  // Idle, Programming, Researching, Reviewing, Meeting, Break, Arriving → Walking
  const result = startWalking(agentId, roomX, roomZ, `meeting room ${roomName}`, () =>
    onAgentArrivedAtMeeting(meetingId, agentId),
  );

  if (result.isError) {
    markArrived(meetingId, agentId, `walk failed from ${state}`);
  }
}

// ── Agent arrival callback ──────────────────────────────────────────

function onAgentArrivedAtMeeting(meetingId: string, agentId: string): void {
  const meeting = pendingMeetings.get(meetingId);
  if (!meeting) {
    // Meeting already started or cancelled — just go Idle
    transitionAgentState(agentId, 'Idle');
    return;
  }

  // Transition Walking → Meeting
  const result = transitionAgentState(agentId, 'Meeting');
  if (!result.success) {
    console.warn(`[meetings] ${agentId} failed to enter Meeting: ${result.error}`);
    // Try Idle as fallback — they still "arrived"
    transitionAgentState(agentId, 'Idle');
  }

  meeting.arrivedAgentIds.add(agentId);
  console.log(
    `[meetings] ${agentId} arrived (${meeting.arrivedAgentIds.size}/${meeting.allParticipantIds.length})`,
  );

  checkAllArrived(meetingId);
}

function markArrived(meetingId: string, agentId: string, reason: string): void {
  const meeting = pendingMeetings.get(meetingId);
  if (!meeting) return;
  console.warn(`[meetings] ${agentId} auto-arrived: ${reason}`);
  meeting.arrivedAgentIds.add(agentId);
}

// ── Check if all participants have arrived ──────────────────────────

function checkAllArrived(meetingId: string): void {
  const meeting = pendingMeetings.get(meetingId);
  if (!meeting) return;

  if (meeting.arrivedAgentIds.size < meeting.allParticipantIds.length) return;

  console.log(`[meetings] All agents arrived. Starting meeting ${meetingId}.`);
  startMeetingSession(meeting).catch((err) => {
    console.error(`[meetings] Failed to start meeting session:`, err);
    endMeeting(meeting);
  });
}

// ── Spawn the facilitator's meeting session ─────────────────────────

async function startMeetingSession(meeting: PendingMeeting): Promise<void> {
  // Remove from pending tracking
  pendingMeetings.delete(meeting.id);
  for (const pid of meeting.allParticipantIds) {
    agentToMeetingId.delete(pid);
  }

  const db = getDb();
  const facilitator = db
    .prepare('SELECT name, role FROM agents WHERE id = ?')
    .get(meeting.facilitatorId) as { name: string; role: string } | undefined;

  if (!facilitator) {
    console.error(`[meetings] Facilitator ${meeting.facilitatorId} not found`);
    endMeeting(meeting);
    return;
  }

  // Don't spawn if facilitator already has an active session
  if (getActiveSessionForAgent(meeting.facilitatorId)) {
    console.warn(
      `[meetings] Facilitator ${meeting.facilitatorId} already has active session, ending meeting`,
    );
    endMeeting(meeting);
    return;
  }

  const provider = providerManager.getProvider(meeting.facilitatorId);
  const model = providerManager.getModel(meeting.facilitatorId);
  const context = buildMeetingContext(meeting);
  const persona = buildMeetingPersona(facilitator.name);
  const mcpTools = Object.keys(TOOL_DEFINITIONS);

  console.log(`[meetings] Spawning meeting session for ${facilitator.name}`);

  const session = await provider.spawnSession({
    agentId: meeting.facilitatorId,
    systemPrompt: persona,
    context,
    mcpTools,
    provider: provider.name,
    model,
  });

  const recorder = new SessionRecorder(session, provider.name, model, simNowFn, 'Meeting');

  // When the session completes (normally or with error), end the meeting
  recorder.onComplete(() => endMeeting(meeting));
}

// ── Build meeting facilitator persona ───────────────────────────────

function buildMeetingPersona(facilitatorName: string): string {
  return `You are ${facilitatorName}, facilitating a team meeting.

Your role is to run this meeting efficiently:
- Present the agenda items
- Ask for updates from team members
- Address blockers and concerns
- Make decisions and assign follow-up actions
- Keep the meeting focused and productive

Communication rules (CRITICAL):
- Use the speak tool to address all meeting participants — everyone is in the meeting room and within proximity
- You do NOT need to walk_to_agent — all participants are already here
- Every speak call will be heard by all attendees

When the meeting is done, simply finish your session. All participants will return to their desks automatically.`;
}

// ── Build meeting context ────────────────────────────────────────────

function buildMeetingContext(meeting: PendingMeeting): string {
  const db = getDb();
  const simTime = simNowFn();
  const sections: string[] = [];

  sections.push(`Current sim time: ${simTime.toISOString()}`);
  sections.push(`## Meeting Agenda\n${meeting.agenda}`);

  // Participants
  const participants = meeting.allParticipantIds.map((id) => {
    const agent = db.prepare('SELECT name, role FROM agents WHERE id = ?').get(id) as
      | { name: string; role: string }
      | undefined;
    const label = id === meeting.facilitatorId ? '(facilitator)' : '';
    return agent ? `- **${agent.name}** (${id}): role=${agent.role} ${label}` : `- ${id}`;
  });
  sections.push('## Participants\n' + participants.join('\n'));

  // Team tasks
  const facilitatorTeam = db
    .prepare('SELECT team_id FROM agents WHERE id = ?')
    .get(meeting.facilitatorId) as { team_id: string | null } | undefined;

  if (facilitatorTeam?.team_id) {
    const tasks = db
      .prepare(
        `SELECT t.id, t.title, t.status, a.name as agent_name FROM tasks t
         LEFT JOIN agents a ON t.agent_id = a.id
         WHERE t.team_id = ?
         ORDER BY t.priority DESC, t.created_at DESC LIMIT 15`,
      )
      .all(facilitatorTeam.team_id) as Array<{
      id: string;
      title: string;
      status: string;
      agent_name: string | null;
    }>;

    if (tasks.length > 0) {
      sections.push(
        '## Team Tasks\n' +
          tasks
            .map((t) => `- [${t.status}] "${t.title}" (${t.id}) — ${t.agent_name ?? 'unassigned'}`)
            .join('\n'),
      );
    }

    // Open PRs
    const prs = db
      .prepare(
        `SELECT pr.id, pr.title, pr.status, a.name as author_name FROM pull_requests pr
         LEFT JOIN agents a ON pr.agent_id = a.id
         LEFT JOIN worktrees w ON pr.worktree_id = w.id
         WHERE w.team_id = ? AND pr.status IN ('open', 'approved')
         ORDER BY pr.created_at DESC LIMIT 10`,
      )
      .all(facilitatorTeam.team_id) as Array<{
      id: string;
      title: string;
      status: string;
      author_name: string | null;
    }>;

    if (prs.length > 0) {
      sections.push(
        '## Open Pull Requests\n' +
          prs
            .map((pr) => `- [${pr.status}] "${pr.title}" by ${pr.author_name ?? 'unknown'}`)
            .join('\n'),
      );
    }

    // Blocked agents
    const blocked = db
      .prepare(
        `SELECT a.id, a.name, b.description as blocker_desc FROM agents a
         LEFT JOIN blockers b ON b.agent_id = a.id AND b.status != 'resolved'
         WHERE a.team_id = ? AND a.state = 'Blocked' AND a.fired_at IS NULL`,
      )
      .all(facilitatorTeam.team_id) as Array<{
      id: string;
      name: string;
      blocker_desc: string | null;
    }>;

    if (blocked.length > 0) {
      sections.push(
        '## Blocked Agents\n' +
          blocked.map((a) => `- **${a.name}**: ${a.blocker_desc ?? 'Unknown blocker'}`).join('\n'),
      );
    }
  }

  // Available tools
  const generalTools = Object.entries(TOOL_DEFINITIONS)
    .filter(([, def]) => !def.managerOnly)
    .map(([name]) => name);
  const managerTools = [...MANAGER_ONLY_TOOLS];
  sections.push(
    `\n## Available Tools\nGeneral: ${generalTools.join(', ')}\nManager-only: ${managerTools.join(', ')}`,
  );

  return sections.join('\n\n');
}

// ── End meeting: close conversation, walk everyone back ─────────────

function endMeeting(meeting: PendingMeeting): void {
  const db = getDb();
  const simTime = simNowFn().toISOString();

  // Close the conversation record
  db.prepare('UPDATE conversations SET sim_time_end = ? WHERE id = ?').run(
    simTime,
    meeting.conversationId,
  );

  console.log(`[meetings] Meeting ${meeting.id} ended. Returning participants to desks.`);

  // Walk all Meeting-state participants back to their desks
  for (const agentId of meeting.allParticipantIds) {
    const agent = db
      .prepare('SELECT state, desk_id FROM agents WHERE id = ? AND fired_at IS NULL')
      .get(agentId) as { state: string; desk_id: string | null } | undefined;

    if (!agent) continue;

    // Only move agents who are still in Meeting state
    if (agent.state !== 'Meeting') continue;

    if (!agent.desk_id) {
      transitionAgentState(agentId, 'Idle');
      continue;
    }

    const desk = db
      .prepare('SELECT position_x, position_z FROM desks WHERE id = ?')
      .get(agent.desk_id) as { position_x: number; position_z: number } | undefined;

    if (!desk) {
      transitionAgentState(agentId, 'Idle');
      continue;
    }

    // Meeting → Walking → (arrive at desk) → Idle
    startWalking(agentId, desk.position_x, desk.position_z, 'desk');
  }
}

// ── Exported for testing / inspection ────────────────────────────────

export function getPendingMeetingCount(): number {
  return pendingMeetings.size;
}
