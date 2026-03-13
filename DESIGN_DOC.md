Agency Design Document

This document is the authoritative specification for the Agency project. Every implementing agent must read this entire document before writing any code. If a decision conflicts with what is written here, this document wins.

HARD CONSTRAINTS

These eight rules are non-negotiable. Any code that violates any of them is wrong and must be changed immediately.

1. No API key inputs anywhere in the application. Authentication for agentic providers is handled entirely by their own local CLI auth flows. There is no settings screen for keys. There is no environment variable prompt for keys. If you are writing code that accepts a key string from a user, stop.

2. Agency's codebase never reads from or writes to the external project repositories that agents are building. Those are entirely separate Git repos on disk. Agency only tracks metadata about them: paths, branch names, PR status, commit hashes, worktree locations. The actual source code in those repos is none of Agency's business.

3. Physical presence is required for all agent communication and all work. Agents do not broadcast messages. There is no pub/sub between agents. There is no shared event bus for inter-agent messaging. If Agent A needs to tell Agent B something, Agent A physically walks to Agent B's location in the simulation. Meetings do not begin until every invited participant has physically arrived at the meeting room. Coding does not begin until the agent has walked to their desk and is registered as seated. This is the core mechanic of the entire product. Do not shortcut it.

4. Managers run autonomous decision loops on a sim-time schedule. They do not wait for user input. The user does not drive the simulation. The Office Manager wakes up at scheduled sim times, evaluates the state of all projects, teams, agents, and blockers, and acts. Team Managers do the same within their team scope.

5. Failures escalate through the agent hierarchy before reaching the user. The escalation chain is: Agent → Team Manager → Office Manager → User. The user is only contacted for true unresolvable blockers such as missing CLI auth for an external service or missing system permissions. Everything else is resolved internally by the management chain.

6. Freshly hired agents know nothing. They have their persona and nothing else. No project context, no codebase access, no knowledge of other agents or teams. Knowledge is transferred only through direct physical interaction with a Manager in the simulation. A newly hired agent must be briefed by their Team Manager before they can do meaningful work.

7. Agents never merge their own work and never merge directly to main. All work goes through a Pull Request. The Team Manager reviews and approves PRs. The merge is performed by the Team Manager, not the authoring agent.

8. The UI is a 3D simulation viewport. There is no global text input or command bar. The user interacts only by clicking agents in the viewport. Clicking an agent opens a side panel with that agent's information and a text input to message that specific agent.

PRODUCT VISION

Agency is a persistent background server application that simulates a living software development office populated by autonomous AI agents. The user starts it from the command line and it runs continuously in the background. The user opens http://localhost:PORT in a browser to observe and interact with the simulation. Closing the browser does not pause or stop anything. The server keeps running, agents keep working, and the sim clock keeps ticking.

The office is populated by AI agents who physically walk around, sit at desks, attend meetings, write code in external Git repositories, open pull requests, and manage teams, entirely without user direction. The user's only job is to give a high-level goal to the Office Manager agent and then watch the simulation unfold. The user never writes code. The user never instructs individual agents directly unless they choose to click one and open a conversation.

This is a simulation first. It is not a chat interface. It is not a code editor. It is not an IDE.

AGENT HIERARCHY AND AUTONOMY MODEL

There are three tiers of agents: the Office Manager, Team Managers, and Regular Agents.

The Office Manager is a singleton. There is exactly one per simulation. The Office Manager has global visibility across all projects, all teams, and all agents. The Office Manager autonomously creates projects (which are new external Git repos initialized on disk), creates teams, assigns teams to projects, hires agents, fires agents, and delegates work. The Office Manager is the only agent who can communicate across team boundaries. If two teams need to coordinate, the Office Manager brokers an inter-team meeting by physically walking between teams. The Office Manager runs three scheduled sessions per sim day: a morning planning loop at 08:00, a midday progress check at 13:00, and an end-of-day review at 17:00. These fire automatically via the scheduled jobs system.

Team Managers each lead one team. They have visibility over their own team's agents, tasks, PRs, and worktrees. They do not see other teams' state. Team Managers run evaluation sessions on three triggers: when they arrive at their desk in the morning, when any team member completes a task, and when any team member reports a blocker. During a session, a Team Manager assigns tasks to idle agents by physically walking to them, reviews and merges PRs, schedules team meetings, and escalates anything they cannot resolve to the Office Manager by physically walking to the Office Manager's desk. Team Managers are also responsible for monitoring context health of their team members, described in the context window management section below.

