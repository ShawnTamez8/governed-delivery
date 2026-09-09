import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { VerifyCommand } from "./governed-config.ts";
import { runVerifyCommand } from "./verify-command.ts";

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
}

export interface CommitVerificationInput {
  rootDir: string;
  worktreePath: string;
  expectedCommit: string;
  commands: VerifyCommand[];
  timeoutSeconds: number;
  maxBytes: number;
  retentionMaxBytes: number;
  envPassthrough: string[];
  evidenceDir: string;
  audit: (action: "command.pass" | "command.fail", summary: string) => void;
  progress?: (command: VerifyCommand, blockedBecause: string | null, durationMs: number) => void;
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

/** Run the frozen commands against one exact commit and retain all evidence. */
export async function verifyCommit(
  input: CommitVerificationInput
): Promise<{ record: CommitVerificationRecord; reason: string | null }> {
  const recorded: RecordedVerificationCommand[] = [];
  const entryFailure = checkCommitState(input.worktreePath, input.expectedCommit, "before verification");
  if (entryFailure !== null) {
    return {
      record: {
        expectedCommit: input.expectedCommit,
        outcome: "block",
        blockingCommand: null,
        commands: recorded,
      },
      reason: entryFailure,
    };
  }
  mkdirSync(input.evidenceDir, { recursive: true });
  for (const command of input.commands) {
    const evidencePath = join(input.evidenceDir, `${command.name}.log`);
    const outcome = await runVerifyCommand(command, {
      cwd: input.worktreePath,
      timeoutSeconds: input.timeoutSeconds,
      maxBytes: input.maxBytes,
      retentionMaxBytes: input.retentionMaxBytes,
      envPassthrough: input.envPassthrough,
      evidencePath,
    });
    let because: string | null = null;
    if (outcome.spawnError !== null) {
      because = `the command could not be started: ${outcome.spawnError}`;
    } else if (outcome.timedOut) {
      because = `the command exceeded the ${input.timeoutSeconds}-second ceiling and its process tree was killed${outcome.killError !== null ? ` (the kill failed: ${outcome.killError})` : ""}`;
    } else if (outcome.outputOverflow) {
      because = `the command produced more than the ${input.maxBytes}-byte output budget; the complete output is retained at ${relative(input.rootDir, evidencePath)}`;
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
        record: {
          expectedCommit: input.expectedCommit,
          outcome: "block",
          blockingCommand: command.name,
          commands: recorded,
        },
        reason: because,
      };
    }
  }
  return {
    record: {
      expectedCommit: input.expectedCommit,
      outcome: "pass",
      blockingCommand: null,
      commands: recorded,
    },
    reason: null,
  };
}
