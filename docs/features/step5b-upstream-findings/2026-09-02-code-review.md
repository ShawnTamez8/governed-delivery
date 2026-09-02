# Step 5b Task 4 (self-critique contract and prompt) — code review

**Status:** reconciled

**Reviewed document:** `docs/features/step5b-upstream-findings/plan.md`, Task 4, together
with the accepted Task 1 prototype exit decision recorded in
`docs/features/step5b-upstream-findings/2026-09-01-task1-prototype-evidence.md` (revision A
binds this task).

**Review date:** 2026-09-02

**Effort:** high.

**Hazards considered:** 1 (the self-critique payload reaches the same
`extractJsonBody` → `validateAgentResult` path as every other result and then a
dedicated shape validator, every refusal naming its cause — checked, and the
refusals are asserted on the message, not merely on failure); 3 (the panel
request is a newly constrained model-returned field, so the source scan in
`test/prompts.test.ts` was extended to pin every rule the prompt states, and
the whole-file nature of that scan produced finding 3's neighbour: the scan
alone cannot localize a sentence two prompts share, which is why the
per-prompt assertions carry it); 4 (the new fixture payloads take their shape
from the plan's stated contract and the prototype's twelve recorded real
dispatches, not from values invented beside the validator, and eleven
break-and-restore mutations were run against the new guards); 7 (the
self-critique prompt is asserted to differ from the author prompt, so the
second author dispatch is not the first one repeated); 11 (the seeded registry
still completes a run, and the registered-specialty list the prompt names is
derived from the frozen profile's eligible reviewers rather than from a
constant); 12 (the self-critique dispatches under the `spec` and `plan` stage
kinds and resolves its model through `resolveStageModel`, the same entry
`bw dispatch` resolves by `stage.kind`, so the two surfaces cannot disagree);
14 (self-critique is an author dispatch and never a panel seat — asserted at
the registry, where no reviewer may carry either self-critique output). Hazard
2 bears on code this review found no fault with: `dispatchOnce` retains raw
output before any branching, and the new phase adds no path around it. Hazards
5, 6, 8, 9, 10, 13 and 15 do not apply: this task adds no delivery claim, no
promise a later stage must keep, no spawn of a new executable, no setup probe,
no model-string comparison, no validator that could manufacture a requirement,
and no subprocess boundary.

**Scope reviewed:** `git diff HEAD` over `src/agents/plan-author.ts`,
`src/agents/spec-author.ts`, `src/plan-stage.ts`, `src/prompts.ts`,
`src/spec-stage.ts`, `test/agents.test.ts`,
`test/fixtures/harness/emit-plan-stage.mjs`,
`test/fixtures/harness/emit-spec-stage.mjs`, `test/plan-stage.test.ts`,
`test/prompts.test.ts`, `test/spec-stage.test.ts`, plus the two untracked files
read in full: `src/self-critique.ts` and `test/self-critique.test.ts`.
`npm run typecheck` clean; `npm test` 523 tests, 522 pass, 1 skip, 0 fail;
`npm run check:docs` exit 0 with 36 warnings, unchanged from `5d63726`.

## Summary

The phase does what Task 4 specifies: one self-critique dispatch per artifact,
under the author's frozen definition and the author's model mapping, before any
reviewer dispatch, with the revised artifact re-gated by the same mechanical
checks the draft passed and no path that continues on the draft. The shape
validator refuses structurally and names every cause. The panel request is
validated and retained without reaching selection, which is the Task 5 boundary
the plan draws — and the reason `LEGACY_CLOSURE_PASSES` had to be reinstated
one task ago.

Eleven break-and-restore mutations were run against the new guards. Nine were
detected on the first attempt. Two were not, and both were defects in the
attack rather than held guards: one mutated a line downstream of the guard it
meant to remove, and one ran only the whole-file source scan, which cannot
localize a sentence the plan prompt also carries. Re-run correctly, both were
detected. Every mutation was restored and the tree verified.

Withheld: the spec stage writes a schema-valid document to disk before checking
its `change_kind` against the run, so a self-critique that returns the wrong
kind overwrites the draft on disk and then blocks. The diff mirrors the legacy
revision path, which has done this since the spec stage shipped, rather than
introducing it, and the run is terminal either way. Also withheld: nothing
distinguishes a self-critique `agent_run` row from a draft or revision row
except its position, since `agent_run` has no dispatch-kind column; adding one
now would be a field nothing enforces (section 9), and Task 7 owns the storage
question.

The findings cluster on the seam between the two stages: the plan side carries
the same code as the spec side but not the same proof.

## Findings

**Finding 1 — nothing proves the plan stage names the registry in its
self-critique prompt, so revision A holds on one side only.**

- **Where:** `src/plan-stage.ts` (`runPlanStage`, the `buildPlanSelfCritiquePrompt`
  call), against `test/plan-stage.test.ts`. The spec side has
  `test/spec-stage.test.ts` "the self-critique prompt names the specialties the
  frozen registry can seat"; the plan side has no counterpart.
