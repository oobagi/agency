# Implementation Log

Complete phase-by-phase implementation history for Agency. All phases completed between 2026-03-13 and 2026-03-14.

---

## Phase 1.0 — Project Scaffold and Monorepo Structure

**Date**: 2026-03-13

pnpm workspace monorepo with two packages (server and client). Root package.json with dev/build/start/lint/format scripts. Server package uses tsx watch for dev, TypeScript strict mode, ESLint with typescript-eslint, and an HTTP server entry point (src/index.ts) on configurable port (default 3001). Client package uses React 19, Vite 6, TypeScript strict mode, ESLint with typescript-eslint, and Vite proxy config routing /api to server:3001 and /ws to websocket on server. Shared Prettier config at root. .gitignore covers node_modules, dist, .env, and SQLite files.

**Issues**: esbuild post-install scripts were blocked by pnpm's default security policy. Resolved by adding onlyBuiltDependencies to pnpm-workspace.yaml.

---

## Phase 1.1 — Database Schema and Migration Runner

**Date**: 2026-03-13

SQLite database layer using better-sqlite3 with WAL mode and foreign keys enabled. Migration runner in src/db.ts that checks a migrations table for applied migrations and runs unapplied ones inside transactions. Initial migration (src/migrations/001_initial_schema.ts) creates all 21 tables from DESIGN_DOC.md: agents, personas, teams, projects, worktrees, tasks, pull_requests, agent_memory, chat_logs, conversations, conversation_participants, conversation_messages, sessions, session_tool_calls, scheduled_jobs, job_queue, desks, meeting_rooms, office_layout, settings, and migrations. Settings table seeded with defaults: default_provider=claude_agent_sdk, default_model=claude-sonnet-4-20250514, sim_speed=1, sim_paused=false.

**Deferred**: sqlite-vss setup (deferred to Phase 5.0).

---

## Phase 2.0 — Sim Clock and Tick Loop

**Date**: 2026-03-13

SimClock class (src/sim-clock.ts) with now(), pause(), resume(), setSpeed(), onTick(), start(), stop() methods. Single setInterval drives tick loop at 1s real-world intervals, advancing sim time by (speed x 1) sim seconds per tick. Sim time persists to settings table and is restored on restart. REST endpoints for sim control. WebSocket server broadcasts tick events to all connected clients.

---

## Phase 2.1 — MCP Server with Stub Tool Handlers

**Date**: 2026-03-13

MCP server using @modelcontextprotocol/sdk (v1.27.1) with StreamableHTTP transport mounted at POST/GET/DELETE /mcp. Tool registry module defines all 24 tools from DESIGN_DOC.md with complete Zod v4 input schemas. Per-session McpServer instances with stub handlers. Permission validation layer checks agent role. Agent identity passed via _agent_id field.

**Issues**: MCP SDK v1.27.1 exports McpServer from @modelcontextprotocol/sdk/server/mcp.js (not the documented path). Zod v4 z.record() requires two arguments. Zod v4 z.object() strips unknown keys by default, requiring .passthrough().

---

## Phase 2.2 — Persona System

**Date**: 2026-03-13

Persona fetcher module that clones the agency-agents GitHub repo, parses markdown files with YAML frontmatter, extracts name/bio/system_prompt/specialties, and upserts into the personas table. 49 personas stored covering 6 specialty categories (frontend, backend, devops, testing, design, architecture). REST endpoints for listing and refreshing.

---

## Phase 3.0 — Provider Abstraction Layer

**Date**: 2026-03-13

Provider abstraction in src/providers/ with four modules. types.ts defines AgenticProvider interface and SessionEvent types. claude-agent-sdk.ts implements ClaudeAgentSdkProvider wrapping @anthropic-ai/claude-agent-sdk query(). codex.ts implements CodexProvider (placeholder). manager.ts implements ProviderManager singleton that reads settings and per-agent overrides. lightweight.ts exports lightweightQuery() using haiku.

**Deviation**: ClaudeAgentSdkProvider uses in-process MCP server per session rather than HTTP transport (more efficient, SDK recommended pattern).

**Issues**: The correct SDK package is @anthropic-ai/claude-agent-sdk (not @anthropic-ai/claude-code which is the CLI binary).

---

## Phase 3.1 — Agent Management and Hiring

**Date**: 2026-03-13

Real implementations for hire_agent, fire_agent, create_team, and assign_agent_to_team. hire_agent creates agent from persona. fire_agent sets fired_at, frees desk/team. create_team allocates 8 desks in a row layout. assign_agent_to_team picks first available desk. MCP server refactored to support real handler registry alongside stubs. REST endpoints for agents, teams, desks.

---

## Phase 3.2 — Session Recording Pipeline

**Date**: 2026-03-13

SessionRecorder class wraps provider Sessions, recording all events to the database and broadcasting via WebSocket. Active session tracking with Map for interrupt support. WebSocket subscription system for live session events. REST endpoints for session queries and interruption.

