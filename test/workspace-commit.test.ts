import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkWorktreeClean, commitWorkspace, type WorkspaceCommitInput } from "../src/workspace-commit.ts";
import { standInSandbox } from "./fixtures/docker/stand-in.ts";

/**
 * The workspace boundary (docs/features/sandboxed-implementer/plan.md, Task 5),
 * over a temp repository and the Docker stand-in. Spike criterion 5 is here:
 * protected and out-of-scope writes are refused at the boundary, naming each.
 */

const SLUG = "feature-x";
const SCOPE = ["src", "docs/notes.md"];
const DERIVED = ["base.lock", "new.lock"];

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

interface Fixture {
  worktree: string;
  base: string;
  audits: { action: string; summary: string }[];
  input: (overrides?: Partial<WorkspaceCommitInput>) => WorkspaceCommitInput;
  write: (path: string, content: string) => void;
  cleanup: () => void;
}

function fixture(): Fixture {
  const parent = mkdtempSync(join(tmpdir(), "bw-workspace-"));
  const root = join(parent, "target");
  mkdirSync(join(root, "src"), { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  const files: Record<string, string> = {
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
    "governed.yaml": "verify: []\n",
    "base.lock": "lock v1\n",
    ".gitignore": "dist/\n.governance/\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  const worktree = join(root, ".governance", "worktrees", "1");
  git(root, "-c", "core.autocrlf=false", "-c", "core.eol=lf", "worktree", "add", "-q", worktree, "-b", "gov/feature-x/1");
  const base = git(worktree, "rev-parse", "HEAD");
  const audits: { action: string; summary: string }[] = [];
  return {
    worktree,
    base,
    audits,
    input: (overrides = {}) => ({
      worktreePath: worktree,
      base,
      scope: SCOPE,
      slug: SLUG,
      derivedPaths: DERIVED,
      sandbox: standInSandbox(),
      message: "bw run 1: phase 1/1",
      onAudit: (action, summary) => audits.push({ action, summary }),
      ...overrides,
    }),
    write: (path, content) => {
      mkdirSync(dirname(join(worktree, path)), { recursive: true });
      writeFileSync(join(worktree, path), content);
    },
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

function withFixture(body: (f: Fixture) => void): void {
  const f = fixture();
  try {
    body(f);
  } finally {
    f.cleanup();
  }
}

/** The worktree is back at its base with nothing untracked or ignored left. */
function assertReset(f: Fixture): void {
  assert.equal(git(f.worktree, "rev-parse", "HEAD"), f.base);
  assert.deepEqual(checkWorktreeClean(f.worktree), { ok: true });
}

test("an in-scope change commits as the system, and ignored output is removed first", () => {
  withFixture((f) => {
    f.write("src/a.ts", "export const a = 10;\n");
    f.write("src/c.ts", "export const c = 3;\n");
    f.write("dist/out.js", "built\n");
    const result = commitWorkspace(f.input());
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.paths, ["src/a.ts", "src/c.ts"]);
    assert.deepEqual(result.ignoredRemoved, ["dist"]);
    assert.equal(git(f.worktree, "rev-parse", "HEAD"), result.head);
    assert.equal(git(f.worktree, "log", "-1", "--format=%an %s"), "BuildWorks bw run 1: phase 1/1");
    assert.equal(git(f.worktree, "diff", "--name-only", f.base, result.head), "src/a.ts\nsrc/c.ts");
    assert.deepEqual(checkWorktreeClean(f.worktree), { ok: true });
    assert.deepEqual(f.audits, []);
  });
});

test("out-of-scope, protected and task-document paths are refused naming each (spike criterion 5)", () => {
  withFixture((f) => {
    f.write("governed.yaml", "verify: [x]\n");
    f.write(`docs/features/${SLUG}/design.md`, "changed\n");
    f.write("out-of-scope.txt", "x\n");
    f.write("src/tasks.md", "- task\n");
    f.write("src/a.ts", "export const a = 10;\n");
    const result = commitWorkspace(f.input());
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, "refused");
    for (const path of ["governed.yaml", `docs/features/${SLUG}/design.md`, "out-of-scope.txt"]) {
      assert.ok(!result.ok && result.reason.includes(`outside the signed scope: ${path}`), path);
    }
    assert.ok(!result.ok && result.reason.includes("task artifacts are prohibited; tasks belong in run-state database rows: src/tasks.md"));
    assert.equal(f.audits.length, 1);
    assert.equal(f.audits[0]!.action, "workspace.refused");
    assertReset(f);
    assert.equal(readFileSync(join(f.worktree, "governed.yaml"), "utf8"), "verify: []\n");
  });
});

test("positive control: a protected path inside the scope is still refused as protected", () => {
  withFixture((f) => {
    f.write("governed.yaml", "verify: [x]\n");
    const result = commitWorkspace(f.input({ scope: [...SCOPE, "governed.yaml"] }));
    assert.ok(!result.ok && result.reason.includes("touches a protected path: governed.yaml"), !result.ok ? result.reason : "");
  });
});

test("a deletion is refused", () => {
  withFixture((f) => {
    rmSync(join(f.worktree, "src", "b.ts"));
    f.write("src/a.ts", "export const a = 10;\n");
    const result = commitWorkspace(f.input());
    assert.ok(!result.ok && result.kind === "refused");
    assert.ok(!result.ok && result.reason.includes("deletes src/b.ts"), !result.ok ? result.reason : "");
    assertReset(f);
    assert.equal(readFileSync(join(f.worktree, "src", "b.ts"), "utf8"), "export const b = 2;\n");
  });
});

test("a rename with identical content inside the scope is refused, naming its source as a deletion", () => {
  withFixture((f) => {
    renameSync(join(f.worktree, "src", "b.ts"), join(f.worktree, "src", "b2.ts"));
    const result = commitWorkspace(f.input());
    assert.ok(!result.ok && result.kind === "refused", !result.ok ? result.reason : "committed");
    assert.ok(!result.ok && result.reason.includes("deletes src/b.ts: the system refuses deletions, and a rename is a deletion"), !result.ok ? result.reason : "");
    assertReset(f);
    assert.equal(existsSync(join(f.worktree, "src", "b2.ts")), false);
  });
});

test("a symbolic link is refused", () => {
  withFixture((f) => {
    let made = false;
    try {
      symlinkSync("a.ts", join(f.worktree, "src", "link.ts"));
      made = true;
    } catch (err) {
      // Windows without the symlink privilege (EPERM). Git under
      // core.symlinks=false keeps an index entry's link mode when the worktree
      // holds the link text as a plain file, so the staged record is the same.
      assert.equal((err as NodeJS.ErrnoException).code, "EPERM");
    }
    if (!made) {
      f.write("src/link.ts", "a.ts");
      const blob = git(f.worktree, "hash-object", "-w", "src/link.ts");
      git(f.worktree, "update-index", "--add", "--cacheinfo", `120000,${blob},src/link.ts`);
    }
    f.write("src/a.ts", "export const a = 10;\n");
    const result = commitWorkspace(f.input());
    assert.ok(!result.ok && result.kind === "refused", !result.ok ? result.reason : "committed");
    assert.ok(!result.ok && result.reason.includes("makes src/link.ts a symbolic link"), !result.ok ? result.reason : "");
    assertReset(f);
  });
});

test("a nested Git repository is refused as a gitlink, so a host git status never runs its config", () => {
  withFixture((f) => {
    // What `run_command` can do in the container: only /work/.git is
    // read-only. Its config names a command host Git would run when it
    // recurses into a committed gitlink.
    const marker = join(dirname(f.worktree), "fsmonitor-ran-on-host.txt").replace(/\\/g, "/");
    const nest = () => {
      const nested = join(f.worktree, "src", "nested");
      mkdirSync(nested, { recursive: true });
      git(nested, "init", "-q");
      git(nested, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "nested");
      git(nested, "config", "core.fsmonitor", `echo ran >> '${marker}'; false`);
    };
    nest();
    f.write("src/a.ts", "export const a = 10;\n");
    const result = commitWorkspace(f.input());
    assert.ok(!result.ok && result.kind === "refused", !result.ok ? result.reason : "committed");
    assert.ok(!result.ok && result.reason.includes("makes src/nested a nested Git repository (a gitlink): the system refuses them"), !result.ok ? result.reason : "");
    assertReset(f);
    assert.equal(existsSync(marker), false, "host Git ran the nested repository's config");
    // Positive control: committed, the gitlink makes the next host status run it.
    nest();
    git(f.worktree, "add", "-A");
    git(f.worktree, "commit", "-q", "-m", "control");
    checkWorktreeClean(f.worktree);
    assert.equal(existsSync(marker), true, "host status never recursed, so this test proves nothing");
  });
});

test("a refused change is kept as a commit outside the branch, named in the reason", () => {
  withFixture((f) => {
    f.write("src/a.ts", "export const a = 10;\n");
    f.write("out-of-scope.txt", "x\n");
    const result = commitWorkspace(f.input());
    assert.ok(!result.ok && result.kind === "refused", !result.ok ? result.reason : "committed");
    const kept = !result.ok ? /the refused change is kept as commit ([0-9a-f]{40}) \(refs\/buildworks\/refused\/\1\)/.exec(result.reason) : null;
    assert.ok(kept, !result.ok ? result.reason : "");
    const sha = kept[1]!;
    assert.equal(git(f.worktree, "rev-parse", `refs/buildworks/refused/${sha}`), sha);
    assert.equal(git(f.worktree, "rev-parse", `${sha}^`), f.base);
    assert.equal(git(f.worktree, "diff", "--name-only", f.base, sha), "out-of-scope.txt\nsrc/a.ts");
    assert.equal(git(f.worktree, "show", `${sha}:src/a.ts`), "export const a = 10;");
    // The branch keeps only committed work.
    assertReset(f);
    assert.equal(f.audits.length, 1);
    assert.ok(f.audits[0]!.summary.includes(`kept as commit ${sha}`));
  });
});

test("a derived file the agent created, absent at base, is removed and recorded; the source edit commits", () => {
  withFixture((f) => {
    f.write("new.lock", "agent lock\n");
    f.write("src/a.ts", "export const a = 10;\n");
    const result = commitWorkspace(f.input());
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.paths, ["src/a.ts"]);
    assert.equal(existsSync(join(f.worktree, "new.lock")), false);
    assert.deepEqual(result.derivedDiscarded, [`new.lock (removed; absent at ${f.base})`]);
    assert.deepEqual(f.audits, [{ action: "derived.discarded", summary: `base=${f.base}; discarded new.lock (removed; absent at ${f.base})` }]);
    assert.deepEqual(checkWorktreeClean(f.worktree), { ok: true });
  });
});

test("a derived file the agent modified is restored to base and recorded; the source edit commits", () => {
  withFixture((f) => {
    f.write("base.lock", "lock v2 written by an install\n");
    f.write("src/a.ts", "export const a = 10;\n");
    const result = commitWorkspace(f.input());
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.paths, ["src/a.ts"]);
    assert.equal(readFileSync(join(f.worktree, "base.lock"), "utf8"), "lock v1\n");
    assert.deepEqual(result.derivedDiscarded, [`base.lock (restored to ${f.base})`]);
    assert.equal(f.audits[0]!.action, "derived.discarded");
  });
});

test("a derived file the agent deleted is restored to base and recorded; the source edit commits", () => {
  withFixture((f) => {
    rmSync(join(f.worktree, "base.lock"));
    f.write("src/a.ts", "export const a = 10;\n");
    const result = commitWorkspace(f.input());
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.paths, ["src/a.ts"]);
    assert.equal(readFileSync(join(f.worktree, "base.lock"), "utf8"), "lock v1\n");
    assert.deepEqual(result.derivedDiscarded, [`base.lock (restored to ${f.base})`]);
  });
});

