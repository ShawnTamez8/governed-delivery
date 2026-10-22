import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  ContainerError,
  captureProxyLog,
  createSandbox,
  destroySandbox,
  dockerClientEnv,
  dockerReady,
  ensureImage,
  execTarget,
  repositoryKey,
  runInSandbox,
  type FrozenSandbox,
  type Sandbox,
} from "../src/container.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { buildHarnessEnvironment } from "../src/harness.ts";
import { seededSandbox } from "../src/policy.ts";
import { recordingDockerCommand, standInSandbox } from "./fixtures/docker/stand-in.ts";

/**
 * Containment against real Docker (docs/features/sandboxed-implementer/plan.md,
 * Task 3): the spike's boundary checks (`scripts/sandbox-spike/boundary-checks.ts`),
 * criteria 2, 3, 4, 6, 8 and 9, as tests, each an attempted violation beside a
 * positive control, plus the error and ownership paths of `src/container.ts`.
 * Criterion 5 is host Git and lives in `test/workspace-commit.test.ts`.
 *
 * Each test makes its own throwaway repository and worktree under the OS temp
 * directory and its own sandbox, removed when it ends. Every test skips, with a
 * named reason, when no Docker engine answers: the suite runs on machines
 * without one.
 */

const DOCKER = ["docker"];
const ready = dockerReady(DOCKER);
const skip = ready.ok ? false : "no Docker engine answered";
const image = ready.ok ? ensureImage(DOCKER) : null;
const TOOL_SERVER = resolve("src", "tool-server.ts");

function frozen(overrides: Partial<FrozenSandbox> = {}): FrozenSandbox {
  return { ...seededSandbox(image!.imageId), ...overrides };
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function docker(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A repository root with one commit and a run worktree at `.governance/worktrees/1`, as the stage makes it. */
function makeTarget(): { root: string; worktree: string; cleanup: () => void } {
  const parent = mkdtempSync(join(tmpdir(), "bw-container-"));
  const root = join(parent, "target");
  mkdirSync(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@t");
  writeFileSync(join(root, "README.md"), "target\n");
  git(root, "add", "README.md");
  git(root, "commit", "-q", "-m", "base");
  const worktree = join(root, ".governance", "worktrees", "1");
  // LF, as the implementation stage checks a run worktree out.
  git(root, "-c", "core.autocrlf=false", "-c", "core.eol=lf", "worktree", "add", "-q", worktree, "-b", "gov/t/1");
  return { root, worktree, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

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
      const resolveReply = this.pending.get(message.id as number);
      if (resolveReply) {
        this.pending.delete(message.id as number);
        resolveReply(message);
      }
    });
  }

  request(method: string, params: object = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolveReply) => {
      this.pending.set(id, resolveReply);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async call(name: string, args: object): Promise<CallResult> {
    const started = Date.now();
    const reply = await this.request("tools/call", { name, arguments: args });
    const result = reply.result as { content: { text: string }[]; isError: boolean };
    return { text: result.content.map((c) => c.text).join(""), isError: result.isError, elapsedMs: Date.now() - started };
  }

  close(): Promise<void> {
    return new Promise((resolveClose) => {
      this.child.on("close", () => resolveClose());
      this.child.stdin.end();
    });
  }
}

interface Fixture {
  root: string;
  worktree: string;
  sandbox: Sandbox;
  server: McpClient;
  logPath: string;
}

/** One target, one sandbox and one tool server, torn down when `body` ends. */
async function withSandbox(
  body: (fixture: Fixture) => Promise<void>,
  options: { timeoutSeconds?: number; serverEnv?: Record<string, string>; frozen?: FrozenSandbox } = {}
): Promise<void> {
  const target = makeTarget();
  const sandbox = createSandbox({
    frozen: options.frozen ?? frozen(),
    rootDir: target.root,
    runId: 1,
    label: "test",
    worktreePath: target.worktree,
  });
  const logPath = join(target.root, `tool-${randomBytes(4).toString("hex")}.jsonl`);
  const server = new McpClient(
    [
      "--container", sandbox.ids.work!, "--docker", JSON.stringify(DOCKER), "--docker-env", JSON.stringify(dockerClientEnv()),
      "--log", logPath, "--timeout", String(options.timeoutSeconds ?? 60),
    ],
    options.serverEnv ?? buildHarnessEnvironment(CLAUDE_CODE)
  );
  try {
    await server.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "container-test", version: "1" } });
    await body({ root: target.root, worktree: target.worktree, sandbox, server, logPath });
  } finally {
    await server.close();
    const teardown = destroySandbox(sandbox);
    target.cleanup();
    assert.deepEqual(teardown.failures, []);
    assert.equal(teardown.workContainerGone, true);
  }
}

