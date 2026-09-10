import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { acquireLock, inspectLock } from "../src/lock.ts";

test("lock inspection observes absent, live, dead, and unreadable files without changing them", () => {
  const root = mkdtempSync(join(tmpdir(), "bw-lock-"));
  try {
    assert.equal(inspectLock(root).status, "absent");
    assert.ok(!existsSync(join(root, ".governance")));
    const release = acquireLock(root);
    try {
      const observation = inspectLock(root);
      assert.equal(observation.status, "live");
      assert.equal(observation.pid, process.pid);
      assert.ok(observation.createdAt !== null);
      const bytes = readFileSync(observation.path);
      const mtime = statSync(observation.path).mtimeMs;
      assert.deepEqual(inspectLock(root), observation);
      assert.deepEqual(readFileSync(observation.path), bytes);
      assert.equal(statSync(observation.path).mtimeMs, mtime);
    } finally {
      release();
    }
    const dead = spawnSync(process.execPath, ["-e", ""]);
    const path = join(root, ".governance", "lock");
    for (const [content, status] of [
      [`pid=${dead.pid}\ncreated_at=retained\n`, "dead"],
      ["partial lock\ncreated_at=retained\n", "unreadable"],
    ]) {
      writeFileSync(path, content);
      const before = statSync(path).mtimeMs;
      const observed = inspectLock(root);
      assert.equal(observed.status, status);
      assert.equal(observed.createdAt, "retained");
      assert.equal(readFileSync(path, "utf8"), content);
      assert.equal(statSync(path).mtimeMs, before);
    }
    unlinkSync(path);
    assert.equal(inspectLock(root).status, "absent");
    mkdirSync(path);
    assert.equal(inspectLock(root).status, "unreadable");
    assert.ok(statSync(path).isDirectory());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("lock inspection treats EPERM as live and a disappearing lock as absent", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bw-lock-"));
  mkdirSync(join(root, ".governance"));
  const path = join(root, ".governance", "lock");
  writeFileSync(path, `pid=${process.pid}\n`);
  try {
    const kill = t.mock.method(process, "kill", () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    assert.equal(inspectLock(root).status, "live");
    kill.mock.restore();
    const original = fs.readFileSync;
    const read = t.mock.method(fs, "readFileSync", (...args: Parameters<typeof fs.readFileSync>) => {
      unlinkSync(path);
      return original(...args);
    });
    syncBuiltinESMExports();
    try {
      assert.equal(inspectLock(root).status, "absent");
    } finally {
      read.mock.restore();
      syncBuiltinESMExports();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
