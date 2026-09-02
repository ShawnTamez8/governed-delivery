import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { appendAudit } from "./audit.ts";
import { verificationEvidenceDir } from "./paths.ts";
import { loadVerifiedProfile } from "./profile.ts";
import { requireRunInProgress, type Store } from "./store.ts";
import { runVerifyCommand, type CommandOutcome } from "./verify-command.ts";

export type VerificationStageResult =
  | { ok: true; stageId: number; resultRef: string }
  | { ok: false; reason: string };

/** One command's outcome as the handoff record carries it. */
interface RecordedCommand {
  name: string;
  argv: string[];
  exitCode: number | null;
  timedOut: boolean;
  spawnError: string | null;
  killError: string | null;
  outputOverflow: boolean;
  durationMs: number;
  /** Relative to `rootDir`, so the record survives being read elsewhere. */
  evidenceRef: string;
  /** Null when the command neither failed nor disturbed the worktree. */
  blockedBecause: string | null;
}

/**
 * The structured handoff `delivery_check` is handed (section 4: stage N's
 * `output_ref` is literally what stage N+1 was handed).
 *
 * A text report would hand step 8 command results and nothing it could
 * compute changed paths from. This names the worktree and the commit that
 * was actually verified, so the next stage can act on the deliverable rather
 * than read about it.
 */
interface VerificationRecord {
  runId: number;
  stageId: number;
  worktreePath: string;
  verifiedCommit: string;
  outcome: "pass" | "block";
  blockingCommand: string | null;
  commands: RecordedCommand[];
}

/**
 * The verification stage (build order step 7), one row continuing section 5's
 * chain from the passed `implementation` row: run the commands frozen at run
 * start inside the run's worktree, under a named environment passthrough, a
 * bounded per-command ceiling, and a bounded output budget; prove before and
 * after every command that the worktree still holds the commit implementation
 * left and is clean; retain every command's complete output before deciding
 * anything; and hand `delivery_check` a record naming the worktree and the
 * verified commit.
 *
 * **This stage dispatches nothing.** No author, no panel, no rounds, no
 * `agent_run` row, no model — so there is no `resolveStageModel` call and
 * `bw verify` takes no `--model`. That is also why the three-orchestrator
 * duplication `src/implementation-stage.ts` names does not extend here: the
 * shape those three share is the dispatch shape, and none of it is present.
 *
 * **Remediation rounds are deliberately not built** (section 12's deferral
 * subsection). The first failing command blocks the run terminally; a fresh
 * run is the repair.
 *
 * Every failure path is terminal in the same way: the stage completes
 * blocked, the run blocks, an audit event names the cause, the worktree
 * survives, and the retained output stays on disk. An unexpected throw lands
 * in the same machinery, so no run is left wedged.
 */
