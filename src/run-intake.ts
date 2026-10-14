import { spawnSync } from "node:child_process";
import { loadPublicKey } from "./approval.ts";
import { appendAudit } from "./audit.ts";
import { checkIntakeRepository, type IntakeRepositoryResult } from "./readiness.ts";
import { freezeProfile, type AfterLink, type SettingsInput } from "./profile.ts";
import { readRunSnapshot, RunMissingError } from "./operator-state.ts";
import type { ChangeKind, RunRow, Store } from "./store.ts";

export interface RunIntakeInput {
  project: string;
  featureId: string;
  slug: string;
  changeKind: ChangeKind;
  model: string;
  /** Per-setting model and effort overrides; guided mode passes none and takes the seeded defaults. */
  settings?: SettingsInput;
  /** The earlier feature's run (`new-run --after`); guided mode passes none. */
  after?: number;
}

export interface RunIntakeResult {
  run: RunRow;
  intake: IntakeRepositoryResult;
  profileHash: string;
  approvalSigner: string | null;
}

export class RunIntakeFreezeError extends Error {
  readonly runId: number;

  constructor(runId: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "RunIntakeFreezeError";
    this.runId = runId;
  }
}

/**
 * The link to the earlier feature, read through the same verified snapshot
 * `status` uses: that run belongs to the same project, is completed, its
 * delivery record verifies, and its delivered commit is an ancestor of this
 * run's starting commit. Throws a named refusal otherwise. The clean-tree check
 * is `checkIntakeRepository`'s.
 */
function checkAfter(store: Store, rootDir: string, runId: number, project: string, startingCommit: string): AfterLink {
  let snapshot;
  try {
    snapshot = readRunSnapshot(store, rootDir, runId).snapshot;
  } catch (error) {
    if (error instanceof RunMissingError) throw new Error(`--after: run ${runId} does not exist`);
    throw error;
  }
  // One store can hold several projects (`run.project`), and a feature builds
  // on an earlier feature of its own project, never on another project's run.
  if (snapshot.run.project !== project) {
    throw new Error(`--after: run ${runId} belongs to project ${snapshot.run.project}, not ${project}; a feature builds only on an earlier feature of its own project`);
  }
  if (snapshot.phase !== "completed") {
    throw new Error(`--after: run ${runId} is ${snapshot.phase}, not completed; a feature starts only after the one before it is delivered`);
  }
  const deliveredCommit = snapshot.delivery.deliveredCommit;
  if (deliveredCommit === null) {
    // A null delivered commit means an evidence check failed; the first one
    // names the cause, such as a missing verification record the delivery
    // record then fails to match.
    const why = snapshot.workflowAction.reasons[0]?.reason ?? "no verified delivery record";
    throw new Error(`--after: run ${runId}'s delivery record does not verify: ${why}`);
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", deliveredCommit, startingCommit], { cwd: rootDir, encoding: "utf8" });
  if (ancestor.status === 1) {
    throw new Error(`--after: run ${runId}'s delivered commit ${deliveredCommit.slice(0, 12)} is not in this checkout's history: merge (not squash) gov/${snapshot.run.slug}/${runId} and commit before starting this feature`);
  }
  if (ancestor.status !== 0) {
    throw new Error(`--after: cannot check run ${runId}'s delivered commit ${deliveredCommit}: ${ancestor.error?.message ?? ancestor.stderr.trim()}`);
  }
  return { runId, deliveredCommit };
}

export function createRunIntake(
  store: Store,
  rootDir: string,
  input: RunIntakeInput,
  options: { requireApprovalSigner?: boolean } = {},
): RunIntakeResult {
  const intake = checkIntakeRepository(rootDir);
  if (!intake.ok) throw new Error(intake.reason!);
  if (options.requireApprovalSigner) {
    const key = loadPublicKey(rootDir);
    if (!key.ok) throw new Error(key.reason);
  }
  // Before the run row, so a refused link leaves nothing behind.
  const after = input.after === undefined ? null : checkAfter(store, rootDir, input.after, input.project, intake.startingCommit!);

  const run = store.insertRun(
    input.project,
    input.featureId,
    input.slug,
    input.changeKind,
  );
  appendAudit(store, {
    runId: run.id,
    stageId: null,
    actor: "system",
    actorType: "cli",
    action: "run.create",
    summary: `created run ${run.id} for ${run.slug}`,
  });

  try {
    const frozen = freezeProfile(
      rootDir,
      run.id,
      intake.startingCommit!,
      input.model,
      intake.verification!,
      {},
      input.settings,
      after,
    );
    if (options.requireApprovalSigner && frozen.profile.approvalSigner === null) {
      throw new Error("guided run creation requires a configured external approval public key");
    }
    store.setProfileRef(run.id, frozen.hash);
    appendAudit(store, {
      runId: run.id,
      stageId: null,
      actor: "system",
      actorType: "cli",
      action: "profile.freeze",
      summary: `froze profile ${frozen.hash} for run ${run.id}`,
    });
    if (after !== null) {
      appendAudit(store, {
        runId: run.id,
        stageId: null,
        actor: "system",
        actorType: "cli",
        action: "run.after",
        summary: `after run ${after.runId}; deliveredCommit=${after.deliveredCommit}`,
      });
    }
    return {
      run: store.getRun(run.id)!,
      intake,
      profileHash: frozen.hash,
      approvalSigner: frozen.profile.approvalSigner,
    };
  } catch (error) {
    appendAudit(store, {
      runId: run.id,
      stageId: null,
      actor: "system",
      actorType: "cli",
      action: "profile.freeze.failed",
      summary: error instanceof Error ? error.message : String(error),
    });
    store.setRunStatus(run.id, "blocked");
    throw new RunIntakeFreezeError(run.id, error);
  }
}
