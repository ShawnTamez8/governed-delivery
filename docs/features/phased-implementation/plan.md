# Phased Implementation Plan

**Status:** Implemented

**Goal:** Split the implementation stage's one implementer dispatch into
sequential phases of 10 approved-plan tasks each, so a plan too large for one
response (team-notes run 6: 57 tasks, 31 files) reaches `verification` instead of
blocking at `implementation`.

**Source:** Operator statements, 2026-10-04. (1) After run 6 blocked: "Have it
break up the work into phases with 10 features at a time." (2) Confirmed in
answer to a question: the unit is plan `## Tasks` items, 10 per phase, split in
plan order with no model involved. (3) The Next.js scaffold the implementer
objected to is handled by clearing the throwaway team-notes target; the system's
no-deletion rule stays. Evidence: run 6 (`.governance/raw/6/2026-10-04T02-59-16-714Z-09d3219d2d26.json`
in the team-notes target, machine-local until Task 1 copies it): one dispatch,
7 turns, $1.2840398, `status: "blocked"`, no patch; total run cost $4.587.

**Assumptions:**
- **Phase size is 10 plan tasks** (operator). **A frozen maximum of 8 phases is
  mine, not the operator's.** The consent preview computes dispatch ceilings from
  the frozen policy alone, and at preview time the plan may not exist yet
  (run 6's preview ran before `plan`), so a policy-only ceiling needs a policy
  number. 8 phases is 80 tasks; run 6's plan is 57. Strike it and the preview
  would have to print "unknown until the plan exists".
- A phase that proposes no patch blocks the run, as the single dispatch does
  today. A plan task already satisfied by an earlier phase is not expected.
- Each phase prompt carries the whole approved plan and spec, not only its ten
  tasks, because tasks reference decisions made elsewhere in the plan (run 6's
  plan has an `Open decision defaults` section ahead of `## Tasks`).

**Approach:** Add two frozen policy fields. A pure function splits the validated
plan's task list into phases. The implementation stage loops: for each phase,
assert the worktree clean, read HEAD, dispatch the `implementer`, assert clean,
validate the result, apply and commit through the existing
`applyProposedPatches`, with HEAD at that moment as the proposal base. The one
`implementation.gate.pass` event keeps its `base=..; head=..` shape, with `base`
the head before phase 1 and `head` the last phase's commit. Nothing after
`implementation` changes. A phase failure blocks the run exactly as a single
dispatch failure does; earlier phases' commits stay on the retained branch, and a
fresh run is the repair (hazard 7, section 19).

**Affected areas:** `src/policy.ts`, `src/plan-doc.ts`, `src/prompts.ts`,
`src/implementation-stage.ts`, `src/operator-output.ts`, a comment in
`src/delivery-coverage.ts`; `test/fixtures/harness/emit-implementation-stage.mjs`
and the tests listed per task; `ARCHITECTURE.md`, `docs/hazards.md`, `CLAUDE.md`
and `AGENTS.md`.

**Known blockers:**
- **[Verified]** Patch deletion is refused by the system and the prompt says so
  (`src/prompts.ts`, the `action one of add, modify` line in
  `buildImplementationAuthorPrompt`). Phasing does not change that. A target that
  carries scaffold the plan must replace has to be cleared in the target first
  (operator decision 3).
- **[Verified]** The task unit is `listItems` in `src/plan-doc.ts`: every
  non-empty line of `## Tasks` with a leading `- ` stripped. A task bullet
  hard-wrapped over three lines counts as three tasks. This plan uses
  `validatePlanDoc(...).tasks` as the unit, so a phase boundary and the plan
  gate's notion of a normative node are the same thing. Run 6's plan is one
  bullet per line: 57 tasks (counted from the file, not from the earlier
  truncated listing that read as 54), which gives phases of 10, 10, 10, 10, 10, 7.
- **[Verified]** Code review hands every reviewer the whole `base..head` diff in
  the prompt, capped at `PROMPT_MAX_BYTES` (1 MiB, `src/harness.ts`,
  enforced at `src/dispatch.ts`). Phasing does not shrink that diff. **[Unknown]**
  whether a 57-task implementation fits; if not, `code_review` blocks after the
  implementation spend. Out of scope here; measured by the live run.
- **[Unknown]** The target's frozen verification commands (`npx tsc --noEmit`,
  `npm run lint`, `npm run build`) run in a fresh worktree. Whether that worktree
  has `node_modules` has not been checked. Target preparation is the operator's.
