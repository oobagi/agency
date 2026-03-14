import type Database from 'better-sqlite3';
import * as m001 from './001_initial_schema.js';
import * as m002 from './002_vss_memory.js';
import * as m003 from './003_blockers.js';
import * as m004 from './004_seed_meeting_rooms.js';
import * as m005 from './005_seed_office_layout.js';
import * as m006 from './006_seed_onboarding_room.js';

export interface Migration {
  name: string;
  up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006];
