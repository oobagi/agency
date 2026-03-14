import crypto from 'node:crypto';
import { getDb } from './db.js';
import { onAgentStateChange } from './team-manager.js';

// ── Types ──────────────────────────────────────────────────────────

interface ScheduledJob {
  id: string;
  agent_id: string;
  job_type: string;
  sim_time: string;
  recurrence: string | null;
  missed_policy: string;
  payload: string;
  created_at: string;
}

interface QueuedJob {
  id: string;
  agent_id: string;
  job_type: string;
  payload: string;
  status: string;
}

// ── Job type handlers ──────────────────────────────────────────────
// Each handler receives the agent_id, parsed payload, and current sim time.
// Returns true if the job was executed, false if it should be queued.

type JobHandler = (agentId: string, payload: Record<string, unknown>, simTime: Date) => boolean;

const jobHandlers: Record<string, JobHandler> = {
  arrive: handleArrive,
  lunch_break: handleLunchBreak,
  return_from_lunch: handleReturnFromLunch,
  depart: handleDepart,
};

// ── State transition helpers ───────────────────────────────────────
// These directly update the agent state in the DB.
// The full state machine validation (Phase 4.3) will replace these
// with proper transition map checks. For now, we do best-effort transitions.

function setAgentState(agentId: string, newState: string): boolean {
  const db = getDb();
  const oldState = getAgentState(agentId);
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE agents SET state = ?, updated_at = ? WHERE id = ? AND fired_at IS NULL')
    .run(newState, now, agentId);

  if (result.changes > 0 && oldState) {
    onAgentStateChange(agentId, oldState, newState);
  }

  return result.changes > 0;
}

function getAgentState(agentId: string): string | null {
  const db = getDb();
  const row = db
    .prepare('SELECT state FROM agents WHERE id = ? AND fired_at IS NULL')
    .get(agentId) as { state: string } | undefined;
  return row?.state ?? null;
}

// ── Job handlers ───────────────────────────────────────────────────

function handleArrive(agentId: string, _payload: Record<string, unknown>, _simTime: Date): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;

  // Arriving is valid from Departing (next day) or if agent was just hired (Idle on first day)
  if (state === 'Departing' || state === 'Idle') {
    setAgentState(agentId, 'Arriving');
    console.log(`[scheduler] ${agentId} → Arriving`);
    return true;
  }

  // Already in office (e.g. didn't depart yesterday), skip
  if (state === 'Arriving' || state === 'Walking') return true;

  console.log(`[scheduler] ${agentId} arrive skipped (state=${state})`);
  return true;
}

function handleLunchBreak(
  agentId: string,
  _payload: Record<string, unknown>,
  _simTime: Date,
): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;

  // Valid transitions to Break: from Idle, Programming, Researching, or Walking
  const canBreak = ['Idle', 'Programming', 'Researching', 'Walking'];
  if (canBreak.includes(state)) {
    setAgentState(agentId, 'Break');
    console.log(`[scheduler] ${agentId} → Break (lunch)`);
    return true;
  }

  // If in Meeting or Reviewing, queue for later
  if (state === 'Meeting' || state === 'Reviewing') {
    return false;
  }

  // Already on break or blocked/departing — skip
  return true;
}

function handleReturnFromLunch(
  agentId: string,
  _payload: Record<string, unknown>,
  _simTime: Date,
): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;

  if (state === 'Break') {
    // Transition Break → Walking (heading back to desk)
    setAgentState(agentId, 'Walking');
    console.log(`[scheduler] ${agentId} → Walking (return from lunch)`);
    return true;
  }

  // Not on break — skip
  return true;
}

function handleDepart(agentId: string, _payload: Record<string, unknown>, _simTime: Date): boolean {
  const state = getAgentState(agentId);
  if (!state) return false;

  // Valid transitions to Departing: from Break, Idle
  const canDepart = ['Break', 'Idle'];
  if (canDepart.includes(state)) {
    setAgentState(agentId, 'Departing');
    console.log(`[scheduler] ${agentId} → Departing`);
    return true;
  }

  // If busy (Programming, Meeting, etc.), queue for later
  if (['Programming', 'Researching', 'Meeting', 'Reviewing', 'Walking'].includes(state)) {
    return false;
  }

  // Already departing or blocked — skip
  return true;
}

// ── Register custom job handler ────────────────────────────────────

export function registerJobHandler(jobType: string, handler: JobHandler): void {
  jobHandlers[jobType] = handler;
}

