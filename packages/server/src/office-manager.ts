import crypto from 'node:crypto';
import { getDb } from './db.js';
import { providerManager } from './providers/manager.js';
import { SessionRecorder, claimSessionSlot, releaseSessionSlot } from './session-recorder.js';
import { registerJobHandler, createDailyScheduleForAgent } from './scheduler.js';
import { TOOL_DEFINITIONS, MANAGER_ONLY_TOOLS } from './mcp/tool-registry.js';
import { buildSessionContext } from './context-assembly.js';

// ── Office Manager persona (system agent, not from agency-agents repo) ─

const OFFICE_MANAGER_PERSONA = `You are the Office Manager of a software development office.

You manage the office: hire agents, create teams, create projects, assign teams to projects, and delegate work. You have global visibility across all projects, teams, and agents.

You are the top of the management hierarchy. Team Managers report to you. Regular agents report to their Team Managers. You are the only agent who can communicate across team boundaries.

CRITICAL RULES — follow these exactly:
- NEVER hire agents, create teams, or create projects unless the user explicitly asks you to.
- When the user has not given you a task, simply greet them or check in briefly. Do NOT take action on your own.
- Your scheduled sessions (morning, midday, EOD) are for checking on existing work, not for creating new work.
- Keep responses short and natural. Do not repeat your introduction or role description.

When the user asks you to do something:
- Create projects when the user provides a goal or project idea
- Hire agents with appropriate personas for the work needed
- Create teams and assign agents to them
- Delegate work to Team Managers
- Address unresolved blockers that Team Managers escalate to you

Blocker handling:
- If a Team Manager escalates a blocker to you and you can resolve it, call resolve_blocker.
- If you cannot resolve it (e.g., missing CLI auth, missing system permissions), call mark_blocker_user_facing to notify the user.

When you hire an agent, they know NOTHING — only their persona. They must be briefed by their Team Manager before they can do meaningful work.

After hiring agents, walk to the Onboarding Room (use walk_to_meeting_room with room_id "room-onboarding") to greet and brief new hires. Then assign them to a team using assign_agent_to_team — this automatically places them at a desk in the team's block.`;

// ── Sim clock accessor ─────────────────────────────────────────────

let simNowFn: () => Date = () => new Date();

export function setOfficeManagerSimClock(fn: () => Date): void {
  simNowFn = fn;
}

// ── Office Manager ID ──────────────────────────────────────────────

let officeManagerId: string | null = null;

export function getOfficeManagerId(): string | null {
  return officeManagerId;
}

// ── Initialize Office Manager ──────────────────────────────────────

export function initOfficeManager(): void {
  const db = getDb();

  // Check if an Office Manager already exists
  const existing = db
    .prepare("SELECT id FROM agents WHERE role = 'office_manager' AND fired_at IS NULL")
    .get() as { id: string } | undefined;

  if (existing) {
    officeManagerId = existing.id;
    console.log(`[office-manager] Existing Office Manager: ${officeManagerId}`);
  } else {
    // Create the Office Manager
    officeManagerId = crypto.randomUUID();
    const now = new Date().toISOString();
    const simTime = simNowFn().toISOString();

    db.prepare(
      `INSERT INTO agents (id, name, role, persona, state, position_x, position_y, position_z, hired_at, created_at, updated_at)
       VALUES (?, 'Office Manager', 'office_manager', ?, 'Idle', -15, 0, 15, ?, ?, ?)`,
    ).run(officeManagerId, OFFICE_MANAGER_PERSONA, simTime, now, now);

    // Seed a row of management desks (unassigned, available for OM and future use)
    const existingDesks = db
      .prepare('SELECT COUNT(*) as cnt FROM desks WHERE team_id IS NULL')
      .get() as { cnt: number };
    if (existingDesks.cnt === 0) {
      const deskInsert = db.prepare(
        'INSERT INTO desks (id, position_x, position_y, position_z, team_id) VALUES (?, ?, 0, ?, NULL)',
      );
      for (let i = 0; i < 4; i++) {
        deskInsert.run(crypto.randomUUID(), -4 + i * 3, -5);
      }
      console.log('[office-manager] Seeded 4 management desks');
    }

    // Create daily schedule for the Office Manager (standard arrive/lunch/depart)
    createDailyScheduleForAgent(officeManagerId, simNowFn());

    console.log(`[office-manager] Created Office Manager: ${officeManagerId}`);
  }

  // Register the three OM session job handlers
  registerJobHandler('morning_planning', handleOMSession);
  registerJobHandler('midday_check', handleOMSession);
  registerJobHandler('eod_review', handleOMSession);

  // Ensure the three OM scheduled jobs exist
  ensureOMScheduledJobs(officeManagerId);
}

// ── Ensure OM scheduled jobs exist ─────────────────────────────────

