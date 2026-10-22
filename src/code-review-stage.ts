import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ACCEPTANCE_COMMAND_NAME,
  acceptanceCommand,
  applyAcceptanceVerdict,
  CHECKS_ROOT,
  judgeReproductionRun,
  lintSuiteFile,
  reproductionCommand,
  type AcceptanceFile,
} from "./acceptance.ts";
import type { AgentDefinition } from "./agents.ts";
import {
  CODE_REVIEW_REPLY_SCHEMA,
  describeIncompleteReply,
  parseWorkspaceReply,
  validateAgentResult,
  validateWorkspaceReply,
  WORKSPACE_REPLY_SCHEMA,
} from "./agent-result.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import {
  decideCodeReviewRound,
  formatCodeReviewGatePass,
  validateCodeReviewReports,
  validateCodeReviewReproductions,
  type CodeReviewBlock,
  type CodeReviewPreservedCheck,
  type CodeReviewReconciliation,
  type CodeReviewRecord,
  type CodeReviewReproduction,
  type CodeReviewRound,
  type RecordedFinding,
  type ReviewerReproduction,
} from "./code-review.ts";
import {
  agreedRejections,
  validateReconcilerReply,
  type ReconcilerDecision,
} from "./code-review-reconcile.ts";
import {
  verifyCommit,
  type RecordedVerificationCommand,
  type VerificationCommand,
} from "./commit-verification.ts";
import { unquiescedReason, type FrozenSandbox } from "./container.ts";
import { derivedPathExclusion, regenerateDerivedArtifacts } from "./derived-artifacts.ts";
import { unapprovedDependencyAdditions } from "./dependency-policy.ts";
import { validateSpecDoc } from "./spec-doc.ts";
import { dispatchInSandbox, dispatchOnce } from "./dispatch.ts";
import { type ExecutorDefinition } from "./executor.ts";
import { extractJsonBody } from "./parse-output.ts";
import { parseVerificationHandoff } from "./handoff.ts";
import { checkWorktreeClean, commitWorkspace, NO_HOOKS } from "./workspace-commit.ts";
import {
  acceptanceEvidenceDir,
  codeReviewChecksDir,
  codeReviewEvidenceDir,
  codeReviewEvidenceRef,
  codeReviewPreservedDir,
  codeReviewVerificationDir,
  derivedEvidenceDir,
} from "./paths.ts";
import { CODE_REVIEW_RECONCILER } from "./policy.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveSettings } from "./profile.ts";
import {
  buildCodeReviewPrompt,
  buildCodeReviewReconcilerPrompt,
  buildCodeReviewRemediationPrompt,
  type AcceptanceReviewPrompt,
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
      reproductions: ReviewerReproduction[];
      /** Why the reply's reproductions were dropped; its findings still stand. */
      reproductionRefusal: string | null;
      durationMs: number;
    }
  | {
      reviewer: AgentDefinition;
      status: "dispatch_failed" | "output_invalid";
      reason: string;
      durationMs: number;
    };

/**
 * A confirmed reproduction of a finding the reconciler kept, run as a
 * non-blocking check at every later remediation's commit
 * (docs/features/reproduced-review-findings/plan.md, Task 6).
 */
