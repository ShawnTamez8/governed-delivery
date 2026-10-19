import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { CLAUDE_CODE } from "../../src/executor.ts";
import { buildHarnessEnvironment } from "../../src/harness.ts";
import { gatePatchPaths } from "../../src/implementation-gate.ts";
import { GOVERNANCE_DIR } from "../../src/paths.ts";
import { createSandbox, destroySandbox, docker, type Sandbox } from "./docker-sandbox.ts";
import {
  BASE,
  SLUG,
  SPIKE_STATE,
  TARGET,
  TOOL_SERVER,
  WORKTREE,
  ensureSpikeState,
  git,
  imageEnvNames,
  readRun6Scope,
  resetWorktree,
  stagedPathsSinceBase,
  versions,
  worktreeStatus,
  writeFixture,
} from "./spike-target.ts";

/**
 * The free boundary checks (docs/features/sandboxed-implementer-spike/plan.md,
 * Task 3): criteria 2, 3, 4, 5, 6, 8 and 9, each an attempted violation that
 * must fail beside a positive control that must succeed. No model is called.
 * The driver speaks MCP to the tool server over stdio, as Claude Code would.
 *
 *   node scripts/sandbox-spike/boundary-checks.ts [--fixture <name>]
 *
 * The fixture name defaults to `sandbox-spike-boundary.json`; a rerun names a
 * new one, because recorded evidence is never overwritten.
 */

const FIXTURE_NAME = parseArgs({ options: { fixture: { type: "string" } } }).values.fixture ?? "sandbox-spike-boundary.json";

interface CallResult {
  text: string;
  isError: boolean;
  elapsedMs: number;
}

class McpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();
  private nextId = 1;

  constructor(args: string[], env: Record<string, string>) {
    this.child = spawn(process.execPath, [TOOL_SERVER, ...args], { env, shell: false, windowsHide: true });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      const resolve = this.pending.get(message.id as number);
      if (resolve) {
        this.pending.delete(message.id as number);
        resolve(message);
      }
    });
  }

  request(method: string, params: object = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  async call(name: string, args: object): Promise<CallResult> {
    const started = Date.now();
    const reply = await this.request("tools/call", { name, arguments: args });
    const result = reply.result as { content: { text: string }[]; isError: boolean };
    return { text: result.content.map((c) => c.text).join(""), isError: result.isError, elapsedMs: Date.now() - started };
  }

  close(): void {
    this.child.stdin.end();
  }
}

interface Check {
  criterion: number;
  name: string;
  pass: boolean;
  evidence: unknown;
}

const checks: Check[] = [];
function record(criterion: number, name: string, pass: boolean, evidence: unknown): void {
  checks.push({ criterion, name, pass, evidence });
  process.stdout.write(`${pass ? "pass" : "FAIL"}  ${criterion}  ${name}\n`);
}

function envNames(text: string, separator: string): string[] {
  return text
    .split(separator)
    .filter((entry) => entry.includes("="))
    .map((entry) => entry.slice(0, entry.indexOf("=")))
    .sort();
}

