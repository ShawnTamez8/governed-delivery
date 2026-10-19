import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentDefinition } from "./agents.ts";
import { PATCH_RESULT_SCHEMA, validateAgentResult, type ProposedPatch } from "./agent-result.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import {
  decideCodeReviewRound,
  formatCodeReviewGatePass,
  validateCodeReviewReports,
  type CodeReviewBlock,
  type CodeReviewReconciliation,
  type CodeReviewRecord,
  type CodeReviewRound,
  type RecordedFinding,
} from "./code-review.ts";
import {
  agreedRejections,
  validateReconcilerReply,
  type ReconcilerDecision,
} from "./code-review-reconcile.ts";
import { verifyCommit } from "./commit-verification.ts";
import { derivedPathExclusion, regenerateDerivedArtifacts } from "./derived-artifacts.ts";
import { unapprovedDependencyAdditions } from "./dependency-policy.ts";
import { validateSpecDoc } from "./spec-doc.ts";
import { dispatchOnce } from "./dispatch.ts";
import { type ExecutorDefinition } from "./executor.ts";
import { extractJsonBody } from "./parse-output.ts";
import { parseVerificationHandoff } from "./handoff.ts";
import { applyProposedPatches, checkWorktreeClean } from "./patch-application.ts";
import {
  codeReviewEvidenceDir,
  codeReviewEvidenceRef,
  codeReviewVerificationDir,
  derivedEvidenceDir,
} from "./paths.ts";
import { CODE_REVIEW_RECONCILER } from "./policy.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveSettings } from "./profile.ts";
import {
  buildCodeReviewPrompt,
  buildCodeReviewReconcilerPrompt,
  buildCodeReviewRemediationPrompt,
  type CodeReviewRemediationFindingInput,
} from "./prompts.ts";
import {
  upstreamPrefixFor,
  validateReviewerReports,
  type ReviewerReport,
} from "./reconciliation.ts";
import { deliveryCoverage } from "./delivery-coverage.ts";
import { codeReviewPanel, codeReviewStaffingShortfall } from "./select.ts";
import { requireRunInProgress, type Store } from "./store.ts";

export type CodeReviewStageResult =
  | { ok: true; stageId: number; resultRef: string }
  | { ok: false; reason: string };

type ReviewerOutcome =
  | {
      reviewer: AgentDefinition;
      status: "valid";
      agentRunId: number;
      reports: ReviewerReport[];
      durationMs: number;
    }
  | {
      reviewer: AgentDefinition;
      status: "dispatch_failed" | "output_invalid";
      reason: string;
      durationMs: number;
    };

function runGit(
  args: string[],
  cwd: string
): { ok: true; stdout: string } | { ok: false; detail: string } {
  let result;
  try {
    result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim();
    return { ok: false, detail: detail || `git ${args[0]} exited with code ${result.status}` };
  }
  return { ok: true, stdout: result.stdout ?? "" };
}

/**
 * One code-review stage containing every bounded panel and repair attempt.
 *
 * Before each remediation, the code-review reconciler judges every finding
 * against the approved specification (`docs/features/code-review-reconciler/plan.md`;
 * the operator chose "before fixes only" on 2026-10-13). A finding is withheld
 * from the implementer only when every one of the frozen
 * `codeReviewReconcilerCalls` calls rejects it validly, quoting the
 * specification; the rejection is stored as a `rejected_with_rationale`
 * finding decision. A failed dispatch, an unparsed reply or a failed check
 * means keep: the reconciler can only narrow what remediation fixes, so an
 * unusable answer leaves remediation as it was. A round whose every finding
 * is rejected is decided by the severity gate, as a final panel is. The final
 * panel is never reconciled, and its gate counts every finding.
 */