Regular Agents are individual contributors. They receive tasks from their Team Manager via physical briefing. They walk to their desk, write code, open PRs, and report completion or blockers to their Team Manager. If a Regular Agent has been idle with no queued tasks for 30 sim minutes, they must walk to their Team Manager's desk and check in, which triggers a Team Manager evaluation session.

All agents follow a daily schedule auto-created at hire time: arrive at 08:00 sim time, lunch break at 12:00, return at 13:00, depart at 17:00.

PHYSICAL COMMUNICATION RULES

This section exists because the previous implementation broke this rule repeatedly. Read it carefully.

Forbidden patterns: event emitters that deliver messages between agent sessions without physical movement, pub/sub message queues between agents, any mechanism that delivers a message to an agent without the sending agent first walking to the receiving agent's physical location in the simulation, WebSocket messages that bypass the walk requirement, shared memory stores that agents read to communicate.

Required patterns: every speak MCP tool call includes proximity detection so that only agents within a defined radius receive the message. The walk_to_agent tool physically moves an agent across the office grid before communication can occur. Meeting rooms check that all invited participant positions match the meeting room location before allowing the meeting session to begin. The World Server validates on every speak call that the speaker and all intended recipients are within proximity range. Speak calls that violate proximity are rejected.

When Agent A needs to communicate with Agent B: Agent A calls walk_to_agent targeting Agent B, the World Server moves Agent A along a path to Agent B's current location, once Agent A arrives and proximity is confirmed, Agent A calls speak, only agents within proximity radius hear the message. There are no exceptions to this flow.

USER INTERACTION MODEL

The user sees a 3D office simulation in their browser. There is no global text input anywhere on screen. There is no command bar. The user's interaction points are:

Clicking an agent in the 3D viewport opens a side panel on the right. The panel displays the agent's name, role, current state, current task, and a tabbed interface with Chat Log, Sessions, and Agent Details tabs. The Chat Log tab shows the full conversation history for that agent including user messages, agent speak outputs, and manager briefings. A text input at the bottom lets the user message that specific agent. Messages are stored in the database and injected into the agent's context on their next session. Agents respond via the speak MCP tool.

The Sessions tab lists all past sessions for that agent grouped by sim day. Each session is expandable to show the full tool call sequence. Each tool call is rendered as a distinct UI element showing the tool name, arguments passed, and result returned. Active tool calls show a loading animation while in progress. For an active session, the panel shows a live feed of tool calls in real time via WebSocket. A Stop button is visible during active sessions, allowing the user to interrupt the agent at any time.

When an agent enters the Blocked state, a visual exclamation mark appears above their 3D capsule in the viewport. Clicking a blocked agent opens a modal with a plain-language failure description, the escalation chain that was attempted, and a guided step-by-step resolution walkthrough. Once the user resolves the external issue, the agent automatically resumes.

Sim time controls are always visible in the UI, never buried in settings. Required controls: Play, Pause, and a speed multiplier selector offering 1x, 2x, 5x, and 10x. Pausing freezes the sim clock and all agent activity. No sessions spawn, no jobs fire, no movement updates. Resuming picks up exactly where it left off. The speed multiplier adjusts how much sim time advances per real-world tick.

AGENTIC PROVIDERS

The system supports two agentic providers: the Claude Agent SDK and the OpenAI Codex API. These are agentic tool-executing environments, not chat completion APIs. Neither requires an API key entered in the UI. Authentication is handled by their respective CLI tools: the Claude Code CLI for the Agent SDK, and the Codex CLI for the OpenAI provider.

The user configures a default provider and a default model in application settings stored in the database. Individual agents can optionally override both the provider and the model at the agent record level. A user does not need both providers configured. The system must function fully with only one.

The provider abstraction layer exposes a single interface to the rest of the system regardless of which provider is running underneath. The interface is: spawn a session with a system prompt, assembled context, and an MCP tool list; receive tool calls as the session executes; receive the session completion result. The World Server never calls provider-specific APIs directly. It always goes through the abstraction layer.

For the Claude Agent SDK specifically, all LLM calls must use the Agent SDK query() function. The raw Anthropic SDK is never used directly. For lightweight calls such as summaries or morning briefings, use query() with model haiku, maxTurns 1, allowedTools empty, persistSession false. For full agent task execution, use the provider abstraction which wraps query() with tool support and session management.

