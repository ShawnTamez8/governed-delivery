# Baseline Verification Implementation Plan

**Status:** Reconciled

**Goal:** Prove that the frozen verification commands can pass in a fresh worktree
of the run's starting commit before the first paid dispatch, so an environment
that can never pass verification refuses at no cost instead of blocking the run
at `verification` after the spend.

**Source:** Operator statements, 2026-10-05. (1) After team-notes run 10 blocked:
"We need a way to detect these failures much sooner, probably before feature
start." (2) "what if a different project uses C#, and drizzle or pnpm?"
(3) "i approve for you to create the plan and read the verify-command.ts, but
lets not implment any work yet" — this document is the plan only; no source file
has been changed and nothing here authorizes implementation or provider spend.
Evidence: run 10 in the team-notes target (`C:\Users\Shawn-work\repositories\testing-repos\team-notes`,
starting commit `3b73c3d`): spec, spec review, approval, plan, plan review and a
six-phase implementation all passed; `verification` blocked on `typecheck`
(`verification.gate.block`); known cost USD 7.3048866 over 16 dispatches, 0 failed
attempts with unknown spend, `verify-audit` reports `chain valid`. The retained
log (`.governance/verification/10/typecheck.log` in that target) ends
`Error: Cannot find module '...\team-notes\node_modules\typescript\bin\tsc'`.
`npm ls typescript` in that target prints `(empty)` while
`node_modules/.bin/tsc` exists and `node_modules` holds 60 directories, so the
target's install was partial. That diagnosis is an inference from those two
observations; no `npm install` was run to confirm it.

**Assumptions:**
- **The check runs once per run, after consent and before the first group.** That
  is the earliest point that needs no new operator surface. `doctor` stays
  read-only (see Open decisions 1).
- **A failing baseline refuses the invocation and does not block the run.** The
  starting commit and frozen configuration do not change when the operator repairs
  the environment, so the same run stays valid. Blocking would force a fresh run
  for a problem no code change can cause. Open decision 2.
- **The baseline reuses frozen profile values**
  (`verifyCommandTimeoutSeconds`, `resultMaxBytes`, `verifyRetentionMaxBytes`,
  `verifyEnvPassthrough`, the frozen `verification.commands`) and adds no policy
  field, so no previously frozen profile is refused (hard rule 6).
- **A red baseline refuses unless the operator accepts it for that invocation.**
  Operator decision, 2026-10-05 (Decisions, item 5). A scaffold-from-nothing
  feature or a `defect_fix` legitimately starts red: team-notes `3b73c3d`
  declares `next build` and carries no application source (`git ls-tree -r` at
  that commit lists config files, `docs/design.md` and the feature design only),
  so repairing its dependencies would still leave it red. `run
  --accept-red-baseline` lets one invocation proceed. The baseline still runs and
  records the failing commands and their evidence; the acceptance is an audit
  event, not frozen configuration (hard rule 6 is about run-start configuration,
  and operator consent is already per invocation).
- **Every baseline attempt is isolated.** Each attempt gets its own worktree and
  its own evidence directory, none is reused or deleted, and a baseline pass must
  hold in a fresh worktree of the kind implementation will create. Findings 2-4
  of the plan review (Decisions, item 3).

**Approach:** Add one function that creates a detached git worktree of the
profile's `startingCommit` and calls the existing `verifyCommit`
(`src/commit-verification.ts`) over it, then call it from `advanceRun` after the
consent and observation checks and before the first group dispatches. The result
is recorded as an audit event with no stage row and no new table. A failure
returns a refusal naming the command and the retained log, unless the invocation
was given `--accept-red-baseline`, in which case the failure is recorded, the
acceptance is recorded, and the run proceeds. Each attempt runs in its own
worktree and writes to its own evidence directory, and its audit event names that
directory and the hash of that attempt's `result.json`. The consent preview says
the step exists. No new stage kind, no per-ecosystem code, no new
abstraction: `verifyCommit` already has two callers
(`src/verification-stage.ts`, `src/code-review-stage.ts`) and this adds a third.

