# Verification stage — code review (verify-command cleanup race fix)

**Reviewed document:** `docs/features/verification-stage/plan.md`

**Review date:** 2026-09-16

**Status:** reconciled

**Effort:** high

**Hazards considered:** 2 bears directly and was satisfied: evidence retention
stream closure is made deterministic by awaiting `'close'` rather than `'finish'`,
guaranteeing that retained output is fully flushed and its underlying file
descriptor is closed before `runVerifyCommand` resolves, preventing callers from
racing with file and directory teardown. 8 bears on Windows process-tree
termination and was satisfied: `killTree` using `taskkill /t /f` remains unchanged,
and `withRoot` test helper adds standard Node.js `rmSync` retry options
(`maxRetries: 3, retryDelay: 50`) to absorb transient Windows filesystem handle
and process teardown latency under concurrent test suite execution. 4 was weighed
and satisfied: the stream `'close'` vs `'finish'` descriptor state (`closed: false`,
`fd !== null`) was empirically proved against Node.js runtime behavior before
applying the fix. Entries 1, 3, 5, 6, 7, 9, 10, 11, 12, 13, and 14 do not apply:
this change touches only command outcome stream finalization and test cleanup;
it involves no agent prompts, model output, schema, migrations, CLI surfaces,
or reviewer staffing.

**Scope reviewed:** `git --no-pager diff HEAD` (modified: `src/verify-command.ts`,
`test/verify-command.test.ts`, `.claude/sessions/project-learnings.md`) plus
untracked files read in full: `.claude/sessions/2026-09-16-debug-verify-command-cleanup-eperm.md`.
Verification: `npm run typecheck` clean, `node --test test/verify-command.test.ts`
8 passed / 0 failed, `npm test` 1,178 passed / 5 skipped / 0 failed,
`npm run check:docs` clean.

## Summary

The review evaluated the surgical fix for the intermittent Windows `EPERM`
cleanup failure in `test/verify-command.test.ts` ("a hung command is killed with
its whole tree at the ceiling").

The change is clean, surgical, and adheres strictly to repository constraints:
1. In `src/verify-command.ts`, `settle()` previously called `evidence.end(callback)`.
   Because `stream.end(callback)` listens on `'finish'`, the promise resolved while
   `evidence.fd` was still open (`closed: false`), directly violating the inline
   contract: `"Resolve only once the retained bytes are actually on disk ... and a
   caller that reads it immediately must not race the flush."` The change awaits
   the `'close'` event (or checks `evidence.closed`), ensuring `evidence.fd` is null
   and the underlying OS handle is closed before resolving.
2. In `test/verify-command.test.ts`, `withRoot` passed no retry options to `rmSync`.
   On Windows, asynchronous kernel handle teardown following `taskkill /t /f` can
   briefly hold the directory lock. Adding `{ maxRetries: 3, retryDelay: 50 }`
   provides bounded linear backoff against transient OS teardown latency without
   masking functional failures.
3. Hard rules 1-6 are preserved: no abstraction, no schema modification, no new
   harness or surface, and no invented fixtures.

Withheld as non-findings:
- The pre-existing deprecation warning `[DEP0190]` from Node.js when spawning with
  `shell: true` on Windows is a known, deliberate trade-off (documented in hazard 8
  and `src/verify-command.ts`).

## Findings

No findings.
