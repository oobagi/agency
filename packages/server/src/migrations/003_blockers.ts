import type Database from 'better-sqlite3';

export const name = '003_blockers';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE blockers (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      task_id TEXT REFERENCES tasks(id),
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'escalated_to_tm', 'escalated_to_om', 'user_facing', 'resolved')),
      resolution TEXT,
      resolved_by TEXT,
      escalation_history TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `);
}
