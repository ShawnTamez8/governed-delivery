import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadPublicKey } from "./approval.ts";
import { buildBinding } from "./approval-stage.ts";
import type { AuditRow } from "./audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "./canonical.ts";
import { parseCodeReviewGatePass, parsePassedCodeReviewRecord } from "./code-review.ts";
import type { RecordedVerificationCommand } from "./commit-verification.ts";
import { parseImplementationGate, parseVerificationHandoff } from "./handoff.ts";
import { inspectLock, type LockObservation } from "./lock.ts";
import {
  codeReviewEvidenceRef, deliveryEvidenceRef, rawOutputDir, worktreePath,
} from "./paths.ts";
import { APPROVAL_DEFAULT_LIFETIME_SECONDS, buildPolicy, policyHash } from "./policy.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel, type Profile } from "./profile.ts";
import { computeScope } from "./scope.ts";
import { codeReviewPanel, codeReviewStaffingShortfall, staffingShortfall } from "./select.ts";
import { readSpecDeclaredArtifacts, validateSpecDoc } from "./spec-doc.ts";
import {
  type AgentRunRow, type ApprovalRow, type CanonicalFindingRow, type FindingDecisionRow,
  type FindingReportRow, type ProposalRow, type RunRow, type StageRow, type Store,
} from "./store.ts";

export const EXECUTION_GROUPS = ["spec", "plan", "implementation", "verification", "code_review", "delivery_check"] as const;
export type ExecutionGroup = (typeof EXECUTION_GROUPS)[number];
export type RunPhase = "ready" | "awaiting_approval" | "blocked" | "completed" | "interrupted_or_inconsistent";
export interface ActionReason {
  code: "observation_changed" | "evidence_invalid" | "policy_block" | "chain_incomplete" | "writer_contention" | "run_aged" | "setup_required";
  reason: string;
}
export interface WorkflowAction {
  group: ExecutionGroup | "approval" | null;
  eligible: boolean;
  reasons: ActionReason[];
  command: string | null;
  args: string[];
}
export interface OperatorAction {
  kind: string;
  command: string;
  args: string[];
  eligible: boolean;
  reason: string | null;
  proposalId: number | null;
  route: string | null;
  title: string | null;
  evidenceRef: string | null;
}
export interface EvidenceReference {
  kind: "stage_output" | "raw_output" | "raw_directory" | "proposal" | "verification_result" |
    "verification_log" | "code_review_result" | "code_review_report" | "delivery_result" | "delivery_report";
  stageId: number | null;
  agentRunId: number | null;
  auditId: number | null;
  ref: string;
  availability: "available" | "missing" | "unverified" | "inconsistent";
  reason: string | null;
}
export interface TokenCoverage {
  known: number | null;
  reportedRows: number;
  unreportedRows: number;
}
export interface CostTotals {
  knownUsd: number;
  agentRows: number;
  costReportedRows: number;
  costUnreportedRows: number;
  tokens: {
    input: TokenCoverage;
    output: TokenCoverage;
    cacheRead: TokenCoverage;
    cacheWrite: TokenCoverage;
  };
  recordedFailedAttempts: number;
}
export interface RunConfiguration {
  systemName: string | null;
  profileHash: string | null;
  policyHash: string | null;
  startingCommit: string | null;
  modelMap: Record<string, string> | null;
  verificationCommands: { name: string; argv: string[] }[] | null;
  documentReview: {
    panelSizeMin: number; panelSizeMax: number; specReviewRounds: number;
    planReviewRounds: number; requiredSpecialties: string[];
  } | null;
  codeReview: { panelSize: number; maxRounds: number; blockingSeverity: string; severities: string[] } | null;
  deadline: string | null;
  approvalSigner: string | null;
}
export interface VerificationObservation {
  stageId: number;
  round: number | null;
  commit: string | null;
  outcome: "pass" | "block" | null;
  blockingCommand: string | null;
  commands: RecordedVerificationCommand[];
  resultRef: string;
}
export interface RunSnapshot {
  run: {
    id: number; project: string; featureId: string; slug: string; changeKind: string;
    status: string; createdAt: string; updatedAt: string;
  };
  phase: RunPhase;
  stages: {
    id: number; runId: number; kind: string; ordinal: number; inputStageId: number | null;
    outputRef: string | null; status: string; gateResult: string | null; startedAt: string | null;
    endedAt: string | null;
    startEvidence: { at: string | null; source: "stage.started_at" | "stage_create_audit" | null; auditId: number | null };
  }[];
  workflowAction: WorkflowAction;
  operatorActions: OperatorAction[];
  proposals: {
    id: number; runId: number; stageId: number; identity: string; title: string; problem: string;
    whyUpstream: string; route: string; evidenceRef: string; createdAt: string; sourceFindingIds: number[];
  }[];
  configuration: RunConfiguration;
  approval: {
    state: "missing" | "granted"; id: number | null; featureId: string | null; signer: string | null;
    scope: string[] | null; risk: string | null; specHash: string | null; startingCommit: string | null;
    profileHash: string | null; expiresAt: string | null; createdAt: string | null;
  };
  cost: CostTotals & {
    currency: "USD";
    byStage: (CostTotals & { stageId: number; kind: string })[];
    byAgent: (CostTotals & {
      agent: string; roles: string[]; requestedModels: string[]; effectiveModels: string[];
      effectiveModelUnreportedRows: number; durationMs: number | null;
    })[];
  };
  activity: { lastRecordedAt: string; lastEvent: { id: number; action: string; summary: string; at: string } | null };
  writer: LockObservation;
  delivery: {
    stageId: number | null; outcome: "pass" | "block" | null; branch: string | null; worktreePath: string | null;
    patchBase: string | null; initialVerifiedCommit: string | null; finalReviewedCommit: string | null;
    deliveredCommit: string | null; changedPaths: string[]; declaredPaths: string[]; deliveredPaths: string[];
    missingPaths: string[]; verification: VerificationObservation[]; resultRef: string | null; reportRef: string | null;
  };
  evidence: {
    references: EvidenceReference[];
    findings: {
      id: number; stageId: number; round: number; intentKey: string; location: string;
      reports: { id: number; agentRunId: number; reviewerId: string | null; severity: string; classification: string; subject: string }[];
      decision: Omit<FindingDecisionRow, "finding_id"> | null;
      finalPanelBlocking: boolean | null;
    }[];
  };
  limitations: string[];
}

