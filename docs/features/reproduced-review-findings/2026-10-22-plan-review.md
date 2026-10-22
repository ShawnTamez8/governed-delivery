# Reproduced review findings implementation plan — review

**Reviewed document:** `plan.md`
**Document type:** Plan
**Review date:** 2026-10-22
**Status:** reconciled

**Hazards considered:** 1, 3, 4, 7, 14, 15, 18, 22 and 23. Entry 3 bears on C3: the reproduction's file name is a constrained field whose rule the plan states two ways, and the plan lists 3 as not engaged. Entry 4 bears on H1: the benchmark's source fixture is the evaluation round that failed its thresholds. Entries 15 and 22 bear on H3: model-written code runs against the shared worktree, and the plan lists 15 and 22 as not engaged. Entries 1, 7, 14, 18 and 23 are the plan's own; the review checks its claims against them. The rest bear on nothing the plan changes.

---

## Summary

The plan is a careful design for confirming code-review findings with executable reproductions, and its no-downgrade rule is well pinned by tests. It was written on 2026-10-20, before plan 1 (`docs/features/protected-acceptance-tests/plan.md`) shipped. Several of its premises about plan 1's runner, mounts and evaluation record no longer match the code that shipped. Its outcome rule also contradicts itself between the approach and Task 4.

## Verdict

**Ready for planning after required changes.** The design holds, but as written an implementer builds a runner invocation that finds no tests and an outcome rule that reads that failure as `confirmed`. C1 to C3 need edits to the plan. H2 needs an operator decision before Task 5.

## Critical issues — must fix before implementation

**Issue:** C1. Plan 1's fixed runner config cannot run a test under `/bw-checks`

