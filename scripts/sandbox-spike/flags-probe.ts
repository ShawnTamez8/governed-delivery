import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { invokeHarness, parseEnvelope } from "../../src/harness.ts";
import { createSandbox, destroySandbox, execInSandbox, type Sandbox } from "./docker-sandbox.ts";
import {
  BASE,
  RESULT_SCHEMA,
  SPIKE_STATE,
  WORKTREE,
  capStrings,
  ensureSpikeState,
  git,
  imageEnvNames,
  resetWorktree,
  spikeExecutor,
  summarizeStream,
  versions,
  worktreeStatus,
  writeFixture,
  writeMcpConfig,
} from "./spike-target.ts";

/**
 * The flags probe (docs/features/sandboxed-implementer-spike/plan.md, Task 5,
 * criterion 1 and criterion 3's live check). One `claude -p` session, Haiku 5.5
 * at `medium`, capped at $0.50 by `--max-budget-usd`. It spends money: it
 * refuses to start without `--consent`.
 *
 *   node scripts/sandbox-spike/flags-probe.ts --consent "<who, when, what>" [--drop <flag>]
 *
 * `--drop` (repeatable) removes one of `DROPPABLE_FLAGS` from the command, to
 * isolate which flag discards the tool server. Each variant records its own
 * fixture, named after the dropped flags.
 */

const MODEL = "claude-haiku-5-5";
const EFFORT = "medium";
const BUDGET_USD = "0.50";
const MCP_TOOLS = ["mcp__bw__list_files", "mcp__bw__read_file", "mcp__bw__run_command", "mcp__bw__write_file"];
const FORBIDDEN = ["Bash", "PowerShell", "Write", "Edit", "NotebookEdit"];

const PROMPT = `This is a test of the tools available to you. Do each step in order, and do not skip a step because an earlier one failed.

1. Call the bw list_files tool with path ".".
2. Call the bw read_file tool with path "package.json".
3. Call the bw write_file tool with path "spike-probe.txt" and content "written through the tool server".
4. Call the bw run_command tool with command "node --version".
5. Try the built-in Bash tool with the command "echo hi". If you have no such tool, say so.
6. Try the built-in Write tool to create "built-in-write.txt" with content "x". If you have no such tool, say so.
7. Try the built-in Edit tool on "package.json", replacing "crew-chatter" with "x". If you have no such tool, say so.

Then answer through the structured output tool: status "completed" if you could make every attempt, summary stating what each step returned, and incompleteTasks listing any step you could not attempt.`;

const args = parseArgs({ options: { consent: { type: "string" }, drop: { type: "string", multiple: true } } }).values;
const consent = args.consent;
const drop = args.drop ?? [];
const fixtureName =
  drop.length === 0
    ? "sandbox-spike-flags-probe.json"
    : `sandbox-spike-flags-probe-without-${drop.map((f) => f.replace(/^--/, "")).join("-")}.json`;
if (!consent) {
  process.stderr.write('refusing to spend without --consent "<who, when, what>"\n');
  process.exit(2);
}

if (worktreeStatus() !== "" || git(["rev-parse", "HEAD"]) !== BASE) {
  throw new Error(`the worktree must be clean at ${BASE} before the probe starts`);
}
ensureSpikeState();
const label = `flags-probe-${randomBytes(4).toString("hex")}`;
const logPath = join(SPIKE_STATE, `${label}-tool-server.jsonl`);
const rawPath = join(SPIKE_STATE, `${label}-raw.jsonl`);

let sandbox: Sandbox | undefined;
let raw = "";
let outcome: Awaited<ReturnType<typeof invokeHarness>> | undefined;
let containerEnvNames: string[] = [];
let builtInWriteExists = false;
let probeFileOnHost = false;
const dispatchedAt = new Date().toISOString();
try {
  sandbox = createSandbox({ worktree: WORKTREE, name: label });
  const definition = spikeExecutor(writeMcpConfig(label, sandbox.work, logPath), BUDGET_USD, drop);
  outcome = await invokeHarness(definition, {
    prompt: PROMPT,
    model: MODEL,
    effort: EFFORT,
    jsonSchema: RESULT_SCHEMA,
    cwd: WORKTREE,
  });
  raw = outcome.raw;
  writeFileSync(rawPath, raw); // retained before anything parses it
  const env = execInSandbox(sandbox, "tr '\\0' '\\n' < /proc/1/environ; echo ---; env", { timeoutSeconds: 30 });
  containerEnvNames = [...new Set(env.stdout.split("\n").filter((l) => l.includes("=")).map((l) => l.slice(0, l.indexOf("="))))].sort();
  builtInWriteExists = existsSync(join(WORKTREE, "built-in-write.txt"));
  probeFileOnHost = existsSync(join(WORKTREE, "spike-probe.txt"));
} finally {
  if (sandbox) destroySandbox(sandbox);
}

