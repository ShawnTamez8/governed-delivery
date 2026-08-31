import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { VerifyCommand } from "./governed-config.ts";
import { killTree } from "./harness.ts";

/**
 * What one verification command did.
 *
 * The field names mirror `HarnessOutcome` deliberately — `timedOut`,
 * `spawnError`, `killError`, `durationMs` mean the same things here, and a
 * reader who knows one contract should not have to learn a second vocabulary
 * for the same facts. The two remain **separate contracts** rather than a
 * shared spawn abstraction: their inputs differ (a prompt over stdin and an
 * envelope to parse, against an argv and an exit code), and hard rule 4
 * forbids extracting an abstraction before something actually needs one.
 */
export interface CommandOutcome {
  name: string;
  argv: string[];
  exitCode: number | null;
  timedOut: boolean;
  spawnError: string | null;
  killError: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  outputOverflow: boolean;
  evidenceRef: string;
}

export interface RunVerifyCommandOptions {
  /** The run's worktree: commands verify the branch, not the main tree. */
  cwd: string;
  timeoutSeconds: number;
  /**
   * The in-memory budget, spent **combined across both streams**.
   *
   * Deliberately unlike `invokeHarness`, which spends `RESULT_MAX_BYTES` on
   * stdout alone and accumulates stderr unbounded. That is right there — the
   * envelope it must parse is on stdout — and wrong here, where a command's
   * diagnosis is as likely to be on one stream as the other. The difference
   * is named because the two callers read the same policy number, and an
   * unnamed divergence between two enforcers of one value is hazard 12.
   */
  maxBytes: number;
  /**
   * The ceiling on what reaches the evidence file. Retention is independent
   * of `maxBytes` (hazard 2), so this is the only thing bounding disk: a
   * command writing at pipe speed reaches gigabytes inside the time ceiling.
   * On breach the process tree is killed; `outputOverflow` is already set by
   * then, so the caller blocks either way.
   */
  retentionMaxBytes: number;
  envPassthrough: string[];
  /** Where the complete output is retained, regardless of the budget. */
  evidencePath: string;
}

const WINDOWS = process.platform === "win32";

/**
 * A descendant inheriting the stdout pipe can keep `close` from ever firing.
 * `invokeHarness` holds the same grace period for the same reason: settle
 * shortly after `exit` rather than hang, but allow late output to arrive
 * first.
 */
const CLOSE_GRACE_MS = 1000;

/**
 * Run one verification command inside the run's worktree, under a named
 * environment, a bounded wall-clock ceiling, and a bounded in-memory output
 * budget.
 *
 * **Retention is independent of the budget.** Every chunk of stdout and
 * stderr is written to the evidence file as it arrives, before any exit code
 * is examined; only the in-memory copy stops at `maxBytes`. Section 20
 * requires refusing above the cap *and* retaining the bytes anyway, and
 * hazard 2 is the reason: bytes discarded above a cap are bytes no diagnosis
 * can recover. Overflow is reported, never silently truncated, and the caller
 * blocks on it.
 *
 * The promise resolves for every ordinary failure — a non-zero exit, a
 * timeout, a shell that cannot start — so the caller can retain evidence and
 * decide. It rejects only when the evidence file itself cannot be written,
 * because that is the one failure where continuing would claim a retention
 * the run does not have.
 */
