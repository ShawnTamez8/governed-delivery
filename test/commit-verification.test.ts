import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCommitState, verifyCommit, type CommitVerificationInput } from "../src/commit-verification.ts";
import { sandboxLeftovers } from "../src/container.ts";
import {
  markNoExitStatus,
  markUnremovable,
  markUnstartable,
  sandboxPrefix,
  STAND_IN_DOCKER_COMMAND,
  STAND_IN_IMAGE_ID,
  standInSandbox,
} from "./fixtures/docker/stand-in.ts";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout ?? "").trim();
}

async function withRepository(
  fn: (root: string, head: string) => Promise<void>,
  ignore: string[] = []
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-verify-helper-"));
  try {
    git(root, ["init", "-q"]);
    writeFileSync(join(root, ".gitignore"), [".governance/", ...ignore].join("\n") + "\n");
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
    removeLeftovers(root);
    rmSync(root, { recursive: true, force: true });
  }
}

/** Remove what a test left in the stand-in for this repository, by the IDs it lists. */
function removeLeftovers(root: string): void {
  const leftovers = sandboxLeftovers(STAND_IN_DOCKER_COMMAND, root);
  for (const line of leftovers.containers) spawnSync(process.execPath, [...STAND_IN_DOCKER_COMMAND.slice(1), "rm", "-f", line.split(" ")[0]!]);
  for (const line of leftovers.networks) spawnSync(process.execPath, [...STAND_IN_DOCKER_COMMAND.slice(1), "network", "rm", line.split(" ")[0]!]);
}

function fixture(name: string): string[] {
  return ["node", join(process.cwd(), "test", "fixtures", "verify", name)];
}

function input(
  root: string,
  head: string,
  overrides: Partial<CommitVerificationInput> & Pick<CommitVerificationInput, "commands">
): CommitVerificationInput {
  return {
    rootDir: root,
    worktreePath: root,
    expectedCommit: head,
    timeoutSeconds: 30,
    maxBytes: 1024 * 1024,
    retentionMaxBytes: 1024 * 1024,
    sandbox: standInSandbox(),
    runId: 1,
    label: "verification",
    evidenceDir: join(root, ".governance", "verification-test"),
    audit: () => undefined,
    ...overrides,
  };
}

test("verifyCommit retains passing evidence for the exact clean commit, naming where it ran", async () => {
  await withRepository(async (root, head) => {
    const audits: string[] = [];
    const evidenceDir = join(root, ".governance", "verification-test");
    const result = await verifyCommit(input(root, head, {
      commands: [{ name: "ok", command: fixture("exit-zero.mjs") }],
      audit: (action, summary) => audits.push(`${action}: ${summary}`),
    }));
    assert.equal(result.reason, null);
    assert.equal(result.record!.outcome, "pass");
    assert.equal(result.record!.expectedCommit, head);
    assert.equal(result.record!.commands.length, 1);
    assert.deepEqual(result.record!.commands[0]!.argv, fixture("exit-zero.mjs"));
    assert.match(audits[0]!, /^command\.pass:/);
    const log = readFileSync(join(evidenceDir, "ok.log"), "utf8");
    const [header, ...rest] = log.split("\n");
    assert.match(header!, new RegExp(`^# ran in container [0-9a-f]{64} \\(image ${STAND_IN_IMAGE_ID}\\): `));
    assert.ok(header!.endsWith(JSON.stringify(fixture("exit-zero.mjs"))), header);
    assert.match(rest.join("\n"), /VERIFY_OK/);
    assert.deepEqual(sandboxLeftovers(STAND_IN_DOCKER_COMMAND, root), { containers: [], networks: [] });
  });
});