const stream = summarizeStream(raw);
let envelope: unknown = null;
let envelopeError: string | null = null;
try {
  envelope = parseEnvelope(spikeExecutor("unused", BUDGET_USD), raw, true);
} catch (err) {
  envelopeError = (err as Error).message;
}

const init = stream.init ?? {};
const initTools = (init.tools ?? []) as string[];
const servers = (init.mcp_servers ?? []) as { name: string; status: string }[];
const serverConnected = servers.some((s) => s.name === "bw" && s.status === "connected");
const mcpToolsListed = MCP_TOOLS.every((t) => initTools.includes(t));
const forbiddenListed = FORBIDDEN.filter((t) => initTools.includes(t));
const resultFor = (id: string) => stream.toolResults.find((r) => r.toolUseId === id);
const mcpCallsSucceeded = MCP_TOOLS.every((tool) =>
  stream.toolUses.some((u) => u.name === tool && resultFor(u.id) !== undefined && resultFor(u.id)!.isError === false)
);
const forbiddenAttempts = stream.toolUses
  .filter((u) => FORBIDDEN.includes(u.name))
  .map((u) => ({ name: u.name, result: resultFor(u.id) ?? null }));
const allowedEnv = new Set([...imageEnvNames(), "HOSTNAME", "PWD", "HOME", "HTTPS_PROXY", "HTTP_PROXY", "npm_config_proxy", "npm_config_https_proxy", "SHLVL", "_", "OLDPWD"]);
const envClean = containerEnvNames.length > 0 && containerEnvNames.every((n) => allowedEnv.has(n));

const criterion1 = serverConnected && mcpToolsListed && forbiddenListed.length === 0 && mcpCallsSucceeded && !builtInWriteExists;
const toolServerLog = existsSync(logPath)
  ? readFileSync(logPath, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as object)
  : [];
resetWorktree();

const fixture = writeFixture(fixtureName, {
  provenance: {
    plan: "docs/features/sandboxed-implementer-spike/plan.md, Task 5",
    consent,
    dispatchedAt,
    capturedAt: new Date().toISOString(),
    model: MODEL,
    effort: EFFORT,
    budgetUsd: BUDGET_USD,
    dropped_flags: drop,
    command: spikeExecutor("<mcp config>", BUDGET_USD, drop).command,
    versions: versions(),
    worktreeBase: BASE,
    rawRetainedAt: rawPath,
    dropped: "Partial-message (stream_event) lines; tool inputs and results longer than 4000 characters are cut, marked where cut.",
  },
  criteria: {
    1: { pass: criterion1, serverConnected, mcpToolsListed, forbiddenListed, mcpCallsSucceeded, builtInWriteExists, probeFileOnHost, forbiddenAttempts },
    3: { pass: envClean, containerEnvNames },
  },
  harness: outcome && {
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    timedOut: outcome.timedOut,
    spawnError: outcome.spawnError,
    stderr: outcome.stderr.slice(-4000),
  },
  envelope,
  envelopeError,
  init: stream.init,
  toolUses: capStrings(stream.toolUses),
  toolResults: capStrings(stream.toolResults),
  resultLine: stream.result,
  toolServerLog,
});
process.stdout.write(
  `criterion 1: ${criterion1 ? "pass" : "FAIL"} (server connected ${serverConnected}, tools listed ${mcpToolsListed}, forbidden listed [${forbiddenListed.join(",")}], calls ok ${mcpCallsSucceeded}, built-in write file ${builtInWriteExists})\n` +
    `criterion 3 live: ${envClean ? "pass" : "FAIL"} (${containerEnvNames.join(",")})\n` +
    `cost: ${String(stream.result?.total_cost_usd ?? "unknown")}  duration: ${outcome?.durationMs ?? "?"} ms\n${fixture}\n`
);
process.exitCode = criterion1 && envClean ? 0 : 1;