export function runVerifyCommand(
  cmd: VerifyCommand,
  opts: RunVerifyCommandOptions
): Promise<CommandOutcome> {
  const started = Date.now();
  // Section 17: named variables only, never the whole environment. This
  // stage runs implementer-authored code, and a spread of `process.env` would
  // hand it BW_APPROVAL_PUBLIC_KEY.
  const env: Record<string, string> = {};
  for (const name of opts.envPassthrough) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }

  mkdirSync(dirname(opts.evidencePath), { recursive: true });
  const evidence = createWriteStream(opts.evidencePath);

  const child: ChildProcess = spawn(cmd.command[0], cmd.command.slice(1), {
    // hazard 8: `npm run typecheck` is an npm shim, and a shim needs shell
    // resolution on Windows. The parser constrains every token to characters
    // the shell leaves alone, so the argv the audit records is the argv that
    // ran.
    shell: WINDOWS,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    detached: !WINDOWS, // so the negative pid reaches the whole group
    cwd: opts.cwd,
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let keptBytes = 0;
  let retainedBytes = 0;
  let outputOverflow = false;
  let timedOut = false;
  let spawnError: string | null = null;
  let killError: string | null = null;
  let evidenceError: string | null = null;
  let exitCode: number | null = null;
  let settled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  return new Promise((resolve, reject) => {
    const settle = () => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      // Resolve only once the retained bytes are actually on disk: the
      // evidence file is the thing this function promises, and a caller that
      // reads it immediately must not race the flush.
      evidence.end(() => {
        if (evidenceError !== null) {
          reject(new Error(`cannot retain output for command ${cmd.name} at ${opts.evidencePath}: ${evidenceError}`));
          return;
        }
        resolve({
          name: cmd.name,
          argv: [...cmd.command],
          exitCode,
          timedOut,
          spawnError,
          killError,
          // Decoded once at the end, so a multi-byte character split across
          // two pipe chunks survives intact.
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          durationMs: Date.now() - started,
          outputOverflow,
          evidenceRef: opts.evidencePath,
        });
      });
    };

    const keep = (chunk: Buffer, into: Buffer[]) => {
      // The evidence file gets the whole chunk, always, before the budget is
      // consulted — retention is what makes a refusal diagnosable, and it must
      // not depend on the in-memory cap. It does have a ceiling of its own,
      // because "retain everything" against an unbounded stream is a full
      // disk rather than a better diagnosis.
      if (evidenceError === null && retainedBytes < opts.retentionMaxBytes) {
        const room = opts.retentionMaxBytes - retainedBytes;
        const written = chunk.length <= room ? chunk : chunk.subarray(0, room);
        retainedBytes += written.length;
        evidence.write(written);
        if (retainedBytes >= opts.retentionMaxBytes) killForRetention();
      }
      const remaining = opts.maxBytes - keptBytes;
      if (remaining <= 0) {
        outputOverflow = true;
        return;
      }
      const kept = chunk.subarray(0, remaining);
      keptBytes += kept.length;
      into.push(kept);
      if (kept.length < chunk.length) outputOverflow = true;
    };

    evidence.on("error", (err) => {
      evidenceError = err.message;
    });

    /**
     * Stop a command that has filled its retention ceiling. It has already
     * exhausted the in-memory budget by this point — the retention ceiling is
     * far larger — so `outputOverflow` is set and the caller will block
     * whatever happens next. Killing it only stops the disk filling while the
     * answer is already known. Not a timeout: `timedOut` stays false so the
     * refusal names overflow, which is the true cause.
     */
    const killForRetention = () => {
      if (settled || child.exitCode !== null || child.pid === undefined) return;
      outputOverflow = true;
      try {
        killTree(child.pid);
      } catch (err) {
        killError = err instanceof Error ? err.message : String(err);
      }
    };

    timers.push(
      setTimeout(() => {
        if (child.exitCode !== null) return; // already exited; the exit path settles
        timedOut = true;
        if (child.pid === undefined) {
          // No process was created, so there is nothing to kill. That is a
          // spawn failure, not a timeout that killed something.
          spawnError = spawnError ?? "the command never started: no pid";
          settle();
          return;
        }
        try {
          killTree(child.pid);
        } catch (err) {
          // A throw in a timer callback is an uncaught exception that kills
          // the CLI. Record it and settle: an orphaned child named in the
          // outcome beats a wedged run.
          killError = err instanceof Error ? err.message : String(err);
          settle();
        }
      }, opts.timeoutSeconds * 1000)
    );

    child.stdout!.on("data", (d: Buffer) => keep(d, stdoutChunks));
    child.stderr!.on("data", (d: Buffer) => keep(d, stderrChunks));
    child.on("exit", (code) => {
      exitCode = code;
      for (const t of timers) clearTimeout(t);
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
  });
}
