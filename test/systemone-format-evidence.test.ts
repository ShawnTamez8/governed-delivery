import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSystemOneResponse, type ChoiceAnswer, type SystemOneResponse } from "../src/systemone.ts";
import {
  ADOPTION_RULE,
  INFORMATIONAL_THRESHOLDS,
  RESULT_PATH,
  THRESHOLD,
  buildRequest,
  evaluationPlan,
  loadChecks,
  scoreCheck,
  type CheckName,
} from "../scripts/systemone-format-evaluation.ts";

/**
 * The recorded format-check evaluation (`docs/features/decision-1-format-checks/plan.md`,
 * Task 4): 172 paid requests to the operator's Decision-1 deployment on
 * 2026-10-17. Reads only the committed fixture, and proves it still describes
 * what the committed builder sends and the committed scorer concludes.
 */
const RESULT = JSON.parse(readFileSync(RESULT_PATH, "utf8")) as {
  provenance: Record<string, unknown>;
  adoptionRule: string;
  labelsConfirmed: string;
  requests: Array<{ label: string; check: CheckName; caseId: string; questionHash: string; stateHash: string }>;
  responses: Array<{ label: string; status: number; at: string; body: SystemOneResponse }>;
  score: Array<{ verdict: unknown; informational: unknown[] }>;
};

const CHECKS = loadChecks();
const BY_NAME = new Map(CHECKS.map((c) => [c.name, c]));

function rebuilt(r: { check: CheckName; caseId: string }) {
  const check = BY_NAME.get(r.check)!;
  return buildRequest(check, check.cases.find((c) => c.id === r.caseId)!);
}

test("the fixture records the deployment, consent, date and what was dropped", () => {
  for (const field of ["consent", "endpoint", "deployment", "deploymentType", "captured", "modelsReported", "inputTokens", "dropped"]) {
    assert.ok(RESULT.provenance[field] !== undefined && RESULT.provenance[field] !== "", field);
  }
  assert.equal(RESULT.adoptionRule, ADOPTION_RULE);
  assert.equal(RESULT.labelsConfirmed, "2026-10-17");
});

test("every recorded request is the one the committed builder sends, in plan order", () => {
  assert.deepEqual(
    RESULT.requests.map((r) => r.label),
    evaluationPlan(CHECKS).map((e) => e.label)
  );
  for (const r of RESULT.requests) {
    const built = rebuilt(r);
    assert.equal(r.questionHash, built.questionHash, `${r.label} question`);
    assert.equal(r.stateHash, built.stateHash, `${r.label} state`);
  }
});

test("every recorded response validates against its rebuilt request and names one model", () => {
  assert.equal(RESULT.responses.length, RESULT.requests.length);
  for (const response of RESULT.responses) {
    const request = RESULT.requests.find((r) => r.label === response.label)!;
    assert.equal(response.status, 200, response.label);
    assert.deepEqual(validateSystemOneResponse(response.body, rebuilt(request).request), [], response.label);
  }
  assert.deepEqual(RESULT.provenance.modelsReported, [...new Set(RESULT.responses.map((r) => r.body.model))]);
});

test("the recorded answers score to the recorded verdicts", () => {
  const checkOf = new Map(RESULT.requests.map((r) => [r.label, r.check]));
  const answers = new Map<string, ChoiceAnswer>(RESULT.responses.map((r) => [r.label, r.body.answers[checkOf.get(r.label)!]!]));
  assert.deepEqual(
    RESULT.score,
    CHECKS.map((check) => ({
      verdict: scoreCheck(answers, check, THRESHOLD),
      informational: INFORMATIONAL_THRESHOLDS.map((t) => scoreCheck(answers, check, t)),
    }))
  );
});
