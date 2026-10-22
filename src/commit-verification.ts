import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  ContainerError,
  execTarget,
  removeIgnoredOutputInContainer,
  runInSandbox,
  unquiescedReason,
  withSandbox,
  type FrozenSandbox,
  type Sandbox,
} from "./container.ts";
import type { RecordedAcceptanceTest } from "./acceptance.ts";
import type { VerifyCommand } from "./governed-config.ts";
import type { CommandOutcome } from "./verify-command.ts";

export interface RecordedVerificationCommand {
  name: string;
  argv: string[];
  exitCode: number | null;
  timedOut: boolean;
  spawnError: string | null;
  killError: string | null;
  outputOverflow: boolean;
  durationMs: number;
  evidenceRef: string;
  blockedBecause: string | null;
}

export interface CommitVerificationRecord {
  expectedCommit: string;
  outcome: "pass" | "block";
  blockingCommand: string | null;
  commands: RecordedVerificationCommand[];
  /** Each acceptance test's outcome, when a run's suite ran and its report was read (`applyAcceptanceVerdict`). */
  acceptance?: { tests: RecordedAcceptanceTest[] };
}

/** The audit actions verification records; the caller adds its stage prefix. */
export type VerificationAuditAction =
  | "command.pass"
  | "command.fail"
  | "cleanup"
  | "sandbox.failed"
  | "sandbox.quiescence.failed"
  | "sandbox.teardown.failed";

export interface CommitVerificationInput {
  rootDir: string;
  worktreePath: string;
  expectedCommit: string;
  commands: VerifyCommand[];
  timeoutSeconds: number;
  maxBytes: number;
  /** A command's own output budget by name, in place of `maxBytes`: the acceptance report's. */
  maxBytesFor?: Record<string, number>;
  retentionMaxBytes: number;
  /** The run's frozen sandbox; every command runs in one container of it. */
  sandbox: FrozenSandbox;
  runId: number;
  /** Names the sandbox: `verification`, `remediation-1-verify`. */
  label: string;
  /** Worktree-relative paths every command sees read-only: the acceptance suite (`createSandbox`). */
  readOnlyPaths?: string[];
  evidenceDir: string;
  audit: (action: VerificationAuditAction, summary: string) => void;
  progress?: (command: VerifyCommand, blockedBecause: string | null, durationMs: number) => void;
}

/**
 * What verification decided. `record` is null when the sandbox, not a
 * command, failed: a container that did not start, an exec whose exit status
 * cannot be read, or a work container not proven gone. No verification result
 * exists then, and `reason` names the infrastructure failure.
 */
export interface CommitVerificationResult {
  record: CommitVerificationRecord | null;
  reason: string | null;
}

