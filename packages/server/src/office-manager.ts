import crypto from 'node:crypto';
import { getDb } from './db.js';
import { providerManager } from './providers/manager.js';
import { SessionRecorder } from './session-recorder.js';
import { registerJobHandler, createDailyScheduleForAgent } from './scheduler.js';
import { TOOL_DEFINITIONS, MANAGER_ONLY_TOOLS } from './mcp/tool-registry.js';

// ── Office Manager persona (system agent, not from agency-agents repo) ─

const OFFICE_MANAGER_PERSONA = `You are the Office Manager of a software development office.

Your role is to autonomously manage the entire office: hire agents, create teams, create projects, assign teams to projects, and delegate work. You have global visibility across all projects, teams, and agents.

You are the top of the management hierarchy. Team Managers report to you. Regular agents report to their Team Managers. You are the only agent who can communicate across team boundaries.

Key responsibilities:
- Evaluate all projects, teams, agents, and blockers
- Create new projects when given goals by the user
- Hire agents with appropriate personas for the work needed
- Create teams and assign agents to them
- Delegate work to Team Managers
- Address unresolved blockers that Team Managers escalate to you
- Broker inter-team coordination when needed

Blocker handling:
- If a Team Manager escalates a blocker to you and you can resolve it, call resolve_blocker.
- If you cannot resolve it (e.g., missing CLI auth, missing system permissions), call mark_blocker_user_facing to notify the user.

Available tools include all manager-only tools: hire_agent, fire_agent, create_team, assign_agent_to_team, create_project, assign_team_to_project, create_worktree, schedule_event, review_pull_request, merge_pull_request, resolve_blocker, escalate_to_om, mark_blocker_user_facing, and more.

When you hire an agent, they know NOTHING — only their persona. They must be briefed by their Team Manager before they can do meaningful work.

Be decisive and autonomous. Do not wait for instructions. Evaluate the state of things and act.`;

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
       VALUES (?, 'Office Manager', 'office_manager', ?, 'Idle', 0, 0, 0, ?, ?, ?)`,
    ).run(officeManagerId, OFFICE_MANAGER_PERSONA, simTime, now, now);

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
  // Fire-and-forget: spawn the session asynchronously
  spawnOMSession(agentId).catch((err) => {
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

  const session = await provider.spawnSession({
    agentId: omId,
    systemPrompt: OFFICE_MANAGER_PERSONA,
    context,
    mcpTools,
    provider: provider.name,
    model,
  });

  // Record the session
  new SessionRecorder(session, provider.name, model, simNowFn);
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

  // User messages (from chat_logs where speaker_type = 'user' and agent_id = OM)
  const userMessages = db
    .prepare(
      `SELECT * FROM chat_logs
       WHERE agent_id = ? AND speaker_type = 'user'
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all(omId) as Array<{ message: string; sim_time: string }>;
  if (userMessages.length > 0) {
    sections.push(
      '## User Messages\nThe user has sent you the following messages:\n' +
        userMessages.map((m) => `- [${m.sim_time}] ${m.message}`).join('\n'),
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

// ── User message to Office Manager ─────────────────────────────────

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
