import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendAudit } from "./audit.ts";
import { deliveryCoverage } from "./delivery-coverage.ts";
import { deliveryEvidenceDir, deliveryEvidenceRef } from "./paths.ts";
import { loadVerifiedProfile } from "./profile.ts";
import { requireRunInProgress, type Store } from "./store.ts";

export type DeliveryStageResult =
  | { ok: true; stageId: number; resultRef: string }
  | { ok: false; reason: string };

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * What the delivery stage reads from the record the verification stage wrote,
 * validated strictly here — a record edited after verification is refused,
 * never trusted.
 */
interface VerificationHandoff {
  runId: number;
  stageId: number;
  worktreePath: string;
  verifiedCommit: string;
  patchBase: string;
}

/**
 * The delivery check (build order step 8), the final deterministic stage:
 * prove that every declared artifact — an exact path the spec declared and
 * the operator's signature bound — appears in the commits produced from the
 * implementation patch base, then finalize the stage, the run, and the audit
 * event in one transaction.
 *
 * **Every check runs before the stage row exists.** Profile, handoff, git,
 * scope, cleanliness, and coverage checks all refuse by name up front; the
 * only mutations are the deterministic record write and the single
 * `Store.transaction` that re-reads the run and chain, requires the run
 * still `in_progress` with no `delivery_check`, inserts and completes the
 * stage, transitions the run to `completed` or `blocked`, and appends the
 * audit event. A crash anywhere leaves `bw deliver` retryable: a record file
 * orphaned by a rollback is deterministic and safely overwritten on retry.
 *
 * This stage dispatches nothing and resolves no model — it is deterministic
 * system code, the way `bw verify` is.
 */