- **[Verified]** `npm test` can leave an empty commit on the current branch
  (`.claude/sessions/project-learnings.md`, Documentation and working practice);
  Task 9 checks `git log -1`.
- Phasing does not claim to fix the output-token cap failure of run 5 or the
  refusal of run 6 at any specific effort. Smaller responses make both less
  likely; nothing measured shows they are gone.

**Blast radius:** (evidence: Grep over `src`, `test`, `scripts`, `.claude`,
2026-10-04)
- `buildImplementationAuthorPrompt`: one source caller,
  `src/implementation-stage.ts`; three call sites in `test/prompts.test.ts`
  (lines 493, 1268 and 1433; line 1268 sits in the routing table that pins every
  builder to a prompt prefix and an emitter, and line 1433 builds a real prompt
  for a routing check). The fixture emitter
  `test/fixtures/harness/emit-implementation-stage.mjs` scrapes the prompt
  (`baseCommit must be exactly:` and the `Patch only these paths:` block).
  `test/fixtures/harness/emit-cli-run.mjs` routes implementation prompts to that
  emitter by prefix and passes `--implementation-mode` through as `EMIT_MODE`, so
  every CLI-level run test reaches the emitter. `emit-code-review.mjs` scrapes the
  code-review prompt's own `baseCommit must be exactly` and is not touched.
  Code-review remediation builds its own prompt in `src/code-review-stage.ts`.
- `runImplementationStage`: called from `src/run-command.ts` (the `implementation`
  group) and `src/cli.ts` (the `implement` command, line 394);
  `test/implementation-stage.test.ts` carries 24 hits on this symbol and the
  prompt builder together; `test/code-review-stage.test.ts` and `test/cli.test.ts`
  mention it in comments only.
- Policy shape: `invalidPolicyReason` derives its expected field set from
  `buildPolicy()`, so adding a field refuses every previously frozen profile by
  name (hard rule 3, no migration; nothing has shipped). Tests that name
  `codeReviewMaxRounds` (the field added most recently with the same effect):
  `test/policy.test.ts` (11), `test/code-review-stage.test.ts` (5),
  `test/cli-operator.test.ts` (4), `test/profile.test.ts` (4),
  `test/operator-state.test.ts` (3), `test/code-review.test.ts` (1),
  `test/run-command.test.ts` (1). Each is checked in Task 2, not assumed
  unchanged.
- Nothing counts implementer dispatches: `src/operator-state.ts` reads only the
  `implementation.gate.pass` event's `base`/`head` (`parseImplementationGate`,
  `src/handoff.ts`), which keeps its shape. `src/verification-stage.ts`,
  `src/code-review-stage.ts` and `src/delivery-stage.ts` consume that handoff and
  need no code change.
- The dashboard names the implementation stage's agent by id
  (`src/dashboard/app.js`, `implementation: { names: ["implementer"] }`); it does
  not assume one row. Task 5 checks the cost projection with six rows.