**Affected areas:** `src/run-command.ts`, `src/paths.ts`, `src/cli.ts` and
`src/cli-args.ts` (the `--accept-red-baseline` flag and its help text),
`src/operator-output.ts` (preview text and, if needed, an error code), a new
`src/baseline-verification.ts`; tests; `ARCHITECTURE.md` section 7,
`docs/hazards.md`, `CLAUDE.md` and `AGENTS.md`, `README.md`,
`docs/runbooks/cli-operator.md`, `.claude/skills/run-buildworks/SKILL.md`.

**Known blockers:**
- **[Verified]** Verification runs in the run's worktree, not the main checkout:
  `runVerifyCommand` sets `cwd: opts.cwd` and `verifyCommit` passes
  `worktreePath` (`src/commit-verification.ts`, `src/verify-command.ts`). The
  worktree lives at `.governance/worktrees/<run-id>` (`worktreePath`,
  `src/paths.ts:73`), is created by the implementation stage at the approval's
  `starting_commit` (`src/implementation-stage.ts`, `git worktree add ... -b
  gov/<slug>/<run>`), and contains tracked files only. Ignored inputs
  (`node_modules`, `.env`, `dev.db`, `bin/`, `obj/`) are absent from it. Any
  dependency resolution that works there does so by walking up to the main
  checkout.
- **[Verified]** The implementation stage cannot reuse a path the baseline took:
  `git worktree add` fails if the directory exists. The baseline therefore needs
  its own path.
- **[Verified by reading; reproduced by the plan reviewer, not re-run by me]**
  Three properties of the existing verifier rule out reusing a baseline worktree
  or evidence directory. (1) `checkCommitState` runs `git status --porcelain`
  without `--ignored`, so ignored files in a reused worktree are invisible to it.
  A repair made there passes the baseline, but the implementation worktree is
  created fresh with tracked files only and lacks it. (2) `runVerifyCommand` opens
  `<name>.log` with `createWriteStream(opts.evidencePath)` (default flags,
  truncating), so a second attempt in the same directory overwrites the bytes an
  earlier audit event refers to; the chain still verifies. (3) An interrupted
  attempt can leave a partial or dirty worktree that neither `git worktree add`
  (path exists) nor `verifyCommit` (entry guard) accepts.
- **[Verified]** Team-notes `3b73c3d` is not a valid baseline target for any
  feature that builds the application: its tree has no `src/`, `app/` or `pages/`
  (`git ls-tree -r --name-only 3b73c3d`, 2026-10-05) and its `governed.yaml`
  freezes `typecheck`, `lint` and `build`. **[Unknown]** whether `next build` fails
  there; no build was run.
- **[Unknown]** Whether a run created by guided mode can be continued with
  `buildworks run --run N --accept-red-baseline`. Guided mode calls `advanceRun`
  without the flag (`src/guided-command.ts:578`, `:589`) and so refuses a red
  baseline. Task 3 checks how guided and low-level runs share a run before the
  refusal text is written.
- **[Verified]** The verification environment is `VERIFY_ENV_PASSTHROUGH` in
  `src/policy.ts` and nothing else: `PATH`, `HOME`, `USERPROFILE`, `APPDATA`,
  `LOCALAPPDATA`, `TEMP`, `TMP`, `SystemRoot`. It is a code constant frozen per run,
  and `governed.yaml` accepts only `verify:` (hard rule 6, the
  configuration-means-a-frozen-constant learning). A project whose verification
  needs `DATABASE_URL`, `NUGET_PACKAGES`, `DOTNET_*` or `PNPM_HOME` cannot supply
  them through any target-side setting. The baseline will expose that; fixing it
  is a policy decision outside this plan.
