Agency Implementation Phases

This document defines every phase of the Agency build in granular micro-phases numbered X.Y. Phases are ordered so that LLM integration and agent orchestration come before simulation rendering. The rationale: getting teams of agents to collaborate correctly, respect hierarchy, communicate physically, and execute real agentic sessions is the hardest and most uncertain part of this project. The 3D office is a visualization layer on top of that foundation. It is far better to have working agent orchestration with placeholder UI than a beautiful office with no real agent behavior.

Every phase includes: a one-sentence goal, context for the implementing agent, exactly what to build, explicit out-of-scope items, testable acceptance criteria, and a handoff note. Read DESIGN_DOC.md in full before starting any phase.


Phase 1.0 — Project Scaffold and Monorepo Structure

Goal: establish the monorepo structure, tooling, and dev workflow so all subsequent phases have a consistent foundation.

Context: this is the very first implementation phase. There are no prior code files. You are starting from DESIGN_DOC.md, PHASES.md, NOTES.md, and README.md only.

What to build: initialize a pnpm workspace monorepo with two packages, server (Node.js, TypeScript) and client (React, Vite, TypeScript). Configure TypeScript with strict mode in both packages. Set up ESLint and Prettier with shared configs. Add a root package.json with dev, build, and start scripts that run both packages. The server package should use tsx for development. The client package should use Vite's dev server with proxy configuration pointing API and WebSocket requests to the server's port. Add a .gitignore covering node_modules, dist, .env, and SQLite database files. Do not install any application-specific dependencies yet beyond the build tooling.

Out of scope: any application code, database setup, 3D rendering dependencies, LLM provider packages.

Acceptance criteria: running pnpm install from root succeeds. Running pnpm dev starts both server and client in parallel. The server starts an HTTP listener on a configurable port. The client starts Vite dev server and proxies requests to the server. TypeScript compilation succeeds with zero errors in both packages.

Handoff: the next phase will add the database layer. The server package should already have a src directory with an index.ts entry point that starts the HTTP server.


Phase 1.1 — Database Schema and Migration Runner

Goal: implement the full SQLite database schema and a migration runner that applies versioned schema changes on startup.

Context: depends on Phase 1.0. You will be working in the server package. Install better-sqlite3 and its TypeScript types.

What to build: create a migrations directory inside the server package. Write the initial migration file that creates all tables defined in DESIGN_DOC.md: agents, personas, teams, projects, worktrees, tasks, pull_requests, agent_memory, chat_logs, conversations, conversation_participants, conversation_messages, sessions, session_tool_calls, scheduled_jobs, job_queue, desks, meeting_rooms, office_layout, settings, and migrations. Implement a migration runner module that on server startup reads the migrations directory, checks which migrations have been applied by querying the migrations table, and applies any unapplied migrations in order. The runner should use transactions so a failed migration rolls back cleanly. Export a getDb() function that returns the initialized database connection as a singleton. Seed the settings table with default values: default_provider set to claude_agent_sdk, default_model set to the latest Claude Sonnet, sim_speed set to 1, sim_paused set to false.

Out of scope: sqlite-vss setup (comes later with memory compression), any application logic beyond schema creation and migration running.

Acceptance criteria: server starts and creates the SQLite database file. All tables exist with correct columns and types. Running the server a second time does not re-apply migrations. The migrations table tracks what has been applied. getDb() returns a usable database connection from any server module.

Handoff: every subsequent server-side phase will import getDb() to access the database. The schema is now the source of truth.


Phase 2.0 — Sim Clock and Tick Loop

Goal: implement the simulation clock that is the sole time source for all game mechanics.

Context: depends on Phase 1.1. The database is available. The settings table has sim_speed and sim_paused values.

What to build: create a SimClock class in the server package. It maintains the current sim datetime, which persists across restarts by storing in the settings table. A single Node.js setInterval drives the tick loop. Each tick advances the sim clock by a number of sim seconds determined by the speed multiplier. The SimClock exposes methods: now() returns current sim datetime, pause() stops the tick interval and sets sim_paused in settings, resume() restarts the interval, setSpeed(multiplier) updates the speed multiplier, onTick(callback) registers a listener called on every tick. The tick loop should emit tick events that other subsystems subscribe to. On server startup, if sim_paused was true when the server last shut down, the clock starts paused. Build a simple REST endpoint GET /api/sim/status that returns current sim time, speed, and paused state. Build POST /api/sim/pause, POST /api/sim/resume, and POST /api/sim/speed endpoints. Set up WebSocket infrastructure using the ws library. On each tick, broadcast the current sim time to all connected WebSocket clients.

Out of scope: any agent behavior, the scheduled jobs runner (just the clock), 3D rendering.

Acceptance criteria: server starts, sim clock begins ticking. GET /api/sim/status returns correct sim time. POST /api/sim/pause stops the clock. POST /api/sim/resume restarts it. POST /api/sim/speed with multiplier 10 makes time advance 10x faster. WebSocket clients receive sim time broadcasts on every tick. Restarting the server resumes from the persisted sim time, not from zero.

Handoff: every time-dependent system in subsequent phases reads from SimClock.now() and subscribes to tick events. No other timer mechanism should be introduced.


Phase 2.1 — MCP Server with Stub Tool Handlers

Goal: stand up the MCP server that agents will connect to, with all tools defined but returning stub responses.

Context: depends on Phase 2.0. Read the full MCP tool list in DESIGN_DOC.md. You are building the skeleton that will be fleshed out in later phases.

