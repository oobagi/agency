import { getDb } from './db.js';
import { providerManager } from './providers/manager.js';
import { SessionRecorder, getActiveSessionForAgent } from './session-recorder.js';
import { TOOL_DEFINITIONS, MANAGER_ONLY_TOOLS } from './mcp/tool-registry.js';
import { resetIdleTimer } from './idle-checker.js';

// ── Sim clock accessor ─────────────────────────────────────────────

let simNowFn: () => Date = () => new Date();

export function setTeamManagerSimClock(fn: () => Date): void {
  simNowFn = fn;
}

// ── Team Manager persona template ──────────────────────────────────

function buildTMPersona(teamName: string): string {
  return `You are a Team Manager leading the "${teamName}" team.

Your role is to manage your team of developers: assign tasks, review pull requests, brief new agents, and ensure work progresses smoothly.

Key responsibilities:
- Assign tasks to idle team members by walking to them and speaking
- Review and merge pull requests from your team
- Brief newly hired agents about the project and their tasks
- Monitor progress and address blockers
- Escalate issues you cannot resolve to the Office Manager by walking to their desk

Communication rules (CRITICAL):
- You MUST call walk_to_agent before speaking to any agent
- You MUST be physically near an agent to communicate with them
- Never try to speak to an agent without walking to them first
- Use send_to_manager to escalate to the Office Manager

When assigning work, walk to the idle agent, speak to brief them, then they will begin_task at their desk.

Blocker handling:
- If you can resolve a blocker (e.g., reassign work, provide guidance), call resolve_blocker with the blocker_id.
- If you cannot resolve it, call escalate_to_om with the blocker_id, then physically walk to the Office Manager (walk_to_agent) and speak to explain the situation.

Be proactive. Check on idle agents, review pending PRs, and keep your team productive.`;
}

// ── Trigger: Team Manager desk arrival ─────────────────────────────

export function triggerTMDeskArrival(tmAgentId: string): void {
  // Don't spawn if already in a session
  if (getActiveSessionForAgent(tmAgentId)) {
    console.log(
      `[team-manager] ${tmAgentId} already has active session, skipping desk arrival trigger`,
    );
    return;
  }

  spawnTMSession(tmAgentId, 'desk_arrival').catch((err) => {
    console.error(`[team-manager] Desk arrival session failed for ${tmAgentId}:`, err);
  });
}

// ── Trigger: Team member task completion ───────────────────────────

export function triggerTMTaskComplete(teamId: string, agentId: string, taskTitle: string): void {
  const db = getDb();
  const tm = db
    .prepare(
      "SELECT id FROM agents WHERE team_id = ? AND role = 'team_manager' AND fired_at IS NULL",
    )
    .get(teamId) as { id: string } | undefined;

  if (!tm) {
    console.log(
      `[team-manager] No team manager for team ${teamId}, skipping task complete trigger`,
    );
    return;
  }

  if (getActiveSessionForAgent(tm.id)) {
    console.log(
      `[team-manager] ${tm.id} already has active session, skipping task complete trigger`,
    );
    return;
  }

  spawnTMSession(tm.id, 'task_complete', {
    completedBy: agentId,
    taskTitle,
  }).catch((err) => {
    console.error(`[team-manager] Task complete session failed for ${tm.id}:`, err);
  });
}

// ── Trigger: Team member blocker report ────────────────────────────

export function triggerTMBlockerReport(
  teamId: string,
  agentId: string,
  description: string,
  blockerId?: string,
): void {
  const db = getDb();
  const tm = db
    .prepare(
      "SELECT id FROM agents WHERE team_id = ? AND role = 'team_manager' AND fired_at IS NULL",
    )
    .get(teamId) as { id: string } | undefined;

  if (!tm) {
    console.log(`[team-manager] No team manager for team ${teamId}, skipping blocker trigger`);
    return;
  }

  if (getActiveSessionForAgent(tm.id)) {
    console.log(`[team-manager] ${tm.id} already has active session, skipping blocker trigger`);
    return;
  }

  spawnTMSession(tm.id, 'blocker_report', {
    blockedAgent: agentId,
    blockerDescription: description,
    ...(blockerId ? { blockerId } : {}),
  }).catch((err) => {
    console.error(`[team-manager] Blocker session failed for ${tm.id}:`, err);
  });
}

