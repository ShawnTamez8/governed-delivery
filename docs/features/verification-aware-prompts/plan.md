# Verification-Aware Prompts Implementation Plan

**Status:** Implemented

**Goal:** Tell the agents that write the spec, the plan and the code which
verification commands the run will be judged by, including the reconcile and fold
passes that rewrite the spec and plan after the first draft, so a run no longer spends
on a layout that its own frozen `governed.yaml` commands cannot accept, and give the
spec author a human-gated way to ask when compatibility cannot be established.

**Source:** Operator statements, 2026-10-05. (1) "I dont care about fixing the
team-notes repo, my only concern is the issue that BuildWorks led us to that
issue. BuildWorks needs fixed, not the test repo." (2) Chose "Prompts only" over
also changing the working directory of spec and plan dispatches. (3) On the review
in `2026-10-05-plan-review.md`: later passes get the guidance for reconcile and fold
only, not code-review remediation; the reconciler is guided by a prompt rule only,
with no deterministic refusal; and the question is required whenever compatibility
cannot be established. Backlog item: "Verification-aware prompts (idea, no plan)" in
`.claude/sessions/project-learnings.md`. Evidence: team-notes run 10 (below).

**Assumptions:**
- **Prompts only** (operator). Spec and plan dispatches keep the working directory
  they inherit from the launch. That gap is recorded in hazard 21 and not changed here.
- The commands are stated as facts the system computes, not as rules the model
  must judge. Run 7 taught that a prompt asking a model to branch on a fact the
  system can compute exactly should state the fact (project learnings, 2026-10-04).
- The only model-judged parts are the spec author's open decision and the
  reconciler's route for it. The operator chose a prompt rule for the reconciler, so
  the reconciler can still choose `upstream_follow_up`, which opens no question. The
  plan promises a recorded question and a prompt that asks for the pause, not a
  guaranteed pause.
- **The question applies to nearly every run launched outside the target** (operator,
  "whenever compatibility cannot be established"). A spec author that cannot read the
  target cannot establish that code-inspecting commands are satisfied, so it asks.
  The effect on operator load is unmeasured.
- No new gate, no new stage, no schema change, no change to `governed.yaml`.

**Approach:** One helper in `src/prompts.ts` renders the frozen commands from
`profile.verification`. Eight builders take the frozen `VerificationConfig` as a
required argument and state the commands plus one role-specific rule: spec draft,
spec self-critique, spec reconcile, spec decision fold, plan draft, plan
self-critique, plan reconcile, and the implementer. The four stages that call them
pass `profile.verification`, never the working-copy file (hard rule 6). The spec
author's open decision opens with the fixed word `Verification:` so the reconcile
and fold prompts can recognize it by its text; no code reads that word. Tests pin the
rendered commands, the wiring from the frozen profile, the routing, the
oversize-config behavior and the route through `spec_decision`; a recorded fixture
holds the run 10 evidence the design rests on.

**Affected areas:** `src/prompts.ts`, `src/spec-stage.ts`, `src/spec-decision-stage.ts`,
`src/plan-stage.ts`, `src/implementation-stage.ts`; `test/prompts.test.ts`,
`test/spec-stage.test.ts`, `test/spec-decision-stage.test.ts`,
`test/plan-stage.test.ts`, `test/implementation-stage.test.ts`,
`test/dispatch.test.ts`, `test/fixtures/harness/emit-spec-stage.mjs`; one new recorded
fixture; `docs/hazards.md`, `ARCHITECTURE.md`.

**Known blockers:**
- **[Verified]** No author prompt carries verification arguments today. None of the
  eight builders above takes a `VerificationConfig`; the profile carries one
  (`Profile.verification`, `src/profile.ts`).
- **[Verified, run 10 retained streams]** Dispatches 1-10 (spec, self-critique,
  spec review, reconciliation, plan, plan review) ran with `cwd` set to the
  BuildWorks checkout; only dispatches 11-16, the six implementation phases, ran in
  `.governance\worktrees\10` of the target. Code: the implementation and code-review
  stages pass `invocation: { cwd: worktreePath }`, and the spec and plan stages pass
  none, so their dispatches inherit the launch directory (the original text said only
  the implementation stage sets one; the independent review corrected it, and run 10
  never reached code review). Operator commands use the absolute checkout script with `--repo`
  to select a separate target (`CLAUDE.md`, Commands), so the launch directory is
  wherever the operator stands; run 10 was launched from the BuildWorks checkout. A
  bare `buildworks` call targets the current directory (`CLAUDE.md`), so a launch from
  the target lets the spec and plan dispatches read it. `--restricted` confines the read tools to the
  working directory (recorded in a comment in `test/executor.test.ts`; not
  re-probed). The prompts therefore cannot assume either case.
- **[Verified]** The implementer cannot fix a scope conflict. Scope is signed
  before implementation and a patch outside it is refused (architecture section 7),
  so an implementer that learns `npm run build` needs `app/` still cannot add it.
