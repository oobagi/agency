Agency Implementation Notes

This file is a running log for implementing agents. When you complete a phase, fill in the fields under that phase's section before handing off. Do not delete any section. If you skip or defer something, say so and say why.

Phase 1.0 — Project Scaffold and Monorepo Structure

Date completed: 2026-03-13
What was built: pnpm workspace monorepo with two packages (server and client). Root package.json with dev/build/start/lint/format scripts. Server package uses tsx watch for dev, TypeScript strict mode, ESLint with typescript-eslint, and an HTTP server entry point (src/index.ts) on configurable port (default 3001). Client package uses React 19, Vite 6, TypeScript strict mode, ESLint with typescript-eslint, and Vite proxy config routing /api to server:3001 and /ws to websocket on server. Shared Prettier config at root. .gitignore covers node_modules, dist, .env, and SQLite files.
What was skipped or deferred: Nothing.
Deviations from the spec and why: None.
Issues encountered: esbuild post-install scripts were blocked by pnpm's default security policy. Resolved by adding onlyBuiltDependencies to pnpm-workspace.yaml.
Notes for the next agent: Server entry point is packages/server/src/index.ts with a bare http.createServer. Install better-sqlite3 and build the database layer there. The server listens on PORT env var (default 3001). Client Vite proxy is already configured to forward /api and /ws to the server.

Phase 1.1 — Database Schema and Migration Runner

Date completed: 2026-03-13
What was built: SQLite database layer using better-sqlite3 with WAL mode and foreign keys enabled. Migration runner in src/db.ts that checks a migrations table for applied migrations and runs unapplied ones inside transactions. Initial migration (src/migrations/001_initial_schema.ts) creates all 21 tables from DESIGN_DOC.md: agents, personas, teams, projects, worktrees, tasks, pull_requests, agent_memory, chat_logs, conversations, conversation_participants, conversation_messages, sessions, session_tool_calls, scheduled_jobs, job_queue, desks, meeting_rooms, office_layout, settings, and migrations. All tables have correct columns, types, CHECK constraints, and foreign keys matching the spec. Settings table seeded with defaults: default_provider=claude_agent_sdk, default_model=claude-sonnet-4-20250514, sim_speed=1, sim_paused=false. Server entry point (src/index.ts) calls initDb() on startup and closeDb() on SIGINT/SIGTERM. getDb() exported as singleton accessor.
What was skipped or deferred: sqlite-vss setup (deferred to Phase 5.0 per spec).
Deviations from the spec and why: None.
Issues encountered: better-sqlite3 native bindings required adding it to onlyBuiltDependencies in pnpm-workspace.yaml (same pattern as esbuild from Phase 1.0). The migrations table needed CREATE TABLE IF NOT EXISTS in the migration file since the runner bootstraps it before running migrations.
Notes for the next agent: Import getDb() from ./db.js to access the database. The DB file path defaults to agency.db in cwd, overridable via AGENCY_DB_PATH env var. Migrations are TypeScript modules in src/migrations/ exporting { name, up(db) }. Register new migrations in src/migrations/index.ts.

Phase 2.0 — Sim Clock and Tick Loop

Date completed: 2026-03-13
What was built: SimClock class (src/sim-clock.ts) with now(), pause(), resume(), setSpeed(), onTick(), start(), stop() methods. Single setInterval drives tick loop at 1s real-world intervals, advancing sim time by (speed × 1) sim seconds per tick. Sim time persists to settings table (sim_time key) and is restored on restart. Speed and paused state also persist. REST endpoints: GET /api/sim/status (returns simTime, speed, paused), POST /api/sim/pause, POST /api/sim/resume, POST /api/sim/speed (accepts {multiplier: 1-10}). WebSocket server (ws library) attached to HTTP server, broadcasts tick events ({type, simTime, speed, paused}) to all connected clients on every tick. Server entry point wires up clock, REST routing, and graceful shutdown (clock.stop(), wss.close(), closeDb()).
What was skipped or deferred: Nothing.
Deviations from the spec and why: None.
Issues encountered: None.
Notes for the next agent: Import SimClock and call clock.onTick(callback) to subscribe to tick events. clock.now() returns the current sim Date. The sim starts at 2026-01-01T07:00:00Z on first run. WebSocket clients receive JSON messages with type "tick" on each tick. Speed is validated to 1-10 range.

Phase 2.1 — MCP Server with Stub Tool Handlers

