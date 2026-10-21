# Inspectable frozen profiles - review

**Reviewed document:** `plan.md`
**Document type:** Plan
**Review date:** 2026-10-20
**Status:** reconciled
**Hazards considered:** 4 (fixture independence and meaningful break-tests), 5 (delivery evidence remains bound to its authorization), and 12 (configuration projection must preserve its consumer contract). Architecture sections 3, 14 and 19 constrain schema handling, predecessor verification and inspection. The remaining hazards do not apply: this review changes no prompt, provider dispatch, stage, sandbox, retry or delivery mechanism.

---

## Summary

The plan identifies the correct shared snapshot boundary and preserves the execution refusal independently of evidence inspection. Its field classification contradicts its own projection rule, and its proposed integration fixtures introduce an unrelated approval mismatch that their assertions do not detect.

## Verdict

**Ready for planning after required changes** - Resolve the projected-field validation and fixture-binding risks before implementation. The two medium concerns tighten the proof and type boundary without requiring a different architecture.

## Critical issues - must fix before implementation

No critical issues found.

## High-risk areas

**Risk:** H1 - The execution-only list includes fields that inspection projects

- **Why:** The Assumptions and Approach sections, followed by Task 1, classify `narrationCheck` and `verification.derived` as execution-only while explicitly acknowledging that `runConfiguration` reads them. Optional chaining only handles absence; it does not validate present values. `src/operator-state.ts:294,301` copies both values directly into the snapshot. The proposed predicate therefore accepts a hash-matching profile with a non-array `verification.derived`, which the current predicate rejects.
- **Impact if ignored:** For a profile with that malformed field and an otherwise inspectable shape, status emits configuration that violates `RunConfiguration`; the dashboard calls `.map` on `derivedArtifacts` at `src/dashboard/app.js:3448` and fails. An in-memory probe of the existing projection with `derived: {}` reproduces `configuration.derivedArtifacts.map is not a function`. This is a malformed, hash-matching input case, not evidence that crew-chatter run 7 contains such a value. A hash proves byte identity, not the projected shape.
- **Mitigation:** Make the list agree with the stated rule. Keep validation for fields that inspection exposes, or specify separate absence and present-value rules that preserve the snapshot contract. The observed missing-`sandbox` case does not require removing either projected field's validation. Include a negative case for a present, malformed projected field.

**Risk:** H2 - Re-hashing the completed fixture invalidates its recorded approval

- **Why:** Task 2 removes `sandbox` and updates `profile_ref` only after `withDeliveredRun` or `withBoundary(10, ...)` completes. Both helpers insert an approval whose `profile_hash` names the earlier bytes. `interpretBoundary` checks that hash against `run.profile_ref` at `src/operator-state.ts:723`. The resulting fixture therefore describes an authorization mismatch, not merely a historical execution-only omission.
- **Impact if ignored:** The success assertions can pass despite that mismatch. The current interpreter records the approval error but assigns `delivery.deliveredCommit` later from its handoff checks; `checkAfter` accepts a non-null delivered commit without requiring an empty reason list. The proposed test thus demonstrates acceptance of contradictory evidence and does not isolate the promised inspection fix. This observation concerns the new test's validity; it does not authorize changing predecessor or delivery policy.
- **Mitigation:** Specify a self-consistent historical fixture: its approval must bind the exact profile bytes under inspection. A test-only transformation must keep the related hash bindings coherent, or use retained historical evidence. Assert that the completed snapshot has only the expected execution-shape refusal and no approval or handoff mismatch. Never repair an actual stored run to manufacture this condition.

## Medium and low concerns

- **M1 - The returned-profile break-test targets the wrong guard.** Task 2 predicts that returning `evidenceProfile` makes the `run-command` refusal test fail. `advanceRun` calls `boundaryResult()` before inspecting `observed.profile` (`src/run-command.ts:142-144`); the retained `profileReason` already makes the boundary ineligible. That refusal test therefore still passes under the specified mutation. Target the direct snapshot assertion `profile === null` instead, and keep the run-command case as separate no-dispatch evidence.
- **M2 - The inspection loader promises an executable type it does not validate.** Task 1 gives `loadInspectableProfile` the same successful return type as `loadVerifiedProfile`, namely `Profile`, although it intentionally accepts an object without required members such as `sandbox`. This allows an inspection result to satisfy execution-oriented signatures without a type error. Specify a read-only structural projection of the existing schema and the corresponding evidence-consumer parameter types. Preserve one stored schema; do not add a version union, defaults or a migration.