**Verification:** `npm run typecheck`; `npm run check:docs`; the targeted tests in
each task; the serial full suite
`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about
11 minutes); `node .claude/skills/run-buildworks/driver.mjs smoke` (free, 13
steps). **No paid run is part of this plan, and this plan authorizes none**: the
end-to-end proof is a live team-notes run, which needs its own operator
authorization after the target is prepared.

**Hazards considered:**
- **Hazard 5** (completion without delivery): the change is exactly what makes the
  `base..head` range multi-commit. `src/delivery-coverage.ts` states three
  invariants for that range; invariant 2 no longer holds as written, because a
  later phase may legitimately modify a path an earlier phase added. Task 7
  states why delivery stays correct (net diff, fails closed) and tests it.
- **Hazard 7** (retries that vary nothing): a failed phase is not retried; the run
  blocks and a fresh run is the repair. Remediation inside `code_review` is
  unchanged.
- **Hazard 19** (inactivity budget): the run 4, 5 and 6 failures are all one
  oversized response; shrinking the response is the point. Per-dispatch time and
  token behaviour under phases is unmeasured until the live run.
- **Hazard 3** (constraint stated in the prompt): the phase prompt must state the
  add-versus-modify rule for files an earlier phase created, because the
  patch applier refuses `add` over an existing file and `modify` over a missing
  one. Task 4.
- **Hazard 4** (fixtures agreeing with code): expected phase counts come from the
  recorded run 6 plan (Task 1), and the emitter reads the phase out of the
  prompt rather than carrying its own counter (Task 5).
- **Hazard 18** (delivery proven, correctness never inspected): unchanged and
  restated; passing phases and delivery says nothing about whether team-notes
  works. Not a defect of this plan.
- **Hazards 1, 2, 6, 8-17:** not weighed as design inputs. Hazard 2 is satisfied
  by `dispatchOnce` retaining each phase's raw stream, unchanged.

## Tasks

### Task 1: Record the evidence this plan depends on

**Depends on:** None

**Files:**
- Create: `test/fixtures/recorded/plan-team-notes-run-6.json`
- Create: `test/fixtures/recorded/implementation-team-notes-run-6-refusal.json`

**Steps:**
- Copy `docs/features/team-notes/plan.md` from the team-notes target into the
  first fixture as a string field, with a `provenance` block: run 6, the plan
  author dispatch times read from the run 6 store (`agent_run` rows for the `plan`
  stage; query them, do not guess), capture date 2026-10-04, and what was dropped
  (nothing; the file is verbatim).
- Copy the `result` text of the last line of the run 6 raw stream into the second
  fixture, with provenance (run 6, dispatch 2026-10-04T02:45:08Z to 02:59:16Z,
  `num_turns` 7, `total_cost_usd` 1.2840398, the 1.1 MB stream dropped).
  Read the last line with `JSON.parse(lastLine)`, never the whole file.
- Verify: `node --test test/harness-stream-fixtures.test.ts` still passes, and
  `node -e` is not used for the extraction (a scratch `.mjs` is, per the learnings).
- Expected: both files parse; `validatePlanDoc` accepts the plan and returns 57
  tasks.

**Task completion evidence:** the two fixture files are committed and nothing in
the plan depends on the target's `.governance/` directory afterwards.

### Task 2: Frozen policy fields

**Depends on:** None

**Files:**
- Modify: `src/policy.ts` — add `IMPLEMENTATION_PHASE_TASKS = 10` and
  `IMPLEMENTATION_MAX_PHASES = 8` beside the code-review constants; add
  `implementationPhaseTasks` and `implementationMaxPhases` to `Policy` and
  `buildPolicy()`; add both to `POSITIVE_INT_FIELDS`.
- Modify: every test that builds or asserts a policy shape. Find them with
  `grep -rn "codeReviewMaxRounds" test` and `grep -rn "buildPolicy" test`; update
  each, including hand-built policy literals in `test/policy.test.ts`,
  `test/profile.test.ts`, `test/operator-state.test.ts`,
  `test/cli-operator.test.ts`, `test/run-command.test.ts`,
  `test/code-review.test.ts` and `test/code-review-stage.test.ts`.
- Validate: `test/policy.test.ts`

**Steps:**
- Add the constants with a comment saying why the phase ceiling exists (the
  preview's ceiling is policy-only; spend must be bounded before the plan exists)
  and that both values freeze at run start (hard rule 6).
- Add the two fields to the three places above. `invalidPolicyReason` needs no
  new branch: the missing-field check and the positive-integer loop cover them.
- Add tests in `test/policy.test.ts`: a frozen policy missing
  `implementationPhaseTasks` is refused by name; `0`, `-1` and `2.5` are refused
  for each field.
- Break-it: delete `implementationMaxPhases` from `POSITIVE_INT_FIELDS`, confirm
  the `0` test fails, restore. Confirm the missing-field test fails if the field
  is dropped from `buildPolicy()`.
- Verify: `node --test test/policy.test.ts test/profile.test.ts test/operator-state.test.ts test/run-command.test.ts test/code-review.test.ts`
- Expected: all pass; `npm run typecheck` clean (the dashboard-asset tsconfig is
  part of it; `test/dashboard-ui.test.ts` is excluded from `tsc`, so grep it too).

**Task completion evidence:** the grep outputs listing each test file touched and
the break-it failure output.

### Task 3: Split the plan into phases

**Depends on:** Task 1

**Files:**
- Modify: `src/plan-doc.ts` — export `planPhases(tasks, phaseSize)` beside
  `validatePlanDoc`, returning `{ index, count, firstTask, tasks }[]` with
  1-based `index` and `firstTask`.
- Modify: `test/plan-doc.test.ts`

**Steps:**
- Implement the split in plan order: phase `i` holds tasks
  `[(i-1)*size, i*size)`. Throw on `phaseSize < 1` or an empty list; callers pass
  validated input, so the throw marks a programming error, not a user path.
- Test with the recorded run 6 plan (Task 1): 57 tasks give six phases of
  10, 10, 10, 10, 10, 7, and `firstTask` of 1, 11, 21, 31, 41, 51. Test 10 tasks
  give one phase and 11 give two (10 and 1). The expected values come from the
  recorded file, not from a literal written beside the implementation.
- Break-it: change the slice end to `i*size + 1` and confirm the 57-task test
  fails, restore.
- Verify: `node --test test/plan-doc.test.ts`
- Expected: all pass.

**Task completion evidence:** the test output and the break-it failure.

### Task 4: The phase prompt

**Depends on:** Task 3

**Files:**
- Modify: `src/prompts.ts` — `buildImplementationAuthorPrompt` takes a phase
  argument `{ index, count, firstTask, tasks }`.
- Modify: `test/prompts.test.ts` (three call sites: lines 493, 1268, 1433)

**Steps:**
- Keep one prompt function, with the phase argument always present; a plan of 10
  tasks or fewer is phase 1 of 1. No second builder (hard rule 4).
- State, each on one source line so the `CONSTRAINT_STRINGS` source scan matches
  (a phrase wrapped across a template-literal line fails it). The first sentence is
  exactly `This is phase K of N.` with the numbers filled in, because the emitter
  scrapes that string (Task 5):
  this is phase `index` of `count`; implement only the tasks listed for this
  phase, numbered `firstTask` onward; earlier phases are already committed in the
  checkout, read it before patching; a file an earlier phase created already
  exists, so use `modify` with its complete new content; `add` only for a file
  that does not exist yet; later phases follow, so do not implement their tasks;
  return at least one file. Keep `baseCommit must be exactly:` and
  `Patch only these paths:` unchanged: the implementation emitter scrapes them.
- List the phase's tasks verbatim under a heading placed before the whole plan.
- Update the three existing `test/prompts.test.ts` call sites for the new argument
  (the routing table at 1268 and the real-prompt check at 1433 must still route to
  `emit-implementation-stage.mjs`) and add assertions for each stated constraint.
  Include the hazard 3 check that the add-versus-modify rule names both actions.
- Break-it: remove the `modify` sentence and confirm its assertion fails, restore.
- Verify: `node --test test/prompts.test.ts`
- Expected: all pass.

**Task completion evidence:** test output; the prompt for run 6's phase 2 rendered
once to a scratch file and read.

### Task 5: The stage loop

**Depends on:** Tasks 2, 3, 4

**Files:**
- Modify: `src/implementation-stage.ts` — `runImplementationStage`.
- Modify: `test/fixtures/harness/emit-implementation-stage.mjs`
- Modify: `test/implementation-stage.test.ts`

**Steps:**
- After the plan-hash and spec checks and before the stage row, parse the plan
  with `validatePlanDoc`; refuse by name when it is invalid, or when
  `tasks.length > implementationPhaseTasks * implementationMaxPhases` (the
  refusal names both numbers and the plan's count). These refusals create no
  stage row, worktree or dispatch.
- Replace the single dispatch-to-apply block with a loop over `planPhases(...)`.
  Per phase, in this order: `checkWorktreeClean` (`refuseDirty`, naming the
  phase), `git rev-parse HEAD` as `proposalBase`, `dispatchOnce` with the same
  agent, setting and effort, `checkWorktreeClean` again, `extractJsonBody`,
  `validateAgentResult`, require `status === "proposed"` and at least one patch,
  then `applyProposedPatches` with that phase's `proposalBase` and commit message
  `bw run <id>: phase <k>/<n> (base <8 chars>)`. Audit
  `implementation.phase.apply` with phase, base and resulting commit.
- Every `abort` reason in the loop names the phase (`phase 3 of 6: ...`) so a
  block says where it stopped. The first phase's `proposalBase` is
  `headAtProposal` for the handoff; the gate event is written once, after the
  last phase, as today.
- Fixture: make the emitter phase-aware by scraping `phase <k> of <n>` from the
  prompt (it throws if absent, as it does for the base commit). Add modes:
  `phased` (phase k adds one new path from the scope), `phased-modify` (phase 2
  modifies the path phase 1 added), `phased-add-existing` (phase 2 adds the path
  phase 1 added), `fail-at-phase` (returns `status: "blocked"` when
  `EMIT_FAIL_PHASE` equals the scraped phase). Existing modes keep their meaning,
  and existing tests keep passing because their plans must be 10 tasks or fewer;
  check each plan helper's task count and report it rather than assuming.
  The emitter scrapes the exact sentence `This is phase K of N.` (Task 4).
- CLI-level run tests reach the same emitter through `emit-cli-run.mjs`
  (`--implementation-mode` becomes `EMIT_MODE`). Find every plan those tests
  freeze (`grep -rn "implementation-mode" test`), count its tasks, and report any
  over 10; an over-10 plan now makes the emitter run in more than one phase and
  its expectations must be rechecked rather than assumed.
- The recorded plan carries run 6's own `plan_for` hash, which cannot match a
  test's spec. The test helper rewrites that one frontmatter line to the test
  spec's hash and leaves every task line verbatim; the multi-phase tests also need
  a signed scope of at least six paths, because `phased` adds one scope path per
  phase.
- Tests, with the recorded 57-task plan (task 1) as the multi-phase input:
  six dispatches, six `implementation.phase.apply` events, six commits on
  `gov/<slug>/<run>`, `agent_run` rows all `setting = 'implementer'`, gate event
  `base` equal to the head before phase 1 and `head` equal to the branch tip,
  `git diff --name-only base..head` equal to the union of the six phases' paths.
  A phase-3 failure: exactly three dispatches, the run and stage `blocked`, the
  reason naming `phase 3 of 6`, two phase commits on the branch, the worktree
  retained. A plan over 80 tasks: refused before any stage row and with zero
  `agent_run` rows. `phased-modify` applies; `phased-add-existing` is refused by
  the existing `add requires the file not to exist` rule, naming the phase.
- Break-it: make the loop run one phase over all tasks and confirm the six-dispatch
  test fails; make the loop skip the per-phase clean check and confirm a
  `mutate-then-propose` at phase 2 test fails (add that test), restore each.
- Verify: `node --test test/implementation-stage.test.ts test/code-review-stage.test.ts test/cli.test.ts test/cli-operator.test.ts test/run-command.test.ts`
- Expected: all pass. Also open the dashboard cost projection test
  (`test/dashboard-ui.test.ts`, `test/operator-state.test.ts`) with six
  `implementer` rows and confirm it renders them; fix the projection only if a
  test shows it assumes one.

**Task completion evidence:** the test output, the two break-it failures, and
the git log of the scratch worktree from the six-phase test.

### Task 6: The consent preview

**Depends on:** Task 2

**Files:**
- Modify: `src/operator-output.ts` — `formatRunPreview`: `implementation:
  policy.implementationMaxPhases`, and a line stating the rule.
- Modify: the tests that assert preview text (find with
  `grep -rn "Dispatch ceilings" test`, currently `test/cli-operator.test.ts`).

**Steps:**
- Change the ceiling and add a preview line such as
  `Implementation: one implementer dispatch per ${implementationPhaseTasks} plan tasks, at most ${implementationMaxPhases} phases; the count is known once the plan exists.`
- Update every assertion on the old `implementation=1` or on a total that
  included it; compute the expected total from the policy constants in the test,
  not by copying the new output.
- Break-it: revert the ceiling to `1` and confirm the preview test fails.
- Verify: `node --test test/cli-operator.test.ts test/run-command.test.ts`
- Expected: all pass. Report, as a number, what the default run-6 preview now says
  (plan 5, implementation 8, code review 7).

**Task completion evidence:** test output and the rendered preview.

### Task 7: Delivery coverage after a multi-commit range

**Depends on:** Task 5

**Files:**
- Modify: `src/delivery-coverage.ts` — the header comment's invariant 2 only.
- Modify: `test/delivery-coverage.test.ts` if it exists, else
  `test/implementation-stage.test.ts`.

**Steps:**
- Rewrite invariant 2 to say what is true now: patches within one phase are
  still refused when they touch a path an earlier patch of the same phase moved;
  across phases a path may be modified again, the changed set is the net
  `patchBase..head` diff, and `deliveryCoverage` matches against that net set.
- Test two facts with a real git range from the stage test: a path added in
  phase 1 and modified in phase 3 appears once in the changed set and satisfies a
  declared artifact; a pre-existing file changed in phase 1 and restored
  byte-for-byte in phase 2 does not appear, so `deliveryCoverage` reports it
  `missing` and delivery would block (fails closed, never open). State the second
  as a known limitation in the comment, not a goal.
- Verify: `node --test test/implementation-stage.test.ts test/delivery-stage.test.ts`
- Expected: all pass.

**Task completion evidence:** both tests' output.

### Task 8: Documents

**Depends on:** Tasks 5-7

**Files:**
- Modify: `docs/hazards.md` — new entry 20.
- Modify: `ARCHITECTURE.md` — section 12 ("After approval" paragraph), section 20
  (a new limit bullet), section 22 (count and list of hazards).
- Modify: `CLAUDE.md` and `AGENTS.md` — one short paragraph in the
  operating-contract text, identical in both.
- Read first, and edit only if they describe one implementer dispatch:
  `README.md`, `docs/runbooks/cli-operator.md`,
  `.claude/skills/run-buildworks/SKILL.md`.

**Steps:**
- Hazard 20, "One dispatch over a plan larger than one response": runs 4, 5 and 6
  of team-notes, each measured (run 4 killed at 1,800,194 ms with a 0-byte raw
  file; run 5 four consecutive 64,000-token thinking messages, $2.9195696; run 6 a
  refusal at $1.2840398 after 7 turns). Requirement: the implementation stage
  must bound the work in one response by task count; nothing was measured about
  what bound is large enough, and 10 is the operator's choice.
- ARCHITECTURE section 20: an "Implementation phases" limit, frozen in the
  profile, with its behavior on breach (refuse before spend).
- Run `npm run check:docs` after each file. Keep `CLAUDE.md` and `AGENTS.md`
  byte-identical (compare hashes). Do not edit any historical document.
- Verify: `npm run check:docs`
- Expected: clean; warnings only from historical documents.

**Task completion evidence:** `check:docs` output and the two file hashes.

### Task 9: Full verification

**Depends on:** Tasks 1-8

**Steps:**
- `npm run typecheck`
- `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`
  (about 11 minutes; keep the file glob so the fixture emitters are not run as
  tests). Known failures before this change: the dashboard SIGTERM stderr warning
  and "nothing under src/ touches a private key"; compare against that list, do
  not assume it.
- `git log -1` and `git status --short`: drop a stray empty "moved" commit with
  `git reset --soft` only after `git diff <prior> HEAD` is empty.
- `node .claude/skills/run-buildworks/driver.mjs smoke`
- Expected: typecheck clean; no new failures beyond the two named; smoke
  `13/13 steps as expected`.
- Report what was not run: any paid run.

**Task completion evidence:** the four outputs, with failures listed by name.

## Out of scope

- A paid run. The live check needs a prepared target (scaffold cleared, a
  verification config that can run in a fresh worktree) and fresh operator
  authorization; a completed paid run never authorizes another.
- Resuming a run from the last committed phase. The architecture has no
  arbitrary resume (section 19); a fresh run is the repair.
- Running verification between phases. The frozen commands (`tsc`, `lint`,
  `build`) would fail on a half-built project by construction.
- A byte or token bound per phase. Task count is the operator's chosen unit;
  tasks vary widely in size (a `package.json` task and an editor task are not
  alike), so a ten-task phase can still be too large. Measure before adding it.
- Allowing patch deletion, and any change to `code_review` prompt size.
- Changing `spec_review` or `plan_review`; a plan with more tasks than the
  frozen ceiling is refused at `implementation`, after the plan is paid for.
  Refusing it at the plan gate (hazard 6's pattern) is a follow-up.

## Open decisions for the operator

1. **The 8-phase ceiling** (assumptions above). Keep, change the number, or drop
   it in exchange for a preview that cannot state an implementation ceiling.
2. **Refuse an oversize plan at `plan_review` rather than at `implementation`.**
   Cheaper for the operator, but it touches the plan gate.

## Implementation note

**Shipped, 2026-10-04.** Tasks 1-9 as written: the two recorded fixtures,
the frozen `implementationPhaseTasks` (10) and `implementationMaxPhases` (8), `planPhases`,
the phase prompt, the stage loop with one gate event spanning all phases, the
preview ceiling and line, the delivery-coverage comment and its two range tests,
hazard 20, and the `ARCHITECTURE.md` / `CLAUDE.md` / `AGENTS.md` text. Verification:
`npm run typecheck` clean; `npm run check:docs` clean; the driver smoke 13/13; the
serial full suite had three failures, one of them this change's (the stream-shape
test's implementation prompt lacked the phase line; fixed, 7/7). The other two, the
dashboard SIGTERM stderr warning and "nothing under src/ touches a private key",
fail identically on a clean checkout of HEAD. `git log -1` was unchanged after the
suite. No paid run was made.

**Deviations.**
- The plan's per-phase pre-dispatch clean check was not added as a separate step: the
  existing post-dispatch check runs for every phase and is the one that catches the
  executor writing into the tree, which is what the `mutate-at-phase` test breaks.
  The planned break-it that skips a per-phase pre-check therefore does not exist.
- Refusing an oversize plan stays at `implementation` (open decision 2 was not
  taken up); the refusal does not block the run, as the existing pre-stage refusals
  do not.

**Independent review** (in-session subagent, one pass, 2026-10-04): no defect in phase
boundaries, base/head handling, failure paths, frozen-profile reads, refusals before
spend or audit integrity. Dispositions of its five findings:
1. A task is one non-empty line of `## Tasks`, so wrapped or nested bullets can be cut
   mid-task or push a plan over the ceiling. Accepted and recorded in hazard 20; run
   6's plan was one line per bullet. Enforcing it at the plan gate is a follow-up.