export interface RunRows {
  run: RunRow;
  stages: StageRow[];
  agents: AgentRunRow[];
  approval: ApprovalRow | null;
  audit: AuditRow[];
  findings: CanonicalFindingRow[];
  reports: FindingReportRow[];
  decisions: FindingDecisionRow[];
  proposals: ProposalRow[];
  sources: { proposal_id: number; finding_id: number }[];
}
export interface RunObservation {
  snapshot: RunSnapshot;
  fingerprint: string;
  profile: Profile | null;
  profileReason: string | null;
}
export const ACTION_REASON_ORDER: ActionReason["code"][] = [
  "observation_changed", "evidence_invalid", "policy_block", "chain_incomplete",
  "writer_contention", "run_aged", "setup_required",
];
export class RunMissingError extends Error {
  readonly code = "run_missing";
  constructor(runId: number) { super(`run ${runId} does not exist`); }
}

function readRows(store: Store, runId: number): RunRows {
  return store.readSnapshot(() => {
    const run = store.getRun(runId);
    if (!run) throw new RunMissingError(runId);
    return {
      run,
      stages: store.query<StageRow>("SELECT * FROM stage WHERE run_id = ? ORDER BY ordinal, id", [runId]),
      agents: store.query<AgentRunRow>("SELECT a.* FROM agent_run a JOIN stage s ON s.id = a.stage_id WHERE s.run_id = ? ORDER BY a.id", [runId]),
      approval: store.getApproval(runId) ?? null,
      audit: store.getAuditEvents(runId),
      findings: store.query<CanonicalFindingRow>("SELECT f.* FROM finding f JOIN stage s ON s.id = f.stage_id WHERE s.run_id = ? ORDER BY s.ordinal, f.round, f.id", [runId]),
      reports: store.query<FindingReportRow>("SELECT r.* FROM finding_report r JOIN finding f ON f.id = r.finding_id JOIN stage s ON s.id = f.stage_id WHERE s.run_id = ? ORDER BY r.id", [runId]),
      decisions: store.query<FindingDecisionRow>("SELECT d.* FROM finding_decision d JOIN finding f ON f.id = d.finding_id JOIN stage s ON s.id = f.stage_id WHERE s.run_id = ? ORDER BY d.id", [runId]),
      proposals: store.query<ProposalRow>("SELECT * FROM proposal WHERE run_id = ? ORDER BY id", [runId]),
      sources: store.query<{ proposal_id: number; finding_id: number }>("SELECT ps.* FROM proposal_source ps JOIN proposal p ON p.id = ps.proposal_id WHERE p.run_id = ? ORDER BY ps.proposal_id, ps.finding_id", [runId]),
    };
  });
}

export function boundaryFingerprint(run: RunRow | undefined, stages: StageRow[], audit: AuditRow[]): string {
  return sha256Hex(JSON.stringify([
    run ? [run.id, run.project, run.feature_id, run.slug, run.change_kind, run.status, run.profile_ref, run.created_at, run.updated_at] : null,
    stages.map((s) => [s.id, s.run_id, s.kind, s.ordinal, s.input_stage_id, s.output_ref, s.status, s.gate_result, s.started_at, s.ended_at]),
    audit.map((a) => [a.id, a.run_id, a.stage_id, a.actor, a.actor_type, a.action, a.summary, a.hash, a.prev_hash, a.created_at]),
  ]));
}

function totals(agents: AgentRunRow[], failures: AuditRow[]): CostTotals {
  const coverage = (key: "tokens_in" | "tokens_out" | "cache_read" | "cache_write"): TokenCoverage => {
    const reported = agents.filter((a) => a[key] !== null);
    return {
      known: reported.length === 0 ? null : reported.reduce((sum, a) => sum + a[key]!, 0),
      reportedRows: reported.length, unreportedRows: agents.length - reported.length,
    };
  };
  const costReportedRows = agents.filter((a) => a.cost !== null).length;
  return {
    knownUsd: agents.reduce((sum, a) => sum + (a.cost ?? 0), 0),
    agentRows: agents.length, costReportedRows, costUnreportedRows: agents.length - costReportedRows,
    tokens: { input: coverage("tokens_in"), output: coverage("tokens_out"), cacheRead: coverage("cache_read"), cacheWrite: coverage("cache_write") },
    recordedFailedAttempts: failures.length,
  };
}

function lastActivity(run: RunRow, stages: StageRow[], audit: AuditRow[]): string {
  return [run.created_at, run.updated_at, ...stages.flatMap((s) => s.ended_at ? [s.ended_at] : []), ...audit.map((a) => a.created_at)]
    .reduce((latest, at) => Date.parse(at) > Date.parse(latest) ? at : latest);
}

const STAGES = ["spec", "spec_review", "awaiting_approval", "plan", "plan_review", "implementation", "verification", "code_review", "delivery_check"];

function prefixAction(rows: Pick<RunRows, "run" | "stages">): { phase: RunPhase; group: WorkflowAction["group"]; reasons: ActionReason[] } {
  const { run, stages } = rows;
  const invalid = stages.some((s, i) => s.run_id !== run.id || s.ordinal !== i || s.kind !== STAGES[i] ||
    s.input_stage_id !== (i === 0 ? null : stages[i - 1]!.id) || s.status !== "passed" || s.gate_result !== "pass" || !s.output_ref);
  const groups: Record<number, WorkflowAction["group"]> = {
    0: "spec", 2: "approval", 3: "plan", 5: "implementation", 6: "verification", 7: "code_review", 8: "delivery_check", 9: null,
  };
  if (run.status === "blocked") return { phase: "blocked", group: null, reasons: [{ code: "policy_block", reason: `run ${run.id} is blocked` }] };
  if (invalid || !Object.hasOwn(groups, stages.length) ||
      (stages.length === STAGES.length) !== (run.status === "completed")) {
    return { phase: "interrupted_or_inconsistent", group: null, reasons: [{
      code: "chain_incomplete", reason: `run ${run.id} does not have an intact passed stage-group boundary; partial, manual, or contradictory chains cannot be replayed`,
    }] };
  }
  return { phase: run.status === "completed" ? "completed" : stages.length === 2 ? "awaiting_approval" : "ready",
    group: groups[stages.length]!, reasons: [] };
}

export function runConfiguration(profile: Profile | null, hash: string | null, createdAt: string): RunConfiguration {
  const p = profile?.policy;
  const deadline = p ? Date.parse(createdAt) + p.runDurationLimitSeconds * 1000 : NaN;
  return {
    systemName: profile?.systemName ?? null, profileHash: hash, policyHash: profile?.policyHash ?? null,
    startingCommit: profile?.startingCommit ?? null, modelMap: profile?.modelMap ?? null,
    verificationCommands: profile?.verification.commands.map((c) => ({ name: c.name, argv: c.command })) ?? null,
    documentReview: p ? { panelSizeMin: p.panelSizeMin, panelSizeMax: p.panelSizeMax,
      specReviewRounds: p.specReviewRounds, planReviewRounds: p.planReviewRounds, requiredSpecialties: p.requiredSpecialties } : null,
    codeReview: p ? { panelSize: p.codeReviewPanelSize, maxRounds: p.codeReviewMaxRounds,
      blockingSeverity: p.codeReviewBlockingSeverity, severities: p.severities } : null,
    deadline: Number.isFinite(deadline) ? new Date(deadline).toISOString() : null,
    approvalSigner: profile?.approvalSigner ?? null,
  };
}

