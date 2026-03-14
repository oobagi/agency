# Agent System

How agents think, move, communicate, and work in Agency.

## Hierarchy

There are three tiers of agents:

**Office Manager (OM)** — Singleton with global visibility. Creates projects, teams, hires/fires agents, delegates work. Only agent that can communicate across team boundaries. Runs three autonomous sessions per sim day: morning planning (08:05), midday check (13:05), end-of-day review (17:00).

**Team Managers (TM)** — One per team. Visibility scoped to their own team's agents, tasks, PRs, and worktrees. Sessions triggered by three events: morning desk arrival, team member task completion, team member blocker report. Responsible for assigning tasks, reviewing PRs, scheduling meetings, and monitoring context health of team members.

**Regular Agents** — Individual contributors. Receive tasks from their TM via physical briefing. Walk to desk, write code, open PRs, report completion or blockers. If idle with no tasks for 30 sim minutes, auto-walk to TM desk and check in.

## Daily Schedule

All agents follow a daily schedule created automatically at hire time:

| Sim Time | Event                                                |
| -------- | ---------------------------------------------------- |
| 08:00    | Arrive (state: Arriving -> Walking -> Idle)          |
| 08:05    | OM morning planning session fires                    |
| 12:00    | Lunch break (state: Break)                           |
| 13:00    | Return from lunch (state: Walking -> Idle)           |
| 13:05    | OM midday check session fires                        |
| 17:00    | OM end-of-day review + end-of-day memory compression |
| 17:00    | Depart (state: Departing)                            |

## Physical Communication

This is the core simulation mechanic. There are no shortcuts.

**The rule**: Agent A cannot communicate with Agent B without first physically walking to Agent B's location. The `speak` MCP tool enforces proximity detection on every call — only agents within 2.5 units hear the message. Calls that violate proximity are rejected.

**The flow**:

1. Agent A calls `walk_to_agent` targeting Agent B
2. Movement system moves Agent A along a path to Agent B
3. On arrival, Agent A calls `speak`
4. Only agents within proximity radius receive the message
5. Message recorded in `chat_logs` and `conversations` tables

**Convenience**: `send_to_manager` auto-walks to the agent's TM, then delivers the message on arrival. Still enforces physical movement.

**Meetings**: `schedule_event` with `job_type: "meeting"` triggers physical arrival gating. All invited participants must physically arrive at the meeting room before the meeting session starts. Post-meeting, all participants walk back to their desks.

**Forbidden patterns**: Event emitters between agent sessions, pub/sub, shared memory stores, any message delivery without physical movement.

## Autonomous Loops

These loops prevent agents from sitting idle:

**OM scheduled loops** — Three recurring jobs (morning, midday, EOD) fire automatically. The OM evaluates all projects, teams, agents, blockers, user messages, and acts autonomously.

**TM triggered loops** — Fire on three events: desk arrival in morning, team member task completion, team member blocker report. TM walks to idle agents, assigns tasks, reviews PRs, schedules meetings, escalates unresolvable issues to OM.

**Regular Agent idle check-in** — If idle with empty task queue for 30 sim minutes, the agent auto-walks to their TM desk and checks in, triggering a TM session.

All loops are driven by sim time exclusively. No real-world timers.

## Session Lifecycle

Every agentic session follows this lifecycle:

1. **Context assembly** — `buildSessionContext()` assembles: persona prompt, current task, last 10 chat logs, top 3 memory chunks (vector similarity search), sim time, role-filtered MCP tools. Bounded to ~100k tokens.
2. **Session spawn** — Via `ProviderManager` which reads default provider/model from settings and per-agent overrides. Wrapped in `SessionRecorder` for DB recording and WebSocket broadcast.
3. **Tool execution** — Agent calls MCP tools. Each call validated (state machine, permissions, proximity). Tool calls recorded in `session_tool_calls`.
4. **Monitoring** — Context monitor tracks token count. At 80%, alerts TM. At 95%, force-compresses.
5. **Completion** — Session ends with outcome: completed, interrupted, errored, or hung.

**Daily reset**: Each sim day starts fresh. No raw history carries over. Previous day's activity is available only as compressed memory summaries.

## Memory System

**Compression**: At task completion and end of sim day, a compression job generates a natural language summary of the agent's activity via `lightweightQuery` (haiku model), embeds it using @huggingface/transformers (384-dim vectors), and stores in `agent_memory` + `vss_agent_memory` for vector search.

**Retrieval**: `buildSessionContext()` queries sqlite-vss for the top 3 memory chunks most similar to the current task description. Falls back to recency-based retrieval when no task context is available or vss is unavailable.

**What's included in context**: Persona prompt, current task, last 10 chat logs, top 3 memory chunks, sim time, MCP tools.

**What's excluded**: Full chat history, complete PR diffs, other agents' memory, out-of-team project info (for non-managers).

## Context Window Management

The context monitor tracks estimated tokens per active session:

| Threshold | Action                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------- |
| 80%       | Alert TM via `triggerTMBlockerReport` — TM can use `trigger_compression` or `checkpoint_agent` |
| 95%       | Force-trigger compression automatically, interrupt session                                     |

Context overflow never causes a silent failure.

## Interruption and Hung Detection

**User interruption**: Stop button in SidePanel calls `POST /api/sessions/:id/interrupt`. Server aborts the session, transitions agent to Idle, records outcome as `interrupted`.

**Hung detection**: If a session runs for 30 sim minutes without completing a tool call, the hung detector auto-interrupts with outcome `hung`, transitions agent to Blocked, creates a blocker record, and escalates to TM.

## Blocker Escalation Chain

```
Agent reports blocker
  -> Agent state: Blocked
  -> Blocker record created
  -> TM notified (triggerTMBlockerReport)
    -> TM attempts resolution via tools
    -> If unresolvable: TM escalates to OM (escalate_to_om)
      -> OM attempts resolution
      -> If unresolvable: OM marks as user-facing (mark_blocker_user_facing)
        -> WebSocket broadcast to UI
        -> User resolves via POST /api/blockers/:id/resolve
          -> Agent state: Blocked -> Idle
```

Blocker records include full escalation history as JSON with role, agent_id, sim_time, action, and notes for each step.

## Persona System

Personas are fetched from the [agency-agents](https://github.com/msitarzewski/agency-agents) GitHub repo. Each persona has: name, bio, system prompt, and specialties (frontend, backend, devops, testing, design, architecture).

Persona IDs are SHA-256 hashes of the file path (not human-readable slugs). The OM's context includes actual persona IDs for use with `hire_agent`.

The OM has a built-in persona (not from the repo). When the OM hires an agent, the persona's system prompt becomes the foundation of that agent's context in every session.

## Providers

Two agentic providers are supported:

**Claude Agent SDK** (`ClaudeAgentSdkProvider`) — Wraps `@anthropic-ai/claude-agent-sdk` `query()`. Uses in-process MCP server per session (not HTTP transport). Auth via Claude Code CLI.

**OpenAI Codex** (`CodexProvider`) — Placeholder implementation. Auth via Codex CLI.

Neither requires API keys in the app. The `ProviderManager` reads `default_provider` and `default_model` from settings, with per-agent `provider_override` and `model_override` fields.

For lightweight calls (summaries, briefings): `lightweightQuery()` with haiku, maxTurns 1, no tools, no persistence.
