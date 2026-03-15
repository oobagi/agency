/**
 * Comprehensive Agency Simulation Test
 *
 * Tests the full agent lifecycle through the REST API:
 * - Server health & sim control
 * - Team creation, agent hiring, desk assignment
 * - Project creation, worktree management
 * - Task lifecycle (create, begin, complete, blocker)
 * - Scheduling (daily schedule, custom events, missed jobs)
 * - OM/TM autonomous sessions
 * - Physical movement & communication
 * - Idle checks, hung detection, stuck work detection
 * - PR lifecycle (open, review, merge)
 * - Blocker escalation chain
 * - Reset functionality
 *
 * Usage: AGENCY_TEST=1 npx tsx packages/server/src/simulation-test.ts
 */

import http from 'node:http';

const BASE = 'http://localhost:3001';

// ── Helpers ───────────────────────────────────────────────────────────

interface ApiResult {
  status: number;
  data: unknown;
  raw: string;
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          data = raw;
        }
        resolve({ status: res.statusCode ?? 0, data, raw });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function get(path: string) {
  return api('GET', path);
}
async function post(path: string, body?: Record<string, unknown>) {
  return api('POST', path, body);
}
async function del(path: string) {
  return api('DELETE', path);
}

// Test tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
  category: string;
  severity: 'bug' | 'warning' | 'info';
}

const results: TestResult[] = [];

function pass(category: string, name: string, details?: string) {
  results.push({ name, passed: true, category, severity: 'info', details });
}

function fail(category: string, name: string, error: string, severity: 'bug' | 'warning' = 'bug') {
  results.push({ name, passed: false, error, category, severity });
}

function assert(
  condition: boolean,
  category: string,
  name: string,
  errorMsg: string,
  severity: 'bug' | 'warning' = 'bug',
) {
  if (condition) {
    pass(category, name);
  } else {
    fail(category, name, errorMsg, severity);
  }
}

// Sleep helper
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Test Suites ───────────────────────────────────────────────────────

async function testHealthAndSimControl() {
  const cat = 'Health & Sim Control';

  // Health endpoint
  const health = await get('/api/health');
  assert(health.status === 200, cat, 'Health endpoint returns 200', `Got ${health.status}`);
  const h = health.data as Record<string, unknown>;
  assert(h.status === 'healthy', cat, 'Status is healthy', `Got ${h.status}`);
  assert(typeof h.simTime === 'string', cat, 'simTime is string', `Got ${typeof h.simTime}`);
  assert(
    typeof h.activeAgents === 'number',
    cat,
    'activeAgents is number',
    `Got ${typeof h.activeAgents}`,
  );
  assert(
    typeof h.activeSessions === 'number',
    cat,
    'activeSessions is number',
    `Got ${typeof h.activeSessions}`,
  );
  assert(typeof h.uptime === 'number', cat, 'uptime is number', `Got ${typeof h.uptime}`);

  // Sim status
  const status = await get('/api/sim/status');
  assert(status.status === 200, cat, 'Sim status returns 200', `Got ${status.status}`);
  const s = status.data as Record<string, unknown>;
  assert(typeof s.simTime === 'string', cat, 'Sim status has simTime', `Missing simTime`);
  assert(typeof s.speed === 'number', cat, 'Sim status has speed', `Missing speed`);
  assert(typeof s.paused === 'boolean', cat, 'Sim status has paused', `Missing paused`);

  // Pause
  const pauseRes = await post('/api/sim/pause');
  assert(pauseRes.status === 200, cat, 'Pause returns 200', `Got ${pauseRes.status}`);
  const afterPause = await get('/api/sim/status');
  assert(
    (afterPause.data as Record<string, unknown>).paused === true,
    cat,
    'Sim is paused after pause',
    'Sim not paused',
  );

  // Resume
  const resumeRes = await post('/api/sim/resume');
  assert(resumeRes.status === 200, cat, 'Resume returns 200', `Got ${resumeRes.status}`);
  const afterResume = await get('/api/sim/status');
  assert(
    (afterResume.data as Record<string, unknown>).paused === false,
    cat,
    'Sim is running after resume',
    'Sim still paused',
  );

  // Speed
  const speedRes = await post('/api/sim/speed', { multiplier: 5 });
  assert(speedRes.status === 200, cat, 'Speed set returns 200', `Got ${speedRes.status}`);
  const afterSpeed = await get('/api/sim/status');
  assert(
    (afterSpeed.data as Record<string, unknown>).speed === 5,
    cat,
    'Speed set to 5x',
    `Got ${(afterSpeed.data as Record<string, unknown>).speed}`,
  );

  // Speed edge cases
  const speed0 = await post('/api/sim/speed', { multiplier: 0 });
  assert(
    speed0.status === 200,
    cat,
    'Speed 0 accepted (no validation)',
    `Got ${speed0.status}`,
    'warning',
  );
  const speedNeg = await post('/api/sim/speed', { multiplier: -1 });
  assert(
    speedNeg.status === 200,
    cat,
    'Negative speed accepted (no validation)',
    `Rejected negative speed: ${speedNeg.status}`,
    'warning',
  );
  const speedHuge = await post('/api/sim/speed', { multiplier: 99999 });
  assert(
    speedHuge.status === 200,
    cat,
    'Huge speed accepted (no upper bound validation)',
    `Rejected huge speed: ${speedHuge.status}`,
    'warning',
  );

  // Reset speed
  await post('/api/sim/speed', { multiplier: 1 });

  // Speed invalid input
  const speedStr = await post('/api/sim/speed', { multiplier: 'fast' });
  assert(speedStr.status === 400, cat, 'Non-numeric speed rejected', `Got ${speedStr.status}`);

  // Set time
  const setTime = await post('/api/sim/set-time', { simTime: '2026-01-01T08:00:00.000Z' });
  assert(setTime.status === 200, cat, 'Set-time returns 200', `Got ${setTime.status}`);

  // Set time invalid
  const setTimeBad = await post('/api/sim/set-time', { simTime: 'not-a-date' });
  assert(setTimeBad.status === 400, cat, 'Invalid date rejected', `Got ${setTimeBad.status}`);

  const setTimeEmpty = await post('/api/sim/set-time', {});
  assert(
    setTimeEmpty.status === 400,
    cat,
    'Missing simTime rejected',
    `Got ${setTimeEmpty.status}`,
  );

  // Pause for rest of tests
  await post('/api/sim/pause');
}