---

## Phase 3.3 — Daily Schedule Automation

**Date**: 2026-03-13

Scheduler module with scheduled jobs runner on sim ticks, daily schedule automation (arrive 08:00, lunch 12:00, return 13:00, depart 17:00), missed job handling on boot (fire_immediately / skip_to_next), and schedule_event MCP tool. Job queueing for busy agents. REST endpoints for scheduled jobs and queue.

---

## Phase 4.0 — Office Manager Autonomous Loop

**Date**: 2026-03-13

Office Manager singleton with 3 autonomous sessions per sim day (08:05 morning planning, 13:05 midday check, 17:00 EOD review). Rich context including all projects, teams, agents, blockers, tasks, PRs, user messages, and personas. Sessions spawn via ProviderManager + SessionRecorder. User message system via chat_logs.

**Deviation**: OM sessions at :05 past the hour (not on the hour) to fire after daily arrive/return jobs.

---

## Phase 4.1 — Team Manager Autonomous Loop

**Date**: 2026-03-13

Three trigger-based TM sessions: desk arrival, task completion, blocker report. Team-scoped context (members, tasks, PRs, blockers, chat logs). Guard against duplicate sessions. hire_agent updated to accept role parameter. assign_agent_to_team auto-sets teams.manager_id for team_managers.

---

## Phase 4.2 — Regular Agent Idle Check-in and Context Assembly

**Date**: 2026-03-13

Context assembly module with buildSessionContext() — async, persona prompt, task, last 10 chat logs, top 3 memory chunks, team info, role-filtered tools, ~100k token budget. Idle checker tracks 30 sim minute idle timeout for regular agents, triggers TM session.

**Deferred**: Vector similarity search for memory (deferred to Phase 5.0, used recency-based retrieval).

---

## Phase 4.3 — Physical Movement and State Machine

**Date**: 2026-03-13

Explicit TRANSITION_MAP data structure for all valid state transitions. transitionAgentState() validates transitions and enforces position checks (desk for Programming/Researching, meeting room for Meeting). Movement system with decoupled 60Hz render loop for smooth animation. Movement speed scales with sim speed. Walk handlers (desk, agent, meeting room, exit). Proximity detection with PROXIMITY_RADIUS=2.5 units.

**Deviation**: Movement render loop decoupled from sim clock at 60Hz real-time for smooth animation (explicitly requested).

---

## Phase 4.4 — Physical Communication Enforcement

**Date**: 2026-03-13

speak handler enforces proximity — rejects if no agents within range. Conversation recording system (conversations, participants, messages tables). send_to_manager walks then speaks with onArrival callback. startWalking() exported with optional onArrival callback. WebSocket speak broadcast for chat bubbles.

---

## Phase 4.5 — Task System

**Date**: 2026-03-13

Four MCP tools: create_task (manager-only), begin_task (validates desk position, transitions to Programming/Researching), complete_task (fires TM trigger), report_blocker (Blocked state + TM trigger). Two new tools added (create_task, complete_task) bringing total from 24 to 26.

**Deviation**: Added create_task and complete_task as new tools not in original 24. Necessary for managers to create tasks and agents to signal completion explicitly.

---

## Phase 4.6 — PR System and Git Operations

**Date**: 2026-03-13

Eight MCP tool handlers using simple-git. create_project initializes real Git repos. create_worktree creates real worktrees. commit_work records metadata only (hard constraint 2). open/review/merge_pull_request with hard constraint 7 enforcement (author cannot review or merge own PRs). merge_pull_request does real git merges. 24 of 26 tools implemented.

---

## Phase 5.0 — Memory Compression Pipeline

**Date**: 2026-03-13

Four subsystems: (1) Embeddings via @huggingface/transformers (384-dim, all-MiniLM-L6-v2). (2) Memory compression with LLM-generated summaries, vector storage in sqlite-vss. (3) Context monitor tracking tokens per session, 80% TM alert, 95% force-compress. (4) sqlite-vss integration with JS cosine similarity fallback. buildSessionContext now async with vector similarity search. 25 of 26 tools implemented.

**Deviation**: Used @huggingface/transformers instead of @xenova/transformers (renamed, same API).

---

## Phase 5.1 — Blocker Detection and Escalation Chain

**Date**: 2026-03-13

Full escalation chain: blockers table (migration 003) with status tracking and JSON escalation history. createBlocker, resolveBlocker, escalateBlockerToOM, markBlockerUserFacing functions. Three new MCP tools (resolve_blocker, escalate_to_om, mark_blocker_user_facing). Hung session detector: 30 sim min timeout, auto-interrupt, Blocked + blocker + TM escalation. REST endpoints and WebSocket broadcast for user-facing blockers. 28 of 29 MCP tools implemented.

---

## Phase 6.0 — Meeting System with Physical Arrival Gating

**Date**: 2026-03-13

