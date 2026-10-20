import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { DOCKER_CLIENT_ENV, execCaptured, runInSandbox, type CapturedExec, type ExecTarget } from "./container.ts";

/**
 * BuildWorks' tool server (docs/features/sandboxed-implementer/plan.md,
 * promoted from the spike's `scripts/sandbox-spike/tool-server.ts`): an MCP
 * server over stdio, written by hand with newline-delimited JSON-RPC 2.0 and no
 * SDK. Its four tools act only inside the work container it is named. It never
 * touches run state, and it does not check which client is calling, so it is
 * agent-neutral: the Claude-specific invocation lives in `src/harness.ts`.
 *
 * Every call is logged as `started` before it runs, then as `finished`,
 * `refused` or `error`. A path that is absolute, climbs with `..`, or names
 * `.git` is refused by name before any Docker call. A handler that throws is
 * logged with its arguments and stack and answered as an error carrying the
 * message; an unparseable line is logged with its first 200 characters and
 * answered with JSON-RPC error -32700; a process-level exception is logged and
 * the process exits non-zero, so the client reports the server as failed
 * rather than hanging.
 *
 *   node src/tool-server.ts --container <work id> --docker <json argv> --docker-env <json object> --log <file> --timeout <seconds>
 *
 * `--docker` is the run's frozen `sandbox.dockerCommand` and `--docker-env` the
 * stage's `DOCKER_CLIENT_ENV` values, which this process's environment does not
 * carry, so the server runs the same Docker against the same engine as the
 * stage does.
 */

const USAGE = "usage: tool-server.ts --container <work id> --docker <json argv> --docker-env <json object> --log <file> --timeout <seconds>\n";
const { values } = parseArgs({
  options: {
    container: { type: "string" },
    docker: { type: "string" },
    "docker-env": { type: "string" },
    log: { type: "string" },
    timeout: { type: "string" },
  },
});
if (!values.container || !values.docker || values["docker-env"] === undefined || !values.log || !values.timeout) {
  process.stderr.write(USAGE);
  process.exit(2);
}
let dockerEnv: unknown;
try {
  dockerEnv = JSON.parse(values["docker-env"]);
} catch (err) {
  process.stderr.write(`--docker-env is not JSON: ${(err as Error).message}\n`);
  process.exit(2);
}
if (
  typeof dockerEnv !== "object" || dockerEnv === null || Array.isArray(dockerEnv) ||
  !Object.entries(dockerEnv).every(([name, value]) => DOCKER_CLIENT_ENV.includes(name) && typeof value === "string")
) {
  process.stderr.write(`--docker-env must be a JSON object of strings named among ${DOCKER_CLIENT_ENV.join(", ")}\n`);
  process.exit(2);
}
// Every Docker client this process spawns inherits them.
Object.assign(process.env, dockerEnv);
const LOG = values.log;
const TIMEOUT_SECONDS = Number(values.timeout);
let dockerCommand: unknown;
try {
  dockerCommand = JSON.parse(values.docker);
} catch (err) {
  process.stderr.write(`--docker is not JSON: ${(err as Error).message}\n`);
  process.exit(2);
}
if (!Array.isArray(dockerCommand) || dockerCommand.length === 0 || !dockerCommand.every((t) => typeof t === "string" && t !== "")) {
  process.stderr.write("--docker must be a JSON array of non-empty strings\n");
  process.exit(2);
}
if (!Number.isInteger(TIMEOUT_SECONDS) || TIMEOUT_SECONDS <= 0) {
  process.stderr.write(`--timeout must be a positive integer, found ${JSON.stringify(values.timeout)}\n`);
  process.exit(2);
}
const TARGET: ExecTarget = { dockerCommand: dockerCommand as string[], work: values.container };
/** The most characters a tool answer carries; the retained evidence keeps everything. */
const ANSWER_LIMIT = 200_000;
/** The most bytes a file tool reads into memory. */
const CAPTURE_MAX_BYTES = 8 * 1024 * 1024;
/** The run_command in-memory budget and its evidence-file ceiling (`runVerifyCommand`). */
const COMMAND_MAX_BYTES = 1024 * 1024;
const COMMAND_RETENTION_MAX_BYTES = 64 * 1024 * 1024;
const ERROR_TAIL = 8_192;

