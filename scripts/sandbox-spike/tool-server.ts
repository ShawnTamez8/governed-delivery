import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { execInSandbox, type ExecResult } from "./docker-sandbox.ts";

/**
 * BuildWorks' tool server for the sandboxed-implementer spike
 * (docs/features/sandboxed-implementer-spike/plan.md, Task 2): an MCP server
 * over stdio, written by hand with newline-delimited JSON-RPC 2.0 and no SDK.
 * Its four tools act only inside the work container it is named. It never
 * touches run state, and it does not check which client is calling.
 *
 * Every call is logged as `started` before it runs, then as `finished` or
 * `refused`. A path that is absolute, climbs with `..`, or names `.git` is
 * refused by name before any `docker` call.
 *
 *   node scripts/sandbox-spike/tool-server.ts --container <work> --log <file> --timeout <seconds>
 */

const { values } = parseArgs({
  options: {
    container: { type: "string" },
    log: { type: "string" },
    timeout: { type: "string" },
  },
});
if (!values.container || !values.log || !values.timeout) {
  process.stderr.write("usage: tool-server.ts --container <work> --log <file> --timeout <seconds>\n");
  process.exit(2);
}
const CONTAINER = values.container;
const LOG = values.log;
const TIMEOUT_SECONDS = Number(values.timeout);
const OUTPUT_LIMIT = 200_000;
const ERROR_TAIL = 8_192;

let seq = 0;
function log(record: Record<string, unknown>): void {
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

log({ event: "start", container: CONTAINER, timeoutSeconds: TIMEOUT_SECONDS, envNames: Object.keys(process.env).sort() });

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

const TOOLS: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and directories under a path in the checkout, three levels deep, skipping node_modules.",
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
      "Run a shell command with sh in the checkout root, inside a Linux container with Node and npm. The npm registry is the only reachable network host. The command is killed at the time ceiling.",
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
  exec?: ExecResult;
}

function containerPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  return segments.length === 0 ? "/work" : `/work/${segments.join("/")}`;
}

function fromExec(exec: ExecResult, success: string): ToolOutcome {
  if (exec.ceilingFired) {
    return { text: `command killed at the ${TIMEOUT_SECONDS} s ceiling`, isError: true, exec };
  }
  if (exec.exitCode !== 0) {
    const output = `${exec.stdout}${exec.stderr}`;
    return { text: `exit code ${exec.exitCode}\n${output.slice(-ERROR_TAIL)}`, isError: true, exec };
  }
  const text = success.length > OUTPUT_LIMIT ? `${success.slice(0, OUTPUT_LIMIT)}\n[truncated at ${OUTPUT_LIMIT} characters]` : success;
  return { text, isError: false, exec };
}

function runTool(name: string, args: Record<string, unknown>): ToolOutcome {
  const sandbox = { work: CONTAINER };
  const options = { timeoutSeconds: TIMEOUT_SECONDS };
  switch (name) {
    case "list_files": {
      const exec = execInSandbox(
        sandbox,
        `find "$1" -maxdepth 3 -not -path '*/node_modules*' -not -path '/work/.git'`,
        { ...options, args: [containerPath(String(args.path))] }
      );
      return fromExec(exec, exec.stdout.replaceAll("/work/", "").replace(/^\/work$/m, "."));
    }
    case "read_file": {
      const exec = execInSandbox(sandbox, `cat -- "$1"`, { ...options, args: [containerPath(String(args.path))] });
      return fromExec(exec, exec.stdout);
    }
    case "write_file": {
      if (typeof args.content !== "string") return { text: "content must be a string", isError: true };
      const exec = execInSandbox(sandbox, `mkdir -p -- "$(dirname -- "$1")" && cat > "$1"`, {
        ...options,
        stdin: args.content,
        args: [containerPath(String(args.path))],
      });
      return fromExec(exec, `wrote ${String(args.path)} (${Buffer.byteLength(args.content)} bytes)`);
    }
    case "run_command": {
      if (typeof args.command !== "string" || args.command.trim() === "") {
        return { text: "command must be a non-empty string", isError: true };
      }
      const exec = execInSandbox(sandbox, args.command, options);
      return fromExec(exec, `exit code 0\n${exec.stdout}${exec.stderr}`);
    }
    default:
      return { text: `unknown tool: ${name}`, isError: true };
  }
}

function handleCall(params: { name?: unknown; arguments?: unknown }): ToolOutcome {
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
  const outcome = runTool(name, args);
  log({
    event: "finished",
    seq: id,
    tool: name,
    isError: outcome.isError,
    exitCode: outcome.exec?.exitCode ?? null,
    ceilingFired: outcome.exec?.ceilingFired ?? false,
    elapsedMs: outcome.exec?.elapsedMs ?? null,
  });
  return outcome;
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

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim() === "") return;
  let request: RpcRequest;
  try {
    request = JSON.parse(line) as RpcRequest;
  } catch {
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
        serverInfo: { name: "bw", version: "spike-1" },
      });
      return;
    case "ping":
      reply({});
      return;
    case "tools/list":
      reply({ tools: TOOLS });
      return;
    case "tools/call": {
      const outcome = handleCall((request.params ?? {}) as { name?: unknown; arguments?: unknown });
      reply({ content: [{ type: "text", text: outcome.text }], isError: outcome.isError });
      return;
    }
    default:
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `method not found: ${request.method}` } });
  }
});
