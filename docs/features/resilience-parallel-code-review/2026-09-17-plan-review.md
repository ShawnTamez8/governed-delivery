# Resilience Reviewer and Parallel Code-Review Panels — plan review

**Reviewed document:** plan.md
**Document type:** Plan
**Review date:** 2026-09-17
**Status:** reconciled

**Hazards considered:** 1 (provider output shapes), 2 (discarded output), 3 (prompt-only constraints), 4 (hand-written fixtures), 7 (identical retries), 8 (Windows executable resolution), 11 (default installation paths), 12 (configuration divergence), 14 (reviewer independence), 15 (read-only reviewers), and 18 (code-inspection coverage).

---

## Summary

The plan defines a disciplined expansion of the code-review stage, adding a third resilience specialist and executing panel dispatches concurrently using `Promise.allSettled`. It preserves deterministic consumption, sequential remediation, and immutable evidence, but contains two critical hazards: intermediate worktree cleanliness checks that race against active concurrent subprocesses, and test barrier environment variables stripped by executor sandboxes.

## Verdict

- **Ready for planning after required changes** — The architectural direction is sound and preserves all binding constraints, but the plan requires corrections for concurrent worktree inspection safety, test fixture environment propagation, audit event naming, and incomplete-panel finding persistence before implementation begins.

## Critical issues — must fix before implementation

**Issue:** Intermediate worktree cleanliness checks race against concurrent child processes

- **Why it matters:** Task Step 3 specifies that after each dispatch completes, the stage immediately observes `HEAD` and executes `checkWorktreeClean`. When three reviewers execute concurrently in the same shared worktree, the fastest reviewer finishes while sibling processes are actively running. Running `git status --porcelain -z --untracked-files=all --ignored=matching` while other processes read files in the same worktree causes race conditions and file lock contention, specifically `.git/index.lock` collisions on Windows. Any non-quiescent worktree state observed while siblings run causes the panel to fail spuriously.
- **Where:** Task Step 3 and the Shared-worktree integrity section.
- **Production impact:** Spurious panel rejections, transient `.git/index.lock` errors, and aborted runs during concurrent review on Windows.
- **Recommended fix:** Remove intermediate worktree cleanliness and `HEAD` checks from individual reviewer completion handlers. Perform worktree cleanliness and `HEAD` verification exactly once, after all sibling dispatches have fully settled, when the worktree is quiescent.

**Issue:** Test harness environment filtering strips proposed barrier variables

- **Why it matters:** Task Step 4 proposes a test-only barrier mode where reviewers wait for start markers, stating: "Pass the marker directory and expected count only through explicitly allowlisted fixture environment variables." However, `invokeHarness` in `src/harness.ts` filters child environment variables strictly against `executor.sandbox.envPassthrough`. The production definition `CLAUDE_CODE` and test fixture executors only allowlist standard system variables and `EMIT_MODE`. Custom barrier variables passed in the test environment are stripped before child process invocation.
- **Where:** Task Step 4 and `src/executor.ts`.
- **Production impact:** The proposed concurrency barrier test hangs or times out because child processes never receive the barrier configuration.
- **Recommended fix:** Specify that `test/code-review-stage.test.ts` configures the barrier directory through a subdirectory of `TEMP` or `TMP` (which all executor sandboxes allowlist), or adds `BARRIER_DIR` explicitly to `envPassthrough` in the test's `fixtureExecutor` helper, avoiding changes to production executor configuration.

## High-risk areas

**Risk:** Underspecified audit action names and terminal failure event semantics

- **Why:** The plan introduces a panel-dispatch audit event, a panel-settled audit event, and a terminal failure summary, but does not define their canonical `action` strings or payload structures. Existing tests and downstream audit chain verifiers (`operator-state.ts`, `verify-audit`, dashboard projections) assert exact action names.
- **Impact if ignored:** Implementers introduce ad-hoc action names, breaking audit queries, test assertions, and status reporting.
- **Mitigation:** Define exact canonical action strings in the plan: `code_review.panel.start`, `code_review.panel.settled`, and `code_review.reviewer.failed` (or `code_review.panel.failed`), including semicolon-delimited key-value payload formats matching repository conventions.

**Risk:** Persisting canonical findings for an aborted panel creates orphaned run state

- **Why:** Task Step 3 specifies that when panel integrity is clean, the stage persists every valid reviewer report and canonical finding in frozen panel order, even if another reviewer in the panel failed. In existing code, `abort()` completes the stage with an empty `output_ref` (`""`) before inserting canonical findings or reports.
- **Impact if ignored:** Storing canonical findings for a stage that aborted without remediation creates orphaned `canonical_finding` and `finding_report` rows in SQLite. Downstream inspection tools (`bw status`, `operator-state`) display these as active findings, misrepresenting execution failures as code defects.
- **Mitigation:** Explicitly specify that if any reviewer fails, the stage preserves all raw outputs and `agent_run` records for post-mortem debugging, but does not call `store.upsertCanonicalFinding` or `store.insertFindingReport`.

**Risk:** Brittle coupling between lexicographical agent ID and panel priority

