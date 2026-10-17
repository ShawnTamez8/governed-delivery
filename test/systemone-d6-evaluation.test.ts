import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSpecDoc } from "../src/spec-doc.ts";
import type { ChoiceAnswer } from "../src/systemone.ts";
import {
  BASELINES,
  NONE_RUBRIC,
  PINNED,
  QUESTION_NAME,
  REPLAY,
  TEST5,
  buildD6Request,
  evaluationPlan,
  haikuBaseline,
  loadCases,
  replayLabels,
  scoreD6,
  specClauses,
} from "../scripts/systemone-d6-evaluation.ts";

/**
 * The D6 builder and scorer (`docs/features/decision-1-d6-evaluation/plan.md`,
 * Task 5). Expected values come from the committed fixtures and from the
 * adoption rule the operator confirmed on 2026-10-16, never from the script.
 */

const parsed = validateSpecDoc(PINNED.spec);
assert.ok(parsed.ok, "the pinned spec parses");
const SPEC_DOC = parsed.value;
const CLAUSES = specClauses(PINNED.spec);
const CASES = loadCases();

test("every acceptance criterion is exactly one clause, and no declared artifact is one", () => {
  for (const criterion of SPEC_DOC.acceptanceCriteria) {
    const own = CLAUSES.filter((c) => c.text.startsWith(`${criterion.id}: `));
    assert.equal(own.length, 1, criterion.id);
  }
  assert.ok(SPEC_DOC.declaredArtifacts.length > 0);
  for (const path of SPEC_DOC.declaredArtifacts) {
    assert.ok(!CLAUSES.some((c) => c.text === path), path);
  }
  assert.ok(!CLAUSES.some((c) => /^\*\*[^*]+\*\*$/.test(c.text)), "a bold-label-only bullet is a clause");
  assert.ok(!CLAUSES.some((c) => c.text.startsWith("#") || c.text === "---"));
});

test("the labelled baselines are the clauses the fixtures quote", () => {
  const signOut = /baseline \\?"([^"\\]+)\\?"/.exec(TEST5.provenance.set5b!)?.[1];
  assert.equal(signOut, "Sign-out clears the cookie.");
  const reset = /each quoting "([^"]+)"/.exec(REPLAY.provenance.result)?.[1];
  assert.ok(reset);
  const line = (name: string) => CLAUSES.find((c) => c.name === name)!;
  assert.ok(line("L047").text.includes(signOut!));
  assert.equal(line("L049").text, reset);
  assert.match(REPLAY.provenance.labels, /spec baseline lines 47 and 49/);
  assert.equal(line("L047").line, 47);
  assert.equal(line("L049").line, 49);
  assert.deepEqual(BASELINES[905], ["L047"]);
});

test("the option count is within what the probe showed accepted", () => {
  const probe = JSON.parse(
    readFileSync(join(process.cwd(), "test", "fixtures", "recorded", "systemone-probe-snitch-resource.json"), "utf8")
  ) as { records: Array<{ label: string; status: number; request: { questions: Record<string, { criteria: object }> } }> };
  const many = probe.records.find((r) => r.label === "many-options")!;
  assert.equal(many.status, 200);
  const accepted = Object.keys(Object.values(many.request.questions)[0]!.criteria).length;
  assert.ok(CLAUSES.length + 1 <= accepted, `${CLAUSES.length + 1} options, ${accepted} accepted`);
});

test("the cases carry the fixtures' labels: 26 findings, 2 reject, 17 keep, 7 either", () => {
  const fromComment = replayLabels(REPLAY.reconcilerSource);
  const fromSentence = [...REPLAY.provenance.labels.matchAll(/(?<!AC-)\b(\d{3})\b/g)].map((m) => Number(m[1]));
  assert.deepEqual(
    [...fromComment.reject, ...fromComment.keep, ...fromComment.either].sort(),
    [...new Set(fromSentence)].sort()
  );
  assert.match(REPLAY.provenance.labels, new RegExp(`reject ${fromComment.reject.join(", ")} `));
  assert.equal(CASES.length, 26);
  const count = (label: string) => CASES.filter((c) => c.label === label).length;
  assert.deepEqual([count("reject"), count("keep"), count("either")], [2, 17, 7]);
  assert.deepEqual(CASES.filter((c) => c.label === "reject").map((c) => c.findingId), [200, 905]);
  for (const set of ["5a", "5b"] as const) {
    for (const finding of TEST5.sets[set].findings) {
      const label = CASES.find((c) => c.findingId === finding.findingId)!.label;
      assert.ok(TEST5.sets[set].labels[label].includes(finding.findingId), `${finding.findingId}`);
    }
  }
});

test("a D6 request offers every clause and none, over the finding and the whole spec", () => {
  const c = CASES.find((x) => x.findingId === 905)!;
  const { request, questionHash, stateHash } = buildD6Request(PINNED.spec, c);
  const question = request.questions[QUESTION_NAME]!;
  assert.equal(question.type, "choice");
  assert.deepEqual(Object.keys(question.criteria), [...CLAUSES.map((x) => x.name), "none"]);
  assert.equal(question.criteria.none, NONE_RUBRIC);
  assert.ok(request.state.startsWith(`Finding reported by code review:\n- location ${c.location}\n`));
  assert.ok(request.state.endsWith(`Approved specification:\n\n${PINNED.spec}`));
  for (const report of c.reports) assert.ok(request.state.includes(report.subject));
  assert.match(questionHash, /^[0-9a-f]{64}$/);
  assert.match(stateHash, /^[0-9a-f]{64}$/);
  assert.equal(evaluationPlan(CASES).length, 35);
});

