# BuildWorks

A repo-native control plane for AI-assisted software delivery. The system
name is configuration; BuildWorks is the default.

> Agents propose. The system decides.

Agents reason, draft, implement, review, and summarize. They never approve their
own work, advance authoritative state, bypass policy, or write without
validation.

## Status

Build order steps 1-8 implemented: run store, stage chain, and audit chain
over SQLite; the concrete harness adapter (`bw dispatch` spawns the `claude`
CLI, parses its envelope, retains raw output, and persists `agent_run` rows);
the spec and spec-review stages (`bw spec` runs the author, one self-critique
dispatch, an author-proposed specialist panel, the author's reconciliation of
every finding into one typed decision each, and a deterministic gate that
decides on decision completeness for each configured review round); the human
approval gate
(`bw approval-request` prints the payload, `bw approve` verifies one Ed25519
authorization against a public key held outside the repository); and the plan
and plan-review stages (`bw plan` builds the plan from the approved
specification, re-verified against the hash the review gate recorded, and an
ID-based coverage gate requires every approved acceptance-criterion ID exactly
once, refuses unknown or repeated IDs, then refuses any covered artifact outside
the signed scope before a panel is convened); and the implementation stage
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
verified commit); and the delivery stage (`bw deliver` — the final
deterministic gate, no dispatch and no model: it re-reads the verification
record and the retained worktree, diffs the patch range between the recorded
base and the verified commit, and completes the run only when every declared
artifact the operator signed for appears there as an exact changed path —
otherwise it blocks the run naming what is missing). The model each stage
uses is frozen
at `bw new-run --model` and every spend entry point checks it. Plus the
documentation checker. Commands: see [`CLAUDE.md`](CLAUDE.md).

Step 5b shipped: an author-led correction to the two review stages.
[`docs/features/step5b-upstream-findings/plan.md`](docs/features/step5b-upstream-findings/plan.md)
replaced the closure-round review loop with the five-phase flow named above —
run for each of the profile's configured review rounds (one by default), gated
once over every round's decisions rather than looping until a panel returns
empty — and gave a concern whose cause is upstream of the reviewed artifact a
destination other than another author round: `upstream_follow_up` writes a
stored, non-binding proposal and the run continues; `upstream_blocking` writes
one and blocks. No run writes into `docs/proposals/`; `bw proposal-export` is
the explicit human command that materializes a stored proposal there, and
promotion to active work stays a human `git mv`. Step 8 shipped next:
[`docs/features/delivery-check/plan.md`](docs/features/delivery-check/plan.md)
implemented the terminal delivery check described above — the delivery_check
stage, `bw deliver`, and the audit events that transition a run to
`completed` or `blocked`. All eight build-order stages now exist; step 9's
stop is the milestone itself: one feature run that reaches `completed` with
queryable per-stage cost.

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the design, and its binding
  constraints.
- [`docs/hazards.md`](docs/hazards.md) — failure modes this kind of system
  is subject to, and what each requires.
- [`CLAUDE.md`](CLAUDE.md) — how to work in this repository.

## The milestone that decides everything

The build order in `ARCHITECTURE.md` stops deliberately at step 9: one feature run that
reaches a terminal state with queryable per-stage cost. Nothing past that is
worth building until that run exists.
