# Debugging Analysis

## Problem

`npm test` on 2026-09-24 (1,189 tests, 825 s) failed one test:
`test/verify-command.test.ts:134`, "a hung command is killed with its whole tree
at the ceiling". This is the fourth recorded occurrence (2026-09-03, 2026-09-13,
2026-09-15/16, 2026-09-24), and the first since `4848a64` claimed to fix it.

## Expected Behavior

After `runVerifyCommand` resolves, `withRoot` removes the test's temporary
directory. The 2026-09-16 fix expected `rmSync(..., { maxRetries: 3,
retryDelay: 50 })` to absorb any transient Windows hold.

## Actual Behavior

Every functional assertion passes (timeout, null `killError`, duration bound,
grandchild `ESRCH`). Cleanup then throws from `withRoot`:

```text
Error: EPERM, Permission denied: \\?\C:\Users\tamezs\AppData\Local\Temp\1\bw-verify-cmd-sCUJvo '\\?\...\bw-verify-cmd-sCUJvo'
    at rmSync (node:fs:1484:18)
    at file:///.../test/verify-command.test.ts:13:33
  code: 'EPERM'
```

Only `evidence.txt` is left behind, which means deleting that file is what
failed.

## Reproducibility

Intermittent and load-dependent. Running 16 concurrent copies of this one test
for 8 rounds reproduced it 2 times in 128 runs, with the same stack and
signature. The operator's full-suite leftover `bw-verify-cmd-SJDMBl` (2:16) has
the same shape. Reproduce with:
`node <scratchpad>\stress-hung.mjs <outdir> 16 8`.

## Evidence

- **The 2026-09-16 test-side retry is inert on this runtime.** On Node v26.4.0,
  with a PowerShell process holding a file open with `FileShare.None` for 800 ms,
  `rmSync(root, { recursive, force })`, `{ maxRetries: 3, retryDelay: 50 }` and
  `{ maxRetries: 10, retryDelay: 100 }` all fail with the same
  `EPERM, Permission denied: \\?\<root>` after 0–1 ms. No retry happens, and the
  message format matches the test failure exactly. (For comparison,
  `fs.promises.rm` reports `EBUSY ... unlink '<root>\evidence.txt'`, so the sync
  implementation reports the root path for a held file inside it.)
- **The hold is transient.** Minutes later, all three leftover `evidence.txt`
  files open exclusively without error, and no process matching
  `setInterval|hang-with-child` survives.
- **Children do not inherit the evidence handle.** With the stream opened before
  and after `spawn`, with `shell` true and false, `unlinkSync(evidence.txt)`
  succeeds while the spawned child is still alive.
- **Control:** "the command runs in the given working directory" writes an
  evidence file without a kill and failed 0 times in 128 runs under the same
  concurrency. This suggests the lock is specific to the kill path but does not
  prove it (2/128 against 0/128 is weak), although all four historical failures
  hit this one test.
- **No production impact:** `src/commit-verification.ts:114` keeps the evidence
  at `<evidenceDir>/<name>.log` and never deletes it after the command, so a
  transient hold only affects the test's cleanup.
- No handle-inspection tool (`handle.exe`, `procmon.exe`) is installed, and
  `MsMpEng` is not visible to this user, so the holder cannot be named directly.

## Likely Failing Layer

Test code: the `withRoot` cleanup in `test/verify-command.test.ts:13`.
`src/verify-command.ts` behaves as specified.

## Scope Narrowing

Ruled out:
- Our own evidence descriptor: `settle()` waits for `'close'` (`4848a64`), and the
  functional assertions pass.
- Handle inheritance by `cmd.exe`, the fixture or the grandchild: the probe above
  disproved it.
- Surviving processes: the grandchild asserts `ESRCH`, and no fixture process
  survives.

Still suspect (the holder, unidentified): an external scanner or endpoint agent
opening the freshly closed `evidence.txt`, possibly triggered by the forced tree
kill. **[Inference]**, not verified.

## Hypothesis

Something outside the process tree holds `evidence.txt` for a short time after
the verify run. Node 26's `rmSync` does not retry that EPERM despite
`maxRetries`, so any hold longer than about 0 ms fails the test. The 2026-09-16
change never provided the resilience it claimed.

## Hypothesis Result

The inert-retry half is **confirmed** by the direct probe. Which process holds
the file is **unknown**.

## Codebase Review

