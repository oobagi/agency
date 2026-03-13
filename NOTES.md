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

Date completed:
What was built:
What was skipped or deferred:
Deviations from the spec and why:
Issues encountered:
Notes for the next agent:


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
