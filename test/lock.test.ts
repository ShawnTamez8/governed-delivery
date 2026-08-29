import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { acquireLock } from "../src/lock.ts";

test("acquiring twice fails fast naming the holder pid", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-lock-"));
  const release = acquireLock(root);
  try {
    assert.throws(() => acquireLock(root), /another invocation \(pid \d+, held since .+\) holds the lock/);
  } finally {
    release();
    rmSync(root, { recursive: true, force: true });
  }
});

test("release allows re-acquire", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-lock-"));
  try {
    const first = acquireLock(root);
    first();
    const second = acquireLock(root);
    second();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stale lock with a dead pid is taken over", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-lock-"));
  try {
    // A pid that existed and exited is provably dead.
    const dead = spawnSync(process.execPath, ["-e", ""]);
    mkdirSync(join(root, ".governance"), { recursive: true });
    writeFileSync(join(root, ".governance", "lock"), `pid=${dead.pid}\ncreated_at=stale\n`);
    const release = acquireLock(root);
    release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
