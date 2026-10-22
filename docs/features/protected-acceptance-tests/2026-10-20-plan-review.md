# Review: Executable Acceptance Criteria Implementation Plan

**Reviewed document:** `docs/features/protected-acceptance-tests/plan.md`
**Date:** 2026-10-20
**Reviewer:** the operator, by review findings given in the session that reconciled them
**Status:** reconciled

The findings below are recorded as the operator gave them, with their links reduced to the repository paths and line numbers they named at the time.

## High-risk areas

### H1. Tests are not protected during system verification

Task 7 (plan line 331) adds read-only overlays for the implementation, self-review and remediation containers. It does not carry that protection into `verifyCommit`.

Verification creates a writable worktree container (`src/commit-verification.ts:248`), then runs target-supplied commands before the acceptance tests. Those commands can execute agent-authored code. A post-command Git check can detect lasting changes; it does not establish that the tests were never temporarily modified during execution.

**Mitigation:** carry the acceptance-directory protection through system verification too, and test that a target verification command cannot modify the suite. Cover both ordinary and remediation verification.

### H2. Changing the runner configuration will not invalidate the image cache

Task 2 (plan line 199) adds `container/acceptance.config.mjs` as a file copied into the image. However, `findSandboxImage` (`src/container.ts:275`) derives the image tag solely from the Dockerfile, and `ensureImage` reuses an existing image under that tag. Editing only the acceptance configuration therefore leaves BuildWorks selecting the previously built image, which contains the old configuration.

**Mitigation:** include the copied configuration in the image-cache identity. Add a regression check proving that changing only that file changes the selected tag, while existing runs keep their frozen image ID.

### H3. The baseline gate cannot distinguish an expected behavioural failure from a broken test

The report parser (plan line 202) keeps titles and statuses. The validity gate (plan line 65) accepts consistent failures as the required red baseline.

Playwright records individual test errors separately from report-level errors. A navigation failure, or a fixture or browser setup failure, can therefore appear as a failed test without showing that the intended acceptance assertion was exercised. The proposed parser discards the diagnostic information needed to tell those cases apart.

**Mitigation:** define which baseline failures count as valid red evidence, keep the necessary diagnostics, and cover rejected setup and runtime failures. In particular, define explicitly how the intentionally absent `index.html` is handled. Do not equate "failed twice" with "valid acceptance test".

## Medium concerns

### M1. Existing static applications have no defined baseline policy

Gate 3 (plan line 68) rejects a criterion whose tests already pass, and the author prompt (plan line 251) says nothing is implemented. That matches the empty calculator benchmark. It does not match an existing static application, where some approved criteria may describe behaviour already present. The plan limits support to static pages, but does not limit it explicitly to empty repositories.

**Mitigation:** either constrain and enforce greenfield-only eligibility explicitly, or define how already-satisfied criteria become valid regression guards without an artificial failure.

### M2. The execution preview omits the additional paid dispatch

Task 6 (plan line 304) adds a test-author dispatch, but the plan does not update `formatRunPreview` (`src/operator-output.ts:54`). Its implementation ceiling stays at `implementationMaxPhases + 1`, which counts only the phases and the self-review.

**Mitigation:** update the preview text and ceiling conditionally for opted-in runs, with tests that keep the existing preview when acceptance testing is off.

---

## Reconciliation

**Date:** 2026-10-20
**Disposition:** 5 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

**Hazards considered:**
- **15 (read-only by declaration):** H1 extends the read-only mount to every container holding the worktree, and an engine test breaks it.
- **4 (fixtures and code agreeing):** H3's classification rule is pinned to reports the real runner produced, never hand-written ones.
- **12 (configuration divergence):** H2 makes the image's identity cover every copied file.
- **21 (agents never told their gate):** M2 states the extra dispatch in the consent preview.
- **18 (correctness never inspected):** H3 and M1 make a red baseline mean an exercised assertion.
- **Not engaged:** the others, because no finding touches prompts' reply shapes, retries, executors, review panels or delivery.

### Verdicts

- **Accepted — H1, tests not protected during system verification:**
  - `verifyCommit` gains `readOnlyPaths`, so the whole verification container holds the suite read-only through every verify command. That covers the verification stage, remediation verification and the gate run.
  - Task 7 adds an engine test in which a verify command writes into the suite directly, and a detached process tries to rewrite it while the acceptance command runs; the suite stays byte-identical.
  - It adds stand-in argv tests for both ordinary and remediation verification, and a break-test for each.
- **Accepted — H2, image cache identity:**
  - `sandboxImageTag` hashes every file in `container/`, path and bytes, in sorted order.
  - Task 2 tests that a config-only change changes the tag, an unchanged tree keeps it, and a rename changes it.
  - It tests that a frozen run's `imageId` is still honoured through `requireImage` without reading the tag. The blast radius records that the first `new-run` after the change builds a new image.
- **Accepted — H3, valid red evidence:**
  - Gate 3 now counts a failure as red only when its first error comes from a locator action or an `expect` matcher in the test body, located in the suite's file and outside any hook.
  - Navigation, launch, hook, test-code and whole-test timeouts are classified separately and refuse the suite. A flaky error class counts as flaky.
  - The parser keeps each result's errors (message, location and stack). The rule is pinned to one recorded real-runner report per case, captured in Task 1, which stops if any two cases cannot be told apart.
  - An absent `index.html` is handled by a blank stub page written in a throwaway checkout of the suite commit, never the run worktree. Task 1 probes that the stub turns a missing element into a locator timeout, not a navigation error.
- **Accepted — M1, existing static applications (operator: "Allow, as regression guards"):**
  - A criterion covered only by tests that already pass is accepted as `already_satisfied`, and its tests are recorded as regression guards in the gate record and listed in the code reviewers' prompt.
  - Gate 5's lint requires every test to assert on a page locator, so a guard cannot be vacuous.
  - The author prompt no longer says nothing is implemented.
- **Accepted — M2, the execution preview:**
  - `formatRunPreview` counts one more implementation dispatch for an opted-in run, with the ceiling at `implementationMaxPhases + 2`, and names the test-author dispatch.
  - Task 6 adds both preview tests: an off profile is byte-identical to a snapshot taken before the change. It also adds a break-test.
