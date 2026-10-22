# 2026-10-20: protected acceptance tests, build session

**Requested outcome:** implement `docs/features/protected-acceptance-tests/plan.md` (change 4) through `/implement-plan`.

**Operator decisions in this session:**
- Section 23: this invocation authorizes change 4 as the plan states it, the same form as change 1's entry. That excludes paid runs other than Task 4, change 7 and anything beyond the plan.
- Gate 2 and gate 3 failures block the run; they do not pause it.
- Task 4 has consent now, up to $5, if Tasks 1 to 3 pass their exit criteria. The operator still picks the seeded setting from its results.

**Baseline:** branch `sandboxed-delivery` at `4be6b2a`. The plan and its review are untracked. The fixture change (`specFull`, `planFull`) is uncommitted.

**Task 1, the spike: stopped at its exit criterion.** The full record is in the plan's "Task 1 spike record".
- Probes 1 to 5, 7 and 8 behaved as stated.
- The image is 2.02 GB (against 472 MB today) and its cold build took 93 s.
- The bare `@playwright/test` import is unsafe: a planted decoy made a failing test pass. The chosen form is `await import(process.env.BW_PLAYWRIGHT_TEST)`, with the variable set as an image `ENV`.
- A locator failure in a `beforeEach` hook declared after its test cannot be told apart from a valid red by any report field. Routes A (lint refuses hooks), B (a system reporter) and C (parse the source, rejected) were offered to the operator.

**Operator decision after Task 1:** route A. The lint refuses hooks, and enforces retrying assertions, no hard-coded timeouts or delays, no missing awaits and no `networkidle`. It is written into the plan's gate 5 and the section 23 entry.

**Task 2: done.**
- `container/Dockerfile` and `container/acceptance.config.mjs`, with `sandboxImageTag` over every file in `container/`. The new image is `bw-sandbox:064ffeee50ae` (`sha256:ed748dbe…`).
- `src/acceptance.ts` has the command, the parser and the classifier.
- 12 recorded reports, `test/fixtures/recorded/acceptance-report-*.json`, were captured through `createSandbox`, `runInSandbox` and `acceptanceCommand`.
- `test/acceptance.test.ts` passes, with the engine `test/container.test.ts` 22/22. The 3 break-tests failed their tests and were restored byte-identical.

**Task 3: done.**
- `validateAcceptanceSuite` and its lint, which works on two source views (comments blanked, and comments plus literals blanked).
- The tests pass 19/19. The 5 break-tests (coverage, `dispatchEvent`, missing await, flaky, any failure counted as red) each failed their target test, with byte-identical restores.
- A defect was found and fixed: the classifier read hook calls in comments, while the lint did not.

**Task 4: finished 2026-10-21, $4.94. Neither setting passes, so the plan is stopped for an operator decision.**
- The full record is in the plan's "Task 4 evaluation record".
- All 79 gate refusals are lint false positives: returned promises and helper-built assertion subjects.
- Finding 9 and the control contradict the approved specification, which says Enter does equals with focus on any element of the page.
- Opus wrote the focus variants in 3 of 3 samples, and Sonnet in 1 of 3. Every variant suite catches finding 10.
- Nothing was re-scored and no rule was changed.

**Correction (2026-10-21):** the line above saying finding 9 and the control contradict the specification is wrong. A spec-correct implementation does equals on every Enter and leaves the key's default alone on `#theme-toggle`, so an AC-018 test that activates the control with Enter catches finding 9. The control was the defect: it skipped equals on the theme control.

**Operator decision (2026-10-21):** replace rules that are not the best, fix the lint and the benchmark, then loop on paid rounds until a suite catches both findings with no false positives, up to $15 in total. The $15 is read as cumulative, including Task 4's $4.94. The operator approved moving `typescript` into `dependencies` in place of Snitch, whose decision worker was down.

**Done on 2026-10-21:**
- **Gate 5 rebuilt on the TypeScript parser** in `src/acceptance.ts`, with the rules stated as intents (plan, "Corrections and operator decision").
  - Over the six recorded suites, refusals fell from 79 to 0.
  - The acceptance tests pass 20/20, with 4 break-tests in `scratchpad/n1..n4.json`.
- **The control is now spec-correct.** `scripts/test-author-evaluation.ts` gained `--rescore`, `--result`, `--ceiling` and `--setting`.
- **The free re-score** is `test/fixtures/recorded/test-author-evaluation-web-calculator-rescore.json`.
  - 266 of 266 tests pass on the control, and all 6 suites pass the gate.
  - Finding 10: Opus 3 of 3, Sonnet 1 of 3. Finding 9: 0 of 6.