test("an empty diff is reported as changed nothing", () => {
  withFixture((f) => {
    f.write("dist/out.js", "built\n");
    const result = commitWorkspace(f.input());
    assert.ok(!result.ok && result.kind === "empty");
    assert.ok(!result.ok && result.reason === "the agent changed nothing");
    assert.deepEqual(f.audits, []);
    assertReset(f);
  });
});

test("a moved HEAD is refused and the worktree kept as evidence", () => {
  withFixture((f) => {
    f.write("src/a.ts", "export const a = 10;\n");
    git(f.worktree, "commit", "-q", "-am", "moved by someone");
    const moved = git(f.worktree, "rev-parse", "HEAD");
    const result = commitWorkspace(f.input());
    assert.ok(!result.ok && result.kind === "failed");
    assert.ok(!result.ok && result.reason.includes(`the worktree head moved from ${f.base} to ${moved}`), !result.ok ? result.reason : "");
    assert.equal(git(f.worktree, "rev-parse", "HEAD"), moved);
  });
});

test("the system's commit runs none of the target's hooks, so an agent's change never runs on the host", () => {
  withFixture((f) => {
    // A target whose hooks run repository content: a tracked hooks directory
    // whose hooks run a script the agent may change. Each hook the commit and
    // its ref update fire runs it.
    const marker = join(dirname(f.worktree), "hook-ran-on-host.txt");
    mkdirSync(join(dirname(f.worktree), "hooks"), { recursive: true });
    for (const hook of ["pre-commit", "commit-msg", "post-commit", "reference-transaction"]) {
      writeFileSync(join(dirname(f.worktree), "hooks", hook), "#!/bin/sh\nnode src/hook.js\n", { mode: 0o755 });
    }
    git(f.worktree, "config", "core.hooksPath", join(dirname(f.worktree), "hooks"));
    // The agent's in-scope change, made inside the container in a real run.
    f.write("src/hook.js", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
    const result = commitWorkspace(f.input());
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.paths, ["src/hook.js"]);
    assert.equal(existsSync(marker), false, "a hook ran the agent's code on the host");
    // Positive control: the same hooks fire for an ordinary commit.
    git(f.worktree, "commit", "-q", "--allow-empty", "-m", "control");
    assert.equal(existsSync(marker), true, "the hooks never fire, so this test proves nothing");
  });
});

test("a Git failure returns a refusal naming the Git argv and its stderr", () => {
  const notRepo = mkdtempSync(join(tmpdir(), "bw-workspace-not-repo-"));
  try {
    const audits: string[] = [];
    const result = commitWorkspace({
      worktreePath: notRepo,
      base: "0".repeat(40),
      scope: SCOPE,
      slug: SLUG,
      derivedPaths: [],
      sandbox: standInSandbox(),
      message: "m",
      onAudit: (_action, summary) => audits.push(summary),
    });
    assert.ok(!result.ok && result.kind === "failed");
    assert.ok(!result.ok && result.reason.includes("git rev-parse HEAD failed (exit 128)"), !result.ok ? result.reason : "");
    assert.ok(!result.ok && /not a git repository/i.test(result.reason));
    assert.equal(audits.length, 1);
  } finally {
    rmSync(notRepo, { recursive: true, force: true });
  }
});
