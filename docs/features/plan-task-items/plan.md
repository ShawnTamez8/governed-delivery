# Plan Task Items Implementation Plan

**Status:** Implemented

**Goal:** Make the implementation stage count and split a plan by its top-level task items, with each item's indented lines travelling with it, so a plan that nests its sub-bullets is neither refused for size nor cut mid-task.

**Source:** Operator statements, 2026-10-07. On team-notes run 12 (below) the operator chose "Fix the count, don't resume": fix the count before the next run, leave run 12 as it is. Evidence: the implementation stage's refusal and `test/fixtures/recorded/plan-team-notes-run-12.json`. Prior record: hazard 20 already names this limit ("a plan that wraps or nests its bullets counts each line and can be cut mid-task or refused for size") and `docs/features/phased-implementation/plan.md` is its origin.

**Assumptions:**
- **The unit is the top-level list item.** `CLAUDE.md` and `ARCHITECTURE.md` section 12 already say a phase is "the next ten items of the plan's `## Tasks` section". The code counted every non-empty line. This change makes the code match the word the documents use.
- **Flat plans are unchanged.** When every line of `## Tasks` has the same indentation, each line is its own item, so the run 6 plan (57 lines) still splits `[10, 10, 10, 10, 10, 7]`.
- **The plan gate's notion of a task does not change.** `planNormativeNodes` in `src/reconciliation.ts` builds the normative nodes from `PlanDoc.tasks`, one per non-empty line. Hazard 17's guard depends on it, so `tasks` stays per line and a new field carries the phase unit.
- **The plan prompts' sentence "one plain task per list line" is left as it is** (open decision 1).
- No change to the frozen policy values, to `profile.json`, to the policy hash, to `governed.yaml`, or to any schema.

**Approach:** `validatePlanDoc` derives a second list, `taskItems`, from the same `## Tasks` text it already parses. A line whose leading whitespace is the section's smallest starts a new item; a line indented deeper than that joins the item above it, keeping its own indentation relative to the item. `src/implementation-stage.ts` counts, ceiling-checks and splits `taskItems` in place of `tasks`. `planPhases` is unchanged: it splits whatever list it is given. The phase prompt already renders each element as `- <text>`, so a multi-line item prints its sub-bullets directly under its first line. Tests are built from the committed run 12 plan.

**Affected areas:** `src/plan-doc.ts`, `src/implementation-stage.ts`; `test/plan-doc.test.ts`, `test/implementation-stage.test.ts`, `test/prompts.test.ts`, `test/plan-gate.test.ts` (one `PlanDoc` literal); `docs/hazards.md`, `ARCHITECTURE.md`; the recorded fixture `test/fixtures/recorded/plan-team-notes-run-12.json`, already written and uncommitted.

**Known blockers:**
- **[Verified]** The stage counts lines. `listItems` in `src/plan-doc.ts` trims every line, strips a leading `-`, and keeps every non-empty line. `src/implementation-stage.ts` compares `parsedPlan.value.tasks.length` with `implementationPhaseTasks * implementationMaxPhases` and passes the same list to `planPhases`.
- **[Verified, run 12]** The recorded plan's `## Tasks` section has 226 non-empty lines, 53 of them top-level bullets and 173 indented beneath them. The stage's refusal reads "the approved plan has 226 tasks, more than the frozen ceiling of 80". The line count of the section equals the stage's number, so the count rule is the cause.
- **[Verified]** `PlanDoc.tasks` has a second consumer. `planNormativeNodes` (`src/reconciliation.ts`) prepends `doc.tasks` to the coverage nodes, and the plan reconcile prompt tells the reconciler that every task in `## Tasks` is a normative node. Changing `tasks` would let a nested line be reworded or removed with no claim (hazard 17).
- **[Verified]** The prompts ask for something the run 12 author did not do. The plan draft, self-critique and reconcile prompts each say "a ## Tasks section: one plain task per list line" (`src/prompts.ts`, three places). The author nested 173 lines across the draft, the self-critique and the reconciliation anyway, so the instruction is advisory (hazard 3).
- **[Verified]** Only one test constructs a `PlanDoc` literal: `test/plan-gate.test.ts` line 29. A new required field breaks its typecheck until that literal is updated.
- **[Verified]** The rendered phase list is `${phase.tasks.map((task) => `- ${task}`).join("\n")}` in `buildImplementationAuthorPrompt`, followed by a blank line and `Approved plan:`. An element containing newlines renders as a nested Markdown list with no change to the builder.
- **[Verified]** The working tree already holds uncommitted edits to `.claude/sessions/project-learnings.md` and `docs/runbooks/cli-operator.md`, and the earlier verification-aware-prompts work. None of it is part of this change.
- **[Unknown]** Whether ten items with nested detail fit one implementer response. Run 12 never dispatched an implementer.

