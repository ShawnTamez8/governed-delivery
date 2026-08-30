import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { acquireLock } from "../src/lock.ts";
import { openStore } from "../src/store.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { appendAudit } from "../src/audit.ts";
import { buildPolicy, policyHash } from "../src/policy.ts";

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
    // verified chain is not the empty chain. Five, not four: new-run also
    // freezes the profile and audits `profile.freeze`.
    const store = openStore(cwd);
    const auditRows = store.query("SELECT * FROM audit");
    store.close();
    assert.equal(auditRows.length, 5);

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

test("spec with a nonexistent run exits 1 naming the run", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "spec", "--run", "9999", "--model", "m");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 9999 does not exist/);
    assert.ok(!existsSync(join(cwd, ".governance", "raw")), "no spawn happened");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("spec with a missing --run exits 2 naming the option", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "spec", "--model", "m");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --run/);
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

test("new-run freezes a profile and records its hash on the run", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());

    const profilePath = join(cwd, ".governance", "profiles", String(runId), "profile.json");
    assert.ok(existsSync(profilePath), "new-run must freeze a profile");
    const raw = readFileSync(profilePath, "utf8");

    const store = openStore(cwd);
    const run = store.query<{ profile_ref: string | null }>("SELECT * FROM run WHERE id = ?", [runId])[0]!;
    store.close();
    // The run row carries the hash of exactly the bytes on disk.
    assert.equal(run.profile_ref, sha256Hex(raw));

    const profile = JSON.parse(raw);
    assert.equal(profile.runId, runId);
    assert.equal(profile.systemName, "BuildWorks");
    // A temp directory is not a git repository, so there is no base commit.
    assert.equal(profile.startingCommit, null);
    assert.equal(profile.policyHash, policyHash(buildPolicy()));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("new-run records the git HEAD as the run's starting commit", () => {
  const cwd = tempCwd();
  try {
    // Asserted, not assumed: a missing git must fail this test loudly rather
    // than let it pass having proved nothing.
    const init = spawnSync("git", ["init", "-q"], { cwd, encoding: "utf8" });
    assert.equal(init.status, 0, `git init failed: ${init.stderr ?? init.error?.message}`);
    const commit = spawnSync(
      "git",
      ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base"],
      { cwd, encoding: "utf8" }
    );
    assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
    assert.equal(head.status, 0);
    const expected = head.stdout.trim();
    assert.match(expected, /^[0-9a-f]{40}$/);

    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = newRun.stdout.trim();
    const profile = JSON.parse(
      readFileSync(join(cwd, ".governance", "profiles", runId, "profile.json"), "utf8")
    );
    assert.equal(profile.startingCommit, expected);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("approval-request with a nonexistent run exits 1 naming the run", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "approval-request", "--run", "9999");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 9999 does not exist/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("approve without --signature exits 2 naming the option", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "approve", "--run", "1", "--expires", "2099-01-01T00:00:00.000Z");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --signature/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("request, sign, and approve walk end to end through the CLI", () => {
  const cwd = tempCwd();
  const keyDir = mkdtempSync(join(tmpdir(), "bw-cli-key-"));
  try {
    // Keys are generated outside the repository by the operator's own tool,
    // spawned from the repository root so its containment guard applies.
    const keygen = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "sign-approval.mjs"), "keygen", "--out", keyDir],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    assert.equal(keygen.status, 0, keygen.stderr);
    const env = { ...process.env, BW_APPROVAL_PUBLIC_KEY: join(keyDir, "approval.pub") };
    const cli = (...argv: string[]) =>
      spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: "utf8", env });

    const newRun = cli("new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());

    // Park the run where the gate expects it, and give it a starting commit
    // the same way a real run would have one.
    const specPath = join(cwd, "docs", "features", "s", "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(
      specPath,
      "feature: Thing\nchange_kind: feature\n\n## Declared artifacts\n\n- src/thing.ts\n\n## Acceptance criteria\n\n- It works.\n"
    );
    const store = openStore(cwd);
    const specStage = store.insertStage(runId, "spec", null);
    store.completeStage(specStage.id, specPath, "pass");
    const reviewStage = store.insertStage(runId, "spec_review", specStage.id);
    store.completeStage(reviewStage.id, specPath, "pass");
    // What the real spec_review gate records; the approval gate reads it back
    // to refuse binding a spec no panel gated.
    appendAudit(store, {
      runId,
      stageId: reviewStage.id,
      actor: "system",
      actorType: "cli",
      action: "spec.gate.pass",
      summary: `spec_review gate passed in round 1; specHash=${sha256Hex(
        normalizeText(readFileSync(specPath, "utf8"))
      )}; risk=low`,
    });
    const profilePath = join(cwd, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(profilePath, "utf8"));
    profile.startingCommit = "b".repeat(40);
    const serialized = canonicalJson(profile);
    writeFileSync(profilePath, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));
    store.close();

    // One expiry value, passed explicitly to both commands: never scraped
    // from stderr, which also carries the node:sqlite ExperimentalWarning.
    const expires = new Date(Date.now() + 3600_000).toISOString();
    const request = cli("approval-request", "--run", String(runId), "--expires", expires);
    assert.equal(request.status, 0, request.stderr);
    // The raw bytes, unstripped: stripping here would hide exactly the
    // defect where the printed payload is not the signed payload.
    const payload = request.stdout;
    assert.match(payload, /^buildworks-approval\n/);
    assert.ok(!payload.endsWith("\n"), "the printed payload must be the signed payload, byte for byte");

    const signed = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", "sign-approval.mjs"), "sign", "--key", join(keyDir, "approval.key")],
      { cwd: process.cwd(), encoding: "utf8", input: payload }
    );
    assert.equal(signed.status, 0, signed.stderr);

    const approve = cli("approve", "--run", String(runId), "--expires", expires, "--signature", signed.stdout.trim());
    assert.equal(approve.status, 0, approve.stderr);
    assert.match(approve.stdout.trim(), /^\d+$/);

    // A second attempt is refused: one authorization covers the run.
    const again = cli("approve", "--run", String(runId), "--expires", expires, "--signature", signed.stdout.trim());
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already has an awaiting_approval stage with status passed/);

    const verify = cli("verify-audit");
    assert.equal(verify.status, 0);
    assert.equal(verify.stdout.trim(), "chain valid");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(keyDir, { recursive: true, force: true });
  }
});

