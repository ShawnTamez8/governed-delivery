# A prose note answering a numbering finding blocks the run

**Observed:** 2026-09-05, paid chain against the web-calculator design, run 1 of
target `bw-run-skill/1788578130692`. The run blocked at `spec_review` after five
dispatches and $0.41049.

**Hazards considered:** 3 is the entry this belongs to — a constrained field whose
constraint the prompt never states — extended from the format of a value to the
shape of a section. 7 bears on the consequence: a block whose repair is a fresh
run against the same design, model, and prompts varies nothing systematically, so
this defect costs a whole chain each time it fires. 16 bears on the shape of the
remedy: the reconciliation loop is aimed at the right artifact here, so this is
not an upstream-routing problem. 4 governs the evidence: the response is committed
rather than described.

## What happened

The spec panel raised two findings about a gap in the acceptance-criteria
numbering: `orphaned-acceptance-criterion-number` and
`acceptance-criteria-numbering-gap`, both at location `Acceptance criteria`.

The author's reconciliation revision answered them the most direct way the
document allows a human to answer them — by explaining the gap in place, as the
first line under the heading:

```
## Acceptance criteria

Note: AC-012 is intentionally unassigned. No requirement or criterion was
dropped; the ID was reserved in an earlier draft and numbering resumes at
AC-013 so that previously assigned criterion IDs are preserved unchanged.

- AC-001: ...
```

`validateSpecDoc` treats every line under `## Acceptance criteria` as a criterion,
so the explanation became a criterion whose ID is `Note`, and the stage refused:

```
spec.reconcile.invalid — spec reconciliation document refused:
invalid acceptance criterion ID Note:
must match ^AC-(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$
```

The run blocked. There is no remediation round for a refused reconciliation, so a
fresh run is the repair.

## Why this is a defect and not a model error

The author was asked to resolve a finding *about the numbering itself*. The
finding says an ID is orphaned; the resolutions available are to reinstate the
missing criterion or to say why the gap is deliberate. The document schema
permits the first and silently forbids the second — and the reconciliation
prompt never states that the section admits nothing but `- AC-NNN: …` lines.

Renumbering was listed here as a third honest resolution in the first draft of
this document, and that was wrong. The reconciliation and self-critique prompts
already require every existing obligation to keep its ID, so renumbering is
forbidden where it would be performed; and it is not free mechanically either,
since each renumbered criterion is one removed node plus one added node that
the reconciliation must claim and ground (`src/reconciliation.ts`,
`deriveRemovedNormativeNodes` and the claim accounting beneath it). The harm
available at this boundary is not to plan traceability — spec reconciliation
runs at stage 2, before any plan exists and before approval binds the spec
hash — but to the round itself: reviewers cite AC IDs as their finding
locations, so renumbering invalidates the locations of the very findings being
reconciled.

