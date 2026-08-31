# Review of the Archon harness

## What this is

A record of a review of `C:\Users\Shawn-work\repositories\Archon` (a local
checkout of the Archon workflow engine, commit `27a6b4a9`, 2026-08-31),
carried out alongside `docs/proposals/sssf-harness-review.md` and
`docs/proposals/omniagent-harness-review.md`. Notes only, no implementation,
nothing adopted. The record exists so the considered-and-rejected list and
the greenfield analysis are on file when step-8/9 planning happens.

## What it is

A workflow engine for AI coding agents, MIT-licensed: YAML DAGs of nodes
(`agent` prompt nodes, `exec` bash/script nodes, `loop`, `gate` approval
nodes, `wait`, child `workflow` runs) executed by a deterministic engine,
with per-run git worktree isolation, SQLite/Postgres persistence, six
platform adapters, and a web dashboard. Its own doctrine is the closest
thing this review found to this repository's architecture: "**YAML
coordinates. Code computes. Agents judge.**", governed by a written
constitution with an admissibility test for every proposed YAML feature and
a recorded case-law table. It is the most mature and most disciplined of the
three harnesses reviewed.

## How it handles greenfield

Greenfield is moved out of the run by specification, in three layers:

1. **The run-input rule** (`AGENTS.md`): before a run starts, the input must
   state the problem to solve, why it is worth solving, why now, the desired
   outcome, the invariants that must hold, and what acceptance looks like. A
   run never starts from a short prompt against an empty repo.
2. **`archon-interactive-prd`**: when the intent is not yet shaped, a gated
   conversation (initiate → foundation gate → research → deep-dive gate →
   technical) pauses at approval nodes for human answers that become typed
   inputs to the next node. Interactive workflows are refused for background
   dispatch — a greenfield PRD cannot happen unattended by construction.
3. **`archon-adversarial-dev`**: when the spec exists, a short prompt is
   expanded by a planner into a product spec with mandated concreteness
   (exact package names and versions, hex color codes, a 3-6 sprint plan), a
   deterministic bootstrap node creates the workspace and runs `git init`
   (the empty-commit problem solved in code, not prose), and a bounded
   adversarial loop builds in sprints — a Generator and an Evaluator with
   hard 7/10 pass/fail thresholds, fresh contexts per role, and a sprint
   state machine. It is their answer to "a whole app is not one shot".

## Does it solve this repository's issues?

**The trust boundary — no; this repository's is stricter.** The direct-chat
agent runs with `permissionMode: "bypassPermissions"` and
`allowDangerouslySkipPermissions: true`
(`packages/providers/src/claude/provider.ts:837-838`) — the exact
anti-pattern the step-6 correction exists to close. Governance is
structural: per-run worktrees (their own docs state twice that a worktree is
not a security sandbox), an opt-in per-node `mutates_checkout: false` git
snapshot check (`assertCheckoutUntouched`, `dag-executor.ts:1275`) — this
repository's cleanliness gate is mandatory at three sites — and a Docker
container backend with a read-only root mount, an overlay for the agent's
writes, and a **write-back approval gate**: a human approves the diff before
it touches the live root, with escape-symlink refusal and claim-protected
apply. The container backend is the one real find: this repository's
`docs/proposals/verification-containment.md` lists "run commands in a
container" as its third containment option, and Archon proves that option is
buildable — 738 lines, fail-closed resume, escape-symlink refusal, CAS
apply. When the containment decision is made, this is the pattern to follow.

**Remediation cost — a data point, not a solution.** Archon supports both
same-session resume and `fresh_context: true` per node, and its own SDLC
correction loop deliberately uses fresh contexts (bounded 5-round fix →
re-gate → re-review). Same-session resumption is proven buildable on the
Claude SDK, which strengthens the sssf review's candidate-1 decision without
changing this repository's calculus: remediation rounds stay cold until the
cost is measured and the design decision is made.

**The plan-coverage restatement variance — the one mechanism this
repository lacks.** The observed failure (the plan restated acceptance
criteria without their `(traces to: …)` suffixes and the gate blocked) is a
prose-restatement problem. Archon eliminates the class with structured
output: every agent node declares an `output_format` JSON Schema, the engine
validates the parse, best-effort providers are re-asked up to three times
with the schema errors, then fail; gate scripts check typed fields, never
normalized prose. For this repository this conflicts with hard rule 3 — a
typed coverage sidecar alongside the prose coverage section would be two
representations of one mapping, a drift surface Archon's own `AGENTS.md`
condemns as "a present defect". The honest disposition: if the coverage
block recurs, the prompt-side fix (copy criteria verbatim) is first; the
structured form only if that fails, and only replacing the prose section,
never duplicating it.

