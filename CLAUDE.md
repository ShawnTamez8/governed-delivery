# Working rules

## Source of truth

`ARCHITECTURE.md` is the design. `docs/hazards.md` records failures that have
actually occurred in systems of this kind. Build from those two documents, and
do not import patterns from other codebases on this machine — they were
written against different constraints and carry assumptions this design rejects.

## The architecture is binding

The hard rules are constraints, not aspirations:

1. One harness until one run completes end to end.
2. One surface — a CLI calling the core directly. No second entry point.
3. One schema per thing. No unions, no version discriminators, no compatibility
   handling. Nothing has shipped.
4. No abstraction without two real implementations.
5. No hand-written fixture may define correctness.
6. Config is frozen at run start.

The build order has a deliberate stop at step 9 — one complete run with
queryable cost. Do not build past it without an explicit decision.

## How to work here

**Trace before asserting.** A predicate named `isCurrent` or `isLegacy` tells
you nothing about which branch is live. Find the callers and the construction
sites before describing behaviour. Confident inference from plausible names was
the single largest source of wasted effort in work of this kind.

**Read the whole file before editing it.** The Read tool returns a bounded
window — repeat with `offset` until every line of the file you will change
has been seen. A token-minimal read that unlocks an edit is not reading the
file. Never edit on the basis of `head`/`tail`/`sed` slices, and a
programmatic patch (`read()` + `replace()`) is only legitimate after you
have viewed the full contents.

**Prove a guard by breaking what it guards.** A test that passes on first write
has shown only that your reading matched the code. Change the behaviour, confirm
the test fails, restore. Until then, report assertions as written, not verified.

**Expected values come from outside your own head.** A schema, a response
recorded from a real run, or a stated requirement in the design document. Never
a value invented in the same session as the code that consumes it. This is the
rule that prevents tests and implementation from agreeing with each other while
both are wrong.

**State which hazards you weighed.** Every plan and every finding
reconciliation under `docs/features/` carries a `**Hazards considered:**` line
naming the `docs/hazards.md` entries it weighed — including `none`, with a
reason, when that is the answer. Silence is the failure mode: an entry nobody
consulted and an entry considered and found irrelevant look identical
afterwards. `npm run check:docs` refuses a document without it.

**Say what is unverified.** Severity is a claim about reachability. Do not label
something critical without naming the configurations that reach it.

**Tasks are state, not documents.** Never create a new `tasks.md`. The only
exceptions are the exact historical bootstrap records at
`docs/features/delivery-check/tasks.md`,
`docs/features/step6-trust-boundary/tasks.md`, and
`docs/features/verification-stage/tasks.md`. Keep them as history, not
templates. A plan's `## Tasks` section uses plain list items, never Markdown
status checkboxes; execution and completion status belong in run-state database
rows. `npm run check:docs` enforces both rules — and exempts, by exact path,
those three task records plus the eleven bootstrap `plan.md` files that already
carried checkboxes when the rule landed. Both allowlists are closed: a new
document never joins either one.

## Layout

- `ARCHITECTURE.md` — the design. Change it deliberately, not incidentally.
- `docs/hazards.md` — failures that have actually occurred, each costing real
  money. Read the relevant entry before implementing that area.
- `docs/proposals/` — backlog. Markdown, no enforced lifecycle.
- `docs/features/<slug>/` — active work. That is the design: `design.md` is the
  only human-authored file, everything else is produced by a stage, and
  `status.md` is a projection. No stage writes there yet. Every directory
  present today is bootstrap work on BuildWorks itself — a hand-written
  `plan.md`, dated review records, and the three grandfathered task documents
  named above. Do not read them as stage output or create new task documents
  from their shape.
- `.governance/` — machine-local state. Gitignored. Never hand-edited.

Plans and review records carry a `**Status:**` line. A plan is `Implemented`
once it has shipped and `Reconciled` when it has absorbed its reviews but
nothing is built; a review record is `reconciled` once every finding carries a
disposition. Nothing enforces these values — `check:docs` does not read them.

## Session continuity

At session start, read `.claude/sessions/project-learnings.md` — it carries
decisions locked, running state, and open questions saved by the
context-compaction skill. The most recent entry is the current state; treat
it as the resume point for any work here.

**The committed tier is the system of record. Knowledge moves into the
repository, never out of it.** Harness auto memory is a cache: it is
machine-local, per-user, and keyed by clone path, so the same person cloning to
a different directory gets an empty store and a second developer never sees it
at all. A compaction pass may mirror a durable one-liner into auto memory in
addition to the committed file; it may never delete one from the committed file
on the grounds that memory now holds it, and it may never leave the committed
file pointing at memory for content memory alone carries. That trade already
cost this repository a decision — see `docs/proposals/durable-knowledge-tiers.md`.

**Recorded evidence is copied into the repository the moment it becomes
load-bearing.** Retained model output under a run's `.governance/raw/` or a
`driver.mjs` scratch target is machine-local, lives in a temp directory, and is
deleted wholesale by `driver.mjs clean`. When a test, plan, or finding starts to
depend on one of those responses, extract it into `test/fixtures/recorded/`
with a `provenance` block naming the run, the dispatch time, the capture date,
and what was dropped from the harness envelope — then depend on the committed
copy. Never schedule that extraction for later: "later" is a machine-local
dependency a teammate cannot execute. Query a run's store before cleaning it;
`clean` deletes the only record.

## Commands

Run from the repository root. These commands live here and nowhere else.

- `npm install` — one-time: dev dependencies (`typescript`, `@types/node`);
  commits `package-lock.json`.
- `npm run typecheck` — strict `tsc --noEmit`.
- `npm test` — `node --test` (Node 24 type stripping; relative imports carry
  explicit `.ts` extensions).
- `npm run check:docs` — the documentation checker (`scripts/doc-check.mjs`);
  run before claiming a documentation change is consistent.
- `node src/cli.ts migrate|new-run|stage-add|stage-complete|dispatch|spec|plan|implement|verify|deliver|approval-request|approve|verify-audit`
  — the CLI. There is no `bw` on PATH after `npm install`: npm does not link a
  private package's own bin, and `node_modules/.bin/` holds only `tsc` and
  `tsserver`. Invoke the file. Note that the CLI governs the repository it is
  run *in*, so running it here creates runs against this repository — use a
  scratch target instead.
- `node .claude/skills/run-buildworks/driver.mjs smoke` — builds that scratch
  target and drives the CLI against it, spending nothing. `paid --yes` drives
  the full chain against the real `claude` binary and reports what it cost.
  See `.claude/skills/run-buildworks/SKILL.md`.
- `node scripts/sign-approval.mjs keygen|sign` — the operator's signing tool.
  It holds the only private key path in the repository and the system never
  invokes it.
