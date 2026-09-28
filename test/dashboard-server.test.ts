import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { request } from "node:http";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadDashboardRepositories } from "../src/dashboard-config.ts";
import { startDashboardServer, waitForDashboardShutdown } from "../src/dashboard-server.ts";
import { parseArguments, UsageError } from "../src/cli-args.ts";
import { openStore } from "../src/store.ts";
import type { OperatorResult } from "../src/operator-output.ts";
import { readRunsResult, readStatusResult } from "../src/operator-read.ts";
import { normalizeText, sha256Hex } from "../src/canonical.ts";
import type { DashboardRepository } from "../src/dashboard-config.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import { approvalPayload } from "../src/approval.ts";
import { approveRun, buildBinding } from "../src/approval-stage.ts";
import { appendAudit, verifyAuditChain } from "../src/audit.ts";
import { acquireLock, inspectLock } from "../src/lock.ts";
import { freezeProfile } from "../src/profile.ts";
import type { VerificationConfig } from "../src/governed-config.ts";

const CLI = resolve("src", "cli.ts");

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "bw-dashboard-"));
}

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function repository(parent: string, name: string): string {
  const root = join(parent, name);
  mkdirSync(root);
  git(root, "init", "-q");
  writeFileSync(join(root, ".gitignore"), ".governance/\n");
  writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
  git(root, "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
  return root;
}

function filesystemInventory(root: string): unknown[] {
  return readdirSync(root).sort().map((name) => {
    const path = join(root, name);
    const stat = lstatSync(path);
    return stat.isDirectory()
      ? [name, filesystemInventory(path)]
      : [name, stat.size, sha256Hex(readFileSync(path))];
  });
}

function bearer(bootstrapUrl: string): string {
  const hash = new URL(bootstrapUrl).hash.slice(1);
  const token = new URLSearchParams(hash).get("token");
  assert.ok(token);
  return token;
}

function requestStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const outgoing = request(url, { headers }, (response) => {
      response.resume();
      response.once("end", () => resolveStatus(response.statusCode!));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

const APPROVAL_SPEC = `feature: Thing
change_kind: feature

## Declared artifacts

- src/thing.ts
- test/thing.test.ts

## Acceptance criteria

- AC-001: It does the thing.
`;

interface ApprovalFixture {
  root: string;
  runId: number;
  specPath: string;
  privateKey: string;
}

/**
 * A run parked where the approval gate expects it, built the way
 * `withFixture` in test/approval-stage.test.ts builds one: spec written,
 * spec, spec_review and spec_decision passed, the spec_decision.gate.pass
 * event the gate reads back, and a frozen profile. The key is generated and BW_APPROVAL_PUBLIC_KEY set
 * **before** `freezeProfile`, and the order is load-bearing: the freeze reads
 * that variable to bind the signer, so setting it afterwards freezes null and
 * every test would exercise only the unbound path. The caller restores the
 * variable.
 */
function approvalFixture(parent: string, name: string): ApprovalFixture {
  const root = repository(parent, name);
  const keyDir = join(parent, `${name}-keys`);
  mkdirSync(keyDir);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubPath = join(keyDir, "approval.pub");
  writeFileSync(pubPath, publicKey.export({ format: "pem", type: "spki" }) as string);
  process.env.BW_APPROVAL_PUBLIC_KEY = pubPath;
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
  const store = openStore(root);
  try {
    const run = store.insertRun("p", "f-1", "s", "feature");
    const specPath = join(root, "docs", "features", "s", "spec.md");
    mkdirSync(join(root, "docs", "features", "s"), { recursive: true });
    writeFileSync(specPath, APPROVAL_SPEC);
    const spec = store.insertStage(run.id, "spec", null);
    store.completeStage(spec.id, specPath, "pass");
    const review = store.insertStage(run.id, "spec_review", spec.id);
    store.completeStage(review.id, specPath, "pass");
    appendAudit(store, { runId: run.id, stageId: review.id, actor: "system", actorType: "cli", action: "spec.gate.pass",
      summary: `spec_review gate passed in round 1; specHash=${sha256Hex(normalizeText(APPROVAL_SPEC))}; risk=low` });
    const decision = store.insertStage(run.id, "spec_decision", review.id);
    store.completeStage(decision.id, specPath, "pass");
    appendAudit(store, { runId: run.id, stageId: decision.id, actor: "system", actorType: "cli", action: "spec_decision.gate.pass",
      summary: `spec_decision gate passed; specHash=${sha256Hex(normalizeText(APPROVAL_SPEC))}; risk=low; answers=0; folded=0` });
    const verification: VerificationConfig = { commands: [{ name: "unit", command: ["node", "--version"] }] };
    const frozen = freezeProfile(root, run.id, head, "test-model", verification);
    store.setProfileRef(run.id, frozen.hash);
    assert.ok(frozen.profile.approvalSigner, "the fixture must freeze a real fingerprint or this proves nothing");
    return { root, runId: run.id, specPath, privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) as string };
  } finally {
    store.close();
  }
}

function auditActions(root: string): string[] {
  const store = openStore(root, { readOnly: true });
  try {
    return store.query<{ action: string }>("SELECT action FROM audit ORDER BY id").map((row) => row.action);
  } finally {
    store.close();
  }
}

/** The approval row without the columns that differ by construction between two runs. */
function approvalFacts(root: string, runId: number) {
  const store = openStore(root, { readOnly: true });
  try {
    const approval = store.getApproval(runId);
    const chain = store.getStageChain(runId).map((stage) => [stage.kind, stage.status, stage.gate_result]);
    return approval === undefined ? { approval: null, chain }
      : { approval: { feature_id: approval.feature_id, spec_hash: approval.spec_hash, risk: approval.risk, scope: approval.scope }, chain };
  } finally {
    store.close();
  }
}

async function withApprovalServer(
  fn: (context: { parent: string; fixture: ApprovalFixture; url: string; headers: Record<string, string>; origin: string }) => Promise<void>,
): Promise<void> {
  const parent = workspace();
  const before = process.env.BW_APPROVAL_PUBLIC_KEY;
  try {
    const fixture = approvalFixture(parent, "target");
    const file = join(parent, "repositories.json");
    writeFileSync(file, JSON.stringify({ repositories: [fixture.root] }));
    const server = await startDashboardServer(loadDashboardRepositories(file, parent), parent, "C:\\BuildWorks\\src\\cli.ts");
    try {
      const headers = { Authorization: `Bearer ${bearer(server.bootstrapUrl)}` };
      const inventory = await (await fetch(`${server.origin}/api/repositories`, { headers })).json() as { repositories: { id: string }[] };
      const url = `${server.origin}/api/repositories/${inventory.repositories[0]!.id}/runs/${fixture.runId}/approval`;
      await fn({ parent, fixture, url, headers, origin: server.origin });
    } finally {
      await server.close();
    }
  } finally {
    if (before === undefined) delete process.env.BW_APPROVAL_PUBLIC_KEY;
    else process.env.BW_APPROVAL_PUBLIC_KEY = before;
    rmSync(parent, { recursive: true, force: true });
  }
}

interface ApprovalRequestBody {
  outcome: string;
  expiresAt: string;
  payload: string;
  specText: string;
  signer: { frozen: string | null; configured: string | null };
}

function post(url: string, headers: Record<string, string>, origin: string | null, body: string, contentType = "application/json") {
  return fetch(url, { method: "POST", body, headers: {
    ...headers, "Content-Type": contentType, ...(origin === null ? {} : { Origin: origin }),
  } });
}

test("the approval route serves the core's own payload and the reviewed spec without writing", async () => {
  await withApprovalServer(async ({ fixture, url, headers }) => {
    const before = filesystemInventory(fixture.root);
    const response = await fetch(url, { headers });
    assert.deepEqual(filesystemInventory(fixture.root), before, "reading the approval request writes nothing");
    assert.equal(response.status, 200);
    const body = await response.json() as ApprovalRequestBody;
    assert.equal(body.outcome, "ok");
    const store = openStore(fixture.root, { readOnly: true });
    try {
      const bound = buildBinding(store, fixture.root, fixture.runId, body.expiresAt);
      assert.ok(bound.ok, (bound as { reason?: string }).reason);
      assert.equal(body.payload, approvalPayload(bound.binding), "the payload is the core's canonical payload");
    } finally {
      store.close();
    }
    assert.equal(body.specText, readFileSync(fixture.specPath, "utf8"));
    assert.ok(body.signer.frozen !== null && body.signer.frozen === body.signer.configured);
  });
});

test("a browser-signed approval is recorded through the core, identically to bw approve", async () => {
  await withApprovalServer(async ({ parent, fixture, url, headers, origin }) => {
    const request = await (await fetch(url, { headers })).json() as ApprovalRequestBody;
    const signature = sign(null, Buffer.from(request.payload, "utf8"), fixture.privateKey).toString("base64");
    assert.equal(inspectLock(fixture.root).status, "absent");
    const response = await post(url, headers, origin, JSON.stringify({ expiresAt: request.expiresAt, signature }));
    const result = await response.json() as { outcome: string };
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.outcome, "approved");
    assert.ok(!JSON.stringify(result).includes(signature), "the response never echoes the signature");
    // The host released the repository lock it took.
    assert.equal(inspectLock(fixture.root).status, "absent");
    acquireLock(fixture.root)();

    const store = openStore(fixture.root, { readOnly: true });
    try {
      assert.equal(verifyAuditChain(store), null);
    } finally {
      store.close();
    }

    // Parity: a second run approved the way `bw approve` does it.
    const direct = approvalFixture(parent, "direct");
    const writer = openStore(direct.root);
    try {
      const bound = buildBinding(writer, direct.root, direct.runId, request.expiresAt);
      assert.ok(bound.ok, (bound as { reason?: string }).reason);
      const directSignature = sign(null, Buffer.from(approvalPayload(bound.binding), "utf8"), direct.privateKey).toString("base64");
      const approved = approveRun(writer, direct.root, { runId: direct.runId, expiresAt: request.expiresAt, signature: directSignature });
      assert.ok(approved.ok, (approved as { reason?: string }).reason);
    } finally {
      writer.close();
    }
    assert.deepEqual(auditActions(fixture.root), auditActions(direct.root), "both surfaces record the same audit trail");
    assert.deepEqual(approvalFacts(fixture.root, fixture.runId), approvalFacts(direct.root, direct.runId));
    assert.equal(approvalFacts(fixture.root, fixture.runId).chain.at(-1)?.[0], "awaiting_approval");
  });
});

test("the core's refusals reach the operator and write only the core's refusal event", async () => {
  await withApprovalServer(async ({ fixture, url, headers, origin }) => {
    const request = await (await fetch(url, { headers })).json() as ApprovalRequestBody;
    const other = generateKeyPairSync("ed25519").privateKey;
    const wrongKey = sign(null, Buffer.from(request.payload, "utf8"), other).toString("base64");
    const refused = await post(url, headers, origin, JSON.stringify({ expiresAt: request.expiresAt, signature: wrongKey }));
    assert.equal(refused.status, 422);
    assert.match((await refused.json() as { reason: string }).reason, /does not verify/);
    assert.equal(auditActions(fixture.root).filter((action) => action === "approval.refused").length, 1);
    assert.equal(approvalFacts(fixture.root, fixture.runId).approval, null);

    // A different expiry changes the payload, so the signature no longer verifies.
    const signature = sign(null, Buffer.from(request.payload, "utf8"), fixture.privateKey).toString("base64");
    const moved = new Date(Date.parse(request.expiresAt) - 60_000).toISOString();
    assert.equal((await post(url, headers, origin, JSON.stringify({ expiresAt: moved, signature }))).status, 422);
    assert.equal(approvalFacts(fixture.root, fixture.runId).approval, null);
  });
});

test("an approval while another writer holds the repository lock writes nothing", async () => {
  await withApprovalServer(async ({ fixture, url, headers, origin }) => {
    const request = await (await fetch(url, { headers })).json() as ApprovalRequestBody;
    const signature = sign(null, Buffer.from(request.payload, "utf8"), fixture.privateKey).toString("base64");
    const before = auditActions(fixture.root);
    const release = acquireLock(fixture.root);
    try {
      const busy = await post(url, headers, origin, JSON.stringify({ expiresAt: request.expiresAt, signature }));
      assert.equal(busy.status, 409);
      assert.equal((await busy.json() as { outcome: string }).outcome, "writer_busy");
    } finally {
      release();
    }
    assert.deepEqual(auditActions(fixture.root), before, "a refused lock appends no audit event");
    assert.equal(approvalFacts(fixture.root, fixture.runId).approval, null);
  });
});

test("the approval route refuses every transport shape but an authenticated same-origin JSON POST", async () => {
  await withApprovalServer(async ({ fixture, url, headers, origin }) => {
    const body = JSON.stringify({ expiresAt: "2026-01-01T00:00:00.000Z", signature: "x" });
    assert.equal((await post(url, headers, null, body)).status, 400, "no Origin");
    assert.equal((await post(url, headers, "http://example.invalid", body)).status, 400, "foreign Origin");
    assert.equal((await post(url, { Authorization: "Bearer wrong-token" }, origin, body)).status, 401);
    assert.equal((await post(url, headers, origin, body, "text/plain")).status, 415);
    assert.equal((await post(url, headers, origin, JSON.stringify({ expiresAt: "x", signature: "y".repeat(9000) }))).status, 413);
    assert.equal((await post(url, headers, origin, JSON.stringify({ signature: 1 }))).status, 400);
    assert.equal((await post(url, headers, origin, "not json")).status, 400);
    const put = await fetch(url, { method: "PUT", headers });
    assert.equal(put.status, 405);
    assert.equal(put.headers.get("allow"), "GET, POST");
    const status = await fetch(url.replace(/\/approval$/, ""), { method: "POST", headers: { ...headers, Origin: origin } });
    assert.equal(status.status, 405, "no other route accepts a write");
    assert.equal(status.headers.get("allow"), "GET");
    assert.equal(auditActions(fixture.root).includes("approval.refused"), false, "no transport refusal reaches the core");
  });
});

/**
 * A run paused at awaiting_decision: spec and spec_review passed and one
 * operator question per intent on the review's findings. Built with
 * `new-run`, so the profile is the real frozen one.
 */
function decisionFixture(parent: string, name: string): { root: string; runId: number; findings: number[] } {
  const root = repository(parent, name);
  const created = spawnSync(process.execPath, [CLI, "new-run", "--repo", root, "--project", "p", "--feature", "f-1",
    "--slug", "s", "--change-kind", "feature", "--model", "test-model"], { cwd: parent, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const runId = Number(created.stdout.trim());
  const store = openStore(root);
  try {
    const spec = store.insertStage(runId, "spec", null);
    store.completeStage(spec.id, "docs/features/s/spec.md", "pass");
    const review = store.insertStage(runId, "spec_review", spec.id);
    store.completeStage(review.id, "docs/features/s/spec.md", "pass");
    const findings = ["retention", "access"].map((intent) => {
      const finding = store.upsertCanonicalFinding(review.id, 1, intent, `upstream:design:${intent}`);
      store.insertDecisionQuestion({ findingId: finding.id, text: `Decide ${intent}?`,
        options: [{ label: "A", answer: `${intent} answer A` }, { label: "B", answer: `${intent} answer B` }],
        recommended: 1, why: "the design is silent" });
      return finding.id;
    });
    return { root, runId, findings };
  } finally {
    store.close();
  }
}

function decisionFacts(root: string, runId: number) {
  const store = openStore(root, { readOnly: true });
  try {
    const review = store.getStageChain(runId)[1]!;
    return {
      answers: store.getDecisionAnswers(review.id).map((answer) => [answer.action, answer.answer]),
      // Intake summaries carry per-repository hashes; the decision events are
      // the ones whose wording both surfaces must share.
      audit: store.getAuditEvents(runId).map((event) => [event.action, event.actor, event.actor_type,
        event.action.startsWith("decision.") ? event.summary : null]),
    };
  } finally {
    store.close();
  }
}

async function withDecisionServer(
  fn: (context: { parent: string; root: string; runId: number; findings: number[]; base: string;
    headers: Record<string, string>; origin: string }) => Promise<void>,
): Promise<void> {
  const parent = workspace();
  try {
    const fixture = decisionFixture(parent, "target");
    const file = join(parent, "repositories.json");
    writeFileSync(file, JSON.stringify({ repositories: [fixture.root] }));
    const server = await startDashboardServer(loadDashboardRepositories(file, parent), parent, "C:\\BuildWorks\\src\\cli.ts");
    try {
      const headers = { Authorization: `Bearer ${bearer(server.bootstrapUrl)}` };
      const inventory = await (await fetch(`${server.origin}/api/repositories`, { headers })).json() as { repositories: { id: string }[] };
      const base = `${server.origin}/api/repositories/${inventory.repositories[0]!.id}/runs/${fixture.runId}/decisions`;
      await fn({ parent, ...fixture, base, headers, origin: server.origin });
    } finally {
      await server.close();
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

test("a dashboard decision is recorded through answerQuestion, identically to bw decide", async () => {
  await withDecisionServer(async ({ parent, root, runId, findings, base, headers, origin }) => {
    const modified = await post(`${base}/${findings[0]}`, headers, origin,
      JSON.stringify({ action: "modify", answer: "Retain exports for ninety days." }));
    const modifiedBody = await modified.json() as { outcome: string; open: number };
    assert.equal(modified.status, 200, JSON.stringify(modifiedBody));
    assert.equal(modifiedBody.outcome, "answered");
    assert.equal(modifiedBody.open, 1);
    const approved = await post(`${base}/${findings[1]}`, headers, origin, JSON.stringify({ action: "approve" }));
    assert.equal(approved.status, 200);
    assert.equal(inspectLock(root).status, "absent");

    // Parity: the same two answers given through `bw decide`.
    const direct = decisionFixture(parent, "direct");
    const answerFile = join(parent, "answer.txt");
    writeFileSync(answerFile, "Retain exports for ninety days.");
    for (const args of [["--finding", String(direct.findings[0]), "--answer-file", answerFile],
      ["--finding", String(direct.findings[1]), "--approve"]]) {
      const decided = spawnSync(process.execPath, [CLI, "decide", "--repo", direct.root, "--run", String(direct.runId), ...args],
        { cwd: parent, encoding: "utf8" });
      assert.equal(decided.status, 0, decided.stderr);
    }
    assert.deepEqual(decisionFacts(root, runId), decisionFacts(direct.root, direct.runId),
      "both surfaces record the same answers and audit trail");
    assert.deepEqual(decisionFacts(root, runId).answers,
      [["modify", "Retain exports for ninety days."], ["approve", "access answer B"]]);
    const store = openStore(root, { readOnly: true });
    try {
      assert.equal(verifyAuditChain(store), null);
    } finally {
      store.close();
    }
  });
});

test("the decision route refuses every transport shape but an authenticated same-origin JSON POST", async () => {
  await withDecisionServer(async ({ root, runId, findings, base, headers, origin }) => {
    const url = `${base}/${findings[0]}`;
    const body = JSON.stringify({ action: "deny" });
    assert.equal((await post(url, headers, null, body)).status, 400, "no Origin");
    assert.equal((await post(url, headers, "http://example.invalid", body)).status, 400, "foreign Origin");
    assert.equal((await post(url, { Authorization: "Bearer wrong-token" }, origin, body)).status, 401);
    assert.equal((await post(url, headers, origin, body, "text/plain")).status, 415);
    assert.equal((await post(url, headers, origin,
      JSON.stringify({ action: "modify", answer: "\u0001".repeat(4100) }))).status, 413);
    for (const shape of [{ action: 1 }, { action: "deny", extra: true }, { action: "modify", answer: 7 }, [], null]) {
      assert.equal((await post(url, headers, origin, JSON.stringify(shape))).status, 400, JSON.stringify(shape));
    }
    assert.equal((await post(url, headers, origin, "not json")).status, 400);
    for (const method of ["GET", "PUT"]) {
      const refused = await fetch(url, { method, headers });
      assert.equal(refused.status, 405, method);
      assert.equal(refused.headers.get("allow"), "POST");
    }
    const before = decisionFacts(root, runId);
    assert.equal(before.answers.length, 0);
    assert.ok(!before.audit.some(([action]) => action === "decision.refused"), "no transport refusal reaches the core");

    // The core's own refusal: a modify with no text is refused and audited once.
    const empty = await post(url, headers, origin, JSON.stringify({ action: "modify" }));
    assert.equal(empty.status, 422);
    assert.equal(decisionFacts(root, runId).audit.filter(([action]) => action === "decision.refused").length, 1);

    const release = acquireLock(root);
    try {
      const busy = await post(url, headers, origin, body);
      assert.equal(busy.status, 409);
      assert.equal((await busy.json() as { outcome: string }).outcome, "writer_busy");
    } finally {
      release();
    }
    assert.equal(decisionFacts(root, runId).answers.length, 0, "a held lock writes no answer");
  });
});

test("dashboard repository files accept one leading BOM and reject every other shape", () => {
  const parent = workspace();
  try {
    const first = repository(parent, "first");
    const second = repository(parent, "second");
    const file = join(parent, "repositories.json");
    writeFileSync(file, `\uFEFF${JSON.stringify({ repositories: [first, second] })}`);
    assert.deepEqual(loadDashboardRepositories(file, parent).map((entry) => entry.path), [first, second]);
    const invalid: unknown[] = [
      "", "\uFEFF", "{", [], {}, { repositories: [] }, { repositories: "x" },
      { repositories: ["relative"] }, { repositories: [first, first] },
      { repositories: [first], extra: true }, { repositories: [1] },
    ];
    for (const value of invalid) {
      writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
      assert.throws(() => loadDashboardRepositories(file, parent), UsageError);
    }
    writeFileSync(file, `\uFEFF\uFEFF${JSON.stringify({ repositories: [first] })}`);
    assert.throws(() => loadDashboardRepositories(file, parent), /not valid JSON/);
    if (process.platform === "win32") {
      writeFileSync(file, JSON.stringify({ repositories: [first, `${first}\\`] }));
      assert.throws(() => loadDashboardRepositories(file, parent), /duplicate normalized path/);
      writeFileSync(file, JSON.stringify({ repositories: [first, first.toUpperCase()] }));
      assert.throws(() => loadDashboardRepositories(file, parent), /duplicate normalized path/);
    }
    writeFileSync(file, `\uFEFF\uFEFF${JSON.stringify({ repositories: [first] })}`);
    const refused = spawnSync(process.execPath, [CLI, "dashboard", "--repositories-file", file], {
      cwd: parent, encoding: "utf8",
    });
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /repositories file.*not valid JSON/);
    assert.equal(existsSync(join(first, ".governance")), false);
    assert.equal(existsSync(join(second, ".governance")), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard parsing rejects global target and JSON options without reading input", () => {
  assert.deepEqual(parseArguments(["dashboard", "--help"]).help, true);
  assert.throws(() => parseArguments(["dashboard"]), /--repositories-file/);
  assert.throws(() => parseArguments(["dashboard", "--repositories-file=x", "--json"]), /unknown option --json/);
  assert.throws(() => parseArguments(["dashboard", "--repositories-file=x", "--repo=y"]), /does not accept --repo/);
});

test("dashboard CLI prints one bootstrap URL, opens no state at startup, and follows platform SIGTERM behavior", async () => {
  const parent = workspace();
  try {
    const root = repository(parent, "target");
    const file = join(parent, "repositories.json");
    writeFileSync(file, JSON.stringify({ repositories: [root] }));
    const child = spawn(process.execPath, [CLI, "dashboard", "--repositories-file", file], {
      cwd: parent, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`dashboard did not start: ${stderr}`)), 10_000);
      child.stdout.on("data", () => {
        if (!stdout.includes("\n")) return;
        clearTimeout(timer);
        resolveReady();
      });
      child.once("exit", (code) => reject(new Error(`dashboard exited ${code}: ${stderr}`)));
    });
    assert.match(stdout, /^http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]+\r?\n$/);
    assert.equal(existsSync(join(root, ".governance")), false);
    assert.equal(child.kill("SIGTERM"), true);
    const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    if (process.platform === "win32") assert.equal(signal, "SIGTERM");
    else assert.equal(code, 0, `signal ${signal}: ${stderr}`);
    assert.equal(stderr, "");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard shutdown closes once and removes both signal listeners", async () => {
  const parent = workspace();
  const root = repository(parent, "target");
  const file = join(parent, "repositories.json");
  writeFileSync(file, JSON.stringify({ repositories: [root] }));
  const server = await startDashboardServer(loadDashboardRepositories(file, parent), parent);
  const signals = new EventEmitter();
  const shutdown = waitForDashboardShutdown(server, signals);
  assert.equal(signals.listenerCount("SIGINT"), 1);
  assert.equal(signals.listenerCount("SIGTERM"), 1);
  signals.emit("SIGTERM");
  signals.emit("SIGINT");
  await shutdown;
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  await assert.rejects(fetch(server.origin));
  rmSync(parent, { recursive: true, force: true });
});

test("dashboard server enforces its loopback transport and reuses complete read envelopes", async () => {
  const parent = workspace();
  const first = repository(parent, "first");
  const second = repository(parent, "second");
  const unavailable = join(parent, "unavailable");
  const store = openStore(first);
  const run = store.insertRun("project", "feature", "slug", "feature");
  store.close();
  const beforeFirst = JSON.stringify(readdirSync(first, { recursive: true }).sort());
  const beforeSecond = JSON.stringify(readdirSync(second, { recursive: true }).sort());
  const repositories = loadDashboardRepositories(
    (() => {
      const file = join(parent, "repositories.json");
      writeFileSync(file, JSON.stringify({ repositories: [first, second, unavailable] }));
      return file;
    })(),
    parent,
  );
  const server = await startDashboardServer(repositories, parent, "C:\\BuildWorks\\src\\cli.ts");
  try {
    assert.equal(server.host, "127.0.0.1");
    const token = bearer(server.bootstrapUrl);
    const headers = { Authorization: `Bearer ${token}` };
    const root = await fetch(server.origin);
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-security-policy")!, /default-src 'none'/);
    assert.equal(root.headers.get("cache-control"), "no-store");
    assert.equal(root.headers.get("x-frame-options"), "DENY");
    const unauthenticated = await fetch(`${server.origin}/api/repositories`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${server.origin}/api/repositories`, {
      headers: { Authorization: "Bearer wrong-token" },
    })).status, 401);
    assert.equal(await requestStatus(`${server.origin}/api/repositories`, {
      ...headers, Host: "example.invalid",
    }), 400);
    assert.equal((await fetch(`${server.origin}/api/repositories`, {
      headers: { ...headers, Origin: "http://example.invalid" },
    })).status, 400);
    assert.equal((await fetch(`${server.origin}/api/repositories`, { method: "POST", headers })).status, 405);
    assert.equal((await fetch(`${server.origin}/package.json`)).status, 404);
    assert.equal((await fetch(`${server.origin}/%2e%2e/package.json`)).status, 404);

    const inventoryResponse = await fetch(`${server.origin}/api/repositories`, { headers });
    assert.equal(inventoryResponse.status, 200);
    const inventory = await inventoryResponse.json() as {
      observedAt: string;
      cliPath: string;
      repositories: { id: string; path: string }[];
    };
    assert.ok(Number.isFinite(Date.parse(inventory.observedAt)));
    assert.equal(inventory.cliPath, "C:\\BuildWorks\\src\\cli.ts");
    assert.deepEqual(inventory.repositories.map((entry) => entry.path), [first, second, unavailable]);
    assert.ok(inventory.repositories.every((entry) => entry.id.length === 43));

    const firstId = inventory.repositories[0].id;
    const secondId = inventory.repositories[1].id;
    const unavailableId = inventory.repositories[2].id;
    let beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const listed = await fetch(`${server.origin}/api/repositories/${firstId}/runs?limit=1`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(listed.status, 200);
    const listing = await listed.json() as OperatorResult;
    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const expectedListing = readRunsResult(first, parent, 1);
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.deepEqual({ ...listing, observedAt: expectedListing.observedAt }, expectedListing);
    assert.deepEqual(Object.keys(listing).sort(),
      ["command", "outcome", "repository", "runId", "errorCode", "reason", "observedAt", "result"].sort());
    assert.equal(listing.command, "runs");
    assert.equal(listing.outcome, "ok");
    assert.equal(listing.errorCode, null);
    assert.deepEqual((listing.result as { runs: { id: number }[] }).runs.map((entry) => entry.id), [run.id]);

    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const status = await fetch(`${server.origin}/api/repositories/${firstId}/runs/${run.id}`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(status.status, 200);
    const snapshot = await status.json() as OperatorResult;
    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const expectedSnapshot = readStatusResult(first, parent, run.id);
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.deepEqual({ ...snapshot, observedAt: expectedSnapshot.observedAt }, expectedSnapshot);
    assert.equal(snapshot.command, "status");
    assert.equal(snapshot.outcome, "ok");
    assert.equal((snapshot.result as { run: { id: number } }).run.id, run.id);

    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const missing = await fetch(`${server.origin}/api/repositories/${secondId}/runs`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(missing.status, 200);
    const refusal = await missing.json() as OperatorResult;
    assert.equal(refusal.outcome, "state_missing");
    assert.equal(refusal.errorCode, "state_missing");
    assert.equal(refusal.result, null);
    assert.equal(existsSync(join(second, ".governance")), false);

    beforeRead = [filesystemInventory(first), filesystemInventory(second)];
    const invalid = await fetch(`${server.origin}/api/repositories/${unavailableId}/runs`, { headers });
    assert.deepEqual([filesystemInventory(first), filesystemInventory(second)], beforeRead);
    assert.equal(invalid.status, 200);
    const invalidTarget = await invalid.json() as OperatorResult;
    assert.equal(invalidTarget.errorCode, "target_unavailable");
    assert.equal(invalidTarget.repository, null);
    assert.ok(invalidTarget.reason?.includes(unavailable));

    assert.equal((await fetch(`${server.origin}/api/repositories/${firstId}/runs?limit=0`, { headers })).status, 400);
    assert.equal((await fetch(`${server.origin}/api/repositories/${firstId}/runs?limit=1&limit=2`, { headers })).status, 400);
    assert.equal((await fetch(`${server.origin}/api/repositories/unknown/runs`, { headers })).status, 404);
    assert.equal((await fetch(`${server.origin}/api/repositories/${firstId}/runs/not-a-run`, { headers })).status, 404);
    const script = await fetch(`${server.origin}/app.js`);
    const model = await fetch(`${server.origin}/dashboard-model.js`);
    const styles = await fetch(`${server.origin}/styles.css`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type")!, /^text\/javascript/);
    assert.equal(model.status, 200);
    assert.match(model.headers.get("content-type")!, /^text\/javascript/);
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get("content-type")!, /^text\/css/);
    // The allowlist is exact: a sibling module the shell never imports is not served.
    assert.equal((await fetch(`${server.origin}/dashboard/dashboard-model.js`)).status, 404);
    assert.equal((await fetch(`${server.origin}/dashboard-model.js.map`)).status, 404);
    assert.equal(JSON.stringify(readdirSync(first, { recursive: true }).sort()), beforeFirst);
    assert.equal(JSON.stringify(readdirSync(second, { recursive: true }).sort()), beforeSecond);
  } finally {
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("dashboard repository identifiers survive configured reordering", async () => {
  const parent = mkdtempSync(join(tmpdir(), "bw-dashboard-order-"));
  const first = repository(parent, "first");
  const second = repository(parent, "second");

  async function identifiers(repositories: DashboardRepository[]): Promise<Map<string, string>> {
    const server = await startDashboardServer(repositories, parent, "C:\\BuildWorks\\src\\cli.ts");
    try {
      const response = await fetch(`${server.origin}/api/repositories`, {
        headers: { authorization: `Bearer ${bearer(server.bootstrapUrl)}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as {
        repositories: Array<{ id: string; path: string }>;
      };
      return new Map(body.repositories.map((entry) => [entry.path, entry.id]));
    } finally {
      await server.close();
    }
  }

  try {
    const file = join(parent, "repositories.json");
    writeFileSync(file, JSON.stringify({ repositories: [first, second] }));
    const configured = loadDashboardRepositories(file, parent);
    const original = await identifiers(configured);
    const reordered = await identifiers([...configured].reverse());
    assert.deepEqual(reordered, original);
    if (process.platform === "win32") {
      writeFileSync(file, JSON.stringify({ repositories: [first.toUpperCase()] }));
      const recased = await identifiers(loadDashboardRepositories(file, parent));
      assert.equal([...recased.values()][0], original.get(first));
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
