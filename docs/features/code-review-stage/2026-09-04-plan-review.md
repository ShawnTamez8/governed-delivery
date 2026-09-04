# Code Review Stage Implementation Plan — plan review

**Reviewed document:** `docs/features/code-review-stage/plan.md`
**Governing sources:** `CLAUDE.md`, `ARCHITECTURE.md` sections 3, 4, 6, 12, 13, 15, and 21, `docs/hazards.md`, `.claude/sessions/project-learnings.md`, and `docs/proposals/post-milestone-target-flow.md`
**Repository evidence:** `src/policy.ts`, `src/finding.ts`, `src/reconciliation.ts`, `src/delivery-stage.ts`, the current stage and store tests, and `test/fixtures/recorded/`
**Review date:** 2026-09-04
**Status:** reconciled
**Hazards considered:** 3 and 4 govern constrained model fields and real-output contracts; 5 and 11 govern honest completion and usable defaults; 7 prohibits evidence-fishing retries; 14 limits the independence claim; 15 requires enforcement beyond a read-only prompt; 16 requires an actionable upstream route; and 17 establishes the current normative-removal baseline. Hazards 1, 2, 6, 8-10, 12, and 13 introduce no separate material finding for this stage.

---

## Summary

The proposed stage closes the observed “delivered but never inspected” gap, but
five contract defects remain. As written, completion can rest on synthetic
output, model-controlled locations are not deterministically bounded, delivery
does not consume the code-review record, severity ordering is live rather than
frozen, and the planned binding documentation overstates upstream routing and
reviewer independence.

## Verdict

**Not ready for implementation.** The sequence and affected components are
identified, but another agent would have to invent security-sensitive validation
and decide an unresolved upstream-routing policy.

## Readiness assessment

- **Requirements coverage:** Partial — the stage and gate are specified, but
  architecture sections 3, 4, 6, 13, and 21 are not fully satisfied.
- **Executor handoff:** Incomplete — adjacent stage rows are checked without
  validating both authoritative output records and audit verdicts.
- **Repository grounding:** Strong for current modules; two proposed reuses do
  not provide the stricter semantics the plan attributes to them.
- **Validation:** Incomplete — deterministic tests are detailed, but the new
  provider contract can complete without recorded real output.
- **Security and operations:** Revision required at the untrusted-output boundary.
- **Specialist rubric:** Security applies; UI and public API rubrics do not.

## Coverage exceptions

| Requirement | Status | Required correction |
| --- | --- | --- |
| Frozen configuration | Partial | Use the frozen severity vocabulary and order. |
| Explicit handoffs | Partial | Validate both adjacent result records and gate events. |
| Upstream findings | Missing | Give upstream reports an actionable route. |
| Recorded-output verification | Missing | Make real-output replay load-bearing. |

## Security and bad-practice assessment

The read-only executor plus pre/post worktree checks is a sound containment
layer. The remaining security issue is integrity: untrusted reviewer output can
name arbitrary locations and influence a terminal gate using live constants.
Those constraints need deterministic enforcement from the frozen run state.

## Material findings

### High risk — The new model-output contract may complete without real-output replay

- **Evidence:** `plan.md:1210-1214` makes live evidence supplementary and
  `plan.md:1266-1271` treats no paid run as complete. The recorded fixture
  directory contains reconciliation responses only. `ARCHITECTURE.md:67-70`
  constrains fixtures, and `ARCHITECTURE.md:964-976` makes contract tests from
  recorded real output the load-bearing verification category.
- **Impact:** Hand-built emitters can agree with the parser while the real
  provider returns an incompatible wrapper, field shape, case, or location.
- **Required plan change:** Require one authorized real code-review response to
  be sanitized, committed with provenance, and replayed through envelope
  extraction, result validation, location validation, and the gate. If no paid
  run is authorized, record the feature as awaiting contract evidence rather
  than complete, unless the operator first changes the binding verification rule.

### High risk — `current_artifact` locations are constrained only by the prompt

- **Evidence:** The prompt requires a changed path with optional `:<line>` at
  `plan.md:677-686`, but Task 3 calls `validateReviewerReports` with only an
  agent ID and upstream prefix (`plan.md:578-594`). The current validator accepts
  any non-empty non-upstream string and normalizes it as prose
  (`src/reconciliation.ts:169-225`; `src/finding.ts:3-10`).
- **Impact:** An unchanged path, heading, or malformed line suffix can become an
  authoritative finding and block a run, defeating traceability and hazard 3.
- **Required plan change:** Add a code-review boundary validator against the
  exact `changedPaths` set, with an optional positive numeric line suffix and
  path-preserving identity. Test accepted paths and rejection of unchanged,
  normalized-away, and malformed locations.

### High risk — The adjacent-stage handoffs are only partially validated

- **Evidence:** Code review re-reads the verification result but does not require
  `verification.gate.pass` (`plan.md:531-562`). Delivery requires a passed
  code-review row and event, then deliberately reads the older verification
  record instead of `last.output_ref` (`plan.md:983-994`). This contradicts
  `ARCHITECTURE.md:77-96`, where a stage's output reference is literally the next
  stage's input.
- **Impact:** A crash-gap verification row can trigger two paid reviews, and a
  missing or tampered code-review result can still allow delivery to complete.
- **Required plan change:** Require the verification gate event before any review
  dispatch. Make delivery strictly parse and cross-check the code-review result
  from `last.output_ref`, then link its range and verified commit to the validated
  verification record. Add missing/tampered-record and missing-event regressions.

