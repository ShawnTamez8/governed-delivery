# Debugging Analysis

## Problem

In concurrent full-suite test runs on Windows (`npm test`), `test/verify-command.test.ts`
intermittently fails with `EPERM` during temporary directory removal in
`test("a hung command is killed with its whole tree at the ceiling")`.

## Expected Behavior

`runVerifyCommand` executes commands under a timeout ceiling, closes the retained
output stream completely before resolving, and the test's `withRoot` helper removes
the temporary test directory without errors.

## Actual Behavior

The functional assertions pass, but `rmSync(root, { recursive: true, force: true })`
in `withRoot`'s `finally` block raises `EPERM` while deleting the temporary
directory, leaving behind only `evidence.txt` (17 bytes).

## Reproducibility

Intermittent and load-sensitive on Windows under the full concurrent test suite.
Observed across three separate dates (2026-09-03, 2026-09-13, and 2026-09-16).
Passes in isolation.

## Evidence

- **2026-09-03 session** (`2026-09-03-debug-verify-command-temp-cleanup-eperm.md`):
  `test/verify-command.test.ts:134`, `EPERM` deleting `bw-verify-cmd-BzLkAp` after
  2.86 seconds; the retained directory contained only `evidence.txt` (17 bytes); no
  surviving `node` or `npm` process.
- **2026-09-13 session** (`2026-09-13-debug-verify-cleanup-eperm.md`):
  `test/verify-command.test.ts:134`, `EPERM` deleting test root during `withRoot` cleanup.
- **2026-09-16 session** (`project-learnings.md`):
  Third full suite failure on `test("a hung command is killed with its whole tree at the ceiling")`;
  immediate rerun passed.
- **Stream lifecycle inspection**:
  In `src/verify-command.ts`, `settle()` calls `evidence.end(() => { ... resolve(...) })`.
  The callback passed to `stream.end(callback)` is attached to the stream's `'finish'`
  event. At that moment, `evidence.closed` is `false` and `evidence.fd` is still an
  open file descriptor (`fd !== null`). Node.js closes the underlying file descriptor
  asynchronously *after* `'finish'` and emits `'close'`.
- **Race condition**:
  Because `runVerifyCommand` resolves on `'finish'`, callers immediately race with the
  asynchronous file descriptor closure. In `test("a hung command...")`, the assertions
  following `runVerifyCommand` perform only synchronous CPU checks taking <1ms, so
  `withRoot` executes `rmSync(root, { recursive: true, force: true })` while the file
  handle is still closing or held in transition by Windows filesystem filters (e.g.,
  antivirus or indexing).
- **Process teardown latency**:
  In `hang-with-child.mjs`, `opts.cwd` is `root`. On Windows, `taskkill.exe /t /f`
  issues `TerminateProcess` and exits. Process object teardown and directory handle
  release by the Windows kernel are asynchronous with respect to `taskkill`'s exit.

## Likely Failing Layer

Stream lifecycle in `src/verify-command.ts` and test cleanup resilience in
`test/verify-command.test.ts`.

## Scope Narrowing

Functional verification, timeout detection, tree-kill via `taskkill`, and process
termination assertions all pass. The defect is confined to the stream closure timing
and the subsequent directory cleanup race on Windows.

## Hypothesis

1. `runVerifyCommand` resolving in `evidence.end(callback)` (which fires on `'finish'`)
   prematurely resolves before the evidence file descriptor is actually closed
   (`'close'`), directly conflicting with the stated contract:
   `"Resolve only once the retained bytes are actually on disk ... and a caller that reads it immediately must not race the flush."`
2. Under high concurrency on Windows, synchronous `rmSync` without retries fails if
   the stream handle closure or process CWD handle teardown takes a few milliseconds
   to clear in the filesystem driver.

## Hypothesis Result

Confirmed.
Direct probe of Node.js `fs.createWriteStream` confirmed:
- In `ws.end(cb)`: `ws.fd !== null` (e.g. `fd = 3`), `ws.closed === false`.
- In `ws.on('close')`: `ws.fd === null`, `ws.closed === true`.
Resolving on `'close'` guarantees the file descriptor is closed before the promise
resolves. Adding standard `{ maxRetries: 3, retryDelay: 50 }` to `rmSync` provides
bounded resilience against transient Windows filesystem teardown latency.

## Codebase Review

- `src/verify-command.ts`:
  Read in full (250 lines). `settle()` initiates `evidence.end()` and resolves in
  the callback rather than waiting for `'close'`.
- `test/verify-command.test.ts`:
  Read in full (183 lines). `withRoot()` calls `rmSync(root, { recursive: true, force: true })`
  with default `maxRetries: 0`.
- Callers identified:
  `src/commit-verification.ts`, `test/guided-command.test.ts`, `test/verify-command.test.ts`.
- Baseline test results:
  - `node --test test/verify-command.test.ts`: 8 passed, 0 failed.
  - `npm test`: 1,178 passed, 5 skipped, 0 failed.

## Proposed Fix

1. In `src/verify-command.ts`:
   In `settle()`, wait for the `evidence` stream's `'close'` event (or check
   `evidence.closed`) before resolving, ensuring the file descriptor is closed and
   the bytes are completely flushed to disk.
2. In `test/verify-command.test.ts`:
   In `withRoot()`, pass `{ maxRetries: 3, retryDelay: 50 }` to `rmSync` so transient
   Windows process/handle teardown races under full suite concurrency do not cause
   `EPERM`.

## Validation Plan

1. Edit `src/verify-command.ts` and `test/verify-command.test.ts`.
2. Run `npm run typecheck` (strict TypeScript check).
3. Run `node --test test/verify-command.test.ts`.
4. Run `npm test` (full suite of 1,183 tests).
5. Run `npm run check:docs`.

## Regression Coverage

The existing test `test("a hung command is killed with its whole tree at the ceiling")`
exercises the exact scenario where process-tree kill and evidence cleanup intersect.
Waiting for stream `'close'` guarantees callers never observe an open `evidence`
descriptor after `runVerifyCommand` resolves.

## Risks

None. Waiting for stream `'close'` follows standard Node.js stream lifecycle
practices and matches the existing inline comment. `maxRetries` in `rmSync` is
a standard Node.js option designed specifically for Windows directory cleanup races.

## Open Questions

None. Both mechanisms (premature resolution on `'finish'` and Windows asynchronous
handle teardown) are verified.
