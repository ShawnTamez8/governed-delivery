import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageFitsScope, coverageMeetsCriteria, planReviewGate } from "../src/plan-gate.ts";
import type { CoverageEntry, PlanDoc } from "../src/plan-doc.ts";
import type { FindingRow } from "../src/store.ts";

function covers(artifact: string, criterion = `criterion for ${artifact}`): CoverageEntry {
  return { criterion, artifact, rationale: null, alternativeVerification: null };
}

function notApplicable(criterion: string): CoverageEntry {
  return {
    criterion,
    artifact: null,
    rationale: "observed, not asserted",
    alternativeVerification: "checked in the smoke run's recorded output",
  };
}

function planWith(coverage: CoverageEntry[]): PlanDoc {
  return { feature: "Thing", planFor: "a".repeat(64), tasks: ["do it"], coverage };
}

function finding(severity: string, disposition: string, id: number): FindingRow {
  return {
    id,
    stage_id: 1,
    agent_run_id: null,
    severity,
    intent_key: "k",
    subject: "s",
    location: "l",
    disposition,
  };
}

const SCOPE = ["src/thing.ts", "test/thing.test.ts"];

test("coverage entirely inside the signed scope passes", () => {
  const result = coverageFitsScope(
    planWith([covers("src/thing.ts"), covers("test/thing.test.ts")]),
    SCOPE
  );
  assert.deepEqual(result, { ok: true });
});

test("an artifact outside the signed scope is returned as unkeepable and named", () => {
  const result = coverageFitsScope(
    planWith([covers("src/thing.ts"), covers("src/elsewhere.ts", "it also does the other thing")]),
    SCOPE
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  // The criterion is what the operator can act on, not the path.
  assert.deepEqual(result.unkeepable, ["it also does the other thing"]);
});

test("a path differing from a signed entry only in case is unkeepable on every platform", () => {
  // The operator signs the paths exactly as declared, which is why
  // `computeScope` preserves spelling. Folding case here would silently widen
  // what was signed, so this must refuse on Windows and macOS too — where the
  // two spellings name one file — not just on a case-sensitive filesystem.
  const result = coverageFitsScope(
    planWith([covers("src/Thing.ts", "case-differing promise")]),
    SCOPE
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.unkeepable, ["case-differing promise"]);
});

test("a not_applicable entry is never unkeepable", () => {
  // It promises no artifact: it carries a rationale and an alternative
  // verification instead, which section 8 prefers to a fabricated test.
  const result = coverageFitsScope(
    planWith([covers("src/thing.ts"), notApplicable("it logs on startup")]),
    SCOPE
  );
  assert.deepEqual(result, { ok: true });
});

test("a mix returns only the offending criteria", () => {
  const result = coverageFitsScope(
    planWith([
      covers("src/thing.ts", "in scope"),
      covers("src/nope.ts", "out of scope one"),
      notApplicable("not applicable at all"),
      covers("docs/other.md", "out of scope two"),
    ]),
    SCOPE
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.unkeepable, ["out of scope one", "out of scope two"]);
});

test("an empty signed scope makes every artifact promise unkeepable", () => {
  const result = coverageFitsScope(planWith([covers("src/thing.ts", "anything")]), []);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.unkeepable, ["anything"]);
});

test("planReviewGate passes when no finding is open", () => {
  assert.deepEqual(planReviewGate([]), { pass: true });
  assert.deepEqual(planReviewGate([finding("critical", "resolved", 1)]), { pass: true });
});

test("planReviewGate ignores open findings below the material threshold", () => {
  assert.deepEqual(planReviewGate([finding("low", "open", 1), finding("medium", "open", 2)]), {
    pass: true,
  });
});

test("planReviewGate blocks on an open material finding and names its id", () => {
  const result = planReviewGate([
    finding("low", "open", 1),
    finding("high", "open", 2),
    finding("critical", "open", 3),
    finding("critical", "resolved", 4),
  ]);
  assert.equal(result.pass, false);
  if (result.pass) return;
  assert.deepEqual(result.openMaterialIds, [2, 3]);
});

test("planReviewGate blocks only on the open disposition, matching specReviewGate", () => {
  // `open` is the only blocking disposition: disputed and accepted are
  // dispositions a panel has already acted on. Asserted explicitly because
  // the two gates must agree — a plan gate that blocked on `disputed` while
  // the spec gate did not would make the same finding terminal at one stage
  // and not the other.
  assert.deepEqual(planReviewGate([finding("high", "disputed", 7)]), { pass: true });
  assert.deepEqual(planReviewGate([finding("high", "accepted", 8)]), { pass: true });
  const blocked = planReviewGate([finding("high", "open", 9)]);
  assert.equal(blocked.pass, false);
  if (blocked.pass) return;
  assert.deepEqual(blocked.openMaterialIds, [9]);
});

test("coverageMeetsCriteria passes when every criterion has a line", () => {
  const doc = planWith([covers("src/thing.ts", "it works"), notApplicable("it logs")]);
  assert.deepEqual(coverageMeetsCriteria(doc, ["it works", "it logs"]), { ok: true });
});

test("coverageMeetsCriteria names the criteria the plan never mentions", () => {
  const doc = planWith([covers("src/thing.ts", "it works")]);
  const result = coverageMeetsCriteria(doc, ["it works", "it logs", "it is fast"]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.uncovered, ["it logs", "it is fast"]);
});

test("coverageMeetsCriteria tolerates case and whitespace differences", () => {
  // A criterion is prose restated by a model and nobody signs it, so byte
  // equality would refuse correct plans over a double space. This is
  // deliberately unlike coverageFitsScope, where the spelling is signed.
  const doc = planWith([covers("src/thing.ts", "It  Works   Correctly")]);
  assert.deepEqual(coverageMeetsCriteria(doc, ["it works correctly"]), { ok: true });
});

test("coverageMeetsCriteria is unaffected by extra coverage lines", () => {
  // A plan may say more than the spec asked; the gate only refuses silence.
  const doc = planWith([covers("src/a.ts", "it works"), covers("src/b.ts", "a bonus concern")]);
  assert.deepEqual(coverageMeetsCriteria(doc, ["it works"]), { ok: true });
});
