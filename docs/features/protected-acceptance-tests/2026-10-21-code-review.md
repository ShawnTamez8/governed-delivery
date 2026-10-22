# Protected acceptance tests - code review

**Reviewed document:** `docs/features/protected-acceptance-tests/plan.md`, including its operator decisions, corrected evaluation and Task 5-10 build records; the reconciled `docs/features/protected-acceptance-tests/2026-10-20-plan-review.md` supplies prior dispositions.

**Review date:** 2026-10-21

**Status:** reconciled

**Effort:** high

**Hazards considered:** 4 (real evidence rather than self-confirming fixtures), 6 (an unusable frozen suite strands a run), 15 (runtime immutability rather than a final clean snapshot), and 18 (a passing test without a behavioral assertion) bear directly on the findings. The review also checks 1-3 (output parsing, retention and prompt constraints), 5 (delivery boundaries), 8 (direct executable launch), 10-12 (frozen settings, seeded staffing and both verification paths), 14 (separate test-author identity), 19-24 (budgets, phases, gate instructions, ignored output, self-review and artifact scope), without additional findings. Entries 7, 9, 13, 16 and 17 do not add findings: this change adds no retry, hook interpreter, requirement-authoring authority or upstream reconciliation behavior.

**Scope reviewed:** `git --no-pager -c diff.autoRefreshIndex=false diff HEAD` on `sandboxed-delivery`, against HEAD `4be6b2abd7203f5412427f20ef4ca340efa14adc`, plus all 31 original untracked files named in the inventory below. The scope includes all 47 modified tracked files, not only the new acceptance module. Review-created evidence and this report do not enter that original inventory.

## Summary

Four findings are **CONFIRMED**: one high and three medium. The shared sandbox permits writes to the protected suite through a Windows case alias. The validity gate also accepts a matcher argument error, an uncalled assertion helper and an unsettled array of promises.

The implementation consistently freezes opt-in configuration, commits the suite before the implementation base, separates the test author from implementation, and routes the suite through initial and remediation verification. The consent preview, reserved command name, system-owned runner, report retention budget and spec-scope refusal have focused coverage. These strengths do not establish the four failing guards below.

The review withholds the documented scope limits: static root pages only, no suite-review panel, no cross-feature suite preservation, no semantic proof of condition-variant coverage, no automatic acceptance-failure remediation and no paid end-to-end claim. It also withholds the recorded dashboard-setting and remediation-dispute follow-ups. The Windows finding adds new evidence to the Task 7 build record's explicit, unreproduced inference: a transient write succeeds, and restoring the bytes leaves neither boundary with a dirty snapshot to reject. It does not reopen a deferred finding from the prior plan review.

## Findings

### Finding 1 - A Windows case alias bypasses the suite's read-only mount

- **Where:** `src/container.ts:417-422`, `createSandbox`. Every caller that supplies `readOnlyPaths` shares this mount layout, including phases, self-review, remediation, the validity gate and both verification paths.
- **Severity:** high. This affects opted-in runs whose worktree resides on a case-insensitive Windows filesystem, as on this review's Docker host. The protected test files remain writable to code inside the work container.
- **Why it matters:** Linux resolves the exact mount point `/work/acceptance/review` through the read-only overlay. The differently cased `/work/Acceptance/review` instead resolves through the writable `/work` bind mount into the same host directory. The plan explicitly requires immutability during verification because agent-written target commands can change a suite and restore it before a Git check. A final `protectedPaths` or commit-state check does not enforce that requirement.
- **Reproduced:** an unchanged `createSandbox` mounts `acceptance/review/` read-only over an owned committed target. Writing the canonical path exits 2 with `Read-only file system`. Writing `/work/Acceptance/review/test.spec.mjs` exits 0; reading the canonical path immediately returns `transient-change`. Restoring through the alias returns the suite to its original bytes, and `git status --porcelain` returns an empty string. Docker Engine 29.8.2 and the existing `bw-sandbox:5c7d0cadf267` image supply the real runtime evidence. No host implementation file changes.
- **Separate guard mutation:** removing only the additional protected mount's `:ro` in an isolated source mirror makes the existing engine write-refusal assertion fail because the write exits 0. Both unmodified engine tests pass. This proves the canonical-path test, not alias coverage; the alias counterexample succeeds without any mutation.
- **Required correction:** remove writable aliases to the protected bytes on supported hosts, or refuse the unsupported mount arrangement before dispatch. Add a case-alias and restore-before-check regression against the real engine.
- **Limit:** the reproduction proves runtime mutation and a clean final snapshot. It does not claim a complete forged-delivery run.

This finding concerns the newly protected acceptance bytes and the new during-verification immutability contract. It does not file the pre-existing `.git` overlay's case handling as a defect of this diff.

### Finding 2 - An uncalled nested helper satisfies the assertion-presence guard

- **Where:** `src/acceptance.ts:522-537`, `lintSuiteFile`'s `asserts` traversal. `everyNode` descends into nested function bodies before the helper-call logic establishes whether any call reaches them.
- **Severity:** medium. An opted-in run accepts a test that never executes its assertion and later reports a pass on incorrect output. Independent code review remains another defense; this finding does not claim that every downstream stage passes.
- **Why it matters:** the corrected plan requires a retrying assertion in each test body or a file-local helper that the test calls. Counting an assertion in an unused declaration is not that contract. This is a failure of the deterministic assertion-presence guard, separate from the explicitly unproven semantic strength of a real assertion.
- **Reproduced:** the recorded suite contains:

```javascript
test("AC-002 unused assertion helper", async ({ page }) => {
  await page.goto("index.html");
  const assertResult = async () => {
    await expect(page.locator("#out")).toHaveText("correct");
  };
  await page.getByRole("button", { name: "Go", exact: true }).click();
});
```

On the blank baseline, the missing button produces two locator timeouts. The unchanged validity gate accepts the entire three-test counterexample suite with no lint refusal. On a page containing a Go button and `<output id="out">wrong</output>`, this test passes both repeats: nothing calls `assertResult`, and nothing checks the output.

- **Separate guard mutation:** disabling the assertion-presence refusal in an isolated source mirror makes the existing no-assertion test fail. The original acceptance unit suite passes 21 of 21. That existing test does not cover assertions inside uncalled nested functions.
- **Required correction:** exclude uninvoked function bodies from the current execution scope, while following actual calls to supported file-local helpers. Cover both an unused nested helper and a genuinely called helper.

### Finding 3 - Matcher argument errors count as valid behavioral red

- **Where:** `src/acceptance.ts:167` and `src/acceptance.ts:192`, `classifyFailure`. Both the ordinary and custom-message matcher paths accept a matcher header without establishing that the matcher evaluates application behavior.
- **Severity:** medium. An opted-in run accepts an unsatisfiable frozen suite before paying for implementation, then blocks at verification without a supported suite-repair path.
- **Why it matters:** `toHaveText(undefined)` produces the same leading matcher header as a genuine mismatch, followed by an explicit invalid-argument diagnostic. The failure does not depend on the application. Treating it as red lets the validity gate send an impossible obligation into implementation, contrary to gate 3's broken-test rule and the corrected plan's use of Playwright to reject invalid assertion inputs.
- **Reproduced:** `await expect(page.locator("#out")).toHaveText(undefined)` fails twice on both the blank page and the page with an existing output. The real diagnostic starts:

```text
Error: expect(locator).toHaveText(expected) failed

Locator: locator('#out')
Error: expected value must be a string or regular expression
Expected has value: undefined
```

The unchanged classifier labels both failures `valid_red`. The baseline validity gate reports `ok: true`, no refusals and a red role for the criterion. Application changes cannot make that argument valid.