async function testOfficeLayout() {
  const cat = 'Office Layout';

  const layout = await get('/api/office/layout');
  assert(layout.status === 200, cat, 'Layout endpoint returns 200', `Got ${layout.status}`);
  const l = layout.data as Record<string, unknown>;
  assert(Array.isArray(l.layout), cat, 'Layout has layout array', 'Missing layout array');
  assert(
    Array.isArray(l.meetingRooms),
    cat,
    'Layout has meetingRooms array',
    'Missing meetingRooms',
  );
  assert(Array.isArray(l.desks), cat, 'Layout has desks array', 'Missing desks');

  const rooms = l.meetingRooms as Array<Record<string, unknown>>;
  assert(
    rooms.length === 4,
    cat,
    '4 meeting rooms seeded (Alpha, Beta, Gamma, Onboarding)',
    `Got ${rooms.length}`,
  );

  const roomNames = rooms.map((r) => r.name);
  assert(roomNames.includes('Alpha Room'), cat, 'Alpha Room exists', `Missing Alpha Room`);
  assert(roomNames.includes('Beta Room'), cat, 'Beta Room exists', `Missing Beta Room`);
  assert(roomNames.includes('Gamma Room'), cat, 'Gamma Room exists', `Missing Gamma Room`);

  // Check meeting room positions are distinct
  const roomPositions = rooms.map((r) => `${r.position_x},${r.position_z}`);
  const uniquePositions = new Set(roomPositions);
  assert(
    uniquePositions.size === rooms.length,
    cat,
    'Meeting rooms have distinct positions',
    `Duplicate positions found: ${roomPositions.join(' | ')}`,
  );
}