**Blast radius:**
- `validatePlanDoc` and `writePlanDoc` callers (grep of `src`): `src/plan-stage.ts` (three validations, three writes, and the `PlanDoc` type) and `src/implementation-stage.ts` (one validation). None constructs a `PlanDoc`, and adding a field changes none of the fields they read.
- `PlanDoc.tasks` readers (grep of `src`): `planNormativeNodes` in `src/reconciliation.ts`, which is untouched, and `src/implementation-stage.ts`, which this change moves to `taskItems`.
- `planPhases` callers: `src/implementation-stage.ts` and tests. Its signature and arithmetic are unchanged.
- `PlanPhase.tasks` readers: `buildImplementationAuthorPrompt` (renders each element) and the stage's audit line (`phase.tasks.length`). Both work on items.
- The operator preview (`src/operator-output.ts`) prints the policy numbers and the words "plan tasks"; no value changes.
- Persisted formats, `agent_run.input_hash` for flat plans, the frozen profile and the policy hash do not change. A nested plan's implementer prompt changes by design, and no stored run holds one.
- Not touched: `CLAUDE.md` and `AGENTS.md` (they already say "items" and must stay identical), the plan prompts, the plan gate and the reviewers.

**Verification:** Component: `validatePlanDoc` returns `taskItems` by the stated rule, and flat plans give `taskItems` equal to `tasks` (`test/plan-doc.test.ts`). End to end, as far as free commands reach: a stage test whose plan has more lines than the frozen ceiling and no more items than it runs to completion and dispatches once per phase of items; the recorded run 12 plan splits `[10, 10, 10, 10, 10, 3]` and its first phase prompt keeps each item's sub-bullets under its first line. Regression: `npm run typecheck`, `npm run check:docs`, the full serial suite compared with its two known failures, and the free smoke. A green result proves the count and the split, not that an implementer can return ten detailed items in one response.

**Hazards considered:**
- **Hazard 20** (one dispatch over a plan larger than one response): this is its documented residual, now measured on run 12. The remedy keeps its bound (ten units per phase, eight phases, frozen) and changes the unit from a line to an item. A plan of more than 80 real items still refuses.
- **Hazard 17** (a reconciliation answering a finding by deleting the obligation): `PlanDoc.tasks`, and so `planNormativeNodes`, stays per line, so a reworded or removed nested line still needs a claim. A test pins that `tasks` stays at 226 for the run 12 plan while `taskItems` is 53.
- **Hazard 13** (validators inventing obligations): the validator gains no refusal. A nested plan is accepted as it is now; only its measurement changes.
- **Hazard 3** (a constraint stated in a prompt): the prompts already say one task per list line and the author did not follow it. The plan does not add a refusal for nesting (it would turn a recoverable count into a blocked plan stage). It records the contradiction as open decision 1.
- **Hazard 4** (fixtures agreeing with code): the expected numbers (226 lines, 53 items, 173 nested) come from the committed run 12 fixture, whose plan hash equals the gate event's `planHash`, and the stage's own refusal message gives 226. The synthetic nested plan in the stage test takes its expectations from the stated rule.
- **Hazard 12** (configuration divergence): the frozen numbers (10 and 8) do not change, and the stage keeps reading them from `profile.policy`. Only the unit they count is clarified, so no migration applies.
- **Hazard 6** (promises a later stage cannot keep): the plan gate still passes a plan the implementation stage may refuse, after the plan stages are paid for. This change removes the false case; the true one (more than 80 real items) remains and is out of scope.
- **Hazards 1, 2, 5, 7-11, 14-16, 18, 19, 21:** not weighed as design inputs. Hazard 21 is unaffected: the verification rules in the prompts do not depend on the count.

## Replay against the motivating failure

Team-notes run 12 (2026-10-07; `--model claude-sonnet-5-5` for the reconciler; Opus authors, Haiku spec and plan reviewers): 11 dispatches, $3.0802364, stopped at `implementation` with "the approved plan has 226 tasks, more than the frozen ceiling of 80". The spec had 40 declared paths and 23 open decisions; the plan had 53 top-level tasks.

Replayed against this plan: `taskItems` has 53 elements, 53 is below 80, and `planPhases` gives six phases (five of ten items and one of three). The stage proceeds to its worktree and the first implementer dispatch. It does not show that the six phases complete, that the delivered code passes the frozen commands, or that the spec's mixed Node and Next layout builds. No implementer ran.

## Tasks