That is hazard 3 with the constraint moved up a level. The prompt states the
*format of a criterion ID*, which the author obeyed for all twenty-three real
criteria (AC-001 through AC-011 and AC-013 through AC-024; a count that returns
twenty-four has counted the note's third line, which begins `AC-013`); it does
not state the *shape of the section*, so a line that is not a criterion at all
was never ruled out. A constrained field whose constraint the prompt never
states is the entry; the constrained thing here is the section's membership
rule.

There is a second constraint the run exposed, upstream of this one. The finding
the author was answering should not have been raised: stable IDs leave gaps
whenever an obligation is withdrawn under the removal accounting, so a gap is
the ordinary residue of another guard rather than a defect — and
`buildSpecReviewPrompt` said nothing about stable-ID semantics, so the panel
had no basis to know that.

The cost is not a warning: it is the whole run. The block is terminal, the repair
is a fresh chain, and a fresh chain against the same design, the same model, and
the same prompts may write the same note again.

## Candidate remedies

Remedies 1, 3, 4 and 5 were applied on 2026-09-05 by
`docs/features/spec-section-membership/plan.md`; remedy 2 is rejected. The
list is kept in its original form, with the dispositions added, so what was
considered stays legible beside what was chosen.

1. **State the rule in the prompts.** Add one sentence to the spec author,
   self-critique, and reconciliation prompts: every line under
   `## Acceptance criteria` must be a `- AC-NNN: …` criterion, and an explanation
   of a numbering decision belongs in the summary rather than in the section.
   Smallest change; consistent with hazard 3's remedy, which is always to state
   the constraint where the value is requested. Does not help a model that writes
   it anyway.
2. **Let the validator tolerate a non-criterion line.** *Rejected, not
   deferred.* Skipping lines that do not begin with `- ` before applying the ID
   rule would remove the terminal block, but the list marker is optional in
   this schema, so the same skip silently drops an unbulleted `AC-001: …`
   criterion from the parsed document — after which the planning gate has no
   ID to require from the plan and the obligation leaves the run unnoticed.
   Whether a specification may ever carry an explanatory note is a product
   question that would need its own note syntax, one that cannot conceal a
   malformed criterion; it is not this defect's fix.
3. **Refuse earlier, with a message that names the rule.** Keep the refusal but
   have it say that the section admits only criterion lines, rather than reporting
   the prose as a malformed ID. Does not stop the block; makes the block
   diagnosable, and makes the operator's next move obvious.

4. **State the stable-ID semantics in the review prompt.** Tell the reviewer
   that criterion IDs are stable identifiers rather than a sequence, that a gap
   is expected wherever an obligation was withdrawn, and that a coverage
   finding names the missing design obligation and never a missing number.
   This is the only remedy that addresses why the author was answering a
   numbering finding at all; without it a different reviewer, or a different
   sample from the same one, raises the same non-defect again.
5. **Close `## Declared artifacts` on the same principle.** The sibling section
   has the same open membership and is worse: any non-empty line becomes a
   declared artifact, is signed into scope by `computeScope`, and can only fail
   at `delivery_check` because nothing was ever committed at that path. Close
   it on a whitespace rule rather than a list marker — two recorded provider
   responses write that section unbulleted, so a marker rule would refuse real
   output.

Remedies 1, 3, 4 and 5 are the set that leaves the contract honest: the prompts
state each section's rule, the refusal names it when a model ignores it, the
reviewer is not invited to raise the finding that started this, and the sibling
section is closed on the same principle rather than left to fail later and
further away. Remedy 2 is rejected above. The plan that implements this set is
`docs/features/spec-section-membership/plan.md`.

Because remedies 1, 4 and 5 change the prompts, a paid run after them varies
something systematically and is therefore a permitted experiment rather than
the bare retry hazard 7 refuses — which is what lifts the objection recorded
under "What happened" against re-running.

## Evidence

The reconciliation response is committed at
`test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json`
with a `provenance` block naming the run, dispatch time, capture date, what was
dropped from the harness envelope, and what was sanitized. It is a real provider
response, so it can drive a regression for whichever remedy is chosen rather than
a hand-written fixture standing in for one.

The retained target at `bw-run-skill/1788578130692` still holds the full run and
has not been cleaned, but it is machine-local: the committed fixture is the copy
anything may depend on.

The fixture's provenance lists two `effectiveModels`, and only one of them
wrote the response. `claude-sonnet-5` produced 6,857 output tokens including
4,124 thinking tokens for $0.115408 of the $0.11971 dispatch; the
`claude-haiku-4-5` entry produced 13 output tokens for $0.004302 and is an
auxiliary harness query. The effective authoring model is Sonnet 5, and nothing
here is evidence that two models authored one document.

Changing the model is an experiment, not a remedy for this defect. The frozen
profile maps every dispatching stage kind to the single value `new-run --model`
was given, so a run with a different model varies the whole author-and-panel
chain at once rather than isolating reconciliation behaviour.

## Scope

This is a defect in a shipped stage, found while running the paid chain for
`docs/features/code-review-stage/plan.md` Task 10. It is unrelated to the
code-review stage, which the run never reached, and nothing in that plan was
changed to accommodate it. It blocks Task 10 in practice: until it is resolved,
reaching `code_review` on this design depends on the author happening not to write
a prose note.