Full meeting lifecycle: PendingMeeting tracking, meeting job handler via registerJobHandler('meeting'), physical arrival gating, session spawning on facilitator when all arrive, post-meeting walk-back to desks. retargetWalking() added for agents already walking. SessionRecorder.onComplete() callback for post-meeting cleanup. Migration 004 seeds 3 meeting rooms (Alpha, Beta, Gamma). TM persona updated with meeting scheduling instructions.

---

## Phase 7.0 — 3D Office Viewport

**Date**: 2026-03-13

React Three Fiber 3D viewport. OfficeScene with Canvas, OrbitControls, lighting. Floor, walls, desks (team-colored), meeting rooms with conference tables. HUD overlay with sim time, play/pause, speed selector, connection status. useWebSocket hook with subscribe pattern. useOfficeLayout hook. Migration 005 seeds office layout (floor, walls). Dark theme (#1a1a2e).

---

## Phase 7.1 — Agent Capsule Rendering and Movement Animation

**Date**: 2026-03-13

useAgents hook fetches agents via REST, subscribes to WS position updates. AgentCapsule with team colors, smooth lerp interpolation (LERP_SPEED=8), idle bobbing animation, floating name/state labels. Activity icons (laptop, checkmark, outbox, magnifier) above capsules for 3s on tool calls. Red exclamation for Blocked agents. OM is neutral gray.

---

## Phase 7.2 — Agent Click Interaction and Side Panel

**Date**: 2026-03-13

Click-to-select with emissive glow. SidePanel (380px right) with three tabs: Chat Log (send input, auto-scroll), Sessions (expandable tool calls, live WS updates, Stop button), Details (role, team, state, desk, persona). onPointerMissed deselects on background click.

---

## Phase 7.3 — Chat Bubbles with Proximity Display

**Date**: 2026-03-13

useChatBubbles hook subscribes to speak events. Bubbles above agents via Drei Html with distanceFactor=15. Truncated to 80 chars, full on hover. 6s real-time expiry with opacity fade.

---

## Phase 7.4 — Conversations Panel

**Date**: 2026-03-13

GET /api/conversations with search/filter params (search, type, participant, limit, offset). conversation_new WebSocket broadcast. ConversationsPanel (420px left) with search, filters, expandable cards, full transcripts, pagination. Left-side panels positioned to avoid conflict with right-side SidePanel.

**Issues**: Fixed test DB isolation bug (AGENCY_DB_PATH set after module-level evaluation). Fixed WebSocket type field collision (renamed to conversationType).

---

## Phase 7.5 — Diff Viewer Panel

**Date**: 2026-03-13

DiffViewerPanel (520px left) with breadcrumb navigation through project list, project detail (worktrees + PRs), and diff view. DiffView renders unified diffs with add/remove line coloring. getWorktreeDiff() and getWorktreeCommits() endpoints. Left panels mutually exclusive.

---

## Phase 7.6 — Schedule Panel and Activity Log

**Date**: 2026-03-13

SchedulePanel (420px left) with two tabs: Schedule (timeline of scheduled jobs, color-coded by type) and Activity Log (real-time WebSocket feed, capped at 200 entries). Activity broadcast system via broadcastActivity in state-machine.ts. WebSocket 'activity' event type. LeftPanel union type for mutual exclusivity.

---

## Phase 7.7 — Blocked Agent Modal

**Date**: 2026-03-13

BlockedAgentModal — centered overlay when clicking blocked agent. Shows blocker description, escalation chain timeline with color-coded role dots, resolution steps, and "Mark as Resolved" button. POST /api/blockers/:id/resolve transitions Blocked -> Idle. Modal appears alongside SidePanel.

---

## Phase 8.0 — Agent Interruption UI and Hung Session Handling

**Date**: 2026-03-14

interruptSession() now broadcasts session_complete WebSocket event and transitions agent to Idle for user-initiated interrupts. Hung session detector fully wired end-to-end: registration, 30 sim min timeout detection, interrupt with outcome='hung', Blocked transition, blocker creation, TM escalation.

**Deferred**: Auto-commit of partial work on interrupt (requires provider-specific integration).

---

## Phase 8.1 — Hardening and Error Recovery

**Date**: 2026-03-14

Health check endpoint (GET /api/health). State restoration on boot via restoreStateOnBoot() — marks orphaned sessions as errored, resets transient agent states (Walking/Arriving/Meeting) to Idle, preserves persistent states (Programming/Researching/Reviewing/Blocked). Enhanced graceful shutdown with double-shutdown guard, session interruption, ordered resource cleanup, 10s force-exit timeout. Provider error handling in SessionRecorder.handleSessionError() — Blocked transition, blocker creation, TM escalation. WebSocket reconnection with exponential backoff (1s * 2^attempt, capped at 30s). useAgents re-fetches on reconnect. React ErrorBoundary wraps all major UI sections.

**Deferred**: Integration tests for health endpoint and state restoration (existing test pattern doesn't cover HTTP endpoints).
