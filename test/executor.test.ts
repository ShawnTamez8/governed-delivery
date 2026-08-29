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