THE MCP SERVER

The World Server runs an internal MCP (Model Context Protocol) server. This is the only way agents interact with the simulated world. All agentic sessions connect to this MCP server and call tools from it. Agents do not call any internal REST API directly. The MCP server is the single gateway between agent intelligence and world state.

Movement tools: walk_to_desk moves the agent to their assigned desk, walk_to_agent moves the agent to another agent's current location, walk_to_meeting_room moves the agent to a specified meeting room, walk_to_exit moves the agent toward the office exit for departure. All movement tools initiate pathfinding and return immediately. The agent's state transitions to Walking. Arrival triggers a state callback.

Communication tools: speak emits a message that is received only by agents within proximity radius of the speaker. The World Server validates proximity on every call. send_to_manager is a convenience tool that first triggers walk_to_agent targeting the agent's Team Manager and then, upon arrival, delivers the message. This exists to make the physical-walk-then-speak pattern ergonomic but it still enforces physical movement.

Work execution tools: begin_task marks the agent as starting a task, validates the agent is seated at their desk, and transitions them to Programming or Researching state. commit_work records a commit in the agent's worktree. open_pull_request creates a PR record from the agent's branch targeting the team's integration branch.

Manager-only tools (the World Server validates that the calling agent has a Manager role before allowing these): hire_agent creates a new agent record with a persona, fire_agent removes an agent from the simulation, create_team creates a new team with a designated color, assign_agent_to_team moves an agent to a team, create_project initializes a new Git repo on disk and creates a project record, delete_project removes a project, assign_team_to_project links a team to a project, create_worktree creates a Git worktree in a project repo for a team, schedule_event creates a scheduled job for a future sim time, review_pull_request allows a Team Manager to review and approve or reject a PR, merge_pull_request merges an approved PR, trigger_compression forces an early context compression for a specified agent, checkpoint_agent instructs an agent to wrap up and commit current work.

State management tools: set_state transitions the agent's state with validation against the legal transition map, report_blocker sets the agent to Blocked state and begins the escalation chain.

The World Server validates all MCP tool calls. It enforces the state machine transition map. It validates manager permissions. It blocks begin_task unless the agent is seated at their desk. It blocks meeting sessions from starting until all participants are physically present in the meeting room.

AGENT STATE MACHINE

Valid states: Idle, Arriving, Walking, Researching, Programming, Reviewing, Meeting, Break, Departing, Blocked.

Legal transitions (source → allowed destinations):

Idle → Walking, Programming, Researching, Reviewing, Meeting, Departing, Break, Blocked.
Arriving → Walking, Idle.
Walking → Idle, Meeting, Blocked.
Researching → Idle, Walking, Blocked, Break.
Programming → Idle, Walking, Blocked, Break.
Reviewing → Idle, Walking, Blocked.
Meeting → Idle, Walking, Blocked.
Break → Walking, Idle, Departing.
Departing → Arriving (next day re-entry only).
Blocked → Idle (only after blocker resolution).

Key enforcement rules: an agent cannot transition to Programming or Researching unless their current position matches their assigned desk coordinates. The World Server checks position on every set_state call targeting these states. An agent cannot transition to Meeting unless they are physically located in the designated meeting room. Arriving is the initial state when an agent first enters the office at the start of a sim day.

The transition map must be defined as an explicit data structure in code, not as scattered conditional checks. The set_state MCP tool handler indexes into this map and rejects any transition not present.

AUTONOMOUS AGENT LOOPS

This section describes the mandatory behavioral loops that prevent agents from sitting idle. The previous implementation failed because these did not exist.

Office Manager scheduled loops: the World Server creates three recurring scheduled jobs when the Office Manager is initialized. Morning planning at 08:00 sim time: the Office Manager evaluates all projects, all teams, all agents, all blockers, any queued user messages, and then acts autonomously, creating projects, hiring agents, reassigning teams, escalating blockers, or delegating new work. Midday check at 13:00: a lighter evaluation focused on progress, detecting stalled agents and unresolved blockers. End-of-day review at 17:00: summarizes the day's progress, identifies carry-over tasks, queues priorities for the next morning.