async function main(): Promise<void> {
  if (worktreeStatus() !== "" || git(["rev-parse", "HEAD"]) !== BASE) {
    throw new Error(`the worktree must be clean at ${BASE} before the checks start`);
  }
  ensureSpikeState();
  const token = randomBytes(8).toString("hex");
  const canary = join(TARGET, GOVERNANCE_DIR, `canary-${token}.txt`);
  writeFileSync(canary, token);
  const credentialCanaries: Record<string, string> = {
    ANTHROPIC_API_KEY: `spike-canary-${token}-anthropic`,
    CLAUDE_CODE_OAUTH_TOKEN: `spike-canary-${token}-oauth`,
    SYSTEMONE_API_KEY: `spike-canary-${token}-systemone`,
  };
  const serverEnv = { ...buildHarnessEnvironment(CLAUDE_CODE), ...credentialCanaries };
  const logPath = join(SPIKE_STATE, `boundary-tool-server-${token}.jsonl`);
  const shortLogPath = join(SPIKE_STATE, `boundary-tool-server-10s-${token}.jsonl`);
  const scope = readRun6Scope();
  const gitFileBefore = readFileSync(join(WORKTREE, ".git"), "utf8");

  let sandbox: Sandbox | undefined;
  let server: McpClient | undefined;
  let shortServer: McpClient | undefined;
  let proxyLog = "";
  try {
    sandbox = createSandbox({ worktree: WORKTREE, name: `boundary-${token}` });
    server = new McpClient(["--container", sandbox.work, "--log", logPath, "--timeout", "60"], serverEnv);
    shortServer = new McpClient(["--container", sandbox.work, "--log", shortLogPath, "--timeout", "10"], serverEnv);

    // Criterion 9's handshake: the server answers MCP as a client expects.
    const init = await server.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "boundary-checks", version: "1" },
    });
    server.notify("notifications/initialized");
    const tools = ((await server.request("tools/list")).result as { tools: { name: string }[] }).tools.map((t) => t.name);
    record(9, "initialize and tools/list answer with the four tools", tools.sort().join(",") === "list_files,read_file,run_command,write_file", { init, tools });
    await shortServer.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "boundary-checks", version: "1" } });

    // Criterion 2: no host path is mounted but the worktree and its read-only .git.
    const mounts = await server.call("run_command", { command: "cat /proc/mounts" });
    const mountPoints = mounts.text.split("\n").slice(1).filter((l) => l.trim() !== "").map((l) => {
      const fields = l.split(" ");
      return { point: fields[1] ?? "", type: fields[2] ?? "", options: fields[3] ?? "" };
    });
    const systemPoint = (p: string) =>
      p === "/" || p === "/etc/resolv.conf" || p === "/etc/hostname" || p === "/etc/hosts" ||
      p.startsWith("/proc") || p.startsWith("/dev") || p.startsWith("/sys");
    const unexpected = mountPoints.filter((m) => !systemPoint(m.point) && m.point !== "/work" && m.point !== "/work/.git");
    const gitMount = mountPoints.find((m) => m.point === "/work/.git");
    record(2, "only the worktree and a read-only .git are mounted from outside the image",
      !mounts.isError && unexpected.length === 0 && gitMount !== undefined && gitMount.options.split(",").includes("ro"),
      { mountPoints, unexpected });

    const canarySearch = await server.call("run_command", {
      command: "find / \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o -name 'canary-*' -print 2>/dev/null; echo END",
    });
    const hostReadsCanary = readFileSync(canary, "utf8") === token;
    record(2, "a canary in the target's .governance/ is invisible inside, and readable on the host",
      hostReadsCanary && canarySearch.text.trim().endsWith("END") && !canarySearch.text.includes("canary-"),
      { canary, hostReadsCanary, search: canarySearch.text });

    const hostPaths = await server.call("run_command", {
      command: "for p in /var/run/docker.sock /mnt/host /host_mnt /run/desktop; do if [ -e \"$p\" ]; then echo \"PRESENT $p\"; fi; done; echo END",
    });
    record(2, "no Docker socket or Docker Desktop host mount is present", !hostPaths.text.includes("PRESENT"), hostPaths.text);

    const credentials = await server.call("run_command", {
      command: "find / \\( -path /proc -o -path /sys \\) -prune -o -name '.credentials.json' -print 2>/dev/null; echo END",
    });
    record(2, "no Claude Code credentials file is reachable", credentials.text.trim() === "exit code 0\nEND", credentials.text);

    // Criterion 3: no provider credential reaches the container's environment.
    const startRecord = JSON.parse(readFileSync(logPath, "utf8").split("\n")[0]!) as { envNames: string[] };
    const canariesOnHost = Object.keys(credentialCanaries).every((n) => startRecord.envNames.includes(n));
    const shellEnv = await server.call("run_command", { command: "env" });
    const initEnv = await server.call("run_command", { command: "tr '\\0' '\\n' < /proc/1/environ" });
    // HOSTNAME and PWD are set by the container runtime for every container;
    // PWD was added after the first run (2026-10-19) showed `docker run` sets
    // it even with no `-w` (the plan's spike record states the amendment).
    const allowed = new Set([...imageEnvNames(), "HOSTNAME", "PWD", ...sandbox.env.map((a) => a.slice(0, a.indexOf("=")))]);
    const shellAllowed = new Set([...allowed, "PWD", "SHLVL", "_", "OLDPWD"]);
    const initNames = envNames(initEnv.text.replace(/^exit code 0\n/, ""), "\n");
    const shellNames = envNames(shellEnv.text.replace(/^exit code 0\n/, ""), "\n");
    const leakedValue = Object.values(credentialCanaries).some((v) => shellEnv.text.includes(v) || initEnv.text.includes(v));
    record(3, "the canary credentials are on the host and nowhere in the container's environment",
      canariesOnHost && !leakedValue &&
        initNames.every((n) => allowed.has(n)) && shellNames.every((n) => shellAllowed.has(n)),
      { hostEnvNames: startRecord.envNames, initNames, shellNames, allowed: [...allowed].sort(), leakedValue });

    // Criterion 4: only the registry is reachable, and only through the proxy.
    const registry = await server.call("run_command", { command: "npm view left-pad version --registry https://registry.npmjs.org/ --fetch-retries=0" });
    record(4, "positive control: the registry answers through the proxy", !registry.isError && /\d+\.\d+\.\d+/.test(registry.text), registry.text);
    const other = await server.call("run_command", { command: "npm view left-pad version --registry https://example.com/ --fetch-retries=0" });
    proxyLog = docker(["logs", sandbox.proxy]).stdout;
    record(4, "another host is refused by the proxy", other.isError && proxyLog.includes('"verdict":"deny","target":"example.com:443"'), { other: other.text, proxyLog });
    const direct = (host: string) =>
      `node -e "require('https').get('https://${host}',{timeout:10000},r=>{console.log('STATUS',r.statusCode)}).on('error',e=>{console.log('ERR',e.code);process.exit(3)}).on('timeout',function(){console.log('ERR timeout');this.destroy()})"`;
    const directExample = await server.call("run_command", { command: direct("example.com") });
    const directProvider = await server.call("run_command", { command: direct("api.anthropic.com") });
    const directIp = await server.call("run_command", {
      command: "node -e \"const s=require('net').connect({host:'1.1.1.1',port:443,timeout:10000},()=>{console.log('CONNECTED');s.end()});s.on('error',e=>{console.log('ERR',e.code);process.exit(3)});s.on('timeout',()=>{console.log('ERR timeout');process.exit(3)})\"",
    });
    record(4, "direct connections fail: example.com, the provider endpoint, and a bare IP",
      [directExample, directProvider, directIp].every((r) => r.isError && r.text.includes("ERR") && !r.text.includes("STATUS") && !r.text.includes("CONNECTED")),
      { example: directExample.text, provider: directProvider.text, ip: directIp.text });

    // Criterion 5: protected and out-of-scope writes are refused at the boundary.
    const governed = readFileSync(join(WORKTREE, "governed.yaml"), "utf8");
    await server.call("write_file", { path: "governed.yaml", content: `${governed}# spike\n` });
    await server.call("write_file", { path: `docs/features/${SLUG}/design.md`, content: "spike\n" });
    await server.call("write_file", { path: "spike-out-of-scope.txt", content: "spike\n" });
    const violating = stagedPathsSinceBase();
    const refused = gatePatchPaths(violating.paths, scope, SLUG);
    resetWorktree();
    const wanted = ["governed.yaml", `docs/features/${SLUG}/design.md`, "spike-out-of-scope.txt"];
    record(5, "a diff with protected and out-of-scope paths is refused naming each",
      !refused.ok && wanted.every((p) => refused.refused.includes(p)), { paths: violating.paths, gate: refused });
    await server.call("write_file", { path: "backend/src/app.ts", content: "export {};\n" });
    const inScope = stagedPathsSinceBase();
    const accepted = gatePatchPaths(inScope.paths, scope, SLUG);
    resetWorktree();
    record(5, "positive control: an in-scope diff passes", accepted.ok && inScope.paths.join() === "backend/src/app.ts", { paths: inScope.paths, gate: accepted });

    // Criterion 6: runaway commands die at the ceiling, and memory is bounded.
    for (const command of ["sleep 600", "node -e \"for(;;){}\""]) {
      const runaway = await shortServer.call("run_command", { command });
      const top = docker(["top", sandbox.work]).stdout;
      const leftover = top.includes("sleep 600") || top.includes("for(;;)");
      record(6, `runaway \`${command}\` is killed at the 10 s ceiling`,
        runaway.isError && runaway.text.includes("ceiling") && runaway.elapsedMs < 15_000 && !leftover,
        { text: runaway.text, elapsedMs: runaway.elapsedMs, top });
    }
    const memory = await server.call("run_command", { command: "node -e \"const a=[];for(;;)a.push(Buffer.alloc(1<<26,1))\"" });
    record(6, "an allocation past --memory 4g ends with exit 137", memory.isError && memory.text.startsWith("exit code 137"), { text: memory.text.slice(0, 500), elapsedMs: memory.elapsedMs });

    // Criterion 8: the worktree's .git file cannot be changed from inside.
    const headBefore = git(["rev-parse", "HEAD"]);
    const writeGit = await server.call("write_file", { path: ".git", content: "gitdir: /tmp\n" });
    const shellGit = await server.call("run_command", { command: "echo 'gitdir: /tmp' > .git" });
    const gitFileAfter = readFileSync(join(WORKTREE, ".git"), "utf8");
    record(8, "the .git file is refused by the tool and read-only to commands",
      writeGit.isError && writeGit.text.startsWith("refused:") && shellGit.isError &&
        /read-only file system/i.test(shellGit.text) && gitFileAfter === gitFileBefore && git(["rev-parse", "HEAD"]) === headBefore,
      { writeGit: writeGit.text, shellGit: shellGit.text, gitFileUnchanged: gitFileAfter === gitFileBefore });

    // Criterion 9: escapes are refused by name, and every call is logged before it runs.
    const parent = await server.call("write_file", { path: "../x", content: "x" });
    const absolute = await server.call("write_file", { path: "/etc/x", content: "x" });
    record(9, "paths that leave the checkout are refused by name",
      parent.text.startsWith("refused: path escapes") && absolute.text.startsWith("refused: path must be relative"),
      { parent: parent.text, absolute: absolute.text });
  } finally {
    server?.close();
    shortServer?.close();
    if (sandbox) destroySandbox(sandbox);
    rmSync(canary, { force: true });
    resetWorktree();
  }

  const logOrdered = [logPath, shortLogPath].every((path) => {
    const records = readFileSync(path, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { event: string; seq?: number });
    const calls = new Map<number, string[]>();
    for (const r of records) if (r.seq !== undefined) calls.set(r.seq, [...(calls.get(r.seq) ?? []), r.event]);
    return calls.size > 0 && [...calls.values()].every((events) => events.length === 2 && events[0] === "started" && (events[1] === "finished" || events[1] === "refused"));
  });
  record(9, "every call is logged as started before it finished or was refused", logOrdered, { logPath, shortLogPath });

  const leftovers = docker(["ps", "-a", "--filter", "name=bw-spike", "--format", "{{.Names}}"]).stdout.trim();
  const status = worktreeStatus();
  const fixture = writeFixture(FIXTURE_NAME, {
    provenance: {
      plan: "docs/features/sandboxed-implementer-spike/plan.md, Task 3",
      capturedAt: new Date().toISOString(),
      versions: versions(),
      worktreeBase: BASE,
      modelCalled: false,
      note: "No model was called. The driver spoke MCP to scripts/sandbox-spike/tool-server.ts over stdio. Canary values are random and were never credentials.",
    },
    checks,
    toolServerLog: readFileSync(logPath, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as object),
    toolServerLog10s: readFileSync(shortLogPath, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as object),
    proxyLog: proxyLog.split("\n").filter((l) => l !== ""),
    teardown: { dockerLeftovers: leftovers, worktreeStatus: status },
  });
  const failed = checks.filter((c) => !c.pass).length;
  process.stdout.write(`\n${checks.length - failed}/${checks.length} checks passed; leftovers: ${leftovers || "none"}; worktree: ${status || "clean"}\n${fixture}\n`);
  process.exitCode = failed === 0 && leftovers === "" && status === "" ? 0 : 1;
}

await main();
