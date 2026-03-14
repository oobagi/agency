import Database from 'better-sqlite3';
import path from 'node:path';
import { createRequire } from 'node:module';
import { migrations } from './migrations/index.js';

const DB_PATH = process.env.AGENCY_DB_PATH ?? path.join(process.cwd(), 'agency.db');

let db: Database.Database | null = null;
let vssAvailable = false;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/** Whether sqlite-vss extensions loaded successfully. */
export function isVssAvailable(): boolean {
  return vssAvailable;
}

export function initDb(): Database.Database {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load sqlite-vss extensions (vector0 + vss0)
  try {
    const require = createRequire(import.meta.url);
    const { getVectorLoadablePath, getVssLoadablePath } = require('sqlite-vss') as {
      getVectorLoadablePath: () => string;
      getVssLoadablePath: () => string;
    };
    db.loadExtension(getVectorLoadablePath());
    db.loadExtension(getVssLoadablePath());
    vssAvailable = true;
    console.log('[db] sqlite-vss extensions loaded');
  } catch (err) {
    console.warn(
      '[db] sqlite-vss not available, falling back to JS-based similarity:',
      err instanceof Error ? err.message : err,
    );
  }

  runMigrations(db);

  return db;
}

function runMigrations(database: Database.Database): void {
  // Ensure migrations table exists (bootstrap — the first migration also creates it,
  // but we need it to exist before we can check what's been applied)
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    database
      .prepare('SELECT name FROM migrations')
      .all()
      .map((row) => (row as { name: string }).name),
  );

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;

    console.log(`Applying migration: ${migration.name}`);

    const run = database.transaction(() => {
      migration.up(database);
      database
        .prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)')
        .run(migration.name, new Date().toISOString());
    });

    run();
    console.log(`Migration applied: ${migration.name}`);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