## Missing and underspecified areas

- H1 needs an explicit decision on missing versus malformed projected values; a general label of execution-only does not define that boundary.
- H2 needs the historical fixture's approval/profile hash invariant and the allowed reason set. Checking only delivered commits and ineligibility does not establish valid evidence.

## Suggested improvements

- Keep the first regression narrowly focused on missing `sandbox`, the observed incompatibility. Broader omission support needs its own explicit inspection contract rather than inheriting authorization from this incident.

---

## Reconciliation

**Date:** 2026-10-20
**Disposition:** 4 accepted, 0 rejected, 1 deferred, 0 open (the two missing-area items are folded into H1 and H2)
**Status:** reconciled

Each finding was checked against the code before its disposition was recorded.

### Verdicts

- **Accepted — H1, the execution-only list includes projected fields (with the H1 missing-area item):**
  - Evidence: `runConfiguration` copies `narrationCheck` and `verification.derived` into the snapshot (`src/operator-state.ts:294,301`), and the dashboard maps `derivedArtifacts` (`src/dashboard/app.js:3448`). Today `invalidProfileReason` rejects a non-array `derived` and a malformed `narrationCheck` (`src/profile.ts:482,526`).
  - Plan change: both checks stay in the inspectable predicate, and the execution-only list is now `after` and `sandbox`. The rule names the whole snapshot path, and projected fields keep their present-value validation. Task 1 gains negative tests for `derived: {}` and `narrationCheck: {}`, and a break-test that moves the `derived` check.
  - The operator chose to keep `after` execution-only under the written rule rather than narrow the list to `sandbox`.
  - A read-only check of crew-chatter's stored profiles showed that run 7 lacks only `sandbox`, so the fix still reaches it. Runs 1 to 4, which lack `derived`, stay uninspectable by name.
- **Accepted — H2, re-hashing the fixture invalidates its approval (with the H2 missing-area item):**
  - Evidence: both helpers insert the approval with the `profile_ref` of that moment (`test/run-intake.test.ts:447`, and the same in `withBoundary`), and `src/operator-state.ts:723` compares the two. `delivery.deliveredCommit` is assigned independently at line 895, and `checkAfter` reads only that commit.
  - Plan change: Task 2 now specifies a coherent historical fixture. After re-hashing, the approval's `profile_hash` is updated to the same hash with the `UPDATE` the existing "profile binding" case uses. Both tests assert exactly one `evidence_invalid` reason and no `inconsistent` evidence. A new negative test shows that skipping the approval update adds the approval-mismatch reason.
  - `checkAfter` and delivery policy are unchanged, and no real stored run is edited.
- **Accepted — M1, the returned-profile break-test targets the wrong guard:**
  - Evidence: the profile reason makes `workflowAction.eligible` false (`src/operator-state.ts:466,475`), so `boundaryResult()` refuses before `observed.profile` is read (`src/run-command.ts:142-144`).
  - Plan change: the break-test now targets the `operator-state` assertion `profile === null`. The `run-command` test is kept as no-dispatch evidence, with the reason it cannot catch the mutation.
- **Accepted — M2, the inspection loader promises an executable type:**
  - Evidence: the inspectable profile reaches `requireFrozenBinding` and `parsePassedCodeReviewRecord`, both typed `Profile`, and neither reads `after` or `sandbox`.
  - Plan change: `loadInspectableProfile` returns `InspectableProfile = Readonly<Omit<Profile, "after" | "sandbox">>`, a type over the one stored schema with no union, default or migration. `runConfiguration`, `interpretBoundary`, `frozenGroupReasons`, `requireFrozenBinding` and `parsePassedCodeReviewRecord` take it, and their 11 existing call sites stay assignable. `src/code-review.ts` joins the affected files, and Rollback now names three source files.
- **Deferred — Suggestion, keep the first regression narrowly on missing `sandbox`:**
  - The regression part fits cleanly: every new regression test removes only `sandbox`, the observed incompatibility.
  - The operator kept the general rule that a later field nothing on the snapshot path reads is execution-only (2026-10-20, "after and sandbox"). Today that rule also covers `after`. No stored crew-chatter run (1 to 8) lacks `after`, so no current run gains inspectability from it.
  - A dedicated contract for wider omissions waits until a run is found that needs one (owner: the operator).