- **[Verified]** The reconciler decides whether a disclosed open decision opens an
  operator question. `buildSpecReconcilePrompt` allows `upstream_blocking`, the route
  that carries a question, only when no acceptance criterion can be written, and says
  a workable baseline is `upstream_follow_up`, which opens none (architecture
  section 12, `spec_decision`). A build-layout conflict can leave every criterion
  writable, so without a rule in that prompt the pause is not promised.
- **[Verified]** Verification does not run once. `src/code-review-stage.ts` runs the
  same frozen commands after each remediation commit. A command that exits 0 still
  fails on a time limit, on the output budget, or if it leaves the checkout dirty
  (`src/commit-verification.ts`: `git status --porcelain` must be empty and HEAD
  unmoved, so untracked files that git does not ignore count).
- **[Verified]** `parseGovernedConfig` bounds neither the number of commands nor a
  token's length (`TOKEN` in `src/governed-config.ts` is `+`, and no count check
  exists), so a valid config can render a block larger than `PROMPT_MAX_BYTES`. The
  only size check is in `src/dispatch.ts`: it refuses the dispatch by name before any
  invocation and truncates nothing (architecture section 20).
- **[Verified]** Test emitters route by `stdin.includes(...)` over the whole prompt,
  embedded data included. `emit-spec-stage.mjs` checks `self-critique`, `spec reviewer`,
  `reconcile`, `Operator answers to fold:`, `spec author` in that order, and
  `emit-plan-stage.mjs` checks `self-critique`, `plan reviewer`, `reconcile`,
  `plan author`. New prose must contain none of the earlier words, and rendered
  command names and tokens are data that can contain them: a valid command named
  `self-critique` makes the spec emitter return a self-critique instead of a draft.
  The same exposure already exists for design text, and the `FIXTURE-*` test modes
  depend on it, so the emitters are not changed here. The emitters also scrape
  `Approved specification:`, `The specification under review:`, `Findings to
  reconcile:`, `name only these:` and `Patch only these paths:`; new text must not
  contain those markers.
- **[Verified]** Command tokens contain no space or shell metacharacter, so joining a
  command's tokens with spaces loses nothing.
- **[Verified]** Hazard 20 records that a task changing no scope file, "such as a
  trailing 'run the build' task", blocks the run. Telling a plan pass the commands
  could invite exactly that task, so each plan prompt must forbid it.
- **[Verified]** The working tree already holds uncommitted edits to
  `.claude/sessions/project-learnings.md` and `docs/runbooks/cli-operator.md`.
  They are not part of this change.
- **[Unknown]** Whether a model follows the new rules, and how often the spec author
  asks. No free command answers either.

**Blast radius:**
- Builder callers (grep of `src`, `test`, `scripts`, `.claude`): `src/spec-stage.ts`
  (author, self-critique and reconcile: three calls), `src/spec-decision-stage.ts`
  (the fold: one), `src/plan-stage.ts` (author, self-critique and reconcile: three),
  `src/implementation-stage.ts` (one), and `test/prompts.test.ts`, which calls all
  eight. `test/fixtures/harness/emit-cli-run.mjs` imports only the prefix constants.
  `src/code-review-stage.ts` imports the review and remediation builders and is
  untouched.
- Prompt size: the block's size is set by `governed.yaml` and has no bound. Behavior
  on overflow is the existing refusal: `dispatchOnce` refuses by name before the
  harness starts, and the stage blocks. Dispatches already made have been paid for, so
  an oversize config can block after spend. A pre-spend bound would change what
  `governed.yaml` accepts and is deferred (Out of scope).
- Persisted formats, schemas, `governed.yaml` and the frozen profile are untouched.
  `agent_run.input_hash` changes for every new run, which is expected and affects
  no stored run.
- Not touched: the reviewer prompts and `buildCodeReviewRemediationPrompt`.

**Verification:** Component: each of the eight builders states the frozen commands and
its rule (`test/prompts.test.ts`). End to end, as far as free commands reach: each
stage passes the frozen profile's commands (dispatch hashes, Tasks 2-5), and an open
decision that begins `Verification:` reaches `awaiting_decision`, is answered and is
folded (Task 3). That route test proves the pipeline carries such a question; it cannot
prove the reconciler chooses the blocking route. Regression: `npm run typecheck`,
`npm run check:docs`, the full serial suite compared against its known failures, and
the free smoke. A green result proves wording, wiring and routing, not model behaviour.

**Hazards considered:**
- **Hazard 3** (constraint stated in the prompt): each rule is stated where an agent is
  asked to produce its document, one rule per source line so the source scan matches,
  and asserted per builder, because a whole-file scan passes while one builder still
  lacks the rule. The advertised `Verification:` question is run through the real spec
  validator.