test("a non-blocking command's failure is recorded and the next command still runs; a dirty worktree still blocks; no flag still stops", async () => {
  // docs/features/reproduced-review-findings/plan.md, Task 5.
  await withRepository(async (root, head) => {
    const audits: string[] = [];
    const result = await verifyCommit(input(root, head, {
      commands: [
        { name: "fails", command: fixture("exit-two.mjs"), blocking: false },
        { name: "ok", command: fixture("exit-zero.mjs") },
      ],
      audit: (action, summary) => audits.push(`${action}: ${summary}`),
    }));
    assert.equal(result.reason, null);
    assert.equal(result.record!.outcome, "pass");
    assert.equal(result.record!.blockingCommand, null);
    assert.deepEqual(result.record!.commands.map((c) => [c.name, c.blockedBecause, c.nonBlockingFailure]), [
      ["fails", null, "the command exited with code 2"],
      ["ok", null, undefined],
    ]);
    assert.match(audits[0]!, /^command\.fail: fails: .*; non-blocking: the command exited with code 2$/);
    assert.match(audits[1]!, /^command\.pass: ok:/);
  });

  await withRepository(async (root, head) => {
    const result = await verifyCommit(input(root, head, {
      commands: [
        { name: "dirties", command: fixture("touch-tracked.mjs"), blocking: false },
        { name: "ok", command: fixture("exit-zero.mjs") },
      ],
      evidenceDir: join(root, ".governance", "verification-dirty"),
    }));
    assert.equal(result.record!.outcome, "block");
    assert.equal(result.record!.blockingCommand, "dirties");
    assert.equal(result.record!.commands.length, 1);
    assert.match(result.reason!, /left the worktree dirty/);
  });

  await withRepository(async (root, head) => {
    const result = await verifyCommit(input(root, head, {
      commands: [
        { name: "fails", command: fixture("exit-two.mjs") },
        { name: "ok", command: fixture("exit-zero.mjs") },
      ],
    }));
    assert.equal(result.record!.outcome, "block");
    assert.equal(result.record!.blockingCommand, "fails");
    assert.deepEqual(result.record!.commands.map((c) => c.name), ["fails"]);
    assert.equal("nonBlockingFailure" in result.record!.commands[0]!, false);
  });
});

test("verifyCommit blocks on command failure and retained residue", async () => {
  await withRepository(async (root, head) => {
    const evidenceDir = join(root, ".governance", "verification-fail");
    const failed = await verifyCommit(input(root, head, {
      commands: [{ name: "fails", command: fixture("exit-two.mjs") }],
      evidenceDir,
    }));
    assert.equal(failed.record!.outcome, "block");
    assert.equal(failed.record!.blockingCommand, "fails");
    // The command's own exit code, read from the wrapper's file, not docker exec's.
    assert.equal(failed.record!.commands[0]!.exitCode, 2);
    assert.match(failed.reason!, /exited with code 2/);
    assert.match(readFileSync(join(evidenceDir, "fails.log"), "utf8"), /VERIFY_FAILED/);
  });

  await withRepository(async (root, head) => {
    const dirty = await verifyCommit(input(root, head, {
      commands: [{ name: "dirties", command: fixture("touch-tracked.mjs") }],
      evidenceDir: join(root, ".governance", "verification-dirty"),
    }));
    assert.equal(dirty.record!.outcome, "block");
    assert.match(dirty.reason!, /left the worktree dirty/);
  });
});

test("verifyCommit removes ignored output after a pass and keeps the evidence directory", async () => {
  await withRepository(async (root, head) => {
    const audits: string[] = [];
    const evidenceDir = join(root, ".governance", "verification-ignored");
    const result = await verifyCommit(input(root, head, {
      commands: [{ name: "build", command: fixture("write-ignored.mjs") }],
      evidenceDir,
      audit: (action, summary) => audits.push(`${action}: ${summary}`),
    }));
    assert.equal(result.reason, null);
    assert.equal(result.record!.outcome, "pass");
    assert.equal(existsSync(join(root, "node_modules")), false);
    assert.equal(existsSync(join(root, "frontend", "dist")), false);
    // Here the evidence sits inside the checked worktree; it must survive.
    assert.equal(existsSync(join(evidenceDir, "build.log")), true);
    assert.deepEqual(
      audits.filter((a) => a.startsWith("cleanup:")),
      ["cleanup: removed ignored output the commands left: frontend/dist/, node_modules/"]
    );
  }, ["node_modules/", "dist/"]);
});

