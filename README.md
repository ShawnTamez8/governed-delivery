# BuildWorks

A repo-native control plane for AI-assisted software delivery. The system
name is configuration; BuildWorks is the default.

> Agents propose. The system decides.

Agents reason, draft, implement, review, and summarize. They never approve their
own work, advance authoritative state, bypass policy, or write without
validation.

## Status

Build order steps 1-7 implemented: run store, stage chain, and audit chain
over SQLite; the concrete harness adapter (`bw dispatch` spawns the `claude`
CLI, parses its envelope, retains raw output, and persists `agent_run` rows);
the spec and spec-review stages (`bw spec` runs the author, the review panel,
and the deterministic gate with closure rounds); the human approval gate
(`bw approval-request` prints the payload, `bw approve` verifies one Ed25519
authorization against a public key held outside the repository); and the plan
and plan-review stages (`bw plan` builds the plan from the approved
specification, re-verified against the hash the review gate recorded, and an
unkeepable-promise gate refuses coverage naming any artifact outside the
signed scope before a panel is convened); and the implementation stage
(`bw implement` creates the run's worktree on branch `gov/<slug>/<run-id>`,
commits the projections, dispatches an implementer, and applies each proposed
patch only when it binds to the recorded base commit and stays inside the
signed scope — one commit per patch, the worktree retained when the gate
blocks); and the verification stage (`bw verify` runs the commands frozen at
run start from the committed `governed.yaml` inside that worktree, under a
named environment passthrough and bounded per-command time and output limits,
proving the worktree still holds the commit implementation left and is clean
before and after every command, retaining each command's complete output, and
handing the next stage a structured record naming the worktree and the
verified commit). The model each stage uses is frozen
at `bw new-run --model` and every spend entry point checks it. Plus the
documentation checker. Commands: see [`CLAUDE.md`](CLAUDE.md).

Planned and not built: step 5b, a correction to the two review stages.
[`docs/features/step5b-upstream-findings/plan.md`](docs/features/step5b-upstream-findings/plan.md)
replaces the closure-round review loop with an author-led flow — draft, one
self-critique, a specialist panel, author reconciliation, deterministic gate —
and gives a concern whose cause is upstream of the reviewed artifact a
destination other than another author round: a stored proposal, materialized
into `docs/proposals/` only by a human command. Thirteen tasks, none
implemented; the first is a bounded prototype whose result decides the rest.
Step 8, the delivery check, remains the next build-order step.

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the design, and its binding
  constraints.
- [`docs/hazards.md`](docs/hazards.md) — failure modes this kind of system
  is subject to, and what each requires.
- [`CLAUDE.md`](CLAUDE.md) — how to work in this repository.

## The milestone that decides everything

The build order in `ARCHITECTURE.md` stops deliberately at step 9: one feature run that
reaches a terminal state with queryable per-stage cost. Nothing past that is
worth building until that run exists.
