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

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 3.0 — Provider Abstraction Layer

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 3.1 — Agent Management and Hiring

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 3.2 — Session Recording Pipeline

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 3.3 — Daily Schedule Automation

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 4.0 — Office Manager Autonomous Loop

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 4.1 — Team Manager Autonomous Loop

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

Phase 4.2 — Regular Agent Idle Check-in and Context Assembly

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:

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
Notes for the next agent:

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