What to build: implement the MCP server using the Model Context Protocol SDK for TypeScript. Register every tool defined in DESIGN_DOC.md: walk_to_desk, walk_to_agent, walk_to_meeting_room, walk_to_exit, speak, send_to_manager, begin_task, commit_work, open_pull_request, hire_agent, fire_agent, create_team, assign_agent_to_team, create_project, delete_project, assign_team_to_project, create_worktree, schedule_event, review_pull_request, merge_pull_request, trigger_compression, checkpoint_agent, set_state, report_blocker. Each tool should have a complete JSON schema for its parameters and a stub handler that logs the call and returns a placeholder success response. Create a tool registry module that maps tool names to handlers, separating manager-only tools from general tools. Add a validation layer that checks whether the calling agent has permission to use manager-only tools. The MCP server should be startable alongside the HTTP server and reachable by agentic sessions.

Out of scope: real tool implementations (those come phase by phase), agent sessions, provider integration.

Acceptance criteria: the MCP server starts without errors. Every tool in the DESIGN_DOC.md list is registered. Calling any tool with valid parameters returns a stub response. Calling a manager-only tool with a non-manager agent ID returns a permission error. Tool schemas validate input parameters correctly.

Handoff: subsequent phases will replace stub handlers with real implementations one by one. The tool registry and permission layer are shared infrastructure.


Phase 2.2 — Persona System

Goal: fetch and curate agent personas from the agency-agents GitHub repo and store them locally.

Context: depends on Phase 1.1. This phase is independent of the MCP server and sim clock so it can be worked on in parallel with 2.0 and 2.1 if desired.

What to build: create a persona fetcher module that clones or pulls the agency-agents GitHub repository to a local cache directory. Parse persona files from the repo structure. Each persona should have: name, github_username, bio, system_prompt, and specialties. Store parsed personas in the personas table. Build a curation layer that ensures diversity of specialties across frontend, backend, devops, testing, design, and architecture. If the repo is unavailable, fall back to any previously cached personas in the database. Add a REST endpoint GET /api/personas that returns all available personas. Add a refresh mechanism that re-fetches on demand via POST /api/personas/refresh.

Out of scope: assigning personas to agents (that is done during hiring), any agent behavior.

Acceptance criteria: on first server start, personas are fetched from the GitHub repo and stored in the database. GET /api/personas returns at least one persona. The personas table has populated name, bio, system_prompt, and specialties fields. If the GitHub repo is unreachable, previously cached personas are still returned.

Handoff: the hiring flow in Phase 3.1 will pull from the personas table to assign a persona to newly hired agents.


Phase 3.0 — Provider Abstraction Layer

Goal: build the unified provider interface that the World Server uses to spawn agentic sessions regardless of which provider is active.

Context: depends on Phase 2.1 for the MCP server. Read the provider section of DESIGN_DOC.md carefully. Remember the hard constraint: the Claude Agent SDK provider must use the Agent SDK query() function, never the raw Anthropic SDK.

What to build: define a TypeScript interface AgenticProvider with methods: spawnSession(config: SessionConfig) returning a Session object, interruptSession(sessionId: string) returning void. The SessionConfig type includes: agentId, systemPrompt, context (assembled string), mcpTools (list of tool names this session can access), provider (string), model (string). The Session type includes: id, agentId, an event emitter or async iterator that yields session events (tool_call_start, tool_call_complete, session_complete, session_error). Implement ClaudeAgentSdkProvider that wraps the Agent SDK query() function. It connects the session to the MCP server's tool list, streams tool calls as events, and handles session completion. Implement CodexProvider that wraps the OpenAI Codex API with the same interface. Build a ProviderManager that reads the default provider and model from settings, checks for per-agent overrides, and returns the correct provider instance. For lightweight calls (summaries, briefings), expose a utility function that calls query() with model haiku, maxTurns 1, allowedTools empty, persistSession false.

Out of scope: the full session recording pipeline (Phase 3.2), context assembly (Phase 4.2), memory compression (Phase 5.0).

Acceptance criteria: ProviderManager.getProvider(agentId) returns the correct provider based on defaults and per-agent overrides. A session can be spawned via the ClaudeAgentSdkProvider and receives tool calls from the MCP server. InterruptSession gracefully terminates an active session. The CodexProvider implements the same interface. Switching the default provider in settings changes which provider is used for agents without overrides.

Handoff: all subsequent phases that spawn agent sessions use ProviderManager. No phase should directly import a specific provider.


Phase 3.1 — Agent Management and Hiring

Goal: implement the hire_agent and fire_agent MCP tool handlers and the agent lifecycle.

Context: depends on Phase 2.1 for MCP stubs and Phase 2.2 for the persona system. Hard constraint 6: freshly hired agents know nothing. They have their persona and nothing else.

What to build: replace the hire_agent stub with a real handler. When the Office Manager calls hire_agent with a persona_id, the handler creates a new agent record with state Idle, assigns the persona's system_prompt, assigns no team and no desk, and returns the new agent's ID. Replace the fire_agent stub. When the Office Manager calls fire_agent with an agent_id, the handler sets fired_at, removes team and desk assignments, and transitions the agent to Departing. Implement the create_team and assign_agent_to_team handlers. create_team takes a name and color (hex) and creates a team record. assign_agent_to_team takes an agent_id and team_id, updates the agent's team_id, and assigns an available desk from the team's desk pool. Build a desk assignment system: when a team is created or assigned to a project, pre-allocate a block of desks in the office layout for that team. When an agent is assigned to a team, assign them the next available desk.