- **Separate guard mutation:** broadening classification to accept every error as `valid_red` in an isolated mirror makes two existing broken-test tests fail. The unmodified tests pass, but do not include this real matcher argument-error envelope.
- **Required correction:** distinguish matcher invocation errors from behavioral mismatch or locator-timeout evidence, for both normal and custom-message assertions, using recorded real runner outputs.

### Finding 4 - Awaiting an array incorrectly counts as settling its action promises

- **Where:** `src/acceptance.ts:333-352`, `src/acceptance.ts:400-406` and `src/acceptance.ts:507-514`, `isPromise`, `settles` and assigned-promise lint.
- **Severity:** medium. An opted-in run accepts a test with a floating browser action; once the relevant elements exist, the test races completion and fails for test-code reasons rather than the application's criterion.
- **Why it matters:** `map` returns an array, even with an async callback. `await operations` immediately yields that array; it does not settle its members. The implementation identifies the mapping as promising, then treats any awaited reference to its assigned name as sufficient. This violates the corrected plan's explicit unsettled-promise rule.
- **Reproduced:** the third recorded test navigates, creates `operations = ["Go"].map(async (name) => { await page.getByRole("button", { name, exact: true }).click(); })`, executes `await operations`, then checks only that `#out` is visible. The blank baseline produces two missing-button locator timeouts and passes the validity gate with no lint refusal. On the page with an output and Go button, both repeats instead fail with `Error: locator.click: Test ended.` The runner closes the page while the unjoined click remains pending.
- **Separate guard mutation:** disabling only the assigned-promise refusal in an isolated mirror makes the existing assigned-`textContent()` assertion fail. The original unit suite passes but does not distinguish a promise from an array of promises.
- **Required correction:** distinguish promise containers from settled promises and require a real join, such as an awaited `Promise.all`, before treating those action promises as settled. Retain coverage for valid returned promises and called helpers.

## Evidence and validation

`test/fixtures/recorded/acceptance-code-review-probes.json` preserves both browser scenarios' complete retained logs, actual suite source, page source, actual gate results and exit codes. It also preserves the alias log, restored bytes, final Git status and all four isolated guard-mutation logs. Its provenance identifies the source HEAD, scratch run IDs, capture date, image and omitted envelope. These probes make no provider dispatch; no model response or paid-run claim supplies their expected behavior.

The source in the browser probes remains identical between the blank and incorrect pages. The system command uses two repeats, the system runner config and the read-only suite overlay. All three tests classify as valid red at the baseline, and the validity gate accepts the suite. On the incorrect page, the unused-helper test passes twice, while the other two expose the invocation error and unfinished action described above. Each probe removes its work container, proxy and network, and asserts successful teardown.

The isolated mount mutation initially encounters a module-relative asset-path setup error. That failure does not count as a guard result. With explicit asset paths, the rerun reaches the named write-refusal assertion and fails because its write succeeds. No implementation correction follows from that probe setup repair.

| Check | Result |
|---|---|
| `npm run typecheck` | Pass, source and dashboard |
| `node --test test\acceptance.test.ts` | Pass, 21 tests |
| `node --test test\acceptance-engine.test.ts` | Pass, 2 tests against the real engine |
| Four isolated guard mutations | Each reaches and fails its corresponding existing assertion |
| All 14 original acceptance-report fixtures | Full JSON parse, retained-log parse, source and provenance inspection |
| All 5 evaluation records | Full JSON parse; 21 stored sample instances checked for sample counts, costs, title uniqueness and replayed `scoreSuite` results |
| Stored generated suite source | All 97 stored file instances, 53 unique sources and 410,005 source bytes parsed through EOF without syntax errors |
| Ten changed non-engine test files, serial execution | 497 pass, 5 fail out of 502; no cancellations or skips; baseline limitations below |
| `npm run check:docs` | Pass; historical path warnings remain non-blocking |

