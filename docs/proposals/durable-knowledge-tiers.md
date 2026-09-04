# Durable knowledge tiers

## The gap

Knowledge produced in this repository is filed by **when it was created** —
a session record, a compaction pass, a backlog entry — and is never indexed
by **where it will be needed**. The result is that a developer standing at
the code a decision governs has no thread leading to that decision, and a
second developer on a second machine cannot reach part of it at all.

Three instances surfaced in a single debugging session on 2026-09-03, all
concerning one function, `coverageMeetsCriteria` in `src/plan-gate.ts`.

## What was observed

**1. A decision survived, its rationale did not.**
`.claude/sessions/project-learnings.md` today records, in the Steps 1-7
section, only this:

> "a genuine plan-coverage block came from the model dropping
> `(traces to: …)` suffixes"

The entry before commit `f094c0f` trimmed it read:

> **A genuine plan-coverage block.** The model dropped `(traces to: …)`
> suffixes when restating criteria and `coverageMeetsCriteria` held the full
> text. The gate was right; the prompt was not softened to pass.

The half that was cut is the half that carries the decision and its
reasoning. The surviving half is an anecdote. The text is still in git
history, so it is recoverable — but only by someone who already suspects it
exists and diffs eight compaction passes of a session file to find it.

**2. Durable lessons are promoted out of the repository, not into it.**
`project-learnings.md` (Diagnostics quick-reference) names roughly fifteen
lessons and then directs the reader elsewhere:

> "Durable one-liners live in **auto memory**, which loads automatically —
> read `MEMORY.md` there rather than duplicating it here."

Auto memory is harness-managed and machine-local; it is deliberately never
inside a repository. So a committed file enumerates fifteen lessons by name,
instructs the reader not to duplicate them here, and points at a store that
does not exist on any other machine. Compaction has been moving durable
material across that boundary on every pass, which strengthens one
workstation and weakens the repository each time.

Most *raw* facts do resurface elsewhere in-tree — `lastInsertRowid`,
`VERIFY_RETENTION_MAX_BYTES`, and the Windows `taskkill` quirk all appear in
code, tests, or docs. What does not survive is distilled judgement. The
lesson "one smoke is one sample" — step 6 passed its only smoke, the same
prompt blocked on the next run, so the path is uncharacterised — returns
zero hits anywhere in the repository.

**3. A complete, correct analysis existed in-tree and was not found.**
`docs/proposals/spec-kit-harness-review.md` already contains the recorded
step-7 coverage failure, three dispositions for it (prompt-side verbatim
copy; a reverse-direction gate check; stable criterion IDs with a single
minting authority), and a design constraint drawn from a predecessor
system's recorded drift failure. It also records a defect in the same
function that the 2026-09-03 session never independently found: the gate
checks only that every spec criterion has a coverage line, never that every
coverage line names a real criterion, so a plan can invent a criterion,
cover it, and pass.

That document is referenced by exactly one file in the repository —
`docs/proposals/README.md`. `src/plan-gate.ts`, `docs/hazards.md`, and
`ARCHITECTURE.md` contain no reference to it, to criterion IDs, or to the
coverage-variance question. Reaching it requires reading the backlog index
end to end on the chance that something there is relevant.

## Why this repository in particular

The whole thesis here is that evidence must be recorded where it will be
consulted, and that consultation must be enforced rather than assumed.
`docs/hazards.md` already implements exactly that tier: committed, mandatory
reading per `CLAUDE.md`, and `npm run check:docs` refuses a plan or review
under `docs/features/` that does not state which hazards it weighed. The
mechanism is built and proven.

It simply does not reach two places: the source files a hazard governs, and
the backlog where considered analyses accumulate. A second knowledge store
(auto memory) then grew up beside it with no such guarantees at all.

## Candidate directions

Roughly increasing in cost. Not a decision — this is backlog.

- **Back-link from the code to the analysis that governs it.** A doc comment
  on `coverageMeetsCriteria` naming the recorded step-7 failure and the three
  dispositions would have ended the 2026-09-03 investigation at its first
  file read. No mechanism, no schema, one comment per affected site. Cheapest
  by a wide margin, and it addresses instance 3 directly.
- **Promote a decided analysis into `docs/hazards.md` when it describes a
  failure that has actually occurred.** The step-7 coverage block is such a
  failure and is not a hazard entry. Hazards are already mandatory reading
  and already enforced; this moves qualifying material into the tier that
  has teeth, rather than inventing a new one.
- **Give durable lessons a committed home, and make auto memory a cache of
  it rather than the system of record.** Compaction's "trim" would mean
  *promote into the repository*, never *promote out of it*. Fixes instance 2
  and the dangling pointer in the Diagnostics quick-reference. Requires
  deciding what that committed home is — `docs/hazards.md` covers failures
  that occurred, but not every durable lesson is a failure.