Out of scope: agent movement (Phase 4.0), agent sessions, daily schedules (Phase 3.3).

Acceptance criteria: calling hire_agent via MCP with a valid persona_id creates an agent record with the correct persona and Idle state. The new agent has no team, no desk, no task, and no memory. Calling fire_agent removes the agent from their team and desk. create_team creates a team with a color. assign_agent_to_team assigns the agent and allocates a desk.

Handoff: agents now exist in the database but do not move or think. Phase 3.2 will give them sessions. Phase 3.3 will give them daily schedules.


Phase 3.2 — Session Recording Pipeline

Goal: record every agentic session and its tool calls in the database for full transparency and the Sessions tab UI.

Context: depends on Phase 3.0 for the provider abstraction. Every session spawned by the World Server must be recorded per DESIGN_DOC.md.

What to build: create a SessionRecorder class that wraps around a Session from the provider abstraction. When a session starts, insert a record into the sessions table with agent_id, sim_day, provider, model, and started_at. Subscribe to the session's event stream. On tool_call_start, insert a record into session_tool_calls with status pending and broadcast the event via WebSocket to any client watching this agent. On tool_call_complete, update the tool call record with the result and status completed, broadcast via WebSocket. On session_complete, update the session record with ended_at, outcome, and token_estimate. On session_error, set outcome to errored. Add REST endpoints: GET /api/agents/:id/sessions returns all sessions for an agent grouped by sim day, GET /api/sessions/:id returns a single session with all its tool calls. Add WebSocket subscription: clients can subscribe to live session events for a specific agent.

Out of scope: the UI rendering of sessions (that comes in UI phases), context assembly.

Acceptance criteria: spawning a session via ProviderManager creates a session record in the database. Every tool call made during the session is recorded with arguments and results. The session outcome is correctly set to completed, interrupted, or errored. WebSocket broadcasts are emitted for tool call starts and completions. REST endpoints return correct data.

Handoff: the UI phases will consume these endpoints and WebSocket events to render the Sessions tab.


Phase 3.3 — Daily Schedule Automation

Goal: implement the automatic daily schedule that all agents follow and the scheduled jobs infrastructure.

Context: depends on Phase 2.0 for the sim clock and Phase 3.1 for agent records. Per DESIGN_DOC.md: all agents follow arrive at 08:00, lunch at 12:00, return at 13:00, depart at 17:00.

What to build: implement the scheduled jobs runner. On each sim clock tick, the runner checks the scheduled_jobs table for any jobs whose sim_time has passed. For jobs that fire, it either executes them immediately or queues them in job_queue if the target agent is busy. Implement the missed job handling on boot: check for jobs whose sim_time passed while the server was down, apply fire_immediately or skip_to_next per the missed_policy field. When an agent is hired, automatically create four daily recurring scheduled jobs: arrive at 08:00, lunch_break at 12:00, return_from_lunch at 13:00, depart at 17:00. The arrive job sets the agent to Arriving state. The lunch_break job transitions to Break. The return_from_lunch job transitions back to Walking toward desk. The depart job transitions to Departing. Implement the schedule_event MCP tool handler for managers to create custom scheduled jobs.

Out of scope: the Office Manager's autonomous loops (Phase 4.0), Team Manager triggers (Phase 4.1), actual physical movement (Phase 4.3).

Acceptance criteria: when an agent is hired, four daily scheduled jobs appear in the scheduled_jobs table. As sim time advances past 08:00, the arrive job fires and sets the agent to Arriving. At 12:00, the lunch job fires. At 13:00, return fires. At 17:00, depart fires. Missed jobs on restart are handled per their policy. The schedule_event MCP tool creates custom jobs.

Handoff: Phase 4.0 will add the Office Manager's three daily loops as scheduled jobs. Phase 4.1 adds Team Manager triggers. The scheduled jobs runner is now live infrastructure.


Phase 4.0 — Office Manager Autonomous Loop

Goal: implement the Office Manager's three daily scheduled sessions that drive the entire simulation forward.

Context: depends on Phase 3.0 for provider abstraction, Phase 3.2 for session recording, and Phase 3.3 for scheduled jobs. This is the most critical phase for making the simulation come alive. The previous implementation failed because this did not exist. Read the autonomous agent loops section of DESIGN_DOC.md carefully.

What to build: on server initialization, if no Office Manager agent exists, create one with a built-in Office Manager persona (not from the agency-agents repo — the Office Manager is a system agent). Create three scheduled jobs for the Office Manager: morning_planning at 08:00, midday_check at 13:00, eod_review at 17:00. When the morning_planning job fires, the World Server spawns an agentic session for the Office Manager. The session context includes: the Office Manager persona, a report of all projects and their status, all teams and their members, all agents and their states, all unresolved blockers, any queued user messages, and the full MCP tool list including all manager-only tools. The Office Manager session runs autonomously, making tool calls to hire agents, create projects, create teams, assign work, and address blockers. The midday_check session has a lighter context focused on progress and stalled work. The eod_review session summarizes the day and queues priorities. Each session is fully recorded via Phase 3.2's SessionRecorder.

Out of scope: Team Manager loops (Phase 4.1), regular agent idle check-in (Phase 4.2), physical movement (Phase 4.3).

