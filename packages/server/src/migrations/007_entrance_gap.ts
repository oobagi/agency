import type Database from 'better-sqlite3';

export const name = '007_entrance_gap';

export function up(db: Database.Database): void {
  // Replace the solid north wall with two halves, leaving a gap for the entrance at X=0.
  // Original: wall-north at (0, 1.5, -20), 60w — spans X from -30 to 30.
  // New: two segments with a 6-unit gap (X from -3 to 3).
  //   Left:  center (-16.5, 1.5, -20), width 27 — spans X from -30 to -3
  //   Right: center (16.5, 1.5, -20),  width 27 — spans X from 3 to 30

  const exists = db.prepare("SELECT id FROM office_layout WHERE id = 'wall-north'").get();
  if (!exists) return; // Layout not seeded yet, nothing to split

  db.prepare("DELETE FROM office_layout WHERE id = 'wall-north'").run();

  const insert = db.prepare(
    `INSERT INTO office_layout (id, type, position_x, position_y, position_z, width, height, depth, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  insert.run('wall-north-left', 'wall', -16.5, 1.5, -20, 27, 3, 0.2, null);
  insert.run('wall-north-right', 'wall', 16.5, 1.5, -20, 27, 3, 0.2, null);

  console.log('[migration] Split north wall into two halves with entrance gap');
}
