import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_CODE, type ExecutorDefinition } from "../../src/executor.ts";
import { GOVERNANCE_DIR, worktreePath } from "../../src/paths.ts";
import { openDatabase } from "../../src/sqlite.ts";
import { SPIKE_IMAGE, docker } from "./docker-sandbox.ts";

/**
 * What every spike driver shares (docs/features/sandboxed-implementer-spike/plan.md):
 * the scratch target and its worktree, run 6's signed scope, the host-side Git
 * calls the boundary makes, and the fixture writer. The scratch target is a
 * clone of crew-chatter made in Task 1, with the worktree in the stage's own
 * shape at run 6's phase 2 base.
 */

export const TARGET = "C:\\Repositories\\testing-repos\\sandbox-spike\\crew-chatter";
export const WORKTREE = worktreePath(TARGET, 1);
export const BASE = "12d3bb205747f0d38777599c338664e23deea33e";
export const SLUG = "crew-chatter-accounts-notes";
export const SPIKE_STATE = join(TARGET, GOVERNANCE_DIR, "spike");
export const TOOL_SERVER = join(import.meta.dirname, "tool-server.ts");
const RUN_6_STORE = join("C:\\Repositories\\testing-repos\\crew-chatter", GOVERNANCE_DIR, "state.db");
const RECORDED = join(import.meta.dirname, "..", "..", "test", "fixtures", "recorded");

/** Run 6's signed scope: the `approval.scope` JSON array, read without a writer. */
export function readRun6Scope(): string[] {
  const db = openDatabase(RUN_6_STORE, { readOnly: true });
  try {
    const row = db.prepare("SELECT scope FROM approval WHERE run_id = 6").get() as { scope: string } | undefined;
    if (!row) throw new Error("run 6 has no approval row");
    const scope: unknown = JSON.parse(row.scope);
    if (!Array.isArray(scope) || !scope.every((s) => typeof s === "string")) {
      throw new Error("run 6's approval.scope is not a JSON array of paths");
    }
    return scope;
  } finally {
    db.close();
  }
}