Team Manager triggered loops: Team Managers do not run on a fixed schedule. They run sessions in response to three triggers. First: arrival at desk in the morning after the Arriving → Walking → Idle transition completes. Second: any team member completing a task (the World Server detects task completion and triggers the Team Manager). Third: any team member reporting a blocker. During a session, a Team Manager walks to idle agents and assigns tasks, reviews pending PRs, schedules team meetings if needed, and escalates to the Office Manager anything they cannot resolve.

Regular Agent idle check-in: if a Regular Agent remains in Idle state with an empty task queue for 30 sim minutes (measured in sim time, not real time), the World Server automatically triggers the agent to walk to their Team Manager's desk and check in. This check-in triggers a Team Manager session.

All of these loops are driven by sim time exclusively. No real-world timers drive agent behavior.

SIM TIME

Sim time is the only time that matters for all game mechanics. Every scheduled event, job trigger, loop timer, daily schedule, idle timeout, proximity duration, chat bubble display duration, and any other time-based mechanic in the backend uses simulation time exclusively. There are no real-world timers driving agent behavior.

The only real-world timer is a single Node.js setInterval that advances the sim clock on each tick. The tick interval is fixed in real-world milliseconds. The speed multiplier determines how much sim time advances per tick. At 1x speed, one tick advances sim time by one sim second. At 10x, one tick advances sim time by 10 sim seconds. Pausing the simulation stops the tick interval. No sim time advances, no jobs fire, no movement updates, no sessions spawn. Resuming restarts the interval from the exact sim time where it was paused.

All subsystems that need time, including the scheduled jobs runner, the movement system, the idle check-in timer, the hung session detector, and the chat bubble display timer, read from the sim clock. They never call Date.now() or use real-world time for game logic.

SESSION MANAGEMENT AND VISIBILITY

Every agentic session spawned by the World Server is recorded in the database. A session record stores: the agent ID it belongs to, the sim date it was created, the session start sim time, the session end sim time or null if still active, the provider and model used, the full list of tool calls made during the session in chronological order, the input and output of each tool call, the final outcome which is one of completed, interrupted, errored, or hung, and a token count estimate.

Sessions are associated with a specific sim day so the user can browse sessions by day in the Sessions tab of an agent's side panel. Each session is expandable to show all tool calls. Tool calls are rendered as distinct UI elements showing the tool name, arguments, and result. Active sessions stream tool calls in real time via WebSocket.

DAILY SESSION INITIALIZATION

Every agent starts a fresh session each sim day. When an agent arrives at their desk in the morning after their Arriving → Walking → Idle transition completes, the World Server initializes a new session with a clean context window. No raw history from the previous day carries over. Instead, the World Server assembles a morning briefing injected into the session context. The briefing contains: the agent's persona system prompt, a summary of what they completed yesterday retrieved from compressed memory, their current task queue, and for Manager agents, a full team status report including agent states, pending PRs, unresolved blockers, and any overnight changes.

This daily reset prevents context bloat from accumulating across multiple sim days and ensures agents start each day focused.

CONTEXT WINDOW MANAGEMENT

The World Server tracks an estimated token count for each active agent session. When a session approaches a configured threshold, defined as 80% of the model's context limit, the World Server notifies the agent's Team Manager.

The Team Manager has two MCP tools for handling this: trigger_compression forces an early compression and session refresh for the flagged agent, summarizing current progress into memory and starting a new session with compressed context. checkpoint_agent walks to the agent and instructs them to wrap up their current subtask and commit before the context limit is hit.

Context overflow must never cause a silent failure. It is always caught and handled before it becomes a problem. The World Server logs a warning at 70% utilization and escalates to the Team Manager at 80%. If somehow a session reaches 95% without intervention, the World Server force-triggers compression automatically as a safety net.

AGENT INTERRUPTION

The user can interrupt any active agent session at any time via the Stop button in the agent's side panel. Pressing Stop sends an interrupt signal to the World Server. The World Server gracefully terminates the active agentic SDK session, commits any partial work in the agent's worktree with an auto-generated interrupt commit message, sets the agent's state to Idle, and logs the interruption in the session record with outcome set to interrupted. The agent does not re-initialize automatically after an interrupt. They wait for their next task assignment or for the user or manager to direct them.

The World Server also detects hung sessions. If an agent session has been running for a configurable duration in sim time without completing a tool call, the World Server automatically interrupts the session, logs it with outcome hung, and sets the agent to Blocked state so the escalation chain handles it. The hung session timeout is configurable and defaults to 30 sim minutes.