- **Why:** The plan relies on the agent ID `code-reviewer-state-integrity` sorting alphabetically after `code-reviewer-security` to ensure that two-seat configurations select correctness and security rather than resilience.
- **Impact if ignored:** Renaming the agent ID or file to `code-reviewer-resilience` silently displaces security in two-seat runs without triggering a syntax or schema error.
- **Mitigation:** Add an explicit comment documenting this ordering constraint in `src/agents/code-reviewer-state-integrity.ts`, and add an explicit test asserting that `codeReviewPanel(AGENTS, 2, ...)` selects correctness and security while `codeReviewPanel(AGENTS, 3, ...)` selects correctness, security, and state-integrity.

## Medium and low concerns

- The barrier loop in `test/fixtures/harness/emit-code-review.mjs` must not use an unthrottled spin loop (`while (!allStarted)`). It must pause between filesystem polls and enforce an explicit deadline (for example 5 seconds) to prevent CPU pegging and test runner timeouts on Windows.
- The plan must specify whether `result.json` is generated when a panel fails. In the current implementation, `abort()` leaves `output_ref` as `""` and writes no `result.json`. The plan should confirm this behavior rather than leaving it to implementer choice.
- Multi-reviewer failure formatting requires an explicit contract. When multiple reviewers fail concurrently, the stage must combine individual failure summaries deterministically (for example in panel seat order) in both the stage abort reason and the audit event.
- `.claude/skills/run-buildworks/SKILL.md` hardcodes references to two code reviewers and two default panel seats. The plan notes updating the skill in Task Step 1, but must ensure existing historical run logs remain preserved as dated historical records.

## Missing and underspecified areas

- The plan does not define how process cancellation behaves if the parent process receives `SIGINT` during concurrent dispatch. Child process management on abort should be explicitly documented.
- The plan does not specify the exact payload schema for the `code_review.panel.settled` audit event. Define the required keys (for example `round`, `commit`, `elapsedMs`, `outcomes`, `integrity`).

## Suggested improvements

- Format all new audit payloads using the standard repository convention: `round=<N>; commit=<SHA>; elapsed=<MS>ms; status=<STATUS>; panel=<ID+ID+ID>`.
- Add a targeted test verifying that when one reviewer fails after 50ms and a sibling reviewer completes after 300ms, the stage awaits the slower reviewer and records its `agent_run` and raw output before returning.

---

## Reconciliation

**Date:** 2026-09-17
**Disposition:** 12 accepted, 1 rejected, 0 deferred, 0 open
**Status:** reconciled

**Hazards considered:** The reconciliation applies the review's named hazards 1, 2, 3, 4, 7, 8, 11, 12, 14, 15, and 18 to the corrected dispatch, evidence, fixture, and worktree contracts.

### Verdicts

- **Accepted — Intermediate worktree cleanliness checks race against concurrent child processes:** The plan removes per-completion Git checks and performs one HEAD and full cleanliness check after every reviewer process settles.
- **Accepted — Test harness environment filtering strips proposed barrier variables:** The plan names test-only barrier variables and adds them only to the cloned fixture executor's passthrough list.
- **Accepted — Underspecified audit action names and terminal failure event semantics:** The plan fixes the actions as `code_review.panel.start`, `code_review.panel.settled`, and the existing `code_review.reviewer.failed`, with canonical ordered summaries.
- **Rejected — Persisting canonical findings for an aborted panel creates orphaned run state:** `ARCHITECTURE.md` requires every valid report to remain immutable evidence, and the current sequential stage already retains an earlier valid reviewer's findings when a later reviewer fails. The blocked stage status, empty output reference, absent review record, and absent gate event distinguish that evidence from a complete panel or gate result.
- **Accepted — Brittle coupling between lexicographical agent ID and panel priority:** The plan requires an adjacent source comment and explicit two-seat and three-seat selection tests for the stable ID ordering constraint.
- **Accepted — Barrier polling needs throttling and a deadline:** The fixture uses delayed polling, a five-second deadline, and a named expiry failure.
- **Accepted — Failed-panel result artifact behavior is unspecified:** The plan preserves empty `output_ref` and creates no code-review `result.json` or `report.md` for an incomplete or integrity-failed panel.
- **Accepted — Multi-reviewer failure formatting lacks a contract:** The plan orders typed failure kinds by frozen panel seat in both the terminal audit summary and operator-visible abort reason.
- **Accepted — Historical two-reviewer records need preservation:** The plan limits documentation edits to current operating text and leaves dated historical run facts unchanged.
- **Accepted — Parent-signal cancellation is unspecified:** The plan states that `Promise.allSettled` covers in-process outcomes only and leaves harness-wide `SIGINT` and `SIGTERM` cancellation to a separate design.
- **Accepted — The settled audit payload lacks an exact schema:** The plan defines required `round`, `commit`, `elapsedMs`, ordered `outcomes`, and `integrity` fields with closed status vocabularies.
- **Accepted — New audit payloads need the repository format:** The plan uses semicolon-delimited key-value summaries and `+`-joined frozen panel IDs.
- **Accepted — Failure draining needs a targeted delayed-sibling test:** The plan adds controlled short and long fixture delays and uses completion-marker ordering, retained evidence, and absence of remediation as deterministic assertions.