export function runDeliveryStage(
  store: Store,
  input: { runId: number; rootDir: string }
): DeliveryStageResult {
  const { runId, rootDir } = input;

  const run = store.getRun(runId);
  if (!run) {
    return { ok: false, reason: `run ${runId} does not exist` };
  }
  const blocked = requireRunInProgress(run);
  if (blocked !== null) {
    return { ok: false, reason: blocked };
  }

  // Exit codes carry meaning twice below: `git diff --quiet` and
  // `git merge-base --is-ancestor` answer a question with their status (0 =
  // clean/ancestor, 1 = not), so a plain ok-style helper would misreport a
  // meaningful "no" as a git failure. The raw helper keeps the codes; the
  // ok-style helper is for commands whose non-zero exit is always a failure.
  const gitRaw = (
    args: string[],
    cwd: string
  ): { status: number; stdout: string; stderr: string } => {
    let result;
    try {
      result = spawnSync("git", args, { cwd, encoding: "utf8" });
    } catch (err) {
      return { status: -1, stdout: "", stderr: (err as Error).message };
    }
    return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
  const runGit = (
    args: string[],
    cwd: string
  ): { ok: true; stdout: string } | { ok: false; detail: string } => {
    const result = gitRaw(args, cwd);
    if (result.status !== 0) {
      const detail = result.stderr.trim();
      return { ok: false, detail: detail || `git ${args[0]} exited with code ${result.status}` };
    }
    return { ok: true, stdout: result.stdout };
  };

  const chain = store.getStageChain(runId);
  if (chain.some((s) => s.kind === "delivery_check")) {
    const existing = chain.find((s) => s.kind === "delivery_check")!;
    return {
      ok: false,
      reason: `run ${runId} already has a delivery_check stage with status ${existing.status}`,
    };
  }
  const last = chain[chain.length - 1];
  if (!last || last.kind !== "verification" || last.status !== "passed" || !last.output_ref) {
    return {
      ok: false,
      reason: `run ${runId}'s last stage is ${last ? `${last.kind} (${last.status})` : "none"}, not a passed verification`,
    };
  }
  const verificationStageId = last.id;

  // The frozen profile and the run-duration ceiling, exactly as the earlier
  // stages read them: the run is governed by the limit in force when it
  // began (section 20).
  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const profile = verified.profile;
  const ageSeconds = (Date.now() - Date.parse(run.created_at)) / 1000;
  if (ageSeconds > profile.policy.runDurationLimitSeconds) {
    return {
      ok: false,
      reason: `run ${runId} has exceeded the run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds`,
    };
  }

  // The signed scope, strictly re-parsed. Task 1's spec gate refuses
  // directory declarations, so the list that reaches delivery is the
  // normalized declared-artifact set the operator signed; a record that does
  // not re-parse as exactly that refuses here.
  const approval = store.getApproval(runId);
  if (!approval) {
    return { ok: false, reason: `run ${runId} has no recorded approval` };
  }
  let scope: string[];
  try {
    const parsed = JSON.parse(approval.scope) as unknown;
    if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== "string")) {
      throw new Error("scope is not an array of strings");
    }
    scope = parsed as string[];
  } catch (err) {
    return {
      ok: false,
      reason: `run ${runId}'s approved scope is invalid: ${(err as Error).message}`,
    };
  }

  // The verification record, re-read and validated strictly. It lives at the
  // passed stage's output_ref and is the only authoritative statement of what
  // was verified; a record edited after verification refuses by name.
  let record: VerificationHandoff;
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, last.output_ref), "utf8")) as Record<
      string,
      unknown
    >;
    if (
      parsed.runId !== runId ||
      typeof parsed.stageId !== "number" ||
      parsed.stageId !== verificationStageId ||
      typeof parsed.worktreePath !== "string" ||
      typeof parsed.verifiedCommit !== "string" ||
      !COMMIT.test(parsed.verifiedCommit) ||
      typeof parsed.patchBase !== "string" ||
      !COMMIT.test(parsed.patchBase) ||
      parsed.outcome !== "pass"
    ) {
      throw new Error("the record does not describe this run's passed verification");
    }
    record = {
      runId,
      stageId: verificationStageId,
      worktreePath: parsed.worktreePath,
      verifiedCommit: parsed.verifiedCommit,
      patchBase: parsed.patchBase,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `run ${runId}'s verification record at ${last.output_ref} is invalid: ${(err as Error).message}`,
    };
  }
  const { worktreePath, verifiedCommit, patchBase } = record;

  // --- the git re-reads ---
  if (!existsSync(worktreePath)) {
    return { ok: false, reason: `the worktree for run ${runId} is missing at ${worktreePath}` };
  }
  const headNow = runGit(["rev-parse", "HEAD"], worktreePath);
  if (!headNow.ok) {
    return { ok: false, reason: `cannot read the worktree head at ${worktreePath}: ${headNow.detail}` };
  }
  if (headNow.stdout.trim() !== verifiedCommit) {
    return {
      ok: false,
      reason: `the worktree is at ${headNow.stdout.trim()}, not the verified commit ${verifiedCommit}`,
    };
  }
  // Clean means tracked state: the branch is the deliverable (section 4), so
  // uncommitted tracked changes are the only dirt that could leave the branch
  // holding bytes nobody verified. Untracked files are excluded — they cannot
  // enter the deliverable, and verification commands may legitimately leave
  // them because containment is unbuilt.
  const trackedDirty = gitRaw(["diff", "--quiet", "HEAD"], worktreePath);
  if (trackedDirty.status === 128 || trackedDirty.status === -1) {
    return {
      ok: false,
      reason: `cannot check the worktree state at ${worktreePath}: ${trackedDirty.stderr.trim() || "git diff failed"}`,
    };
  }
  if (trackedDirty.status !== 0) {
    const names = runGit(["diff", "--name-only", "HEAD"], worktreePath);
    const detail = names.ok
      ? names.stdout.trim().split(/\r?\n/).filter((l) => l !== "").join(", ")
      : trackedDirty.stderr.trim();
    return {
      ok: false,
      reason: `the worktree has tracked changes since the verified commit: ${detail}`,
    };
  }
  // The patch base must be an ancestor of the verified commit (the range is
  // well-defined only over real ancestry) and must descend from the signed
  // starting commit (branch continuity: the run branch was created at the
  // starting commit, so a base that does not descend from it was never on
  // this run's branch). Task 2 records the empirical pre-apply head; these
  // two checks are what keep a wrong or forged base out of the range.
  for (const [label, candidate, anchor] of [
    ["patch base", patchBase, verifiedCommit],
    ["starting commit", approval.starting_commit, patchBase],
  ] as const) {
    const ancestor = gitRaw(["merge-base", "--is-ancestor", candidate, anchor], worktreePath);
    if (ancestor.status === 1) {
      return {
        ok: false,
        reason: `the ${label} ${candidate} is not an ancestor of ${anchor}`,
      };
    }
    if (ancestor.status !== 0) {
      return {
        ok: false,
        reason: `cannot compare the ${label} ${candidate} against ${anchor}: ${ancestor.stderr.trim() || "git merge-base failed"}`,
      };
    }
  }

  const changedResult = runGit(["diff", "--name-only", "-z", patchBase, verifiedCommit], worktreePath);
  if (!changedResult.ok) {
    return {
      ok: false,
      reason: `cannot diff the patch range ${patchBase}..${verifiedCommit}: ${changedResult.detail}`,
    };
  }
  const changedPaths = changedResult.stdout.split("\0").filter((p) => p !== "");

  // --- the pure comparison ---
  const coverage = deliveryCoverage(scope, changedPaths);
  const missing = coverage.missing;

  // --- the deterministic record, written before the final transaction ---
  // A file orphaned by a rollback is deterministic enough to overwrite on
  // retry: nothing references it until the transaction commits.
  const evidenceDir = deliveryEvidenceDir(rootDir, runId);
  mkdirSync(evidenceDir, { recursive: true });
  const resultRef = deliveryEvidenceRef(runId, "result.json");
  const recordDocument = {
    runId,
    stageId: verificationStageId,
    worktreePath,
    patchBase,
    verifiedCommit,
    declared: coverage.declared,
    changed: coverage.changed,
    delivered: coverage.delivered,
    missing,
    outcome: missing.length === 0 ? "pass" : "block",
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(rootDir, resultRef), `${JSON.stringify(recordDocument, null, 2)}\n`);
  writeFileSync(
    join(rootDir, deliveryEvidenceRef(runId, "report.md")),
    buildDeliveryReport(recordDocument)
  );

  // --- the final operation: one transaction or nothing ---
  // The run and chain are re-read inside the transaction, so a concurrent
  // invocation that slipped past the pre-checks cannot double-finalize: a
  // run that gained a delivery_check or left in_progress since the checks
  // refuses here, and every database write rolls back together on a throw.
  let finalized: { ok: true; stageId: number } | { ok: false; reason: string };
  try {
    finalized = store.transaction(() => {
    const runNow = store.getRun(runId);
    if (!runNow) {
      return { ok: false as const, reason: `run ${runId} does not exist` };
    }
    const stillInProgress = requireRunInProgress(runNow);
    if (stillInProgress !== null) {
      return { ok: false as const, reason: stillInProgress };
    }
    const chainNow = store.getStageChain(runId);
    if (chainNow.some((s) => s.kind === "delivery_check")) {
      const existing = chainNow.find((s) => s.kind === "delivery_check")!;
      return {
        ok: false as const,
        reason: `run ${runId} already has a delivery_check stage with status ${existing.status}`,
      };
    }
    const stage = store.insertStage(runId, "delivery_check", verificationStageId);
    if (missing.length === 0) {
      store.completeStage(stage.id, resultRef, "pass");
      store.setRunStatus(runId, "completed");
      appendAudit(store, {
        runId,
        stageId: stage.id,
        actor: "system",
        actorType: "cli",
        action: "delivery.gate.pass",
        summary: `delivery passed over ${patchBase}..${verifiedCommit}; delivered ${coverage.delivered.length} artifact(s): ${coverage.delivered.join(", ")}`,
      });
      return { ok: true as const, stageId: stage.id };
    }
    store.completeStage(stage.id, resultRef, "block");
    store.setRunStatus(runId, "blocked");
    appendAudit(store, {
      runId,
      stageId: stage.id,
      actor: "system",
      actorType: "cli",
      action: "delivery.gate.block",
      summary: `delivery blocked over ${patchBase}..${verifiedCommit}; declared artifact(s) never committed: ${missing.join(", ")}`,
    });
    return {
      ok: false as const,
      reason: `delivery blocked: declared artifact(s) never appear in the committed changes: ${missing.join(", ")}`,
    };
    });
  } catch (err) {
    // The transaction rolled everything back; the run is still in_progress
    // with no delivery_check, so `bw deliver` is retryable.
    return { ok: false, reason: `delivery finalization failed: ${(err as Error).message}` };
  }

  if (!finalized.ok) {
    return { ok: false, reason: finalized.reason };
  }
  return { ok: true, stageId: finalized.stageId, resultRef };
}

/**
 * The human-readable companion, written beside the record: an operator reads
 * this; nothing downstream parses it.
 */
function buildDeliveryReport(document: {
  runId: number;
  worktreePath: string;
  patchBase: string;
  verifiedCommit: string;
  declared: string[];
  delivered: string[];
  missing: string[];
  outcome: string;
}): string {
  const lines = [
    `# Delivery report: run ${document.runId}`,
    "",
    `**Outcome:** ${document.outcome}`,
    "",
    `**Worktree:** ${document.worktreePath}`,
    "",
    `**Patch range:** ${document.patchBase}..${document.verifiedCommit}`,
    "",
    "## Declared artifacts",
    "",
    ...document.declared.map((p) => `- ${p}`),
    "",
    "## Delivered",
    "",
    ...(document.delivered.length > 0 ? document.delivered.map((p) => `- ${p}`) : ["- none"]),
    "",
    "## Missing",
    "",
    ...(document.missing.length > 0 ? document.missing.map((p) => `- ${p}`) : ["- none"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
