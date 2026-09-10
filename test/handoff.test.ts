import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatImplementationGate, parseImplementationGate, parseVerificationHandoff } from "../src/handoff.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const LONG = "c".repeat(64);

test("the formatter and parser round-trip a canonical handoff", () => {
  const summary = formatImplementationGate({ base: A, head: B });
  assert.equal(summary, `base=${A}; head=${B}`);
  assert.deepEqual(parseImplementationGate(summary), { ok: true, value: { base: A, head: B } });
});

test("the parser accepts 64-hex commits, matching git's sha256 mode", () => {
  assert.deepEqual(parseImplementationGate(`base=${LONG}; head=${B}`), {
    ok: true,
    value: { base: LONG, head: B },
  });
});

test("every malformed shape refuses by name with the expected format", () => {
  const cases = [
    "implementation passed",
    `head=${A}`, // the pre-step-8 shape: no base
    `base=${A}`,
    `base=${A}; head=not-a-commit`,
    `base=xyz; head=${B}`,
    `BASE=${A}; head=${B}`,
    `base=${A}; head=${B}; extra=true`,
  ];
  for (const summary of cases) {
    const result = parseImplementationGate(summary);
    assert.equal(result.ok, false, `must refuse: ${JSON.stringify(summary)}`);
    if (!result.ok) {
      assert.match(result.reason, /does not record the implementation handoff as base=<commit>; head=<commit>/);
      assert.ok(result.reason.includes(JSON.stringify(summary)), "the refusal names the offending summary");
    }
  }
});

test("surrounding whitespace is tolerated the way the stage's read tolerates it", () => {
  // The verification stage trims what it reads from the audit event; the
  // parser keeps the same tolerance so a stored summary cannot break on a
  // cosmetic difference.
  assert.equal(parseImplementationGate(`  base=${A}; head=${B}\n`).ok, true);
});

test("uppercase hex refuses: the commits are recorded in git's lowercase form", () => {
  assert.equal(parseImplementationGate(`base=${A.toUpperCase()}; head=${B}`).ok, false);
});

test("the format is canonical: exactly one rendering, stable across revisions", () => {
  assert.equal(formatImplementationGate({ base: A, head: B }), formatImplementationGate({ base: A, head: B }));
});

function recordedVerification() {
  const chain = JSON.parse(readFileSync(new URL(
    "./fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json", import.meta.url
  ), "utf8"));
  const stage = chain.stages.find((entry: { kind: string }) => entry.kind === "verification");
  return {
    runId: chain.run.id as number,
    stageId: stage.id as number,
    worktreePath: chain.review.worktreePath as string,
    verifiedCommit: chain.review.initialVerifiedCommit as string,
    patchBase: chain.review.patchBase as string,
    outcome: stage.gate_result as string,
  };
}

test("verification parsing returns only the checked handoff from the recorded chain", () => {
  const record = recordedVerification();
  const { outcome: _outcome, ...expected } = record;
  const result = parseVerificationHandoff(record, record.runId, record.stageId);
  assert.deepEqual(result, { ok: true, value: expected });
  assert.deepEqual(parseVerificationHandoff({
    ...record, worktreePath: "", commands: [null], createdAt: null,
  }, record.runId, record.stageId), {
    ok: true, value: { ...expected, worktreePath: "" },
  }, "the existing callers checked a string path, not its contents or unrelated fields");
  const longCommit = record.verifiedCommit + record.verifiedCommit.slice(0, 24);
  assert.deepEqual(parseVerificationHandoff({
    ...record, verifiedCommit: longCommit, patchBase: longCommit,
  }, record.runId, record.stageId), {
    ok: true, value: { ...expected, verifiedCommit: longCommit, patchBase: longCommit },
  });
});

test("verification parsing refuses malformed and mismatched records without throwing", () => {
  const record = recordedVerification();
  const values: unknown[] = [
    null, undefined, false, 1, "", [], {},
    { ...record, runId: record.runId + 1 },
    { ...record, stageId: String(record.stageId) },
    { ...record, stageId: record.stageId + 1 },
    { ...record, worktreePath: null },
    { ...record, verifiedCommit: record.verifiedCommit.toUpperCase() },
    { ...record, verifiedCommit: record.verifiedCommit.slice(1) },
    { ...record, patchBase: "not-a-commit" },
    { ...record, outcome: "block" },
  ];
  for (const value of values) {
    assert.deepEqual(parseVerificationHandoff(value, record.runId, record.stageId), {
      ok: false, reason: "the record does not describe this run's passed verification",
    });
  }
});