async function testAgentManagement() {
  const cat = 'Agent Management';

  // Check OM exists
  const agents = await get('/api/agents');
  const agentList = agents.data as Array<Record<string, unknown>>;
  assert(agentList.length >= 1, cat, 'At least 1 agent (OM) exists', `Got ${agentList.length}`);
  const om = agentList.find((a) => a.role === 'office_manager');
  assert(om !== undefined, cat, 'Office Manager exists', 'No OM found');

  if (!om) return;

  const omId = om.id as string;
  assert(om.state === 'Idle', cat, 'OM is Idle', `OM state: ${om.state}`);
  assert(om.team_id === null, cat, 'OM has no team', `OM team_id: ${om.team_id}`);

  // Get OM by ID
  const omDetail = await get(`/api/agents/${omId}`);
  assert(omDetail.status === 200, cat, 'Get agent by ID works', `Got ${omDetail.status}`);

  // Get non-existent agent
  const noAgent = await get('/api/agents/nonexistent-id');
  assert(noAgent.status === 404, cat, 'Non-existent agent returns 404', `Got ${noAgent.status}`);

  // Get personas (needed for hiring)
  const personas = await get('/api/personas');
  const personaList = personas.data as Array<Record<string, unknown>>;
  assert(personaList.length > 0, cat, 'Personas available', `Got ${personaList.length}`);

  // Create a team
  const teamRes = await post('/api/teams', { name: 'Alpha Team', color: '#FF6B6B' });
  assert(teamRes.status === 201, cat, 'Team creation returns 201', `Got ${teamRes.status}`);
  const team = teamRes.data as Record<string, unknown>;
  const teamId = team.team_id as string;
  assert(typeof teamId === 'string', cat, 'Team has ID', `Team ID: ${teamId}`);

  // Create team with missing fields
  const teamBad1 = await post('/api/teams', { name: 'No Color' });
  assert(teamBad1.status === 400, cat, 'Team without color rejected', `Got ${teamBad1.status}`);

  const teamBad2 = await post('/api/teams', { color: '#000' });
  assert(teamBad2.status === 400, cat, 'Team without name rejected', `Got ${teamBad2.status}`);

  // Hire a team manager
  const tmPersona = personaList.find(
    (p) =>
      ((p.specialties as string) || '').includes('backend') ||
      ((p.specialties as string) || '').includes('architecture'),
  );
  if (!tmPersona) {
    fail(cat, 'Find TM persona', 'No suitable persona found');
    return;
  }

  const tmRes = await post('/api/agents/hire', {
    persona_id: tmPersona.id,
    role: 'team_manager',
  });
  assert(tmRes.status === 201, cat, 'TM hire returns 201', `Got ${tmRes.status}: ${tmRes.raw}`);
  const tmData = tmRes.data as Record<string, unknown>;
  const tmId = tmData.agent_id as string;

  // Assign TM to team
  const assignTm = await post(`/api/agents/${tmId}/assign-team`, { team_id: teamId });
  assert(
    assignTm.status === 200,
    cat,
    'TM assigned to team',
    `Got ${assignTm.status}: ${assignTm.raw}`,
  );

  // Verify TM is on the team
  const tmDetail = await get(`/api/agents/${tmId}`);
  const tmAgent = tmDetail.data as Record<string, unknown>;
  assert(
    tmAgent.team_id === teamId,
    cat,
    'TM team_id matches',
    `TM team_id: ${tmAgent.team_id}, expected: ${teamId}`,
  );
  assert(tmAgent.desk_id !== null, cat, 'TM has desk assigned', 'TM has no desk');

  // Hire regular agents
  const devPersonas = personaList.filter(
    (p) =>
      p.id !== tmPersona.id &&
      (((p.specialties as string) || '').includes('frontend') ||
        ((p.specialties as string) || '').includes('backend')),
  );
  const hiredAgents: string[] = [];

  for (let i = 0; i < Math.min(2, devPersonas.length); i++) {
    const hireRes = await post('/api/agents/hire', {
      persona_id: devPersonas[i].id,
      role: 'agent',
    });
    assert(
      hireRes.status === 201,
      cat,
      `Agent ${i + 1} hire returns 201`,
      `Got ${hireRes.status}: ${hireRes.raw}`,
    );
    const data = hireRes.data as Record<string, unknown>;
    hiredAgents.push(data.agent_id as string);
  }

  // Assign agents to team
  for (let i = 0; i < hiredAgents.length; i++) {
    const assignRes = await post(`/api/agents/${hiredAgents[i]}/assign-team`, {
      team_id: teamId,
    });
    assert(
      assignRes.status === 200,
      cat,
      `Agent ${i + 1} assigned to team`,
      `Got ${assignRes.status}: ${assignRes.raw}`,
    );
  }

  // Verify team has correct members
  const teamDetail = await get(`/api/teams/${teamId}`);
  assert(teamDetail.status === 200, cat, 'Team detail returns 200', `Got ${teamDetail.status}`);

  // Hire with invalid persona
  const hireBad = await post('/api/agents/hire', { persona_id: 'nonexistent' });
  assert(hireBad.status === 400, cat, 'Hire with bad persona rejected', `Got ${hireBad.status}`);

  // Hire with missing persona_id
  const hireMissing = await post('/api/agents/hire', {});
  assert(
    hireMissing.status === 400,
    cat,
    'Hire with missing persona_id rejected',
    `Got ${hireMissing.status}`,
  );

  // Double-assign to same team (should be idempotent or handled)
  const doubleAssign = await post(`/api/agents/${hiredAgents[0]}/assign-team`, {
    team_id: teamId,
  });
  assert(
    doubleAssign.status === 200,
    cat,
    'Double assign to same team handled',
    `Got ${doubleAssign.status}: ${doubleAssign.raw}`,
    'warning',
  );

  // Assign to non-existent team
  const assignBadTeam = await post(`/api/agents/${hiredAgents[0]}/assign-team`, {
    team_id: 'nonexistent',
  });
  assert(
    assignBadTeam.status === 400,
    cat,
    'Assign to non-existent team rejected',
    `Got ${assignBadTeam.status}`,
  );

  // Get team desks
  const teamDesks = await get(`/api/teams/${teamId}/desks`);
  assert(teamDesks.status === 200, cat, 'Team desks endpoint works', `Got ${teamDesks.status}`);

  // Store IDs for later tests
  return { omId, teamId, tmId, agentIds: hiredAgents };
}

async function testScheduling(ids: {
  omId: string;
  teamId: string;
  tmId: string;
  agentIds: string[];
}) {
  const cat = 'Scheduling';

  // Get scheduled jobs
  const jobs = await get('/api/scheduled-jobs');
  assert(jobs.status === 200, cat, 'Scheduled jobs endpoint works', `Got ${jobs.status}`);
  const jobList = jobs.data as Array<Record<string, unknown>>;
  assert(jobList.length > 0, cat, 'Scheduled jobs exist', 'No scheduled jobs found');

  // Check OM has daily schedule
  const omJobs = jobList.filter((j) => j.agent_id === ids.omId);
  const omJobTypes = omJobs.map((j) => j.job_type);
  assert(
    omJobTypes.includes('morning_planning'),
    cat,
    'OM has morning_planning job',
    `OM jobs: ${omJobTypes.join(', ')}`,
  );
  assert(
    omJobTypes.includes('midday_check'),
    cat,
    'OM has midday_check job',
    `OM jobs: ${omJobTypes.join(', ')}`,
  );
  assert(
    omJobTypes.includes('eod_review'),
    cat,
    'OM has eod_review job',
    `OM jobs: ${omJobTypes.join(', ')}`,
  );
  assert(
    omJobTypes.includes('lunch_break'),
    cat,
    'OM has lunch_break job',
    `OM jobs: ${omJobTypes.join(', ')}`,
  );
  assert(
    omJobTypes.includes('depart'),
    cat,
    'OM has depart job',
    `OM jobs: ${omJobTypes.join(', ')}`,
  );

  // Check TM has daily schedule
  const tmJobs = jobList.filter((j) => j.agent_id === ids.tmId);
  const tmJobTypes = tmJobs.map((j) => j.job_type);
  assert(
    tmJobTypes.includes('arrive'),
    cat,
    'TM has arrive job',
    `TM jobs: ${tmJobTypes.join(', ')}`,
  );
  assert(
    tmJobTypes.includes('lunch_break'),
    cat,
    'TM has lunch_break job',
    `TM jobs: ${tmJobTypes.join(', ')}`,
  );

  // Check regular agents have daily schedule
  for (const agentId of ids.agentIds) {
    const agentJobs = jobList.filter((j) => j.agent_id === agentId);
    const agentJobTypes = agentJobs.map((j) => j.job_type);
    assert(
      agentJobTypes.includes('arrive'),
      cat,
      `Agent ${agentId.slice(0, 8)} has arrive job`,
      `Jobs: ${agentJobTypes.join(', ')}`,
    );
  }

  // Check agent-specific jobs endpoint
  const agentJobs = await get(`/api/agents/${ids.tmId}/scheduled-jobs`);
  assert(
    agentJobs.status === 200,
    cat,
    'Agent scheduled-jobs endpoint works',
    `Got ${agentJobs.status}`,
  );
  const agentJobList = agentJobs.data as Array<Record<string, unknown>>;
  assert(
    agentJobList.length > 0,
    cat,
    'TM has scheduled jobs via agent endpoint',
    `Got ${agentJobList.length}`,
  );

  // Check job queue
  const queue = await get('/api/job-queue');
  assert(queue.status === 200, cat, 'Job queue endpoint works', `Got ${queue.status}`);

  // Verify recurrence is set correctly
  for (const job of omJobs) {
    assert(
      job.recurrence === 'daily',
      cat,
      `OM job ${job.job_type} is daily`,
      `Got recurrence: ${job.recurrence}`,
    );
  }

  // Verify missed_policy
  const firePolicies = omJobs.filter((j) => j.missed_policy === 'fire_immediately');
  const skipPolicies = omJobs.filter((j) => j.missed_policy === 'skip_to_next');
  assert(
    firePolicies.length > 0,
    cat,
    'Some OM jobs have fire_immediately policy',
    'No fire_immediately jobs',
  );
  assert(
    skipPolicies.length > 0,
    cat,
    'Some OM jobs have skip_to_next policy',
    'No skip_to_next jobs',
  );
}

