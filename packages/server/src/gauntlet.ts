/**
 * Agency Gauntlet Test
 *
 * End-to-end tests that send real prompts to the Office Manager,
 * let the LLM-powered agents work autonomously, then validate outcomes.
 *
 * Each scenario defines:
 *   - A user prompt sent to the OM
 *   - A set of assertions checked after the agents finish working
 *   - A time budget (real-world minutes)
 *
 * Usage:
 *   AGENCY_DB_PATH=/tmp/gauntlet.db node packages/server/dist/index.js &
 *   npx tsx packages/server/src/gauntlet.ts [scenario-name]
 *
 * Scenarios:
 *   portfolio   — Build a 3-page portfolio website
 *   api         — Build a REST API backend
 *   fullstack   — Build a fullstack app with frontend + backend teams
 *   bugfix      — Fix a bug in an existing project
 */

import http from 'node:http';

const BASE = 'http://localhost:3001';

// ── HTTP helpers ──────────────────────────────────────────────────────

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; data: Record<string, unknown> | Record<string, unknown>[] }> {
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
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({
            status: res.statusCode ?? 0,
            data: { _raw: raw } as unknown as Record<string, unknown>,
          });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const get = (p: string) => api('GET', p);
const post = (p: string, b?: Record<string, unknown>) => api('POST', p, b);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Logging ───────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function header(title: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

// ── Scenario definition ───────────────────────────────────────────────

interface Assertion {
  name: string;
  check: (state: SimState) => boolean;
  severity: 'required' | 'expected' | 'bonus';
}

interface Scenario {
  name: string;
  description: string;
  prompt: string;
  timeBudgetMinutes: number;
  simSpeed: number;
  assertions: Assertion[];
}

interface SimState {
  agents: Array<Record<string, unknown>>;
  teams: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  conversations: { conversations: Array<Record<string, unknown>>; total: number };
  blockers: Array<Record<string, unknown>>;
  sessions: Map<string, Array<Record<string, unknown>>>;
  toolCalls: Map<string, Array<Record<string, unknown>>>;
  prs: Array<Record<string, unknown>>;
  worktrees: Array<Record<string, unknown>>;
}

// ── State gathering ───────────────────────────────────────────────────

async function gatherState(): Promise<SimState> {
  const [agentsR, teamsR, projectsR, tasksR, convosR, blockersR] = await Promise.all([
    get('/api/agents'),
    get('/api/teams'),
    get('/api/projects'),
    get('/api/tasks'),
    get('/api/conversations'),
    get('/api/blockers'),
  ]);

  const agents = agentsR.data as unknown as Array<Record<string, unknown>>;
  const projects = projectsR.data as unknown as Array<Record<string, unknown>>;

  // Gather sessions per agent
  const sessions = new Map<string, Array<Record<string, unknown>>>();
  const toolCalls = new Map<string, Array<Record<string, unknown>>>();
  for (const agent of agents) {
    if (agent.fired_at) continue;
    const sessR = await get(`/api/agents/${agent.id}/sessions`);
    const sessList = sessR.data as unknown as Array<Record<string, unknown>>;
    sessions.set(agent.id as string, sessList);

    // Gather tool calls from all sessions
    const allCalls: Array<Record<string, unknown>> = [];
    for (const sess of sessList) {
      const detailR = await get(`/api/sessions/${sess.id}`);
      const detail = detailR.data as Record<string, unknown>;
      const calls = (detail.tool_calls ?? []) as Array<Record<string, unknown>>;
      allCalls.push(...calls);
    }
    toolCalls.set(agent.id as string, allCalls);
  }

  // Gather PRs and worktrees per project
  const allPrs: Array<Record<string, unknown>> = [];
  const allWorktrees: Array<Record<string, unknown>> = [];
  for (const proj of projects) {
    const prsR = await get(`/api/projects/${proj.id}/prs`);
    const wtsR = await get(`/api/projects/${proj.id}/worktrees`);
    allPrs.push(...(prsR.data as unknown as Array<Record<string, unknown>>));
    allWorktrees.push(...(wtsR.data as unknown as Array<Record<string, unknown>>));
  }

  return {
    agents,
    teams: teamsR.data as unknown as Array<Record<string, unknown>>,
    projects,
    tasks: tasksR.data as unknown as Array<Record<string, unknown>>,
    conversations: convosR.data as unknown as {
      conversations: Array<Record<string, unknown>>;
      total: number;
    },
    blockers: blockersR.data as unknown as Array<Record<string, unknown>>,
    sessions,
    toolCalls,
    prs: allPrs,
    worktrees: allWorktrees,
  };
}

// ── Helper predicates ─────────────────────────────────────────────────

function activeAgents(state: SimState): Array<Record<string, unknown>> {
  return state.agents.filter((a) => !a.fired_at);
}

function agentsByRole(state: SimState, role: string): Array<Record<string, unknown>> {
  return activeAgents(state).filter((a) => a.role === role);
}

function completedTasks(state: SimState): Array<Record<string, unknown>> {
  return state.tasks.filter((t) => t.status === 'completed');
}

function allToolCallNames(state: SimState): string[] {
  const names: string[] = [];
  for (const calls of state.toolCalls.values()) {
    for (const c of calls) {
      if (c.tool_name) names.push(c.tool_name as string);
    }
  }
  return names;
}

function anyAgentUsedTool(state: SimState, toolName: string): boolean {
  return allToolCallNames(state).some((n) => n.includes(toolName));
}

function agentSpoke(state: SimState): boolean {
  return anyAgentUsedTool(state, 'speak');
}

// ── Scenarios ─────────────────────────────────────────────────────────

const SCENARIOS: Record<string, Scenario> = {
  portfolio: {
    name: 'Portfolio Website',
    description: 'Build a 3-page portfolio website using info from github.com/oobagi public repos',
    prompt: `I want you to build a 3-page portfolio website for the GitHub user "oobagi". The pages should be:
1. Home page — brief intro, profile summary
2. Projects page — list their public repositories with descriptions
3. Contact page — a simple contact form

Create a team with a frontend developer to build this. Create a project called "oobagi-portfolio". Assign tasks and get it built.`,
    timeBudgetMinutes: 8,
    simSpeed: 5,
    assertions: [
      {
        name: 'Team created',
        check: (s) => s.teams.length >= 1,
        severity: 'required',
      },
      {
        name: 'At least 2 agents hired (TM + dev)',
        check: (s) =>
          agentsByRole(s, 'team_manager').length >= 1 && agentsByRole(s, 'agent').length >= 1,
        severity: 'required',
      },
      {
        name: 'Project "oobagi-portfolio" created',
        check: (s) =>
          s.projects.some((p) => (p.name as string).toLowerCase().includes('portfolio')),
        severity: 'required',
      },
      {
        name: 'At least 3 tasks created (one per page)',
        check: (s) => s.tasks.length >= 3,
        severity: 'required',
      },
      {
        name: 'Tasks assigned to agents',
        check: (s) => s.tasks.some((t) => t.agent_id !== null),
        severity: 'required',
      },
      {
        name: 'Team assigned to project',
        check: (s) => s.teams.some((t) => t.project_id !== null),
        severity: 'expected',
      },
      {
        name: 'TM spoke to developer (briefing)',
        check: (s) => agentSpoke(s),
        severity: 'expected',
      },
      {
        name: 'At least 1 task completed',
        check: (s) => completedTasks(s).length >= 1,
        severity: 'expected',
      },
      {
        name: 'Agent began task (entered Programming state)',
        check: (s) => anyAgentUsedTool(s, 'begin_task'),
        severity: 'expected',
      },
      {
        name: 'Agent committed work',
        check: (s) => anyAgentUsedTool(s, 'commit_work'),
        severity: 'bonus',
      },
      {
        name: 'PR opened',
        check: (s) => s.prs.length >= 1,
        severity: 'bonus',
      },
      {
        name: 'PR reviewed and merged',
        check: (s) => s.prs.some((pr) => pr.status === 'merged'),
        severity: 'bonus',
      },
    ],
  },

  api: {
    name: 'REST API Backend',
    description: 'Build a REST API with CRUD endpoints for a bookstore',
    prompt: `Build a REST API backend for a bookstore. I need endpoints for:
- GET/POST/PUT/DELETE /books
- GET/POST /authors
- Search books by title or author

Create a backend team with a team manager and 2 developers (one for the book endpoints, one for the author/search endpoints). Project name: "bookstore-api". Use Node.js with Express.`,
    timeBudgetMinutes: 10,
    simSpeed: 5,
    assertions: [
      {
        name: 'Team created',
        check: (s) => s.teams.length >= 1,
        severity: 'required',
      },
      {
        name: 'TM + 2 developers hired',
        check: (s) =>
          agentsByRole(s, 'team_manager').length >= 1 && agentsByRole(s, 'agent').length >= 2,
        severity: 'required',
      },
      {
        name: 'Project "bookstore-api" created',
        check: (s) =>
          s.projects.some((p) => (p.name as string).toLowerCase().includes('bookstore')),
        severity: 'required',
      },
      {
        name: 'At least 4 tasks created',
        check: (s) => s.tasks.length >= 4,
        severity: 'required',
      },
      {
        name: 'Tasks distributed across multiple agents',
        check: (s) => {
          const assignees = new Set(s.tasks.filter((t) => t.agent_id).map((t) => t.agent_id));
          return assignees.size >= 2;
        },
        severity: 'expected',
      },
      {
        name: 'TM briefed team members',
        check: (s) => agentSpoke(s),
        severity: 'expected',
      },
      {
        name: 'At least 1 task in progress or completed',
        check: (s) => s.tasks.some((t) => t.status === 'in_progress' || t.status === 'completed'),
        severity: 'expected',
      },
      {
        name: 'Agent used begin_task',
        check: (s) => anyAgentUsedTool(s, 'begin_task'),
        severity: 'expected',
      },
      {
        name: 'Multiple tasks completed',
        check: (s) => completedTasks(s).length >= 2,
        severity: 'bonus',
      },
      {
        name: 'PR opened',
        check: (s) => s.prs.length >= 1,
        severity: 'bonus',
      },
    ],
  },

  fullstack: {
    name: 'Fullstack App',
    description: 'Build a fullstack todo app with separate frontend and backend teams',
    prompt: `I need a fullstack todo application with two separate teams:

1. **Backend Team** — Build the REST API (Node.js/Express) with SQLite storage. Endpoints: CRUD for todos, mark complete, filter by status.
2. **Frontend Team** — Build a React UI that consumes the API. Pages: todo list, add todo form, completed todos view.

Create TWO teams with different colors. Each team needs a team manager and at least 1 developer. Create two projects: "todo-backend" and "todo-frontend". Get both teams working in parallel.`,
    timeBudgetMinutes: 12,
    simSpeed: 5,
    assertions: [
      {
        name: '2 teams created',
        check: (s) => s.teams.length >= 2,
        severity: 'required',
      },
      {
        name: '2 TMs hired',
        check: (s) => agentsByRole(s, 'team_manager').length >= 2,
        severity: 'required',
      },
      {
        name: 'At least 2 developers hired',
        check: (s) => agentsByRole(s, 'agent').length >= 2,
        severity: 'required',
      },
      {
        name: 'Backend project created',
        check: (s) => s.projects.some((p) => (p.name as string).toLowerCase().includes('backend')),
        severity: 'required',
      },
      {
        name: 'Frontend project created',
        check: (s) => s.projects.some((p) => (p.name as string).toLowerCase().includes('frontend')),
        severity: 'required',
      },
      {
        name: 'Tasks created for both teams',
        check: (s) => {
          const teamIds = new Set(s.tasks.map((t) => t.team_id));
          return teamIds.size >= 2;
        },
        severity: 'expected',
      },
      {
        name: 'Teams have different colors',
        check: (s) => {
          const colors = s.teams.map((t) => t.color);
          return new Set(colors).size === colors.length;
        },
        severity: 'expected',
      },
      {
        name: 'Each team assigned to its project',
        check: (s) => s.teams.filter((t) => t.project_id !== null).length >= 2,
        severity: 'expected',
      },
      {
        name: 'Cross-team communication (OM spoke to both TMs)',
        check: (s) => {
          const omId = s.agents.find((a) => a.role === 'office_manager')?.id;
          if (!omId) return false;
          const omCalls = s.toolCalls.get(omId as string) ?? [];
          const walkTargets = omCalls
            .filter((c) => (c.tool_name as string)?.includes('walk_to_agent'))
            .map((c) => {
              try {
                return JSON.parse(c.arguments as string).agent_id;
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          return new Set(walkTargets).size >= 2;
        },
        severity: 'bonus',
      },
      {
        name: 'At least 1 task completed',
        check: (s) => completedTasks(s).length >= 1,
        severity: 'bonus',
      },
    ],
  },

  bugfix: {
    name: 'Bug Fix Sprint',
    description: 'Fix bugs in an existing project with a small focused team',
    prompt: `We have a critical bug in our "user-auth" project — the login endpoint returns 500 when the password contains special characters. I need you to:

1. Create a small team (1 TM + 1 developer) called "Bug Squad"
2. Create a project called "user-auth"
3. Create these bug fix tasks:
   - "Fix special character handling in login endpoint"
   - "Add input validation for password field"
   - "Add regression tests for auth edge cases"
4. Brief the developer and get them working immediately

This is urgent — prioritize speed over polish.`,
    timeBudgetMinutes: 8,
    simSpeed: 5,
    assertions: [
      {
        name: 'Team "Bug Squad" created',
        check: (s) => s.teams.some((t) => (t.name as string).toLowerCase().includes('bug')),
        severity: 'required',
      },
      {
        name: 'TM + 1 developer hired',
        check: (s) =>
          agentsByRole(s, 'team_manager').length >= 1 && agentsByRole(s, 'agent').length >= 1,
        severity: 'required',
      },
      {
        name: 'Project "user-auth" created',
        check: (s) => s.projects.some((p) => (p.name as string).toLowerCase().includes('auth')),
        severity: 'required',
      },
      {
        name: 'At least 3 bug fix tasks created',
        check: (s) => s.tasks.length >= 3,
        severity: 'required',
      },
      {
        name: 'Tasks mention bug-related keywords',
        check: (s) =>
          s.tasks.some(
            (t) =>
              (t.title as string).toLowerCase().includes('fix') ||
              (t.title as string).toLowerCase().includes('bug') ||
              (t.title as string).toLowerCase().includes('test') ||
              (t.title as string).toLowerCase().includes('validation'),
          ),
        severity: 'expected',
      },
      {
        name: 'Developer briefed by TM',
        check: (s) => agentSpoke(s),
        severity: 'expected',
      },
      {
        name: 'Developer started working (begin_task called)',
        check: (s) => anyAgentUsedTool(s, 'begin_task'),
        severity: 'expected',
      },
      {
        name: 'At least 1 task completed',
        check: (s) => completedTasks(s).length >= 1,
        severity: 'bonus',
      },
      {
        name: 'PR opened for bug fix',
        check: (s) => s.prs.length >= 1,
        severity: 'bonus',
      },
    ],
  },
};

// ── Runner ────────────────────────────────────────────────────────────

async function runScenario(scenario: Scenario): Promise<{
  passed: number;
  failed: number;
  total: number;
  results: Array<{ name: string; passed: boolean; severity: string }>;
}> {
  header(`SCENARIO: ${scenario.name}`);
  console.log(`  ${scenario.description}`);
  console.log(
    `  Budget: ${scenario.timeBudgetMinutes} min real time, ${scenario.simSpeed}x sim speed`,
  );

  // Reset to fresh state
  log('Resetting server to fresh state...');
  await post('/api/reset', { scope: 'everything' });
  await post('/api/sim/pause');
  await post('/api/sim/set-time', { simTime: '2026-01-01T08:00:00.000Z' });
  await post('/api/sim/speed', { multiplier: scenario.simSpeed });
  await sleep(2000);

  // Get OM
  const agentsR = await get('/api/agents');
  const agents = agentsR.data as unknown as Array<Record<string, unknown>>;
  const om = agents.find((a) => a.role === 'office_manager');
  if (!om) {
    log('ERROR: No Office Manager found!');
    return {
      passed: 0,
      failed: scenario.assertions.length,
      total: scenario.assertions.length,
      results: [],
    };
  }
  const omId = om.id as string;

  // Send the prompt
  log(`Sending prompt to OM (${scenario.prompt.length} chars)...`);
  await post(`/api/agents/${omId}/messages`, { message: scenario.prompt });

  // Resume sim
  await post('/api/sim/resume');
  log(`Sim running at ${scenario.simSpeed}x speed`);

  // Monitor progress (real-world timing for test harness, not game logic)
  // eslint-disable-next-line no-restricted-syntax
  const startTime = Date.now();
  const budgetMs = scenario.timeBudgetMinutes * 60 * 1000;
  let lastLog = 0;
  let lastAgentCount = 1;
  let lastTaskCount = 0;

  // eslint-disable-next-line no-restricted-syntax
  while (Date.now() - startTime < budgetMs) {
    await sleep(15000); // Check every 15s

    // eslint-disable-next-line no-restricted-syntax
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const simStatus = await get('/api/sim/status');
    const simTime = (simStatus.data as Record<string, unknown>).simTime as string;

    const currentAgents = await get('/api/agents');
    const agentList = currentAgents.data as unknown as Array<Record<string, unknown>>;
    const active = agentList.filter((a) => !a.fired_at);
    const currentTasks = await get('/api/tasks');
    const taskList = currentTasks.data as unknown as Array<Record<string, unknown>>;

    // Log significant changes
    if (active.length !== lastAgentCount) {
      log(`  Agents: ${lastAgentCount} → ${active.length}`);
      for (const a of active) {
        if (a.role === 'office_manager') continue;
        log(`    ${a.role}: ${a.name} (${a.state})`);
      }
      lastAgentCount = active.length;
    }

    if (taskList.length !== lastTaskCount) {
      log(`  Tasks: ${lastTaskCount} → ${taskList.length}`);
      for (const t of taskList) {
        log(`    [${t.status}] ${t.title}`);
      }
      lastTaskCount = taskList.length;
    }

    // Periodic status
    if (elapsed - lastLog >= 60) {
      const health = await get('/api/health');
      const h = health.data as Record<string, unknown>;
      log(
        `  [${elapsed}s] sim=${simTime.slice(11, 19)} agents=${active.length} ` +
          `tasks=${taskList.length} sessions=${h.activeSessions} completed=${taskList.filter((t) => t.status === 'completed').length}`,
      );
      lastLog = elapsed;
    }

    // Early exit: all assertions already passing
    try {
      const earlyState = await gatherState();
      const allRequired = scenario.assertions
        .filter((a) => a.severity === 'required')
        .every((a) => a.check(earlyState));
      const allExpected = scenario.assertions
        .filter((a) => a.severity === 'expected')
        .every((a) => a.check(earlyState));

      if (allRequired && allExpected) {
        log('  All required + expected assertions passing. Waiting 30s more for bonus...');
        await sleep(30000);
        break;
      }
    } catch {
      // State gathering can fail during transitions, ignore
    }
  }

  // Pause sim and gather final state
  await post('/api/sim/pause');
  log('Sim paused. Gathering final state...');
  await sleep(2000);

  const finalState = await gatherState();

  // Run assertions
  header(`RESULTS: ${scenario.name}`);

  const results: Array<{ name: string; passed: boolean; severity: string }> = [];
  let passed = 0;
  let failed = 0;

  for (const assertion of scenario.assertions) {
    let ok = false;
    try {
      ok = assertion.check(finalState);
    } catch {
      ok = false;
    }

    results.push({ name: assertion.name, passed: ok, severity: assertion.severity });

    const icon = ok
      ? '\x1b[32m✓\x1b[0m'
      : assertion.severity === 'bonus'
        ? '\x1b[33m○\x1b[0m'
        : '\x1b[31m✗\x1b[0m';
    const tag =
      assertion.severity === 'bonus'
        ? ' (bonus)'
        : assertion.severity === 'expected'
          ? ' (expected)'
          : '';
    console.log(`  ${icon} ${assertion.name}${tag}`);

    if (ok) passed++;
    else failed++;
  }

  // Summary stats
  const active = activeAgents(finalState);
  const completed = completedTasks(finalState);

  console.log(`\n  Summary:`);
  console.log(
    `    Agents: ${active.length} (${agentsByRole(finalState, 'team_manager').length} TM, ${agentsByRole(finalState, 'agent').length} dev)`,
  );
  console.log(`    Teams: ${finalState.teams.length}`);
  console.log(`    Projects: ${finalState.projects.length}`);
  console.log(`    Tasks: ${finalState.tasks.length} (${completed.length} completed)`);
  console.log(`    PRs: ${finalState.prs.length}`);
  console.log(`    Blockers: ${finalState.blockers.length}`);

  let totalSessions = 0;
  let totalTools = 0;
  for (const sessList of finalState.sessions.values()) totalSessions += sessList.length;
  for (const calls of finalState.toolCalls.values()) totalTools += calls.length;
  console.log(`    Sessions: ${totalSessions}, Tool calls: ${totalTools}`);

  console.log(
    `\n  Score: ${passed}/${scenario.assertions.length} (${Math.round((passed / scenario.assertions.length) * 100)}%)`,
  );

  return { passed, failed, total: scenario.assertions.length, results };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║                    AGENCY GAUNTLET TEST                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // Verify server
  try {
    const h = await get('/api/health');
    if (h.status !== 200) throw new Error('unhealthy');
    log('Server connected');
  } catch {
    console.error('Server not reachable at localhost:3001');
    console.error('Start with: AGENCY_DB_PATH=/tmp/gauntlet.db node packages/server/dist/index.js');
    process.exit(1);
  }

  // Pick scenarios
  const args = process.argv.slice(2);
  let scenarioNames: string[];

  if (args.length > 0 && args[0] !== 'all') {
    scenarioNames = args.filter((a) => SCENARIOS[a]);
    if (scenarioNames.length === 0) {
      console.error(`Unknown scenario(s): ${args.join(', ')}`);
      console.error(`Available: ${Object.keys(SCENARIOS).join(', ')}, all`);
      process.exit(1);
    }
  } else {
    scenarioNames = Object.keys(SCENARIOS);
  }

  log(`Running ${scenarioNames.length} scenario(s): ${scenarioNames.join(', ')}`);

  // Run scenarios
  const allResults: Array<{
    scenario: string;
    passed: number;
    failed: number;
    total: number;
    results: Array<{ name: string; passed: boolean; severity: string }>;
  }> = [];

  for (const name of scenarioNames) {
    const scenario = SCENARIOS[name];
    const result = await runScenario(scenario);
    allResults.push({ scenario: name, ...result });
  }

  // Final summary
  header('GAUNTLET SUMMARY');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalAssertions = 0;

  for (const r of allResults) {
    const pct = Math.round((r.passed / r.total) * 100);
    const icon = r.failed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`  ${icon} ${r.scenario.padEnd(15)} ${r.passed}/${r.total} (${pct}%)`);

    // Show failures
    for (const a of r.results) {
      if (!a.passed && a.severity !== 'bonus') {
        console.log(`      \x1b[31m✗\x1b[0m ${a.name} [${a.severity}]`);
      }
    }

    totalPassed += r.passed;
    totalFailed += r.failed;
    totalAssertions += r.total;
  }

  const overallPct = Math.round((totalPassed / totalAssertions) * 100);
  console.log(`\n  Overall: ${totalPassed}/${totalAssertions} (${overallPct}%)`);
  console.log('═'.repeat(70));

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Gauntlet error:', err);
  process.exit(1);
});
