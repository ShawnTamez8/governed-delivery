# Reproduced Review Findings Implementation Plan

**Status:** Implemented

**Goal:** A code reviewer may attach an executable reproduction to each finding. The system runs it in the sandbox against the reviewed commit and records whether it confirmed the finding. Every confirmed reproduction of a kept finding then runs as a preserved check at every later verification point in the run, and every later panel sees each check that fails. No reproduction outcome, including its absence, ever lowers a finding's severity, removes it from remediation, or keeps it from the final severity gate. No preserved check blocks a run by its verdict alone.

**Source:**
- `docs/proposals/sandboxed-delivery-rework.md`, change 7 and its 2026-10-20 revision. A confirmed repro must become a regression check for every later commit, and "no repro, so advisory" must never by itself deliver a real high.
- The operator, 2026-10-20: "extend #7: confirm findings through executable reproductions and preserve confirmed checks through remediation. Inability to reproduce must not automatically downgrade a potentially blocking defect."
- The operator, 2026-10-22, settling the working choices, approving the operating contract change, and declining to preserve rejected findings (see "Settled decisions").
- **The motivating run** is `test/fixtures/recorded/code-review-web-calculator-remediation-regression.json`:
  - round 1 kept finding 9, and the remediation fixed it by exempting every focused button;
  - that broke the plan's Enter rule;
  - only a second panel's reviewer noticed (finding 10).

  A check preserved from finding 9 would not have caught that. Plan 1's acceptance suite catches it, and a preserved check from finding 10 would then have shown every later panel whether that fix still held.
- **This plan builds on `docs/features/protected-acceptance-tests/plan.md`,** which is built (`9319f0a`, `6a63ee7`). It reuses that plan's browser image, its runner and report reader (`src/acceptance.ts`), its failure classifier, its lint, and its throwaway-checkout pattern for the gate baseline.

