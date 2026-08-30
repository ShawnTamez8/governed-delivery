# Plan Stage Implementation Plan — review

**Reviewed document:** `C:\Users\Shawn-work\repositories\governed-delivery\docs\features\plan-stage\plan.md`
**Document type:** Plan. A full implementation plan in the repository's write-plan format; its assumptions resolve architecture ambiguities (the plan document schema, the model map shape) and those resolutions receive review as design decisions.
**Review date:** 2026-08-29
**Hazards considered:** `docs/hazards.md` 6 (promises a later stage cannot keep — the plan states its limit, and this review checked that no task implies the stronger guarantee), 4 (every task carries a break-it step). Entries 1, 3, 7, 11 and 13 are named by the reviewed plan itself and were checked as covered; no other entry bears on it.

---

## Summary

The plan is a faithful mirror of the shipped spec stage, and its load-bearing claims verify against the post-hardening tree: the doc-check sequence assertion, `selectReviewers` stage-agnosticism, the prompts-scan comment, and the approval `scope` column all check out. Three binding-chain gaps remain — the frozen model map is enforced at two of three spend entry points, the blocked-run spend gap through `bw dispatch` and `bw stage-add` stays open, and the plan stage reads the spec file after approval without re-verifying it against what the approval bound. All three are task-level additions, not redesign.

## Verdict

**Ready for planning after required changes.** The critical issues are each a guard the plan is the natural owner of; fixing them costs one task addition and two task extensions, and none changes the plan's structure.

## Critical issues — must fix before implementation

**Issue:** The frozen model map is enforced at two of three spend entry points

- **Why it matters:** Task 1 implements section 10's model map and checks it at `spec` (Task 1 Step 3) and `plan` (Task 6). `bw dispatch --model <name>` (a required flag at [cli.ts:208](src/cli.ts#L208)) accepts any model for any stage without consulting the profile. After step 5, hard rule 6 holds for two commands and not the third, and the raw dispatch surface spends against a model the frozen map never resolved. Task 5 Step 1 accepts `requestedModel?` for `runPlanStage` but never states the mismatch refusal — Task 1 Step 3 specifies that check for `runSpecStage` only.
- **Where:** Task 1, Task 5 Step 1, Task 6; the affected-areas list names `src/spec-stage.ts` but not `src/cli.ts`'s `dispatch` case.
- **Production impact:** A documented command bypasses the frozen configuration the step exists to enforce, and the plan stage's own `--model` mismatch has no defined behavior — an implementer would have to invent it.
- **Recommended fix:** Extend Task 1: the `dispatch` case resolves the stage's kind through `resolveStageModel(profile, stage.kind)`, `--model` becomes optional, and a supplied value that differs from the frozen one is refused by name, before any spawn. State the same refusal for `runPlanStage` in Task 5 Step 1.

**Issue:** The blocked-run spend gap stays open through `bw dispatch` and `bw stage-add`

