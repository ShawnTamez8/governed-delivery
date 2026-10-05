# Baseline Verification Implementation Plan — plan review

**Reviewed document:** `docs/features/baseline-verification/plan.md`
**Governing sources:** `CLAUDE.md`, `ARCHITECTURE.md` section 7, `docs/hazards.md`
**Repository evidence:** `src/commit-verification.ts`, `src/verify-command.ts`, `src/run-command.ts`, the team-notes target at commit `3b73c3d`
**Review date:** 2026-10-05
**Status:** reconciled
**Hazards considered:** 2, 4, 6, 7, 8, 11, 12 and 18 were weighed by the reviewer. `check:docs` passed with path warnings. The reviewer changed no repository files, spent nothing, and reproduced findings 2 and 3 against the existing verifier; real Next.js, pnpm and C# builds were not run.

This record was created at reconciliation time from findings pasted into the
conversation without a review file; the findings below are the pasted text,
unchanged.

---

## Findings

1. **High — The gate rejects features needed to make the starting project build.**
   Lines 40–42 require every frozen command to pass before implementation, including failures caused by existing code. The cited team-notes commit, 3b73c3d, declares build: next build but contains no app, pages, or src files. Repairing its dependencies does not supply the missing application. This also prevents a defect_fix run from repairing an existing typecheck/build failure. The plan needs an explicit decision about unfinished scaffolds and corrective work; dependency repair alone cannot make these runs eligible.

2. **High — Reusing the baseline worktree can approve an environment the implementation worktree cannot reproduce.**
   Task 2 (line 238) reuses a clean worktree, and Task 5 (line 323) repairs it by creating an ignored marker there. checkCommitState ignores ignored files. The later implementation worktree receives tracked files only, so it lacks that repair.
   The reviewer reproduced this with the existing verifyCommit: first baseline blocked, retained baseline after adding the marker passed, fresh implementation worktree blocked. The proposed test therefore accepts the same late-failure mechanism this feature is intended to prevent. Each attempt must establish readiness reproducible in the implementation worktree.

3. **High — Retrying destroys the previous attempt's evidence.**
   Task 2's evidence path (line 230) varies only by run. verifyCommit writes <command>.log, and runVerifyCommand opens it with truncating createWriteStream. A retry replaces the bytes referenced by the earlier failure's immutable audit event.
   The probe confirmed this: the original failure reference changed from marker-missing to marker-present. The audit chain would still verify. Require a unique evidence directory per attempt and bind each event to that attempt's retained result.

4. **Medium — A dirty or interrupted baseline has no defined retry path.**
   Lines 241–243 permit reuse only at the expected commit and when clean. They specify no behavior when an existing baseline contains generated untracked files, tracked changes, or a partial checkout. Creating it again fails because the destination already exists; reusing it fails the verifier's entry guard. Leaving the run in_progress does not make it resumable. Define an evidence-preserving replacement procedure and test this failure branch.

5. **Medium — Task 6 cannot perform its promised free baseline checks.**
   Lines 357–362 instruct the operator to decline paid execution consent and record whether the baseline passes. advanceRun returns immediately when consent is declined, before acquiring the writer lock or reaching the proposed hook. Granting consent instead allows a passing baseline to proceed directly into the paid group; there is no intervening stop. Use direct baseline-function checks or a fixture-backed executor for this validation.

6. **Medium — The skip-on-pass mutation test can pass without exercising the guard.**
   Task 5's third invocation (line 323) follows successful execution of the first group. That group normally pauses at approval—or at operator questions. advanceRun returns at those boundaries before reaching the baseline hook. Exactly one pass event therefore remains even if the skip check is deleted. Advance through the human boundary explicitly, or repeat the baseline function directly, before asserting that the guard works.

7. **Medium — A baseline refusal returns a snapshot from before its audit event.**
   Task 3 (line 270) re-observes only on success. On failure, result() uses the existing observed.snapshot, captured before the baseline ran. Consequently, run --json reports a refusal alongside stale activity.lastEvent and lastRecordedAt, omitting the failure it just persisted. Re-observe after either outcome before constructing the response.