### Task 1: Derive task items in the plan parser

**Depends on:** None

**Files:**
- Modify: `src/plan-doc.ts` — `PlanDoc` gets `taskItems: string[]`; add a private `taskItems` helper beside `listItems`; `validatePlanDoc` fills it; update the comment on `planPhases` that says a phase boundary and the plan gate's notion of a task are the same thing.
- Modify: `test/plan-gate.test.ts` — the `PlanDoc` literal at line 29 gets `taskItems: ["do it"]`.
- Modify: `test/plan-doc.test.ts`.

**Steps:**
- Read `src/plan-doc.ts`, `test/plan-doc.test.ts` and `test/plan-gate.test.ts` to end of file before editing.
- Helper rule: take the `## Tasks` section text after `normalizeText`; drop empty lines; let the base indent be the smallest leading-whitespace length among the remaining lines. A line at the base indent starts a new item whose text is the line with its indent and a leading `-` marker removed. A line deeper than the base indent is appended to the current item after a newline, keeping its leading whitespace beyond the base indent and with trailing whitespace removed. A deeper line before any item starts one. Never include a blank line in an item.
- `validatePlanDoc` keeps `tasks` exactly as it is and returns `taskItems` beside it; the checkbox refusal and the empty-section refusal still run over the same text.
- Tests, each as its own `test(...)`: (a) a flat plan, `taskItems` deep-equals `tasks`; (b) the recorded run 6 plan, 57 items and `taskItems` deep-equals `tasks`; (c) a plan with two items, the first with two nested lines, gives `taskItems` of length 2 whose first element is its first line, a newline, and the two nested lines with their relative indentation, while `tasks` has four elements; (d) a plan indented uniformly by two spaces (one level) gives the same items as the unindented one; (e) a nested line before any item is kept, not dropped; (f) every non-empty line of the section, trimmed, appears exactly once and in order across `taskItems` split on newlines (no line lost or reordered).
- Break it: change the base-indent rule so every line starts an item, and (a) and (c) must fail; make the helper drop deeper lines, and (f) must fail. Restore each and hash the file before and after.
- Verify: `node --test test/plan-doc.test.ts test/plan-gate.test.ts`
- Expected: pass; each break fails the named test.

**Task completion evidence:** test output and the two break-it results.

### Task 2: Count and split by items in the implementation stage

**Depends on:** Task 1

**Files:**
- Modify: `src/implementation-stage.ts` — the ceiling comparison, the refusal text's count, and the `planPhases` call use `parsedPlan.value.taskItems`; update the comment above them (it says tasks) to say items.
- Modify: `test/implementation-stage.test.ts`.

**Steps:**
- Read `src/implementation-stage.ts` and `test/implementation-stage.test.ts` to end of file before editing.
- The refusal wording stays "the approved plan has N tasks, more than the frozen ceiling of C (P tasks per phase, at most M phases): ...", with N now the item count, so the two existing ceiling tests keep matching.
- Add a plan builder beside `tasksPlan(count)`: `nestedTasksPlan(items, nestedPerItem)` writes `items` top-level bullets each followed by `nestedPerItem` indented sub-bullets, with the same frontmatter and coverage line.
- Test A, shaped like the existing frozen-ceiling test: with `implementationPhaseTasks: 2` and `implementationMaxPhases: 3` frozen, a plan of 6 items with 3 nested lines each (24 lines, over the ceiling of 6) is implemented, with three dispatches, and the audit lines name tasks 1-2, 3-4 and 5-6.
- Test B: the same frozen numbers with 7 such items are refused by name with "has 7 tasks, more than the frozen ceiling of 6", with no dispatch, no worktree and no stage row.
- Test C: the first dispatch's prompt (rebuilt with `buildImplementationAuthorPrompt` and the plan's first phase, and matched to the `input_hash` of the first `agent_run` row the stage wrote) contains the first item's line, followed immediately by its sub-bullets, inside "Tasks for this phase".
- Break it: change the stage back to `parsedPlan.value.tasks` at the count only, and Test A must fail; at the `planPhases` call only, and Test A's audit-line assertion or Test C must fail. Restore and hash.
- Verify: `node --test test/implementation-stage.test.ts`
- Expected: pass; both breaks fail.

**Task completion evidence:** test output and the two break-it results.

### Task 3: The recorded run 12 plan

**Depends on:** Tasks 1-2

**Files:**
- Modify: `test/plan-doc.test.ts`, `test/prompts.test.ts`.
- Already present, uncommitted: `test/fixtures/recorded/plan-team-notes-run-12.json`.

