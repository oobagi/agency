import type Database from 'better-sqlite3';

export const name = '005_seed_office_layout';

export function up(db: Database.Database): void {
  const count = db.prepare('SELECT COUNT(*) as count FROM office_layout').get() as {
    count: number;
  };

  if (count.count > 0) return;

  const insert = db.prepare(
    `INSERT INTO office_layout (id, type, position_x, position_y, position_z, width, height, depth, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Floor: large plane centered at origin
  insert.run('floor-main', 'floor', 0, 0, 0, 60, 0.1, 40, null);

  // Outer walls (office boundary)
  insert.run('wall-north', 'wall', 0, 1.5, -20, 60, 3, 0.2, null);
  insert.run('wall-south', 'wall', 0, 1.5, 20, 60, 3, 0.2, null);
  insert.run('wall-east', 'wall', 30, 1.5, 0, 0.2, 3, 40, null);
  insert.run('wall-west', 'wall', -30, 1.5, 0, 0.2, 3, 40, null);

  // Meeting room walls (Alpha Room at 15,5)
  insert.run('wall-alpha-n', 'wall', 15, 1.5, 2, 8, 3, 0.2, '{"room":"room-alpha"}');
  insert.run('wall-alpha-s', 'wall', 15, 1.5, 8, 8, 3, 0.2, '{"room":"room-alpha"}');
  insert.run('wall-alpha-e', 'wall', 19, 1.5, 5, 0.2, 3, 6, '{"room":"room-alpha"}');
  insert.run('wall-alpha-w', 'wall', 11, 1.5, 5, 0.2, 3, 6, '{"room":"room-alpha"}');

  // Meeting room walls (Beta Room at 15,15)
  insert.run('wall-beta-n', 'wall', 15, 1.5, 12, 8, 3, 0.2, '{"room":"room-beta"}');
  insert.run('wall-beta-s', 'wall', 15, 1.5, 18, 8, 3, 0.2, '{"room":"room-beta"}');
  insert.run('wall-beta-e', 'wall', 19, 1.5, 15, 0.2, 3, 6, '{"room":"room-beta"}');
  insert.run('wall-beta-w', 'wall', 11, 1.5, 15, 0.2, 3, 6, '{"room":"room-beta"}');

  // Meeting room walls (Gamma Room at -15,5)
  insert.run('wall-gamma-n', 'wall', -15, 1.5, 2, 8, 3, 0.2, '{"room":"room-gamma"}');
  insert.run('wall-gamma-s', 'wall', -15, 1.5, 8, 8, 3, 0.2, '{"room":"room-gamma"}');
  insert.run('wall-gamma-e', 'wall', -11, 1.5, 5, 0.2, 3, 6, '{"room":"room-gamma"}');
  insert.run('wall-gamma-w', 'wall', -19, 1.5, 5, 0.2, 3, 6, '{"room":"room-gamma"}');

  console.log('[migration] Seeded office layout (floor, walls, meeting room walls)');
}
