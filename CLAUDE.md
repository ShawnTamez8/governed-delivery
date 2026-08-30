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

## Layout

- `ARCHITECTURE.md` — the design. Change it deliberately, not incidentally.
- `docs/hazards.md` — failures that have actually occurred, each costing real
  money. Read the relevant entry before implementing that area.
- `docs/proposals/` — backlog. Markdown, no enforced lifecycle.
- `docs/features/<slug>/` — active work. `design.md` is the only human-authored
  file; everything else is produced by a stage and `status.md` is a projection.
- `.governance/` — machine-local state. Gitignored. Never hand-edited.

## Session continuity

At session start, read `.claude/sessions/project-learnings.md` — it carries
decisions locked, running state, and open questions saved by the
context-compaction skill. The most recent entry is the current state; treat
it as the resume point for any work here.

## Commands

Run from the repository root. These commands live here and nowhere else.

- `npm install` — one-time: dev dependencies (`typescript`, `@types/node`);
  commits `package-lock.json`.
- `npm run typecheck` — strict `tsc --noEmit`.
- `npm test` — `node --test` (Node 24 type stripping; relative imports carry
  explicit `.ts` extensions).
- `npm run check:docs` — the documentation checker (`scripts/doc-check.mjs`);
  run before claiming a documentation change is consistent.
- `node src/cli.ts migrate|new-run|stage-add|stage-complete|dispatch|spec|plan|approval-request|approve|verify-audit`
  — the CLI; `bw` works once `npm install` links the bin.
- `node scripts/sign-approval.mjs keygen|sign` — the operator's signing tool.
  It holds the only private key path in the repository and the system never
  invokes it.
