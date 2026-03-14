/**
 * Integration test for Phases 4.4, 4.5, 4.6
 * Tests the full flow: create project → create team → hire agents →
 * assign to team → create task → begin task → complete task → open PR →
 * review PR → merge PR. Also tests speak proximity enforcement and
 * send_to_manager.
 *
 * Run: npx tsx test/integration.ts
 */

import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const testId = crypto.randomUUID().slice(0, 8);
const DB_PATH = path.join(os.tmpdir(), `agency-test-${testId}.db`);
process.env.AGENCY_DB_PATH = DB_PATH;
const REPO_PATH = path.join(os.tmpdir(), `agency-test-repo-${testId}`);

const { initDb, closeDb, getDb } = await import('../src/db.js');
const { dispatchToolCall, setSimClock } = await import('../src/mcp/server.js');
const { SimClock } = await import('../src/sim-clock.js');
const { setMovementSimClock, startMovementLoop, stopMovementLoop } =
  await import('../src/movement.js');
const { setCommunicationSimClock } = await import('../src/handlers/communication.js');
const { initOfficeManager, setOfficeManagerSimClock } = await import('../src/office-manager.js');
const { setTeamManagerSimClock } = await import('../src/team-manager.js');
const { setContextSimClock } = await import('../src/context-assembly.js');
const { setIdleCheckerSimClock } = await import('../src/idle-checker.js');

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

function parseResult(result: {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}) {
  const text = result.content[0]?.text ?? '{}';
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text };
  }
  return { data, isError: !!result.isError };
}

