# Dashboard full-suite approval-expiry flake

**Date:** 2026-09-12
**Status:** resolved

## Expected behavior

`Task 8 a legitimately granted approval is not revoked when its acceptance
expiry elapses` accepts a valid approval before its expiry, advances the
observed clock past that expiry, and proves that later workflow execution does
not revoke the recorded approval.

## Actual behavior

Two loaded `npm test` runs failed in `approveFixture` before recording the
approval. The test computed an expiry five seconds ahead of wall-clock time,
but concurrent suite load delayed signing and `approveRun` long enough for
`validateExpiry` to return `approval expired at <timestamp>`. The same test
passed in isolation.

## Cause and fix

The failing layer was test timing, not approval or dashboard behavior. The test
used one short real-time window for two different boundaries: approval must
occur before expiry, while the later run must occur after expiry.

The test now uses Node's test-scoped mock for `Date.now`. It holds time fixed
while creating the approval, then advances the controlled value 25 milliseconds
past the signed expiry before resuming the run. This preserves the production
contract without waiting or widening the acceptance window.

## Validation

- `node --test --test-name-pattern="Task 8 a legitimately granted approval is not revoked" test/run-command.test.ts` passes.
- `npm test` passes 1,122 tests, skips five and fails zero in the loaded full suite.
- `npm run typecheck` passes both TypeScript programs.
- `npm run check:docs` remains clean with 72 historical path warnings.

## Remaining risk

None identified. The mock is scoped to the test context and the final full
suite demonstrates that it does not leak into other tests.
