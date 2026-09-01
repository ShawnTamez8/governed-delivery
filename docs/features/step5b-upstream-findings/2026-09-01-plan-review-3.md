# Step 5b Author-Led Review Plan — reconciliation audit

**Reviewed document:** `plan.md`
**Prior reviews:** `2026-08-31-plan-review.md` and `2026-08-31-plan-review-2.md`
**Document type:** Plan review
**Review date:** 2026-09-01

**Hazards considered:** 1 (the proposal candidate and rejection grounding are model-returned fields and need the same fail-closed parsing as the rest of reconciliation), 2 (per-reviewer reports, decisions, raw output, and artifact hashes must survive independently of overwritten projections), 3 (classification, upstream location, panel specialties, proposal fields, and grounding must be stated in every prompt that requests them), 4 (the prototype must exercise the storage and prompt contracts rather than let fixtures define them), 7 (round-scoped evidence must not become another indistinguishable retry), 11 (required and requested specialties share a bounded panel and the default must remain staffable), 12 (panel and round policy remains frozen and must be the value the selector reads), 13 (an author must not be able to dismiss an invented-obligation finding with an ungrounded sentence), and 14 (self-critique remains an author dispatch and never a panel seat). Entries 5, 6, 8, 9, 10, and 15 remain outside this correction for the reasons recorded in `plan.md`.

---

## Summary

The rewritten plan maps every finding from the first two reviews to a named task, but five mappings are not executable as written. The plan promises immutable per-reviewer reports while retaining a storage identity that overwrites them; asks a specification reviewer to locate an omission in a design it never receives; defines proposal persistence without defining the proposal-producing result; does not enforce the distinct-specialty panel Review 2 requires; and postpones the binding architecture decision until after production behaviour has been implemented.

The `Reconciled` status is a valid repository status, but the two reconciliation stamps' zero-open claim is not yet supported by the tasks below. These findings must be reconciled into the single existing plan before production implementation begins.

## Verdict

**Not ready for implementation; ready for in-place reconciliation.** Preserve both earlier reviews unchanged, update `plan.md`, and retain this audit as the third review record. No second implementation plan or spike document is needed.

## Required changes

### 1. Preserve canonical finding identity and immutable reviewer reports as different things

Review 2 requires every reviewer's severity and classification to survive together. The plan repeats that requirement but Task 7 retains `finding`'s current unique identity and upsert. Today `UNIQUE (stage_id, intent_key, location)` plus `ON CONFLICT ... DO UPDATE` replaces the prior row's `agent_run_id`, severity, and subject. The mixed `critical/current_artifact` plus `low/upstream` case therefore cannot reach the reconciler unfused.

The storage contract must separate:

- one round-scoped canonical finding identity;
- one immutable report per reviewer against that finding, preserving severity, classification, subject, and producing `agent_run`;
- one reconciliation decision per canonical finding.

The prototype and migration task must also cover the same concern appearing in a later configured round. A test in Task 9 is too late to settle the schema Task 7 already committed.

### 2. Ground upstream specification findings in the design input

Task 6 says a specification reviewer should name an upstream design section while also saying the reviewer never sees `design.md`. The shipped `buildSpecReviewPrompt` receives only the specification. A reviewer cannot distinguish “the design omitted this decision” from “the spec author omitted a stated design obligation” without the design, and an absent obligation has no section to name.

The spec reviewer and spec reconciler must receive the design input. Upstream locations need an exact stable syntax that does not invent a missing heading. Plan review can use the approved specification already present in its prompt; specification review needs the equivalent grounding added.

### 3. Define the proposal-producing result, not only the stored proposal

Task 6's reconciliation result carries a revised artifact, disposition, and rationale. Task 8 then requires a proposal title, problem statement, upstream explanation, impact, and source links. No prompt or parser says where the first three fields come from.

Make the proposal candidate a conditional part of the reconciliation decision. Require it exactly for `upstream_follow_up` and `upstream_blocking`, forbid it for the other dispositions, and derive `follow_up | blocking_dependency` deterministically from the disposition rather than asking the model for the same route twice.

### 4. Make the specialist-panel rule complete

Review 2 requires distinct specialties and prompts limited to the assigned specialty. Task 5 currently guarantees distinct agent identities only. It also does not define how configured required specialties and author-requested specialties consume the requested panel size.

The plan must state that required specialties count as seats; the union of required and requested specialties is unique and cannot exceed the requested size; every selected reviewer has a distinct specialty; and an unstaffable union blocks without shrinking or silently dropping a requested lens. With the default size of two and requirements-traceability required, only one additional specialty fits. SQL and UI together therefore require a configured size of at least three and registered agents for both. Reviewer prompts must say to report findings only within the assigned specialty.