- **[Verified]** Command tokens are limited to `[A-Za-z0-9._:=@+/-]`
  (`TOKEN` in `src/governed-config.ts`) and spawn uses `shell: WINDOWS`
  (`src/verify-command.ts`). On Windows `pnpm`, `npx` and `dotnet` resolve
  through the shell, so the `.cmd`-shim concern I raised earlier in this
  session was wrong for verification commands (hazard 8). On other platforms
  there is no shell and no shim.
- **[Verified]** The stage sequence is pinned (`PINNED_SEQUENCE`,
  `scripts/doc-check.mjs`), and `expectedBoundary` in `src/run-command.ts`
  counts exactly how many stages a group adds. A baseline stage would break both.
  The plan uses an audit event instead.
- **[Verified]** `boundaryFingerprint(run, stages, audit)` includes audit events
  (`src/operator-state.ts:301`), so appending the baseline event changes the
  fingerprint. `advanceRun` must re-observe after the baseline and before it
  captures `before` for the first group; otherwise `expectedBoundary` or the
  preview comparison misfires. Task 3 does this and Task 5 tests it.
- **[Verified]** `advanceRun` has two callers: `src/cli.ts:111` (`run`) and
  `src/guided-command.ts:578` and `:589` (guided mode). The low-level commands
  (`spec`, `plan`, `implement`, `verify`, `review`, `deliver`) and
  `.claude/skills/run-buildworks/driver.mjs paid` call stage functions directly
  and would not get the baseline. This plan does not change that; it is the same
  boundary that already exempts them from the consent preview.
- **[Unknown]** `profile.startingCommit` may be null (`src/profile.ts:33-40`, the
  comment at line 91). What `advanceRun` should do for such a profile has not
  been traced. Task 2 reads it; the baseline refuses by name rather than skipping.
- **[Unknown]** Which `OperatorErrorCode` the refusal should use, and whether
  adding one reaches the dashboard or JSON consumers. Task 3 reads
  `src/operator-output.ts` and greps consumers before choosing.
- **[Unknown]** Whether `pnpm` or `dotnet` is installed on this host, and whether
  verification commands may reach the network. Neither has been checked. Task 6
  records the answer and does not assume it.
- **[Verified at session start, 2026-10-05]** The working tree carries uncommitted
  work from the phased-implementation change in files this plan also touches:
  `src/operator-output.ts`, `src/policy.ts`, `src/implementation-stage.ts`,
  `ARCHITECTURE.md`, `docs/hazards.md`, `CLAUDE.md`, `AGENTS.md`. Implement this
  plan only after that work is committed, or the two changes cannot be reviewed
  apart.
- **[Verified]** `npm test` can leave an empty commit on the current branch
  (project learnings, test-suite leak). Each task that runs the suite checks
  `git log -1` afterwards.

**Blast radius:** (evidence: Grep over `src` and `test`, 2026-10-05)
- `verifyCommit`: callers `src/verification-stage.ts:174` and
  `src/code-review-stage.ts:713`. Unchanged; the baseline adds a caller and no
  parameter.
- `advanceRun`: `src/cli.ts:111`, `src/guided-command.ts:578` and `:589`;
  `test/run-command.test.ts` (30 hits) and `test/cli-operator.test.ts` (2 hits).
  Every run-command test now executes the baseline over its fixture target's
  frozen commands. Task 5 inspects those fixtures first, because a fixture whose
  commands cannot pass in a fresh worktree would fail for a reason unrelated to
  what the test is about.
- `src/paths.ts`: one existing worktree helper (`worktreePath`, line 73) and
  `verificationEvidenceDir`; the plan adds two siblings. Nothing else in `src`
  enumerates `.governance/worktrees` (Grep for `worktrees` found only
  `src/paths.ts:74`). The plan adds one new retained directory,
  `.governance/baseline/<run-id>/<attempt>/`, and one new worktree name per
  attempt directly under `.governance/worktrees/`, so its depth matches the
  implementation worktree's.
- `src/cli.ts` and `src/cli-args.ts`: `run` gains one boolean flag, and the
  checker that rejects unknown options (`node src/cli.ts help <command>` text
  included) must know it. `test/cli-operator.test.ts` and any test that pins `run`
  help text are checked in Task 3.
