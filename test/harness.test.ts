import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { invokeHarness, parseEnvelope, probeExecutor } from "../src/harness.ts";
import { CLAUDE_CODE, type ExecutorDefinition } from "../src/executor.ts";

const FIXTURES = join(process.cwd(), "test", "fixtures", "harness");

function testExecutor(command: string[], overrides: Partial<ExecutorDefinition> = {}): ExecutorDefinition {
  return {
    id: "test-fixture",
    command,
    probe: ["node", "--version"],
    capabilities: [],
    telemetry: { perInvocationModel: true, effectiveModel: true, tokenUsage: true, sessionCost: false },
    sandbox: {
      allowedPaths: [],
      deniedPaths: [],
      commandAllowlist: [],
      idleTimeoutSeconds: 30,
      absoluteTimeoutSeconds: 120,
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP"],
      network: "inherit",
    },
    ...overrides,
  };
}

test("probeExecutor succeeds for a resolving probe", () => {
  assert.doesNotThrow(() => probeExecutor(testExecutor([])));
});

test("probeExecutor throws naming the executor and the cause", () => {
  const executor = testExecutor([], { id: "broken-exec", probe: ["definitely-not-a-real-binary"] });
  assert.throws(() => probeExecutor(executor), /probe failed for executor broken-exec: .+/);
});

test("invokeHarness happy path delivers the prompt over stdin", async () => {
  const executor = testExecutor(["node", join(FIXTURES, "echo-json.mjs")]);
  const prompt = "the prompt travels over stdin";
  const outcome = await invokeHarness(executor, { prompt });
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.timedOut, false);
  assert.ok(outcome.durationMs >= 0);
  const parsed = JSON.parse(outcome.raw) as { type: string; stdinLength: number };
  assert.equal(parsed.type, "result");
  assert.equal(parsed.stdinLength, Buffer.byteLength(prompt));
});

test("the environment filter excludes anything not on the passthrough list", async () => {
  process.env.BUILDWORKS_TEST_CANARY = "leak-me";
  try {
    const executor = testExecutor(["node", join(FIXTURES, "echo-env.mjs")]);
    const outcome = await invokeHarness(executor, { prompt: "" });
    const env = JSON.parse(outcome.raw) as Record<string, string>;
    assert.ok(!("BUILDWORKS_TEST_CANARY" in env), "canary leaked through the filter");
    assert.ok("PATH" in env, "passthrough variables must still be present");
  } finally {
    delete process.env.BUILDWORKS_TEST_CANARY;
  }
});

test("an idle process is killed and flagged timedOut", async () => {
  const executor = testExecutor(["node", join(FIXTURES, "hang.mjs")]);
  const outcome = await invokeHarness(executor, { prompt: "x", idleTimeoutSeconds: 1 });
  assert.equal(outcome.timedOut, true);
  // The kill must be prompt. A duration near the runner's own timeout means
  // the kill silently failed and something else ended the test.
  assert.ok(outcome.durationMs < 10_000, `kill took ${outcome.durationMs}ms`);
});

test("tree-kill reaches the grandchild", async () => {
  const root = mkdtempSync(join(tmpdir(), "bw-tree-"));
  const pidFile = join(root, "pid.txt");
  try {
    const executor = testExecutor(["node", join(FIXTURES, "spawn-grandchild.mjs"), pidFile]);
    const outcome = await invokeHarness(executor, { prompt: "x", idleTimeoutSeconds: 1 });
    assert.equal(outcome.timedOut, true);
    assert.ok(outcome.durationMs < 10_000, `kill took ${outcome.durationMs}ms`);
    const grandchildPid = Number(readFileSync(pidFile, "utf8").trim());
    assert.throws(
      () => process.kill(grandchildPid, 0),
      (err: unknown) => (err as NodeJS.ErrnoException).code === "ESRCH",
      `grandchild ${grandchildPid} survived the tree-kill`
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real claude shim resolves through shell spawning", (t) => {
  const check = spawnSync(CLAUDE_CODE.probe[0], CLAUDE_CODE.probe.slice(1), {
    shell: process.platform === "win32",
    encoding: "utf8",
  });
  if (check.status !== 0) {
    t.skip(`claude does not resolve in this environment: ${(check.stderr ?? "").trim()}`);
    return;
  }
  assert.doesNotThrow(() => probeExecutor(CLAUDE_CODE));
});

test("parseEnvelope reads the recorded real envelope", () => {
  const raw = readFileSync(join(FIXTURES, "claude-code-envelope.json"), "utf8");
  const fixture = JSON.parse(raw) as {
    result: string;
    total_cost_usd: number;
    usage: { input_tokens: number; output_tokens: number };
    modelUsage: Record<string, { inputTokens: number }>;
  };
  const envelope = parseEnvelope(CLAUDE_CODE, raw);
  assert.equal(envelope.resultText, fixture.result);
  assert.equal(envelope.cost, fixture.total_cost_usd);
  assert.equal(envelope.tokensIn, fixture.usage.input_tokens);
  assert.equal(envelope.tokensOut, fixture.usage.output_tokens);
  const expectedModel = Object.entries(fixture.modelUsage).find(
    ([, u]) => u.inputTokens === fixture.usage.input_tokens
  )?.[0];
  assert.equal(envelope.effectiveModel, expectedModel);
  assert.equal(envelope.fallback, null);
});

test("parseEnvelope refuses non-JSON naming the executor", () => {
  assert.throws(() => parseEnvelope(CLAUDE_CODE, "not json"), /harness envelope for executor claude-code is not valid JSON/);
});

test("an unresolvable binary resolves with a named failure instead of rejecting", async () => {
  // Under shell: true the shell itself starts and reports the unresolvable
  // command on stderr with exit 1; the spawnError field covers the case
  // where even the shell cannot start. Either way the promise resolves so
  // the caller can retain evidence and audit the attempt.
  const executor = testExecutor(["definitely-not-a-real-binary"]);
  const outcome = await invokeHarness(executor, { prompt: "x" });
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderr, /definitely-not-a-real-binary/);
});

test("the model override reaches the child argv", async () => {
  const executor = testExecutor(["node", join(FIXTURES, "echo-json.mjs")]);
  const outcome = await invokeHarness(executor, { prompt: "", model: "sonnet" });
  const parsed = JSON.parse(outcome.raw) as { argv: string[] };
  assert.deepEqual(parsed.argv, ["--model", "sonnet"]);
});

test("stderr is captured alongside stdout", async () => {
  const executor = testExecutor(["node", join(FIXTURES, "exit-nonzero.mjs")]);
  const outcome = await invokeHarness(executor, { prompt: "x" });
  assert.equal(outcome.exitCode, 3);
  assert.equal(outcome.raw, "partial");
  assert.equal(outcome.stderr, "boom");
});