MEMORY AND TOKEN MANAGEMENT

Session context is assembled by the World Server and bounded strictly. A session context includes: the agent's persona system prompt, the current task description and acceptance criteria, the last 10 chat log entries for that agent, the top 3 memory chunks retrieved via vector similarity search against the current task description, the current sim time, and the list of available MCP tools with descriptions.

A session context never includes: full raw chat history beyond the last 10 entries, complete PR diffs (only summaries), other agents' memory or chat logs, out-of-team project information for non-Manager agents.

At task completion and at end of sim day, a compression job runs. The compression job takes the agent's recent activity, generates a natural language summary, embeds the summary using @xenova/transformers running locally, and stores the embedding in sqlite-vss for future vector similarity retrieval. Raw chat logs are retained in the database for the UI but are not re-injected into future session contexts. Only compressed memory summaries are injected.

DATABASE

SQLite via better-sqlite3. Single file. The database stores all simulation state.

Table: agents. Fields: id (text, primary key), name (text), role (text, one of office_manager, team_manager, agent), persona (text, the full persona prompt), team_id (text, nullable, foreign key to teams), desk_id (text, nullable, foreign key to desks), provider_override (text, nullable), model_override (text, nullable), state (text, current state machine state), position_x (real), position_y (real), position_z (real), hired_at (text, sim datetime), fired_at (text, nullable, sim datetime), created_at (text), updated_at (text).

Table: personas. Fields: id (text, primary key), name (text), github_username (text), bio (text), system_prompt (text), specialties (text, JSON array), fetched_at (text), source_url (text).

Table: teams. Fields: id (text, primary key), name (text), color (text, hex color code for team identification in viewport), project_id (text, nullable, foreign key to projects), manager_id (text, nullable, foreign key to agents), created_at (text).

Table: projects. Fields: id (text, primary key), name (text), description (text), repo_path (text, absolute path on disk to the Git repo), default_branch (text, defaults to main), created_at (text), updated_at (text).

Table: worktrees. Fields: id (text, primary key), project_id (text, foreign key to projects), team_id (text, foreign key to teams), branch_name (text), worktree_path (text, absolute path on disk), created_at (text).

Table: tasks. Fields: id (text, primary key), title (text), description (text), agent_id (text, nullable, foreign key to agents), team_id (text, foreign key to teams), project_id (text, foreign key to projects), status (text, one of pending, in_progress, completed, blocked), priority (integer), created_at (text), started_at (text, nullable), completed_at (text, nullable).

Table: pull_requests. Fields: id (text, primary key), project_id (text, foreign key to projects), worktree_id (text, foreign key to worktrees), agent_id (text, foreign key to agents, the author), title (text), description (text), source_branch (text), target_branch (text), status (text, one of open, approved, merged, rejected), reviewer_id (text, nullable, foreign key to agents, the Team Manager), reviewed_at (text, nullable), merged_at (text, nullable), created_at (text).

Table: agent_memory. Fields: id (text, primary key), agent_id (text, foreign key to agents), sim_day (text), content (text, the summary text), embedding (blob, the vector embedding), created_at (text).

Table: chat_logs. Fields: id (text, primary key), agent_id (text, foreign key to agents), speaker_id (text, nullable, the agent or user who spoke), speaker_type (text, one of agent, user, system), message (text), sim_time (text), created_at (text).

Table: conversations. Fields: id (text, primary key), type (text, one of one_on_one, meeting, standup, briefing, user_interaction), location (text), sim_time_start (text), sim_time_end (text, nullable), created_at (text).

Table: conversation_participants. Fields: id (text, primary key), conversation_id (text, foreign key to conversations), agent_id (text, foreign key to agents), role (text, one of speaker, listener, facilitator).

Table: conversation_messages. Fields: id (text, primary key), conversation_id (text, foreign key to conversations), speaker_id (text), speaker_type (text, one of agent, user), message (text), sim_time (text), created_at (text).

Table: sessions. Fields: id (text, primary key), agent_id (text, foreign key to agents), sim_day (text), provider (text), model (text), started_at (text, sim time), ended_at (text, nullable, sim time), outcome (text, nullable, one of completed, interrupted, errored, hung), token_estimate (integer, nullable), created_at (text).

Table: session_tool_calls. Fields: id (text, primary key), session_id (text, foreign key to sessions), tool_name (text), arguments (text, JSON), result (text, JSON), status (text, one of pending, completed, errored), sim_time (text), created_at (text).