function envNames(text: string): string[] {
  return text
    .replace(/^exit code 0\n/, "")
    .split("\n")
    .filter((entry) => entry.includes("="))
    .map((entry) => entry.slice(0, entry.indexOf("=")))
    .sort();
}

function imageEnvNames(): string[] {
  const env = JSON.parse(docker("image", "inspect", "--format", "{{json .Config.Env}}", image!.imageId).stdout) as string[];
  return env.map((assignment) => assignment.slice(0, assignment.indexOf("=")));
}

test("criterion 2: only the worktree and a read-only .git are mounted, and host state is invisible", { skip }, async () => {
  await withSandbox(async ({ root, server }) => {
    const mounts = await server.call("run_command", { command: "cat /proc/mounts" });
    assert.equal(mounts.isError, false, mounts.text);
    const points = mounts.text.split("\n").slice(1).filter((l) => l.trim() !== "").map((l) => {
      const fields = l.split(" ");
      return { point: fields[1] ?? "", options: fields[3] ?? "" };
    });
    const system = (p: string) =>
      p === "/" || p === "/etc/resolv.conf" || p === "/etc/hostname" || p === "/etc/hosts" ||
      p.startsWith("/proc") || p.startsWith("/dev") || p.startsWith("/sys");
    // `--init` mounts the engine's own init binary as PID 1.
    const init = "/usr/sbin/docker-init";
    assert.deepEqual(points.filter((m) => !system(m.point) && m.point !== "/work" && m.point !== "/work/.git" && m.point !== init), []);
    assert.ok(points.find((m) => m.point === "/work/.git")?.options.split(",").includes("ro"), "the .git mount is read-only");
    assert.ok(points.find((m) => m.point === init)?.options.split(",").includes("ro"), "the init binary is mounted read-only");

    const token = randomBytes(8).toString("hex");
    const canary = join(root, ".governance", `canary-${token}.txt`);
    writeFileSync(canary, token);
    const search = await server.call("run_command", {
      command: "find / \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o -name 'canary-*' -print 2>/dev/null; echo END",
    });
    assert.equal(readFileSync(canary, "utf8"), token, "positive control: the host reads the canary");
    assert.ok(search.text.trim().endsWith("END"), search.text);
    assert.ok(!search.text.includes("canary-"), search.text);

    const hostPaths = await server.call("run_command", {
      command: "for p in /var/run/docker.sock /mnt/host /host_mnt /run/desktop; do if [ -e \"$p\" ]; then echo \"PRESENT $p\"; fi; done; echo END",
    });
    assert.ok(!hostPaths.text.includes("PRESENT"), hostPaths.text);
    const credentials = await server.call("run_command", {
      command: "find / \\( -path /proc -o -path /sys \\) -prune -o -name '.credentials.json' -print 2>/dev/null; echo END",
    });
    assert.equal(credentials.text.trim(), "exit code 0\nEND");
  });
});

