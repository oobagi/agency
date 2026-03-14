Agency Implementation Notes

This file is a running log for implementing agents. When you complete a phase, fill in the fields under that phase's section before handing off. Do not delete any section. If you skip or defer something, say so and say why.

Completed phases have been moved to @NOTES_COMPLETED.md. Read that file for full implementation details of prior work.

Key facts from completed phases:

- All completed on 2026-03-13
- 28 of 29 MCP tools have real handlers (only checkpoint_agent remains as a stub)
- Agent SDK uses Zod v3 internally; tool registry uses Zod v4 — bridged via buildZod3Shape() in claude-agent-sdk.ts
- Movement render loop runs at 60Hz real-time (decoupled from sim clock) for smooth animation
- OM sessions fire at 08:05, 13:05, 17:00 (5 min after arrive/return to ensure OM has arrived first)
- Persona IDs are SHA-256 hashes (not human-readable slugs) — OM context includes actual IDs
- Memory compression uses @huggingface/transformers (384-dim embeddings) + sqlite-vss for vector search
- buildSessionContext is now async and uses vector similarity search for memory injection
- Context monitor tracks estimated tokens per session; alerts TM at 80%, force-compresses at 95%
- Blockers table tracks escalation chain: agent → TM → OM → user with full history
- resolve_blocker, escalate_to_om, mark_blocker_user_facing MCP tools for managers
- Hung session detector auto-interrupts after 30 sim minutes without tool call, transitions to Blocked
- User-facing blockers broadcast via WebSocket; REST endpoint POST /api/blockers/:id/resolve for user resolution
- startWalking() exported from movement.ts with optional onArrival callback
- retargetWalking() can redirect a walking agent to a new destination without state transition
- speak rejects if no agents within proximity; send_to_manager auto-walks then delivers
- Task lifecycle: pending → in_progress → completed or blocked
- Git operations use simple-git; create_project inits real repos, merge_pull_request does real merges
- Hard constraint 7 enforced: agents cannot review or merge their own PRs
- Meeting system: schedule_event with job_type "meeting" triggers physical arrival gating
- Meeting rooms seeded via migration 004 (Alpha Room, Beta Room, Gamma Room)
- SessionRecorder.onComplete() callback fires when session ends (used by meeting system)
- TM persona includes meeting scheduling instructions and meeting room list in context
- 3D viewport: React Three Fiber + Drei, OrbitControls, floor/walls/desks/meeting rooms
- useWebSocket hook with subscribe pattern for real-time events
- HUD overlay with sim time, Play/Pause, speed selector (1x/2x/5x/10x)
- GET /api/office/layout returns layout + meetingRooms + desks with team colors
- Agent capsules rendered with team colors, smooth lerp interpolation, idle bobbing
- useAgents hook tracks positions via WebSocket, fetches initial state via REST
- Activity icons (laptop, checkmark, outbox, magnifier) appear above capsules for 3s on tool calls
- Blocked agents show red exclamation mark; OM is neutral gray
- SidePanel: click agent to open right panel with Chat Log, Sessions, Details tabs
- Chat Log tab has send input; Sessions tab shows tool calls and live updates; Stop button interrupts
- onPointerMissed on Canvas closes the panel; selected capsule glows with emissive
- Chat bubbles appear above agents on speak events, truncated to 80 chars, full on hover
- Bubbles fade out after 6s with opacity transition, one bubble per agent at a time
- ConversationsPanel: left-side 420px panel, toggled from HUD button
- GET /api/conversations supports search, type, participant, limit, offset query params; returns { conversations, total }
- conversation_new WebSocket event broadcasts new conversations with conversationType, participant_names, first_message
- Integration tests use dynamic imports to set AGENCY_DB_PATH before db module loads
- DiffViewerPanel: left-side 520px panel, toggled from HUD "Projects" button
- GET /api/worktrees/:id/diff and GET /api/worktrees/:id/commits endpoints
- Left-side panels (Conversations, Projects, Schedule) are mutually exclusive via LeftPanel union type
- SchedulePanel: tabbed with Schedule (timeline) and Activity Log (real-time feed)
- Activity broadcast: setActivityBroadcast/broadcastActivity in state-machine.ts; fires on state transitions, session events, blocker escalations
- WebSocket 'activity' event: { category, agentId, agentName, description, simTime }
- BlockedAgentModal: centered overlay modal shown when clicking a blocked agent, alongside SidePanel
- Blocker resolution via POST /api/blockers/:id/resolve transitions agent Blocked → Idle

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
