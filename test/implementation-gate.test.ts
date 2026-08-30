import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { gatePatchPaths, movedPaths, pathFitsScope } from "../src/implementation-gate.ts";

test("pathFitsScope accepts an exact signed entry", () => {
  assert.equal(pathFitsScope("src/index.ts", ["src/index.ts"]), true);
});

test("pathFitsScope accepts a path under a signed directory, trailing slash or not", () => {
  assert.equal(pathFitsScope("src/index.ts", ["src"]), true);
  assert.equal(pathFitsScope("src/index.ts", ["src/"]), true);
});

test("pathFitsScope refuses a path that only shares a string prefix", () => {
  // Comparison is on whole path segments: "src/index.ts" must not cover
  // "src/index.tsx".
  assert.equal(pathFitsScope("src/index.tsx", ["src/index.ts"]), false);
});

test("pathFitsScope is exact and case-preserving on every platform", () => {
  // The operator signs the paths as the spec declared them, so a path
  // differing from a signed entry only in case is out of scope everywhere —
  // including on filesystems where the two names resolve to the same file.
  assert.equal(pathFitsScope("Src/A.ts", ["src/a.ts"]), false);
});

test("gatePatchPaths passes paths inside the signed scope", () => {
  assert.deepEqual(
    gatePatchPaths(["src/a.ts", "src/b.ts", "test/a.test.ts"], ["src", "test/a.test.ts"], "demo"),
    { ok: true }
  );
});

test("gatePatchPaths refuses an out-of-scope path and names it", () => {
  const result = gatePatchPaths(["src/a.ts", "src/never-approved.ts"], ["src/a.ts"], "demo");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.refused, ["src/never-approved.ts"]);
  assert.match(result.reason, /outside the signed scope: src\/never-approved\.ts/);
});

test("gatePatchPaths refuses a path differing from a signed entry only in case", () => {
  // A case-differing patch path is refused on every platform, not just on
  // case-sensitive filesystems — the scope check fires before protection.
  const result = gatePatchPaths(["Src/a.ts"], ["src/a.ts"], "demo");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.refused, ["Src/a.ts"]);
  assert.match(result.reason, /outside the signed scope: Src\/a\.ts/);
});

test("gatePatchPaths refuses a protected path even when the scope names it", () => {
  // Protection outranks scope: the operator signing "src/agents/x.ts" does
  // not make it writable. The gate refuses it anyway.
  const result = gatePatchPaths(["src/agents/x.ts"], ["src/agents/x.ts"], "demo");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.refused, ["src/agents/x.ts"]);
  assert.match(result.reason, /touches a protected path: src\/agents\/x\.ts/);
});

test("gatePatchPaths refuses a path that escapes the repository and names it", () => {
  for (const escape of ["../evil.ts", "a/../../b"]) {
    const result = gatePatchPaths([escape], ["src"], "demo");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.refused, [escape]);
    assert.match(result.reason, /path escapes the repository/);
  }
});

test("gatePatchPaths refuses an absolute path and names it", () => {
  const abs = resolve("evil.ts");
  const result = gatePatchPaths([abs], ["src"], "demo");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.refused, [abs]);
  assert.match(result.reason, /path escapes the repository/);
});

test("movedPaths returns the normalized intersection", () => {
  // A git diff name and a patch path that name the same file differently
  // ("./src/a.ts" vs "src/a.ts") must still intersect after normalization.
  assert.deepEqual(
    movedPaths(["./src/a.ts", "docs/readme.md"], ["src/a.ts", "test/a.test.ts"]),
    ["src/a.ts"]
  );
});

test("movedPaths returns an empty array when nothing intersects", () => {
  assert.deepEqual(movedPaths(["docs/readme.md"], ["src/a.ts"]), []);
});
