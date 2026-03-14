import { z } from 'zod/v4';
import { getDb } from '../db.js';

// ---------- Schema building blocks ----------

const AGENT_STATES = [
  'Idle',
  'Arriving',
  'Walking',
  'Researching',
  'Programming',
  'Reviewing',
  'Meeting',
  'Break',
  'Departing',
  'Blocked',
] as const;

const PR_DECISION = ['approved', 'rejected'] as const;

// ---------- Tool definition type ----------

export interface ToolDefinition {
  description: string;
  inputSchema: z.ZodType;
  managerOnly: boolean;
}

// ---------- Tool definitions ----------

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // ── Movement tools ──────────────────────────────────────────────
  walk_to_desk: {
    description: 'Walk to your assigned desk. Must arrive before starting any task.',
    inputSchema: z.object({}),
    managerOnly: false,
  },
  walk_to_agent: {
    description: "Walk to another agent's current location. Required before you can speak to them.",
    inputSchema: z.object({
      target_agent_id: z.string().describe('ID of the agent to walk to'),
    }),
    managerOnly: false,
  },
  walk_to_meeting_room: {
    description: 'Walk to a meeting room. Required before a meeting can begin.',
    inputSchema: z.object({
      meeting_room_id: z.string().describe('ID of the meeting room'),
    }),
    managerOnly: false,
  },
  walk_to_exit: {
    description: 'Walk toward the office exit for departure.',
    inputSchema: z.object({}),
    managerOnly: false,
  },

  // ── Communication tools ─────────────────────────────────────────
  speak: {
    description:
      'Say something to nearby agents. Only agents within proximity radius will hear you.',
    inputSchema: z.object({
      message: z.string().describe('The message to speak'),
    }),
    managerOnly: false,
  },
  reply_to_user: {
    description:
      'Send a direct message to the user. Use this to respond to user messages, ask clarifying questions, or report status.',
    inputSchema: z.object({
      message: z.string().describe('The message to send to the user'),
    }),
    managerOnly: false,
  },
  send_to_manager: {
    description: 'Walk to your Team Manager and deliver a message. Handles the walk automatically.',
    inputSchema: z.object({
      message: z.string().describe('The message to deliver to your manager'),
    }),
    managerOnly: false,
  },

  // ── Work execution tools ────────────────────────────────────────
  begin_task: {
    description:
      'Start working on a task. You must be seated at your desk. Transitions you to Programming or Researching.',
    inputSchema: z.object({
      task_id: z.string().describe('ID of the task to begin'),
      mode: z
        .enum(['programming', 'researching'] as const)
        .optional()
        .describe('Work mode: "programming" (default) or "researching"'),
    }),
    managerOnly: false,
  },
  complete_task: {
    description:
      'Mark a task as completed. You must be in Programming or Researching state. Transitions you to Idle and notifies your Team Manager.',
    inputSchema: z.object({
      task_id: z.string().describe('ID of the task to complete'),
    }),
    managerOnly: false,
  },
  commit_work: {
    description: 'Record a commit in your worktree.',
    inputSchema: z.object({
      message: z.string().describe('Commit message'),
      worktree_id: z.string().describe('ID of the worktree'),
    }),
    managerOnly: false,
  },
  open_pull_request: {
    description: 'Open a pull request from your branch to the team integration branch.',
    inputSchema: z.object({
      title: z.string().describe('PR title'),
      description: z.string().describe('PR description'),
      source_branch: z.string().describe('Source branch name'),
      target_branch: z.string().describe('Target branch name'),
      worktree_id: z.string().describe('ID of the worktree'),
    }),
    managerOnly: false,
  },

  // ── State management tools ──────────────────────────────────────
  set_state: {
    description: 'Transition to a new state. Validates against the legal transition map.',
    inputSchema: z.object({
      state: z.enum(AGENT_STATES).describe('Target state'),
    }),
    managerOnly: false,
  },
  report_blocker: {
    description: 'Report a blocker. Sets you to Blocked state and begins the escalation chain.',
    inputSchema: z.object({
      description: z.string().describe('Description of what is blocking you'),
      task_id: z.string().optional().describe('ID of the blocked task, if applicable'),
    }),
    managerOnly: false,
  },

  // ── Manager-only tools ──────────────────────────────────────────
  create_task: {
    description: 'Create a new task for a team. Optionally assign it to an agent immediately.',
    inputSchema: z.object({
      title: z.string().describe('Task title'),
      description: z.string().describe('Task description and acceptance criteria'),
      team_id: z.string().describe('ID of the team this task belongs to'),
      project_id: z.string().describe('ID of the project this task is for'),
      priority: z.number().optional().describe('Priority (higher = more important, default 0)'),
      agent_id: z.string().optional().describe('ID of the agent to assign (optional)'),
    }),
    managerOnly: true,
  },
  hire_agent: {
    description:
      'Hire a new agent with a persona. Optionally set role to team_manager. The agent starts knowing nothing.',
    inputSchema: z.object({
      persona_id: z.string().describe('ID of the persona to assign'),
      role: z
        .enum(['agent', 'team_manager'] as const)
        .optional()
        .describe('Role for the agent: "agent" (default) or "team_manager"'),
    }),
    managerOnly: true,
  },
  fire_agent: {
    description: 'Remove an agent from the simulation.',
    inputSchema: z.object({
      agent_id: z.string().describe('ID of the agent to fire'),
    }),
    managerOnly: true,
  },
  create_team: {
    description: 'Create a new team with a designated color.',
    inputSchema: z.object({
      name: z.string().describe('Team name'),
      color: z.string().describe('Hex color code for the team (e.g. #3B82F6)'),
    }),
    managerOnly: true,
  },
  assign_agent_to_team: {
    description: 'Move an agent to a team and assign them a desk.',
    inputSchema: z.object({
      agent_id: z.string().describe('ID of the agent'),
      team_id: z.string().describe('ID of the team'),
    }),
    managerOnly: true,
  },
  create_project: {
    description: 'Initialize a new Git repo on disk and create a project record.',
    inputSchema: z.object({
      name: z.string().describe('Project name'),
      description: z.string().describe('Project description'),
      repo_path: z.string().describe('Absolute path on disk for the Git repo'),
    }),
    managerOnly: true,
  },
  delete_project: {
    description: 'Remove a project.',
    inputSchema: z.object({
      project_id: z.string().describe('ID of the project to delete'),
    }),
    managerOnly: true,
  },
  assign_team_to_project: {
    description: 'Link a team to a project.',
    inputSchema: z.object({
      team_id: z.string().describe('ID of the team'),
      project_id: z.string().describe('ID of the project'),
    }),
    managerOnly: true,
  },
  create_worktree: {
    description: 'Create a Git worktree in a project repo for a team.',
    inputSchema: z.object({
      project_id: z.string().describe('ID of the project'),
      team_id: z.string().describe('ID of the team'),
      branch_name: z.string().describe('Branch name for the worktree'),
    }),
    managerOnly: true,
  },
  schedule_event: {
    description: 'Create a scheduled job for a future sim time.',
    inputSchema: z.object({
      agent_id: z.string().describe('ID of the target agent'),
      job_type: z.string().describe('Type of job to schedule'),
      sim_time: z.string().describe('Sim time when the job should fire (ISO 8601)'),
      recurrence: z.string().optional().describe('Cron-like recurrence pattern in sim time'),
      payload: z.record(z.string(), z.unknown()).optional().describe('Additional job data'),
    }),
    managerOnly: true,
  },
  review_pull_request: {
    description: 'Review and approve or reject a pull request.',
    inputSchema: z.object({
      pull_request_id: z.string().describe('ID of the PR to review'),
      decision: z.enum(PR_DECISION).describe('Approve or reject'),
      comments: z.string().optional().describe('Review comments'),
    }),
    managerOnly: true,
  },
  merge_pull_request: {
    description: 'Merge an approved pull request.',
    inputSchema: z.object({
      pull_request_id: z.string().describe('ID of the PR to merge'),
    }),
    managerOnly: true,
  },
  trigger_compression: {
    description: 'Force an early memory compression and session refresh for an agent.',
    inputSchema: z.object({
      agent_id: z.string().describe('ID of the agent to compress'),
    }),
    managerOnly: true,
  },
  checkpoint_agent: {
    description:
      'Instruct an agent to wrap up their current subtask and commit before context limit.',
    inputSchema: z.object({
      agent_id: z.string().describe('ID of the agent to checkpoint'),
    }),
    managerOnly: true,
  },
  resolve_blocker: {
    description:
      'Resolve a blocker for an agent. Transitions the agent from Blocked back to Idle so they can resume work.',
    inputSchema: z.object({
      blocker_id: z.string().describe('ID of the blocker to resolve'),
      resolution: z.string().describe('Description of how the blocker was resolved'),
    }),
    managerOnly: true,
  },
  escalate_to_om: {
    description:
      'Escalate an unresolvable blocker to the Office Manager. You must physically walk to the Office Manager after calling this to explain the situation.',
    inputSchema: z.object({
      blocker_id: z.string().describe('ID of the blocker to escalate'),
      notes: z.string().describe('Why you cannot resolve this blocker and what you tried'),
    }),
    managerOnly: true,
  },
  mark_blocker_user_facing: {
    description:
      'Mark a blocker as requiring user intervention. The user will be notified via the UI.',
    inputSchema: z.object({
      blocker_id: z.string().describe('ID of the blocker'),
      notes: z
        .string()
        .describe('What the user needs to do to resolve this (e.g., "Run claude in terminal")'),
    }),
    managerOnly: true,
  },
};

// ---------- Manager-only tool set (quick lookup) ----------

export const MANAGER_ONLY_TOOLS = new Set(
  Object.entries(TOOL_DEFINITIONS)
    .filter(([, def]) => def.managerOnly)
    .map(([name]) => name),
);

// ---------- Permission validation ----------

export function validateAgentPermission(
  agentId: string,
  toolName: string,
): { allowed: boolean; reason?: string } {
  const def = TOOL_DEFINITIONS[toolName];
  if (!def) {
    return { allowed: false, reason: `Unknown tool: ${toolName}` };
  }

  if (!def.managerOnly) {
    return { allowed: true };
  }

  const db = getDb();
  const row = db
    .prepare('SELECT role FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as { role: string } | undefined;

  if (!row) {
    return { allowed: false, reason: `Agent ${agentId} not found or has been fired` };
  }

  if (row.role === 'agent') {
    return {
      allowed: false,
      reason: `Tool "${toolName}" requires a manager role. Agent ${agentId} has role "${row.role}".`,
    };
  }

  return { allowed: true };
}
