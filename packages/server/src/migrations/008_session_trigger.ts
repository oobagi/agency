import type Database from 'better-sqlite3';

export const name = '008_session_trigger';

export function up(db: Database.Database): void {
  db.prepare('ALTER TABLE sessions ADD COLUMN trigger TEXT').run();
  console.log('[migration] Added trigger column to sessions table');
}