function runGit(
  args: string[],
  cwd: string
): { ok: true; stdout: string } | { ok: false; detail: string } {
  let result;
  try {
    result = spawnSync("git", args, { cwd, encoding: "utf8" });
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim();
    return { ok: false, detail: detail || `git ${args[0]} exited with code ${result.status}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}

function splitPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Verify that the checkout contains exactly one clean committed state. */
export function checkCommitState(
  worktreePath: string,
  expectedCommit: string,
  when: "before verification" | "after command"
): string | null {
  const head = runGit(["rev-parse", "HEAD"], worktreePath);
  if (!head.ok) {
    return when === "before verification"
      ? `cannot read the worktree head at ${worktreePath}: ${head.detail}`
      : `the worktree head could not be re-read after the command: ${head.detail}`;
  }
  if (head.stdout.trim() !== expectedCommit) {
    return when === "before verification"
      ? `the worktree is at ${head.stdout.trim()}, not the commit implementation left (${expectedCommit})`
      : `the command moved the worktree head from ${expectedCommit} to ${head.stdout.trim()}`;
  }
  const clean = runGit(["status", "--porcelain"], worktreePath);
  if (!clean.ok) {
    return when === "before verification"
      ? `cannot read the worktree state at ${worktreePath}: ${clean.detail}`
      : `the worktree state could not be re-read after the command: ${clean.detail}`;
  }
  const dirty = splitPaths(clean.stdout);
  if (dirty.length === 0) return null;
  return when === "before verification"
    ? `the worktree is not clean before verification: ${dirty.slice(0, 3).join(", ")}`
    : `the command left the worktree dirty in: ${dirty.slice(0, 3).join(", ")}`;
}

/**
 * Remove what passing commands left in ignored paths (`npm ci`'s
 * `node_modules/`, a build's `dist/`). Code review's clean-tree guard counts
 * ignored entries so that a reviewer or the remediation implementer writing
 * into an ignored path is visible; verification output left in the same
 * worktree would trip that guard for every target whose commands install or
 * build. No agent runs between the last command and this removal, so it hides
 * nothing an agent wrote. A path holding this verification's own evidence is
 * kept. Host Git names the paths; a throwaway container of the frozen image
 * removes them, because the Linux symlinks a package manager leaves cannot be
 * opened from Windows (hazard 22). Returns the removed entries, or why removal
 * failed.
 */
export function removeIgnoredOutput(
  frozen: FrozenSandbox,
  worktreePath: string,
  evidenceDir: string
): { ok: true; removed: string[] } | { ok: false; detail: string } {
  const status = runGit(["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"], worktreePath);
  if (!status.ok) return { ok: false, detail: status.detail };
  const evidence = resolve(evidenceDir);
  const removed: string[] = [];
  for (const entry of status.stdout.split("\0").filter((e) => e !== "")) {
    if (!entry.startsWith("!! ")) {
      return { ok: false, detail: `unexpected non-ignored entry ${entry}` };
    }
    const path = entry.slice(3);
    const target = resolve(worktreePath, path);
    if (evidence === target || evidence.startsWith(`${target}${sep}`)) continue;
    removed.push(path);
  }
  try {
    removeIgnoredOutputInContainer(frozen, worktreePath, removed);
  } catch (err) {
    return { ok: false, detail: `cannot remove ${removed.join(", ")}: ${(err as Error).message}` };
  }
  return { ok: true, removed };
}

type CommandsResult =
  | { kind: "decided"; record: CommitVerificationRecord; reason: string | null }
  | { kind: "infrastructure"; reason: string };

/** Run each frozen command in the sandbox, stopping at the first that blocks. */
async function runCommands(input: CommitVerificationInput, sandbox: Sandbox): Promise<CommandsResult> {
  const recorded: RecordedVerificationCommand[] = [];
  for (const command of input.commands) {
    const evidencePath = join(input.evidenceDir, `${command.name}.log`);
    const maxBytes = input.maxBytesFor?.[command.name] ?? input.maxBytes;
    let outcome: CommandOutcome;
    try {
      outcome = await runInSandbox(execTarget(sandbox), sandbox.frozen.imageId, command, {
        cwd: input.worktreePath,
        timeoutSeconds: input.timeoutSeconds,
        maxBytes,
        retentionMaxBytes: input.retentionMaxBytes,
        evidencePath,
      });
    } catch (err) {
      // An exec whose exit status cannot be read failed as infrastructure,
      // never as the command: `docker exec` exits 1 for both.
      if (!(err instanceof ContainerError)) throw err;
      const reason = `command ${command.name} could not be run in sandbox ${sandbox.name}: ${err.message}`;
      input.audit("sandbox.failed", reason);
      return { kind: "infrastructure", reason };
    }
    let because: string | null = null;
    if (outcome.timedOut) {
      because = `the command exceeded the ${input.timeoutSeconds}-second ceiling and its process tree was killed${outcome.killError !== null ? ` (the kill failed: ${outcome.killError})` : ""}`;
    } else if (outcome.outputOverflow) {
      because = `the command produced more than the ${maxBytes}-byte output budget; the complete output is retained at ${relative(input.rootDir, evidencePath)}`;
    } else if (outcome.exitCode !== 0) {
      because = `the command exited with code ${outcome.exitCode}`;
    }
    if (because === null) {
      because = checkCommitState(input.worktreePath, input.expectedCommit, "after command");
    }
    recorded.push({
      name: outcome.name,
      argv: outcome.argv,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      spawnError: outcome.spawnError,
      killError: outcome.killError,
      outputOverflow: outcome.outputOverflow,
      durationMs: outcome.durationMs,
      evidenceRef: relative(input.rootDir, evidencePath),
      blockedBecause: because,
    });
    input.audit(
      because === null ? "command.pass" : "command.fail",
      `${command.name}: ${command.command.join(" ")}; exit=${outcome.exitCode}; timedOut=${outcome.timedOut}; durationMs=${outcome.durationMs}; evidence=${relative(input.rootDir, evidencePath)}${because === null ? "" : `; ${because}`}`
    );
    input.progress?.(command, because, outcome.durationMs);
    if (because !== null) {
      return {
        kind: "decided",
        record: { expectedCommit: input.expectedCommit, outcome: "block", blockingCommand: command.name, commands: recorded },
        reason: because,
      };
    }
  }
  return {
    kind: "decided",
    record: { expectedCommit: input.expectedCommit, outcome: "pass", blockingCommand: null, commands: recorded },
    reason: null,
  };
}

/**
 * Run the frozen commands against one exact commit, in one sandbox of the
 * run's frozen image, and retain all evidence. Each command's log begins with
 * a line naming the container, the image and the argv. The result is decided
 * only after the work container is proven gone, so no command left running in
 * it can change the worktree after it was judged.
 */
export async function verifyCommit(input: CommitVerificationInput): Promise<CommitVerificationResult> {
  const entryFailure = checkCommitState(input.worktreePath, input.expectedCommit, "before verification");
  if (entryFailure !== null) {
    return {
      record: { expectedCommit: input.expectedCommit, outcome: "block", blockingCommand: null, commands: [] },
      reason: entryFailure,
    };
  }
  mkdirSync(input.evidenceDir, { recursive: true });
  const run = await withSandbox(
    { frozen: input.sandbox, rootDir: input.rootDir, runId: input.runId, label: input.label, worktreePath: input.worktreePath, readOnlyPaths: input.readOnlyPaths },
    (sandbox) => runCommands(input, sandbox)
  );
  if (!run.started) {
    const reason = `cannot start the verification sandbox: ${run.error.message}`;
    input.audit("sandbox.failed", reason);
    return { record: null, reason };
  }
  const { sandbox, teardown, value } = run;
  if (!teardown.workContainerGone) {
    const reason = unquiescedReason(sandbox, teardown, value.reason);
    input.audit("sandbox.quiescence.failed", reason);
    return { record: null, reason };
  }
  if (teardown.failures.length > 0) {
    input.audit("sandbox.teardown.failed", `sandbox ${sandbox.name} left objects behind: ${teardown.failures.join("; ")}`);
  }
  if (value.kind === "infrastructure") return { record: null, reason: value.reason };
  if (value.record.outcome === "block") return { record: value.record, reason: value.reason };

  const cleanup = removeIgnoredOutput(input.sandbox, input.worktreePath, input.evidenceDir);
  if (!cleanup.ok) {
    const reason = `every command passed, but the ignored output they left could not be removed: ${cleanup.detail}`;
    input.audit("cleanup", reason);
    return { record: { ...value.record, outcome: "block" }, reason };
  }
  if (cleanup.removed.length > 0) {
    input.audit("cleanup", `removed ignored output the commands left: ${cleanup.removed.join(", ")}`);
  }
  return { record: value.record, reason: null };
}
