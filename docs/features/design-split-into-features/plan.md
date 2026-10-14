# Design Split Into Features Implementation Plan

**Status:** Implemented

**Goal:** When an approved specification declares more files than one run can safely build, BuildWorks proposes splitting the design into ordered features, the operator approves or denies that split through the existing spec-decision pause, an approved split ends the run with one exportable design per feature, and each later feature's run can be bound with `new-run --after` to the delivered commit of the feature before it.

**Source:** `docs/proposals/split-a-design-into-features.md` (mechanism B, which includes A) and `docs/proposals/build-in-segments-and-continue.md`, reviewed 2026-10-12. Operator decisions the same day, in answer to four questions: (1) "BuildWorks proposes": the split is proposed by a dispatch, checked by a validator and approved by the operator; this authorizes splitting a design into features, while `task_decomposition` (tasks as run rows) stays deferred; (2) "File count at spec review": the trigger is the number of declared files, compared with a frozen threshold; (3) "You merge it first": the operator merges each delivered feature before starting the next, and BuildWorks refuses to start a feature whose predecessor's delivered commit is not in the checkout; (4) "Shelve it, keep usage-limit work": `docs/features/implementation-segments-and-pause/plan.md` is shelved, `docs/features/usage-limit-refusal-summary/plan.md` stays as it is, and a pause on a usage-limit refusal stays a separate later decision. Mechanism 1 of `docs/proposals/toolchain-probe-and-stack-intent.md` (the spec and plan dispatches run in the target) is included because a later feature's spec author has to see the earlier feature's merged code.

