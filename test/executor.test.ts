import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAUDE_CODE } from "../src/executor.ts";

test("the executor identity is claude-code", () => {
  assert.equal(CLAUDE_CODE.id, "claude-code");
});

test("the command matches section 11's YAML", () => {
  assert.deepEqual(CLAUDE_CODE.command, ["claude", "-p", "--output-format", "json"]);
});

test("session cost is declared reported, matching the recorded envelope", () => {
  assert.equal(CLAUDE_CODE.telemetry.sessionCost, true);
});

test("the absolute ceiling is a multiple of the idle budget", () => {
  assert.ok(CLAUDE_CODE.sandbox.absoluteTimeoutSeconds > CLAUDE_CODE.sandbox.idleTimeoutSeconds);
});

test("no approval variable is passed through to a spawned executor", () => {
  // Section 17: pass named environment variables, never the whole
  // environment. A worker session must never receive signing material or the
  // key that verifies it.
  for (const name of CLAUDE_CODE.sandbox.envPassthrough) {
    assert.ok(!name.startsWith("BW_"), `${name} must not reach a spawned executor`);
  }
});

test("the governance CLI is never in a spawned executor's allowlist", () => {
  // Section 6: agents may not invoke the governance CLI.
  for (const command of CLAUDE_CODE.sandbox.commandAllowlist) {
    assert.ok(command !== "bw" && command !== "git", `${command} must not be allowlisted`);
  }
});
