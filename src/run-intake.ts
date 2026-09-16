import { loadPublicKey } from "./approval.ts";
import { appendAudit } from "./audit.ts";
import { checkIntakeRepository, type IntakeRepositoryResult } from "./readiness.ts";
import { freezeProfile } from "./profile.ts";
import type { ChangeKind, RunRow, Store } from "./store.ts";

export interface RunIntakeInput {
  project: string;
  featureId: string;
  slug: string;
  changeKind: ChangeKind;
  model: string;
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
