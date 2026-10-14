import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeText, sha256Hex } from "../src/canonical.ts";
import { planPhases, validatePlanDoc } from "../src/plan-doc.ts";
import { IMPLEMENTATION_MAX_PHASES, IMPLEMENTATION_PHASE_TASKS } from "../src/policy.ts";

/**
 * The plan crew-chatter run 2 produced and its plan_review gate passed, verbatim
 * (`test/fixtures/recorded/plan-crew-chatter-run-2.json`, with provenance). It is
 * the first plan the implementation stage phased by task item: the run's own
 * `implementation.phase.apply` events state the task range of each dispatched
 * phase, and those recorded ranges are the expected values here, not numbers
 * written beside the code that computes them.
 */
const RUN_2 = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "plan-crew-chatter-run-2.json"), "utf8")
) as {
  provenance: {
    planHash: string;
    tasksSectionLines: number;
    tasksSectionTopLevelItems: number;
    tasksSectionNestedLines: number;
    implementationPhaseEvents: { auditId: number; summary: string }[];
  };
  planMarkdown: string;
};

function parsedPlan() {
  const result = validatePlanDoc(RUN_2.planMarkdown);
  assert.equal(result.ok, true, (result as { reason?: string }).reason);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
}

test("the recorded crew-chatter run 2 plan is the plan its gate passed", () => {
  assert.equal(sha256Hex(normalizeText(RUN_2.planMarkdown)), RUN_2.provenance.planHash);
});

test("the recorded crew-chatter run 2 plan counts 279 lines but 51 tasks, and only the tasks fit the stage ceiling", () => {
  const plan = parsedPlan();
  const ceiling = IMPLEMENTATION_PHASE_TASKS * IMPLEMENTATION_MAX_PHASES;
  assert.equal(plan.tasks.length, RUN_2.provenance.tasksSectionLines);
  assert.equal(plan.taskItems.length, RUN_2.provenance.tasksSectionTopLevelItems);
  assert.equal(plan.tasks.length - plan.taskItems.length, RUN_2.provenance.tasksSectionNestedLines);
  assert.ok(plan.tasks.length > ceiling, `${plan.tasks.length} lines must exceed ${ceiling}`);
  assert.ok(plan.taskItems.length <= ceiling, `${plan.taskItems.length} tasks must fit ${ceiling}`);
});

test("the phase split of the recorded plan equals the task ranges the run itself recorded for its first five phases", () => {
  const phases = planPhases(parsedPlan().taskItems, IMPLEMENTATION_PHASE_TASKS);
  const recorded = RUN_2.provenance.implementationPhaseEvents.map((event) => {
    const match = /^phase (\d+) of (\d+): tasks (\d+)-(\d+);/.exec(event.summary);
    assert.ok(match, `audit ${event.auditId} states a phase and its task range`);
    return { index: Number(match![1]), count: Number(match![2]), first: Number(match![3]), last: Number(match![4]) };
  });
  assert.equal(recorded.length, 5);
  assert.deepEqual(
    phases.slice(0, recorded.length).map((p) => ({
      index: p.index,
      count: p.count,
      first: p.firstTask,
      last: p.firstTask + p.tasks.length - 1,
    })),
    recorded
  );
  // The phase the usage limit refused is the one remaining task.
  assert.equal(phases.length, 6);
  assert.deepEqual(phases[5]!.tasks.length, 1);
  assert.deepEqual(phases.flatMap((p) => p.tasks), parsedPlan().taskItems);
});