// ── Create daily schedule for agent ────────────────────────────────

export function createDailyScheduleForAgent(agentId: string, simTime: Date): void {
  const db = getDb();
  const now = new Date().toISOString();
  const simDay = simTime.toISOString().split('T')[0];

  // Calculate the next occurrence for each daily job.
  // If we're past that time today, schedule for tomorrow.
  const scheduleItems = [
    { jobType: 'arrive', hour: 8 },
    { jobType: 'lunch_break', hour: 12 },
    { jobType: 'return_from_lunch', hour: 13 },
    { jobType: 'depart', hour: 17 },
  ];

  const insert = db.prepare(
    `INSERT INTO scheduled_jobs (id, agent_id, job_type, sim_time, recurrence, missed_policy, payload, created_at)
     VALUES (?, ?, ?, ?, 'daily', ?, '{}', ?)`,
  );

  const tx = db.transaction(() => {
    for (const item of scheduleItems) {
      const jobTime = new Date(simTime);
      jobTime.setUTCHours(item.hour, 0, 0, 0);

      // If we're past this time today, schedule for tomorrow
      if (jobTime.getTime() <= simTime.getTime()) {
        jobTime.setUTCDate(jobTime.getUTCDate() + 1);
      }

      const missedPolicy = item.jobType === 'arrive' ? 'fire_immediately' : 'skip_to_next';

      insert.run(
        crypto.randomUUID(),
        agentId,
        item.jobType,
        jobTime.toISOString(),
        missedPolicy,
        now,
      );
    }
  });

  tx();
  console.log(`[scheduler] Created daily schedule for agent ${agentId} (day: ${simDay})`);
}

// ── Remove schedule for agent (on firing) ──────────────────────────

export function removeScheduleForAgent(agentId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM scheduled_jobs WHERE agent_id = ?').run(agentId);
  db.prepare("DELETE FROM job_queue WHERE agent_id = ? AND status = 'pending'").run(agentId);
  console.log(`[scheduler] Removed schedule for agent ${agentId}`);
}

// ── Tick handler: check and fire due jobs ──────────────────────────

export function processTick(simTime: Date): void {
  const db = getDb();
  const simTimeStr = simTime.toISOString();

  // Find all due scheduled jobs
  const dueJobs = db
    .prepare('SELECT * FROM scheduled_jobs WHERE sim_time <= ?')
    .all(simTimeStr) as ScheduledJob[];

  for (const job of dueJobs) {
    executeOrQueueJob(job, simTime);
    advanceJobSchedule(job, simTime);
  }

  // Process any queued jobs for agents that are now idle
  processJobQueue(simTime);
}

// ── Boot: handle missed jobs ───────────────────────────────────────

export function handleMissedJobsOnBoot(simTime: Date): void {
  const db = getDb();
  const simTimeStr = simTime.toISOString();

  const missedJobs = db
    .prepare('SELECT * FROM scheduled_jobs WHERE sim_time <= ?')
    .all(simTimeStr) as ScheduledJob[];

  if (missedJobs.length === 0) return;

  console.log(`[scheduler] Processing ${missedJobs.length} missed jobs on boot`);

  for (const job of missedJobs) {
    if (job.missed_policy === 'fire_immediately') {
      console.log(`[scheduler] Firing missed job ${job.job_type} for agent ${job.agent_id}`);
      executeOrQueueJob(job, simTime);
    } else {
      console.log(`[scheduler] Skipping missed job ${job.job_type} for agent ${job.agent_id}`);
    }
    advanceJobSchedule(job, simTime);
  }
}

// ── MCP tool handler: schedule_event ───────────────────────────────

