import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { buildHarnessEnvironment, invokeHarness, parseEnvelope, probeExecutor } from "../src/harness.ts";
import { CLAUDE_CODE, type ExecutorDefinition } from "../src/executor.ts";

const FIXTURES = join(process.cwd(), "test", "fixtures", "harness");
const HARNESS_SOURCE = readFileSync(join(process.cwd(), "src", "harness.ts"), "utf8");

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

test("probeExecutor returns captured stdout and stderr without changing its argv", () => {
  const probe = [process.execPath, join(FIXTURES, "exit-nonzero.mjs")];
  const expected = spawnSync(probe[0], probe.slice(1), { encoding: "utf8", shell: false });
  assert.throws(() => probeExecutor(testExecutor([], { probe })), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(expected.stderr));
    assert.ok(error.message.includes(expected.stdout));
    assert.ok(error.message.includes(`exited with code ${expected.status}`));
    return true;
  });
  const successful = spawnSync(process.execPath, ["--version"], { encoding: "utf8", shell: false });
  assert.deepEqual(probeExecutor(testExecutor([], { probe: [process.execPath, "--version"] })),
    { stdout: successful.stdout, stderr: successful.stderr });
});

test("probeExecutor bounds a hanging probe without invoking a model", () => {
  const start = Date.now();
  assert.throws(() => probeExecutor(testExecutor([], {
    probe: [process.execPath, "-e", "setTimeout(() => {}, 1000)"],
  }), { timeoutMs: 50 }), /probe failed.*timed out after 50 ms.*ETIMEDOUT/);
  assert.ok(Date.now() - start < 5000);
});

test("named environment construction preserves empty values and immutable inputs", () => {
  const executor = structuredClone(CLAUDE_CODE);
  const source = Object.freeze({ PATH: "", HOME: "owned-home", BUILDWORKS_TEST_CANARY: "excluded" });
  const before = structuredClone(executor);
  const env = buildHarnessEnvironment(executor, source);
  assert.deepEqual(env, { PATH: "", HOME: "owned-home" });
  assert.notEqual(env, source);
  assert.deepEqual(executor, before);
  env.HOME = "changed-copy";
  assert.equal(source.HOME, "owned-home");
});

test("probe defaults omit env cwd and timeout; explicit relative executable refuses before spawn", (t) => {
  const original = childProcess.spawnSync;
  const calls: unknown[][] = [];
  const mocked = t.mock.method(childProcess, "spawnSync", (...args: Parameters<typeof spawnSync>) => {
    calls.push(args);
    return original(...args);
  });
  syncBuiltinESMExports();
  try {
    const executor = testExecutor([]);
    probeExecutor(executor);
    assert.deepEqual(calls, [[executor.probe[0], executor.probe.slice(1), { shell: false, encoding: "utf8" }]]);
    assert.throws(() => probeExecutor(executor, { executablePath: "relative-node" }),
      /probe failed.*executablePath must be absolute/);
    assert.equal(calls.length, 1);
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
});

test("explicit probe and invocation share the named filter in real children", async () => {
  const root = mkdtempSync(join(tmpdir(), "bw-probe-env-"));
  const names = ["BUILDWORKS_TEST_CANARY", "BUILDWORKS_TEST_NAMED", "BUILDWORKS_TEST_EMPTY"];
  const saved = names.map((name) => process.env[name]);
  try {
    process.env.BUILDWORKS_TEST_CANARY = "excluded-canary";
    process.env.BUILDWORKS_TEST_NAMED = "named-value";
    process.env.BUILDWORKS_TEST_EMPTY = "";
    const command = [process.execPath, join(FIXTURES, "echo-env.mjs")];
    const executor = testExecutor(command, { probe: ["unused-bare-command", ...command.slice(1)] });
    executor.sandbox.envPassthrough.push("BUILDWORKS_TEST_NAMED", "BUILDWORKS_TEST_EMPTY");
    const env = buildHarnessEnvironment(executor);
    const probe = probeExecutor(executor, { executablePath: process.execPath, env, cwd: root, timeoutMs: 5000 });
    const invocation = await invokeHarness(executor, { prompt: "", cwd: root });
    assert.equal(invocation.exitCode, 0);
    for (const output of [probe.stdout, invocation.raw]) {
      const actual = JSON.parse(output) as Record<string, string>;
      assert.equal(actual.BUILDWORKS_TEST_NAMED, process.env.BUILDWORKS_TEST_NAMED);
      assert.equal(actual.BUILDWORKS_TEST_EMPTY, "");
      assert.ok(!Object.hasOwn(actual, "BUILDWORKS_TEST_CANARY"), "canary leaked through the filter");
    }
    const code = "console.log(process.cwd()); console.error(process.argv[1])";
    const argv = ["-e", code, "preserved-argument"];
    const expected = spawnSync(process.execPath, argv, { env, cwd: root, shell: false, encoding: "utf8" });
    assert.equal(expected.status, 0);
    assert.equal(expected.stdout.trim(), root);
    assert.equal(expected.stderr.trim(), "preserved-argument");
    assert.deepEqual(probeExecutor(testExecutor([], { probe: ["unused", ...argv] }),
      { executablePath: process.execPath, env, cwd: root, timeoutMs: 5000 }),
    { stdout: expected.stdout, stderr: expected.stderr });
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
    rmSync(root, { recursive: true, force: true });
  }
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

test("the harness launches executables directly without a command-shell wrapper", () => {
  assert.ok(
    !HARNESS_SOURCE.includes("shell: WINDOWS"),
    "native executables must not be routed through cmd.exe"
  );
});

test("the real claude executable resolves through direct spawning", (t) => {
  const check = spawnSync(CLAUDE_CODE.probe[0], CLAUDE_CODE.probe.slice(1), {
    shell: false,
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

test("an unresolvable binary resolves with a named direct-spawn failure instead of rejecting", async () => {
  const executor = testExecutor(["definitely-not-a-real-binary"]);
  const outcome = await invokeHarness(executor, { prompt: "x" });
  assert.equal(outcome.exitCode, null);
  assert.match(outcome.spawnError ?? "", /ENOENT/);
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

test("invokeHarness runs the child in a caller-chosen working directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bw-cwd-"));
  try {
    const executor = testExecutor(["node", join(FIXTURES, "echo-cwd.mjs")]);
    const outcome = await invokeHarness(executor, { prompt: "", cwd: dir });
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.raw.trim(), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invokeHarness defaults to the inherited working directory", async () => {
  const executor = testExecutor(["node", join(FIXTURES, "echo-cwd.mjs")]);
  const outcome = await invokeHarness(executor, { prompt: "" });
  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.raw.trim(), process.cwd());
});