Table: scheduled_jobs. Fields: id (text, primary key), agent_id (text, foreign key to agents), job_type (text), sim_time (text, the next scheduled fire time), recurrence (text, nullable, cron-like pattern in sim time), missed_policy (text, one of fire_immediately or skip_to_next), payload (text, JSON), created_at (text).

Table: job_queue. Fields: id (text, primary key), agent_id (text, foreign key to agents), job_type (text), payload (text, JSON), status (text, one of pending, processing, completed, failed), queued_at (text, sim time), started_at (text, nullable), completed_at (text, nullable).

Table: desks. Fields: id (text, primary key), position_x (real), position_y (real), position_z (real), agent_id (text, nullable, foreign key to agents), team_id (text, nullable, foreign key to teams).

Table: meeting_rooms. Fields: id (text, primary key), name (text), position_x (real), position_y (real), position_z (real), capacity (integer).

Table: office_layout. Fields: id (text, primary key), type (text, one of wall, door, floor, decoration), position_x (real), position_y (real), position_z (real), width (real), height (real), depth (real), metadata (text, JSON nullable).

Table: settings. Fields: key (text, primary key), value (text, JSON).

Table: migrations. Fields: id (integer, primary key), name (text), applied_at (text).

SCHEDULED JOBS SYSTEM

Scheduled jobs live in SQLite and survive server restarts. On boot, the World Server scans the scheduled_jobs table for any jobs whose sim_time has passed. For each missed job, it checks the missed_policy: fire_immediately means the job is executed immediately upon boot, skip_to_next means the job's sim_time is advanced to its next recurrence and the missed instance is discarded.

When a scheduled job fires and the target agent is currently busy (not in Idle state), the job is placed into the job_queue table with status pending. The World Server checks the queue whenever an agent transitions to Idle and processes any pending jobs for that agent.

Only Manager agents can create scheduled jobs via the schedule_event MCP tool. Regular agents cannot schedule anything.

TEAM COLOR CODING

Each team is assigned a distinct hex color when created by the Office Manager. The color is stored in the teams table. Every agent on that team has their 3D capsule rendered in that team's color in the viewport. The Office Manager and any unassigned agents use a neutral gray. The color assignment should draw from a predefined palette of visually distinct colors that remain distinguishable even when multiple teams are present simultaneously. The palette should avoid colors too close to red (reserved for Blocked state indication) or colors too similar to each other.

CONVERSATION HISTORY PANEL

All conversations that occur in the simulation are logged in the conversations, conversation_participants, and conversation_messages tables and accessible from a dedicated Conversations panel in the UI. This includes one-on-one agent interactions, team meetings, group standups, manager briefings, and user-to-agent messages with responses. Each conversation entry shows participants, the sim time it occurred, the conversation type, and the full transcript. The user can browse conversations chronologically and search by participant name, keyword, or conversation type. This panel is separate from the individual agent chat log. The agent chat log shows one agent's messages. The Conversations panel shows all conversations across the entire office.

DIFF VIEWER

A read-only panel in the UI showing the current git diff for a selected worktree branch, the list of recent commits on that branch, open PRs for that worktree, and full PR diffs. No editing capability. No code interaction from Agency's side. The diff viewer reads from the external Git repos on disk using simple-git but never writes to them. Agency tracks metadata only.

PROJECT AND TEAM STRUCTURE

The Office Manager autonomously creates projects, which are new external Git repos initialized on disk via simple-git. Each project gets a record in the projects table with its absolute disk path. The Office Manager creates teams, assigns teams to projects, and creates worktrees for each team in their assigned project repo. Teams are fully isolated: no shared context, no cross-team communication without a physical inter-team meeting brokered by the Office Manager. Team agents can only see their own team's worktree, tasks, and PRs. The Office Manager is the only agent with visibility across all teams and projects.

PERSONA SYSTEM

Agent personas are fetched and curated from the agency-agents GitHub repository. Each persona includes a name, bio, system prompt, and list of specialties. Personas are stored in the personas table after being fetched. When the Office Manager hires an agent, they select or are assigned a persona. The persona's system prompt becomes the foundation of that agent's context in every session. Personas should be diverse in specialties covering frontend, backend, devops, testing, design, and architecture. The fetching mechanism should cache personas locally and refresh periodically.