Date completed: 2026-03-13
What was built: MCP server using @modelcontextprotocol/sdk (v1.27.1) with StreamableHTTP transport mounted at POST/GET/DELETE /mcp on the existing HTTP server. Tool registry module (src/mcp/tool-registry.ts) defines all 24 tools from DESIGN_DOC.md with complete Zod v4 input schemas, descriptions, and managerOnly flags. MCP server module (src/mcp/server.ts) creates per-session McpServer instances, registers all tools with stub handlers that log calls and return placeholder success responses, and manages session lifecycle. 11 general tools: walk_to_desk, walk_to_agent, walk_to_meeting_room, walk_to_exit, speak, send_to_manager, begin_task, commit_work, open_pull_request, set_state, report_blocker. 13 manager-only tools: hire_agent, fire_agent, create_team, assign_agent_to_team, create_project, delete_project, assign_team_to_project, create_worktree, schedule_event, review_pull_request, merge_pull_request, trigger_compression, checkpoint_agent. Permission validation layer checks agent role from the agents table — office_manager and team_manager roles pass, regular agent role is rejected. Agent identity passed via _agent_id field (to be replaced by session context in Phase 3.0). Schema validation via Zod rejects wrong types and missing required fields. Graceful shutdown closes all MCP sessions.
What was skipped or deferred: Nothing.
Deviations from the spec and why: Agent identity for permission checks uses a temporary _agent_id field passed in tool arguments rather than session context, because the provider abstraction (Phase 3.0) that establishes session identity doesn't exist yet. All schemas use .passthrough() so this meta-field survives Zod validation. The MCP server creates a fresh McpServer instance per session (required by the SDK — each Server/McpServer can only connect to one transport).
Issues encountered: MCP SDK v1.27.1 exports McpServer from @modelcontextprotocol/sdk/server/mcp.js (not the documented @modelcontextprotocol/server path). StreamableHTTPServerTransport.sessionId is undefined until after handleRequest processes the initialize call, so session storage must happen after handleRequest returns. Zod v4 z.record() requires two arguments (key schema + value schema), unlike v3. Zod v4 z.object() strips unknown keys by default, requiring .passthrough() to preserve the _agent_id meta-field.
Notes for the next agent: Import createMcpServer from ./mcp/server.js to get a fresh MCP server instance with all tools. Import TOOL_DEFINITIONS from ./mcp/tool-registry.js for tool metadata. To replace a stub handler, modify the handler in server.ts or refactor to import handlers from separate modules. The MCP endpoint is at /mcp (StreamableHTTP protocol — POST to initialize, include mcp-session-id header for subsequent requests). Manager-only tools are listed in the MANAGER_ONLY_TOOLS set exported from tool-registry.ts. The validateAgentPermission function checks agent role from the DB.

Phase 2.2 — Persona System

