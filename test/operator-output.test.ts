import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRunPreview } from "../src/operator-output.ts";
import { buildPolicy } from "../src/policy.ts";
import type { ExecutionGroup, RunSnapshot } from "../src/operator-state.ts";
import type { Profile } from "../src/profile.ts";

// formatRunPreview reads a handful of fields; the rest of a snapshot and a
// profile is irrelevant to the text under test, so the fixtures carry only those.
function preview(policy: ReturnType<typeof buildPolicy>, groups: ExecutionGroup[]): string {
  const snapshot = {
    run: { id: 6, slug: "team-notes" },
    configuration: { dispatchSettings: {}, verificationCommands: [] },
  } as unknown as RunSnapshot;
  const profile = { systemName: "BuildWorks", policy } as unknown as Profile;
  return formatRunPreview("/target", snapshot, groups, profile);
}

const RUN_6_GROUPS: ExecutionGroup[] = ["plan", "implementation", "verification", "code_review", "delivery_check"];

test("the implementation ceiling is the frozen phase ceiling, not one dispatch", () => {
  // Values no default or old constant produces: the old ceiling was 1 and the
  // defaults are 10 and 8, so a preview that ignored the frozen policy would
  // print one of those.
  const text = preview({ ...buildPolicy(), implementationPhaseTasks: 7, implementationMaxPhases: 4 }, RUN_6_GROUPS);
  assert.match(text, /Dispatch ceilings for this range: .*implementation=4,/);
  assert.ok(
    text.includes(
      "Implementation: one implementer dispatch per 7 plan tasks, at most 4 phases; the phase count is known once the plan exists."
    )
  );
});

test("the preview a run 6 consent covers: plan 5, implementation 8, code review 7 plus the reconciler calls", () => {
  // `plan=5` and `code_review=7` are what the run 6 preview printed on
  // 2026-10-04 (it also printed `implementation=1` and `total 13`). The
  // implementation ceiling changes from 1 to the default of 8 phases, and the
  // code-review reconciler adds its frozen calls before the one remediation.
  const policy = buildPolicy();
  const codeReview = 7 + (policy.codeReviewMaxRounds - 1) * policy.codeReviewReconcilerCalls;
  const text = preview(policy, RUN_6_GROUPS);
  assert.ok(
    text.includes(
      `Dispatch ceilings for this range: plan=5, implementation=8, verification=0, code_review=${codeReview}, delivery_check=0; total ${5 + 8 + codeReview}.`
    ),
    text
  );
});

test("the code-review ceiling counts the reconciler calls before each remediation", () => {
  // Three rounds and three calls: values no default produces (both default to
  // 2), so a preview that ignored the frozen policy would print another number.
  const policy = { ...buildPolicy(), codeReviewMaxRounds: 3, codeReviewReconcilerCalls: 3 };
  const text = preview(policy, ["code_review"]);
  const ceiling = policy.codeReviewPanelSize * 3 + 2 * (1 + 3);
  assert.ok(text.includes(`Dispatch ceilings for this range: code_review=${ceiling}; total ${ceiling}.`), text);
  assert.ok(
    text.includes(
      `Code review: ${policy.codeReviewPanelSize} reviewers * 3 panel(s), plus before each of at most 2 remediation implementer dispatch(es) up to 3 code-review reconciler dispatches; each remediation is followed by frozen verification; blocking severity ${policy.codeReviewBlockingSeverity}.`
    ),
    text
  );
});

test("the spec ceiling counts the split dispatch and the sentence states the frozen threshold", () => {
  // 17 is a value no default produces (the default is 30), so a preview that
  // printed the live constant would not contain it.
  const policy = { ...buildPolicy(), designSplitPathThreshold: 17 };
  const text = preview(policy, ["spec"]);
  const ceiling = 3 + policy.specReviewRounds * (policy.panelSizeMax + 1);
  assert.ok(text.includes(`Dispatch ceilings for this range: spec=${ceiling}; total ${ceiling}.`), text);
  assert.ok(
    text.includes("The spec group adds 1 split-proposal dispatch when the reviewed spec declares more than 17 files."),
    text
  );
});

test("a range that does not include implementation does not count its ceiling", () => {
  const text = preview(buildPolicy(), ["plan"]);
  assert.ok(text.includes("Dispatch ceilings for this range: plan=5; total 5."), text);
});
