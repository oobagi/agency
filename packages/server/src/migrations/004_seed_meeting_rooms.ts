import type Database from 'better-sqlite3';

export const name = '004_seed_meeting_rooms';

export function up(db: Database.Database): void {
  // Seed meeting rooms if none exist
  const count = db.prepare('SELECT COUNT(*) as count FROM meeting_rooms').get() as {
    count: number;
  };

  if (count.count === 0) {
    const insert = db.prepare(
      'INSERT INTO meeting_rooms (id, name, position_x, position_y, position_z, capacity) VALUES (?, ?, ?, 0, ?, ?)',
    );

    insert.run('room-alpha', 'Alpha Room', 15, 5, 6);
    insert.run('room-beta', 'Beta Room', 15, 15, 4);
    insert.run('room-gamma', 'Gamma Room', -15, 5, 8);

    console.log('[migration] Seeded 3 meeting rooms');
  }
}