## Candidates worth carrying forward

These are principles for later steps, not mechanisms to import now:

1. **The container write-back gate as the containment pattern.** When the
   `verification-containment.md` decision is made, Archon's container
   backend is the demonstrated shape: read-only project mount, per-run
   overlay, human-approved diff application, escape-symlink refusal, and the
   fail-closed rule that a resume reaching an undecided gate re-raises the
   gate rather than touching the live root.
2. **Read-back verification after irreversible actions** — "a successful
   exit is not proof the state changed". Their `flip-ready` node re-verifies
   CI and reads back `isDraft` and the PR URL before the one irreversible
   step. Step 8 (delivery check) will create branches and PRs; this is the
   discipline it needs, recorded now, applied then.
3. **Deterministic loop-termination vocabulary.** `until_bash` and
   `until_field` terminate loops on deterministic checks, with prose `until`
   only as a fallback sentinel; `max_iterations` is "a runaway backstop, not
   a pacing device". This repository's verify commands and gate refusals are
   the same idea; the framing is worth stating in its docs.
4. **The dry-run fixture discipline** — "if this pack's fixture suite cannot
   exercise the guard, it is not a guard. It is a comment." This repository's
   break-it rule applied to whole workflows. Already present per guard; a
   whole-sequence dry-run is premature under hard rules 1 and 4 (one
   hard-coded sequence, one harness).

## Greenfield: the open decision for this repository

Greenfield is designed for here in the strictest form of the three harnesses
reviewed — the seed is the human-authored design document, and by
construction the first run can bootstrap what it verifies (the frozen
`governed.yaml` commands run in the worktree after implementation, so the
implementer can create the code and the tests their own verify commands
need). But it is unproven: the one real smoke was a single-file feature with
always-existing commands. A whole app in one run — a spec declaring dozens
of artifacts, one implementer dispatch with a large multi-file patch set,
verify commands whose prerequisites exist only if the run delivered them —
has never run. The authorship tension is real: on an empty repo the operator
must commit `governed.yaml` naming commands whose prerequisites do not exist
yet, while `new-run` refuses a dirty tree. The step-8/9 planning must make
one of three decisions: prove whole-app greenfield with a real smoke, or
declare the seed-commit pattern (the operator commits a minimal passing
skeleton first, after which the first run looks like every other run), or
adopt Archon's split (the spec as a model-authored artifact plus a
deterministic workspace bootstrap). TheBotFather's retirement is recorded
here as the reason this must be a decision and not an assumption.

## Considered and rejected

- **`bypassPermissions` direct-chat mode.** Full tool access with governance
  structural only. This is the anti-pattern the step-6 correction exists to
  close; rejected by record.
- **Run trees, fan-out, joins, child runs.** Hard rule 1: one harness until
  one run completes end to end. Rejected by design.
- **Mutable events audit (no hash chain).** This repository's audit chain
  and `verify-audit` recomputation are strictly stronger. Rejected.
- **Layered config (defaults < global < repo < env).** Their base config is
  process-cached and only the per-run overlay is sealed; this repository's
  full-profile freeze, canonical JSON, and gate-time hash comparison are
  stricter. Validation, not import.
- **The `manage_run` agent-driven approval tool.** No agent in this
  repository can drive the CLI — that is the point. Rejected by design.
- **Opt-in `mutates_checkout`.** This repository's cleanliness gate is
  mandatory at three sites. Rejected.
- **Telemetry as a service feature.** Out of scope for a governed local
  pipeline; nothing to take.

## What would settle it

Nothing is adopted before the step-9 stop. Three decisions, in order of
cost:

1. **Greenfield** (this review's addition): one real whole-app smoke, or the
   seed-commit pattern declared, or the model-authored-spec split. Until
   then, greenfield is an assumption, and assumptions killed the predecessor
   project.
2. **Containment** (the `verification-containment.md` decision): Archon's
   container backend is the demonstrated pattern for the third option.
3. **Coverage variance** (if it recurs): prompt-side verbatim-copy fix
   first; structured coverage only as a replacement for the prose section,
   never a sidecar.

Related: `docs/proposals/sssf-harness-review.md` (same-session correction,
mid-flight tracing, run-process registry),
`docs/proposals/omniagent-harness-review.md` (gate-level loop detection),
`docs/proposals/verification-containment.md`, `ARCHITECTURE.md` sections 6
and 12, `docs/hazards.md` entries 3, 11, and 15.
