import type Database from 'better-sqlite3';

export const name = '001_initial_schema';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('office_manager', 'team_manager', 'agent')),
      persona TEXT NOT NULL,
      team_id TEXT,
      desk_id TEXT,
      provider_override TEXT,
      model_override TEXT,
      state TEXT NOT NULL DEFAULT 'Idle',
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      position_z REAL NOT NULL DEFAULT 0,
      hired_at TEXT NOT NULL,
      fired_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (desk_id) REFERENCES desks(id)
    );

    CREATE TABLE personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      github_username TEXT NOT NULL,
      bio TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      specialties TEXT NOT NULL DEFAULT '[]',
      fetched_at TEXT NOT NULL,
      source_url TEXT NOT NULL
    );

    CREATE TABLE teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      project_id TEXT,
      manager_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (manager_id) REFERENCES agents(id)
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      repo_path TEXT NOT NULL,
      default_branch TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE worktrees (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      agent_id TEXT,
      team_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked')),
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE pull_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_branch TEXT NOT NULL,
      target_branch TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'merged', 'rejected')),
      reviewer_id TEXT,
      reviewed_at TEXT,
      merged_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (reviewer_id) REFERENCES agents(id)
    );

    CREATE TABLE agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      sim_day TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE chat_logs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      speaker_id TEXT,
      speaker_type TEXT NOT NULL CHECK (speaker_type IN ('agent', 'user', 'system')),
      message TEXT NOT NULL,
      sim_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('one_on_one', 'meeting', 'standup', 'briefing', 'user_interaction')),
      location TEXT NOT NULL,
      sim_time_start TEXT NOT NULL,
      sim_time_end TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE conversation_participants (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('speaker', 'listener', 'facilitator')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      speaker_id TEXT NOT NULL,
      speaker_type TEXT NOT NULL CHECK (speaker_type IN ('agent', 'user')),
      message TEXT NOT NULL,
      sim_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      sim_day TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      outcome TEXT CHECK (outcome IN ('completed', 'interrupted', 'errored', 'hung')),
      token_estimate INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE session_tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      arguments TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'errored')),
      sim_time TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE scheduled_jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      sim_time TEXT NOT NULL,
      recurrence TEXT,
      missed_policy TEXT NOT NULL DEFAULT 'fire_immediately' CHECK (missed_policy IN ('fire_immediately', 'skip_to_next')),
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE job_queue (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      queued_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );

    CREATE TABLE desks (
      id TEXT PRIMARY KEY,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      position_z REAL NOT NULL,
      agent_id TEXT,
      team_id TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE meeting_rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      position_z REAL NOT NULL,
      capacity INTEGER NOT NULL
    );

    CREATE TABLE office_layout (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('wall', 'door', 'floor', 'decoration')),
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      position_z REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      depth REAL NOT NULL,
      metadata TEXT
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  // Seed default settings
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insert.run('default_provider', JSON.stringify('claude_agent_sdk'));
  insert.run('default_model', JSON.stringify('claude-sonnet-4-20250514'));
  insert.run('sim_speed', JSON.stringify(1));
  insert.run('sim_paused', JSON.stringify(false));
}