Date completed: 2026-03-13
What was built: Persona fetcher module (src/personas.ts) that clones the agency-agents GitHub repo (https://github.com/msitarzewski/agency-agents.git) to a local cache in os.tmpdir(), parses markdown files with YAML frontmatter from relevant directories (engineering, testing, design, product, project-management), extracts name/bio/system_prompt/specialties, and upserts into the personas table. Specialty detection via keyword matching classifies personas into frontend, backend, devops, testing, design, and architecture. 49 personas stored covering all 6 specialty categories. REST endpoints: GET /api/personas returns all personas with parsed specialties array, POST /api/personas/refresh re-fetches from GitHub. Persona fetch runs in background on server startup.
What was skipped or deferred: Nothing.
Deviations from the spec and why: No fallback/caching layer — the repo is public and available; if it's unreachable, the error propagates normally. Repo URL configurable via AGENCY_AGENTS_REPO env var.
Issues encountered: None.
Notes for the next agent: Import getPersonas() from ./personas.js to query stored personas. Each persona has: id (sha256 hash of path), name, github_username (filename slug), bio (frontmatter description), system_prompt (full markdown body), specialties (JSON array). The hiring flow in Phase 3.1 should pull from this table to assign personas to new agents.

Phase 3.0 — Provider Abstraction Layer

Date completed: 2026-03-13
What was built: Provider abstraction in src/providers/ with four modules. types.ts defines AgenticProvider interface, SessionConfig, Session, and SessionEvent types (tool_call_start, tool_call_complete, session_complete, session_error). claude-agent-sdk.ts implements ClaudeAgentSdkProvider wrapping @anthropic-ai/claude-agent-sdk query() function — spawns sessions with in-process MCP server (via createSdkMcpServer/tool helpers), streams SDK messages mapped to SessionEvents, supports interrupt via Query.interrupt() and abort via Query.close(). codex.ts implements CodexProvider with same interface (placeholder — returns session_error, to be wired to Codex CLI in future). manager.ts implements ProviderManager singleton that reads default_provider and default_model from settings, checks per-agent provider_override and model_override, and returns the correct provider instance. lightweight.ts exports lightweightQuery() using query() with haiku model, maxTurns 1, no tools, no persistence.
What was skipped or deferred: Nothing.
Deviations from the spec and why: The ClaudeAgentSdkProvider uses createSdkMcpServer to build an in-process MCP server per session rather than connecting to the StreamableHTTP endpoint. This is more efficient (no HTTP roundtrip) and is the SDK's recommended pattern for in-process tool servers. The Codex provider is a placeholder that returns a session_error — the OpenAI Codex CLI integration requires separate research.
Issues encountered: The @anthropic-ai/claude-code package is the CLI binary, not the SDK library. The correct SDK package is @anthropic-ai/claude-agent-sdk. SDKResultMessage type narrowing caused TS errors when accessing error-specific fields — resolved with a type assertion.
Notes for the next agent: Import providerManager from ./providers/manager.js. Call providerManager.getProvider(agentId) and providerManager.getModel(agentId) to get the right provider and model. Spawn sessions with provider.spawnSession(config). Iterate session.events async to get SessionEvents. Call provider.interruptSession(sessionId) or session.abort() to stop. For lightweight LLM calls (summaries, briefings), import lightweightQuery from ./providers/lightweight.js. The ClaudeAgentSdkProvider builds per-session in-process MCP servers with tool permission checks baked in.

Phase 3.1 — Agent Management and Hiring

Date completed: 2026-03-13
What was built: Handler module (src/handlers/agent-management.ts) with real implementations for four MCP tools: hire_agent, fire_agent, create_team, and assign_agent_to_team. hire_agent looks up a persona by ID, creates a new agent record with role 'agent', state 'Idle', the persona's system_prompt, and no team/desk/knowledge. fire_agent sets fired_at to sim time, transitions agent to 'Departing', frees their desk, removes team assignment, and clears team manager_id if applicable. Cannot fire the Office Manager. create_team creates a team record with name and hex color, then allocates a block of 8 desks positioned in a row layout. assign_agent_to_team assigns an agent to a team, picks the first available desk in the team's block, updates the agent's position to the desk coordinates, and marks the desk as occupied. Frees the old desk if the agent had one. MCP server refactored to support real handler registry alongside stub handlers — tools with real implementations get routed to the handler module with permission checks, sim clock access, and caller identity. Sim clock accessor wired from index.ts via setSimClock(). REST endpoints added: GET /api/agents (all agents with team info), GET /api/agents/:id (single agent), GET /api/teams (all teams with agent count), GET /api/teams/:id (single team), GET /api/desks (all desks), GET /api/teams/:id/desks (team desks). Team color palette of 8 visually distinct colors exported for future use.
What was skipped or deferred: Nothing.
Deviations from the spec and why: None.
Issues encountered: None.
Notes for the next agent: Import handler functions from ./handlers/agent-management.js. To add more real MCP tool handlers, add entries to the REAL_HANDLERS map in src/mcp/server.ts — each handler receives (args, callerAgentId, simNow). The desk allocation uses a row-based layout: each team gets 8 desks in a horizontal row, with rows stacked in the Z axis. The simNow function is injected via setSimClock() from index.ts. REST endpoints for agents and teams are live. The handler module also exports getAgents(), getAgent(), getTeams(), getTeam(), getDesks() for querying.

Phase 3.2 — Session Recording Pipeline

Date completed: 2026-03-13
What was built: SessionRecorder class (src/session-recorder.ts) that wraps a provider Session and records all events to the database. On session start, inserts a record into the sessions table with agent_id, sim_day, provider, model, and started_at. Consumes the session's async event stream in the background. On tool_call_start, inserts into session_tool_calls with status 'pending'. On tool_call_complete, updates the tool call record with result and status 'completed' or 'errored'. On session_complete, updates the session with ended_at, outcome 'completed', and token_estimate. On session_error, sets outcome to 'errored'. All events are broadcast via a pluggable broadcast function to WebSocket subscribers. WebSocket subscription system: clients send {"type": "subscribe_sessions", "agentId": "..."} to receive live session events for a specific agent. Unsubscribe with {"type": "unsubscribe_sessions", "agentId": "..."}. Active session tracking with Map for interrupt support. interruptSession() function aborts the session, updates DB outcome, and removes from active tracking. REST endpoints: GET /api/agents/:id/sessions (all sessions with tool call count), GET /api/sessions/:id (single session with full tool_calls array), POST /api/sessions/:id/interrupt (graceful interruption).
What was skipped or deferred: Nothing.
Deviations from the spec and why: None.
Issues encountered: None.
Notes for the next agent: Import SessionRecorder from ./session-recorder.js. Construct with (session, provider, model, simNow) — it automatically starts consuming events in the background. Call setSessionBroadcast() from index.ts to wire up WebSocket broadcasting. interruptSession(sessionId, outcome, simNow) is available for hung session detection (Phase 5.1) and the UI Stop button. getActiveSession() and getActiveSessionForAgent() check if a session is currently running. All session-spawning code in future phases should wrap sessions with SessionRecorder.

Phase 3.3 — Daily Schedule Automation

Date completed: 2026-03-13
What was built: Scheduler module (src/scheduler.ts) with scheduled jobs runner, daily schedule automation, missed job handling, and the schedule_event MCP tool handler. processTick() runs on every sim clock tick, checks the scheduled_jobs table for due jobs, executes them via registered handlers, and advances recurring jobs to their next occurrence. Four built-in daily job handlers: arrive (→ Arriving), lunch_break (→ Break), return_from_lunch (→ Walking), depart (→ Departing). If an agent is busy when a job fires, it's queued in job_queue and retried when the agent becomes Idle. createDailyScheduleForAgent() creates four recurring daily jobs at 08:00, 12:00, 13:00, 17:00 — called automatically when hire_agent fires. removeScheduleForAgent() cleans up on fire_agent. handleMissedJobsOnBoot() runs at server start, fires missed fire_immediately jobs and skips skip_to_next ones, then advances all to their next recurrence. schedule_event MCP tool registered as real handler for managers to create custom scheduled jobs. REST endpoints: GET /api/scheduled-jobs, GET /api/agents/:id/scheduled-jobs, GET /api/job-queue. registerJobHandler() exported for future phases to add custom job types.
What was skipped or deferred: Nothing.
Deviations from the spec and why: None.
Issues encountered: None.
Notes for the next agent: Import processTick from ./scheduler.js — it's called on every sim clock tick from index.ts. Import createDailyScheduleForAgent/removeScheduleForAgent for agent lifecycle. Use registerJobHandler(jobType, handler) to add new job types (e.g., Office Manager morning_planning in Phase 4.0). The recurrence field currently supports 'daily' only; extend advanceJobSchedule() for other patterns. Job handlers return false to queue a job when the agent is busy. State transitions in handlers are direct DB updates — they'll be replaced with proper state machine validation in Phase 4.3.

Phase 4.0 — Office Manager Autonomous Loop

Date completed: 2026-03-13
What was built: Office Manager module (src/office-manager.ts) with autonomous session spawning. initOfficeManager() creates the singleton Office Manager agent on first run (built-in persona, not from agency-agents repo) with role 'office_manager'. Creates 7 scheduled jobs: 4 daily lifecycle (arrive/lunch/return/depart) plus 3 OM session jobs (morning_planning at 08:05, midday_check at 13:05, eod_review at 17:00). OM sessions scheduled 5 minutes after arrive/return to ensure the OM has arrived first. When OM session jobs fire, spawnOMSession() builds a rich context including: current sim time, all projects, all teams with manager/agent counts, all agents with states, blocked agents, pending/blocked tasks, open PRs, user messages from chat_logs, available persona count, and full tool list. Session spawned via ProviderManager + SessionRecorder for full recording. The OM gets access to all 24 MCP tools (general + manager-only). User message system: sendUserMessageToAgent() stores messages in chat_logs with speaker_type 'user', injected into OM context on next session. REST endpoints: GET /api/agents/:id/chat-logs, POST /api/agents/:id/messages (accepts {message: string}). Re-init is idempotent — won't duplicate the OM or its jobs.
What was skipped or deferred: Nothing.
Deviations from the spec and why: OM session jobs scheduled at :05 past the hour (08:05, 13:05) instead of exactly on the hour, so they fire after the daily arrive/return jobs rather than simultaneously.
Issues encountered: None.
Notes for the next agent: Import initOfficeManager from ./office-manager.js — called on server startup in index.ts. The OM sessions fire automatically via the scheduler when sim time reaches 08:05, 13:05, 17:00. The actual LLM session requires a configured provider (Claude Agent SDK with CLI auth). User messages are injected into the OM's next session context. getChatLogs(agentId) returns the full chat history for any agent. The OM persona and context builder are in office-manager.ts — extend buildOMContext() to add more status information as new systems come online.

Phase 4.1 — Team Manager Autonomous Loop

Date completed: 2026-03-13
What was built: Team Manager module (src/team-manager.ts) with three trigger-based session spawning. triggerTMDeskArrival() fires when a TM transitions Walking → Idle (arriving at desk). triggerTMTaskComplete() fires when any team member completes a task (looks up the team's manager by team_id). triggerTMBlockerReport() fires when a team member reports a blocker. Each trigger spawns an autonomous session with team-scoped context: team members with states, team tasks, team PRs, blocked agents, recent chat logs, and full tool list. TM persona is built dynamically with the team name. All sessions go through ProviderManager + SessionRecorder. Guard against duplicate sessions — skips trigger if TM already has an active session. hire_agent updated to accept optional role parameter ('agent' | 'team_manager'). assign_agent_to_team auto-sets teams.manager_id when a team_manager is assigned. onAgentStateChange() wired into scheduler's setAgentState() to detect Walking → Idle transitions for TMs.
What was skipped or deferred: Nothing.
Deviations from the spec and why: None.
Issues encountered: None.
Notes for the next agent: Import trigger functions from ./team-manager.js: triggerTMDeskArrival(tmId), triggerTMTaskComplete(teamId, agentId, taskTitle), triggerTMBlockerReport(teamId, agentId, description). These are called from: the scheduler (state changes), the task system (Phase 4.5 on completion), and the report_blocker handler (Phase 5.1). The onAgentStateChange() hook is already wired into the scheduler. Additional state change sources (Phase 4.3 state machine) should also call it.

Phase 4.2 — Regular Agent Idle Check-in and Context Assembly

Date completed: 2026-03-13
What was built: Two modules. (1) Context assembly module (src/context-assembly.ts) with buildSessionContext(agentId, taskContext?) that assembles session context for any agent: persona system prompt, current sim time, current/pending task or "no tasks" message, last 10 chat logs, top 3 memory chunks (plain text for now — vector search in Phase 5.0), team info with TM name for regular agents, and available MCP tools filtered by role (regular agents don't see manager-only tools). Enforces ~100k token budget with truncation. (2) Idle checker module (src/idle-checker.ts) with processIdleChecks(simTime) called on every tick. Tracks how long each regular agent with no tasks has been Idle using a Map of sim timestamps. At 30 sim minutes, triggers a TM desk arrival session so the TM can assign work. Timer resets after trigger and when agent leaves Idle state. resetIdleTimer() called from onAgentStateChange() when agents transition out of Idle.
What was skipped or deferred: Vector similarity search for memory retrieval (deferred to Phase 5.0 per spec — using plain recency-based retrieval for now).
Deviations from the spec and why: None.
Issues encountered: None.
Notes for the next agent: Import buildSessionContext from ./context-assembly.js for all session-spawning code. It replaces ad-hoc context building. The OM and TM modules still use their own specialized context builders since they need different information (team-scoped vs global). Regular agent sessions should use buildSessionContext. processIdleChecks runs on every tick from index.ts. Phase 5.0 will add vector search to replace the plain memory retrieval.

Phase 4.3 — Physical Movement and State Machine

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 4.4 — Physical Communication Enforcement

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 4.5 — Task System

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 4.6 — PR System and Git Operations

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 5.0 — Memory Compression Pipeline

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 5.1 — Blocker Detection and Escalation Chain

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 6.0 — Meeting System with Physical Arrival Gating

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 7.0 — 3D Office Viewport

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 7.1 — Agent Capsule Rendering and Movement Animation

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent: IMPORTANT — In addition to the spec, add floating activity icons above agent capsules for desk work actions (PR review, git push, task start, commit). These are NOT walk-to-speak communication — they represent work happening at the agent's desk (like getting a notification on their computer). The physical walk rule only applies to agent-to-agent messaging. Show small icons (git, PR, code, etc.) when tool_call_start events fire for begin_task, commit_work, open_pull_request, review_pull_request. These events are already broadcast via WebSocket session subscriptions.

Phase 7.2 — Agent Click Interaction and Side Panel

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 7.3 — Chat Bubbles with Proximity Display

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 7.4 — Conversations Panel

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 7.5 — Diff Viewer Panel

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 7.6 — Schedule Panel and Activity Log

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 7.7 — Blocked Agent Modal

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 8.0 — Agent Interruption UI and Hung Session Handling

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 8.1 — Hardening and Error Recovery

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:
