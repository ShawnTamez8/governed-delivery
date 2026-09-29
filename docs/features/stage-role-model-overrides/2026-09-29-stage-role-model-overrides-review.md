# Per-agent model and effort configuration plan — review

**Reviewed document:** `plan.md`
**Document type:** Plan (with a design section: the settings model, defaults and flags)
**Reviewer:** the session that wrote the plan, in-session, not a separate process. Hazard 14 applies: independence is unproven, and a separate reviewer remains available.
**Review date:** 2026-09-29
**Status:** reconciled

**Hazards considered:** 4 (the existing suite encodes the single-model contract, and finding 1 is the plan's claim that it passes unchanged), 10 (seeded model IDs and the closed effort set; no finding), 11 (a default installation: finding 3 and the seeded model access), 12 (effective configuration visible: finding 2 and the `--model` meaning), 14 (this review's own independence, stated above). Items 1-3 and 5-9 and 13-19 add nothing here: no gate, prompt, parser, retry policy, sandbox or delivery rule changes.

---

## Summary

The plan replaces the stage-keyed `modelMap` with per-setting model and effort for the nine agents and `reconciler`, and the design holds together. Its blast-radius search is complete for source files. It understates the test suite: it claims existing tests pass unchanged while the seeded defaults change what every stage test freezes.

## Verdict

**Ready for planning after required changes.** One critical issue (the existing tests) and four high-risk areas need edits to the plan before an implementation plan starts. None requires redesign.

## Critical issues — must fix before implementation

**Issue:** The plan claims existing tests pass unchanged, and the seeded defaults break them

- **Why it matters:** Task 4 Step 2 says the existing `--model` mismatch test "passes unchanged" and Task 4 Step 3 adds tests, but neither accounts for the tests that match. `test/spec-stage.test.ts` calls `runSpecStage` with `requestedModel: "m"` at 14 or more sites (lines 219 through 1022, 56 references in the file), and 47 `freezeProfile(` calls in 14 test files freeze the model `"m"`. After the plan, `freezeProfile` seeds `spec-author` with `claude-opus-5-5`, so the stage's `--model m` assertion refuses each of those runs. `implementer` and the code reviewers are seeded non-null as well.
- **Where:** Task 4 Steps 2 and 3, Task 2 Step 4 (which updates only `test/profile.test.ts`), and the Blast radius list of tests, which counts only files that mention `modelMap` or `resolveStageModel`.
- **Production impact:** No production impact; the impact is on delivery. The first Task 4 verification fails across the stage test files, and an implementer under pressure loosens the model assertion instead of fixing the fixtures, which removes the guard Task 4 Step 2 exists to keep.
- **Recommended fix:** Add a step that defines one test helper freezing uniform settings (every one of the ten names set to `"m"` through `modelFor`, plus a fixed effort) and routes the stage test helpers through it. Keep the seeded-defaults assertions in `test/profile.test.ts` (Task 2 Step 4, case a) as the only tests that freeze real defaults. List the files to change with counts, and change the Task 4 Step 2 expectation from "passes unchanged" to "passes after the helper change".

## High-risk areas

**Risk:** Tasks 2 and 3 expect a clean typecheck that cannot exist yet

- **Why:** Task 2 Step 2 and Task 3 Steps 1 and 2 each say `npx tsc --noEmit` compiles clean. Task 2 removes `modelMap` while five stage files, `src/operator-state.ts` and `src/cli.ts` still read it until Tasks 4 and 5. Task 3 Step 2 makes `requestedEffort` a required field of `DispatchInput`, which breaks all 13 `dispatchOnce` callers until Task 4. Task 2 Step 1 states the expected failure correctly; the later steps contradict it.
- **Impact if ignored:** The implementer meets failing verification in tasks the plan calls green and either skips verification or reorders tasks without a record.
- **Mitigation:** State in Tasks 2 and 3 that the typecheck fails with errors only at the listed consumers, or move the required `requestedEffort` and the `modelMap` removal into one compile boundary with Tasks 4 and 5 and verify once at its end.

**Risk:** `--model` stops meaning what its name says, and cost moves toward Opus

- **Why:** After seeding, `--model` governs only `plan-author` and `reconciler`. `bw new-run --model claude-sonnet-5`, as the driver, README and runbook pass it, dispatches Opus for `spec-author` and Sonnet 5.5 and Haiku for the rest. An operator reading the command sees one model and runs several. Open decision 6 mentions guided mode's prompt but not `new-run` or its help text. The paid driver's recorded costs in `.claude/skills/run-buildworks/SKILL.md` assume one model and become stale. Task 0 measured one identical one-word prompt at $0.0125 on Opus 5.5 and $0.0066 on Sonnet 5.5, a ratio of 1.9. That ratio is not reliable: on the same prompt Haiku cost $0.0042 at `low` and $0.0008 at `medium`, so per-dispatch noise exceeds the model difference on prompts that small. The real ratio for a spec-author dispatch is unmeasured. The operator's most recent run ended at 82 percent of both usage windows.
- **Impact if ignored:** A cost-conscious operator runs the driver expecting the recorded $1.34 to $2.06 range and spends more, with no plan text that warned of it.
- **Mitigation:** Say in the plan, in the `new-run` help text and in README which settings `--model` covers, and add the driver skill's cost records to Task 6 as stale.

