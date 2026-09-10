import { SYSTEM_NAME } from "./policy.ts";
import type { ExecutionGroup, RunSnapshot } from "./operator-state.ts";
import type { Profile } from "./profile.ts";
import type { CurrentReadiness, ReadinessCheck } from "./readiness.ts";
import type { RunConfiguration } from "./operator-state.ts";

export type OperatorCommand = "doctor" | "runs" | "status" | "run";
export type OperatorErrorCode = "usage" | "target_unavailable" | "state_missing" | "schema_unsupported" |
  "state_unavailable" | "run_missing" | "setup_required" | "writer_contention" | "consent_required" |
  "observation_changed" | "run_aged" | "chain_incomplete" | "evidence_invalid" | "policy_block" | "execution_failed";
export interface OperatorResult {
  command: OperatorCommand;
  outcome: string;
  repository: string | null;
  runId: number | null;
  errorCode: OperatorErrorCode | null;
  reason: string | null;
  observedAt: string;
  result: unknown;
}
export interface DoctorResult {
  checks: ReadinessCheck[];
  current: CurrentReadiness;
  frozen: RunConfiguration | null;
  limitations: string[];
}
export interface RunExecution {
  consent: "not_needed" | "required" | "declined" | "granted";
  groupsAttempted: ExecutionGroup[];
  groupsCompleted: ExecutionGroup[];
  remainingGroups: ExecutionGroup[];
  startedAt: string | null;
  endedAt: string | null;
  elapsedMs: number | null;
}
export interface RunCommandResult {
  snapshot: RunSnapshot | null;
  execution: RunExecution;
}

export function formatRunPreview(rootDir: string, snapshot: RunSnapshot, groups: ExecutionGroup[], profile: Profile): string {
  const policy = profile.policy;
  const ceilings = {
    spec: 2 + policy.specReviewRounds * (policy.panelSizeMax + 1),
    plan: 2 + policy.planReviewRounds * (policy.panelSizeMax + 1),
    implementation: 1,
    verification: 0,
    code_review: policy.codeReviewPanelSize * policy.codeReviewMaxRounds + policy.codeReviewMaxRounds - 1,
    delivery_check: 0,
  };
  return [
    `${profile.systemName}: execution preview for run ${snapshot.run.id} (${snapshot.run.slug})`,
    `Canonical target: ${rootDir}`,
    `Frozen models: ${JSON.stringify(snapshot.configuration.modelMap)}`,
    `Remaining groups: ${groups.join(" -> ")}`,
    `Frozen verification commands: ${JSON.stringify(snapshot.configuration.verificationCommands)}`,
    `Document review: panel up to ${policy.panelSizeMax}; spec ${policy.specReviewRounds} round(s), plan ${policy.planReviewRounds} round(s). Each document group permits 1 author + 1 self-critique + rounds * (panel + 1 reconciler) dispatches.`,
    `Code review: ${policy.codeReviewPanelSize} reviewers * ${policy.codeReviewMaxRounds} panel(s), plus at most ${policy.codeReviewMaxRounds - 1} remediation implementer dispatch(es), each followed by frozen verification; blocking severity ${policy.codeReviewBlockingSeverity}.`,
    `Dispatch ceilings for this range: ${groups.map((group) => `${group}=${ceilings[group]}`).join(", ")}; total ${groups.reduce((sum, group) => sum + ceilings[group], 0)}.`,
    "Consent covers EVERY listed group through approval or terminalization, including bounded internal remediation, not only the next group.",
    "There is no intermediate voluntary stop control or hard monetary cap. Dispatch ceilings are not an invoice or a dollar guarantee.",
    "Consent does not sign approval, export proposals, publish, or authorize a later invocation.",
    "",
  ].join("\n");
}

export function operatorCommand(command: string | null): command is OperatorCommand {
  return command === "doctor" || command === "runs" || command === "status" || command === "run";
}

export function operatorEnvelope(command: OperatorCommand, repository: string | null, runId: number | null,
  outcome: string, result: unknown, errorCode: OperatorErrorCode | null = null, reason: string | null = null): OperatorResult {
  return { command, outcome, repository, runId, errorCode, reason, observedAt: new Date().toISOString(), result };
}

export function operatorExit(result: OperatorResult): number {
  if (result.errorCode === "usage") return 2;
  if (result.command === "run") return result.outcome === "completed" ? 0 : result.outcome === "awaiting_approval" ? 3 : 1;
  return result.outcome === "ok" || result.outcome === "ready" ? 0 : 1;
}

