import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { VerifyCommand } from "./governed-config.ts";
import { killTree } from "./harness.ts";
import { acceptanceMountDir } from "./paths.ts";
import { runVerifyCommand, type CommandOutcome } from "./verify-command.ts";

/**
 * The only module that runs `docker` (docs/features/sandboxed-implementer/plan.md,
 * promoted from the spike's `scripts/sandbox-spike/docker-sandbox.ts`). It
 * spawns the frozen Docker command directly, with no shell (hazard 8).
 *
 * One sandbox is three Docker objects, named
 * `bw-<repoKey>-<run>-<label>-<instance>` and labelled `bw.repo`, `bw.run` and
 * `bw.instance`:
 * - an internal network with no route out;
 * - a proxy container on the default bridge and on that network, under the
 *   alias `proxy`, which forwards only the frozen egress allowlist;
 * - a work container on the internal network only, with the run's worktree
 *   mounted at `/work` and its `.git` file mounted read-only over it.
 *
 * `repoKey` is the first 8 hex digits of the SHA-256 of the repository root's
 * resolved path, because run IDs are local to each repository's store and two
 * repositories can run run 1, phase 1 at once. `instance` is random per
 * sandbox. The objects are attached by name and ID, with no assumption that
 * they are the network's only members (extension point 3).
 *
 * Everything this module knows about the image, its user, its environment and
 * its network access comes from a `FrozenSandbox` argument, never from a
 * constant here (extension points 1 and 2). The only environment it adds is the
 * stack-neutral `HTTPS_PROXY`/`HTTP_PROXY` pointing at its own proxy, and
 * `NO_PROXY` naming loopback, so a command's calls to its own local server stay
 * direct.
 *
 * Failures. Every control call (network, run, inspect, logs, rm) raises one
 * `ContainerError` naming the operation, the object, the argv, the exit or
 * spawn code and the tail of stderr. A command run in the work container is
 * different: its own failure is an outcome, not an infrastructure error.
 * `docker exec` exits 1 both for a missing container and for a failing test,
 * so each command runs inside a wrapper that records its exit status in the
 * container under a fresh token, and the code is read back from that file. A
 * present file is the command's exit code; an absent one is a `ContainerError`.
 */

/** The port the proxy listens on inside its container (`src/egress-proxy.ts`). */
export const PROXY_PORT = 3128;
/** The proxy's alias on the internal network, so frozen values never embed a run-specific name. */
export const PROXY_ALIAS = "proxy";
/** The work container's `NO_PROXY`: the container's own loopback names. */
export const LOOPBACK_HOSTS = "localhost,127.0.0.1,::1";
/** The last bytes of a failed call's stderr that its error carries. */
export const STDERR_TAIL_BYTES = 2000;
/**
 * The host kills a `docker exec` client this long after the in-container
 * ceiling, in case `timeout` inside the container did not end the command.
 * Killing the client alone would leave the command running in the container.
 */
export const HOST_KILL_GRACE_SECONDS = 5;

const CONTROL_TIMEOUT_MS = 120_000;
const BUILD_TIMEOUT_MS = 1_800_000;
const CONTROL_MAX_BUFFER = 64 * 1024 * 1024;
/** Keeps one removal container's argv well under the Windows command-line limit. */
const REMOVE_ARGV_CHARS = 16_000;
const EGRESS_PROXY_FILE = join(import.meta.dirname, "egress-proxy.ts");
const CONTAINER_PROXY_FILE = "/bw/egress-proxy.ts";

export interface SandboxLimits {
  cpus: string;
  memory: string;
  pidsLimit: number;
}

/**
 * The sandbox a run froze at `new-run` (hard rule 6), as `profile.sandbox`
 * carries it. `imageId` is the toolchain's identity: the Dockerfile installs
 * Git without a version, so a rebuild is not guaranteed to reproduce it.
 */
export interface FrozenSandbox {
  /** The argv that runs Docker, seeded `["docker"]`; tests freeze a stand-in. */
  dockerCommand: string[];
  imageId: string;
  limits: SandboxLimits;
  /** The ceiling on one tool-server command inside the work container. */
  commandTimeoutSeconds: number;
  /** The `host:port` targets the egress proxy forwards. */
  egressAllowlist: string[];
  /** The `--user` every container runs as. */
  user: string;
  /** The `NAME=value` assignments the work container gets beyond the proxy variables. */
  env: string[];
  /** The `--max-budget-usd` cap on one patch dispatch. */
  patchDispatchBudgetUsd: string;
}