export async function runCodeReviewStage(
  store: Store,
  executor: ExecutorDefinition,
  input: { runId: number; requestedModel?: string; rootDir: string }
): Promise<CodeReviewStageResult> {
  const { runId, requestedModel, rootDir } = input;

  const run = store.getRun(runId);
  if (!run) return { ok: false, reason: `run ${runId} does not exist` };
  const notInProgress = requireRunInProgress(run);
  if (notInProgress !== null) return { ok: false, reason: notInProgress };

  const chain = store.getStageChain(runId);
  const existing = chain.find((stage) => stage.kind === "code_review");
  if (existing) {
    return {
      ok: false,
      reason: `run ${runId} already has a code_review stage with status ${existing.status}`,
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

  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const profile = verified.profile;
  // Remediation runs the `implementer`; each reviewer seat resolves its own
  // setting once the panel is chosen, below, before the stage row exists.
  const implementerSettings = resolveSettings(profile, "implementer");
  if (!implementerSettings.ok) return { ok: false, reason: implementerSettings.reason };
  // Asserted against the implementer setting: `--model` never named a
  // reviewer, and it names the remediation dispatch only. The code-review
  // reconciler is also author-side but has its own frozen setting, below.
  if (requestedModel !== undefined && requestedModel !== implementerSettings.model) {
    return {
      ok: false,
      reason: `--model ${requestedModel} does not match the model frozen at run start (${implementerSettings.model}): config is frozen at run start`,
    };
  }
  // The reconciler runs as the implementer under its own setting, as the
  // document reconciler runs as its stage's author under `reconciler`.
  const reconcilerSettings = resolveSettings(profile, CODE_REVIEW_RECONCILER);
  if (!reconcilerSettings.ok) return { ok: false, reason: reconcilerSettings.reason };
  const binding = requireFrozenBinding(profile, executor, "code_review");
  if (!binding.ok) return { ok: false, reason: binding.reason };

  const ageSeconds = (Date.now() - Date.parse(run.created_at)) / 1000;
  if (ageSeconds > profile.policy.runDurationLimitSeconds) {
    return {
      ok: false,
      reason: `run ${runId} has exceeded the run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds`,
    };
  }

  const verificationRecordPath = resolve(rootDir, last.output_ref);
  let worktreePath: string;
  let initialVerifiedCommit: string;
  let patchBase: string;
  if (!existsSync(verificationRecordPath)) {
    return {
      ok: false,
      reason: `run ${runId}'s verification record at ${last.output_ref} is missing: restore it from the verification evidence or start a fresh run (the branch and worktree are retained; a verification stage cannot be re-run)`,
    };
  }
  try {
    const parsed = parseVerificationHandoff(
      JSON.parse(readFileSync(verificationRecordPath, "utf8")), runId, verificationStageId
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    worktreePath = parsed.value.worktreePath;
    initialVerifiedCommit = parsed.value.verifiedCommit;
    patchBase = parsed.value.patchBase;
  } catch (err) {
    return {
      ok: false,
      reason: `run ${runId}'s verification record at ${last.output_ref} is invalid: ${(err as Error).message}`,
    };
  }

  const verifiedEvent = store
    .getAuditEvents(runId)
    .filter((event) => event.action === "verification.gate.pass")
    .pop();
  if (!verifiedEvent) {
    return {
      ok: false,
      reason: `run ${runId}'s passed verification stage ${verificationStageId} has no verification.gate.pass audit event: the audit trail does not record the verification outcome — start a fresh run; the branch and evidence are retained`,
    };
  }

  const approval = store.getApproval(runId);
  if (!approval) return { ok: false, reason: `run ${runId} has no recorded approval` };
  let scope: string[];
  try {
    const parsed = JSON.parse(approval.scope) as unknown;
    if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== "string")) {
      throw new Error("scope is not an array of strings");
    }
    scope = parsed as string[];
  } catch (err) {
    return {
      ok: false,
      reason: `run ${runId}'s approved scope is unreadable: ${(err as Error).message}`,
    };
  }

  const planStage = chain.find((stage) => stage.kind === "plan_review");
  if (!planStage || !planStage.output_ref) {
    return { ok: false, reason: `run ${runId} has no passed plan_review stage with a plan to read` };
  }
  let planContent: string;
  try {
    planContent = readFileSync(resolve(rootDir, planStage.output_ref), "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read the approved plan ${planStage.output_ref}: ${(err as Error).message}` };
  }
  const planHash = sha256Hex(normalizeText(planContent));
  const planGateEvent = store.query<{ summary: string }>(
    "SELECT summary FROM audit WHERE run_id = ? AND action = 'plan.gate.pass' ORDER BY id DESC LIMIT 1",
    [runId]
  )[0];
  if (!planGateEvent) {
    return { ok: false, reason: `run ${runId} has no plan.gate.pass audit event: the plan_review gate never recorded what it approved` };
  }
  const gatedPlan = /planHash=([0-9a-f]{64}); planFor=([0-9a-f]{64})/.exec(planGateEvent.summary);
  if (!gatedPlan) {
    return { ok: false, reason: `run ${runId}'s plan.gate.pass event does not record a plan hash and plan_for` };
  }
  if (gatedPlan[1] !== planHash) {
    return { ok: false, reason: `the plan has changed since review: gated ${gatedPlan[1]}, on disk ${planHash}` };
  }

  const approvalStage = chain.find((stage) => stage.kind === "awaiting_approval");
  if (!approvalStage || !approvalStage.output_ref) {
    return { ok: false, reason: `run ${runId} has no passed awaiting_approval stage with a spec to read` };
  }
  let specContent: string;
  try {
    specContent = readFileSync(resolve(rootDir, approvalStage.output_ref), "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read the approved spec ${approvalStage.output_ref}: ${(err as Error).message}` };
  }
  const specHash = sha256Hex(normalizeText(specContent));
  if (approval.spec_hash !== specHash) {
    return { ok: false, reason: `the spec has changed since approval: signed ${approval.spec_hash}, on disk ${specHash}` };
  }
  if (gatedPlan[2] !== specHash) {
    return { ok: false, reason: `the spec does not match the plan the gate approved: planFor ${gatedPlan[2]}, on disk ${specHash}` };
  }
  // The grounding location of every reconciler rejection.
  const specLocation = approvalStage.output_ref;
  // The packages the signed specification lists: the only additions a
  // remediation may make.
  const signedSpec = validateSpecDoc(specContent);
  if (!signedSpec.ok) {
    return { ok: false, reason: `the approved spec ${specLocation} no longer validates: ${signedSpec.reason}` };
  }
  const approvedDependencies = signedSpec.value.dependenciesAdded;

  if (!existsSync(worktreePath)) {
    return { ok: false, reason: `the worktree for run ${runId} is missing at ${worktreePath}` };
  }
  const headAtEntry = runGit(["rev-parse", "HEAD"], worktreePath);
  if (!headAtEntry.ok) {
    return { ok: false, reason: `cannot read the worktree head at ${worktreePath}: ${headAtEntry.detail}` };
  }
  if (headAtEntry.stdout.trim() !== initialVerifiedCommit) {
    return {
      ok: false,
      reason: `the worktree is at ${headAtEntry.stdout.trim()}, not the verified commit ${initialVerifiedCommit}`,
    };
  }
  const cleanAtEntry = checkWorktreeClean(worktreePath);
  if (!cleanAtEntry.ok) {
    return {
      ok: false,
      reason:
        cleanAtEntry.detail !== undefined
          ? `cannot check worktree cleanliness before code review: ${cleanAtEntry.detail}`
          : `worktree is not clean before code review: ${cleanAtEntry.entries.join(", ")}`,
    };
  }

  const panel = codeReviewPanel(profile.agents, profile.policy.codeReviewPanelSize, executor.id);
  const shortfall = codeReviewStaffingShortfall(
    profile.agents,
    profile.policy.codeReviewPanelSize,
    executor.id
  );
  if (shortfall !== null) {
    return { ok: false, reason: `run ${runId} cannot seat a code-review panel: ${shortfall}` };
  }
  for (const reviewer of panel) {
    if (!reviewer.outputs.includes("code-findings")) {
      return { ok: false, reason: `configured agent ${reviewer.id} does not allow code-findings output` };
    }
  }
  // Every seat's setting is resolved before the stage row or any dispatch: a
  // missing entry refuses the whole panel here, never one seat after its
  // siblings have already spent.
  const seatSettings = new Map<string, { model: string; effort: string }>();
  for (const reviewer of panel) {
    const seat = resolveSettings(profile, reviewer.id);
    if (!seat.ok) return { ok: false, reason: seat.reason };
    seatSettings.set(reviewer.id, { model: seat.model, effort: seat.effort });
  }

  const author = profile.agents.find((agent) => agent.id === "implementer");
  if (!author) return { ok: false, reason: "configured agent implementer is not in the frozen profile" };
  if (author.role !== "author" || author.executor !== executor.id || !author.outputs.includes("patches")) {
    return {
      ok: false,
      reason: `configured agent ${author.id} cannot author patches through the frozen executor ${executor.id}`,
    };
  }

  // Reviewers read the change without the files the system regenerates, and
  // so may place findings only on paths the implementer wrote.
  const excludeDerived = derivedPathExclusion(profile.verification.derived);
  const initialNames = runGit(
    ["diff", "--name-only", "-z", patchBase, initialVerifiedCommit, ...excludeDerived],
    worktreePath
  );
  if (!initialNames.ok) {
    return {
      ok: false,
      reason: `cannot read the changed paths for ${patchBase}..${initialVerifiedCommit}: ${initialNames.detail}`,
    };
  }
  const changedPaths = initialNames.stdout.split("\0").filter((path) => path !== "");
  if (changedPaths.length === 0) {
    return {
      ok: false,
      reason: `run ${runId}'s verified range ${patchBase}..${initialVerifiedCommit} changed no files: a passed verification over a range that changed nothing is a state no honest run reaches, and a review of nothing must not pass`,
    };
  }

  const audit = (activeStageId: number | null, action: string, summary: string): void => {
    appendAudit(store, { runId, stageId: activeStageId, actor: "system", actorType: "cli", action, summary });
  };
  const evidenceDir = codeReviewEvidenceDir(rootDir, runId);
  let stageId: number | null = null;
  const abort = (
    activeStageId: number,
    action: string,
    reason: string,
    auditSummary: string = reason
  ): CodeReviewStageResult => {
    audit(activeStageId, action, auditSummary);
    store.completeStage(activeStageId, "", "block");
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  };

  try {
    const stage = store.insertStage(runId, "code_review", last.id);
    stageId = stage.id;
    store.setStageStatus(stage.id, "in_progress");
    audit(
      stage.id,
      "code_review.stage.create",
      `created code_review stage ${stage.id} for worktree ${worktreePath}; patchBase=${patchBase}; initialCommit=${initialVerifiedCommit}; panel=${panel.map((agent) => agent.id).join("+")}; panelSize=${profile.policy.codeReviewPanelSize}; maxRounds=${profile.policy.codeReviewMaxRounds}; threshold=${profile.policy.codeReviewBlockingSeverity}`
    );

    const coverage = deliveryCoverage(scope, changedPaths);
    const existsAtHead: Record<string, boolean> = {};
    for (const artifact of coverage.declared) {
      const entry = runGit(["ls-tree", initialVerifiedCommit, "--", artifact], worktreePath);
      if (!entry.ok) {
        return abort(stage.id, "code_review.stage.failed", `cannot read the verified commit tree for ${artifact}: ${entry.detail}`);
      }
      existsAtHead[artifact] = entry.stdout
        .split(/\r?\n/)
        .some((line) => line !== "" && line.split("\t")[0].split(" ")[1] === "blob");
    }
    const missing = [...coverage.missing, ...coverage.delivered.filter((p) => !existsAtHead[p])].sort();
    if (missing.length > 0) {
      const reason = `run ${runId}'s verified range ${patchBase}..${initialVerifiedCommit} does not deliver declared artifact(s): ${missing.join(", ")}`;
      return abort(stage.id, "code_review.artifact.missing", reason);
    }

    const agentByRun = new Map<number, string>();
    const rounds: CodeReviewRound[] = [];
    let currentCommit = initialVerifiedCommit;
    const writeRecord = (
      outcome: "pass" | "block",
      blocking: CodeReviewBlock[],
      finalVerifiedCommit: string
    ): { record: CodeReviewRecord; resultRef: string } => {
      const record: CodeReviewRecord = {
        runId,
        stageId: stage.id,
        worktreePath,
        patchBase,
        initialVerifiedCommit,
        finalVerifiedCommit,
        panel: panel.map((agent) => agent.id),
        panelSize: profile.policy.codeReviewPanelSize,
        maxRounds: profile.policy.codeReviewMaxRounds,
        blockingSeverity: profile.policy.codeReviewBlockingSeverity,
        severities: [...profile.policy.severities],
        rounds,
        blocking,
        outcome,
        createdAt: new Date().toISOString(),
      };
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, "result.json"), `${JSON.stringify(record, null, 2)}\n`);
      writeFileSync(join(evidenceDir, "report.md"), buildReport(record));
      return { record, resultRef: codeReviewEvidenceRef(runId, "result.json") };
    };

    for (let roundNumber = 1; roundNumber <= profile.policy.codeReviewMaxRounds; roundNumber += 1) {
      const names = runGit(["diff", "--name-only", "-z", patchBase, currentCommit, ...excludeDerived], worktreePath);
      if (!names.ok) {
        return abort(stage.id, "code_review.round.failed", `round ${roundNumber}: cannot read changed paths for ${patchBase}..${currentCommit}: ${names.detail}`);
      }
      const changedPaths = names.stdout.split("\0").filter((path) => path !== "");
      if (changedPaths.length === 0) {
        return abort(stage.id, "code_review.round.failed", `round ${roundNumber}: ${patchBase}..${currentCommit} changed no files`);
      }
      const diffResult = runGit(["diff", "--no-color", patchBase, currentCommit, ...excludeDerived], worktreePath);
      if (!diffResult.ok) {
        return abort(stage.id, "code_review.round.failed", `round ${roundNumber}: cannot read diff for ${patchBase}..${currentCommit}: ${diffResult.detail}`);
      }
      const diff = diffResult.stdout;
      audit(
        stage.id,
        "code_review.round.start",
        `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; changedPaths=${changedPaths.length}; panel=${panel.map((agent) => agent.id).join("+")}`
      );

      const panelStartedAt = Date.now();
      const panelIds = panel.map((reviewer) => reviewer.id).join("+");
      audit(
        stage.id,
        "code_review.panel.start",
        `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; panel=${panelIds}`
      );
      const reviewerPromises = panel.map(async (reviewer): Promise<ReviewerOutcome> => {
        const startedAt = Date.now();
        const invalid = (reason: string): ReviewerOutcome => ({
          reviewer,
          status: "output_invalid",
          reason,
          durationMs: Date.now() - startedAt,
        });
        const seat = seatSettings.get(reviewer.id)!;
        const dispatch = await dispatchOnce(
          store,
          executor,
          {
            stageId: stage.id,
            agent: reviewer.id,
            role: "reviewer",
            requestedModel: seat.model,
            requestedEffort: seat.effort,
            setting: reviewer.id,
            prompt: buildCodeReviewPrompt(reviewer, specContent, planContent, changedPaths, diff, currentCommit),
            invocation: { cwd: worktreePath },
          },
          rootDir
        );
        if (!dispatch.ok) {
          return {
            reviewer,
            status: "dispatch_failed",
            reason: dispatch.reason,
            durationMs: Date.now() - startedAt,
          };
        }
        const body = extractJsonBody(dispatch.envelope.resultText);
        if (body.kind === "refused") {
          return invalid(`body refused: ${body.reason}`);
        }
        const result = validateAgentResult(reviewer.id, body.value);
        if (!result.ok) {
          return invalid(`result refused: ${result.reason}`);
        }
        if (result.value.status !== "proposed") {
          return invalid(
            `returned status ${result.value.status}, not proposed — a reviewer that cannot review must not pass the gate by absence`
          );
        }
        const content = result.value.proposedContentChanges as { findings?: unknown } | undefined;
        if (!Array.isArray(content?.findings)) {
          return invalid("result is missing proposedContentChanges.findings");
        }
        const reports = validateReviewerReports(content.findings, {
          agentId: reviewer.id,
          upstreamPrefix: upstreamPrefixFor("plan"),
        });
        if (!reports.ok) {
          return invalid(`result refused: ${reports.reason}`);
        }
        const reportRefusal = validateCodeReviewReports(reports.value, changedPaths);
        if (reportRefusal !== null) {
          return invalid(`result refused: ${reportRefusal}`);
        }
        for (const report of reports.value) {
          if (!profile.policy.severities.includes(report.severity)) {
            return invalid(
              `result refused: severity ${JSON.stringify(report.severity)} is not in the frozen severities ${profile.policy.severities.join(", ")}`
            );
          }
        }
        return {
          reviewer,
          status: "valid",
          agentRunId: dispatch.agentRunId,
          reports: reports.value,
          durationMs: Date.now() - startedAt,
        };
      });
      const settled = await Promise.allSettled(reviewerPromises);
      const outcomes: ReviewerOutcome[] = settled.map((result, index) =>
        result.status === "fulfilled"
          ? result.value
          : {
              reviewer: panel[index]!,
              status: "dispatch_failed",
              reason: `unexpected dispatch failure: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
              durationMs: Date.now() - panelStartedAt,
            }
      );

      const headAfterPanel = runGit(["rev-parse", "HEAD"], worktreePath);
      const cleanAfterPanel = checkWorktreeClean(worktreePath);
      let integrity: "clean" | "dirty" | "check_failed" = "clean";
      let integrityReason: string | null = null;
      if (!headAfterPanel.ok) {
        integrity = "check_failed";
        integrityReason = `cannot read the worktree head after the panel: ${headAfterPanel.detail}`;
      } else if (!cleanAfterPanel.ok && cleanAfterPanel.detail !== undefined) {
        integrity = "check_failed";
        integrityReason = `cannot check worktree cleanliness after the panel: ${cleanAfterPanel.detail}`;
      } else if (headAfterPanel.stdout.trim() !== currentCommit) {
        integrity = "dirty";
        integrityReason = `the panel moved the worktree head from ${currentCommit} to ${headAfterPanel.stdout.trim()}`;
      } else if (!cleanAfterPanel.ok) {
        integrity = "dirty";
        integrityReason = `the panel left the worktree dirty in: ${cleanAfterPanel.entries.join(", ")}`;
      }

      const outcomeStatuses = outcomes.map((outcome) =>
        `${outcome.reviewer.id}:${integrity === "clean" ? outcome.status : outcome.status === "valid" ? "integrity_untrusted" : outcome.status}`
      );
      audit(
        stage.id,
        "code_review.panel.settled",
        `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; elapsedMs=${Date.now() - panelStartedAt}; outcomes=${outcomeStatuses.join(",")}; integrity=${integrity}`
      );

      if (integrity === "clean") {
        for (const outcome of outcomes) {
          if (outcome.status !== "valid") continue;
          agentByRun.set(outcome.agentRunId, outcome.reviewer.id);
          for (const report of outcome.reports) {
            const finding = store.upsertCanonicalFinding(stage.id, roundNumber, report.intentKey, report.location);
            store.insertFindingReport({
              findingId: finding.id,
              agentRunId: outcome.agentRunId,
              severity: report.severity,
              classification: report.classification,
              subject: report.subject,
            });
            audit(
              stage.id,
              "code_review.finding.record",
              `round=${roundNumber}; commit=${currentCommit}; finding=${finding.id}; location=${report.location}; intent=${report.intentKey}; severity=${report.severity}; reviewer=${outcome.reviewer.id}`
            );
          }
        }
      }

      const failures = outcomeStatuses.filter((status) => !status.endsWith(":valid"));
      if (failures.length > 0) {
        const failureSummary = `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; failures=${failures.join(",")}; panel=${panelIds}`;
        const details = outcomes
          .filter((outcome) => outcome.status !== "valid")
          .map((outcome) => `${outcome.reviewer.id}:${outcome.status} (${outcome.reason})`);
        if (integrityReason !== null) details.push(`panel:integrity_untrusted (${integrityReason})`);
        return abort(
          stage.id,
          "code_review.reviewer.failed",
          `code-review panel failed after round ${roundNumber}/${profile.policy.codeReviewMaxRounds} at ${currentCommit}: ${details.join("; ")}`,
          failureSummary
        );
      }

      for (const outcome of outcomes) {
        if (outcome.status !== "valid") continue;
        process.stderr.write(
          `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} reviewed ${outcome.reviewer.id} (${outcome.reviewer.specialty ?? "general review"}) at ${currentCommit.slice(0, 8)}: ${outcome.reports.length} finding(s) in ${outcome.durationMs}ms\n`
        );
      }

      const withReports = store
        .getCanonicalFindings(stage.id)
        .filter((finding) => finding.round === roundNumber)
        .map((finding) => ({ finding, reports: store.getFindingReports(finding.id) }));
      const recordedFindings: RecordedFinding[] = withReports.map(({ finding, reports }) => ({
        id: finding.id,
        location: finding.location,
        intentKey: finding.intent_key,
        reports: reports.map((report) => ({
          agent: agentByRun.get(report.agent_run_id) ?? "unknown",
          severity: report.severity,
          classification: "current_artifact",
          subject: report.subject,
        })),
      }));
      let decision = decideCodeReviewRound(
        withReports,
        profile.policy.codeReviewBlockingSeverity,
        profile.policy.severities,
        roundNumber < profile.policy.codeReviewMaxRounds
      );
      const roundRecord: CodeReviewRound = {
        round: roundNumber,
        reviewedCommit: currentCommit,
        changedPaths,
        findings: recordedFindings,
        blocking: decision.action === "block" ? decision.blocking : [],
        reconciliation: null,
        remediation: null,
      };
      rounds.push(roundRecord);
      const toRemediationInput = (finding: RecordedFinding): CodeReviewRemediationFindingInput => ({
        findingId: finding.id,
        location: finding.location,
        intentKey: finding.intentKey,
        reports: finding.reports.map((report) => ({
          reviewerId: report.agent,
          severity: report.severity,
          classification: report.classification,
          subject: report.subject,
        })),
      });

      let remediationFindings = recordedFindings;
      let decidedEarly = false;
      if (decision.action === "remediate") {
        const findingIds = recordedFindings.map((finding) => finding.id);
        const reconcilerPrompt = buildCodeReviewReconcilerPrompt(
          recordedFindings.map(toRemediationInput),
          specContent,
          planContent,
          diff,
          currentCommit
        );
        const calls: CodeReviewReconciliation["calls"] = [];
        const callDecisions: Array<Map<number, ReconcilerDecision> | null> = [];
        for (let call = 1; call <= profile.policy.codeReviewReconcilerCalls; call += 1) {
          const reconcileDispatch = await dispatchOnce(
            store,
            executor,
            {
              stageId: stage.id,
              agent: author.id,
              role: "author",
              requestedModel: reconcilerSettings.model,
              requestedEffort: reconcilerSettings.effort,
              setting: CODE_REVIEW_RECONCILER,
              prompt: reconcilerPrompt,
              invocation: { cwd: worktreePath },
            },
            rootDir
          );
          // Checked whatever the dispatch returned: a call that failed after
          // writing still left its writes in the worktree (hazard 15).
          const headAfterReconciler = runGit(["rev-parse", "HEAD"], worktreePath);
          if (!headAfterReconciler.ok || headAfterReconciler.stdout.trim() !== currentCommit) {
            return abort(
              stage.id,
              "code_review.worktree.dirty",
              !headAfterReconciler.ok
                ? `round ${roundNumber}: the worktree head could not be re-read after reconciler call ${call}: ${headAfterReconciler.detail}`
                : `round ${roundNumber}: reconciler call ${call} moved the worktree head from ${currentCommit} to ${headAfterReconciler.stdout.trim()}`
            );
          }
          const cleanAfterReconciler = checkWorktreeClean(worktreePath);
          if (!cleanAfterReconciler.ok) {
            return abort(
              stage.id,
              "code_review.worktree.dirty",
              cleanAfterReconciler.detail !== undefined
                ? `round ${roundNumber}: cannot check worktree cleanliness after reconciler call ${call}: ${cleanAfterReconciler.detail}`
                : `round ${roundNumber}: reconciler call ${call} left the worktree dirty in: ${cleanAfterReconciler.entries.join(", ")}`
            );
          }
          if (!reconcileDispatch.ok) {
            calls.push({ agentRunId: null, status: "failed", reason: reconcileDispatch.reason, problems: [] });
            callDecisions.push(null);
            break;
          }
          const reconcileBody = extractJsonBody(reconcileDispatch.envelope.resultText);
          if (reconcileBody.kind === "refused") {
            calls.push({ agentRunId: reconcileDispatch.agentRunId, status: "unparsed", reason: reconcileBody.reason, problems: [] });
            callDecisions.push(null);
            break;
          }
          const checked = validateReconcilerReply(reconcileBody.value, {
            findingIds,
            spec: specContent,
            plan: planContent,
            specLocation,
          });
          calls.push({ agentRunId: reconcileDispatch.agentRunId, status: "valid", reason: null, problems: checked.problems });
          callDecisions.push(checked.decisions);
          // A later call can only take rejections away, so stop once none is left.
          if (agreedRejections(callDecisions, callDecisions.length).length === 0) break;
        }

        const rejectedIds = agreedRejections(callDecisions, profile.policy.codeReviewReconcilerCalls);
        const rejected: CodeReviewReconciliation["rejected"] = rejectedIds.map((findingId) => {
          const answers = callDecisions.map((decisions) => decisions!.get(findingId)!);
          const rejects = answers.filter(
            (answer): answer is Extract<ReconcilerDecision, { disposition: "reject" }> => answer.disposition === "reject"
          );
          return {
            findingId,
            rationales: rejects.map((answer) => answer.rationale),
            excerpts: rejects.map((answer) => answer.excerpt),
            agentRunIds: calls.map((entry) => entry.agentRunId!),
          };
        });
        for (const entry of rejected) {
          // The decision changes no artifact, so both hashes are the reviewed commit.
          store.insertFindingDecision({
            findingId: entry.findingId,
            agentRunId: entry.agentRunIds[0]!,
            disposition: "rejected_with_rationale",
            rationale: entry.rationales[0]!,
            changedLocations: [],
            grounding: { source: "specification", location: specLocation, excerpt: entry.excerpts[0]! },
            normativeChanges: null,
            artifactHashBefore: currentCommit,
            artifactHashAfter: currentCommit,
          });
          // The excerpt is free text that may hold `;` or line breaks: last field.
          audit(
            stage.id,
            "code_review.reconcile.reject",
            `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; finding=${entry.findingId}; agentRuns=${entry.agentRunIds.join(",")}; excerpt=${entry.excerpts[0]}`
          );
        }
        const kept = findingIds.filter((id) => !rejectedIds.includes(id));
        audit(
          stage.id,
          "code_review.reconcile.done",
          `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; findings=${findingIds.length}; kept=${kept.length}; rejected=${rejected.length}; calls=${calls.map((entry) => entry.status).join(",")}`
        );
        process.stderr.write(
          `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} reconciled ${findingIds.length} finding(s) at ${currentCommit.slice(0, 8)}: kept ${kept.length}, rejected ${rejected.length} in ${calls.length} call(s)\n`
        );
        roundRecord.reconciliation = { calls, rejected, kept };

        if (kept.length === 0) {
          // Nothing left to fix: another panel over this commit would change
          // nothing, so the round is decided by the gate over every finding.
          decision = decideCodeReviewRound(
            withReports,
            profile.policy.codeReviewBlockingSeverity,
            profile.policy.severities,
            false
          );
          // The round record was built from the `remediate` decision.
          roundRecord.blocking = decision.action === "block" ? decision.blocking : [];
          decidedEarly = true;
        } else {
          remediationFindings = recordedFindings.filter((finding) => kept.includes(finding.id));
        }
      }

      if (decision.action === "pass") {
        const { resultRef } = writeRecord("pass", [], currentCommit);
        store.completeStage(stage.id, resultRef, "pass");
        audit(
          stage.id,
          "code_review.gate.pass",
          formatCodeReviewGatePass({
            round: roundNumber,
            maxRounds: profile.policy.codeReviewMaxRounds,
            commit: currentCommit,
            findings: recordedFindings.length,
            blockingSeverity: profile.policy.codeReviewBlockingSeverity,
          })
        );
        return { ok: true, stageId: stage.id, resultRef };
      }
      if (decision.action === "block") {
        const { resultRef } = writeRecord("block", decision.blocking, currentCommit);
        const named = decision.blocking
          .map((entry) => `${entry.findingId} (${entry.severity}, severity, ${entry.location})`)
          .join(", ");
        const reason = `code_review blocked after round ${roundNumber}/${profile.policy.codeReviewMaxRounds}: finding id(s) ${named}; threshold ${profile.policy.codeReviewBlockingSeverity}${decidedEarly ? "; every finding was rejected by the code-review reconciler, so the round was decided as a final panel" : ""}`;
        store.completeStage(stage.id, resultRef, "block");
        store.setRunStatus(runId, "blocked");
        audit(stage.id, "code_review.gate.block", `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; findings=${recordedFindings.length}; blocking=${decision.blocking.length}; threshold=${profile.policy.codeReviewBlockingSeverity}`);
        return { ok: false, reason };
      }

      const authorDispatch = await dispatchOnce(
        store,
        executor,
        {
          stageId: stage.id,
          agent: author.id,
          role: "author",
          requestedModel: implementerSettings.model,
          requestedEffort: implementerSettings.effort,
          setting: author.id,
          prompt: buildCodeReviewRemediationPrompt(
            author,
            specContent,
            planContent,
            scope,
            currentCommit,
            changedPaths,
            diff,
            remediationFindings.map(toRemediationInput),
            profile.verification
          ),
          // The answer comes back as structured output, never free text
          // (docs/features/structured-patch-output/plan.md). Reviewers and the
          // reconciler above still read free text.
          invocation: { cwd: worktreePath, jsonSchema: PATCH_RESULT_SCHEMA },
        },
        rootDir
      );
      if (!authorDispatch.ok) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}, commit ${currentCommit}, implementer: ${authorDispatch.reason}`);
      }
      const headAfterAuthor = runGit(["rev-parse", "HEAD"], worktreePath);
      if (!headAfterAuthor.ok || headAfterAuthor.stdout.trim() !== currentCommit) {
        return abort(
          stage.id,
          "code_review.worktree.dirty",
          !headAfterAuthor.ok
            ? `round ${roundNumber}: the worktree head could not be re-read after implementer: ${headAfterAuthor.detail}`
            : `round ${roundNumber}: implementer moved the worktree head from ${currentCommit} to ${headAfterAuthor.stdout.trim()}`
        );
      }
      const cleanAfterAuthor = checkWorktreeClean(worktreePath);
      if (!cleanAfterAuthor.ok) {
        return abort(
          stage.id,
          "code_review.worktree.dirty",
          cleanAfterAuthor.detail !== undefined
            ? `round ${roundNumber}: cannot check worktree cleanliness after implementer: ${cleanAfterAuthor.detail}`
            : `round ${roundNumber}: implementer left the worktree dirty in: ${cleanAfterAuthor.entries.join(", ")}`
        );
      }
      const authorBody = extractJsonBody(authorDispatch.envelope.resultText);
      if (authorBody.kind === "refused") {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}: implementer body refused: ${authorBody.reason}`);
      }
      const authorResult = validateAgentResult(author.id, authorBody.value);
      if (!authorResult.ok) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}: implementer result refused: ${authorResult.reason}`);
      }
      if (authorResult.value.status !== "proposed" || authorResult.value.role !== "author") {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}: implementer returned status ${authorResult.value.status} and role ${authorResult.value.role}, not a proposed author result`);
      }
      const patches = authorResult.value.proposedPatches;
      if (!Array.isArray(patches) || patches.length === 0) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}: implementer returned no proposed patches`);
      }
      const applied = applyProposedPatches({
        worktreePath,
        runId,
        slug: run.slug,
        scope,
        proposalBase: currentCommit,
        patches: patches as ProposedPatch[],
        commitMessage: `bw run ${runId}: code review remediation round ${roundNumber} (base ${currentCommit.slice(0, 8)})`,
        audit: (action, summary) => audit(stage.id, `code_review.remediation.${action}`, `round=${roundNumber}; ${summary}`),
      });
      if (!applied.ok) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}, base ${currentCommit}: ${applied.reason}`);
      }
      if (applied.resultingCommit === currentCommit) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}: remediation produced no new commit from ${currentCommit}`);
      }
      process.stderr.write(
        `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} remediation committed ${applied.resultingCommit.slice(0, 8)} from ${currentCommit.slice(0, 8)}\n`
      );
      const dependencies = unapprovedDependencyAdditions(worktreePath, patchBase, applied.resultingCommit, approvedDependencies);
      if (!dependencies.ok) {
        return abort(stage.id, "code_review.dependency.unapproved", `round ${roundNumber}, base ${currentCommit}: ${dependencies.reason}`);
      }
      // The system regenerates the derived files after the patch commit, and
      // the regenerated head is what is verified, recorded as the
      // remediation's resulting commit, and reviewed next.
      const regenerated = await regenerateDerivedArtifacts({
        rootDir,
        worktreePath,
        runId,
        derived: profile.verification.derived,
        expectedHead: applied.resultingCommit,
        label: `remediation-${roundNumber}`,
        evidenceDir: derivedEvidenceDir(rootDir, runId, `remediation-${roundNumber}`),
        policy: {
          timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
          maxBytes: profile.policy.resultMaxBytes,
          retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
          envPassthrough: profile.policy.verifyEnvPassthrough,
        },
        audit: (action, summary) => audit(stage.id, `code_review.remediation.${action}`, `round=${roundNumber}; ${summary}`),
      });
      if (!regenerated.ok) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}, base ${currentCommit}: ${regenerated.reason}`);
      }
      const remediatedCommit = regenerated.head;

      const verification = await verifyCommit({
        rootDir,
        worktreePath,
        expectedCommit: remediatedCommit,
        commands: profile.verification.commands,
        timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
        maxBytes: profile.policy.resultMaxBytes,
        retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
        envPassthrough: profile.policy.verifyEnvPassthrough,
        evidenceDir: codeReviewVerificationDir(rootDir, runId, roundNumber),
        audit: (action, summary) => audit(stage.id, `code_review.verification.${action}`, `round=${roundNumber}; commit=${remediatedCommit}; ${summary}`),
        progress: (command, because, durationMs) => {
          process.stderr.write(
            `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} verification ${because === null ? "pass" : "BLOCK"} ${command.name} at ${remediatedCommit.slice(0, 8)} in ${durationMs}ms\n`
          );
        },
      });
      roundRecord.remediation = {
        author: author.id,
        baseCommit: currentCommit,
        resultingCommit: remediatedCommit,
        changedPaths: applied.changedPaths,
        verification: verification.record,
      };
      if (verification.record.outcome === "block") {
        const { resultRef } = writeRecord("block", [], currentCommit);
        const reason = `code_review remediation verification blocked after round ${roundNumber}: ${verification.reason}`;
        store.completeStage(stage.id, resultRef, "block");
        store.setRunStatus(runId, "blocked");
        audit(stage.id, "code_review.verification.block", `round=${roundNumber}; commit=${remediatedCommit}; ${verification.reason}`);
        return { ok: false, reason };
      }
      audit(stage.id, "code_review.remediation.pass", `round=${roundNumber}; base=${currentCommit}; commit=${remediatedCommit}; changedPaths=${applied.changedPaths.join(",")}; verification=pass`);
      currentCommit = remediatedCommit;
    }
    throw new Error("the frozen code-review round budget ended without a terminal decision");
  } catch (err) {
    const reason = `code review stage failed: ${(err as Error).message}`;
    if (stageId !== null) {
      const stage = store.getStage(stageId);
      if (stage && (stage.status === "pending" || stage.status === "in_progress")) {
        store.completeStage(stageId, "", "block");
      }
    }
    audit(stageId, "code_review.stage.failed", reason);
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  }
}

function buildReport(record: CodeReviewRecord): string {
  const lines = [
    `# Code review report: run ${record.runId}`,
    "",
    `**Outcome:** ${record.outcome}`,
    "",
    `**Worktree:** ${record.worktreePath}`,
    "",
    `**Range:** ${record.patchBase}..${record.finalVerifiedCommit}`,
    "",
    `**Initial verified commit:** ${record.initialVerifiedCommit}`,
    "",
    `**Panel:** ${record.panel.join(", ")} (${record.panelSize} seats, up to ${record.maxRounds} round(s))`,
    "",
    `**Blocking severity:** ${record.blockingSeverity} (frozen order: ${record.severities.join(", ")})`,
    "",
  ];
  for (const round of record.rounds) {
    lines.push(`## Round ${round.round}: ${round.reviewedCommit}`, "", "### Findings", "");
    if (round.findings.length === 0) lines.push("No reviewer reported a finding.", "");
    for (const finding of round.findings) {
      lines.push(`#### ${finding.location} (${finding.intentKey})`, "");
      for (const report of finding.reports) {
        lines.push(`- **${report.agent}** — ${report.severity}, ${report.classification} — ${report.subject}`);
      }
      lines.push("");
    }
    if (round.reconciliation !== null) {
      lines.push("### Reconciliation", "");
      round.reconciliation.calls.forEach((call, index) => {
        lines.push(
          `- Call ${index + 1}: ${call.status}, agent run ${call.agentRunId ?? "none"}, ${call.problems.length} problem(s)${call.reason !== null ? ` — ${call.reason}` : ""}`
        );
      });
      lines.push("");
      for (const entry of round.reconciliation.rejected) {
        const location = round.findings.find((finding) => finding.id === entry.findingId)?.location ?? "unknown";
        lines.push(`- Rejected finding ${entry.findingId} (${location})`);
        entry.rationales.forEach((rationale, index) => {
          lines.push(`  - Call ${index + 1} rationale: ${rationale}`, `  - Call ${index + 1} excerpt: ${entry.excerpts[index]}`);
        });
      }
      lines.push(`- Kept: ${round.reconciliation.kept.length === 0 ? "none" : round.reconciliation.kept.join(", ")}`, "");
      if (round.reconciliation.kept.length === 0) {
        lines.push("Every finding was rejected, so this round was decided as a final panel.", "");
      }
    }
    if (round.remediation !== null) {
      lines.push(
        "### Remediation",
        "",
        `- ${round.remediation.author}: ${round.remediation.baseCommit} -> ${round.remediation.resultingCommit}`,
        `- Changed: ${round.remediation.changedPaths.join(", ")}`,
        `- Verification: ${round.remediation.verification.outcome}`,
        ""
      );
    }
  }
  if (record.outcome === "block") {
    lines.push("## Blocking findings", "");
    if (record.blocking.length === 0) {
      lines.push("The remediation machinery blocked; no final finding caused this block.");
    }
    for (const entry of record.blocking) {
      lines.push(`- finding ${entry.findingId} — ${entry.severity} — ${entry.location}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
