import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRunPreview } from "../src/operator-output.ts";
import { buildPolicy } from "../src/policy.ts";
import type { ExecutionGroup, RunSnapshot } from "../src/operator-state.ts";
import type { NarrationCheckConfig, Profile } from "../src/profile.ts";
import { narrationQuestionHash } from "../src/narration-check.ts";
import { readFileSync } from "node:fs";

// formatRunPreview reads a handful of fields; the rest of a snapshot and a
// profile is irrelevant to the text under test, so the fixtures carry only those.
function preview(policy: ReturnType<typeof buildPolicy>, groups: ExecutionGroup[], narrationCheck: NarrationCheckConfig | null = null): string {
  const snapshot = {
    run: { id: 6, slug: "team-notes" },
    configuration: { dispatchSettings: {}, verificationCommands: [] },
  } as unknown as RunSnapshot;
  const profile = { systemName: "BuildWorks", policy, narrationCheck } as unknown as Profile;
  return formatRunPreview("/target", snapshot, groups, profile);
}

const RUN_6_GROUPS: ExecutionGroup[] = ["plan", "implementation", "verification", "code_review", "delivery_check"];

test("the implementation ceiling is the frozen phase ceiling plus the self-review, not one dispatch", () => {
  // Values no default or old constant produces: the old ceiling was 1 and the
  // defaults are 10 and 8, so a preview that ignored the frozen policy would
  // print one of those. The self-review after the last phase adds one dispatch
  // (docs/features/implementation-self-review/plan.md).
  const policy = { ...buildPolicy(), implementationPhaseTasks: 7, implementationMaxPhases: 4 };
  const text = preview(policy, RUN_6_GROUPS);
  assert.match(text, new RegExp(`Dispatch ceilings for this range: .*implementation=${policy.implementationMaxPhases + 1},`));
  assert.ok(
    text.includes(
      "Implementation: one implementer dispatch per 7 plan tasks, at most 4 phases, then one implementer self-review dispatch; the phase count is known once the plan exists."
    ),
    text
  );
});

test("the preview a run 6 consent covers: plan 5, the phases plus the self-review, code review 7 plus the reconciler calls", () => {
  // `plan=5` and `code_review=7` are what the run 6 preview printed on
  // 2026-10-04 (it also printed `implementation=1` and `total 13`). The
  // implementation ceiling changes from 1 to the default of 8 phases plus the
  // self-review, and the code-review reconciler adds its frozen calls before
  // the one remediation.
  const policy = buildPolicy();
  const implementation = policy.implementationMaxPhases + 1;
  const codeReview = 7 + (policy.codeReviewMaxRounds - 1) * policy.codeReviewReconcilerCalls;
  const text = preview(policy, RUN_6_GROUPS);
  assert.ok(
    text.includes(
      `Dispatch ceilings for this range: plan=5, implementation=${implementation}, verification=0, code_review=${codeReview}, delivery_check=0; total ${5 + implementation + codeReview}.`
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

test("the preview states whether spec review asks Decision-1, and where", () => {
  assert.ok(preview(buildPolicy(), ["spec"]).split("\n").includes("Narration check: off (new-run --no-narration-check)."));
  // The deployment is the recorded probe's.
  const probe = JSON.parse(readFileSync("test/fixtures/recorded/systemone-probe-snitch-resource.json", "utf8")).provenance;
  const config = { endpoint: probe.endpoint, deployment: probe.deployment, deploymentType: probe.deploymentType, threshold: 0.8, timeoutMs: 30000, questionHash: narrationQuestionHash() };
  const text = preview(buildPolicy(), ["spec"], config);
  assert.ok(
    text.split("\n").includes(`Narration check: one Decision-1 request per acceptance criterion per spec-review round to ${probe.deployment} at ${probe.endpoint}, flagged at P >= 0.8; not counted in the dispatch ceilings; any failed request blocks the run.`),
    text
  );
});
