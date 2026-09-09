# Plan coverage single-artifact run block — design review

**Reviewed document:** `docs/proposals/plan-coverage-single-artifact-blocks-run.md`  
**Document type:** Design with feature behavior  
**Review date:** 2026-09-06  
**Status:** reconciled

**Hazards considered:** 3 is the entry the reviewed proposal belongs to, and
this review sharpened it in the direction the entry itself points — a rule
stated as a shape with no semantics is not stated. 16 bears on the reviewer
half: a request the schema cannot keep is unanswerable, and the review is what
insisted the redirect name where the concern *can* be reported. 13 bears on the
suppression risk that redirect avoids. 6 governs the gate the medium concern
constrains: the typed signal stays the branch point and the message stays
prose. 4 governs the regression the review requires, fed by the committed
recorded response. 1, 2, 5, 7-12, 14, 15, 17 and 18 bear on nothing in a review
of this proposal.

---

## Dispositions (2026-09-06)

**This review was written before the implementation plan and was not read until
after the paid run.** The plan and the first implementation were built from the
proposal alone. Two of the findings below say that produced the wrong thing, and
both were corrected afterwards rather than caught in time; the cost of the miss
was one $0.08103 run that blocked upstream for an unrelated reason, so no work
was lost to it, but that is luck rather than process. All findings are accepted.

- **HR-1, remedy 3 makes an unstated product decision — accepted, and it was
  the real gap.** The plan defined the coverage line's *shape* and never its
  *meaning*, so an author told to name one path out of several contributing
  files had no stated basis for choosing. The amendment is adopted verbatim in
  `ARCHITECTURE.md` section 8: each criterion has exactly one entry, an
  artifact-form entry names exactly one signed-scope path, and that path is the
  criterion's representative delivery anchor rather than an exhaustive list.
  All four plan prompts now carry the same wording, plus the selection rule the
  review supplied — the declared artifact most directly responsible for the
  criterion's observable outcome. The reviewer instruction now redirects missing
  implementation work to the plan's tasks instead of only declining it, which is
  what keeps the rule from reading as a silence.
- **HR-1's "one-to-one" correction — accepted.** The phrase was wrong: several
  criteria may name the same path, and fourteen do in the recorded plan. An
  independent code review caught the same error separately in the first
  implementation. Both `ARCHITECTURE.md` and the review prompt now say the
  uniqueness proved is one entry per criterion, never one criterion per file.
- **Medium, remedy 2 should not infer a list from punctuation — accepted, and
  this reverses what was built.** The first implementation emitted the
  membership rule only when the target matched a separator pattern; an
  independent review then widened that pattern rather than questioning it. The
  check now states the rule unconditionally: a path may legally contain
  punctuation, the check already holds the stronger evidence that the target
  equals no signed entry, and the rule is true in the ordinary case too. The
  typed `unkeepable` list remains the only thing callers branch on, and a test
  asserts both refusals carry the identical sentence so nothing can come to
  depend on distinguishing them.
- **Medium, model variation is an exposure, not a contract — accepted.** No
  delimiter-specific handling survives, and the enforcement is exact scope
  membership, which is model-independent.
- **Missing area 1, how an author chooses the representative artifact —
  accepted**, in the review's own words, in all three authoring prompts.
- **Missing area 2, regression coverage for all four prompts — accepted.** Each
  phrase is asserted against each builder's rendered prompt, not only in the
  file-wide source scan, and each was proved by deleting it from one builder at
  a time.
- **Missing areas 3 and 4, replay the recorded fixture, cover both paths —
  accepted.** The committed response is replayed through `validatePlanDoc` and
  `coverageFitsScope` against the scope that run signed; an exact signed-scope
  artifact passes, and both a comma-joined pair and an ordinary out-of-scope
  path fail with the same typed refusal.
- **Verdict note, do not spend on another paid run until the deterministic
  fixture and local gates pass — honoured on the gates, missed on the review.**
  Typecheck, doc-check, the full suite and the smoke chain all passed before the
  run, and an independent code review was reconciled first; this document was
  not read, which is the failure worth recording.

---

## Summary

