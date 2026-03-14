Agency Implementation Notes

This file is a running log for implementing agents. When you complete a phase, fill in the fields under that phase's section before handing off. Do not delete any section. If you skip or defer something, say so and say why.

Completed phases (1.0 through 4.5) have been moved to @NOTES_COMPLETED.md. Read that file for full implementation details of prior work.

Key facts from completed phases:

- All completed on 2026-03-13
- 16 of 26 MCP tools have real handlers (2 new tools added: create_task, complete_task)
- Agent SDK uses Zod v3 internally; tool registry uses Zod v4 — bridged via buildZod3Shape() in claude-agent-sdk.ts
- Movement render loop runs at 60Hz real-time (decoupled from sim clock) for smooth animation
- OM sessions fire at 08:05, 13:05, 17:00 (5 min after arrive/return to ensure OM has arrived first)
- Persona IDs are SHA-256 hashes (not human-readable slugs) — OM context includes actual IDs
- Vector similarity search for memory is stubbed — plain recency-based retrieval until Phase 5.0
- startWalking() exported from movement.ts with optional onArrival callback
- speak rejects if no agents within proximity; send_to_manager auto-walks then delivers
- Task lifecycle: pending → in_progress → completed or blocked
- complete_task fires triggerTMTaskComplete; report_blocker fires triggerTMBlockerReport

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