**Risk:** New freeze refusals run before the staffing checks and collide with the `deps.agents` seam

- **Why:** Task 2 Step 2 places the settings validation "after the existing model check", which precedes the staffing and code-review staffing refusals in `freezeProfile`. `test/profile.test.ts` freezes five custom agent lists (lines 431, 448, 462, 494, 506) and expects specific staffing and registry messages. A list containing an id with no `DEFAULT_SETTINGS` entry now refuses earlier with `no default settings for <name>`. The same rule makes any custom agent list unusable for a successful freeze.
- **Impact if ignored:** Five refusal tests assert the wrong message or fail, and no test can freeze a synthetic agent list, which removes coverage the seam exists to provide.
- **Mitigation:** Specify that settings resolution runs after both staffing checks, and specify how a seam agent list without defaults freezes (the test passes settings for those ids, or the refusal applies only to ids in the real registry).

**Risk:** The implementer is seeded at the level where the live failure occurred, and a repeat is unrecorded spend

- **Why:** The operator chose `claude-sonnet-5-5` at `high` for the implementer. The plan records the reasoning: run 5 failed on Sonnet 5 at `high`, and 5.5's levels are recalibrated. Nothing in the plan detects a repeat. The plan lists the store's missing cost for failed dispatches as out of scope, so a second failure costs about what run 5's did ($2.92) and the store shows "unknown spend" again.
- **Impact if ignored:** The first fresh run after this plan can repeat the failure and its unrecorded cost with no change to what the operator sees.
- **Mitigation:** State in Task 7 that the first paid run after implementation is the test of this default, and either bring the failed-dispatch cost record into scope or record in the plan that the spend is invisible to the store.

## Medium and low concerns

- The Blast radius names `test/fixtures/recorded/doctor-ambient-config-web-calculator-live-chain.json` as a test reference. No test or source file reads it (a search by its stem finds none), so the four `modelMap` mentions inside it are inert. Remove it from the list or say it is unreferenced.
- Task 3 Step 2 says the migration sets "the matching `PRAGMA user_version`". State `PRAGMA user_version = 8`. `test/migrate.test.ts` derives `MIGRATION_COUNT` from the directory, so it needs no expectation change; only the store test needs the new column.
- `agent_run` does not record which setting governed a row. A reconciliation row and a draft row for the same agent differ only in requested model and effort, and when those are equal nothing distinguishes them; Task 4's tests rely on row id order.
- Renaming `configuration.modelMap` to `dispatchSettings` changes the `--json` output of `status` and `doctor`. Hard rule 3 permits it, but the plan searches only `README.md` for consumers. `docs/runbooks/cli-operator.md` and the dashboard model files are not searched for `frozen_models` or `modelMap`.
- Task 6 omits `docs/runbooks/cli-operator.md`, which `CLAUDE.md` names as carrying the full operator procedure, and `.claude/skills/run-buildworks/SKILL.md`.
- Runs 1 through 5 in the team-notes target read as `interrupted_or_inconsistent` after the change, and the dashboard's configuration panel shows nothing for them. That matches the earlier profile-shape refusals; the plan states the consequence for the executor and not for these stores.
- The rule that no reviewer is seeded at `high` is enforced only on the seeded values. A run passing `--effort high` sets every setting to `high`, reviewers included.

## Missing and underspecified areas

- The order of refusals inside `freezeProfile`: which comes first when a run has an invalid `--effort`, an unknown setting name, and a staffing shortfall.
- The shared test helper for uniform settings: its name, its location, and which test helpers call it.
- What `--model` covers, in the `new-run` help text and in the operator documents.
- A per-file count of test changes. The plan lists nine files by mention count and misses the files that assert on `"m"`.
- Whether the failed-dispatch audit event `agent.dispatch.failed` records the requested model and effort. Today its summary names the agent, role and stage only, so a failed attempt links to its settings only through the frozen profile.
- How the fixture `test/fixtures/recorded/claude-effort-flag-probes.json` is guarded. No test reads it, and the plan's Task 3 argv test takes its expectation from the CLI help text rather than from the fixture.

## Suggested improvements