test("criterion 3: no provider credential reaches the container's environment", { skip }, async () => {
  const token = randomBytes(8).toString("hex");
  const canaries: Record<string, string> = {
    ANTHROPIC_API_KEY: `bw-canary-${token}-anthropic`,
    CLAUDE_CODE_OAUTH_TOKEN: `bw-canary-${token}-oauth`,
    SYSTEMONE_API_KEY: `bw-canary-${token}-systemone`,
  };
  // The stage process that starts the sandbox holds them too, as an operator's would.
  const saved = Object.fromEntries(Object.keys(canaries).map((name) => [name, process.env[name]]));
  Object.assign(process.env, canaries);
  try {
    await withSandbox(async ({ sandbox, server, logPath }) => {
      const start = JSON.parse(readFileSync(logPath, "utf8").split("\n")[0]!) as { envNames: string[] };
      assert.ok(Object.keys(canaries).every((n) => start.envNames.includes(n)), "positive control: the tool server holds the canaries");
      const shellEnv = await server.call("run_command", { command: "env" });
      const initEnv = await server.call("run_command", { command: "tr '\\0' '\\n' < /proc/1/environ" });
      // HOSTNAME, PWD and HOME are container runtime defaults (spike record).
      const allowed = new Set([...imageEnvNames(), "HOSTNAME", "PWD", "HOME", ...sandbox.env.map((a) => a.slice(0, a.indexOf("=")))]);
      const shellAllowed = new Set([...allowed, "SHLVL", "_", "OLDPWD"]);
      for (const value of Object.values(canaries)) {
        assert.ok(!shellEnv.text.includes(value) && !initEnv.text.includes(value), `a canary value leaked: ${value}`);
      }
      assert.deepEqual(envNames(initEnv.text).filter((n) => !allowed.has(n)), []);
      assert.deepEqual(envNames(shellEnv.text).filter((n) => !shellAllowed.has(n)), []);
    }, { serverEnv: { ...buildHarnessEnvironment(CLAUDE_CODE), ...canaries } });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("criterion 4: only the allowlisted registry is reachable, and only through the proxy", { skip }, async () => {
  await withSandbox(async ({ root, sandbox, server }) => {
    const registry = await server.call("run_command", { command: "npm view left-pad version --registry https://registry.npmjs.org/ --fetch-retries=0" });
    assert.equal(registry.isError, false, registry.text);
    assert.match(registry.text, /\d+\.\d+\.\d+/);
    const other = await server.call("run_command", { command: "npm view left-pad version --registry https://example.com/ --fetch-retries=0" });
    assert.equal(other.isError, true, other.text);
    const proxyLog = join(root, "proxy.log");
    captureProxyLog(sandbox, proxyLog);
    const log = readFileSync(proxyLog, "utf8");
    assert.ok(log.includes('"verdict":"allow","target":"registry.npmjs.org:443"'), log);
    assert.ok(log.includes('"verdict":"deny","target":"example.com:443"'), log);
    const direct = (host: string) =>
      `node -e "require('https').get('https://${host}',{timeout:10000},r=>{console.log('STATUS',r.statusCode)}).on('error',e=>{console.log('ERR',e.code);process.exit(3)}).on('timeout',function(){console.log('ERR timeout');this.destroy()})"`;
    for (const host of ["example.com", "api.anthropic.com"]) {
      const answer = await server.call("run_command", { command: direct(host) });
      assert.equal(answer.isError, true, answer.text);
      assert.ok(answer.text.includes("ERR") && !answer.text.includes("STATUS"), answer.text);
    }
  });
});

test("a command's call to its own local server stays direct under a client that honours the proxy variables", { skip }, async () => {
  // Node's fetch honours HTTP_PROXY and NO_PROXY under NODE_USE_ENV_PROXY, as
  // npm and most HTTP libraries do by default.
  await withSandbox(async ({ server }) => {
    const fetchFrom = (host: string, env = "") =>
      `${env} NODE_USE_ENV_PROXY=1 node -e "fetch('http://${host}:3000').then(r=>r.text()).then(t=>console.log('BODY',t),e=>{console.log('ERR',e.cause?.code??e.message);process.exit(3)})"`;
    const command = [
      `node -e "require('http').createServer((q,r)=>r.end('direct')).listen(3000)" > /dev/null 2>&1 &`,
      "sleep 1",
      `${fetchFrom("127.0.0.1")}; ${fetchFrom("localhost")}`,
      // Positive control: with NO_PROXY emptied the same call goes to the proxy and fails.
      `${fetchFrom("127.0.0.1", "NO_PROXY=")}; echo "control exit $?"`,
      "kill $!",
    ].join("\n");
    const answer = await server.call("run_command", { command });
    assert.equal(answer.text.split("\n").filter((l) => l === "BODY direct").length, 2, answer.text);
    assert.match(answer.text, /ERR [^\n]+\ncontrol exit 3/, answer.text);
  });
});

test("list_files names a path under a directory called work as the checkout holds it", { skip }, async () => {
  await withSandbox(async ({ worktree, server }) => {
    mkdirSync(join(worktree, "src", "work"), { recursive: true });
    writeFileSync(join(worktree, "src", "work", "a.js"), "export {};\n");
    const answer = await server.call("list_files", { path: "src" });
    assert.equal(answer.isError, false, answer.text);
    assert.deepEqual(answer.text.split("\n").filter((l) => l !== "").sort(), ["src", "src/work", "src/work/a.js"]);
  });
});

test("criterion 4: a bare IP is unreachable from the work container", { skip }, async () => {
  await withSandbox(async ({ server }) => {
    const answer = await server.call("run_command", {
      command: "node -e \"const s=require('net').connect({host:'1.1.1.1',port:443,timeout:10000},()=>{console.log('CONNECTED');s.end()});s.on('error',e=>{console.log('ERR',e.code);process.exit(3)});s.on('timeout',()=>{console.log('ERR timeout');process.exit(3)})\"",
    });
    assert.equal(answer.isError, true, answer.text);
    assert.ok(answer.text.includes("ERR") && !answer.text.includes("CONNECTED"), answer.text);
  });
});

test("criterion 6: runaway commands die at the ceiling, and memory is bounded", { skip }, async () => {
  await withSandbox(async ({ sandbox, server }) => {
    for (const command of ["sleep 600", "node -e \"for(;;){}\""]) {
      const runaway = await server.call("run_command", { command });
      assert.equal(runaway.isError, true);
      assert.match(runaway.text, /ceiling/);
      assert.ok(runaway.elapsedMs < 20_000, `${runaway.elapsedMs} ms`);
      const top = docker("top", sandbox.ids.work!).stdout;
      assert.ok(!top.includes("sleep 600") && !top.includes("for(;;)"), top);
    }
  }, { timeoutSeconds: 10 });
  await withSandbox(async ({ server }) => {
    const memory = await server.call("run_command", { command: "node -e \"const a=[];for(;;)a.push(Buffer.alloc(1<<26,1))\"" });
    assert.equal(memory.isError, true);
    assert.ok(memory.text.startsWith("exit code 137"), memory.text.slice(0, 300));
  });
});

test("an orphan a command leaves is reaped, so zombies never accumulate against the pids limit", { skip }, async () => {
  // Chromium leaves such orphans on every test; under a PID 1 that never reaps
  // them they filled the 512-pid limit (protected-acceptance-tests, Task 4 round 1).
  const target = makeTarget();
  try {
    const sandbox = createSandbox({ frozen: frozen(), rootDir: target.root, runId: 1, label: "test", worktreePath: target.worktree });
    try {
      const options = { cwd: target.worktree, timeoutSeconds: 30, maxBytes: 65536, retentionMaxBytes: 65536, evidencePath: join(target.root, "orphans.log") };
      const orphans = await runInSandbox(execTarget(sandbox), sandbox.frozen.imageId,
        { name: "orphans", command: ["sh", "-c", 'for i in 1 2 3 4 5; do (sh -c "sleep 0.2; echo \\$\\$ >> /work/orphans.txt" &); done'] }, options);
      assert.equal(orphans.exitCode, 0);
      const file = join(target.worktree, "orphans.txt");
      const deadline = Date.now() + 10_000;
      while ((existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").length : 0) < 5 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 5, "positive control: five orphans ran to their end");
      await new Promise((r) => setTimeout(r, 1000));
      const count = await runInSandbox(execTarget(sandbox), sandbox.frozen.imageId,
        { name: "zombies", command: ["sh", "-c", 'for s in /proc/[0-9]*/status; do grep -q "^State:.Z" "$s" 2>/dev/null && echo zombie; done; echo END'] },
        { ...options, evidencePath: join(target.root, "zombies.log") });
      assert.equal(count.exitCode, 0);
      const log = readFileSync(join(target.root, "zombies.log"), "utf8");
      assert.ok(log.includes("END"), log);
      assert.equal(log.split("\n").filter((l) => l === "zombie").length, 0, log);
    } finally {
      destroySandbox(sandbox);
    }
  } finally {
    target.cleanup();
  }
});

test("criterion 8: the worktree's .git file is refused by the tool and read-only to commands", { skip }, async () => {
  await withSandbox(async ({ worktree, server }) => {
    const before = readFileSync(join(worktree, ".git"), "utf8");
    const head = git(worktree, "rev-parse", "HEAD");
    const writeGit = await server.call("write_file", { path: ".git", content: "gitdir: /tmp\n" });
    const shellGit = await server.call("run_command", { command: "echo 'gitdir: /tmp' > .git" });
    assert.equal(writeGit.isError, true);
    assert.ok(writeGit.text.startsWith("refused:"), writeGit.text);
    assert.equal(shellGit.isError, true);
    assert.match(shellGit.text, /read-only file system/i);
    assert.equal(readFileSync(join(worktree, ".git"), "utf8"), before);
    assert.equal(git(worktree, "rev-parse", "HEAD"), head);
    // Positive control: an ordinary file is writable.
    const ordinary = await server.call("write_file", { path: "src/a.ts", content: "export {};\n" });
    assert.equal(ordinary.isError, false, ordinary.text);
    assert.equal(readFileSync(join(worktree, "src", "a.ts"), "utf8"), "export {};\n");
  });
});

test("criterion 9: escapes are refused by name, and every call is logged before it runs", { skip }, async () => {
  await withSandbox(async ({ server, logPath }) => {
    const parent = await server.call("write_file", { path: "../x", content: "x" });
    const absolute = await server.call("write_file", { path: "/etc/x", content: "x" });
    assert.match(parent.text, /^refused: path escapes/);
    assert.match(absolute.text, /^refused: path must be relative/);
    const read = await server.call("read_file", { path: "README.md" });
    assert.equal(read.text, "target\n");
    const calls = new Map<number, string[]>();
    for (const line of readFileSync(logPath, "utf8").split("\n").filter((l) => l !== "")) {
      const record = JSON.parse(line) as { event: string; seq?: number };
      if (record.seq !== undefined) calls.set(record.seq, [...(calls.get(record.seq) ?? []), record.event]);
    }
    assert.equal(calls.size, 3);
    for (const events of calls.values()) {
      assert.equal(events.length, 2);
      assert.equal(events[0], "started");
    }
  });
});

// --- the reviewers' reproductions (docs/features/reproduced-review-findings/plan.md, Task 4) ---

test("criterion 2 with a checks mount: /bw-checks is read-only, and the worktree and .git mounts are unchanged", { skip }, async () => {
  const target = makeTarget();
  const checksDir = join(target.root, ".governance", "code-review", "1", "checks");
  mkdirSync(join(checksDir, "9", "code-reviewer-correctness"), { recursive: true });
  writeFileSync(join(checksDir, "9", "code-reviewer-correctness", "r.spec.mjs"), "// reproduction\n");
  const sandbox = createSandbox({ frozen: frozen(), rootDir: target.root, runId: 1, label: "test", worktreePath: target.worktree, checksDir });
  try {
    const run = (name: string, script: string) =>
      runInSandbox(execTarget(sandbox), null, { name, command: ["sh", "-c", script] }, {
        cwd: target.worktree, timeoutSeconds: 30, maxBytes: 65536, retentionMaxBytes: 65536, evidencePath: join(target.root, `${name}.log`),
      });
    const log = (name: string) => readFileSync(join(target.root, `${name}.log`), "utf8");
    // Positive control: the host's file is there to read.
    assert.equal((await run("read", "cat /bw-checks/9/code-reviewer-correctness/r.spec.mjs")).exitCode, 0);
    assert.ok(log("read").endsWith("// reproduction\n"), log("read"));
    for (const [name, script] of [["write-new", "echo x > /bw-checks/new.txt"], ["write-over", "echo x > /bw-checks/9/code-reviewer-correctness/r.spec.mjs"]]) {
      const write = await run(name!, script!);
      assert.notEqual(write.exitCode, 0, log(name!));
      assert.match(log(name!), /read-only file system/i);
    }
    assert.equal(readFileSync(join(checksDir, "9", "code-reviewer-correctness", "r.spec.mjs"), "utf8"), "// reproduction\n");
    assert.equal((await run("mounts", "cat /proc/mounts")).exitCode, 0);
    const points = new Map(log("mounts").split("\n").slice(1).map((l) => l.split(" ")).map((f) => [f[1] ?? "", (f[3] ?? "").split(",")]));
    assert.ok(points.get("/bw-checks")?.includes("ro"), "the checks mount is read-only");
    assert.ok(points.get("/work/.git")?.includes("ro"), "the .git mount is read-only");
    assert.ok(points.get("/work")?.includes("rw"), "the worktree stays writable");
    assert.equal((await run("work", "echo y > other.txt")).exitCode, 0);
    assert.equal(readFileSync(join(target.worktree, "other.txt"), "utf8"), "y\n");
  } finally {
    const teardown = destroySandbox(sandbox);
    assert.deepEqual(teardown.failures, []);
    assert.ok(existsSync(join(checksDir, "9", "code-reviewer-correctness", "r.spec.mjs")), "teardown leaves the run's evidence in place");
    target.cleanup();
  }
});

/** The work container's `run -d` argv, with the sandbox's random name and network ID made constant. */
function workRunArgv(calls: string[][]): string[] {
  const run = calls.find((c) => c[0] === "run" && c.includes("-d") && c[c.indexOf("--name") + 1]!.endsWith("-work"))!;
  const network = run[run.indexOf("--network") + 1]!;
  return run.map((a) =>
    a === network
      ? "<network>"
      : a.replace(/bw-[0-9a-f]{8}-1-test-[0-9a-f]{6}/g, "<name>").replace(/^bw\.(repo|instance)=[0-9a-f]+$/, "bw.$1=<random>")
  );
}

test("without a checks directory the work container's argv is unchanged; with one it adds only the read-only mount, last", () => {
  for (const readOnlyPaths of [undefined, ["README.md"]]) {
    const argv: Record<string, string[]> = {};
    for (const [variant, extra] of [["absent", {}], ["undefined", { checksDir: undefined }], ["given", { checksDir: "C:\\checks" }]] as const) {
      const target = makeTarget();
      const dir = mkdtempSync(join(tmpdir(), "bw-checks-argv-"));
      try {
        const recording = recordingDockerCommand(dir);
        const sandbox = createSandbox({
          frozen: standInSandbox({ dockerCommand: recording.dockerCommand }), rootDir: target.root, runId: 1, label: "test",
          worktreePath: target.worktree, ...(readOnlyPaths === undefined ? {} : { readOnlyPaths }), ...extra,
        });
        destroySandbox(sandbox);
        argv[variant] = workRunArgv(recording.calls()).map((a) => a.split(target.root).join("<root>"));
      } finally {
        rmSync(dir, { recursive: true, force: true });
        target.cleanup();
      }
    }
    assert.deepEqual(argv.undefined, argv.absent, `readOnlyPaths ${JSON.stringify(readOnlyPaths)}`);
    const workdir = argv.absent!.indexOf("-w");
    assert.deepEqual(argv.given, [...argv.absent!.slice(0, workdir), "-v", "C:\\checks:/bw-checks:ro", ...argv.absent!.slice(workdir)]);
    const mounts = argv.absent!.flatMap((a, i) => (argv.absent![i - 1] === "-v" ? [a] : []));
    assert.equal(mounts.length, readOnlyPaths === undefined ? 2 : 3, mounts.join(" | "));
    assert.ok(!argv.absent!.some((a) => a.includes("/bw-checks")));
  }
});

test("an absent frozen image is refused by name before any object is created, naming a fresh run", { skip }, () => {
  const target = makeTarget();
  try {
    const missing = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => createSandbox({ frozen: frozen({ imageId: missing }), rootDir: target.root, runId: 1, label: "test", worktreePath: target.worktree }),
      (err: unknown) => {
        assert.ok(err instanceof ContainerError);
        assert.equal(err.operation, "find frozen image");
        assert.ok(err.message.includes(missing), err.message);
        assert.match(err.message, /No such image/i);
        assert.match(err.message, /start a fresh run/);
        return true;
      }
    );
    assert.equal(docker("ps", "-a", "--filter", `label=bw.repo=${repositoryKey(target.root)}`, "--format", "{{.ID}}").stdout.trim(), "");
  } finally {
    target.cleanup();
  }
});

test("a network removed before teardown is reported as a failure naming it, not thrown or hidden", { skip }, () => {
  const target = makeTarget();
  try {
    const sandbox = createSandbox({ frozen: frozen(), rootDir: target.root, runId: 1, label: "test", worktreePath: target.worktree });
    for (const id of [sandbox.ids.work!, sandbox.ids.proxy!]) docker("network", "disconnect", "-f", sandbox.ids.network!, id);
    assert.equal(docker("network", "rm", sandbox.ids.network!).status, 0);
    const teardown = destroySandbox(sandbox);
    assert.equal(teardown.workContainerGone, true);
    assert.equal(teardown.failures.length, 1, teardown.failures.join("\n"));
    assert.ok(teardown.failures[0]!.startsWith(`remove network ${sandbox.network} failed`), teardown.failures[0]);
    assert.deepEqual(teardown.removed, [sandbox.work, sandbox.proxy]);
  } finally {
    target.cleanup();
  }
});

test("a background writer stops when the sandbox is destroyed, and the work container is proven gone", { skip }, async () => {
  const target = makeTarget();
  try {
    const sandbox = createSandbox({ frozen: frozen(), rootDir: target.root, runId: 1, label: "test", worktreePath: target.worktree });
    const outcome = await runInSandbox(execTarget(sandbox), sandbox.frozen.imageId,
      { name: "background", command: ["sh", "-c", "(while true; do date >> /work/bg.txt; sleep 0.2; done) > /dev/null 2>&1 &"] },
      { cwd: target.worktree, timeoutSeconds: 30, maxBytes: 65536, retentionMaxBytes: 65536, evidencePath: join(target.root, "bg.log") });
    assert.equal(outcome.exitCode, 0);
    const file = join(target.worktree, "bg.txt");
    const deadline = Date.now() + 10_000;
    while (!existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    assert.ok(existsSync(file), "positive control: the writer ran");
    const teardown = destroySandbox(sandbox);
    assert.deepEqual(teardown.failures, []);
    assert.equal(teardown.workContainerGone, true);
    const size = statSync(file).size;
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(statSync(file).size, size, "the file stopped growing");
  } finally {
    target.cleanup();
  }
});

test("a failing command's exit code comes from the exit-status file; exec against a removed container raises", { skip }, async () => {
  const target = makeTarget();
  try {
    const sandbox = createSandbox({ frozen: frozen(), rootDir: target.root, runId: 1, label: "test", worktreePath: target.worktree });
    try {
      const options = { cwd: target.worktree, timeoutSeconds: 30, maxBytes: 65536, retentionMaxBytes: 65536, evidencePath: join(target.root, "exit.log") };
      const failing = await runInSandbox(execTarget(sandbox), sandbox.frozen.imageId, { name: "fail", command: ["sh", "-c", "echo out; exit 3"] }, options);
      assert.equal(failing.exitCode, 3);
      assert.equal(failing.timedOut, false);
      const evidence = readFileSync(join(target.root, "exit.log"), "utf8");
      assert.ok(evidence.startsWith(`# ran in container ${sandbox.ids.work} (image ${sandbox.frozen.imageId}): ["sh","-c","echo out; exit 3"]\n`), evidence);
      assert.ok(evidence.includes("out\n"));
      docker("rm", "-f", sandbox.ids.work!);
      await assert.rejects(
        runInSandbox(execTarget(sandbox), sandbox.frozen.imageId, { name: "gone", command: ["true"] }, options),
        (err: unknown) => {
          assert.ok(err instanceof ContainerError, String(err));
          assert.equal(err.operation, "read exit status in");
          assert.match(err.message, /No such container/i);
          return true;
        }
      );
    } finally {
      destroySandbox(sandbox);
    }
  } finally {
    target.cleanup();
  }
});

test("sandboxes of two repositories with equal run IDs and labels run side by side; a failed start removes only its own objects", { skip }, () => {
  const a = makeTarget();
  const b = makeTarget();
  const c = makeTarget();
  const started: Sandbox[] = [];
  try {
    for (const target of [a, b]) {
      const sandbox = createSandbox({ frozen: frozen(), rootDir: target.root, runId: 1, label: "phase-1", worktreePath: target.worktree });
      started.push(sandbox);
      const key = repositoryKey(target.root);
      for (const name of [sandbox.network, sandbox.proxy, sandbox.work]) assert.ok(name.startsWith(`bw-${key}-1-phase-1-`), name);
      assert.equal(docker("inspect", "--format", '{{index .Config.Labels "bw.repo"}}', sandbox.ids.work!).stdout.trim(), key);
    }
    assert.notEqual(repositoryKey(a.root), repositoryKey(b.root));
    // The third fails at its work container, after its network and proxy started.
    assert.throws(
      () => createSandbox({ frozen: frozen({ limits: { cpus: "9999", memory: "4g", pidsLimit: 512 } }), rootDir: c.root, runId: 1, label: "phase-1", worktreePath: c.worktree }),
      (err: unknown) => {
        assert.ok(err instanceof ContainerError, String(err));
        assert.equal(err.operation, "start work container");
        assert.match(err.message, new RegExp(`^start work container bw-${repositoryKey(c.root)}-1-phase-1-[0-9a-f]{6}-work failed \\(docker exit \\d+\\): `));
        return true;
      }
    );
    const leftovers = docker("ps", "-a", "--filter", `label=bw.repo=${repositoryKey(c.root)}`, "--format", "{{.Names}}").stdout.trim();
    const networks = docker("network", "ls", "--filter", `label=bw.repo=${repositoryKey(c.root)}`, "--format", "{{.Name}}").stdout.trim();
    assert.equal(networks, "");
    // A container `docker run` created but could not start may remain; it never ran, and doctor lists it.
    for (const name of leftovers.split("\n").filter(Boolean)) {
      assert.match(name, /-work$/);
      docker("rm", "-f", name);
    }
    for (const sandbox of started) {
      for (const id of [sandbox.ids.network!, sandbox.ids.proxy!, sandbox.ids.work!]) {
        assert.equal(docker("inspect", "--format", "{{.Id}}", id).status, 0, `${id} still answers`);
      }
    }
  } finally {
    for (const sandbox of started) destroySandbox(sandbox);
    for (const target of [a, b, c]) target.cleanup();
  }
});
