import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROTECTED_PATH_PREFIXES,
  artifactDirectoryRefusals,
  computeScope,
  normalizePath,
  touchesProtected,
} from "../src/scope.ts";
import { computeRisk } from "../src/select.ts";

test("normalizePath folds backslashes and a leading ./", () => {
  assert.equal(normalizePath("src\\a\\b.ts"), "src/a/b.ts");
  assert.equal(normalizePath("./src/a.ts"), "src/a.ts");
});

test("computeScope normalizes, deduplicates, and sorts", () => {
  assert.deepEqual(computeScope(["./src/b.ts", "src\\a.ts", "src/b.ts", "docs/x.md"]), [
    "docs/x.md",
    "src/a.ts",
    "src/b.ts",
  ]);
});

test("computeScope is independent of the order the spec listed artifacts in", () => {
  const a = computeScope(["src/z.ts", "src/a.ts", "docs/m.md"]);
  const b = computeScope(["docs/m.md", "src/z.ts", "src/a.ts"]);
  assert.deepEqual(a, b);
});

test("every protected prefix is detected", () => {
  for (const prefix of PROTECTED_PATH_PREFIXES) {
    assert.ok(touchesProtected([`${prefix}anything`], "s"), `${prefix} must be protected`);
  }
});

test("the run's own design document is protected", () => {
  assert.ok(touchesProtected(["docs/features/my-feature/design.md"], "my-feature"));
  // Another run's design document is not this run's input.
  assert.ok(!touchesProtected(["docs/features/other/design.md"], "my-feature"));
});

test("an ordinary source path is not protected", () => {
  assert.ok(!touchesProtected(["src/foo.ts", "docs/features/s/spec.md"], "s"));
});

test("a windows-style protected path is still detected", () => {
  assert.ok(touchesProtected(["src\\agents\\rogue.ts"], "s"));
});

test("a protected prefix is detected whatever case the spec declared it in", () => {
  // Windows and macOS resolve `Src/Agents/x.ts` and `src/agents/x.ts` to the
  // same file, so an exact-case prefix test is a guard the author steps around
  // by changing capitalization.
  for (const p of ["Src/Agents/rogue.ts", "SRC/AGENTS/rogue.ts", "src/Agents/rogue.ts"]) {
    assert.ok(touchesProtected([p], "s"), `${p} must be protected`);
  }
  assert.ok(touchesProtected(["DOCS/features/my-feature/DESIGN.md"], "my-feature"));
});

test("case does not change the risk a protected path produces", () => {
  // The consequence the bypass buys: +2 on the risk score, which is the step
  // from a one-reviewer panel to a two-reviewer one.
  assert.equal(computeRisk("feature", 1, touchesProtected(["src/agents/x.ts"], "s")), "standard");
  assert.equal(computeRisk("feature", 1, touchesProtected(["Src/Agents/x.ts"], "s")), "standard");
});

test("computeScope preserves the case the spec declared", () => {
  // Deliberately not folded: the operator signs the paths as written, and the
  // signed scope has to read back as the spec's own text.
  assert.deepEqual(computeScope(["Src/Agents/x.ts"]), ["Src/Agents/x.ts"]);
});

test("risk counts distinct artifacts, not repeated ones", () => {
  // The panel is sized from this count and the operator signs the deduplicated
  // scope. If risk used the raw list, a spec repeating a path could cross the
  // >10 threshold and bind a risk the deduplicated scope never justified.
  const distinct = Array.from({ length: 9 }, (_, i) => `src/a${i}.ts`);
  const withDuplicates = [...distinct, "src/a0.ts", "src/a1.ts"]; // 11 raw, 9 distinct
  assert.equal(computeScope(withDuplicates).length, 9);
  assert.equal(
    computeRisk("feature", computeScope(withDuplicates).length, false),
    computeRisk("feature", distinct.length, false)
  );
  // And the raw count would have landed in a different band.
  assert.notEqual(
    computeRisk("feature", withDuplicates.length, false),
    computeRisk("feature", computeScope(withDuplicates).length, false)
  );
});

function gitRepoWith(srcFile: string): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "bw-scope-tree-"));
  const git = (args: string[]): { status: number; stdout: string; stderr: string } => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  try {
    assert.equal(git(["init", "-q"]).status, 0, "git init failed");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", srcFile), "x");
    writeFileSync(join(root, "base.txt"), "base");
    assert.equal(git(["add", "-A"]).status, 0, "git add failed");
    const commit = git(["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "base"]);
    assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
    return { root, head: git(["rev-parse", "HEAD"]).stdout.trim() };
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

test("artifactDirectoryRefusals names declared paths that are directories in the commit tree", () => {
  const { root, head } = gitRepoWith("exists.ts");
  try {
    // An existing directory refuses; an existing file and a nonexistent
    // future file pass.
    assert.deepEqual(artifactDirectoryRefusals(root, head, ["src", "src/exists.ts", "src/future.ts"]), {
      ok: true,
      directories: ["src"],
    });
    // A directory deeper in the tree refuses the same way.
    assert.deepEqual(artifactDirectoryRefusals(root, head, ["src/future.ts"]), {
      ok: true,
      directories: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifactDirectoryRefusals refuses when the tree cannot be read (fail closed)", () => {
  const { root } = gitRepoWith("exists.ts");
  try {
    const result = artifactDirectoryRefusals(root, "c".repeat(40), ["src/future.ts"]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /cannot inspect the starting commit tree/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifactDirectoryRefusals treats declared globs as literal paths", () => {
  const { root, head } = gitRepoWith("exists.ts");
  try {
    // `--literal-pathspecs`: a declared artifact is a literal path, never a
    // pattern, so `*` must not expand to `src/exists.ts`.
    assert.deepEqual(artifactDirectoryRefusals(root, head, ["src/*.ts"]), { ok: true, directories: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
