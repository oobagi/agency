Agency Implementation Phases

This document defines every phase of the Agency build in granular micro-phases numbered X.Y. Phases are ordered so that LLM integration and agent orchestration come before simulation rendering. Read DESIGN_DOC.md in full before starting any phase.

Phase 8.1 — Hardening and Error Recovery

Goal: make the system resilient to crashes, disconnections, and edge cases.

Context: this is the final phase. All features are implemented. This phase is about robustness.

What to build: WebSocket reconnection: the client should automatically reconnect on disconnect with exponential backoff, and re-subscribe to all active channels. State restoration on restart: when the server restarts, it should restore all agent states from the database, restart the sim clock from persisted time, re-fire missed scheduled jobs per policy, and resume any sessions that were active (or mark them as errored if they cannot be resumed). Graceful shutdown: on SIGTERM/SIGINT, the server should interrupt all active sessions, commit partial work, persist sim time, and close the database cleanly. Error boundaries in the React app: wrap major UI sections in error boundaries so a rendering error in one panel does not crash the entire viewport. Provider error handling: if an agentic session errors out, the agent transitions to Blocked and the escalation chain handles it. Database WAL mode: enable WAL mode on the SQLite database for better concurrent read performance. Add a health check endpoint GET /api/health.

Out of scope: horizontal scaling, multi-user support, authentication.

Acceptance criteria: killing and restarting the server resumes the simulation from where it was. WebSocket disconnection and reconnection is seamless. A provider error does not crash the server. The health check endpoint returns 200 when the server is healthy. Graceful shutdown completes within a reasonable timeout.

Handoff: the project is feature-complete and hardened. Future work is iteration and polish.
