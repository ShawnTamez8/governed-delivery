# Spec Stage Implementation Plan — review

**Reviewed document:** `C:\Users\Shawn-work\repositories\governed-delivery\docs\features\spec-stage\plan.md`
**Document type:** Plan. A full implementation plan in the repository's write-plan format; its assumptions section resolves architecture ambiguities (severity, disposition, risk enums) and those resolutions receive review as design decisions.
**Review date:** 2026-08-29
**Hazards considered:** `docs/hazards.md` 7 (retries that vary nothing — the closure round must vary the prompt). Entries 1, 3, 4, 11, 13 and 14 are named by the reviewed plan itself and were checked as covered; no other entry bears on it.

---

## Summary

The plan is the strongest of the three build-order plans so far: the fixture design is deterministic through the full two-round loop, the hazard-3 and hazard-11 guards are built in, and every refusal names its cause. One structural defect remains — the plan collapses two architecture-mandated stages into one row, which misattributes the evidence the milestone's cost query exists to produce — plus two failure-path behaviors the implementer would otherwise invent.

## Verdict

**Ready for planning after required changes.** The critical issue is a task-level restructure of `runSpecStage` into two stage rows, not a redesign; the high-risk items are behavior definitions.

## Critical issues — must fix before implementation

**Issue:** One stage row where the architecture's sequence names two