// ── Spawn a Team Manager session ───────────────────────────────────

async function spawnTMSession(
  tmId: string,
  trigger: string,
  triggerData?: Record<string, string>,
): Promise<void> {
  const provider = providerManager.getProvider(tmId);
  const model = providerManager.getModel(tmId);
  const context = buildTMContext(tmId, trigger, triggerData);

  // TMs get general tools + manager-only tools (scoped by permission check)
  const mcpTools = Object.keys(TOOL_DEFINITIONS);

  const db = getDb();
  const tm = db.prepare('SELECT name, team_id FROM agents WHERE id = ?').get(tmId) as {
    name: string;
    team_id: string | null;
  };

  const team = tm.team_id
    ? (db.prepare('SELECT name FROM teams WHERE id = ?').get(tm.team_id) as
        | { name: string }
        | undefined)
    : undefined;

  const teamName = team?.name ?? 'Unknown Team';
  const persona = buildTMPersona(teamName);

  console.log(`[team-manager] Spawning session for ${tm.name} (trigger=${trigger})`);

  const session = await provider.spawnSession({
    agentId: tmId,
    systemPrompt: persona,
    context,
    mcpTools,
    provider: provider.name,
    model,
  });

  new SessionRecorder(session, provider.name, model, simNowFn);
}

// ── Build Team Manager context ─────────────────────────────────────

