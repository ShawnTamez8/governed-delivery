import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type Store } from "../src/store.ts";
import { dispatchOnce } from "../src/dispatch.ts";
import { PROMPT_MAX_BYTES, RESULT_MAX_BYTES } from "../src/harness.ts";
import { verifyAuditChain } from "../src/audit.ts";
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
      { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "hello" },
      root
    );
    assert.equal(result.ok, true);
    const row = store.getAgentRun(result.agentRunId);
    assert.ok(row);
    assert.equal(row.requested_model, "m");
    assert.equal(row.requested_effort, "medium");
    assert.equal(row.setting, "a");
    assert.equal(row.independence, "configured_standalone");
    assert.ok(existsSync(join(root, row.raw_output_ref)));
    assert.deepEqual(auditActions(store), ["agent.dispatch"]);
  });
});

test("three concurrent dispatches retain distinct evidence and one valid audit chain", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const executor = fixtureExecutor("echo-json");
    const results = await Promise.all(
      ["correctness", "security", "resilience"].map((agent) =>
        dispatchOnce(
          store,
          executor,
          { stageId, agent, role: "reviewer", requestedModel: "m", requestedEffort: "medium", setting: agent, prompt: `review ${agent}` },
          root
        )
      )
    );
    assert.ok(results.every((result) => result.ok));
    const rows = store.query<{ raw_output_ref: string; cost: number | null }>(
      "SELECT raw_output_ref, cost FROM agent_run ORDER BY id"
    );
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows.map((row) => row.raw_output_ref)).size, 3);
    assert.deepEqual(rows.map((row) => row.cost), [0.125, 0.125, 0.125]);
    assert.equal(rows.reduce((sum, row) => sum + (row.cost ?? 0), 0), 0.375);
    assert.equal(auditActions(store).filter((action) => action === "agent.dispatch").length, 3);
    assert.equal(verifyAuditChain(store), null);
  });
});

test("a non-zero exit retains raw bytes, retains stderr, audits the failure, and inserts no row", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("exit-nonzero"),
      { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x" },
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
      { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x", invocation: { idleTimeoutSeconds: 1 } },
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
      { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x" },
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
      { stageId: 9999, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x" },
      root
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "stage 9999 does not exist");
    assert.ok(!existsSync(join(root, ".governance", "raw")), "no spawn, no retained output");
  });
});

test("dispatchOnce forwards the requested model and effort to the harness", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("echo-json"),
      { stageId, agent: "a", role: "author", requestedModel: "sonnet", requestedEffort: "low", setting: "a", prompt: "x" },
      root
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const row = store.getAgentRun(result.agentRunId)!;
    const stream = readFileSync(join(root, row.raw_output_ref), "utf8");
    const raw = JSON.parse(stream.trimEnd().split("\n").at(-1)!) as { argv: string[] };
    assert.deepEqual(raw.argv, ["--model", "sonnet", "--effort", "low"]);
  });
});

test("the row records the governing setting apart from the agent that ran", async () => {
  // A reconciliation runs as the author agent but under the `reconciler`
  // setting; only the `setting` column tells the two rows apart.
  await withDispatchContext(async (store, root, stageId) => {
    const executor = fixtureExecutor("echo-json");
    const draft = await dispatchOnce(
      store, executor,
      { stageId, agent: "spec-author", role: "author", requestedModel: "opus", requestedEffort: "high", setting: "spec-author", prompt: "d" },
      root);
    const reconcile = await dispatchOnce(
      store, executor,
      { stageId, agent: "spec-author", role: "author", requestedModel: "opus", requestedEffort: "high", setting: "reconciler", prompt: "r" },
      root);
    assert.ok(draft.ok && reconcile.ok);
    if (!draft.ok || !reconcile.ok) return;
    assert.equal(store.getAgentRun(draft.agentRunId)!.setting, "spec-author");
    assert.equal(store.getAgentRun(reconcile.agentRunId)!.setting, "reconciler");
    assert.equal(store.getAgentRun(reconcile.agentRunId)!.agent, "spec-author");
  });
});

