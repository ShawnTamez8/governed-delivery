import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { isAbsolute, join } from "node:path";
import type { ExecutorDefinition } from "./executor.ts";

export interface InvocationInput {
  prompt: string;
  idleTimeoutSeconds?: number;
  absoluteTimeoutSeconds?: number;
  model?: string;
  /**
   * The effort level passed as `--effort`, next to `--model` and per
   * invocation, so it is not part of the frozen executor definition. The CLI
   * only warns about an unknown level, so callers validate it at freeze time.
   */
  effort?: string;
  /**
   * The working directory the harness process starts in. The implementation
   * stage runs the harness inside the run's worktree so the implementer
   * reads the repository it patches. Raw output retention is unaffected:
   * `dispatchOnce`'s `rootDir` argument is unchanged — only the spawn's
   * `cwd` moves.
   */
  cwd?: string;
}

export interface HarnessOutcome {
  raw: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  spawnError: string | null;
  killError: string | null;
  resultOverflow: boolean;
}

export interface HarnessEnvelope {
  effectiveModel: string | null;
  fallback: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  cost: number | null;
  resultText: string;
}

interface EnvelopeShape {
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number }>;
}

// Section 20: every limit has a defined behaviour on breach. These values
// move to configuration when the config loader exists; until then they are
// the single place to change them.
export const PROMPT_MAX_BYTES = 1024 * 1024;
/** Caps the result text the executor reports, not the stream that carries it. */
export const RESULT_MAX_BYTES = 1024 * 1024;
/**
 * The ceiling on how much stdout is kept, separate from and much larger than
 * `RESULT_MAX_BYTES` (section 20). The stream is the result text plus every
 * partial-message chunk and every tool call and result: the recorded capture
 * measured text chunks at about 18 times the result text and tool results at
 * about 2.3 times the files read
 * (test/fixtures/recorded/harness-stream-json-envelope.json, one sample). The
 * result cap does not bound the tool results, because the read-only tools can
 * open any file in the worktree. No measured bound exists, so this is a
 * disk-and-memory safety limit sized like `VERIFY_RETENTION_MAX_BYTES`, not a
 * tight fit: it holds a maximum-size result several times over. On breach the
 * process is killed and `resultOverflow` is set.
 */
export const STREAM_RETAIN_MAX_BYTES = 64 * 1024 * 1024;
const CLOSE_GRACE_MS = 1000;

const WINDOWS = process.platform === "win32";

/**
 * Kill the whole process tree, not the immediate child. On Windows the child
 * pid belongs to the directly spawned harness executable, and `taskkill /t`
 * reaches everything under it. `taskkill` runs by full path — the harness
 * environment deliberately has no guaranteed PATH (hazard 9's class), and a
 * PATH-miss that silently skips the kill is a timeout that never fires. On
 * POSIX the child is detached and the negative pid kills its process group.
 */
export function killTree(pid: number): void {
  if (WINDOWS) {
    const taskkill = join(process.env.SystemRoot ?? "C:\\WINDOWS", "System32", "taskkill.exe");
    const result = spawnSync(taskkill, ["/pid", String(pid), "/t", "/f"], { encoding: "utf8" });
    if (result.error) {
      throw new Error(`tree-kill failed: ${result.error.message}`);
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  }
}

/**
 * Hazard 9: verify the executable resolves in the environment that will
 * actually spawn it, and fail closed with a named cause before any real
 * invocation is attempted.
 */
export interface ProbeOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
  cwd?: string;
  executablePath?: string;
}

export interface ProbeResult {
  stdout: string;
  stderr: string;
}