test("approval-request with an empty --expires value is a usage error, not a silent default", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "approval-request", "--run", "1", "--expires");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --expires/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a profile-freeze failure blocks the run and names it on stderr", () => {
  const cwd = tempCwd();
  try {
    // Create one run so the next id is known, then occupy that run's profile
    // directory with a *file* — `mkdirSync` then throws and the freeze fails
    // for a real filesystem reason rather than a stubbed one.
    const first = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature");
    assert.equal(first.status, 0, first.stderr);
    const nextId = String(Number(first.stdout.trim()) + 1);
    mkdirSync(join(cwd, ".governance", "profiles"), { recursive: true });
    writeFileSync(join(cwd, ".governance", "profiles", nextId), "not a directory\n");

    const blocked = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s2", "--change-kind", "feature");
    assert.equal(blocked.status, 1, "a freeze failure is an error, not a usage error");
    assert.equal(blocked.stdout.trim(), "", "no run id is printed, so the id must come from stderr");
    assert.match(
      blocked.stderr,
      new RegExp(`run ${nextId} created but blocked: profile freeze failed`),
      "the operator must be able to find the wedged run"
    );

    const store = openStore(cwd);
    try {
      const run = store.getRun(Number(nextId));
      assert.ok(run, "the run row survives the freeze failure");
      assert.equal(run.status, "blocked");
      const failed = store.query<{ summary: string }>(
        "SELECT summary FROM audit WHERE run_id = ? AND action = 'profile.freeze.failed'",
        [Number(nextId)]
      );
      assert.equal(failed.length, 1, "the failure is audited");
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
