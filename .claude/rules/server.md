---
paths:
  - 'packages/server/**/*.ts'
---

# Server Package Rules

## Time

- Never use `Date.now()` or `new Date()` for game logic. All game time comes from `SimClock.now()`.
- Real-world `Date` is only acceptable for: database `created_at` timestamps, log output, and migration `applied_at`.
- The single `setInterval` in SimClock is the only real-world timer. Do not add others for game mechanics.

## Database

- Always import `getDb` from `./db.js` (or relative equivalent). Never construct a new Database instance.
- Use `db.prepare()` with parameterized queries. Never interpolate values into SQL strings.
- Wrap multi-statement writes in `db.transaction()`.
- WAL mode and foreign keys are enabled at connection time. Do not change pragmas.

## Modules

- Use `.js` extensions in all imports (TypeScript with Node16 resolution).
- Use `node:` prefix for Node.js built-ins.
- The package is ESM (`"type": "module"`). No `require()`.

## Agent SDK

- All LLM calls must use Agent SDK `query()`. Never import or use the raw Anthropic SDK.
- For lightweight calls (summaries, briefings): `query()` with model haiku, maxTurns 1, allowedTools empty, persistSession false.

## State Machine

- Agent state transitions must go through the explicit transition map. No scattered conditionals.
- `set_state` validates against the transition map and rejects invalid transitions.

## MCP Tools

- Manager-only tools must validate the calling agent's role before executing.
- `speak` must validate proximity on every call. No bypassing the walk requirement.
- `begin_task` must validate the agent is seated at their desk.