test("a sandbox that fails to start blocks verification with no result, naming the operation and the stand-in's stderr", async () => {
  await withRepository(async (root, head) => {
    const audits: string[] = [];
    const unmark = markUnstartable(sandboxPrefix(root, 1, "verification"));
    try {
      const result = await verifyCommit(input(root, head, {
        commands: [{ name: "ok", command: fixture("exit-zero.mjs") }],
        audit: (action, summary) => audits.push(`${action}: ${summary}`),
      }));
      assert.equal(result.record, null);
      assert.match(result.reason!, /^cannot start the verification sandbox: start proxy bw-\S+-proxy failed \(docker exit 125\): .*stand-in marked \S+ unstartable/);
      assert.deepEqual(audits.map((a) => a.slice(0, a.indexOf(":"))), ["sandbox.failed"]);
    } finally {
      unmark();
    }
    // The failed start removed the network it had created.
    assert.deepEqual(sandboxLeftovers(STAND_IN_DOCKER_COMMAND, root), { containers: [], networks: [] });
  });
});

test("an absent exit-status file is a sandbox failure, never the command failing", async () => {
  await withRepository(async (root, head) => {
    const audits: string[] = [];
    const unmark = markNoExitStatus(sandboxPrefix(root, 1, "verification"));
    try {
      const result = await verifyCommit(input(root, head, {
        commands: [{ name: "ok", command: fixture("exit-zero.mjs") }],
        audit: (action, summary) => audits.push(`${action}: ${summary}`),
      }));
      assert.equal(result.record, null);
      assert.match(result.reason!, /^command ok could not be run in sandbox \S+: read exit status in \S+ failed \(docker exit 1\): .*No such file or directory/);
      assert.deepEqual(audits.map((a) => a.slice(0, a.indexOf(":"))), ["sandbox.failed"]);
    } finally {
      unmark();
    }
    assert.deepEqual(sandboxLeftovers(STAND_IN_DOCKER_COMMAND, root), { containers: [], networks: [] });
  });
});

test("a work container not proven gone blocks verification with no result and no host cleanup", async () => {
  await withRepository(async (root, head) => {
    const audits: string[] = [];
    const unmark = markUnremovable(sandboxPrefix(root, 1, "verification"));
    try {
      const result = await verifyCommit(input(root, head, {
        commands: [{ name: "build", command: fixture("write-ignored.mjs") }],
        audit: (action, summary) => audits.push(`${action}: ${summary}`),
      }));
      assert.equal(result.record, null);
      assert.match(result.reason!, /^work container \S+-work \([0-9a-f]{64}\) could not be proven removed, so a process left in it could still write the worktree: remove work container .*unremovable/);
      assert.deepEqual(audits.map((a) => a.slice(0, a.indexOf(":"))), ["command.pass", "sandbox.quiescence.failed"]);
      // No host step read or changed the worktree after the unproven teardown.
      assert.equal(existsSync(join(root, "node_modules")), true);
    } finally {
      unmark();
    }
  }, ["node_modules/", "dist/"]);
});

test("checkCommitState names an entry head mismatch before commands run", async () => {
  await withRepository(async (root) => {
    assert.match(
      checkCommitState(root, "0".repeat(40), "before verification")!,
      /not the commit implementation left/
    );
  });
});

test("an entry check failure blocks before any sandbox starts", async () => {
  await withRepository(async (root) => {
    const result = await verifyCommit(input(root, "0".repeat(40), {
      commands: [{ name: "ok", command: fixture("exit-zero.mjs") }],
    }));
    assert.equal(result.record!.outcome, "block");
    assert.equal(result.record!.commands.length, 0);
    assert.deepEqual(sandboxLeftovers(STAND_IN_DOCKER_COMMAND, root), { containers: [], networks: [] });
  });
});