- **Why it matters:** The approach runs "plan 1's runner with its fixed config and `--repeat-each 2`, pointed at `/bw-checks/<findingId>/`". The shipped config, `container/acceptance.config.mjs`, sets `testDir: "/work/acceptance"`. Playwright treats a positional argument as a filter over files found under `testDir`, not as an extra directory [Inference: Playwright's documented CLI behavior, not yet run here]. A file under `/bw-checks` is never discovered, so the runner reports no tests and exits non-zero. The report reader in `src/acceptance.ts` also prefixes every test file with `acceptance/` (`ACCEPTANCE_ROOT + spec.file`). It strips only `/work/` from error locations. `classifyFailure` then finds no suite file for an error located under `/bw-checks`, and returns `test_code` for every failure.
- **Where:** Approach, "The reply" (the runner bullet); Task 4 Files; Task 7 (the "exact runner command"). Neither `src/acceptance.ts` nor `container/acceptance.config.mjs` nor `container/Dockerfile` appears under "Affected areas".
- **Production impact:** Under Task 4's exit-code rule (C2), every reproduction ends `confirmed`, including ones that never ran. Every confirmed reproduction of a kept high then becomes a preserved check that fails after every remediation and blocks the run.
- **Recommended fix:** Add a task that adds a second system-owned config whose `testDir` is `/bw-checks`, or another runner shape proven by a spike on the real engine. Parameterize the report reader's root and container prefix. List `src/acceptance.ts`, the config and `container/Dockerfile` under "Affected areas". A changed image also changes the frozen image ID, so state how existing runs are affected. Make Task 4's first test run one reproduction through the real runner and assert that a test was discovered.

**Issue:** C2. The outcome rule is stated three incompatible ways

- **Why it matters:** The approach says outcomes "come from plan 1's report classifier, not the exit code", with `confirmed` meaning "every test failed on both repeats". Task 4's steps say "exit non-zero, not timed out and not overflowed is `confirmed`". The hazard 14 line says "the system decides the outcome from an exit status". Task 4 is what an implementer executes. Under it, a load error, a lint refusal or a "no tests found" exit all become `confirmed`. The approach's own definition is also incomplete. "Every test failed on both repeats" does not require the failure class to be `valid_red`. A test that throws a `TypeError` on both repeats is classified `fail` with class `test_code`, so it confirms.
- **Where:** Approach, "Confirmation"; Task 4, "Steps", "Outcome"; "Hazards considered", entry 14.
- **Production impact:** False confirmations of every kind. Through C1 these include reproductions that never executed. Each one of a kept high blocks at the next remediation verification.
- **Recommended fix:** Make Task 4 implement the classifier rule. `confirmed` means a report that loads, has at least one test, has no load error and passes the lint, with every test `fail` and class `valid_red` on both repeats. `not_reproduced` means every test passed. Everything else is `repro_failed`. Correct the hazard 14 line to match. Replace Task 4's "exit 0 is `confirmed`" break-test with one that runs a report whose failures are `test_code` and asserts `repro_failed`.

**Issue:** C3. The reproduction file name has two contracts

- **Why it matters:** The approach and Task 7 require `<kebab-case>.spec.mjs`. Task 1's schema pattern is `^[a-z0-9][a-z0-9-]{0,63}\.test\.mjs$`. A reviewer that follows the prompt produces a name the schema refuses. If the harness enforces `pattern`, the structured output fails and the reviewer is `output_invalid`. An incomplete panel blocks the run (`code_review.reviewer.failed`). This is hazard 3's failure class, which the plan lists as not engaged.
- **Where:** Approach, "The reply"; Task 1, Files; Task 7, Files.
- **Production impact:** Every panel in which a reviewer attaches a reproduction can fail, and blocks the run.
- **Recommended fix:** Choose one suffix, and state it in the schema, the validator, the prompt and the tests. Pin the prompt sentence through `CONSTRAINT_STRINGS` from the same constant the schema uses. Move "Not engaged: 3" into the considered list.

## High-risk areas

**Risk:** H1. The free benchmark names the evaluation round that failed its thresholds

- **Why:** The hazard 4 line and Task 8 source reproductions from `test/fixtures/recorded/test-author-evaluation-web-calculator.json`, described as "a suite that met its thresholds". That record's `score` shows `gatePassing: 0`, `gate: false`, `finding9: false` and `finding10: false` for both settings. Plan 1's Task 4 evaluation record says "neither setting passes". The rounds that met the re-registered thresholds are `test-author-evaluation-web-calculator-r1.json` and `test-author-evaluation-web-calculator-r2-rescore.json`.
- **Impact if ignored:** Task 8's expected outcomes rest on tests that did not catch either finding, so the benchmark can fail on the fixture rather than on the mechanism. If an implementer patches the test selection to make it pass, the expected values become session-invented, which hazard 4 forbids.
- **Mitigation:** Name the passing record and the exact sample and test title for each reproduction. Name where the control tree comes from: it is a one-line edit of `bc57eb74` described in that record's `provenance.control`, not a tree in the regression fixture.

**Risk:** H2. A falsely confirmed high blocks at the next remediation, with no dispute path

- **Why:** `classifyFailure` counts a locator timeout as `valid_red`. A reproduction with a wrong selector therefore fails the same way on both repeats and confirms. Nothing at confirmation checks the contract's second half, "passes once the defect is fixed". If the reconciler keeps the finding, the preserved check fails after any remediation, because the selector is still wrong. A kept high's check then blocks at that remediation's verification, before the next panel can review the fix. The plan's only limit on false confirmation covers below-threshold severities. Plan 1 gave the implementer a dispute route for a test that contradicts the specification (`disputedTests`). This plan gives none for a preserved check. The reconciler keeps any finding when a call fails, so "kept" does not establish that the specification requires the behavior.
- **Impact if ignored:** The plan adds a new run-ending path driven by model-written tests that no one has measured. The plan itself names reviewer precision as unmeasured.
- **Mitigation:** Put a choice to the operator under "Decision needed". Option one: a failing preserved check becomes evidence for the next panel rather than a block. Option two: extend plan 1's dispute route to preserved checks. Option three: accept the risk explicitly. Also consider excluding locator-timeout reds from confirmation, because they do not prove the asserted behavior is absent.

**Risk:** H3. Confirmation runs model-written code against the run's writable worktree, with no rule for a dirtied tree

- **Why:** `verifyCommit` mounts the worktree read-write at `/work`. The lint does not refuse a dynamic `import("node:fs")` [Inference: from the `lintSuiteFile` rules read, not tested]. In `runCommands`, a dirty tree after a command becomes that command's `blockedBecause`. With `blocking: false`, verification continues on the dirty tree, and every later reproduction fails the same check. `removeIgnoredOutput` runs only on a pass, and it refuses non-ignored entries. The plan says only that "the worktree is clean after the call". It defines no outcome when a reproduction dirties the tree. The next guard to see the dirt is the reconciler call's or the pre-implementer clean check, which aborts and names the wrong actor.
- **Impact if ignored:** A run aborts with `code_review.worktree.dirty`, attributed to the reconciler or the implementer, after a reviewer's reproduction wrote the file.
- **Mitigation:** Run confirmation in a throwaway checkout of the reviewed commit, as plan 1's gate does for its baseline. If that is not possible, specify that a dirtied tree makes that reproduction `repro_failed`, stops the call, and is restored before the stage continues. Add a stage test for that case. Move entries 15 and 22 into "Hazards considered".

**Risk:** H4. The verification plumbing for non-blocking and preserved commands is underspecified

- **Why:** Several behaviors the tasks depend on are left undefined:
  - Task 4 adds `blocking: false` but does not say what `record.outcome` and `blockingCommand` become when only non-blocking commands fail.
  - An infrastructure failure (`ContainerError`) in `runCommands` returns `kind: "infrastructure"` and drops the partial record. The plan's rule "a sandbox failure is `repro_failed` for every reproduction" therefore loses the outcomes of reproductions that already ran, and the plan does not say so.
  - Preserved checks in Task 5 are judged by exit code through `verifyCommit`. Only the acceptance command is reclassified (`applyAcceptanceVerdict`, matched by name). A flaky preserved high therefore blocks as "failed", where the confirmation rule calls flakiness `repro_failed`.
  - Two reviewers' reproductions for one canonical finding go to the same `checks/<findingId>/` directory. File-name uniqueness is checked only within one reply, so the second file can overwrite the first. Pointing the runner at the directory also runs both files in one command, which cannot yield the per-reproduction outcome that "confirmed if either confirms" needs.
- **Impact if ignored:** Each gap forces the implementer to invent behavior that the tests then pin, which is the hazard 4 failure mode.
- **Mitigation:** Specify the record shape for non-blocking failures. Specify how preserved checks are judged: by the classifier, with a named block reason. Run one command per reproduction file, in a directory keyed by finding and reviewer.

## Medium and low concerns

- **Stale premises from before plan 1 shipped.** The assumption that "the work container mounts only the worktree and its read-only `.git`" is out of date. `createSandbox` now takes `readOnlyPaths` and mounts committed copies from `acceptanceMountDir`. Container test criterion 2 is the one plan 1 left in place. `verifyCommit` has three callers (`src/implementation-stage.ts`, `src/verification-stage.ts` and `src/code-review-stage.ts`), not two. The task dependency names plan 1's Task 10, but plan 1 is now built. Reconcile `checksDir` with `readOnlyPaths`, including mount order and teardown, and update the blast radius.
- **Task 9's paid command does not run.** `.claude/skills/run-buildworks/web-calculator-acceptance-design.md` does not exist, and the driver's flag is `--acceptance-tests`, not `--acceptance`. Plan 1's Task 11 ran the committed web-calculator design.
- **The content bound lives only in the schema.** Task 2's validator re-checks the file name but not the 65,536-character bound. The repository's pattern re-checks schema rules at the boundary (`validateWorkspaceReply`). No evidence shows that the harness enforces `pattern` or `maxLength`; `WORKSPACE_REPLY_SCHEMA` uses only `enum`.
- **Wall time is unbounded.** The plan caps reproductions at one per finding, but findings per reply are uncapped. Each reproduction runs sequentially under the full verify-command ceiling, with `--repeat-each 2`, on every panel including the final one. Add a `maxItems` or a stated budget.
- **The output budget is unset.** Remediation verification gives the acceptance report `maxBytesFor` with `verifyRetentionMaxBytes`. Reproductions fall back to `resultMaxBytes`, so a large JSON report overflows and ends `repro_failed` silently.
- **The lint has no implementing step.** `lintSuiteFile` is not exported, and no task runs it before confirmation. The approach's "a lint refusal" outcome has nothing that produces it.
- **The prompt and the schema disagree between Task 1 and Task 7.** Task 1 moves reviewers to `--json-schema`, but `buildCodeReviewPrompt` keeps its free-text reply instructions until Task 7. Move the reply-format sentences into Task 1.
- **Task 6's break-test has no plumbing to break.** `decideCodeReviewRound` receives no reproduction outcomes. Break the call site's `withReports` instead.
- **The session record describes a different contract.** `.claude/sessions/project-learnings.md` describes change 7 as "one `node:test` reproduction per finding". The plan specifies Playwright.

## Missing and underspecified areas

- **The exact reproduction command.** Name the config path, the `testDir` and the argv in the plan, because Task 7 pins it into the remediation prompt.
- **The round-record shape.** Give the full type of `reproductions` and `preservedChecks[]`, and say where each preserved check's per-remediation result lives relative to `CommitVerificationRecord`.
- **Audit events for preserved checks.** Only `code_review.check.failed_nonblocking` is named. Name the pass and block events too, and the blocking reason's text.
- **Preserved checks after a legitimate change.** A fix may change the DOM a reproduction depends on. State whether that block is the intended outcome. H2's decision covers this case.
- **The dashboard and `report.md`.** State what they show for reproduction outcomes and preserved-check results.

## Suggested improvements

- Add one engine spike before Task 1 that runs a hand-written reproduction from `/bw-checks` through the shipped image, and records the report. That record then serves as a committed fixture for Tasks 4 and 5, rather than a hand-written report.
- Record each reproduction's content hash in the round record and the audit event, so a preserved check's identity across rounds is provable.

---

## Reconciliation

**Date:** 2026-10-22
**Disposition:** 22 accepted, 0 rejected, 1 deferred, 0 open
**Status:** reconciled

The operator settled four judgment calls on 2026-10-22. A failing preserved check is evidence for the next panel, not a block. Only a matcher failure confirms, and the operator asked that a locator timeout record why it waited; the call log's last entry provides that. The free benchmark narrows each recorded loop. Each reply carries at most 5 reproductions.

### Verdicts

- **Accepted — C1, plan 1's fixed runner config cannot run a test under `/bw-checks`:** Task 1 adds `container/checks.config.mjs` (`testDir: "/bw-checks"`), parameterizes the report reader's root and prefix, and records the runner's reports on the real engine, including whether plan 1's config discovers the file; the affected areas and blast radius name the config, the Dockerfile, `src/acceptance.ts` and the image-tag change.
- **Accepted — C2, the outcome rule is stated three incompatible ways:** the approach, Task 5 and the hazard 14 line now share one classifier rule; `confirmed` requires a matcher failure on every test on both repeats; Task 5's break-test confirms on any `valid_red` and expects the locator-timeout test to fail.
- **Accepted — C3, the reproduction file name has two contracts:** one constant, `REPRODUCTION_FILE_NAME` (`.spec.mjs`, matching plan 1's suite files), feeds the schema, the validator and the prompt; hazard 3 moved into the considered list.
- **Accepted — H1, the free benchmark names the evaluation round that failed its thresholds:** Task 9 and the hazard 4 line use sample `sonnet-5-5-medium-1` of the r1 record, name each file and narrowing, and take the control tree from that record's provenance; both chosen tests recorded matcher failures, so they confirm under the settled rule.
- **Accepted — H2, a falsely confirmed high blocks at the next remediation with no dispute path:** by operator decision a failing preserved check never blocks; it is recorded and named in the next panel's prompt, and only the final panel's gate blocks; Task 6's break-test now marks checks blocking, and Task 7 pins that a failing check alone does not block; locator timeouts no longer confirm.
- **Accepted — H3, confirmation runs model-written code against the writable worktree:** confirmation runs in a throwaway detached checkout of the reviewed commit, removed in a `finally`; a dirtied checkout is `repro_failed`; Task 5 asserts the run's worktree is byte-identical before and after, with a break-test; hazards 15 and 22 moved into the considered list.
- **Accepted — H4, the verification plumbing for non-blocking and preserved commands is underspecified:** Task 5 defines the record for non-blocking failures and keeps the dirty-tree block whatever the flag; a sandbox failure makes every reproduction in the call `repro_failed`; preserved checks are judged `holds` or `fails` by the classifier; reproductions are stored per finding and reviewer and run one command each.
- **Accepted — stale premises from before plan 1 shipped:** the assumptions describe `readOnlyPaths` and `acceptanceMountDir`, the blast radius lists three `verifyCommit` callers, and the dependency on plan 1's Task 10 is replaced by its commits.
- **Accepted — Task 9's paid command does not run:** Task 10 runs the driver on the committed web-calculator design with no `--design` or `--slug`, and names `--acceptance-tests`.
- **Accepted — the content bound lives only in the schema:** Task 3's validator checks the file name, the content length and the entry count, with a break-test on the length check; the assumptions mark harness enforcement of those keywords as unknown.
- **Accepted — wall time is unbounded:** by operator decision the schema caps reproductions at 5 per reply, and the paid report records each reproduction's duration.
- **Accepted — the output budget is unset:** confirmation and preserved checks retain each report under `verifyRetentionMaxBytes`.
- **Accepted — the lint has no implementing step:** Task 1 exports `lintSuiteFile`, and Task 5 runs it before writing; a refusal is `repro_failed` and is never run.
- **Accepted — the prompt and the schema disagree between Task 1 and Task 7:** Task 2 rewrites the reviewer prompt's reply-format sentences with the schema change.
- **Accepted — Task 6's break-test has no plumbing to break:** Task 7's break-test filters the findings the stage passes to `decideCodeReviewRound`.
- **Deferred — the session record describes a different contract:** `.claude/sessions/project-learnings.md` is a historical-tier record that only `context-compaction` rewrites; the next compaction pass replaces "`node:test` reproduction" with this plan's Playwright contract.
- **Accepted — the exact reproduction command:** the approach and Task 1 name `CHECKS_CONFIG` and the full argv of `reproductionCommand`.
- **Accepted — the round-record shape:** Task 5 defines `CodeReviewReproduction`, and Task 6 defines `remediation.preservedChecks[]`.
- **Accepted — audit events for preserved checks:** Task 6 names `code_review.check.holds` and `code_review.check.fails`; Task 5 names `code_review.repro.cleanup.failed`; the dirty-tree block keeps the existing `code_review remediation verification blocked` reason.
- **Accepted — preserved checks after a legitimate change:** under H2's decision such a check fails without blocking, and the next panel decides whether the defect has returned.
- **Accepted — the dashboard and `report.md`:** the approach states that `report.md` lists outcomes and check results, and that the dashboard does not show them in this plan.
- **Accepted — an engine spike before Task 1:** Task 1 is that spike; its recorded reports replace hand-written ones in Tasks 1 and 5.
- **Accepted — record each reproduction's content hash:** `CodeReviewReproduction.contentSha256` and the `code_review.repro.<outcome>` audit event carry it.