**Assumptions:**
- **The split is a step inside `spec_review`, not a new stage.** It runs after the spec review gate passes and records an operator question on the review stage, the same kind of question the reconciler records. That keeps one decision path (`answerQuestion`, used by `bw decide`, guided mode and the dashboard's decision `POST`), so hard rule 2 gains no new write, and the stage sequence and the checker's pinned sequence stay unchanged. `task_decomposition`, meaning tasks as run rows (`ARCHITECTURE.md` section 14), stays deferred; section 5 records that this decision authorizes the design split only.
- **An approved split ends the run as `blocked`.** `RunStatus` is `in_progress`, `blocked` or `completed` (`src/store.ts` line 12, `src/migrations/001_init.sql`). `completed` would claim a delivery that never happened, and it would also satisfy the new `--after` check. A new status needs a migration. The plan blocks the run, with a reason that says the split was approved and names the stored features. Open decision 1 offers the new status instead.
- **Approve means split and deny means build as one.** `answerQuestion` stores the recommended option for `approve` and an empty answer for `deny`; the split question's recommended option is "Split". `modify` makes no sense for a split and is refused for this question only, in `answerQuestion`, so the CLI, guided mode and the dashboard all refuse it the same way.
- **Each feature is stored as a `proposal` row and reaches `docs/features/` through the two human steps of `ARCHITECTURE.md` section 14**: `bw proposal-export` writes it under `docs/proposals/`, and the operator moves it to `docs/features/<slug>/design.md` with `git mv`. A run never writes a design document. The rows are created only when the operator approves, so a denied split leaves no exportable features behind. Their text is rendered by BuildWorks from the reviewed specification, the validated split and the operator's recorded answers to the other questions at the same pause, never written by a model. The original design is named by its path, not copied: a feature run's spec stage treats its whole `design.md` as the governing text for grounding, so a copied original would let a feature's spec cite and add every other feature's requirements. Each proposal's route comes from `deriveRoute("upstream_blocking")` (`blocking_dependency`), as for every other proposal; these are the only proposals not created by a reconciliation decision, and `ARCHITECTURE.md` section 14 records that exception (Task 10).
- **The operator trims each exported file.** `proposal-export` writes a fixed wrapper around the stored text (`src/cli.ts`: an H1, `**Route:**`, `**Raised in:**`, `**Source finding id(s):**`, `**Evidence:**`, `## Problem`, `## Why this is upstream`). Before committing a feature's `design.md`, the operator deletes everything except the body under `## Problem`, and promotes that body's headings. The runbook says so (Task 10). No code changes the export.
- **The validator checks coverage and direction, not buildability.** It confirms every criterion is placed once, every file is placed, and each piece depends only on earlier pieces. It cannot tell whether a piece's criteria need code that a later piece writes. The operator is the only check on order, and the question text says so.
- **A feature can be split again.** A feature run whose own spec declares more files than the threshold gets its own split proposal, like any run. Its slugs are checked against the target's `docs/features/` directories as usual. The plan adds nothing for nested splits.
- **The threshold is 43 declared files.** The run's frozen ceiling is 80 plan task items (`IMPLEMENTATION_PHASE_TASKS` 10 times `IMPLEMENTATION_MAX_PHASES` 8, `src/policy.ts`). The five recorded runs that have both a signed scope and a plan produced 1.0 to 1.84 plan items per declared file (crew-chatter runs 2, 3 and 4: 51 to 51, 52 to 52, 62 to 86; team-notes runs 6 and 12: 31 to 57, 40 to 53; `.claude/sessions/project-learnings.md`, 2026-10-10). 80 divided by 1.84 is 43.48, so 43. The figure is an inference from five runs of two test designs. Task 1 copies the evidence into the repository and pins the constant to it. The split proposal's own 2.9 ratio counts files changed in a diff, not declared files, so it is not used.
- **A split dispatch failure is terminal**, like every other failure in the spec group (`ARCHITECTURE.md` section 19). It blocks the run after the spec group has spent; nothing retries.
- **`--after` is a low-level `new-run` option only.** Guided mode does not take it in this plan (open decision 3).

**Approach:** Run the spec, plan and decision dispatches in the target repository. Add one frozen policy value, the split threshold. Add `src/design-split.ts`: the split's shape, a strict validator, the question text and the rendered feature design. When the spec review gate passes and the reviewed spec declares more files than the threshold, dispatch the spec author once with a new split prompt. Validate the reply against the reviewed spec. Retain it as evidence, and record it as a finding with an `upstream_blocking` decision and an operator question. The run then pauses at `awaiting_decision` through the existing branch. In the decision group, an approved split creates one proposal row per feature, carrying the operator's other answers into each, and ends the run; a denied split is left out of the fold and the run goes on as before. Add `--after <run-id>` to `new-run`. Before the run row exists, it reads the earlier run through `readRunSnapshot`, the same verified reading `status` uses, and refuses unless that run is completed with a verified delivered commit that is an ancestor of the new starting commit. It freezes the link into the profile. Update the consent preview, the documents, and the record of which plans are shelved.

**Affected areas:** `src/spec-stage.ts`, `src/plan-stage.ts`, `src/spec-decision-stage.ts`, `src/prompts.ts`, `src/policy.ts`, `src/profile.ts`, `src/run-intake.ts`, `src/cli.ts`, `src/cli-args.ts`, `src/agents/spec-author.ts`, `src/readiness.ts`, `src/operator-output.ts`; new `src/design-split.ts`; `test/fixtures/harness/emit-spec-stage.mjs` and `test/fixtures/harness/emit-plan-stage.mjs`; tests named per task; two new recorded fixtures; `ARCHITECTURE.md`, `docs/hazards.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/runbooks/cli-operator.md`, `docs/proposals/split-a-design-into-features.md`, `docs/features/implementation-segments-and-pause/plan.md`, `.claude/sessions/project-learnings.md`.

**Known blockers:**
- **[Verified]** An approved split leaves the original run's `docs/features/<slug>/spec.md` untracked in the target. `writeSpecDoc` writes it into the checkout, and run intake refuses a dirty tree (`checkIntakeRepository`, `src/readiness.ts`). The first feature's `new-run` therefore refuses until the operator commits or moves that file. The project learnings record the same trap after a blocked spec review. The approval message and the runbook must say so (Tasks 7 and 10).
- **[Verified]** Squash merges break the hand-off. `git merge-base --is-ancestor` fails when the delivered branch was squash-merged, because the delivered commit is then not in the checkout's history. The runbook must say to merge or fast-forward (Task 10).
- **[Verified]** Changing the policy shape (Task 3) and the profile shape (Task 8) makes every earlier run's frozen profile unusable by name (`invalidPolicyReason`, `invalidProfileReason` in `src/profile.ts`; hard rule 3). `status` still reads those runs with a limitation line. No live run needs to continue: crew-chatter run 4 is unbuildable, and run 3 and team-notes run 12 are blocked.
- **[Verified]** `test/fixtures/harness/emit-spec-stage.mjs` routes by prompt text in the order `self-critique`, `spec reviewer`, `reconcile`, `Operator answers to fold:`, `spec author` (lines 338 to 385). The split prompt must contain none of those substrings, and its route must be checked first.
- **[Verified]** Crew-chatter run 4's spec and plan exist only in the target, untracked: *docs/features/crew-chatter/spec.md* and *plan.md* in `C:\Users\Shawn-work\repositories\testing-repos\crew-chatter`. Task 1 copies them in after a hash check against the gate events.
- **[Verified]** Four recorded fixtures are still uncommitted (`git status` at session start). This plan adds two more. Commit fixtures together with, or before, the code that depends on them.
- **[Verified]** The last full suite run, at `fd756a7`, was 1414 tests: 1408 pass, 0 fail, 6 skipped. Compare against zero failures.
- **[Verified]** Each feature's design names the original design by path, so the original *docs/features/&lt;originalSlug&gt;/design.md* must stay committed in the target. The runbook must say not to delete or move it (Task 10).
- **[Verified]** With the target as the working directory, a spec or plan dispatch can read `.governance/`, including earlier runs' retained raw outputs. The executor allows only `Read`, `Glob` and `Grep`, but nothing restricts their paths: the sandbox's `deniedPaths` (`src/executor.ts`) is declared and read by no code. **[Inference]** `Grep` honors `.gitignore`, so a dispatch is unlikely to find those files without a direct read. Not changed here.
- **[Verified]** Guided mode turns any `answerQuestion` refusal into exit 3 (`decisionHandoff`, `src/guided-command.ts`). An operator who picks modify on the split question leaves the session and is offered modify again on the next invocation. The runbook states this (Task 10); guided mode is not changed.
- **[Verified]** `status` suggests `proposal-export` with a name derived from the proposal title (`src/operator-state.ts`), while the split's message names `--name <slug>`. The runbook says to use the slug.
- **[Unknown]** Whether a feature's spec author builds only its own criteria when it can open the original design by path. The free tests cannot show this; the first paid pair can.
- **[Unknown]** Whether the dashboard renders a split question usefully beyond its generic question card. Its modify box will be refused for this question. Not looked at in a browser.

**Blast radius:** (evidence: Grep over `src` and `test`, 2026-10-12)
- `answerQuestion` has four callers: `src/cli.ts` (`decide`), `src/dashboard-decision.ts`, `src/guided-command.ts` (`decisionHandoff`), and the function's own tests. The new refusal adds a reason string and changes no signature.
- `runSpecStage`: its result type is unchanged. A split pauses the run through the existing `questions.length > 0` branch, which `src/operator-state.ts` already reads as `awaiting_decision`.
- `runSpecDecisionStage`: its result type is unchanged. On an approved split it returns `ok: false` with the split reason after blocking the stage and the run, the same shape as any other decision failure, so `src/run-command.ts` and the `decide`/`run` CLI paths report it as blocked (exit 1).
- `dispatchOnce` call sites that gain `invocation: { cwd: rootDir }`: 4 in `src/spec-stage.ts`, 4 in `src/plan-stage.ts`, 1 in `src/spec-decision-stage.ts`, and the new split dispatch. Implementation and code review already pass a worktree `cwd` and are untouched. The split dispatch records on the spec stage, like the author, self-critique and reconcile dispatches (`src/spec-stage.ts`), so the review stage's `agent_run` rows stay reviewer seats.
- `SPEC_AUTHOR.outputs` gains `spec-split`. Readers are `src/readiness.ts` (`author_bindings`, line 236) and every capability check in the spec stages.
- `Policy` gains `designSplitPathThreshold`. Readers are `buildPolicy`, `POSITIVE_INT_FIELDS`, `invalidPolicyReason` and `test/policy.test.ts`. `Profile` gains `after`, read by `invalidProfileReason`, `freezeProfile` and `test/profile.test.ts`.
- `createRunIntake` has two callers: `src/cli.ts` (`new-run`) and guided intake in `src/guided-command.ts`. The new input field is optional, and guided mode passes nothing.
- `readRunSnapshot` (`src/operator-state.ts`) gains one caller, `createRunIntake`, and is not modified. It already derives `delivery.deliveredCommit` only after it cross-checks the retained delivery record, the final reviewed commit, the approved scope, the stage status and the `delivery.gate.pass` summary. The delivery stage and its summary format are untouched.
- Tests that state the old spec ceiling: `test/cli-operator.test.ts` line 1714 and `test/run-command.test.ts` line 177 (`2 + specReviewRounds * (panelSizeMax + 1)`). The sentence "Your working directory may not be the target repository." is pinned at `test/prompts.test.ts` line 108.
- Persisted formats: three new audit actions (`spec.split.record`, `spec_decision.split.approve`, `spec_decision.split.blocked`), one finding intent key (`design-split`), proposal rows created by the decision group, one evidence file per run (*.governance/proposals/&lt;run&gt;/split.json*), and one profile field. No migration.
- Not touched: the plan, implementation, verification, code-review and delivery stages beyond the `cwd` change above; `proposal-export`; guided mode; the approval gate; the store schema; the dashboard's code.

**Verification:** Component: the validator accepts a split derived from crew-chatter run 4's recorded spec and refuses each defect; the spec stage proposes and records a split only above the frozen threshold; the decision group stores the features and ends the run on approve, and folds normally on deny; `new-run --after` refuses each broken link before a run row exists. End to end, as far as free commands reach: with the stand-in executor and a low frozen threshold, `bw run` pauses at the split question, `bw decide --approve` followed by `bw run` ends the run with stored features, and `bw proposal-export` writes a feature's design. In a scratch repository, a completed run's delivered commit merged into the checkout lets `new-run --after` freeze the link. Regression: the focused files per task, `npm run typecheck`, `npm run check:docs`, the full serial suite against zero failures, and the free smoke. A green result does not show that a real model proposes a usable split, that a feature's spec author stays inside its criteria, or that two real chained runs deliver. That needs one paid pair, which is a separate decision.

**Hazards considered:**
- **Hazard 18** (delivery proven, correctness never inspected): the review prompt's 1 MiB ceiling is the reason a large design cannot be one run. Splitting keeps each feature reviewable by the unchanged panel. Nothing here reviews less.
- **Hazard 20** (one dispatch over a plan larger than one response): smaller features mean smaller plans, and the phase size and ceiling are unchanged. The split reply carries IDs and paths only, not prose, so it is far smaller than a plan.
- **Hazard 3** (a constrained field must have its constraint stated in the prompt): the split prompt states every rule the validator enforces, with the computed numbers (the threshold, the criterion IDs, the declared files, the slugs in use). Its example must itself validate, which Task 5 tests.
- **Hazard 4** (fixtures and code agreeing while both are wrong): the validator's inputs come from crew-chatter run 4's recorded spec. Test splits are derived from that spec mechanically, not written by hand. The threshold test reads the recorded ratios. The stand-in emitter derives its split from the spec in its prompt.
- **Hazard 6** (promises a later stage cannot keep): the question text says the threshold is an estimate from five runs, that a denied split may still be refused at the plan ceiling, and that the operator alone checks the order. No message claims a feature will fit. The new working-directory sentence (Task 2) claims the target's working tree, not a commit, because nothing keeps the checkout at the starting commit during a pause.
- **Hazard 13** (specifications inventing obligations): the rendered feature design copies criterion text verbatim and adds no requirement. The original design is named by path and never copied, so a feature's spec cannot ground a requirement in another feature's text. Whether the next spec author stays inside its criteria is listed under Unknown.
- **Hazard 14** (independence that cannot be proven): the split is a model proposal and the operator decides. Answers are audited as human decisions, as today. An approved split carries the operator's other answers into every feature verbatim, so no recorded human decision is dropped. An independent review of the build is offered at the end (Task 11).
- **Hazard 2** (discarded output is undiagnosable): `dispatchOnce` retains the raw reply before parsing. The validated split is written to its evidence file before any row refers to it, and its hash is in the audit event.
- **Hazard 7** (retries that vary nothing): no retry is added. A failed split blocks the run.
- **Hazard 21** (agents are never told the gate that will judge their work): Task 2 corrects the spec prompt's statement about the working directory, which becomes false once the dispatches run in the target.
- **Hard rules 2, 3, 4 and 6:** the dashboard gains no write; the policy and profile each gain one field, and earlier shapes are refused by name; there is one split format with one validator and one renderer, and no decomposition framework; the threshold and the `--after` link are frozen at run start.
- **Hazards 1, 5, 8 to 12, 15 to 17 and 19:** not design inputs. No output extraction, delivery rule, executable resolution, hook, model alias, default installation, sandbox, remediation loop, normative-node accounting or idle budget changes.

## Replay against the motivating failures

- **Crew-chatter run 4 (2026-10-10):** 62 declared files and 86 plan items, refused by the frozen 80-item ceiling after $4.94. Under this plan, 62 is over 43, so the split is proposed after spec review, before approval and before the plan's roughly $3.21. Task 3 checks that its recorded declared count exceeds the threshold, Task 4 runs the validator on its recorded spec, and Task 5 builds the split prompt from it. Task 6 tests the trigger's comparison on the stand-in emitter's spec, not on run 4's.
- **Crew-chatter runs 2 and 3:** 51 and 52 declared files, which built as 51 and 52 items and fit. Both would trigger a split proposal. These are the false positives the operator accepted. The operator can deny the split and continue.
- **Team-notes runs 6 and 12:** 31 and 40 declared files. No trigger. Both fit by item count.
- **A design past the review-prompt wall** (roughly 130 to 160 items, not a recorded case): split into features of at most 43 declared files each, each reviewed whole.
- **Runs 8, 9, crew-chatter 2 and 3** (one failed step strands a run): not changed. Smaller features lose less per failure; nothing resumes. The usage-limit summary plan and the phase-retry plan stay separate.

## Tasks

### Task 1: Copy the sizing evidence and crew-chatter run 4's spec into the repository

**Depends on:** None

**Files:**
- Create: *test/fixtures/recorded/spec-crew-chatter-run-4.json*
- Create: *test/fixtures/recorded/declared-paths-vs-plan-items.json*
- Create: *test/design-split-evidence.test.ts*

**Steps:**
- Read `test/fixtures/recorded/plan-crew-chatter-run-2.json` (its `provenance` keys) and `test/recorded-plan-task-items.test.ts` to the end, so the new fixtures follow their shape.
- Crew-chatter run 4's spec: read the target file *docs/features/crew-chatter/spec.md* read-only. Open the target's `.governance/state.db` read-only through a scratch `.mjs` that imports `openDatabase` from `src/sqlite.ts` by `file:///` URL (never a direct `node:sqlite` import). Find run 4's last `spec_decision.gate.pass` event and its `specHash`. The file's SHA-256 over `normalizeText` must equal that hash before anything is written; if not, stop and report. Also read the run 4 plan, check it against run 4's `plan.gate.pass` `planHash`, and record its top-level task item count as `validatePlanDoc(...).value.taskItems.length` (`src/plan-doc.ts`; the count the implementation stage uses). Write *spec-crew-chatter-run-4.json* with `provenance` (run, target path, gate event ids and text, `specHash`, `planHash`, declared file count from `readSpecDeclaredArtifacts`, criterion count, plan item count, capture date) and `specMarkdown` verbatim.
- The ratio evidence: for crew-chatter runs 2, 3 and 4 and team-notes runs 6 and 12, read each run's approval `scope` (the signed declared files; `src/migrations/004_approval.sql`) and the item count of the plan that passed its `plan.gate.pass`. Use the committed plan fixtures where they exist (`plan-crew-chatter-run-2.json`, `plan-team-notes-run-6.json`, `plan-team-notes-run-12.json`) and the target files and stores otherwise. Write *declared-paths-vs-plan-items.json* as `{ provenance, runs: [{ target, run, declaredPaths, planItems, source }] }`. A run whose source no longer exists is recorded with `source: "not recoverable"` and its learnings figure, and the task evidence says so.
- *test/design-split-evidence.test.ts*: (a) the run 4 spec fixture validates with `validateSpecDoc`, its hash equals `provenance.specHash`, and its declared file count equals `provenance.declaredPaths`; (b) for every recoverable run in the ratio fixture, `planItems / declaredPaths` is at most 1.84, and the maximum ratio across them is 1.84 as recorded for team-notes run 6. If the measured maximum differs from 1.84, stop and report: Task 3's threshold is derived from it.
- Break it: edit one byte of `specMarkdown` in a scratch copy and point the test at it; (a) must fail. Restore.
- Verify: `node --test --test-reporter=tap test/design-split-evidence.test.ts`
- Expected: all pass, and the break fails (a).

**Task completion evidence:** the two hash comparisons, the five rows with their sources, and the TAP counts.

### Task 2: The spec, plan and decision dispatches run in the target

**Depends on:** None

**Files:**
- Modify: `src/spec-stage.ts`, `src/plan-stage.ts`, `src/spec-decision-stage.ts` — each `dispatchOnce` call.
- Modify: `src/prompts.ts` — `specVerificationRule` and its comment.
- Modify: `test/fixtures/harness/emit-spec-stage.mjs`, `test/fixtures/harness/emit-plan-stage.mjs` — report the working directory when asked.
- Modify: `test/prompts.test.ts`, `test/spec-stage.test.ts`, `test/plan-stage.test.ts`.

**Steps:**
- Read all three stage files, `src/prompts.ts` from `specVerificationRule` through its callers, `src/harness.ts` (`invokeHarness` passes `input.cwd` to `spawn`; the child's environment is filtered by `buildHarnessEnvironment`, so an environment variable cannot carry the answer), both emitters and the three test files to the end before editing.
- Add `invocation: { cwd: rootDir }` to the four `dispatchOnce` inputs in `src/spec-stage.ts`, the four in `src/plan-stage.ts` and the one in `src/spec-decision-stage.ts`. `rootDir` is the target root these stages already read the design from.
- In `specVerificationRule`, replace "Your working directory may not be the target repository." with "Your working directory is the target repository's working tree; read what each command runs there." Do not name a commit: the operator can commit while the run waits at a decision or approval pause. Rewrite the comment above it: it now says the spec dispatches run in the target. Keep the "Treat a file as evidence..." sentence, because the operator's uncommitted files are also visible.
- Tests: in `test/prompts.test.ts`, replace the pinned sentence at line 108 with the new one. In `test/spec-stage.test.ts`, add a test whose design carries the marker `FIXTURE-REPORT-CWD`. In `test/plan-stage.test.ts`, put the marker in the spec text the test seeds, because plan prompts carry the spec and never the design (`buildPlanAuthorPrompt`). When the prompt contains that marker, both emitters write `cwd=<process.cwd()>` as one line to stderr, and `dispatchOnce` retains that line in the run's raw output. The marker keeps every other test's raw output unchanged. Assert that every `cwd=` line in the run's retained raw files names the target root, and that there is one per dispatch of the stage. Compare with `realpathSync` on both sides, because Windows temp paths can differ in short and long form.
- Break it: drop `cwd` from the spec author's dispatch only; the spec-stage test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/prompts.test.ts test/spec-stage.test.ts test/plan-stage.test.ts test/spec-decision-stage.test.ts`
- Expected: all pass, and the break fails the named test.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 3: The frozen split threshold

**Depends on:** Task 1

**Files:**
- Modify: `src/policy.ts` — add `DESIGN_SPLIT_PATH_THRESHOLD`, the `Policy` field, `buildPolicy`, `POSITIVE_INT_FIELDS`.
- Modify: `test/policy.test.ts`, `test/design-split-evidence.test.ts`.

**Steps:**
- Read both files to the end before editing.
- `export const DESIGN_SPLIT_PATH_THRESHOLD = 43;` with a comment stating the derivation: a spec declaring more files than this gets a split proposal; 43 is the frozen 80-item ceiling divided by the highest recorded ratio of plan items to declared files (1.84, team-notes run 6, *test/fixtures/recorded/declared-paths-vs-plan-items.json*), rounded down; five runs of two test designs; it is an estimate, so a denied split may still be refused at the plan ceiling. Add `designSplitPathThreshold: number` to `Policy`, set it in `buildPolicy`, and add it to `POSITIVE_INT_FIELDS`.
- `test/policy.test.ts`: extend the "enforcing module" and hash-change tests with the field; add a "missing designSplitPathThreshold" refusal test; add the field to the positive-integer test's list; add the constant to the `FROZEN_ONLY` source-scan list (line 336) so no stage reads the live constant.
- `test/design-split-evidence.test.ts`: (c) `DESIGN_SPLIT_PATH_THRESHOLD === Math.floor(IMPLEMENTATION_PHASE_TASKS * IMPLEMENTATION_MAX_PHASES / maxRatio)`, where `maxRatio` is computed from the fixture rows, not typed in; (d) the run 4 spec fixture's `provenance.declaredPaths` is greater than `DESIGN_SPLIT_PATH_THRESHOLD`, so the motivating run would have been asked.
- Break it, restoring after each: (1) set the constant to 44 and (c) must fail; (2) remove the field from `POSITIVE_INT_FIELDS` and the positive-integer test must fail.
- Verify: `node --test --test-reporter=tap test/policy.test.ts test/design-split-evidence.test.ts`
- Expected: all pass and each break fails the named test. Any other test that compares a whole frozen policy may fail until it is updated. List each one in the evidence and update only its expected field list.

**Task completion evidence:** TAP counts and the two break-it outcomes.

### Task 4: The split format, validator, question and rendered feature design

**Depends on:** Tasks 1 and 3

**Files:**
- Create: `src/design-split.ts`
- Create: *test/design-split.test.ts*

**Steps:**
- Read `src/spec-doc.ts`, `src/scope.ts` (`computeScope`, `normalizePath`), `src/proposal.ts` and the `proposal-export` case in `src/cli.ts` (its kebab-name rule) to the end before writing.
- Types: `DesignSplitPiece { slug: string; title: string; criteria: string[]; declaredArtifacts: string[]; dependsOn: number[] }` and `DesignSplit { pieces: DesignSplitPiece[]; rationale: string }`. `dependsOn` holds 1-based indexes of earlier pieces.
- `DESIGN_SPLIT_INTENT = "design-split"` and `DESIGN_SPLIT_LOCATION = \`${upstreamPrefixFor("design")}split\`` (import from `src/reconciliation.ts`; confirm that `validateReviewerReports` accepts the location shape, as it does for the disclosed open decisions).
- `validateDesignSplit(value: unknown, ctx: { spec: SpecDoc; runSlug: string; slugsInUse: readonly string[]; maxPathsPerPiece: number }): { ok: true; value: DesignSplit } | { ok: false; reason: string }`. It is strict, refuses unknown keys at both levels, and names the first rule broken:
  - at least 2 pieces;
  - each `slug` matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`, is distinct, is not `runSlug` and is not in `slugsInUse`;
  - each `title` is a non-empty single line;
  - each piece has at least one criterion and one declared file;
  - every criterion ID is one of `spec.acceptanceCriteria`, and every criterion of the spec appears in exactly one piece (name the missing and the repeated IDs);
  - every declared file, compared by `normalizePath`, is one of the spec's declared files; every spec file appears in at least one piece; a file may appear in several pieces;
  - `computeScope(piece.declaredArtifacts).length <= maxPathsPerPiece`;
  - every `dependsOn` entry is an integer from 1 to the piece's own index minus 1, with no repeats;
  - `rationale` is a non-empty string.
- `splitQuestionText(split, threshold, declaredCount): string` and `SPLIT_OPTIONS = [{ label: "Split", answer: "split the design into the features listed" }, { label: "Build as one", answer: "build the design as one run" }]`, recommended 0. The text lists each feature as `k. <slug>: <title> (<n> criteria, <m> files; builds on <list or nothing>)`. It then says the spec declares `declaredCount` files against a threshold of `threshold`, an estimate from five recorded runs; that the check confirms coverage and direction only, so the operator decides whether each feature can be built before the ones after it; that approve stores one design per feature and ends this run; that deny builds the design as one run, which may still be refused at the plan ceiling; and that modify is not accepted for this question. `SPLIT_WHY(threshold, declaredCount)` returns the question's `why`: "The reviewed specification declares <declaredCount> files. Above <threshold>, one run is estimated to need more than the 80 plan items a run can build."
- `renderPieceDesign(input: { originalSlug: string; runId: number; spec: SpecDoc; split: DesignSplit; index: number; decisions: { question: string; action: string; answer: string }[] }): string`. It takes no design text: the original is named, never copied. Deterministic Markdown in this order: a first paragraph saying the feature is piece k of n of *docs/features/&lt;originalSlug&gt;/design.md*, split by run N, and that only the criteria below are to be built; `## Builds on` (the earlier pieces by slug and title, or "Nothing: this is the first feature."); `## Acceptance criteria for this feature` (each `- AC-NNN: <text>` copied verbatim from the spec); `## Files this feature is expected to change`; `## Criteria other features build` (each ID and its piece slug, so the author can see what to leave alone); `## Decisions already made` (for each entry in `decisions`, in order: the question text verbatim, then "Answer: " and the answer verbatim, or "Left open by the operator." for `deny`; the section is omitted when `decisions` is empty); `## Original design` (one paragraph: the full design this feature was split from is *docs/features/&lt;originalSlug&gt;/design.md* in this repository; read it for shared context; it states no requirement for this feature).
- Tests in *test/design-split.test.ts*, with the spec taken from *spec-crew-chatter-run-4.json*. `derivedSplit(spec, k)` assigns the criteria in order to k contiguous groups and the declared files in order to k contiguous groups, with `dependsOn` `[i-1]` for each later piece. It is a function of the recorded spec, not a hand-written answer.
  - (a) `derivedSplit(spec, 2)` validates with `maxPathsPerPiece` 43 (62 files give 31 per piece).
  - (b) Each of these, applied to (a)'s split, is refused with a reason naming the rule: drop one criterion; repeat a criterion in both pieces; add an unknown `AC-999`; drop the only copy of one file; add a file not in the spec; one piece; a slug equal to the run slug; a slug in `slugsInUse`; two equal slugs; an uppercase slug; `dependsOn [2]` on piece 1; `dependsOn [1, 1]`; an extra key; a piece with no criteria.
  - (c) With `maxPathsPerPiece` 30, (a)'s split is refused for size, naming the piece and the count 31.
  - (d) A file listed in both pieces is accepted.
  - (e) `renderPieceDesign` for piece 2 contains every criterion line of piece 2 exactly as it appears in the spec, contains no criterion line of piece 1 outside the "Criteria other features build" section, names piece 1 under "Builds on", and names the original design's path. With two `decisions` (one `approve`, one `deny`), it contains each question and the approved answer verbatim and "Left open by the operator." once; with none, it has no `## Decisions already made` heading. It contains no heading other than the six listed, so nothing from an original design can appear at heading level.
  - (f) `splitQuestionText` names both slugs, `62`, `43` and the words "may still be refused" and "the operator decides"; `SPLIT_WHY(43, 62)` contains `62` and `43`.
- Break it, restoring after each: (1) allow a criterion in two pieces and (b)'s repeat case must fail; (2) compare paths without `normalizePath` and a case using `./frontend/x` must fail (add that case); (3) let `dependsOn` reach its own index and (b)'s forward case must fail; (4) count raw paths instead of `computeScope` and add a duplicate-path case that must then fail.
- Verify: `node --test --test-reporter=tap test/design-split.test.ts`
- Expected: all pass and each break fails its case.

**Task completion evidence:** TAP counts and the four break-it outcomes.

### Task 5: The split prompt and the author's new output

**Depends on:** Task 4

**Files:**
- Modify: `src/prompts.ts` — add `buildDesignSplitPrompt`.
- Modify: `src/agents/spec-author.ts` — `outputs` gains `spec-split`.
- Modify: `src/readiness.ts` — `author_bindings` requires `spec-split` for `spec-author`.
- Modify: `test/prompts.test.ts`, `test/doctor-diagnostics.test.ts` (or wherever `author_bindings` is tested; find it with Grep).

**Steps:**
- Read `src/prompts.ts` from `buildSpecAuthorPrompt` through `buildSpecReconcilePrompt`, and the AgentResult contract it states, to the end. Read `src/readiness.ts` around line 236 and its tests.
- `buildDesignSplitPrompt(author, design, specContent, ctx: { threshold: number; declaredCount: number; slugsInUse: string[]; runSlug: string })`. It opens with "You are dividing an approved specification into separately built features." It states that the spec declares `declaredCount` files and that each feature may declare at most `threshold`; lists every rule `validateDesignSplit` enforces, in the same order and with the same numbers; lists the slugs in use and the run slug as forbidden; asks for the AgentResult JSON with `status: "proposed"` and `proposedContentChanges.split` holding `{ pieces, rationale }`; and asks that features be ordered so each builds on earlier ones only. It includes the JSON-escaping instruction the other prompts carry. It includes one literal example split, for a spec with criteria `AC-001` and `AC-002` and declared files *src/a.ts* and *src/b.ts*, and says so in the prompt. The test builds that spec with `validateSpecDoc` and checks that the example passes `validateDesignSplit` against it (an advertised example must itself validate). It must not contain the substrings `self-critique`, `spec reviewer`, `reconcile` or `spec author`.
- Tests: the prompt for crew-chatter run 4's spec contains `62`, `43`, every criterion ID and every declared file; the example object in the prompt is extracted and passes `validateDesignSplit` against its two-criterion spec; none of the four routing substrings appear; a missing `spec-split` output fails `author_bindings` with the existing message shape.
- Break it: change the stated per-feature limit to a literal `40` and the prompt test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/prompts.test.ts test/doctor-diagnostics.test.ts test/design-split.test.ts`
- Expected: all pass and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 6: The spec stage proposes and records the split

**Depends on:** Tasks 2, 3, 4 and 5

**Files:**
- Modify: `src/spec-stage.ts` — after the gate passes.
- Modify: `test/fixtures/harness/emit-spec-stage.mjs` — a split route and its modes.
- Modify: `test/spec-stage.test.ts`.

**Steps:**
- Read `src/spec-stage.ts`, `src/store.ts` (`upsertCanonicalFinding`, `insertFindingReport`, `insertFindingDecision`, `insertDecisionQuestion`), `src/proposal.ts` (`writeProposalEvidence` and `proposalEvidenceDir`), the emitter and `test/spec-stage.test.ts` to the end before editing.
- Before writing, Grep `src/` (including `src/dashboard/dashboard-model.js` and `src/operator-state.ts`) for readers of `finding_decision` rows. Look for code that assumes an `upstream_blocking` decision has a linked proposal or a non-null `grounding`. Every reconciler-made `upstream_blocking` decision has both today; the split decision will have neither. If such a reader exists, stop and report it with the line, rather than inventing a proposal or grounding to satisfy it.
- In `runSpecStage`, beside the existing `spec-self-critique` and `spec-reconciliation` capability checks and before the author's first dispatch, abort the spec stage with `spec.split.failed` if the author lacks `spec-split` output, so a misconfigured profile refuses before any spend. The split dispatch uses the already-resolved `authorSettings`.
- In `runSpecStage`, inside `if (gate.pass)` and before the `spec.gate.pass` audit: `const declaredCount = computeScope(written.doc.declaredArtifacts).length`. If it is greater than `profile.policy.designSplitPathThreshold`:
  - List `slugsInUse` as the directory names under the target's `docs/features/`.
  - Dispatch the author once on the spec stage (`stageId: specStage.id`, as the self-critique and reconcile dispatches do) under the author's own setting, with `invocation: { cwd: rootDir }`, using `buildDesignSplitPrompt`. On a failed dispatch, abort with `spec.split.failed`. On a refused body, an invalid AgentResult, a status other than `proposed`, a missing `split`, or `validateDesignSplit` refusing, abort with `spec.split.invalid` and the reason.
  - On success, write the evidence `{ split, specHash, declaredCount, threshold }` to `split.json` in `proposalEvidenceDir(rootDir, runId)` before any row. Insert a canonical finding on the review stage (round `rounds`, the last round the stage ran; `DESIGN_SPLIT_INTENT`; `DESIGN_SPLIT_LOCATION`). Insert a report from the split dispatch's `agent_run` (severity `high`, classification `upstream`, subject `design split into <n> features`). Insert a decision (disposition `upstream_blocking`, rationale the split's rationale, `changedLocations` empty, `grounding` and `normativeChanges` null, both hashes the reviewed spec's hash). Insert a question with `splitQuestionText`, `SPLIT_OPTIONS`, recommended 0, and `SPLIT_WHY(threshold, declaredCount)` as its `why`. Append `spec.split.record` with `pieces=<n>; declared=<count>; threshold=<t>; evidence=<ref>; evidenceHash=<sha256 of the file>`.
  - Then re-read `questions` so the existing `questions.length > 0` branch pauses the run at `awaiting_decision`. The gate decision itself is not recomputed: the split decision carries a question, so it cannot block.
- The emitter: before the `self-critique` route, `stdin.includes("You are dividing an approved specification")` routes to a split reply derived from the spec in the prompt. It parses the criterion IDs and declared files from the prompt's spec text and splits them into two contiguous halves, the same rule as Task 4's `derivedSplit`. Markers in the design select failure modes: `FIXTURE-SPLIT-DROP-CRITERION`, `FIXTURE-SPLIT-BACKWARD`, `FIXTURE-SPLIT-NOT-JSON`.
- Tests use a local `freezePolicyValues` helper copied from `test/implementation-stage.test.ts` line 990. Freeze `designSplitPathThreshold` at a value below the base spec's declared file count (count it from the emitter's `BASE_SPEC` in the test; a value no default produces):
  - (a) the split is proposed: one more `agent_run` than a run without it, one `spec.split.record` event, a question whose text names both derived slugs, the evidence file present with its hash matching the event, the result `specDecision: null`, and the operator state `awaiting_decision`;
  - (b) at the default threshold, the base spec gets no split: same `agent_run` count as today, no event, and the `spec_decision` row created as today;
  - (c) a threshold exactly equal to the declared count gets no split, because the comparison is strictly greater;
  - (d) each of the three failure markers blocks the review stage and the run with the matching action, and leaves no finding with `DESIGN_SPLIT_INTENT`;
  - (e) a run whose spec review gate blocks never dispatches the split;
  - (f) a frozen author without `spec-split` output aborts with `spec.split.failed` and zero `agent_run` rows;
  - (g) the split dispatch's `agent_run` row is on the spec stage, and every `agent_run` row on the review stage is a reviewer.
- Break it, restoring after each: (1) use `>=` and (c) must fail; (2) skip `validateDesignSplit` and (d)'s drop-criterion case must fail; (3) dispatch before the gate check and (e) must fail; (4) read the live constant instead of the profile and (a) must fail; (5) move the capability check to just before the split dispatch and (f) must fail.
- Verify: `node --test --test-reporter=tap test/spec-stage.test.ts test/design-split.test.ts`
- Expected: all pass, every existing spec-stage test unchanged, and each break fails its case.

**Task completion evidence:** TAP counts and the five break-it outcomes.

### Task 7: The decision group stores the features on approve and builds as one on deny

**Depends on:** Task 6

**Files:**
- Modify: `src/spec-decision-stage.ts` — `answerQuestion` and `runSpecDecisionStage`.
- Modify: `test/spec-decision-stage.test.ts`, `test/cli-operator.test.ts`.

**Steps:**
- Read `src/spec-decision-stage.ts`, `src/store.ts` (`upsertProposal`, `getCanonicalFinding`, `getDecisionAnswers`), `src/proposal.ts` (`deriveRoute`, `proposalIdentity`), the `decide` and `proposal-export` cases in `src/cli.ts`, `test/spec-decision-stage.test.ts` and the decide tests in `test/cli-operator.test.ts` to the end before editing.
- `answerQuestion`: after the question is found, if its finding's `intent_key` is `DESIGN_SPLIT_INTENT` and the action is `modify`, refuse with "the design-split question takes approve (split) or deny (build as one); modify is not accepted". Like every other refusal, it is audited as `decision.refused`.
- `runSpecDecisionStage`: find the split question, if any, by its finding's intent.
  - **Approved split.** Create the `spec_decision` stage as today. Re-read the evidence file and compare its SHA-256 with the `spec.split.record` event's `evidenceHash`. Its `specHash` must equal the hash of the reviewed spec file as it is now (`normalizeText`, then `sha256Hex`). Re-validate it with `validateDesignSplit` against the reviewed spec (the review stage's `output_ref`) and `slugsInUse` read now. Refusal on either is `spec_decision.split.invalid` and blocks.
  - Build `decisions` for `renderPieceDesign` from every other question on the review stage, in question order: its text, its answer's action, and its answer text as recorded. The split question itself is excluded.
  - Then, in one `store.transaction`, create one proposal row per piece via `upsertProposal`. Use stage = the decision stage, finding = the split finding, title = the piece title, problem = `renderPieceDesign(...)` with those `decisions`, `whyUpstream` = "Feature k of n split from run N's design (<originalSlug>), approved by the operator; build after: <earlier slugs or nothing>.", route `deriveRoute("upstream_blocking")`, evidence the split evidence ref. Identity comes from `proposalIdentity`. In the same transaction, append `spec_decision.split.approve` with `proposals=<ids in piece order>; slugs=<slugs>`.
  - Complete the stage `block` and set the run `blocked`, then append `spec_decision.split.blocked` with the reason as its summary, so `status` shows it as the run's last event. Return `ok: false` with the same reason: "design split approved: <n> features stored as proposals <ids>. This run builds nothing further. Export each with `proposal-export --proposal <id> --name <slug>`, keep only the text under ## Problem, move it to docs/features/<slug>/design.md with git mv, keep docs/features/<originalSlug>/design.md, commit or move aside docs/features/<originalSlug>/spec.md, and start the first feature with new-run; start each later feature with new-run --after <the previous feature's run id> once that feature is delivered and merged." No fold is dispatched; the other answers reach the features through `## Decisions already made`.
  - **Denied split.** Remove the split question from `folds`, from the fold prompt's inputs and from the operator answers passed to `validateReconciliation`, and continue exactly as today. A run whose only question was the split passes with the reviewed spec and folds nothing. No new event is added: the `decision.answer` event records `deny` against the split finding, whose intent key is `design-split`.
- Tests, starting from Task 6's paused state with the same frozen threshold:
  - (a) approve: no fold dispatch, two proposal rows whose `problem` equals `renderPieceDesign` for each piece computed in the test from the evidence file, both with route `blocking_dependency`, the stage `blocked`, the run `blocked`, the reason naming both proposal ids, one `spec_decision.split.approve` event, a final `spec_decision.split.blocked` event whose summary equals the returned reason, `readRunSnapshot`'s blocked reason containing that summary, and `verifyAuditChain` null;
  - (h) approve the split together with a `modify` answer to a disclosed open decision (`FIXTURE-DISCLOSE-OD`): no fold dispatch, and each proposal's `problem` contains that question's text and the modify answer verbatim under `## Decisions already made`;
  - (b) `proposal-export --proposal <id> --name <slug>` through the CLI writes the file under `docs/proposals/` with the rendered design inside it;
  - (c) deny: no proposal rows from the split, the stage `passed`, and the run ready for approval;
  - (d) deny together with an approved disclosed open decision (design marker `FIXTURE-DISCLOSE-OD`): one fold dispatch whose prompt contains the disclosed question and not the split question text;
  - (e) `modify` on the split question is refused, audited `decision.refused`, and records no answer; `modify` on a disclosed question still works;
  - (f) the evidence file edited after the pause gives `spec_decision.split.invalid` and no proposal rows; so does the reviewed spec file edited after the pause;
  - (g) `decide --run <id> --finding <split finding> --approve` through the CLI records the answer, and a following `run --yes` reports the run blocked with the split reason and exits 1. The CLI test lowers the frozen threshold with the same policy-rewrite helper as Task 6, copied locally.
- Break it, restoring after each: (1) skip the evidence hash comparison and (f) must fail; (2) leave the split question in `folds` and (d) must fail; (3) drop the modify refusal and (e) must fail; (4) create the proposals outside the transaction and make the audit append throw (use the store's existing failure seam if there is one; if there is none, say so and leave this break unproven); (5) pass an empty `decisions` list and (h) must fail.
- Verify: `node --test --test-reporter=tap test/spec-decision-stage.test.ts test/cli-operator.test.ts`
- Expected: all pass and each break fails its case, or is reported unproven with the reason.

**Task completion evidence:** TAP counts and the break-it outcomes.

### Task 8: `new-run --after` checks and freezes the link to the earlier feature

**Depends on:** None (independent of Tasks 1 to 7)

**Files:**
- Modify: `src/profile.ts` — `Profile.after`, `freezeProfile`, `invalidProfileReason`.
- Modify: `src/run-intake.ts` — `RunIntakeInput.after` and the check.
- Modify: `src/cli-args.ts`, `src/cli.ts` — the `new-run` option.
- Modify: `test/profile.test.ts`, `test/run-intake.test.ts`, `test/cli-operator.test.ts`.

**Steps:**
- Read the three source files to change, `src/readiness.ts` (`checkIntakeRepository`), `src/operator-state.ts` (`readRunSnapshot`, `RunMissingError`, and the delivery block that sets `delivery.deliveredCommit`), the `withBoundary` helper in `test/operator-state.test.ts`, and the named tests to the end before editing.
- `Profile.after: { runId: number; deliveredCommit: string } | null`. `freezeProfile` takes it as a new optional final parameter (default null) and writes it. `invalidProfileReason` refuses a profile without the key ("predates the field", as for `approvalSigner`) and a value that is neither null nor that exact shape.
- `createRunIntake`: when `input.after` is set, check before `store.insertRun`, so a refusal leaves no run row:
  - `readRunSnapshot(store, rootDir, after)` returns; a `RunMissingError` refuses with "run N does not exist";
  - its `snapshot.phase` is `completed`; otherwise refuse naming the phase;
  - its `snapshot.delivery.deliveredCommit` is not null; otherwise refuse with "run N's delivery record does not verify" and the snapshot's first limitation or reason;
  - `git merge-base --is-ancestor <deliveredCommit> <intake.startingCommit>` exits 0 in `rootDir`. Exit 1 refuses with "run N's delivered commit <short> is not in this checkout's history: merge (not squash) gov/<slug>/<N> and commit before starting this feature". Any other exit refuses with git's message.

  The clean-tree check is already in `checkIntakeRepository`. Pass the link to `freezeProfile` and append `run.after` with `after run N; deliveredCommit=<commit>`.
- `cli-args.ts`: `new-run` accepts `--after <positive integer>`. `cli.ts` passes it through. Update `help new-run`.
- Tests. Build the earlier, completed run with a local copy of `withBoundary(10, ...)` from `test/operator-state.test.ts`, which produces a completed chain whose delivery record verifies; never type a delivery summary by hand. Then:
  - the profile refusals (missing key, bad shape);
  - intake with `after` pointing at that run, after its delivered commit is merged into the target with `git merge --no-ff` and committed, succeeds, and the frozen profile carries the link;
  - each refusal leaves the run count unchanged: missing run; a `blocked` run; a completed run whose delivery result file was deleted (the existing "completed records remain terminal" test shows `deliveredCommit` is then null); delivered commit not an ancestor; delivered commit squash-merged (`git merge --squash` then commit).
- Break it, restoring after each: (1) skip the ancestry check and the not-ancestor and squash cases must fail; (2) accept any phase and the `blocked` case must fail; (3) read the commit from the `delivery.gate.pass` event instead of the snapshot and the deleted-record case must fail; (4) move the check after `insertRun` and the run-count assertion must fail.
- Verify: `node --test --test-reporter=tap test/profile.test.ts test/run-intake.test.ts test/cli-operator.test.ts test/operator-state.test.ts`
- Expected: all pass and each break fails its case.

**Task completion evidence:** TAP counts and the four break-it outcomes.

### Task 9: The consent preview counts the split dispatch

**Depends on:** Tasks 3 and 6

**Files:**
- Modify: `src/operator-output.ts` — `formatRunPreview`.
- Modify: `test/operator-output.test.ts`, `test/cli-operator.test.ts` (line 1714), `test/run-command.test.ts` (line 177).

**Steps:**
- Read the three files to the end before editing.
- The spec ceiling becomes `3 + policy.specReviewRounds * (policy.panelSizeMax + 1)`. The document-review sentence gains: "The spec group adds 1 split-proposal dispatch when the reviewed spec declares more than ${policy.designSplitPathThreshold} files."
- Update the two ceiling expressions in the tests to `3 + ...`. In `test/operator-output.test.ts`, freeze `designSplitPathThreshold` at a value no default produces and assert the sentence contains it.
- Break it: print the live constant instead of the frozen value; the operator-output test must fail. Restore.
- Verify: `node --test --test-reporter=tap test/operator-output.test.ts test/cli-operator.test.ts test/run-command.test.ts`
- Expected: all pass and the break fails.

**Task completion evidence:** TAP counts and the break-it outcome.

### Task 10: Documents

**Depends on:** Tasks 1 to 9

**Files:**
- Modify: `ARCHITECTURE.md`, `docs/hazards.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/runbooks/cli-operator.md`, `docs/proposals/split-a-design-into-features.md`, `docs/features/implementation-segments-and-pause/plan.md`, `.claude/sessions/project-learnings.md`.

**Steps:**
- Read each file to the end before editing it. Edit only where it states a rule this plan changes.
- `ARCHITECTURE.md`:
  - section 5: one paragraph saying the operator authorized a design split on 2026-10-12, inside `spec_review`, and that `task_decomposition` (tasks as rows) stays deferred; the deferred list and the sequence block are unchanged, so the checker's pins hold;
  - section 7: replace "The spec and plan dispatches inherit the directory the operator launched from, so they may not be able to read the target or its `governed.yaml`" with the new rule that they run in the target root;
  - section 12, the `spec_review` and `spec_decision` passages: the split question, approve and deny, and that an approved split blocks the run with stored features;
  - section 14: features from an approved split reach `docs/features/` through `proposal-export`, the operator's trim to the `## Problem` body, and `git mv`; these are the only proposals created by an operator answer rather than a reconciliation decision, and they take the `blocking_dependency` route; and `new-run --after` with its conditions, read through the run snapshot.
- `docs/hazards.md` entry 20: a dated paragraph (do not rewrite history) saying a spec declaring more than the frozen threshold gets a split proposal before the plan exists, with the 1.0 to 1.84 evidence and its fixture path. Entry 18: a dated paragraph naming the split as the route past the review-prompt ceiling.
- `CLAUDE.md` Commands: `new-run` gains `--after <run-id>` (completed run, delivered commit an ancestor, frozen into the profile); `decide` notes the split question takes approve or deny. Copy the changes to `AGENTS.md` and compare hashes.
- `README.md` and `docs/runbooks/cli-operator.md`: a "When BuildWorks proposes a split" section. Read the question; approve or deny (modify is refused, and in guided mode a refusal ends the session with exit 3, so pick approve or deny when it asks again); on approve, export each feature with `--name <slug>` (not the name `status` suggests), delete everything in the exported file except the text under `## Problem` and promote its headings, `git mv` it into place, keep the original `design.md` committed because every feature names it, commit or move aside the original `spec.md`, and commit; run feature 1; merge its branch (merge or fast-forward, never squash) and commit; start feature 2 with `new-run --after`, and so on. Deny builds as one and may still be refused at the plan ceiling.
- `docs/proposals/split-a-design-into-features.md`: append a dated "Decided 2026-10-12" section naming the four choices and this plan.
- `docs/features/implementation-segments-and-pause/plan.md`: change `**Status:** Proposed` to `**Status:** Shelved` and add one dated line under it: "Shelved 2026-10-12 by the operator: splitting oversized designs replaces segments (`docs/features/design-split-into-features/plan.md`); a pause on a usage-limit refusal remains a separate later decision." Change nothing else.
- `.claude/sessions/project-learnings.md`: update the Current state block with what was built and proved, what was not, the shelved plan, and the next action. Do not remove still-open items.
- Verify: `npm run check:docs`; then compare the `CLAUDE.md` and `AGENTS.md` hashes.
- Expected: clean, identical hashes, and no new warning naming a file this task touched.

**Task completion evidence:** the checker output, the hash pair and the diffs.

### Task 11: Full verification and the free end-to-end walk

**Depends on:** Tasks 1 to 10

**Steps:**
- `npm run typecheck`.
- `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about 11 minutes). Expected: no failures; the count rises by the tests added here.
- `git log -1` and `git status --short`: a stray empty "moved" commit is dropped only after `git diff <prior> HEAD` is empty (project learnings: the suite can leave one).
- `node .claude/skills/run-buildworks/driver.mjs smoke`. Expected: `13/13 steps as expected`. The smoke's design declares fewer than 43 files, so it never triggers a split; say so.
- A free walk in a scratch target, with the stand-in spec emitter as the frozen executor. After `new-run`, a scratch `.mjs` rewrites the frozen threshold the same way `freezePolicyValues` does: rewrite `profile.policy`, recompute `policyHash`, re-serialize canonically, and update `profile_ref`. Then:
  - `run --yes` pauses at the split question (exit 3);
  - `decide --approve` on the split finding;
  - `run --yes` ends the run blocked with the split reason;
  - `status` shows the run blocked, with `spec_decision.split.blocked` and the reason as the last event;
  - `new-run --after <the split run's id>` refuses because that run is not completed, and the run count is unchanged;
  - `proposal-export --name <slug>` for both features, trim each to its `## Problem` body, `git mv` and commit;
  - `new-run` for the first feature succeeds, and a spec-stage run with the stand-in emitter accepts its design.

  Report each command and its exit code.
- Report what was not run: any paid run; a real model's split; a real feature's spec author reading the original design by path; a real chained pair. The first paid proof is a separate decision with its own consent: one design over the threshold, split, with two features built and delivered in order.
- Ask the operator whether to commission an independent review of the build (hazard 14): an in-session subagent or the billed `/code-review ultra`.

**Task completion evidence:** the outputs above and the not-run list.

## Open decisions

1. **The status of a run ended by an approved split:** `blocked` with a named reason (this plan, no migration), or a new terminal status such as `split` (a migration, plus every reader of `RunStatus`, the dashboard's badges and guided mode's terminal result).
2. **The threshold of 43:** derived from five runs. A higher value proposes fewer false splits (crew-chatter runs 2 and 3 would have been asked) and lets more plans reach the 80-item refusal; a lower value does the reverse.
3. **Guided mode and `--after`:** guided mode is the primary operator path, but it does not offer the link in this plan. Adding it means a prompt for the earlier run and the same check.
4. **Whether `--after` should be required for features 2 and later.** Nothing ties a feature's run to its split today. Requiring it would mean recording the split's proposal ids on the feature's run.

## Implementation note

**Built, 2026-10-12, uncommitted on `dashboard-restyling` against `fd756a7`.** Tasks 1-11. Open decision 1 was taken as written (`blocked`, no migration); 3 and 4 stay open. The body above is the reconciled plan and is left as written; where the build differs, this note governs.

**Deviations from the plan:**
- **Threshold 30, not 43 (open decision 2).** Task 1 recovered eleven runs, not five: the six other team-notes runs were recoverable from their delivery branches. Their highest ratio is 2.6 (team-notes run 10, 20 files, 52 items), not 1.84. The operator chose 30, "worst case of all 11" (80 / 2.6, rounded down). Test (c) of Task 3 derives it from the fixture rows. Nine of the eleven runs would have been offered a split.
- **Task 4 tests follow the threshold.** At 30, a two-way split of run 4's 62 files gives 31 per piece, so (a) uses a three-way derived split and (c) refuses the two-way split for size. A `dependsOn` naming the piece itself got its own refusal case.
- **`SPLIT_WHY` takes a third parameter**, the frozen plan task ceiling, instead of a literal 80.
- **The split prompt opens with a fixed lowercase sentence** (`DESIGN_SPLIT_PROMPT_PREFIX`, `src/prompts.ts`) and the emitter routes on `startsWith` of it. The emitter's `FIXTURE-SPLIT-CRITERIA` marker gives its spec three criteria so a split can be valid.
- **`spec.split.record` also carries `finding=<id>`.** The review fix for finding 1 identifies the split question by it.
- **`writeSplitEvidence`** (`src/design-split.ts`) writes and hashes the evidence for the stage and the tests.
- **Task 6 break 3** (dispatch before the gate check) was approximated rather than run exactly as written. The `--after` refusal for an unverified delivery record takes its reason from the snapshot's first workflow reason, which names the first broken record.
- **Documents beyond Task 10's list:** a dated addendum to `docs/hazards.md` entry 21 (the launch-directory gap is closed); the README and runbook say the split question lists each feature's counts.
- **The trim instruction was wrong as planned.** The rendered design uses `##` headings itself, so "keep the text under `## Problem` and promote its headings" kept 155 characters in the free walk. Every document and the blocked reason now say to keep the text between `## Problem` and `## Why this is upstream`, unchanged.
- **Review fixes** (`2026-10-12-code-review.md`, 6 findings, all accepted): the split is found by the `spec.split.record` finding id, not the intent key; `DESIGN_SPLIT_LOCATION` is `upstream:design:split:proposed`, which no reviewer report can produce; a spec with too few criteria to split records `spec.split.skipped` and dispatches nothing; the export is moved and `git add`ed, because `git mv` refuses an untracked file; `status` offers the split question approve or deny only; a fold `cwd` test; two fixture provenance paths repaired.
- **Second review fixes** (`2026-10-12-code-review-high.md`, 10 findings: 8 accepted, 1 rejected, 1 deferred). Task 2 as built ran the reviewers in the target too; the spec and plan reviewers now start in the launch directory, because the target's `.governance/` holds their siblings' raw reports and nothing enforces the denied paths (operator's option (a)). Guided mode gives the split question its own menu (1 Split, 2 Build as one, 4 Exit). Feature slugs are compared without case, through one `featureSlugsInUse`. `status` suggests `--name <slug>` for a split feature's export. `--after` refuses a run of another project. The split check is one if/else with one `minimumSplitPieces`. The split prompt says "reviewed", not "approved". Finding 6's fix (prefer the delivery record's own reason) was reverted after tracing showed the first boundary reason already names the cause. Finding 7 (allowed answers as data, including the dashboard's Modify box on the split card) is deferred.

**Verified:** typecheck clean; full serial suite after the second review's fixes 1475 tests, 1469 pass, 0 fail, 6 skipped, HEAD unchanged (1470 and 1464 after the first review's); smoke 13/13 before and after each round of review fixes (its design is under the threshold, so it never splits); `check:docs` clean apart from its standing warnings; `CLAUDE.md` and `AGENTS.md` identical. Every break-it named in the tasks and the review failed its test and was restored byte-identical. The free walk with the stand-in emitter and a frozen threshold of 6: `run` paused at the split (exit 3), modify refused (exit 1), `decide --approve` (exit 0), `run` ended the run blocked with `spec_decision.split.blocked` last (exit 1), both exports (exit 0), move and `git add` staged each design, `new-run --after` the blocked run refused with the run count unchanged (exit 1), and feature 1's run reached approval (exit 3).

**Not run:** any paid run; a real model's split; a real feature's spec author reading the original design by path; a real chained pair delivered in order. The first paid proof is a separate decision with its own consent. `/code-review ultra` refused the branch because its diff against `master` passes the size limit; `/code-review high` ran in its place.

**Follow-ups outside this change:** ARCHITECTURE section 14's general promotion text and README line 94 still say `git mv`, which fails the same way on any untracked export; `test/fixtures/recorded/spec-review-note-keeper-runs-5-6-disclosed-decisions.json` has the same corrupted provenance path; the dashboard's split question card still offers Modify, which is refused (second review, finding 7).