test("a failed dispatch's audit summary and reason name the requested model and effort", async () => {
  // No agent_run row exists for a failure, so the summary is the only
  // per-attempt record of what was requested.
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("exit-nonzero"),
      { stageId, agent: "a", role: "author", requestedModel: "claude-opus-5-5", requestedEffort: "xhigh", setting: "a", prompt: "x" },
      root
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, /exited with code 3 \(requested model claude-opus-5-5, effort xhigh\)$/);
    const audited = store.query<{ summary: string }>("SELECT summary FROM audit WHERE action = 'agent.dispatch.failed'");
    assert.equal(audited.length, 1);
    assert.equal(audited[0]!.summary, result.reason);
  });
});

function scratchExecutor(root: string, name: string, source: string): ExecutorDefinition {
  const script = join(root, `${name}.mjs`);
  writeFileSync(script, source);
  return { ...fixtureExecutor("echo-json"), id: `test-${name}`, command: [process.execPath, script] };
}

test("a result over the size cap is refused by name while the whole stream is retained", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    // The cap bounds the result text, not the stream (section 20). The stream
    // here is a little over the cap because it carries the result once.
    const executor = scratchExecutor(root, "big-result", `
      import { readFileSync } from "node:fs";
      readFileSync(0);
      console.log(JSON.stringify({ type: "result", subtype: "success", result: "x".repeat(${RESULT_MAX_BYTES} + 1) }));
    `);
    const result = await dispatchOnce(
      store, executor, { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x" }, root);
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(`result exceeded the ${RESULT_MAX_BYTES}-byte size cap`));
    const files = rawDirFiles(root);
    assert.equal(files.length, 1);
    assert.ok(readFileSync(join(root, ".governance", "raw", files[0]), "utf8").length > RESULT_MAX_BYTES,
      "the raw stream is retained whole");
    assert.deepEqual(auditActions(store), ["agent.dispatch.failed"]);
    assert.equal(store.query("SELECT * FROM agent_run").length, 0);
  });
});

test("a result at the size cap is accepted", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const executor = scratchExecutor(root, "cap-result", `
      import { readFileSync } from "node:fs";
      readFileSync(0);
      console.log(JSON.stringify({ type: "result", subtype: "success", result: "x".repeat(${RESULT_MAX_BYTES}) }));
    `);
    const result = await dispatchOnce(
      store, executor, { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x" }, root);
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
  });
});

test("a dispatch killed for silence retains the partial stream written before the kill (hazard 2)", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const executor = scratchExecutor(root, "goes-silent", `
      import { readFileSync } from "node:fs";
      readFileSync(0);
      console.log(JSON.stringify({ type: "stream_event", text: "written-before-the-kill" }));
      setInterval(() => {}, 1 << 30);
    `);
    const result = await dispatchOnce(
      store, executor,
      { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x", invocation: { idleTimeoutSeconds: 1 } },
      root);
    assert.equal(result.ok, false);
    assert.match(result.reason, /timed out after \d+ms/);
    const files = rawDirFiles(root);
    assert.equal(files.length, 1);
    assert.ok(readFileSync(join(root, ".governance", "raw", files[0]), "utf8").includes("written-before-the-kill"));
  });
});

test("an oversized prompt is refused before any invocation", async () => {
  await withDispatchContext(async (store, root, stageId) => {
    const result = await dispatchOnce(
      store,
      fixtureExecutor("exit-nonzero"),
      { stageId, agent: "a", role: "author", requestedModel: "m", requestedEffort: "medium", setting: "a", prompt: "x".repeat(PROMPT_MAX_BYTES + 1) },
      root
    );
    assert.equal(result.ok, false);
    assert.match(result.reason, new RegExp(`prompt exceeds ${PROMPT_MAX_BYTES} bytes`));
    assert.ok(!existsSync(join(root, ".governance", "raw")), "no spawn, no retained output");
  });
});
