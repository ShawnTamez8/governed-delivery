# Review of the super-simple-software-factory harness

## What this is

A record of a review of `https://github.com/disler/super-simple-software-factory`
(branches `main` — the skill itself — and `example` — the skill stamped into a
real repo with the `inkwell` demo app it built), carried out on 2026-08-31.
Notes only, no implementation. The entry records what the harness does that
this repository already does, what it does that this repository does not, and
the disposition of each idea against the hard rules. Nothing here is adopted;
the record exists so the considered-and-rejected list is on file when the
step-8/9 planning happens.

The harness's own one-line doctrine: **"Agent proposes, code disposes."**
Deterministic Python scripts (ADWs) own sequencing, retries, and acceptance;
agents are bounded nodes inside them. Each agent call is one phase: prompt in,
typed JSON envelope out, gates checked after the fact. Every event streams
into SQLite while the run is still happening.

## How it handles greenfield at start

There is no greenfield mode; the design makes it a non-event.

- **Stamp into an empty repo.** The install script copies templates into the
  cwd; the only repo precondition is `git init` plus one empty commit, so
  commit phases have a baseline and change capture has a base to diff against
  (the empty-commit requirement is stated plainly in the install cookbook).
- **The request is the seed.** Every run starts with an engineer-lane phase
  that captures the incoming ask, then the planner turns it into a plan. For
  a repo with existing code there is an optional `scout` read-only recon
  agent; for an empty repo the planner works from the request alone.
- **The plan is the institutional memory.** The planner writes
  `specs/<adw_id>_<slug>.md`, listing the directory first and suffixing
  `_v2`, `_v3` — never overwriting an earlier spec. Traces are gitignored and
  the demo repo's history is squashed, so the committed record of greenfield
  is the requests, the specs, and the built artifacts.
- **Proof by example:** the `example` branch is exactly this — requests,
  specs, and a planned/built/tested/reviewed/documented demo app.

## Shared stances (already present here, listed for the record)

The review found several ideas that this repository already implements, in
some cases harder than the harness does:

- **Known commands are code, not agent calls.** Their `kind="code"` phase is
  the verification stage's role here; their doctrine that a passing test
  suite must not ride in a context window is the same line `src/prompts.ts`
  draws between content and enforcement.
- **Phase passing is not run acceptance.** Their `run.finish(accepted=...)`
  separates "the test phase ran the red suite correctly" from "the run is
  acceptable"; here the smoke recorded exactly the same separation — stages
  `passed` while the run stayed `in_progress`.
- **Claims are checked after the fact against the repo itself**, not believed
  from the envelope — the same stance as the implementation stage's
  staged-set and committed-set equality.
- **Gates report what they verified**, not just a verdict — the audit's
  `gate.pass` entries name the checked facts.
- **A frozen environment at run start** — their config is read once per ADW;
  this repository's hard rule 6 freezes it in the profile, which is stricter.

## Candidates worth carrying forward

Ranked by fit with this repository's architecture, not by the harness's own
priorities.

1. **Same-session correction loops.** When an envelope does not parse or a
   gate fails, the harness re-prompts the *same* session with a correction
   naming exactly what was wrong — one message, context intact. This
   repository's remediation rounds re-dispatch each revision and the executor
   deliberately runs with `--no-session-persistence`, so every round pays
   full context cost. This is the largest cost lever on the remediation path.
   Adopting it means reopening session persistence, which the step-6
   hardening closed as a trust surface. It is a design decision, not a
   bolt-on: the candidate is the *decision*, not the mechanism.
2. **Mid-flight tracing.** The harness tails the coding agent's JSONL stdout
   and inserts per-tool-call events into SQLite while the agent is still
   working. Here the raw output is retained and the audit is written after
   each stage, so nothing can be watched in progress. The JSONL is already
   captured; streaming it into the existing trace is an addition, not a new
   surface. It sits past the step-9 stop boundary.
3. **Run-process registry.** The harness records each run's pid and command in
   its trace and a killed run finalizes its own trace to `fail`. Here the
   harness kills process trees but the audit never records the stage's own
   pid, so "which process is this run, and is it hung or dead" has no answer
   outside the OS. Small, cheap, and within the one-surface rule.

## Considered and rejected

Each of these conflicts with a hard rule or duplicates an existing mechanism;
the reason is recorded so a later reader does not re-propose them.

- **Writes-and-rollback enforcement.** The harness snapshots the tree before
  an agent runs, compares after, rolls back unauthorized changes, and
  distinguishes agent-introduced dirt from pre-existing dirt (an
  agent-reverted operator change is reported as unrecoverable). This
  repository chose invocation-boundary refusal instead — read-only executor
  flags plus the worktree cleanliness gate — which does not let the write
  happen at all. Its own README concedes it has no sandbox. The pre-existing
  dirt analysis is made unreachable here by the pre-dispatch refusal.
- **Session pinning across workflows** (`--adw-id` create-or-continue, agents
  resuming their context windows). This repository's recorded decision: a
  blocked run is terminal and a fresh run is the repair (ARCHITECTURE.md
  section 12's deferral record). Resuming windows across runs is state the
  audit cannot hold accountable.
- **Placeholder quality commands.** The harness ships test blocks as `echo`
  commands that exit 0 and admit they are fake, on the ground that a
  wrong-but-plausible command that silently passes is worse than one that
  says so. The concern is real; this repository solves it at the root —
  `governed.yaml` has no seeded content, and only operator-authored committed
  commands run.
- **Per-agent model and thinking roster.** The harness lets every agent carry
  its own model and thinking level. This repository freezes one model per run
  by design; the per-stage-kind `modelMap` already provides the same
  flexibility at the one point where freezing is legal (new-run).
- **The commit phase as a first-class code phase** (agent proposes the commit
  message, code decides and commits). Here the implementation stage applies
  and commits patches under the system identity, and the audit binds the
  commit to the run.
- **Idempotent skill stamping and the trace UI.** Irrelevant to a single
  project (stamping) or a second surface past the one CLI (UI).

## What would settle it

Nothing is adopted before the step-9 stop. Three facts, when the step-8/9
planning happens:

1. Whether remediation cost (context re-purchase per round) has become a
   measured driver — if yes, the same-session correction decision deserves an
   explicit ruling; if no, the recorded rejection stands.
2. Whether a stage's live progress is part of the step-9 milestone's "one
   complete run with queryable cost" — mid-flight tracing is the only way to
   watch a run without waiting for it.
3. Whether the run-process registry is worth two tables of the audit schema's
   budget — it is the only candidate that fits today's architecture without
   reopening a closed decision.

Related: `docs/proposals/verification-containment.md` (the same review
discipline applied to the verification stage's own boundaries),
`ARCHITECTURE.md` sections 6 and 12, `docs/hazards.md` entries 3, 11, and 15.
