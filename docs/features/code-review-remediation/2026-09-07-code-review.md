# Bounded code-review remediation implementation — code review

**Project checklist:** No `.Codex/review-code.md` exists; this review applies the repository rules in `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, and `docs/hazards.md` plus the full correctness layer.

**Reviewed document:** `docs/features/code-review-remediation/plan.md`

**Review date:** 2026-09-07

**Status:** reconciled — all three findings resolved; reviewed plan implemented

**Hazards considered:** 1, 2, 3, 4, 5, 7, 11, 12, 14, 15, 16, and 18. The review focuses on typed failure evidence, retained provider and verification evidence, frozen policy, exact commit handoffs, bounded materially changed retries, default staffing, read-only subprocess boundaries, code-only findings, and the missing remediation path. Hazards 6, 8-10, 13, and 17 do not govern this diff because it adds no executable, hook, model alias, specification obligation, document reconciliation, or removal accounting.

**Scope reviewed:** `git diff HEAD` plus the untracked requirements, plan, `src/code-review.ts`, `src/commit-verification.ts`, `src/patch-application.ts`, and their three new test files. The review traces the changed stage callers and delivery consumer. After reconciliation, the disposable-mirror full gate passes 818 tests with zero failures and one operating-system symlink skip; focused break tests prove the threshold, round cap, panel cardinality, and post-patch verification guards.

## Summary

High-effort review found three confirmed evidence defects and no unresolved correctness, security, policy-freeze, panel-bound, or delivery-handoff defect. Every finding has a focused failing regression. The review withholds style, naming, optional abstraction, speculative hardening, the intentionally unchanged document-review stages, the separately authorized paid run, and pre-existing behavior outside this feature.

## Findings

**Finding 1 — Delivery accepts an unreviewed commit through a forged round record**

- **Where:** `src/delivery-stage.ts` in the `code_review.gate.pass` prerequisite and `src/code-review-stage.ts` in the pass-event handoff.
- **Why it matters:** Delivery checks only that a pass event exists. After a valid review, a new commit plus an edited code-review record can invent a remediation, a passing verification, and a second clean panel around that commit. The record passes every link check, the worktree head matches it, and delivery completes even though the immutable pass event names the earlier reviewed commit. This violates the exact-stage-handoff rule and permits unreviewed, unverified bytes to reach `completed` when machine-local evidence is edited.
- **Reproduced:** A regression starts from a passed one-round record, commits a post-review source change, and rewrites the JSON as a valid two-round chain ending at the new commit. Delivery returns success before the fix. A canonical pass-event formatter and parser now bind the event's stage, final round, frozen round budget, final commit, finding count, and threshold to the record; the attack refuses before a delivery row exists while valid remediated delivery still passes.

- **Reconciled:** `code_review.gate.pass` now carries one canonical, parsed handoff bound to the stage id, final round, frozen round budget, final commit, finding count, and threshold. Delivery cross-checks every field against the retained record. The forged post-review commit regression refuses before a delivery stage is created, and the valid remediated handoff still passes.

**Finding 2 — A failed remediation candidate is labelled as the final verified commit**

- **Where:** `src/code-review-stage.ts` in the remediation-verification block and `test/code-review-stage.test.ts` in the failed-verification case.
- **Why it matters:** When a remediation command fails, the blocked record assigns the failed candidate to `finalVerifiedCommit`. The structured record and human report therefore call bytes verified even though the retained round says verification blocks. This contradicts the architecture's initial-and-final-verified-commit contract and gives an operator inconsistent evidence during diagnosis. Delivery cannot consume the blocked stage, so the defect does not bypass the delivery gate.
- **Reproduced:** A regression asserts that `finalVerifiedCommit` remains the last passing commit and differs from the failed remediation candidate. The test fails with the failed candidate as actual and the initial verified commit as expected. Changing the blocked-record write to use the prior `currentCommit` makes the test pass while the round retains the failed candidate and its verification result.

- **Reconciled:** The blocked record now preserves the prior `currentCommit` as `finalVerifiedCommit`; the failed candidate remains visible only in its remediation and verification evidence. The regression passes.

**Finding 3 — Patch-helper extraction changes initial implementation failure categories**

- **Where:** `src/patch-application.ts` failure results and `src/implementation-stage.ts` failure mapping.
- **Why it matters:** The previous implementation stage records a patch with no files as `implementation.content.invalid`. The extracted helper returns only prose, so the caller maps the same reachable result to `implementation.patch.refused`. Audit queries and incident diagnosis then confuse malformed model output with a structurally valid patch rejected by a deterministic guard, contrary to the typed-signal rule and the governing implementation-stage contract.
- **Reproduced:** A fixture returns one patch with an empty file list. The regression sees zero `implementation.content.invalid` events before the fix. Adding typed helper failure kinds and mapping them to the caller's existing audit actions makes the focused stage test pass without parsing error prose.

- **Reconciled:** The shared helper now returns typed failure kinds, and the implementation-stage caller maps them to its existing audit actions without parsing prose. The empty-file patch regression and the shared-helper suite pass.