Acceptance criteria: starting the server with no existing agents creates an Office Manager. At 08:00 sim time, the Office Manager's morning session fires automatically. The session makes real MCP tool calls. If given a user goal, the Office Manager creates projects, hires agents, creates teams, and delegates work without user intervention. Session tool calls are recorded in the database.

Handoff: the Office Manager now drives the simulation. Phase 4.1 adds Team Managers who respond to the Office Manager's delegations.


Phase 4.1 — Team Manager Autonomous Loop

Goal: implement Team Manager triggered sessions that assign work, review PRs, and escalate blockers.

Context: depends on Phase 4.0. Team Managers are created by the Office Manager via hire_agent and assign_agent_to_team. Team Manager sessions fire on three triggers per DESIGN_DOC.md: arrival at desk, team member task completion, team member blocker report.

What to build: implement a trigger system in the World Server. Register three triggers for each Team Manager: on_desk_arrival fires when the Team Manager transitions from Walking to Idle at their desk in the morning. on_task_complete fires when any agent on the manager's team completes a task (detected when a task status changes to completed). on_blocker_report fires when any team agent calls report_blocker. When a trigger fires, the World Server spawns a session for the Team Manager. The session context includes: the Team Manager's persona, their team roster with agent states and current tasks, pending PRs for the team, unresolved blockers, and the manager MCP tools scoped to their team. During the session, the Team Manager walks to idle agents to assign tasks, reviews PRs, schedules meetings, and escalates to the Office Manager by physically walking to the Office Manager's desk if needed. The physical walk requirement means the session must use walk_to_agent before speak.

Out of scope: regular agent idle check-in (Phase 4.2), meeting system (Phase 6.0).

Acceptance criteria: when a Team Manager arrives at their desk, a session fires automatically. When a team member completes a task, the Team Manager session fires. When a team member reports a blocker, the Team Manager session fires. The Team Manager's session uses walk_to_agent before communicating with any agent. Session tool calls are recorded.

Handoff: Phase 4.2 adds the idle agent check-in that ensures regular agents are not forgotten.


Phase 4.2 — Regular Agent Idle Check-in and Context Assembly

Goal: implement the idle agent check-in behavior and the context assembly system that builds session prompts.

Context: depends on Phase 4.1. Per DESIGN_DOC.md, regular agents idle for 30 sim minutes must walk to their Team Manager. Context assembly is needed for all session types going forward.

What to build: implement the idle check-in timer. The World Server tracks how long each regular agent has been in Idle state with an empty task queue, using sim time. At 30 sim minutes, the World Server automatically triggers the agent to call walk_to_agent targeting their Team Manager. Upon arrival, this triggers the Team Manager's on_desk_arrival or a new on_agent_checkin trigger. Implement the context assembly module. This module builds the session context string for any agent session. It assembles: the agent's persona system prompt, the current task description if any, the last 10 chat log entries from chat_logs for this agent, the top 3 memory chunks from agent_memory via vector similarity (or plain text match as a fallback until sqlite-vss is set up in Phase 5.0), the current sim time from SimClock, and the list of available MCP tools filtered by role. The context module enforces a token budget and truncates if necessary. Expose this as a buildSessionContext(agentId, taskContext?) function used by all session-spawning code.

Out of scope: memory compression (Phase 5.0), the actual vector search (stubbed until Phase 5.0).

Acceptance criteria: an agent in Idle state with no tasks for 30 sim minutes automatically walks to their Team Manager. buildSessionContext returns a well-formed context string within token budget. The context includes persona, recent chat, current task, and sim time. Manager sessions include team status information. Non-manager sessions do not include cross-team data.

Handoff: all session-spawning code should now use buildSessionContext. Phase 5.0 will replace the memory stub with real vector search.


Phase 4.3 — Physical Movement and State Machine

Goal: implement the agent movement system, pathfinding, position tracking, and the state machine with enforced transitions.

Context: depends on Phase 2.0 for sim clock ticks and Phase 3.1 for agent records. This phase makes physical presence real.

What to build: implement the state machine as an explicit transition map data structure (not scattered conditionals). The map defines which states can transition to which other states per DESIGN_DOC.md. The set_state MCP tool handler indexes into this map and rejects invalid transitions with a clear error. Add position enforcement: set_state to Programming or Researching checks that the agent's position matches their assigned desk coordinates; set_state to Meeting checks that the agent is in the correct meeting room. Implement the movement system. walk_to_desk, walk_to_agent, walk_to_meeting_room, and walk_to_exit calculate a path from the agent's current position to the target position. On each sim clock tick, agents in Walking state advance along their path. Movement speed is a configurable value in sim-time units per tick. When the agent arrives, they transition from Walking to Idle (or to Meeting if at a meeting room with a pending meeting). Implement proximity detection: a function that given an agent's position returns all other agents within a configurable radius. The speak MCP tool uses this to determine message recipients.

Out of scope: 3D rendering of movement (UI phases), pathfinding around obstacles (use simple direct movement for now, refine in UI phases if needed).

Acceptance criteria: the state machine rejects invalid transitions with a descriptive error. An agent cannot enter Programming without being at their desk. walk_to_agent moves an agent's position toward the target agent over multiple ticks. Proximity detection correctly identifies nearby agents. speak only delivers messages to agents within proximity radius. Movement speed is consistent with sim time regardless of speed multiplier.

Handoff: physical communication is now enforced. All subsequent phases that involve agent-to-agent interaction must use walk then speak.


Phase 4.4 — Physical Communication Enforcement

Goal: ensure that every communication pathway in the system respects physical presence rules.

