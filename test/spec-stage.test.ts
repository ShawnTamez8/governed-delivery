import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { runSpecStage } from "../src/spec-stage.ts";
import { REMEDIATION_ROUNDS } from "../src/policy.ts";
import type { ExecutorDefinition } from "../src/executor.ts";
import { normalizeText, sha256Hex } from "../src/canonical.ts";

const FIXTURE = join(process.cwd(), "test", "fixtures", "harness", "emit-spec-stage.mjs");

function fixtureExecutor(scriptPath: string): ExecutorDefinition {
  return {
    id: "test-spec-stage",
    command: ["node", scriptPath],
    probe: ["node", "--version"],
    capabilities: [],
    telemetry: { perInvocationModel: true, effectiveModel: true, tokenUsage: true, sessionCost: true },
    sandbox: {
      allowedPaths: [],
      deniedPaths: [],
      commandAllowlist: [],
      idleTimeoutSeconds: 30,
      absoluteTimeoutSeconds: 120,
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP"],
      network: "inherit",
    },
  };
}

/**
 * The fixture source, normalized at the read boundary.
 *
 * These tests build scratch executors by substituting into the fixture's own
 * text, several of them across multi-line targets. Under a CRLF working tree
 * — which `core.autocrlf=true` produces on any fresh checkout — those
 * substitutions silently no-match and the test then fails on a wrong-stage
 * outcome that never mentions line endings. That is hazard 12: two checkouts
 * of the same commit behaving as different products, diagnosed as a
 * regression. `normalizeText` is the same tolerance the spec hash and the
 * signing tool already apply; the fixture source is one more reader of bytes
 * that crossed a checkout.
 */
function fixtureSource(): string {
  return normalizeText(readFileSync(FIXTURE, "utf8"));
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
}

function withRun(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-spec-stage-"));
  const store = openStore(root);
  const run = store.insertRun("p", "f-1", "demo", "feature");
  mkdirSync(join(root, "docs", "features", "demo"), { recursive: true });
  writeFileSync(join(root, "docs", "features", "demo", "design.md"), "# design\n");
  return Promise.resolve(fn({ store, root, runId: run.id })).finally(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
}

function agentRunCounts(store: Store, runId: number): { author: number; reviewer: number } {
  const rows = store.query<{ stage_id: number; role: string }>(
    "SELECT ar.role FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
    [runId]
  );
  return {
    author: rows.filter((r) => r.role === "author").length,
    reviewer: rows.filter((r) => r.role === "reviewer").length,
  };
}

test("happy path with one revision round: two stage rows, gate passes in round 2", async () => {
  await withRun(async ({ store, root, runId }) => {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const chain = store.getStageChain(runId);
    assert.deepEqual(chain.map((s) => s.kind), ["spec", "spec_review"]);
    assert.equal(chain[1].input_stage_id, chain[0].id);
    assert.ok(chain.every((s) => s.status === "passed"));
    assert.ok(chain.every((s) => s.output_ref === result.specPath));
    const spec = readFileSync(result.specPath, "utf8");
    assert.ok(spec.includes("REVISED-spec"), "the revision was written");
    assert.equal(store.getRun(runId)!.status, "in_progress");
    const counts = agentRunCounts(store, runId);
    assert.equal(counts.author, 2);
    assert.equal(counts.reviewer, 4);
    const findings = store.getFindings(chain[1].id);
    assert.equal(findings.length, 2);
    const material = findings.find((f) => f.intent_key === "missing-traceability");
    assert.equal(material?.disposition, "resolved");
  });
});

test("blocked on budget exhaustion", async () => {
  await withRun(async ({ store, root, runId }) => {
    // Scratch fixture whose reviewer branch ignores REVISED-spec, so every
    // round reports the material finding.
    const scratch = join(root, "emit-spec-stage-always-finds.mjs");
    const source = fixtureSource().replace(
      "const findings = stdin.includes(\"REVISED-spec\")",
      "const findings = false && stdin.includes(\"REVISED-spec\")"
    );
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /material findings remain open after 3 rounds/);
    const chain = store.getStageChain(runId);
    assert.equal(chain[0].status, "passed");
    assert.equal(chain[1].status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
    assert.equal(agentRunCounts(store, runId).author, REMEDIATION_ROUNDS);
  });
});

test("dedup: two reviewers reporting the same identity produce one row", async () => {
  await withRun(async ({ store, root, runId }) => {
    // The unmodified fixture has both reviewers emit the same finding in
    // round 1; the UNIQUE index must collapse them to one row.
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, true);
    const reviewStage = store.getStageChain(runId)[1];
    const findings = store.getFindings(reviewStage.id);
    assert.equal(findings.filter((f) => f.intent_key === "missing-traceability").length, 1);
  });
});