- **Hazard 13** (specifications inventing obligations): stating the commands to the
  spec author could turn them into acceptance criteria or invented artifacts. Every
  spec-side rule forbids both, and the one outlet is an open decision, which a human
  answers. The fold may add only the declared artifact paths the operator's answer
  states. Risk left: the author may ask on designs that do not need it; the operator
  accepted that for any run where compatibility cannot be established.
- **Hazard 16** (a remediation loop aimed at the wrong artifact): a layout the
  commands cannot accept is an upstream defect that code-review remediation cannot
  repair, which is why the question is asked at the spec stage. Remediation itself is
  not informed (operator decision) and the residual is recorded.
- **Hazard 17** (a reconciliation answering a finding by deleting the obligation): the
  reconcile and fold prompts gain rules that forbid adding commands as criteria or
  tasks and never instruct removing anything, so no deletion route opens.
- **Hazard 20** (one dispatch over a plan larger than one response): each plan prompt
  forbids a task that runs the commands, and the implementer prompt says the commands
  first run after the last phase, so no phase is expected to pass them.
- **Hazard 4** (fixtures agreeing with code): the expected commands come from the real
  `governed.yaml` recorded in Task 1, parsed by the real parser, not from a literal
  written in this session. The emitters scrape these prompts, so the router tests are
  the break-it check for routing words, and a guard keeps routing words out of fixture
  command data.
- **Hazard 12** (configuration divergence): the commands come from the frozen
  profile, not the working copy. A test that freezes two different configs shows the
  prompt follows the frozen one.
- **Hazard 18** (delivery proven, correctness never inspected): unchanged. This plan
  stops one cause of a doomed run; it does not show a delivered product works.
- **Hazard 7** (retries that vary nothing): no retry is added.
- **Hazard 6** (promises a later stage cannot keep): the plan rule that forbids a
  verify-only task is its prompt-side cousin; no gate changes.
- **Hazards 1, 2, 5, 8-11, 14, 15, 19:** not weighed as design inputs. Hazard 19 is
  unaffected: the streaming budget does not depend on prompt size, and the size
  ceiling is covered above.

## Replay against the motivating failure

