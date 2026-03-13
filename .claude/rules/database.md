---
paths:
  - 'packages/server/src/db.ts'
  - 'packages/server/src/migrations/**'
---

# Database & Migration Rules

## Migrations

- Each migration is a TypeScript module exporting `{ name: string, up(db): void }`.
- Register every new migration in `src/migrations/index.ts`.
- Migration names must be unique and sort lexicographically (use numeric prefix: `002_`, `003_`).
- Migrations run inside transactions — a failed migration rolls back cleanly.
- Never modify an already-applied migration. Create a new one instead.

## Schema

- Use TEXT PRIMARY KEY with UUIDs for all `id` columns (except migrations which uses INTEGER AUTOINCREMENT).
- Use CHECK constraints for enum-like columns (status, role, type).
- Use FOREIGN KEY constraints for all references.
- Store JSON as TEXT with `JSON.stringify()` / `JSON.parse()`.
- Timestamps are ISO 8601 strings (TEXT), not Unix integers.
