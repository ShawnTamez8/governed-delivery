import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandbox, destroySandbox, execTarget, runInSandbox, type SandboxCommandOptions } from "../src/container.ts";
import type { VerifyCommand } from "../src/governed-config.ts";
import { VERIFY_RETENTION_MAX_BYTES } from "../src/policy.ts";
import type { CommandOutcome } from "../src/verify-command.ts";
import { STAND_IN_IMAGE_ID, standInSandbox } from "./fixtures/docker/stand-in.ts";

/**
 * `runVerifyCommand`'s streaming and ceilings, exercised through its only
 * caller: `runInSandbox`'s `docker exec`, against the Docker stand-in
 * (docs/features/sandboxed-implementer/plan.md, Task 8). Where the command
 * itself runs, and with what environment, is the real container's to prove
 * (`test/container.test.ts`).
 */

const FIXTURES = join(process.cwd(), "test", "fixtures", "verify");

const REMOVE_ATTEMPTS = 20;
const REMOVE_DELAY_MS = 100;

/**
 * On Windows something outside the process tree can hold a freshly closed
 * evidence file briefly after a forced tree-kill, and Node 26's `rmSync`
 * does not retry that EPERM despite `maxRetries` (probed 2026-09-24: it
 * fails in about 1 ms against a held file). Retry only those codes, within a
 * bounded budget, so a lasting hold still fails the test.
 */
async function removeRoot(root: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY") || attempt >= REMOVE_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, REMOVE_DELAY_MS));
    }
  }
}

/** Run `cmd` in a fresh stand-in sandbox and tear it down. */
async function inSandbox(
  cmd: VerifyCommand,
  overrides: Partial<SandboxCommandOptions> = {}
): Promise<{ outcome: CommandOutcome; root: string; work: string }> {
  const root = mkdtempSync(join(tmpdir(), "bw-verify-cmd-"));
  const worktree = join(root, "wt");
  mkdirSync(worktree);
  writeFileSync(join(worktree, ".git"), "gitdir: elsewhere\n");
  const sandbox = createSandbox({ frozen: standInSandbox(), rootDir: root, runId: 1, label: "verify", worktreePath: worktree });
  try {
    const outcome = await runInSandbox(execTarget(sandbox), sandbox.frozen.imageId, cmd, {
      cwd: worktree,
      timeoutSeconds: 30,
      maxBytes: 1024 * 1024,
      retentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
      evidencePath: join(root, "evidence.txt"),
      ...overrides,
    });
    return { outcome, root, work: sandbox.ids.work! };
  } finally {
    destroySandbox(sandbox);
  }
}

async function withOutcome(
  cmd: VerifyCommand,
  overrides: Partial<SandboxCommandOptions>,
  fn: (outcome: CommandOutcome, work: string) => void
): Promise<void> {
  const { outcome, root, work } = await inSandbox(cmd, overrides);
  try {
    fn(outcome, work);
  } finally {
    await removeRoot(root);
  }
}

test("a passing command carries its marker on stdout and exits 0", async () => {
  const command = ["node", join(FIXTURES, "exit-zero.mjs")];
  await withOutcome({ name: "ok", command }, {}, (outcome, work) => {
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.outputOverflow, false);
    assert.deepEqual(outcome.argv, command);
    assert.match(outcome.stdout, /VERIFY_OK/);
    assert.equal(outcome.stderr, "");
    const log = readFileSync(outcome.evidenceRef, "utf8");
    // The first line names the container, the image and the argv, and counts
    // toward neither ceiling.
    assert.ok(
      log.startsWith(`# ran in container ${work} (image ${STAND_IN_IMAGE_ID}): ${JSON.stringify(command)}\n`),
      log.slice(0, 300)
    );
    assert.match(log, /VERIFY_OK/);
  });
});