export interface PreservedCheck {
  findingId: number;
  reviewer: string;
  fileName: string;
  confirmedInRound: number;
  location: string;
  intentKey: string;
  severity: string;
  /** At its `/bw-checks/` path. */
  file: AcceptanceFile;
  command: VerificationCommand;
}

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
  // The acceptance suite is read-only to remediation and its verification, and
  // refused at the boundary (docs/features/protected-acceptance-tests/plan.md, Task 7).
  const suiteDirs = profile.acceptance === null ? undefined : [profile.acceptance.dir];
  // What the reviewer and remediation prompts say about the suite (Task 9). The
  // criteria the author claimed were already met come from the validity gate's
  // record, so a reviewer can check the claim; a run with a suite that has no
  // readable record is refused here, before the stage row or any dispatch.
  let reviewPrompt: AcceptanceReviewPrompt | null = null;
  if (profile.acceptance !== null) {
    const gatePath = join(acceptanceEvidenceDir(rootDir, runId), "gate.json");
    let alreadySatisfied: unknown;
    try {
      alreadySatisfied = (JSON.parse(readFileSync(gatePath, "utf8")) as { alreadySatisfied?: unknown }).alreadySatisfied;
    } catch (err) {
      return { ok: false, reason: `run ${runId}'s acceptance gate record ${gatePath} is unreadable: ${(err as Error).message}` };
    }
    if (!Array.isArray(alreadySatisfied) || alreadySatisfied.some((id) => typeof id !== "string")) {
      return { ok: false, reason: `run ${runId}'s acceptance gate record ${gatePath} carries no alreadySatisfied list of criterion IDs` };
    }
    reviewPrompt = { dir: profile.acceptance.dir, alreadySatisfied: alreadySatisfied as string[] };
  }
  const suitePrompt = profile.acceptance === null
    ? null
    : { dir: profile.acceptance.dir, command: acceptanceCommand(profile.acceptance.dir, profile.acceptance.repeatEach) };
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

    // Every check preserved so far, never removed during the run, and those
    // that failed at the last remediation's commit, which the next panel is told of.
    const preserved: PreservedCheck[] = [];
    let failingChecks: Array<{ check: PreservedCheck; detail: string | null }> = [];

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
            prompt: buildCodeReviewPrompt(
              reviewer, specContent, planContent, changedPaths, diff, currentCommit, reviewPrompt,
              failingChecks.map(({ check, detail }) => ({ findingId: check.findingId, location: check.location, path: check.file.path, detail }))
            ),
            // The answer comes back as structured output, because a
            // reproduction is file content inside it
            // (docs/features/reproduced-review-findings/plan.md, hazard 1).
            invocation: { cwd: worktreePath, jsonSchema: CODE_REVIEW_REPLY_SCHEMA },
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
        // `resultText` is the serialized structured_output object (`parseEnvelope`).
        const result = validateAgentResult(reviewer.id, JSON.parse(dispatch.envelope.resultText));
        if (!result.ok) {
          return invalid(`result refused: ${result.reason}`);
        }
        if (result.value.status !== "proposed") {
          return invalid(
            `returned status ${result.value.status}, not proposed — a reviewer that cannot review must not pass the gate by absence`
          );
        }
        const content = result.value.proposedContentChanges as { findings?: unknown; reproductions?: unknown } | undefined;
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
        // A reproduction is evidence, never the review: one the validator
        // refuses drops the reply's reproductions, not its findings.
        const reproductions = validateCodeReviewReproductions(content.reproductions, reports.value);
        return {
          reviewer,
          status: "valid",
          agentRunId: dispatch.agentRunId,
          reports: reports.value,
          reproductions: reproductions.ok ? reproductions.value : [],
          reproductionRefusal: reproductions.ok ? null : reproductions.reason,
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

      const pendingReproductions: PendingReproduction[] = [];
      if (integrity === "clean") {
        for (const outcome of outcomes) {
          if (outcome.status !== "valid") continue;
          agentByRun.set(outcome.agentRunId, outcome.reviewer.id);
          if (outcome.reproductionRefusal !== null) {
            // The reason is free text: last field.
            audit(
              stage.id,
              "code_review.repro.refused",
              `round=${roundNumber}; commit=${currentCommit}; reviewer=${outcome.reviewer.id}; reason=${outcome.reproductionRefusal}`
            );
          }
          for (const report of outcome.reports) {
            const finding = store.upsertCanonicalFinding(stage.id, roundNumber, report.intentKey, report.location);
            const reproduction = outcome.reproductions.find(
              (entry) => entry.intentKey === report.intentKey && entry.location === report.location
            );
            if (reproduction !== undefined) {
              pendingReproductions.push({ findingId: finding.id, reviewer: outcome.reviewer.id, reproduction });
            }
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

      // Before the round is decided and before the reconciler, which is not
      // told the outcomes: they cannot change a rejection or a gate.
      const reproductions = pendingReproductions.length === 0
        ? []
        : await confirmReproductions({
            rootDir,
            runId,
            round: roundNumber,
            commit: currentCommit,
            pending: pendingReproductions,
            sandbox: profile.sandbox,
            timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
            retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
            audit: (action, summary) => audit(stage.id, action, summary),
          });
      for (const result of reproductions) {
        process.stderr.write(
          `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} reproduction of finding ${result.findingId} by ${result.reviewer}: ${result.outcome}\n`
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
        reproductions,
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

      // A confirmed reproduction of a kept finding becomes a check from this
      // remediation on. A rejected finding's never does: what it encodes is
      // not what the specification requires (hazard 16).
      for (const reproduction of reproductions) {
        if (reproduction.outcome !== "confirmed") continue;
        const finding = remediationFindings.find((entry) => entry.id === reproduction.findingId);
        if (finding === undefined) continue;
        const source = pendingReproductions.find(
          (entry) => entry.findingId === reproduction.findingId && entry.reviewer === reproduction.reviewer
        )!;
        const kept = preserveCheck({
          rootDir,
          runId,
          round: roundNumber,
          finding,
          reviewer: reproduction.reviewer,
          fileName: reproduction.fileName,
          content: source.reproduction.content,
          severities: profile.policy.severities,
        });
        if (!kept.ok) {
          // A check that cannot be kept is lost evidence, never a block.
          audit(
            stage.id,
            "code_review.check.unpreserved",
            `round=${roundNumber}; finding=${reproduction.findingId}; reviewer=${reproduction.reviewer}; file=${reproduction.fileName}; reason=${kept.reason}`
          );
          continue;
        }
        preserved.push(kept.check);
      }

      // The remediation runs in its own sandbox and changes the worktree
      // through the tool server; the system computes the diff against the
      // reviewed commit, gates it and commits it
      // (docs/features/sandboxed-implementer/plan.md, Task 9). The reconciler
      // above still reads free text.
      const cleanBeforeAuthor = checkWorktreeClean(worktreePath);
      if (!cleanBeforeAuthor.ok) {
        return abort(
          stage.id,
          "code_review.worktree.dirty",
          cleanBeforeAuthor.detail !== undefined
            ? `round ${roundNumber}: cannot check worktree cleanliness before the implementer: ${cleanBeforeAuthor.detail}`
            : `round ${roundNumber}: the worktree is dirty before the implementer in: ${cleanBeforeAuthor.entries.join(", ")}`
        );
      }
      const sandboxed = await dispatchInSandbox(
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
            profile.verification,
            suitePrompt,
            preserved.map((check) => ({ findingId: check.findingId, command: check.command }))
          ),
          // The answer comes back as structured output, never free text
          // (docs/features/structured-patch-output/plan.md).
          invocation: { cwd: worktreePath, jsonSchema: WORKSPACE_REPLY_SCHEMA },
        },
        {
          frozen: profile.sandbox, runId, label: `remediation-${roundNumber}`, worktreePath, readOnlyPaths: suiteDirs,
          // The preserved checks only, read-only, so the implementer can run
          // them and not change them, and never sees a rejected finding's.
          ...(preserved.length === 0 ? {} : { checksDir: codeReviewPreservedDir(rootDir, runId) }),
        },
        rootDir
      );
      if (!sandboxed.started) {
        return abort(stage.id, "code_review.sandbox.failed", `round ${roundNumber}: cannot start the remediation sandbox: ${sandboxed.reason}`);
      }
      // A process left in an unremoved work container could still be writing
      // the worktree, so nothing reads it until the container is proven gone.
      if (!sandboxed.teardown.workContainerGone) {
        const primary = sandboxed.dispatch.ok ? null : sandboxed.dispatch.reason;
        return abort(
          stage.id,
          "code_review.sandbox.quiescence.failed",
          `round ${roundNumber}: ${unquiescedReason(sandboxed.sandbox, sandboxed.teardown, primary)}`
        );
      }
      const teardownFailures = [...(sandboxed.proxyLogFailure === null ? [] : [sandboxed.proxyLogFailure]), ...sandboxed.teardown.failures];
      if (teardownFailures.length > 0) {
        audit(stage.id, "code_review.sandbox.teardown.failed", `round=${roundNumber}; sandbox ${sandboxed.sandbox.name}: ${teardownFailures.join("; ")}`);
      }
      const authorDispatch = sandboxed.dispatch;
      if (!authorDispatch.ok) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}, commit ${currentCommit}, implementer: ${authorDispatch.reason}`);
      }
      const reply = parseWorkspaceReply(authorDispatch.envelope.resultText, validateWorkspaceReply);
      if (!reply.ok) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}: ${reply.reason}`);
      }
      if (reply.value.status !== "completed") {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}: implementer returned ${describeIncompleteReply(reply.value)}`);
      }
      const committed = commitWorkspace({
        worktreePath,
        base: currentCommit,
        scope,
        slug: run.slug,
        derivedPaths: profile.verification.derived.map((d) => d.path),
        protectedPaths: suiteDirs,
        sandbox: profile.sandbox,
        message: `bw run ${runId}: code review remediation round ${roundNumber} (base ${currentCommit.slice(0, 8)})`,
        // The refusal is the abort's own record, below.
        onAudit: (action, summary) => {
          if (action === "derived.discarded") audit(stage.id, "code_review.remediation.derived.discarded", `round=${roundNumber}; ${summary}`);
        },
      });
      if (!committed.ok) {
        return abort(
          stage.id,
          "code_review.remediation.failed",
          committed.kind === "empty"
            ? `round ${roundNumber}: remediation produced no new commit from ${currentCommit}`
            : `round ${roundNumber}, base ${currentCommit}: ${committed.reason}`
        );
      }
      process.stderr.write(
        `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} remediation committed ${committed.head.slice(0, 8)} from ${currentCommit.slice(0, 8)}\n`
      );
      const dependencies = unapprovedDependencyAdditions(worktreePath, patchBase, committed.head, approvedDependencies);
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
        expectedHead: committed.head,
        label: `remediation-${roundNumber}`,
        evidenceDir: derivedEvidenceDir(rootDir, runId, `remediation-${roundNumber}`),
        sandbox: profile.sandbox,
        policy: {
          timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
          maxBytes: profile.policy.resultMaxBytes,
          retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
        },
        audit: (action, summary) => audit(stage.id, sandboxAction(action, "code_review.remediation."), `round=${roundNumber}; ${summary}`),
      });
      if (!regenerated.ok) {
        return abort(stage.id, "code_review.remediation.failed", `round ${roundNumber}, base ${currentCommit}: ${regenerated.reason}`);
      }
      const remediatedCommit = regenerated.head;

      // The suite runs last and decides the block, as at the verification
      // stage (docs/features/protected-acceptance-tests/plan.md, Task 8).
      const suite = profile.acceptance;
      const ran = await verifyCommit({
        rootDir,
        worktreePath,
        expectedCommit: remediatedCommit,
        commands: suite === null
          ? profile.verification.commands
          : [...profile.verification.commands, acceptanceCommand(suite.dir, suite.repeatEach)],
        timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
        maxBytes: profile.policy.resultMaxBytes,
        ...(suite === null ? {} : { maxBytesFor: { [ACCEPTANCE_COMMAND_NAME]: profile.policy.verifyRetentionMaxBytes } }),
        retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
        sandbox: profile.sandbox,
        runId,
        label: `remediation-${roundNumber}-verify`,
        readOnlyPaths: suiteDirs,
        evidenceDir: codeReviewVerificationDir(rootDir, runId, roundNumber),
        audit: (action, summary) => audit(stage.id, sandboxAction(action, "code_review.verification."), `round=${roundNumber}; commit=${remediatedCommit}; ${summary}`),
        progress: (command, because, durationMs) => {
          process.stderr.write(
            `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} verification ${because === null ? "pass" : "BLOCK"} ${command.name} at ${remediatedCommit.slice(0, 8)} in ${durationMs}ms\n`
          );
        },
      });
      const verification = suite === null ? ran : applyAcceptanceVerdict(rootDir, worktreePath, suite.dir, ran);
      if (verification.record === null) {
        // The sandbox failed, not a command: there is no verification result
        // to record for the round.
        return abort(
          stage.id,
          "code_review.verification.block",
          `code_review remediation verification blocked after round ${roundNumber}: ${verification.reason}`,
          `round=${roundNumber}; commit=${remediatedCommit}; ${verification.reason}`
        );
      }
      // Each check runs alone, after the verification it cannot change, in its
      // own throwaway checkout (Task 6): whatever one does, it fails only itself.
      const judgedChecks = verification.record.outcome === "block"
        ? []
        : await runPreservedChecks({
            rootDir,
            runId,
            round: roundNumber,
            commit: remediatedCommit,
            checks: preserved,
            sandbox: profile.sandbox,
            timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
            retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
            audit: (action, summary) => audit(stage.id, action, summary),
          });
      failingChecks = judgedChecks
        .filter(({ result }) => result.outcome === "fails")
        .map(({ check, result }) => ({ check, detail: result.detail }));
      for (const { result } of judgedChecks) {
        process.stderr.write(
          `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} check of finding ${result.findingId} by ${result.reviewer} at ${remediatedCommit.slice(0, 8)}: ${result.outcome}\n`
        );
      }
      roundRecord.remediation = {
        author: author.id,
        baseCommit: currentCommit,
        resultingCommit: remediatedCommit,
        changedPaths: committed.paths,
        verification: verification.record,
        preservedChecks: judgedChecks.map(({ result }) => result),
      };
      if (verification.record.outcome === "block") {
        const { resultRef } = writeRecord("block", [], currentCommit);
        const reason = `code_review remediation verification blocked after round ${roundNumber}: ${verification.reason}`;
        store.completeStage(stage.id, resultRef, "block");
        store.setRunStatus(runId, "blocked");
        audit(stage.id, "code_review.verification.block", `round=${roundNumber}; commit=${remediatedCommit}; ${verification.reason}`);
        return { ok: false, reason };
      }
      audit(stage.id, "code_review.remediation.pass", `round=${roundNumber}; base=${currentCommit}; commit=${remediatedCommit}; changedPaths=${committed.paths.join(",")}; verification=pass`);
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

/** A validated reproduction awaiting confirmation, with the canonical finding it names. */
export interface PendingReproduction {
  findingId: number;
  reviewer: string;
  reproduction: ReviewerReproduction;
}

/**
 * Run each reviewer reproduction against the commit it reviewed
 * (docs/features/reproduced-review-findings/plan.md, Task 5), in panel order.
 * A reproduction the lint refuses is never written or run. The rest are
 * written under the run's checks directory, which is mounted read-only at
 * `/bw-checks`, and each runs alone (`runAlone`): never in the run's worktree
 * (hazard 15), and never where another reproduction can stop it. Each outcome
 * is the classified report's, never the exit code's, and is evidence only.
 */
export async function confirmReproductions(input: {
  rootDir: string;
  runId: number;
  round: number;
  commit: string;
  pending: PendingReproduction[];
  sandbox: FrozenSandbox;
  timeoutSeconds: number;
  /** Each report's output budget and retention, as the acceptance report's. */
  retentionMaxBytes: number;
  audit: (action: string, summary: string) => void;
}): Promise<CodeReviewReproduction[]> {
  const { rootDir, runId, round, commit } = input;
  const roundDir = join(codeReviewEvidenceDir(rootDir, runId), `round-${round}`);
  const checksDir = codeReviewChecksDir(rootDir, runId);
  const results: CodeReviewReproduction[] = [];
  for (const { findingId, reviewer, reproduction } of input.pending) {
    const result: CodeReviewReproduction = {
      findingId,
      reviewer,
      fileName: reproduction.fileName,
      contentSha256: sha256Hex(reproduction.content),
      outcome: "repro_failed",
      detail: null,
      evidenceRef: null,
    };
    results.push(result);
    const file = { path: `${CHECKS_ROOT}${findingId}/${reviewer}/${reproduction.fileName}`, content: reproduction.content };
    const refusals = lintSuiteFile(file);
    const written = refusals.length > 0 ? null : writeCheckFile(checksDir, findingId, reviewer, reproduction.fileName, reproduction.content);
    if (refusals.length > 0) {
      result.detail = `the lint refused it: ${refusals.join("; ")}`;
    } else if (written !== null) {
      result.detail = `cannot write the reproduction: ${written}`;
    } else {
      const ran = await runAlone({
        rootDir,
        runId,
        commit,
        checkout: join(roundDir, "repro-checkout", `${findingId}-${reviewer}`),
        label: `round-${round}-repro`,
        evidenceDir: join(roundDir, "reproductions"),
        mountDir: checksDir,
        file,
        command: { ...reproductionCommand(`${findingId}-${reviewer}-${reproduction.fileName}`, file.path), blocking: false },
        sandbox: input.sandbox,
        timeoutSeconds: input.timeoutSeconds,
        retentionMaxBytes: input.retentionMaxBytes,
        audit: (action, summary) =>
          input.audit(`code_review.repro.${action}`, `round=${round}; commit=${commit}; finding=${findingId}; reviewer=${reviewer}; ${summary}`),
      });
      result.evidenceRef = ran.evidenceRef;
      result.outcome = ran.kind === "matcher_failure" ? "confirmed" : ran.kind === "passed" ? "not_reproduced" : "repro_failed";
      result.detail = ran.detail;
    }
    // The detail is free text: last field.
    input.audit(
      `code_review.repro.${result.outcome}`,
      `round=${round}; commit=${commit}; finding=${result.findingId}; reviewer=${result.reviewer}; file=${result.fileName}; sha256=${result.contentSha256}; evidence=${result.evidenceRef ?? "none"}; detail=${result.detail ?? "none"}`
    );
  }
  return results;
}

/**
 * Keep a confirmed reproduction of a kept finding as a check (Task 6): its
 * file is written under the run's preserved directory, which holds nothing
 * else, at the same `/bw-checks/` path it was confirmed at. Its severity is
 * the highest any reviewer gave the finding.
 */
export function preserveCheck(input: {
  rootDir: string;
  runId: number;
  round: number;
  finding: RecordedFinding;
  reviewer: string;
  fileName: string;
  content: string;
  severities: readonly string[];
}): { ok: true; check: PreservedCheck } | { ok: false; reason: string } {
  const { finding, reviewer, fileName, severities } = input;
  const written = writeCheckFile(codeReviewPreservedDir(input.rootDir, input.runId), finding.id, reviewer, fileName, input.content);
  if (written !== null) return { ok: false, reason: written };
  const path = `${CHECKS_ROOT}${finding.id}/${reviewer}/${fileName}`;
  return {
    ok: true,
    check: {
      findingId: finding.id,
      reviewer,
      fileName,
      confirmedInRound: input.round,
      location: finding.location,
      intentKey: finding.intentKey,
      severity: finding.reports
        .map((report) => report.severity)
        .reduce((highest, severity) => (severities.indexOf(severity) > severities.indexOf(highest) ? severity : highest)),
      file: { path, content: input.content },
      command: { ...reproductionCommand(`${finding.id}-${reviewer}-${fileName}`, path), blocking: false },
    },
  };
}

/**
 * Run every preserved check at a remediation's verified commit (Task 6), each
 * alone (`runAlone`) with only the preserved directory at `/bw-checks`:
 * `holds` when every test passed on both repeats, `fails` otherwise, whatever
 * stopped it. No result blocks anything.
 */
export async function runPreservedChecks(input: {
  rootDir: string;
  runId: number;
  /** The remediation's round. */
  round: number;
  commit: string;
  checks: PreservedCheck[];
  sandbox: FrozenSandbox;
  timeoutSeconds: number;
  retentionMaxBytes: number;
  audit: (action: string, summary: string) => void;
}): Promise<Array<{ check: PreservedCheck; result: CodeReviewPreservedCheck }>> {
  const { rootDir, runId, round, commit } = input;
  const roundDir = join(codeReviewEvidenceDir(rootDir, runId), `round-${round}`);
  const judged: Array<{ check: PreservedCheck; result: CodeReviewPreservedCheck }> = [];
  for (const check of input.checks) {
    const ran = await runAlone({
      rootDir,
      runId,
      commit,
      checkout: join(roundDir, "check-checkout", `${check.findingId}-${check.reviewer}`),
      label: `remediation-${round}-check`,
      evidenceDir: join(roundDir, "preserved-checks"),
      mountDir: codeReviewPreservedDir(rootDir, runId),
      file: check.file,
      command: check.command,
      sandbox: input.sandbox,
      timeoutSeconds: input.timeoutSeconds,
      retentionMaxBytes: input.retentionMaxBytes,
      audit: (action, summary) =>
        input.audit(`code_review.check.${action}`, `round=${round}; commit=${commit}; finding=${check.findingId}; reviewer=${check.reviewer}; ${summary}`),
    });
    const result: CodeReviewPreservedCheck = {
      findingId: check.findingId,
      reviewer: check.reviewer,
      fileName: check.fileName,
      confirmedInRound: check.confirmedInRound,
      outcome: ran.kind === "passed" ? "holds" : "fails",
      detail: ran.detail,
      evidenceRef: ran.evidenceRef,
    };
    // The detail is free text: last field.
    input.audit(
      `code_review.check.${result.outcome}`,
      `round=${round}; commit=${commit}; finding=${result.findingId}; reviewer=${result.reviewer}; file=${result.fileName}; confirmedInRound=${result.confirmedInRound}; evidence=${result.evidenceRef ?? "none"}; detail=${result.detail ?? "none"}`
    );
    judged.push({ check, result });
  }
  return judged;
}

/** Write one check file at `<dir>/<findingId>/<reviewer>/<fileName>`, never over another; the failure, or `null`. */
function writeCheckFile(dir: string, findingId: number, reviewer: string, fileName: string, content: string): string | null {
  const hostDir = join(dir, String(findingId), reviewer);
  try {
    mkdirSync(hostDir, { recursive: true });
    writeFileSync(join(hostDir, fileName), content, { flag: "wx" });
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Run one reproduction or check by itself: one `verifyCommit` call with its
 * one command, in its own throwaway detached checkout of `commit`, with
 * `mountDir` read-only at `/bw-checks`. The checkout is removed afterwards
 * whatever happened. A checkout that cannot be made, a sandbox failure, a
 * worktree the command left dirty or anything thrown is `other`, with that
 * reason as the detail, so no run can stop another or the stage.
 */
async function runAlone(input: {
  rootDir: string;
  runId: number;
  commit: string;
  checkout: string;
  label: string;
  evidenceDir: string;
  mountDir: string;
  file: AcceptanceFile;
  command: VerificationCommand;
  sandbox: FrozenSandbox;
  timeoutSeconds: number;
  /** The report's output budget and retention, as the acceptance report's. */
  retentionMaxBytes: number;
  /** Receives the step's action unprefixed. */
  audit: (action: string, summary: string) => void;
}): Promise<{ evidenceRef: string | null } & ReturnType<typeof judgeReproductionRun>> {
  const { rootDir, checkout, commit } = input;
  const added = existsSync(checkout)
    ? { ok: false as const, detail: "it already exists" }
    : runGit([...NO_HOOKS, "-c", "core.autocrlf=false", "-c", "core.eol=lf", "worktree", "add", "--detach", checkout, commit], rootDir);
  if (!added.ok) {
    return { evidenceRef: null, kind: "other", detail: `cannot create the throwaway checkout at ${checkout}: ${added.detail}` };
  }
  try {
    const ran = await verifyCommit({
      rootDir,
      worktreePath: checkout,
      expectedCommit: commit,
      commands: [input.command],
      timeoutSeconds: input.timeoutSeconds,
      maxBytes: input.retentionMaxBytes,
      retentionMaxBytes: input.retentionMaxBytes,
      sandbox: input.sandbox,
      runId: input.runId,
      label: input.label,
      checksDir: input.mountDir,
      evidenceDir: input.evidenceDir,
      audit: input.audit,
    });
    if (ran.record === null) return { evidenceRef: null, kind: "other", detail: ran.reason };
    const recorded = ran.record.commands[0];
    if (recorded === undefined) {
      return { evidenceRef: null, kind: "other", detail: `not run: ${ran.reason ?? "verification stopped before it"}` };
    }
    return { evidenceRef: recorded.evidenceRef, ...judgeRecordedReproduction(rootDir, recorded, input.file) };
  } catch (err) {
    return { evidenceRef: null, kind: "other", detail: `the run failed: ${(err as Error).message}` };
  } finally {
    const removed = runGit(["worktree", "remove", "--force", checkout], rootDir);
    if (!removed.ok) input.audit("cleanup.failed", `cannot remove the throwaway checkout ${checkout}: ${removed.detail}`);
  }
}

/**
 * What one reproduction command showed, from its record and its retained
 * report, never its exit code: a checkout it left dirty, a ceiling or an
 * output budget is `other`, with that reason as the detail.
 */
function judgeRecordedReproduction(
  rootDir: string,
  recorded: RecordedVerificationCommand,
  file: AcceptanceFile
): ReturnType<typeof judgeReproductionRun> {
  if (recorded.blockedBecause !== null) return { kind: "other", detail: recorded.blockedBecause };
  if (recorded.timedOut || recorded.outputOverflow) return { kind: "other", detail: recorded.nonBlockingFailure ?? null };
  let log: string;
  try {
    log = readFileSync(resolve(rootDir, recorded.evidenceRef), "utf8");
  } catch (err) {
    return { kind: "other", detail: `cannot read the retained report: ${(err as Error).message}` };
  }
  return judgeReproductionRun(log, file);
}

/**
 * The audit action for a remediation's derived regeneration or verification:
 * a sandbox event is the stage's own (`code_review.sandbox.failed`), every
 * other keeps the step's prefix.
 */
function sandboxAction(action: string, stepPrefix: string): string {
  return action.startsWith("sandbox.") ? `code_review.${action}` : `${stepPrefix}${action}`;
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
      for (const reproduction of round.reproductions.filter((entry) => entry.findingId === finding.id)) {
        lines.push(
          `- reproduction by ${reproduction.reviewer} (${reproduction.fileName}): ${reproduction.outcome}${reproduction.detail === null ? "" : ` — ${reproduction.detail}`}`
        );
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
        ...round.remediation.preservedChecks.map(
          (check) =>
            `- Check ${check.fileName} (finding ${check.findingId}, by ${check.reviewer}, confirmed in round ${check.confirmedInRound}): ${check.outcome}${check.detail === null ? "" : ` — ${check.detail}`}`
        ),
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