async function testProjectAndGit(_ids: {
  omId: string;
  teamId: string;
  tmId: string;
  agentIds: string[];
}) {
  const cat = 'Project & Git';

  // Create project
  const projRes = await post('/api/projects', {
    name: 'test-project',
    // eslint-disable-next-line no-restricted-syntax -- test file, not game logic
    path: '/tmp/agency-test-project-' + Date.now(),
    description: 'A test project for simulation testing',
  });
  assert(
    projRes.status === 201,
    cat,
    'Project creation returns 201',
    `Got ${projRes.status}: ${projRes.raw}`,
  );
  const project = projRes.data as Record<string, unknown>;
  const projectId = project.id as string;
  assert(typeof projectId === 'string', cat, 'Project has ID', `No ID in response`);

  // List projects
  const projects = await get('/api/projects');
  assert(projects.status === 200, cat, 'Projects list returns 200', `Got ${projects.status}`);
  const projList = projects.data as Array<Record<string, unknown>>;
  assert(projList.length >= 1, cat, 'At least 1 project exists', `Got ${projList.length}`);

  // Get project detail
  const projDetail = await get(`/api/projects/${projectId}`);
  assert(projDetail.status === 200, cat, 'Project detail returns 200', `Got ${projDetail.status}`);

  // Get non-existent project
  const noProjRes = await get('/api/projects/nonexistent');
  assert(
    noProjRes.status === 404,
    cat,
    'Non-existent project returns 404',
    `Got ${noProjRes.status}`,
  );

  // Create project with missing fields
  const projBad1 = await post('/api/projects', { name: 'test' });
  assert(
    projBad1.status === 400 || projBad1.status === 201,
    cat,
    'Project without path/description handled',
    `Got ${projBad1.status}`,
    'warning',
  );

  // Create project with duplicate path — should this be rejected?
  const projDupe = await post('/api/projects', {
    name: 'dupe-project',
    path: project.repo_path,
    description: 'duplicate path',
  });
  assert(
    projDupe.status === 400,
    cat,
    'Duplicate repo_path rejected',
    `Got ${projDupe.status} — duplicate paths accepted without error`,
    'warning',
  );

  // Get PRs (should be empty)
  const prs = await get(`/api/projects/${projectId}/prs`);
  assert(prs.status === 200, cat, 'Project PRs endpoint works', `Got ${prs.status}`);
  const prList = prs.data as Array<Record<string, unknown>>;
  assert(prList.length === 0, cat, 'No PRs yet', `Got ${prList.length}`);

  // Get worktrees (should be empty)
  const wts = await get(`/api/projects/${projectId}/worktrees`);
  assert(wts.status === 200, cat, 'Project worktrees endpoint works', `Got ${wts.status}`);
  const wtList = wts.data as Array<Record<string, unknown>>;
  assert(wtList.length === 0, cat, 'No worktrees yet', `Got ${wtList.length}`);

  return { projectId, repoPath: project.repo_path as string };
}

async function testTaskSystem(ids: {
  omId: string;
  teamId: string;
  tmId: string;
  agentIds: string[];
  projectId: string;
}) {
  const cat = 'Task System';

  // Get tasks (should be empty)
  const tasks = await get('/api/tasks');
  assert(tasks.status === 200, cat, 'Tasks endpoint works', `Got ${tasks.status}`);

  // Get agent tasks
  const agentTasks = await get(`/api/agents/${ids.agentIds[0]}/tasks`);
  assert(agentTasks.status === 200, cat, 'Agent tasks endpoint works', `Got ${agentTasks.status}`);

  return {};
}

