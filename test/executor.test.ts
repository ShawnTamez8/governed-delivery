import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAUDE_CODE } from "../src/executor.ts";

test("the executor identity is claude-code", () => {
  assert.equal(CLAUDE_CODE.id, "claude-code");
});

test("the command matches section 11's YAML", () => {
  assert.deepEqual(CLAUDE_CODE.command, [
    "claude",
    "-p",
    "--output-format",
    "json",
    "--restricted",
    "--safe-mode",
    "--tools",
    "Read,Glob,Grep",
    "--disallowedTools",
    "Write,Edit,NotebookEdit,Bash,mcp__*",
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--no-session-persistence",
  ]);
});

test("claude_executor_exposes_only_read_tools_in_restricted_safe_mode", () => {
  // The exact array is the probe input Task 9 Step 1 runs against the real
  // binary — the unit pin and the real-harness evidence name one command.
  // Semantics from the installed CLI's help (verified at plan time):
  // `--restricted` removes the command/code tools and WebFetch unless
  // `--tools` names them, confines file tools to the working directories,
  // and refuses bypassPermissions; `--safe-mode` disables customizations
  // (CLAUDE.md, skills, hooks, MCP, plugins, custom agents) while auth,
  // model selection, built-in tools, and permissions work normally;
  // `--tools Read,Glob,Grep` fixes the inventory; `--disallowedTools`
  // denies Write, Edit, NotebookEdit, Bash, and mcp__*; `--permission-mode
  // dontAsk` makes the session non-interactive; `--strict-mcp-config` with
  // no `--mcp-config` means no MCP servers; `--no-session-persistence`
  // works with `-p`. `--bare` is deliberately absent: the installed CLI
  // makes it API-key-only, and a default OAuth installation must keep
  // completing runs (hazard 11).
  assert.deepEqual(CLAUDE_CODE.command, [
    "claude",
    "-p",
    "--output-format",
    "json",
    "--restricted",
    "--safe-mode",
    "--tools",
    "Read,Glob,Grep",
    "--disallowedTools",
    "Write,Edit,NotebookEdit,Bash,mcp__*",
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    "--no-session-persistence",
  ]);
  for (const capability of ["spec", "plan", "review", "implementation"]) {
    assert.ok(CLAUDE_CODE.capabilities.includes(capability), `missing capability ${capability}`);
  }
  assert.deepEqual(CLAUDE_CODE.probe, ["claude", "--version"]);
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
