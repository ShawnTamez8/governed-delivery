import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { ExecutorDefinition } from "./executor.ts";

export interface InvocationInput {
  prompt: string;
  idleTimeoutSeconds?: number;
  absoluteTimeoutSeconds?: number;
  model?: string;
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
export const RESULT_MAX_BYTES = 1024 * 1024;
const CLOSE_GRACE_MS = 1000;

const WINDOWS = process.platform === "win32";

/**
 * Kill the whole process tree, not the immediate child. On Windows the child
 * pid belongs to the cmd.exe wrapper (shell: true), so `taskkill /t` reaches
 * the harness binary and everything under it. `taskkill` runs by full path —
 * the harness environment deliberately has no guaranteed PATH (hazard 9's
 * class), and a PATH-miss that silently skips the kill is a timeout that
 * never fires. On POSIX the child is detached and the negative pid kills its
 * process group.
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
export function probeExecutor(executor: ExecutorDefinition): void {
  const result = spawnSync(executor.probe[0], executor.probe.slice(1), {
    shell: WINDOWS,
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`probe failed for executor ${executor.id}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim();
    throw new Error(
      `probe failed for executor ${executor.id}: ${executor.probe.join(" ")} exited with code ${result.status}${detail ? `: ${detail}` : ""}`
    );
  }
}

/**
 * Parse the machine-generated outer envelope. Field names come from the one
 * recorded real invocation (hard rule 5), not from documentation memory.
 * The effective model is the unique `modelUsage` entry whose input tokens
 * match the top-level `usage.input_tokens`: the recorded envelope shows
 * auxiliary model queries (a title generation) alongside the real turn, and
 * only the effective model's usage lands in the top-level `usage`. Anything
 * the envelope omits stays `null`, never zero.
 */
export function parseEnvelope(executor: ExecutorDefinition, raw: string): HarnessEnvelope {
  let parsed: EnvelopeShape;
  try {
    parsed = JSON.parse(raw) as EnvelopeShape;
  } catch (err) {
    throw new Error(`harness envelope for executor ${executor.id} is not valid JSON: ${(err as Error).message}`);
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
  const env: Record<string, string> = {};
  for (const name of executor.sandbox.envPassthrough) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  const argv = [...executor.command.slice(1)];
  if (input.model !== undefined) argv.push("--model", input.model);
  const child: ChildProcess = spawn(executor.command[0], argv, {
    shell: WINDOWS, // hazard 8: npm-shimmed .cmd executables need shell resolution
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
      const remaining = RESULT_MAX_BYTES - stdoutBytes;
      if (remaining <= 0) return;
      const kept = d.subarray(0, remaining);
      stdoutBytes += kept.length;
      stdoutChunks.push(kept);
      if (kept.length < d.length) {
        // Section 20: cap the result, refuse above the cap, retain the
        // capped prefix so the refusal is diagnosable.
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