- Record the setting name on `agent_run` so a row explains itself and tests stop depending on id order.
- Add the requested model and effort to the `agent.dispatch.failed` summary, so a failed dispatch is diagnosable without loading the profile.
- Print the resolved settings, with their source (`--model-for`, `--effort`, default), in `status`, so an operator sees why a setting has its value.
- Add one test that reads the recorded probe fixture and asserts the argv the harness builds for `low` and `medium` matches the recorded command, so the fixture backs a guard.

---

## Reconciliation

**Date:** 2026-09-29
**Disposition:** 13 accepted, 0 rejected, 1 deferred, 0 open
**Status:** reconciled

The review lists 22 items. Six repeat another item's underlying gap, so they share a verdict: 14 verdicts in all. Each factual claim was checked against the repository before its verdict. The operator ruled on the four judgment calls (failed-dispatch cost, the `setting` column, run-wide effort, the failed-dispatch summary).

### Verdicts

- **Accepted — The plan claims existing tests pass unchanged, and the seeded defaults break them** (also: the shared test helper is unspecified; no per-file count of test changes): verified (`requestedModel: "m"` at 55 sites in `test/spec-stage.test.ts`, 47 `freezeProfile(` calls in 14 files). Plan adds `test/uniform-profile.ts` (Task 2 Step 5), routes seven dispatching test files through it (Task 4 Step 0), lists the files with counts in Blast radius, and changes the Task 4 Step 2 expectation to "passes once Step 0 is done".
- **Accepted — Tasks 2 and 3 expect a clean typecheck that cannot exist yet:** verified (13 `dispatchOnce` callers). Tasks 2 and 3 now expect errors only at the listed consumers, and Task 5's completion evidence is the first clean typecheck.
- **Accepted — `--model` stops meaning what its name says, and cost moves toward Opus** (also: what `--model` covers is unspecified; Task 6 omits the runbook and the run skill): new open decision 8 states the coverage and the cost caveat; Task 5 puts it in the `new-run` help text; Task 6 adds `docs/runbooks/cli-operator.md` and `.claude/skills/run-buildworks/SKILL.md` and marks the recorded costs stale.
- **Accepted — New freeze refusals run before the staffing checks and collide with the `deps.agents` seam** (also: the order of refusals in `freezeProfile` is unspecified): Task 2 Step 2 fixes the order (model name, both staffing checks, then settings). The five seam tests (`test/profile.test.ts:431`, `:448`, `:462`, `:494`, `:506`) refuse in staffing and pass unchanged. No existing test freezes a synthetic agent list successfully, so a list with no defaults refuses by name.
- **Accepted — The implementer is seeded at the level where the live failure occurred, and a repeat is unrecorded spend:** operator chose to keep failed-dispatch cost out of scope. The plan states the consequence in the out-of-scope note and in Task 7, and names the first paid run as the test of the default.
- **Accepted — Inert fixture in the Blast radius list:** verified no test or source file reads it; the plan now says so.
- **Accepted — Migration `PRAGMA user_version` unstated:** Task 3 Step 2 states `PRAGMA user_version = 8;` and that `test/migrate.test.ts` needs no change.
- **Accepted — `agent_run` does not record which setting governed a row** (also: the suggestion to record the setting name): operator chose to add it. Migration 008 adds a nullable `setting` column, every dispatch passes it, and Task 4 tests identify rows by `setting` instead of id order.
- **Accepted — Renaming `modelMap` changes `--json` output and consumers were searched thinly:** searched; the extra consumer is `README.md:814`, and the runbook and dashboard model files carry only prose. Blast radius and Task 6 Step 1 cover it.
- **Accepted — Runs 1 through 5 read as `interrupted_or_inconsistent`:** Approach item 3 states the consequence for old stores, grounded in `readRunSnapshot` (`src/operator-state.ts:304-324`): the refusal shows as a limitation and the configuration is empty.
- **Accepted — The no-reviewer-at-`high` rule is enforced only on seeded values:** operator ruled that a run-wide `--effort` must not reach reviewers and that an explicit `--effort-for` may set any level up to `max`, not `ultracode`. Open decision 3, the precedence rule, Task 2 (cases g and h) and Task 5 carry it.
- **Accepted — `agent.dispatch.failed` does not record the requested model and effort** (also: the suggestion to add them to the summary): operator chose to add it. Task 3 Step 2 appends them to every failed summary in `dispatchOnce` and Step 3 tests it.
- **Accepted — The recorded probe fixture has no guard** (also: the suggestion to add a fixture-backed argv test): Task 3 Step 3 adds a harness test that takes model and effort from each recorded probe and asserts the argv ends with `--model <model> --effort <effort>`.
- **Deferred — Print the resolved settings, with their source, in `status`:** optional; the frozen values already display. Revisit if an operator cannot tell why a setting has its value.