function ensureOMScheduledJobs(omId: string): void {
  const db = getDb();

  const omJobTypes = [
    { jobType: 'morning_planning', hour: 8, minute: 5 },
    { jobType: 'midday_check', hour: 13, minute: 5 },
    { jobType: 'eod_review', hour: 17, minute: 0 },
  ];

  for (const item of omJobTypes) {
    const existing = db
      .prepare('SELECT id FROM scheduled_jobs WHERE agent_id = ? AND job_type = ?')
      .get(omId, item.jobType);

    if (!existing) {
      const simTime = simNowFn();
      const jobTime = new Date(simTime);
      jobTime.setUTCHours(item.hour, item.minute, 0, 0);

      // If past today, schedule for tomorrow
      if (jobTime.getTime() <= simTime.getTime()) {
        jobTime.setUTCDate(jobTime.getUTCDate() + 1);
      }

      db.prepare(
        `INSERT INTO scheduled_jobs (id, agent_id, job_type, sim_time, recurrence, missed_policy, payload, created_at)
         VALUES (?, ?, ?, ?, 'daily', 'fire_immediately', '{}', ?)`,
      ).run(
        crypto.randomUUID(),
        omId,
        item.jobType,
        jobTime.toISOString(),
        new Date().toISOString(),
      );

      console.log(`[office-manager] Scheduled ${item.jobType} at ${jobTime.toISOString()}`);
    }
  }
}

// ── OM session job handler ─────────────────────────────────────────

function handleOMSession(
  agentId: string,
  _payload: Record<string, unknown>,
  _simTime: Date,
): boolean {
  if (!claimSessionSlot(agentId)) {
    console.log(`[office-manager] ${agentId} already has active/spawning session, skipping`);
    return true;
  }

  // Fire-and-forget: spawn the session asynchronously
  spawnOMSession(agentId).catch((err) => {
    releaseSessionSlot(agentId);
    console.error('[office-manager] Session spawn failed:', err);
  });
  return true;
}

// ── Spawn an Office Manager session ────────────────────────────────

async function spawnOMSession(omId: string): Promise<void> {
  const provider = providerManager.getProvider(omId);
  const model = providerManager.getModel(omId);
  const context = buildOMContext(omId);

  // All tools the OM can access (general + manager-only)
  const mcpTools = Object.keys(TOOL_DEFINITIONS);

  console.log(`[office-manager] Spawning session (model=${model})`);

  try {
    const session = await provider.spawnSession({
      agentId: omId,
      systemPrompt: OFFICE_MANAGER_PERSONA,
      context,
      mcpTools,
      provider: provider.name,
      model,
    });

    // Record the session (constructor releases spawning guard)
    new SessionRecorder(session, provider.name, model, simNowFn);
  } catch (err) {
    releaseSessionSlot(omId);
    throw err;
  }
}

// ── Build Office Manager context ───────────────────────────────────