test("an invalid author result aborts terminally and writes no spec", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-bogus.mjs");
    const source = fixtureSource().replace(
      '    status: "proposed",\n    agent: "spec-author",',
      '    status: "bogus",\n    agent: "spec-author",'
    );
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /spec author result refused: invalid AgentResult status bogus/);
    assert.ok(!existsSync(join(root, "docs", "features", "demo", "spec.md")), "no spec written");
    assert.equal(store.getStageChain(runId)[0].status, "blocked");
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a null finding entry aborts terminally naming the reviewer", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-null-finding.mjs");
    const source = fixtureSource().replace(
      '    : [\n        {\n          location: "## Acceptance criteria",',
      '    : [null, {\n          location: "## Acceptance criteria",'
    );
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /finding entry is not an object/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a reviewer returning blocked with empty findings cannot pass the gate by absence", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-blocked-reviewer.mjs");
    const source = fixtureSource().replace(
      '    status: "proposed",\n    agent: agentId,',
      '    status: "blocked",\n    agent: agentId,'
    );
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /returned status blocked, not proposed/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("an invalid intentKey aborts terminally naming the reviewer", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-bad-key.mjs");
    const source = fixtureSource().replace(
      'intentKey: "missing-traceability",',
      'intentKey: "Bad Key!",'
    );
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /is not lowercase kebab-case within 64 characters/);
  });
});

test("a spec whose change_kind contradicts the run aborts terminally", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-kind-mismatch.mjs");
    const source = fixtureSource().replace("change_kind: feature", "change_kind: defect_fix");
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /does not match run change_kind feature/);
    assert.equal(store.getRun(runId)!.status, "blocked");
  });
});

test("a high-risk spec convenes the full three-reviewer panel", async () => {
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-high-risk.mjs");
    const source = fixtureSource().replace("src/a1.ts", "src/agents/evil.ts");
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), { runId, requestedModel: "m", rootDir: root });
    // The gate outcome depends on findings; the panel must never be the
    // blocker — assert no incomplete-panel abort and three round-1 reviews.
    if (!result.ok) {
      assert.ok(!result.reason.includes("panel incomplete"), result.reason);
    }
    const rows = store.query<{ role: string }>(
      "SELECT ar.role FROM agent_run ar JOIN stage s ON ar.stage_id = s.id WHERE s.run_id = ?",
      [runId]
    );
    assert.ok(rows.filter((r) => r.role === "reviewer").length >= 3, "three reviewers dispatched in round 1");
  });
});

test("a missing design document is refused before any dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "bw-spec-stage-"));
  const store = openStore(root);
  const run = store.insertRun("p", "f-1", "no-design", "feature");
  try {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), { runId: run.id, requestedModel: "m", rootDir: root });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /cannot read design document/);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the panel is sized from distinct artifacts, not repeated ones", async () => {
  // 11 declared entries, 9 distinct. Deduplicated that is low risk (a panel of
  // one); counted raw it is standard (a panel of two), and the approval would
  // then bind a risk no panel of that size ever satisfied.
  await withRun(async ({ store, root, runId }) => {
    const scratch = join(root, "emit-spec-stage-duplicates.mjs");
    const source = fixtureSource()
      .replace(
        'const spec = stdin.includes("## Revision") ? REVISED_SPEC : BASE_SPEC;',
        "const spec = DUPLICATE_SPEC;"
      )
      // Clean review, so the run reaches the gate in one round and the
      // reviewer count is the panel size rather than a multiple of it.
      .replace('const findings = stdin.includes("REVISED-spec")', "const findings = true");
    writeFileSync(scratch, source);
    const result = await runSpecStage(store, fixtureExecutor(scratch), {
      runId,
      requestedModel: "m",
      rootDir: root,
    });
    assert.equal(result.ok, true, (result as { reason?: string }).reason);
    assert.equal(agentRunCounts(store, runId).reviewer, 1, "low risk seats one reviewer");
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0];
    assert.ok(gate, "the gate must record what it passed");
    assert.match(gate.summary, /risk=low/);
  });
});

test("the passing gate records the spec hash and risk it gated", async () => {
  await withRun(async ({ store, root, runId }) => {
    const result = await runSpecStage(store, fixtureExecutor(FIXTURE), {
      runId,
      requestedModel: "m",
      rootDir: root,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const gate = store.query<{ summary: string }>(
      "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
      [runId]
    )[0]!;
    // The hash must be of the spec actually on disk after the last revision.
    const onDisk = sha256Hex(normalizeText(readFileSync(result.specPath, "utf8")));
    assert.match(gate.summary, new RegExp(`specHash=${onDisk}; risk=(low|standard|high)`));
  });
});
