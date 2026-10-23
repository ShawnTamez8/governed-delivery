# Served browser pages implementation plan - review

**Reviewed document:** `plan.md`
**Document type:** Plan, with a server design
**Review date:** 2026-10-22
**Status:** reconciled

**Hazards considered:** 2 (discarded server diagnostics), 4 (durable inputs and independent expectations), 15 (server path containment), 18 (the exact false-confirmation claim), 21 (prompt and runner agreement), and 22 (output placement and clean-tree boundaries). The review also considers the reconciled runner findings in the reproduced-review-findings and protected-acceptance-tests feature folders.

---

## Summary

The plan targets the measured origin failure without changing stage authority, outcome policy, or frozen images. Its engine spike and stop rule suit the uncertainty, but its regression input still depends on one workstation, and several assertions and server guarantees lack corresponding verification.

## Verdict

**Ready for planning after required changes.** Preserve the HTTP approach and bounded engine spike. Resolve H1 before implementation, correct M1's guaranteed test failure, and make the server's verification and residual guarantees explicit.

## Critical issues - must fix before implementation

No critical issues found.

## High-risk areas

**Risk:** H1. The motivating regression still depends on a machine-local page tree

- **Why:** Task 1 requires extracting commit `37f048e3893eab96da3fa6b7880a849f8929668d` from an absolute path under the operator's profile. The three committed false-confirmation records retain test files, reports, and a diagnostic, but not the target page tree. The planned `target-tap-delivered-page.json` does not exist. The repository's session-continuity rule requires copying evidence into the repository as soon as tests, plans, or findings depend on it, rather than scheduling extraction for later.
- **Impact if ignored:** Another clone cannot execute Task 1 from repository contents. Removing the local target also removes the source for both runners' motivating regression, despite the retained reports.
- **Mitigation:** Capture the exact target tree before implementation and reference its committed fixture from Task 1. Include the named provenance and a manifest binding paths and bytes to the source commit. Keep the existing expected outcomes from the recorded HTTP diagnostic; do not reconstruct a substitute application.

## Medium and low concerns

- **M1. Task 3 leaves an exact prompt assertion incompatible with its new sentence.** The task changes the constraint phrase, but `test/prompts.test.ts:2855` independently requires the literal ``open the page with `await page.goto("index.html")`.``. The proposed rule places a semicolon after that call. An in-memory substitution using the actual plan sentence confirms that the current rule satisfies this assertion and the proposed rule does not. Update that assertion alongside `REPRODUCTION_RULE_SENTENCES`, while retaining coverage of the navigation instruction and new HTTP wording. The hash test that removes the whole rules block does not cover this assertion.

- **M2. The goal promises more than changing origins establishes.** The Goal says a reproduction "can no longer be confirmed against a page that never ran", while "Not in this plan" explicitly excludes script-load validation. `judgeReproductionRun` still confirms matcher failures without inspecting application startup. A missing imported module or a startup exception can leave the same existing elements unchanged and produce another confirmation. Narrow the goal and remedy paragraph to eliminating the measured file-origin failure, and state that application execution remains unverified. This correction does not require adding the excluded guard.

- **M3. The new server's contract lacks negative and protocol checks.** Task 2 checks the two application outcomes and missing-page classification, but no task proves decoded-path containment, realpath containment, `HEAD`, directory indexes, `.mjs` MIME handling, or `Cache-Control: no-store`. Existing container tests exercise container boundaries, not this server. Add focused checks derived from the stated server contract, including an encoded traversal, a sibling-prefix escape, and a symlink outside `/work`; prove the containment check fails when removed. Keep assertions about these paths inside a disposable test environment. Define the MIME table and directory URL behavior sufficiently to make the corresponding checks independent of implementation choices.

- **M4. Clean report output currently comes at the cost of server failure evidence.** The Approach requires the server to print nothing and sets both web-server streams to `"ignore"`. That preserves `readAcceptanceReport`'s single-JSON contract, but discards startup exceptions and makes expected missing files and unexpected read failures indistinguishable beyond a network error. `runVerifyCommand` cannot retain streams that Playwright discards. Define a retained diagnostic channel for unexpected server failures that does not contaminate the JSON report, and cover an induced startup failure. Preserve the deliberate socket-close behavior for requests the server refuses.

## Missing and underspecified areas