function buildOMContext(omId: string): string {
  const db = getDb();
  const simTime = simNowFn();
  const sections: string[] = [];

  sections.push(`Current sim time: ${simTime.toISOString()}`);
  sections.push(`Sim day: ${simTime.toISOString().split('T')[0]}`);

  // Projects
  const projects = db.prepare('SELECT * FROM projects').all() as Array<{
    id: string;
    name: string;
    description: string;
    repo_path: string;
  }>;
  if (projects.length > 0) {
    sections.push(
      '## Projects\n' +
        projects
          .map(
            (p) =>
              `- **${p.name}** (${p.id}): ${p.description || 'No description'} — repo: ${p.repo_path}`,
          )
          .join('\n'),
    );
  } else {
    sections.push('## Projects\nNo projects exist yet.');
  }

  // Teams
  const teams = db
    .prepare(
      `SELECT t.*, a.name as manager_name,
              (SELECT COUNT(*) FROM agents ag WHERE ag.team_id = t.id AND ag.fired_at IS NULL) as agent_count
       FROM teams t
       LEFT JOIN agents a ON t.manager_id = a.id`,
    )
    .all() as Array<{
    id: string;
    name: string;
    color: string;
    project_id: string | null;
    manager_name: string | null;
    agent_count: number;
  }>;
  if (teams.length > 0) {
    sections.push(
      '## Teams\n' +
        teams
          .map(
            (t) =>
              `- **${t.name}** (${t.id}): color=${t.color}, manager=${t.manager_name ?? 'none'}, ` +
              `agents=${t.agent_count}, project=${t.project_id ?? 'none'}`,
          )
          .join('\n'),
    );
  } else {
    sections.push('## Teams\nNo teams exist yet.');
  }

  // Agents (excluding self)
  const agents = db
    .prepare(
      `SELECT a.*, t.name as team_name FROM agents a
       LEFT JOIN teams t ON a.team_id = t.id
       WHERE a.id != ? AND a.fired_at IS NULL`,
    )
    .all(omId) as Array<{
    id: string;
    name: string;
    role: string;
    state: string;
    team_name: string | null;
    desk_id: string | null;
  }>;
  if (agents.length > 0) {
    sections.push(
      '## Agents\n' +
        agents
          .map(
            (a) =>
              `- **${a.name}** (${a.id}): role=${a.role}, state=${a.state}, ` +
              `team=${a.team_name ?? 'unassigned'}, desk=${a.desk_id ? 'yes' : 'no'}`,
          )
          .join('\n'),
    );
  } else {
    sections.push('## Agents\nNo other agents exist. Consider hiring some.');
  }

  // Agents in onboarding (no team/desk)
  const onboardingAgents = db
    .prepare(
      `SELECT id, name, role FROM agents
       WHERE desk_id IS NULL AND team_id IS NULL AND fired_at IS NULL AND role != 'office_manager'
       ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: string; name: string; role: string }>;
  if (onboardingAgents.length > 0) {
    sections.push(
      '## Agents in Onboarding Room\n' +
        'These agents have been hired but are not yet assigned to a team. ' +
        'Walk to the Onboarding Room (room_id: "room-onboarding") to greet them, ' +
        'then assign them to a team.\n' +
        onboardingAgents.map((a) => `- **${a.name}** (${a.id}) — role: ${a.role}`).join('\n'),
    );
  }

  // Unresolved blockers (from blockers table, showing escalation details)
  const openBlockers = db
    .prepare(
      `SELECT b.*, a.name as agent_name, t.name as team_name
       FROM blockers b
       LEFT JOIN agents a ON b.agent_id = a.id
       LEFT JOIN agents a2 ON a.team_id = a2.team_id
       LEFT JOIN teams t ON a.team_id = t.id
       WHERE b.status IN ('escalated_to_om', 'user_facing')
       ORDER BY b.created_at DESC`,
    )
    .all() as Array<{
    id: string;
    agent_name: string;
    description: string;
    status: string;
    escalation_history: string;
    team_name: string | null;
  }>;
  if (openBlockers.length > 0) {
    sections.push(
      '## Blockers Escalated to You\n' +
        openBlockers
          .map(
            (b) =>
              `- blocker_id: ${b.id} — Agent **${b.agent_name}** (team: ${b.team_name ?? 'none'}): "${b.description}" [status: ${b.status}]`,
          )
          .join('\n'),
    );
  }

  // Also show any blocked agents not yet in blockers table
  const blockedAgents = db
    .prepare(
      `SELECT a.id, a.name FROM agents a
       WHERE a.state = 'Blocked' AND a.fired_at IS NULL
       AND a.id NOT IN (SELECT agent_id FROM blockers WHERE status != 'resolved')`,
    )
    .all() as Array<{ id: string; name: string }>;
  if (blockedAgents.length > 0) {
    sections.push(
      '## Other Blocked Agents\n' +
        blockedAgents
          .map((a) => `- **${a.name}** (${a.id}) is BLOCKED (no blocker record)`)
          .join('\n'),
    );
  }

  // Pending tasks
  const pendingTasks = db
    .prepare(
      `SELECT t.*, tm.name as team_name FROM tasks t
       LEFT JOIN teams tm ON t.team_id = tm.id
       WHERE t.status IN ('pending', 'blocked')
       ORDER BY t.priority DESC LIMIT 20`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: string;
    team_name: string | null;
    agent_id: string | null;
  }>;
  if (pendingTasks.length > 0) {
    sections.push(
      '## Pending/Blocked Tasks\n' +
        pendingTasks
          .map(
            (t) =>
              `- [${t.status}] "${t.title}" (${t.id}) — team=${t.team_name ?? 'none'}, agent=${t.agent_id ?? 'unassigned'}`,
          )
          .join('\n'),
    );
  }

  // Open PRs
  const openPRs = db
    .prepare(
      `SELECT pr.*, a.name as author_name FROM pull_requests pr
       LEFT JOIN agents a ON pr.agent_id = a.id
       WHERE pr.status IN ('open', 'approved')
       ORDER BY pr.created_at DESC LIMIT 10`,
    )
    .all() as Array<{
    id: string;
    title: string;
    status: string;
    author_name: string | null;
  }>;
  if (openPRs.length > 0) {
    sections.push(
      '## Open Pull Requests\n' +
        openPRs
          .map(
            (pr) => `- [${pr.status}] "${pr.title}" by ${pr.author_name ?? 'unknown'} (${pr.id})`,
          )
          .join('\n'),
    );
  }

  // Conversation history (user messages + your own replies)
  const chatHistory = db
    .prepare(
      `SELECT cl.*, a.name as speaker_name FROM chat_logs cl
       LEFT JOIN agents a ON cl.speaker_id = a.id
       WHERE cl.agent_id = ?
       ORDER BY cl.created_at DESC LIMIT 20`,
    )
    .all(omId) as Array<{
    message: string;
    speaker_name: string | null;
    speaker_type: string;
    sim_time: string;
  }>;
  if (chatHistory.length > 0) {
    const hasUserMessages = chatHistory.some((cl) => cl.speaker_type === 'user');
    sections.push(
      '## Conversation History\n' +
        chatHistory
          .reverse()
          .map((cl) => {
            const speaker = cl.speaker_type === 'user' ? '**User**' : (cl.speaker_name ?? 'You');
            return `- [${cl.sim_time}] ${speaker}: ${cl.message}`;
          })
          .join('\n') +
        (hasUserMessages
          ? '\n\n**Use the `reply_to_user` tool to respond to the user. Do NOT repeat what you already said above.**'
          : ''),
    );
  }

  // Available personas (for hiring) — include IDs so the OM can actually hire
  const personas = db
    .prepare('SELECT id, name, specialties FROM personas ORDER BY name LIMIT 30')
    .all() as Array<{ id: string; name: string; specialties: string }>;
  if (personas.length > 0) {
    sections.push(
      '## Available Personas for Hiring\nUse hire_agent with the persona_id value:\n' +
        personas
          .map((p) => {
            const specs = JSON.parse(p.specialties) as string[];
            return `- **${p.name}** (persona_id: \`${p.id}\`) — specialties: ${specs.join(', ') || 'general'}`;
          })
          .join('\n'),
    );
  }

  // Available tool names
  const generalTools = Object.entries(TOOL_DEFINITIONS)
    .filter(([, def]) => !def.managerOnly)
    .map(([name]) => name);
  const managerTools = [...MANAGER_ONLY_TOOLS];
  sections.push(
    `\n## Available Tools\nGeneral: ${generalTools.join(', ')}\nManager-only: ${managerTools.join(', ')}`,
  );

  return sections.join('\n\n');
}