- **The author prompt** gained three rules: condition-set members, each activation method, and two criteria on one input.
- **Paid round 1** is Sonnet only with a $3 ceiling: `C:\Users\tamezs\buildWorks_test_repos\test-author-evaluation-2026-10-21-r1`.

**Paid round 1, state on 2026-10-21 (Sonnet, $3 ceiling, $0.77 spent):**
- Sample 1: 109 tests. The gate refused it only because the serial baseline was killed at 900 s (exit 137, "Killed"). Scored outside the record, its tree runs catch finding 9 (two AC-018 Enter-on-theme-control tests) and finding 10, with 0 control failures.
- Sample 2: the dispatch is checkpointed ($0.33). Its baseline never ran: Docker Desktop was down. Sample 3: not dispatched.
- The timeout's cause: every baseline result waits out the 5 s action/expect timeout (5.05–5.19 s in all six Task 4 reports), serially, with `--repeat-each 2`. So the 900 s ceiling holds about 82 tests.
- Operator: use the workers fix. `container/acceptance.config.mjs` now has `workers: 4, fullyParallel: true` (image `bw-sandbox:5c7d0cadf267`), uncommitted.
- Probes of sample 1's baseline, free, all in the scratchpad. Wall time fell to 359 s (4 workers) and 548 s (2 workers), but Chromium crashed ("Target crashed", SIGABRT, `spawn` failures), giving 84 and 48 flaky tests.
- Root cause: PID 1 in the work container is `sleep infinity` (`src/container.ts:406`), which never reaps orphans. Zombies parented to PID 1 grew 6 → 20 in 40 s at 1 worker, and the container's thread count reached the 512 `--pids-limit` at both 2 and 4 workers while memory stayed near 450 MiB. A serial run has the same leak, only slower.
- The proposed fix is `--init` on the work container, awaiting the operator. Two orphaned probe containers, `bw-128ff279-985-probe-fc165a-{work,proxy}`, are left because Snitch was down.

**Operator (2026-10-21): "Just add init and re-run the tests."** Done, uncommitted. `src/container.ts` adds `--init`, the stand-in accepts it, and `test/container.test.ts` admits the read-only `docker-init` mount and gained a zombie guard (break-tested; engine 15/15). With 4 workers, sample 1's baseline took 305 s, with 109 valid red and no flaky result.

**Rounds 1 and 2: both settings pass all four thresholds.** The table is in the plan's "Round 1 and round 2 results".
- Sonnet 5.5 `medium`: 3/3 gate, findings 9 and 10 caught in each suite, 0 control failures, $1.1326. Record `…-r1.json`.
- Opus 5.5 `high`: 2/3 gate, findings 9 and 10 caught in each suite, 0 control failures, $3.6602. Record `…-r2.json`.
- Cumulative spend is $9.73 of $15.
- Opus sample 3's gate refusal is a classifier false refusal. A custom `expect` message puts text before `expect(`, and `MATCHER` is anchored at the start. Reported, not fixed.
- Open: the operator picks the seeded setting (Task 5), decides the classifier fix, and decides whether to commit. The probe containers still need removing.

**Classifier fix for custom `expect` messages: built, uncommitted (state recovered after a reboot, 2026-10-21).**
- `src/acceptance.ts` adds `CUSTOM_MESSAGE_MATCHER`: the matcher header after a blank line following a custom message counts as valid red; a self-thrown error of the same layout stays `test_code`.
- Fixture `test/fixtures/recorded/acceptance-report-valid-red-custom-message.json`; the acceptance tests pass 21/21 and typecheck is clean.
- Break-test: removing the rule failed the classification test; restore byte-identical.
- Free re-score `test/fixtures/recorded/test-author-evaluation-web-calculator-r2-rescore.json`: Opus 5.5 `high` is now 3/3 gate, with findings 9 and 10 caught in each suite and 0 control failures. Nothing spent.
- Not yet done: the plan's round 2 note (line ~697, "reported, not fixed") and its results table still describe the pre-fix state. Sonnet's r1 record was not re-scored.
- Leftover containers: `bw-128ff279-985-probe-fc165a-{work,proxy}` and `bw-4fc7cb2d-951-baseline-d6b040-{work,proxy}`, all exited.