/** One started sandbox and the IDs of the objects it actually created. */
export interface Sandbox {
  frozen: FrozenSandbox;
  name: string;
  network: string;
  proxy: string;
  work: string;
  ids: { network: string | null; proxy: string | null; work: string | null };
  /** The `--env` assignments the work container was given, and nothing else. */
  env: string[];
  /** The committed copy mounted for the read-only paths, which teardown removes; null without them. */
  mountDir: string | null;
}

/** What a command runs against: the Docker argv and the work container's ID. */
export interface ExecTarget {
  dockerCommand: string[];
  work: string;
}

export interface ContainerErrorFields {
  operation: string;
  object: string;
  argv: string[];
  exitCode: number | null;
  spawnCode: string | null;
  stderr: string;
  /** What the operator can do, or what else failed, appended after the stderr tail. */
  note?: string;
}

/** The last `STDERR_TAIL_BYTES` of a stream, on one line. */
export function stderrTail(stderr: string): string {
  const bytes = Buffer.from(stderr, "utf8");
  const tail = bytes.length > STDERR_TAIL_BYTES ? bytes.subarray(bytes.length - STDERR_TAIL_BYTES).toString("utf8") : stderr;
  return tail.trim().replace(/\s*\r?\n\s*/g, " | ");
}

/**
 * A failed Docker control call. Its message reads in one line, for example
 * `start work container bw-1a2b3c4d-7-phase-2-9f8e7d-work failed (docker exit 125): <stderr tail>`.
 */
export class ContainerError extends Error {
  readonly operation: string;
  readonly object: string;
  readonly argv: string[];
  readonly exitCode: number | null;
  readonly spawnCode: string | null;
  readonly stderrTail: string;

  constructor(fields: ContainerErrorFields) {
    const tail = stderrTail(fields.stderr);
    const status = fields.spawnCode !== null ? `spawn error ${fields.spawnCode}` : `docker exit ${fields.exitCode}`;
    super(`${fields.operation} ${fields.object} failed (${status}): ${tail === "" ? "no stderr" : tail}${fields.note ? `; ${fields.note}` : ""}`);
    this.name = "ContainerError";
    this.operation = fields.operation;
    this.object = fields.object;
    this.argv = [...fields.argv];
    this.exitCode = fields.exitCode;
    this.spawnCode = fields.spawnCode;
    this.stderrTail = tail;
  }

  /** The same failure with a note appended, such as a cleanup that also failed. */
  withNote(note: string): ContainerError {
    return new ContainerError({
      operation: this.operation,
      object: this.object,
      argv: this.argv,
      exitCode: this.exitCode,
      spawnCode: this.spawnCode,
      stderr: this.stderrTail,
      note,
    });
  }
}

/**
 * One control call. Any spawn failure or non-zero exit raises `ContainerError`;
 * the stdout is returned untrimmed. The Docker client inherits this process's
 * environment: a container receives only the explicit `--env` assignments, never
 * the client's variables (criterion 3, `test/container.test.ts`).
 */
function control(
  dockerCommand: string[],
  operation: string,
  object: string,
  args: string[],
  options: { timeoutMs?: number } = {}
): string {
  const argv = [...dockerCommand, ...args];
  const result = spawnSync(argv[0]!, argv.slice(1), {
    shell: false,
    encoding: "utf8",
    timeout: options.timeoutMs ?? CONTROL_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: CONTROL_MAX_BUFFER,
    windowsHide: true,
  });
  if (result.error) {
    throw new ContainerError({
      operation,
      object,
      argv,
      exitCode: result.status,
      spawnCode: (result.error as NodeJS.ErrnoException).code ?? result.error.message,
      stderr: result.stderr ?? "",
    });
  }
  if (result.status !== 0) {
    throw new ContainerError({ operation, object, argv, exitCode: result.status, spawnCode: null, stderr: result.stderr ?? "" });
  }
  return result.stdout ?? "";
}

/**
 * The variables that select the Docker client's engine and its credentials.
 * This process's client inherits them, but the tool server runs under the
 * harness's environment, which drops them, so a dispatch hands their values to
 * it (`dockerClientEnv`): the tool calls then reach the engine that created
 * their container (hazards 9 and 12).
 */
