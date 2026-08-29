import { readFileSync } from "node:fs";
import { appendAudit } from "./audit.ts";
import {
  approvalPayload,
  loadPublicKey,
  validateExpiry,
  verifyApproval,
  type ApprovalBinding,
} from "./approval.ts";
import { canonicalJson, normalizeText, sha256Hex } from "./canonical.ts";
import { APPROVAL_MAX_LIFETIME_SECONDS, buildPolicy, policyHash } from "./policy.ts";
import { loadProfile } from "./profile.ts";
import { computeScope, touchesProtected } from "./scope.ts";
import { computeRisk } from "./select.ts";
import { validateSpecDoc } from "./spec-doc.ts";
import type { Store } from "./store.ts";

export type BindingResult =
  | { ok: true; binding: ApprovalBinding; specPath: string; reviewStageId: number }
  | { ok: false; reason: string; runExists: boolean };

export type ApprovalResult =
  | { ok: true; approvalId: number; stageId: number }
  | { ok: false; reason: string };

/**
 * Recompute every bound value from authoritative state. The operator
 * supplies only the expiry and the signature, so a mutated spec, a changed
 * policy, or a moved profile produces a different payload and the signature
 * fails on its own — the gate never has to trust an operator-supplied risk
 * or scope.
 */
export function buildBinding(
  store: Store,
  rootDir: string,
  runId: number,
  expiresAt: string
): BindingResult {
  const run = store.getRun(runId);
  if (!run) {
    return { ok: false, reason: `run ${runId} does not exist`, runExists: false };
  }
  const no = (reason: string): BindingResult => ({ ok: false, reason, runExists: true });

  if (run.status !== "in_progress") {
    return no(`run ${runId} is ${run.status}, not in_progress`);
  }
  const chain = store.getStageChain(runId);
  if (chain.some((s) => s.kind === "awaiting_approval")) {
    const existing = chain.find((s) => s.kind === "awaiting_approval")!;
    return no(`run ${runId} already has an awaiting_approval stage with status ${existing.status}`);
  }
  const last = chain[chain.length - 1];
  if (!last) {
    return no(`run ${runId} has no passed spec_review stage to approve`);
  }
  if (last.kind !== "spec_review" || last.status !== "passed" || !last.output_ref) {
    return no(
      `run ${runId}'s last stage is ${last.kind} (${last.status}), not a passed spec_review`
    );
  }
  if (run.profile_ref === null) {
    return no(`run ${runId} has no frozen profile`);
  }
  let loaded;
  try {
    loaded = loadProfile(rootDir, runId);
  } catch (err) {
    return no((err as Error).message);
  }
  if (loaded.hash !== run.profile_ref) {
    return no(
      `profile for run ${runId} has been modified since intake: frozen ${run.profile_ref}, on disk ${loaded.hash}`
    );
  }
  // Section 12: the gate re-checks that policy has not changed since intake.
  const inForce = policyHash(buildPolicy());
  if (loaded.profile.policyHash !== inForce) {
    return no(`policy has changed since intake: profile ${loaded.profile.policyHash}, in force ${inForce}`);
  }
  if (loaded.profile.startingCommit === null) {
    return no(`run ${runId} has no starting commit: it was not created in a git repository`);
  }
  let content: string;
  try {
    content = readFileSync(last.output_ref, "utf8");
  } catch (err) {
    return no(`cannot read the approved spec ${last.output_ref}: ${(err as Error).message}`);
  }
  const doc = validateSpecDoc(content);
  if (!doc.ok) {
    return no(`the approved spec ${last.output_ref} no longer validates: ${doc.reason}`);
  }
  return {
    ok: true,
    specPath: last.output_ref,
    reviewStageId: last.id,
    binding: {
      featureId: run.feature_id,
      specHash: sha256Hex(normalizeText(content)),
      startingCommit: loaded.profile.startingCommit,
      profileHash: run.profile_ref,
      risk: computeRisk(
        run.change_kind,
        doc.value.declaredArtifacts.length,
        touchesProtected(doc.value.declaredArtifacts, run.slug)
      ),
      expiresAt,
      scope: computeScope(doc.value.declaredArtifacts),
    },
  };
}

/**
 * The only human gate (architecture section 12). It is deterministic and
 * dispatches nothing, so it spends nothing: a refusal is an operator input
 * error, not a terminal run state. It writes an `approval.refused` audit
 * event and creates no stage row, leaving the operator free to retry a
 * correct signature. Only a verified authorization creates the
 * `awaiting_approval` row.
 */
export function approveRun(
  store: Store,
  rootDir: string,
  input: { runId: number; expiresAt: string; signature: string }
): ApprovalResult {
  const { runId, expiresAt, signature } = input;

  // The audit append is conditional on the run existing: audit.run_id carries
  // a foreign key, so an event for a nonexistent run would throw and turn a
  // clean refusal into a crash.
  const refuse = (reason: string, runExists: boolean): ApprovalResult => {
    if (runExists) {
      appendAudit(store, {
        runId,
        stageId: null,
        actor: "operator",
        actorType: "human",
        action: "approval.refused",
        summary: reason,
      });
    }
    return { ok: false, reason };
  };

  const runExists = store.getRun(runId) !== undefined;
  const expiry = validateExpiry(expiresAt, Date.now(), APPROVAL_MAX_LIFETIME_SECONDS);
  if (!expiry.ok) return refuse(expiry.reason, runExists);

  const bound = buildBinding(store, rootDir, runId, expiresAt);
  if (!bound.ok) return refuse(bound.reason, bound.runExists);

  const key = loadPublicKey(rootDir);
  if (!key.ok) return refuse(key.reason, true);

  const verified = verifyApproval(approvalPayload(bound.binding), signature, key.key);
  if (!verified.ok) return refuse(verified.reason, true);

  const stage = store.insertStage(runId, "awaiting_approval", bound.reviewStageId);
  appendAudit(store, {
    runId,
    stageId: stage.id,
    actor: "operator",
    actorType: "human",
    action: "approval.stage.create",
    summary: `created awaiting_approval stage ${stage.id}`,
  });
  const approval = store.insertApproval({
    runId,
    featureId: bound.binding.featureId,
    specHash: bound.binding.specHash,
    startingCommit: bound.binding.startingCommit,
    profileHash: bound.binding.profileHash,
    risk: bound.binding.risk,
    scope: canonicalJson(bound.binding.scope),
    expiresAt: bound.binding.expiresAt,
    signature,
    signer: key.signer,
  });
  // output_ref is the spec path because that is literally what the plan
  // stage is handed (section 4).
  store.completeStage(stage.id, bound.specPath, "pass");
  appendAudit(store, {
    runId,
    stageId: stage.id,
    actor: "operator",
    actorType: "human",
    action: "approval.granted",
    summary: `approval ${approval.id} verified for run ${runId}, signer ${key.signer}`,
  });
  return { ok: true, approvalId: approval.id, stageId: stage.id };
}