- The audit chain gets two new action names with a null stage id. Whether any
  consumer restricts the action vocabulary is unchecked; Task 3 greps
  `src/audit.ts` and `src/operator-state.ts` before the first append.
- Run state, schema and profile shape: unchanged. No migration, no policy field.

**Verification:** `npm run typecheck`; `npm run check:docs`; the targeted tests in
each task; `node .claude/skills/run-buildworks/driver.mjs smoke` (free, 13 steps;
the smoke stops before any `run`, so it is a regression check, not proof of this
change); the serial full suite
`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` followed by
`git log -1`. **No paid run is part of this plan, and this plan authorizes none.**
The free proof is direct calls to `runBaselineVerification` against scratch
targets (Tasks 5 and 6). Running `buildworks run` against the real team-notes
target is not part of it: consent has to be granted for `run` to reach the hook,
and a baseline that passes (or is accepted) continues straight into a paid group.
Do that only as a separate, explicitly authorized step.

**Hazards considered:**
- **Hazard 8** (Windows executable resolution): the baseline reuses
  `runVerifyCommand`, so shim handling is the same code path the verification
  stage uses. This corrects my earlier statement that `.cmd` shims were a likely
  trap; they are not for verification commands on Windows.
- **Hazard 2** (discarded output undiagnosable): the baseline retains each
  command's complete output through `verifyCommit`'s evidence file, and the
  refusal names that file. Each attempt has its own evidence directory and
  worktree, none is overwritten or deleted (ARCHITECTURE section 7), and the audit
  event carries the hash of that attempt's `result.json`. A shared directory
  would let a retry rewrite the bytes an earlier event refers to.
- **Hazard 6** (promises a later stage cannot keep): a baseline pass promises the
  frozen commands can run where implementation's work will be verified. That holds
  only if the baseline ran in a fresh worktree of the same kind, so no attempt
  reuses a worktree and a test checks the implementation path directly (Task 5).
- **Hazard 7** (retries that vary nothing): a refused baseline is retried only
  after the operator changes the environment; nothing retries automatically.
  If the operator retries without changing anything it fails identically at zero
  cost, which is the accepted outcome.
- **Hazard 11** (a default installation that cannot complete a run): the
  default-seeded `static-web` starter must still complete a run with the baseline
  in place. Task 5 asserts it with the existing guided-mode fixture.
- **Hazard 12** (configuration divergence between targets): a commit that passes
  on one machine and not another is exactly this hazard. The baseline makes the
  difference visible before spend instead of at `verification`.
- **Hazards 5 and 18** (completion without delivery; correctness never
  inspected): a green baseline proves the commands run in a fresh worktree. It
  proves nothing about whether the delivered feature works, and the 2026-09-07
  and 2026-09-11 manual checks remain the only product-level evidence. Not a
  defect of this plan, and the preview text must not imply otherwise.
- **Hazard 4** (fixtures agreeing with the code): the expected failure text comes
  from the recorded run 10 log (Task 1), not from a string written in this
  session next to the code that matches it.
- **Hazards 1, 3, 9, 10, 13-17, 19, 20:** not weighed as design inputs; this
  change dispatches nothing and touches no prompt, schema or parser.

**Decisions:** Items 1, 2 and 4 are open and the operator's. Item 3 was settled by
evidence, not by the operator, and item 5 by the operator on 2026-10-05.
1. **Where the check lives.** Proposed: only in `run`, after consent. A `doctor
   --baseline` flag was considered and rejected: `doctor` is free and read-only,
   and creating a worktree registers it in `.git/worktrees`, which makes it a
   mutation. A separate `bw baseline` command was considered and deferred: it is a
   second operator surface (hard rule 2 and 4 weigh against it) for a gain of
   running the check before consent. Decide if "before consent" matters.
