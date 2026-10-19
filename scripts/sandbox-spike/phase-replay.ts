import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { sha256Hex } from "../../src/canonical.ts";
import { invokeHarness, parseEnvelope } from "../../src/harness.ts";
import { gatePatchPaths } from "../../src/implementation-gate.ts";
import { createSandbox, destroySandbox, execInSandbox, type Sandbox } from "./docker-sandbox.ts";
import {
  BASE,
  RESULT_SCHEMA,
  SLUG,
  SPIKE_STATE,
  WORKTREE,
  capStrings,
  ensureSpikeState,
  git,
  imageEnvNames,
  readRun6Scope,
  removeIgnoredOutput,
  spikeExecutor,
  stagedPathsSinceBase,
  summarizeStream,
  versions,
  worktreeStatus,
  writeFixture,
  writeMcpConfig,
} from "./spike-target.ts";

/**
 * The phase replay (docs/features/sandboxed-implementer-spike/plan.md, Task 6,
 * criterion 7). Crew-chatter run 6's phase 2, in tool mode: Sonnet 5.5 at
 * `medium`, the seeded implementer setting, capped at $3.00 by
 * `--max-budget-usd`. Then the boundary the build would run: discard ignored
 * output and any lockfile edit, compute the diff, gate it against run 6's
 * signed scope, regenerate the lockfile in a fresh container, commit, and
 * measure the frozen verification commands in a third container. It spends
 * money: it refuses to start without `--consent`.
 *
 *   node scripts/sandbox-spike/phase-replay.ts --consent "<who, when, what>"
 */

const MODEL = "claude-sonnet-5-5";
const EFFORT = "medium";
const BUDGET_USD = "3.00";
// Adopted by the operator on 2026-10-19, after the isolation and CLAUDE.md
// probes: `--safe-mode` discards the tool server, and `--restricted` alone keeps
// CLAUDE.md files out (plan, spike record).
const DROP = ["--safe-mode"];
const RETAINED_PROMPT =
  "C:\\Repositories\\testing-repos\\crew-chatter\\.governance\\prompts\\6\\c121a489a1498ec943921cab59fdcc950b2a907d98225588ab808da80e0e367d.txt";
const RETAINED_SHA256 = "c121a489a1498ec943921cab59fdcc950b2a907d98225588ab808da80e0e367d";
const RECORDED_PHASE = { agentRunId: 249, costUsd: 0.1902674, durationMs: 41626, commit: "f093727e266857970bb5e1c378463b237823d510" };
const VERIFY = ["npm ci", "npm run typecheck", "npm run lint", "npm run build"];
const DERIVED = "npm install --package-lock-only --ignore-scripts";

// The tool-mode preamble, fixed in the plan before any call.
const PREAMBLE = `you are the implementer

Implement the approved plan below by changing files in the repository checkout
through the bw tools: list_files, read_file, write_file and run_command. Paths
are relative to the checkout root. run_command runs a shell command in the
checkout inside a Linux container with Node and npm; the package registry is
the only network host it can reach. You have no other way to change files and
no git: the system computes your changes from the checkout and commits them.

This is phase 2 of 5. Implement only the tasks listed under "Tasks for this
phase" below: tasks 11 through 20 of the approved plan. Earlier phases are
already committed in this checkout. Later phases implement the remaining
tasks, so do not implement a task outside this phase. Change only the scope
paths listed below; any other change is refused. Do not edit
package-lock.json: the system regenerates it after you finish.

When you finish, answer through the structured output tool with your status,
a summary of what you changed and why, and any task of this phase you could
not complete.
`;

const consent = parseArgs({ options: { consent: { type: "string" } } }).values.consent;
if (!consent) {
  process.stderr.write('refusing to spend without --consent "<who, when, what>"\n');
  process.exit(2);
}

const retained = readFileSync(RETAINED_PROMPT, "utf8");
if (sha256Hex(retained) !== RETAINED_SHA256) throw new Error("the retained phase 2 prompt does not match its recorded hash");
const anchor = retained.indexOf("Patch only these paths:");
if (anchor < 0 || retained[anchor - 1] !== "\n") throw new Error("the retained prompt has no 'Patch only these paths:' line");
const prompt = `${PREAMBLE}\n${retained.slice(anchor)}`;

if (worktreeStatus() !== "" || git(["rev-parse", "HEAD"]) !== BASE) {
  throw new Error(`the worktree must be clean at ${BASE} before the replay starts`);
}
ensureSpikeState();
const label = `phase-replay-${randomBytes(4).toString("hex")}`;
const logPath = join(SPIKE_STATE, `${label}-tool-server.jsonl`);
const rawPath = join(SPIKE_STATE, `${label}-raw.jsonl`);
const scope = readRun6Scope();