// ── Trigger immediate session on user message ─────────────────────

export function triggerUserMessageSession(agentId: string): void {
  if (!claimSessionSlot(agentId)) {
    console.log(`[user-message] Agent ${agentId} already in session, message will be picked up`);
    return;
  }

  const db = getDb();
  const agent = db.prepare('SELECT role FROM agents WHERE id = ?').get(agentId) as
    | { role: string }
    | undefined;
  if (!agent) {
    releaseSessionSlot(agentId);
    return;
  }

  if (agent.role === 'office_manager') {
    spawnOMSession(agentId).catch((err) => {
      releaseSessionSlot(agentId);
      console.error('[user-message] OM session failed:', err);
    });
  } else {
    spawnAgentSession(agentId).catch((err) => {
      releaseSessionSlot(agentId);
      console.error('[user-message] Agent session failed:', err);
    });
  }
}

async function spawnAgentSession(agentId: string): Promise<void> {
  const db = getDb();
  const agent = db.prepare('SELECT persona, role FROM agents WHERE id = ?').get(agentId) as
    | { persona: string; role: string }
    | undefined;
  if (!agent) return;

  const provider = providerManager.getProvider(agentId);
  const model = providerManager.getModel(agentId);
  const context = await buildSessionContext(agentId);

  const isManager = agent.role === 'team_manager';
  const mcpTools = isManager
    ? Object.keys(TOOL_DEFINITIONS)
    : Object.entries(TOOL_DEFINITIONS)
        .filter(([, def]) => !def.managerOnly)
        .map(([name]) => name);

  console.log(`[user-message] Spawning session for ${agentId} (role=${agent.role})`);

  try {
    const session = await provider.spawnSession({
      agentId,
      systemPrompt: agent.persona,
      context,
      mcpTools,
      provider: provider.name,
      model,
    });

    new SessionRecorder(session, provider.name, model, simNowFn);
  } catch (err) {
    releaseSessionSlot(agentId);
    throw err;
  }
}

// ── User message to agent ─────────────────────────────────────────

export function sendUserMessageToAgent(agentId: string, message: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const simTime = simNowFn().toISOString();

  db.prepare(
    `INSERT INTO chat_logs (id, agent_id, speaker_id, speaker_type, message, sim_time, created_at)
     VALUES (?, ?, 'user', 'user', ?, ?, ?)`,
  ).run(crypto.randomUUID(), agentId, message, simTime, now);

  console.log(`[chat] User → ${agentId}: ${message.substring(0, 80)}...`);
}

// ── Get chat logs for agent ────────────────────────────────────────

export function getChatLogs(agentId: string): unknown[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT cl.*, a.name as speaker_name
       FROM chat_logs cl
       LEFT JOIN agents a ON cl.speaker_id = a.id
       WHERE cl.agent_id = ?
       ORDER BY cl.created_at ASC`,
    )
    .all(agentId);
}