async function call(tool: string, args: Record<string, unknown>, agentId = '') {
  const result = await dispatchToolCall(tool, { ...args, _agent_id: agentId });
  return parseResult(result);
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

  // Seed two test personas so we don't need the GitHub fetch
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO personas (id, name, github_username, bio, system_prompt, specialties, fetched_at, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'persona-1',
    'Alice Dev',
    'alicedev',
    'Frontend dev',
    'You are Alice.',
    '["frontend"]',
    now,
    'test',
  );
  db.prepare(
    `INSERT INTO personas (id, name, github_username, bio, system_prompt, specialties, fetched_at, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'persona-2',
    'Bob Backend',
    'bobbackend',
    'Backend dev',
    'You are Bob.',
    '["backend"]',
    now,
    'test',
  );

  // Get the Office Manager
  const om = db.prepare("SELECT id FROM agents WHERE role = 'office_manager'").get() as {
    id: string;
  };
  const omId = om.id;

  // Get a persona for hiring
  const persona = db.prepare('SELECT id FROM personas LIMIT 1').get() as { id: string } | undefined;

  console.log('\n=== Phase 4.6: Project & Git Operations ===');

  // Create project
  const proj = await call(
    'create_project',
    {
      name: 'TestProject',
      description: 'A test project',
      repo_path: REPO_PATH,
    },
    omId,
  );
  assert(!proj.isError, 'create_project succeeds');
  assert(fs.existsSync(REPO_PATH), 'Git repo created on disk');
  assert(fs.existsSync(path.join(REPO_PATH, '.git')), '.git directory exists');
  const projectId = proj.data.project_id;

  // Create team
  const team = await call('create_team', { name: 'Alpha', color: '#3B82F6' }, omId);
  assert(!team.isError, 'create_team succeeds');
  const teamId = team.data.team_id;

  // Assign team to project
  const atp = await call(
    'assign_team_to_project',
    { team_id: teamId, project_id: projectId },
    omId,
  );
  assert(!atp.isError, 'assign_team_to_project succeeds');

  // Hire a team manager
  let tmId = '';
  if (persona) {
    const tmResult = await call(
      'hire_agent',
      { persona_id: persona.id, role: 'team_manager' },
      omId,
    );
    assert(!tmResult.isError, 'hire_agent (team_manager) succeeds');
    tmId = tmResult.data.agent_id;

    // Assign TM to team
    const assignTm = await call('assign_agent_to_team', { agent_id: tmId, team_id: teamId }, omId);
    assert(!assignTm.isError, 'assign TM to team succeeds');

    // Hire a regular agent
    const persona2 = db
      .prepare('SELECT id FROM personas WHERE id != ? LIMIT 1')
      .get(persona.id) as { id: string };
    const agentResult = await call('hire_agent', { persona_id: persona2.id }, omId);
    assert(!agentResult.isError, 'hire_agent (regular) succeeds');
    const agentId = agentResult.data.agent_id;

    // Assign agent to team
    const assignAgent = await call(
      'assign_agent_to_team',
      { agent_id: agentId, team_id: teamId },
      omId,
    );
    assert(!assignAgent.isError, 'assign agent to team succeeds');

    // Create worktree
    const wt = await call(
      'create_worktree',
      {
        project_id: projectId,
        team_id: teamId,
        branch_name: 'feature/test',
      },
      omId,
    );
    assert(!wt.isError, 'create_worktree succeeds');
    assert(fs.existsSync(wt.data.worktree_path), 'Worktree directory created on disk');
    const worktreeId = wt.data.worktree_id;

    console.log('\n=== Phase 4.5: Task System ===');

    // Create task
    const task = await call(
      'create_task',
      {
        title: 'Build login page',
        description: 'Create a login page with email/password',
        team_id: teamId,
        project_id: projectId,
        agent_id: agentId,
      },
      omId,
    );
    assert(!task.isError, 'create_task succeeds');
    const taskId = task.data.task_id;

    // begin_task — should fail (agent not at desk, state is Idle but position might be wrong)
    // First, agent is at their desk after assign_agent_to_team, so it should work
    const begin = await call('begin_task', { task_id: taskId }, agentId);
    assert(!begin.isError, 'begin_task succeeds (agent at desk)');
    assert(begin.data.state === 'Programming', 'Agent transitions to Programming');

    // Verify task is in_progress
    const taskRow = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as {
      status: string;
    };
    assert(taskRow.status === 'in_progress', 'Task status is in_progress');

    // begin_task on already started task should fail
    const beginAgain = await call('begin_task', { task_id: taskId }, agentId);
    assert(beginAgain.isError, 'begin_task on in_progress task fails');

    // commit_work
    const commit = await call(
      'commit_work',
      {
        message: 'Add login form component',
        worktree_id: worktreeId,
      },
      agentId,
    );
    assert(!commit.isError, 'commit_work succeeds');

    // complete_task
    const complete = await call('complete_task', { task_id: taskId }, agentId);
    assert(!complete.isError, 'complete_task succeeds');
    assert(complete.data.status === 'completed', 'Task marked completed');

    // Verify agent is Idle
    const agentState = db.prepare('SELECT state FROM agents WHERE id = ?').get(agentId) as {
      state: string;
    };
    assert(agentState.state === 'Idle', 'Agent transitions to Idle after completion');

    // report_blocker
    // First create and begin another task
    const task2 = await call(
      'create_task',
      {
        title: 'Fix CSS bug',
        description: 'Buttons are misaligned',
        team_id: teamId,
        project_id: projectId,
        agent_id: agentId,
      },
      omId,
    );
    await call('begin_task', { task_id: task2.data.task_id }, agentId);

    const blocker = await call(
      'report_blocker',
      {
        description: 'Cannot access design system package',
        task_id: task2.data.task_id,
      },
      agentId,
    );
    assert(!blocker.isError, 'report_blocker succeeds');

    const blockedAgent = db.prepare('SELECT state FROM agents WHERE id = ?').get(agentId) as {
      state: string;
    };
    assert(blockedAgent.state === 'Blocked', 'Agent transitions to Blocked');

    const blockedTask = db
      .prepare('SELECT status FROM tasks WHERE id = ?')
      .get(task2.data.task_id) as { status: string };
    assert(blockedTask.status === 'blocked', 'Task status set to blocked');

    // Unblock agent for PR tests
    db.prepare("UPDATE agents SET state = 'Idle' WHERE id = ?").run(agentId);

    console.log('\n=== Phase 4.6: PR Workflow ===');

    // Open PR
    const pr = await call(
      'open_pull_request',
      {
        title: 'Add login page',
        description: 'Implements the login page with email/password auth',
        source_branch: 'feature/test',
        target_branch: 'main',
        worktree_id: worktreeId,
      },
      agentId,
    );
    assert(!pr.isError, 'open_pull_request succeeds');
    const prId = pr.data.pull_request_id;

    // Agent tries to review own PR — should fail
    const selfReview = await call(
      'review_pull_request',
      {
        pull_request_id: prId,
        decision: 'approved',
      },
      agentId,
    );
    assert(selfReview.isError, 'Agent cannot review own PR (hard constraint 7)');

    // TM reviews PR
    const review = await call(
      'review_pull_request',
      {
        pull_request_id: prId,
        decision: 'approved',
        comments: 'LGTM',
      },
      tmId,
    );
    assert(!review.isError, 'TM can review PR');
    assert(review.data.decision === 'approved', 'PR is approved');

    // Agent tries to merge own PR — should fail
    const selfMerge = await call(
      'merge_pull_request',
      {
        pull_request_id: prId,
      },
      agentId,
    );
    assert(selfMerge.isError, 'Agent cannot merge own PR (hard constraint 7)');

    // TM merges PR
    const merge = await call(
      'merge_pull_request',
      {
        pull_request_id: prId,
      },
      tmId,
    );
    assert(!merge.isError, 'TM can merge approved PR');
    assert(merge.data.status === 'merged', 'PR status is merged');

    // Verify PR status in DB
    const prRow = db.prepare('SELECT status FROM pull_requests WHERE id = ?').get(prId) as {
      status: string;
    };
    assert(prRow.status === 'merged', 'PR is merged in database');

    console.log('\n=== Phase 4.4: Physical Communication ===');

    // speak — agents are at different desks, not within proximity
    // First check agent positions
    const agentPos = db
      .prepare('SELECT position_x, position_z FROM agents WHERE id = ?')
      .get(agentId) as { position_x: number; position_z: number };
    const tmPos = db
      .prepare('SELECT position_x, position_z FROM agents WHERE id = ?')
      .get(tmId) as { position_x: number; position_z: number };
    const dx = Math.abs(agentPos.position_x - tmPos.position_x);
    const dz = Math.abs(agentPos.position_z - tmPos.position_z);
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance > 2.5) {
      // They're far apart — speak should fail
      const speakFar = await call('speak', { message: 'Hello!' }, agentId);
      assert(speakFar.isError, 'speak fails when no agents within proximity');
    }

    // Move agent next to TM manually for speak test
    db.prepare('UPDATE agents SET position_x = ?, position_z = ? WHERE id = ?').run(
      tmPos.position_x + 1,
      tmPos.position_z,
      agentId,
    );

    const speakClose = await call('speak', { message: 'Hey, I finished the login page!' }, agentId);
    assert(!speakClose.isError, 'speak succeeds when agents within proximity');

    // Verify conversation was recorded
    const convos = db.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as { cnt: number };
    assert(convos.cnt > 0, 'Conversation recorded in database');

    const msgs = db.prepare('SELECT COUNT(*) as cnt FROM conversation_messages').get() as {
      cnt: number;
    };
    assert(msgs.cnt > 0, 'Conversation messages recorded');

    // send_to_manager — move agent away first
    db.prepare(
      "UPDATE agents SET position_x = 100, position_z = 100, state = 'Idle' WHERE id = ?",
    ).run(agentId);

    const sendMsg = await call(
      'send_to_manager',
      { message: 'Need help with deployment' },
      agentId,
    );
    assert(!sendMsg.isError, 'send_to_manager initiates walk');
    assert(sendMsg.data.message?.includes('Walking'), 'send_to_manager returns walking message');

    // Verify agent is in Walking state
    const walkingAgent = db.prepare('SELECT state FROM agents WHERE id = ?').get(agentId) as {
      state: string;
    };
    assert(walkingAgent.state === 'Walking', 'Agent transitions to Walking for send_to_manager');

    // Test send_to_manager when already near manager
    db.prepare("UPDATE agents SET position_x = ?, position_z = ?, state = 'Idle' WHERE id = ?").run(
      tmPos.position_x + 1,
      tmPos.position_z,
      agentId,
    );

    const sendNear = await call('send_to_manager', { message: 'Quick question' }, agentId);
    assert(!sendNear.isError, 'send_to_manager delivers immediately when near');
    assert(sendNear.data.delivered_to !== undefined, 'Message delivered directly');
  } else {
    console.log('  ⚠ No personas loaded — skipping agent-level tests');
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 7.0: Office Layout Endpoint & Seed Data
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== Phase 7.0: Office Layout & Meeting Rooms ===');

  // Meeting rooms seeded by migration 004
  const meetingRooms = db.prepare('SELECT * FROM meeting_rooms').all() as Array<{
    id: string;
    name: string;
    capacity: number;
  }>;
  assert(meetingRooms.length === 3, `3 meeting rooms seeded (got ${meetingRooms.length})`);

  const roomNames = meetingRooms.map((r) => r.name).sort();
  assert(
    roomNames.includes('Alpha Room') &&
      roomNames.includes('Beta Room') &&
      roomNames.includes('Gamma Room'),
    'Meeting rooms are Alpha, Beta, Gamma',
  );

  // Office layout seeded by migration 005
  const layoutElements = db.prepare('SELECT * FROM office_layout').all() as Array<{
    id: string;
    type: string;
  }>;
  assert(layoutElements.length > 0, 'Office layout elements seeded');

  const floor = layoutElements.filter((e) => e.type === 'floor');
  assert(floor.length === 1, 'One floor element exists');

  const walls = layoutElements.filter((e) => e.type === 'wall');
  assert(walls.length > 0, 'Wall elements exist');

  const outerWalls = walls.filter(
    (w) =>
      w.id.startsWith('wall-north') ||
      w.id.startsWith('wall-south') ||
      w.id.startsWith('wall-east') ||
      w.id.startsWith('wall-west'),
  );
  assert(outerWalls.length === 4, `4 outer walls (got ${outerWalls.length})`);

  const roomWalls = walls.filter(
    (w) =>
      w.id.startsWith('wall-alpha') ||
      w.id.startsWith('wall-beta') ||
      w.id.startsWith('wall-gamma'),
  );
  assert(roomWalls.length === 12, `12 meeting room walls (4 per room, got ${roomWalls.length})`);

  // ══════════════════════════════════════════════════════════════════
  // Phase 7.1: retargetWalking
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== Phase 7.1: retargetWalking ===');

  if (tmId) {
    const { retargetWalking, startWalking } = await import('../src/movement.js');

    // Put agent in walkable state
    db.prepare("UPDATE agents SET state = 'Idle', position_x = 0, position_z = 0 WHERE id = ?").run(
      tmId,
    );

    // Start walking
    startWalking(tmId, 10, 10, 'test-target');
    const walkState = db.prepare('SELECT state FROM agents WHERE id = ?').get(tmId) as {
      state: string;
    };
    assert(walkState.state === 'Walking', 'Agent enters Walking state');

    // Retarget
    const retargeted = retargetWalking(tmId, 20, 20);
    assert(retargeted === true, 'retargetWalking succeeds for walking agent');

    // Non-existent agent
    const failRetarget = retargetWalking('nonexistent', 0, 0);
    assert(failRetarget === false, 'retargetWalking fails for unknown agent');

    // Reset
    db.prepare("UPDATE agents SET state = 'Idle' WHERE id = ?").run(tmId);
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 7.2: SessionRecorder.onComplete
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== Phase 7.2: SessionRecorder.onComplete ===');

  // Verify SessionRecorder class has onComplete method
  const { SessionRecorder } = await import('../src/session-recorder.js');
  assert(
    typeof SessionRecorder.prototype.onComplete === 'function',
    'SessionRecorder has onComplete method',
  );

  // ══════════════════════════════════════════════════════════════════
  // Phase 7.4: Conversations API
  // ══════════════════════════════════════════════════════════════════
  console.log('\n=== Phase 7.4: Conversations API ===');

  const { getConversations, getConversation } = await import('../src/handlers/communication.js');

  // We already have a conversation from the speak test above
  const allConvos = getConversations({});
  assert(allConvos.total > 0, 'getConversations returns total count');
  assert(allConvos.conversations.length > 0, 'getConversations returns conversations');

  const firstConvo = allConvos.conversations[0] as Record<string, unknown>;
  assert('participant_names' in firstConvo, 'Conversations include participant_names');
  assert('first_message' in firstConvo, 'Conversations include first_message');
  assert('message_count' in firstConvo, 'Conversations include message_count');

  // Filter by type
  const filteredByType = getConversations({ type: 'one_on_one' });
  for (const c of filteredByType.conversations as Array<Record<string, unknown>>) {
    assert(c.type === 'one_on_one', 'Type filter works');
  }

  // Filter by participant name
  const filteredByParticipant = getConversations({ participant: 'Bob' });
  assert(filteredByParticipant.total > 0, 'Participant filter finds conversations');

  // Filter by search (message keyword)
  const filteredBySearch = getConversations({ search: 'login' });
  assert(filteredBySearch.total > 0, 'Search filter finds conversations by keyword');

  // Search with no results
  const noResults = getConversations({ search: 'zzz_nonexistent_zzz' });
  assert(noResults.total === 0, 'Search filter returns 0 for non-matching keyword');

  // Pagination
  const page1 = getConversations({ limit: 1, offset: 0 });
  assert(page1.conversations.length <= 1, 'Pagination limit works');

  // Get conversation detail
  const convoId = (allConvos.conversations[0] as Record<string, unknown>).id as string;
  const detail = getConversation(convoId) as Record<string, unknown>;
  assert(detail !== undefined, 'getConversation returns detail');
  assert(Array.isArray(detail.participants), 'Detail includes participants array');
  assert(Array.isArray(detail.messages), 'Detail includes messages array');

  // setConversationBroadcast exists
  const { setConversationBroadcast } = await import('../src/handlers/communication.js');
  assert(typeof setConversationBroadcast === 'function', 'setConversationBroadcast is exported');

  console.log('\n=== Delete project ===');
  const del = await call('delete_project', { project_id: projectId }, omId);
  assert(!del.isError, 'delete_project succeeds');

  // Cleanup
  stopMovementLoop();
  closeDb();
  try {
    fs.unlinkSync(DB_PATH);
    fs.rmSync(REPO_PATH, { recursive: true, force: true });
    // Clean up worktree directories (named repo-wt-*)
    const parentDir = path.dirname(REPO_PATH);
    const repoBase = path.basename(REPO_PATH);
    for (const entry of fs.readdirSync(parentDir)) {
      if (entry.startsWith(`${repoBase}-wt-`)) {
        fs.rmSync(path.join(parentDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // Cleanup failures are fine
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
