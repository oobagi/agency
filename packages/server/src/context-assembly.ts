import { getDb } from './db.js';
import { TOOL_DEFINITIONS, MANAGER_ONLY_TOOLS } from './mcp/tool-registry.js';
import { searchSimilarMemories } from './memory-compression.js';

// ── Sim clock accessor ─────────────────────────────────────────────

let simNowFn: () => Date = () => new Date();

export function setContextSimClock(fn: () => Date): void {
  simNowFn = fn;
}

// ── Token budget (rough estimate: 1 token ≈ 4 chars) ──────────────

const MAX_CONTEXT_CHARS = 100_000 * 4; // ~100k tokens

// ── Build session context for any agent ────────────────────────────

export async function buildSessionContext(agentId: string, taskContext?: string): Promise<string> {
  const db = getDb();
  const simTime = simNowFn();
  const sections: string[] = [];

  // Agent info
  const agent = db
    .prepare(
      `SELECT a.*, t.name as team_name, t.project_id
       FROM agents a
       LEFT JOIN teams t ON a.team_id = t.id
       WHERE a.id = ?`,
    )
    .get(agentId) as
    | {
        id: string;
        name: string;
        role: string;
        persona: string;
        team_id: string | null;
        team_name: string | null;
        project_id: string | null;
        state: string;
        desk_id: string | null;
      }
    | undefined;

  if (!agent) return 'Error: Agent not found.';

  // 1. Persona system prompt
  sections.push(agent.persona);

  // 2. Current sim time
  sections.push(
    `Current sim time: ${simTime.toISOString()}\nSim day: ${simTime.toISOString().split('T')[0]}`,
  );

  // 3. Current task
  let currentTaskDescription = '';
  if (taskContext) {
    sections.push(`## Current Task\n${taskContext}`);
    currentTaskDescription = taskContext;
  } else {
    // Check for in-progress or pending tasks
    const currentTask = db
      .prepare(`SELECT * FROM tasks WHERE agent_id = ? AND status = 'in_progress' LIMIT 1`)
      .get(agentId) as { id: string; title: string; description: string } | undefined;

    if (currentTask) {
      sections.push(
        `## Current Task\n**${currentTask.title}** (${currentTask.id})\n${currentTask.description}`,
      );
      currentTaskDescription = currentTask.description;
    } else {
      const pendingTask = db
        .prepare(
          `SELECT * FROM tasks WHERE agent_id = ? AND status = 'pending' ORDER BY priority DESC LIMIT 1`,
        )
        .get(agentId) as { id: string; title: string; description: string } | undefined;

      if (pendingTask) {
        sections.push(
          `## Queued Task\n**${pendingTask.title}** (${pendingTask.id})\n${pendingTask.description}`,
        );
        currentTaskDescription = pendingTask.description;
      } else {
        sections.push('## Current Task\nNo tasks assigned. Check in with your Team Manager.');
      }
    }
  }

  // 4. Recent chat logs (last 10)
  const chatLogs = db
    .prepare(
      `SELECT cl.*, a.name as speaker_name FROM chat_logs cl
       LEFT JOIN agents a ON cl.speaker_id = a.id
       WHERE cl.agent_id = ?
       ORDER BY cl.created_at DESC LIMIT 10`,
    )
    .all(agentId) as Array<{
    message: string;
    speaker_name: string | null;
    speaker_type: string;
    sim_time: string;
  }>;

  if (chatLogs.length > 0) {
    sections.push(
      '## Recent Messages\n' +
        chatLogs
          .reverse()
          .map((cl) => {
            const speaker = cl.speaker_type === 'user' ? 'User' : (cl.speaker_name ?? 'System');
            return `- [${cl.sim_time}] ${speaker}: ${cl.message}`;
          })
          .join('\n'),
    );
  }

  // 5. Memory chunks (top 3 via vector similarity search)
  let memories: Array<{ content: string; sim_day: string }>;
  if (currentTaskDescription) {
    memories = await searchSimilarMemories(agentId, currentTaskDescription, 3);
  } else {
    // No task context to match against — fall back to recency
    memories = db
      .prepare(
        `SELECT content, sim_day FROM agent_memory
         WHERE agent_id = ?
         ORDER BY created_at DESC LIMIT 3`,
      )
      .all(agentId) as Array<{ content: string; sim_day: string }>;
  }

  if (memories.length > 0) {
    sections.push(
      '## Memory (from previous days)\n' +
        memories.map((m) => `### ${m.sim_day}\n${m.content}`).join('\n\n'),
    );
  }

  // 6. Team context (for non-managers only — managers get their own context)
  if (agent.role === 'agent' && agent.team_id) {
    sections.push(`## Your Team: ${agent.team_name ?? 'Unknown'}`);

    // Team manager
    const tm = db
      .prepare(
        `SELECT name, id FROM agents
         WHERE team_id = ? AND role = 'team_manager' AND fired_at IS NULL`,
      )
      .get(agent.team_id) as { name: string; id: string } | undefined;

    if (tm) {
      sections.push(`Team Manager: **${tm.name}** (${tm.id})`);
    }
  }

  // 7. Available MCP tools (filtered by role)
  const generalTools = Object.entries(TOOL_DEFINITIONS)
    .filter(([, def]) => !def.managerOnly)
    .map(([name]) => name);

  if (agent.role === 'agent') {
    sections.push(`\n## Available Tools\n${generalTools.join(', ')}`);
  } else {
    const managerTools = [...MANAGER_ONLY_TOOLS];
    sections.push(
      `\n## Available Tools\nGeneral: ${generalTools.join(', ')}\nManager-only: ${managerTools.join(', ')}`,
    );
  }

  // Assemble and enforce token budget
  let context = sections.join('\n\n');
  if (context.length > MAX_CONTEXT_CHARS) {
    context =
      context.substring(0, MAX_CONTEXT_CHARS) + '\n\n[Context truncated due to token budget]';
  }

  return context;
}