export const DOCKER_CLIENT_ENV = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

/** The `DOCKER_CLIENT_ENV` variables set in `source`, by name. */
export function dockerClientEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of DOCKER_CLIENT_ENV) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function noSuchObject(err: unknown): boolean {
  return err instanceof ContainerError && err.spawnCode === null && /no such (container|object|image)/i.test(err.stderrTail);
}

/** The first 8 hex digits of the SHA-256 of the repository root's resolved path. */
export function repositoryKey(rootDir: string): string {
  return createHash("sha256").update(resolve(rootDir)).digest("hex").slice(0, 8);
}

/** Whether the engine answers and runs Linux containers. */
export function dockerReady(dockerCommand: string[]): { ok: true; serverVersion: string } | { ok: false; reason: string } {
  let answer: string;
  try {
    answer = control(dockerCommand, "query", "the Docker engine", ["version", "--format", "{{.Server.Os}} {{.Server.Version}}"]).trim();
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const [os, version] = answer.split(" ");
  if (os !== "linux") {
    return { ok: false, reason: `the Docker engine runs ${JSON.stringify(os)} containers, not linux` };
  }
  return { ok: true, serverVersion: version ?? "" };
}

/**
 * The image's ID, building it from the committed `container/` directory when
 * no image with that directory's tag is present. The tag names a hash over
 * every file the build can copy (`sandboxImageTag`), so an edited Dockerfile
 * or runner config builds a new image rather than reusing an old one. This is
 * the only code that knows where the image comes from (extension point 1).
 */
export function ensureImage(dockerCommand: string[]): { imageId: string; tag: string; built: boolean } {
  const found = findSandboxImage(dockerCommand);
  if (found.imageId !== null) return { imageId: found.imageId, tag: found.tag, built: false };
  control(dockerCommand, "build image", found.tag, ["build", "-t", found.tag, DOCKERFILE_DIR], { timeoutMs: BUILD_TIMEOUT_MS });
  const built = findSandboxImage(dockerCommand);
  if (built.imageId === null) {
    throw new Error(`build image ${found.tag} succeeded, but no image with that tag is present afterwards`);
  }
  return { imageId: built.imageId, tag: found.tag, built: true };
}

const DOCKERFILE_DIR = join(import.meta.dirname, "..", "container");

/**
 * `bw-sandbox:` and the first 12 hex digits of a SHA-256 over every file under
 * `dir`, in sorted relative-path order, each fed as its `/`-separated path, a
 * NUL, its bytes and a NUL. Every file counts, not only the Dockerfile,
 * because the build copies others into the image
 * (docs/features/protected-acceptance-tests/plan.md).
 */
export function sandboxImageTag(dir: string): string {
  const files = (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(path).update("\0").update(readFileSync(join(dir, path))).update("\0");
  }
  return `bw-sandbox:${hash.digest("hex").slice(0, 12)}`;
}

/** The committed image directory's tag and the ID of the image under it, or null when it is not built; builds nothing. */
export function findSandboxImage(dockerCommand: string[]): { tag: string; imageId: string | null } {
  const tag = sandboxImageTag(DOCKERFILE_DIR);
  try {
    return { tag, imageId: control(dockerCommand, "inspect image", tag, ["image", "inspect", "--format", "{{.Id}}", tag]).trim() };
  } catch (err) {
    if (noSuchObject(err)) return { tag, imageId: null };
    throw err;
  }
}

/** Whether the frozen image ID is present locally; a Docker failure is raised, never read as absence. */
export function imagePresent(dockerCommand: string[], imageId: string): boolean {
  try {
    control(dockerCommand, "inspect image", imageId, ["image", "inspect", "--format", "{{.Id}}", imageId]);
    return true;
  } catch (err) {
    if (noSuchObject(err)) return false;
    throw err;
  }
}

/** Refuse a frozen image that is absent locally, naming a fresh run as the recovery (hard rule 6). */
export function requireImage(frozen: FrozenSandbox): void {
  try {
    control(frozen.dockerCommand, "find frozen image", frozen.imageId, ["image", "inspect", "--format", "{{.Id}}", frozen.imageId]);
  } catch (err) {
    if (noSuchObject(err)) {
      throw (err as ContainerError).withNote(
        `the image this run froze is not present locally; a rebuild is not guaranteed to reproduce its ID, so start a fresh run`
      );
    }
    throw err;
  }
}

/**
 * The programs among `programs` that the frozen image does not provide, by
 * `command -v` in a throwaway container with no network and no mounts. The
 * check sees only the programs named; it cannot see what they call.
 */
export function missingImagePrograms(frozen: FrozenSandbox, programs: string[]): string[] {
  requireImage(frozen);
  const unique = [...new Set(programs)];
  const stdout = control(frozen.dockerCommand, "check programs in image", frozen.imageId, [
    "run", "--rm", "--network", "none", "--user", frozen.user, frozen.imageId,
    "sh", "-c", 'for p in "$@"; do command -v "$p" >/dev/null 2>&1 || echo "missing $p"; done', "sh", ...unique,
  ]);
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("missing "))
    .map((line) => line.slice("missing ".length).trim());
}