export async function handleScheduleEvent(
  args: Record<string, unknown>,
  _callerAgentId: string,
  simNow: () => Date,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const agentId = args.agent_id as string;
  const jobType = args.job_type as string;
  const simTimeStr = args.sim_time as string;
  const recurrence = (args.recurrence as string) || null;
  const payload = args.payload ?? {};

  if (!agentId) return mcpError('agent_id is required');
  if (!jobType) return mcpError('job_type is required');
  if (!simTimeStr) return mcpError('sim_time is required');

  // Validate sim_time is in the future
  const simTime = new Date(simTimeStr);
  if (isNaN(simTime.getTime())) return mcpError('sim_time is not a valid ISO 8601 date');
  if (simTime.getTime() <= simNow().getTime()) {
    return mcpError('sim_time must be in the future');
  }

  const db = getDb();

  // Verify agent exists
  const agent = db.prepare('SELECT id FROM agents WHERE id = ? AND fired_at IS NULL').get(agentId);
  if (!agent) return mcpError(`Agent "${agentId}" not found or has been fired`);

  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO scheduled_jobs (id, agent_id, job_type, sim_time, recurrence, missed_policy, payload, created_at)
     VALUES (?, ?, ?, ?, ?, 'fire_immediately', ?, ?)`,
  ).run(jobId, agentId, jobType, simTime.toISOString(), recurrence, JSON.stringify(payload), now);

  console.log(`[scheduler] Scheduled ${jobType} for agent ${agentId} at ${simTimeStr}`);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          job_id: jobId,
          agent_id: agentId,
          job_type: jobType,
          sim_time: simTime.toISOString(),
          recurrence,
          message: `Scheduled "${jobType}" for agent ${agentId} at ${simTime.toISOString()}.`,
        }),
      },
    ],
  };
}

// ── REST query helpers ─────────────────────────────────────────────

export function getScheduledJobs(agentId?: string): unknown[] {
  const db = getDb();
  if (agentId) {
    return db
      .prepare('SELECT * FROM scheduled_jobs WHERE agent_id = ? ORDER BY sim_time ASC')
      .all(agentId);
  }
  return db.prepare('SELECT * FROM scheduled_jobs ORDER BY sim_time ASC').all();
}

export function getJobQueue(agentId?: string): unknown[] {
  const db = getDb();
  if (agentId) {
    return db
      .prepare(
        "SELECT * FROM job_queue WHERE agent_id = ? AND status = 'pending' ORDER BY queued_at ASC",
      )
      .all(agentId);
  }
  return db
    .prepare("SELECT * FROM job_queue WHERE status = 'pending' ORDER BY queued_at ASC")
    .all();
}

// ── Internal helpers ───────────────────────────────────────────────

function executeOrQueueJob(job: ScheduledJob, simTime: Date): void {
  const handler = jobHandlers[job.job_type];
  const payload = JSON.parse(job.payload) as Record<string, unknown>;

  if (!handler) {
    console.warn(`[scheduler] No handler for job type "${job.job_type}"`);
    return;
  }

  const executed = handler(job.agent_id, payload, simTime);

  if (!executed) {
    // Agent is busy — queue the job
    const db = getDb();
    db.prepare(
      `INSERT INTO job_queue (id, agent_id, job_type, payload, status, queued_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(crypto.randomUUID(), job.agent_id, job.job_type, job.payload, simTime.toISOString());
    console.log(`[scheduler] Queued ${job.job_type} for busy agent ${job.agent_id}`);
  }
}

function advanceJobSchedule(job: ScheduledJob, simTime: Date): void {
  const db = getDb();

  if (job.recurrence === 'daily') {
    // Advance to the next day at the same time
    const nextTime = new Date(job.sim_time);
    // Keep advancing until we're past the current sim time
    while (nextTime.getTime() <= simTime.getTime()) {
      nextTime.setUTCDate(nextTime.getUTCDate() + 1);
    }
    db.prepare('UPDATE scheduled_jobs SET sim_time = ? WHERE id = ?').run(
      nextTime.toISOString(),
      job.id,
    );
  } else if (job.recurrence) {
    // Future: support other recurrence patterns
    // For now, treat unknown recurrence as one-shot
    db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(job.id);
  } else {
    // One-shot job — remove it
    db.prepare('DELETE FROM scheduled_jobs WHERE id = ?').run(job.id);
  }
}

function processJobQueue(simTime: Date): void {
  const db = getDb();

  // Find idle agents with pending queued jobs
  const pendingJobs = db
    .prepare(
      `SELECT jq.* FROM job_queue jq
       JOIN agents a ON jq.agent_id = a.id
       WHERE jq.status = 'pending' AND a.state = 'Idle' AND a.fired_at IS NULL
       ORDER BY jq.queued_at ASC`,
    )
    .all() as QueuedJob[];

  for (const qJob of pendingJobs) {
    const handler = jobHandlers[qJob.job_type];
    if (!handler) continue;

    const payload = JSON.parse(qJob.payload) as Record<string, unknown>;
    const executed = handler(qJob.agent_id, payload, simTime);

    if (executed) {
      db.prepare("UPDATE job_queue SET status = 'completed', completed_at = ? WHERE id = ?").run(
        simTime.toISOString(),
        qJob.id,
      );
    }
  }
}

function mcpError(message: string) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}
