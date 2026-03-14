# Architecture

System architecture reference for Agency.

## System Overview

Agency is a persistent Node.js server with a React client. The server manages the simulation (agents, state machine, scheduling, MCP tools, agentic sessions) and the client renders a 3D viewport via React Three Fiber.

```
Browser (React + R3F)
  |
  |-- REST (user actions, data fetching)
  |-- WebSocket (real-time: ticks, positions, speaks, sessions, activity)
  v
Node.js Server (http + ws)
  |
  |-- SimClock (sole time source for all game logic)
  |-- MCP Server (tool gateway for agent sessions)
  |-- Provider Layer (Claude Agent SDK / Codex abstraction)
  |-- SQLite (better-sqlite3, WAL mode, sqlite-vss)
```

## Server Modules

### Core

| Module        | File               | Purpose                                                                                                            |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Entry point   | `index.ts`         | HTTP server, WebSocket, wiring, boot sequence, shutdown                                                            |
| Database      | `db.ts`            | SQLite singleton (`getDb()`), migrations, WAL mode, sqlite-vss                                                     |
| Sim Clock     | `sim-clock.ts`     | `SimClock` class — sole time source. `now()`, `pause()`, `resume()`, `setSpeed()`, `onTick()`                      |
| State Machine | `state-machine.ts` | Explicit `TRANSITION_MAP`, `transitionAgentState()`, activity broadcast                                            |
| Movement      | `movement.ts`      | 60Hz render loop (real-time, decoupled from sim clock), `startWalking()`, `retargetWalking()`, proximity detection |
| Scheduler     | `scheduler.ts`     | Scheduled jobs runner on sim ticks, daily schedules, missed job recovery, `registerJobHandler()`                   |

### Agent Intelligence

| Module            | File                            | Purpose                                                                                       |
| ----------------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| Office Manager    | `office-manager.ts`             | OM singleton, 3 daily sessions (08:05, 13:05, 17:00), context builder, user message injection |
| Team Manager      | `team-manager.ts`               | TM trigger-based sessions (desk arrival, task complete, blocker), team-scoped context         |
| Context Assembly  | `context-assembly.ts`           | `buildSessionContext()` — async, vector similarity memory search, role-filtered tools         |
| Session Recorder  | `session-recorder.ts`           | `SessionRecorder` class wraps provider sessions, records to DB, broadcasts events             |
| Provider Manager  | `providers/manager.ts`          | Provider abstraction — reads settings, per-agent overrides                                    |
| Claude Agent SDK  | `providers/claude-agent-sdk.ts` | `ClaudeAgentSdkProvider` — wraps Agent SDK `query()`                                          |
| Lightweight Query | `providers/lightweight.ts`      | `lightweightQuery()` — haiku, maxTurns 1, no tools                                            |

### Memory and Context

| Module             | File                       | Purpose                                                                |
| ------------------ | -------------------------- | ---------------------------------------------------------------------- |
| Memory Compression | `memory-compression.ts`    | End-of-day and task-completion compression, summary generation via LLM |
| Embeddings         | `embeddings.ts`            | @huggingface/transformers, 384-dim vectors (all-MiniLM-L6-v2)          |
| Context Monitor    | `context-monitor.ts`       | Token tracking per session, 80% TM alert, 95% force-compress           |
| Idle Checker       | `idle-checker.ts`          | 30 sim min idle timeout triggers TM check-in                           |
| Hung Detector      | `hung-session-detector.ts` | 30 sim min without tool call — interrupt, Blocked, TM escalation       |

### Handlers (MCP Tool Implementations)

| Module           | File                           | Purpose                                                            |
| ---------------- | ------------------------------ | ------------------------------------------------------------------ |
| Agent Management | `handlers/agent-management.ts` | hire_agent, fire_agent, create_team, assign_agent_to_team          |
| Communication    | `handlers/communication.ts`    | speak (proximity enforced), send_to_manager (walk-then-speak)      |
| Task System      | `handlers/task-system.ts`      | create_task, begin_task, complete_task, report_blocker             |
| Git Operations   | `handlers/git-operations.ts`   | create_project, create_worktree, commit_work, open/review/merge PR |
| Blocker Handlers | `handlers/blocker-handlers.ts` | resolve_blocker, escalate_to_om, mark_blocker_user_facing          |

### Support

| Module        | File                   | Purpose                                                                 |
| ------------- | ---------------------- | ----------------------------------------------------------------------- |
| MCP Server    | `mcp/server.ts`        | Per-session MCP server instances, tool routing, permission checks       |
| Tool Registry | `mcp/tool-registry.ts` | All 29 tool definitions with Zod v4 schemas                             |
| Blockers      | `blockers.ts`          | Blocker lifecycle, escalation history, resolution                       |
| Meetings      | `meetings.ts`          | Physical arrival gating, meeting session spawning, post-meeting cleanup |
| Personas      | `personas.ts`          | Fetch from agency-agents GitHub repo, parse, store                      |

## Client Components

### Hooks

| Hook              | Purpose                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `useWebSocket`    | WS connection with exponential backoff reconnection, tick/state tracking, `subscribe()` pattern |
| `useAgents`       | Agent render state from REST + WS position updates, activity icons, re-fetch on reconnect       |
| `useOfficeLayout` | Fetches office layout, desks, meeting rooms from REST                                           |
| `useChatBubbles`  | Tracks speak events, auto-expires bubbles after 6s                                              |

### Components