2. **Refuse or block.** Proposed: refuse, leave the run `in_progress`, so the
   same run proceeds after repair. Alternative: block, which matches how every
   other failure behaves but wastes a run ID per environment fix.
3. **Worktree retention (settled by evidence).** The first draft proposed reusing
   one baseline worktree across retries. The plan review showed that approves an
   environment the implementation worktree cannot reproduce and lets a retry
   overwrite earlier evidence (Known blockers). Now: one worktree
   `.governance/worktrees/baseline-<run-id>-<attempt>` and one evidence directory
   `.governance/baseline/<run-id>/<attempt>/` per attempt, where `<attempt>` is the
   smallest integer from 1 for which neither path exists. Nothing is reused,
   repaired or deleted; a dirty or partial leftover from an interrupted attempt is
   evidence and is simply never selected again. The cost is one retained worktree
   of tracked files per attempt.
4. **Environment passthrough for other stacks.** Not changed here. If the first
   pnpm or C# target needs variables outside `VERIFY_ENV_PASSTHROUGH`, the
   baseline will refuse and the fix is a policy change that refuses every
   previously frozen profile (hard rule 3, no migration).
5. **A red baseline (operator, 2026-10-05: "Refuse unless operator accepts").** A
   red baseline refuses by default. `run --accept-red-baseline` proceeds for that
   invocation only. An accepted red baseline counts as satisfied for the run's
   later invocations, so resuming after the approval signature does not refuse
   again. Rejected alternatives: always refuse (leaves scaffold-from-nothing and
   defect-fix runs unable to start) and warn-only (an unattended `--yes` run
   would spend anyway). The accepted flag cannot tell an environment failure from
   a missing-code failure; the operator reads the retained log, which the
   refusal names. Guided mode has no flag; see Known blockers.

## Tasks

### Task 1: Record the evidence this plan depends on

**Depends on:** None

**Files:**
- Create: `test/fixtures/recorded/verification-team-notes-run-10-typecheck.json`
- Create: `test/recorded-verification-evidence.test.ts`

**Steps:**
- Copy the run 10 `typecheck.log` from the team-notes target into the fixture as a
  string field with a `provenance` block: run 10, the verification event time read
  from the run 10 store (the table is `audit`, created in
  `src/migrations/001_init.sql`; read that file for the column names, then select
  the rows for run 10 whose action is `verification.command.fail`; do not
  guess), capture date 2026-10-05, what was dropped (nothing), and the target
  path and commit `3b73c3d`. Use a scratch `.mjs` to write it, not `node -e`
  (project learnings).
- Record the `npm ls typescript` output (`(empty)`) and the `node_modules/.bin/tsc`
  presence in the same provenance block as observations, labelled as such.
- Create `test/recorded-verification-evidence.test.ts`, modelled on
  `test/recorded-implementation-response.test.ts`: it reads the fixture, asserts
  the `provenance` block names run, event time, capture date, what was dropped,
  target and commit, and asserts the log text contains the `Cannot find module`
  line. `test/harness-stream-fixtures.test.ts` does not cover this fixture: it
  reads one fixed recording (`harness-stream-json-envelope.json`) and tests the
  harness emitters.
- Verify: `node --test test/recorded-verification-evidence.test.ts`.
- Expected: it passes; remove the `Cannot find module` text from a scratch copy
  of the fixture and confirm the test fails. Nothing in the plan depends on the
  target's `.governance/` afterwards.

**Task completion evidence:** the fixture file is committed.

### Task 2: The baseline function and its paths

**Depends on:** Task 1

**Files:**
- Create: `src/baseline-verification.ts`
- Modify: `src/paths.ts` — add `baselineWorktreePath(rootDir, runId, attempt)`
  returning `.governance/worktrees/baseline-<runId>-<attempt>` (one path segment
  under `worktrees`, the same depth as `worktreePath`) and
  `baselineEvidenceDir(rootDir, runId, attempt)` returning
  `.governance/baseline/<runId>/<attempt>`, beside `verificationEvidenceDir`.

