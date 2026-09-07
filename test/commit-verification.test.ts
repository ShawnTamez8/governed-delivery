import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCommitState, verifyCommit } from "../src/commit-verification.ts";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout ?? "").trim();
}

async function withRepository(fn: (root: string, head: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-verify-helper-"));
  try {
    git(root, ["init", "-q"]);
    writeFileSync(join(root, ".gitignore"), ".governance/\n");
    writeFileSync(join(root, "a.txt"), "base\n");
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
    await fn(root, git(root, ["rev-parse", "HEAD"]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const env = ["PATH", "SystemRoot", "TEMP", "TMP"];

test("verifyCommit retains passing evidence for the exact clean commit", async () => {
  await withRepository(async (root, head) => {
    const audits: string[] = [];
    const result = await verifyCommit({
      rootDir: root,
      worktreePath: root,
      expectedCommit: head,
      commands: [{ name: "ok", command: ["node", join(process.cwd(), "test", "fixtures", "verify", "exit-zero.mjs")] }],
      timeoutSeconds: 30,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: 1024 * 1024,
      envPassthrough: env,
      evidenceDir: join(root, ".governance", "verification-test"),
      audit: (action, summary) => audits.push(`${action}: ${summary}`),
    });
    assert.equal(result.reason, null);
    assert.equal(result.record.outcome, "pass");
    assert.equal(result.record.expectedCommit, head);
    assert.equal(result.record.commands.length, 1);
    assert.match(audits[0]!, /^command\.pass:/);
  });
});

test("verifyCommit blocks on command failure and retained residue", async () => {
  await withRepository(async (root, head) => {
    const failed = await verifyCommit({
      rootDir: root,
      worktreePath: root,
      expectedCommit: head,
      commands: [{ name: "fails", command: ["node", join(process.cwd(), "test", "fixtures", "verify", "exit-two.mjs")] }],
      timeoutSeconds: 30,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: 1024 * 1024,
      envPassthrough: env,
      evidenceDir: join(root, ".governance", "verification-fail"),
      audit: () => undefined,
    });
    assert.equal(failed.record.outcome, "block");
    assert.equal(failed.record.blockingCommand, "fails");
    assert.match(failed.reason!, /exited with code 2/);
  });

  await withRepository(async (root, head) => {
    const dirty = await verifyCommit({
      rootDir: root,
      worktreePath: root,
      expectedCommit: head,
      commands: [{ name: "dirties", command: ["node", join(process.cwd(), "test", "fixtures", "verify", "touch-tracked.mjs")] }],
      timeoutSeconds: 30,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: 1024 * 1024,
      envPassthrough: env,
      evidenceDir: join(root, ".governance", "verification-dirty"),
      audit: () => undefined,
    });
    assert.equal(dirty.record.outcome, "block");
    assert.match(dirty.reason!, /left the worktree dirty/);
  });
});

test("checkCommitState names an entry head mismatch before commands run", async () => {
  await withRepository(async (root) => {
    assert.match(
      checkCommitState(root, "0".repeat(40), "before verification")!,
      /not the commit implementation left/
    );
  });
});