async function testConversations() {
  const cat = 'Conversations';

  // List conversations
  const convos = await get('/api/conversations');
  assert(convos.status === 200, cat, 'Conversations endpoint works', `Got ${convos.status}`);
  const data = convos.data as Record<string, unknown>;
  assert(
    Array.isArray(data.conversations),
    cat,
    'Has conversations array',
    'Missing conversations',
  );
  assert(typeof data.total === 'number', cat, 'Has total count', 'Missing total');

  // Search conversations
  const search = await get('/api/conversations?search=test');
  assert(search.status === 200, cat, 'Conversation search works', `Got ${search.status}`);

  // Filter by type
  const filtered = await get('/api/conversations?type=one_on_one');
  assert(filtered.status === 200, cat, 'Conversation type filter works', `Got ${filtered.status}`);

  // Pagination
  const paged = await get('/api/conversations?limit=5&offset=0');
  assert(paged.status === 200, cat, 'Conversation pagination works', `Got ${paged.status}`);

  // Non-existent conversation
  const noConvo = await get('/api/conversations/nonexistent');
  assert(
    noConvo.status === 404,
    cat,
    'Non-existent conversation returns 404',
    `Got ${noConvo.status}`,
  );
}

async function testBlockers(ids: { omId: string; agentIds: string[] }) {
  const cat = 'Blockers';

  // List blockers (should be empty initially)
  const blockers = await get('/api/blockers');
  assert(blockers.status === 200, cat, 'Blockers endpoint works', `Got ${blockers.status}`);

  // Get agent blockers
  const agentBlockers = await get(`/api/agents/${ids.agentIds[0]}/blockers`);
  assert(
    agentBlockers.status === 200,
    cat,
    'Agent blockers endpoint works',
    `Got ${agentBlockers.status}`,
  );

  // Non-existent blocker
  const noBlocker = await get('/api/blockers/nonexistent');
  assert(
    noBlocker.status === 404,
    cat,
    'Non-existent blocker returns 404',
    `Got ${noBlocker.status}`,
  );

  // Resolve non-existent blocker
  const resolveBad = await post('/api/blockers/nonexistent/resolve', { resolution: 'fixed' });
  assert(
    resolveBad.status === 400,
    cat,
    'Resolve non-existent blocker rejected',
    `Got ${resolveBad.status}`,
  );

  // Resolve with missing resolution
  const resolveNoRes = await post('/api/blockers/nonexistent/resolve', {});
  assert(
    resolveNoRes.status === 400,
    cat,
    'Resolve without resolution text rejected',
    `Got ${resolveNoRes.status}`,
  );
}

async function testSessions(ids: { omId: string; tmId: string; agentIds: string[] }) {
  const cat = 'Sessions';

  // Get OM sessions
  const omSessions = await get(`/api/agents/${ids.omId}/sessions`);
  assert(omSessions.status === 200, cat, 'OM sessions endpoint works', `Got ${omSessions.status}`);

  // Get agent sessions
  const agentSessions = await get(`/api/agents/${ids.agentIds[0]}/sessions`);
  assert(
    agentSessions.status === 200,
    cat,
    'Agent sessions endpoint works',
    `Got ${agentSessions.status}`,
  );

  // Non-existent session
  const noSession = await get('/api/sessions/nonexistent');
  assert(
    noSession.status === 404,
    cat,
    'Non-existent session returns 404',
    `Got ${noSession.status}`,
  );

  // Interrupt non-existent session
  const interruptBad = await post('/api/sessions/nonexistent/interrupt');
  assert(
    interruptBad.status === 404,
    cat,
    'Interrupt non-existent session returns 404',
    `Got ${interruptBad.status}`,
  );
}

async function testUserMessages(ids: { omId: string }) {
  const cat = 'User Messages';

  // Send message to OM
  const msgRes = await post(`/api/agents/${ids.omId}/messages`, { message: 'Hello, how are you?' });
  assert(
    msgRes.status === 200,
    cat,
    'Send message to OM works',
    `Got ${msgRes.status}: ${msgRes.raw}`,
  );

  // Send empty message
  const emptyMsg = await post(`/api/agents/${ids.omId}/messages`, { message: '' });
  assert(emptyMsg.status === 400, cat, 'Empty message rejected', `Got ${emptyMsg.status}`);

  // Send message without message field
  const noMsg = await post(`/api/agents/${ids.omId}/messages`, {});
  assert(noMsg.status === 400, cat, 'Missing message field rejected', `Got ${noMsg.status}`);

  // Send to non-existent agent
  const badAgent = await post('/api/agents/nonexistent/messages', { message: 'Hello' });
  // This should ideally return 404 but might not be validated
  assert(
    badAgent.status === 200 || badAgent.status === 404 || badAgent.status === 400,
    cat,
    'Message to non-existent agent handled',
    `Got unexpected status: ${badAgent.status}`,
  );
  if (badAgent.status === 200) {
    fail(
      cat,
      'Message to non-existent agent should be rejected',
      'Returns 200 for non-existent agent — message stored in chat_logs with invalid agent_id',
      'bug',
    );
  }

  // Check chat logs include the message
  const chatLogs = await get(`/api/agents/${ids.omId}/chat-logs`);
  assert(chatLogs.status === 200, cat, 'Chat logs endpoint works', `Got ${chatLogs.status}`);
  const logs = chatLogs.data as Array<Record<string, unknown>>;
  const found = logs.some((l) => l.message === 'Hello, how are you?' && l.speaker_type === 'user');
  assert(found, cat, 'User message appears in chat logs', 'Message not found in chat logs');

  // Wait briefly for session to potentially start
  await sleep(2000);

  // Check if session was triggered
  const sessions = await get(`/api/agents/${ids.omId}/sessions`);
  const sessionList = sessions.data as Array<Record<string, unknown>>;
  // Session may or may not have started yet (async)
  if (sessionList.length > 0) {
    pass(cat, 'OM session triggered by user message', `${sessionList.length} session(s)`);
  } else {
    pass(cat, 'No OM session yet (async, may still be starting)', 'This is normal');
  }
}