function buildTMContext(
  tmId: string,
  trigger: string,
  triggerData?: Record<string, string>,
): string {
  const db = getDb();
  const simTime = simNowFn();
  const sections: string[] = [];

  sections.push(`Current sim time: ${simTime.toISOString()}`);

  // Trigger info
  sections.push(`## Session Trigger: ${trigger}`);
  if (trigger === 'desk_arrival') {
    sections.push(
      'You have arrived at your desk for the day. Check your team status and assign work to idle agents.',
    );
  } else if (trigger === 'task_complete' && triggerData) {
    const completedAgent = db
      .prepare('SELECT name FROM agents WHERE id = ?')
      .get(triggerData.completedBy) as { name: string } | undefined;
    sections.push(
      `Agent **${completedAgent?.name ?? triggerData.completedBy}** has completed task "${triggerData.taskTitle}". ` +
        'Review their work and assign new tasks if available.',
    );
  } else if (trigger === 'blocker_report' && triggerData) {
    const blockedAgent = db
      .prepare('SELECT name FROM agents WHERE id = ?')
      .get(triggerData.blockedAgent) as { name: string } | undefined;
    const blockerIdInfo = triggerData.blockerId ? ` (blocker_id: ${triggerData.blockerId})` : '';
    sections.push(
      `Agent **${blockedAgent?.name ?? triggerData.blockedAgent}** has reported a blocker${blockerIdInfo}: "${triggerData.blockerDescription}". ` +
        'Try to resolve it by calling resolve_blocker. If you cannot resolve it, call escalate_to_om and then physically walk to the Office Manager to explain.',
    );
  }

  // Team info
  const tm = db.prepare('SELECT team_id FROM agents WHERE id = ?').get(tmId) as {
    team_id: string | null;
  };

  if (!tm?.team_id) {
    sections.push('## Team\nYou are not assigned to a team yet.');
    return sections.join('\n\n');
  }

  const teamId = tm.team_id;
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as
    | { id: string; name: string; project_id: string | null }
    | undefined;

  if (team) {
    sections.push(
      `## Your Team: ${team.name}\nTeam ID: ${team.id}\nProject: ${team.project_id ?? 'none'}`,
    );
  }

  // Team members
  const members = db
    .prepare(
      `SELECT a.id, a.name, a.role, a.state, a.desk_id FROM agents a
       WHERE a.team_id = ? AND a.id != ? AND a.fired_at IS NULL`,
    )
    .all(teamId, tmId) as Array<{
    id: string;
    name: string;
    role: string;
    state: string;
    desk_id: string | null;
  }>;

  if (members.length > 0) {
    sections.push(
      '## Team Members\n' +
        members
          .map(
            (m) =>
              `- **${m.name}** (${m.id}): role=${m.role}, state=${m.state}, desk=${m.desk_id ? 'yes' : 'no'}`,
          )
          .join('\n'),
    );
  } else {
    sections.push('## Team Members\nNo team members yet.');
  }

  // Team tasks
  const tasks = db
    .prepare(
      `SELECT t.*, a.name as agent_name FROM tasks t
       LEFT JOIN agents a ON t.agent_id = a.id
       WHERE t.team_id = ?
       ORDER BY t.priority DESC, t.created_at DESC LIMIT 20`,
    )
    .all(teamId) as Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    agent_name: string | null;
    agent_id: string | null;
  }>;

  if (tasks.length > 0) {
    sections.push(
      '## Tasks\n' +
        tasks
          .map(
            (t) =>
              `- [${t.status}] "${t.title}" (${t.id}) — assigned to: ${t.agent_name ?? 'unassigned'}`,
          )
          .join('\n'),
    );
  } else {
    sections.push('## Tasks\nNo tasks exist for your team.');
  }

  // Team PRs
  const prs = db
    .prepare(
      `SELECT pr.*, a.name as author_name FROM pull_requests pr
       LEFT JOIN agents a ON pr.agent_id = a.id
       LEFT JOIN worktrees w ON pr.worktree_id = w.id
       WHERE w.team_id = ?
       ORDER BY pr.created_at DESC LIMIT 10`,
    )
    .all(teamId) as Array<{
    id: string;
    title: string;
    status: string;
    author_name: string | null;
  }>;

  if (prs.length > 0) {
    sections.push(
      '## Pull Requests\n' +
        prs
          .map(
            (pr) => `- [${pr.status}] "${pr.title}" by ${pr.author_name ?? 'unknown'} (${pr.id})`,
          )
          .join('\n'),
    );
  }

  // Blocked agents on this team (with blocker details)
  const blocked = members.filter((m) => m.state === 'Blocked');
  if (blocked.length > 0) {
    const blockerDetails = blocked.map((a) => {
      const blocker = db
        .prepare(
          `SELECT id, description, status FROM blockers
           WHERE agent_id = ? AND status != 'resolved'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(a.id) as { id: string; description: string; status: string } | undefined;
      if (blocker) {
        return `- **${a.name}** (${a.id}) is BLOCKED — blocker_id: ${blocker.id}, status: ${blocker.status}, reason: "${blocker.description}"`;
      }
      return `- **${a.name}** (${a.id}) is BLOCKED`;
    });
    sections.push('## Blocked Agents\n' + blockerDetails.join('\n'));
  }

  // Recent chat logs for TM
  const chatLogs = db
    .prepare(
      `SELECT cl.*, a.name as speaker_name FROM chat_logs cl
       LEFT JOIN agents a ON cl.speaker_id = a.id
       WHERE cl.agent_id = ?
       ORDER BY cl.created_at DESC LIMIT 10`,
    )
    .all(tmId) as Array<{ message: string; speaker_name: string | null; sim_time: string }>;

  if (chatLogs.length > 0) {
    sections.push(
      '## Recent Messages\n' +
        chatLogs
          .reverse()
          .map((cl) => `- [${cl.sim_time}] ${cl.speaker_name ?? 'User'}: ${cl.message}`)
          .join('\n'),
    );
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

// ── Check for agent state transitions that should trigger TM ───────
// Called from the scheduler or state machine when an agent changes state.

export function onAgentStateChange(agentId: string, oldState: string, newState: string): void {
  const db = getDb();
  const agent = db
    .prepare('SELECT role, team_id FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as { role: string; team_id: string | null } | undefined;

  if (!agent) return;

  // Trigger: Team Manager arrives at desk (Walking → Idle)
  if (agent.role === 'team_manager' && oldState === 'Walking' && newState === 'Idle') {
    triggerTMDeskArrival(agentId);
  }

  // Reset idle timer when agent leaves Idle state
  if (oldState === 'Idle' && newState !== 'Idle') {
    resetIdleTimer(agentId);
  }
}