- **Why it matters:** Task 5 Step 1 gives `runPlanStage` the `in_progress` precondition, matching the hardening's `requireRunInProgress` in `runSpecStage`. The documented CLI's other two entry points still move: `stage-add` inserts a stage row on a blocked run unconditionally, and `dispatch` checks only that the stage exists ([cli.ts:213](src/cli.ts#L213)) before spawning the harness and recording an `agent_run` row with cost against a run that can never complete. This is the review-skip item this planning round was to settle; the plan is silent on it.
- **Where:** Absent from the plan; the reachable paths are `src/cli.ts`'s `stage-add` and `dispatch` cases.
- **Production impact:** Real spend on a terminal run through the documented CLI, with the evidence recorded in `agent_run` and no stage that could ever consume it.
- **Recommended fix:** Add a small task (or extend Task 6): `dispatch` and `stage-add` refuse runs whose status is not `in_progress`, naming the run and its status, with CLI tests asserting the refusal precedes any spawn — the absent `agent_run` row and absent stage row are the proofs.

**Issue:** The plan stage reads the spec file after approval without re-verifying it against what the approval bound

- **Why it matters:** Task 5 Step 1 reads the spec from the `awaiting_approval` stage's `output_ref` and treats it as "the approved specification" by provenance. Nothing re-checks the content. The `plan_for` check in Step 2 compares the written plan against "the spec hash the stage computed" — both computed from the same current file, so a spec edited after approval passes with a matching plan, and the plan then binds a specification the operator's signature never authorized. The hardening just built exactly this guard for the approval gate (read the `spec.gate.pass` event, hash the disk file, refuse on difference); the plan stage is the first consumer to read the file after approval and the plan gives it no equivalent.
- **Where:** Task 5 Step 1 and Step 2; the goal sentence's word "approved" is load-bearing with no guard.
- **Production impact:** The binding chain the hardening commit established — panel gated it, approval signed it, plan builds from it — breaks at its newest link, and a plan written from an unauthorized spec proceeds through a paid panel before anyone notices.
- **Recommended fix:** In Task 5 Step 1, before any dispatch, read the run's most recent `spec.gate.pass` event (the same query the approval gate uses), hash the spec file with `sha256Hex(normalizeText(...))`, and refuse on difference with the approval gate's own wording. This also fixes the underspecified `plan_for` hash: name the same pair in Task 2's schema description so `plan_for` is comparable to the record the approval bound.

## High-risk areas

**Risk:** `coverageFitsScope`'s comparison semantics are unspecified

- **Why:** Task 4 names the function but never says how a coverage artifact path compares against the signed scope — exact string equality, containment, or case folding. The repository's own step-4 lesson split exactly here: `touchesProtected` folds case because Windows treats the spellings as one file, while `computeScope` deliberately preserves the declared spelling because the operator signs it. A model-written coverage path differing from the signed spelling only in case is the same file on this platform; a case-exact gate refuses a legitimate plan, a case-folding one silently widens what was signed.
- **Impact if ignored:** The implementer picks a semantics on instinct and the choice only surfaces when a real plan is refused or, worse, when a plan passes for an artifact the operator never authorized.
- **Mitigation:** State in Task 4 that the comparison is exact-string against the signed scope as declared — case-preserving, matching `computeScope`'s deliberate decision — and add a test asserting that a path differing only in case is refused as out of scope on every platform.

## Medium and low concerns

- **The blast-radius call-site count is stale.** The plan states `freezeProfile` "breaks all eight call sites (verified by grep)" and lists `test/approval-stage.test.ts:61` and six `test/profile.test.ts` lines at 24, 33, 41, 54, 62, 63. The post-hardening tree has ten call sites: `src/cli.ts:134`, `test/approval-stage.test.ts:126`, and eight in `test/profile.test.ts` at 27, 36, 44, 57, 65, 66, 124, 134. The hardening commit moved these lines after the plan was written, and the plan's own assumption 1 says it executes after that commit lands — re-verify the numbers against the tree that exists now.
- **Task 5 Step 4 names `computeRisk` without its module.** It lives in `src/select.ts` (as `spec-stage.ts:10` imports it), not in `src/scope.ts` where an implementer following the affected-areas list might look. One clause in Step 4 resolves it.

## Missing and underspecified areas

- **The spec-file read failure has no named behavior.** Task 5 Step 1 reads the approved spec from `output_ref`; if the file is missing or unreadable the plan says nothing. Mirror `runSpecStage`'s `cannot read design document` refusal so the failure names its cause and blocks before any dispatch.
- **The coverage gate's audit evidence.** Task 5 Step 3 blocks the `plan` stage "naming the unkeepable criteria" in the reason; the plan does not state that the audit event must carry those names. The reason string is the operator's only diagnosable record — assert it in the test.

## Suggested improvements

- In Task 5 Step 4, state once that the panel's re-review resolves findings and the author's claim never does, as the shipped spec stage does — the plan relies on the precedent without repeating the rule its own fixtures must encode.
- In Task 7 Step 5, record not only the smoke's prompt defects but which of the three critical guards above were broken and restored during implementation, so the learning entry names the guards the plan added after review.

---

## Reconciliation

**Date:** 2026-08-29
**Disposition:** 10 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — frozen model map at two of three spend entry points:** Task 1 gains Step 5, which brings `bw dispatch` under the frozen map with a named mismatch refusal before any spawn; Task 5 Step 1 states the same refusal for `runPlanStage`.
- **Accepted — blocked-run spend through `bw dispatch` and `stage-add`:** Task 6 gains Step 3, which reuses `requireRunInProgress` in both CLI cases with the no-`agent_run`-row and no-stage-row proofs.
- **Accepted — spec read after approval without re-verification:** Task 5 Step 1 re-verifies the spec file against the `spec.gate.pass` hash with the approval gate's own refusal wording; the goal statement and the `plan_for` schema assumption now name the `sha256Hex(normalizeText(...))` pair.
- **Accepted — `coverageFitsScope` comparison semantics:** Task 4 states the exact-string, case-preserving comparison and the test asserts a case-differing path is refused on every platform.
- **Accepted — stale freezeProfile call-site count:** the blast radius now names ten call sites at the post-hardening lines.
- **Accepted — `computeRisk` module unnamed:** Task 5 Step 4 names `src/select.ts`.
- **Accepted — spec-file read failure unnamed:** Task 5 Step 1 adds the `cannot read approved spec` refusal before any dispatch.
- **Accepted — coverage gate audit evidence:** Task 5 Step 3 requires the audit event to carry the unkeepable criteria names, and Step 5 asserts it.
- **Accepted — re-review resolution rule:** Task 5 Step 4 states that the panel's re-review resolves findings and the author's claim never does.
- **Accepted — learning entry naming the post-review guards:** Task 7 Step 5 records which of the three added guards were broken and restored during implementation.
