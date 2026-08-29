import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSpecDoc, writeSpecDoc } from "../src/spec-doc.ts";

function validSpec(): string {
  return `feature: my-feature
change_kind: feature

# My Feature

## Declared artifacts

- src/parser.ts
- test/parser.test.ts

## Acceptance criteria

- the parser accepts the documented shapes
`;
}

test("a valid spec parses with artifacts and criteria extracted", () => {
  const result = validateSpecDoc(validSpec());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.feature, "my-feature");
    assert.equal(result.value.changeKind, "feature");
    assert.deepEqual(result.value.declaredArtifacts, ["src/parser.ts", "test/parser.test.ts"]);
    assert.deepEqual(result.value.acceptanceCriteria, ["the parser accepts the documented shapes"]);
  }
});

test("each refusal names its cause", () => {
  const missingFeature = "change_kind: feature\n\n## Declared artifacts\n- a\n\n## Acceptance criteria\n- c\n";
  assert.deepEqual(validateSpecDoc(missingFeature), {
    ok: false,
    reason: "spec is missing the frontmatter field feature",
  });
  const badKind = validSpec().replace("change_kind: feature", "change_kind: experiment");
  assert.deepEqual(validateSpecDoc(badKind), {
    ok: false,
    reason: "invalid spec change_kind experiment: allowed values are feature, defect_fix",
  });
  const noArtifacts = validSpec().replace("## Declared artifacts\n", "");
  assert.deepEqual(validateSpecDoc(noArtifacts), {
    ok: false,
    reason: "spec is missing the ## Declared artifacts section",
  });
  const noCriteria = validSpec().replace("## Acceptance criteria\n\n- the parser accepts the documented shapes\n", "## Acceptance criteria\n");
  assert.deepEqual(validateSpecDoc(noCriteria), {
    ok: false,
    reason: "acceptance criteria must not be empty",
  });
  const traversal = validSpec().replace("src/parser.ts", "../secrets.ts");
  assert.deepEqual(validateSpecDoc(traversal), {
    ok: false,
    reason: "declared artifact must be a repo-relative path: ../secrets.ts",
  });
});

test("writeSpecDoc writes the file and refuses invalid content without touching the filesystem", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-specdoc-"));
  try {
    const { path, doc } = writeSpecDoc(root, "my-feature", validSpec());
    assert.equal(readFileSync(path, "utf8"), validSpec());
    assert.equal(doc.feature, "my-feature");
    const before = join(root, "docs", "features", "my-feature", "spec.md");
    assert.throws(() => writeSpecDoc(root, "my-feature", "not a spec"), /missing the frontmatter/);
    assert.equal(readFileSync(before, "utf8"), validSpec());
    // Overwrite on revision.
    const revised = validSpec() + "revision\n";
    writeSpecDoc(root, "my-feature", revised);
    assert.equal(readFileSync(before, "utf8"), revised);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
