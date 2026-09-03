import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryCoverage } from "../src/delivery-coverage.ts";

function sets(coverage: ReturnType<typeof deliveryCoverage>) {
  return { delivered: coverage.delivered, missing: coverage.missing };
}

test("exact matches deliver; undeclared changed paths are extra, not delivery", () => {
  const coverage = deliveryCoverage(["src/a.ts", "test/a.test.ts"], ["src/a.ts", "src/extra.ts"]);
  assert.deepEqual(sets(coverage), {
    delivered: ["src/a.ts"],
    missing: ["test/a.test.ts"],
  });
  assert.deepEqual(coverage.changed, ["src/a.ts", "src/extra.ts"]);
  assert.deepEqual(coverage.declared, ["src/a.ts", "test/a.test.ts"]);
});

test("separator and leading-./ normalization applies to both sides", () => {
  // The operator signs what the spec declared; git emits forward slashes.
  // Backslashes and a leading `./` must not split one path into two.
  const coverage = deliveryCoverage(["./src/a.ts", "src\\b.ts"], ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(sets(coverage), { delivered: ["src/a.ts", "src/b.ts"], missing: [] });
});

test("duplicates in either side collapse to one set member", () => {
  const coverage = deliveryCoverage(["src/a.ts", "src/a.ts"], ["src/a.ts", "src/a.ts"]);
  assert.deepEqual(sets(coverage), { delivered: ["src/a.ts"], missing: [] });
  assert.deepEqual(coverage.declared, ["src/a.ts"]);
});

test("case mismatches refuse: delivery never guesses between two spellings", () => {
  // Git trees are case-sensitive; a case-different commit is a different
  // path, and on a case-insensitive filesystem it may even be a different
  // *file*. The declared path stays missing.
  const coverage = deliveryCoverage(["Src/A.ts"], ["src/A.ts"]);
  assert.deepEqual(sets(coverage), { delivered: [], missing: ["Src/A.ts"] });
});

test("a missing file is a missing deliverable, whatever else changed", () => {
  const coverage = deliveryCoverage(["src/a.ts", "src/b.ts"], ["src/a.ts"]);
  assert.deepEqual(sets(coverage), { delivered: ["src/a.ts"], missing: ["src/b.ts"] });
});

test("directory-prefix containment never satisfies delivery", () => {
  // Scope permission ("may this stage write here") may be directory-shaped;
  // delivery is not: a change under `src/` does not deliver a declared
  // `src/a.ts` unless the exact path changed.
  const coverage = deliveryCoverage(["src/a.ts"], ["src/other.ts", "src/nested/x.ts"]);
  assert.deepEqual(sets(coverage), { delivered: [], missing: ["src/a.ts"] });
  // And a declared directory can never match: git never emits a directory as
  // a changed path. (The spec gate refuses directory declarations in task 1;
  // this pins the coverage semantics independently.)
  const dir = deliveryCoverage(["scripts"], ["scripts/run.mjs"]);
  assert.deepEqual(sets(dir), { delivered: [], missing: ["scripts"] });
});

test("an empty changed set delivers nothing and names every artifact missing", () => {
  const coverage = deliveryCoverage(["src/a.ts"], []);
  assert.deepEqual(sets(coverage), { delivered: [], missing: ["src/a.ts"] });
  assert.deepEqual(coverage.changed, []);
});

test("results are sorted and deterministic whatever the input order", () => {
  const a = deliveryCoverage(["z.ts", "a.ts"], ["b.ts", "a.ts"]);
  const b = deliveryCoverage(["a.ts", "z.ts"], ["a.ts", "b.ts"]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.declared, ["a.ts", "z.ts"]);
});