**Operator (2026-10-21, after the reboot):** remove the four exited containers (done, with their two networks; Snitch's worker was down, so the operator's own approval stood in), update the plan's round 2 record (done), seed Sonnet 5.5 `medium`, and continue the tasks. Task 11 is still separately authorized.

**Task 5: done (uncommitted).**
- Files: `src/policy.ts` (the seeded setting, `ACCEPTANCE_REPEAT_EACH`), `src/agents.ts`, `src/profile.ts` (`acceptance`, execution-only), `src/run-intake.ts`, `src/cli.ts`, `src/cli-args.ts`, `src/acceptance.ts` (`acceptanceDir`), and tests in `test/profile.test.ts`, `test/cli.test.ts` and `test/dashboard-ui.test.ts`.
- 224/224 across those files and `test/acceptance.test.ts`; typecheck clean. Break-test: an inspectable read of `acceptance` failed the old-profile test; restore byte-identical.
- Stored runs: the inspect results are unchanged. Execute now refuses crew-chatter run 8 and `sandboxed-web-calculator-2026-10-20`, both completed.
- **Test environment:** five NUL-filled files under `%TEMP%\bw-docker-stand-in` (written 12:44–12:47 local, at the reboot) break every stand-in test. They were left in place. Tests run with `BW_DOCKER_STAND_IN_STATE` set to a scratchpad directory.
- Follow-up, not done: the dashboard's `STAGE_SETTINGS` (`src/dashboard/app.js`) does not list the test author under `implementation`.

**Task 6: done (uncommitted).** The plan's "Task 5 and Task 6 build record" holds the detail.
- Files:
  - `src/implementation-stage.ts`: `authorSuite` and `gateSuite`.
  - `src/paths.ts`: `acceptanceEvidenceDir`.
  - `src/operator-output.ts`.
  - The stand-in: `docker-stand-in.mjs` and `stand-in.ts`, which gained `serveAcceptanceReport` and `acceptanceRuns`.
  - The emitter: the `test-author-outside` mode.
  - Tests in `test/implementation-stage.test.ts`, which gained a `baseFiles` option and 6 tests, and in `test/operator-output.test.ts`.
- Results: 77/77 across both files, typecheck clean, `check:docs` clean. All five break-tests failed as intended, and each restore was byte-identical.
- Decision: the gate run's output budget is `verifyRetentionMaxBytes`. The evidence is the 1,014,909-byte baseline log against the 1 MiB budget. Task 8 needs the same per-command budget.
- The null-run comparison against `4be6b2a` was run in scratch copies under `scratchpad/snap`, `head/` and `now/`, with the outputs in `out-head/` and `out-now/`.

**Task 7: done (uncommitted).** The plan's "Task 7 build record" holds the detail.
- Files:
  - `src/container.ts`: `readOnlyPaths`.
  - `src/dispatch.ts`.
  - `src/commit-verification.ts`.
  - `src/workspace-commit.ts`: `protectedPaths`.
  - `src/implementation-stage.ts`, `src/verification-stage.ts` and `src/code-review-stage.ts`.
  - `src/spec-doc.ts`: `acceptanceArtifactRefusals`, called in `writeSpecDoc`.
  - `src/approval-stage.ts`.
- Tests:
  - the new `test/acceptance-engine.test.ts`, run on the engine;
  - `recordingDockerCommand` and `workContainerMounts` in `stand-in.ts`;
  - new tests in the implementation-stage, verification-stage, code-review-stage, spec-doc and approval-stage test files.
- Results: 401/402 when the files run in parallel. The one failure is a race in the stand-in's shared state, and it passes alone. Five break-tests all failed as intended.
- The full suite must run serially (`--test-concurrency=1`). Running the stand-in tests in parallel against one `BW_DOCKER_STAND_IN_STATE` races.

**Task 8: done (uncommitted).** The plan's "Task 8 build record" holds the detail.
- Files:
  - `src/acceptance.ts`: `ACCEPTANCE_COMMAND_NAME`, `judgeAcceptanceRun`, `readSuiteFiles` and `applyAcceptanceVerdict`.
  - `src/commit-verification.ts`: `maxBytesFor`, and the record's optional `acceptance` field.
  - `src/verification-stage.ts` and `src/code-review-stage.ts`: the appended command and the verdict.
  - `src/profile.ts`: the reserved-name refusal.
