import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeAddArgs } from "../src/implementation-stage.ts";

// docs/features/sandboxed-implementer/plan.md, Task 7: the run worktree is
// checked out LF whatever the repository's `core.autocrlf` says, because the
// work container is Linux and a CRLF checkout reads as a change to every file
// the agent edits.

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

test("the run worktree checks a committed LF file out LF under core.autocrlf=true, and its status is clean", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-worktree-lf-"));
  try {
    git(root, "init", "-q");
    git(root, "config", "core.autocrlf", "true");
    writeFileSync(join(root, "a.txt"), "one\ntwo\n");
    git(root, "add", "a.txt");
    git(root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "base");
    const head = git(root, "rev-parse", "HEAD").trim();
    // The blob is LF, so a CRLF read below is the checkout's doing.
    assert.equal(git(root, "cat-file", "blob", `${head}:a.txt`), "one\ntwo\n");
    const worktree = join(root, "wt");
    git(root, ...worktreeAddArgs(worktree, "gov/demo/1", head));
    assert.equal(readFileSync(join(worktree, "a.txt"), "utf8"), "one\ntwo\n");
    assert.equal(git(worktree, "status", "--porcelain=v1", "--ignored=matching", "--untracked-files=all"), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the worktree argv carries the LF pair before the subcommand", () => {
  // Asserted on every host; only a Windows host's checkout differs without it.
  assert.deepEqual(worktreeAddArgs("/w", "gov/demo/1", "c0ffee"), [
    "-c", "core.autocrlf=false", "-c", "core.eol=lf", "worktree", "add", "/w", "-b", "gov/demo/1", "c0ffee",
  ]);
});
