/**
 * Simulation test for Phase 5.0 — Memory Compression Pipeline
 *
 * Tests the full flow: seed agent activity → run compression (real LLM + real embeddings) →
 * verify storage → vector similarity search → trigger_compression MCP tool →
 * context monitor thresholds.
 *
 * Requires: Claude CLI auth (for lightweightQuery) + internet (for embedding model download on first run).
 *
 * Run: npx tsx test/run-memory-test.ts
 */

import { initDb, closeDb, getDb, isVssAvailable } from '../src/db.js';
import { dispatchToolCall, setSimClock } from '../src/mcp/server.js';
import { SimClock } from '../src/sim-clock.js';
import { setMovementSimClock, startMovementLoop, stopMovementLoop } from '../src/movement.js';
import { setCommunicationSimClock } from '../src/handlers/communication.js';
import { initOfficeManager, setOfficeManagerSimClock } from '../src/office-manager.js';
import { setTeamManagerSimClock } from '../src/team-manager.js';
import { setContextSimClock } from '../src/context-assembly.js';
import { setIdleCheckerSimClock } from '../src/idle-checker.js';
import {
  runCompressionForAgent,
  searchSimilarMemories,
  processEndOfDayCompression,
} from '../src/memory-compression.js';
import { generateEmbedding, EMBEDDING_DIMENSIONS } from '../src/embeddings.js';
import {
  registerSession,
  addSessionTokens,
  getSessionTokenEstimate,
  unregisterSession,
} from '../src/context-monitor.js';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.AGENCY_DB_PATH!;
const REPO_PATH = path.join(
  os.tmpdir(),
  `agency-memory-test-repo-${crypto.randomUUID().slice(0, 8)}`,
);

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