**Hazards considered:**
- **1 (output shapes).** A reproduction is a file's content inside a reply, which is the escaping failure class. The reviewer reply therefore moves to `--json-schema` structured output, as the patch dispatches did (`docs/features/structured-patch-output/plan.md`). The schema bounds the reproduction's size and count, and the boundary validator checks every bound again.
- **3 (a constrained field's rule stated in the prompt).** The reproduction's file name has one rule, `^[a-z0-9][a-z0-9-]{0,63}\.spec\.mjs$`, held in one constant. The schema, the validator and the reviewer prompt all read it, and `CONSTRAINT_STRINGS` pins the prompt sentence.
- **14 (independence that cannot be proven).** Reviewer reproductions run in the system's sandbox against a commit the system names. The system decides the outcome from the runner's classified report, never from the exit status. Who wrote the reproduction does not change what its run proves.
- **15 (a declared sandbox is not read-only).** A reproduction is model-written code. Confirmation runs it in a throwaway detached checkout of the reviewed commit, never in the run's worktree. A preserved check that leaves the run's worktree dirty during remediation verification blocks, as any verify command that does so blocks today.
- **22 (a guard that counts ignored files).** The runner writes its output to the container's temporary directory, as plan 1's config does. The throwaway checkout is removed after confirmation, so nothing it holds reaches the code-review clean-tree guard.
- **23 (a fix blind to the decisions behind the code).** The remediation implementer receives each confirmed reproduction and its command, and runs it before replying. Every later panel's prompt names each preserved check that fails at the commit it reviews.
- **16 (remediation aimed at the wrong artifact).** Only findings the code-review reconciler keeps are preserved. A rejected finding's reproduction encodes behaviour the specification does not require, so it never becomes a check.
- **4 (fixtures and code agreeing).** The free benchmark's reproductions are recorded model output: the round-1 test-author suite (`test/fixtures/recorded/test-author-evaluation-web-calculator-r1.json`, Sonnet 5.5 `medium`, the seeded setting), which met plan 1's re-registered thresholds. Each is narrowed to its one failing case by a named edit. Their expected outcomes come from that record's per-tree results and from the recorded findings 9 and 10. The checks runner's report shape comes from a report recorded on the real engine (Task 1), not from a hand-written report.
- **7 (retries that vary nothing).** No retry and no extra round is added. A preserved check that fails is evidence for the next panel, not a second attempt.
- **18 (correctness never inspected).** A confirmed reproduction is the first executed evidence attached to a review finding.
- **21 (agents never told their gate).** The remediation prompt names every preserved check as part of its verification, and the reviewer prompt names every failing one.
- **Not engaged:** 2, 5, 6, 8 to 13, 17, 19, 20 and 24. No prompt for another stage, no spec, plan, delivery or executor rule changes.

**Assumptions:**
- **[Verified]** Reviewers today return free-text JSON. `extractJsonBody` and then `validateAgentResult` read it, and the shared `validateReviewerReports` (`src/reconciliation.ts`) checks the findings. That validator is also used by `src/narration-check.ts` and the design split, so it must not grow a code-review-only field (project memory "a shared validator checks only its own stage"). The reproductions travel in their own member and get their own validator.
- **[Verified]** `--json-schema` is supported for any dispatch through `invocation.jsonSchema` (`src/harness.ts`), and `dispatch.ts` then reads `structured_output`. The patch dispatches use `WORKSPACE_REPLY_SCHEMA` (`src/agent-result.ts`).
- **[Unknown]** Whether the harness enforces `pattern`, `maxLength` and `maxItems`. `WORKSPACE_REPLY_SCHEMA` uses only `enum`, so nothing has exercised them. The boundary validator therefore checks each bound itself.
- **[Verified]** `parsePassedCodeReviewRecord` (`src/code-review.ts`), which the snapshot and the dashboard use, copies named fields from each round and ignores other keys. New round members therefore leave stored records parseable. Task 6 pins that with a test.
- **[Verified]** `createSandbox` (`src/container.ts`) mounts the worktree, its read-only `.git`, and optional `readOnlyPaths`. Those are copied from the worktree's `HEAD` under `acceptanceMountDir` and mounted over `/work` (plan 1, Task 12). A reproduction is not committed, so it cannot use `readOnlyPaths`. The checks directory is a second optional mount of a host directory. `test/container.test.ts` criterion 2 asserts the default mount set, so it gains a case with the checks mount.
- **[Verified]** The runner config `container/acceptance.config.mjs` sets `testDir: "/work/acceptance"`. `readAcceptanceReport` prefixes each test file with `acceptance/` and strips `/work/` from error locations. **[Inference]** Playwright treats a positional argument as a filter over the files under `testDir`, so that config cannot run a file under `/bw-checks`. Task 1's engine spike settles this.
- **[Verified]** `classifyFailure` counts a matcher failure and a locator action's timeout both as `valid_red`. A locator timeout's message carries Playwright's call log, whose last entry names what the locator was waiting for (`test/fixtures/recorded/acceptance-report-valid-red-locator.json`: `waiting for getByRole('button', { name: '7' })`).
- **[Verified]** `verifyCommit` (`src/commit-verification.ts`) stops at the first command that blocks, and runs `removeIgnoredOutput` only after a pass. It returns no record when the sandbox fails, so the outcomes of commands that already ran are lost.
- **[Verified]** Plan 1's gate runs its baseline in a throwaway `git worktree add --detach` checkout under the run's evidence directory, removed in a `finally` (`src/implementation-stage.ts`).
- **[Verified]** The image tag is a hash over every file under `container/` (`sandboxImageTag`), and `new-run` freezes the image ID. A new file in `container/` therefore builds a new image for new runs, and leaves a run frozen earlier on its own image.
- **[Verified]** Adding a policy field would make every stored run uninspectable, because inspection tolerates an obsolete policy field but refuses a missing one (`docs/features/inspectable-frozen-profiles/plan.md`). So this plan adds no policy field. Its bounds, the reproduction size and count, live in the reply schema and the validator.
- **[Inference]** A reproduction can fail for a reason other than the defect, such as a wrong selector. The plan limits false confirmation in two ways. Only a matcher failure on every test, on both repeats, confirms a finding. A preserved check never blocks by its verdict.

**Approach:**
- **The reply.** Code reviewers answer through `--json-schema` with a new `CODE_REVIEW_REPLY_SCHEMA`. It is the AgentResult shape they return today, plus an optional `proposedContentChanges.reproductions` array of at most 5 entries.
  - Each entry names one of the reply's findings by its `intentKey` and `location`, and carries `fileName` and `content`: a Playwright test in plan 1's import form.
  - `fileName` matches `REPRODUCTION_FILE_NAME`, `^[a-z0-9][a-z0-9-]{0,63}\.spec\.mjs$`. `content` is at most 65,536 characters.
  - A finding may have at most one reproduction from each reviewer. A reviewer may attach none.
  - The schema states every bound, and `validateCodeReviewReproductions` checks each one again.
- **The checks runner.** The command is not the reviewer's to choose.
  - The image gains `container/checks.config.mjs` at `/opt/bw-browser/checks.config.mjs`. It is plan 1's config with `testDir: "/bw-checks"`.
  - The system runs one command per reproduction file: `node /opt/bw-browser/node_modules/@playwright/test/cli.js test --config /opt/bw-browser/checks.config.mjs --repeat-each 2 /bw-checks/<findingId>/<reviewer>/<fileName>`.
  - A reproduction therefore reaches no package script and no file an agent can change.
  - Plan 1's lint (gate 5) runs on the content first. A refused reproduction is never run.
- **Confirmation.**
  - After every panel's findings are recorded, including the final panel's, the system writes each validated reproduction to `.governance/code-review/<run>/checks/<findingId>/<reviewer>/<fileName>`. This happens before the round decision is applied, and before the code-review reconciler when one runs.
  - It creates a throwaway detached checkout of the reviewed commit at `.governance/code-review/<run>/round-<n>/repro-checkout`, as plan 1's gate baseline does. It runs every reproduction in one `verifyCommit` call against that checkout, with the checks directory mounted read-only at `/bw-checks`, and removes the checkout afterwards. The run's worktree is never mounted.
  - Each reproduction's report is retained under the verification retention budget, as the acceptance report is.
  - Outcomes come from plan 1's report reader and classifier, read with the checks root, never from the exit code:
    - `confirmed`: the report loads with at least one test and no load error, and every test failed on both repeats with a matcher failure;
    - `not_reproduced`: every test passed on both repeats;
    - `repro_failed`: anything else. That covers a lint refusal, a load error, no tests, a flaky test, a broken test, a locator timeout, a command ceiling, an output overflow, an unreadable report and a dirtied checkout. It also covers a sandbox failure, which makes every reproduction in the call `repro_failed`, including any that already ran.
  - A locator timeout records the last entry of Playwright's call log as the outcome's `detail`, so the record states what the locator was waiting for: no matching element, or one that stayed hidden or disabled.
  - A flaky reproduction therefore never confirms a finding, and neither does a locator that never resolves.
  - Two reproductions for one canonical finding, from two reviewers, are written to separate directories and run as separate commands. The finding is confirmed if either confirms it.
  - A failed confirmation never aborts the stage. It is evidence about the reproduction, not about the code.
- **No downgrade.**
  - The reconciler prompt, the remediation decision and the final severity gate take exactly the inputs they take today, whatever the outcome. A `not_reproduced` or `repro_failed` high on the final panel still blocks.
  - The outcome is recorded in the round record and the audit log and shown in the report. The reconciler is not told it, so this plan cannot change a rejection.
- **Preservation.**
  - Every confirmed reproduction of a finding the reconciler keeps becomes a preserved check.
  - From the next remediation on, the remediation's `verifyCommit` runs the frozen verify commands, plan 1's acceptance command when the run froze one, and then the preserved checks.
  - Each preserved check is non-blocking. The same classifier judges it: `holds` when every test passed on both repeats, and `fails` otherwise, with the same `detail` rule.
  - A failing preserved check never blocks. The result is recorded in the round's remediation record and the audit log. The next panel's reviewer prompt names every check that failed at the commit it reviews, with its finding, location, path and first error line. A reviewer may raise the defect again as a finding at its severity, and the final panel's gate then decides as it does today.
  - A preserved check that leaves the run's worktree dirty still blocks, under the existing rule for any verify command. That is an integrity failure, not a verdict on the code.
  - Preserved checks are never removed during the run. A reproduction confirmed in round *n* is checked against every commit after round *n*'s remediation.
- **Telling the implementer.** The remediation prompt lists each confirmed finding's check path and its exact command. The remediation's work container mounts the same directory read-only at `/bw-checks`, so the implementer can run the checks with `run_command` but cannot change them. The reviewer prompt states the reproduction contract. A reproduction is a Playwright test that fails at the reviewed commit because of the defect and passes once it is fixed. It asserts with Playwright's auto-retrying matchers, and uses trusted input (`page.keyboard`, `page.click`), never `dispatchEvent`.
- **Shown, not gated, elsewhere.** `report.md` lists each reproduction's outcome beside its finding, and each preserved check's result at each remediation. The dashboard reads the round record through `parsePassedCodeReviewRecord`, which ignores the new members, so the dashboard does not show them in this plan.

**Affected areas:**
- **Create:**
  - `container/checks.config.mjs`;
  - `test/reproduced-findings.test.ts` and `test/reproduced-findings-benchmark.test.ts`;
  - the recorded checks-runner reports under `test/fixtures/recorded/` (Task 1).
- **Modify, code:**
  - `container/Dockerfile` (copies the checks config);
  - `src/acceptance.ts` (the checks config and command, the report reader's root and container prefix as parameters with today's values as defaults, a matcher-failure predicate, and `lintSuiteFile` exported);
  - `src/agent-result.ts` (`CODE_REVIEW_REPLY_SCHEMA`);
  - `src/code-review.ts` (`REPRODUCTION_FILE_NAME`, the reproduction validator and round-record types);
  - `src/code-review-stage.ts` (reviewer dispatch, the throwaway checkout, confirmation, preservation, remediation inputs and verification commands, and `buildReport`);
  - `src/container.ts` (an optional read-only checks mount in `createSandbox` and `withSandbox`);
  - `src/commit-verification.ts` (the checks mount passed through, and per-command blocking);
  - `src/dispatch.ts` (`dispatchInSandbox` passes the mount);
  - `src/prompts.ts` (`buildCodeReviewPrompt` and `buildCodeReviewRemediationPrompt`).
- **Modify, tests:**
  - `test/acceptance.test.ts`, `test/code-review-stage.test.ts`, `test/prompts.test.ts` and `test/container.test.ts`;
  - `test/fixtures/docker/stand-in.ts`;
  - the code-review emitter fixtures under `test/fixtures/harness/` that answer reviewer prompts.
- **Modify, documents:**
  - `ARCHITECTURE.md` sections 12 and 23;
  - `CLAUDE.md` and `AGENTS.md` (the code-review operating contract);
  - `docs/hazards.md` entries 18 and 23;
  - `docs/proposals/sandboxed-delivery-rework.md` (change 7's status line).

**Known blockers:**
- **Operator decisions:** none open. The contract change and its section 23 entry, needed because the 2026-09-04 authorization "covers the stage, not this evidence rule" (proposal, change 7), were approved on 2026-10-22 (see "Settled decisions").
- **Reviewer recall and precision are unmeasured** (proposal, change 7 risk). Reviewers cannot run their reproductions, because they are read-only, so they write them blind. The paid benchmark (Task 10) is the first measurement. Change 9's replay of run 6's findings does not exist yet.
- **Engine-only tests** skip by name without Docker, and the PowerShell transport test is environment-specific. Both are as in plan 1.

**Blast radius** (searched 2026-10-20, revised 2026-10-22):
- **The reviewer dispatch,** in `runCodeReviewStage` (`src/code-review-stage.ts`): `extractJsonBody`, `validateAgentResult`, `validateReviewerReports` and `validateCodeReviewReports`. The shared validators are unchanged.
- **The emitter fixtures:** `test/fixtures/harness/emit-code-review.mjs` and `test/fixtures/harness/emit-cli-run.mjs` answer reviewer prompts with free text. Under `--json-schema` they must answer through `structured_output`, which `emit-code-review.mjs` already does for remediation replies. The tests that drive reviewers through them are `test/code-review-stage.test.ts`, `test/cli.test.ts`, `test/delivery-stage.test.ts`, `test/guided-command.test.ts`, `test/operator-state.test.ts`, `test/profile.test.ts`, `test/harness-stream-fixtures.test.ts` and `test/dashboard-ui.test.ts`, by `grep -rln "code-reviewer\|CODE_REVIEW_PROMPT_PREFIX"`.
- **`createSandbox` and `withSandbox`:** callers are `src/commit-verification.ts`, `src/derived-artifacts.ts`, `src/dispatch.ts` and `src/project-bootstrap.ts`. The mount is optional and absent by default, so the derived and bootstrap callers do not change.
- **`verifyCommit`:** three callers, `src/implementation-stage.ts`, `src/verification-stage.ts` and `src/code-review-stage.ts`. Only the code-review stage's confirmation and remediation calls pass checks and the mount. The per-command `blocking` flag defaults to `true`, so the other callers behave exactly as today.
- **`readAcceptanceReport` and `classifyFailure`:** their current callers keep today's root and prefix through the defaults. The gate and the verification verdict are unchanged.
- **The image:** adding `container/checks.config.mjs` changes the image tag, so the next run builds a new image. A run frozen before the change keeps its image, and its reproductions end `repro_failed` with the runner's own error.
- **`buildCodeReviewPrompt` and `buildCodeReviewRemediationPrompt`:** one caller each, in `src/code-review-stage.ts`. `test/prompts.test.ts` pins sentences through `CONSTRAINT_STRINGS`.
- **`result.json` (`CodeReviewRecord`):** read by `parsePassedCodeReviewRecord` for the snapshot and the dashboard, and by the paid driver's report. The new members are additive.
- **Store:** no new table or column. The outcomes live in the round record, the audit log and evidence files, so `scripts/doc-check.mjs` `PINNED_TABLES` and `test/schema.test.ts` are untouched.

**Verification:**
- **Component:** each task's tests, with every new guard broken and restored (the byte-compare rule).
- **No downgrade:** Task 7's stage tests, through the Docker stand-in and emitter fixtures.
- **Benchmark, free:** Task 9 on the real engine, over the recorded trees.
- **Regression:** `npm run typecheck`, `npm run check:docs`, the full serial no-engine suite, and the engine suites.
- **End to end, paid and separately authorized:** Task 10.

**Settled decisions (operator, 2026-10-22):**
- **A failing preserved check is evidence, not a block.** It is recorded and named in the next panel's prompt. Only the final panel's severity gate blocks on a finding.
- **Only a matcher failure confirms.** A locator timeout ends `repro_failed`, with the call log's last entry recorded as the reason.
- **The free benchmark narrows each recorded loop to its one failing case,** by an edit named in the test's provenance.
- **At most 5 reproductions per reviewer reply,** bounded in the schema.
- **The operating contract changes.** The operator approved the code-review operating contract change in `CLAUDE.md`, `AGENTS.md` and section 12, recorded as a section 23 entry (Task 10).
- **Rejected findings are not preserved.** A confirmed reproduction of a finding the reconciler rejected never becomes a check. Preserving it would make the reconciler's specification-grounded rejection unenforceable.

---

## Tasks

### Task 1: The checks runner, proven on the engine

**Depends on:** nothing; the decisions above are settled.

**Files:**
- Create: `container/checks.config.mjs`, which is plan 1's config with `testDir: "/bw-checks"`. Modify `container/Dockerfile` to copy it to `/opt/bw-browser/checks.config.mjs`.
- Modify: `src/acceptance.ts`.
  - Add `CHECKS_CONFIG` and `reproductionCommand(name, path)`, which builds the command in "Approach".
  - Give `readAcceptanceReport` a root and a container prefix as parameters. The defaults are `acceptance/` and `/work/`, so the checks reader passes `/bw-checks/` for both.
  - Add `isMatcherFailure(result, files)`: a `valid_red` result whose first error is a matcher failure, not a locator timeout.
  - Add `locatorWaitDetail(message)`: the last entry of the call log in a locator timeout's message.
  - Export `lintSuiteFile`.
- Modify: `test/acceptance.test.ts`.

**Steps:**
- **The spike,** on the real engine with the rebuilt image. Run one hand-written file from a read-only `/bw-checks` mount four ways:
  - with plan 1's config, recording whether any test is discovered;
  - with the checks config and an assertion that fails;
  - with an assertion that passes;
  - with a locator on an element that exists but stays hidden.

  Commit each report as `test/fixtures/recorded/reproduction-report-<case>.json`, with a `provenance` block naming the image, the date and what was dropped. Record the call log's last entry for the hidden element.
- **Tests,** over the recorded reports:
  - the checks reader names each test by its `/bw-checks/` path and locates its errors in the file;
  - `isMatcherFailure` is true for the failing assertion and false for both locator timeouts (`acceptance-report-valid-red-locator.json` and the hidden-element report);
  - `locatorWaitDetail` returns each report's last call-log entry;
  - every existing `test/acceptance.test.ts` test passes, which pins the defaults.
- **Break-test:** make `isMatcherFailure` return `valid_red` unchanged. The hidden-element test fails. Restore and compare bytes.
- Verify: `node --test test/acceptance.test.ts` and `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the recorded reports, including whether plan 1's config discovered the file, the tests and the break-test failure.

### Task 2: The reviewer reply moves to structured output

**Depends on:** Task 1.

**Files:**
- Modify: `src/code-review.ts`. Add `REPRODUCTION_FILE_NAME`, `^[a-z0-9][a-z0-9-]{0,63}\.spec\.mjs$`.
- Modify: `src/agent-result.ts`. Add `CODE_REVIEW_REPLY_SCHEMA`, built from `REPRODUCTION_FILE_NAME`. It is the reviewer AgentResult shape, with `proposedContentChanges.findings` items `{severity, classification, location, intentKey, subject}`, plus an optional `reproductions` array with `maxItems: 5`. Each reproduction item is `{intentKey, location, fileName, content}`, with `fileName` matching the pattern and `content` at most 65,536 characters.
- Modify: `src/code-review-stage.ts`. The reviewer dispatch passes `jsonSchema: CODE_REVIEW_REPLY_SCHEMA` and reads the structured output in place of `extractJsonBody`. Everything after `validateAgentResult` is unchanged.
- Modify: `src/prompts.ts`. `buildCodeReviewPrompt`'s reply-format sentences describe the structured reply in place of a JSON body, and `test/prompts.test.ts` pins them through `CONSTRAINT_STRINGS`.
- Modify: the reviewer emitter fixtures and `test/code-review-stage.test.ts`.

**Steps:**
- Search the fixtures and tests that answer reviewer prompts (the blast-radius grep), and convert each to answer through `structured_output`, as the patch-dispatch fixtures already do.
- **Tests:**
  - a structured reviewer reply with findings and no reproductions is accepted exactly as a free-text reply was;
  - a reply missing `structured_output` fails the reviewer as `invalid`, with the harness reason;
  - the schema's file-name pattern is `REPRODUCTION_FILE_NAME`'s source;
  - every existing code-review stage test passes.
- **Break-test:** drop `jsonSchema` from the reviewer invocation. The structured-reply test fails. Restore it and compare bytes.
- Verify: `node --test test/code-review-stage.test.ts test/agent-result.test.ts test/prompts.test.ts` and `npm run typecheck`. Expected: pass and clean.

**Task completion evidence:** the tests and the break-test failure.

### Task 3: Validate reproductions in their own member

**Depends on:** Task 2.

**Files:**
- Modify: `src/code-review.ts`. Add `validateCodeReviewReproductions(raw, reports)`, returning the reproductions or a reason. `validateReviewerReports` does not change. The validator checks:
  - each entry's `(intentKey, normalized location)` names a finding in the same reply, at most once;
  - file names are unique within the reply and match `REPRODUCTION_FILE_NAME`;
  - `content` is a string of at most 65,536 characters;
  - the reply holds at most 5 entries.
- Create: `test/reproduced-findings.test.ts`.

**Steps:**
- **Tests:**
  - a valid reproduction;
  - a reproduction naming no finding is refused;
  - two reproductions for one finding are refused;
  - a `.test.mjs` file name is refused;
  - content of 65,537 characters is refused;
  - six entries are refused;
  - a reply without `reproductions` gives an empty list;
  - `validateReviewerReports` still refuses an unknown finding field, which pins that the shared validator is untouched.
- **Break-tests:**
  - remove the "names a finding" check: its test fails;
  - remove the content-length check: its test fails.
- Verify: `node --test test/reproduced-findings.test.ts test/reconciliation.test.ts`. Expected: pass.

**Task completion evidence:** the tests and both break-test failures.

### Task 4: An optional read-only checks mount

**Depends on:** Task 2.

**Files:**
- Modify: `src/container.ts`. `createSandbox` and `withSandbox` take an optional `checksDir`. When given, the work container adds `-v <checksDir>:/bw-checks:ro` after the `readOnlyPaths` overlays. Absent, the argv is byte-identical to today. Teardown leaves the host directory in place, because it is the run's evidence.
- Modify: `src/commit-verification.ts` (`CommitVerificationInput.checksDir`, passed to `withSandbox`) and `src/dispatch.ts` (`dispatchInSandbox`'s sandbox argument gains the same optional field).
- Modify: `test/container.test.ts` and `test/fixtures/docker/stand-in.ts`.

**Steps:**
- **Tests:**
  - with no `checksDir`, the recorded `docker run` argv equals today's, through the stand-in, with and without `readOnlyPaths`;
  - with one, it carries the read-only mount;
  - on the real engine, criterion 2 gains a case: a write to `/bw-checks` fails with a read-only error, and the worktree and `.git` mounts are unchanged.
- **Break-test:** mount without `:ro`. The real-engine write test fails.
- Verify: `node --test test/container.test.ts` on the engine, plus the stand-in tests. Expected: pass.

**Task completion evidence:** the tests and the break-test failure.

### Task 5: Confirm each reproduction against the reviewed commit

**Depends on:** Tasks 1, 3 and 4.

**Files:**
- Modify: `src/code-review-stage.ts`. After the panel's findings are recorded and before `buildCodeReviewReconcilerPrompt`:
  - run `lintSuiteFile` on each validated reproduction; a refused one is recorded `repro_failed` with the refusals and is not written;
  - write the rest to `.governance/code-review/<run>/checks/<findingId>/<reviewer>/<fileName>`;
  - create the throwaway detached checkout of `currentCommit` at `.governance/code-review/<run>/round-<n>/repro-checkout`, as plan 1's gate baseline does;
  - run every written reproduction in one `verifyCommit` call against that checkout, one `reproductionCommand` each, every one `blocking: false`, with `checksDir` set and each report's budget at `verifyRetentionMaxBytes`;
  - remove the checkout in a `finally`, auditing a failed removal as `code_review.repro.cleanup.failed`.
- Modify: `src/commit-verification.ts`. Each command passed to `verifyCommit` may carry `blocking: false`.
  - A non-blocking command's failure is recorded with `blockedBecause: null` and a `nonBlockingFailure` reason, and the remaining commands still run.
  - `outcome` stays `pass` and `blockingCommand` stays null when only non-blocking commands failed.
  - A dirty worktree after any command still blocks, whatever its flag.
  - The default is `true`, so existing callers behave exactly as today.
- Modify: `src/code-review.ts`. Add `CodeReviewReproduction { findingId; reviewer; fileName; contentSha256; outcome: "confirmed" | "not_reproduced" | "repro_failed"; detail: string | null; evidenceRef: string | null }` and `CodeReviewRound.reproductions`. `buildReport` in `src/code-review-stage.ts` lists each outcome and its detail beside its finding.

**Steps:**
- **Outcome,** from the checks reader and classifier, by the rule in "Approach". `detail` is the lint refusal, the locator's last call-log entry, the first error line, the ceiling or budget reason, or the sandbox reason.
- Each outcome writes the audit event `code_review.repro.<outcome>` with the finding ID, the reviewer, the content hash and the evidence path.
- **Tests,** through the stand-in, with the reports recorded in Task 1 and plan 1's recorded reports adapted only in their root:
  - each outcome is recorded in `result.json` and the audit log: `confirmed` for the failing assertion; `not_reproduced` for the passing one; and `repro_failed` for a locator timeout with its call-log detail, a flaky report, a load error, a lint refusal (never run), a ceiling, and a sandbox failure after one reproduction ran (both `repro_failed`);
  - the run's worktree `HEAD` and `git status --porcelain --ignored` are byte-identical before and after confirmation, with a reproduction stand-in that writes a file, and the throwaway checkout is gone;
  - the reconciler prompt's bytes are identical with and without reproductions in the reply. That pins the "the reconciler is not told" rule;
  - a final-panel finding's reproduction is run and recorded, and the round decision is the one the gate makes without it;
  - two reviewers' reproductions for one canonical finding run as two commands, and the finding is confirmed when only one confirms;
  - an existing verification call with no `blocking` flag still stops at its first failure.
- **Break-tests:**
  - confirm on any `valid_red`: the locator-timeout test fails;
  - pass the outcome into the reconciler prompt: the byte-identity test fails;
  - run confirmation in the run's worktree: the untouched-worktree test fails.
- Verify: `node --test test/reproduced-findings.test.ts test/code-review-stage.test.ts`. Expected: pass.

**Task completion evidence:** the tests and the three break-test failures.

### Task 6: Preserve confirmed checks through remediation

**Depends on:** Task 5.

**Files:**
- Modify: `src/code-review-stage.ts`. Keep a run-scoped list of preserved checks: each confirmed reproduction of a finding the reconciler kept, with its round, finding, location and severity.
  - The remediation's `verifyCommit` call passes the frozen verify commands, plan 1's acceptance command when the run froze one, and then each preserved check as a non-blocking `reproductionCommand`, with `checksDir`.
  - The classifier judges each check `holds` or `fails`. The result is recorded as `remediation.preservedChecks[]`: `{findingId, reviewer, fileName, confirmedInRound, outcome, detail, evidenceRef}`. The audit event is `code_review.check.holds` or `code_review.check.fails`.
  - The checks that failed at a remediation's commit are carried to the next panel's prompt input (Task 8).
- Modify: the remediation's `dispatchInSandbox` call in `src/code-review-stage.ts`, which passes the same `checksDir`.

**Steps:**
- **Tests,** through the stand-in, with a high and a medium confirmed reproduction kept in round 1:
  - after a remediation where the high check still fails, verification passes, the failure is recorded with its detail, and the round-2 panel runs;
  - the round-2 panel's prompt input names the failing check;
  - a check confirmed in round 1 also runs after round 2's remediation in a three-round profile;
  - a preserved check that leaves the worktree dirty blocks under `code_review remediation verification blocked`;
  - with the acceptance command frozen, `applyAcceptanceVerdict` still decides the acceptance block when preserved checks run after it;
  - a confirmed reproduction of a rejected finding is not preserved;
  - a stored `result.json` from before this plan, the committed recorded fixture's code-review record, still parses with `parsePassedCodeReviewRecord`.
- **Break-tests:**
  - mark preserved checks blocking: the high-check test blocks the stage and fails;
  - preserve rejected findings: their test fails.
- Verify: `node --test test/code-review-stage.test.ts test/reproduced-findings.test.ts test/code-review.test.ts`. Expected: pass.

**Task completion evidence:** the tests and both break-test failures.

### Task 7: No outcome downgrades a finding

**Depends on:** Task 6.

**Files:**
- Modify: `test/code-review-stage.test.ts`.

**Steps:**
- **Stage tests,** each with a final-panel `high` finding at the default blocking severity `high`. The stage blocks in each, naming that finding:
  - with no reproduction;
  - with a `not_reproduced` reproduction;
  - with a `repro_failed` reproduction.
- **A non-final round:** a `not_reproduced` finding still goes to the reconciler and, kept, to remediation. It is simply not preserved.
- **A failing check alone:** a preserved high check fails at the last remediation and the final panel reports no finding. The stage passes, and the record and report show the failing check.
- **Break-test:** filter the `not_reproduced` findings out of the findings the stage passes to `decideCodeReviewRound`. The first two tests fail. Restore and compare bytes.
- Verify: `node --test test/code-review-stage.test.ts`. Expected: pass.

**Task completion evidence:** the tests and the break-test failure.

### Task 8: The prompts

**Depends on:** Task 6.

**Files:**
- Modify: `src/prompts.ts`. `buildCodeReviewPrompt` states the reproduction contract, each rule on one source line:
  - attach at most one reproduction per finding and at most 5 in all, as a Playwright test file whose name matches `REPRODUCTION_FILE_NAME`, in plan 1's import form;
  - it must fail at the reviewed commit because of the defect, and pass once the defect is fixed;
  - the system runs it with the checkout as the working directory;
  - assert with Playwright's auto-retrying matchers: only a matcher failure confirms a finding, and a locator that never resolves does not;
  - use trusted input (`page.keyboard`, `page.click`), never `dispatchEvent`, and never fixed waits;
  - a finding without a reproduction is still reviewed and still gated at its severity.

  The structured-reply example gains `reproductions`.
- Modify: `src/prompts.ts`. `buildCodeReviewPrompt` also lists each preserved check that failed at the commit under review, with its finding, location, path and first error line. It says the reviewer may report the defect again as a finding at its severity.
- Modify: `src/prompts.ts`. `buildCodeReviewRemediationPrompt` lists each confirmed finding's check path and the exact `reproductionCommand` for it. It says the checks run after every later remediation, are read-only, and are shown to the next panel when they fail, and it says to run them with `run_command` before replying.
- Modify: `test/prompts.test.ts`. Pin the sentences in `CONSTRAINT_STRINGS`. With no confirmed checks and no failing checks, both prompts are byte-identical to Task 2's.

**Steps:**
- Verify: `node --test test/prompts.test.ts`. Expected: pass.

**Task completion evidence:** the tests, including the byte-identity checks.

### Task 9: The free benchmark on the recorded calculator

**Depends on:** Tasks 6 and 8.

**Files:**
- Create: `test/reproduced-findings-benchmark.test.ts`, which skips by name without an engine.

**Steps:**
- Build temporary repositories from the regression fixture's `trees`, and the control tree from the r1 record's `provenance.control`: `bc57eb74`'s `src/app.js` with its Enter branch replaced, so Enter always does equals and leaves `#theme-toggle` to activate itself. Run the confirmation and preserved-check functions on the real engine.
- **The reproductions** come from sample `sonnet-5-5-medium-1` of `test/fixtures/recorded/test-author-evaluation-web-calculator-r1.json`. Each is one recorded file, kept verbatim except for one named narrowing: the other top-level test declarations are removed, and the arrays of the loop that generates the target test are cut to its one failing case.
  - **Finding 9:** `acceptance/web-calculator/theme-layout.spec.mjs`, the `AC-018` loop narrowed to `"Enter"`. It recorded a matcher failure at `b5d42890` and passed at `bc57eb74` and on the control.
  - **Finding 10:** `acceptance/web-calculator/keyboard.spec.mjs`, the calculation loop narrowed to its `AC-013` row and the focus place `"1"`. It recorded a matcher failure at `bc57eb74` and passed at `b5d42890` and on the control.

  The test's `provenance` names the sample, the files and each narrowing.
- **Expected,** from the recorded per-tree results:

  | Reproduction | Commit | Expected |
  |---|---|---|
  | finding 9 | `b5d42890` | `confirmed` |
  | finding 9, preserved | `bc57eb74` | `holds` |
  | finding 10 | `bc57eb74` | `confirmed` |
  | finding 10, preserved | the control tree | `holds` |
  | finding 9, preserved | the control tree | `holds` |

- **Break-test:** run finding 9's reproduction against `bc57eb74` as if it were the reviewed commit. It must be `not_reproduced`, and the test asserting `confirmed` fails.
- Verify: `node --test test/reproduced-findings-benchmark.test.ts` on the engine. Expected: pass.

**Task completion evidence:** the test output and per-tree logs.

### Task 10: Documents, regression, and the paid benchmark (separate authorization)

**Depends on:** Tasks 1 to 9. The paid step also needs the operator's consent to its spend.

**Files:**
- Modify:
  - `ARCHITECTURE.md` section 12 (the code-review gate, reproduction outcomes and preserved checks as evidence), plus section 23 (the decision, verbatim);
  - `CLAUDE.md`, then a copy to `AGENTS.md` with hashes compared (the operating contract paragraph);
  - `docs/hazards.md` entries 18 and 23 (dated paragraphs);
  - `docs/proposals/sandboxed-delivery-rework.md` (change 7's status line).

**Steps:**
- Verify, in order:
  - `npm run typecheck`;
  - `npm run check:docs`;
  - the full serial no-engine suite, then `git log -1`;
  - the engine suites.

  Expected: clean, clean, 0 failures with the named skips, and the engine suites passing.
- **Paid, separately authorized.** Run `node .claude/skills/run-buildworks/driver.mjs paid --yes --model claude-sonnet-5-5 --dir <a durable directory under C:\Users\tamezs\buildWorks_test_repos>` on the committed web-calculator design. Run it once without `--acceptance-tests`, so review alone is measured, and redirect the output to a file.
  - **Report:** per finding, whether a reproduction was attached, its outcome and detail; every preserved check's result at each later verification; each reproduction's duration; cost and dispatches.
  - **Success criterion:** the mechanism recorded every outcome, showed every failing check to the next panel, and passed or blocked by the stated rules.
  - **Not the criterion:** that reviewers wrote confirming reproductions. That is the recall measurement this run starts.
- Extract the load-bearing responses into `test/fixtures/recorded/` with provenance before any `driver.mjs clean`.

**Task completion evidence:** the counts, the run record and the extracted fixture.

## Implementation record (2026-10-22)

**Hazards considered:** 1, 3, 4, 14, 15, 16, 18, 21, 22, 23, as in the header; 7 is unchanged because nothing retries.

Tasks 1 to 9 and Task 10's documents are built, uncommitted, on `sandboxed-delivery`. Task 10's paid benchmark has not run: it needs the operator's consent to its spend.

**What shipped, by task.**
- **Task 1.** The image is `bw-sandbox:b3acf46315c0` (`sha256:3736e8f3…`). The spike's four recorded reports are `test/fixtures/recorded/reproduction-report-{acceptance-config,matcher,pass,hidden-locator}.json`. Plan 1's config discovers no test under `/bw-checks` ("Error: No tests found."). The hidden element's call log ends `waiting 500ms`. Break-test: confirming on any `valid_red` failed the hidden-locator test.
- **Task 2.** Reviewers answer through `CODE_REVIEW_REPLY_SCHEMA`. Break-test: dropping `jsonSchema` failed the structured-reply test.
- **Task 3.** `validateCodeReviewReproductions`. Both break-tests failed their tests.
- **Task 4.** The optional `/bw-checks` mount. 17/17 container tests on the engine. Break-test: a mount without `:ro` failed the engine write test.
- **Task 5.** `confirmReproductions` (exported from `src/code-review-stage.ts`) and per-command `blocking: false` in `verifyCommit`. Three break-tests failed their tests: confirming on any `valid_red`, passing the outcome to the reconciler prompt, and confirming in the run's worktree. After the review, each reproduction runs alone (see below).
- **Task 6.** Built first as non-blocking commands after the frozen and acceptance commands. Two break-tests failed their tests: blocking checks, and preserving rejected findings. After the review, `preserveCheck` and `runPreservedChecks` replace that (see below).
- **Task 7.** Three no-downgrade stage tests. Break-test: filtering `not_reproduced` findings from the round decision failed the first two.
- **Task 8.** `REPRODUCTION_RULES`, the failing-check lines and the remediation's check lines, pinned in `CONSTRAINT_STRINGS`.
- **Task 9.** `test/reproduced-findings-benchmark.test.ts` on the real engine. Finding 9 confirmed at `b5d42890` ("Error: expect(locator).toHaveAttribute(expected) failed"). It held at `bc57eb74` and on the control. Finding 10 confirmed at `bc57eb74` ("Error: expect(locator).toHaveText(expected) failed") and held on the control. Break-test: finding 9 against `bc57eb74` came back `not_reproduced`, which failed the test.

**Deviations from the plan.**
- **The reproduction report's root and prefix.** The checks reader passes root `/bw-checks/` and container prefix `""`, not `/bw-checks/` for both. The report names a test's file relative to `testDir` but an error's location absolutely. Stripping the prefix from the location would make it differ from the test's file, so the classifier could not find the file.
- **The detail for a hidden element.** `locatorWaitDetail` skips the call log's retry-timing entries (`retrying click action`, `waiting 500ms`). For a hidden element it returns `element is not visible`, the reason the locator waited, not the literal last entry.
- **Where the constants live.** `CHECKS_ROOT`, `REPRODUCTION_FILE_NAME`, `REPRODUCTION_MAX_COUNT` and `REPRODUCTION_MAX_CHARS` live in `src/acceptance.ts`. `src/prompts.ts` may import only that module, because the CLI-router test mirrors just those two files. `CHECKS_ROOT` is pinned equal to `CHECKS_MOUNT` and a slash by a test.
- **A reply with no `structured_output`.** It fails the reviewer as `dispatch_failed`, at the envelope parse, as the patch dispatches do, not as `output_invalid`.
- **The reviewer prompt without checks.** It is not byte-identical to Task 2's, because the reproduction contract is always stated. With no failing checks it differs from Task 2's only by that contract and the example's `reproductions` member, and the pre-suite hash test removes exactly those. The remediation prompt without checks is byte-identical.
- **The no-reproduction rule.** It says a finding without one "counts exactly as one with a reproduction, at the severity you give it", not "is gated". The reviewer prompt states no consequence, and the test pins that no gate, threshold or block is named.
- **Outside the plan's file list.** `test/commit-verification.test.ts` holds the per-command `blocking` tests. `test/code-review.test.ts` holds the parse test for the new members. `test/delivery-stage.test.ts`'s hand-built record gained the new members. `scripts/test-author-evaluation.ts` exports `controlTree`, so the benchmark builds the control the r1 record used.

**Independent review (2026-10-22).** One independent reviewer read the full diff and reported seven findings. Each was checked against the code, and the operator decided findings 1, 2, 3/4 and 6. The decisions replace Task 3's refusal, Task 5's single call, and Task 6's in-verification checks and mount. The plan's steps above still describe the superseded design.
1. **A bad reproduction blocked the run.** A reply whose reproductions the validator refused failed the reviewer as `output_invalid`, which fails the panel. *Fixed (operator: drop the reproductions, keep the findings).* The reply's findings stand, its reproductions are dropped, and `code_review.repro.refused` records the reviewer and reason. The validator also counts content in code points, as the schema's `maxLength` does.
2. **A matcher on a missing element confirmed.** `expect(locator).toHaveText` on a locator that matches nothing fails as a matcher, so a reproduction with a wrong selector confirmed. *Fixed (operator: `repro_failed`).* `isMatcherFailure` excludes the `element(s) not found` failure, and the detail names the locator. The test is built from `acceptance-code-review-probes.json`'s recorded "AC-003 promise array awaits only the array" report.
3. **A check that writes on its pass path blocked the run.** A preserved check ran inside the remediation's verification, where a dirty worktree blocks. *Fixed (operator: isolate each run).*
4. **A dirtying reproduction stopped its siblings.** All reproductions shared one `verifyCommit` call, which stops at the first block. *Fixed with 3.* Each reproduction and each check now runs alone (`runAlone`), in its own sandbox and throwaway checkout, and a checkout that cannot be made, a sandbox failure, a dirty checkout or a throw ends only that run. The remediation's verification is back to the frozen and acceptance commands. The checks run after it passes, at `round-<n>/check-checkout/`, with evidence under `round-<n>/preserved-checks/`, and none runs when it blocks. `CodeReviewPreservedCheck.evidenceRef` may be `null`.
5. **A thrown report error aborted the stage.** `readReproductionReport` throws on a report shape it cannot read. *Fixed.* `judgeReproductionRun` returns `other` with "the report cannot be read: …".
6. **The remediation mount exposed rejected reproductions.** The remediation's container mounted the whole checks directory. *Fixed (operator: mount the preserved checks only).* `preserveCheck` copies each preserved file under `.governance/code-review/<run>/preserved/`, which is what remediation and the checks mount.
7. **(a) The benchmark bypassed the preservation wiring, and (b) a confirmation sandbox failure was audited as `code_review.sandbox.failed`.** *Fixed.* (a) The benchmark's checks go through `preserveCheck` and `runPreservedChecks`. (b) The runs audit their steps as `code_review.repro.<action>` and `code_review.check.<action>`.

Each fix has a test that failed when the fix was broken, and each file was restored byte-identical from a copy:
- counting UTF-16 units failed the code-point test;
- refusing the reviewer again failed the refused-reproductions test (finding 1);
- treating a missing element as a matcher failure failed the not-found test (finding 2);
- stopping confirmation after the first `repro_failed` failed the dirty-sibling and sandbox-failure tests (finding 4);
- running the checks after a blocked verification failed the acceptance-suite test (finding 3);
- mounting the checks directory for remediation failed the mount test (finding 6);
- writing a preserved check into the checks directory failed the rejected-finding test (finding 6);
- routing a confirmation's sandbox events through `sandboxAction` failed the cannot-start test (finding 7b);
- removing `judgeReproductionRun`'s catch failed the "judged other, never thrown" test with "number 5 is not iterable" (finding 5).

`runAlone`'s wrapper for a thrown error has no test that throws, so it is written, not verified.

**Regression (2026-10-22, after the review's fixes).**
- `npm run typecheck` and `npm run check:docs` were clean.
- The full serial no-engine suite ran 1883 tests: 1877 passed, 2 failed and 4 were skipped. `git log -1` was still `de99c1d`.
- The two failures are `test/sign-approval.test.ts`'s keygen refusal tests, which this change does not touch. `scripts/sign-approval.mjs` is unchanged since `72fe14f`. It prints its refusal and writes nothing. Node v26.4.0 then aborts inside `process.exit(2)` with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`, exit `3221226505`. Run alone, they fail the same way.
- The engine suites ran on Docker 29.8.2: `test/container.test.ts`, `test/acceptance-engine.test.ts` and the benchmark passed 28 of 28. The benchmark's six tests all passed.

**Deferred.** The paid benchmark (Task 10) awaits consent.

## Rollback

Revert the build commits.
- Reviewers return free text again, the work container loses the optional mount, and remediation verification runs only the frozen commands and suites.
- Removing `container/checks.config.mjs` restores the earlier image tag.
- `result.json` files written meanwhile keep their extra members, which the parser ignores.
- No stored schema or frozen profile changes.
