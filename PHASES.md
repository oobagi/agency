Agency Implementation Phases

This document defines every phase of the Agency build in granular micro-phases numbered X.Y. Phases are ordered so that LLM integration and agent orchestration come before simulation rendering. Read DESIGN_DOC.md in full before starting any phase.

Completed Phases (Summary)

Full specs for completed phases are in the git history. See @NOTES_COMPLETED.md for implementation details.

- **Phase 1.0** — Project scaffold: pnpm monorepo, server + client packages, TypeScript strict, ESLint, Prettier.
- **Phase 1.1** — Database: SQLite via better-sqlite3, WAL mode, 21 tables, migration runner, `getDb()` singleton.
- **Phase 2.0** — Sim clock: `SimClock` class, tick loop, REST endpoints, WebSocket broadcasts, persistent sim time.
- **Phase 2.1** — MCP server: 24 tools with Zod v4 schemas, StreamableHTTP transport, permission validation, stub handlers.
- **Phase 2.2** — Personas: 49 personas from agency-agents repo, specialty classification, REST endpoints.
- **Phase 3.0** — Provider abstraction: `AgenticProvider` interface, `ClaudeAgentSdkProvider` (Agent SDK `query()`), `CodexProvider` (placeholder), `ProviderManager`, `lightweightQuery()`.
- **Phase 3.1** — Agent management: `hire_agent`, `fire_agent`, `create_team`, `assign_agent_to_team` real handlers, desk allocation, REST endpoints.
- **Phase 3.2** — Session recording: `SessionRecorder` class, DB persistence, WebSocket broadcasts, interrupt support.
- **Phase 3.3** — Daily schedule: scheduler with `processTick()`, 4 daily jobs per agent, missed job handling, `schedule_event` tool.
- **Phase 4.0** — Office Manager: singleton OM agent, 3 autonomous sessions (08:05, 13:05, 17:00), rich context builder, user message system.
- **Phase 4.1** — Team Manager: 3 triggers (desk arrival, task complete, blocker report), team-scoped context, duplicate session guard.
- **Phase 4.2** — Context assembly: `buildSessionContext()`, idle checker (30 sim-min threshold), role-filtered tools, ~100k token budget.
- **Phase 4.3** — Movement & state machine: `TRANSITION_MAP`, position enforcement, 60Hz decoupled render loop, proximity detection (2.5 units), walk handlers, `set_state`.

Upcoming Phases

Phase 4.4 — Physical Communication Enforcement

Goal: ensure that every communication pathway in the system respects physical presence rules.

Context: depends on Phase 4.3. This phase exists specifically to prevent the most commonly broken rule from DESIGN_DOC.md. Review the physical communication section carefully.

What to build: audit every code path that could deliver a message between agents. The speak tool handler must verify proximity before delivering any message. Add proximity radius as a configurable setting. The send_to_manager tool must first trigger walk_to_agent to the manager's location, wait for arrival, then deliver the message. No message delivery should occur without the sender being within proximity of the recipient. Add a proximity validation middleware to the MCP server that checks proximity for speak and any future tools that involve communication. Log all proximity violations as warnings. Add the conversation recording system: every speak call that successfully delivers a message creates a conversation record (or appends to an existing one if agents are in an ongoing conversation) in the conversations, conversation_participants, and conversation_messages tables.

Out of scope: meeting room communication (Phase 6.0), the Conversations panel UI (UI phases).

Acceptance criteria: speak from an agent not within proximity of the target is rejected with an error. send_to_manager initiates movement before message delivery. No code path exists that delivers a message without proximity check. Every successful speak creates conversation records in the database. A comprehensive test proves that two agents across the office cannot communicate without one walking to the other first.

Handoff: physical communication is now bulletproof. Phase 6.0 will add meeting rooms which are a structured form of physical communication.

Phase 4.5 — Task System

Goal: implement the task lifecycle from creation through assignment, execution, and completion.

Context: depends on Phase 4.1 for Team Manager sessions and Phase 4.3 for state machine. Tasks are created by managers and assigned to agents who must be at their desk to begin work.

What to build: implement the begin_task MCP tool handler. When an agent calls begin_task with a task_id, the handler validates the agent is at their desk (position check), transitions the agent to Programming or Researching state based on the task type, and updates the task status to in_progress. Implement task completion: when an agent's session completes a task, the task status is set to completed, the agent transitions to Idle, and the Team Manager's on_task_complete trigger fires. Implement task creation as part of manager sessions: Team Managers create tasks by interacting with the task system during their sessions. Tasks have a status lifecycle: pending → in_progress → completed or blocked. When an agent calls report_blocker while working on a task, the task status changes to blocked and the escalation chain begins. Add REST endpoints: GET /api/tasks for listing tasks with filters, GET /api/agents/:id/tasks for an agent's task history.

Out of scope: PR creation from completed tasks (Phase 4.6), the full escalation chain UI (Phase 6.2).

Acceptance criteria: begin_task fails if the agent is not at their desk. begin_task transitions the agent to Programming and the task to in_progress. Task completion transitions the agent to Idle and fires the Team Manager trigger. report_blocker on a task sets both agent and task to blocked states. REST endpoints return correct task data.

Handoff: Phase 4.6 adds PR creation as the next step after task completion.

Phase 4.6 — PR System and Git Operations