Remedies 1–3 are the right-sized response to the observed paid-run failure and should be planned as one coherent defect fix. Remedy 1 teaches authors the scalar coverage shape, remedy 2 makes the same rule actionable at the enforcement boundary, and remedy 3 stops reviewers from requesting a representation the schema cannot keep. Building only one or two preserves the one-boundary inconsistency that caused this run to fail.

The proposal is not ready to implement exactly as written. It must first define the meaning of the single artifact and correct the phrase “one-to-one coverage.” The current contract requires every acceptance criterion exactly once and stores one scalar artifact per entry, but it permits several criteria to point to the same artifact. The relation is therefore one entry per criterion, not one-to-one. The architecture also does not yet state whether the artifact is exhaustive implementation traceability or a representative evidence anchor when several files contribute to one criterion.

Remedy 4 should remain a separate product decision. Supporting multiple artifacts changes the persisted plan shape, scope checking, downstream consumption, and tests. The paid response proves a prompt-contract defect; it does not establish a need for a multi-artifact schema.

## Verdict

**Ready for planning after required changes.** Adopt remedies 1–3 together after defining single-artifact semantics in the binding architecture and removing separator-based guessing from remedy 2. Do not add another review round: `src/plan-stage.ts` applies the reconciliation scope gate before another round could occur, so an unchanged retry cannot remediate this refusal.

## Critical issues

No critical issues.

## High-risk areas

### Remedy 3 currently makes an unstated product decision

The reviewer instruction says coverage is “one-to-one” and treats a second contributing file as outside the review contract. `ARCHITECTURE.md` requires every approved criterion exactly once and separately constrains each target to signed scope, while `src/plan-doc.ts` stores one artifact string. Neither source says that this string is a non-exhaustive representative anchor. For criteria such as AC-017, both the HTML control and JavaScript behavior can be necessary to deliver the observable outcome; suppressing a reviewer’s concern without defining what the selected path represents weakens traceability by prompt alone.

Before implementation, amend the proposal and the relevant architecture contract to say:

> Each acceptance criterion has exactly one Coverage entry. An artifact-form entry names exactly one path copied from signed scope. That path is the criterion’s representative delivery anchor, not an exhaustive list of every contributing file. Multiple criteria may name the same path.

Use the same meaning in the author, self-critique, reconciliation, and reviewer prompts. Tell reviewers to report missing implementation work against the plan’s tasks, but not to request extra paths in a scalar Coverage entry.

## Medium and low concerns

### Remedy 2 should not infer a list from punctuation

The proposed diagnostic depends on detecting a comma or another separator. A repository path can legally contain punctuation, and the validator already has stronger evidence: the complete right-hand side does not exactly equal any signed-scope path. Return the rejected criterion ID and received target from the scope check, then report that an artifact-form entry must contain exactly one signed-scope path. This gives the operator the membership rule without parsing human prose or guessing the model’s intent.

Keep the machine signal typed. Do not make later behavior depend on matching the diagnostic text.

### Model variation is an exposure, not a contract

The recorded response shows that the selected provider models can express reviewer feedback as a comma-separated list. Other models may choose prose, conjunctions, or a different delimiter. Remedies 1–3 reduce that model-style sensitivity only if the validator enforces exact scope membership and the prompts state the same semantic rule; examples or delimiter-specific handling alone will remain model-dependent.

## Missing and underspecified areas

- Define how an author chooses the representative artifact when several files contribute. “The declared artifact most directly responsible for the criterion’s observable outcome” is sufficient prompt guidance; the gate need not infer relevance.
- Require regression coverage for all four affected prompts: plan author, self-critique, reconciliation, and review. The author-side rule alone does not prevent a reviewer from reintroducing the invalid request.
- Replay the committed real-provider reconciliation fixture through the relevant parsing and scope path. The test should prove that the response receives the new actionable refusal, while a corrected single-path response passes.
- Cover both accepted and rejected paths: one exact signed-scope artifact succeeds; a comma-separated pair and an ordinary out-of-scope path fail with the typed scope refusal and an actionable message.

## Suggested improvements

Revise the proposal, then write one implementation plan containing remedies 1–3 as a single contract-alignment change. Make the architecture statement, four prompt updates, typed scope diagnostic, and recorded-response regression tests explicit plan obligations. Keep remedy 4 in the backlog, and do not spend on another paid run until the deterministic fixture and full local gates pass.