export function probeExecutor(executor: ExecutorDefinition, options: ProbeOptions = {}): ProbeResult {
  if (options.executablePath !== undefined && !isAbsolute(options.executablePath)) {
    throw new Error(`probe failed for executor ${executor.id}: executablePath must be absolute`);
  }
  const result = spawnSync(options.executablePath ?? executor.probe[0], executor.probe.slice(1), {
    shell: false,
    encoding: "utf8",
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  if (result.error) {
    if (options.timeoutMs !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      throw new Error(`probe failed for executor ${executor.id}: timed out after ${options.timeoutMs} ms (${result.error.message})`);
    }
    throw new Error(`probe failed for executor ${executor.id}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].map((text) => (text ?? "").trim()).filter(Boolean).join("; ");
    throw new Error(
      `probe failed for executor ${executor.id}: ${executor.probe.join(" ")} exited with code ${result.status}${detail ? `: ${detail}` : ""}`
    );
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function buildHarnessEnvironment(
  executor: ExecutorDefinition,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of executor.sandbox.envPassthrough) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * Parse the machine-generated outer envelope: newline-delimited JSON from
 * `--output-format stream-json`, whose one `type: "result"` line is the last
 * line and carries the fields read below. The shape and field names come from
 * the one recorded real invocation
 * (test/fixtures/recorded/harness-stream-json-envelope.json; hard rule 5),
 * not from documentation memory. Exactly that shape is accepted: a line that
 * is not a JSON object, no result line, more than one, or a result line that
 * is not last is refused by name (hazard 1), never repaired. The inner
 * `result` text is unchanged and is still parsed by `extractJsonBody`.
 *
 * The effective model is the unique `modelUsage` entry whose input tokens
 * match the top-level `usage.input_tokens`. The recording has one entry, so it
 * shows only that this match still runs on the stream's result line; the
 * two-entry case (an auxiliary model beside the real turn, whose usage does
 * not land in the top-level `usage`) is evidenced by the committed recorded
 * chain fixtures, whose envelopes are one-line streams. A match that finds no
 * unique entry yields `null`. Anything the envelope omits stays `null`, never
 * zero.
 */
export function parseEnvelope(executor: ExecutorDefinition, raw: string): HarnessEnvelope {
  const refuse = (cause: string) => new Error(`harness envelope for executor ${executor.id} ${cause}`);
  const results: { line: number; shape: EnvelopeShape }[] = [];
  let lastLine = 0;
  const physical = raw.split(/\r?\n/);
  for (let index = 0; index < physical.length; index++) {
    const text = physical[index];
    if (text.trim() === "") continue;
    const line = index + 1;
    lastLine = line;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (err) {
      throw refuse(`is not valid JSON: line ${line}: ${(err as Error).message}`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw refuse(`has a line that is not a JSON object: line ${line}`);
    }
    if ((value as { type?: unknown }).type === "result") results.push({ line, shape: value as EnvelopeShape });
  }
  if (results.length === 0) throw refuse(`has no result line (expected exactly one line with type "result")`);
  if (results.length > 1) throw refuse(`has ${results.length} result lines (expected exactly one)`);
  if (results[0].line !== lastLine) {
    throw refuse(`result line ${results[0].line} is not the last line (line ${lastLine})`);
  }
  const parsed = results[0].shape;
  if (parsed.result !== undefined && typeof parsed.result !== "string") {
    throw refuse(`has a result line whose result is not a string: line ${results[0].line}`);
  }
  const usage = parsed.usage ?? {};
  const matches = Object.entries(parsed.modelUsage ?? {}).filter(([, u]) => u.inputTokens === usage.input_tokens);
  return {
    effectiveModel: matches.length === 1 ? matches[0][0] : null,
    fallback: null,
    tokensIn: usage.input_tokens ?? null,
    tokensOut: usage.output_tokens ?? null,
    cacheRead: usage.cache_read_input_tokens ?? null,
    cacheWrite: usage.cache_creation_input_tokens ?? null,
    cost: parsed.total_cost_usd ?? null,
    resultText: parsed.result ?? "",
  };
}

/**
 * One process per invocation. The prompt travels over stdin and stdin closes
 * (section 11: never argv). The child environment is filtered to the
 * executor's passthrough list (section 17: named variables only). The idle
 * timer resets on any stdout or stderr output; the absolute timer never
 * resets. Either firing kills the process tree and flags `timedOut`.
 *
 * The promise always resolves — never rejects — so every failure path can
 * retain evidence and audit the attempt before the caller branches. Output
 * is accumulated as buffers and decoded once, so multi-byte characters split
 * across pipe chunks survive intact. Async by necessity: the timeout timers
 * run on the same thread as any synchronous wait, so a sync wait would
 * starve the timers and the timeout could never fire.
 */
export function invokeHarness(executor: ExecutorDefinition, input: InvocationInput): Promise<HarnessOutcome> {
  const started = Date.now();
  const env = buildHarnessEnvironment(executor);
  const argv = [...executor.command.slice(1)];
  if (input.model !== undefined) argv.push("--model", input.model);
  if (input.effort !== undefined) argv.push("--effort", input.effort);
  const child: ChildProcess = spawn(executor.command[0], argv, {
    // The installed Claude Code launcher is a native executable. Spawn it
    // directly, as PowerShell does, so argv has one parser and no cmd.exe
    // wrapper. Actual npm shims are handled by the verification-command path.
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    env,
    detached: !WINDOWS,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let timedOut = false;
  let killError: string | null = null;
  let spawnError: string | null = null;
  let resultOverflow = false;
  let exitCode: number | null = null;
  let settled = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const idleMs = (input.idleTimeoutSeconds ?? executor.sandbox.idleTimeoutSeconds) * 1000;
  const absoluteMs = (input.absoluteTimeoutSeconds ?? executor.sandbox.absoluteTimeoutSeconds) * 1000;

  return new Promise((resolve) => {
    const settle = () => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      if (idleTimer) clearTimeout(idleTimer);
      resolve({
        raw: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
        durationMs: Date.now() - started,
        timedOut,
        spawnError,
        killError,
        resultOverflow,
      });
    };
    const fireTimeout = () => {
      if (child.exitCode !== null) return; // already exited; the exit path settles
      timedOut = true;
      if (child.pid === undefined) {
        settle();
        return;
      }
      try {
        killTree(child.pid);
      } catch (err) {
        // A kill that fails must not crash the timer callback (uncaught
        // exception kills the process). Settle so the lock releases and the
        // attempt is auditable; the orphaned child is documented in the
        // outcome rather than wedging the repository.
        killError = err instanceof Error ? err.message : String(err);
        settle();
      }
    };
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(fireTimeout, idleMs);
    };

    timers.push(setTimeout(fireTimeout, absoluteMs));
    child.stdout!.on("data", (d: Buffer) => {
      const remaining = STREAM_RETAIN_MAX_BYTES - stdoutBytes;
      if (remaining <= 0) {
        // The previous chunk ended exactly on the ceiling, so it did not flag
        // overflow; more output arriving now is the overflow.
        resultOverflow = true;
        fireTimeout();
        return;
      }
      const kept = d.subarray(0, remaining);
      stdoutBytes += kept.length;
      stdoutChunks.push(kept);
      if (kept.length < d.length) {
        // Section 20: retention is bounded by its own ceiling, far above the
        // result cap. Kill on breach and retain the capped prefix so the
        // refusal is diagnosable. The result cap applies to the parsed
        // result text, in `dispatchOnce`.
        resultOverflow = true;
        fireTimeout();
      }
      resetIdle();
    });
    child.stderr!.on("data", (d: Buffer) => {
      stderrChunks.push(d);
      resetIdle();
    });
    child.stdin!.on("error", () => {
      // The child exited without draining stdin (EPIPE/EOF). Without a
      // listener this is an unhandled 'error' that crashes the process.
      // The exit path settles the outcome.
    });
    child.on("exit", (code) => {
      exitCode = code;
      for (const t of timers) clearTimeout(t);
      if (idleTimer) clearTimeout(idleTimer);
      // A descendant inheriting the stdout pipe can keep 'close' from ever
      // firing; settle a grace period after exit rather than hanging while
      // holding the repository lock.
      timers.push(setTimeout(settle, CLOSE_GRACE_MS));
    });
    child.on("close", (code) => {
      exitCode = code;
      settle();
    });
    child.on("error", (err) => {
      spawnError = err.message;
      settle();
    });
    resetIdle();
    child.stdin!.write(input.prompt);
    child.stdin!.end();
  });
}