The ten-file regression command covers approval, CLI, code review, dashboard UI, implementation, operator output, profiles, prompts, spec documents and verification. It uses an owned `BW_DOCKER_STAND_IN_STATE` directory to avoid the documented shared-state race. The review does not rerun the full suite or the complete container engine suite, and does not treat the implementation session's historical full-suite result as a new check.

The completed regression has four failures that directly report dirty fixture files: three code-review checks name `.gitignore`, `README.md` and `base.txt`, and the ignored-output verification check names `.gitignore` and `base.txt`. A fifth test, the one-round code-review check, dereferences an absent stage; its isolated rerun passes. An isolated three-selector check passes two selectors and fails the remediation selector on the cleanliness refusal. The same three selectors in an archive of unchanged HEAD pass two and fail the upstream-location selector with the identical cleanliness refusal. The unchanged-HEAD result establishes that this cleanliness failure mode predates the diff. It does not establish the underlying filesystem or Git cause, or the trigger for the absent-stage failure. The broader regression is not green, and the review does not attribute those baseline-sensitive failures to this feature.

The recorded evidence's `regressionDiagnostics` retains the entire 502-test log and both complete three-selector logs. The review neither replaces the failing run with a passing rerun nor omits its failures from the handoff.

The recorded-data audit reads every JSON payload in full and replays the stored metrics; it does not claim an independent rerun of the paid author evaluation or a human line-by-line review of every duplicate generated test body. The operator's existing HTML explorer describes an earlier snapshot and explicitly runs nothing; its snapshot omissions are not findings against this feature.

## Original untracked-file inventory

The following 31 files belong to the original diff scope. The empty `=` file and the operator's existing HTML explorer remain untouched.

```text
.claude\sessions\2026-10-20-protected-acceptance-tests-build.md
=
container\acceptance.config.mjs
docs\features\protected-acceptance-tests\2026-10-20-plan-review.md
docs\features\protected-acceptance-tests\plan.md
docs\features\reproduced-review-findings\plan.md
docs\runbooks\workflow-explorer.html
scripts\test-author-evaluation.ts
src\acceptance.ts
src\agents\acceptance-test-author.ts
test\acceptance-engine.test.ts
test\acceptance.test.ts
test\fixtures\recorded\acceptance-report-flaky.json
test\fixtures\recorded\acceptance-report-hook-locator-after.json
test\fixtures\recorded\acceptance-report-hook-locator-before.json
test\fixtures\recorded\acceptance-report-hook-throw.json
test\fixtures\recorded\acceptance-report-launch.json
test\fixtures\recorded\acceptance-report-load-error.json
test\fixtures\recorded\acceptance-report-navigation.json
test\fixtures\recorded\acceptance-report-pass.json
test\fixtures\recorded\acceptance-report-test-code-expect-text.json
test\fixtures\recorded\acceptance-report-test-code.json
test\fixtures\recorded\acceptance-report-test-timeout.json
test\fixtures\recorded\acceptance-report-valid-red-custom-message.json
test\fixtures\recorded\acceptance-report-valid-red-locator.json
test\fixtures\recorded\acceptance-report-valid-red-matcher.json
test\fixtures\recorded\test-author-evaluation-web-calculator-r1.json
test\fixtures\recorded\test-author-evaluation-web-calculator-r2-rescore.json
test\fixtures\recorded\test-author-evaluation-web-calculator-r2.json
test\fixtures\recorded\test-author-evaluation-web-calculator-rescore.json
test\fixtures\recorded\test-author-evaluation-web-calculator.json
```

## Disposition boundary

All four findings remain open. This review changes no implementation, test behavior, approval, run state or learning-record decision. It creates only the review, its recorded evidence and a session task record. Accepted fixes belong to the implementation workflow, followed by focused counterexample checks and re-review; document reconciliation alone does not fix these defects.

---

## Reconciliation

**Date:** 2026-10-21
**Disposition:** 4 accepted, 0 rejected, 0 deferred, 0 open
**Status:** reconciled