Context: depends on Phase 4.3. This phase exists specifically to prevent the most commonly broken rule from DESIGN_DOC.md. Review the physical communication section carefully.

What to build: audit every code path that could deliver a message between agents. The speak tool handler must verify proximity before delivering any message. Add proximity radius as a configurable setting. The send_to_manager tool must first trigger walk_to_agent to the manager's location, wait for arrival, then deliver the message. No message delivery should occur without the sender being within proximity of the recipient. Add a proximity validation middleware to the MCP server that checks proximity for speak and any future tools that involve communication. Log all proximity violations as warnings. Add the conversation recording system: every speak call that successfully delivers a message creates a conversation record (or appends to an existing one if agents are in an ongoing conversation) in the conversations, conversation_participants, and conversation_messages tables.

Out of scope: meeting room communication (Phase 6.0), the Conversations panel UI (UI phases).

Acceptance criteria: speak from an agent not within proximity of the target is rejected with an error. send_to_manager initiates movement before message delivery. No code path exists that delivers a message without proximity check. Every successful speak creates conversation records in the database. A comprehensive test proves that two agents across the office cannot communicate without one walking to the other first.

Handoff: physical communication is now bulletproof. Phase 6.0 will add meeting rooms which are a structured form of physical communication.


Phase 4.5 — Task System

Goal: implement the task lifecycle from creation through assignment, execution, and completion.

Context: depends on Phase 4.1 for Team Manager sessions and Phase 4.3 for state machine. Tasks are created by managers and assigned to agents who must be at their desk to begin work.

What to build: implement the begin_task MCP tool handler. When an agent calls begin_task with a task_id, the handler validates the agent is at their desk (position check), transitions the agent to Programming or Researching state based on the task type, and updates the task status to in_progress. Implement task completion: when an agent's session completes a task, the task status is set to completed, the agent transitions to Idle, and the Team Manager's on_task_complete trigger fires. Implement task creation as part of manager sessions: Team Managers create tasks by interacting with the task system during their sessions. Tasks have a status lifecycle: pending → in_progress → completed or blocked. When an agent calls report_blocker while working on a task, the task status changes to blocked and the escalation chain begins. Add REST endpoints: GET /api/tasks for listing tasks with filters, GET /api/agents/:id/tasks for an agent's task history.

Out of scope: PR creation from completed tasks (Phase 4.6), the full escalation chain UI (Phase 6.2).

Acceptance criteria: begin_task fails if the agent is not at their desk. begin_task transitions the agent to Programming and the task to in_progress. Task completion transitions the agent to Idle and fires the Team Manager trigger. report_blocker on a task sets both agent and task to blocked states. REST endpoints return correct task data.

Handoff: Phase 4.6 adds PR creation as the next step after task completion.


Phase 4.6 — PR System and Git Operations

Goal: implement the pull request workflow and Git operations that agents use to manage code in external repos.

Context: depends on Phase 4.5 for task completion and Phase 3.1 for project and worktree records. Install simple-git. Remember hard constraint 2: Agency tracks metadata only, never reads or writes actual code in external repos. However, agents working through their agentic sessions do interact with the repos via their provider's built-in tools. Agency itself only runs Git metadata commands (branch listing, diff generation, PR status).

What to build: implement the create_project MCP tool handler. When the Office Manager calls it, initialize a new Git repo on disk at a specified path using simple-git, create the project record, and set up the default branch. Implement create_worktree: create a Git worktree in the project repo for a team's branch. Implement commit_work: record a commit entry in the database (the actual commit is made by the agentic session, not by Agency). Implement open_pull_request: create a PR record in the pull_requests table. Implement review_pull_request: allow a Team Manager to approve or reject a PR. Implement merge_pull_request: merge the PR's source branch into the target branch using simple-git and update the PR status to merged. Hard constraint 7: only Team Managers can merge, never the authoring agent. Add REST endpoints: GET /api/projects/:id/prs for listing PRs, GET /api/prs/:id for PR details including diff. The diff endpoint uses simple-git to generate the diff between source and target branches.

Out of scope: the diff viewer UI panel (Phase 7.5), cross-team PRs.

Acceptance criteria: create_project initializes a real Git repo on disk. create_worktree creates a real Git worktree. open_pull_request creates a PR record. review_pull_request updates PR status to approved or rejected. merge_pull_request performs a real Git merge and updates the record. Only agents with manager role can call review and merge tools. REST endpoints return correct PR and diff data.

Handoff: the full agentic workflow is now possible: Office Manager creates project → creates team → hires agents → Team Manager assigns tasks → agent works at desk → agent opens PR → Team Manager reviews and merges.


Phase 5.0 — Memory Compression Pipeline

Goal: implement the memory compression system that summarizes agent activity and stores embeddings for vector retrieval.

Context: depends on Phase 3.2 for session records and Phase 4.2 for context assembly. Install @xenova/transformers for local embeddings and sqlite-vss for vector search.

What to build: implement the compression job. At task completion and at end of sim day (17:00), the World Server runs a compression job for each agent. The job collects the agent's recent chat logs and session summaries from that sim day, generates a natural language summary using a lightweight LLM call (Agent SDK query with model haiku, maxTurns 1, no tools), embeds the summary using @xenova/transformers, and stores the embedding in the agent_memory table. Set up sqlite-vss as a virtual table that indexes the embedding column of agent_memory. Update the buildSessionContext function from Phase 4.2 to perform vector similarity search against the current task description and inject the top 3 matching memory chunks into the session context. Implement the trigger_compression MCP tool that Team Managers can call for early compression when context limits are approaching. Implement the context window monitoring: the World Server tracks estimated token counts for active sessions and notifies the Team Manager at 80% threshold. At 95% threshold, force-trigger compression automatically as a safety net.

