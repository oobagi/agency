# API Reference

All REST endpoints and WebSocket events for the Agency server.

## REST Endpoints

### Health

| Method | Path          | Description                                                                                                   |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health` | Server health check. Returns `{ status, simTime, simPaused, simSpeed, activeAgents, activeSessions, uptime }` |

### Simulation Control

| Method | Path                | Description                                                 |
| ------ | ------------------- | ----------------------------------------------------------- |
| GET    | `/api/sim/status`   | Current sim state: `{ simTime, speed, paused }`             |
| POST   | `/api/sim/pause`    | Pause simulation                                            |
| POST   | `/api/sim/resume`   | Resume simulation                                           |
| POST   | `/api/sim/speed`    | Set speed multiplier. Body: `{ multiplier: number }` (1-10) |
| POST   | `/api/sim/set-time` | Set sim time. Body: `{ simTime: string }` (ISO 8601)        |

### Agents

| Method | Path                             | Description                                             |
| ------ | -------------------------------- | ------------------------------------------------------- |
| GET    | `/api/agents`                    | List all agents with team info                          |
| GET    | `/api/agents/:id`                | Single agent detail                                     |
| GET    | `/api/agents/:id/chat-logs`      | Chat history for an agent                               |
| POST   | `/api/agents/:id/messages`       | Send user message to agent. Body: `{ message: string }` |
| GET    | `/api/agents/:id/sessions`       | All sessions for an agent (with tool call counts)       |
| GET    | `/api/agents/:id/scheduled-jobs` | Scheduled jobs for an agent                             |
| GET    | `/api/agents/:id/tasks`          | Tasks assigned to an agent                              |
| GET    | `/api/agents/:id/blockers`       | Blockers for an agent                                   |

### Teams

| Method | Path                   | Description                      |
| ------ | ---------------------- | -------------------------------- |
| GET    | `/api/teams`           | List all teams with agent counts |
| GET    | `/api/teams/:id`       | Single team detail               |
| GET    | `/api/teams/:id/desks` | Desks for a team                 |

### Sessions

| Method | Path                          | Description                             |
| ------ | ----------------------------- | --------------------------------------- |
| GET    | `/api/sessions/:id`           | Session detail with full tool call list |
| POST   | `/api/sessions/:id/interrupt` | Interrupt an active session             |

### Conversations

| Method | Path                     | Description                                                                                                              |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/conversations`     | List conversations. Query params: `search`, `type`, `participant`, `limit`, `offset`. Returns `{ conversations, total }` |
| GET    | `/api/conversations/:id` | Conversation detail with participants and messages                                                                       |

### Tasks

| Method | Path         | Description                                   |
| ------ | ------------ | --------------------------------------------- |
| GET    | `/api/tasks` | List tasks. Query params: `status`, `team_id` |

### Projects and Git

| Method | Path                          | Description                                      |
| ------ | ----------------------------- | ------------------------------------------------ |
| GET    | `/api/projects`               | List all projects                                |
| GET    | `/api/projects/:id`           | Single project detail                            |
| GET    | `/api/projects/:id/prs`       | Pull requests for a project                      |
| GET    | `/api/projects/:id/worktrees` | Worktrees for a project                          |
| GET    | `/api/worktrees/:id/diff`     | Git diff for a worktree (against default branch) |
| GET    | `/api/worktrees/:id/commits`  | Commit log for a worktree                        |
| GET    | `/api/prs/:id`                | PR detail with diff                              |

### Blockers

