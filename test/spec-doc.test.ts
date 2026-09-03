import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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

test("a spec saved with a BOM or CRLF line endings still validates", () => {
  // `normalizeText` exists so a checkout under `core.autocrlf=true` cannot
  // change a spec hash. The same tolerance has to reach parsing: without it a
  // BOM sits in front of `feature:`, the regex misses, and a BOM-saving editor
  // blocks approval reporting a missing frontmatter field that is present.
  const spec = validSpec();
  const expected = validateSpecDoc(spec);
  assert.equal(expected.ok, true);
  assert.deepEqual(validateSpecDoc(`﻿${spec}`), expected);
  assert.deepEqual(validateSpecDoc(spec.replace(/\n/g, "\r\n")), expected);
  assert.deepEqual(validateSpecDoc(`﻿${spec.replace(/\n/g, "\r\n")}`), expected);
});

test("a declared artifact spelled with a trailing slash refuses as a directory scope", () => {
  // Delivery (architecture step 8) proves each declared artifact by exact
  // equality with a committed file path; a trailing slash marks a directory
  // scope that can never equal one, so it refuses here rather than letting
  // the spec pass the gates and block at the last stage.
  const directory = validSpec().replace("src/parser.ts", "scripts/");
  assert.deepEqual(validateSpecDoc(directory), {
    ok: false,
    reason: "declared artifact must be an exact file path, not a directory: scripts/",
  });
  const fileWithSlash = validSpec().replace("src/parser.ts", "src/parser.ts/");
  assert.deepEqual(validateSpecDoc(fileWithSlash), {
    ok: false,
    reason: "declared artifact must be an exact file path, not a directory: src/parser.ts/",
  });
});

function gitCommitBase(root: string): string {
  const git = (args: string[]): { status: number; stdout: string; stderr: string } => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  assert.equal(git(["init", "-q"]).status, 0, "git init failed");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "exists.ts"), "existing content");
  writeFileSync(join(root, "base.txt"), "base");
  assert.equal(git(["add", "-A"]).status, 0, "git add failed");
  const commit = git(["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "base"]);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
  return git(["rev-parse", "HEAD"]).stdout.trim();
}

test("writeSpecDoc refuses a declared artifact that names a directory in the starting commit", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-specdoc-tree-"));
  try {
    const head = gitCommitBase(root);
    // An existing directory never satisfies delivery's exact-equality check.
    const declaresDir = validSpec().replace("src/parser.ts", "src");
    assert.throws(
      () => writeSpecDoc(root, "my-feature", declaresDir, head),
      /declared artifact names a directory in the starting commit tree: src/
    );
    // An existing file stays a legal declared artifact (modify case).
    const existingFile = validSpec().replace("src/parser.ts", "src/exists.ts");
    writeSpecDoc(root, "my-feature", existingFile, head);
    // A path nothing in the starting tree names is a future file the
    // implementation is expected to create, and passes.
    const futureFile = validSpec().replace("src/parser.ts", "src/future.ts");
    writeSpecDoc(root, "my-feature", futureFile, head);
    // Without a starting commit the tree rule does not run (the parse rules
    // still do — the trailing-slash case above is independent of git).
    writeSpecDoc(root, "my-feature", declaresDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
