import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os, { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { appendAudit } from "../src/audit.ts";
import { approvalPayload } from "../src/approval.ts";
import { approveRun, buildBinding } from "../src/approval-stage.ts";
import { canonicalJson, sha256Hex } from "../src/canonical.ts";
import type { CodeReviewRecord } from "../src/code-review.ts";
import { acquireLock, inspectLock } from "../src/lock.ts";
import { profilePath, stateDbPath } from "../src/paths.ts";
import { freezeProfile, loadProfile, type Profile } from "../src/profile.ts";
import { openStore, type AgentRunRow, type Store } from "../src/store.ts";
import { advanceRun } from "../src/run-command.ts";
import { readRunSnapshot } from "../src/operator-state.ts";
import type { OperatorResult, RunCommandResult } from "../src/operator-output.ts";
import { validateSpecDoc } from "../src/spec-doc.ts";

const SPEC_FIXTURE = resolve("test", "fixtures", "harness", "emit-spec-stage.mjs");
const JOURNEY_FIXTURE = resolve("test", "fixtures", "harness", "emit-cli-run.mjs");

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

interface Fixture {
  root: string;
  store: Store;
  runId: number;
  profile: Profile;
}

async function withRun(fn: (fixture: Fixture) => Promise<void>, command = [process.execPath, SPEC_FIXTURE]): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-guided-run-"));
  let store: Store | null = null;
  const originalKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    const absentKey = join(tmpdir(), `${basename(root)}-absent-approval.pub`);
    assert.equal(existsSync(absentKey), false);
    process.env.BW_APPROVAL_PUBLIC_KEY = absentKey;
    git(root, "init", "-q");
    writeFileSync(join(root, ".gitignore"), ".governance/\n");
    writeFileSync(join(root, "base.txt"), "worktree-base-marker\n");
    writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: node\n    command: ["node", "--version"]\n');
    const feature = join(root, "docs", "features", "demo");
    mkdirSync(feature, { recursive: true });
    writeFileSync(join(feature, "design.md"), "# design\nDeliver the declared artifact.\n");
    git(root, "add", "-A");
    git(root, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
    store = openStore(root);
    const run = store.insertRun("local", "f-1", "demo", "feature");
    appendAudit(store, { runId: run.id, stageId: null, actor: "system", actorType: "cli", action: "run.create", summary: "fixture intake" });
    freezeProfile(root, run.id, git(root, "rev-parse", "HEAD"), "m", {
      commands: [{ name: "node", command: ["node", "--version"] }],
    });
    const { profile } = loadProfile(root, run.id);
    profile.executor.command = command;
    profile.executor.probe = [process.execPath, "--version"];
    const serialized = canonicalJson(profile);
    writeFileSync(profilePath(root, run.id), serialized);
    store.setProfileRef(run.id, sha256Hex(serialized));
    appendAudit(store, { runId: run.id, stageId: null, actor: "system", actorType: "cli", action: "profile.freeze", summary: `froze ${sha256Hex(serialized)}` });
    await fn({ root, store, runId: run.id, profile });
  } finally {
    store?.close();
    if (originalKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = originalKey;
    rmSync(root, { recursive: true, force: true });
  }
}

function capture(onWrite?: (text: string) => void) {
  let text = "";
  const stderr = new Writable({
    write(chunk, _encoding, done) {
      const part = chunk.toString();
      text += part;
      onWrite?.(part);
      done();
    },
  });
  return { stderr, text: () => text };
}

function data(result: OperatorResult): RunCommandResult {
  assert.equal(result.command, "run");
  assert.ok(result.result && typeof result.result === "object");
  return result.result as RunCommandResult;
}

function approveFixture(store: Store, root: string, runId: number, expiresAt?: string) {
  const pause = readRunSnapshot(store, root, runId).snapshot;
  const request = pause.operatorActions.find((action) => action.kind === "approval_request");
  assert.ok(request?.eligible);
  const expires = expiresAt ?? request.args[request.args.indexOf("--expires") + 1]!;
  const bound = buildBinding(store, root, runId, expires);
  assert.ok(bound.ok, bound.ok ? undefined : bound.reason);
  const spec = validateSpecDoc(readFileSync(bound.specPath, "utf8"));
  assert.ok(spec.ok, spec.ok ? undefined : spec.reason);
  const keys = generateKeyPairSync("ed25519");
  const keyDirectory = mkdtempSync(join(tmpdir(), "bw-guided-keys-"));
  const originalKey = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    const publicPath = join(keyDirectory, "fixture-public.pem");
    writeFileSync(publicPath, keys.publicKey.export({ type: "spki", format: "pem" }));
    process.env.BW_APPROVAL_PUBLIC_KEY = publicPath;
    const approval = approveRun(store, root, {
      runId, expiresAt: expires,
      signature: sign(null, Buffer.from(approvalPayload(bound.binding), "utf8"), keys.privateKey).toString("base64"),
    });
    assert.ok(approval.ok, approval.ok ? undefined : approval.reason);
  } finally {
    if (originalKey === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = originalKey;
    rmSync(keyDirectory, { recursive: true, force: true });
  }
  return { spec: spec.value, expiresAt: expires };
}

function durable(store: Store, runId: number) {
  return {
    run: store.getRun(runId),
    stages: store.getStageChain(runId),
    agents: store.query("SELECT a.* FROM agent_run a JOIN stage s ON s.id = a.stage_id WHERE s.run_id = ?", [runId]),
    audit: store.getAuditEvents(runId),
  };
}

function files(root: string): [string, string][] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry): [string, string] => {
      const path = join(entry.parentPath, entry.name);
      return [path, sha256Hex(readFileSync(path))];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

test("direct run fixtures never consult the operator's default approval key", async (t) => {
  t.mock.method(os, "homedir", () => { throw new Error("fixture consulted the operator's home directory"); });
  syncBuiltinESMExports();
  try {
    await withRun(async ({ profile }) => assert.equal(profile.approvalSigner, null));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("guided preview requires invocation consent without writing, opening a lock, or spending", async (t) => {
  for (const json of [false, true]) {
    await t.test(json ? "JSON with a TTY still requires --yes" : "redirected stdin never prompts", () => withRun(async ({ root, store, runId, profile }) => {
      const input = Object.assign(new PassThrough(), { isTTY: json });
      const output = capture();
      const rows = durable(store, runId);
      const bytes = readFileSync(stateDbPath(root));
      const result = await advanceRun(root, runId, { json, input, stderr: output.stderr });
      assert.equal(result.outcome, "consent_required");
      assert.equal(result.errorCode, "consent_required");
      assert.deepEqual(data(result).execution, {
        consent: "required", groupsAttempted: [], groupsCompleted: [], remainingGroups: ["spec"],
        startedAt: null, endedAt: null, elapsedMs: null,
      });
      assert.deepEqual(durable(store, runId), rows);
      assert.deepEqual(readFileSync(stateDbPath(root)), bytes);
      assert.equal(inspectLock(root).status, "absent");
      assert.match(output.text(), /Consent covers EVERY listed group/);
      assert.match(output.text(), /no intermediate voluntary stop control or hard monetary cap/);
      assert.ok(output.text().includes(JSON.stringify(profile.modelMap)));
      const ceiling = 2 + profile.policy.specReviewRounds * (profile.policy.panelSizeMax + 1);
      assert.ok(output.text().includes(`spec=${ceiling}; total ${ceiling}`));
      assert.doesNotMatch(output.text(), /Type yes|group spec start/);
      input.destroy();
    }));
  }
});

test("TTY decline, EOF, and cancellation keep consent separate from execution and release input listeners", async (t) => {
  for (const choice of ["no", "EOF", "SIGINT"]) {
    await t.test(choice, () => withRun(async ({ root, store, runId }) => {
      const input = Object.assign(new PassThrough(), { isTTY: true });
      const listeners = process.listenerCount("SIGINT");
      const before = durable(store, runId);
      let asked = false;
      const output = capture((text) => {
        if (!text.includes("Type yes")) return;
        asked = true;
        assert.equal(inspectLock(root).status, "absent");
        queueMicrotask(() => {
          if (choice === "SIGINT") process.emit("SIGINT");
          else input.end(choice === "EOF" ? undefined : "no\n");
        });
      });
      const result = await advanceRun(root, runId, { input, stderr: output.stderr });
      assert.equal(asked, true);
      assert.equal(result.outcome, "consent_required");
      assert.equal(data(result).execution.consent, "declined");
      assert.deepEqual(data(result).execution.groupsAttempted, []);
      assert.deepEqual(durable(store, runId), before);
      assert.equal(process.listenerCount("SIGINT"), listeners);
      assert.equal(inspectLock(root).status, "absent");
      input.destroy();
    }));
  }
});

test("consent rechecks exact schema, observed boundary, profile, age, and writer ownership", async (t) => {
  for (const change of ["schema", "audit", "profile", "age", "writer"]) {
    await t.test(change, () => withRun(async ({ root, store, runId, profile }) => {
      const input = Object.assign(new PassThrough(), { isTTY: true });
      const lock: { release: (() => void) | null } = { release: null };
      const output = capture((text) => {
        if (!text.includes("Type yes")) return;
        assert.equal(inspectLock(root).status, "absent", "no lock while waiting for consent");
        assert.deepEqual(store.getStageChain(runId), []);
        if (change === "schema") store.exec("PRAGMA user_version = 0");
        if (change === "audit") appendAudit(store, { runId, stageId: null, actor: "operator", actorType: "human", action: "fixture.observation", summary: "changed while consent was pending" });
        if (change === "profile") {
          profile.modelMap.spec = "changed-model";
          const bytes = canonicalJson(profile);
          writeFileSync(profilePath(root, runId), bytes);
          store.setProfileRef(runId, sha256Hex(bytes));
        }
        if (change === "age") store.exec(`UPDATE run SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ${runId}`);
        if (change === "writer") lock.release = acquireLock(root);
        queueMicrotask(() => input.end("yes\n"));
      });
      try {
        const result = await advanceRun(root, runId, { input, stderr: output.stderr });
        assert.equal(result.outcome, "refused");
        assert.equal(result.errorCode, change === "schema" ? "schema_unsupported"
          : change === "writer" ? "writer_contention" : "observation_changed");
        assert.equal(data(result).execution.consent, "granted");
        assert.deepEqual(data(result).execution.groupsAttempted, []);
        assert.equal(data(result).execution.startedAt, null);
        assert.deepEqual(store.getStageChain(runId), []);
        if (change === "schema") assert.equal(store.query<{ user_version: number }>("PRAGMA user_version")[0]!.user_version, 0, "consent did not apply migrations");
        assert.equal(inspectLock(root).status, change === "writer" ? "live" : "absent");
      } finally {
        lock.release?.();
        input.destroy();
      }
    }));
  }
});

test("one affirmative answer runs the real document group, then returns an unsigned approval pause", () => withRun(async ({ root, store, runId }) => {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  let prompts = 0;
  const output = capture((text) => {
    if (text.includes("Type yes")) {
      prompts++;
      assert.equal(inspectLock(root).status, "absent");
      queueMicrotask(() => input.end("YeS\n"));
    }
  });
  const frozen = readFileSync(profilePath(root, runId));
  const result = await advanceRun(root, runId, { input, stderr: output.stderr });
  assert.equal(result.outcome, "awaiting_approval", result.reason ?? "");
  assert.equal(prompts, 1);
  assert.deepEqual(data(result).execution.groupsAttempted, ["spec"]);
  assert.deepEqual(data(result).execution.groupsCompleted, ["spec"]);
  assert.deepEqual(data(result).execution.remainingGroups, []);
  assert.equal(data(result).execution.consent, "granted");
  assert.ok(data(result).execution.startedAt);
  assert.ok(data(result).execution.endedAt);
  assert.ok(data(result).execution.elapsedMs! >= 0);
  assert.equal(store.getApproval(runId), undefined);
  assert.equal(store.getStageChain(runId).some((stage) => stage.kind === "awaiting_approval"), false);
  assert.equal(inspectLock(root).status, "absent");
  assert.match(output.text(), /group spec start/);
  assert.match(output.text(), /group spec end; passed boundary recorded/);
  assert.doesNotMatch(output.text(), /spec_review start|proposedContentChanges/);
  assert.deepEqual(readFileSync(profilePath(root, runId)), frozen);
  const before = durable(store, runId);
  const repeatOutput = capture();
  const repeat = await advanceRun(root, runId, { json: true, stderr: repeatOutput.stderr });
  assert.equal(repeat.outcome, "awaiting_approval", repeat.reason ?? "");
  assert.equal(data(repeat).execution.consent, "not_needed");
  assert.deepEqual(data(repeat).execution.groupsAttempted, []);
  assert.deepEqual(durable(store, runId), before);
  assert.equal(repeatOutput.text(), "");
  input.destroy();
}));

test("a core dispatch failure preserves its recorded block and never retries the failed group", () => withRun(async ({ root, store, runId }) => {
  const output = capture();
  const result = await advanceRun(root, runId, { yes: true, json: true, stderr: output.stderr });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.errorCode, "policy_block");
  const failure = store.getAuditEvents(runId).find((event) => event.action === "agent.dispatch.failed");
  assert.ok(failure);
  assert.equal(result.reason, failure.summary, "the original durable core refusal is not replaced by stderr or a generic runner error");
  assert.match(result.reason!, /exited with code 23/);
  assert.equal(data(result).snapshot!.run.status, store.getRun(runId)!.status);
  assert.deepEqual(data(result).execution.groupsAttempted, ["spec"]);
  assert.deepEqual(data(result).execution.groupsCompleted, []);
  assert.deepEqual(data(result).execution.remainingGroups, ["spec"]);
  assert.equal((output.text().match(/group spec start/g) ?? []).length, 1);
  const before = durable(store, runId);
  const again = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(again.outcome, "blocked");
  assert.equal(data(again).execution.consent, "not_needed");
  assert.deepEqual(data(again).execution.groupsAttempted, []);
  assert.deepEqual(durable(store, runId), before);
  assert.equal(inspectLock(root).status, "absent");
}, [process.execPath, "-e", "process.stderr.write('fixture-dispatch-failure'); process.exit(23)", "--"]));

test("an unrecorded core refusal stays failed, not a fabricated persisted block", () => withRun(async ({ root, store, runId }) => {
  const before = durable(store, runId);
  const output = capture((text) => {
    if (text.includes("group spec start")) rmSync(join(root, "docs", "features", "demo", "design.md"));
  });
  const result = await advanceRun(root, runId, { yes: true, stderr: output.stderr });
  assert.equal(result.outcome, "failed");
  assert.equal(result.errorCode, "execution_failed");
  assert.match(result.reason!, /cannot read design document .*ENOENT/);
  assert.deepEqual(data(result).execution.groupsAttempted, ["spec"]);
  assert.deepEqual(data(result).execution.groupsCompleted, []);
  assert.equal(data(result).snapshot!.run.status, before.run!.status);
  assert.deepEqual(durable(store, runId), before);
  assert.equal(inspectLock(root).status, "absent");
}));

test("a progress sink failure before the call does not count an attempted group", () => withRun(async ({ root, store, runId }) => {
  const before = durable(store, runId);
  const output = capture((text) => {
    if (text.includes("group spec start")) throw new Error("fixture progress sink failed");
  });
  const result = await advanceRun(root, runId, { yes: true, stderr: output.stderr });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "fixture progress sink failed");
  assert.deepEqual(data(result).execution.groupsAttempted, []);
  assert.deepEqual(durable(store, runId), before);
  assert.equal(inspectLock(root).status, "absent");
}));

test("yielding async execution emits the 15-second elapsed observation and clears its heartbeat", { timeout: 30_000 }, () => withRun(async ({ root, runId }) => {
  const output = capture();
  const result = await advanceRun(root, runId, { yes: true, stderr: output.stderr });
  assert.equal(result.outcome, "blocked");
  assert.match(output.text(), /group spec elapsed \d+ ms \(observation, not live agent telemetry\)/);
  assert.ok(output.text().indexOf("group spec start") < output.text().indexOf("group spec elapsed"));
  assert.ok(output.text().indexOf("group spec elapsed") < output.text().indexOf("group spec end"));
  assert.equal(inspectLock(root).status, "absent");
}, [process.execPath, "-e", "setTimeout(() => process.exit(23), 16_100)", "--"]));

test("unknown and missing run state remain named refusals with a null snapshot", async () => {
  const root = mkdtempSync(join(tmpdir(), "bw-guided-absent-"));
  try {
    const absent = await advanceRun(root, 0, { yes: true, stderr: capture().stderr });
    assert.equal(absent.errorCode, "state_missing");
    assert.equal(absent.outcome, "refused");
    assert.equal(data(absent).snapshot, null);
    assert.equal(existsSync(join(root, ".governance")), false);
    openStore(root).close();
    const missing = await advanceRun(root, 0, { yes: true, stderr: capture().stderr });
    assert.equal(missing.errorCode, "run_missing");
    assert.equal(data(missing).snapshot, null);
    assert.deepEqual(data(missing).execution.groupsAttempted, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one frozen executor advances the real chain across separate approval and never replays completion", () => withRun(async ({ root, store, runId, profile }) => {
  const frozen = readFileSync(profilePath(root, runId));
  const first = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(first.outcome, "awaiting_approval", first.reason ?? "");
  assert.deepEqual(data(first).execution.groupsCompleted, ["spec"]);
  assert.equal(store.getApproval(runId), undefined);
  const { spec } = approveFixture(store, root, runId);
  const notConsented = await advanceRun(root, runId, { json: true, stderr: capture().stderr });
  assert.equal(notConsented.outcome, "consent_required", notConsented.reason ?? "");
  const output = capture();
  const completed = await advanceRun(root, runId, { yes: true, json: true, stderr: output.stderr });
  assert.equal(completed.outcome, "completed", completed.reason ?? "");
  const snapshot = data(completed).snapshot!;
  const architecture = readFileSync(resolve("ARCHITECTURE.md"), "utf8").replace(/\r\n/g, "\n");
  const sequenceText = /## 5\. Stage sequence\n[\s\S]*?```\n([\s\S]*?)\n```/.exec(architecture)?.[1];
  assert.ok(sequenceText);
  const sequence = sequenceText.split(/\s*->\s*/).map((kind) => kind.trim());
  assert.equal(sequence.at(-1), snapshot.run.status);
  assert.deepEqual(store.getStageChain(runId).map((stage) => stage.kind), sequence.slice(0, -1));
  const groups = sequence.filter((kind) => !["spec", "spec_review", "awaiting_approval", "plan_review", "completed"].includes(kind));
  assert.deepEqual(data(completed).execution.groupsAttempted, groups);
  assert.deepEqual(data(completed).execution.groupsCompleted, groups);
  assert.deepEqual(data(completed).execution.remainingGroups, []);
  assert.deepEqual([...snapshot.delivery.declaredPaths].sort(), [...spec.declaredArtifacts].sort());
  assert.deepEqual([...snapshot.delivery.deliveredPaths].sort(), [...spec.declaredArtifacts].sort());
  assert.deepEqual([...snapshot.delivery.changedPaths].sort(), [...spec.declaredArtifacts].sort());
  assert.deepEqual(snapshot.delivery.missingPaths, []);
  assert.equal(snapshot.delivery.deliveredCommit, git(snapshot.delivery.worktreePath!, "rev-parse", "HEAD"));
  assert.equal(snapshot.delivery.branch, git(snapshot.delivery.worktreePath!, "symbolic-ref", "--short", "HEAD"));
  assert.ok(output.text().includes(JSON.stringify(profile.modelMap)));
  assert.match(output.text(), /group delivery_check start/);
  assert.match(output.text(), /group delivery_check end; passed boundary recorded/);
  assert.doesNotMatch(output.text(), /group delivery_check elapsed/);
  assert.deepEqual(readFileSync(profilePath(root, runId)), frozen);
  assert.equal(inspectLock(root).status, "absent");
  const before = durable(store, runId);
  const inventory = files(root);
  const repeat = await advanceRun(root, runId, { json: true, stderr: capture().stderr });
  assert.equal(repeat.outcome, "completed", repeat.reason ?? "");
  assert.equal(data(repeat).execution.consent, "not_needed");
  assert.deepEqual(data(repeat).execution.groupsAttempted, []);
  assert.deepEqual(durable(store, runId), before);
  assert.deepEqual(files(root), inventory);
}, [process.execPath, JOURNEY_FIXTURE, "--implementation-mode", "ok", "--code-review-mode", "ok"]));

test("Task 8 guided review respects frozen panels, remediation, and final severity without an outer retry", async (t) => {
  for (const mode of ["high", "low", "high-then-clean"]) {
    await t.test(mode, () => withRun(async ({ root, store, runId, profile }) => {
      const frozen = readFileSync(profilePath(root, runId));
      const pause = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
      assert.equal(pause.outcome, "awaiting_approval", pause.reason ?? "");
      approveFixture(store, root, runId);
      const output = capture();
      const result = await advanceRun(root, runId, { yes: true, stderr: output.stderr });
      const stage = store.getStageChain(runId).find((stage) => stage.kind === "code_review");
      assert.ok(stage?.output_ref, result.reason ?? "");
      const record = JSON.parse(readFileSync(resolve(root, stage.output_ref), "utf8")) as CodeReviewRecord;
      assert.ok(record.rounds.length > 0 && record.rounds.length <= profile.policy.codeReviewMaxRounds);
      const final = record.rounds.at(-1)!;
      const block = final.findings.some((finding) => finding.reports.some((report) =>
        profile.policy.severities.indexOf(report.severity) >= profile.policy.severities.indexOf(profile.policy.codeReviewBlockingSeverity)));
      assert.equal(result.outcome, block ? "blocked" : "completed", result.reason ?? "");
      const remediations = record.rounds.filter((round) => round.remediation !== null);
      assert.equal(remediations.length, record.rounds.length - 1);
      assert.equal(final.remediation, null, "the final panel never receives an unreviewed patch");
      assert.notEqual(record.initialVerifiedCommit, record.finalVerifiedCommit, "these fixture modes exercise a genuine remediation commit");
      const agents = store.query<AgentRunRow>("SELECT * FROM agent_run WHERE stage_id = ? ORDER BY id", [stage.id]);
      assert.equal(agents.filter((agent) => agent.role === "reviewer").length,
        profile.policy.codeReviewPanelSize * record.rounds.length);
      assert.equal(agents.filter((agent) => agent.role === "author").length, remediations.length);
      assert.equal(data(result).execution.groupsAttempted.filter((group) => group === "code_review").length, 1);
      assert.equal((output.text().match(/group code_review start/g) ?? []).length, 1);
      const snapshot = data(result).snapshot!;
      const findings = snapshot.evidence.findings.filter((finding) => finding.stageId === stage.id);
      for (const finding of findings) {
        assert.equal(finding.finalPanelBlocking, finding.round === final.round ? block : null);
        for (const report of finding.reports) {
          assert.equal(report.reviewerId, agents.find((agent) => agent.id === report.agentRunId)?.agent);
        }
      }
      const subtotal = snapshot.cost.byStage.find((cost) => cost.stageId === stage.id)!;
      assert.equal(subtotal.agentRows, agents.length);
      assert.equal(subtotal.knownUsd, agents.reduce((sum, agent) => sum + (agent.cost ?? 0), 0));
      if (!block) {
        assert.equal(snapshot.delivery.deliveredCommit, record.finalVerifiedCommit);
        assert.equal(snapshot.delivery.verification.length, 1 + remediations.length);
        assert.ok(snapshot.delivery.verification.every((verification) => verification.outcome === "pass"));
      }
      const before = durable(store, runId);
      const repeated = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
      assert.equal(repeated.outcome, result.outcome);
      assert.deepEqual(data(repeated).execution.groupsAttempted, []);
      assert.deepEqual(durable(store, runId), before);
      assert.deepEqual(readFileSync(profilePath(root, runId)), frozen);
      assert.equal(inspectLock(root).status, "absent");
    }, [process.execPath, JOURNEY_FIXTURE, "--implementation-mode", "ok", "--code-review-mode", mode]));
  }
});

test("Task 8 failed delivery finalization stops once and requires a separate invocation to continue", () => withRun(async ({ root, store, runId }) => {
  store.exec(`CREATE TRIGGER fail_guided_delivery BEFORE UPDATE OF status ON run
    WHEN NEW.id = ${runId} AND NEW.status = 'completed'
    BEGIN SELECT RAISE(ABORT, 'fixture delivery commit rejected'); END;`);
  const first = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(first.outcome, "awaiting_approval", first.reason ?? "");
  approveFixture(store, root, runId);
  let attempts = 0;
  const output = capture((text) => {
    if (text.includes("group delivery_check start") && ++attempts > 1) {
      throw new Error("fixture detected an automatic delivery retry");
    }
  });
  const failed = await advanceRun(root, runId, { yes: true, stderr: output.stderr });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.errorCode, "execution_failed");
  assert.equal(attempts, 1, "only one delivery attempt is permitted per invocation");
  assert.match(failed.reason!, /delivery finalization failed: fixture delivery commit rejected/);
  assert.deepEqual(data(failed).execution.remainingGroups, ["delivery_check"]);
  assert.equal(store.getRun(runId)!.status, "in_progress");
  assert.equal(store.getStageChain(runId).at(-1)!.kind, "code_review");
  assert.equal(store.getAuditEvents(runId).some((event) => event.action === "delivery.gate.pass"), false);
  assert.equal(inspectLock(root).status, "absent");
  store.exec("DROP TRIGGER fail_guided_delivery");
  const before = durable(store, runId);
  const noConsent = await advanceRun(root, runId, { json: true, stderr: capture().stderr });
  assert.equal(noConsent.outcome, "consent_required", noConsent.reason ?? "");
  assert.deepEqual(durable(store, runId), before);
  const continued = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(continued.outcome, "completed", continued.reason ?? "");
  assert.deepEqual(data(continued).execution.groupsAttempted, ["delivery_check"]);
  assert.deepEqual(data(continued).execution.groupsCompleted, ["delivery_check"]);
}, [process.execPath, JOURNEY_FIXTURE, "--implementation-mode", "ok", "--code-review-mode", "ok"]));

test("Task 8 a legitimately granted approval is not revoked when its acceptance expiry elapses", () => withRun(async ({ root, store, runId }) => {
  const first = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(first.outcome, "awaiting_approval", first.reason ?? "");
  const expiresAt = new Date(Date.now() + 5000).toISOString();
  approveFixture(store, root, runId, expiresAt);
  const approval = store.getApproval(runId);
  await delay(Math.max(0, Date.parse(expiresAt) - Date.now()) + 25);
  assert.ok(Date.now() > Date.parse(expiresAt));
  const result = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(result.outcome, "completed", result.reason ?? "");
  assert.deepEqual(store.getApproval(runId), approval);
}, [process.execPath, JOURNEY_FIXTURE, "--implementation-mode", "ok", "--code-review-mode", "ok"]));

test("Task 8 an aged guided run cannot create work even with explicit consent", () => withRun(async ({ root, store, runId, profile }) => {
  const created = new Date(Date.now() - (profile.policy.runDurationLimitSeconds + 1) * 1000).toISOString();
  store.exec(`UPDATE run SET created_at = '${created}' WHERE id = ${runId}`);
  const before = durable(store, runId);
  const result = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.deepEqual(durable(store, runId), before, "the aged boundary cannot create work");
  assert.equal(result.outcome, "refused");
  assert.equal(result.errorCode, "run_aged");
  assert.equal(data(result).execution.consent, "not_needed");
  assert.deepEqual(data(result).execution.groupsAttempted, []);
  assert.equal(inspectLock(root).status, "absent");
}));

test("Task 8 an ordinary implementation refusal stops the consented range before verification", () => withRun(async ({ root, store, runId }) => {
  const first = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(first.outcome, "awaiting_approval", first.reason ?? "");
  approveFixture(store, root, runId);
  const result = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(result.outcome, "blocked");
  assert.equal(result.errorCode, "policy_block");
  assert.match(result.reason!, /implementer returned status .*not proposed/);
  assert.deepEqual(data(result).execution.groupsAttempted, ["plan", "implementation"]);
  assert.deepEqual(data(result).execution.groupsCompleted, ["plan"]);
  assert.equal(store.getStageChain(runId).at(-1)!.kind, "implementation");
  assert.equal(store.getStageChain(runId).some((stage) => stage.kind === "verification"), false);
  const before = durable(store, runId);
  const repeated = await advanceRun(root, runId, { yes: true, stderr: capture().stderr });
  assert.equal(repeated.outcome, "blocked");
  assert.deepEqual(durable(store, runId), before);
}, [process.execPath, JOURNEY_FIXTURE, "--implementation-mode", "non-proposed", "--code-review-mode", "ok"]));