| Method | Path                        | Description                                                                          |
| ------ | --------------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/blockers`             | List open blockers                                                                   |
| GET    | `/api/blockers/:id`         | Single blocker detail                                                                |
| POST   | `/api/blockers/:id/resolve` | Resolve a blocker. Body: `{ resolution: string }`. Transitions agent Blocked -> Idle |

### Other

| Method | Path                    | Description                                            |
| ------ | ----------------------- | ------------------------------------------------------ |
| GET    | `/api/personas`         | List all personas                                      |
| POST   | `/api/personas/refresh` | Re-fetch personas from GitHub                          |
| GET    | `/api/office/layout`    | Office layout + meeting rooms + desks with team colors |
| GET    | `/api/desks`            | All desks                                              |
| GET    | `/api/scheduled-jobs`   | All scheduled jobs                                     |
| GET    | `/api/job-queue`        | Job queue                                              |

### MCP

| Method          | Path   | Description                                     |
| --------------- | ------ | ----------------------------------------------- |
| POST/GET/DELETE | `/mcp` | StreamableHTTP MCP transport for agent sessions |

## WebSocket Events

Connect to `/ws` (Vite dev server proxies automatically).

### Server -> Client

| Event Type            | Fields                                                                                       | Description                                                        |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `tick`                | `simTime`, `speed`, `paused`                                                                 | Fired every sim tick                                               |
| `agent_position`      | `agentId`, `x`, `y`, `z`, `state`, `moving`                                                  | Agent position update (60Hz)                                       |
| `speak`               | `agentId`, `agentName`, `message`, `listeners[]`                                             | Agent spoke (for chat bubbles)                                     |
| `session_event`       | `agentId`, `event`                                                                           | Session tool call or completion event (only for subscribed agents) |
| `conversation_new`    | `conversationId`, `conversationType`, `participant_names`, `first_message`, `sim_time_start` | New conversation created                                           |
| `activity`            | `category`, `agentId`, `agentName`, `description`, `simTime`                                 | State transition, session event, or blocker escalation             |
| `blocker_user_facing` | `blockerId`, `agentId`, `description`, ...                                                   | Blocker escalated to user                                          |

### Client -> Server

| Message Type           | Fields    | Description                                   |
| ---------------------- | --------- | --------------------------------------------- |
| `subscribe_sessions`   | `agentId` | Subscribe to live session events for an agent |
| `unsubscribe_sessions` | `agentId` | Unsubscribe from session events               |

## MCP Tools (29 total)

### General Tools (available to all agents)

| Tool                   | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `walk_to_desk`         | Walk to assigned desk                                     |
| `walk_to_agent`        | Walk to another agent's location                          |
| `walk_to_meeting_room` | Walk to a meeting room                                    |
| `walk_to_exit`         | Walk toward office exit                                   |
| `speak`                | Speak to nearby agents (proximity enforced)               |
| `send_to_manager`      | Walk to TM and deliver message                            |
| `begin_task`           | Start working on a task (must be at desk)                 |
| `commit_work`          | Record a commit                                           |
| `open_pull_request`    | Create a PR                                               |
| `complete_task`        | Mark task as completed                                    |
| `set_state`            | Transition agent state (validated against transition map) |
| `report_blocker`       | Report a blocker and enter Blocked state                  |

### Manager-Only Tools

| Tool                       | Description                                  |
| -------------------------- | -------------------------------------------- |
| `hire_agent`               | Create a new agent from a persona            |
| `fire_agent`               | Remove an agent                              |
| `create_team`              | Create a team with a color                   |
| `assign_agent_to_team`     | Move agent to a team and assign desk         |
| `create_project`           | Initialize a new Git repo                    |
| `delete_project`           | Remove a project                             |
| `assign_team_to_project`   | Link team to project                         |
| `create_worktree`          | Create a Git worktree for a team             |
| `create_task`              | Create a task for a team/project             |
| `schedule_event`           | Create a scheduled job (meetings, etc.)      |
| `review_pull_request`      | Approve or reject a PR                       |
| `merge_pull_request`       | Merge an approved PR                         |
| `trigger_compression`      | Force memory compression for an agent        |
| `checkpoint_agent`         | Instruct agent to commit current work (stub) |
| `resolve_blocker`          | Resolve a blocker                            |
| `escalate_to_om`           | Escalate blocker to Office Manager           |
| `mark_blocker_user_facing` | Escalate blocker to user                     |