| Component            | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `OfficeScene`        | R3F Canvas with floor, walls, desks, meeting rooms, agents, chat bubbles                       |
| `AgentCapsule`       | Team-colored capsule mesh, lerp interpolation, idle bobbing, activity icons, blocked indicator |
| `HUD`                | Sim time, play/pause, speed selector, panel toggle buttons, connection status                  |
| `SidePanel`          | Right panel on agent click — Chat Log, Sessions (live tool calls), Details tabs                |
| `ConversationsPanel` | Left panel — searchable conversation list with full transcripts                                |
| `DiffViewerPanel`    | Left panel — project/worktree/PR browser with diff rendering                                   |
| `SchedulePanel`      | Left panel — timeline of scheduled jobs + real-time activity log                               |
| `BlockedAgentModal`  | Centered modal for blocked agents — escalation chain, resolution button                        |
| `ErrorBoundary`      | Class component wrapping major UI sections with crash recovery                                 |

## Key Implementation Details

- **29 MCP tools** total (28 fully implemented, `checkpoint_agent` is a stub)
- **Agent SDK** uses Zod v3 internally; tool registry uses Zod v4 — bridged via `buildZod3Shape()` in `claude-agent-sdk.ts`
- **Movement** render loop runs at 60Hz real-time (decoupled from sim clock) for smooth animation
- **OM sessions** fire at 08:05, 13:05, 17:00 (5 min after arrive/return to ensure OM has arrived first)
- **Persona IDs** are SHA-256 hashes (not human-readable slugs) — OM context includes actual IDs
- **Memory** uses @huggingface/transformers (384-dim embeddings) + sqlite-vss for vector search
- **Context assembly** is async — uses vector similarity search for memory injection
- **Context monitor** tracks estimated tokens per session; alerts TM at 80%, force-compresses at 95%
- **Blockers** table tracks escalation chain: Agent -> TM -> OM -> User with full JSON history
- **Hung detector** auto-interrupts after 30 sim minutes without tool call, transitions to Blocked
- **Meeting system**: `schedule_event` with `job_type: "meeting"` triggers physical arrival gating
- **Meeting rooms** seeded via migration 004 (Alpha Room, Beta Room, Gamma Room)
- **`SessionRecorder.onComplete()`** callback fires when session ends (used by meeting system)
- **Hard constraint 7** enforced: agents cannot review or merge their own PRs
- **Task lifecycle**: pending -> in_progress -> completed or blocked
- **Git operations** use simple-git; `create_project` inits real repos, `merge_pull_request` does real merges
- **Left-side panels** (Conversations, Projects, Schedule) are mutually exclusive via `LeftPanel` union type
- **Integration tests** use dynamic imports to set `AGENCY_DB_PATH` before db module loads

## Boot Sequence

1. `initDb()` — SQLite with WAL mode, foreign keys, migrations, sqlite-vss
2. `restoreStateOnBoot()` — mark orphaned sessions as errored, reset transient agent states
3. Wire sim clock to all subsystems
4. `initMeetingSystem()` — register meeting job handler
5. `initOfficeManager()` — create OM if not exists, register scheduled jobs
6. `handleMissedJobsOnBoot()` — fire or skip missed scheduled jobs
7. `clock.start()` + `startMovementLoop()` — begin simulation
8. `fetchAndStorePersonas()` — background persona fetch
9. `server.listen()` — accept connections

## Shutdown Sequence

1. Double-shutdown guard (`isShuttingDown` flag)
2. Stop sim clock (persists time to settings table)
3. Stop movement loop
4. Interrupt all active sessions via `getAllActiveSessionIds()` + `interruptSession()`
5. Close MCP sessions
6. Close WebSocket server
7. Close HTTP server (callback-based)
8. Close database
9. 10-second force-exit timeout with `.unref()` on SIGINT/SIGTERM

## State Machine

Valid states: Idle, Arriving, Walking, Researching, Programming, Reviewing, Meeting, Break, Departing, Blocked.

```
Idle       -> Walking, Programming, Researching, Reviewing, Meeting, Departing, Break, Blocked
Arriving   -> Walking, Idle
Walking    -> Idle, Meeting, Blocked
Researching -> Idle, Walking, Blocked, Break
Programming -> Idle, Walking, Blocked, Break
Reviewing  -> Idle, Walking, Blocked
Meeting    -> Idle, Walking, Blocked
Break      -> Walking, Idle, Departing
Departing  -> Arriving
Blocked    -> Idle (only after blocker resolution)
```

## Sim Time

Sim time is the only time for all game mechanics. Every scheduled event, idle timeout, daily routine, meeting duration, and agent behavior runs on the simulation clock.

- Single `setInterval` advances the sim clock on each tick (1s real-world interval)
- Speed multiplier: at 1x, one tick = 1 sim second; at 10x, one tick = 10 sim seconds
- Pause stops the interval — no sim time advances, no jobs fire, no movement, no sessions
- All subsystems read from `SimClock.now()` — never `Date.now()` for game logic
- `Date.now()` only acceptable for: database `created_at` timestamps, log output, real-world uptime tracking

## Scheduled Jobs

Jobs live in SQLite and survive server restarts.

- On boot: `handleMissedJobsOnBoot()` checks missed jobs — `fire_immediately` jobs execute, `skip_to_next` jobs advance to next recurrence
- On each tick: `processSchedulerTick()` fires due jobs via registered handlers
- If agent is busy when job fires: job queued in `job_queue`, processed when agent transitions to Idle
- Only managers can create scheduled jobs via `schedule_event` MCP tool
- `registerJobHandler(jobType, handler)` to add custom job types (e.g., `meeting`)

## Database

SQLite via better-sqlite3. WAL mode and foreign keys enabled at connection time. Full schema reference in [database.md](database.md).

## Related Docs

- [agents.md](agents.md) — Agent hierarchy, autonomy, communication, sessions, memory
- [api-reference.md](api-reference.md) — REST endpoints, WebSocket events, MCP tools
- [database.md](database.md) — Full table schemas and migrations
- [implementation-log.md](implementation-log.md) — Phase-by-phase build history
