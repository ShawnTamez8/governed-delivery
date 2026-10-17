import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSystemOneResponse, type ChoiceAnswer } from "../src/systemone.ts";
import { REPEATS, THRESHOLD, buildRequest, evaluationPlan, loadChecks, scoreCheck, type Check } from "../scripts/systemone-format-evaluation.ts";

/**
 * The format-check request plan and the adoption rule the operator chose on
 * 2026-10-17 (`docs/features/decision-1-format-checks/plan.md`, "Operator
 * confirmations"). The scoring cases below are read from that rule's four
 * clauses; no Decision-1 answer is involved.
 */
const CHECKS = loadChecks();

test("the plan asks every case once and each check's recorded failure nine more times", () => {
  const plan = evaluationPlan(CHECKS);
  for (const check of CHECKS) {
    const entries = plan.filter((e) => e.check === check.name);
    assert.equal(entries.length, check.cases.length + REPEATS, check.name);
    assert.equal(entries.filter((e) => e.caseId === check.repeated).length, REPEATS + 1, check.name);
    assert.equal(check.cases.find((c) => c.id === check.repeated)!.label, check.positive, `${check.name} repeats a labelled failure`);
  }
  assert.equal(new Set(plan.map((e) => e.label)).size, plan.length);
});

test("each request carries one question named for its check, with the check's two options", () => {
  for (const check of CHECKS) {
    for (const c of check.cases) {
      const { request } = buildRequest(check, c);
      assert.deepEqual(Object.keys(request.questions), [check.name]);
      assert.deepEqual(Object.keys(request.questions[check.name]!.criteria).sort(), [check.negative, check.positive].sort());
      assert.equal(request.state, c.state);
    }
  }
});

/** Every case answered with its own label at probability p; an either case answered negative. */
function answersFor(check: Check, p: number): Map<string, ChoiceAnswer> {
  const answer = (choice: string, pc: number): ChoiceAnswer => {
    const other = choice === check.positive ? check.negative : check.positive;
    return { type: "choice", choice, confidence: pc, probabilities: { [choice]: pc, [other]: 1 - pc } };
  };
  const map = new Map<string, ChoiceAnswer>();
  for (const entry of evaluationPlan([check])) {
    const label = check.cases.find((c) => c.id === entry.caseId)!.label;
    map.set(entry.label, answer(label === check.positive ? check.positive : check.negative, p));
  }
  return map;
}

for (const check of CHECKS) {
  test(`${check.name}: the rule passes only when all four clauses hold`, () => {
    const all = answersFor(check, 0.9);
    // Validated against a real request, so the synthetic answers have the response's shape.
    const first = check.cases[0]!;
    assert.deepEqual(
      validateSystemOneResponse({ model: "m", answers: { [check.name]: all.get(`${check.name}-${first.id}`) }, usage: { input_tokens: 1, output_tokens: 0 } }, buildRequest(check, first).request),
      []
    );
    assert.deepEqual(scoreCheck(all, check, THRESHOLD).clauses, { validity: true, determinism: true, noFalseAlarms: true, catches: true });

    const negative = check.cases.find((c) => c.label === check.negative)!;
    const falseAlarm = new Map(all);
    falseAlarm.set(`${check.name}-${negative.id}`, { type: "choice", choice: check.positive, confidence: 0.85, probabilities: { [check.positive]: 0.85, [check.negative]: 0.15 } });
    assert.equal(scoreCheck(falseAlarm, check, THRESHOLD).clauses.noFalseAlarms, false);

    const missed = new Map(all);
    missed.set(`${check.name}-${check.repeated}`, { type: "choice", choice: check.positive, confidence: 0.79, probabilities: { [check.positive]: 0.79, [check.negative]: 0.21 } });
    const scoredMissed = scoreCheck(missed, check, THRESHOLD);
    assert.equal(scoredMissed.clauses.catches, false, "below T is not flagged");
    assert.equal(scoredMissed.clauses.determinism, false, "a spread of 0.11 across the repeats");

    const spread = new Map(all);
    spread.set(`repeat-${check.repeated}-1`, { type: "choice", choice: check.positive, confidence: 0.92, probabilities: { [check.positive]: 0.92, [check.negative]: 0.08 } });
    assert.equal(scoreCheck(spread, check, THRESHOLD).clauses.determinism, false, "a spread of 0.02");
    const within = new Map(all);
    within.set(`repeat-${check.repeated}-1`, { type: "choice", choice: check.positive, confidence: 0.905, probabilities: { [check.positive]: 0.905, [check.negative]: 0.095 } });
    assert.equal(scoreCheck(within, check, THRESHOLD).clauses.determinism, true, "a spread of 0.005");

    const gap = new Map(all);
    gap.delete(`repeat-${check.repeated}-${REPEATS}`);
    assert.equal(scoreCheck(gap, check, THRESHOLD).clauses.validity, false);
  });
}
