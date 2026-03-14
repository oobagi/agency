Agency Implementation Phases

This document defines every phase of the Agency build in granular micro-phases numbered X.Y. Phases are ordered so that LLM integration and agent orchestration come before simulation rendering. Read DESIGN_DOC.md in full before starting any phase.

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
