# Per-Agent Model and Effort Configuration Plan

**Status:** Implemented

**Goal:** Make the model and the effort level of every dispatching agent, and of
the reconciler, a frozen per-run setting, with defaults the operator can change
in one place and per-run overrides on `bw new-run`. Today one `--model` value
covers every dispatch, and no effort level is passed at all.

**Source:** Three operator statements in this conversation.
1. Original (2026-09-27): run the reviewer role on a cheaper model (for example
   Haiku) while a strong model acts on findings, parameterized rather than
   hard-coded. The first draft of this plan added six per-role model keys beside
   the existing stage-keyed `modelMap`. Operator scope decision then: code_review
   has no LLM reconciler, so no third slot is invented there.
2. Revision (2026-09-29): "All agents should have model and effort
   configurable. Every one of them in there and we can set defaults." New models
   shipped the week before. The trigger was team-notes run 5: the `implementer`
   (Sonnet, default effort `high`) spent four consecutive 64,000-token responses
   entirely on thinking and the CLI failed with `Claude's response exceeded the
   64000 output token maximum` (`.claude/sessions/project-learnings.md`, Current
   state, External target). Effort is the documented control for thinking volume:
   https://platform.claude.com/docs/en/build-with-claude/effort.
3. Refinement (2026-09-29, after talking with others): the spec author is its own
   model, "a model like Opus", at a high or very high effort. Reviewers get a low
   or medium effort, "definitely not high", to be tuned by trial. Haiku "should be
   available and is the popular choice for individual reviewers"; if that is a
   problem, swap to Sonnet at the effort wanted, likely low. The implementer is
   configurable in model and effort like the others. **The reconciler gets its own
   model and effort.** "None of that matters now because we can configure to
   however we want afterwards": the defaults below are starting values the
   operator changes, not requirements.
4. Reconciliation of the 2026-09-29 review (2026-09-29): a run must never put a
   reviewer at `high` or above by accident, so a run-wide `--effort` does not reach
   reviewers; an explicit `--effort-for` may still set a reviewer to any level up to
   `max`, but not `ultracode`. `agent_run` records which setting governed each row.
   The failed-dispatch audit summary names the requested model and effort. The cost
   of a failed dispatch stays out of scope, stated in the plan.

This revision replaces the first two drafts. Neither had a review record or an
implementation, so nothing depends on their keys.

## Facts this plan rests on