- Tests: the verification-stage, code-review-stage and profile test files. Task 7's argv tests now commit a suite file and serve a pass report.
- Results: 309/309 across nine files run serially, and typecheck is clean. Four break-tests all failed as intended, and each restore was byte-identical.
- Decision: a frozen verify command named `acceptance` is refused when a suite is on, because the suite's log would collide with that command's log.
- Next: Task 9 (the prompts, the `implementation.acceptance.disputed` event, byte-identity snapshots).

**Task 9: done (uncommitted).** The plan's "Task 9 build record" holds the detail.
- Files:
  - `src/prompts.ts`: `acceptanceSuiteRules` and `acceptanceReviewRules`, plus a trailing `acceptance` argument on four builders.
  - `src/acceptance.ts`: `disputedTests`.
  - `src/implementation-stage.ts`: `recordDisputes`, and the suite prompt passed to the phase and self-review.
  - `src/code-review-stage.ts`: reads `alreadySatisfied` from `gate.json`, and refuses a run with a suite but no readable record.
  - The emitter: `suiteTitle()` and the `dispute`, `dispute-id-only` and `self-review-dispute` modes.
  - Tests in the prompts, implementation-stage and code-review-stage test files.
- Byte identity: the six affected prompts hash identically at `4be6b2a` and in the tree. The hashes are pinned in `test/prompts.test.ts`, and the snapshot script is `scratchpad/prompt-snapshot.mjs`.
- Break-tests: seven, each failing its target and restored byte-identical.
- Decisions:
  - A dispute is a whole gate-recorded title in `incompleteTasks`, never a bare ID.
  - Code review refuses a run with a suite whose `gate.json` is missing or malformed.
- Follow-ups:
  - remediation disputes are not recorded;
  - the prompt ablation, with Task 11 as its first data point;
  - the dashboard `STAGE_SETTINGS` entry, carried over from Task 5.
- Regression: 440/440 across nine files run serially (prompts, implementation, code-review, verification, profile, CLI, acceptance, approval, operator-output), none skipped.

**Task 10: done (uncommitted).** The plan's "Task 10 build record" holds the detail.
- Files:
  - `driver.mjs`, which passes `--acceptance-tests` through;
  - `SKILL.md`;
  - `ARCHITECTURE.md` sections 5, 7, 11, 12, 15, 20 and 23;
  - `README.md`;
  - `docs/hazards.md` entries 18 and 23;
  - `docs/runbooks/cli-operator.md`;
  - `CLAUDE.md` and `AGENTS.md`, which are identical (hashes compared);
  - the rework proposal's change 4 status.
- Beyond the plan's file list: ARCHITECTURE sections 12, 15 and 20 and the runbook, because they would otherwise be false.
- Results:
  - smoke 13/13, and 13/13 with `--acceptance-tests`, with the frozen `acceptance` checked in both profiles;
  - typecheck clean, and `check:docs` clean;
  - the full serial suite 1818/1822 with 0 failures, 4 skipped by name, and 69 minutes on a live engine;
  - the engine suites 17/17;
  - HEAD still `4be6b2a`.
- Next:
  - Task 11, the paid benchmark, needs separate authorization;
  - committing needs the operator's word.
- An untracked file named `=` sits at the repository root, of unknown origin; not touched.

**Task 4 build notes:**
- `src/agents/acceptance-test-author.ts` exists but is not yet registered in `AGENTS`. Registering it needs a seeded setting, or every `new-run` throws `no default settings`, so it moves to Task 5.
- `buildAcceptanceTestAuthorPrompt(agent, spec, plan, dir, command)`.
- `scripts/test-author-evaluation.ts`. It interleaves the settings, caps each dispatch's `--max-budget-usd` at min($2, what remains), checkpoints every dispatch, and its free smoke passed.
- The control narrows only the Enter guard the remediation added (the second `closest("button")` site).
- The output is in `C:\Users\tamezs\buildWorks_test_repos\test-author-evaluation-2026-10-20` (`run.log`).

**Scratch, not durable:** the spike scripts and raw reports are in the session scratchpad, under `acceptance-spike` (`make-target.mjs`, `run-case.sh`, `inspect.mjs`, `make-calc.mjs`, `reports/`). The images are `bw-acceptance-spike:1` (bare form) and `:2` (env form).

**Files changed:** the plan (its spike record). Nothing under `src/`.

**Rollback:** remove the spike record section from the plan, and run `docker image rm bw-acceptance-spike:1 bw-acceptance-spike:2`.