Run 10 (team-notes, 2026-10-05, `--model claude-sonnet-5-5` for the reconciler; the
retained streams show Opus authors, Haiku spec and plan reviewers, a Sonnet
implementer): 16 dispatches, $7.3048866, blocked at `verification` on `typecheck`,
which failed on a partial `npm install`. After the operator-authorized `npm ci`, a
fresh worktree of the delivered commit `d62ba9d` still failed `npx tsc --noEmit`
(two type errors) and `npm run build` ("Couldn't find any `pages` or `app`
directory"). The delivered code is a Node `http` server in the target's
*src/server* plus a plain TypeScript client in its *src/client*; `package.json`
was not touched and its `build` script is `next build`. Those two
results come from the manual check in the project learnings, not from a run record.

Replayed against this plan:
- The spec author would have received `npx tsc --noEmit`, `npm run lint`,
  `npm run build`, launched from the BuildWorks checkout, so it could not read the
  target and could not establish that its declared artifacts satisfy them. The rule
  applies whether or not the design names a stack, so it is told to record one
  `Verification:` open decision asking what each command requires and which artifact
  paths that needs. The reconcile prompt is told to route that decision
  `upstream_blocking`, which opens the operator question before approval, at the
  cost of the spec stage only.
- It would not have caught the partial install (environment; the runbook's
  fresh-worktree check covers that) or the two type errors (code defects).
- It does not help if the author does not raise the question, the reconciler routes it
  as a follow-up, or the operator answers with a stack the scaffold does not match. The
  change shortens the path to the question; it does not decide the answer.

## Tasks

### Task 1: Record the run 10 dispatch context

**Depends on:** None

**Files:**
- Create: `test/fixtures/recorded/run-10-dispatch-context.json`

**Steps:**
- With a scratch `.mjs` outside the repository (not `node -e`), read the first line
  of each file under `<team-notes target>\.governance\raw\10\` in name order and
  keep only `model`, `cwd`, `tools`, and the UTC time in the file name. Join each
  to its `agent_run` row (query the run 10 store: stage kind, agent, setting,
  `cost`); confirm the file count equals the `agent_run` count before joining, and
  stop and report if they differ.
- Add the target's `governed.yaml` verbatim from commit `3b73c3d`
  (`git show 3b73c3d:governed.yaml`) as a string field.
- Add a `provenance` block: run 10, operator-authorized paid run, 2026-10-05,
  capture date, and what was dropped (every line after the first of each stream, all
  prompts and results). No private key, token or credential is read or copied.
- Verify: a scratch script imports `parseGovernedConfig` through a `file:///C:/...`
  URL and parses the stored text.
- Expected: 16 rows; rows 1-10 carry the BuildWorks checkout as `cwd`, rows 11-16
  end in `.governance\worktrees\10`; the config parses to three commands.

**Task completion evidence:** the fixture is committed and nothing later depends on
the target's `.governance/` directory.

### Task 2: The shared block, the spec draft prompts, and the size and routing guards

**Depends on:** Task 1

**Files:**
- Modify: `src/prompts.ts` — import `VerificationConfig` from `./governed-config.ts`;
  add `verificationCommandsBlock` and `specVerificationRule`; add a required
  `verification: VerificationConfig` last parameter to `buildSpecAuthorPrompt` and
  `buildSpecSelfCritiquePrompt`.
- Modify: `src/spec-stage.ts` — the author and self-critique call sites pass
  `profile.verification`.
- Modify: `test/prompts.test.ts`, `test/spec-stage.test.ts`, `test/dispatch.test.ts`.

**Steps:**
- Read `src/prompts.ts` and `src/spec-stage.ts` to end of file before editing.
- `verificationCommandsBlock(verification)` returns, each sentence on one source line:
  "After the implementation is committed, and again after each code-review
  remediation commit, the system runs these verification commands in this order in a
  checkout of the delivered code:", a blank line, one `- <name>: <tokens joined by a
  space>` line per command, a blank line, then "A command passes only if it exits 0
  within its time and output limits and leaves the checkout exactly as committed: git
  must show no new or changed file, so build output must be ignored by git." and "The
  first command that fails blocks the run, and no repair round follows." (Facts from
  `src/verification-stage.ts`, `src/commit-verification.ts` and
  `src/code-review-stage.ts`.)
- `specVerificationRule` is these lines, each one source line: "Your working
  directory may not be the target repository."; "Treat a file as evidence of what a
  command runs only if it belongs to the repository the design describes; if you
  cannot tell, what the command requires is not established."; "The commands are not
  obligations the design states: never restate a command as an acceptance criterion,
  and never declare an artifact only because a command exists."; "A command that only
  reports a tool version depends on nothing and needs no decision."; "If neither the
  design nor files you can read establish that the declared artifacts satisfy every
  other command, even when the design names a stack, record exactly one open decision
  in the form stated above, with severity high and a question that begins
  `Verification:`, asking what each such command requires and which declared artifact
  paths that needs."; "That is the one further kind of open decision this section
  admits."
- Place the block and the rule as one paragraph before `Design document:` in both
  spec builders. Use none of `self-critique` (draft prompt only), `spec reviewer`,
  `reconcile`, `finding <digit>`, or any marker in Known blockers.
- Tests in `test/prompts.test.ts`: build `VERIFICATION` from the Task 1 fixture with
  `parseGovernedConfig`; update every existing call to the two builders (the author,
  self-critique and `routingPrompts` tests, and the compose test near `runRouter`).
  Add a test that each spec builder contains the three rendered command lines, every
  block and rule sentence, and the block before `Design document:`; a test that two
  different configs render different prompts and neither contains the other's lines;
  a test that `validateSpecDoc` accepts a spec whose `## Open decisions` holds
  `- OD-001 (high): Verification: <a question>`; and add the block and rule sentences
  to `CONSTRAINT_STRINGS`.
- Routing guard: a test that no command name or token in the Task 1 config, or in any
  `VERIFICATION` constant in the stage tests, contains a routing marker (`self-critique`,
  `spec reviewer`, `plan reviewer`, `reconcile`, `spec author`, `plan author`,
  `Operator answers to fold:`, `FIXTURE-`). Say in the test that the emitters route over
  the whole prompt, so fixture command data must stay clear of these words.
- Size guard: in `test/dispatch.test.ts`, parse a config with one command whose single
  token is `PROMPT_MAX_BYTES` characters long and assert `parseGovernedConfig` accepts
  it (the reviewer's reproduction, with the real parser). Build `buildSpecAuthorPrompt`
  from it and assert the prompt holds the whole token and exceeds `PROMPT_MAX_BYTES`,
  and that `dispatchOnce` refuses it with `prompt exceeds` and no spawn and no raw
  directory, as the existing oversized-prompt test does. Add a boundary pair: pad the
  token so the prompt is exactly `PROMPT_MAX_BYTES` bytes (the size check does not
  refuse it; the existing `exit-nonzero` fixture then fails for its own reason) and one
  byte more (refused).
- Wiring test in `test/spec-stage.test.ts`: give `withRun` an optional `verification`
  argument defaulting to the file's constant; run the stage under two frozen configs
  and assert the first two `agent_run.input_hash` rows (author, self-critique) differ
  between the runs while the reviewer rows are equal; assert the first row equals the
  hash of `buildSpecAuthorPrompt` given the frozen config. If a reviewer prompt embeds
  a run-specific value, compare only the first two rows and say so in the test.
- Break it before trusting it: (a) pass `{ commands: [] }` at one call site, and the
  wiring test must fail; (b) put the word `reconcile` into the rule, and the router
  tests must fail; (c) join tokens with `""`, and the rendered-lines test must fail;
  (d) wrap one rule sentence across two template lines, and the source scan must fail;
  (e) name a test command `reconcile`, and the routing guard must fail. Restore each
  and hash the file before and after.
- Verify: `node --test test/prompts.test.ts test/spec-stage.test.ts test/dispatch.test.ts`
- Expected: pass; each break above fails the named test.

**Task completion evidence:** test output and the five break-it results.

### Task 3: The spec reconcile and fold prompts, and the route through spec_decision

**Depends on:** Task 2

**Files:**
- Modify: `src/prompts.ts` — `buildSpecReconcilePrompt` and `buildSpecDecisionFoldPrompt`
  take a required `verification: VerificationConfig` last parameter.
- Modify: `src/spec-stage.ts` (the reconcile call) and `src/spec-decision-stage.ts`
  (the fold call) pass `profile.verification`.
- Modify: `test/fixtures/harness/emit-spec-stage.mjs` — one new marker mode.
- Modify: `test/prompts.test.ts`, `test/spec-stage.test.ts`, `test/spec-decision-stage.test.ts`.

**Steps:**
- Read the three source files and the emitter to end of file before editing.
- Reconcile prompt: place the block and these lines, each one source line, after the
  paragraph that ends "A report's severity, or how serious a risk sounds, does not by
  itself make a finding blocking.": "A finding whose question begins `Verification:` is
  the open decision you disclosed about the verification commands, and it is the one
  exception to the rule above: choose upstream_blocking for it, because the commands
  decide whether the delivered code is accepted at all."; "Its question's options must
  each name the stack or layout the commands would then accept and the declared
  artifact paths that needs, written as answers that can be folded into the
  specification as it stands."; "Never restate a command as an acceptance criterion."
  Leave the existing blocking rule's wording unchanged. Use none of `self-critique` or
  `spec reviewer`, and none of the scrape markers.
- Fold prompt: place the block and these lines before `Design document:`: "An answer
  to a question that begins `Verification:` may name a stack, a layout and declared
  artifact paths: fold exactly the paths it names into ## Declared artifacts, grounded
  in that answer, and nothing the answer does not state."; "Never restate a command as
  an acceptance criterion." Use none of `self-critique`, `spec reviewer` or
  `reconcile`; the fixture recognizes the fold by its own heading after those checks.
- Emitter: add the marker `FIXTURE-DISCLOSE-VERIFICATION-OD`, handled beside
  `FIXTURE-DISCLOSE-OD` in `authoredSpec`, which discloses one open decision whose
  text begins `Verification:`. Do not change how any existing marker routes.
- Route test in `test/spec-decision-stage.test.ts`, shaped like the existing disclosed
  decision tests: with that marker and `FIXTURE-ASK-EVERY` in the design, the run
  reaches `awaiting_decision` with a question whose finding is that open decision;
  answering it with text naming an artifact path runs the fold; the fold dispatch's
  prompt contains the frozen commands and the answer; the run proceeds to approval.
  State in the test that it proves the pipeline carries a `Verification:` question and
  that the reconciler's choice of route is the fixture's, not the model's.
- Update every existing call to the two builders in `test/prompts.test.ts` (the
  reconcile and fold tests, `routingPrompts`, and the compose test). Add the
  rendered-lines, ordering and rule tests; add the sentences to `CONSTRAINT_STRINGS`.
- Wiring tests, same shape as Task 2: the reconcile row differs between two frozen
  configs in `test/spec-stage.test.ts`; the fold row differs in
  `test/spec-decision-stage.test.ts`.
- Break it: (a) delete the exception sentence from the reconcile prompt, and its
  per-builder test must fail; (b) `{ commands: [] }` at the fold call site fails the
  fold wiring test; (c) the word `self-critique` in either new text fails the router
  or compose test.
- Verify: `node --test test/prompts.test.ts test/spec-stage.test.ts test/spec-decision-stage.test.ts`
- Expected: pass; each break fails the named test.

**Task completion evidence:** test output and the three break-it results.

### Task 4: The implementer prompt

**Depends on:** Task 2

**Files:**
- Modify: `src/prompts.ts` — `buildImplementationAuthorPrompt` takes a required
  `verification: VerificationConfig` last parameter.
- Modify: `src/implementation-stage.ts` — the call site passes `profile.verification`.
- Modify: `test/prompts.test.ts`, `test/implementation-stage.test.ts`.

**Steps:**
- Read both source files to end of file before editing.
- Place `verificationCommandsBlock` and two lines after the "do not exist yet" list
  and before `Tasks for this phase`: "These commands first run after the last phase,
  and again after any code-review remediation, so a phase that leaves one of them
  failing is not by itself a defect."; "Before you choose a file's content, read what
  each command runs (for an npm command, its entry under scripts in package.json) and
  write files that command will accept." Do not add a rule telling the implementer to
  return `blocked` when it thinks a command cannot pass (see Out of scope).
- The existing scrape contracts must still hold. The assertions at the scope-block
  test, the exists/missing list test and the phase tests keep passing unchanged; add
  one assertion that no `- <name>: <command>` line falls inside the scope block or
  either path list.
- Update every existing call to the builder in `test/prompts.test.ts`. Add the
  rendered-lines and ordering test for this builder.
- Wiring test in `test/implementation-stage.test.ts`: extend `withApprovedRun` with
  an optional `verification` argument; after the success-path run, rebuild the
  phase-1 prompt with the builder using the gate event's `base`, the stage's plan and
  spec text, `SCOPE`, the first phase from `planPhases`, `existingPaths` of `[]`, and
  the frozen config, and assert its hash equals the first `agent_run.input_hash`. If
  the hashes differ for a reason other than the commands, stop and report; do not
  loosen the assertion.
- Break it: pass `{ commands: [] }` at the call site, and the wiring test must fail;
  move the block inside the scope list, and the scrape-contract assertion must fail.
- Verify: `node --test test/prompts.test.ts test/implementation-stage.test.ts`
- Expected: pass; both breaks fail.

**Task completion evidence:** test output and the two break-it results.

### Task 5: The plan prompts, including reconcile (may be dropped as a unit)

**Depends on:** Task 2

**Files:**
- Modify: `src/prompts.ts` — `buildPlanAuthorPrompt`, `buildPlanSelfCritiquePrompt` and
  `buildPlanReconcilePrompt` take a required `verification: VerificationConfig` last
  parameter.
- Modify: `src/plan-stage.ts` — the three call sites pass `profile.verification`.
- Modify: `test/prompts.test.ts`, `test/plan-stage.test.ts`.

**Steps:**
- Read both source files to end of file before editing.
- Draft and self-critique: place the block and one line after the scope list and
  before `Approved specification:`: "The system runs these commands itself: never
  write a task that runs, repeats or checks them, because a task that changes no file
  in the approved scope has nothing to return and blocks the run."
- Reconcile: place the block and this line before `Approved specification:`: "The
  system runs these commands itself: never add a task that runs, repeats or checks
  them, because a task that changes no file in the approved scope has nothing to
  return and blocks the run." It does not tell the reconciler to remove any task.
- Use none of `self-critique` (draft and reconcile), `plan reviewer`, or the string
  `Approved specification:` inside the new text; `reconcile` is allowed only in the
  reconcile prompt, which already carries it.
- Update every existing call to the three builders. Add the rendered-lines test per
  builder and the scope-scrape check (`name only these:` list still ends at its first
  blank line).
- Wiring tests in `test/plan-stage.test.ts`, the same shape as Task 2: two frozen
  configs, and the author, self-critique and reconcile hashes differ while the
  reviewer rows are equal.
- Break it: `{ commands: [] }` at the reconcile call site fails the wiring test; the
  word `plan reviewer` in a sentence fails the router tests.
- Verify: `node --test test/prompts.test.ts test/plan-stage.test.ts`
- Expected: pass; both breaks fail.

**Task completion evidence:** test output and the two break-it results.

### Task 6: Documents

**Depends on:** Tasks 2-5

**Files:**
- Modify: `docs/hazards.md` — new entry 21.
- Modify: `ARCHITECTURE.md` — section 7 (one sentence after the `governed.yaml`
  paragraph), section 8 (the open-decisions paragraph), section 12 (the
  `spec_decision` paragraph), section 22 (count and list).
- Read first, edit only if they contradict the change: `README.md`,
  `docs/runbooks/cli-operator.md` (it holds uncommitted operator edits; keep them
  out of this change), `.claude/skills/run-buildworks/SKILL.md`.
- Not edited: `CLAUDE.md`, `AGENTS.md`, any historical document.

**Steps:**
- Hazard 21, "Agents are never told the gate that will judge their work": the run 10
  measurement in the Replay section above, with its cost and what each figure
  comes from; the mechanism (no prompt carried the commands; spec and plan
  dispatches inherit the launch directory, which was the BuildWorks checkout in run
  10, per the Task 1 fixture; scope is signed before the implementer can read the
  target); its cousin, run 6's Next.js scaffold objection (entry 20); the requirement
  (state the frozen commands to every agent whose output they judge, with a
  human-gated outlet where the author cannot inspect the target). Say what it does not
  show: model compliance and question frequency are unmeasured; the reconciler's route
  is a prompt rule, so a follow-up route can still pass; code-review remediation is not
  informed; the launch-directory gap stays; an oversize `governed.yaml` blocks at the
  first dispatch it overflows, possibly after spend; the stage emitters still route
  over embedded data.
- Section 7: the frozen commands are stated to the spec, plan, reconcile, fold and
  implementer prompts. The spec and plan authors may not be able to read the target
  and `governed.yaml`; the implementer can read it in its worktree but was never told
  it governs the run.
- Section 8: add the second kind of open decision (a `Verification:` question, asked
  when the declared artifacts cannot be shown to satisfy the frozen commands) beside
  the existing limit, so the paragraph is not contradicted by the prompt.
- Section 12: state that the reconcile prompt names that question as the one exception
  that routes `upstream_blocking`, as a prompt rule the model may not follow.
- Section 22: update the stated count and add the new failure mode to the list; the
  checker derives the count from the hazard headings.
- Run `npm run check:docs` after each file.
- Verify: `npm run check:docs`
- Expected: clean; warnings only from historical documents.

**Task completion evidence:** `check:docs` output.

### Task 7: Full verification

**Depends on:** Tasks 1-6

**Steps:**
- `npm run typecheck` (the root `tsconfig.json` includes `test/` except
  `test/dashboard-ui.test.ts`, which calls none of these builders, so a stale builder
  call in a test fails here).
- `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about 11
  minutes; keep the file glob). Compare against the known failures recorded in the
  project learnings; do not assume them. The full suite has not run since the
  phased-implementation work, so a failure unrelated to this change may predate it.
- `git log -1` and `git status --short`: a stray empty "moved" commit is dropped
  only after `git diff <prior> HEAD` is empty.
- `node .claude/skills/run-buildworks/driver.mjs smoke`
- Expected: typecheck clean; no failure beyond the known list; smoke `13/13 steps as
  expected`.
- Report what was not run: any paid run.

**Task completion evidence:** the four outputs, with failures named.

## Out of scope

- A paid run. This plan authorizes none. The only way to learn whether authors raise
  the question, the reconciler routes it blocking, or implementers read the build
  script is a live run; it needs its own operator authorization.
- Running spec, plan and review dispatches in the target (operator chose prompts
  only). Hazard 21 records the gap.
- The code-review remediation prompt (operator, 2026-10-05: reconcile and fold only).
  Changing it together with the spec and plan reconcile prompts would span the
  `code_review`, `spec_review` and `plan_review` prompts in one change, against the
  working rule not to change `spec_review` or `plan_review` while maintaining the
  `code_review` loop. The residual is a remediation patch written without being told
  the commands that judge it.
- A deterministic refusal for a `Verification:` question the reconciler routes as a
  follow-up (operator chose a prompt rule only). Revisit if a measured run shows the
  reconciler following it up.
- A pre-spend bound on `governed.yaml`'s command count and token length. It changes
  what the file accepts. The defined behavior until then is the existing refusal at
  `dispatchOnce`; revisit if a real config approaches the ceiling.
- Anchoring the stage emitters' routing to the instruction text rather than the whole
  prompt. The exposure already exists for design text and the `FIXTURE-*` modes rely
  on it; the routing guard in Task 2 keeps fixture command data clear of the markers.
  Revisit if a valid fixture needs a routing word as command data.
- An outlet for the implementer or plan author to return `blocked` when they think a
  command cannot pass. That is a model judgement with no human in it, and a false
  block is terminal for the run. Revisit only if a measured run shows implementers
  noticing the conflict with no way to say so.
- The reviewer prompts.
- The baseline-verification gate (operator chose the runbook check, 2026-10-05) and
  any change to the `governed.yaml` format.
- The team-notes target and its `governed.yaml`.

## Open decisions for the operator

1. **Keep Task 5 (the plan prompts)?** It now includes the plan reconcile pass, which
   is the pass that could add a verify-only task after the draft obeyed the rule, so
   dropping it reopens that risk. The plan author cannot read the target and the scope
   is already signed, so its rules have the least to act on. Default: keep, because
   you named the plan prompts; dropping it leaves Tasks 1-4, 6 and 7 intact.
   Resolved 2026-10-06: kept, and built as Task 5.

## Implementation note

Implemented 2026-10-06. Nothing is committed. One paid run followed the
implementation, at the operator's request the same day (see "Paid run" below).

**What shipped.** Eight prompt builders in `src/prompts.ts` state the run's frozen
commands, each with its role's rule; the four stages that call them pass
`profile.verification`. The spec author can record a `Verification:` open decision,
the reconcile prompt names it the `upstream_blocking` exception, and the fold prompt
folds exactly the declared paths the answer names. The plan prompts forbid a task
that runs the commands; the implementer prompt says when they first run. Tests cover
each builder, the wiring from the frozen profile (two configs, rebuilt prompt
hashes), the oversize-config refusal, fixture routing, and the route through
`spec_decision`. The run 10 context is recorded in
`test/fixtures/recorded/run-10-dispatch-context.json`. Hazard 21 and `ARCHITECTURE.md`
sections 7, 8, 12, 13 and 22 are updated.

**Verification.** `npm run typecheck` and `npm run check:docs` are clean. The full
serial suite ran 1,393 tests: 1,385 passed, 6 skipped, 2 failed. Both failures
reproduce on a clean copy of HEAD `c1471b5` and sit in files this change does not
touch: `test/sign-approval.test.ts` "nothing under src/ touches a private key"
(`src/dashboard-approval.ts` matches `/private[ -]?key/i`) and
`test/dashboard-server.test.ts` "dashboard CLI prints one bootstrap URL" (Node prints
an SQLite `ExperimentalWarning` to stderr). No stray commit followed the run. The free
smoke printed `13/13 steps as expected`. After the review fixes below, ten test files
that build or consume these prompts were run again: 349 tests, 348 passed, 1 skipped.
Every break-it in Tasks 2-5 failed the test it was meant to, in a scratch mirror with
the repository's hashes unchanged.

**Independent review.** One fresh-context subagent, which shares this session's
harness, so its independence is unverified (hazard 14). It reported four low findings
and none above. All four were checked against the code and accepted:
1. The reconcile exception said "the rule above", but the commands block now sits
   between it and the blocking test, and it showed the subject as `OD-001`. It now
   names "the upstream_blocking test above" and writes `OD-<n>`; a test checks that
   test sits above the exception.
2. The plan prompts said a task that changes no scope file "blocks the run". The stage
   blocks only when a whole phase returns no patch. They now say it can leave a phase
   with nothing to return.
3. Hazard 21 said only the implementation stage sets a working directory; the
   code-review stage does too. Corrected there and in this plan's Known blockers. The
   hazard also pointed at a runbook check that exists only in an uncommitted edit; the
   reference is gone.
4. In `ARCHITECTURE.md` section 12 the new paragraph split "With no question open" from
   "Otherwise". It moved to the end of the `spec_decision` text, and section 13 now
   names the exception.

**Paid run.** Operator-authorized on 2026-10-06 ("a paid run of the small web
calculator first"): `driver.mjs paid --yes --model claude-sonnet-5-5` with the
committed `web-calculator-design.md`. It made 15 dispatches for $1.61751 and
completed: 15 of 15 driver steps, `verify-audit` valid, one clean code-review panel
and no remediation, 3 of 3 declared artifacts delivered. The scratch target is
preserved at `C:\Users\Shawn-work\AppData\Local\Temp\bw-run-skill\1791327638429\target`.
The first spec-author `agent_run.input_hash` equals the hash of
`buildSpecAuthorPrompt` rebuilt from the frozen profile's commands, and differs from
the hash with no commands, so the live prompt carried them. The driver freezes only
`node --version` and `npm --version`, so no `Verification:` question was due: the spec
review recorded 8 open decisions, all `upstream_follow_up`, with 8 proposals and 0
operator questions. The 20-task plan split into 2 phases and both implementer
dispatches succeeded. The cost is not comparable to the $1.66350 of 2026-09-29 (14
dispatches, 4 artifacts). This run does not show the question path, the reconcile
exception, the fold, or a real build command; those need a target whose frozen
commands read the code, and a separate authorization.

**Deviations from the plan.**
- The reconcile exception is keyed on the finding subject `OD-<n>: Verification:
  <question>`, not on "a finding whose question begins". The reconciler sees only the
  subject, and the fold prompt can recognize the question only by its text, so the
  reconcile prompt also tells the reconciler to begin the question's text with
  `Verification:` and to write each declared path exactly as it would be declared.
- The Task 3 route test uses `FIXTURE-ASK-OPERATOR`, not `FIXTURE-ASK-EVERY`, and
  stops at the passed `spec_decision` gate without invoking approval.
- The Task 3 router break-it (a `self-critique`-style word in new text) surfaces in the
  compose test, which runs the real emitters, as well as in the per-builder tests.
- `scripts/doc-check.mjs` changed, which the plan did not list: its hazard-count word
  map stopped at `twenty` and its pattern stopped at a hyphen, so "twenty-one" in
  section 22 could not be read. It now maps `twenty-one` and accepts a hyphenated word.
  Both failure modes were shown in a scratch mirror.
- The plan prompts' sentence reads "can leave an implementation phase with nothing to
  return, and that blocks the run", not the Task 5 wording (review finding 2).

**Deferred.**
- A paid run that exercises the new rules. The 2026-10-06 calculator run could not,
  because its frozen commands only print versions. Whether models follow the rules,
  how often a spec author asks, and what that costs the operator in pauses are all
  unmeasured.
- The runbook and README do not tell an operator that the decision prompt may now
  appear on most runs launched outside the target. The runbook holds uncommitted
  operator edits, so it was left alone.
- Everything in Out of scope above, unchanged: code-review remediation is not told the
  commands, spec and plan dispatches keep the launch directory, `governed.yaml` has no
  pre-spend size bound, the reconciler's route is a prompt rule, and the stage emitters
  still route over the whole prompt.
- The two failing tests above, which predate this change.