let seq = 0;
function log(record: Record<string, unknown>): void {
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

process.on("uncaughtException", (err) => {
  try {
    log({ event: "fatal", kind: "uncaughtException", message: err.message, stack: err.stack });
  } finally {
    process.stderr.write(`tool server failed: ${err.stack ?? err.message}\n`);
    process.exit(1);
  }
});
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  try {
    log({ event: "fatal", kind: "unhandledRejection", message, stack: reason instanceof Error ? reason.stack : undefined });
  } finally {
    process.stderr.write(`tool server failed: ${message}\n`);
    process.exit(1);
  }
});

log({ event: "start", container: TARGET.work, docker: TARGET.dockerCommand, timeoutSeconds: TIMEOUT_SECONDS, envNames: Object.keys(process.env).sort() });

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and directories under a path in the checkout, three levels deep.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "A checkout-relative directory; '.' for the root." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read one file in the checkout.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "A checkout-relative file path." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Create or replace one file in the checkout with the given content, creating its directories.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "A checkout-relative file path." },
        content: { type: "string", description: "The complete new file content." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "run_command",
    description:
      "Run a shell command with sh in the checkout root, inside the run's Linux container. Only the network hosts the run allows are reachable. The command is killed at the time ceiling.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string", description: "The shell command." } },
      required: ["command"],
      additionalProperties: false,
    },
  },
];

/** The refusal reason for a path argument, or null when the path is usable. */
function pathRefusal(path: unknown): string | null {
  if (typeof path !== "string" || path.trim() === "") return "path must be a non-empty string";
  const p = path.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return `path must be relative to the checkout: ${path}`;
  const segments = p.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.includes("..")) return `path escapes the checkout: ${path}`;
  if (segments[0]?.toLowerCase() === ".git") return `the checkout's .git is not writable or readable through this tool: ${path}`;
  return null;
}

interface ToolOutcome {
  text: string;
  isError: boolean;
  exitCode: number | null;
  ceilingFired: boolean;
  elapsedMs: number | null;
}

function containerPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  return segments.length === 0 ? "/work" : `/work/${segments.join("/")}`;
}

function cap(text: string): string {
  return text.length > ANSWER_LIMIT ? `${text.slice(0, ANSWER_LIMIT)}\n[truncated at ${ANSWER_LIMIT} characters]` : text;
}

function fromCaptured(exec: CapturedExec, success: string): ToolOutcome {
  const facts = { exitCode: exec.exitCode, ceilingFired: exec.ceilingFired, elapsedMs: exec.elapsedMs };
  if (exec.ceilingFired) {
    return { text: `command killed at the ${TIMEOUT_SECONDS} s ceiling`, isError: true, ...facts };
  }
  if (exec.exitCode !== 0) {
    return { text: `exit code ${exec.exitCode}\n${`${exec.stdout}${exec.stderr}`.slice(-ERROR_TAIL)}`, isError: true, ...facts };
  }
  return { text: cap(success), isError: false, ...facts };
}

