import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSystemOneResponse, type ChoiceAnswer, type SystemOneResponse } from "../src/systemone.ts";
import {
  ADOPTION_RULE,
  INFORMATIONAL_THRESHOLDS,
  PINNED,
  QUESTION_NAME,
  THRESHOLD,
  buildD6Request,
  evaluationPlan,
  haikuBaseline,
  loadCases,
  scoreD6,
} from "../scripts/systemone-d6-evaluation.ts";

/**
 * The recorded D6 evaluation (`docs/features/decision-1-d6-evaluation/plan.md`,
 * Task 6): 35 paid requests to the operator's Decision-1 deployment on
 * 2026-10-16. Reads only the committed fixture, and proves it still describes
 * what the committed builder sends and the committed scorer concludes.
 */
const RESULT = JSON.parse(
  readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "systemone-d6-evaluation-crew-chatter-run-6.json"), "utf8")
) as {
  provenance: Record<string, unknown>;
  adoptionRule: string;
  labelsConfirmed: string;
  requests: Array<{ label: string; findingId: number; questionHash: string; stateHash: string }>;
  responses: Array<{ label: string; status: number; at: string; body: SystemOneResponse }>;
  score: { verdict: unknown; informational: unknown[] };
  haiku: unknown;
};

const CASES = loadCases();
const BY_ID = new Map(CASES.map((c) => [c.findingId, c]));

test("the fixture records the deployment, consent, date and what was dropped", () => {
  for (const field of ["consent", "endpoint", "deployment", "deploymentType", "captured", "modelsReported", "inputTokens", "dropped"]) {
    assert.ok(RESULT.provenance[field] !== undefined && RESULT.provenance[field] !== "", field);
  }
  assert.equal(RESULT.adoptionRule, ADOPTION_RULE);
  assert.equal(RESULT.labelsConfirmed, "2026-10-16");
});

test("every recorded request is the one the committed builder sends, in plan order", () => {
  assert.deepEqual(
    RESULT.requests.map((r) => r.label),
    evaluationPlan(CASES).map((e) => e.label)
  );
  for (const r of RESULT.requests) {
    const built = buildD6Request(PINNED.spec, BY_ID.get(r.findingId)!);
    assert.equal(r.questionHash, built.questionHash, `${r.label} question`);
    assert.equal(r.stateHash, built.stateHash, `${r.label} state`);
  }
});

test("every recorded response validates against its rebuilt request and names one model", () => {
  assert.equal(RESULT.responses.length, RESULT.requests.length);
  for (const response of RESULT.responses) {
    const request = RESULT.requests.find((r) => r.label === response.label)!;
    const built = buildD6Request(PINNED.spec, BY_ID.get(request.findingId)!);
    assert.equal(response.status, 200, response.label);
    assert.deepEqual(validateSystemOneResponse(response.body, built.request), [], response.label);
  }
  assert.deepEqual(RESULT.provenance.modelsReported, [...new Set(RESULT.responses.map((r) => r.body.model))]);
});

test("the recorded answers score to the recorded verdict, and Haiku's baseline is unchanged", () => {
  const answers = new Map<string, ChoiceAnswer>(RESULT.responses.map((r) => [r.label, r.body.answers[QUESTION_NAME]!]));
  assert.deepEqual(scoreD6(answers, CASES, THRESHOLD), RESULT.score.verdict);
  assert.deepEqual(
    INFORMATIONAL_THRESHOLDS.map((t) => scoreD6(answers, CASES, t)),
    RESULT.score.informational
  );
  assert.deepEqual(haikuBaseline(CASES), RESULT.haiku);
});
