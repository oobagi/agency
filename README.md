# Agency

A persistent server that simulates a software development office run entirely by autonomous AI agents. Give the Office Manager a goal and watch as it hires developers, forms teams, assigns tasks, writes code in real Git repos, opens pull requests, and resolves blockers — all on its own.

Open `http://localhost:3001` to observe the simulation in a 3D viewport. Agents physically walk to each other to communicate, sit at desks to code, and gather in meeting rooms. Click any agent to inspect their work or send them a message.

## Getting Started

```bash
git clone https://github.com/oobagi/agency.git
cd agency
pnpm install
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- At least one agentic provider CLI authenticated:
  - **Claude** — run `claude` in your terminal and complete the auth flow
  - **Codex** — run `codex` in your terminal and complete the auth flow

## How It Works

1. The **Office Manager** wakes up on a sim-time schedule and evaluates the world
2. It creates projects (real Git repos), hires agents from a persona pool, forms teams, and delegates work
3. **Team Managers** assign tasks, review PRs, and handle blockers within their teams
4. **Agents** walk to their desks, run agentic coding sessions via MCP tools, and open PRs when done
5. Failures escalate: Agent -> Team Manager -> Office Manager -> You (last resort)

Closing the browser doesn't stop anything. The simulation keeps running.

## Tech Stack

|                   |                                                               |
| ----------------- | ------------------------------------------------------------- |
| **Server**        | Node.js, TypeScript, SQLite (better-sqlite3), WebSockets (ws) |
| **Client**        | React, Vite, React Three Fiber, Drei                          |
| **AI**            | Claude Agent SDK, MCP Server, @huggingface/transformers       |
| **Git**           | simple-git (real repos, real worktrees, real merges)           |
| **Vector Search** | sqlite-vss (agent memory retrieval)                           |

## Documentation

| Doc                                              | Description                                        |
| ------------------------------------------------ | -------------------------------------------------- |
| [Architecture](docs/architecture.md)             | System design, module map, boot/shutdown sequences |
| [Agent System](docs/agents.md)                   | How agents think, move, communicate, and work      |
| [API Reference](docs/api-reference.md)           | REST endpoints, WebSocket events, MCP tools        |
| [Database Schema](docs/database.md)              | Full table definitions and migrations              |
| [Implementation Log](docs/implementation-log.md) | Phase-by-phase build history                       |

## License

MIT