export function readRunSnapshot(store: Store, rootDir: string, runId: number,
  options: { ownedWriter?: boolean } = {}): RunObservation {
  const rows = readRows(store, runId);
  const { run, stages, agents, approval, audit } = rows;
  const fingerprint = boundaryFingerprint(run, stages, audit);
  const limitations = ["Known recorded costs are not a complete bill; missing telemetry and process loss can hide spend.",
    "Configured standalone reviewers and passed frozen commands do not prove product correctness."];
  const loaded = loadVerifiedProfile(rootDir, run);
  let profile = loaded.ok ? loaded.profile : null;
  let profileReason = loaded.ok ? null : loaded.reason;
  let configuration = runConfiguration(null, null, run.created_at);
  if (profile !== null) {
    try {
      if (profile.runId !== runId) throw new Error(`the frozen profile identifies run ${profile.runId}, not run ${runId}`);
      if (!Object.values(profile.modelMap).every((model) => typeof model === "string")) {
        throw new Error("the frozen model map contains a non-string model");
      }
      if (!profile.verification.commands.every((command) => object(command) &&
          typeof command.name === "string" && strings(command.command))) {
        throw new Error("the frozen verification commands cannot be projected as named argv arrays");
      }
      configuration = runConfiguration(profile, loaded.ok ? loaded.hash : null, run.created_at);
    } catch (error) {
      profileReason = `cannot inspect the frozen profile for run ${runId}: ${message(error)}`;
      profile = null;
    }
  }
  if (profileReason !== null) limitations.push(profileReason);
  const writer = inspectLock(rootDir);
  const prefix = prefixAction(rows);
  const references: EvidenceReference[] = [];
  const reference = (kind: EvidenceReference["kind"], ref: string, stageId: number | null,
    agentRunId: number | null = null, auditId: number | null = null) => {
    const entry: EvidenceReference = { kind, stageId, agentRunId, auditId, ref, availability: "unverified",
      reason: "The reference exists; its contents have not been hash-verified by this observation." };
    try {
      statSync(resolve(rootDir, ref));
    } catch (error) {
      entry.availability = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unverified";
      entry.reason = `cannot inspect ${ref}: ${error instanceof Error ? error.message : String(error)}`;
      limitations.push(entry.reason);
    }
    references.push(entry);
    return entry;
  };
  for (const s of stages) {
    if (s.output_ref) reference("stage_output", s.output_ref, s.id);
    if (s.kind === "code_review") reference("code_review_report", codeReviewEvidenceRef(runId, "report.md"), s.id);
    if (s.kind === "delivery_check") reference("delivery_report", deliveryEvidenceRef(runId, "report.md"), s.id);
  }
  for (const a of agents) reference("raw_output", a.raw_output_ref, a.stage_id, a.id);
  const failed = audit.filter((a) => a.action === "agent.dispatch.failed");
  for (const a of failed) {
    reference("raw_directory", rawOutputDir(rootDir, runId), a.stage_id, null, a.id);
    const last = references.at(-1)!;
    last.availability = last.availability === "missing" ? "missing" : "unverified";
    last.reason = "This failed attempt has no exact raw-output linkage; the retained run directory is not a guessed individual response.";
    limitations.push(last.reason);
  }
  const proposals = rows.proposals.map((p) => {
    reference("proposal", p.evidence_ref, p.stage_id);
    return { id: p.id, runId: p.run_id, stageId: p.stage_id, identity: p.identity, title: p.title,
      problem: p.problem, whyUpstream: p.why_upstream, route: p.route, evidenceRef: p.evidence_ref,
      createdAt: p.created_at, sourceFindingIds: rows.sources.filter((s) => s.proposal_id === p.id).map((s) => s.finding_id) };
  });
  let scope: string[] | null = null;
  if (approval) {
    try {
      const value: unknown = JSON.parse(approval.scope);
      if (!Array.isArray(value) || !value.every((p): p is string => typeof p === "string")) throw new Error("scope is not an array of strings");
      scope = value;
    } catch (error) {
      limitations.push(`run ${runId}'s approved scope is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const actions: OperatorAction[] = ["status", "doctor", "verify-audit"].map((command) => ({
    kind: command, command, args: ["--repo", rootDir, ...(command === "verify-audit" ? [] : ["--run", String(runId)])],
    eligible: true, reason: null, proposalId: null, route: null, title: null, evidenceRef: null,
  }));
  for (const p of proposals) {
    const name = p.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const usable = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
    const collision = usable && existsSync(resolve(rootDir, "docs", "proposals", `${name}.md`));
    actions.push({ kind: "proposal_export", command: "proposal-export",
      args: ["--repo", rootDir, "--proposal", String(p.id), ...(!usable || collision ? ["--name", "<new-slug>"] : [])],
      eligible: true, reason: !usable ? "The title cannot derive a default name; choose --name."
        : collision ? "The default export path exists; choose a new --name. Export never overwrites."
        : "Export rechecks its exclusive-create rule; it does not continue the run.",
      proposalId: p.id, route: p.route, title: p.title, evidenceRef: p.evidenceRef });
  }
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const snapshot: RunSnapshot = {
    run: { id: run.id, project: run.project, featureId: run.feature_id, slug: run.slug, changeKind: run.change_kind,
      status: run.status, createdAt: run.created_at, updatedAt: run.updated_at },
    phase: prefix.phase,
    stages: stages.map((s) => {
      const event = audit.find((a) => a.stage_id === s.id && a.action === (s.kind === "awaiting_approval" ? "approval.stage.create" : `${s.kind}.stage.create`));
      return { id: s.id, runId: s.run_id, kind: s.kind, ordinal: s.ordinal, inputStageId: s.input_stage_id,
        outputRef: s.output_ref, status: s.status, gateResult: s.gate_result, startedAt: s.started_at, endedAt: s.ended_at,
        startEvidence: s.started_at !== null ? { at: s.started_at, source: "stage.started_at", auditId: null }
          : event ? { at: event.created_at, source: "stage_create_audit", auditId: event.id }
            : { at: null, source: null, auditId: null } };
    }),
    workflowAction: { group: prefix.group, eligible: false, reasons: prefix.reasons,
      command: prefix.group === null ? null : prefix.group === "approval" ? "approval-request" : "run",
      args: prefix.group === null ? [] : ["--repo", rootDir, "--run", String(runId)] },
    operatorActions: actions, proposals, configuration,
    approval: { state: approval ? "granted" : "missing", id: approval?.id ?? null, featureId: approval?.feature_id ?? null,
      signer: approval?.signer ?? null, scope, risk: approval?.risk ?? null, specHash: approval?.spec_hash ?? null,
      startingCommit: approval?.starting_commit ?? null, profileHash: approval?.profile_hash ?? null,
      expiresAt: approval?.expires_at ?? null, createdAt: approval?.created_at ?? null },
    cost: { currency: "USD", ...totals(agents, failed),
      byStage: stages.map((s) => ({ stageId: s.id, kind: s.kind,
        ...totals(agents.filter((a) => a.stage_id === s.id), failed.filter((a) => a.stage_id === s.id)) })),
      byAgent: [...new Set([...agents.map((a) => a.agent), ...failed.map((a) => a.actor)])].sort().map((agent) => {
        const selected = agents.filter((a) => a.agent === agent);
        const distinct = (values: (string | null)[]) => [...new Set(values.filter((v) => v !== null))].sort();
        return { agent, ...totals(selected, failed.filter((a) => a.actor === agent)),
          roles: distinct(selected.map((a) => a.role)), requestedModels: distinct(selected.map((a) => a.requested_model)),
          effectiveModels: distinct(selected.map((a) => a.effective_model)),
          effectiveModelUnreportedRows: selected.filter((a) => a.effective_model === null).length,
          durationMs: selected.length === 0 ? null : selected.reduce((sum, a) => sum + a.duration_ms, 0) };
      }) },
    activity: { lastRecordedAt: lastActivity(run, stages, audit),
      lastEvent: audit.length ? { id: audit.at(-1)!.id, action: audit.at(-1)!.action,
        summary: audit.at(-1)!.summary, at: audit.at(-1)!.created_at } : null },
    writer,
    delivery: { stageId: null, outcome: null, branch: null, worktreePath: null, patchBase: null,
      initialVerifiedCommit: null, finalReviewedCommit: null, deliveredCommit: null, changedPaths: [],
      declaredPaths: [], deliveredPaths: [], missingPaths: [], verification: [], resultRef: null, reportRef: null },
    evidence: { references, findings: rows.findings.map((f) => {
      const decision = rows.decisions.find((d) => d.finding_id === f.id);
      let answer: Omit<FindingDecisionRow, "finding_id"> | null = null;
      if (decision) {
        const { finding_id: _findingId, ...recorded } = decision;
        answer = recorded;
      }
      return { id: f.id, stageId: f.stage_id, round: f.round, intentKey: f.intent_key, location: f.location,
        reports: rows.reports.filter((r) => r.finding_id === f.id).map((r) => ({
          id: r.id, agentRunId: r.agent_run_id, reviewerId: agentMap.get(r.agent_run_id)?.agent ?? null,
          severity: r.severity, classification: r.classification, subject: r.subject,
        })),
        decision: answer, finalPanelBlocking: null };
    }) },
    limitations,
  };
  if (profileReason !== null) snapshot.workflowAction.reasons.push({ code: "evidence_invalid", reason: profileReason });
  interpretBoundary(store, rootDir, rows, profile, snapshot, reference, options);
  const rechecked = store.readSnapshot(() => boundaryFingerprint(store.getRun(runId),
    store.query<StageRow>("SELECT * FROM stage WHERE run_id = ? ORDER BY ordinal, id", [runId]), store.getAuditEvents(runId)));
  if (rechecked !== fingerprint) {
    snapshot.workflowAction.reasons.unshift({ code: "observation_changed", reason: "The recorded boundary changed during inspection; inspect again before continuing." });
    snapshot.limitations.push(snapshot.workflowAction.reasons[0]!.reason);
  }
  snapshot.workflowAction.reasons.sort((a, b) => ACTION_REASON_ORDER.indexOf(a.code) - ACTION_REASON_ORDER.indexOf(b.code));
  snapshot.workflowAction.eligible = snapshot.workflowAction.group !== null && snapshot.workflowAction.reasons.length === 0;
  for (const action of snapshot.operatorActions.filter((a) => a.kind === "approval_request" || a.kind === "approval_submit")) {
    if (!snapshot.workflowAction.eligible) {
      action.eligible = false;
      action.reason ??= snapshot.workflowAction.reasons[0]?.reason ?? "The approval boundary is not eligible.";
    }
  }
  const ordinals = new Map(stages.map((s) => [s.id, s.ordinal]));
  references.sort((a, b) => (ordinals.get(a.stageId ?? -1) ?? -1) - (ordinals.get(b.stageId ?? -1) ?? -1) ||
    a.kind.localeCompare(b.kind) || (a.agentRunId ?? -1) - (b.agentRunId ?? -1) ||
    (a.auditId ?? -1) - (b.auditId ?? -1) || a.ref.localeCompare(b.ref));
  return { snapshot, fingerprint, profile, profileReason };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function commit(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value);
}

function commands(value: unknown): value is RecordedVerificationCommand[] {
  return Array.isArray(value) && value.every((c: unknown) => object(c) &&
    typeof c.name === "string" && strings(c.argv) &&
    (c.exitCode === null || typeof c.exitCode === "number") &&
    typeof c.timedOut === "boolean" && (c.spawnError === null || typeof c.spawnError === "string") &&
    (c.killError === null || typeof c.killError === "string") && typeof c.outputOverflow === "boolean" &&
    typeof c.durationMs === "number" && typeof c.evidenceRef === "string" &&
    (c.blockedBecause === null || typeof c.blockedBecause === "string"));
}

function inspectGit(cwd: string, ...args: string[]) {
  // git diff can refresh index stat data even with optional locks disabled.
  return spawnSync("git", ["--no-optional-locks", "-c", "diff.autoRefreshIndex=false", ...args], {
    cwd, encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024,
  });
}

function frozenGroupReasons(profile: Profile, group: ExecutionGroup): ActionReason[] {
  const reasons: ActionReason[] = [];
  const fail = (reason: string) => reasons.push({ code: "setup_required", reason });
  const kinds = group === "spec" || group === "plan" ? [group, `${group}_review`]
    : group === "implementation" || group === "code_review" ? [group] : [];
  for (const kind of kinds) {
    const model = resolveStageModel(profile, kind);
    if (!model.ok) fail(model.reason);
    const binding = requireFrozenBinding(profile, profile.executor, kind);
    if (!binding.ok) fail(binding.reason);
  }
  if (kinds.length > 0) {
    const authorId = group === "spec" || group === "plan" ? `${group}-author` : "implementer";
    const requiredOutputs = group === "spec" || group === "plan"
      ? [group, `${group}-self-critique`, `${group}-reconciliation`] : ["patches"];
    const author = profile.agents.find((a) => a.id === authorId);
    if (!author) fail(`configured agent ${authorId} is not in the frozen profile`);
    else if (author.role !== "author" || author.executor !== profile.executor.id) {
      fail(`configured agent ${authorId} cannot author through the frozen executor ${profile.executor.id}`);
    } else {
      for (const kind of requiredOutputs) {
        if (!author.outputs.includes(kind)) fail(`configured agent ${authorId} does not allow ${kind} output`);
      }
    }
  }
  const p = profile.policy;
  const shortfall = group === "spec" || group === "plan"
    ? staffingShortfall(profile.agents, p.panelSizeMax, p.requiredSpecialties, [], profile.executor.id)
    : group === "code_review" ? codeReviewStaffingShortfall(profile.agents, p.codeReviewPanelSize, profile.executor.id) : null;
  if (shortfall !== null) fail(shortfall);
  return reasons;
}

function interpretBoundary(
  store: Store, root: string, rows: RunRows, profile: Profile | null, snapshot: RunSnapshot,
  reference: (kind: EvidenceReference["kind"], ref: string, stageId: number | null,
    agentRunId?: number | null, auditId?: number | null) => EvidenceReference,
  options: { ownedWriter?: boolean },
): void {
  const { run, stages, audit, approval } = rows;
  const { workflowAction: action, delivery, limitations, evidence } = snapshot;
  const projectionNotes: { stageId: number; ref: string; reason: string }[] = [];
  const refuse = (code: ActionReason["code"], reason: string) => {
    if (!action.reasons.some((r) => r.code === code && r.reason === reason)) action.reasons.push({ code, reason });
    if (!limitations.includes(reason)) limitations.push(reason);
  };
  const mark = (stageId: number, ref: string, availability: EvidenceReference["availability"], reason: string | null) => {
    for (const entry of evidence.references.filter((r) => r.stageId === stageId && r.ref === ref)) {
      entry.availability = availability;
      entry.reason = reason;
    }
  };
  const invalid = (stage: StageRow, reason: string) => {
    refuse("evidence_invalid", reason);
    if (stage.output_ref) mark(stage.id, stage.output_ref, "inconsistent", reason);
  };
  const event = (stage: StageRow, name: string) => audit.findLast((a) => a.stage_id === stage.id && a.action === name);
  const requireEvent = (stage: StageRow, name: string) => {
    const found = event(stage, name);
    if (!found) invalid(stage, `run ${run.id}'s stage ${stage.id} has no ${name} audit event; the recorded handoff is incomplete`);
    return found;
  };
  const readText = (stage: StageRow, kind: EvidenceReference["kind"] = "stage_output"): string | null => {
    if (!stage.output_ref) {
      invalid(stage, `stage ${stage.id} (${stage.kind}) has no retained output reference`);
      return null;
    }
    if (kind !== "stage_output") reference(kind, stage.output_ref, stage.id);
    try {
      return readFileSync(resolve(root, stage.output_ref), "utf8");
    } catch (error) {
      const reason = `cannot read ${stage.kind} evidence at ${stage.output_ref}: ${message(error)}`;
      refuse("evidence_invalid", reason);
      mark(stage.id, stage.output_ref, (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unverified", reason);
      return null;
    }
  };
  const readRecord = (stage: StageRow, kind: EvidenceReference["kind"]): Record<string, unknown> | null => {
    const text = readText(stage, kind);
    if (text === null) return null;
    try {
      const value: unknown = JSON.parse(text);
      if (!object(value)) throw new Error("the record is not an object");
      return value;
    } catch (error) {
      invalid(stage, `${stage.kind} record at ${stage.output_ref} is invalid: ${message(error)}`);
      return null;
    }
  };
  const projectVerification = (stage: StageRow, round: number | null, value: Record<string, unknown>,
    verifiedCommit: string | null, ref: string) => {
    const recordedCommands = commands(value.commands) ? value.commands : null;
    const outcome = value.outcome === "pass" ? "pass" : value.outcome === "block" ? "block" : null;
    const validBlocking = value.blockingCommand === null || typeof value.blockingCommand === "string";
    if (recordedCommands === null || outcome === null || !validBlocking) {
      const reason = `verification command projection at ${ref}${round === null ? "" : `, remediation round ${round}`} is incomplete or malformed; its unchecked fields are not a stronger core handoff contract`;
      limitations.push(reason);
      projectionNotes.push({ stageId: stage.id, ref, reason });
    }
    delivery.verification.push({
      stageId: stage.id, round, commit: verifiedCommit, outcome,
      blockingCommand: typeof value.blockingCommand === "string" ? value.blockingCommand : null,
      commands: recordedCommands ?? [], resultRef: ref,
    });
    if (recordedCommands !== null) {
      for (const c of recordedCommands) reference("verification_log", c.evidenceRef, stage.id);
    }
  };
  const labelFinalFindings = (stage: StageRow, round: number, findings: unknown[], blocking: unknown[]): boolean => {
    const selected = evidence.findings.filter((f) => f.stageId === stage.id && f.round === round);
    const matches = findings.length === selected.length && selected.every((f) => {
      const retained = findings.find((candidate) => object(candidate) && candidate.id === f.id);
      if (!object(retained) || retained.location !== f.location || retained.intentKey !== f.intentKey ||
          !Array.isArray(retained.reports)) return false;
      const reports = retained.reports.filter(object);
      return reports.length === retained.reports.length && reports.every((r) =>
        typeof r.agent === "string" && typeof r.severity === "string" &&
        typeof r.classification === "string" && typeof r.subject === "string") &&
        canonicalJson(reports.map((r) => ({
          agent: r.agent, severity: r.severity, classification: r.classification, subject: r.subject,
        }))) === canonicalJson(f.reports.map((r) => ({
          agent: r.reviewerId, severity: r.severity, classification: r.classification, subject: r.subject,
        })));
    });
    const blocks = blocking.filter((b): b is Record<string, unknown> => object(b));
    if (!matches || blocks.length !== blocking.length ||
        blocks.some((b) => !selected.some((f) => f.id === b.findingId && f.location === b.location))) return false;
    for (const f of selected) f.finalPanelBlocking = blocks.some((b) => b.findingId === f.id);
    return true;
  };

  if (run.status === "blocked") {
    const last = audit.findLast((a) => a.action !== "proposal.export" && a.action !== "approval.refused");
    if (last) {
      const blocked = action.reasons.find((r) => r.code === "policy_block");
      if (blocked) blocked.reason = `run ${run.id} is blocked; last recorded event ${last.action}: ${last.summary}`;
    }
  }
  for (const stage of stages) {
    if (stage.kind === "delivery_check") continue;
    const name = stage.kind === "awaiting_approval" ? "approval.stage.create" : `${stage.kind}.stage.create`;
    if (STAGES.includes(stage.kind)) requireEvent(stage, name);
  }
  if (stages.length < 3 && approval !== null) {
    refuse("chain_incomplete", `run ${run.id} has an approval row without its passed awaiting_approval boundary`);
  }
  const spec = stages.find((s) => s.kind === "spec");
  const specReview = stages.find((s) => s.kind === "spec_review");
  const approved = stages.find((s) => s.kind === "awaiting_approval");
  const plan = stages.find((s) => s.kind === "plan");
  const planReview = stages.find((s) => s.kind === "plan_review");
  let specHash: string | null = null;
  let specRisk: string | null = null;
  let specContent: string | null = null;
  if (specReview?.status === "passed") {
    specContent = readText(specReview);
    const gate = requireEvent(specReview, "spec.gate.pass");
    const gated = gate && /specHash=([0-9a-f]{64}); risk=(low|standard|high)/.exec(gate.summary);
    if (gate && !gated) invalid(specReview, "spec.gate.pass does not record a specification hash and risk");
    if (specContent !== null) specHash = sha256Hex(normalizeText(specContent));
    if (gated && specHash !== null) {
      specRisk = gated[2]!;
      if (gated[1] !== specHash) invalid(specReview, `the spec has changed since review: gated ${gated[1]}, on disk ${specHash}`);
      else mark(specReview.id, specReview.output_ref!, "available", null);
    }
    for (const stage of [spec, approved]) {
      if (stage && (!stage.output_ref || !specReview.output_ref || resolve(root, stage.output_ref) !== resolve(root, specReview.output_ref))) {
        invalid(stage, `${stage.kind} output does not identify the reviewed specification ${specReview.output_ref}`);
      } else if (stage?.output_ref && gated?.[1] === specHash) mark(stage.id, stage.output_ref, "available", null);
    }
  }
  if (approved?.status === "passed") {
    const granted = requireEvent(approved, "approval.granted");
    if (approval === null) invalid(approved, `run ${run.id} has no recorded approval for its passed awaiting_approval stage`);
    else {
      if (granted && granted.summary !== `approval ${approval.id} verified for run ${run.id}, signer ${approval.signer}${profile?.approvalSigner === null ? "; signer not bound at intake" : ""}`) {
        invalid(approved, "approval.granted does not identify the recorded authorization and signer binding");
      }
      if (profile && (approval.feature_id !== run.feature_id || approval.profile_hash !== run.profile_ref ||
          approval.starting_commit !== profile.startingCommit ||
          (profile.approvalSigner !== null && approval.signer !== profile.approvalSigner))) {
        invalid(approved, "the recorded approval does not match this run's feature, frozen profile, starting commit, or signer binding");
      }
      if (specHash !== null && approval.spec_hash !== specHash) invalid(approved, `the spec has changed since approval: signed ${approval.spec_hash}, on disk ${specHash}`);
      if (specRisk !== null && approval.risk !== specRisk) invalid(approved, `approval risk ${approval.risk} does not match spec.gate.pass risk ${specRisk}`);
      if (specContent !== null) {
        if (action.group === "plan") {
          const doc = validateSpecDoc(specContent);
          if (!doc.ok) invalid(approved, `the approved specification no longer validates for plan: ${doc.reason}`);
        }
        const artifacts = readSpecDeclaredArtifacts(specContent);
        if (artifacts === null) invalid(approved, "cannot recover the declared-artifact metadata from the approved specification");
        else if (snapshot.approval.scope === null || canonicalJson(snapshot.approval.scope) !== canonicalJson(computeScope(artifacts))) {
          invalid(approved, "the recorded approval scope does not match the reviewed specification's declared artifacts");
        }
      }
    }
  }
  if (planReview?.status === "passed") {
    const text = readText(planReview);
    const gate = requireEvent(planReview, "plan.gate.pass");
    const gated = gate && /planHash=([0-9a-f]{64}); planFor=([0-9a-f]{64})/.exec(gate.summary);
    if (gate && !gated) invalid(planReview, "plan.gate.pass does not record a plan hash and plan_for");
    if (text !== null && gated) {
      const hash = sha256Hex(normalizeText(text));
      if (hash !== gated[1]) invalid(planReview, `the plan has changed since review: gated ${gated[1]}, on disk ${hash}`);
      else if (gated[2] !== specHash || gated[2] !== approval?.spec_hash) invalid(planReview, `planFor ${gated[2]} does not identify the approved specification ${specHash}`);
      else mark(planReview.id, planReview.output_ref!, "available", null);
    }
    if (plan && (!plan.output_ref || !planReview.output_ref || resolve(root, plan.output_ref) !== resolve(root, planReview.output_ref))) {
      invalid(plan, "plan output does not identify the reviewed plan");
    }
  }

  const implementation = stages.find((s) => s.kind === "implementation");
  let initial: { base: string; head: string; worktree: string } | null = null;
  if (implementation?.status === "passed") {
    const gate = requireEvent(implementation, "implementation.gate.pass");
    const parsed = gate ? parseImplementationGate(gate.summary) : null;
    if (parsed && !parsed.ok) invalid(implementation, `implementation.gate.pass ${parsed.reason}`);
    if (parsed?.ok && implementation.output_ref) {
      initial = { ...parsed.value, worktree: resolve(root, implementation.output_ref) };
      delivery.patchBase = initial.base;
      delivery.worktreePath = initial.worktree;
    }
  }
  const verification = stages.find((s) => s.kind === "verification");
  let verified: ReturnType<typeof parseVerificationHandoff> | null = null;
  if (verification?.output_ref) {
    const value = readRecord(verification, "verification_result");
    if (value !== null) {
      projectVerification(verification, null, value, commit(value.verifiedCommit) ? value.verifiedCommit : null, verification.output_ref);
      if (verification.status === "passed") {
        requireEvent(verification, "verification.gate.pass");
        verified = parseVerificationHandoff(value, run.id, verification.id);
        if (!verified.ok) invalid(verification, `verification record is invalid: ${verified.reason}`);
        else if (!initial || verified.value.patchBase !== initial.base || verified.value.verifiedCommit !== initial.head ||
            resolve(root, verified.value.worktreePath) !== initial.worktree) {
          invalid(verification, "verification does not describe the implementation's worktree, patch base, and head");
          verified = null;
        } else {
          delivery.initialVerifiedCommit = verified.value.verifiedCommit;
          mark(verification.id, verification.output_ref, "available", null);
        }
      }
    }
  }

  const review = stages.find((s) => s.kind === "code_review");
  let finalReviewed: string | null = null;
  if (review?.output_ref) {
    const value = readRecord(review, "code_review_result");
    if (value !== null) {
      if (Array.isArray(value.rounds)) {
        for (const round of value.rounds) {
          if (object(round) && object(round.remediation) && object(round.remediation.verification)) {
            projectVerification(review, typeof round.round === "number" ? round.round : null,
              round.remediation.verification, commit(round.remediation.resultingCommit) ? round.remediation.resultingCommit : null, review.output_ref);
          }
        }
      } else limitations.push(`code-review record at ${review.output_ref} has no readable round collection`);
      if (review.status === "passed" && profile !== null) {
        const parsed = parsePassedCodeReviewRecord(value, run.id, review.id, profile);
        const gate = requireEvent(review, "code_review.gate.pass");
        const gated = gate ? parseCodeReviewGatePass(gate.summary) : null;
        if (!parsed.ok) invalid(review, `code-review record is invalid: ${parsed.reason}`);
        else {
          const last = parsed.value.rounds.at(-1)!;
          if (!verified?.ok || parsed.value.patchBase !== verified.value.patchBase ||
              parsed.value.initialVerifiedCommit !== verified.value.verifiedCommit ||
              parsed.value.worktreePath !== verified.value.worktreePath) {
            invalid(review, "the code review did not begin from the recorded verification handoff");
          } else if (!gated?.ok || gated.value.round !== last.round || gated.value.maxRounds !== profile.policy.codeReviewMaxRounds ||
              gated.value.commit !== parsed.value.finalVerifiedCommit || gated.value.findings !== last.findings.length ||
              gated.value.blockingSeverity !== profile.policy.codeReviewBlockingSeverity) {
            invalid(review, "code_review.gate.pass does not match the final reviewed commit and frozen gate policy");
          } else {
            finalReviewed = parsed.value.finalVerifiedCommit;
            delivery.finalReviewedCommit = finalReviewed;
            mark(review.id, review.output_ref, "available", null);
            if (!labelFinalFindings(review, last.round, last.findings, [])) {
              invalid(review, "the final code-review panel does not identify the recorded canonical findings and immutable reports");
            }
          }
        }
      } else if (review.status === "blocked" && value.outcome === "block" && profile !== null) {
        const final: unknown = Array.isArray(value.rounds) ? value.rounds.at(-1) : null;
        const gate = event(review, "code_review.gate.block");
        if (object(final) && typeof final.round === "number" && final.remediation === null &&
            Array.isArray(final.findings) && Array.isArray(final.blocking) && Array.isArray(value.blocking) &&
            verified?.ok && value.runId === run.id && value.stageId === review.id &&
            value.patchBase === verified.value.patchBase && value.initialVerifiedCommit === verified.value.verifiedCommit &&
            value.worktreePath === verified.value.worktreePath && commit(final.reviewedCommit) &&
            value.finalVerifiedCommit === final.reviewedCommit && final.round === profile.policy.codeReviewMaxRounds &&
            value.panelSize === profile.policy.codeReviewPanelSize && value.maxRounds === profile.policy.codeReviewMaxRounds &&
            value.blockingSeverity === profile.policy.codeReviewBlockingSeverity &&
            strings(value.severities) && strings(value.panel) &&
            canonicalJson(value.severities) === canonicalJson(profile.policy.severities) &&
            canonicalJson(value.panel) === canonicalJson(codeReviewPanel(profile.agents, profile.policy.codeReviewPanelSize, profile.executor.id).map((a) => a.id)) &&
            canonicalJson(value.blocking) === canonicalJson(final.blocking) &&
            gate?.summary === `round=${final.round}/${profile.policy.codeReviewMaxRounds}; commit=${final.reviewedCommit}; findings=${final.findings.length}; blocking=${final.blocking.length}; threshold=${profile.policy.codeReviewBlockingSeverity}` &&
            labelFinalFindings(review, final.round, final.findings, final.blocking)) {
          delivery.finalReviewedCommit = final.reviewedCommit;
          mark(review.id, review.output_ref, "available", null);
        } else if (gate !== undefined) {
          invalid(review, "the blocked final code-review panel does not match its recorded gate and immutable findings");
        }
      }
    }
  }

  const delivered = stages.find((s) => s.kind === "delivery_check");
  if (delivered !== undefined) {
    delivery.stageId = delivered.id;
    delivery.resultRef = delivered.output_ref;
    delivery.reportRef = deliveryEvidenceRef(run.id, "report.md");
    const value = readRecord(delivered, "delivery_result");
    if (value !== null) {
      const gateName = value.outcome === "pass" ? "delivery.gate.pass" : "delivery.gate.block";
      const gate = requireEvent(delivered, gateName);
      if (value.runId !== run.id || value.stageId !== delivered.id ||
          (value.outcome !== "pass" && value.outcome !== "block") || typeof value.worktreePath !== "string" ||
          !commit(value.patchBase) || !commit(value.verifiedCommit) || !strings(value.changed) ||
          !strings(value.declared) || !strings(value.delivered) || !strings(value.missing)) {
        invalid(delivered, "delivery record does not describe this run/stage and its retained artifact sets");
      }
      else {
        delivery.outcome = value.outcome;
        delivery.changedPaths = value.changed;
        delivery.declaredPaths = value.declared;
        delivery.deliveredPaths = value.delivered;
        delivery.missingPaths = value.missing;
        if (!initial || value.patchBase !== initial.base || value.verifiedCommit !== finalReviewed ||
            resolve(root, value.worktreePath) !== initial.worktree ||
            (value.outcome === "pass") !== (run.status === "completed" && delivered.status === "passed" && delivered.gate_result === "pass") ||
            canonicalJson(value.declared) !== canonicalJson(snapshot.approval.scope)) {
          invalid(delivered, "delivery record does not match the final reviewed handoff, approved artifacts, and persisted outcome");
        } else {
          const expected = value.outcome === "pass"
            ? `delivery passed over ${value.patchBase}..${value.verifiedCommit}; delivered ${delivery.deliveredPaths.length} artifact(s): ${delivery.deliveredPaths.join(", ")}`
            : `delivery blocked over ${value.patchBase}..${value.verifiedCommit}; declared artifact(s) never committed: ${delivery.missingPaths.join(", ")}`;
          if (!gate || gate.summary !== expected) invalid(delivered, "delivery gate event does not match its retained outcome and patch range");
          else {
            delivery.deliveredCommit = value.verifiedCommit;
            mark(delivered.id, delivered.output_ref!, "available", null);
          }
        }
      }
    }
  }

  if (action.group === "spec") {
    const design = join(root, "docs", "features", run.slug, "design.md");
    try { readFileSync(design, "utf8"); }
    catch (error) { refuse("setup_required", `cannot read design document ${design}: ${message(error)}`); }
  }
  if (action.group === "implementation") {
    const destination = worktreePath(root, run.id);
    if (existsSync(destination)) refuse("evidence_invalid", `worktree path already exists for run ${run.id}: ${destination}; it is not reused`);
    const branch = `refs/heads/gov/${run.slug}/${run.id}`;
    const existing = inspectGit(root, "show-ref", "--verify", "--quiet", branch);
    if (existing.status === 0) refuse("evidence_invalid", `run branch already exists: ${branch}; it is not reused`);
    else if (existing.status !== 1) refuse("evidence_invalid", `cannot inspect run branch ${branch}: ${existing.error?.message ?? existing.stderr.trim()}`);
  }
  if (delivery.worktreePath !== null) {
    const branch = inspectGit(delivery.worktreePath, "symbolic-ref", "--short", "HEAD");
    if (branch.status === 0) delivery.branch = branch.stdout.trim();
    else limitations.push(`cannot observe the retained branch at ${delivery.worktreePath}: ${branch.error?.message ?? branch.stderr.trim()}`);
  }
  const currentCommit = action.group === "verification" ? initial?.head
    : action.group === "code_review" ? delivery.initialVerifiedCommit
      : action.group === "delivery_check" ? finalReviewed
        : snapshot.phase === "completed" ? delivery.deliveredCommit : null;
  if (currentCommit && delivery.worktreePath !== null) {
    const head = inspectGit(delivery.worktreePath, "rev-parse", "HEAD");
    if (head.status !== 0) refuse("evidence_invalid", `cannot read worktree head at ${delivery.worktreePath}: ${head.error?.message ?? head.stderr.trim()}`);
    else if (head.stdout.trim() !== currentCommit) refuse("evidence_invalid", `the worktree is at ${head.stdout.trim()}, not the bound commit ${currentCommit}`);
    const args = action.group === "verification" ? ["status", "--porcelain"]
      : action.group === "code_review" ? ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"]
        : ["diff", "--quiet", "HEAD"];
    const clean = inspectGit(delivery.worktreePath, ...args);
    if (clean.status !== 0 || clean.stdout.trim() !== "") {
      refuse("evidence_invalid", `worktree is not clean at the ${action.group ?? "recorded delivery"} boundary: ${clean.error?.message ?? (clean.stderr.trim() || clean.stdout.trim() || "tracked changes since the reviewed commit")}`);
    }
  }
  if (profile && action.group !== null && action.group !== "approval") {
    try { action.reasons.push(...frozenGroupReasons(profile, action.group)); }
    catch (error) { refuse("evidence_invalid", `cannot inspect frozen execution metadata: ${message(error)}`); }
    const age = (Date.now() - Date.parse(run.created_at)) / 1000;
    if (age > profile.policy.runDurationLimitSeconds) {
      refuse("run_aged", `run ${run.id} has exceeded the frozen run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds; this is a guided-entry precondition. Low-level spec/plan retain their narrower checks, but cannot make aged downstream delivery eligible; start a fresh run`);
    }
  }
  if (action.group === "approval" && profile !== null) {
    const expires = new Date(Date.now() + APPROVAL_DEFAULT_LIFETIME_SECONDS * 1000).toISOString();
    const bound = buildBinding(store, root, run.id, expires);
    if (!bound.ok) refuse(profile.policyHash !== policyHash(buildPolicy()) ? "policy_block" : "evidence_invalid", bound.reason);
    else {
      snapshot.approval.scope = bound.binding.scope;
      snapshot.approval.risk = bound.binding.risk;
      snapshot.approval.specHash = bound.binding.specHash;
      snapshot.approval.startingCommit = bound.binding.startingCommit;
      snapshot.approval.profileHash = bound.binding.profileHash;
      limitations.push("No approval has been granted. The displayed scope and hashes are derived from the reviewed specification; suggested expiry is prospective.");
      action.args.push("--expires", expires);
      const key = loadPublicKey(root);
      const keyReason = !key.ok ? key.reason : profile.approvalSigner !== null && profile.approvalSigner !== key.signer
        ? `approval key ${key.signer} is not the key frozen at run start (${profile.approvalSigner})` : null;
      if (keyReason !== null) limitations.push(keyReason);
      snapshot.operatorActions.push({
        kind: "approval_request", command: "approval-request", args: [...action.args], eligible: action.reasons.length === 0,
        reason: null, proposalId: null, route: null, title: null, evidenceRef: bound.specPath,
      }, {
        kind: "approval_submit", command: "approve",
        args: ["--repo", root, "--run", String(run.id), "--expires", expires, "--signature-file", "<signature-file>"],
        eligible: keyReason === null && action.reasons.length === 0, reason: keyReason,
        proposalId: null, route: null, title: null, evidenceRef: bound.specPath,
      });
    }
  }
  const ownsObservedLock = options.ownedWriter === true && snapshot.writer.status === "live" && snapshot.writer.pid === process.pid;
  if (!ownsObservedLock && (snapshot.writer.status === "live" || snapshot.writer.status === "unreadable") && action.group !== null) {
    refuse("writer_contention", snapshot.writer.reason ?? `repository writer lock is ${snapshot.writer.status} at ${snapshot.writer.path}; its PID does not identify the selected run`);
  }
  for (const note of projectionNotes) {
    for (const entry of evidence.references.filter((r) => r.stageId === note.stageId && r.ref === note.ref)) {
      if (entry.availability === "available" || entry.availability === "unverified") {
        entry.availability = "unverified";
        entry.reason = note.reason;
      }
    }
  }
}

export function listRuns(store: Store, limit = 20) {
  return store.readSnapshot(() => {
    const selected = store.query<RunRow>("SELECT * FROM run ORDER BY id DESC LIMIT ?", [limit + 1]);
    return { runs: selected.slice(0, limit).map((run) => {
      const stages = store.query<StageRow>("SELECT * FROM stage WHERE run_id = ? ORDER BY ordinal, id", [run.id]);
      return { id: run.id, project: run.project, featureId: run.feature_id, slug: run.slug,
        status: run.status, phase: prefixAction({ run, stages }).phase,
        lastRecordedAt: lastActivity(run, stages, store.getAuditEvents(run.id)) };
    }), limit, hasMore: selected.length > limit };
  });
}
