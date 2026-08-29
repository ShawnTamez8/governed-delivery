import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { dispatchOnce } from "../src/dispatch.ts";
import { PROMPT_MAX_BYTES } from "../src/harness.ts";
import type { ExecutorDefinition } from "../src/executor.ts";

const FIXTURES = join(process.cwd(), "test", "fixtures", "harness");

function fixtureExecutor(name: string): ExecutorDefinition {
  return {
    id: `test-${name}`,
    command: ["node", join(FIXTURES, `${name}.mjs`)],
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

function withDispatchContext(
  fn: (store: Store, root: string, stageId: number) => Promise<void> | void
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-dispatch-"));
  const store = openStore(root);
  const run = store.insertRun("p", "f-1", "s", "feature");
  const stage = store.insertStage(run.id, "spec", null);
  return Promise.resolve(fn(store, root, stage.id)).finally(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
}

function auditActions(store: Store): string[] {
  return store
    .query<{ action: string }>("SELECT action FROM audit ORDER BY id")
    .map((r) => r.action);
}

function rawDirFiles(root: string): string[] {
  const rawDir = join(root, ".governance", "raw");
  if (!existsSync(rawDir)) return [];
  return readdirSync(rawDir, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith(".json"));
}

test("a successful dispatch records row, raw output, and a success audit event", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("echo-json"),
      { stageId, agent: "a", role: "author", requestedModel: "m", prompt: "hello" },
      root
    );
    assert.equal(result.ok, true);
    const row = store.getAgentRun(result.agentRunId);
    assert.ok(row);
    assert.equal(row.requested_model, "m");
    assert.equal(row.independence, "configured_standalone");
    assert.ok(existsSync(join(root, row.raw_output_ref)));
    assert.deepEqual(auditActions(store), ["agent.dispatch"]);
  });
});

test("a non-zero exit retains raw bytes, retains stderr, audits the failure, and inserts no row", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("exit-nonzero"),
      { stageId, agent: "a", role: "author", requestedModel: "m", prompt: "x" },
      root
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /exited with code 3/);
    const files = rawDirFiles(root);
    const contents = files.map((f) => readFileSync(join(root, ".governance", "raw", String(f)), "utf8"));
    assert.ok(contents.some((c) => c.includes("partial")), "stdout bytes retained");
    assert.ok(contents.some((c) => c.includes("boom")), "stderr bytes retained");
    assert.deepEqual(auditActions(store), ["agent.dispatch.failed"]);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0);
  });
});

test("a timeout retains raw bytes, audits the failure, and inserts no row", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("hang"),
      { stageId, agent: "a", role: "author", requestedModel: "m", prompt: "x", invocation: { idleTimeoutSeconds: 1 } },
      root
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /timed out after \d+ms/);
    assert.ok(rawDirFiles(root).length >= 1, "raw bytes retained on timeout");
    assert.deepEqual(auditActions(store), ["agent.dispatch.failed"]);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0);
  });
});

test("an unparseable envelope audits the failure and inserts no row", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("emit-bad-json"),
      { stageId, agent: "a", role: "author", requestedModel: "m", prompt: "x" },
      root
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /envelope parse failed/);
    assert.ok(rawDirFiles(root).length >= 1, "raw bytes retained on parse failure");
    assert.deepEqual(auditActions(store), ["agent.dispatch.failed"]);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0);
  });
});

test("a nonexistent stage fails without spawning", async () => {
  await withDispatchContext(async (store, root) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("exit-nonzero"),
      { stageId: 9999, agent: "a", role: "author", requestedModel: "m", prompt: "x" },
      root
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "stage 9999 does not exist");
    assert.ok(!existsSync(join(root, ".governance", "raw")), "no spawn, no retained output");
  });
});

test("an oversized prompt is refused before any invocation", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("exit-nonzero"),
      { stageId, agent: "a", role: "author", requestedModel: "m", prompt: "x".repeat(PROMPT_MAX_BYTES + 1) },
      root
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(`prompt exceeds ${PROMPT_MAX_BYTES} bytes`));
    assert.ok(!existsSync(join(root, ".governance", "raw")), "no spawn, no retained output");
  });
});