8. **Low — Task 1's evidence extraction and validation instructions are incorrect.**
   Lines 209–218 name audit_event; the actual table is audit. They also claim harness-stream-fixtures.test.ts scans the recorded fixture directory. It reads one fixed stream recording and tests harness emitters; it will never read the new verification fixture. Correct the query and add an explicit validation of the captured fixture and provenance.

---

## Reconciliation

**Date:** 2026-10-05
**Disposition:** 8 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

Each claim was checked before it was accepted. Confirmed from the repository:
`git ls-tree -r --name-only 3b73c3d` in team-notes lists config files and design
documents and no application source (finding 1); `src/migrations/001_init.sql`
creates `audit`, and `test/harness-stream-fixtures.test.ts` reads
`harness-stream-json-envelope.json` only (finding 8); `src/verify-command.ts`
opens the evidence file with `createWriteStream(opts.evidencePath)` and
`src/commit-verification.ts` `checkCommitState` runs `git status --porcelain`
without `--ignored` (findings 2 and 3); `src/run-command.ts` returns on a
declined consent before the lock and the loop, and its `result` closure reads
`observed.snapshot` (findings 5, 6 and 7). The reproductions in findings 2 and 3
were not re-run; the plan labels them as the reviewer's.

### Verdicts

- **Accepted — The gate rejects features needed to make the starting project build:** operator decision, 2026-10-05, "Refuse unless operator accepts". A red baseline refuses by default and `run --accept-red-baseline` lets one invocation proceed; the failure and the acceptance are audit events. Plan: Assumptions, Approach, Decisions item 5, Tasks 2-5, Task 7. Guided mode gets no flag; whether a guided run can continue under `run --run N` is recorded as an unknown for Task 3.
- **Accepted — Reusing the baseline worktree can approve an environment the implementation worktree cannot reproduce:** no attempt reuses a worktree; each gets `.governance/worktrees/baseline-<run>-<attempt>`. Task 5 repairs by creating the marker in the main checkout, which both worktrees reach, and adds a test that verifies in a fresh worktree at the implementation path. Decisions item 3 was changed from the first draft's reuse proposal; that follows from the evidence, not from an operator choice.
- **Accepted — Retrying destroys the previous attempt's evidence:** a per-attempt evidence directory `.governance/baseline/<run>/<attempt>/`, an attempt `result.json`, and the audit event carries its SHA-256. Task 5 asserts attempt 1's files are byte-identical after a retry.
- **Accepted — A dirty or interrupted baseline has no defined retry path:** the replacement procedure is to never reuse or repair: the attempt number is the smallest integer whose paths do not exist, and a leftover is kept as evidence. Task 5 pre-creates a dirty attempt 1 and asserts attempt 2 passes and attempt 1 is untouched. A failed `git worktree add` records a fail event and refuses.
- **Accepted — Task 6 cannot perform its promised free baseline checks:** Task 6 now calls `runBaselineVerification` directly from a scratch script against a low-level `new-run`, and says why `buildworks run` cannot be used. The Verification section drops the real-target `run` as a free proof. The Drizzle-on-team-notes check is marked not answerable at `3b73c3d`.
- **Accepted — The skip-on-pass mutation test can pass without exercising the guard:** the skip test calls the function directly twice, and break-it (c) names the expected failure (two pass events). The accepted-red skip is tested the same way.
- **Accepted — A baseline refusal returns a snapshot from before its audit event:** Task 3 re-observes after either outcome before building the result, and Task 5 asserts the refusal's last-activity fields name the new event, with break-it (e) as the guard check.
- **Accepted — Task 1's evidence extraction and validation instructions are incorrect:** the query names the `audit` table and tells the implementer to read `001_init.sql` for columns; the false claim about the harness test is removed; Task 1 adds `test/recorded-verification-evidence.test.ts` to validate the fixture and its provenance.
