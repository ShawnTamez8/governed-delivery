# 2026-10-21 — protected acceptance tests: review fixes (plan Tasks 12–16)

**Requested outcome:** `/implement-plan docs/features/protected-acceptance-tests/plan.md`.
Execute Tasks 12–16, which close the four findings of
`docs/features/protected-acceptance-tests/2026-10-21-code-review.md`, then run an
independent review and update the plan. Task 11 is paid and needs its own consent.

**Baseline:** commit `9319f0a` on `sandboxed-delivery` (unpushed).

**Success criteria:** the success criteria are each task's tests and break-tests,
plus Task 16's checks:
- typecheck and check:docs clean;
- smoke 13/13, with and without `--acceptance-tests`;
- the full serial suite with 0 failures;
- both engine suites passing.

**Approved approach:** the operator chose, on 2026-10-21, to mount a copy of the
suite taken from the commit, rather than refusing case-insensitive hosts.

**Files changed:**
- source: `src/container.ts`, `src/paths.ts` and `src/acceptance.ts`;
- the stand-in: `test/fixtures/docker/stand-in.ts`;
- tests: `test/{verification,implementation,code-review}-stage.test.ts`,
  `test/acceptance.test.ts` and `test/acceptance-engine.test.ts`;
- two new recorded fixtures, `acceptance-report-matcher-argument*.json`;
- documents: `ARCHITECTURE.md` (sections 7, 11, 12, 15 and 17), `docs/hazards.md`
  entry 15, and the plan.

**Validation so far:**
- Every break-test failed as specified and was restored byte-identically
  (SHA-256).
- Stage tests pass: verification 31/31, implementation 75/75, code review 70/70.
- `acceptance.test.ts` passes 26/26 and the engine tests 5/5.
- typecheck and check:docs are clean.

**Re-review:** `2026-10-21-code-review-2.md`, reconciled.
- All four original findings are closed.
- It found 4 new lint defects: same-named helpers, object-literal helpers, a
  named `map` callback, and a spread join.
- Each is fixed in `src/acceptance.ts`, tested in `test/acceptance.test.ts`
  (29/29), and break-tested.

**Result:**
- The full serial suite: 1,829 of 1,833 pass, 0 fail, 4 named skips. The
  engine suites ran in it.
- Smoke passes 13/13, with and without `--acceptance-tests`.
- typecheck and check:docs are clean.
- The plan is `Implemented`, with Task 11 (paid) awaiting consent.

**Remaining:**
- the operator's decision to commit;
- Task 11's consent;
- the follow-ups recorded in the re-review.

Nothing has been committed.

**Rollback:** the work is uncommitted, so reverting the working tree to `9319f0a`
restores the baseline. The two new fixtures are untracked.
