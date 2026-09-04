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

- AC-001: the parser accepts the documented shapes
`;
}

test("a valid spec parses with artifacts and criteria extracted", () => {
  const result = validateSpecDoc(validSpec());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.feature, "my-feature");
    assert.equal(result.value.changeKind, "feature");
    assert.deepEqual(result.value.declaredArtifacts, ["src/parser.ts", "test/parser.test.ts"]);
    assert.deepEqual(result.value.acceptanceCriteria, [
      { id: "AC-001", text: "the parser accepts the documented shapes" },
    ]);
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
  const noCriteria = validSpec().replace("## Acceptance criteria\n\n- AC-001: the parser accepts the documented shapes\n", "## Acceptance criteria\n");
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

test("criterion IDs use one canonical positive-integer encoding", () => {
  for (const id of ["AC-001", "AC-010", "AC-999", "AC-1000"]) {
    const result = validateSpecDoc(validSpec().replace("AC-001", id));
    assert.equal(result.ok, true, id);
  }
  for (const id of ["AC-000", "ac-001", "AC-01", "AC-0001"]) {
    const result = validateSpecDoc(validSpec().replace("AC-001", id));
    assert.equal(result.ok, false, id);
    if (result.ok) continue;
    assert.match(result.reason, new RegExp(id));
    assert.equal(result.obsoleteCriterionShape, undefined);
  }
});

test("acceptance criteria require an ID, unique identity, and non-empty text", () => {
  const proseOnly = validateSpecDoc(
    validSpec().replace("AC-001: the parser accepts the documented shapes", "the parser accepts the documented shapes")
  );
  assert.equal(proseOnly.ok, false);
  if (!proseOnly.ok) {
    assert.match(proseOnly.reason, /acceptance criterion must be '<criterion-id>: <criterion text>'/);
    assert.equal(proseOnly.obsoleteCriterionShape, true);
  }

  const duplicate = validateSpecDoc(
    validSpec().replace(
      "- AC-001: the parser accepts the documented shapes",
      "- AC-001: the parser accepts the documented shapes\n- AC-001: another criterion"
    )
  );
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.reason, /duplicate acceptance criterion ID AC-001/);

  const empty = validateSpecDoc(
    validSpec().replace("AC-001: the parser accepts the documented shapes", "AC-001:")
  );
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.reason, /acceptance criterion AC-001 has empty text/);
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
    const revised = validSpec().replace("documented shapes", "documented shapes after revision");
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

test("a declared tasks.md artifact is refused wherever it is proposed", () => {
  for (const path of ["tasks.md", "docs/features/my-feature/tasks.md", "DOCS/TASKS.MD"]) {
    const result = validateSpecDoc(validSpec().replace("src/parser.ts", path));
    assert.deepEqual(result, {
      ok: false,
      reason: `declared artifact is prohibited because tasks belong in run-state database rows, not tasks.md: ${path}`,
    });
  }
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

test("writeSpecDoc refuses a declared artifact that names the run's own document", () => {
  // design.md is the run's protected input and spec.md/plan.md are
  // projections the implementation stage commits before the recorded patch
  // base — all three sit outside the range delivery_check certifies, so a
  // declaration naming one would pass every tree rule and still block
  // terminally at the last stage. The rule is independent of git: it fires
  // even with no starting commit in play.
  const root = mkdtempSync(join(tmpdir(), "bw-specdoc-doc-"));
  try {
    for (const name of ["design.md", "spec.md", "plan.md"]) {
      const declares = validSpec().replace("src/parser.ts", `docs/features/my-feature/${name}`);
      assert.throws(
        () => writeSpecDoc(root, "my-feature", declares),
        (err: unknown) =>
          (err as Error).message ===
          `declared artifact names a document the run itself writes (design, spec, or plan under docs/features/my-feature/): docs/features/my-feature/${name}`,
        `${name} must refuse by name`
      );
    }
    // A sibling document under the same directory is an ordinary future file.
    const sibling = validSpec().replace("src/parser.ts", "docs/features/my-feature/notes.md");
    writeSpecDoc(root, "my-feature", sibling);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