function dependencyNames(packageJson: string): Set<string> {
  const parsed = JSON.parse(packageJson) as { dependencies?: object; devDependencies?: object };
  return new Set([...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})]);
}

let agentSandbox: Sandbox | undefined;
let raw = "";
let outcome: Awaited<ReturnType<typeof invokeHarness>> | undefined;
let containerEnvNames: string[] = [];
const dispatchedAt = new Date().toISOString();
try {
  agentSandbox = createSandbox({ worktree: WORKTREE, name: label });
  const definition = spikeExecutor(writeMcpConfig(label, agentSandbox.work, logPath), BUDGET_USD, DROP);
  outcome = await invokeHarness(definition, { prompt, model: MODEL, effort: EFFORT, jsonSchema: RESULT_SCHEMA, cwd: WORKTREE });
  raw = outcome.raw;
  writeFileSync(rawPath, raw); // retained before anything parses it
  const env = execInSandbox(agentSandbox, "tr '\\0' '\\n' < /proc/1/environ; echo ---; env", { timeoutSeconds: 30 });
  containerEnvNames = [...new Set(env.stdout.split("\n").filter((l) => l.includes("=")).map((l) => l.slice(0, l.indexOf("="))))].sort();
} finally {
  if (agentSandbox) destroySandbox(agentSandbox);
}

const stream = summarizeStream(raw);
interface Reply {
  status?: string;
  summary?: string;
  incompleteTasks?: string[];
}
function readReply(): { reply: Reply | null; costUsd: number | null; envelopeError: string | null } {
  try {
    const envelope = parseEnvelope(spikeExecutor("unused", BUDGET_USD, DROP), raw, true);
    return { reply: JSON.parse(envelope.resultText) as Reply, costUsd: envelope.cost, envelopeError: null };
  } catch (err) {
    return { reply: null, costUsd: null, envelopeError: (err as Error).message };
  }
}
const { reply, costUsd, envelopeError } = readReply();

// The boundary, as the build would run it.
const agentStatus = worktreeStatus();
const ignoredRemoved = removeIgnoredOutput();
const lockfileTouchedByAgent = git(["status", "--porcelain", "--", "package-lock.json"]) !== "";
if (lockfileTouchedByAgent) git(["checkout", BASE, "--", "package-lock.json"]);
const diff = stagedPathsSinceBase();
const gate = gatePatchPaths(diff.paths, scope, SLUG);
const added = [...dependencyNames(readFileSync(join(WORKTREE, "frontend", "package.json"), "utf8"))].filter(
  (name) => !dependencyNames(git(["show", `${BASE}:frontend/package.json`])).has(name)
);

let derived: { exitCode: number | null; elapsedMs: number; tail: string } | null = null;
let lockfileEntries: Record<string, boolean> = {};
let lockfileChanged = false;
let commit: string | null = null;
const verification: { command: string; exitCode: number | null; elapsedMs: number; tail: string }[] = [];
const completed = reply?.status === "completed";

if (completed && gate.ok && diff.paths.length > 0) {
  const derivedSandbox = createSandbox({ worktree: WORKTREE, name: `${label}-derived` });
  try {
    const run = execInSandbox(derivedSandbox, DERIVED, { timeoutSeconds: 300 });
    derived = { exitCode: run.exitCode, elapsedMs: run.elapsedMs, tail: `${run.stdout}${run.stderr}`.slice(-4000) };
  } finally {
    destroySandbox(derivedSandbox);
  }
  removeIgnoredOutput();
  const lock = JSON.parse(readFileSync(join(WORKTREE, "package-lock.json"), "utf8")) as { packages?: Record<string, unknown> };
  const keys = new Set(Object.keys(lock.packages ?? {}));
  lockfileEntries = Object.fromEntries(added.map((name) => [name, keys.has(`node_modules/${name}`) || keys.has(`frontend/node_modules/${name}`)]));
  lockfileChanged = git(["status", "--porcelain", "--", "package-lock.json"]) !== "";
  if (derived.exitCode === 0) {
    git(["add", "-A"]);
    git(["-c", "user.name=bw-spike", "-c", "user.email=spike@localhost", "commit", "-q", "-m", "spike: run 6 phase 2 in tool mode, lockfile regenerated"]);
    commit = git(["rev-parse", "HEAD"]);
    const verifySandbox = createSandbox({ worktree: WORKTREE, name: `${label}-verify` });
    try {
      for (const command of VERIFY) {
        const run = execInSandbox(verifySandbox, command, { timeoutSeconds: 600 });
        verification.push({ command, exitCode: run.exitCode, elapsedMs: run.elapsedMs, tail: `${run.stdout}${run.stderr}`.slice(-4000) });
        if (run.exitCode !== 0) break;
      }
    } finally {
      destroySandbox(verifySandbox);
    }
    removeIgnoredOutput();
  }
}
if (commit === null) {
  // Nothing committed: leave the worktree at the base for inspection-free reruns.
  git(["reset", "-q", "--hard", BASE]);
  git(["clean", "-fdxq"]);
}