### High risk — Gate ordering bypasses the frozen severity contract

- **Evidence:** Policy already freezes `severities` (`src/policy.ts:149-180`),
  yet Task 3 orders reports with the live `SEVERITIES` constant
  (`plan.md:603-614`). Task 6 varies only the frozen threshold
  (`plan.md:865-870`).
- **Impact:** Reordering or changing the live constant changes an in-progress
  run's gate semantics despite hard rule 6; validation also accepts values from
  the live list rather than the run's vocabulary.
- **Required plan change:** Pass `profile.policy.severities` into report
  validation and gate comparison, validate that the threshold occurs exactly
  once in that frozen ordered list, and add a refreeze test whose order differs
  from the live constant.

### High risk — Planned binding text would assert guarantees the stage lacks

- **Evidence:** The plan sends upstream findings only to the record and permits
  severity-based passage (`plan.md:130-138`), while `ARCHITECTURE.md:677-686`
  requires an upstream finding to have somewhere actionable to go. It also tells
  hazard 18 to claim “two independent reviewers” (`plan.md:1156-1174`) even
  though the plan and architecture correctly limit the evidence to
  `configured_standalone` (`plan.md:58-60`; `ARCHITECTURE.md:128-135`).
- **Impact:** A valid plan defect may reach delivery without ownership, and the
  binding hazard register would promise independence the audit cannot prove.
- **Required plan change:** Define an actionable upstream route before coding —
  at minimum, block for an operator with retained evidence, or implement the
  proposal/decision route — and test it. Replace “independent” with “separately
  dispatched and recorded as `configured_standalone`” everywhere.

## Material evidence limits

- No code-review provider response exists yet, so live contract compatibility is
  unverified.
- The known-leaky full suite was not run during this document review. Current
  behavior was established by source, focused-test, and fixture inspection.

---

## Reconciliation

**Date:** 2026-09-04
**Disposition:** 5 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled
**Hazards considered:** 3 (the location and severity rules the prompt states now have deterministic backstops in the stage), 4 and hard rule 5 (a recorded real response is the completion condition, not an option), 14 (no document the plan writes calls the reviewers independent), and 16 (an upstream finding blocks for a human and, at the threshold, becomes a proposal, so the remediation the stage lacks is never aimed at the code). 7 governs Task 10's outcome 3: an empty panel is recorded, never rerun.

### Verdicts

- **Accepted — The new model-output contract may complete without real-output replay:** Task 10 is load-bearing. The plan now requires one real reviewer response committed under `test/fixtures/recorded/` with provenance and replayed through `extractJsonBody`, `validateAgentResult`, `validateReviewerReports`, `validateCodeReviewLocations`, and `codeReviewGate`; outcome 1 (no paid run) leaves the plan `Proposed` and awaiting contract evidence, and the header, known blockers, verification line, and gate say so.
- **Accepted — `current_artifact` locations are constrained only by the prompt:** Task 3 adds the exported pure `validateCodeReviewLocations(reports, changedPaths)`, requiring each `current_artifact` location to match one changed path exactly with an optional positive integer line suffix and refusing an unchanged path, a heading, `:0`, a non-numeric suffix, or a second suffix. Task 6 drives it through the `unchanged-path` and `bad-line` fixture modes and a direct unit test. The shared validator's whitespace and trailing-colon normalization runs first by design; the plan records why that cannot turn one changed path into another, so the reviewer's "normalized-away" case narrows to those two tolerances and the stored identity stays the exact path.
- **Accepted — The adjacent-stage handoffs are only partially validated:** the stage requires the `verification.gate.pass` event before any dispatch (Task 3 Step 2, Task 6 Step 10, a break-it in Step 12). Delivery reads the code-review record from `last.output_ref` as the exported `CodeReviewRecord`, parses it strictly, walks back to the verification record the chain names, and refuses when the two records disagree on worktree, base, or verified commit; Task 7 adds the missing-record, edited-record, mismatched-commit, and blocked-review regressions.
- **Accepted — Gate ordering bypasses the frozen severity contract:** `codeReviewGate` takes the frozen `profile.policy.severities` and indexes it; the stage refuses a report whose severity is absent from that frozen list; `invalidPolicyReason` requires the threshold to occur exactly once in the policy's own `severities`, not the live constant; Task 6 Step 6 adds the reversed-order refreeze test and Step 12 the break-it.
- **Accepted — Planned binding text would assert guarantees the stage lacks:** the operator decided the upstream route during reconciliation: every upstream finding blocks the run for a human regardless of severity, with the finding id and decision key retained in the record and the `code_review.gate.block` event, and every upstream finding also writes a non-binding `blocking_dependency` proposal through the existing `writeProposalEvidence` and `store.upsertProposal`, with the candidate derived from the finding rather than a second model-returned field. The operator first scoped the proposal to findings at or above the frozen threshold, then on the reconciler's recommendation in the same session chose one rule for every severity, because the run is blocked either way and the second comparison bought only a branch and a fixture mode. Only a human promotes the proposal; a fresh run is the repair. Task 6 Step 8 carries the four regressions the operator named (a low `current_artifact` finding passes, a low upstream finding blocks, the record and event retain the id and key, delivery refuses the blocked stage). Every planned hazard 18 and section 12 sentence now says "separately dispatched and recorded as `configured_standalone`" in place of "independent".