Out of scope: the checkpoint_agent flow is a simple walk-and-speak handled by the Team Manager's session, not a separate system.

Acceptance criteria: at end of sim day, each agent's activity is summarized and stored with an embedding. Vector similarity search against a task description returns relevant past memories. buildSessionContext now injects real memory chunks instead of stubs. trigger_compression creates a new summary mid-session. Context monitoring alerts at 80% and force-compresses at 95%.

Handoff: agents now have persistent memory across sim days. The daily session initialization from Phase 3.3 can now inject yesterday's compressed summary into the morning briefing.


Phase 5.1 — Blocker Detection and Escalation Chain

Goal: implement the full escalation chain from agent through managers to user.

Context: depends on Phase 4.1 for Team Manager loops and Phase 4.0 for Office Manager loops. Per DESIGN_DOC.md: Agent → Team Manager → Office Manager → User.

What to build: implement the report_blocker MCP tool fully. When an agent calls report_blocker, the handler sets the agent to Blocked state, records the blocker details in the task or a new blockers column, and triggers the Team Manager. The Team Manager evaluates the blocker during their session. If the Team Manager can resolve it (e.g., reassigning the task, providing guidance), they do so and the agent resumes. If the Team Manager cannot resolve it, they physically walk to the Office Manager and escalate. The Office Manager evaluates and acts. If the Office Manager cannot resolve it (e.g., missing CLI auth, missing system permissions), the blocker is marked as user_facing and a notification is sent to the UI via WebSocket. The notification creates the blocked agent visual indicator (data only at this phase, the UI renders it later). Implement hung session detection: if an agent session runs for a configurable sim-time duration (default 30 sim minutes) without a tool call completing, the World Server auto-interrupts it, sets outcome to hung, and transitions the agent to Blocked.

Out of scope: the blocked agent modal UI (Phase 7.7), visual indicators in 3D (UI phase).

Acceptance criteria: report_blocker transitions agent to Blocked and triggers Team Manager. A blocker the Team Manager can handle is resolved without reaching the Office Manager. A blocker the Team Manager cannot handle is escalated physically to the Office Manager. An unresolvable blocker is surfaced to the user via WebSocket. Hung sessions are detected and the agent is set to Blocked automatically.

Handoff: the full autonomous loop is now operational. Agents work, blockers escalate, managers intervene. Phase 6.0 adds meetings and Phase 7.x adds all UI.


Phase 6.0 — Meeting System with Physical Arrival Gating

Goal: implement meetings that require all participants to physically arrive before the meeting begins.

Context: depends on Phase 4.3 for movement and proximity, Phase 4.4 for physical communication. This is a key expression of hard constraint 3.

What to build: implement the schedule_event MCP tool for meetings. A manager creates a meeting by specifying a meeting_room_id, a list of invited agent IDs, a sim_time, and an agenda. This creates a scheduled job. When the meeting job fires, the World Server sends walk_to_meeting_room commands to all invited agents. The meeting does not start until every invited agent's position matches the meeting room's coordinates. The World Server tracks arrival and, once all are present, spawns a meeting session. The meeting session has all participants in its context. During the meeting, all speak calls are delivered to all agents in the meeting room (they are all within proximity). When the meeting session completes, all agents transition from Meeting to Walking (back to their desks). Record the full meeting transcript in the conversations table with type meeting.

Out of scope: meeting UI rendering in 3D (UI phase), cross-team meetings brokered by Office Manager (a stretch goal).

Acceptance criteria: scheduling a meeting creates a scheduled job. When the job fires, all invited agents walk to the meeting room. The meeting does not start until all agents have arrived. The meeting session delivers messages to all present agents. The meeting transcript is recorded in the conversations table. Agents return to their desks after the meeting ends.

Handoff: the core simulation logic is now complete. Everything from here is UI, polish, and hardening.


Phase 7.0 — 3D Office Viewport

Goal: render the simulated office as a 3D scene in the browser using React Three Fiber.

Context: depends on Phase 2.0 for WebSocket sim time broadcasts. Install react-three-fiber, drei, and three in the client package. The server-side logic is complete. This phase and all subsequent 7.x phases are client-side.

What to build: set up the React Three Fiber canvas as the main application view. Create the office floor plane with a grid. Render walls, desks, and meeting rooms based on data from GET /api/office/layout (add this endpoint to serve the office_layout table data). Set up an orbital camera with zoom, pan, and rotation controls using Drei's OrbitControls. Add ambient and directional lighting. The office should look clean and minimal, not photorealistic. Establish a WebSocket connection from the client to the server. Receive sim time broadcasts and display the current sim time in a HUD overlay. Add the sim time controls (Play, Pause, speed selector) to the HUD. The controls call the REST endpoints from Phase 2.0.

Out of scope: agent rendering (Phase 7.1), click interaction (Phase 7.2), side panels (Phase 7.3).

Acceptance criteria: opening http://localhost:PORT shows a 3D office scene with floor, walls, desks, and meeting rooms. The camera can be rotated, zoomed, and panned. Sim time is displayed and updates in real time via WebSocket. Play, Pause, and speed controls work and affect the server's sim clock.