- **Server response details:** M3 needs an explicit supported extension table, unknown-extension fallback, and behavior for a directory URL without a trailing slash. Serving its index without redirecting changes the base for relative asset URLs.
- **Persistent coverage of spike-only cases:** Task 1 records the no-index case and checks log parseability, but Task 2 does not explicitly preserve that case as an executable regression. State which tests retain readiness independent of `/`, and verify repeated runner invocations release the fixed port in the same container.

## Suggested improvements

- Extend Task 1's stop rule to explicitly include the existing-page pass case and the no-index case, not only the two reproductions, navigation classification, and JSON parsing. A parseable report can still contain a web-server startup error.
- Keep the current freeze boundary and no-spend scope: the review establishes no engine result for the proposed server and authorizes neither implementation nor a paid run.

---

## Reconciliation

**Date:** 2026-10-22
**Disposition:** 9 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

The operator settled two judgment calls on 2026-10-22. For M4, the plan accepts the residual and keeps the reader contract unchanged: the server stays silent, and a recorded induced startup failure shows what Playwright's report retains. For the directory URL, the server answers a directory without a trailing slash with a `301` to the slashed path.

H1's evidence was copied into the repository during this reconciliation, as the repository's session-continuity rule requires. `test/fixtures/recorded/target-tap-delivered-page.json` was captured from commit `37f048e3893eab96da3fa6b7880a849f8929668d` (tree `4858dd42cbc225f797a4d6d981eb17f5d253cc3f`). Its manifest lists all 28 paths in the tree with blob IDs, and it stores the bytes of 12 files, each rehashed to its blob ID at capture. The fixture is not yet committed.

### Verdicts

- **Accepted — H1. The motivating regression still depends on a machine-local page tree:** the fixture is captured. Task 1 now uses it instead of creating it, the hazard 4 line and Affected areas name it, and every spike tree rehashes its files against the manifest before use.
- **Accepted — M1. Task 3 leaves an exact prompt assertion incompatible with its new sentence:** `test/prompts.test.ts:2855` holds ``open the page with `await page.goto("index.html")`.``, and the new rule's semicolon breaks it. Task 3 now updates that assertion to the new literal and adds an "over loopback HTTP" assertion. The Blast radius explains why the hash test does not cover it, and Affected areas names the assertion.
- **Accepted — M2. The goal promises more than changing origins establishes:** `judgeReproductionRun` (`src/acceptance.ts:930`) confirms on matcher failures alone. The Goal and the hazard 18 line now claim only that the measured file-origin cause is removed, and they state that application startup remains unchecked. Task 4's remedy paragraph names the same residual.
- **Accepted — M3. The new server's contract lacks negative and protocol checks; Missing — server response details:** the Approach now specifies `HEAD` semantics, containment on the decoded path with an exact `/work` or `/work/` rule, the real-path check, the exported `resolveUnder` function, the `301` redirect for directories without a trailing slash, the full extension table with an `application/octet-stream` fallback, and `no-store` on every response. Task 2 adds an engine contract test with expected values from that contract, run as a probe in a disposable target whose symlink case stays under `/tmp` and removes its link, and a host test, `test/serve.test.ts`, covering encoded traversal and sibling-prefix escapes. It also adds four break-tests, one each for decoded containment, the prefix rule, the real-path check and the `.mjs` type.
- **Accepted — M4. Clean report output currently comes at the cost of server failure evidence:** by operator decision, the plan accepts the residual. The Approach and the hazard 2 line state that the server's exception text is not retained and that a missing file and an unexpected read failure end the same way. A new `[Unknown]` assumption and Task 1 case 5, a failed start on an occupied port, record what the report retains, and Task 4's remedy paragraph names the gap. Refused requests still close the socket.
- **Accepted — Missing — persistent coverage of spike-only cases:** Task 2 adds the no-`index.html` case as an engine regression and a test in which two runner invocations share one container, which proves the fixed port is released.
- **Accepted — Suggested — extend Task 1's stop rule:** the stop rule now also covers the pass case, the no-index case, the failed start and, through case 6, the absence of any top-level report error.
- **Accepted — Suggested — keep the freeze boundary and no-spend scope:** no change was needed. The plan already excludes changing frozen runs and any paid run, and this reconciliation authorizes neither implementation nor spend.