const criterion7 =
  completed && diff.paths.length > 0 && gate.ok && added.length > 0 && derived?.exitCode === 0 &&
  lockfileChanged && Object.values(lockfileEntries).every(Boolean) && commit !== null;
const allowedEnv = new Set([...imageEnvNames(), "HOSTNAME", "PWD", "HOME", "HTTPS_PROXY", "HTTP_PROXY", "npm_config_proxy", "npm_config_https_proxy", "SHLVL", "_", "OLDPWD"]);
const envClean = containerEnvNames.length > 0 && containerEnvNames.every((n) => allowedEnv.has(n));
const toolServerLog = existsSync(logPath)
  ? readFileSync(logPath, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { event?: string; tool?: string; args?: { command?: string } })
  : [];
const toolCalls = toolServerLog.filter((r) => r.event === "started");
const agentRanNpmInstall = toolCalls.some((r) => r.tool === "run_command" && /npm (install|i|ci)\b/.test(r.args?.command ?? ""));

const fixture = writeFixture("sandbox-spike-crew-chatter-phase-2.json", {
  provenance: {
    plan: "docs/features/sandboxed-implementer-spike/plan.md, Task 6",
    consent,
    dispatchedAt,
    capturedAt: new Date().toISOString(),
    model: MODEL,
    effort: EFFORT,
    budgetUsd: BUDGET_USD,
    droppedFlags: DROP,
    command: spikeExecutor("<mcp config>", BUDGET_USD, DROP).command,
    versions: versions(),
    worktreeBase: BASE,
    retainedPrompt: { path: RETAINED_PROMPT, sha256: RETAINED_SHA256 },
    promptSha256: sha256Hex(prompt),
    preamble: PREAMBLE,
    rawRetainedAt: rawPath,
    dropped: "Partial-message (stream_event) lines; tool inputs and results longer than 4000 characters are cut, marked where cut.",
  },
  criteria: {
    7: { pass: criterion7, completed, changedPaths: diff.paths, symlinks: diff.symlinks, gate, addedDependencies: added, derived, lockfileChanged, lockfileEntries, commit },
    3: { pass: envClean, containerEnvNames },
  },
  measurements: {
    costUsd,
    durationMs: outcome?.durationMs ?? null,
    turns: stream.result?.num_turns ?? null,
    toolCalls: toolCalls.length,
    toolCallsByName: toolCalls.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.tool ?? "?"]: (acc[r.tool ?? "?"] ?? 0) + 1 }), {}),
    agentRanNpmInstall,
    lockfileTouchedByAgent,
    agentStatus,
    ignoredRemoved,
    recordedOneShot: RECORDED_PHASE,
    recordedPhasePaths: git(["diff", "--name-only", `${BASE}..${RECORDED_PHASE.commit}`]).split("\n"),
    verification,
  },
  reply,
  envelopeError,
  harness: outcome && {
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    timedOut: outcome.timedOut,
    spawnError: outcome.spawnError,
    stderr: outcome.stderr.slice(-4000),
  },
  init: stream.init,
  toolUses: capStrings(stream.toolUses),
  toolResults: capStrings(stream.toolResults),
  resultLine: stream.result,
  toolServerLog: capStrings(toolServerLog),
});
process.stdout.write(
  `criterion 7: ${criterion7 ? "pass" : "FAIL"} (status ${reply?.status ?? "none"}, paths ${diff.paths.length}, gate ${gate.ok ? "ok" : "refused"}, added [${added.join(",")}], derived exit ${derived?.exitCode ?? "-"}, lockfile changed ${lockfileChanged}, commit ${commit ?? "none"})\n` +
    `criterion 3 live: ${envClean ? "pass" : "FAIL"}\n` +
    `cost: ${costUsd ?? stream.result?.total_cost_usd ?? "unknown"}  duration: ${outcome?.durationMs ?? "?"} ms  tool calls: ${toolCalls.length}\n` +
    `verification: ${verification.map((v) => `${v.command}=${v.exitCode} (${v.elapsedMs} ms)`).join(", ") || "not run"}\n${fixture}\n`
);
process.exitCode = criterion7 && envClean ? 0 : 1;
