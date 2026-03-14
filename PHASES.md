Agency Implementation Phases

This document defines every phase of the Agency build in granular micro-phases numbered X.Y. Phases are ordered so that LLM integration and agent orchestration come before simulation rendering. Read DESIGN_DOC.md in full before starting any phase.

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
