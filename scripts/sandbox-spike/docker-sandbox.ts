import { spawnSync } from "node:child_process";
import { join } from "node:path";

/**
 * The only spike module that runs `docker`
 * (docs/features/sandboxed-implementer-spike/plan.md, Task 2). It spawns the
 * native `docker.exe` directly, with no shell (hazard 8), and uses nothing
 * specific to Docker Desktop.
 *
 * One sandbox is three Docker objects:
 * - an internal network with no route out;
 * - a proxy container on that network and on the default bridge, which
 *   forwards only `CONNECT registry.npmjs.org:443`;
 * - a work container on the internal network only, with the run's worktree
 *   mounted at `/work` and its `.git` file mounted read-only over it.
 */

export const SPIKE_IMAGE = "bw-spike:1";
const PROXY_PORT = 3128;

export interface SandboxLimits {
  cpus: string;
  memory: string;
  pidsLimit: number;
}

export const SPIKE_LIMITS: SandboxLimits = { cpus: "2", memory: "4g", pidsLimit: 512 };

export interface Sandbox {
  name: string;
  network: string;
  proxy: string;
  work: string;
  /** The `--env` assignments the work container was given, and nothing else. */
  env: string[];
}

export interface DockerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function docker(
  args: string[],
  options: { input?: string; timeoutMs?: number } = {}
): DockerResult {
  const result = spawnSync("docker", args, {
    shell: false,
    encoding: "utf8",
    input: options.input,
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (result.error && !timedOut) {
    throw new Error(`docker ${args[0]} could not run: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", timedOut };
}

function mustDocker(args: string[]): string {
  const result = docker(args, { timeoutMs: 120_000 });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed (${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

export function createSandbox(options: {
  worktree: string;
  name: string;
  limits?: SandboxLimits;
  user?: string;
}): Sandbox {
  const limits = options.limits ?? SPIKE_LIMITS;
  const name = `bw-spike-${options.name}`;
  const sandbox: Sandbox = {
    name,
    network: `${name}-net`,
    proxy: `${name}-proxy`,
    work: `${name}-work`,
    env: [],
  };
  const proxyUrl = `http://${sandbox.proxy}:${PROXY_PORT}`;
  sandbox.env = [
    `HTTPS_PROXY=${proxyUrl}`,
    `HTTP_PROXY=${proxyUrl}`,
    `npm_config_proxy=${proxyUrl}`,
    `npm_config_https_proxy=${proxyUrl}`,
    "HOME=/tmp/home",
  ];
  try {
    mustDocker(["network", "create", "--internal", sandbox.network]);
    mustDocker([
      "run", "-d", "--name", sandbox.proxy,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "node",
      "-v", `${import.meta.dirname}:/proxy:ro`,
      SPIKE_IMAGE, "node", "/proxy/egress-proxy.ts",
    ]);
    mustDocker(["network", "connect", sandbox.network, sandbox.proxy]);
    mustDocker([
      "run", "-d", "--name", sandbox.work,
      "--network", sandbox.network,
      "--cpus", limits.cpus, "--memory", limits.memory, "--memory-swap", limits.memory,
      "--pids-limit", String(limits.pidsLimit),
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--user", options.user ?? "node",
      "-v", `${options.worktree}:/work`,
      "-v", `${join(options.worktree, ".git")}:/work/.git:ro`,
      "-w", "/work",
      ...sandbox.env.flatMap((assignment) => ["--env", assignment]),
      SPIKE_IMAGE, "sleep", "infinity",
    ]);
    return sandbox;
  } catch (err) {
    destroySandbox(sandbox);
    throw err;
  }
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  /** True when the in-container `timeout` or the host-side kill fired. */
  ceilingFired: boolean;
}

/**
 * Run one shell command in the work container under a ceiling. The ceiling is
 * enforced twice: `timeout --signal=KILL` inside the container ends the
 * command's process, and the host kills the `docker exec` client five seconds
 * later in case the first did not. Killing the client alone would leave the
 * command running inside the container.
 */
export function execInSandbox(
  sandbox: Pick<Sandbox, "work">,
  command: string,
  options: { stdin?: string; timeoutSeconds: number; args?: string[] }
): ExecResult {
  const started = Date.now();
  const result = docker(
    [
      "exec", "-i", sandbox.work,
      "timeout", "--signal=KILL", String(options.timeoutSeconds),
      "sh", "-c", command, "sh", ...(options.args ?? []),
    ],
    { input: options.stdin ?? "", timeoutMs: (options.timeoutSeconds + 5) * 1000 }
  );
  const elapsedMs = Date.now() - started;
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    elapsedMs,
    // `timeout --signal=KILL` exits 137 when it kills the command. An
    // out-of-memory kill also exits 137, but before the ceiling has elapsed.
    ceilingFired:
      result.timedOut || (result.status === 137 && elapsedMs >= options.timeoutSeconds * 1000),
  };
}

/** Remove both containers and the network; never throws. */
export function destroySandbox(sandbox: Sandbox): void {
  docker(["rm", "-f", sandbox.work, sandbox.proxy], { timeoutMs: 60_000 });
  docker(["network", "rm", sandbox.network], { timeoutMs: 60_000 });
}