**Steps:**
- Read `src/profile.ts` around lines 33-40 and 91 and decide, from what the code
  says, how a null `startingCommit` reaches this function. The function refuses by
  name when it is null; it never skips.
- Implement `runBaselineVerification(store, { rootDir, runId, profile,
  acceptRed })` returning `{ ok: true } | { ok: false, reason }`: (a) return ok
  without work when the run already has a `baseline.verification.pass` or
  `baseline.verification.accepted_red` audit event; (b) choose `<attempt>` as the
  smallest integer from 1 for which neither `baselineWorktreePath` nor
  `baselineEvidenceDir` exists, never touching an existing one, then
  `git worktree add --detach <path> <startingCommit>`; if that fails, append a
  `baseline.verification.fail` event naming the git detail and refuse (no
  evidence directory is needed, and the next attempt number is free again only
  because the path was never created); (c) call `verifyCommit` with the frozen
  commands, the frozen policy values listed under Assumptions and that attempt's
  evidence directory; (d) write that attempt's `result.json` beside its logs, in
  the shape `verification-stage.ts` writes, and append
  `baseline.verification.pass` or `baseline.verification.fail` through
  `appendAudit` with `stageId: null`, an actor of `system`, and a summary naming
  the commit, the attempt, the command count, the relative evidence directory, the
  SHA-256 of `result.json` and, on failure, the blocking command; (e) on failure
  with `acceptRed`, also append `baseline.verification.accepted_red` naming the
  same attempt and return ok; (f) never call `setRunStatus`, delete a path, or
  retry.
- Verify: `npm run typecheck`.
- Expected: clean.

**Task completion evidence:** the module type-checks and no caller exists yet.

### Task 3: Hook the baseline into `advanceRun`

**Depends on:** Task 2

**Files:**
- Modify: `src/run-command.ts` — `advanceRun`, between the preview-comparison
  block and the `while (true)` loop.
- Modify: `src/operator-output.ts` — only if no existing `OperatorErrorCode`
  fits.
- Modify: `src/cli.ts` and `src/cli-args.ts` — the `--accept-red-baseline` flag on
  `run`, passed as `acceptRedBaseline` in `AdvanceRunOptions`; its help text.

**Steps:**
- Grep `src/audit.ts` and `src/operator-state.ts` for any restriction on action
  names before the first append, and record what was found in the commit message.
- Read `OperatorErrorCode` in `src/operator-output.ts`. Prefer an existing code.
  If one must be added, grep its consumers (`src/dashboard/app.js`, `src/cli.ts`,
  `test/operator-output.test.ts`) first and list them in the task notes.
- Read how `src/guided-command.ts` and the low-level `run` share a persisted run
  (guided matches by the project, feature, slug and change-kind tuple), and decide
  from the code whether a guided-created run can be continued with `buildworks run
  --run N --accept-red-baseline`. Word the refusal accordingly; do not name a
  command that does not work.
- Add the flag to `src/cli-args.ts` and `src/cli.ts`; grep `test` for tests that
  pin the `run` help text or option list and list them in the task notes.
- After the fingerprint comparison, call `runBaselineVerification` with
  `acceptRed: options.acceptRedBaseline === true`, then, **whether it returned ok
  or not**, re-observe with `readRunSnapshot(store, rootDir, runId, { ownedWriter:
  true })`. On `{ ok: false }` return `result("refused", <code>, reason)` from that
  fresh observation and do not enter the loop: `result()` reads `observed.snapshot`
  (`src/run-command.ts`, the `result` closure), and the pre-baseline snapshot would
  omit the event just persisted. On success the same re-observation means `before`
  is captured against the post-baseline fingerprint.
- Verify: `npm run typecheck` and `node --test test/run-command.test.ts
  test/cli-operator.test.ts`.
- Expected: typecheck clean; any test failure is investigated against Task 5's
  fixture inventory before it is changed.

**Task completion evidence:** the hook is the only edit in `src/run-command.ts`.

