# A coverage line naming two artifacts blocks the run

**Observed:** 2026-09-05, paid chain against the web-calculator design, run 1 of
target `bw-run-skill/1788668925127`. The run blocked at `plan_review` after ten
dispatches and $1.25141.

**Hazards considered:** 3 is the entry this belongs to — a constrained field
whose constraint the prompt never states — and it is the second instance of that
entry measured in two days, the first being
`docs/proposals/spec-reconciliation-prose-note-blocks-run.md` one document
earlier in the chain. 16 bears on the shape of the remedy and is the sharper
half here: three reviewers asked for a change the plan schema cannot express, so
no revision of the plan could have satisfied them, and a reconciliation loop
aimed at an artifact that forbids the answer cannot converge. 6 bears on the
gate's behaviour, which was correct: a coverage line naming a path outside the
signed scope is a promise a later stage cannot keep, and refusing it before
implementation is the point. 7 bears on the consequence: the repair is a fresh
chain against the same design, model and prompts, which varies nothing, so this
costs a whole run each time it fires. 4 governs the evidence: the response is
committed rather than described.

## What happened

The plan panel raised three findings, each saying that a coverage entry named
only one of the two artifacts that implement its criterion:
`coverage-entry-omits-required-artifact` at `AC-017`, and
`coverage-omits-implementing-artifact` at `AC-008` and at `AC-017`.

The author's reconciliation revision answered them the most direct way the
document allows a person to answer them — by naming both artifacts:

```
AC-008 -> src/index.html, src/calculator.js
AC-017 -> src/index.html, src/theme.js
```

Its summary says so plainly: "Expanded the AC-008 and AC-017 coverage rows to
list both implementing artifacts … resolving three traceability/consistency
findings about single-artifact coverage entries that omitted a second artifact
the task list already names."

`src/plan-doc.ts` splits a coverage line at the first `->` and takes the entire
remainder as one artifact target. The pair therefore became a single path,
`src/index.html, src/calculator.js`, which is not one of the four paths the
operator signed, and the planning gate refused:

```
plan.coverage.unkeepable — plan promises coverage outside the approved scope: AC-008; AC-017
```

The run blocked. There is no remediation round for a refused plan
reconciliation, so a fresh run is the repair.

## Why this is a defect and not a model error

Two things are wrong at once, and either alone would be survivable.

**The constraint is never stated.** The plan author, self-critique, and
reconciliation prompts give the coverage form as `- AC-001 -> <artifact path>`
and say to copy only the ID to the left of the arrow. They never say that the
right side admits exactly one path, that the path must be one of the approved
scope entries verbatim, or that a comma-separated list is not a path. An author
that has just been told a criterion has two implementing artifacts, and is
looking at a line whose right side is free text, will write both. That is hazard
3 exactly: a field deterministic code parses, whose shape the prompt requesting
it does not state.

**The finding is unanswerable inside the schema.** The planning gate requires a
bidirectional, unique relation — every approved criterion ID appears exactly
once. So one criterion cannot cite two artifacts, and a reviewer asking for a
second artifact on a coverage line is asking for something the document cannot
express. The author's only faithful moves were to reject the finding with a
rationale, or to route it upstream; both are correct and neither is obvious when
the prompt presents the coverage line as free text after the arrow. This is
hazard 16 at close range: the loop was aimed at an artifact whose schema forbids
the repair the finding requests.

The cost is not a warning: it is the whole run, at $1.25141 for this one.

## Candidate remedies

Remedies 1, 2 and 3 were chosen by the operator on 2026-09-06 and applied by
`docs/features/plan-coverage-single-artifact/plan.md`. Remedy 4 was not taken:
it changes what a plan may promise rather than fixing a defect, and it would
move both the planning gate's one-to-one relation and delivery's exact-path
proof. The list is kept in its original form, with the dispositions added, so
what was considered stays legible beside what was chosen.

1. **State the constraint in the three plan prompts.** One sentence: the right
   side of `->` is exactly one artifact path, copied verbatim from the approved
   scope, and never a list — a criterion implemented by several files cites the
   one artifact that carries the obligation. Smallest change, and hazard 3's
   standing remedy is always to state the constraint where the value is
   requested. Does not stop a model that writes a list anyway.
2. **Name the rule in the refusal.** `plan.coverage.unkeepable` currently reports
   the criterion IDs whose targets fell outside scope, which reads as "you chose
   the wrong file" when the actual fault is "that is not one path". Report the
   rejected criterion ID and the target received, and state that an artifact-form
   entry names exactly one signed-scope path. Does not stop the block; makes it
   diagnosable, exactly as the sibling defect's remedy 3 does.

   *As first written this remedy proposed emitting the rule only when the target
   contained a separator. The design review of 2026-09-06 rejected that: a path
   may legally contain punctuation, the check already holds the stronger
   evidence that the target equals no signed entry, and inferring the model's
   intent from prose is guessing. The rule is stated unconditionally, and the
   typed signal stays the branch point — nothing may depend on the text.*
3. **Tell the plan reviewers what the schema can express.** State in the plan
   review prompt that coverage is a one-to-one relation and that "this criterion
   also touches another file" is not a coverage finding. This is the only remedy
   that stops the finding being raised, and it is the analogue of the stable-ID
   sentence added to the spec review prompt for the sibling defect.
4. **Let a coverage entry carry several artifacts.** A product change, not a
   defect fix: it widens the relation the planning gate proves, changes what
   `coverageFitsScope` and delivery must check, and needs its own decision. Named
   here so that choosing 1-3 is visibly a choice and not an oversight.

Remedies 1, 2 and 3 are the set that matches how the sibling defect was closed:
the prompt states the rule, the refusal names it, and the reviewer is not invited
to raise a finding the schema cannot answer. Remedy 4 is a separate question
about what a plan may promise.

## Evidence

The reconciliation response is committed at
`test/fixtures/recorded/plan-reconciliation-web-calculator-multi-artifact-coverage.json`
with a `provenance` block naming the run, the stage, the dispatch time, the
capture date, the cost, the effective models, what was dropped from the harness
envelope, and what was sanitized. It is a real provider response, so it can drive
a regression for whichever remedy is chosen rather than a hand-written fixture
standing in for one.

The retained target at `bw-run-skill/1788668925127` still holds the full run and
has not been cleaned, but it is machine-local: the committed fixture is the copy
anything may depend on.

## Scope

This is a defect in a shipped stage, found by the paid run that proved
`docs/features/spec-section-membership/plan.md`. Nothing in that plan touches
`src/plan-doc.ts` or any plan prompt builder, and nothing in it was changed to
accommodate this. It blocks nothing that plan claimed; it does block reaching
`code_review` on this design, and so it now stands where the spec-side defect
stood yesterday with respect to
`docs/features/code-review-stage/plan.md` Task 10.