async function runTool(name: string, args: Record<string, unknown>, id: number): Promise<ToolOutcome> {
  const options = { timeoutSeconds: TIMEOUT_SECONDS, maxBytes: CAPTURE_MAX_BYTES };
  switch (name) {
    case "list_files": {
      const exec = await execCaptured(
        TARGET,
        ["sh", "-c", `find "$1" -maxdepth 3 -not -path '/work/.git'`, "sh", containerPath(String(args.path))],
        options
      );
      // The mount prefix, once at the start of each line: a directory named
      // `work` inside the checkout keeps its name.
      return fromCaptured(exec, exec.stdout.replace(/^\/work\//gm, "").replace(/^\/work$/m, "."));
    }
    case "read_file": {
      const exec = await execCaptured(TARGET, ["cat", "--", containerPath(String(args.path))], options);
      return fromCaptured(exec, exec.stdout);
    }
    case "write_file": {
      if (typeof args.content !== "string") {
        return { text: "content must be a string", isError: true, exitCode: null, ceilingFired: false, elapsedMs: null };
      }
      const exec = await execCaptured(
        TARGET,
        ["sh", "-c", `mkdir -p -- "$(dirname -- "$1")" && cat > "$1"`, "sh", containerPath(String(args.path))],
        { ...options, stdin: args.content }
      );
      return fromCaptured(exec, `wrote ${String(args.path)} (${Buffer.byteLength(args.content)} bytes)`);
    }
    case "run_command": {
      if (typeof args.command !== "string" || args.command.trim() === "") {
        return { text: "command must be a non-empty string", isError: true, exitCode: null, ceilingFired: false, elapsedMs: null };
      }
      const evidencePath = LOG.replace(/\.jsonl$/, "") + `-call-${id}.log`;
      const outcome = await runInSandbox(TARGET, null, { name: `call-${id}`, command: ["sh", "-c", args.command] }, {
        cwd: process.cwd(),
        timeoutSeconds: TIMEOUT_SECONDS,
        maxBytes: COMMAND_MAX_BYTES,
        retentionMaxBytes: COMMAND_RETENTION_MAX_BYTES,
        evidencePath,
      });
      const facts = { exitCode: outcome.exitCode, ceilingFired: outcome.timedOut, elapsedMs: outcome.durationMs };
      const output = `${outcome.stdout}${outcome.stderr}`;
      if (outcome.timedOut) {
        return { text: `command killed at the ${TIMEOUT_SECONDS} s ceiling`, isError: true, ...facts };
      }
      const overflow = outcome.outputOverflow ? `\n[output exceeded ${COMMAND_MAX_BYTES} bytes; the rest is retained at ${evidencePath}]` : "";
      if (outcome.exitCode !== 0) {
        return { text: `exit code ${outcome.exitCode}\n${output.slice(-ERROR_TAIL)}${overflow}`, isError: true, ...facts };
      }
      return { text: cap(`exit code 0\n${output}${overflow}`), isError: false, ...facts };
    }
    default:
      return { text: `unknown tool: ${name}`, isError: true, exitCode: null, ceilingFired: false, elapsedMs: null };
  }
}

async function handleCall(params: { name?: unknown; arguments?: unknown }): Promise<{ text: string; isError: boolean }> {
  const name = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const id = ++seq;
  const logged = name === "write_file" ? { path: args.path, contentBytes: typeof args.content === "string" ? Buffer.byteLength(args.content) : null } : args;
  log({ event: "started", seq: id, tool: name, args: logged });
  if (name !== "run_command" && TOOLS.some((t) => t.name === name)) {
    const refusal = pathRefusal(args.path);
    if (refusal !== null) {
      log({ event: "refused", seq: id, tool: name, reason: refusal });
      return { text: `refused: ${refusal}`, isError: true };
    }
  }
  try {
    const outcome = await runTool(name, args, id);
    log({
      event: "finished",
      seq: id,
      tool: name,
      isError: outcome.isError,
      exitCode: outcome.exitCode,
      ceilingFired: outcome.ceilingFired,
      elapsedMs: outcome.elapsedMs,
    });
    return { text: outcome.text, isError: outcome.isError };
  } catch (err) {
    const error = err as Error;
    log({ event: "error", seq: id, tool: name, args: logged, message: error.message, stack: error.stack });
    return { text: `tool ${name} failed: ${error.message}`, isError: true };
  }
}

function send(message: object): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

async function handleLine(line: string): Promise<void> {
  let request: RpcRequest;
  try {
    request = JSON.parse(line) as RpcRequest;
  } catch (err) {
    log({ event: "unparseable", head: line.slice(0, 200), message: (err as Error).message });
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  if (request.id === undefined) return; // a notification, such as notifications/initialized
  const reply = (result: object) => send({ jsonrpc: "2.0", id: request.id, result });
  switch (request.method) {
    case "initialize":
      reply({
        protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "bw", version: "1" },
      });
      return;
    case "ping":
      reply({});
      return;
    case "tools/list":
      reply({ tools: TOOLS });
      return;
    case "tools/call": {
      const outcome = await handleCall((request.params ?? {}) as { name?: unknown; arguments?: unknown });
      reply({ content: [{ type: "text", text: outcome.text }], isError: outcome.isError });
      return;
    }
    default:
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `method not found: ${request.method}` } });
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim() === "") return;
  // A rejection here reaches the process-level handler, which logs and exits.
  void handleLine(line);
});
