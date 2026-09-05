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
finding says an ID is orphaned; the honest resolutions are to renumber, to
reinstate the missing criterion, or to say why the gap is deliberate. The document
schema permits the first two and silently forbids the third — and the
reconciliation prompt never states that the section admits nothing but
`- AC-NNN: …` lines.

That is hazard 3 with the constraint moved up a level. The prompt states the
*format of a criterion ID*, which the author obeyed for all twenty-four real
criteria; it does not state the *shape of the section*, so a line that is not a
criterion at all was never ruled out. A constrained field whose constraint the
prompt never states is the entry; the constrained thing here is the section's
membership rule.

The cost is not a warning: it is the whole run. The block is terminal, the repair
is a fresh chain, and a fresh chain against the same design, the same model, and
the same prompts may write the same note again.

## Candidate remedies, none applied

1. **State the rule in the prompts.** Add one sentence to the spec author,
   self-critique, and reconciliation prompts: every line under
   `## Acceptance criteria` must be a `- AC-NNN: …` criterion, and an explanation
   of a numbering decision belongs in the summary rather than in the section.
   Smallest change; consistent with hazard 3's remedy, which is always to state
   the constraint where the value is requested. Does not help a model that states
   it anyway.
2. **Let the validator tolerate a non-criterion line.** Skip lines that do not
   begin with `- ` before applying the ID rule, so prose under the heading is
   ignored rather than parsed as a criterion. Removes the terminal block, but
   widens what a specification may contain, and a tolerance added on the
   validator's side without the matching statement on the prompt's side is the
   one-boundary defect this repository keeps re-learning — so this is only
   correct *together with* remedy 1, never instead of it.
3. **Refuse earlier, with a message that names the rule.** Keep the refusal but
   have it say that the section admits only criterion lines, rather than reporting
   the prose as a malformed ID. Does not stop the block; makes the block
   diagnosable, and makes the operator's next move obvious.

Remedies 1 and 3 together are the smallest pair that leaves the contract honest:
the prompt states the rule, and the refusal names it when a model ignores it.
Whether to add remedy 2's tolerance is a product decision about what a
specification may contain, not a defect fix.

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

## Scope

This is a defect in a shipped stage, found while running the paid chain for
`docs/features/code-review-stage/plan.md` Task 10. It is unrelated to the
code-review stage, which the run never reached, and nothing in that plan was
changed to accommodate it. It blocks Task 10 in practice: until it is resolved,
reaching `code_review` on this design depends on the author happening not to write
a prose note.