Goal: implement the pull request workflow and Git operations that agents use to manage code in external repos.

Context: depends on Phase 4.5 for task completion and Phase 3.1 for project and worktree records. Install simple-git. Remember hard constraint 2: Agency tracks metadata only, never reads or writes actual code in external repos. However, agents working through their agentic sessions do interact with the repos via their provider's built-in tools. Agency itself only runs Git metadata commands (branch listing, diff generation, PR status).

What to build: implement the create_project MCP tool handler. When the Office Manager calls it, initialize a new Git repo on disk at a specified path using simple-git, create the project record, and set up the default branch. Implement create_worktree: create a Git worktree in the project repo for a team's branch. Implement commit_work: record a commit entry in the database (the actual commit is made by the agentic session, not by Agency). Implement open_pull_request: create a PR record in the pull_requests table. Implement review_pull_request: allow a Team Manager to approve or reject a PR. Implement merge_pull_request: merge the PR's source branch into the target branch using simple-git and update the PR status to merged. Hard constraint 7: only Team Managers can merge, never the authoring agent. Add REST endpoints: GET /api/projects/:id/prs for listing PRs, GET /api/prs/:id for PR details including diff. The diff endpoint uses simple-git to generate the diff between source and target branches.

Out of scope: the diff viewer UI panel (Phase 7.5), cross-team PRs.

Acceptance criteria: create_project initializes a real Git repo on disk. create_worktree creates a real Git worktree. open_pull_request creates a PR record. review_pull_request updates PR status to approved or rejected. merge_pull_request performs a real Git merge and updates the record. Only agents with manager role can call review and merge tools. REST endpoints return correct PR and diff data.

Handoff: the full agentic workflow is now possible: Office Manager creates project → creates team → hires agents → Team Manager assigns tasks → agent works at desk → agent opens PR → Team Manager reviews and merges.

Phase 5.0 — Memory Compression Pipeline

Goal: implement the memory compression system that summarizes agent activity and stores embeddings for vector retrieval.

Context: depends on Phase 3.2 for session records and Phase 4.2 for context assembly. Install @xenova/transformers for local embeddings and sqlite-vss for vector search.

What to build: implement the compression job. At task completion and at end of sim day (17:00), the World Server runs a compression job for each agent. The job collects the agent's recent chat logs and session summaries from that sim day, generates a natural language summary using a lightweight LLM call (Agent SDK query with model haiku, maxTurns 1, no tools), embeds the summary using @xenova/transformers, and stores the embedding in the agent_memory table. Set up sqlite-vss as a virtual table that indexes the embedding column of agent_memory. Update the buildSessionContext function from Phase 4.2 to perform vector similarity search against the current task description and inject the top 3 matching memory chunks into the session context. Implement the trigger_compression MCP tool that Team Managers can call for early compression when context limits are approaching. Implement the context window monitoring: the World Server tracks estimated token counts for active sessions and notifies the Team Manager at 80% threshold. At 95% threshold, force-trigger compression automatically as a safety net.

Out of scope: the checkpoint_agent flow is a simple walk-and-speak handled by the Team Manager's session, not a separate system.

Acceptance criteria: at end of sim day, each agent's activity is summarized and stored with an embedding. Vector similarity search against a task description returns relevant past memories. buildSessionContext now injects real memory chunks instead of stubs. trigger_compression creates a new summary mid-session. Context monitoring alerts at 80% and force-compresses at 95%.

Handoff: agents now have persistent memory across sim days. The daily session initialization from Phase 3.3 can now inject yesterday's compressed summary into the morning briefing.

Phase 5.1 — Blocker Detection and Escalation Chain

Goal: implement the full escalation chain from agent through managers to user.

Context: depends on Phase 4.1 for Team Manager loops and Phase 4.0 for Office Manager loops. Per DESIGN_DOC.md: Agent → Team Manager → Office Manager → User.

What to build: implement the report_blocker MCP tool fully. When an agent calls report_blocker, the handler sets the agent to Blocked state, records the blocker details in the task or a new blockers column, and triggers the Team Manager. The Team Manager evaluates the blocker during their session. If the Team Manager can resolve it (e.g., reassigning the task, providing guidance), they do so and the agent resumes. If the Team Manager cannot resolve it, they physically walk to the Office Manager and escalate. The Office Manager evaluates and acts. If the Office Manager cannot resolve it (e.g., missing CLI auth, missing system permissions), the blocker is marked as user_facing and a notification is sent to the UI via WebSocket. The notification creates the blocked agent visual indicator (data only at this phase, the UI renders it later). Implement hung session detection: if an agent session runs for a configurable sim-time duration (default 30 sim minutes) without a tool call completing, the World Server auto-interrupts it, sets outcome to hung, and transitions the agent to Blocked.

Out of scope: the blocked agent modal UI (Phase 7.7), visual indicators in 3D (UI phase).

Acceptance criteria: report_blocker transitions agent to Blocked and triggers Team Manager. A blocker the Team Manager can handle is resolved without reaching the Office Manager. A blocker the Team Manager cannot handle is escalated physically to the Office Manager. An unresolvable blocker is surfaced to the user via WebSocket. Hung sessions are detected and the agent is set to Blocked automatically.

Handoff: the full autonomous loop is now operational. Agents work, blockers escalate, managers intervene. Phase 6.0 adds meetings and Phase 7.x adds all UI.

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
