import type Database from 'better-sqlite3';
import * as m001 from './001_initial_schema.js';

export interface Migration {
  name: string;
  up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [m001];