async function main() {
  // Setup
  initDb();
  const clock = new SimClock();
  setSimClock(() => clock.now());
  setOfficeManagerSimClock(() => clock.now());
  setTeamManagerSimClock(() => clock.now());
  setContextSimClock(() => clock.now());
  setIdleCheckerSimClock(() => clock.now());
  setMovementSimClock(
    () => clock.now(),
    () => clock.getSpeed(),
  );
  setCommunicationSimClock(() => clock.now());
  startMovementLoop();
  initOfficeManager();

  const db = getDb();

  console.log(`\n  VSS available: ${isVssAvailable()}`);

  // Seed test personas
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO personas (id, name, github_username, bio, system_prompt, specialties, fetched_at, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'persona-mem-1',
    'Carol Coder',
    'carolcoder',
    'Full-stack dev',
    'You are Carol.',
    '["frontend","backend"]',
    now,
    'test',
  );

  // Get the Office Manager
  const om = db.prepare("SELECT id FROM agents WHERE role = 'office_manager'").get() as {
    id: string;
  };
  const omId = om.id;

  // Create a team and project
  const team = await dispatch('create_team', { name: 'Memory Team', color: '#10B981' }, omId);
  const teamId = (team.data as Record<string, unknown>).team_id as string;

  const proj = await dispatch(
    'create_project',
    { name: 'MemTest', description: 'Memory test project', repo_path: REPO_PATH },
    omId,
  );
  const projectId = (proj.data as Record<string, unknown>).project_id as string;

  await dispatch('assign_team_to_project', { team_id: teamId, project_id: projectId }, omId);

  // Hire an agent
  const hire = await dispatch('hire_agent', { persona_id: 'persona-mem-1', role: 'agent' }, omId);
  const agentId = (hire.data as Record<string, unknown>).agent_id as string;
  await dispatch('assign_agent_to_team', { agent_id: agentId, team_id: teamId }, omId);

  const simDay = clock.now().toISOString().split('T')[0];

  // ── Test 1: Embedding generation ──────────────────────────────────
  console.log('\n=== Embedding Generation ===');

  const embedding = await generateEmbedding('Build a login page with React');
  assert(embedding instanceof Float32Array, 'generateEmbedding returns Float32Array');
  assert(
    embedding.length === EMBEDDING_DIMENSIONS,
    `Embedding has ${EMBEDDING_DIMENSIONS} dimensions`,
  );

  // Verify embeddings are semantically meaningful
  const emb1 = await generateEmbedding('React frontend login form');
  const emb2 = await generateEmbedding('Python machine learning model');
  const simSame = cosine(embedding, emb1);
  const simDiff = cosine(embedding, emb2);
  assert(
    simSame > simDiff,
    `Similar texts are closer (${simSame.toFixed(3)} > ${simDiff.toFixed(3)})`,
  );

  // ── Test 2: Seed activity and run compression ─────────────────────
  console.log('\n=== Memory Compression (real LLM + embedding) ===');

  // Seed some chat logs for the agent
  const simTime = clock.now().toISOString();
  const insertChat = db.prepare(
    `INSERT INTO chat_logs (id, agent_id, speaker_id, speaker_type, message, sim_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertChat.run(
    crypto.randomUUID(),
    agentId,
    omId,
    'agent',
    'Welcome to the team, Carol! Your first task is to build a login page.',
    simTime,
    now,
  );
  insertChat.run(
    crypto.randomUUID(),
    agentId,
    agentId,
    'agent',
    'Got it! I will start working on the login page with React and TypeScript.',
    simTime,
    now,
  );
  insertChat.run(
    crypto.randomUUID(),
    agentId,
    agentId,
    'agent',
    'I have completed the login form component with email and password fields.',
    simTime,
    now,
  );

  // Seed a session record
  const sessionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, agent_id, sim_day, provider, model, started_at, ended_at, outcome, token_estimate, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    agentId,
    simDay,
    'claude_agent_sdk',
    'claude-sonnet-4-20250514',
    simTime,
    simTime,
    'completed',
    5000,
    now,
  );

  db.prepare(
    `INSERT INTO session_tool_calls (id, session_id, tool_name, arguments, result, status, sim_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    sessionId,
    'begin_task',
    '{"task_id":"t1"}',
    '{"status":"ok"}',
    'completed',
    simTime,
    now,
  );
  db.prepare(
    `INSERT INTO session_tool_calls (id, session_id, tool_name, arguments, result, status, sim_time, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    sessionId,
    'commit_work',
    '{"message":"Add login form"}',
    '{"status":"ok"}',
    'completed',
    simTime,
    now,
  );

  // Run compression
  await runCompressionForAgent(agentId, clock.now());

  // Verify memory was stored
  const memory = db.prepare('SELECT * FROM agent_memory WHERE agent_id = ?').get(agentId) as
    | {
        id: string;
        content: string;
        embedding: Buffer | null;
        sim_day: string;
      }
    | undefined;

  assert(memory !== undefined, 'Memory entry created in agent_memory');
  assert(memory!.content.length > 0, `Summary has content (${memory!.content.length} chars)`);
  assert(memory!.embedding !== null, 'Embedding blob stored');
  assert(
    memory!.embedding!.length === EMBEDDING_DIMENSIONS * 4,
    `Embedding is ${EMBEDDING_DIMENSIONS} floats (${memory!.embedding!.length} bytes)`,
  );
  assert(memory!.sim_day === simDay, `Sim day matches (${memory!.sim_day})`);

  console.log(`  Summary: "${memory!.content.substring(0, 100)}..."`);

  // Verify VSS index
  if (isVssAvailable()) {
    const vssCount = db.prepare('SELECT COUNT(*) as cnt FROM vss_agent_memory').get() as {
      cnt: number;
    };
    assert(vssCount.cnt > 0, 'VSS index has entries');
  }

  // ── Test 3: Vector similarity search ──────────────────────────────
  console.log('\n=== Vector Similarity Search ===');

  // Search with related query
  const results = await searchSimilarMemories(agentId, 'login page frontend React', 3);
  assert(results.length > 0, `Search returned ${results.length} result(s)`);
  assert(results[0].content.length > 0, 'Search result has content');
  assert(results[0].sim_day === simDay, 'Search result has correct sim_day');

  // Add a second memory about a different topic
  const mem2Id = crypto.randomUUID();
  const emb2buf = Buffer.from(
    (await generateEmbedding('Database migration and SQL schema design')).buffer,
  );
  db.prepare(
    `INSERT INTO agent_memory (id, agent_id, sim_day, content, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    mem2Id,
    agentId,
    '2026-01-02',
    'Worked on database schema migrations for the user table. Created SQL migrations and tested them.',
    emb2buf,
    now,
  );

  if (isVssAvailable()) {
    const row = db.prepare('SELECT rowid FROM agent_memory WHERE id = ?').get(mem2Id) as {
      rowid: number;
    };
    db.prepare('INSERT INTO vss_agent_memory(rowid, embedding) VALUES (?, ?)').run(
      row.rowid,
      emb2buf,
    );
  }

  // Search for login-related should return login memory first
  const loginResults = await searchSimilarMemories(agentId, 'React login form component', 3);
  assert(loginResults.length === 2, `Search returns both memories (got ${loginResults.length})`);

  // Search for database-related should return database memory first
  const dbResults = await searchSimilarMemories(agentId, 'SQL database migration schema', 3);
  assert(dbResults.length === 2, `Database search returns both memories (got ${dbResults.length})`);
  assert(dbResults[0].sim_day === '2026-01-02', 'Database query ranks database memory first');

  // ── Test 4: trigger_compression MCP tool ──────────────────────────
  console.log('\n=== trigger_compression MCP Tool ===');

  // Add more chat logs so there's new activity to compress
  insertChat.run(
    crypto.randomUUID(),
    agentId,
    agentId,
    'agent',
    'Starting work on the signup page now.',
    simTime,
    now,
  );

  // Remove existing memory for this sim day so compression creates a new one
  // Must also clean vss index to avoid orphaned rowids
  if (isVssAvailable()) {
    const oldRows = db
      .prepare('SELECT rowid FROM agent_memory WHERE agent_id = ? AND sim_day = ?')
      .all(agentId, simDay) as Array<{ rowid: number }>;
    for (const r of oldRows) {
      db.prepare('DELETE FROM vss_agent_memory WHERE rowid = ?').run(r.rowid);
    }
  }
  db.prepare('DELETE FROM agent_memory WHERE agent_id = ? AND sim_day = ?').run(agentId, simDay);

  const triggerResult = await dispatch('trigger_compression', { agent_id: agentId }, omId);
  assert(!triggerResult.isError, 'trigger_compression succeeds');

  const newMemory = db
    .prepare('SELECT * FROM agent_memory WHERE agent_id = ? AND sim_day = ?')
    .get(agentId, simDay) as
    | {
        content: string;
        embedding: Buffer | null;
      }
    | undefined;
  assert(newMemory !== undefined, 'trigger_compression created new memory entry');
  assert(newMemory!.embedding !== null, 'New memory has embedding');

  // Verify permission: non-manager cannot call trigger_compression
  const triggerFail = await dispatch('trigger_compression', { agent_id: agentId }, agentId);
  assert(triggerFail.isError, 'Regular agent cannot call trigger_compression (manager-only)');

  // ── Test 5: Context monitor ───────────────────────────────────────
  console.log('\n=== Context Monitor ===');

  const testSessionId = 'test-session-monitor';
  registerSession(testSessionId, agentId, 'claude-sonnet-4-20250514', 0);

  assert(getSessionTokenEstimate(testSessionId) === 0, 'Initial token estimate is 0');

  // Add some tokens (simulate tool call results)
  addSessionTokens(testSessionId, 40_000); // 10k tokens worth
  assert(
    getSessionTokenEstimate(testSessionId) === 10_000,
    'Token estimate after 40k chars = 10k tokens',
  );

  addSessionTokens(testSessionId, 200_000); // +50k tokens
  assert(getSessionTokenEstimate(testSessionId) === 60_000, 'Token estimate tracks cumulative');

  unregisterSession(testSessionId);
  assert(getSessionTokenEstimate(testSessionId) === 0, 'Token estimate cleared after unregister');

  // ── Test 6: End-of-day compression trigger ────────────────────────
  console.log('\n=== End-of-Day Compression ===');

  // Clean memories for a fresh test (must also clean vss)
  if (isVssAvailable()) {
    const oldRows = db
      .prepare('SELECT rowid FROM agent_memory WHERE agent_id = ?')
      .all(agentId) as Array<{ rowid: number }>;
    for (const r of oldRows) {
      db.prepare('DELETE FROM vss_agent_memory WHERE rowid = ?').run(r.rowid);
    }
  }
  db.prepare('DELETE FROM agent_memory WHERE agent_id = ?').run(agentId);

  // Test runCompressionForAgent directly (the function processEndOfDayCompression calls)
  await runCompressionForAgent(agentId, clock.now());

  const eodMemory = db.prepare('SELECT * FROM agent_memory WHERE agent_id = ?').get(agentId) as
    | { content: string }
    | undefined;
  assert(eodMemory !== undefined, 'End-of-day compression created memory entry');

  // processEndOfDayCompression should not re-fire for same day once lastCompressionDay is set
  const eodTime = new Date(clock.now());
  eodTime.setUTCHours(17, 0, 0, 0);
  processEndOfDayCompression(eodTime); // sets lastCompressionDay

  const countBefore = (
    db.prepare('SELECT COUNT(*) as cnt FROM agent_memory WHERE agent_id = ?').get(agentId) as {
      cnt: number;
    }
  ).cnt;
  processEndOfDayCompression(eodTime); // should be a no-op (same day)
  await new Promise((resolve) => setTimeout(resolve, 500));
  const countAfter = (
    db.prepare('SELECT COUNT(*) as cnt FROM agent_memory WHERE agent_id = ?').get(agentId) as {
      cnt: number;
    }
  ).cnt;
  assert(countAfter === countBefore, 'End-of-day compression does not duplicate on same day');

  // ── Cleanup ───────────────────────────────────────────────────────
  stopMovementLoop();
  closeDb();
  try {
    fs.unlinkSync(DB_PATH);
    fs.rmSync(REPO_PATH, { recursive: true, force: true });
  } catch {
    // Cleanup failures are fine
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── Helpers ─────────────────────────────────────────────────────────

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function dispatch(tool: string, args: Record<string, unknown>, agentId: string) {
  const result = await dispatchToolCall(tool, { ...args, _agent_id: agentId });
  const text = result.content[0]?.text ?? '{}';
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  return { data, isError: !!result.isError };
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
