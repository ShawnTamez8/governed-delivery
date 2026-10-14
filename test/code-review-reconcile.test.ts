import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KEEP_BASES,
  agreedRejections,
  validateReconcilerReply,
  type ReconcilerDecision,
} from "../src/code-review-reconcile.ts";

/**
 * Expected values come from the recorded replays (`test/fixtures/recorded/`):
 * the `problems` each call's check wrote, and the labels fixed before any
 * call. The specification and plan are crew-chatter run 6's approved texts,
 * pinned with their store hashes (`test/code-review-reconcile-evidence.test.ts`).
 */
const recorded = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "recorded", name), "utf8"));

const PINNED = recorded("crew-chatter-run-6-approved-spec-plan.json") as { spec: string; plan: string };
const LOCATION = "docs/features/crew-chatter-foundation/spec.md";

interface RecordedCall {
  label: string;
  problems: string[];
  decisions: unknown[];
}
const REPLAY = recorded("code-review-reconciler-replay-crew-chatter-run-6.json") as {
  provenance: { labels: string };
  calls: RecordedCall[];
};
const TEST_5 = recorded("code-review-reconciler-test-5-crew-chatter-run-6.json") as {
  sets: Record<"5a" | "5b", { labels: { keep: number[] }; findings: { findingId: number }[] }>;
  calls: RecordedCall[];
};
const RUN_6 = recorded("code-review-crew-chatter-run-6.json") as {
  codeReviewFindings: { findingId: number; round: number }[];
};

/** Each recorded set: its finding ids (prompt order), calls, and keep-labelled ids. */
const SETS = {
  replay: {
    ids: RUN_6.codeReviewFindings.filter((f) => f.round === 1).map((f) => f.findingId),
    calls: REPLAY.calls,
    // "keep 195 (AC-019), 197 (AC-004), ...; either ..." — the ids, not the criterion numbers.
    keep: [...REPLAY.provenance.labels.split("keep ")[1]!.split("; either")[0]!.matchAll(/(?<![-\d])(\d{3})(?!\d)/g)]
      .map((match) => Number(match[1])),
  },
  "5a": {
    ids: TEST_5.sets["5a"].findings.map((f) => f.findingId),
    calls: TEST_5.calls.filter((c) => c.label.startsWith("5a-")),
    keep: TEST_5.sets["5a"].labels.keep,
  },
  "5b": {
    ids: TEST_5.sets["5b"].findings.map((f) => f.findingId),
    calls: TEST_5.calls.filter((c) => c.label.startsWith("5b-")),
    keep: TEST_5.sets["5b"].labels.keep,
  },
};

const check = (ids: number[], value: unknown) =>
  validateReconcilerReply(value, { findingIds: ids, spec: PINNED.spec, plan: PINNED.plan, specLocation: LOCATION });

/** The finding ids a check flagged: an unusable decision or a keep with an invalid basis. */
function flagged(decisions: Map<number, ReconcilerDecision>): number[] {
  return [...decisions.entries()]
    .filter(([, d]) => d.disposition === "unusable" || (d.disposition === "keep" && !d.basisValid))
    .map(([id]) => id)
    .sort((a, b) => a - b);
}

// --- one test per rule ------------------------------------------------------

const BASELINE = "A successful reset replaces the password hash, so the old password no longer signs in.";

test("the recorded baseline sentence and plan-task basis are real text in the pinned documents", () => {
  // The unit tests below use these as their valid excerpt and basis.
  assert.ok(PINNED.spec.includes(BASELINE));
  assert.deepEqual(check([1], { decisions: [{ findingId: 1, disposition: "keep", basis: "plan task: Add password reset to `backend/src/features/auth/service.ts`" }] }).problems, []);
});

test("a reply with no decisions array makes every listed finding unusable", () => {
  for (const value of [null, "prose", [], { decisions: "none" }, {}]) {
    const result = check([1, 2], value);
    assert.deepEqual(result.problems, ["the reply has no decisions array"]);
    assert.deepEqual([...result.decisions.values()].map((d) => d.disposition), ["unusable", "unusable"]);
  }
});

test("a finding with no entry or two entries is unusable", () => {
  const result = check([1, 2], {
    decisions: [
      { findingId: 2, disposition: "keep", basis: "crash" },
      { findingId: 2, disposition: "keep", basis: "crash" },
    ],
  });
  assert.deepEqual(result.decisions.get(1), { disposition: "unusable", reason: "finding 1 has 0 decisions" });
  assert.deepEqual(result.decisions.get(2), { disposition: "unusable", reason: "finding 2 has 2 decisions" });
});

test("an entry for an unlisted finding is a problem and changes nothing else", () => {
  const result = check([1], {
    decisions: [
      { findingId: 1, disposition: "keep", basis: "crash" },
      { findingId: 999, disposition: "reject", rationale: "r", excerpt: BASELINE },
    ],
  });
  assert.deepEqual(result.problems, ["unknown finding 999"]);
  assert.deepEqual([...result.decisions.keys()], [1]);
  assert.deepEqual(result.decisions.get(1), { disposition: "keep", basis: "crash", basisValid: true });
});