- `test/verify-command.test.ts` (183 lines) and `src/verify-command.ts`
  (254 lines) read in full. The only `maxRetries` in `src`, `test`, `scripts`
  and `.claude/skills` is `test/verify-command.test.ts:13`.
- Fixture `test/fixtures/verify/hang-with-child.mjs` read in full; `killTree` is
  at `src/harness.ts:71`.

## Proposed Fix (awaiting operator approval)

Test-only. Replace the inert `rmSync` options in `withRoot` with an explicit,
bounded retry that retries only `EPERM`/`EBUSY`, with a budget of about 2 s,
and re-throws anything else or anything that outlasts the budget. Include a
comment naming the Node 26 behaviour. No production change, and no assertion
is weakened.

## Validation Plan

1. Run the held-file probe against the new helper: an 800 ms hold must be
   removed, and a hold longer than the budget must still throw.
2. Break-test: set the retry budget to zero, confirm the probe fails, restore
   by reversing the edit.
3. Stress `16 x 8` of the hung test: expect 0 failures, compared with the
   2/128 baseline.
4. `node --test test/verify-command.test.ts`, `npm run typecheck`, `npm test`.

## Regression Coverage

No committed test can reproduce an external scanner hold. The held-file probe
is the regression evidence for the helper itself and belongs in the record, not
in the suite. Committing a test that spawns PowerShell to lock files would add
a platform-specific fixture for test infrastructure.

## Risks

A long-lived external hold still fails the test, which is correct: it then
names a real, different problem. The retry covers up nothing in
`runVerifyCommand`, because every functional assertion runs before cleanup.

## Corrections to earlier records

`2026-09-16-debug-verify-command-cleanup-eperm.md` concluded "Confirmed" and
"Open Questions: None", and it credited `rmSync` `maxRetries` with bounded
resilience. That resilience never existed on Node v26.4.0: the option was
added without a probe of the installed runtime. That record's `'close'`
correction to `src/verify-command.ts` stands.

## Fix Applied and Validation (2026-09-24, operator-approved)

`test/verify-command.test.ts`: `withRoot` now awaits `removeRoot`, which retries
only EPERM/EBUSY, up to 20 attempts 100 ms apart (about 2 s), then re-throws.
This is the only file changed (24 insertions, 1 deletion). SHA-256 after the fix:
`257A132C...976926`.

- Held-file probe (`scratchpad\probe-remove-root.mjs` extracts the helper body
  from the test file at runtime): an 800 ms hold is removed after 976 ms; a
  3,500 ms hold still throws EPERM after 2,196 ms; **break:** with zero attempts,
  an 800 ms hold throws EPERM after 1 ms.
- Instrumented stress (a temporary stderr line in the retry branch, removed
  afterwards with the hash restored exactly): 0 failures in 256 runs (`16x16`).
  Run 58 hit a real `EPERM`, retried once, and passed; before the fix that run
  would have failed.
- `node --test test/verify-command.test.ts`: 8 passed. `npm run typecheck`:
  exit 0.
- `npm test` (936 s): 1,183 passed / 1 failed / 5 skipped. The hung-command test
  **passed**. The one failure was a different test, described below.

## Separate open failure (not part of this fix)

`test/cli-operator.test.ts:1394`, "Task 7 external Windows PowerShell transport
signs original BOM CRLF input and submits a signature file", fails with
`approval signature does not verify against the configured public key`. It fails
every time here (3 of 3 isolated runs, and 1 with `PSModulePath` unset), but it
passed in the operator's own full-suite run earlier on 2026-09-24. The
non-PowerShell approval tests use the same payload and passed in the same suite
run, so the difference is on the Windows PowerShell 5.1 transport path.
`test/cli-operator.test.ts`, `scripts/sign-approval.mjs` and the approval
sources are unmodified in the working tree. **[Inference]** It depends on the
launching environment (this session's tool shell, not the operator's terminal).
It is not diagnosed; the next step is for the operator to run it once in their
own terminal.

**Resolved as environment-specific (2026-09-24):** the operator ran the same
isolated command in their own terminal and it passed (1 of 1, 19.2 s). The
failure reproduces only when the suite is launched from the assistant's tool
shell. Which environment difference causes it is still unknown (`PSModulePath`
is ruled out); it is not a code defect, and no change was made.

## Open Questions

- Which process holds `evidence.txt`? This would need Sysinternals `handle.exe`
  or Process Monitor (an install, which requires approval), and knowing it would
  not change the test-side fix.