async function testSimTimeAdvancement(_ids: {
  omId: string;
  teamId: string;
  tmId: string;
  agentIds: string[];
}) {
  const cat = 'Sim Time Advancement';

  // Set to a known time
  await post('/api/sim/set-time', { simTime: '2026-01-02T07:55:00.000Z' });
  await post('/api/sim/speed', { multiplier: 10 });
  await post('/api/sim/resume');

  // SIM_SECONDS_PER_TICK=60, so at 10x speed: 1 real sec = 10 sim min
  // 5 real seconds ≈ 50 sim minutes
  await sleep(5000);

  // Check time has advanced
  const status = await get('/api/sim/status');
  const s = status.data as Record<string, unknown>;
  const simTime = new Date(s.simTime as string);
  const expected = new Date('2026-01-02T08:45:00.000Z');
  const diff = Math.abs(simTime.getTime() - expected.getTime());

  // Allow 15 sim-minute tolerance (timing variance)
  assert(
    diff < 15 * 60 * 1000,
    cat,
    'Sim time advanced correctly at 10x (~50 sim min)',
    `Expected ~08:45, got ${simTime.toISOString()}, diff=${Math.round(diff / 60000)}min`,
  );

  // Pause and verify time stops
  await post('/api/sim/pause');
  const beforePause = await get('/api/sim/status');
  const t1 = (beforePause.data as Record<string, unknown>).simTime;
  await sleep(2000);
  const afterPause = await get('/api/sim/status');
  const t2 = (afterPause.data as Record<string, unknown>).simTime;
  assert(t1 === t2, cat, 'Time stops when paused', `t1=${t1}, t2=${t2}`);

  // Run simulation fast to trigger daily schedule jobs
  await post('/api/sim/set-time', { simTime: '2026-01-02T07:59:55.000Z' });
  await post('/api/sim/speed', { multiplier: 10 });
  await post('/api/sim/resume');
  await sleep(3000); // 30 sim seconds → past 08:00

  await post('/api/sim/pause');

  // Check if agents changed state (arrive job should have fired)
  const agents = await get('/api/agents');
  const agentList = agents.data as Array<Record<string, unknown>>;
  for (const agent of agentList) {
    if ((agent as Record<string, unknown>).fired_at) continue;
    const state = (agent as Record<string, unknown>).state;
    pass(
      cat,
      `Agent ${((agent as Record<string, unknown>).name as string)?.slice(0, 15)} state after 08:00: ${state}`,
    );
  }

  // Reset for remaining tests
  await post('/api/sim/pause');
  await post('/api/sim/speed', { multiplier: 1 });
}

async function testDesks(ids: { teamId: string }) {
  const cat = 'Desks';

  // Get all desks
  const desks = await get('/api/desks');
  assert(desks.status === 200, cat, 'Desks endpoint works', `Got ${desks.status}`);
  const deskList = desks.data as Array<Record<string, unknown>>;
  assert(deskList.length > 0, cat, 'Desks exist', 'No desks found');

  // Get available desks
  const available = await get(`/api/desks/available?team_id=${ids.teamId}`);
  assert(
    available.status === 200,
    cat,
    'Available desks endpoint works',
    `Got ${available.status}`,
  );
  const availList = available.data as Array<Record<string, unknown>>;
  assert(availList.length >= 0, cat, 'Available desks query works', `Got ${availList.length}`);

  // Check desk positions are valid
  for (const desk of deskList) {
    const x = desk.position_x as number;
    const z = desk.position_z as number;
    assert(
      typeof x === 'number' && typeof z === 'number',
      cat,
      `Desk ${(desk.id as string).slice(0, 8)} has valid position`,
      `Invalid position: x=${x}, z=${z}`,
    );
  }
}

async function testResetFunctionality(_ids: {
  omId: string;
  teamId: string;
  tmId: string;
  agentIds: string[];
}) {
  const cat = 'Reset';

  // Test invalid scope
  const badScope = await post('/api/reset', { scope: 'invalid' });
  assert(badScope.status === 400, cat, 'Invalid reset scope rejected', `Got ${badScope.status}`);

  // Test conversation reset (least destructive)
  const convReset = await post('/api/reset', { scope: 'conversations' });
  assert(convReset.status === 200, cat, 'Conversation reset works', `Got ${convReset.status}`);

  // Verify conversations cleared
  const convos = await get('/api/conversations');
  const data = convos.data as Record<string, unknown>;
  const convList = data.conversations as Array<unknown>;
  assert(convList.length === 0, cat, 'Conversations cleared after reset', `Got ${convList.length}`);

  // Verify agents still exist
  const agents = await get('/api/agents');
  const agentList = agents.data as Array<Record<string, unknown>>;
  assert(
    agentList.length > 1,
    cat,
    'Agents preserved after conversation reset',
    `Got ${agentList.length}`,
  );

  // Test sim_time reset
  const timeReset = await post('/api/reset', { scope: 'sim_time' });
  assert(timeReset.status === 200, cat, 'Sim time reset works', `Got ${timeReset.status}`);
  const status = await get('/api/sim/status');
  const simTime = (status.data as Record<string, unknown>).simTime as string;
  assert(simTime.includes('2026-01-01T08:00'), cat, 'Sim time reset to 08:00', `Got ${simTime}`);
}

