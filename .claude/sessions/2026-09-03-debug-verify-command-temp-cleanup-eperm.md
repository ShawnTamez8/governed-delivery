# Debugging Analysis

## Problem

The disposable completion checkout's first full `npm test` run completed the
hung-command assertions but failed while its test helper removed the temporary
directory.

## Expected Behavior

`runVerifyCommand` kills the timed-out command tree, closes its retained-output
stream, and the test helper removes its temporary root.

## Actual Behavior

The full suite reported 692 passes, one pre-existing Windows symlink skip, and
one failure. `rmSync(root, { recursive: true, force: true })` raised `EPERM` for
`bw-verify-cmd-BzLkAp` after the hung-command assertions completed.

## Reproducibility

Intermittent and load-sensitive on Windows. The exact failing test passed when
run once in isolation immediately afterward.

## Evidence

- Full-suite failure: `test/verify-command.test.ts:134`, `EPERM` deleting the
  test root after about 2.86 seconds.
- The retained directory contained only `evidence.txt` (17 bytes).
- Process inspection after the suite found no surviving test `node` or `npm`
  process.
- Isolated command:
  `node --test "--test-name-pattern=a hung command is killed with its whole tree at the ceiling" test/verify-command.test.ts`
  passed one of one tests in about 3.05 seconds.
- The original working checkout retained its starting commit and feature diff;
  the failure occurred only in the authorized disposable checkout.

## Likely Failing Layer

Test infrastructure: Windows temporary-directory cleanup after concurrent
process-tree tests.

## Scope Narrowing

The failure occurred after the command outcome assertions, not in criterion-ID
parsing, coverage gating, prompts, reconciliation, or stage behavior. No child
process remained when inspected, and the isolated test could delete its own
fresh root.

## Hypothesis

Under full-suite concurrency, Windows had not yet released one filesystem
handle when the helper's immediate `rmSync` ran.

## Hypothesis Result

Supported, not conclusively proven. The absence of a surviving child and the
immediate isolated pass distinguish a transient cleanup race from a
deterministic tree-kill failure. The exact holder at the failing instant was
not captured.

## Proposed Fix

None — speculative fix rejected. This failure is outside the stable
criterion-ID feature and a single isolated pass is not enough evidence to
change shared process-cleanup behavior.

## Validation Plan

Run the full disposable completion gate again after independent review, as the
feature plan already requires. If this same cleanup failure recurs, capture the
live handle or process at failure time before considering a bounded Windows
cleanup wait in the test helper.

## Regression Coverage

The existing hung-command test already covers process-tree termination and
cleanup. No new assertion is justified by the current evidence.

## Risks

The first full-suite run is not a passing completion gate. Treat the feature as
incomplete until a later isolated full run has zero failures.

## Open Questions

- Which Windows process or stream retained the directory handle during the
  failed cleanup instant?
