import * as m001 from './001_initial_schema.js';

export interface Migration {
  name: string;
  up: (db: import('better-sqlite3').Database) => void;
}

export const migrations: Migration[] = [m001];