export async function runVerificationStage(
  store: Store,
  input: { runId: number; rootDir: string }
): Promise<VerificationStageResult> {
  const { runId, rootDir } = input;

  // Git is spawned directly, no shell, the way `resolveStartingCommit` and
  // the implementation stage spawn it.
  const runGit = (args: string[], cwd: string): { ok: true; stdout: string } | { ok: false; detail: string } => {
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
  };

  // --- preconditions, each refused by name before any state mutation ---
  const run = store.getRun(runId);
  if (!run) {
    return { ok: false, reason: `run ${runId} does not exist` };
  }
  const notInProgress = requireRunInProgress(run);
  if (notInProgress !== null) {
    return { ok: false, reason: notInProgress };
  }

  const chain = store.getStageChain(runId);
  const existing = chain.find((s) => s.kind === "verification");
  if (existing) {
    return {
      ok: false,
      reason: `run ${runId} already has a verification stage with status ${existing.status}`,
    };
  }
  const last = chain[chain.length - 1];
  if (!last || last.kind !== "implementation" || last.status !== "passed" || !last.output_ref) {
    return {
      ok: false,
      reason: `run ${runId}'s last stage is ${last ? `${last.kind} (${last.status})` : "none"}, not a passed implementation`,
    };
  }
  const worktreePath = last.output_ref;
  if (!existsSync(worktreePath)) {
    return { ok: false, reason: `the worktree for run ${runId} is missing at ${worktreePath}` };
  }

  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const profile = verified.profile;

  // Section 20's run-duration ceiling, read from the profile frozen at run
  // start so the run is governed by the limit in force when it began.
  const ageSeconds = (Date.now() - Date.parse(run.created_at)) / 1000;
  if (ageSeconds > profile.policy.runDurationLimitSeconds) {
    return {
      ok: false,
      reason: `run ${runId} has exceeded the run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds`,
    };
  }

  // The commit the implementation stage actually left on the branch. It lives
  // in that stage's own `implementation.gate.pass` event and nowhere else, so
  // reading it couples two stages through an audit summary; the guard against
  // that coupling is a strict anchored pattern and a refusal when it does not
  // match. Refuse what cannot be verified — never skip the check.
  const gateEvent = store
    .getAuditEvents(runId)
    .filter((e) => e.action === "implementation.gate.pass")
    .pop();
  if (!gateEvent) {
    return {
      ok: false,
      reason: `run ${runId} has no implementation.gate.pass audit event: the implementation stage never recorded the head it committed`,
    };
  }
  const recordedHead = /^head=([0-9a-f]{40}|[0-9a-f]{64})$/.exec(gateEvent.summary.trim());
  if (!recordedHead) {
    return {
      ok: false,
      reason: `run ${runId}'s implementation.gate.pass event does not record a commit: ${JSON.stringify(gateEvent.summary)}`,
    };
  }
  const verifiedCommit = recordedHead[1];

  // Section 4 makes the branch the deliverable, so the stage proves it is
  // about to test exactly what implementation committed. A suite run against
  // a moved head or uncommitted bytes has verified something the branch does
  // not contain.
  const headAtEntry = runGit(["rev-parse", "HEAD"], worktreePath);
  if (!headAtEntry.ok) {
    return { ok: false, reason: `cannot read the worktree head at ${worktreePath}: ${headAtEntry.detail}` };
  }
  if (headAtEntry.stdout.trim() !== verifiedCommit) {
    return {
      ok: false,
      reason: `the worktree is at ${headAtEntry.stdout.trim()}, not the commit implementation left (${verifiedCommit})`,
    };
  }
  const cleanAtEntry = runGit(["status", "--porcelain"], worktreePath);
  if (!cleanAtEntry.ok) {
    return { ok: false, reason: `cannot read the worktree state at ${worktreePath}: ${cleanAtEntry.detail}` };
  }
  const dirtyAtEntry = splitPaths(cleanAtEntry.stdout);
  if (dirtyAtEntry.length > 0) {
    return {
      ok: false,
      reason: `the worktree is not clean before verification: ${dirtyAtEntry.slice(0, 3).join(", ")}`,
    };
  }

  const audit = (stageId: number | null, action: string, summary: string): void => {
    appendAudit(store, { runId, stageId, actor: "system", actorType: "cli", action, summary });
  };

  const evidenceDir = verificationEvidenceDir(rootDir, runId);
  let stageId: number | null = null;

  try {
    const stage = store.insertStage(runId, "verification", last.id);
    stageId = stage.id;
    store.setStageStatus(stage.id, "in_progress");
    audit(
      stage.id,
      "verification.stage.create",
      `created verification stage ${stage.id} for worktree ${worktreePath} at ${verifiedCommit}`
    );

    mkdirSync(evidenceDir, { recursive: true });
    const recorded: RecordedCommand[] = [];
    let blockingCommand: string | null = null;
    let blockReason: string | null = null;

    for (const command of profile.verification.commands) {
      const evidencePath = join(evidenceDir, `${command.name}.log`);
      const outcome: CommandOutcome = await runVerifyCommand(command, {
        cwd: worktreePath,
        timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
        maxBytes: profile.policy.resultMaxBytes,
        retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
        envPassthrough: profile.policy.verifyEnvPassthrough,
        evidencePath,
      });

      // The four command-failure conditions, most specific first: a timeout
      // also reports an exit code, and naming it as a non-zero exit would send
      // the operator to the wrong diagnosis.
      let because: string | null = null;
      if (outcome.spawnError !== null) {
        because = `the command could not be started: ${outcome.spawnError}`;
      } else if (outcome.timedOut) {
        because = `the command exceeded the ${profile.policy.verifyCommandTimeoutSeconds}-second ceiling and its process tree was killed${outcome.killError !== null ? ` (the kill failed: ${outcome.killError})` : ""}`;
      } else if (outcome.outputOverflow) {
        // Section 20: refuse above the cap. The bytes are retained anyway, so
        // the refusal is diagnosable.
        because = `the command produced more than the ${profile.policy.resultMaxBytes}-byte output budget; the complete output is retained at ${relative(rootDir, evidencePath)}`;
      } else if (outcome.exitCode !== 0) {
        because = `the command exited with code ${outcome.exitCode}`;
      }

      // The integrity pair, re-checked after every command. A suite that
      // rewrites snapshots and then passes has verified bytes the branch does
      // not contain, so a moved head or a dirty tree blocks even on exit 0.
      if (because === null) {
        const headAfter = runGit(["rev-parse", "HEAD"], worktreePath);
        if (!headAfter.ok) {
          because = `the worktree head could not be re-read after the command: ${headAfter.detail}`;
        } else if (headAfter.stdout.trim() !== verifiedCommit) {
          because = `the command moved the worktree head from ${verifiedCommit} to ${headAfter.stdout.trim()}`;
        } else {
          const cleanAfter = runGit(["status", "--porcelain"], worktreePath);
          if (!cleanAfter.ok) {
            because = `the worktree state could not be re-read after the command: ${cleanAfter.detail}`;
          } else {
            const dirtyAfter = splitPaths(cleanAfter.stdout);
            if (dirtyAfter.length > 0) {
              because = `the command left the worktree dirty in: ${dirtyAfter.slice(0, 3).join(", ")}`;
            }
          }
        }
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
        evidenceRef: relative(rootDir, evidencePath),
        blockedBecause: because,
      });
      audit(
        stage.id,
        because === null ? "verification.command.pass" : "verification.command.fail",
        `${command.name}: ${command.command.join(" ")}; exit=${outcome.exitCode}; timedOut=${outcome.timedOut}; durationMs=${outcome.durationMs}; evidence=${relative(rootDir, evidencePath)}${because === null ? "" : `; ${because}`}`
      );
      // One progress line per command as it finishes. Only the stage knows a
      // command has completed before the run has, and printing the argv is
      // what makes the effective, frozen configuration visible at the
      // operator's surface (hazard 12). stderr, so stdout stays exactly the
      // result path the CLI prints.
      process.stderr.write(
        `${because === null ? "pass" : "BLOCK"} ${command.name} (${command.command.join(" ")}) in ${outcome.durationMs}ms\n`
      );

      if (because !== null) {
        blockingCommand = command.name;
        blockReason = because;
        break; // the decision is deterministic and the first failure is terminal
      }
    }

    const outcome: "pass" | "block" = blockingCommand === null ? "pass" : "block";
    const record: VerificationRecord = {
      runId,
      stageId: stage.id,
      worktreePath,
      verifiedCommit,
      outcome,
      blockingCommand,
      commands: recorded,
    };
    const recordPath = join(evidenceDir, "result.json");
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(join(evidenceDir, "report.md"), buildReport(record, blockReason));
    const resultRef = relative(rootDir, recordPath);

    if (blockingCommand !== null) {
      const reason = `verification blocked on ${blockingCommand}: ${blockReason}`;
      store.completeStage(stage.id, resultRef, "block");
      store.setRunStatus(runId, "blocked");
      audit(stage.id, "verification.gate.block", reason);
      return { ok: false, reason };
    }
    store.completeStage(stage.id, resultRef, "pass");
    audit(
      stage.id,
      "verification.gate.pass",
      `verified ${verifiedCommit} in ${worktreePath} with ${recorded.length} command(s)`
    );
    return { ok: true, stageId: stage.id, resultRef };
  } catch (err) {
    // The wedge guard: an unexpected throw must produce the same terminal
    // state as any other failure.
    const reason = `verification stage failed: ${(err as Error).message}`;
    if (stageId !== null) {
      const stage = store.getStage(stageId);
      if (stage && (stage.status === "pending" || stage.status === "in_progress")) {
        store.completeStage(stageId, "", "block");
      }
    }
    audit(stageId, "verification.stage.failed", reason);
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  }
}

function splitPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * The human-readable report, written beside the record rather than instead of
 * it: an operator reads this, and `delivery_check` reads `result.json`.
 */
function buildReport(record: VerificationRecord, blockReason: string | null): string {
  const lines = [
    `# Verification report: run ${record.runId}`,
    "",
    `**Outcome:** ${record.outcome}`,
    "",
    `**Worktree:** ${record.worktreePath}`,
    "",
    `**Verified commit:** ${record.verifiedCommit}`,
    "",
    "## Commands",
    "",
  ];
  for (const command of record.commands) {
    lines.push(
      `- **${command.name}** — \`${command.argv.join(" ")}\` — exit ${command.exitCode}, ${command.durationMs}ms — output retained at \`${command.evidenceRef}\``
    );
    if (command.blockedBecause !== null) {
      lines.push(`  - blocked: ${command.blockedBecause}`);
    }
  }
  if (record.blockingCommand !== null) {
    lines.push("", `## Blocked on \`${record.blockingCommand}\``, "", blockReason ?? "");
    lines.push(
      "",
      "No remediation round exists: the run is terminal and a fresh run is the repair (architecture section 12)."
    );
  }
  return `${lines.join("\n")}\n`;
}
