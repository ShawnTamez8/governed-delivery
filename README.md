# BuildWorks

A repo-native control plane for AI-assisted software delivery. The system
name is configuration; BuildWorks is the default.

> Agents propose. The system decides.

Agents reason, draft, implement, review, and summarize. They never approve their
own work, advance authoritative state, bypass policy, or write without
validation.

## Status

Build order steps 1-4 implemented: run store, stage chain, and audit chain
over SQLite; the concrete harness adapter (`bw dispatch` spawns `claude-code`,
parses its envelope, retains raw output, and persists `agent_run` rows); the
spec and spec-review stages (`bw spec` runs the author, the review panel,
and the deterministic gate with closure rounds); and the human approval gate
(`bw approval-request` prints the payload, `bw approve` verifies one Ed25519
authorization against a public key held outside the repository). Plus the
documentation checker. Commands: see [`CLAUDE.md`](CLAUDE.md).

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the design, and its binding
  constraints.
- [`docs/hazards.md`](docs/hazards.md) — failure modes this kind of system
  is subject to, and what each requires.
- [`CLAUDE.md`](CLAUDE.md) — how to work in this repository.

## The milestone that decides everything

The build order in `ARCHITECTURE.md` stops deliberately at step 9: one feature run that
reaches a terminal state with queryable per-stage cost. Nothing past that is
worth building until that run exists.