### 5. Put the approved architecture decision before conflicting production work

`ARCHITECTURE.md` is binding today. Its sections 12 and 13 still require a panel closure pass and say the author does not resolve its own finding. Task 10 changes those sections only after Task 9 implements the opposite behaviour.

The prototype may precede the architecture decision because it runs outside production. Once its exit confirms the design, the operator-approved amendments to sections 12 and 13 must land before Tasks 3 through 9. Final schema facts, README wording, hazard count, and checker derivations may still follow implementation in Task 10.

The architecture amendment must preserve “agents propose; the system decides”: the author proposes a typed disposition, while deterministic code validates completeness, grounding against the governing upstream input, proposal requirements, mechanical artifact gates, and the resulting route before changing stage state. The current artifact cannot ground its own rejection. An ungrounded `rejected_with_rationale` becomes `cannot_determine` and blocks for a human. This keeps the operator's any-severity rejection decision without weakening hazard 13 into a sentence the author can satisfy from its own head.

---

## Reconciliation

**Date:** 2026-09-01

**Disposition:** 5 accepted, 0 rejected, 0 deferred, 0 open

**Status:** reconciled

### Verdicts

- **Accepted — preserve canonical findings and reviewer reports separately:** `plan.md` now fixes the entity contract before schema work: round-scoped canonical findings, immutable per-reviewer reports, and one decision per canonical finding. Tasks 1, 6, 7, 9, and 11 cover mixed reports and the same concern in multiple rounds.
- **Accepted — ground specification upstream findings:** Task 6 now passes the design to specification reviewers and the specification reconciler, defines stable upstream location tokens for missing decisions, and pins both the source and generated prompts.
- **Accepted — define the proposal-producing result:** Task 6 now carries a conditional proposal candidate inside each upstream reconciliation decision; Task 8 derives impact from the disposition and persists the validated candidate rather than inventing fields downstream.
- **Accepted — complete the specialist-panel rule:** Tasks 3 and 5 now enforce distinct specialties, seat accounting across required and requested specialties, the default panel's one-additional-lens consequence, and reviewer prompts limited to their assigned specialty.
- **Accepted — put architecture authority before production behaviour:** Task 1 now ends with the operator-approved sections 12 and 13 amendment after the prototype confirms the design and before Tasks 3 through 9. Task 10 retains only final factual documentation and checker alignment. Rejected findings require grounding against the governing design or approved specification that deterministic code can verify; the current artifact cannot ground itself, and absent or invalid grounding blocks as `cannot_determine`.

---

## Reconciliation addendum — review of this record

**Date:** 2026-09-01

**Reviewed by:** `2026-09-01-plan-review-3-review.md`

**Status after reconciliation:** `plan.md` remains `Reconciled` and is cleared to begin Task 1's bounded prototype. Production Tasks 3 through 9 remain closed until Task 1 confirms the design, the operator accepts the authority change, and architecture sections 12 and 13 are amended.

**Attribution correction:** The specialist-panel changes live in Tasks 3, 5, and 6. Task 3 owns frozen configuration and configuration-time staffing; Task 5 owns seat accounting and deterministic distinct-specialty selection; Task 6 owns the specialty-only reviewer prompts.

**Prior-review linkage:**

| This record | Prior finding completed |
|---|---|
| Finding 1 — canonical finding/report/decision separation | Review 1's upsert-return, cross-report fusion, final-table constraint, and round-ratchet findings; Review 2's immutable-report and mixed-pair requirements |
| Finding 2 — design-grounded specification review | Review 1's upstream-location and spec-review `current_artifact` findings; Review 2's governing-input/no-invention requirement |
| Finding 3 — proposal-producing reconciliation result | Review 2 required change 4 and its proposal-dedup high-risk area |
| Finding 4 — complete specialist-panel rule | Review 2 required change 3, distinct-specialty verification, and specialty-only prompt high-risk area |
| Finding 5 — architecture before production behaviour | Review 2 required change 2 and the Task 1 prototype/decision ordering in required change 5 |

**Grounding limit:** Exact-match validation proves only that the cited excerpt occurs in the governing design or approved specification. It cannot prove that the excerpt logically supports the rejection. Semantic sufficiency remains the author/reconciler's judgment and is retained for audit; a textually matching but semantically weak rationale can advance under the operator-selected author-led policy.

**`addressed` asymmetry:** `addressed` has no independent semantic confirmation. Deterministic code proves reconciliation completeness, before/after hashes, and the mechanical artifact gates; it does not prove that the change cured the reviewer's concern. This is the same deliberate removal of default closure review, not a hidden deterministic guarantee.
