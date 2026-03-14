# Database Schema

SQLite via better-sqlite3. Single file (`agency.db`). WAL mode and foreign keys enabled at connection time.

Configurable via `AGENCY_DB_PATH` env var (defaults to `agency.db` in cwd).

## Tables

### agents

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| name | text | Display name |
| role | text | `office_manager`, `team_manager`, or `agent` |
| persona | text | Full persona system prompt |
| team_id | text? | FK -> teams |
| desk_id | text? | FK -> desks |
| provider_override | text? | Per-agent provider override |
| model_override | text? | Per-agent model override |
| state | text | Current state machine state |
| position_x | real | World position X |
| position_y | real | World position Y |
| position_z | real | World position Z |
| hired_at | text | Sim datetime |
| fired_at | text? | Sim datetime (null = active) |
| created_at | text | Real datetime |
| updated_at | text | Real datetime |

### personas

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | SHA-256 hash of source path |
| name | text | Persona name |
| github_username | text | Filename slug |
| bio | text | Short bio |
| system_prompt | text | Full system prompt (markdown body) |
| specialties | text | JSON array of specialties |
| fetched_at | text | When fetched |
| source_url | text | Source repo/path |

### teams

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| name | text | Team name |
| color | text | Hex color for viewport |
| project_id | text? | FK -> projects |
| manager_id | text? | FK -> agents |
| created_at | text | |

### projects

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| name | text | Project name |
| description | text | Project description |
| repo_path | text | Absolute path to Git repo |
| default_branch | text | Default: `main` |
| created_at | text | |
| updated_at | text | |

### worktrees

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| project_id | text | FK -> projects |
| team_id | text | FK -> teams |
| branch_name | text | Git branch name |
| worktree_path | text | Absolute path on disk |
| created_at | text | |

### tasks

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| title | text | Task title |
| description | text | Task description |
| agent_id | text? | FK -> agents (assignee) |
| team_id | text | FK -> teams |
| project_id | text | FK -> projects |
| status | text | `pending`, `in_progress`, `completed`, `blocked` |
| priority | integer | |
| created_at | text | |
| started_at | text? | |
| completed_at | text? | |

### pull_requests

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| project_id | text | FK -> projects |
| worktree_id | text | FK -> worktrees |
| agent_id | text | FK -> agents (author) |
| title | text | |
| description | text | |
| source_branch | text | |
| target_branch | text | |
| status | text | `open`, `approved`, `merged`, `rejected` |
| reviewer_id | text? | FK -> agents (TM reviewer) |
| reviewed_at | text? | |
| merged_at | text? | |
| created_at | text | |

### agent_memory

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| agent_id | text | FK -> agents |
| sim_day | text | Sim date (YYYY-MM-DD) |
| content | text | Summary text |
| embedding | blob | 384-dim vector |
| created_at | text | |

### chat_logs

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| agent_id | text | FK -> agents |
| speaker_id | text? | Agent or user who spoke |
| speaker_type | text | `agent`, `user`, `system` |
| message | text | |
| sim_time | text | |
| created_at | text | |

### conversations

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| type | text | `one_on_one`, `meeting`, `standup`, `briefing`, `user_interaction` |
| location | text | |
| sim_time_start | text | |
| sim_time_end | text? | |
| created_at | text | |

### conversation_participants

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| conversation_id | text | FK -> conversations |
| agent_id | text | FK -> agents |
| role | text | `speaker`, `listener`, `facilitator` |

### conversation_messages

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| conversation_id | text | FK -> conversations |
| speaker_id | text | |
| speaker_type | text | `agent`, `user` |
| message | text | |
| sim_time | text | |
| created_at | text | |

### sessions

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| agent_id | text | FK -> agents |
| sim_day | text | |
| provider | text | |
| model | text | |
| started_at | text | Sim time |
| ended_at | text? | Sim time |
| outcome | text? | `completed`, `interrupted`, `errored`, `hung` |
| token_estimate | integer? | |
| created_at | text | |

### session_tool_calls

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID or tool use ID |
| session_id | text | FK -> sessions |
| tool_name | text | |
| arguments | text | JSON |
| result | text | JSON |
| status | text | `pending`, `completed`, `errored` |
| sim_time | text | |
| created_at | text | |

### scheduled_jobs

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| agent_id | text | FK -> agents |
| job_type | text | e.g. `arrive`, `morning_planning`, `meeting` |
| sim_time | text | Next fire time |
| recurrence | text? | e.g. `daily` |
| missed_policy | text | `fire_immediately` or `skip_to_next` |
| payload | text | JSON |
| created_at | text | |

### job_queue

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| agent_id | text | FK -> agents |
| job_type | text | |
| payload | text | JSON |
| status | text | `pending`, `processing`, `completed`, `failed` |
| queued_at | text | Sim time |
| started_at | text? | |
| completed_at | text? | |

### blockers

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| agent_id | text | FK -> agents |
| task_id | text? | FK -> tasks |
| description | text | |
| status | text | `open`, `escalated_to_tm`, `escalated_to_om`, `user_facing`, `resolved` |
| resolution | text? | |
| escalation_history | text | JSON array of escalation entries |
| created_at | text | |
| resolved_at | text? | |

### desks

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | |
| position_x | real | |
| position_y | real | |
| position_z | real | |
| agent_id | text? | FK -> agents |
| team_id | text? | FK -> teams |

### meeting_rooms

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | |
| name | text | e.g. Alpha Room, Beta Room, Gamma Room |
| position_x | real | |
| position_y | real | |
| position_z | real | |
| capacity | integer | |

### office_layout

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | |
| type | text | `wall`, `door`, `floor`, `decoration` |
| position_x | real | |
| position_y | real | |
| position_z | real | |
| width | real | |
| height | real | |
| depth | real | |
| metadata | text? | JSON |

### settings

| Column | Type | Description |
|--------|------|-------------|
| key | text PK | e.g. `default_provider`, `sim_time`, `sim_speed` |
| value | text | JSON |

### migrations

| Column | Type | Description |
|--------|------|-------------|
| id | integer PK | |
| name | text | Migration name |
| applied_at | text | |

## Migrations

| # | Name | What it does |
|---|------|-------------|
| 001 | initial_schema | Creates all 21 base tables, seeds settings |
| 002 | vss_memory | Creates `vss_agent_memory` virtual table for vector search |
| 003 | blockers | Creates `blockers` table |
| 004 | seed_meeting_rooms | Seeds Alpha, Beta, Gamma meeting rooms |
| 005 | seed_office_layout | Seeds floor, outer walls, and meeting room walls |
