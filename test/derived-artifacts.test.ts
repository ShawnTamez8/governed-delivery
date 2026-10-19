import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenerateDerivedArtifacts, type RegenerationInput } from "../src/derived-artifacts.ts";
import type { DerivedArtifact } from "../src/governed-config.ts";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout ?? "").trim();
}

/**
 * A repository whose base commit holds a tracked `package-lock.json`, with
 * `node_modules/` ignored, and a state root outside it — production keeps the
 * evidence under the main checkout's `.governance/`, never in the worktree.
 */
async function withRepository(fn: (worktree: string, stateRoot: string, head: string) => Promise<void>): Promise<void> {
  const worktree = mkdtempSync(join(tmpdir(), "bw-derived-"));
  const stateRoot = mkdtempSync(join(tmpdir(), "bw-derived-state-"));
  try {
    git(worktree, ["init", "-q"]);
    writeFileSync(join(worktree, ".gitignore"), "node_modules/\n");
    writeFileSync(join(worktree, "a.txt"), "base\n");
    writeFileSync(join(worktree, "package-lock.json"), "v1\n");
    git(worktree, ["add", "-A"]);
    git(worktree, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "base"]);
    await fn(worktree, stateRoot, git(worktree, ["rev-parse", "HEAD"]));
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

const WRITE_DERIVED = join(process.cwd(), "test", "fixtures", "verify", "write-derived.mjs");

function lockfile(...args: string[]): DerivedArtifact {
  return { name: "lockfile", path: "package-lock.json", command: ["node", WRITE_DERIVED, "package-lock.json", ...args] };
}

function input(
  worktree: string,
  stateRoot: string,
  head: string,
  derived: DerivedArtifact[],
  audits: string[]
): RegenerationInput {
  return {
    rootDir: stateRoot,
    worktreePath: worktree,
    runId: 7,
    derived,
    expectedHead: head,
    label: "phase-1",
    evidenceDir: join(stateRoot, ".governance", "derived", "7", "phase-1"),
    policy: {
      timeoutSeconds: 30,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: 1024 * 1024,
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP"],
    },
    audit: (action, summary) => audits.push(`${action}: ${summary}`),
  };
}

test("an empty derived list runs nothing and returns the head", async () => {
  await withRepository(async (worktree, stateRoot, head) => {
    const audits: string[] = [];
    const result = await regenerateDerivedArtifacts(input(worktree, stateRoot, head, [], audits));
    assert.deepEqual(result, { ok: true, head, regenerated: [] });
    assert.deepEqual(audits, []);
    assert.equal(existsSync(join(stateRoot, ".governance")), false, "no evidence directory for nothing run");
  });
});

test("a command that changes its derived file produces one commit touching only that path", async () => {
  await withRepository(async (worktree, stateRoot, head) => {
    const audits: string[] = [];
    const result = await regenerateDerivedArtifacts(input(worktree, stateRoot, head, [lockfile("v2")], audits));
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    assert.notEqual(result.head, head);
    assert.deepEqual(result.regenerated, ["package-lock.json"]);
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), result.head);
    assert.equal(git(worktree, ["rev-parse", `${result.head}~1`]), head, "exactly one commit");
    assert.equal(git(worktree, ["diff", "--name-only", head, result.head]), "package-lock.json");
    assert.equal(
      git(worktree, ["log", "-1", "--format=%s"]),
      `bw run 7: regenerate derived artifacts (phase-1, base ${head.slice(0, 8)})`
    );
    assert.equal(git(worktree, ["log", "-1", "--format=%an <%ae>"]), "BuildWorks <buildworks@buildworks.invalid>");
    assert.equal(readFileSync(join(worktree, "package-lock.json"), "utf8"), "v2\n");
    assert.deepEqual(audits, [
      `derived.commit: label=phase-1; base=${head}; head=${result.head}; paths=package-lock.json; evidence=${join(".governance", "derived", "7", "phase-1")}`,
    ]);
    assert.ok(existsSync(join(stateRoot, ".governance", "derived", "7", "phase-1", "lockfile.log")));
  });
});

test("a command that also writes ignored output commits once, removes the output and leaves the tree clean", async () => {
  await withRepository(async (worktree, stateRoot, head) => {
    const audits: string[] = [];
    const result = await regenerateDerivedArtifacts(
      input(worktree, stateRoot, head, [lockfile("v2", "ignored")], audits)
    );
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    if (!result.ok) return;
    assert.equal(git(worktree, ["rev-parse", `${result.head}~1`]), head);
    assert.equal(existsSync(join(worktree, "node_modules")), false);
    assert.equal(git(worktree, ["status", "--porcelain", "--untracked-files=all", "--ignored=matching"]), "");
    assert.match(audits[0]!, /^derived\.commit: /);
  });
});

test("a command that leaves the file identical audits derived.unchanged and makes no commit", async () => {
  await withRepository(async (worktree, stateRoot, head) => {
    const audits: string[] = [];
    const result = await regenerateDerivedArtifacts(input(worktree, stateRoot, head, [lockfile("v1")], audits));
    assert.deepEqual(result, { ok: true, head, regenerated: [] });
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
    assert.deepEqual(audits, [
      `derived.unchanged: label=phase-1; head=${head}; evidence=${join(".governance", "derived", "7", "phase-1")}`,
    ]);
  });
});

test("a command that also writes a file that is not derived is refused, and nothing is committed", async () => {
  await withRepository(async (worktree, stateRoot, head) => {
    const audits: string[] = [];
    const result = await regenerateDerivedArtifacts(
      input(worktree, stateRoot, head, [lockfile("v2", "stray")], audits)
    );
    assert.deepEqual(result, {
      ok: false,
      reason: "the derived command(s) changed files that are not derived artifacts: stray.txt",
    });
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
    assert.match(audits[0]!, /^derived\.refused: label=phase-1; the derived command\(s\) changed files that are not derived artifacts: stray\.txt/);
  });
});

test("a failing command is refused naming the artifact", async () => {
  await withRepository(async (worktree, stateRoot, head) => {
    const audits: string[] = [];
    const failing: DerivedArtifact = {
      name: "lockfile",
      path: "package-lock.json",
      command: ["node", join(process.cwd(), "test", "fixtures", "verify", "exit-two.mjs")],
    };
    const result = await regenerateDerivedArtifacts(input(worktree, stateRoot, head, [failing], audits));
    assert.deepEqual(result, {
      ok: false,
      reason: "derived artifact lockfile could not be regenerated: the command exited with code 2",
    });
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), head);
    assert.match(audits[0]!, /^derived\.fail: label=phase-1; lockfile: node /);
  });
});

test("a head that moved before the call is refused", async () => {
  await withRepository(async (worktree, stateRoot, head) => {
    writeFileSync(join(worktree, "a.txt"), "moved\n");
    git(worktree, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-am", "moved"]);
    const moved = git(worktree, ["rev-parse", "HEAD"]);
    const audits: string[] = [];
    const result = await regenerateDerivedArtifacts(input(worktree, stateRoot, head, [lockfile("v2")], audits));
    assert.deepEqual(result, {
      ok: false,
      reason: `the worktree head moved before regeneration: expected ${head}, found ${moved}`,
    });
    assert.equal(git(worktree, ["rev-parse", "HEAD"]), moved);
  });
});