function approvalHandoff(snapshot: RunSnapshot): string[] {
  if (snapshot.workflowAction.group !== "approval") return [];
  const request = snapshot.operatorActions.find((action) => action.kind === "approval_request");
  const submit = snapshot.operatorActions.find((action) => action.kind === "approval_submit");
  if (!snapshot.workflowAction.eligible || !request?.eligible || submit === undefined) return [];
  const value = (args: string[], name: string): string | undefined => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const target = value(request.args, "--repo");
  const expires = value(request.args, "--expires");
  if (target === undefined || expires === undefined || value(submit.args, "--expires") !== expires) {
    return ["Approval instructions unavailable: the request and submission must share an explicit expiry."];
  }
  const quoted = (text: string): string => `'${text.replaceAll("'", "''")}'`;
  const lines = [
    "External approval handoff (no approval has been granted):",
    `Reviewed specification: ${request.evidenceRef}`,
    `Feature: ${snapshot.run.featureId}`,
    `Derived scope: ${JSON.stringify(snapshot.approval.scope)}`,
    `Risk: ${snapshot.approval.risk}`,
    `specHash: ${snapshot.approval.specHash}`,
    `startingCommit: ${snapshot.approval.startingCommit}`,
    `profileHash: ${snapshot.approval.profileHash}`,
    snapshot.configuration.approvalSigner === null
      ? "Signer binding: no key was bound at intake; the signer guarantee is partial."
      : `Signer bound at intake: ${snapshot.configuration.approvalSigner}`,
    `Approval submission: ${submit.eligible ? "READY" : `NOT READY: ${submit.reason ?? "submission is unavailable"}`}`,
    "Readiness covers the current public key only; operator signing-key availability has not been checked.",
    `Prospective expiry: ${expires} (not granted; reuse this exact value for export and submission).`,
    "PowerShell templates: set $BuildWorksCheckout to this tool's checkout and $PayloadFile/$SignatureFile to new absolute file paths with existing parents.",
    "Set $OperatorKeyFile to your operator-managed signing key outside every repository. These commands are instructions only; BuildWorks never runs the signer.",
    "$BwCli = Join-Path $BuildWorksCheckout 'src\\cli.ts'",
    "$BwSigner = Join-Path $BuildWorksCheckout 'scripts\\sign-approval.mjs'",
    `$Target = ${quoted(target)}`,
    `$RunId = ${snapshot.run.id}`,
    `$Expires = ${quoted(expires)}`,
    "Step 1 — export the exact payload (does not approve or sign):",
    "& node $BwCli approval-request --repo $Target --run $RunId --expires $Expires --out $PayloadFile",
    "if ($LASTEXITCODE -ne 0) { throw 'Payload export failed; do not sign or submit.' }",
  ];
  if (submit.eligible) {
    lines.push(
      "Step 2 — separately review the specification and payload; only if you authorize the bound work, run the external signer:",
      "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$Signature = Get-Content -LiteralPath $PayloadFile -Raw -Encoding utf8 | & node $BwSigner sign --key $OperatorKeyFile",
      "if ($LASTEXITCODE -ne 0) { throw 'External signing failed; do not submit.' }",
      "$Signature | Set-Content -LiteralPath $SignatureFile -Encoding utf8",
      "Step 3 — submit that signature with the same expiry (does not execute later stages):",
      "& node $BwCli approve --repo $Target --run $RunId --expires $Expires --signature-file $SignatureFile",
      "if ($LASTEXITCODE -ne 0) { throw 'Approval was not recorded; do not resume.' }",
    );
  } else {
    lines.push("Signing/submission steps are not offered while the public key is unavailable or mismatched. Set BW_APPROVAL_PUBLIC_KEY to the matching external public key and inspect status again before signing.");
  }
  lines.push(
    "After successful approval, resume explicitly; the next run --run invocation requires new execution consent for every remaining group:",
    "& node $BwCli run --repo $Target --run $RunId",
  );
  return lines;
}

export function snapshotText(snapshot: RunSnapshot): string {
  const lines = [
    `${snapshot.configuration.systemName ?? SYSTEM_NAME}: run ${snapshot.run.id} (${snapshot.run.slug})`,
    `Persisted: ${snapshot.run.status}; phase: ${snapshot.phase}`,
    `Repository writer: ${snapshot.writer.status}${snapshot.writer.pid === null ? "" : ` (pid ${snapshot.writer.pid}; not an active-run identity)`}`,
    `Known recorded cost: USD ${snapshot.cost.knownUsd}; reported ${snapshot.cost.costReportedRows}/${snapshot.cost.agentRows} agent rows; ${snapshot.cost.recordedFailedAttempts} failed attempt(s) with unknown spend`,
  ];
  if (snapshot.workflowAction.eligible) lines.push(`Next workflow action: ${snapshot.workflowAction.command} ${snapshot.workflowAction.args.map((a) => JSON.stringify(a)).join(" ")}`);
  for (const refusal of snapshot.workflowAction.reasons) lines.push(`Unavailable: ${refusal.code}: ${refusal.reason}`);
  lines.push(...approvalHandoff(snapshot));
  // The complete structured projection is also useful redirected to a file.
  // Unlike raw provider bodies, no evidence array is silently shortened here.
  lines.push("Recorded snapshot:", JSON.stringify(snapshot, null, 2));
  return `${lines.join("\n")}\n`;
}

export function formatOperatorResult(envelope: OperatorResult, json: boolean): string {
  if (json) return `${JSON.stringify(envelope)}\n`;
  const lines = [`${envelope.command}: ${envelope.outcome}`];
  if (envelope.repository !== null) lines.push(`Repository: ${envelope.repository}`);
  if (envelope.reason !== null) lines.push(`${envelope.errorCode}: ${envelope.reason}`);
  if (envelope.command === "doctor" && envelope.result !== null) {
    const result = envelope.result as DoctorResult;
    lines.push(`${result.current.systemName}: current local readiness`);
    for (const check of result.checks) {
      lines.push(`${check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "NOT CHECKED"} ${check.name}: ${check.evidence}`);
      if (check.repair !== null) lines.push(`Repair: ${check.repair}`);
    }
    lines.push("Current configuration:", JSON.stringify(result.current, null, 2),
      "Frozen run configuration:", JSON.stringify(result.frozen, null, 2),
      ...result.limitations.map((limit) => `Limitation: ${limit}`));
  } else if (envelope.command === "status" && envelope.result !== null) {
    lines.push(snapshotText(envelope.result as RunSnapshot).trimEnd());
  } else if (envelope.command === "run" && envelope.result !== null) {
    const result = envelope.result as RunCommandResult;
    lines.push("Invocation execution:", JSON.stringify(result.execution, null, 2));
    if (result.snapshot !== null) lines.push(snapshotText(result.snapshot).trimEnd());
  } else if (envelope.result !== null) {
    lines.push(JSON.stringify(envelope.result, null, 2));
  }
  return `${lines.join("\n")}\n`;
}