**Steps:**
- Load the fixture the way `RUN_6` is loaded. Assert its provenance carries `tasksSectionLines: 226`, `tasksSectionTopLevelItems: 53` and `tasksSectionNestedLines: 173`, and that the plan's sha256 equals `provenance.planHash` (the committed plan is the one the gate approved).
- `plan-doc.test.ts`: `validatePlanDoc` gives `tasks.length` 226 (the number the stage refused) and `taskItems.length` 53; `planPhases(taskItems, 10)` gives item counts `[10, 10, 10, 10, 10, 3]`, six phases, all with `count` 6; 53 is at most 80 and 226 is more than 80 (the ceiling, written as 10 times 8 from `IMPLEMENTATION_PHASE_TASKS` and `IMPLEMENTATION_MAX_PHASES`); no item is dropped, repeated or reordered.
- `prompts.test.ts`: build `buildImplementationAuthorPrompt` for phase 1 of that plan, using `VERIFICATION` and a scope taken from the plan's own paths; assert the `Tasks for this phase` block contains the first item's first line followed directly by its recorded sub-bullets, and that no phase's last item is cut (the next phase's first rendered line is a top-level item).
- Break it: pass `tasks` to `planPhases` in those tests' setup, and the `[10, 10, 10, 10, 10, 3]` assertion must fail.
- Verify: `node --test test/plan-doc.test.ts test/prompts.test.ts`
- Expected: pass; the break fails.

**Task completion evidence:** test output and the break-it result.

### Task 4: Documents

**Depends on:** Tasks 1-3

**Files:**
- Modify: `docs/hazards.md` — entry 20.
- Modify: `ARCHITECTURE.md` — the `implementation` paragraph (section 12, Gates) and the "Implementation phases" bullet (section 20, Limits).
- Read first, edit only if they say a task is a line: the comment above `IMPLEMENTATION_PHASE_TASKS` in `src/policy.ts`, and `src/operator-output.ts`.
- Not edited: `CLAUDE.md`, `AGENTS.md` (they say "items" already), any historical document.

**Steps:**
- Hazard 20: add a measured bullet for run 12 (the 226-line count, the 53 items, $3.0802364 spent before the refusal, $1.8167862 of it on the plan and its review, no implementation spend) and replace the sentence "A task is one non-empty line ... or refused for size; run 6's plan was one line per bullet, and the plan gate does not enforce that" with the new rule: a task is a top-level item, its indented lines belong to it, the ceiling and the split count items, and the plan gate still counts each line as a normative node. Keep what remains true: ten items can still be more than one response; the refusal comes after the spec and plan are paid for; a plan of more than 80 real items still passes the plan gate and refuses later.
- ARCHITECTURE section 12: one sentence after "the next ten items of the plan's `## Tasks` section" saying an item is a top-level list entry and indented lines beneath it travel with it; and the section 20 bullet says "ten plan task items".
- Do not change the stated limits.
- Run `npm run check:docs` after each file.
- Verify: `npm run check:docs`
- Expected: clean; warnings only from historical documents.

**Task completion evidence:** `check:docs` output.

### Task 5: Full verification

**Depends on:** Tasks 1-4

**Steps:**
- `npm run typecheck`.
- `node --test --test-concurrency=1 --test-reporter=tap test/*.test.ts` (about 11 minutes; keep the file glob). Compare against the known failures (`test/sign-approval.test.ts` "nothing under src/ touches a private key" and `test/dashboard-server.test.ts` "dashboard CLI prints one bootstrap URL"); do not assume them.
- `git log -1` and `git status --short`: a stray empty "moved" commit is dropped only after `git diff <prior> HEAD` is empty.
- `node .claude/skills/run-buildworks/driver.mjs smoke`.
- Expected: typecheck clean; no failure beyond the two known; smoke `13/13 steps as expected`.
- Report what was not run: any paid run, and a resume of run 12.

**Task completion evidence:** the four outputs, with failures named.

## Out of scope

- Resuming run 12. The operator chose not to. After this change its next action would be the implementation range, and that needs its own authorization.
- A paid run. This plan authorizes none.
- Counting items for the plan gate's normative nodes. `PlanDoc.tasks` stays per line (hazard 17).
- A plan-gate refusal for nesting, or for a plan with more than 80 items. The second is the same refusal-after-spend the hazard records; bounding it at the plan gate would change what plans the gate accepts.
- A cap on the lines inside one item. Ten items with long nested detail may still exceed one response, which is unmeasured.
- The `implementationPhaseTasks` and `implementationMaxPhases` values, and `governed.yaml`.
- The toolchain probe, the system-computed stack facts and the declared stack intent discussed on 2026-10-07. They are a separate proposal, not yet written.

