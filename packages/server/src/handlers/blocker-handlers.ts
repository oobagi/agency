import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolveBlocker, escalateBlockerToOM, markBlockerUserFacing } from '../blockers.js';

// ── resolve_blocker ─────────────────────────────────────────────────

export async function handleResolveBlocker(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const blockerId = args.blocker_id as string;
  const resolution = args.resolution as string;
  if (!blockerId) return error('blocker_id is required');
  if (!resolution) return error('resolution is required');

  const result = resolveBlocker(blockerId, callerAgentId, resolution, simNow());
  if (!result.success) return error(result.error!);

  return ok({
    blocker_id: blockerId,
    status: 'resolved',
    message: `Blocker resolved: ${resolution}`,
  });
}

// ── escalate_to_om ──────────────────────────────────────────────────

export async function handleEscalateToOM(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const blockerId = args.blocker_id as string;
  const notes = args.notes as string;
  if (!blockerId) return error('blocker_id is required');
  if (!notes) return error('notes is required');

  const result = escalateBlockerToOM(blockerId, callerAgentId, notes, simNow());
  if (!result.success) return error(result.error!);

  return ok({
    blocker_id: blockerId,
    status: 'escalated_to_om',
    om_agent_id: result.omId,
    message: `Blocker escalated to Office Manager. Walk to the Office Manager (${result.omId}) and explain the situation.`,
  });
}

// ── mark_blocker_user_facing ────────────────────────────────────────

export async function handleMarkBlockerUserFacing(
  args: Record<string, unknown>,
  callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const blockerId = args.blocker_id as string;
  const notes = args.notes as string;
  if (!blockerId) return error('blocker_id is required');
  if (!notes) return error('notes is required');

  const result = markBlockerUserFacing(blockerId, callerAgentId, notes, simNow());
  if (!result.success) return error(result.error!);

  return ok({
    blocker_id: blockerId,
    status: 'user_facing',
    message: `Blocker marked as requiring user intervention. The user has been notified.`,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

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
