import crypto from 'node:crypto';
import { getDb, isVssAvailable } from './db.js';
import { lightweightQuery } from './providers/lightweight.js';
import {
  generateEmbedding,
  embeddingToBuffer,
  bufferToEmbedding,
  EMBEDDING_DIMENSIONS,
} from './embeddings.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── End-of-day tracking ─────────────────────────────────────────────

let lastCompressionDay = '';

// ── Core compression job ────────────────────────────────────────────

/**
 * Run the memory compression pipeline for a single agent.
 * Collects recent activity, generates a summary via lightweight LLM,
 * embeds it, and stores in agent_memory + vss index.
 */
export async function runCompressionForAgent(agentId: string, simTime: Date): Promise<void> {
  const db = getDb();
  const simDay = simTime.toISOString().split('T')[0];

  // Collect chat logs from this sim day
  const chatLogs = db
    .prepare(
      `SELECT cl.message, cl.speaker_type, cl.sim_time, a.name as speaker_name
       FROM chat_logs cl
       LEFT JOIN agents a ON cl.speaker_id = a.id
       WHERE cl.agent_id = ? AND cl.sim_time LIKE ?
       ORDER BY cl.created_at ASC`,
    )
    .all(agentId, `${simDay}%`) as Array<{
    message: string;
    speaker_type: string;
    sim_time: string;
    speaker_name: string | null;
  }>;

  // Collect session summaries from this sim day
  const sessions = db
    .prepare(
      `SELECT s.id, s.outcome, s.started_at, s.ended_at, s.token_estimate,
              (SELECT GROUP_CONCAT(stc.tool_name, ', ')
               FROM session_tool_calls stc WHERE stc.session_id = s.id) as tools_used
       FROM sessions s
       WHERE s.agent_id = ? AND s.sim_day = ?
       ORDER BY s.created_at ASC`,
    )
    .all(agentId, simDay) as Array<{
    id: string;
    outcome: string | null;
    started_at: string;
    ended_at: string | null;
    token_estimate: number | null;
    tools_used: string | null;
  }>;

  // Nothing to compress
  if (chatLogs.length === 0 && sessions.length === 0) {
    console.log(`[memory-compression] No activity for agent ${agentId} on ${simDay}, skipping`);
    return;
  }

  // Assemble activity dump
  const activityParts: string[] = [];

  if (chatLogs.length > 0) {
    activityParts.push(
      'Chat messages:\n' +
        chatLogs
          .map((cl) => {
            const speaker = cl.speaker_type === 'user' ? 'User' : (cl.speaker_name ?? 'System');
            return `[${cl.sim_time}] ${speaker}: ${cl.message}`;
          })
          .join('\n'),
    );
  }

  if (sessions.length > 0) {
    activityParts.push(
      'Sessions:\n' +
        sessions
          .map((s) => {
            const tools = s.tools_used ? `tools: ${s.tools_used}` : 'no tools';
            return `- ${s.started_at} → ${s.ended_at ?? 'ongoing'} (${s.outcome ?? 'active'}, ${tools})`;
          })
          .join('\n'),
    );
  }

  const activityDump = activityParts.join('\n\n');

  // Generate summary via lightweight LLM call
  const prompt = `Summarize the following agent activity from sim day ${simDay} into a concise paragraph (2-4 sentences). Focus on: what tasks were worked on, key decisions made, blockers encountered, communications with other agents, and outcomes achieved.

Activity log:
${activityDump}`;

  let summary: string;
  try {
    summary = await lightweightQuery(prompt);
  } catch (err) {
    console.error(`[memory-compression] LLM summary failed for ${agentId}:`, err);
    // Fall back to a simple concatenation
    summary = `Activity on ${simDay}: ${chatLogs.length} messages, ${sessions.length} sessions.`;
  }

  if (!summary.trim()) {
    summary = `Activity on ${simDay}: ${chatLogs.length} messages, ${sessions.length} sessions.`;
  }

  // Generate embedding
  let embedding: Float32Array;
  try {
    embedding = await generateEmbedding(summary);
  } catch (err) {
    console.error(`[memory-compression] Embedding generation failed for ${agentId}:`, err);
    // Store without embedding — still useful for recency-based retrieval
    const memoryId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_memory (id, agent_id, sim_day, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(memoryId, agentId, simDay, summary, now);
    console.log(`[memory-compression] Stored memory for ${agentId} (no embedding)`);
    return;
  }

  const embeddingBuf = embeddingToBuffer(embedding);
  const memoryId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Insert into agent_memory
  db.prepare(
    `INSERT INTO agent_memory (id, agent_id, sim_day, content, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(memoryId, agentId, simDay, summary, embeddingBuf, now);

  // Insert into vss index if available
  if (isVssAvailable()) {
    const row = db.prepare('SELECT rowid FROM agent_memory WHERE id = ?').get(memoryId) as {
      rowid: number;
    };

    db.prepare('INSERT INTO vss_agent_memory(rowid, embedding) VALUES (?, ?)').run(
      row.rowid,
      embeddingBuf,
    );
  }

  console.log(`[memory-compression] Compressed memory for ${agentId} on ${simDay}`);
}

// ── Vector similarity search ────────────────────────────────────────

/**
 * Search for the most relevant past memories for an agent given a query text.
 * Uses sqlite-vss if available, otherwise falls back to recency-based retrieval.
 */
export async function searchSimilarMemories(
  agentId: string,
  queryText: string,
  limit: number = 3,
): Promise<Array<{ content: string; sim_day: string }>> {
  const db = getDb();

  if (isVssAvailable()) {
    try {
      const queryEmbedding = await generateEmbedding(queryText);
      const queryBuf = embeddingToBuffer(queryEmbedding);

      const results = db
        .prepare(
          `SELECT am.content, am.sim_day
           FROM vss_agent_memory v
           INNER JOIN agent_memory am ON am.rowid = v.rowid
           WHERE vss_search(v.embedding, ?)
             AND am.agent_id = ?
           LIMIT ?`,
        )
        .all(queryBuf, agentId, limit) as Array<{ content: string; sim_day: string }>;

      return results;
    } catch (err) {
      console.warn('[memory-compression] VSS search failed, falling back to recency:', err);
    }
  }

  // Fallback: JS-based cosine similarity if we have embeddings, else recency
  const memories = db
    .prepare(
      `SELECT content, sim_day, embedding FROM agent_memory
       WHERE agent_id = ?
       ORDER BY created_at DESC LIMIT 50`,
    )
    .all(agentId) as Array<{ content: string; sim_day: string; embedding: Buffer | null }>;

  // If no embeddings stored, just return recency-based
  const withEmbeddings = memories.filter((m) => m.embedding !== null);
  if (withEmbeddings.length === 0) {
    return memories.slice(0, limit).map(({ content, sim_day }) => ({ content, sim_day }));
  }

  // Compute cosine similarity in JS
  try {
    const queryEmbedding = await generateEmbedding(queryText);

    const scored = withEmbeddings.map((m) => {
      const memEmbedding = bufferToEmbedding(m.embedding!);
      const similarity = cosineSimilarity(queryEmbedding, memEmbedding);
      return { content: m.content, sim_day: m.sim_day, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit).map(({ content, sim_day }) => ({ content, sim_day }));
  } catch {
    // If embedding generation fails, fall back to recency
    return memories.slice(0, limit).map(({ content, sim_day }) => ({ content, sim_day }));
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── End-of-day compression (called on tick) ─────────────────────────

/**
 * Check if it's time to run end-of-day compression (17:00 sim time).
 * Called on each sim tick from index.ts.
 */
export function processEndOfDayCompression(simTime: Date): void {
  const simDay = simTime.toISOString().split('T')[0];
  const hour = simTime.getUTCHours();
  const minute = simTime.getUTCMinutes();

  // Fire once at 17:00 per sim day
  if (hour === 17 && minute === 0 && lastCompressionDay !== simDay) {
    lastCompressionDay = simDay;
    runEndOfDayCompression(simTime).catch((err) => {
      console.error('[memory-compression] End-of-day compression failed:', err);
    });
  }
}

async function runEndOfDayCompression(simTime: Date): Promise<void> {
  const db = getDb();
  const agents = db
    .prepare("SELECT id, name FROM agents WHERE fired_at IS NULL AND role != 'office_manager'")
    .all() as Array<{ id: string; name: string }>;

  console.log(`[memory-compression] Running end-of-day compression for ${agents.length} agents`);

  // Run sequentially to avoid overwhelming the system
  for (const agent of agents) {
    try {
      await runCompressionForAgent(agent.id, simTime);
    } catch (err) {
      console.error(`[memory-compression] Failed for ${agent.name}:`, err);
    }
  }

  console.log('[memory-compression] End-of-day compression complete');
}

// ── trigger_compression MCP tool handler ────────────────────────────

export async function handleTriggerCompression(
  args: Record<string, unknown>,
  _callerAgentId: string,
  simNow: () => Date,
): Promise<CallToolResult> {
  const agentId = args.agent_id as string;
  if (!agentId) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: 'agent_id is required' }) }],
    };
  }

  const db = getDb();
  const agent = db
    .prepare('SELECT id, name FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as { id: string; name: string } | undefined;

  if (!agent) {
    return {
      isError: true,
      content: [
        { type: 'text', text: JSON.stringify({ error: `Agent "${agentId}" not found or fired` }) },
      ],
    };
  }

  await runCompressionForAgent(agentId, simNow());

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          agent_id: agentId,
          agent_name: agent.name,
          message: `Memory compression triggered for ${agent.name}. Activity summarized and stored.`,
        }),
      },
    ],
  };
}

// ── Exported constant for context monitor ───────────────────────────

export { EMBEDDING_DIMENSIONS };