### Task 4: The consent preview names the step

**Depends on:** Task 3

**Files:**
- Modify: `src/operator-output.ts` — `formatRunPreview`.
- Modify: `test/operator-output.test.ts`

**Steps:**
- Add one paragraph to the preview: before the first dispatch the invocation runs
  the run's frozen verification commands against the starting commit in a
  throwaway worktree; it spends nothing; each command may take up to the frozen
  ceiling (read the number from `profile.policy.verifyCommandTimeoutSeconds`, do
  not hard-code 900); it runs once per run and is skipped when a previous
  invocation recorded a pass or an acceptance; a pass shows only that the commands
  run, not that the feature will work; a failing baseline refuses unless the
  invocation was given `--accept-red-baseline`, and that flag records the
  failure and proceeds.
- Verify: `node --test test/operator-output.test.ts`.
- Expected: the preview test pins the new paragraph, and the existing preview
  assertions still pass unchanged.

**Task completion evidence:** the paragraph appears in `run` output without
`--yes` and in the guided consent text.

### Task 5: Tests, including the break-it for every guard

**Depends on:** Task 3

**Files:**
- Modify: `test/run-command.test.ts`
- Create: `test/baseline-verification.test.ts`

**Steps:**
- First inventory the fixture targets used by `test/run-command.test.ts` and
  `test/cli-operator.test.ts`: list each `governed.yaml` verify command and state
  whether it passes in a fresh worktree. Change a fixture only when its commands
  cannot pass there, and say which and why.
- The fixture's one dependency is a committed script that walks up from its
  working directory looking for `node_modules/baseline-marker`, the way Node
  resolves a package. It fails when no ancestor has the marker. The marker belongs
  in the **main checkout's** ignored `node_modules`, which both a baseline worktree
  and the implementation worktree reach by walking up, because both sit directly
  under `.governance/worktrees/`. Never create the marker inside a worktree.
- Refusal test (calls `advanceRun`, marker absent): returns `refused`; the emitter
  is never invoked and no `agent_run` row exists (zero spend); run status is still
  `in_progress`; the audit chain holds one `baseline.verification.fail` event and
  verifies; the returned snapshot's last-activity fields name that event rather
  than the earlier one (finding 7: re-observation on the refusal path).
- Retry-after-repair test (calls `advanceRun`): create the marker in the main
  checkout, call again; the baseline passes in attempt 2 and the first group
  proceeds. Assert attempt 1's `<command>.log` and `result.json` are byte-identical
  to what the first call wrote (read and hash them before the retry), and that the
  attempt-1 event's recorded `result.json` hash still matches the file.
- Reproducibility test (hazard 6): after that pass, create a worktree at
  `worktreePath(rootDir, runId)` the way `implementation-stage.ts` does and run
  `verifyCommit` there with the same commands; it passes. Then repeat with a
  marker made only inside a baseline worktree: the baseline attempt that finds it
  must not be possible, because no attempt reuses a worktree (assert attempt
  numbers never repeat).
- Interrupted-attempt test: pre-create `baseline-<run>-1` as a worktree with
  generated untracked files and a modified tracked file. The next call chooses
  attempt 2, passes, and attempt 1's directory is untouched (same listing, same
  file hashes).
- Skip test (calls `runBaselineVerification` **directly**, not through
  `advanceRun`, which returns at the approval pause before the hook): two calls
  after a pass leave exactly one `baseline.verification.pass` event; the second
  makes no new worktree.
- Acceptance test (direct call, `acceptRed: true`, marker absent): returns ok;
  the chain holds `fail` then `accepted_red` for the same attempt; a following call
  without the flag also returns ok and adds no event; with `acceptRed` unset and
  no acceptance the same target refuses.
- Fingerprint test: a passing baseline followed by a full group boundary does not
  produce `observation_changed` or the `expectedBoundary` failure message.
- Null `startingCommit` test: refuses by name.
- Default-seeded test (hazard 11): the existing guided-mode fixture still
  completes a run.