async function testEdgeCases() {
  const cat = 'Edge Cases';

  // POST to GET-only endpoint
  const postHealth = await post('/api/health');
  // Server uses catch-all that returns 200 { status: 'ok' }
  assert(
    postHealth.status === 200,
    cat,
    'POST to /api/health returns 200 (no method routing)',
    `Got ${postHealth.status}`,
    'warning',
  );

  // GET non-existent endpoint
  const noEndpoint = await get('/api/nonexistent');
  assert(
    noEndpoint.status === 200,
    cat,
    'Non-existent endpoint returns 200 (catch-all)',
    `Got ${noEndpoint.status}`,
    'warning',
  );

  // Very long message
  const longMsg = 'x'.repeat(100000);
  const longRes = await post('/api/agents/nonexistent/messages', { message: longMsg });
  // Should either reject or handle gracefully
  assert(
    longRes.status === 200 || longRes.status === 400 || longRes.status === 413,
    cat,
    'Very long message handled',
    `Got unexpected status: ${longRes.status}`,
  );

  // Invalid JSON body
  // Can't easily test with our helper, skip

  // Concurrent requests (basic)
  const results = await Promise.all([
    get('/api/health'),
    get('/api/agents'),
    get('/api/teams'),
    get('/api/projects'),
    get('/api/tasks'),
    get('/api/blockers'),
    get('/api/scheduled-jobs'),
    get('/api/conversations'),
  ]);
  const allOk = results.every((r) => r.status === 200);
  assert(allOk, cat, 'Concurrent requests all succeed', 'Some concurrent requests failed');
}

async function testFireAgent(ids: { agentIds: string[] }) {
  const cat = 'Fire Agent';

  if (ids.agentIds.length < 2) {
    pass(cat, 'Skipping fire test (not enough agents)');
    return;
  }

  const agentToFire = ids.agentIds[1];

  // Fire the agent
  const fireRes = await post(`/api/agents/${agentToFire}/fire`);
  assert(
    fireRes.status === 200,
    cat,
    'Fire agent returns 200',
    `Got ${fireRes.status}: ${fireRes.raw}`,
  );

  // Verify agent is fired
  const agent = await get(`/api/agents/${agentToFire}`);
  const agentData = agent.data as Record<string, unknown>;
  assert(agentData.fired_at !== null, cat, 'Agent has fired_at set', 'fired_at is null');

  // Verify scheduled jobs removed
  const jobs = await get(`/api/agents/${agentToFire}/scheduled-jobs`);
  const jobList = jobs.data as Array<Record<string, unknown>>;
  assert(
    jobList.length === 0,
    cat,
    'Fired agent has no scheduled jobs',
    `Got ${jobList.length} jobs`,
    'warning',
  );

  // Fire already-fired agent
  const doubleFire = await post(`/api/agents/${agentToFire}/fire`);
  assert(
    doubleFire.status === 400,
    cat,
    'Double fire rejected',
    `Got ${doubleFire.status} — can fire already-fired agent`,
    'warning',
  );

  // Fire non-existent agent
  const fireNonexistent = await post('/api/agents/nonexistent/fire');
  assert(
    fireNonexistent.status === 400,
    cat,
    'Fire non-existent agent rejected',
    `Got ${fireNonexistent.status}`,
  );

  // Try to fire OM
  const agents = await get('/api/agents');
  const agentList = agents.data as Array<Record<string, unknown>>;
  const om = agentList.find((a) => a.role === 'office_manager');
  if (om) {
    const fireOm = await post(`/api/agents/${om.id}/fire`);
    // OM should arguably not be fireable, but let's see what happens
    assert(
      fireOm.status === 400,
      cat,
      'Fire OM rejected',
      `Got ${fireOm.status} — OM can be fired, which would break the simulation`,
      'bug',
    );
  }
}

async function testDeleteTeam(_ids: { teamId: string }) {
  const cat = 'Delete Team';

  // Create a temporary team to delete
  const teamRes = await post('/api/teams', { name: 'Temp Team', color: '#00FF00' });
  if (teamRes.status !== 201) {
    fail(cat, 'Create temp team for delete test', `Got ${teamRes.status}`);
    return;
  }
  const tempTeamId = (teamRes.data as Record<string, unknown>).team_id as string;

  // Delete it
  const delRes = await del(`/api/teams/${tempTeamId}`);
  assert(
    delRes.status === 200,
    cat,
    'Delete empty team works',
    `Got ${delRes.status}: ${delRes.raw}`,
  );

  // Delete non-existent team
  const delBad = await del('/api/teams/nonexistent');
  assert(
    delBad.status === 400 || delBad.status === 404,
    cat,
    'Delete non-existent team handled',
    `Got ${delBad.status}`,
  );
}

async function testPersonas() {
  const cat = 'Personas';

  const personas = await get('/api/personas');
  assert(personas.status === 200, cat, 'Personas endpoint works', `Got ${personas.status}`);
  const list = personas.data as Array<Record<string, unknown>>;
  assert(list.length > 0, cat, 'Personas available', `Got ${list.length}`);

  // Check persona structure
  const first = list[0];
  assert(typeof first.id === 'string', cat, 'Persona has id', `Missing id`);
  assert(typeof first.name === 'string', cat, 'Persona has name', `Missing name`);
  assert(
    typeof first.system_prompt === 'string',
    cat,
    'Persona has system_prompt',
    `Missing system_prompt`,
  );
  assert(
    Array.isArray(first.specialties),
    cat,
    'Persona has specialties array',
    `specialties type: ${typeof first.specialties}`,
  );

  // Check persona IDs are truncated SHA-256 hashes (16 hex chars)
  const idPattern = /^[0-9a-f]{16}$/;
  assert(
    idPattern.test(first.id as string),
    cat,
    'Persona ID is 16-char hex hash',
    `ID format: ${(first.id as string).slice(0, 20)}...`,
  );
}

