import type Database from 'better-sqlite3';
import { isVssAvailable } from '../db.js';

export const name = '002_vss_memory';

export function up(db: Database.Database): void {
  if (!isVssAvailable()) {
    console.log('[migration] Skipping vss_agent_memory virtual table (sqlite-vss not available)');
    return;
  }

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vss_agent_memory USING vss0(embedding(384))`);
  console.log('[migration] Created vss_agent_memory virtual table');
}