2. A phase whose tasks change no file in scope (a trailing "run the build" task)
   blocks the run. Accepted and recorded in hazard 20; not fixed, because the
   alternative needs a handoff-format decision. The live run measures how often it
   happens.
3. The `profile.policy` source assertion is weak; the behavioural 2x3 versus 7-task
   test is the real guard. Left as is; its break-it was not run.
4. Pre-stage refusals leave the run `in_progress`. Consistent with the existing ones.
5. Hazard 20 said "before anything is spent" about the oversize refusal. Corrected to
   "before any implementation spend".

**Deferred.** The two open decisions above; a plan-gate refusal of an oversize or
wrapped-task plan; per-phase byte or token bounds; the live team-notes run, which
needs its own authorization.

## Amendment, 2026-10-04: existence lists in the phase prompt

Team-notes run 7, the first live run under phases, blocked at phase 4 of 8 when the
implementer proposed `modify` for a scope path no phase had created (`modify
requires the file to exist: src/server/routes/import.ts`). The operator chose the fix
on 2026-10-04. `buildImplementationAuthorPrompt` takes `existingPaths`, the scope
paths that exist in the worktree at the phase's base, which
`runImplementationStage` computes per phase with `existsSync`, the test the patch
applier refuses on. The prompt lists the paths that take `modify` and the paths that
take `add`, after the unchanged scope block. Evidence for the change is the run 7
record in hazard 20. Guards, each shown to fail when broken: a stage-level test
driving a new `phased-by-prompt` fixture mode, which takes every action from the
prompt's two lists and throws on a path in neither (broken by passing `[]` from the
stage), and a prompt test of the two lists (broken by swapping them). Hazards
considered: 3 (the constraint is now stated as a computed fact, not only a rule), 4
(the fixture reads the lists out of the prompt rather than carrying its own
existence knowledge) and 20. Not addressed: a phase whose tasks change no in-scope
file, and a model that disregards the lists; the live run measures both.