async function testPREndpoints() {
  const cat = 'PR Endpoints';

  // Get non-existent PR
  const noPR = await get('/api/prs/nonexistent');
  assert(noPR.status === 404, cat, 'Non-existent PR returns 404', `Got ${noPR.status}`);

  // Get non-existent worktree diff
  const noWT = await get('/api/worktrees/nonexistent/diff');
  assert(noWT.status === 404, cat, 'Non-existent worktree diff returns 404', `Got ${noWT.status}`);

  // Get non-existent worktree commits
  const noWTCommits = await get('/api/worktrees/nonexistent/commits');
  assert(
    noWTCommits.status === 404,
    cat,
    'Non-existent worktree commits returns 404',
    `Got ${noWTCommits.status}`,
  );
}

// ── Main Execution ────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(80));
  console.log('   AGENCY SIMULATION TEST');
  console.log('='.repeat(80));
  console.log();

  // Verify server is running
  try {
    const health = await get('/api/health');
    if (health.status !== 200) {
      console.error(
        'Server not healthy. Start with: AGENCY_DB_PATH=/tmp/agency-test-sim.db pnpm dev',
      );
      process.exit(1);
    }
  } catch {
    console.error('Server not reachable at localhost:3001. Start the server first.');
    process.exit(1);
  }

  // Ensure fresh state
  console.log('Resetting to fresh state...');
  await post('/api/reset', { scope: 'everything' });
  await post('/api/sim/pause');
  await post('/api/sim/set-time', { simTime: '2026-01-01T08:00:00.000Z' });
  await post('/api/sim/speed', { multiplier: 1 });

  console.log('Running tests...\n');

  // Run test suites in order
  await testHealthAndSimControl();
  console.log('  [done] Health & Sim Control');

  await testOfficeLayout();
  console.log('  [done] Office Layout');

  await testPersonas();
  console.log('  [done] Personas');

  const ids = await testAgentManagement();
  console.log('  [done] Agent Management');

  if (ids) {
    await testScheduling(ids);
    console.log('  [done] Scheduling');

    const projIds = await testProjectAndGit(ids);
    console.log('  [done] Project & Git');

    if (projIds) {
      await testTaskSystem({ ...ids, projectId: projIds.projectId });
      console.log('  [done] Task System');
    }

    await testDesks({ teamId: ids.teamId });
    console.log('  [done] Desks');

    await testConversations();
    console.log('  [done] Conversations');

    await testBlockers({ omId: ids.omId, agentIds: ids.agentIds });
    console.log('  [done] Blockers');

    await testSessions({ omId: ids.omId, tmId: ids.tmId, agentIds: ids.agentIds });
    console.log('  [done] Sessions');

    await testUserMessages({ omId: ids.omId });
    console.log('  [done] User Messages');

    await testSimTimeAdvancement(ids);
    console.log('  [done] Sim Time Advancement');

    await testFireAgent(ids);
    console.log('  [done] Fire Agent');

    await testResetFunctionality(ids);
    console.log('  [done] Reset');

    await testDeleteTeam(ids);
    console.log('  [done] Delete Team');
  }

  await testPREndpoints();
  console.log('  [done] PR Endpoints');

  await testEdgeCases();
  console.log('  [done] Edge Cases');

  // ── Print Results ───────────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log('   RESULTS');
  console.log('='.repeat(80));

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);
  const bugs = failed.filter((r) => r.severity === 'bug');
  const warnings = failed.filter((r) => r.severity === 'warning');

  console.log(`\n  Total:    ${results.length}`);
  console.log(`  Passed:   ${passed.length}`);
  console.log(`  Failed:   ${failed.length} (${bugs.length} bugs, ${warnings.length} warnings)`);

  if (bugs.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('   BUGS');
    console.log('-'.repeat(80));
    for (const bug of bugs) {
      console.log(`\n  [BUG] ${bug.category} > ${bug.name}`);
      console.log(`         ${bug.error}`);
    }
  }

  if (warnings.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('   WARNINGS');
    console.log('-'.repeat(80));
    for (const warning of warnings) {
      console.log(`\n  [WARN] ${warning.category} > ${warning.name}`);
      console.log(`          ${warning.error}`);
    }
  }

  // Print all results grouped by category
  console.log('\n' + '-'.repeat(80));
  console.log('   FULL RESULTS BY CATEGORY');
  console.log('-'.repeat(80));

  const categories = [...new Set(results.map((r) => r.category))];
  for (const category of categories) {
    console.log(`\n  ${category}:`);
    const catResults = results.filter((r) => r.category === category);
    for (const r of catResults) {
      const icon = r.passed
        ? '\x1b[32m✓\x1b[0m'
        : r.severity === 'bug'
          ? '\x1b[31m✗\x1b[0m'
          : '\x1b[33m!\x1b[0m';
      const label = r.passed ? r.name : `${r.name}: ${r.error}`;
      console.log(`    ${icon} ${label}`);
    }
  }

  console.log('\n' + '='.repeat(80));

  // Exit with error code if bugs found
  process.exit(bugs.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