- **Extend `check:docs`.** Candidates: flag a `docs/proposals/` entry that
  nothing but the backlog README references; refuse a `project-learnings.md`
  pass that removes a decision without recording where it went. Both are
  enforcement rather than convention, which is this repository's preferred
  shape — but both need a definition of "decision" precise enough to check
  mechanically, and that is the hard part.

## What would settle it

The cheap first move (back-links) can be judged on its own: apply it to
`coverageMeetsCriteria` and see whether the next investigator lands on the
existing analysis without being told it exists. The larger question — where
durable lessons live and what enforces their consultation — should not be
decided before the build order's step-9 stop without an explicit decision,
consistent with the stop's terms.

Related: `docs/proposals/spec-kit-harness-review.md`,
`docs/hazards.md` entries 3 and 16, `ARCHITECTURE.md` section 12,
`.claude/sessions/2026-09-03-debug-plan-coverage-gate-paraphrase-mismatch.md`.

## The evidence tier (added 2026-09-04)

The three instances above all concern *knowledge* — distilled judgement that
did not survive where it would be needed. A fourth instance surfaced on
2026-09-04 with a different shape and a sharper failure mode: **recorded
evidence that became load-bearing while living outside the repository.**

`docs/features/normative-removal-accounting/plan.md` was written, reviewed, and
committed with a task that read, in effect, "copy the retained reconciliation
response out of the scratch target into a repository fixture." The response was
real, it was exactly the contract test the plan needed, and depending on it was
correct. What was wrong was the tense. Until that copy happened, a committed
plan's task depended on a file at
`.../Temp/1/bw-run-skill/<timestamp>/target/.governance/raw/1/`, which:

- exists on one machine, for one user, and no teammate can obtain it;
- sits in an OS temp directory that may be cleared without notice;
- is deleted wholesale by a documented command, `driver.mjs clean`, which had
  already destroyed the `stats` run's per-dispatch record once; and
- is invisible to every check in the repository — `check:docs` verifies that
  cited paths resolve, and this path was never cited in a checkable form.

This is worse than the knowledge instances in one specific way. A lost lesson
degrades judgement, and a reader who suspects it exists can dig it out of git
history. Lost recorded output cannot be recovered at all: reproducing it means
a fresh paid dispatch, and the model may not produce the same shape twice.
`ARCHITECTURE.md` section 21 already makes replayed real output the
load-bearing verification category, which means the tier with the weakest
durability guarantees is the one the verification strategy leans on hardest.

### What was done about it

Two of the candidate directions above were acted on for this instance, and
both were cheap:

- **The extraction was pulled forward out of the plan.** The response now lives
  at `test/fixtures/recorded/plan-reconciliation-web-calculator.json` with a
  `provenance` block naming the run, the dispatch time, the capture date, what
  was dropped from the harness envelope, and the delta it demonstrates. It was
  verified from its committed location to reproduce the same result — 2 added
  nodes both claimed, 1 removed node claimed by nothing. The plan now reads
  that file and has no remaining machine-local dependency.
- **`CLAUDE.md` gained the direction-of-movement rule**, under Session
  continuity: the committed tier is the system of record, auto memory is a
  cache that may be added to but never traded against the committed file, and
  recorded evidence is copied into the repository the moment something starts
  depending on it rather than at a scheduled later step. This closes instance
  2's dangling pointer as a matter of rule rather than of whoever is
  compacting — the quoted Diagnostics text in instance 2 is preserved above as
  the observation it was, and the file it describes no longer points outward
  for content it does not carry.

### What is still open

- **Nothing enforces the provenance convention.** A fixture claiming to be
  recorded output is trusted on its comment. The natural extension is a
  `check:docs` rule: every file under `test/fixtures/recorded/` must carry a
  `provenance` block with a named run, capture date, and fidelity statement,
  and any test asserting against such a file must reference it by path.
  Roughly twenty lines in `scripts/doc-check.mjs`, break-testable against a
  scratchpad mirror per `.claude/skills/doc-check/SKILL.md`.
- **Nothing detects the failure at the moment it is introduced.** The plan sat
  committed for one session carrying a machine-local dependency, and only a
  question from the operator surfaced it. A checkable form would be to require
  that a plan task naming a path outside the repository state how that path
  becomes committed before the task's own gate.
- **The larger tier question is unchanged**: where durable non-failure lessons
  live in-tree, and what enforces their consultation. `docs/hazards.md` covers
  failures that occurred and has teeth; not every durable lesson is a failure.
  Per the terms of the build order's step-9 stop, that should not be decided
  without an explicit decision.
