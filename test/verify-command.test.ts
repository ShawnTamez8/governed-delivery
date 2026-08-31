import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runVerifyCommand } from "../src/verify-command.ts";
import { VERIFY_ENV_PASSTHROUGH, VERIFY_RETENTION_MAX_BYTES } from "../src/policy.ts";

const FIXTURES = join(process.cwd(), "test", "fixtures", "verify");

function withRoot(fn: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-verify-cmd-"));
  return fn(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

function opts(root: string, overrides: Partial<Parameters<typeof runVerifyCommand>[1]> = {}) {
  return {
    cwd: root,
    timeoutSeconds: 30,
    maxBytes: 1024 * 1024,
    retentionMaxBytes: VERIFY_RETENTION_MAX_BYTES,
    envPassthrough: [...VERIFY_ENV_PASSTHROUGH],
    evidencePath: join(root, "evidence.txt"),
    ...overrides,
  };
}

test("a passing command carries its marker on stdout and exits 0", async () => {
  await withRoot(async (root) => {
    const outcome = await runVerifyCommand(
      { name: "ok", command: ["node", join(FIXTURES, "exit-zero.mjs")] },
      opts(root)
    );
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.timedOut, false);
    assert.equal(outcome.outputOverflow, false);
    assert.match(outcome.stdout, /VERIFY_OK/);
    assert.equal(outcome.stderr, "");
    assert.match(readFileSync(outcome.evidenceRef, "utf8"), /VERIFY_OK/);
  });
});

test("a failing command carries its marker on stderr and its exit code", async () => {
  await withRoot(async (root) => {
    const outcome = await runVerifyCommand(
      { name: "fail", command: ["node", join(FIXTURES, "exit-two.mjs")] },
      opts(root)
    );
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.stderr, /VERIFY_FAILED/);
    assert.equal(outcome.stdout, "");
    assert.match(readFileSync(outcome.evidenceRef, "utf8"), /VERIFY_FAILED/);
  });
});

test("the command runs in the given working directory", async () => {
  await withRoot(async (root) => {
    const outcome = await runVerifyCommand(
      { name: "cwd", command: ["node", join(FIXTURES, "print-cwd.mjs")] },
      opts(root)
    );
    assert.equal(outcome.exitCode, 0);
    // Compared through realpath: macOS resolves /var to /private/var, so the
    // literal temp path and the child's cwd can differ while naming one
    // directory.
    assert.equal(
      statSync(outcome.stdout.trim()).ino,
      statSync(root).ino,
      `command ran in ${outcome.stdout.trim()}, not ${root}`
    );
  });
});

test("the environment is the named passthrough and nothing else", async () => {
  // Asserted in both directions: an unlisted variable set in this process must
  // not reach the child, and a listed one must. One direction alone would pass
  // against a child that received no environment at all, or against one that
  // received everything.
  const before = process.env.BW_CANARY_SECRET;
  process.env.BW_CANARY_SECRET = "must-not-leak";
  try {
    await withRoot(async (root) => {
      const outcome = await runVerifyCommand(
        { name: "env", command: ["node", join(FIXTURES, "print-env.mjs")] },
        opts(root)
      );
      assert.equal(outcome.exitCode, 0);
      const childEnv = JSON.parse(outcome.stdout) as Record<string, string>;
      assert.equal(childEnv.BW_CANARY_SECRET, undefined, "the canary reached the command");
      assert.ok(childEnv.PATH !== undefined && childEnv.PATH !== "", "PATH did not reach the command");
    });
  } finally {
    if (before === undefined) delete process.env.BW_CANARY_SECRET;
    else process.env.BW_CANARY_SECRET = before;
  }
});

test("an unresolvable command is reported the way the shell reports it", async () => {
  // The expectation comes from the behaviour `test/harness.test.ts` already
  // records, not from an invented one: under shell: true the shell itself
  // starts, names the command on stderr, and exits 1. `spawnError` covers only
  // the case where the shell cannot start at all.
  await withRoot(async (root) => {
    const outcome = await runVerifyCommand(
      { name: "missing", command: ["definitely-not-a-real-binary"] },
      opts(root)
    );
    assert.equal(outcome.exitCode, 1);
    assert.match(outcome.stderr, /definitely-not-a-real-binary/);
    assert.equal(outcome.spawnError, null);
  });
});

test("output above the budget is refused in memory and retained on disk", async () => {
  await withRoot(async (root) => {
    const maxBytes = 4096;
    const outcome = await runVerifyCommand(
      { name: "flood", command: ["node", join(FIXTURES, "flood-stdout.mjs")] },
      opts(root, { maxBytes })
    );
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

test("a hung command is killed with its whole tree at the ceiling", async () => {
  await withRoot(async (root) => {
    const outcome = await runVerifyCommand(
      { name: "hang", command: ["node", join(FIXTURES, "hang-with-child.mjs")] },
      opts(root, { timeoutSeconds: 2 })
    );
    assert.equal(outcome.timedOut, true);
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
  await withRoot(async (root) => {
    // The in-memory budget bounds memory; nothing else bounds disk, because
    // retention is deliberately independent of it. Measured before this
    // ceiling existed: 5.97 GB in 5.2 seconds, which is about 955 GB inside
    // the 900-second command ceiling. The fixture never exits, so a passing
    // assertion here is also proof the ceiling ends the command.
    const retentionMaxBytes = 2 * 1024 * 1024;
    const outcome = await runVerifyCommand(
      { name: "endless", command: ["node", join(FIXTURES, "flood-forever.mjs")] },
      opts(root, { maxBytes: 4096, retentionMaxBytes, timeoutSeconds: 120 })
    );
    const retained = statSync(outcome.evidenceRef).size;
    assert.ok(
      retained <= retentionMaxBytes,
      `retained ${retained} bytes, ceiling ${retentionMaxBytes}`
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
  });
});
