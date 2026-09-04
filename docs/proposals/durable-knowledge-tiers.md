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
