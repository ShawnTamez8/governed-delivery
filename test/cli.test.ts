import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { acquireLock } from "../src/lock.ts";
import { openStore } from "../src/store.ts";

// Absolute path: the CLI is spawned from temp directories, so relative
// paths would resolve against the wrong cwd. Migrations anchor themselves
// to the module location, which is what makes this safe.
const CLI = resolve(process.cwd(), "src", "cli.ts");

function runCli(cwd: string, ...argv: string[]) {
  return spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: "utf8" });
}

function tempCwd(): string {
  return mkdtempSync(join(tmpdir(), "bw-cli-"));
}

test("migrate creates .governance/state.db and exits 0", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "migrate");
    assert.equal(r.status, 0);
    assert.ok(existsSync(join(cwd, ".governance", "state.db")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("new-run, stage-add, stage-complete, and verify-audit walk a chain end to end", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = newRun.stdout.trim();

    const s0 = runCli(cwd, "stage-add", "--run", runId, "--kind", "spec");
    assert.equal(s0.status, 0, s0.stderr);
    const s1 = runCli(cwd, "stage-add", "--run", runId, "--kind", "spec_review", "--input", s0.stdout.trim());
    assert.equal(s1.status, 0, s1.stderr);

    const done = runCli(cwd, "stage-complete", "--id", s1.stdout.trim(), "--output", "content:abc", "--gate-result", "pass");
    assert.equal(done.status, 0, done.stderr);

    // The walk must have written one audit event per mutation, so the
    // verified chain is not the empty chain.
    const store = openStore(cwd);
    const auditRows = store.query("SELECT * FROM audit");
    store.close();
    assert.equal(auditRows.length, 4);

    const verify = runCli(cwd, "verify-audit");
    assert.equal(verify.status, 0);
    assert.equal(verify.stdout.trim(), "chain valid");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("verify-audit reports chain valid on an empty database", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "verify-audit");
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), "chain valid");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a second invocation fails fast while the lock is held", () => {
  const cwd = tempCwd();
  const release = acquireLock(cwd);
  try {
    const r = runCli(cwd, "migrate");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /another invocation \(pid \d+, held since .+\) holds the lock/);
  } finally {
    release();
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an invalid change-kind names the allowed values and exits 2", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "new-run", "--project", "p", "--feature", "f", "--slug", "s", "--change-kind", "nonsense");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /invalid change_kind nonsense: allowed values are feature, defect_fix/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("an unknown command prints usage and exits 2", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "frobnicate");
    assert.equal(r.status, 2);
    // stderr may carry the node:sqlite ExperimentalWarning before the usage
    // text; match anywhere in the output rather than anchoring to its start.
    assert.match(r.stderr, /usage: bw <command>/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("stage-complete without --gate-result fails closed with exit 2", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "stage-complete", "--id", "1", "--output", "content:x");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --gate-result/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a missing flag value is reported instead of consuming the next flag", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "stage-complete", "--id", "1", "--output", "--gate-result", "block");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --output/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("completing a nonexistent stage names the stage", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "stage-complete", "--id", "9999", "--output", "content:x", "--gate-result", "pass");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /stage 9999 does not exist/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a non-decimal id is refused naming the cause", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "stage-complete", "--id", "0x2", "--output", "x", "--gate-result", "pass");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--id must be a non-negative integer, got 0x2/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dispatch with a nonexistent stage fails before any probe or spawn", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(
      cwd,
      "dispatch",
      "--stage",
      "9999",
      "--agent",
      "a",
      "--role",
      "author",
      "--model",
      "m",
      "--prompt-file",
      "never-read.txt"
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /stage 9999 does not exist/);
    // Raw retention is the first act after any spawn, so an absent raw
    // directory proves no invocation ran — the stage check fired first.
    assert.ok(
      !existsSync(join(cwd, ".governance", "raw")),
      "no raw output may exist when the stage check refused the dispatch"
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dispatch with an unreadable prompt file exits 2 naming the option", () => {
  const cwd = tempCwd();
  try {
    // A real stage must exist so the stage check passes and the prompt-file
    // read is what fails.
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f", "--slug", "s", "--change-kind", "feature");
    const stage = runCli(cwd, "stage-add", "--run", newRun.stdout.trim(), "--kind", "spec");
    const r = runCli(
      cwd,
      "dispatch",
      "--stage",
      stage.stdout.trim(),
      "--agent",
      "a",
      "--role",
      "author",
      "--model",
      "m",
      "--prompt-file",
      "missing.txt"
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read prompt file missing\.txt/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dispatch with a missing --role value exits 2 naming the option", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "dispatch", "--stage", "1", "--agent", "a", "--role", "--model", "m", "--prompt-file", "f");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --role/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