test("a reject needs a rationale and an excerpt found in the specification", () => {
  const result = check([1, 2, 3, 4], {
    decisions: [
      { findingId: 1, disposition: "reject", rationale: "Beyond the baseline.", excerpt: BASELINE },
      { findingId: 2, disposition: "reject", rationale: " ", excerpt: BASELINE },
      { findingId: 3, disposition: "reject", rationale: "r", excerpt: "words the specification never says" },
      // Whitespace differences are typography (collapseWhitespace), not a different quote.
      { findingId: 4, disposition: "reject", rationale: "r", excerpt: BASELINE.replaceAll(" ", "\n  ") },
    ],
  });
  assert.deepEqual(result.decisions.get(1), { disposition: "reject", rationale: "Beyond the baseline.", excerpt: BASELINE });
  assert.deepEqual(result.decisions.get(2), { disposition: "unusable", reason: "finding 2 reject has no rationale" });
  assert.deepEqual(result.decisions.get(3), {
    disposition: "unusable",
    reason: "finding 3 reject excerpt not in spec: grounding excerpt does not occur in the governing specification",
  });
  assert.equal(result.decisions.get(4)!.disposition, "reject");
  const missing = check([5], { decisions: [{ findingId: 5, disposition: "reject", rationale: "r" }] });
  assert.equal(missing.decisions.get(5)!.disposition, "unusable");
  assert.match(missing.problems[0]!, /finding 5 reject excerpt not in spec/);
});

test("a keep's basis is a criterion in the spec, a plan task found in the plan, or a fixed basis; otherwise still a keep, flagged", () => {
  const bases = [
    "AC-001",
    "AC-999",
    "plan task: Add password reset to `backend/src/features/auth/service.ts`",
    "plan task: Build a spaceship",
    ...KEEP_BASES,
    "Wire auto-save and paste in",
  ];
  const result = check(bases.map((_, i) => i + 1), {
    decisions: bases.map((basis, i) => ({ findingId: i + 1, disposition: "keep", basis })),
  });
  const valid = [...result.decisions.values()].map((d) => (d.disposition === "keep" ? d.basisValid : null));
  assert.deepEqual(valid, [true, false, true, false, true, true, true, true, false]);
  assert.deepEqual(result.problems, [
    "finding 2 keep basis invalid: AC-999",
    "finding 4 keep basis invalid: plan task: Build a spaceship",
    "finding 9 keep basis invalid: Wire auto-save and paste in",
  ]);
});

test("any other disposition is unusable", () => {
  const result = check([1], { decisions: [{ findingId: 1, disposition: "defer" }] });
  assert.deepEqual(result.decisions.get(1), { disposition: "unusable", reason: 'finding 1 disposition "defer"' });
});

test("a rejection needs every one of exactly the required calls; a failed or missing call rejects nothing", () => {
  const reject: ReconcilerDecision = { disposition: "reject", rationale: "r", excerpt: BASELINE };
  const keep: ReconcilerDecision = { disposition: "keep", basis: "crash", basisValid: true };
  const unusable: ReconcilerDecision = { disposition: "unusable", reason: "x" };
  const both = new Map<number, ReconcilerDecision>([[1, reject], [2, reject]]);
  assert.deepEqual(agreedRejections([both, new Map<number, ReconcilerDecision>([[1, reject], [2, keep]])], 2), [1]);
  assert.deepEqual(agreedRejections([both, new Map<number, ReconcilerDecision>([[1, unusable], [2, reject]])], 2), [2]);
  assert.deepEqual(agreedRejections([both, null], 2), []);
  assert.deepEqual(agreedRejections([both], 2), [], "one call is not two");
  assert.deepEqual(agreedRejections([both, both, both], 2), [], "more calls than the policy names");
  assert.deepEqual(agreedRejections([both, both, both], 3), [1, 2]);
});

// --- the 30 recorded calls ---------------------------------------------------

test("the validator flags exactly the findings each recorded call's check flagged", () => {
  let calls = 0;
  for (const [name, set] of Object.entries(SETS)) {
    for (const call of set.calls) {
      calls += 1;
      const expected = [...new Set(call.problems.map((p) => Number(/finding (\d+)/.exec(p)![1])))].sort((a, b) => a - b);
      assert.deepEqual(flagged(check(set.ids, { decisions: call.decisions }).decisions), expected, `${name} ${call.label}`);
    }
  }
  assert.equal(calls, 30);
  // Spelled out as the plan states them, so a fixture edit cannot empty both sides.
  assert.deepEqual(flagged(check(SETS.replay.ids, { decisions: SETS.replay.calls[0]!.decisions }).decisions), [195, 196, 197, 204]);
  const fiveA7 = SETS["5a"].calls.find((c) => c.label === "5a-7")!;
  assert.deepEqual(flagged(check(SETS["5a"].ids, { decisions: fiveA7.decisions }).decisions), [214]);
});

test("pairing the recorded calls rejects #200 every time, #905 twice, and no keep-labelled finding", () => {
  const pairs = (set: (typeof SETS)[keyof typeof SETS]): number[][] => {
    const results: number[][] = [];
    for (let i = 0; i < set.calls.length; i += 2) {
      const pair = [set.calls[i]!, set.calls[i + 1]!].map((c) => check(set.ids, { decisions: c.decisions }).decisions);
      results.push(agreedRejections(pair, 2));
    }
    return results;
  };
  const replay = pairs(SETS.replay);
  const fiveA = pairs(SETS["5a"]);
  const fiveB = pairs(SETS["5b"]);
  assert.deepEqual(replay, [[200], [200], [200], [200], [200]]);
  assert.deepEqual(fiveA, [[], [], [], [], []]);
  assert.deepEqual(fiveB, [[], [905], [], [905], []]);
  for (const [name, results] of [["replay", replay], ["5a", fiveA], ["5b", fiveB]] as const) {
    const keep = SETS[name].keep;
    assert.ok(keep.length > 0, `${name} has keep labels`);
    assert.deepEqual(results.flat().filter((id) => keep.includes(id)), [], `${name} rejected a keep-labelled finding`);
  }
});