- **Why it matters:** Section 5's chain is `spec -> spec_review -> awaiting_approval`, and section 4's model is "each stage ... writes an immutable record, and hands off." The plan's `runSpecStage` inserts one `spec` row and runs the author, the panel, and the gate under it (Task 7 Step 2.4-2.10). The `spec_review` kind never appears. Every `agent_run` — author and all reviewers — attaches to one row, so the evidence model's "cost per stage" query cannot separate authoring cost from review cost, and the stage chain the audit joins to walks from `spec` straight to whatever step 4 records, with no `spec_review` row for the approval to bind its content hash against. Section 12's own description of `spec_review` ("dispatch the author and the review panel") loosely lumps the complex, but the stage sequence is the binding chain.
- **Where:** Task 7 Step 2; the plan's goal statement ("decide completion with a deterministic gate" under one stage).
- **Production impact:** The step-9 milestone — one run with queryable per-stage cost — reports wrong numbers from the first real run, and step 4's approval must invent which stage's output it approves.
- **Recommended fix:** Restructure `runSpecStage` into two stage rows: `spec` (author dispatch, `AgentResult` validation, spec-doc validation, content write, `completeStage(..., "pass")`) and `spec_review` (input `stage_id` = the `spec` row's id; panel selection, reviewer dispatches, findings, the deterministic gate, closure rounds, block-on-budget). The one `bw spec` command drives both; the audit and cost queries then distinguish them. Adjust the goal sentence and the happy-path assertions to expect two stage rows.

## High-risk areas

**Risk:** Aborted stages leave the run with no defined recovery

- **Why:** Task 7 Step 2.5-2.6 abort on a failed dispatch or invalid result and "leave the stage status untouched"; Step 2.2 then refuses any second `bw spec` attempt with "run already has stages." The run is wedged: money may be spent (a dispatch happened), the evidence sits in `agent_run` and the audit, and no path exists to retry, resume, or close the run.
- **Impact if ignored:** The first malformed agent result in production strands a run permanently, and the operator has no command that says so — the wedge surfaces as a mysterious refusal on the retry.
- **Mitigation:** Make aborts terminal: `completeStage` with `gate_result: "block"` and an audit event naming the reason, and state the retry rule — a re-run is refused with a message naming the stage and its status, because an identical retry is hazard 7's slower failure. A fresh run is the recovery path.

**Risk:** An invalid finding entry has no defined consequence for the round

- **Why:** Task 7 Step 2.9 says invalid entries "are refused naming the reviewer and the cause, and count as a blocked round" — but the plan never defines what a blocked round does: whether the remaining valid findings still reach the gate, whether the round increments the budget, and what the gate decides when one reviewer's findings were discarded.
- **Impact if ignored:** An implementer could discard garbage findings and let the other reviewer's clean result pass the gate — a reviewer that returned unparseable output effectively votes pass by absence.
- **Mitigation:** Treat an invalid finding entry like a failed dispatch: the stage aborts and blocks, with the audit naming the reviewer and the cause. A reviewer whose output cannot be validated cannot be skipped silently.

## Medium and low concerns

- The plan computes risk but never records where step 4 reads it. Risk is a pure function of the spec, so define it as recomputed at approval time from the spec content — no persistence, no schema change — and say so in the plan, or step 4 will add a column on its own.
- `completeStage(stage, specPathRef, ...)` names `specPathRef` without defining it. Define `output_ref` as the written spec path (`docs/features/<slug>/spec.md`).
- `writeSpecDoc` overwrites on revision rounds; state the overwrite semantics explicitly, since section 8's content-write description ("no prior content to conflict with") does not cover the revision case.
- `selectReviewers(stageKind, ...)` takes a `stageKind` its described logic never uses; drop the parameter or state what it selects on.
- The `executor` and `tools` fields on `AgentDefinition` are carried but unused in step 3; note that they exist because the architecture's definition shape requires them and become enforced in later steps — otherwise section 9's "a field that nothing enforces does not belong here" is a standing objection.
- The architecture's severity values were never enumerated; the plan's `low | medium | high | critical` choice is sound, but the plan should note that the architecture gains nothing from this — the enum lives in the migration and the prompts only.

## Missing and underspecified areas

- What `runSpecStage` returns on the mid-stage abort paths (the stage row id? the stage state?), now that aborts become terminal blocks.
- The reviewer prompt's round-2 content: the plan implies the revised spec alone (the re-review mechanism needs nothing else), but state it so the fixture's `REVISED-spec` key is the only coupling.
- The `spec.stage.create` audit event's actor and action values for the two new stage rows.

## Suggested improvements

- Extend the happy-path assertion to check the two stage rows' `kind` values (`spec`, then `spec_review`) and their `input_stage_id` chain — the critical fix becomes the test that pins it.

---

## Reconciliation

**Date:** 2026-08-29
**Disposition:** 13 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

### Verdicts

- **Accepted — one stage row where the architecture names two (critical):** `runSpecStage` now creates two stage rows, `spec` then `spec_review`, chained by `input_stage_id`; author work, validation, and the content write complete the `spec` row; the panel, findings, gate, and closure rounds complete the `spec_review` row. Both rows' `output_ref` is the spec path. The goal statement and the happy-path and blocked-case assertions pin the two-row chain.
- **Accepted — aborted stages leave no recovery (high-risk):** every abort path is terminal — `completeStage(..., "block")`, an audit event naming the reason, and a `{ ok: false, reason }` return. The stage-exists refusal now names the existing stage's kind and status, and the plan states the recovery: a fresh run, since an identical retry is hazard 7's slower failure.
- **Accepted — invalid finding entry has no defined consequence (high-risk):** an invalid finding entry is the same terminal abort as a failed dispatch — audit naming the reviewer and the cause, blocked stage, return — so an unvalidatable reviewer can never pass the gate by absence.
- **Accepted — risk recomputed at approval (medium):** the assumptions state risk is never persisted; step 4 recomputes it from the spec content, and Task 7 Step 2 says so where risk is computed.
- **Accepted — `specPathRef` undefined (medium):** both stage rows' `output_ref` is defined as the spec path (`docs/features/<slug>/spec.md`).
- **Accepted — overwrite semantics (medium):** `writeSpecDoc` states the overwrite, and the gate decides whether the revision stands.
- **Accepted — unused `stageKind` parameter (medium):** dropped from `selectReviewers`; the call site now passes `(risk, requiredSpecialties)`.
- **Accepted — carried-but-unenforced `executor` and `tools` (medium):** Task 1 notes they exist because the architecture's shape requires them and become enforced with executor binding.
- **Accepted — severity enum lives only in migration and prompts (medium):** stated in the assumptions.
- **Accepted — missing area: return shape on aborts:** all aborts return `{ ok: false, reason }`; success returns the two stage ids and the spec path.
- **Accepted — missing area: round-2 reviewer prompt content:** the revision round passes the revised spec content only, stated in Task 5.
- **Accepted — missing area: audit actor and action values:** stage-level audit events use `actor: "system"`, `actorType: "cli"`, stated in Task 7 Step 2.
- **Accepted — suggested: happy path pins the two stage rows:** the happy-path and blocked-case assertions now check kinds, chaining, and per-stage completion.
