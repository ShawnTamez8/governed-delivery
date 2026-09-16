# Debugging Analysis

## Problem

The full `npm test` run failed once while cleaning the temporary directory used
by the Windows process-tree termination test.

## Expected Behavior

`withRoot` removes its isolated `bw-verify-cmd-*` directory after
`runVerifyCommand` reports the hung command and its grandchild terminated.

## Actual Behavior

The full concurrent suite passed the functional assertions but `rmSync` raised
`EPERM` for the temporary directory during the test's `finally` cleanup.

## Reproducibility

Intermittent and Windows-specific. The exact failing test passed when rerun by
itself.

## Evidence

- Full suite: 1,169 passed, 1 failed, 5 skipped. The only failure was
  `test/verify-command.test.ts` cleanup with `EPERM`.
- Focused rerun:
  `node --test --test-name-pattern "a hung command is killed with its whole tree at the ceiling" test\verify-command.test.ts`
  passed in 2.8 seconds.
- The test had already asserted `timedOut`, a null `killError`, the duration
  ceiling, and `ESRCH` for the grandchild before cleanup failed.
- Cross-session history contained no prior matching `verify-command` cleanup
  incident in the preceding 30 days.

## Likely Failing Layer

Windows test cleanup. The evidence does not indicate a failure in
`runVerifyCommand` or the guided-project implementation.

## Scope Narrowing

The functional process-tree assertions passed, and the same test immediately
passed in isolation. The remaining suspect is a transient Windows filesystem
handle or scanner race during the high-concurrency full suite.

## Hypothesis

A short-lived external or runtime handle remained on the just-terminated test
directory during full-suite load, causing one immediate recursive removal to
receive `EPERM`.

## Hypothesis Result

Inconclusive. The isolated rerun did not reproduce the failure, so no evidence
supports changing production code or adding retry behavior to hide a
deterministic defect.

## Codebase Review

- `test/verify-command.test.ts`: owns the temporary directory and performs the
  failing cleanup in `withRoot`.
- `src/verify-command.ts`: exercised by the passing functional assertions; not
  changed for this incident.
- Existing coverage proves the command times out, the tree kill reports no
  error, and the grandchild is absent before cleanup.

## Proposed Fix

No code change. Rerun the complete suite once to distinguish a transient
cleanup race from a repeatable defect. If the same cleanup failure repeats,
stop and investigate open handles before considering a bounded test-only
cleanup strategy.

## Validation Plan

1. Rerun `npm test`.
2. If it passes, record the first result as a non-reproduced Windows cleanup
   race.
3. If it fails again, preserve the new path/process evidence and do not add a
   blind retry.

## Regression Coverage

No new coverage is justified: the existing test already exercises the
functional failure mode, and the observed cleanup error did not reproduce.

## Risks

The race may recur under unusually high Windows filesystem load. A passing
rerun does not identify which external handle caused the first `EPERM`.

## Open Questions

The process holding the transient directory handle was not identified.
