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
    // The section carries no criterion line at all, which is the obsolete
    // prose-only shape the fresh-run repair is written for.
    assert.match(proseOnly.reason, /must be one criterion of the form '- AC-NNN: <criterion text>'/);
    assert.match(proseOnly.reason, /this line is not a criterion: the parser accepts the documented shapes/);
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

test("a note among valid criteria refuses by name without claiming the obsolete shape", () => {
  // The three lines are the note a live spec author wrote on 2026-09-05,
  // quoted from the committed response at
  // test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json.
  // Its specification carried twenty-three valid criteria; the operator must
  // not be told to start a fresh run to mint IDs the document already has.
  const note = [
    "Note: AC-012 is intentionally unassigned. No requirement or criterion was",
    "dropped; the ID was reserved in an earlier draft and numbering resumes at",
    "AC-013 so that previously assigned criterion IDs are preserved unchanged.",
  ];
  const withNote = validSpec().replace(
    "- AC-001: the parser accepts the documented shapes",
    `${note.join("\n")}\n\n- AC-001: the parser accepts the documented shapes\n- AC-013: the parser rejects the rest`
  );
  const result = validateSpecDoc(withNote);
  assert.deepEqual(result, {
    ok: false,
    reason: `every line under ## Acceptance criteria must be one criterion of the form '- AC-NNN: <criterion text>'; a note or explanation belongs in another section, and a criterion is never wrapped across lines; this line is not a criterion: ${note[0]}`,
  });

  // The note's third line begins with an AC ID and carries no colon. Only its
  // position kept it from being the line that refused, and before the
  // membership pass it would have refused as the obsolete prose-only shape
  // against a document whose criteria are all present.
  const trailingLineOnly = validSpec().replace(
    "- AC-001: the parser accepts the documented shapes",
    `${note[2]}\n\n- AC-001: the parser accepts the documented shapes`
  );
  const trailing = validateSpecDoc(trailingLineOnly);
  assert.equal(trailing.ok, false);
  if (trailing.ok) return;
  assert.match(trailing.reason, /this line is not a criterion: AC-013 so that previously assigned/);
  assert.equal(trailing.obsoleteCriterionShape, undefined);
});

test("a criterion bulleted with anything but a hyphen is not called an obsolete prose spec", () => {
  // Only the ASCII hyphen is stripped as a list marker, so a section bulleted
  // any other way has no well-formed criterion line — but it plainly carries
  // criterion IDs, and the fresh-run repair the flag triggers would tell the
  // operator to discard a run and re-mint IDs the document already has.
  for (const marker of ["*", "+", "1.", "–"]) {
    const spec = validSpec().replace("- AC-001:", `${marker} AC-001:`);
    const result = validateSpecDoc(spec);
    assert.equal(result.ok, false, marker);
    if (result.ok) continue;
    assert.match(result.reason, /must be one criterion of the form/, marker);
    assert.equal(result.obsoleteCriterionShape, undefined, marker);
  }
});

test("a wrong-case criterion ID stays an ID refusal, not a membership refusal", () => {
  // `ac-001: text` is a malformed ID, not prose. The membership predicate is
  // case-insensitive so this reaches the ID check and is answered by the rule
  // it actually broke.
  const result = validateSpecDoc(validSpec().replace("AC-001:", "ac-001:"));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /invalid acceptance criterion ID ac-001/);
  assert.equal(result.obsoleteCriterionShape, undefined);
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

test("a line under the artifacts heading that is not a path refuses by naming the section rule", () => {
  // The line is the one a live spec author wrote on 2026-09-05, quoted from
  // the committed response at
  // test/fixtures/recorded/spec-reconciliation-web-calculator-numbering-note.json
  // — it was written under ## Acceptance criteria, and the same prose under
  // ## Declared artifacts is what this section admitted until now: it became
  // a declared artifact, was signed into scope, and could only fail at
  // delivery.
  const prose = "Note: AC-012 is intentionally unassigned. No requirement or criterion was";
  const withProse = validSpec().replace("- src/parser.ts", prose);
  assert.deepEqual(validateSpecDoc(withProse), {
    ok: false,
    reason: `every line under ## Declared artifacts must be one repo-relative file path with no whitespace; this line is not a path: ${prose}`,
  });
  // Membership is decided before the path rules, so prose wins over a
  // malformed path on a later line rather than the other way round.
  const proseAndBadPath = validSpec()
    .replace("- src/parser.ts", prose)
    .replace("- test/parser.test.ts", "- ../secrets.ts");
  assert.equal(validateSpecDoc(proseAndBadPath).ok, false);
  assert.match(
    (validateSpecDoc(proseAndBadPath) as { reason: string }).reason,
    /must be one repo-relative file path with no whitespace/
  );
});

test("a line breaking both a path rule and the membership rule is answered by the path rule", () => {
  // The membership check runs last for each line, so a line that really is a
  // path keeps the diagnostic that says something true about it. The tasks.md
  // case is the one that matters: architecture section 14's prohibition is the
  // operator's only signal there, and a membership message would suppress it.
  for (const [path, reason] of [
    [
      "docs/my feature/tasks.md",
      "declared artifact is prohibited because tasks belong in run-state database rows, not tasks.md: docs/my feature/tasks.md",
    ],
    [
      "C:\\Program Files\\a.ts",
      "declared artifact must be a repo-relative path: C:\\Program Files\\a.ts",
    ],
    [
      "src/my dir/",
      "declared artifact must be an exact file path, not a directory: src/my dir/",
    ],
  ] as const) {
    assert.deepEqual(validateSpecDoc(validSpec().replace("- src/parser.ts", `- ${path}`)), {
      ok: false,
      reason,
    });
  }
});

test("the artifacts section tolerates a missing list marker and surrounding padding", () => {
  // Two recorded provider responses write this section unbulleted, so the
  // marker is optional here and the membership rule above must not assume it.
  const expected = validateSpecDoc(validSpec());
  assert.equal(expected.ok, true);
  for (const form of ["src/parser.ts", "  src/parser.ts  ", "-   src/parser.ts"]) {
    const spec = validSpec().replace("- src/parser.ts", form);
    const result = validateSpecDoc(spec);
    assert.equal(result.ok, true, form);
    if (!result.ok) continue;
    assert.deepEqual(result.value.declaredArtifacts, ["src/parser.ts", "test/parser.test.ts"], form);
  }
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