- Break it, per the repo rule, in a scratch mirror or staged git, restoring after
  each: (a) delete the hook call and confirm the refusal test fails; (b) run the
  baseline in the main checkout instead of a worktree and confirm the marker
  tests fail; (c) delete the skip-on-pass check and confirm the skip test fails
  with two pass events (this is why it calls the function directly); (d) make the
  attempt chooser always return 1 and confirm the retry and interrupted-attempt
  tests fail; (e) re-observe only on success and confirm the refusal test's
  last-activity assertion fails. Report the five outcomes. Until then, report the
  tests as written, not verified.
- Verify: `node --test test/baseline-verification.test.ts test/run-command.test.ts
  test/cli-operator.test.ts test/operator-output.test.ts`, then the serial full
  suite, then `git log -1`.
- Expected: all pass; the full-suite known failures are the two recorded in the
  learnings (dashboard SIGTERM stderr warning; "nothing under src/ touches a
  private key") and any other failure is mine until shown otherwise.

**Task completion evidence:** the five break-it outcomes are written in the
commit message.

### Task 6: Free generalization checks

**Depends on:** Task 3

**Files:**
- Create: none in the repository. Scratch targets live in the scratchpad.

**Steps:**
- Check `pnpm --version` and `dotnet --version` on this host. If either is absent
  say so and stop that branch; do not claim the stack works.
- For each stack present, build a scratch repository with a committed
  `governed.yaml` and the smallest project that has a typecheck-like command.
  Create a run with the low-level `new-run` (free) and call
  `runBaselineVerification` **directly** from a scratch `.mjs` that opens the
  store, the way `test/baseline-verification.test.ts` does. Do not go through
  `buildworks run`: declining consent returns before the hook runs, and granting it
  continues from a passing baseline straight into a paid group. Record: whether the
  baseline passes from a clean checkout; what an uninstalled dependency looks like
  in the retained log; and whether anything outside `VERIFY_ENV_PASSTHROUGH` was
  needed.
- The Drizzle case is answerable only at a commit that carries an application.
  Team-notes `3b73c3d` has none (Known blockers), so the question "does `npm run
  build` pass in a fresh worktree without `.env` and `dev.db`" cannot be answered
  there and the table says "not tested" for it until the operator has a committed
  scaffold. Do not run it against a toy and call it the Drizzle result.
- Expected: a short table in this plan's Implementation note listing, per stack,
  pass, fail or not tested, with the evidence.

**Task completion evidence:** every cell in that table is measured or says "not
tested".

### Task 7: Documents

**Depends on:** Tasks 3 and 4

**Files:**
- Modify: `ARCHITECTURE.md` — section 7 Preconditions: one paragraph stating the
  baseline precondition, that it runs after consent and before any dispatch, that
  it records an audit event and no stage, that each attempt has its own retained
  worktree and evidence, and that a failure refuses without blocking unless the
  operator passes `--accept-red-baseline` for that invocation.
- Modify: `docs/hazards.md` — add entry 21, "An environment that can never pass
  verification is discovered after the spend", with the measured run 10 figures
  ($7.3048866, 16 dispatches, 2026-10-05) and the phased-implementation plan's
  earlier `[Unknown]` about worktree `node_modules` as the missed opportunity.
- Modify: `CLAUDE.md` and `AGENTS.md` identically, in the `run` command
  description; they must stay byte-identical.
- Modify: `README.md` and `docs/runbooks/cli-operator.md` — the run procedure.
- Modify: `.claude/skills/run-buildworks/SKILL.md` — the troubleshooting table:
  a baseline refusal, and the note that the low-level driver does not run it.
- Verify: `npm run check:docs`, `npm run typecheck`, and a byte comparison of
  `CLAUDE.md` against `AGENTS.md`.
- Expected: no new doc-check error; `CLAUDE.md` and `AGENTS.md` identical.

**Task completion evidence:** the checker is clean and the two instruction files
match.