/**
 * Write the files under each of `paths` at the worktree's `HEAD` into `dir`,
 * from Git's objects, never from the worktree's files: the worktree is the
 * writable `/work` mount, which a differently cased path reaches on a
 * case-insensitive host (docs/features/protected-acceptance-tests/plan.md,
 * Task 12). Anything but a regular file is refused.
 */
function writeCommittedPaths(worktreePath: string, paths: string[], dir: string): void {
  const git = (args: string[]): Buffer => {
    const result = spawnSync("git", args, { cwd: worktreePath, maxBuffer: CONTROL_MAX_BUFFER, windowsHide: true });
    if (result.error || result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed in ${worktreePath}: ${result.error?.message ?? (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim()}`);
    }
    return result.stdout;
  };
  for (const path of paths) {
    const entries = git(["ls-tree", "-r", "-z", "HEAD", "--", path]).toString("utf8").split("\0").filter((e) => e !== "");
    if (entries.length === 0) throw new Error(`read-only path ${JSON.stringify(path)} holds no file at HEAD in ${worktreePath}`);
    for (const entry of entries) {
      const [meta, file] = [entry.slice(0, entry.indexOf("\t")), entry.slice(entry.indexOf("\t") + 1)];
      const [mode, type, object] = meta.split(" ");
      if (type !== "blob" || (mode !== "100644" && mode !== "100755")) {
        throw new Error(`read-only path ${JSON.stringify(path)} holds ${file} with mode ${mode}, not a regular file`);
      }
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), git(["cat-file", "blob", object!]));
    }
  }
}

/**
 * Start one sandbox for `worktreePath`. A failure part-way removes exactly the
 * objects this call created, by the IDs Docker returned, never anything by
 * name pattern, and raises the start's `ContainerError` with any cleanup
 * failure appended.
 */
export function createSandbox(input: {
  frozen: FrozenSandbox;
  rootDir: string;
  runId: number;
  label: string;
  worktreePath: string;
  /**
   * Worktree-relative paths mounted read-only over `/work`, after the `.git`
   * overlay: the acceptance suite (docs/features/protected-acceptance-tests/plan.md,
   * Tasks 7 and 12). Each is mounted from a copy of its files at the worktree's
   * `HEAD` under `acceptanceMountDir`, not from the worktree. Absent, the argv
   * is unchanged.
   */
  readOnlyPaths?: string[];
}): Sandbox {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.label)) {
    throw new Error(`sandbox label ${JSON.stringify(input.label)} must be lowercase letters, digits and hyphens`);
  }
  for (const path of input.readOnlyPaths ?? []) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\/?$/.test(path)) {
      throw new Error(`read-only path ${JSON.stringify(path)} must be worktree-relative, with no empty, dot or dot-dot segment`);
    }
  }
  const { frozen } = input;
  requireImage(frozen);
  const repoKey = repositoryKey(input.rootDir);
  const instance = randomBytes(3).toString("hex");
  const name = `bw-${repoKey}-${input.runId}-${input.label}-${instance}`;
  const labels = ["--label", `bw.repo=${repoKey}`, "--label", `bw.run=${input.runId}`, "--label", `bw.instance=${instance}`];
  const proxyUrl = `http://${PROXY_ALIAS}:${PROXY_PORT}`;
  const sandbox: Sandbox = {
    frozen,
    name,
    network: `${name}-net`,
    proxy: `${name}-proxy`,
    work: `${name}-work`,
    ids: { network: null, proxy: null, work: null },
    // Loopback stays direct: a client that honours the proxy variables would
    // otherwise send a test's call to its own local server to the proxy, which
    // refuses it.
    env: [`HTTPS_PROXY=${proxyUrl}`, `HTTP_PROXY=${proxyUrl}`, `NO_PROXY=${LOOPBACK_HOSTS}`, ...frozen.env],
    mountDir: (input.readOnlyPaths ?? []).length > 0 ? acceptanceMountDir(input.rootDir, input.runId, name) : null,
  };
  const dc = frozen.dockerCommand;
  try {
    if (sandbox.mountDir !== null) writeCommittedPaths(input.worktreePath, input.readOnlyPaths!, sandbox.mountDir);
    sandbox.ids.network = control(dc, "create network", sandbox.network, [
      "network", "create", "--internal", ...labels, sandbox.network,
    ]).trim();
    sandbox.ids.proxy = control(dc, "start proxy", sandbox.proxy, [
      "run", "-d", "--name", sandbox.proxy, ...labels,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", frozen.user,
      "-v", `${EGRESS_PROXY_FILE}:${CONTAINER_PROXY_FILE}:ro`,
      frozen.imageId, "node", CONTAINER_PROXY_FILE, ...frozen.egressAllowlist,
    ]).trim();
    control(dc, "attach proxy", sandbox.proxy, [
      "network", "connect", "--alias", PROXY_ALIAS, sandbox.ids.network, sandbox.ids.proxy,
    ]);
    sandbox.ids.work = control(dc, "start work container", sandbox.work, [
      "run", "-d", "--name", sandbox.work, ...labels,
      // An init process as PID 1 reaps the orphans a command leaves; `sleep`
      // never does, and their zombies count against the pids limit until
      // Chromium cannot start (protected-acceptance-tests, Task 4 round 1).
      "--init",
      "--network", sandbox.ids.network,
      "--cpus", frozen.limits.cpus,
      "--memory", frozen.limits.memory, "--memory-swap", frozen.limits.memory,
      "--pids-limit", String(frozen.limits.pidsLimit),
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", frozen.user,
      "-v", `${input.worktreePath}:/work`,
      "-v", `${join(input.worktreePath, ".git")}:/work/.git:ro`,
      ...(input.readOnlyPaths ?? []).flatMap((path) => {
        const trimmed = path.replace(/\/$/, "");
        return ["-v", `${join(sandbox.mountDir!, trimmed)}:/work/${trimmed}:ro`];
      }),
      "-w", "/work",
      ...sandbox.env.flatMap((assignment) => ["--env", assignment]),
      frozen.imageId, "sleep", "infinity",
    ]).trim();
    return sandbox;
  } catch (err) {
    const teardown = destroySandbox(sandbox);
    if (err instanceof ContainerError && teardown.failures.length > 0) {
      throw err.withNote(`cleanup after the failed start also failed: ${teardown.failures.join("; ")}`);
    }
    throw err;
  }
}

export interface TeardownResult {
  removed: string[];
  failures: string[];
  /**
   * True only after `docker rm -f` on the work container succeeded and a
   * following `docker container inspect` of that ID reported no such
   * container, or when no work container was ever created. Until then a
   * command left running in it could still be writing the worktree.
   */
  workContainerGone: boolean;
}

/** Remove the objects the sandbox created, recording every failure rather than throwing. */
export function destroySandbox(sandbox: Sandbox): TeardownResult {
  const dc = sandbox.frozen.dockerCommand;
  const removed: string[] = [];
  const failures: string[] = [];
  let workContainerGone = sandbox.ids.work === null;
  if (sandbox.ids.work !== null) {
    let rmOk = false;
    try {
      control(dc, "remove work container", sandbox.work, ["rm", "-f", sandbox.ids.work]);
      rmOk = true;
      removed.push(sandbox.work);
    } catch (err) {
      failures.push((err as Error).message);
    }
    try {
      control(dc, "inspect work container", sandbox.work, ["container", "inspect", "--format", "{{.Id}}", sandbox.ids.work]);
      failures.push(`work container ${sandbox.work} (${sandbox.ids.work}) still exists after removal`);
    } catch (err) {
      if (noSuchObject(err)) {
        workContainerGone = rmOk;
      } else {
        failures.push((err as Error).message);
      }
    }
  }
  if (sandbox.ids.proxy !== null) {
    try {
      control(dc, "remove proxy", sandbox.proxy, ["rm", "-f", sandbox.ids.proxy]);
      removed.push(sandbox.proxy);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  if (sandbox.ids.network !== null) {
    try {
      control(dc, "remove network", sandbox.network, ["network", "rm", sandbox.ids.network]);
      removed.push(sandbox.network);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }
  if (sandbox.mountDir !== null) {
    try {
      rmSync(sandbox.mountDir, { recursive: true, force: true });
      removed.push(sandbox.mountDir);
    } catch (err) {
      failures.push(`remove read-only copy ${sandbox.mountDir} failed: ${(err as Error).message}`);
    }
  }
  return { removed, failures, workContainerGone };
}

/** What `withSandbox` reports: the failed start, or the body's value and the teardown. */
export type SandboxRun<T> =
  | { started: false; error: Error }
  | { started: true; sandbox: Sandbox; value: T; teardown: TeardownResult };

/**
 * Start a sandbox, run `body` against it, and tear it down whatever `body`
 * does. A failed start is returned, not thrown, so the caller can record
 * `<stage>.sandbox.failed` before anything else happens. A throw from `body`
 * propagates after teardown, with any teardown failure appended to its
 * message. What the teardown means is the caller's: a false
 * `workContainerGone` must block the stage before any host step reads the
 * worktree (`unquiescedReason`).
 */
export async function withSandbox<T>(
  input: Parameters<typeof createSandbox>[0],
  body: (sandbox: Sandbox) => Promise<T>
): Promise<SandboxRun<T>> {
  let sandbox: Sandbox;
  try {
    sandbox = createSandbox(input);
  } catch (err) {
    return { started: false, error: err as Error };
  }
  let value: T;
  try {
    value = await body(sandbox);
  } catch (err) {
    const teardown = destroySandbox(sandbox);
    if (teardown.failures.length > 0) {
      throw new Error(`${(err as Error).message}; tearing down sandbox ${sandbox.name} also failed: ${teardown.failures.join("; ")}`, { cause: err });
    }
    throw err;
  }
  return { started: true, sandbox, value, teardown: destroySandbox(sandbox) };
}

/**
 * Why a stage cannot go on after a teardown whose work container is not
 * proven gone: a process left in it could still be writing the worktree.
 * `primary` is the stage's own error, which comes first when there is one.
 */
export function unquiescedReason(sandbox: Sandbox, teardown: TeardownResult, primary: string | null): string {
  const cause = `work container ${sandbox.work} (${sandbox.ids.work}) could not be proven removed, so a process left in it could still write the worktree: ${teardown.failures.join("; ")}`;
  return primary === null ? cause : `${primary}; and the ${cause}`;
}

/** Write the proxy's `docker logs` to `path`, before teardown removes them. */
export function captureProxyLog(sandbox: Sandbox, path: string): void {
  if (sandbox.ids.proxy === null) {
    throw new Error(`sandbox ${sandbox.name} has no proxy container to read a log from`);
  }
  const log = control(sandbox.frozen.dockerCommand, "read proxy log", sandbox.proxy, ["logs", sandbox.ids.proxy]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, log);
}

/**
 * Remove ignored paths from inside a throwaway container of the frozen image,
 * because the Linux symlinks a package manager leaves on the bind mount cannot
 * be opened from Windows (spike Task 1). Git on the host names the paths; the
 * worktree's `.git` is mounted read-only here too.
 */
export function removeIgnoredOutputInContainer(frozen: FrozenSandbox, worktreePath: string, paths: string[]): void {
  if (paths.length === 0) return;
  requireImage(frozen);
  const chunks: string[][] = [[]];
  let size = 0;
  for (const path of paths) {
    if (size + path.length > REMOVE_ARGV_CHARS && chunks[chunks.length - 1]!.length > 0) {
      chunks.push([]);
      size = 0;
    }
    chunks[chunks.length - 1]!.push(path);
    size += path.length + 1;
  }
  for (const chunk of chunks) {
    control(frozen.dockerCommand, "remove ignored output in", worktreePath, [
      "run", "--rm", "--network", "none",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", frozen.user,
      "-v", `${worktreePath}:/work`,
      "-v", `${join(worktreePath, ".git")}:/work/.git:ro`,
      "-w", "/work",
      frozen.imageId, "sh", "-c", 'rm -rf -- "$@"', "sh", ...chunk,
    ], { timeoutMs: 600_000 });
  }
}

/** The containers and networks labelled with this repository's key, as `<id> <name>` lines. */
export function sandboxLeftovers(dockerCommand: string[], rootDir: string): { containers: string[]; networks: string[] } {
  const filter = `label=bw.repo=${repositoryKey(rootDir)}`;
  const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  return {
    containers: lines(control(dockerCommand, "list containers labelled", filter, ["ps", "-a", "--filter", filter, "--format", "{{.ID}} {{.Names}}"])),
    networks: lines(control(dockerCommand, "list networks labelled", filter, ["network", "ls", "--filter", filter, "--format", "{{.ID}} {{.Name}}"])),
  };
}

export function execTarget(sandbox: Sandbox): ExecTarget {
  if (sandbox.ids.work === null) {
    throw new Error(`sandbox ${sandbox.name} has no work container`);
  }
  return { dockerCommand: sandbox.frozen.dockerCommand, work: sandbox.ids.work };
}

/** A fresh token naming one command's exit-status file. */
export function newExitToken(): string {
  return randomBytes(8).toString("hex");
}

/**
 * The `docker exec` argv that runs `argv` in the work container under the
 * in-container ceiling and records its exit status in `/tmp/bw-exit-<token>`.
 * Because `timeout` runs inside the wrapper, a ceiling kill is recorded too,
 * as 137.
 */
export function execArgv(target: ExecTarget, argv: string[], token: string, timeoutSeconds: number): string[] {
  if (!/^[0-9a-f]{16}$/.test(token)) throw new Error(`exit-status token ${JSON.stringify(token)} is not 16 hex digits`);
  return [
    ...target.dockerCommand,
    "exec", "-i", target.work,
    "sh", "-c", `timeout --signal=KILL "$0" "$@"; echo $? > /tmp/bw-exit-${token}`,
    String(timeoutSeconds), ...argv,
  ];
}

/** The exit status the wrapper recorded, or a `ContainerError` when the file is absent. */
export function readExitStatus(target: ExecTarget, token: string, context = ""): number {
  let text: string;
  try {
    text = control(target.dockerCommand, "read exit status in", target.work, ["exec", target.work, "cat", `/tmp/bw-exit-${token}`]).trim();
  } catch (err) {
    if (err instanceof ContainerError && context !== "") throw err.withNote(context);
    throw err;
  }
  if (!/^\d+$/.test(text)) {
    throw new ContainerError({
      operation: "read exit status in",
      object: target.work,
      argv: ["cat", `/tmp/bw-exit-${token}`],
      exitCode: 0,
      spawnCode: null,
      stderr: "",
      note: `the exit-status file holds ${JSON.stringify(text.slice(0, 100))}, not a number`,
    });
  }
  return Number(text);
}

export interface SandboxCommandOptions {
  /** A host directory to spawn the Docker client in; the run's worktree. */
  cwd: string;
  timeoutSeconds: number;
  maxBytes: number;
  retentionMaxBytes: number;
  evidencePath: string;
}

/**
 * Run one command in the work container with `runVerifyCommand`'s bounded
 * streaming and evidence file. The outcome's `argv` is the command's own, and
 * its exit code is the one the wrapper recorded, never `docker exec`'s. A
 * kill at the in-container ceiling is reported as `timedOut`; an out-of-memory
 * kill also exits 137, but before the ceiling elapsed, so it stays an exit
 * code. The evidence file's first line names the container, the image and the
 * argv, so the log alone says where the command ran.
 */
export async function runInSandbox(
  target: ExecTarget,
  /** The frozen image ID for the evidence header, or null where the caller is not told it (the tool server). */
  imageId: string | null,
  cmd: VerifyCommand,
  opts: SandboxCommandOptions
): Promise<CommandOutcome> {
  const token = newExitToken();
  const argv = execArgv(target, cmd.command, token, opts.timeoutSeconds);
  const outcome = await runVerifyCommand(
    { name: cmd.name, command: argv },
    {
      cwd: opts.cwd,
      timeoutSeconds: opts.timeoutSeconds + HOST_KILL_GRACE_SECONDS,
      maxBytes: opts.maxBytes,
      retentionMaxBytes: opts.retentionMaxBytes,
      evidencePath: opts.evidencePath,
      evidenceHeader: `# ran in container ${target.work}${imageId === null ? "" : ` (image ${imageId})`}: ${JSON.stringify(cmd.command)}\n`,
    }
  );
  const own = { ...outcome, argv: [...cmd.command] };
  if (outcome.spawnError !== null) {
    throw new ContainerError({
      operation: "exec in",
      object: target.work,
      argv,
      exitCode: null,
      spawnCode: outcome.spawnError,
      stderr: outcome.stderr,
    });
  }
  if (outcome.timedOut) return { ...own, exitCode: null };
  let exitCode: number;
  try {
    exitCode = readExitStatus(
      target,
      token,
      `docker exec itself exited ${outcome.exitCode}: ${stderrTail(outcome.stderr) || "no stderr"}`
    );
  } catch (err) {
    // A command killed for filling its retention ceiling may not have reached
    // the wrapper's write; its outcome is already decided by the overflow.
    if (outcome.outputOverflow) return { ...own, exitCode: null };
    throw err;
  }
  const ceilingFired = exitCode === 137 && outcome.durationMs >= opts.timeoutSeconds * 1000;
  return { ...own, exitCode, timedOut: ceilingFired };
}

export interface CapturedExec {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  ceilingFired: boolean;
  outputOverflow: boolean;
}

/**
 * Run `argv` in the work container with `stdin` piped in and stdout captured
 * up to `maxBytes`: the tool server's file tools, which need stdin and whose
 * output is the answer rather than evidence. Same wrapper, same exit-status
 * read and same double ceiling as `runInSandbox`.
 */
export function execCaptured(
  target: ExecTarget,
  argv: string[],
  options: { stdin?: string; timeoutSeconds: number; maxBytes: number }
): Promise<CapturedExec> {
  const token = newExitToken();
  const full = execArgv(target, argv, token, options.timeoutSeconds);
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(full[0]!, full.slice(1), { shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let overflow = false;
    let hostKilled = false;
    let settled = false;
    const keep = (chunk: Buffer, into: Buffer[], size: number): number => {
      const room = options.maxBytes - size;
      if (room <= 0) {
        overflow = true;
        return size;
      }
      const kept = chunk.subarray(0, room);
      if (kept.length < chunk.length) overflow = true;
      into.push(kept);
      return size + kept.length;
    };
    const timer = setTimeout(() => {
      hostKilled = true;
      if (child.pid !== undefined) {
        try {
          killTree(child.pid);
        } catch (killErr) {
          err.push(Buffer.from(`\nhost kill failed: ${(killErr as Error).message}\n`));
        }
      }
    }, (options.timeoutSeconds + HOST_KILL_GRACE_SECONDS) * 1000);
    child.stdout.on("data", (d: Buffer) => {
      outBytes = keep(d, out, outBytes);
    });
    child.stderr.on("data", (d: Buffer) => {
      errBytes = keep(d, err, errBytes);
    });
    child.stdin.on("error", (stdinErr) => {
      // The client exited before reading its input (a missing container); its
      // own stderr and the exit-status read below name the cause.
      err.push(Buffer.from(`\nstdin write failed: ${stdinErr.message}\n`));
    });
    child.on("error", (spawnErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new ContainerError({
          operation: "exec in",
          object: target.work,
          argv: full,
          exitCode: null,
          spawnCode: (spawnErr as NodeJS.ErrnoException).code ?? spawnErr.message,
          stderr: Buffer.concat(err).toString("utf8"),
        })
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      const elapsedMs = Date.now() - started;
      if (hostKilled) {
        resolvePromise({ exitCode: null, stdout, stderr, elapsedMs, ceilingFired: true, outputOverflow: overflow });
        return;
      }
      try {
        const exitCode = readExitStatus(target, token, `docker exec itself exited ${code}: ${stderrTail(stderr) || "no stderr"}`);
        const ceilingFired = exitCode === 137 && elapsedMs >= options.timeoutSeconds * 1000;
        resolvePromise({ exitCode, stdout, stderr, elapsedMs, ceilingFired, outputOverflow: overflow });
      } catch (readErr) {
        reject(readErr);
      }
    });
    child.stdin.end(options.stdin ?? "");
  });
}