- **Why it matters:** revision A of the accepted prototype result binds Task 4
  to supply the frozen registry's specialty list, because an author not told
  what can be staffed requested `data-privacy` and the run blocked by name on a
  request it had no way to get right. `buildPlanSelfCritiquePrompt`'s own test
  proves the list renders when it is passed; nothing proves the stage passes it.
  A later change that drops the argument turns the Task 5 staffing refusal from
  a backstop into the ordinary outcome on the plan side, at the cost of a paid
  panel per run, with a green suite.
- **Reproduced:** replaced `registeredSpecialties` with `[]` at the
  `buildPlanSelfCritiquePrompt` call site and ran `test/plan-stage.test.ts`:
  exit 0, no failing test. The same mutation on `src/spec-stage.ts` fails the
  spec-side registry test. Restored and confirmed byte-identical. — CONFIRMED

**Finding 2 — the self-critique capability refusal spends a dispatch before it
fires.**

- **Where:** `src/spec-stage.ts` and `src/plan-stage.ts`, the
  `author.outputs.includes("spec-self-critique")` and
  `...includes("plan-self-critique")` checks. Both sit after the draft
  dispatch; the sibling `outputs.includes("spec")` and `outputs.includes("plan")`
  checks sit before it.
- **Why it matters:** the stage's own stated rule is that a configuration
  failure fails "at configuration time — before any stage row or paid
  invocation" (`src/spec-stage.ts`, the model-resolution comment, and the
  ordering of every other capability and binding check). A run whose frozen
  profile carries an author without the self-critique output can never complete
  the stage, and the current ordering discovers that only after paying for the
  draft. Both new tests assert `counts.author === 1` at the refusal, which is
  the wasted dispatch written down.
- **Reachability:** not reachable with the seeded registry, which carries both
  outputs. It requires a frozen profile whose author definition was edited —
  the configuration the tests construct by rewriting the profile on disk. Low
  severity for that reason, and it is a correctness-of-ordering defect rather
  than a wrong result.
- **Reproduced:** the refusal path is exercised by "an author whose frozen
  definition cannot self-critique blocks before the dispatch" in both stage
  suites; each asserts one author `agent_run` row already exists when the
  refusal returns. — CONFIRMED

**Finding 3 — the self-critique phase is duplicated across both stages with no
recorded justification, which hard rule 4 counts as silent duplication.**

- **Where:** `src/spec-stage.ts` and `src/plan-stage.ts`, roughly fifty lines
  each: the capability check, the `registeredSpecialties` derivation, the
  dispatch, the four-step envelope validation, and the audit pair.
- **Why it matters:** hard rule 4 forbids abstraction before two real
  implementations exist, and `runPlanStage`'s docstring already records the
  duplication that rule produced — naming "author dispatch, envelope
  validation, content write, panel selection, findings, deterministic gate,
  bounded closure rounds". The self-critique phase is not in that list. The
  checklist states the test plainly: duplication that is named and deferred is
  compliant, silent duplication is a finding. The fix is a sentence, not an
  extraction: Task 9 rewires both orchestrators and is the step that can see
  which parts generalize.
- **Not reproduced:** a documentation-of-intent defect with no runtime failure
  mode. What would confirm it is the reading above — the docstring's list
  against the diff.

## Checks

`npm run typecheck` clean. `npm test` 523 tests, 522 pass, 1 skip, 0 fail.
`npm run check:docs` exit 0, 36 warnings, identical to the count recorded at
`5d63726`.

## Reconciliation

Every finding was mechanical — a missing test, a statement ordering, and a
sentence in a docstring. None was a judgment call, so all three were applied in
the same pass rather than carried to a decision.

**Finding 1 — applied.** `test/plan-stage.test.ts` gained "the self-critique
prompt names the specialties the frozen registry can seat", mirroring the spec
side. The fixture answers with the first lens the prompt actually listed, so an
empty list returns `none-listed` and the assertion fails. Proven by the
mutation that exposed the gap: `registeredSpecialties` replaced with `[]` at
the `buildPlanSelfCritiquePrompt` call site now fails that test, where before
it passed the whole file. Restored.

**Finding 2 — applied.** Both capability checks moved beside the draft's own
`outputs.includes(...)` check, before any dispatch. The two refusal tests now
assert that no `agent_run` row exists at all, rather than one. Proven by moving
each check back to its old position: both stage suites fail on the spend
assertion. Restored.

**Finding 3 — applied.** `runPlanStage`'s duplication docstring now names the
self-critique phase and the re-gating of what it returns, so the duplication
Task 9 will resolve is recorded rather than silent (hard rule 4).

**Verified after reconciliation:** `npm run typecheck` clean; `npm test` 524
tests, 523 pass, 1 skip, 0 fail; `npm run check:docs` exit 0, 36 warnings.