- **[Verified 2026-09-29, `claude` 2.1.284]** `claude --help` lists
  `--effort <level>` with `(low, medium, high, xhigh, max)`. The CLI reference
  (https://code.claude.com/docs/en/cli-reference) also accepts `ultracode` and
  says the flag "overrides the `modelSettings` and `effortLevel` settings for
  this session and does not persist".
- **[Verified 2026-09-29]** An unknown value is not an error:
  `claude --effort nonsense --version` printed `Warning: Unknown --effort value
  'nonsense' — ignoring it and using the default effort. Valid values: low,
  medium, high, xhigh, max.` and exited normally. That probe ran the flag parser
  on `--version`; it did not dispatch. A typo therefore runs at the default level
  with a warning on stderr, which the harness retains but does not read.
  BuildWorks must refuse a bad level itself, when the run starts.
- **[Verified from the docs page above, not by running it]** The effort docs list
  these models as supporting effort: `claude-fable-5-1`, `claude-fable-5`,
  `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`,
  `claude-opus-4-6`, `claude-opus-4-5-20251101`, `claude-sonnet-5-5`,
  `claude-sonnet-5`, `claude-sonnet-4-6` (plus Mythos models). **`claude-haiku-4-5`
  is not in the list.** `xhigh` is not available on every model that supports
  `max` (Opus 4.6 and Sonnet 4.6 lack it). Defaults: `high` on every supporting
  model except Opus 5.5, which defaults to `medium`. Setting the default level
  explicitly behaves the same as omitting the parameter.
- **[Verified from the docs]** Effort applies to all output tokens, including
  thinking and tool calls. It is "a behavioral signal, not a strict token
  budget". For Sonnet 5.5 the docs suggest starting agentic coding at `medium` for
  well-specified tasks and `high` for harder or longer ones. Thinking counts
  toward `max_tokens`.
- **[Verified in the retained run 5 stream]** The `system` init line carries
  `per_turn_effort_active` but no effort level, and the result line carries none
  either. **Effective effort cannot be recorded; only requested effort can.** This
  mirrors how `agent_run` records requested and effective model, except that the
  effective half does not exist for effort.
- **[Verified in the retained run 5 stream, count only]** Thinking still produces
  stream output. Each of the four 64,000-token thinking messages carried 380-402
  `thinking_delta` events, every one with an empty `thinking` string (the thinking
  text is hidden; the events are not). So the idle timer is fed during heavy
  thinking, which answers the streaming plan's open question for this run. The
  stream carries no timestamps, so no gap was measured, and the run was never
  close to the 1,800 s idle budget. The streaming reference
  (https://platform.claude.com/docs/en/build-with-claude/streaming) describes the
  API's own events, including mid-stream `error` events such as
  `overloaded_error` that can follow a 200. The Claude CLI consumes those; this
  harness sees only the CLI's `stream-json` and its exit code, so the page changes
  nothing else here.
- **[Verified 2026-09-29, Task 0, five real dispatches, $0.0349 total, recorded in
  `test/fixtures/recorded/claude-effort-flag-probes.json`]** With the executor's own
  flags plus `--model` and `--effort`, a one-word prompt:
  - `claude-haiku-4-5-20251001` at `low` and at `medium`: exit 0, empty stderr, result
    `OK`, no error, the requested model was the effective model. **Haiku takes
    `--effort`.** It wrote 34 and 26 thinking tokens for a one-word answer, so the
    probe shows the flag is accepted, not that effort changed anything on Haiku.
  - `claude-opus-5-5` at `high`: exit 0, `OK`. The operator's account can call it.
  - `claude-sonnet-4-6` at `xhigh`, a level the docs say it lacks: exit 0, empty
    stderr, `OK`. **The CLI neither errors nor warns.** Whether it clamps or ignores
    the level is not observable from this probe.
  - `claude-sonnet-5-5` with `--effort nonsense`: exit 0, `OK`, and stderr held
    `Warning: Unknown --effort value 'nonsense' — ignoring it and using the default
    effort.` This confirms in a real dispatch what the `--version` probe showed.
  - A one-word prompt cannot show whether effort changes model behavior. Nothing here
    measures review quality.
- **[Unknown]** Whether `--effort` changes Haiku's behavior at all, and what a level
  the model does not support does inside the CLI (clamp or ignore). Neither blocks the
  plan: the harness passes the requested level and records it.
- **[Inference from the docs, not tested]** `--restricted` (already in the
  executor command) loads only managed settings and `--settings`, and
  `envPassthrough` names no effort variable, so ambient user `effortLevel`
  settings and `CLAUDE_CODE_EFFORT_LEVEL` should not reach a dispatch. The
  explicit `--effort` flag outranks them regardless; its documented precedence is
  the guarantee relied on.

## Open decisions for the operator

Items 1-3 below carry your 2026-09-29 statements. The rest adopt a recommended
choice; change the plan before implementation if you choose otherwise.

1. **Settings names: the nine registered agents plus `reconciler` (your
   decision).** The agents in `src/agents.ts` are `spec-author`, `plan-author`,
   `implementer`, `spec-reviewer-traceability`, `spec-reviewer-security`,
   `spec-reviewer-consistency`, `code-reviewer-correctness`,
   `code-reviewer-security`, `code-reviewer-state-integrity`. Each has one model
   and one effort. `reconciler` is a tenth setting, **not** a registered agent:
   it governs the three reconciliation dispatches, which today run as
   `spec-author` and `plan-author` with a reconcile prompt (the spec and plan
   reconciliation in the review round, and the decision fold after an operator
   answers). Those dispatches still record `agent` as the author agent; the
   settings name only decides which model and effort they request. An author
   agent's draft and self-critique dispatches use its own setting. `implementer`
   covers both the implementation stage and the code-review remediation. **One
   `reconciler` setting covers spec and plan** (operator decision, 2026-09-29; the
   first draft had two).
2. **Seeded defaults, from your statements (final, 2026-09-29).** `spec-author`:
   `claude-opus-5-5` at `high` (raise to `xhigh` per run). The three spec reviewers:
   Haiku (`claude-haiku-4-5-20251001`) at `medium`; Task 0 showed Haiku accepts
   `--effort` at `low` and `medium` and answers. The three code reviewers:
   `claude-sonnet-5-5` at `medium`. `implementer`: `claude-sonnet-5-5` at `medium`
   (operator decision, 2026-09-29). `reconciler`: `--model` at `medium` (operator
   decision, 2026-09-29). Not specified by you, so a guess to confirm: `plan-author`
   at `--model`, `high`. **None of these levels is measured for this workload, and
   neither Haiku's nor Sonnet's review quality is.** One risk is recorded rather than
   argued: run 5's implementer failure happened at `high` effort, on
   `claude-sonnet-5`. The implementer is now seeded one level lower, at `medium`,
   which the effort docs suggest for well-specified agentic coding. Sonnet 5.5's
   levels are documented as recalibrated relative to Sonnet 5, so run 5 is not
   evidence about 5.5 at either level, and nothing measured shows that `medium`
   avoids the output-cap failure. Raising it stays a one-line change
   (`--effort-for implementer=high`, or the constant).
3. **Reviewers are never seeded at `high`, and a run-wide `--effort` never reaches
   them (operator decision, 2026-09-29).** The six reviewer settings (every
   registered agent whose `role` is `reviewer`) start at the seeded `medium` and move
   only through their own `--effort-for`, to any level in the closed set up to `max`.
   Enforced by the seeded values, the resolution rule and a test on each. There is no
   cap on an explicit `--effort-for`: naming a reviewer is the deliberate act.
4. **Flag shape: three optional flags with comma lists.** `--effort <level>` sets
   the run-wide effort for every non-reviewer setting without its own value; `--model-for
   <name>=<model>[,...]` and `--effort-for <name>=<level>[,...]` set one setting
   each, where `<name>` is an agent id or `reconciler`. `parseArguments` rejects a
   repeated option (`src/cli-args.ts:215`), so repeatable flags would need a
   parser change; twenty fixed flags would be unreadable. Model names and setting
   names contain no `,` or `=`, so the lists parse unambiguously.
5. **Excluded effort level: `ultracode`.** The CLI accepts it as `xhigh` plus a
   separate feature. The closed set here is `low`, `medium`, `high`, `xhigh`,
   `max`, matching the API docs.
6. **Guided mode is unchanged in what it asks.** `buildworks [<path>]` still
   prompts for one model and passes no overrides. That one model now covers only
   the settings whose default model is null (`plan-author` and `reconciler`); the
   other settings take the seeded defaults, so a guided run dispatches Opus, Sonnet
   5.5 and Haiku without being asked.
7. **Stage-command `--model` keeps its meaning as an assertion.** `bw spec`,
   `plan`, `implement` and `review` accept `--model` today only to confirm it
   equals the frozen value (`src/spec-stage.ts:145`). It will assert against the
   stage's author setting (`spec-author`, `plan-author`, `implementer`; `review`
   asserts against `implementer`). Nothing in the README, runbook or driver passes
   `--model` to those commands; only `new-run --model` appears there.
8. **`--model` names only the settings whose seeded model is null.** After seeding
   that is `plan-author` and `reconciler`. `bw new-run --model claude-sonnet-5`, the
   form the driver, README and runbook use, dispatches the seeded Opus for
   `spec-author`, Sonnet 5.5 for `implementer` and the code reviewers, and Haiku for
   the spec reviewers. The `new-run` help text, README and runbook say which
   settings `--model` covers (Tasks 5 and 6). Cost moves toward Opus. Task 0 priced
   one one-word prompt at $0.0125 on Opus 5.5 and $0.0066 on Sonnet 5.5, but the
   same prompt cost Haiku $0.0042 at `low` and $0.0008 at `medium`, so that noise
   exceeds the model difference and the real ratio for a spec-author dispatch is
   unmeasured. The paid driver's recorded costs assume one model and become stale
   (Task 6). Run 5 ended at 82 percent of both usage windows.

## Assumptions

- Precedence when resolving one setting, frozen at `new-run`:
  model = `--model-for` for that name, else the seeded default model for that name
  (null for some), else `--model`;
  effort = `--effort-for` for that name, else (non-reviewer settings only)
  `--effort`, else the seeded default effort for that name. `--model` stays
  required.
- The seeded defaults are code constants in `src/policy.ts`, read only at freeze
  time. The profile freezes the resolved values, not the defaults, so a later edit
  to the constants never changes a frozen run (hard rule 6).
- Model names are validated for shape only, exactly as today. No per-model
  effort-support table is kept: a table authored now is a moving list
  (hazard 10). Whether a level works on a model is not knowable from the CLI: Task 0
  showed it accepts a level the docs say a model lacks, silently.
- Seeded defaults use full model IDs, not aliases such as `opus` or `haiku`, so the
  frozen profile names one model. Whether the operator's account can call each
  seeded model is not checked by `doctor` and is not established here.
- `ARCHITECTURE.md` section 10 already says a stage names what it needs and
  configuration resolves it, and requires requested and effective model to be
  recorded separately. This plan keeps both and adds effort under the same rule,
  with the stated limit that effective effort is not observable.

## Approach

1. `src/policy.ts` gains `EFFORT_LEVELS` and `DEFAULT_SETTINGS`, one entry per
   registered agent plus `reconciler`.
2. The frozen profile's `modelMap` (keyed by stage kind, six entries) is
   **replaced** by `dispatchSettings` (keyed by setting name, one `{ model,
   effort }` each). One schema per thing (hard rule 3): the two maps do not
   coexist. `resolveStageModel` is replaced by `resolveSettings`.
3. `invokeHarness` appends `--effort <level>` next to `--model`, always,
   explicitly. The executor definition is unchanged, so runs frozen earlier are
   not refused by `requireFrozenBinding`. They are refused by `invalidProfileReason`
   because they carry `modelMap` and no `dispatchSettings`, by name, and a fresh run
   is the repair (the same consequence the executor comment cites for a changed
   executor). For the stores of runs already frozen (team-notes runs 1-5 and the
   older ones), `readRunSnapshot` (`src/operator-state.ts:304-324`) reports the
   refusal reason as a limitation and shows no configuration, so the dashboard's
   configuration panel is empty for them; that matches the earlier profile-shape
   refusals.
4. Every dispatch site passes the settings its setting name resolves to: the agent's
   own name for draft, self-critique, review and implementation dispatches, and
   `reconciler` for the three reconciliation dispatches, and it passes that setting
   name as well. `agent_run` gains nullable `requested_effort` and `setting`
   columns (migration 008), so a row says which setting governed it; nothing has to
   infer that from row order. A failed dispatch writes no `agent_run` row, so its
   `agent.dispatch.failed` audit summary names the requested model and effort.
5. `new-run` gains the three flags; status, doctor and the dashboard display
   `dispatchSettings`.

## Affected areas

`src/policy.ts`, `src/profile.ts`, `src/harness.ts`, `src/dispatch.ts`,
`src/store.ts`, a new `src/migrations/008_agent_run_effort.sql`,
`src/spec-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts`,
`src/code-review-stage.ts`, `src/spec-decision-stage.ts`, `src/operator-state.ts`,
`src/operator-output.ts`, `src/cli-args.ts`, `src/cli.ts`, `src/run-intake.ts`,
`src/dashboard/app.js`, a new test helper `test/uniform-profile.ts`, tests, and docs
(`README.md`, `docs/runbooks/cli-operator.md`, `ARCHITECTURE.md`, `CLAUDE.md`,
`AGENTS.md`, `.claude/skills/run-buildworks/SKILL.md`). `src/executor.ts` and
`src/guided-command.ts` are not edited.

## Known blockers

None. Task 0 ran on 2026-09-29 and settled what blocked the defaults: Haiku takes
`--effort`, so Task 1 seeds Haiku for the reviewers. The remaining unknowns (whether
effort changes Haiku's behavior, and what the CLI does inside for an unsupported
level) do not change any task: the harness passes the requested level and records it.

## Blast radius

Enumerated by search on 2026-09-29 (`resolveStageModel|modelMap` under `src/`,
`test/`, and `*.mjs`). Each site is accounted for.

- `src/profile.ts:45` (`modelMap` field), `:190` (`freezeProfile` literal), `:236`
  (`resolveStageModel`), `:294-297` (`invalidProfileReason`): replaced (Task 2).
- `src/spec-stage.ts:130,139` (resolves `spec` and `spec_review`), `:145` (`--model`
  assertion), `requestedModel` at `:243` (draft) and `:307` (self-critique), both
  the author's setting; `:494` (per-seat reviewer dispatch), the seat agent's
  setting; `:578` (reconciliation), the `reconciler` setting: Task 4.
- `src/plan-stage.ts:117,126` (resolves `plan` and `plan_review`) and
  `requestedModel` at `:284` (draft) and `:368` (self-critique), the author's
  setting; `:542` (reviewer seat); `:626` (reconciliation, `reconciler`): Task 4.
- `src/implementation-stage.ts:93` and `requestedModel` at `:385`: the
  `implementer` setting, Task 4.
- `src/code-review-stage.ts:108` (resolves `code_review`), `requestedModel` at
  `:407` (reviewer dispatch, the seat agent's setting) and `:613` (remediation, the
  `implementer` setting; `agent: author.id` at `:611`): Task 4. There is no
  reconciler here.
- `src/spec-decision-stage.ts:240` (resolves `spec` for the fold) and
  `requestedModel` at `:309`, with `agent: author!.id` at `:307`: the fold is a
  reconciliation, so it takes the `reconciler` setting, Task 4.
- `src/operator-state.ts:83` (type), `:286` (snapshot), `:311` (string check), `:522`
  (`frozenGroupReasons` loop over stage kinds, with the decision group mapped to
  `spec`): Task 5. This loop also decides pre-flight readiness, so it must check
  every setting the group will dispatch.
- `src/cli.ts:134` (doctor's `frozen_models` check), `:279-287` (`dispatch` case
  resolves by `stage.kind` and asserts `--model`), and the `--model` pass-throughs at
  `:338`, `:362`, `:386`, `:430`: Task 5.
- `src/operator-output.ts:56` prints `JSON.stringify(...modelMap)`: Task 5.
- `src/dashboard/app.js:3415` and `:4056` read `configuration.modelMap ?? {}`.
  **After the rename these would silently render an empty model list**, not fail.
  Task 5 changes both and adds a test.
- `src/executor.ts`: not edited. `--effort` is added per invocation in
  `invokeHarness`, as `--model` already is (`src/harness.ts:239`), so it is not part
  of the frozen executor definition.
- `src/verification-stage.ts` resolves no model and dispatches nothing: not touched.
- Tests referencing `resolveStageModel` or `modelMap`: `test/cli-operator.test.ts`
  (9), `test/profile.test.ts` (5), `test/plan-stage.test.ts` (4),
  `test/run-command.test.ts` (4), `test/operator-state.test.ts` (3),
  `test/implementation-stage.test.ts` (2), `test/spec-stage.test.ts` (2),
  `test/guided-command.test.ts` (1). The recorded fixture
  `test/fixtures/recorded/doctor-ambient-config-web-calculator-live-chain.json` (four
  `modelMap` mentions) is read by no test and no source file (searched by its
  stem 2026-09-29; only session and review notes name it): it is inert, stays as
  recorded evidence and is not edited.
- **Tests that encode the single-model contract**, counted 2026-09-29. Seeding
  changes what `freezeProfile` freezes, so a stage test that freezes model `"m"` and
  then runs a stage no longer matches the seeded author setting. `test/spec-stage.test.ts`
  passes `requestedModel: "m"` at 55 sites (56 references to `requestedModel`) and
  calls `freezeProfile(` twice (`:121`, `:1246`); `test/dispatch.test.ts` passes it at
  10 sites, but to `dispatchOnce` directly, so it is affected by Task 3's required
  fields and not by seeding. `freezeProfile(` has 47 call sites in 14 test files:
  `test/profile.test.ts` (31, Task 2), `test/spec-stage.test.ts` (2),
  `test/operator-state.test.ts` (3), and one each in `test/spec-decision-stage.test.ts`,
  `test/plan-stage.test.ts`, `test/implementation-stage.test.ts`,
  `test/code-review-stage.test.ts`, `test/run-command.test.ts` (these seven files
  dispatch or read a stage's model and go through the helper in Task 2 Step 5) and
  `test/approval-stage.test.ts`, `test/delivery-stage.test.ts`,
  `test/verification-stage.test.ts`, `test/dashboard-server.test.ts`,
  `test/code-review.test.ts`, `test/relative-evidence.test.ts` (six files that
  dispatch nothing and stay as they are unless a run shows otherwise). Which
  individual assertions fail is settled by running the files after Task 4, not by
  this list.
- Callers of `freezeProfile(`: `src/run-intake.ts` and the test files that call it
  positionally. The new parameter is appended after `deps` and defaults to `{}`, so
  the calls compile unchanged; the seven dispatching test files above still need the
  helper, because the frozen values change.
- The `status` and `doctor` `--json` output changes: `configuration.modelMap` becomes
  `configuration.dispatchSettings` and doctor's `frozen_models` check becomes
  `frozen_settings`. Hard rule 3 permits it. Searched 2026-09-29 for `modelMap`,
  `frozen_models` and `resolveStageModel` in `README.md`, `ARCHITECTURE.md`,
  `docs/runbooks/`, `src/dashboard/` and `.claude/skills/`: the consumers are
  `README.md:814` (the `configuration` field table names `modelMap`) and the two
  `src/dashboard/app.js` sites. `docs/runbooks/cli-operator.md:530` and
  `README.md:205,585` say "frozen models" in prose only.
- Docs: `README.md:78` and `:814`, `docs/runbooks/cli-operator.md:500` (the `new-run`
  example stays valid) and `:530`, `CLAUDE.md` and `AGENTS.md` (`new-run` bullet,
  identical wording), `ARCHITECTURE.md` sections 10, 11, 12 and the `agent_run` column
  list near line 1140. `scripts/doc-check.mjs:331` pins the table name `agent_run`,
  not its columns; `npm run check:docs` in Task 6 is what confirms that.
- The paid driver `.claude/skills/run-buildworks/driver.mjs` passes only
  `new-run ... --model`; it needs no change and takes the seeded defaults, which
  means its chains now dispatch the seeded Opus and reviewer models. Its skill file
  `.claude/skills/run-buildworks/SKILL.md` carries cost records measured under one
  model (`claude-sonnet-5`, lines 131-187 and 285) and the line "Start a new run to
  change the model" (`:410`); Task 6 marks the costs stale.

Line numbers were read from the checkout at commit `ff61dee` on 2026-09-29 and will
drift; find each site by the call, not the number.

**Out of scope, recorded so it is not lost:** the store carries no cost for a
dispatch that failed after producing a stream (`dispatchOnce` inserts an `agent_run`
row only on a parsed success). Run 5's failed implementer cost $2.92 by its own
result line and the store shows "unknown spend". This plan does not change that
(operator decision, 2026-09-29). The consequence is stated, not fixed: the implementer
is seeded at `claude-sonnet-5-5` and `medium`, one level below where run 5 failed at
`high` on `claude-sonnet-5`, and nothing here detects a repeat or shows that `medium`
avoids it. A repeat would cost about what run 5's did and the store would show
"unknown spend" again. The first paid run after implementation is the test of that
default (Task 7).

## Verification

`npm run typecheck`, the serial suite
`node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`,
`npm run check:docs`, and the per-task checks below. A paid run is **not** part of
this plan: whether `implementer` on Sonnet 5.5 at `medium` avoids the output-cap
failure, and whether Haiku spec reviewers and Sonnet code reviewers at `medium`
review well enough, need fresh runs under their own authorization. This plan claims component success only.

**Hazards considered:** 4 (fixtures and code agreeing while both are wrong): the
expected `--effort` argv comes from the CLI's own help text and the documented
level names, and Task 0 records real behavior; no hand-written value defines
correctness, and the argv guard is broken and restored before it is trusted. The
existing stage tests freeze a hand-written model `"m"`; they go through one helper
that freezes uniform settings rather than loosening the stage's `--model` assertion,
and the recorded probe fixture backs an argv test (Task 3). 7
(retries that vary nothing): run 5's failed dispatch cannot be retried with the same
prompt, context and model and expected to differ; effort is the axis this plan adds,
and it is frozen per setting before the retry, not passed ad hoc. 10 (exact-match
acceptance against moving aliases): the effort set is closed and checked by shape,
model names stay shape-checked, seeded defaults use full model IDs, and no per-model
support table is written; the explicit `--effort` flag also removes dependence on a
model's moving default (Opus 5.5 defaults to `medium`, the others to `high`). 11 (a
default installation that cannot complete a run): a test asserts `DEFAULT_SETTINGS`
covers every registered agent and `reconciler`, and that a run with no new flag
freezes valid settings for all ten. The test uses the fixture executor, so it does
not prove the account can call the seeded Opus or Haiku models; Task 0 did, for this
account on 2026-09-29, with single-turn dispatches of Opus 5.5 and of Haiku 4.5 at two
levels, which is why Haiku could be seeded. A machine without that access still fails
at its first dispatch of the missing model, and `doctor` does not check it. 12 (configuration
divergence, effective configuration visible): status, doctor and the dashboard show
the frozen settings, Task 5 names the dashboard site that would otherwise go
blank without an error, `--model` no longer means one model and the help text and
docs say what it covers, `agent_run` records the governing setting, and a failed
dispatch's audit summary names its requested model and effort. 14 (independence that cannot be proven): considered and not
applicable; it concerns process separation, which `dispatchOnce` already provides per
dispatch whatever model and effort are passed.

---

### Task 0: Record real CLI behavior for effort (operator-authorized spend)

**Depends on:** None

**Files:**
- Create: a recorded fixture under `test/fixtures/recorded/` with a `provenance`
  block (dispatch time, capture date, `claude` version, what was dropped)

**Steps:**

- **Step 1: State the spend and get authorization before running.** Single-turn
  dispatches of a trivial prompt through `claude -p` with the executor's flags plus
  `--model` and `--effort`: (a) `claude-haiku-4-5-20251001` at `low`, (b) the same
  at `medium`, (c) `claude-opus-5-5` at `high`, (d) `claude-sonnet-4-6` at `xhigh`,
  (e) `claude-sonnet-5-5` with `--effort nonsense`. Expected cost is on the order of
  cents and is **unmeasured** (the Opus dispatch is the largest); the operator
  authorizes it first, as for the streaming plan's recording. A completed paid probe
  never authorizes another.
- **Step 2: Record what each does:** exit code, stderr text, whether the result line
  reports an error, and any field that differs. Answer the two [Unknown] items:
  unsupported level on a model, and Haiku 4.5. (c) also shows that the operator's
  account can call the seeded Opus model.
- **Step 3: Decide the reviewer default and the validation rule from the evidence,
  not from this plan.** If Haiku takes `--effort` and answers, the reviewer default
  is Haiku at `low`. If Haiku rejects it, errors, or the result shows a problem, the
  reviewer default is `claude-sonnet-5-5` at `low` (the operator's stated fallback),
  and the plan records why. If an unsupported level errors or silently clamps, note it
  in `ARCHITECTURE.md` section 10 as a limit not checked at freeze. If the CLI needs
  `--effort` omitted for some model, this plan is amended before Task 3.
  - Verify: the fixture parses and names all five outcomes.
  - Expected: the two [Unknown] items are resolved or restated as still unknown.

**Task completion evidence:** the committed fixture and a dated note in this plan
stating the answers and the reviewer default chosen.

**Result (executed 2026-09-29, operator-authorized, $0.0349):** all five dispatches
exited 0. The fixture is `test/fixtures/recorded/claude-effort-flag-probes.json`, with
the `system` lines dropped (they carry machine paths and inventories) and recorded in
its `provenance`. Answers: Haiku takes `--effort` at `low` and `medium`, so Haiku is
usable as a reviewer default (the operator then chose `medium`, open decision 2). A level the docs say a model lacks
(`xhigh` on Sonnet 4.6) is accepted with no error and no warning. A nonsense level
warns on stderr and runs at the default. Opus 5.5 is callable from this account. No
per-model omission of `--effort` is needed, so Task 3 is unchanged.

---

### Task 1: Add the effort vocabulary and the seeded defaults to `src/policy.ts`

**Depends on:** Task 0

**Files:**
- Modify: `src/policy.ts`
- Validate: `test/policy.test.ts`, `test/agents.test.ts`

**Steps:**

- **Step 1: Add the constants.** After `CODE_REVIEW_BLOCKING_SEVERITY`, add:
  ```ts
  export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
  export type EffortLevel = (typeof EFFORT_LEVELS)[number];

  export const RECONCILER = "reconciler";

  export interface SettingDefault {
    /** null means "the run's --model". */
    model: string | null;
    effort: EffortLevel;
  }

  // Task 0 (2026-09-29): Haiku 4.5 accepts --effort at low and medium.
  const SPEC_REVIEWER: SettingDefault = { model: "claude-haiku-4-5-20251001", effort: "medium" };
  const CODE_REVIEWER: SettingDefault = { model: "claude-sonnet-5-5", effort: "medium" };

  export const DEFAULT_SETTINGS: Readonly<Record<string, SettingDefault>> = {
    "spec-author": { model: "claude-opus-5-5", effort: "high" },
    "plan-author": { model: null, effort: "high" },
    "implementer": { model: "claude-sonnet-5-5", effort: "medium" },
    [RECONCILER]: { model: null, effort: "medium" },
    "spec-reviewer-traceability": SPEC_REVIEWER,
    "spec-reviewer-security": SPEC_REVIEWER,
    "spec-reviewer-consistency": SPEC_REVIEWER,
    "code-reviewer-correctness": CODE_REVIEWER,
    "code-reviewer-security": CODE_REVIEWER,
    "code-reviewer-state-integrity": CODE_REVIEWER,
  };
  ```
  A comment states the values are starting points with no measurement behind them,
  that they are read only at freeze time, and that changing one affects new runs only.
  These constants are not part of `Policy` or `policyHash`: the profile freezes the
  resolved values (Task 2).
  - Verify: `npx tsc --noEmit`
  - Expected: compiles clean.

- **Step 2: Pin completeness and the reviewer rule.** In `test/agents.test.ts`, add a
  test that the keys of `DEFAULT_SETTINGS` equal the ids in `AGENTS` plus
  `"reconciler"` exactly, both directions, so a new agent cannot ship without a
  default and a removed agent leaves no orphan. In `test/policy.test.ts`, add a test
  that every registered agent whose `role` is `reviewer` has a default effort other
  than `high`, `xhigh` or `max` (operator statement 3).
  (Task 2 pins the other half: a run-wide effort does not reach reviewers.)
  - Verify: `node --test test/agents.test.ts test/policy.test.ts`
  - Expected: passes. Break each by deleting one entry, and by setting one reviewer
    to `high`; confirm the matching test fails by assertion; restore.

**Task completion evidence:** typecheck passes; both tests pass and each fails under
its break.

---

### Task 2: Replace `modelMap` with `dispatchSettings` in the frozen profile

**Depends on:** Task 1

**Files:**
- Modify: `src/profile.ts`
- Validate: `test/profile.test.ts`

**Steps:**

- **Step 1: Types.** Replace the `modelMap` field and its comment on `Profile` with:
  ```ts
  /** Per-setting model and effort, resolved once at run start (section 10). */
  dispatchSettings: Record<string, { model: string; effort: EffortLevel }>;
  ```
  Add, near `validateModelName`:
  ```ts
  export interface SettingsInput {
    effort?: string;
    modelFor?: Record<string, string>;
    effortFor?: Record<string, string>;
  }
  export function validateEffort(value: string): string | null {
    return (EFFORT_LEVELS as readonly string[]).includes(value)
      ? null
      : `invalid effort ${JSON.stringify(value)}: allowed values are ${EFFORT_LEVELS.join(", ")}`;
  }
  ```
  - Verify: `npx tsc --noEmit`
  - Expected: it fails, and every error is in a consumer listed in Blast radius and
    names `modelMap` or `resolveStageModel`. An error naming any other symbol is a
    defect in this step.

- **Step 2: Resolve and freeze.** Add a `settings: SettingsInput = {}` parameter to
  `freezeProfile` after `deps`. **Order of refusals**, first to last: the existing
  model-name check; the spec-panel staffing check; the code-review staffing check
  (both unchanged, and still before anything here); then, in this order, an invalid
  `settings.effort`; each `modelFor` entry, then each `effortFor` entry, in argument
  order, refusing a name that is neither a frozen agent id nor `reconciler` (named
  refusal: `--model-for names unknown setting <name>: known settings are ...`), an
  invalid model (`validateModelName`) or an invalid level (`validateEffort`); last,
  a frozen agent id with no entry in `DEFAULT_SETTINGS` (`no default settings for
  <name>`). The settings checks sit after both staffing checks so the five existing
  `deps.agents` refusal tests (`test/profile.test.ts:431`, `:448`, `:462`, `:494`,
  `:506`, each expecting a staffing or duplicate-id message) refuse before settings
  resolution and pass unchanged. No existing test freezes a synthetic agent list
  successfully; a list that passes both staffing checks but holds an id with no
  default refuses with the named message, and no override supplies a default. Then
  build `dispatchSettings` for **every** frozen agent and for `reconciler`, applying
  the precedence in Assumptions: a run-wide `settings.effort` applies to every setting
  whose agent `role` is not `reviewer` and leaves the six reviewer settings at their
  seeded effort (open decision 3). Nothing is written when a refusal is thrown, as
  today.
  - Verify: `npx tsc --noEmit`
  - Expected: the only errors are at the consumers Step 1 lists (they still read
    `modelMap` or `resolveStageModel`); none is in `src/profile.ts`.

- **Step 3: Resolver and shape check.** Replace `resolveStageModel` with
  `resolveSettings(profile, name)` returning
  `{ ok: true; model; effort } | { ok: false; reason }`; the refusal names the setting
  and lists the names the frozen profile maps. In `invalidProfileReason` replace the
  `modelMap` check with: `dispatchSettings` is a non-array object, has an entry for
  every agent in `p.agents` and for `reconciler`, and each entry has a string `model`
  that passes `validateModelName` and an `effort` in `EFFORT_LEVELS`. A profile that
  still carries `modelMap` and no `dispatchSettings` fails with a reason that says it
  was frozen under a superseded configuration and must be replaced by a fresh run. No
  default fill, no migration.
  - Verify: `node --test test/profile.test.ts` after updating it (Step 4).
  - Expected: passes.

- **Step 4: Tests.** Update the tests that pin `modelMap` (`test/profile.test.ts`,
  five references) to `dispatchSettings`. Add: (a) no overrides freezes all ten
  settings, each equal to its seeded default with a null model resolved to `--model`
  (assert `spec-author` is the seeded Opus, the three spec reviewers Haiku at
  `medium`, the three code reviewers Sonnet 5.5 at `medium`, `implementer` Sonnet 5.5
  at `medium`, `plan-author` the `--model` passed at `high` and `reconciler` the
  `--model` passed at `medium`); (b) `effortFor` and `modelFor` override
  only the named settings and leave the other nine equal to (a); (c) `--effort` applies
  to every non-reviewer setting without a per-name value, and a per-name value beats
  it; (d) an invalid level, invalid model, unknown name, and a registry agent lacking
  a default each refuse and write no `profile.json`; (e) a frozen profile with
  `modelMap` and no `dispatchSettings` is refused by name; (f) `reconciler` can be set
  independently of `spec-author` and `plan-author`; (g) `--effort xhigh` sets the four
  non-reviewer settings and leaves the six reviewers at their seeded `medium`; (h)
  `effortFor` can set one reviewer to `max` while the other five stay at `medium`, and
  `ultracode` is refused as an invalid level; (i) with an invalid effort, an unknown
  setting name and a depleted registry together, the staffing refusal is the one
  thrown (the order in Step 2). Case (d) builds its no-default registry as `AGENTS`
  plus one extra agent with a new id that keeps both staffing checks satisfied.
  - Verify: `node --test test/profile.test.ts`
  - Expected: passes. Break the precedence (swap the order of the `--effort` and
    seeded-default terms), confirm (c) fails, restore. Remove the `role` test that
    skips reviewers, confirm (g) fails, restore.

- **Step 5: The shared test helper.** Create `test/uniform-profile.ts` (no `.test.ts`
  suffix, so `node --test test/*.test.ts` does not run it as a test; `tsconfig.json`
  includes `test`, so it is typechecked). It exports one function,
  `freezeUniformProfile(rootDir, runId, startingCommit, model, verification)`, which
  calls `freezeProfile` with `modelFor` and `effortFor` set for every key of
  `DEFAULT_SETTINGS`: the model passed, and `medium`. Every setting therefore equals
  the model the stage test passes as `requestedModel`. Task 4 routes the seven
  dispatching test files (Blast radius) through it; `test/profile.test.ts` case (a)
  stays the only place that freezes the real seeded defaults, and the `--model`
  assertion in the stages is not loosened.
  - Verify: `npx tsc --noEmit`, then a call from `test/profile.test.ts` that
    `Object.keys(profile.dispatchSettings)` has all ten names, each with the model
    passed and `medium`.
  - Expected: the helper's own file has no errors; the profile test passes.

**Task completion evidence:** `test/profile.test.ts` passes, each break-test fails by
assertion before restoration, and `test/uniform-profile.ts` exists. The whole project
does not compile until Task 5, and that is expected.

---

### Task 3: Pass effort to the harness and record it on `agent_run`

**Depends on:** Task 0 (done; it changed nothing here), Task 2

**Files:**
- Modify: `src/harness.ts`, `src/dispatch.ts`, `src/store.ts`
- Create: `src/migrations/008_agent_run_effort.sql`
- Validate: `test/harness.test.ts`, `test/dispatch.test.ts`, `test/store.test.ts`,
  `test/migrate.test.ts`

**Steps:**

- **Step 1: Argv.** Add `effort?: string` to `InvocationInput`. In `invokeHarness`
  (`src/harness.ts:239`), after
  `if (input.model !== undefined) argv.push("--model", input.model);` add
  `if (input.effort !== undefined) argv.push("--effort", input.effort);`.
  - Verify: `npx tsc --noEmit`
  - Expected: `src/harness.ts` compiles; the project-wide errors from Task 2 remain and
    no new one is in `src/harness.ts`.

- **Step 2: Dispatch and store.** Add `requestedEffort: string` and `setting: string`
  to `DispatchInput` (both required, so no dispatch can omit them) and pass the effort
  as `effort` to `invokeHarness`. Add both to the `insertAgentRun` input and the insert
  statement (`src/store.ts:248`, `:572`). Migration 008 adds two nullable columns,
  `ALTER TABLE agent_run ADD COLUMN requested_effort TEXT;` and
  `ALTER TABLE agent_run ADD COLUMN setting TEXT;`, and its last line is
  `PRAGMA user_version = 8;` (`src/migrate.ts` refuses a migration that does not set
  it to its own index). Nullable because rows written before this migration exist in
  old stores; new rows always carry both. Update the `AgentRunRow` type
  (`src/store.ts:46`). In `dispatchOnce` (`src/dispatch.ts`), the shared `failed`
  helper appends ` (requested model <model>, effort <effort>)` to every
  `agent.dispatch.failed` summary and to the returned `reason`, so a failed attempt,
  which writes no `agent_run` row, still names what it requested.
  - Verify: `npx tsc --noEmit`, then `node --test test/store.test.ts test/migrate.test.ts`
  - Expected: `src/harness.ts`, `src/dispatch.ts` and `src/store.ts` compile. The 13
    `dispatchOnce` callers (`src/cli.ts:309`, `src/code-review-stage.ts:400` and
    `:606`, `src/implementation-stage.ts:378`, `src/plan-stage.ts:277`, `:361`, `:535`
    and `:619`, `src/spec-decision-stage.ts:302`, `src/spec-stage.ts:236`, `:300`,
    `:487` and `:571`) fail with a missing `requestedEffort` and `setting`; that is
    expected until Task 4 and Task 5 and is not a defect in this step. The store and
    migrate tests pass after `test/store.test.ts` asserts the two new columns;
    `test/migrate.test.ts` derives `MIGRATION_COUNT` from the migrations directory and
    needs no expectation change.

- **Step 3: Tests.** In `test/harness.test.ts`, run `invokeHarness` against a fixture
  executor that reports the argv it received (find the one the current `--model` argv
  assertion uses; if none reports argv, add one under `test/fixtures/harness/` that
  emits the recorded line kinds and echoes `process.argv`), with `model: "m"` and
  `effort: "medium"`. Assert the argv contains `--model m --effort medium` in that
  order and no `--effort` when `effort` is omitted. Add a second harness test that reads
  `test/fixtures/recorded/claude-effort-flag-probes.json` and, for every probe, builds
  the argv from the probe's recorded `model` and `effort` and asserts it ends with
  `--model <model> --effort <effort>`, the shape the fixture's `provenance.command`
  records; the expected values come from the recorded fixture, not from the code. In
  `test/dispatch.test.ts` (whose 10 `requestedModel: "m"` sites gain `requestedEffort`
  and `setting`), assert the inserted row's `requested_effort` and `setting`, and that
  a failed dispatch's audit summary and returned `reason` name the requested model and
  effort. Update any test that compares an `agent.dispatch.failed` summary exactly;
  the phrases `dispatched agent`, `exited with code`, `timed out after` and `spawn
  failed` appear in `test/harness.test.ts`, `test/dispatch.test.ts`,
  `test/commit-verification.test.ts`, `test/run-command.test.ts`,
  `test/cli-operator.test.ts`, `test/agent-result.test.ts` and
  `test/verification-stage.test.ts`; running the files shows which compare exactly.
  - Verify: `node --test test/harness.test.ts test/dispatch.test.ts`
  - Expected: passes. Remove the `argv.push("--effort", ...)` line, confirm the harness
    tests fail by assertion (not by a crash; require the TAP summary line), restore.
    Remove the suffix from the `failed` helper, confirm the dispatch test fails by
    assertion, restore.

**Task completion evidence:** the four test files pass, the two argv break-tests and the
summary break-test fail as described, and the callers listed in Step 2 are the only
compile errors left in `src/dispatch.ts`'s consumers.

---

### Task 4: Every dispatch site uses its setting

**Depends on:** Tasks 2, 3

**Files:**
- Modify: `src/spec-stage.ts`, `src/plan-stage.ts`, `src/implementation-stage.ts`,
  `src/code-review-stage.ts`, `src/spec-decision-stage.ts`
- Validate: `test/spec-stage.test.ts`, `test/plan-stage.test.ts`,
  `test/implementation-stage.test.ts`, `test/code-review-stage.test.ts`,
  `test/spec-decision-stage.test.ts`

**Steps:**

- **Step 0: Route the dispatching tests through the helper.** In the seven test files
  the Blast radius names (`test/spec-stage.test.ts` 2 calls, `test/operator-state.test.ts`
  3, and one each in `test/spec-decision-stage.test.ts`, `test/plan-stage.test.ts`,
  `test/implementation-stage.test.ts`, `test/code-review-stage.test.ts` and
  `test/run-command.test.ts`), replace `freezeProfile(root, run.id, head, MODEL,
  VERIFICATION)` with `freezeUniformProfile(...)` from `test/uniform-profile.ts` (Task 2
  Step 5), keeping each file's model value. The 55 `requestedModel: "m"` sites in
  `test/spec-stage.test.ts` then match the frozen author setting and need no edit. No
  assertion in the stages or in the tests is loosened. The verification for this step
  is Steps 2 and 3 below: it has no result of its own.

- **Step 1: Resolve per setting, before spend.** In each stage, replace the
  `resolveStageModel(profile, <kind>)` calls listed in Blast radius with
  `resolveSettings(profile, <name>)` for the author agent's own name and for
  `reconciler`, resolved where the stage already resolves at configuration time
  (before any stage row or paid invocation). For the review panels the seats are
  chosen after the author proposes specialties, so resolve each seat agent's settings
  when the panel is selected and **before the first reviewer dispatches**: a missing
  entry refuses the whole panel, never a single seat after siblings have spent. Every
  `dispatchOnce` call in the sites listed in Blast radius passes `requestedModel` and
  `requestedEffort` from the setting that site's row names: the author agent for draft
  and self-critique, the seat agent for a reviewer, `implementer` for implementation
  and remediation, and `reconciler` for the reconciliation dispatches and the decision
  fold. Each call also passes `setting:` with that same name. `agent:` keeps naming the
  agent that runs.
  - Verify: `npx tsc --noEmit`
  - Expected: the five stage files compile. The errors left are the Task 5 sites
    (`src/cli.ts`, `src/operator-state.ts`, `src/operator-output.ts`), including the
    `dispatchOnce` call at `src/cli.ts:309`, and errors in the test files that still call
    `resolveStageModel` or read `modelMap`.

- **Step 2: Keep the `--model` assertion.** Where a stage compares `requestedModel`
  with the frozen model (`src/spec-stage.ts:145` and its plan, implementation and
  code-review equivalents), compare with the stage's author setting (open decision 7)
  and keep the message
  `--model X does not match the model frozen at run start (Y)`.
  - Verify: `node --test test/spec-stage.test.ts`
  - Expected: the existing mismatch test passes once Step 0 is done; the assertion
    itself is untouched.

- **Step 3: Tests.** For each stage, freeze a profile whose settings differ per name
  (reuse the `refreeze` helper pattern already in `test/code-review-stage.test.ts`,
  adding it to the others), run the stage on the fixture executor, and assert from
  `agent_run` that every row's `requested_model` and `requested_effort` equal the
  settings its dispatch should have used, identifying each row by its `setting`
  column and not by id order: for spec and plan, the draft and self-critique rows
  carry the author's setting and the reconciliation row carries `reconciler`, with
  `agent` still the author; each reviewer row matches its own seat agent; the code-review
  remediation row matches `implementer`; the decision-fold row matches `reconciler`
  and its `agent` is still `spec-author`. Assert that the expected values are distinct
  per setting so a stage that reads the wrong entry fails. Add one test that a profile
  missing one reviewer's entry refuses the panel with zero `agent_run` rows written.
  - Verify: `node --test test/spec-stage.test.ts test/plan-stage.test.ts test/implementation-stage.test.ts test/code-review-stage.test.ts test/spec-decision-stage.test.ts`
  - Expected: passes. Point the reconciliation dispatch at the author's setting,
    confirm the matching test fails by assertion, restore.

**Task completion evidence:** the five stage test files pass and the wrong-setting
break-test fails.

---

### Task 5: New-run flags, readiness, display and the dispatch surface

**Depends on:** Tasks 2-4

**Files:**
- Modify: `src/cli-args.ts`, `src/cli.ts`, `src/run-intake.ts`, `src/operator-state.ts`,
  `src/operator-output.ts`, `src/dashboard/app.js`
- Validate: `test/cli.test.ts`, `test/run-intake.test.ts`, `test/operator-state.test.ts`,
  `test/cli-operator.test.ts`, `test/run-command.test.ts`, `test/dashboard-ui.test.ts`

**Steps:**

- **Step 1: Flags.** In `COMMANDS["new-run"].options` (`src/cli-args.ts:30-38`) add
  three optional entries: `effort` (validated with `validateEffort`), `model-for` and
  `effort-for`. The last two take `<name>=<value>[,...]`; a shared helper splits on
  `,`, then on the first `=`, and refuses an empty name or value, a repeated name
  within one list, and (through `validateModelName` / `validateEffort`) a bad value.
  Unknown names are refused later, at freeze, where the registry is known.
  `parseArguments` is not changed: each flag appears once.
  The `new-run` help text says which settings `--model` covers (only `plan-author` and
  `reconciler`; every other setting takes its seeded model unless `--model-for` names
  it) and that `--effort` does not reach reviewers (open decisions 3 and 8).
  - Verify: `node src/cli.ts help new-run`
  - Expected: the usage line lists `[--effort <level>] [--model-for <list>]
    [--effort-for <list>]` (declare the options' `value` as `level` and `list`), and the
    help text carries both statements.

- **Step 2: Thread through intake.** `RunIntakeInput` gains an optional
  `settings?: SettingsInput`; `createRunIntake` passes it as the new `freezeProfile`
  argument; `case "new-run"` in `src/cli.ts` builds it from the three flags.
  `src/guided-command.ts` is not edited and passes nothing.
  - Verify: `node --test test/run-intake.test.ts test/cli.test.ts`
  - Expected: passes after adding: a `new-run` with `--effort xhigh` freezes the four
    non-reviewer settings at `xhigh` and the six reviewers at `medium`; a `new-run` with
    `--effort-for code-reviewer-security=max` freezes that reviewer at `max` and the other
    five at `medium`; a `new-run` with `--effort-for implementer=low`
    freezes `implementer` at `low` and the others unchanged; `--model-for
    reconciler=<a model name>` changes only `reconciler`; a bad level, a bad model, and
    an unknown name each refuse and create no run row (use the file's existing
    `assertNoRunRow`).

- **Step 3: The raw dispatch command and stage commands.** In `case "dispatch"`
  (`src/cli.ts:279-287`) resolve by the required `--agent` argument through
  `resolveSettings` instead of `stage.kind`, assert `--model` against that agent's
  frozen model, and pass its effort and `setting: <agent id>`. The raw command has no reconciler concept: a
  reconciliation dispatched through it takes the agent's own setting, and that is
  stated in its help text. The stage commands' `--model` pass-throughs stay (Task 4
  Step 2 holds the assertion).
  - Verify: `node --test test/cli.test.ts`
  - Expected: passes; the existing dispatch-mismatch test is updated to name the
    agent's frozen model.

- **Step 4: Readiness.** Replace the `kinds` loop in `frozenGroupReasons`
  (`src/operator-state.ts:514-526`) so that, in addition to the stage-kind capability
  checks it makes today through `requireFrozenBinding`, it resolves settings for every
  name the group will dispatch: for spec and plan, the author agent, `reconciler` and
  the reviewer agents the frozen profile could seat; for decision, `reconciler`; for
  implementation, `implementer`; for code_review, `implementer` and the code reviewers.
  A missing entry is a `setup_required` reason naming the setting, so an unstaffed run
  is refused before it spends. Update `:83`, `:286` and `:311` to carry
  `dispatchSettings`.
  - Verify: `node --test test/operator-state.test.ts`
  - Expected: passes after adding a test that deleting one entry (once an agent, once
    `reconciler`) from a frozen profile yields a `setup_required` reason naming it.

- **Step 5: Display.** `src/cli.ts:134` renames the doctor check `frozen_models` to
  `frozen_settings` and prints `dispatchSettings`; `src/operator-output.ts:56` prints
  `Frozen settings:` with the same value; `src/dashboard/app.js:3415` and `:4056` read
  `configuration.dispatchSettings` and show effort beside model. Assets are read once
  at startup, so the dashboard must be restarted to show the change.
  - Verify: `node --test test/cli-operator.test.ts test/run-command.test.ts test/dashboard-ui.test.ts`
  - Expected: passes after updating the references to `modelMap` and
    `resolveStageModel` in `test/cli-operator.test.ts` (9) and `test/run-command.test.ts`
    (4). Add one dashboard test that a snapshot carrying `dispatchSettings` renders a
    row per setting with its model and effort, and confirm by removing the `app.js`
    change that this test fails (an empty list is the failure mode being guarded).

**Task completion evidence:** `npx tsc --noEmit` is clean for the first time since Task 2
(this task closes the compile gap, and `npm run typecheck` also covers the dashboard
assets); the six test files pass; `node src/cli.ts help new-run` shows the three flags
and the two coverage statements; the dashboard test fails without the `app.js` change.

---

### Task 6: Documentation

**Depends on:** Tasks 1-5

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `AGENTS.md`, `ARCHITECTURE.md`,
  `docs/runbooks/cli-operator.md`, `.claude/skills/run-buildworks/SKILL.md`

**Steps:**

- **Step 1: README and the two instruction files.** `README.md:78` and the `new-run`
  bullet in `CLAUDE.md` and `AGENTS.md` say one model is frozen at `new-run`. Replace
  with: each agent's, and the reconciler's, model and effort are frozen at `new-run`
  (`--model` required and covering only `plan-author` and `reconciler`; optional
  `--effort`, which does not reach reviewers, `--model-for`, `--effort-for`), the seeded
  defaults live in `src/policy.ts`, and every spend entry point checks the frozen
  setting for its dispatch. In `README.md:814` (the `configuration` field table) replace
  `modelMap` with `dispatchSettings`. Edit `CLAUDE.md`, copy to `AGENTS.md`, then
  compare hashes.
  - Verify: `npm run check:docs`; compare the file hashes of `CLAUDE.md` and `AGENTS.md`.
  - Expected: clean; hashes equal.

- **Step 1b: The operator runbook and the run skill.** In `docs/runbooks/cli-operator.md`,
  state at the `new-run` example (`:500`) which settings `--model` covers and how the
  other flags work, and at `:530` say the preview shows frozen settings, not one model.
  In `.claude/skills/run-buildworks/SKILL.md`, mark the recorded costs (lines 131-187
  and the range near `:285`) as measured with one model (`claude-sonnet-5`) and not
  valid for the seeded defaults, and change the line at `:410` so it names the frozen
  setting for the stage. `.claude/skills/**` is reference tier: write any placeholder
  path in prose, not backticks.
  - Verify: `npm run check:docs`
  - Expected: clean.

- **Step 2: ARCHITECTURE.md.** Section 10: state that configuration is per agent plus
  the reconciler (a stage still names what it needs), that requested effort is recorded
  and effective effort is not observable, and the Task 0 findings on Haiku and on
  unsupported levels. Section 11: the invocation adds `--effort`, passed per dispatch
  and not part of the frozen executor definition. Section 12: the profile freezes
  `dispatchSettings`. The `agent_run` column list near line 1140: add `requested_effort`
  and `setting`. `ARCHITECTURE.md` does not name the `agent.dispatch.failed` event
  (searched 2026-09-29), so the summary change needs no edit there.
  - Verify: `npm run check:docs`
  - Expected: clean.

**Task completion evidence:** `npm run check:docs` exits 0 and the two instruction files
are byte-identical.

---

### Task 7: Full verification and a free end-to-end check

**Depends on:** Tasks 1-6

**Steps:**

- **Step 1:** `npm run typecheck`, then the serial suite
  `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts`, then
  `git log -1` to confirm the suite left no stray "moved" commit.
  - Expected: typecheck clean; the two known baseline failures only (the dashboard
    SIGTERM stderr warning and the private-key comment match); no new failure.
- **Step 2:** `node .claude/skills/run-buildworks/driver.mjs smoke` (no dispatches, no
  spend).
  - Expected: `13/13 steps as expected`.
- **Step 3:** In a scratch target, `new-run` with `--effort-for implementer=low
  --model-for reconciler=<a model name>` and read `status --json`:
  `configuration.dispatchSettings` shows those two settings changed and the other eight
  at their seeded values. Then a second `new-run` with `--effort xhigh`: the four
  non-reviewer settings read `xhigh` and the six reviewers still read `medium`.

**Task completion evidence:** all three steps pass. A paid run is a separate,
operator-authorized step and is not part of completion. The first paid run after this
plan is implemented is the test of the seeded `implementer` default (`claude-sonnet-5-5`
at `medium`), one level below where run 5 failed at `high` on `claude-sonnet-5`. If it fails the same way
the spend is about run 5's ($2.92) and the store shows "unknown spend"; that is
recorded in the plan's out-of-scope note, not fixed here.

---

## Implementation note

**Implemented 2026-09-29.** Tasks 0-7 are done and committed (`c539e59`). Component
success at implementation, as the Verification section says; the live run recorded
below then exercised the seeded defaults once.

**What shipped.** `DEFAULT_SETTINGS`, `EFFORT_LEVELS` and `RECONCILER` in `src/policy.ts`;
`dispatchSettings` replacing `modelMap` in the frozen profile, with `resolveSettings`
replacing `resolveStageModel`; `--effort` on every dispatch; migration 008
(`agent_run.requested_effort`, `agent_run.setting`); the `new-run` flags `--effort`,
`--model-for`, `--effort-for`; every stage dispatching under its own setting, with
reconciliation and the decision fold under `reconciler`; status, doctor and the dashboard
showing the frozen settings; and the docs. A failed dispatch's audit summary and returned
reason name the requested model and effort.

**Verification.** `npm run typecheck` and `npm run check:docs` are clean, and `CLAUDE.md`
and `AGENTS.md` are byte-identical. The serial suite ran 1341 tests: 1333 pass, 5 skipped
and 3 fail. Two failures are the known baseline (the dashboard SIGTERM stderr warning;
the private-key comment match in `src/dashboard-approval.ts`). The third,
`test/schema.test.ts` "every table's columns", was a real gap this work introduced and is
fixed (deviation h); the file passes. `driver.mjs smoke` printed `13/13 steps as expected`.
Two scratch `new-run` calls froze the expected tables: `--effort-for implementer=low
--model-for reconciler=<model>` changed exactly those two settings, and `--effort xhigh`
set the four non-reviewers to `xhigh` and left the six reviewers at `medium`. `git log -1`
showed no stray commit. Break-it checks were run for the profile precedence, the new-run
tests, the dashboard tests and the fold's setting.

**Independent review (in-session subagent, operator's choice under hazard 14).** It found
no correctness defect in precedence, dispatch sites, profile validation, argument parsing,
migration or docs, and three low findings:
- Unknown `--model-for` / `--effort-for` name leaves a blocked run: **deferred**, not
  fixed. It is deviation (c); the setting names are a static set, so a parse-time refusal
  would need no run row. Trigger: an operator loses a run to a typo.
- No test for the `spec_decision` fold's setting (Task 4 Step 3 required one):
  **fixed**. `test/spec-decision-stage.test.ts` gives `reconciler` values no other setting
  has and asserts the fold row; it fails when the fold resolves `spec-author`.
- The dashboard's per-stage "Configured settings" column omitted the reconciler on the
  `spec` and `plan` rows and the implementer on the `code_review` row: **fixed** in
  `src/dashboard/app.js`, with the dashboard test and ARCHITECTURE section 10 updated.

**Deviations from the plan.**
- (a) No per-group settings check in readiness. `loadVerifiedProfile` refuses a profile
  missing any entry (`evidence_invalid`, naming the entry), before any group can run, so
  Task 5 Step 4's `setup_required` reason was not added.
- (b) The per-seat `resolveSettings` checks in the stages are defense in depth: the
  profile door makes them unreachable, and the missing-reviewer-entry tests pass through it.
- (c) An unknown setting name in `--model-for` / `--effort-for` is refused at freeze, so
  it leaves a blocked run row, not "no run row". A bad level or model is refused at parse
  and creates no row. README and the runbook say so.
- (d) The refusal text for a missing entry is the loader's "dispatchSettings carries no
  entry for X".
- (e) `scripts/doc-check.mjs` pinned table columns, not only names, so it now folds in
  `ALTER TABLE ... ADD COLUMN`, and the ARCHITECTURE `agent_run` list carries the added
  columns last.
- (f) `test/dashboard-ui.test.ts` is excluded from `tsc`, so its `insertAgentRun` calls
  needed the two new fields by hand, and `stageSettingsText` is exported for testing.
- (g) `test/fixtures/harness/emit-cli-run.mjs` accepts `--effort`.
- (h) `test/schema.test.ts` also compares migration columns to the ARCHITECTURE block and
  needed the same `ALTER TABLE` fold; the plan's Task 3 did not list it.

**Change after implementation (operator decision, 2026-09-29).** The `plan-author`
default is `claude-opus-5-5` at `high`, not the `--model`-at-`high` guess the sections
above describe (open decisions 2, 6 and 8, the Task 1 constants and the Task 2 test
cases). `--model` therefore covers only `reconciler`. `src/policy.ts`, the `new-run`
help text, the README, `CLAUDE.md`, `AGENTS.md`, the runbook, ARCHITECTURE section 10 and
the tests that assumed `plan-author` follows `--model` were updated to match; those
sections are left as written and this note supersedes them.

**Live verification (operator-authorized paid run, 2026-09-29).** The paid driver
(`.claude/skills/run-buildworks/driver.mjs paid --yes --model claude-sonnet-5-5`) ran
the `web-calculator` design under the seeded defaults: 14 dispatches, $1.66350, run
`completed`, ten stages passed (spec, spec_review, spec_decision, awaiting_approval,
plan, plan_review, implementation, verification, code_review, delivery_check), 4 of 4
declared artifacts delivered, audit chain valid, and the driver's 15 steps as expected.
The scratch target sat in the OS temp directory and is not preserved; its `agent_run`
rows were read before anything was cleaned. All 14 rows carry `setting` and
`requested_effort`, and `effective_model` equals `requested_model` on every row:
- `spec-author`, two rows: `claude-opus-5-5`, `high`. $0.13930 and $0.26410.
- `spec-reviewer-traceability` and `spec-reviewer-consistency`, in each of the spec and
  plan reviews (four rows): `claude-haiku-4-5-20251001`, `medium`. $0.30963 together.
- `plan-author`, two rows: `claude-opus-5-5`, `high`. $0.12441 and $0.36403.
- The two reconciliation rows: `setting` is `reconciler`, `agent` is `spec-author` and
  `plan-author`, `claude-sonnet-5-5`, `medium`. $0.09117 and $0.09112.
- `implementer`: `claude-sonnet-5-5`, `medium`. $0.09017, about 30 seconds.
- The three code reviewers: `claude-sonnet-5-5`, `medium`. $0.18957 together.

Cost by group: the four Opus author dispatches $0.89184, the Haiku spec reviewers
$0.30963, the reconciliations $0.18229, the implementer $0.09017, the code-review panel
$0.18957.

What this shows. The seeded `implementer` default completed a real implementation with no
output-cap failure, one sample only. The reconciler setting governed both reconciliation
dispatches while `agent` kept naming the author. The requested effort is recorded;
effective effort is still unobservable. One code-review panel returned no findings, so
remediation, the second panel and the blocking gate were not exercised.

The code reviewers did review. Each ran one turn with no tool calls, from the diff in the
prompt (about 17,000 input tokens each, 3 to 12 seconds, $0.06 each). Their summaries name
specifics, and the four I checked against the delivered files held: the display writes
through `textContent` and nothing uses `innerHTML` or `eval`; the stored theme is checked
against `dark` or `light` before use; every `localStorage` read and write sits in a
try/catch; the Error state resets on the next digit. That establishes they read the code,
not that they would catch a subtle defect on a larger change. No independent audit of the
delivered code was done, and the reviewers are at `medium`.

**Deferred, and unverified.** Neither reviewer quality nor implementer quality is measured
across levels or models: one run on a small design, one clean panel. A run that attracts
findings (for example `target-tap-design.md`, or `--effort-for` on a reviewer) is the test
of that and needs its own authorization. Effective effort cannot be observed. Failed-dispatch
cost stays out of scope. The runbook line "The current code-review defaults are two
reviewers" is inaccurate (the default is three); it predates this work and was left alone.
