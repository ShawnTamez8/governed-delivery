import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { acquireLock } from "../src/lock.ts";
import { deliveryEvidenceRef } from "../src/paths.ts";
import { openStore } from "../src/store.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { appendAudit } from "../src/audit.ts";
import { APPROVAL_DEFAULT_LIFETIME_SECONDS, buildPolicy, policyHash } from "../src/policy.ts";

// Absolute path: the CLI is spawned from temp directories, so relative
// paths would resolve against the wrong cwd. Migrations anchor themselves
// to the module location, which is what makes this safe.
const CLI = resolve(process.cwd(), "src", "cli.ts");

function runCli(cwd: string, ...argv: string[]) {
  return spawnSync(process.execPath, [CLI, ...argv], { cwd, encoding: "utf8" });
}

/** The seeded verification configuration every temp root is created with. */
const GOVERNED = `verify:
  - name: unit
    command: ["node", "--version"]
`;

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function commitAll(cwd: string, message: string): void {
  assert.equal(git(cwd, ["add", "-A"]).status, 0);
  const commit = git(cwd, [
    "-c",
    "user.email=t@example.invalid",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  assert.equal(commit.status, 0, `git commit failed: ${commit.stderr}`);
}

/**
 * A temp root `new-run` will accept: a git repository with a clean tree and a
 * committed `governed.yaml`. `.governance/` is gitignored here for the same
 * reason it is in the real repository — the CLI writes its state there, and
 * an untracked state directory would make the next `new-run` refuse a tree
 * the operator never dirtied.
 */
function tempCwd(): string {
  const cwd = mkdtempSync(join(tmpdir(), "bw-cli-"));
  assert.equal(git(cwd, ["init", "-q"]).status, 0);
  writeFileSync(join(cwd, ".gitignore"), ".governance/\n");
  writeFileSync(join(cwd, "governed.yaml"), GOVERNED);
  commitAll(cwd, "base");
  return cwd;
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
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
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
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    const stage = runCli(cwd, "stage-add", "--run", newRun.stdout.trim(), "--kind", "spec");
    const r = runCli(
      cwd,
      "dispatch",
      "--stage",
      stage.stdout.trim(),
      // A real frozen agent: the raw surface refuses an agent the run's
      // frozen profile does not declare, before the prompt-file read.
      "--agent",
      "spec-author",
      "--role",
      "author",
      // Must match the model frozen at run start, or the frozen-map check
      // refuses first and the prompt-file read is never reached.
      "--model",
      "test-model",
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
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
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
    // `new-run` refuses a repository it cannot resolve a starting commit in,
    // so a frozen profile always names one. The next test proves it is HEAD.
    assert.match(profile.startingCommit, /^[0-9a-f]{40}([0-9a-f]{24})?$/);
    // The verification commands are frozen from the committed configuration,
    // not re-read later (hard rule 6).
    assert.deepEqual(profile.verification, {
      commands: [{ name: "unit", command: ["node", "--version"] }],
    });
    assert.equal(profile.policyHash, policyHash(buildPolicy()));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

/**
 * The `new-run` preconditions all sit before the insert, and that is what
 * these assert: not merely that the command refuses, but that no run row
 * survives it. A row created and then refused is a run guaranteed to block
 * after every expensive stage has already spent.
 */
function assertNoRunRow(cwd: string, r: { status: number | null; stderr: string }, pattern: RegExp): void {
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, pattern);
  const store = openStore(cwd);
  const runs = store.query<{ id: number }>("SELECT * FROM run");
  store.close();
  assert.equal(runs.length, 0, `refused but left ${runs.length} run row(s)`);
}

const NEW_RUN_ARGS = [
  "new-run",
  "--project",
  "p",
  "--feature",
  "f-1",
  "--slug",
  "s",
  "--change-kind",
  "feature",
  "--model",
  "test-model",
];

test("new-run refuses a repository with no committed governed.yaml and creates no run", () => {
  const cwd = tempCwd();
  try {
    rmSync(join(cwd, "governed.yaml"));
    commitAll(cwd, "remove the configuration");
    assertNoRunRow(cwd, runCli(cwd, ...NEW_RUN_ARGS), /governed\.yaml is not committed at/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("new-run refuses a malformed governed.yaml and creates no run", () => {
  const cwd = tempCwd();
  try {
    writeFileSync(join(cwd, "governed.yaml"), "checks:\n  - name: a\n");
    commitAll(cwd, "break the configuration");
    assertNoRunRow(cwd, runCli(cwd, ...NEW_RUN_ARGS), /must be exactly "verify:"/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("new-run refuses a governed.yaml present on disk but never committed, and creates no run", () => {
  const cwd = tempCwd();
  try {
    // Removed from the commit, restored on disk, and the removal committed so
    // the tree is clean: the file exists, and the commit the run would branch
    // from does not contain it.
    rmSync(join(cwd, "governed.yaml"));
    commitAll(cwd, "remove the configuration");
    writeFileSync(join(cwd, "governed.yaml"), GOVERNED);
    writeFileSync(join(cwd, ".gitignore"), ".governance/\ngoverned.yaml\n");
    commitAll(cwd, "ignore the uncommitted configuration");
    assertNoRunRow(cwd, runCli(cwd, ...NEW_RUN_ARGS), /governed\.yaml is not committed at/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a default repository with no .gitignore can still create a run (hazard 11)", () => {
  // The shared helper writes a `.gitignore` covering `.governance/`, which is
  // the right thing for a repository to have and the wrong thing for this
  // assertion to assume. A fresh checkout that satisfies section 7 exactly —
  // clean tree, `governed.yaml` committed, nothing else — must be able to
  // start a run, because `bw new-run` creates `.governance/state.db` itself
  // and would otherwise report as dirty a tree only it had dirtied.
  const cwd = mkdtempSync(join(tmpdir(), "bw-cli-default-"));
  try {
    assert.equal(git(cwd, ["init", "-q"]).status, 0);
    writeFileSync(join(cwd, "governed.yaml"), GOVERNED);
    commitAll(cwd, "base");
    assert.equal(git(cwd, ["status", "--porcelain"]).stdout.trim(), "");
    const r = runCli(cwd, ...NEW_RUN_ARGS);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout.trim(), /^\d+$/);
    // The state directory it just created is present and untracked, which is
    // exactly the condition the check must not treat as operator dirt.
    assert.match(git(cwd, ["status", "--porcelain"]).stdout, /\.governance\//);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("new-run refuses a dirty working tree and creates no run", () => {
  const cwd = tempCwd();
  try {
    writeFileSync(join(cwd, "uncommitted.txt"), "work in progress\n");
    assertNoRunRow(cwd, runCli(cwd, ...NEW_RUN_ARGS), /the working tree is not clean/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("new-run outside a git repository refuses and creates no run", () => {
  const cwd = mkdtempSync(join(tmpdir(), "bw-cli-norepo-"));
  try {
    assertNoRunRow(cwd, runCli(cwd, ...NEW_RUN_ARGS), /not a git repository/);
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

    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
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

    const newRun = cli("new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());

    // Park the run where the gate expects it. `new-run` froze the repository's
    // real HEAD as the starting commit (the profile test above asserts that),
    // and the approval gate now reads that commit's tree to refuse declared
    // artifacts that name directories — so the frozen commit must stay real.
    const specPath = join(cwd, "docs", "features", "s", "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(
      specPath,
      "feature: Thing\nchange_kind: feature\n\n## Declared artifacts\n\n- src/thing.ts\n\n## Acceptance criteria\n\n- AC-001: It works.\n"
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
    const first = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    assert.equal(first.status, 0, first.stderr);
    const nextId = String(Number(first.stdout.trim()) + 1);
    mkdirSync(join(cwd, ".governance", "profiles"), { recursive: true });
    writeFileSync(join(cwd, ".governance", "profiles", nextId), "not a directory\n");

    const blocked = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s2", "--change-kind", "feature", "--model", "test-model");
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

test("new-run without --model exits 2 naming the option", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --model/);
    // The model is the only point at which the map can be frozen, so a run
    // must not exist at all without one.
    const store = openStore(cwd);
    try {
      assert.equal(store.query("SELECT * FROM run").length, 0, "no run row may be created");
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("spec --model disagreeing with the frozen model is refused before any dispatch", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "frozen-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const r = runCli(cwd, "spec", "--run", newRun.stdout.trim(), "--model", "some-other-model");
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /--model some-other-model does not match the model frozen at run start \(frozen-model\): config is frozen at run start/
    );
    const store = openStore(cwd);
    try {
      assert.equal(store.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dispatch --model disagreeing with the frozen model is refused before any spawn", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "frozen-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const stage = runCli(cwd, "stage-add", "--run", newRun.stdout.trim(), "--kind", "spec");
    assert.equal(stage.status, 0, stage.stderr);
    const r = runCli(
      cwd, "dispatch", "--stage", stage.stdout.trim(), "--agent", "a", "--role", "author",
      "--model", "some-other-model", "--prompt-file", "whatever.txt"
    );
    assert.equal(r.status, 1);
    assert.match(
      r.stderr,
      /--model some-other-model does not match the model frozen at run start \(frozen-model\): config is frozen at run start/
    );
    // The raw dispatch surface is the escape hatch beside `bw spec`; if hard
    // rule 6 did not hold here it would not hold at all.
    const store = openStore(cwd);
    try {
      assert.equal(store.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
    } finally {
      store.close();
    }
    assert.ok(!existsSync(join(cwd, ".governance", "raw")), "no raw output means no spawn");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("stage-add refuses a blocked run before inserting a stage", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    const runId = newRun.stdout.trim();
    const store = openStore(cwd);
    store.setRunStatus(Number(runId), "blocked");
    const before = store.query("SELECT * FROM stage").length;
    store.close();

    const r = runCli(cwd, "stage-add", "--run", runId, "--kind", "spec");
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`run ${runId} is blocked, not in_progress`));

    const after = openStore(cwd);
    try {
      assert.equal(after.query("SELECT * FROM stage").length, before, "no stage row may be created");
    } finally {
      after.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dispatch refuses a blocked run before any spawn", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    const runId = newRun.stdout.trim();
    const stage = runCli(cwd, "stage-add", "--run", runId, "--kind", "spec");
    assert.equal(stage.status, 0, stage.stderr);

    const store = openStore(cwd);
    store.setRunStatus(Number(runId), "blocked");
    store.close();

    const r = runCli(
      cwd, "dispatch", "--stage", stage.stdout.trim(), "--agent", "a", "--role", "author",
      "--model", "test-model", "--prompt-file", "whatever.txt"
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`run ${runId} is blocked, not in_progress`));

    // Real spend recorded against a run no stage could ever consume is the
    // failure this guard exists to prevent.
    const after = openStore(cwd);
    try {
      assert.equal(after.query("SELECT * FROM agent_run").length, 0, "nothing was spent");
    } finally {
      after.close();
    }
    assert.ok(!existsSync(join(cwd, ".governance", "raw")), "no raw output means no spawn");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plan with a nonexistent run exits 1 naming the run and spawns nothing", () => {
  const cwd = tempCwd();
  try {
    assert.equal(runCli(cwd, "migrate").status, 0);
    const r = runCli(cwd, "plan", "--run", "9999");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 9999 does not exist/);
    assert.ok(!existsSync(join(cwd, ".governance", "raw")), "no raw output means no spawn");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plan without --run is a usage error naming the option", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "plan");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --run/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("plan drives the real stage logic up to the dispatch boundary", () => {
  // `bw plan` hardcodes CLAUDE_CODE, as `bw spec` does, and there is no
  // executor injection seam — adding one would be a test-only abstraction
  // that hard rule 4 forbids. So the end-to-end stage behaviour is covered by
  // test/plan-stage.test.ts against a fixture executor, and this asserts the
  // command is wired to it: a run driven to a passed awaiting_approval whose
  // spec was edited afterwards must be refused by the deepest pre-dispatch
  // check, which only runPlanStage performs.
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "demo", "--change-kind", "feature", "--model", "test-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());

    const spec = "feature: demo\nchange_kind: feature\n\n## Declared artifacts\n\n- src/a1.ts\n\n## Acceptance criteria\n\n- AC-001: it works\n";
    const specPath = join(cwd, "docs", "features", "demo", "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(specPath, spec);

    const store = openStore(cwd);
    const specStage = store.insertStage(runId, "spec", null);
    store.completeStage(specStage.id, specPath, "pass");
    const reviewStage = store.insertStage(runId, "spec_review", specStage.id);
    store.completeStage(reviewStage.id, specPath, "pass");
    appendAudit(store, {
      runId,
      stageId: reviewStage.id,
      actor: "system",
      actorType: "cli",
      action: "spec.gate.pass",
      summary: `spec_review gate passed in round 1; specHash=${sha256Hex(normalizeText(spec))}; risk=low`,
    });
    const approvalStage = store.insertStage(runId, "awaiting_approval", reviewStage.id);
    store.completeStage(approvalStage.id, specPath, "pass");
    store.insertApproval({
      runId,
      featureId: "f-1",
      specHash: sha256Hex(normalizeText(spec)),
      startingCommit: "b".repeat(40),
      profileHash: store.getRun(runId)!.profile_ref!,
      risk: "low",
      scope: canonicalJson(["src/a1.ts"]),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      signature: "sig",
      signer: "signer",
    });
    store.close();

    // Edit the approved spec, then plan: the binding check must refuse.
    writeFileSync(specPath, `${spec}- AC-002: something nobody approved\n`);
    const r = runCli(cwd, "plan", "--run", String(runId));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /the spec has changed since review: gated [0-9a-f]{64}, on disk [0-9a-f]{64}/);
    assert.ok(!existsSync(join(cwd, ".governance", "raw")), "the refusal precedes any spawn");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("implement with a nonexistent run exits 1 naming the run and creates no worktree", () => {
  const cwd = tempCwd();
  try {
    assert.equal(runCli(cwd, "migrate").status, 0);
    const r = runCli(cwd, "implement", "--run", "9999");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 9999 does not exist/);
    assert.ok(!existsSync(join(cwd, ".governance", "worktrees")), "no worktree directory was created");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("implement without --run is a usage error naming the option", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "implement");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --run/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("implement drives the real stage logic up to the dispatch boundary", () => {
  // `bw implement` hardcodes CLAUDE_CODE, as `bw spec` and `bw plan` do, and
  // there is no executor injection seam — adding one would be a test-only
  // abstraction that hard rule 4 forbids. End-to-end stage behaviour is
  // covered by test/implementation-stage.test.ts against a fixture executor;
  // this asserts the command is wired to it: a run driven to a passed
  // plan_review whose plan was edited afterwards must be refused by the
  // deepest pre-dispatch check, which only runImplementationStage performs.
  // The walk deliberately stops there — a walk that reached the dispatch
  // would spend real money in the automated suite.
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "demo", "--change-kind", "feature", "--model", "test-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());

    const spec = "feature: demo\nchange_kind: feature\n\n## Declared artifacts\n\n- src/a1.ts\n\n## Acceptance criteria\n\n- AC-001: it works\n";
    const specPath = join(cwd, "docs", "features", "demo", "spec.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(specPath, spec);
    const specHash = sha256Hex(normalizeText(spec));

    const store = openStore(cwd);
    const specStage = store.insertStage(runId, "spec", null);
    store.completeStage(specStage.id, specPath, "pass");
    const reviewStage = store.insertStage(runId, "spec_review", specStage.id);
    store.completeStage(reviewStage.id, specPath, "pass");
    appendAudit(store, {
      runId,
      stageId: reviewStage.id,
      actor: "system",
      actorType: "cli",
      action: "spec.gate.pass",
      summary: `spec_review gate passed in round 1; specHash=${specHash}; risk=low`,
    });
    const approvalStage = store.insertStage(runId, "awaiting_approval", reviewStage.id);
    store.completeStage(approvalStage.id, specPath, "pass");
    store.insertApproval({
      runId,
      featureId: "f-1",
      specHash,
      startingCommit: "b".repeat(40),
      profileHash: store.getRun(runId)!.profile_ref!,
      risk: "low",
      scope: canonicalJson(["src/a1.ts"]),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      signature: "sig",
      signer: "signer",
    });

    const planPath = join(cwd, "docs", "features", "demo", "plan.md");
    const plan = `feature: demo\nplan_for: ${specHash}\n\n## Tasks\n\n- Build it\n\n## Coverage\n\n- AC-001 -> src/a1.ts\n`;
    mkdirSync(dirname(planPath), { recursive: true });
    writeFileSync(planPath, plan);
    const planStage = store.insertStage(runId, "plan", approvalStage.id);
    store.completeStage(planStage.id, planPath, "pass");
    const planReviewStage = store.insertStage(runId, "plan_review", planStage.id);
    store.completeStage(planReviewStage.id, planPath, "pass");
    appendAudit(store, {
      runId,
      stageId: planReviewStage.id,
      actor: "system",
      actorType: "cli",
      action: "plan.gate.pass",
      summary: `plan_review gate passed in round 1; planHash=${sha256Hex(normalizeText(plan))}; planFor=${specHash}; risk=low`,
    });
    store.close();

    // Edit the gated plan, then implement: the binding check must refuse.
    writeFileSync(planPath, `${plan}- and something nobody approved\n`);
    const r = runCli(cwd, "implement", "--run", String(runId));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /the plan has changed since review: gated [0-9a-f]{64}, on disk [0-9a-f]{64}/);
    assert.ok(!existsSync(join(cwd, ".governance", "worktrees")), "no worktree directory was created");
    const after = openStore(cwd);
    try {
      const spent = after.query<{ n: number }>(
        "SELECT COUNT(*) AS n FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
        [runId]
      )[0].n;
      assert.equal(spent, 0, "the refusal precedes any spawn");
    } finally {
      after.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a --model flag with no value is a usage error, not an empty model", () => {
  // parse() records a valueless flag as "" so it can be reported by name.
  // Reading it with args.get alone turned `bw spec --run 1 --model` into the
  // empty-string model, which then failed downstream as a mismatch against
  // the frozen value rather than as the typo it is.
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    for (const command of ["spec", "plan"]) {
      const r = runCli(cwd, command, "--run", newRun.stdout.trim(), "--model");
      assert.equal(r.status, 2, `${command} must exit 2, got: ${r.stderr}`);
      assert.match(r.stderr, /option --model was given without a value/);
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the approval default window comes from policy, not a literal", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const store = openStore(cwd);
    try {
      // The frozen profile records the value a run actually used, so an
      // operator can read back the window their approval was granted under.
      const profile = JSON.parse(
        readFileSync(join(cwd, ".governance", "profiles", newRun.stdout.trim(), "profile.json"), "utf8")
      ) as { policy: { approvalDefaultLifetimeSeconds: number; approvalMaxLifetimeSeconds: number } };
      assert.equal(profile.policy.approvalDefaultLifetimeSeconds, APPROVAL_DEFAULT_LIFETIME_SECONDS);
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("new-run refuses a model name the spawn cannot carry, before creating the run", () => {
  // A model name containing a space freezes fine and then corrupts the
  // child's argv on Windows, where the spawn builds its command line through
  // a shell. The refusal is a usage error: no run row may exist for a typo.
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "gpt-4 mini");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /invalid model name "gpt-4 mini"/);
    const store = openStore(cwd);
    try {
      assert.equal(store.query("SELECT * FROM run").length, 0, "no run row may be created");
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("stage-add refuses a valueless --input as a usage error", () => {
  // numericOptional must hold the same convention optional() holds: a flag
  // supplied with no value is the typo parse() records "" for, not a silent
  // null that chains the stage from nothing.
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "s", "--change-kind", "feature", "--model", "test-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const r = runCli(cwd, "stage-add", "--run", newRun.stdout.trim(), "--kind", "spec", "--input");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /option --input was given without a value/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("stage-add reports a usage error before run state, whatever the run is", () => {
  // The argument check precedes the store guard: a malformed command line is
  // a usage error even against a nonexistent run, so a script keying on exit
  // code 2 can classify it without querying run state.
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "stage-add", "--run", "9999", "--kind");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --kind/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("dispatch refuses a stage kind the frozen executor lacks capability for, before any spawn", () => {
  const cwd = tempCwd();
  try {
    assert.equal(runCli(cwd, "migrate").status, 0);
    const newRun = runCli(cwd, "new-run", "--project", "p", "--feature", "f-1", "--slug", "demo", "--change-kind", "feature", "--model", "test-model");
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());

    // Strip the implementation capability from the frozen profile and
    // re-point profile_ref at the new bytes, so the profile stays
    // self-consistent — the refusal under test is the capability, not a
    // tampered profile.
    const profilePath = join(cwd, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(profilePath, "utf8")) as {
      executor: { capabilities: string[] };
    };
    profile.executor.capabilities = profile.executor.capabilities.filter(
      (c) => c !== "implementation"
    );
    const serialized = canonicalJson(profile);
    writeFileSync(profilePath, serialized);

    const store = openStore(cwd);
    store.setProfileRef(runId, sha256Hex(serialized));
    const stageId = store.insertStage(runId, "implementation", null).id;
    store.close();

    const promptPath = join(cwd, "prompt.txt");
    writeFileSync(promptPath, "probe");
    const r = runCli(cwd, "dispatch", "--stage", String(stageId), "--agent", "implementer", "--role", "author", "--prompt-file", promptPath);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /lacks the required capability "implementation" for stage kind implementation/);
    assert.ok(!existsSync(join(cwd, ".governance", "raw")), "no spawn happened");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("verify without --run is a usage error", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "verify");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --run/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("verify with a nonexistent run exits 1 with the stage's refusal", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "verify", "--run", "9999");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 9999 does not exist/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the usage text distinguishes verify from verify-audit", () => {
  const cwd = tempCwd();
  try {
    // Two commands whose names share a prefix and do unrelated things: the
    // usage text is the only place an operator sees which is which.
    const r = runCli(cwd, "not-a-command");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /verify --run <id> +run the verification stage/);
    assert.match(r.stderr, /verify-audit +recompute the whole audit chain/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// --- deliver (step 8, the terminal stage) ------------------------------------

test("the usage text introduces deliver as the step-8 terminal check", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "not-a-command");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /deliver --run <id> +run the delivery check \(step 8\)/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("deliver without --run is a usage error", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "deliver");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required option --run/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("deliver with a nonexistent run exits 1 naming the run and writes nothing", () => {
  const cwd = tempCwd();
  try {
    const r = runCli(cwd, "deliver", "--run", "9999");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /run 9999 does not exist/);
    assert.ok(
      !existsSync(join(cwd, ".governance", "delivery")),
      "no delivery record directory was created"
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("deliver refuses a run whose last stage is not a passed verification", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, ...NEW_RUN_ARGS);
    assert.equal(newRun.status, 0, newRun.stderr);
    const r = runCli(cwd, "deliver", "--run", newRun.stdout.trim());
    assert.equal(r.status, 1);
    assert.match(r.stderr, /last stage is none, not a passed verification/);
    assert.ok(
      !existsSync(join(cwd, ".governance", "delivery")),
      "no delivery record directory was created"
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

/**
 * Drive a CLI-created run to a passed verification the way the shipped stages
 * would, crossing the dispatch boundary by hand. There is no executor
 * injection seam (hard rule 4), so the implementer dispatch cannot run here;
 * everything delivery reads is real: the spec document, the stage rows and
 * hash-chained gate events, a real worktree on the run branch at the frozen
 * starting commit with the declared files committed on it, the typed
 * implementation gate event — and the deterministic `bw verify` (frozen
 * commands only, nothing dispatched) writing the record delivery re-reads.
 */
function parkVerifiedRun(
  cwd: string,
  runId: number,
  scope: string[],
  commitFiles: string[] = scope
): {
  worktreePath: string;
  verifiedCommit: string;
  startingCommit: string;
  patchBase: string;
  specStageId: number;
} {
  const slug = "s";
  const spec = [
    "feature: thing",
    "change_kind: feature",
    "",
    "## Declared artifacts",
    "",
    ...scope.map((p) => `- ${p}`),
    "",
    "## Acceptance criteria",
    "",
    "- AC-001: the artifact is committed",
    "",
  ].join("\n");
  const specPath = join(cwd, "docs", "features", slug, "spec.md");
  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(specPath, spec);
  const specHash = sha256Hex(normalizeText(spec));

  const profile = JSON.parse(
    readFileSync(join(cwd, ".governance", "profiles", String(runId), "profile.json"), "utf8")
  ) as { startingCommit: string };
  const startingCommit = profile.startingCommit;

  const store = openStore(cwd);
  const specStage = store.insertStage(runId, "spec", null);
  store.completeStage(specStage.id, specPath, "pass");
  const reviewStage = store.insertStage(runId, "spec_review", specStage.id);
  store.completeStage(reviewStage.id, specPath, "pass");
  appendAudit(store, {
    runId,
    stageId: reviewStage.id,
    actor: "system",
    actorType: "cli",
    action: "spec.gate.pass",
    summary: `spec_review gate passed in round 1; specHash=${specHash}; risk=low`,
  });
  const approvalStage = store.insertStage(runId, "awaiting_approval", reviewStage.id);
  store.completeStage(approvalStage.id, specPath, "pass");
  store.insertApproval({
    runId,
    featureId: "f-1",
    specHash,
    startingCommit,
    profileHash: store.getRun(runId)!.profile_ref!,
    risk: "low",
    scope: canonicalJson(scope),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    signature: "sig",
    signer: "signer",
  });

  const worktreePath = join(cwd, ".governance", "worktrees", String(runId));
  const added = git(cwd, ["worktree", "add", "-q", worktreePath, "-b", `gov/${slug}/${runId}`, startingCommit]);
  assert.equal(added.status, 0, `git worktree add failed: ${added.stderr}`);

  // The run's own projections, committed before the implementer sees the
  // branch — the real chain's shape, where the recorded base is the starting
  // commit's child and delivery's strict-descent requirement is satisfiable.
  for (const file of [`docs/features/${slug}/spec.md`, `docs/features/${slug}/plan.md`]) {
    const target = join(worktreePath, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `projected ${file}\n`);
  }
  const addProjections = git(worktreePath, ["add", "--", `docs/features/${slug}/spec.md`, `docs/features/${slug}/plan.md`]);
  assert.equal(addProjections.status, 0, `git add failed: ${addProjections.stderr}`);
  const commitProjections = git(worktreePath, [
    "-c",
    "user.email=t@example.invalid",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "-m",
    `bw run ${runId}: project spec and plan`,
  ]);
  assert.equal(commitProjections.status, 0, `git commit failed: ${commitProjections.stderr}`);
  const patchBase = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();

  for (const file of commitFiles) {
    const target = join(worktreePath, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `content of ${file}\n`);
  }
  const addPatch = git(worktreePath, ["add", "--", ...commitFiles]);
  assert.equal(addPatch.status, 0, `git add failed: ${addPatch.stderr}`);
  const commitPatch = git(worktreePath, [
    "-c",
    "user.email=t@example.invalid",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "-m",
    `bw run ${runId}: apply patch`,
  ]);
  assert.equal(commitPatch.status, 0, `git commit failed: ${commitPatch.stderr}`);
  const verifiedCommit = git(worktreePath, ["rev-parse", "HEAD"]).stdout.trim();

  const implementationStage = store.insertStage(runId, "implementation", approvalStage.id);
  store.completeStage(implementationStage.id, worktreePath, "pass");
  appendAudit(store, {
    runId,
    stageId: implementationStage.id,
    actor: "system",
    actorType: "cli",
    action: "implementation.gate.pass",
    summary: `base=${patchBase}; head=${verifiedCommit}`,
  });
  store.close();

  const verify = runCli(cwd, "verify", "--run", String(runId));
  assert.equal(verify.status, 0, verify.stderr);
  return { worktreePath, verifiedCommit, startingCommit, patchBase, specStageId: specStage.id };
}

test("deliver prints the result reference, completes the run, and the terminal run refuses all work", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, ...NEW_RUN_ARGS);
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());
    const ctx = parkVerifiedRun(cwd, runId, ["src/a1.ts"]);

    const r = runCli(cwd, "deliver", "--run", String(runId));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), deliveryEvidenceRef(runId, "result.json"));
    const record = JSON.parse(
      readFileSync(join(cwd, ".governance", "delivery", String(runId), "result.json"), "utf8")
    );
    assert.deepEqual(record.declared, ["src/a1.ts"]);
    assert.deepEqual(record.delivered, ["src/a1.ts"]);
    assert.deepEqual(record.missing, []);
    assert.equal(record.outcome, "pass");
    assert.equal(record.patchBase, ctx.patchBase);
    assert.equal(record.verifiedCommit, ctx.verifiedCommit);
    assert.notEqual(ctx.patchBase, ctx.startingCommit, "the projections commit separates the base from the starting commit");
    assert.ok(existsSync(join(cwd, ".governance", "delivery", String(runId), "report.md")));

    const store = openStore(cwd);
    const chain = store.getStageChain(runId);
    assert.equal(store.getRun(runId)!.status, "completed");
    const deliveryStage = chain.find((s) => s.kind === "delivery_check")!;
    assert.equal(deliveryStage.status, "passed");
    store.close();

    const audit = runCli(cwd, "verify-audit");
    assert.equal(audit.status, 0, audit.stderr);
    assert.equal(audit.stdout.trim(), "chain valid");

    // Completed is terminal: every work surface refuses by name, and the
    // low-level commands refuse with the same guard the stages use.
    const again = runCli(cwd, "deliver", "--run", String(runId));
    assert.equal(again.status, 1);
    assert.match(again.stderr, /is completed, not in_progress/);

    const addStage = runCli(cwd, "stage-add", "--run", String(runId), "--kind", "spec");
    assert.equal(addStage.status, 1);
    assert.match(addStage.stderr, /is completed, not in_progress/);
    const afterAdd = openStore(cwd);
    try {
      assert.equal(
        afterAdd.query("SELECT * FROM stage").length,
        chain.length,
        "a refused stage-add must create no stage row"
      );
    } finally {
      afterAdd.close();
    }

    const dispatched = runCli(
      cwd,
      "dispatch",
      "--stage",
      String(ctx.specStageId),
      "--agent",
      "a",
      "--role",
      "author",
      "--model",
      "test-model",
      "--prompt-file",
      "whatever.txt"
    );
    assert.equal(dispatched.status, 1);
    assert.match(dispatched.stderr, /is completed, not in_progress/);
    const afterDispatch = openStore(cwd);
    try {
      assert.equal(
        afterDispatch.query<{ n: number }>("SELECT COUNT(*) AS n FROM agent_run")[0]!.n,
        0,
        "nothing was spent"
      );
    } finally {
      afterDispatch.close();
    }
    assert.ok(!existsSync(join(cwd, ".governance", "raw")), "no raw output means no spawn");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a declared artifact never committed blocks the stage and the run through the CLI", () => {
  const cwd = tempCwd();
  try {
    const newRun = runCli(cwd, ...NEW_RUN_ARGS);
    assert.equal(newRun.status, 0, newRun.stderr);
    const runId = Number(newRun.stdout.trim());
    parkVerifiedRun(cwd, runId, ["src/a1.ts", "test/a1.test.ts"], ["src/a1.ts"]);

    const r = runCli(cwd, "deliver", "--run", String(runId));
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "", "a blocked delivery prints nothing on stdout");
    assert.match(
      r.stderr,
      /delivery blocked: declared artifact\(s\) never appear in the committed changes: test\/a1\.test\.ts/
    );
    const record = JSON.parse(
      readFileSync(join(cwd, ".governance", "delivery", String(runId), "result.json"), "utf8")
    );
    assert.deepEqual(record.delivered, ["src/a1.ts"]);
    assert.deepEqual(record.missing, ["test/a1.test.ts"]);
    assert.equal(record.outcome, "block");

    const store = openStore(cwd);
    assert.equal(store.getRun(runId)!.status, "blocked");
    const deliveryStage = store.getStageChain(runId).find((s) => s.kind === "delivery_check")!;
    assert.equal(deliveryStage.status, "blocked");
    store.close();

    const audit = runCli(cwd, "verify-audit");
    assert.equal(audit.status, 0, audit.stderr);
    assert.equal(audit.stdout.trim(), "chain valid");

    const again = runCli(cwd, "deliver", "--run", String(runId));
    assert.equal(again.status, 1);
    assert.match(again.stderr, /is blocked, not in_progress/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// --- proposal-export (step 5b Task 8) ---------------------------------------

/**
 * A minimal proposal row, seeded directly through the store rather than a
 * real reconciliation — the two upstream routes and the deterministic dedup
 * key are already proven end to end against the real orchestrator in
 * `test/spec-stage.test.ts`; this file only needs one to exist so the export
 * command has something to materialize.
 */
function seedProposal(
  cwd: string,
  opts: { title?: string; route?: string } = {}
): { runId: number; stageId: number; proposalId: number } {
  const store = openStore(cwd);
  try {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const finding = store.upsertCanonicalFinding(stage.id, 1, "upstream-gap", "upstream:design:upstream-gap");
    const { proposal } = store.upsertProposal(
      {
        runId: run.id,
        stageId: stage.id,
        findingId: finding.id,
        title: opts.title ?? "Missing rate-limit decision",
        problem: "the design never says whether retries are rate-limited",
        whyUpstream: "the specification cannot invent a policy the design never stated",
        route: opts.route ?? "follow_up",
        evidenceRef: ".governance/proposals/1/finding-1.json",
      },
      `test-identity-${run.id}`
    );
    return { runId: run.id, stageId: stage.id, proposalId: proposal.id };
  } finally {
    store.close();
  }
}

test("proposal-export writes the derived file name and audits the export", () => {
  const cwd = tempCwd();
  try {
    const { proposalId } = seedProposal(cwd);
    const r = runCli(cwd, "proposal-export", "--proposal", String(proposalId));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "docs/proposals/missing-rate-limit-decision.md");
    const path = join(cwd, "docs", "proposals", "missing-rate-limit-decision.md");
    assert.ok(existsSync(path));
    const body = readFileSync(path, "utf8");
    assert.match(body, /^# Missing rate-limit decision/);
    assert.match(body, /\*\*Route:\*\* follow_up/);
    assert.match(body, /\*\*Source finding id\(s\):\*\*/);
    assert.match(body, /the design never says whether retries are rate-limited/);
    assert.match(body, /the specification cannot invent a policy the design never stated/);

    const store = openStore(cwd);
    try {
      const audited = store.query<{ summary: string; actor: string; actor_type: string }>(
        "SELECT summary, actor, actor_type FROM audit WHERE action = 'proposal.export'"
      );
      assert.equal(audited.length, 1);
      assert.match(audited[0].summary, /exported proposal \d+ to docs\/proposals\/missing-rate-limit-decision\.md/);
      // The human operator's own action (architecture section 14), not the run.
      assert.equal(audited[0].actor, "operator");
      assert.equal(audited[0].actor_type, "human");
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// The refusal is the exclusive write's own outcome (`flag: "wx"`), not a
// separate `existsSync` preflight a later write could contradict, so this
// exercises the write-time collision rather than only a check branch. Proven
// by breaking: under a default truncating write the untouched-content
// assertion below fails.
test("proposal-export refuses to overwrite an existing file", () => {
  const cwd = tempCwd();
  try {
    const { proposalId } = seedProposal(cwd);
    mkdirSync(join(cwd, "docs", "proposals"), { recursive: true });
    writeFileSync(join(cwd, "docs", "proposals", "missing-rate-limit-decision.md"), "# already here\n");
    const r = runCli(cwd, "proposal-export", "--proposal", String(proposalId));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to overwrite an existing proposal file: docs\/proposals\/missing-rate-limit-decision\.md/);
    assert.equal(
      readFileSync(join(cwd, "docs", "proposals", "missing-rate-limit-decision.md"), "utf8"),
      "# already here\n",
      "the pre-existing file must be untouched"
    );
    const store = openStore(cwd);
    try {
      assert.equal(store.query("SELECT * FROM audit WHERE action = 'proposal.export'").length, 0, "a refused export audits nothing");
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("proposal-export honours an explicit --name over the derived title", () => {
  const cwd = tempCwd();
  try {
    const { proposalId } = seedProposal(cwd);
    const r = runCli(cwd, "proposal-export", "--proposal", String(proposalId), "--name", "rate-limit-policy");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "docs/proposals/rate-limit-policy.md");
    assert.ok(existsSync(join(cwd, "docs", "proposals", "rate-limit-policy.md")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("proposal-export refuses a non-kebab-case --name", () => {
  const cwd = tempCwd();
  try {
    const { proposalId } = seedProposal(cwd);
    const r = runCli(cwd, "proposal-export", "--proposal", String(proposalId), "--name", "Not Kebab Case");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /invalid --name Not Kebab Case: must be lowercase kebab-case/);
    assert.ok(!existsSync(join(cwd, "docs", "proposals")));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("proposal-export renders the blocking_dependency route", () => {
  const cwd = tempCwd();
  try {
    const { proposalId } = seedProposal(cwd, { title: "Blocking gap", route: "blocking_dependency" });
    const r = runCli(cwd, "proposal-export", "--proposal", String(proposalId));
    assert.equal(r.status, 0, r.stderr);
    const body = readFileSync(join(cwd, "docs", "proposals", "blocking-gap.md"), "utf8");
    assert.match(body, /\*\*Route:\*\* blocking_dependency/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("proposal-export with a nonexistent proposal id exits 1 naming it", () => {
  const cwd = tempCwd();
  try {
    assert.equal(runCli(cwd, "migrate").status, 0);
    const r = runCli(cwd, "proposal-export", "--proposal", "9999");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /proposal 9999 does not exist/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
