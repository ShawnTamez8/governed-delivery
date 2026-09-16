# Debugging Analysis: Plan Reconciliation Unclaimed Coverage Node

## Problem

During the live paid run of `target-tap` on 2026-09-16, stage 5 (`plan_review`) blocked
at round 1 reconciliation with exit code 1 after 10 dispatches ($1.55366 total spend).
The run database recorded audit event 34:
`plan.reconcile.invalid: plan reconciliation left normative node(s) unclaimed by any decision: AC-011 -> not_applicable: ...`

## Expected Behavior

When the plan author reconciles findings from a plan review panel, all added and
removed normative nodes across both `## Tasks` and `## Coverage` are either:
1. Left untouched if the finding does not require changing that criterion's mapping; or
2. Claimed in `normativeChanges` by an `addressed` decision with textual grounding in the
   approved specification.

## Actual Behavior

The plan author addressed reviewer findings regarding `src/render.js` in `## Tasks` and
claimed both the added and removed task nodes in `normativeChanges`. However, the author
also incidentally rephrased the alternative verification text of a `not_applicable` coverage
line in `## Coverage` (`AC-011`) without claiming the change in `normativeChanges`.
`planNormativeNodes` treats all coverage lines as normative nodes, so the multiset difference
detected an unclaimed added node and an unclaimed removed node, causing the deterministic
reconciliation gate to fail closed.

## Reproducibility

Deterministic given model output that modifies coverage line phrasing.
Observed in the live paid run on 2026-09-16 (`.governance/raw/1/2026-09-16T22-25-13-262Z-5a40588622c9.json`).

## Evidence

- **Audit Event 34** (`run` 1 in target worktree):
  `plan.reconcile.invalid: plan reconciliation left normative node(s) unclaimed by any decision: AC-011 -> not_applicable: ...`
- **Retained Model Output**:
  In `.governance/raw/1/2026-09-16T22-25-13-262Z-5a40588622c9.json`, the plan author returned:
  - `status: "proposed"`
  - Revised plan content with modified tasks and modified `AC-011` coverage line.
  - `decisions`: claimed task nodes under finding 5, but made no claims regarding `AC-011`.
- **`src/reconciliation.ts` Contract**:
  `planNormativeNodes` defines plan normative nodes as:
  ```ts
  export function planNormativeNodes(doc: PlanDoc): string[] {
    return [
      ...doc.tasks,
      ...doc.coverage.map((entry) =>
        entry.artifact !== null
          ? `${entry.criterionId} -> ${entry.artifact}`
          : `${entry.criterionId} -> not_applicable: ${entry.rationale} / ${entry.alternativeVerification}`
      ),
    ];
  }
  ```
  Every line in `## Coverage` is a normative node. Any edit to a coverage line generates
  one added node and one removed node.
- **Prompt Gap in `src/prompts.ts`**:
  `buildPlanReconcilePrompt` provided `nodeForm` to `reconciliationDecisionContract` as:
  `a task's node text is the task itself and a coverage entry's is AC-001 -> <artifact path>`
  The prompt:
  1. Did not state that `not_applicable: <rationale> / <alternative verification>` lines are normative nodes.
  2. Did not explicitly instruct authors that every line in `## Coverage` is a normative node.
  3. Did not instruct authors to refrain from casually rephrasing or polishing coverage entries when addressing task findings.
  4. Did not explicitly state that any altered coverage line must be claimed as both an added and removed node in `normativeChanges`.

## Likely Failing Layer

Prompt contract in `src/prompts.ts` (`buildPlanReconcilePrompt`) and missing constraint assertions
in `test/prompts.test.ts`.

## Scope Narrowing

The deterministic gate in `src/reconciliation.ts` is working exactly as designed per
`ARCHITECTURE.md` §12: it enforces multiset accounting for normative nodes and prevents
unclaimed or ungrounded changes from passing. No changes to `src/reconciliation.ts` or
`src/policy.ts` are required. The fix is strictly within the author prompt contract in
`src/prompts.ts` and its regression tests in `test/prompts.test.ts`.

## Hypothesis

Explicitly instructing the plan author that:
1. Every task in `## Tasks` and every line in `## Coverage` (including `not_applicable`) is a normative node;
2. Coverage lines must not be casually rephrased or polished when addressing task findings; and
3. Any modified coverage line must have its added and removed node forms claimed in `normativeChanges` with specification grounding;
will prevent plan author models from introducing unclaimed coverage edits during reconciliation.

## Codebase Review

- `src/prompts.ts`:
  Read `reconciliationDecisionContract` (lines 550-645) and `buildPlanReconcilePrompt` (lines 740-820).
  Updated `nodeForm` to describe both `AC-001 -> <artifact path>` and `AC-001 -> not_applicable: <rationale> / <alternative verification>`.
  Added explicit instructions regarding `## Tasks` and `## Coverage` normative nodes and forbidding casual rewrites.
- `test/prompts.test.ts`:
  Read lines 45-140 and 725-780.
  Added new constraint strings to `CONSTRAINT_STRINGS` and asserted them on the generated prompt.

## Proposed Fix

1. Update `src/prompts.ts` (`buildPlanReconcilePrompt`):
   - Include `not_applicable` line format in `nodeForm`.
   - Add explicit warnings that all lines in `## Coverage` are normative nodes and must not be casually rephrased.
2. Update `test/prompts.test.ts`:
   - Add new constraints to `CONSTRAINT_STRINGS` and prompt assertions.

## Validation Plan

1. Run `npm run typecheck` (strict TypeScript check).
2. Run `node --test test/prompts.test.ts`.
3. Run `node --test test/reconciliation.test.ts`.
4. Run `npm run check:docs`.
5. Run full test suite (`npm test`).

## Regression Coverage

`test/prompts.test.ts` validates that every constrained field is present in `src/prompts.ts`
source and in the generated prompt output for `buildPlanReconcilePrompt`.

## Risks

None. The prompt changes add clarity and alignment with the existing deterministic
validator in `src/reconciliation.ts` without altering the schema or validator logic.