## Open decisions for the operator

1. **Reword "one plain task per list line" in the three plan prompts?** The sentence now says something the system no longer measures, and the author ignored it. Rewording touches `src/prompts.ts` in three places, the constraint scan and the routing tests, and risks the reconciler reading a nested line as not normative (an unclaimed edit would then abort the round, by name). Default: leave it, and revisit if a measured run shows an author flattening or nesting for the wrong reason.

## Implementation note

Tasks 1 to 5 are done in the working tree, uncommitted. The independent code review ran on 2026-10-07 and its three findings are reconciled below.

**What shipped.** `PlanDoc.taskItems` in `src/plan-doc.ts`, derived by the rule in Task 1 (a shared `itemText` helper gives `listItems` and the grouping one definition of a line's text); `src/implementation-stage.ts` checks the ceiling, words its refusal and splits phases by `taskItems`; `PlanDoc.tasks` is unchanged, so hazard 17's normative nodes still count every line. Tests: `test/plan-doc.test.ts`, `test/implementation-stage.test.ts`, `test/prompts.test.ts`, and the one `PlanDoc` literal in `test/plan-gate.test.ts`. Documents: hazard 20 in `docs/hazards.md` and sections 12 and 20 of `ARCHITECTURE.md`. The run 12 plan is replayed from `test/fixtures/recorded/plan-team-notes-run-12.json`: 226 lines, 53 items, six phases of `[10, 10, 10, 10, 10, 3]`.

**Verification.** `npm run typecheck` clean. `npm run check:docs` clean. Full serial suite, run again after the review fixes: 1408 tests, 1400 pass, 6 skipped, 2 fail. The two failures are the known ones and neither touches this change: `test/dashboard-server.test.ts` (Node's SQLite `ExperimentalWarning` on stderr where the test expects none) and `test/sign-approval.test.ts` (`src/dashboard-approval.ts` contains the words "private key"; that file has no diff). `HEAD` stayed at `c1471b5` and no stray commit appeared. The free smoke printed `13/13 steps as expected`.

**Deviations.**
- Task 3's planned break-it (pass `tasks` to `planPhases` in the tests' setup) was replaced by three mutations of production code in a scratch mirror: grouping disabled, deeper lines dropped, and the phase prompt flattening a task's detail lines onto its first line. Each fails the run 12 tests, and the third fails only the new prompts test. The stage-level `tasks`-in-place-of-`taskItems` break is Task 2's.
- The prompts test covers all six phases of the run 12 plan, not only phase 1. It compares the concatenated phase task blocks with the plan's `## Tasks` lines read without the parser. A separate test checks that the committed plan hashes to the gate event's `planHash`.
- `src/policy.ts` (the comment above `IMPLEMENTATION_PHASE_TASKS`) and `src/operator-output.ts` were read and not edited: neither says a task is a line.
- Hazard 20's measured range now reads 2026-09-27 to 2026-10-07.

**Independent review.** One reviewer subagent, dispatched in this session, read-only, with no sight of the author's reasoning. By hazard 14 that is `unverified_self_attestation`, not a proven independent review; the operator chose it over a billed `/code-review ultra` on 2026-10-07. It reported no critical, high or medium finding and three low ones, each checked here before acting:
- **Accepted, fixed. A bare `-` line became an empty task item.** `listItems` dropped a line with no text after its marker and `groupTaskItems` dropped only blank lines, so `- a`, `-`, `- b` gave `tasks` of 2 and `taskItems` of 3. A flat plan of 80 real tasks plus one stray `-` was accepted before this change and would have been refused. Reproduced on the real parser. Both views now share `itemText`; a new test pins it and fails when the blank-only filter returns.
- **Accepted, fixed. Nothing guarded the trailing-whitespace trim on nested lines.** Removing it broke no test. A new test pins it and fails without it.
- **Accepted, fixed. Two figures in hazard 20 had no evidence in the repository.** Both are true against the run's store and retained responses: the plan author rows plus the two plan reviewers sum to $1.8167862, and the author nested in the draft (201 task lines, 53 top-level), the self-critique and the reconciliation (226 each, 53 top-level). The figures now sit in the fixture's provenance block, and the hazard text states them.

The reviewer's other probes (tab and CRLF input, `*` and numbered markers, blank lines between items, deep nesting) gave correct or acceptable results. One it named and left alone: a section that mixes tabs and spaces in one list can group a line under the wrong item; no line is lost, and it needs a model to do that.

**Not done.** Any paid run, and any resume of run 12. A commit. Open decision 1 is unchanged. Whether ten items with nested detail fit one implementer response is still unmeasured.