Handoff: Phase 7.1 adds agent capsules to this scene.


Phase 7.1 — Agent Capsule Rendering and Movement Animation

Goal: render agents as colored capsules in the 3D scene with smooth movement animation.

Context: depends on Phase 7.0 for the viewport and Phase 4.3 for agent position data. Agent positions are stored in the database and broadcast via WebSocket.

What to build: add a WebSocket subscription for agent state updates. The server broadcasts agent position, state, and team_id changes. Render each agent as a capsule mesh at their current position. Color the capsule based on the agent's team color (fetched from the teams table via the agent's team_id). The Office Manager and unassigned agents use neutral gray. Add smooth interpolation between position updates so agents glide rather than teleport. Display a floating name label above each capsule using Drei's Html or Billboard component. Show the agent's current state as a small text or icon below their name. When an agent is in Blocked state, render a red exclamation mark above their capsule. Add a simple idle animation (subtle floating or breathing effect) for agents who are not walking.

Out of scope: click interaction (Phase 7.2), chat bubbles (Phase 7.3).

Acceptance criteria: all agents in the database appear as colored capsules in the viewport. Capsule colors match team colors. Agents moving in the simulation animate smoothly. Name labels are visible. Blocked agents show a red exclamation mark. The Office Manager is visually distinct (neutral color).

Handoff: Phase 7.2 adds click interaction so the user can actually interact with these capsules.


Phase 7.2 — Agent Click Interaction and Side Panel

Goal: implement clicking an agent to open a side panel with their information, chat log, sessions, and a text input.

Context: depends on Phase 7.1 for agent capsules, Phase 3.2 for session data, and Phase 4.4 for conversation data.

What to build: add raycasting click detection on agent capsules using React Three Fiber's onClick. When an agent is clicked, open a side panel on the right side of the screen. The panel displays: agent name, role (Office Manager / Team Manager / Agent), team name and color, current state, current task. Below this, a tabbed interface with three tabs. Chat Log tab: shows the agent's chat log from GET /api/agents/:id/chat-logs, with a text input at the bottom for the user to send a message via POST /api/agents/:id/messages. Sessions tab: shows all sessions grouped by sim day from GET /api/agents/:id/sessions, each expandable to show tool calls. Active sessions show live tool call updates via WebSocket with loading animations. A Stop button appears during active sessions, calling POST /api/sessions/:id/interrupt. Details tab: shows the agent's persona, specialties, hire date, and desk assignment. Clicking the viewport background closes the side panel.

Out of scope: the Conversations panel (Phase 7.4), the blocked agent modal (Phase 7.7).

Acceptance criteria: clicking an agent in the viewport opens a side panel. The panel shows correct agent information. The Chat Log tab displays messages and allows the user to send new messages. The Sessions tab shows past sessions with expandable tool calls. Active sessions stream live tool calls. The Stop button interrupts an active session. Closing the panel deselects the agent.

Handoff: the core interaction model is now live. The user can observe and communicate with agents.


Phase 7.3 — Chat Bubbles with Proximity Display

Goal: show speech bubbles above agents when they speak, visible only when the camera is close enough.

Context: depends on Phase 7.1 for agent rendering and Phase 4.4 for speak events.

What to build: subscribe to speak events via WebSocket. When an agent speaks, display a chat bubble above their capsule. The bubble shows the message text, truncated to a reasonable length with full text available on hover. Bubbles fade out after a configurable duration in sim time. Only render bubbles for agents currently within the camera's view frustum. Optionally, reduce bubble detail or hide them when the camera is zoomed out far enough to prevent visual clutter. Ensure bubbles are positioned using Drei's Html component so they face the camera (billboard behavior).

Out of scope: message filtering, the Conversations panel.

Acceptance criteria: when an agent speaks, a chat bubble appears above them in the viewport. Bubbles display the message text. Bubbles disappear after a sim-time duration. Bubbles use billboard rendering to always face the camera.

Handoff: the viewport now shows both movement and communication visually.


Phase 7.4 — Conversations Panel

Goal: build the Conversations panel showing all office-wide conversation history.

Context: depends on Phase 4.4 for conversation records in the database.

What to build: add a Conversations tab or panel accessible from the UI (e.g., a toggle button in the HUD). The panel lists all conversations from GET /api/conversations with pagination. Each entry shows: conversation type (one-on-one, meeting, standup, briefing, user interaction), participants by name, sim time, and a preview of the first message. Clicking a conversation expands it to show the full transcript. Add search functionality: filter by participant name, keyword in messages, conversation type, and sim date range. New conversations should appear in real time via WebSocket subscription. The panel is separate from the agent-specific chat log in the side panel.

Out of scope: filtering by team, exporting conversations.

Acceptance criteria: the Conversations panel lists all conversations in the simulation. Each entry shows participants, type, time, and transcript. Search by keyword and participant works. New conversations appear in real time.

Handoff: the user now has full visibility into all office communication.


Phase 7.5 — Diff Viewer Panel

Goal: build the read-only diff viewer for browsing worktree changes, commits, and PRs.

Context: depends on Phase 4.6 for PR and Git data endpoints.

What to build: add a Projects/Diff panel accessible from the UI. The panel lists all projects and their worktrees. Selecting a worktree shows: the current git diff for the branch (from GET /api/worktrees/:id/diff), a list of recent commits (from GET /api/worktrees/:id/commits), and open PRs (from GET /api/projects/:id/prs). Selecting a PR shows the full PR diff. All diffs should be rendered with syntax highlighting using a lightweight diff rendering library or a simple custom renderer with add/remove line coloring. No editing capability. This is strictly read-only observation.

