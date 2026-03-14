import type Database from 'better-sqlite3';

export const name = '006_seed_onboarding_room';

export function up(db: Database.Database): void {
  // Seed onboarding room if it doesn't exist
  const existing = db.prepare("SELECT id FROM meeting_rooms WHERE id = 'room-onboarding'").get();

  if (!existing) {
    db.prepare(
      'INSERT INTO meeting_rooms (id, name, position_x, position_y, position_z, capacity) VALUES (?, ?, ?, 0, ?, ?)',
    ).run('room-onboarding', 'Onboarding Room', -15, 15, 12);

    console.log('[migration] Seeded onboarding room');
  }

  // Seed onboarding room walls (10x10 room at -15, 15)
  const wallCount = db
    .prepare("SELECT COUNT(*) as count FROM office_layout WHERE metadata LIKE '%room-onboarding%'")
    .get() as { count: number };

  if (wallCount.count === 0) {
    const insert = db.prepare(
      `INSERT INTO office_layout (id, type, position_x, position_y, position_z, width, height, depth, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // 10-unit wide room centered at (-15, 15)
    insert.run('wall-onboard-n', 'wall', -15, 1.5, 10, 10, 3, 0.2, '{"room":"room-onboarding"}');
    insert.run('wall-onboard-s', 'wall', -15, 1.5, 20, 10, 3, 0.2, '{"room":"room-onboarding"}');
    insert.run('wall-onboard-e', 'wall', -10, 1.5, 15, 0.2, 3, 10, '{"room":"room-onboarding"}');
    insert.run('wall-onboard-w', 'wall', -20, 1.5, 15, 0.2, 3, 10, '{"room":"room-onboarding"}');

    console.log('[migration] Seeded onboarding room walls');
  }

  // Seed front door marker at south wall center
  const doorExists = db.prepare("SELECT id FROM office_layout WHERE id = 'door-front'").get();

  if (!doorExists) {
    db.prepare(
      `INSERT INTO office_layout (id, type, position_x, position_y, position_z, width, height, depth, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('door-front', 'door', 0, 1.5, -20, 4, 3, 0.2, '{"label":"Entrance"}');

    console.log('[migration] Seeded front door');
  }
}
