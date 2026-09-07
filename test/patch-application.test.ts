import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyProposedPatches, checkWorktreeClean } from "../src/patch-application.ts";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout ?? "").trim();
}

function withRepository(fn: (root: string, head: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "bw-patch-helper-"));
  try {
    git(root, ["init", "-q"]);
    writeFileSync(join(root, ".gitignore"), ".governance/\n");
    writeFileSync(join(root, "a.txt"), "before\n");
    git(root, ["add", "-A"]);
    git(root, [
      "-c",
      "user.name=BuildWorks",
      "-c",
      "user.email=buildworks@buildworks.invalid",
      "commit",
      "-q",
      "-m",
      "base",
    ]);
    fn(root, git(root, ["rev-parse", "HEAD"]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("applyProposedPatches commits the exact proposed set and leaves a clean head", () => {
  withRepository((root, head) => {
    const audits: string[] = [];
    const result = applyProposedPatches({
      worktreePath: root,
      runId: 7,
      slug: "demo",
      scope: ["a.txt"],
      proposalBase: head,
      patches: [{ baseCommit: head, files: [{ path: "a.txt", action: "modify", content: "after\n" }] }],
      commitMessage: "apply test patch",
      audit: (action, summary) => audits.push(`${action}: ${summary}`),
    });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    if (!result.ok) return;
    assert.notEqual(result.resultingCommit, head);
    assert.deepEqual(result.changedPaths, ["a.txt"]);
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "after\n");
    assert.deepEqual(checkWorktreeClean(root), { ok: true });
    assert.match(audits[0]!, /patch\.apply: applied patch to a\.txt/);
  });
});

test("applyProposedPatches refuses wrong-base, outside-scope, and protected patches", () => {
  for (const [name, scope, path, base, expected] of [
    ["wrong base", ["a.txt"], "a.txt", "0".repeat(40), /does not match the branch head/],
    ["outside scope", ["a.txt"], "b.txt", null, /outside the signed scope/],
    ["protected", [".governance/x.txt"], ".governance/x.txt", null, /protected path/],
  ] as const) {
    withRepository((root, head) => {
      const result = applyProposedPatches({
        worktreePath: root,
        runId: 7,
        slug: "demo",
        scope: [...scope],
        proposalBase: head,
        patches: [
          {
            baseCommit: base ?? head,
            files: [{ path, action: path === "a.txt" ? "modify" : "add", content: "after\n" }],
          },
        ],
        commitMessage: "must not commit",
        audit: () => undefined,
      });
      assert.equal(result.ok, false, name);
      if (result.ok) return;
      assert.match(result.reason, expected);
      assert.equal(git(root, ["rev-parse", "HEAD"]), head);
    });
  }
});

test("applyProposedPatches refuses an unrelated staged path", () => {
  withRepository((root, head) => {
    writeFileSync(join(root, "other.txt"), "staged residue\n");
    git(root, ["add", "other.txt"]);
    const result = applyProposedPatches({
      worktreePath: root,
      runId: 7,
      slug: "demo",
      scope: ["a.txt"],
      proposalBase: head,
      patches: [{ baseCommit: head, files: [{ path: "a.txt", action: "modify", content: "after\n" }] }],
      commitMessage: "must not commit",
      audit: () => undefined,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /staged set differs from the proposed patch/);
    assert.equal(git(root, ["rev-parse", "HEAD"]), head);
  });
});