export function git(args: string[]): string {
  const result = spawnSync("git", ["-C", WORKTREE, ...args], { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.status}): ${(result.stderr ?? "").trim()}`);
  }
  return (result.stdout ?? "").trim();
}

/** Stage everything and return the paths that differ from the phase base, as the boundary computes them. */
export function stagedPathsSinceBase(): { paths: string[]; symlinks: string[] } {
  git(["add", "-A"]);
  const paths = git(["diff", "--cached", "--name-only", BASE]).split("\n").filter((p) => p !== "");
  const raw = git(["diff", "--cached", "--raw", BASE]).split("\n").filter((l) => l !== "");
  const symlinks = raw
    .filter((line) => line.split(" ")[1] === "120000")
    .map((line) => line.split("\t")[1] ?? "");
  return { paths, symlinks };
}

/** Put the worktree back at the phase base with nothing untracked or ignored. */
export function resetWorktree(): void {
  git(["reset", "-q", "--hard", BASE]);
  git(["clean", "-fdxq"]);
}

export function worktreeStatus(): string {
  return git(["status", "--porcelain", "--ignored"]);
}

export function ensureSpikeState(): void {
  mkdirSync(SPIKE_STATE, { recursive: true });
}

export function versions(): Record<string, string> {
  const claude = spawnSync("claude", ["--version"], { encoding: "utf8", shell: false });
  return {
    docker: docker(["version", "--format", "{{.Server.Version}}"]).stdout.trim(),
    image: SPIKE_IMAGE,
    imageId: docker(["image", "inspect", "--format", "{{.Id}}", SPIKE_IMAGE]).stdout.trim(),
    claude: (claude.stdout ?? "").trim(),
    node: process.version,
  };
}

/** The image's own environment variable names, from its config rather than from memory. */
export function imageEnvNames(): string[] {
  const env = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Env}}", SPIKE_IMAGE]).stdout) as string[];
  return env.map((assignment) => assignment.slice(0, assignment.indexOf("=")));
}

/**
 * The reply both paid sessions return through `--json-schema`: a summary, not
 * file contents. The diff is computed from the checkout, never reported.
 */
export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "blocked"] },
    summary: { type: "string" },
    incompleteTasks: { type: "array", items: { type: "string" } },
  },
  required: ["status", "summary", "incompleteTasks"],
  additionalProperties: false,
};

/**
 * The spike's executor: today's read-only definition with BuildWorks' tool
 * server admitted. `mcp__*` leaves `--disallowedTools`, because it would deny
 * the server's own tools; Bash, Write, Edit and NotebookEdit stay denied, and
 * `--safe-mode` stays on.
 */
export const DROPPABLE_FLAGS = ["--safe-mode", "--restricted", "--strict-mcp-config"];

/**
 * `drop` removes named single-token flags, for the probes that isolate which
 * flag discards the tool server (spike record, Task 5). It is diagnostic: the
 * plan's command is the one with nothing dropped.
 */
export function spikeExecutor(mcpConfigPath: string, budgetUsd: string, drop: string[] = []): ExecutorDefinition {
  for (const flag of drop) {
    if (!DROPPABLE_FLAGS.includes(flag)) throw new Error(`cannot drop ${flag}; droppable: ${DROPPABLE_FLAGS.join(", ")}`);
  }
  return {
    ...CLAUDE_CODE,
    id: "claude-code-spike",
    command: [
      "claude", "-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose",
      "--restricted", "--safe-mode",
      "--tools", "Read,Glob,Grep",
      "--disallowedTools", "Write,Edit,NotebookEdit,Bash",
      "--mcp-config", mcpConfigPath, "--strict-mcp-config",
      "--allowedTools", "mcp__bw__*",
      "--permission-mode", "dontAsk",
      "--no-session-persistence",
      "--max-budget-usd", budgetUsd,
    ].filter((token) => !drop.includes(token)),
  };
}

/** The MCP config naming the tool server by absolute interpreter path (hazard 9). */
export function writeMcpConfig(label: string, workContainer: string, logPath: string): string {
  const path = join(SPIKE_STATE, `${label}-mcp.json`);
  const config = {
    mcpServers: {
      bw: {
        type: "stdio",
        command: process.execPath,
        args: [TOOL_SERVER, "--container", workContainer, "--log", logPath, "--timeout", "300"],
      },
    },
  };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

export interface StreamSummary {
  init: Record<string, unknown> | null;
  toolUses: { id: string; name: string; input: unknown }[];
  toolResults: { toolUseId: string; isError: boolean; content: string }[];
  result: Record<string, unknown> | null;
  messages: Record<string, unknown>[];
}

/** Read the retained stream: the init line, tool calls and results, and the result line. Partial-message events are dropped. */
export function summarizeStream(raw: string): StreamSummary {
  const summary: StreamSummary = { init: null, toolUses: [], toolResults: [], result: null, messages: [] };
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type === "stream_event") continue;
    if (event.type === "system" && event.subtype === "init") summary.init = event;
    if (event.type === "result") summary.result = event;
    if (event.type === "assistant" || event.type === "user") {
      summary.messages.push(event);
      const content = ((event.message as { content?: unknown })?.content ?? []) as Record<string, unknown>[];
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type === "tool_use") {
          summary.toolUses.push({ id: String(block.id), name: String(block.name), input: block.input });
        }
        if (block.type === "tool_result") {
          const text = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
          summary.toolResults.push({ toolUseId: String(block.tool_use_id), isError: block.is_error === true, content: text });
        }
      }
    }
  }
  return summary;
}

/** Cap long strings in recorded messages, so a fixture keeps the shape without every file body. */
export function capStrings(value: unknown, limit = 4000): unknown {
  if (typeof value === "string") return value.length > limit ? `${value.slice(0, limit)}[... ${value.length - limit} more characters dropped]` : value;
  if (Array.isArray(value)) return value.map((v) => capStrings(v, limit));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, capStrings(v, limit)]));
  }
  return value;
}

/**
 * Remove the ignored output an agent or a command left in the worktree. Git
 * on the host names the paths, and a container deletes them, because the
 * Linux symlinks `npm` creates on the bind mount cannot be opened from
 * Windows (Task 1). Returns the removed paths.
 */
export function removeIgnoredOutput(): string[] {
  const ignored = spawnSync("git", ["-C", WORKTREE, "status", "--porcelain", "--ignored"], { encoding: "utf8", shell: false });
  const paths = (ignored.stdout ?? "")
    .split("\n")
    .filter((l) => l.startsWith("!! "))
    .map((l) => l.slice(3).replace(/\/$/, ""));
  if (paths.length === 0) return [];
  const removal = docker([
    "run", "--rm", "--network", "none", "--user", "node",
    "-v", `${WORKTREE}:/work`, "-w", "/work",
    SPIKE_IMAGE, "sh", "-c", 'rm -rf -- "$@"', "sh", ...paths,
  ], { timeoutMs: 600_000 });
  if (removal.status !== 0) throw new Error(`removing ignored output failed: ${removal.stderr.trim()}`);
  return paths;
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Write a recorded fixture once; a rerun never overwrites recorded evidence. */
export function writeFixture(name: string, value: object): string {
  const path = join(RECORDED, name);
  if (existsSync(path)) throw new Error(`refusing to overwrite recorded evidence: ${path}`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