test("a failing command carries its marker on stderr and its own exit code", async () => {
  await withOutcome({ name: "fail", command: ["node", join(FIXTURES, "exit-two.mjs")] }, {}, (outcome) => {
    // docker exec itself exits 0 after the wrapper's echo; 2 is the command's.
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.stderr, /VERIFY_FAILED/);
    assert.equal(outcome.stdout, "");
    assert.match(readFileSync(outcome.evidenceRef, "utf8"), /VERIFY_FAILED/);
  });
});

test("output above the budget is refused in memory and retained on disk", async () => {
  const maxBytes = 4096;
  await withOutcome({ name: "flood", command: ["node", join(FIXTURES, "flood-stdout.mjs")] }, { maxBytes }, (outcome) => {
    assert.equal(outcome.outputOverflow, true, "overflow was not reported");
    assert.ok(
      Buffer.byteLength(outcome.stdout, "utf8") <= maxBytes,
      `kept ${Buffer.byteLength(outcome.stdout, "utf8")} bytes in memory, budget ${maxBytes}`
    );
    // Section 20: refuse above the cap and retain the bytes anyway. The
    // evidence file must hold more than the in-memory copy, or retention is
    // only a claim.
    const retained = statSync(outcome.evidenceRef).size;
    assert.ok(retained > maxBytes, `evidence file is ${retained} bytes, budget ${maxBytes}`);
  });
});

test("a hung command is killed with its whole tree at the in-container ceiling", async () => {
  await withOutcome({ name: "hang", command: ["node", join(FIXTURES, "hang-with-child.mjs")] }, { timeoutSeconds: 2 }, (outcome) => {
    assert.equal(outcome.timedOut, true);
    // The wrapper records the in-container ceiling's SIGKILL (`execArgv`).
    assert.equal(outcome.exitCode, 137);
    assert.equal(outcome.killError, null);
    // The duration bound is asserted explicitly: a killed run can look green
    // because Node's own exit teardown kills the hung child long after the
    // ceiling should have.
    assert.ok(outcome.durationMs < 20_000, `kill took ${outcome.durationMs}ms`);
    const match = /grandchild=(\d+)/.exec(outcome.stdout);
    assert.ok(match, `no grandchild pid in ${JSON.stringify(outcome.stdout)}`);
    assert.throws(
      () => process.kill(Number(match[1]), 0),
      (err: unknown) => (err as NodeJS.ErrnoException).code === "ESRCH",
      `grandchild ${match[1]} survived the tree-kill`
    );
  });
});

test("retention has a ceiling of its own, so an endless command cannot fill the disk", async () => {
  // The in-memory budget bounds memory; nothing else bounds disk, because
  // retention is deliberately independent of it. Measured before this
  // ceiling existed: 5.97 GB in 5.2 seconds, which is about 955 GB inside
  // the 900-second command ceiling. The fixture never exits, so a passing
  // assertion here is also proof the ceiling ends the command.
  const retentionMaxBytes = 2 * 1024 * 1024;
  await withOutcome(
    { name: "endless", command: ["node", join(FIXTURES, "flood-forever.mjs")] },
    { maxBytes: 4096, retentionMaxBytes, timeoutSeconds: 120 },
    (outcome) => {
      const retained = statSync(outcome.evidenceRef).size;
      // The evidence header is written before the ceiling is counted.
      const header = readFileSync(outcome.evidenceRef, "utf8").indexOf("\n") + 1;
      assert.ok(
        retained - header <= retentionMaxBytes,
        `retained ${retained - header} bytes, ceiling ${retentionMaxBytes}`
      );
      // Still more than the in-memory budget: the ceiling bounds retention, it
      // does not collapse it onto the memory cap.
      assert.ok(retained > 4096, `retained only ${retained} bytes`);
      assert.equal(outcome.outputOverflow, true);
      // Overflow, not a timeout: the refusal must name the true cause, and the
      // time ceiling is 120 seconds here precisely so a timeout cannot be what
      // stopped it.
      assert.equal(outcome.timedOut, false);
      assert.ok(outcome.durationMs < 60_000, `took ${outcome.durationMs}ms`);
    }
  );
});