// ---- the adoption rule ----------------------------------------------------------

function answer(choice: string, p: number): ChoiceAnswer {
  const probabilities: Record<string, number> = choice === "none" ? { none: p } : { [choice]: p, none: 1 - p };
  return { type: "choice", choice, confidence: p, probabilities };
}

/** Every planned label answered `none` at 0.99, then the given overrides. */
function answers(overrides: Record<string, ChoiceAnswer> = {}): Map<string, ChoiceAnswer> {
  const map = new Map(evaluationPlan(CASES).map((e) => [e.label, answer("none", 0.99)]));
  for (const [label, a] of Object.entries(overrides)) map.set(label, a);
  return map;
}

const verdictOf = (score: ReturnType<typeof scoreD6>, id: number) => score.cases.find((c) => c.findingId === id)!.verdict;

const PASSING = (() => {
  const overrides: Record<string, ChoiceAnswer> = { "case-200": answer("L049", 0.9), "case-905": answer("L047", 0.9) };
  for (let n = 1; n <= 9; n++) overrides[`repeat-905-${n}`] = answer("L047", 0.9);
  return overrides;
})();

test("the rule passes when both rejections hit a baseline and nothing else is withheld", () => {
  const score = scoreD6(answers(PASSING), CASES, 0.8);
  assert.deepEqual(score.clauses, { validity: true, determinism: true, noWrongRejections: true, correctRejections: true });
  assert.equal(score.pass, true);
  // P(withhold) = 1 - P(none) against 1 for reject and 0 otherwise, over the 19 labelled cases.
  assert.ok(Math.abs(score.brier - (2 * 0.1 ** 2 + 17 * 0.01 ** 2) / 19) < 1e-12, String(score.brier));
});

test("a rejection counts at exactly T, misses just under it, and must name a baseline", () => {
  assert.equal(verdictOf(scoreD6(answers({ ...PASSING, "case-200": answer("L047", 0.8) }), CASES, 0.8), 200), "correct-withhold");
  const under = scoreD6(answers({ ...PASSING, "case-200": answer("L047", 0.7999) }), CASES, 0.8);
  assert.equal(verdictOf(under, 200), "missed");
  assert.equal(under.clauses.correctRejections, false);
  const wrong = scoreD6(answers({ ...PASSING, "case-905": answer("L049", 0.95) }), CASES, 0.8);
  assert.equal(verdictOf(wrong, 905), "wrong-clause");
  assert.equal(wrong.pass, false);
  assert.equal(verdictOf(scoreD6(answers(), CASES, 0.8), 905), "missed");
});

test("withholding a keep-labelled finding fails, an either-labelled one does not", () => {
  const keep = scoreD6(answers({ ...PASSING, "case-195": answer("L047", 0.9) }), CASES, 0.8);
  assert.equal(verdictOf(keep, 195), "wrong-rejection");
  assert.equal(keep.clauses.noWrongRejections, false);
  const either = scoreD6(answers({ ...PASSING, "case-207": answer("L047", 0.9) }), CASES, 0.8);
  assert.equal(verdictOf(either, 207), "either-withheld");
  assert.equal(either.pass, true);
});

test("disagreeing #905 repeats or a missing answer fail the rule", () => {
  assert.equal(scoreD6(answers({ ...PASSING, "repeat-905-3": answer("L049", 0.9) }), CASES, 0.8).clauses.determinism, false);
  assert.equal(scoreD6(answers({ ...PASSING, "repeat-905-3": answer("L047", 0.92) }), CASES, 0.8).clauses.determinism, false);
  assert.equal(scoreD6(answers({ ...PASSING, "repeat-905-3": answer("L047", 0.905) }), CASES, 0.8).clauses.determinism, true);
  const missing = answers(PASSING);
  missing.delete("case-208");
  assert.equal(scoreD6(missing, CASES, 0.8).clauses.validity, false);
});

// ---- Haiku's recorded calls -----------------------------------------------------

test("Haiku's baseline reproduces the fixtures' recorded verdicts and pair outcomes", () => {
  const baseline = haikuBaseline(CASES);
  assert.equal(baseline.calls.length, 30);
  for (const call of TEST5.calls) {
    const mine = baseline.calls.find((c) => c.label === call.label)!;
    assert.deepEqual(mine.wrongRejections, call.verdict!.wrongRejects, call.label);
    assert.deepEqual(mine.missedRejections, call.verdict!.missedRejects, call.label);
  }
  // Replay provenance: "All 10 calls rejected 200 … no must-keep finding was rejected in any call".
  for (const call of baseline.calls.filter((c) => c.label.startsWith("rec-"))) {
    assert.deepEqual([call.wrongRejections, call.missedRejections], [[], []], call.label);
  }
  // docs/features/code-review-reconciler/plan.md, "Replay against the motivating failure".
  const pairs = (set: string) => baseline.pairs.filter((p) => p.set === set).map((p) => p.rejected);
  assert.deepEqual(pairs("replay"), [[200], [200], [200], [200], [200]]);
  assert.deepEqual(pairs("5a"), [[], [], [], [], []]);
  assert.deepEqual(pairs("5b"), [[], [905], [], [905], []]);
});