Out of scope: code editing, code navigation, cross-project views.

Acceptance criteria: the diff viewer shows real Git diffs from project worktrees. Commits are listed chronologically. PRs are listed with status. PR diffs are viewable with syntax coloring. No write operations are possible through this panel.

Handoff: the user can now observe what agents are building without leaving the Agency UI.


Phase 7.6 — Schedule Panel and Activity Log

Goal: add a schedule panel showing upcoming sim events and a terminal-style activity log.

Context: depends on Phase 3.3 for scheduled jobs data and Phase 3.2 for session events.

What to build: add a Schedule panel accessible from the UI. It shows a timeline view of the current sim day's events: agent arrivals, meetings, lunch breaks, departures, Office Manager sessions, and any custom scheduled events. Events are color-coded by type. Upcoming events are highlighted. Past events are dimmed. Add a terminal-style Activity Log panel that shows a scrolling feed of simulation events in real time: agent state changes, session starts and completions, tool calls, PR events, task completions, blocker reports, and escalations. Each log entry has a sim timestamp, the agent involved, and a short description. The log subscribes to a WebSocket channel for simulation events.

Out of scope: filtering the activity log by agent or type (a nice-to-have for later).

Acceptance criteria: the schedule panel shows today's scheduled events as a timeline. The activity log streams simulation events in real time. Both panels update correctly as sim time advances.

Handoff: the user now has timeline and log-based views of simulation activity.


Phase 7.7 — Blocked Agent Modal

Goal: implement the guided resolution modal for blocked agents.

Context: depends on Phase 5.1 for blocker data and Phase 7.1 for the visual blocked indicator.

What to build: when the user clicks a blocked agent (one with the red exclamation mark), open a modal instead of (or in addition to) the side panel. The modal displays: the agent's name and role, a plain-language description of what went wrong, the escalation chain that was attempted (e.g., "Team Manager Alex tried to resolve this but could not"), the specific external action needed from the user (e.g., "Run `claude` in your terminal to authenticate the Claude CLI"), step-by-step instructions for resolution, and a "Mark as Resolved" button. When the user clicks "Mark as Resolved," the World Server transitions the agent from Blocked to Idle and resumes normal operation. If the blocker was not actually resolved, the agent will re-encounter it and re-escalate.

Out of scope: automatic detection of resolution (checking if CLI auth exists), agent-specific troubleshooting beyond generic steps.

Acceptance criteria: clicking a blocked agent shows a modal with the blocker description and resolution steps. The modal shows the escalation history. Clicking "Mark as Resolved" transitions the agent to Idle. The agent resumes work after resolution.

Handoff: the UI is now functionally complete. Phase 8.x handles hardening.


Phase 8.0 — Agent Interruption UI and Hung Session Handling

Goal: ensure the Stop button and hung session detection work end-to-end through the UI.

Context: depends on Phase 7.2 for the side panel Stop button and Phase 5.1 for hung session detection.

What to build: verify and complete the Stop button flow. Pressing Stop calls POST /api/sessions/:id/interrupt. The server gracefully terminates the agentic session via the provider abstraction's interruptSession method. Partial work is committed with an auto-generated message. The agent transitions to Idle. The session record updates with outcome interrupted. The UI reflects the state change in real time. For hung sessions: the World Server's detection runs on each sim tick, checking all active sessions for tool call inactivity exceeding the timeout. When detected, the same interrupt flow triggers automatically, but the outcome is set to hung and the agent transitions to Blocked instead of Idle. The blocked agent then follows the escalation chain from Phase 5.1.

Out of scope: configuring the hung session timeout from UI (use server config).

Acceptance criteria: pressing Stop during an active session terminates it and the agent returns to Idle within a few seconds. The session shows as interrupted in the Sessions tab. A hung session is automatically detected, interrupted, and the agent is set to Blocked. The blocked agent modal shows the hung session as the blocker cause.

Handoff: Phase 8.1 handles the remaining hardening tasks.


Phase 8.1 — Hardening and Error Recovery

Goal: make the system resilient to crashes, disconnections, and edge cases.

Context: this is the final phase. All features are implemented. This phase is about robustness.

What to build: WebSocket reconnection: the client should automatically reconnect on disconnect with exponential backoff, and re-subscribe to all active channels. State restoration on restart: when the server restarts, it should restore all agent states from the database, restart the sim clock from persisted time, re-fire missed scheduled jobs per policy, and resume any sessions that were active (or mark them as errored if they cannot be resumed). Graceful shutdown: on SIGTERM/SIGINT, the server should interrupt all active sessions, commit partial work, persist sim time, and close the database cleanly. Error boundaries in the React app: wrap major UI sections in error boundaries so a rendering error in one panel does not crash the entire viewport. Provider error handling: if an agentic session errors out, the agent transitions to Blocked and the escalation chain handles it. Database WAL mode: enable WAL mode on the SQLite database for better concurrent read performance. Add a health check endpoint GET /api/health.

Out of scope: horizontal scaling, multi-user support, authentication.

Acceptance criteria: killing and restarting the server resumes the simulation from where it was. WebSocket disconnection and reconnection is seamless. A provider error does not crash the server. The health check endpoint returns 200 when the server is healthy. Graceful shutdown completes within a reasonable timeout.

Handoff: the project is feature-complete and hardened. Future work is iteration and polish.
