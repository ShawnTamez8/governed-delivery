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

## Commands

Nothing is built yet. When there is a build, its commands go here and nowhere
else.
