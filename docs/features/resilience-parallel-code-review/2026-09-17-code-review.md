# Resilience and parallel code review implementation — code review

**Reviewed document:** `docs/features/resilience-parallel-code-review/plan.md`
**Review date:** 2026-09-17
**Status:** reconciled
**Effort:** high

**Hazards considered:** `docs/hazards.md` items 1 (provider output shapes), 2 (discarded output), 3 (prompt-only constraints), 4 (hand-written fixtures), 7 (identical retries), 8 (Windows executable resolution), 11 (default installation paths), 12 (configuration divergence), 14 (reviewer independence), 15 (read-only reviewers), and 18 (code-inspection coverage). Items 5, 6, 9, 10, 13, 16, and 17 remain outside this implementation's stage and artifact boundaries.

**Scope reviewed:** `git --no-pager diff HEAD` plus untracked `docs/features/resilience-parallel-code-review/plan.md`, `docs/features/resilience-parallel-code-review/2026-09-17-plan-review.md`, and `src/agents/code-reviewer-state-integrity.ts`. No dedicated repository `review-code.md` checklist exists, so this review applies `AGENTS.md`, `ARCHITECTURE.md`, `docs/hazards.md`, `.claude/sessions/project-learnings.md`, the reconciled plan review, and the canonical `doc-check` workflow. Repository verification reports `npm test` at 1,182 passed, 0 failed, and 5 skipped; `npm run typecheck` at exit 0; `npm run check:docs` clean with 75 illustrative-path warnings; `git diff --check` clean; and byte-identical `AGENTS.md` and `CLAUDE.md`. A focused local rerun of the failure-drain regression also passes.

## Summary

The implementation adds the third specialist without displacing either two-seat default lens, launches each panel concurrently, drains every dispatch, performs one quiescent integrity check, and persists valid evidence in frozen panel order. The failure path keeps an incomplete panel distinct from a gate result and retains clean sibling evidence as the reconciled plan requires.

The remaining finding concerns verification coverage, not an observed production failure. The implementation plan requires regression evidence for deterministic report and remediation ordering, ordered multiple failures, and aggregate concurrent cost. The new tests cover the underlying happy and single-failure paths but do not exercise those exact contracts. This review withholds style, naming, optional refactoring, the accepted incomplete-panel evidence decision, and the separately authorized paid-provider validation boundary.

## Findings

**Finding 1 — The regression suite does not enforce all required deterministic evidence contracts**

- **Where:** `test/code-review-stage.test.ts` in the controlled-delay barrier, failure-drain, shared-finding, and remediation tests; `test/dispatch.test.ts` in the three-dispatch concurrency test.
- **Severity:** Medium. A reachable refactor that consumes successful reports by completion order or combines two reviewer failures in completion order changes immutable report identifiers, remediation prompt order, or the canonical terminal summary without a regression failure. A dropped or mis-aggregated concurrent cost also satisfies the new zero-cost assertion.
- **Why it matters:** Step 4 and the verification matrix require a mixed-duration, mixed-finding case that asserts report insertion, deduplication, and remediation input in frozen order; an ordered multi-reviewer failure summary; and correct aggregate cost. The barrier test emits no findings and asserts only the static `record.panel`; the shared-finding test applies no controlled delays and sorts its severity assertion; the failure-drain test fails only one seat; and the dispatch fixture reports zero cost before the test sums the rows to zero. These tests therefore do not prove the plan's deterministic consumption and cost guarantees or satisfy the repository rule to break the guards they claim.
- **Not reproduced:** The current production implementation iterates the input-ordered `Promise.allSettled` result, and the full suite passes. Confirm the missing guards by adding controlled out-of-order findings and at least two failed seats, then temporarily consume those results in completion order; use a non-zero recorded envelope cost and assert the run-level aggregate. Each mutation must fail its targeted assertion before restoration.

## Reconciliation (2026-09-18)

Finding 1 is accepted and resolved. The executable review fixture now supplies three distinct high findings whose controlled completion order differs from the frozen panel order, rejects a remediation prompt unless all three reviewer reports remain in canonical order, and then emits a clean second panel. The stage regression asserts canonical persisted finding/report order and successful sequential remediation. A second controlled fixture fails state-integrity before correctness while security completes successfully; its regression asserts the exact canonical settled outcomes, two-failure terminal summary, operator-facing failure order, retained valid sibling evidence, and absence of a gate result. The concurrent dispatch fixture now emits a non-zero cost and the dispatch regression asserts three individual costs and the `0.375` aggregate in addition to distinct raw references, three audit entries, and a valid chain.

Each new guard was broken and restored: sorting settled outcomes by measured duration caused the mixed-order remediation regression to fail, reversing the failure list caused the multi-failure summary regression to fail, and zeroing the fixture cost caused the aggregate-cost regression to fail. The restored focused suites pass. Final repository verification reports `npm test` at 1,184 passed, 0 failed, and 5 skipped; `npm run typecheck` at exit 0; `npm run check:docs` clean with 75 illustrative-path warnings; `git diff --check` clean; and byte-identical `AGENTS.md` and `CLAUDE.md`. The independent follow-up confirmed the finding fully resolved and found no material defect in the marker lifecycle, second-panel bypass, ordering checks, or shared cost fixture. No review finding remains open.