Each finding was checked against the code it names and against the plan's governing text before its disposition was recorded. All four describe real defects. No code was changed: each fix belongs to the implementation workflow, followed by the counterexample checks and a re-review, and this reconciliation authorizes neither the fix nor any spend.

The plan's written gate 5 rules were older than the lint the Task 4 corrections rebuilt. Read literally, "the direct operand of `await`" and "every test body contains at least one `await expect(`" allow Findings 4 and 2. The governing intent does not: the operator's "no missing awaits before async calls", the rebuilt lint's stated rule that a promise must be settled, and gate 3's purpose of keeping a test from being vacuous. The plan now states those rules as intended.

A scan of the 53 unique generated suite sources in the five evaluation records found none of the three counterexample shapes: no `map` with an async callback, no `Promise.all`, and no function declared inside a test body. So the three medium findings concern shapes no recorded author wrote. Five sources do pass an async callback holding an assertion to a call, such as the file-local `keyboardCriterion`. A fix for Finding 2 that counted only named helper calls would refuse those. Each lint fix must leave the recorded suites at 0 refusals.

### Verdicts

- **Accepted — Finding 1, a Windows case alias bypasses the suite's read-only mount:** `createSandbox` mounts `<worktree>/<path>` read-only only at the exact path `/work/<path>` (`src/container.ts:419-422`), under a writable `/work` bind. The recorded `caseAlias` probe shows an alias write succeeding and a restore leaving Git clean. That breaks the plan's requirement that a write during verification be impossible, not merely detectable. Plan change: the read-only approach now states that the protection covers every path reaching the suite's bytes, including a differently cased one. The Task 7 build record's "Two later checks should still catch it" now carries a dated correction with the reproduced evidence. The severity of high holds for case-insensitive hosts, including this operator's Windows engine. The fix design is the implementer's to choose, and the reviewer named two routes. Refusing the arrangement before dispatch would refuse every opted-in run on this machine.
- **Accepted — Finding 2, an uncalled nested helper satisfies the assertion-presence guard:** `asserts` walks the test body with `everyNode` (`src/acceptance.ts:522-536`), so it counts an assertion inside an arrow function that the test declares and never calls. Plan change: the gate 5 rule is now "An assertion the test runs". It counts the test's body, plus a file-local helper or callback the test calls or passes to a call. An assertion in a function the test declares and neither calls nor passes on does not count. The dependent sentence under "Already satisfied" now says the same.
- **Accepted — Finding 3, matcher argument errors count as valid behavioral red:** `MATCHER` (`/^Error: expect\(/`) and `CUSTOM_MESSAGE_MATCHER` accept the header `toHaveText(undefined)` emits (`src/acceptance.ts:167,174,192`). The recorded diagnostic is `expected value must be a string or regular expression`, an error no page can satisfy. The plan already relies on gate 3 reading Playwright's run-time refusals as broken tests, through the Task 4 corrections' assertion-subject bullet. Plan change: gate 3's list of broken tests now names a matcher that refuses its own arguments, with or without a custom message.
- **Accepted — Finding 4, awaiting an array counts as settling its action promises:** `isPromise` treats a `map` with an async callback as a promise (`src/acceptance.ts:352`), and `settles` then accepts any `await` of the assigned name (`src/acceptance.ts:400-406`, `507-514`). Awaiting the array settles none of its members, and the recorded run ended with `locator.click: Test ended.` Plan change: the gate 5 rule is now "No unsettled promise". It requires every action and `expect(` to be awaited or returned to an awaiting caller, and it says that only awaiting each member of an array, as an awaited `Promise.all` does, settles that array's promises.

The review's regression table records 5 failures in 502 tests across ten files. The review attributes them to a pre-existing cleanliness refusal, which also reproduces at unchanged HEAD, and to one test that passes in isolation. That is not a finding of this review, and this reconciliation does not dispose of it. The broader regression is still not green.
