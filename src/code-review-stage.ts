import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateAgentResult, type ProposedPatch } from "./agent-result.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import {
  decideCodeReviewRound,
  formatCodeReviewGatePass,
  validateCodeReviewReports,
  type CodeReviewBlock,
  type CodeReviewRecord,
  type CodeReviewRound,
  type RecordedFinding,
} from "./code-review.ts";
import { verifyCommit } from "./commit-verification.ts";
import { dispatchOnce } from "./dispatch.ts";
import type { ExecutorDefinition } from "./executor.ts";
import { extractJsonBody } from "./parse-output.ts";
import { applyProposedPatches, checkWorktreeClean } from "./patch-application.ts";
import {
  codeReviewEvidenceDir,
  codeReviewEvidenceRef,
  codeReviewVerificationDir,
} from "./paths.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { buildCodeReviewPrompt, buildCodeReviewRemediationPrompt } from "./prompts.ts";
import { upstreamPrefixFor, validateReviewerReports } from "./reconciliation.ts";
import { codeReviewPanel, codeReviewStaffingShortfall } from "./select.ts";
import { requireRunInProgress, type Store } from "./store.ts";

export type CodeReviewStageResult =
  | { ok: true; stageId: number; resultRef: string }
  | { ok: false; reason: string };

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

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

/** One code-review stage containing every bounded panel and repair attempt. */
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
  const resolvedModel = resolveStageModel(profile, "code_review");
  if (!resolvedModel.ok) return { ok: false, reason: resolvedModel.reason };
  if (requestedModel !== undefined && requestedModel !== resolvedModel.model) {
    return {
      ok: false,
      reason: `--model ${requestedModel} does not match the model frozen at run start (${resolvedModel.model}): config is frozen at run start`,
    };
  }
  const model = resolvedModel.model;
  const binding = requireFrozenBinding(profile, executor, "code_review");
  if (!binding.ok) return { ok: false, reason: binding.reason };

  const ageSeconds = (Date.now() - Date.parse(run.created_at)) / 1000;
  if (ageSeconds > profile.policy.runDurationLimitSeconds) {
    return {
      ok: false,
      reason: `run ${runId} has exceeded the run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds`,
    };
  }

  const verificationRecordPath = join(rootDir, last.output_ref);
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
    const parsed = JSON.parse(readFileSync(verificationRecordPath, "utf8")) as Record<string, unknown>;
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
    worktreePath = parsed.worktreePath;
    initialVerifiedCommit = parsed.verifiedCommit;
    patchBase = parsed.patchBase;
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
    planContent = readFileSync(planStage.output_ref, "utf8");
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
    specContent = readFileSync(approvalStage.output_ref, "utf8");
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

  const author = profile.agents.find((agent) => agent.id === "implementer");
  if (!author) return { ok: false, reason: "configured agent implementer is not in the frozen profile" };
  if (author.role !== "author" || author.executor !== executor.id || !author.outputs.includes("patches")) {
    return {
      ok: false,
      reason: `configured agent ${author.id} cannot author patches through the frozen executor ${executor.id}`,
    };
  }

  const initialNames = runGit(
    ["diff", "--name-only", "-z", patchBase, initialVerifiedCommit],
    worktreePath
  );
  if (!initialNames.ok) {
    return {
      ok: false,
      reason: `cannot read the changed paths for ${patchBase}..${initialVerifiedCommit}: ${initialNames.detail}`,
    };
  }
  if (initialNames.stdout.split("\0").filter((path) => path !== "").length === 0) {
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
  const abort = (activeStageId: number, action: string, reason: string): CodeReviewStageResult => {
    audit(activeStageId, action, reason);
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
      const names = runGit(["diff", "--name-only", "-z", patchBase, currentCommit], worktreePath);
      if (!names.ok) {
        return abort(stage.id, "code_review.round.failed", `round ${roundNumber}: cannot read changed paths for ${patchBase}..${currentCommit}: ${names.detail}`);
      }
      const changedPaths = names.stdout.split("\0").filter((path) => path !== "");
      if (changedPaths.length === 0) {
        return abort(stage.id, "code_review.round.failed", `round ${roundNumber}: ${patchBase}..${currentCommit} changed no files`);
      }
      const diffResult = runGit(["diff", "--no-color", patchBase, currentCommit], worktreePath);
      if (!diffResult.ok) {
        return abort(stage.id, "code_review.round.failed", `round ${roundNumber}: cannot read diff for ${patchBase}..${currentCommit}: ${diffResult.detail}`);
      }
      const diff = diffResult.stdout;
      audit(
        stage.id,
        "code_review.round.start",
        `round=${roundNumber}/${profile.policy.codeReviewMaxRounds}; commit=${currentCommit}; changedPaths=${changedPaths.length}; panel=${panel.map((agent) => agent.id).join("+")}`
      );

      for (const reviewer of panel) {
        const startedAt = Date.now();
        const dispatch = await dispatchOnce(
          store,
          executor,
          {
            stageId: stage.id,
            agent: reviewer.id,
            role: "reviewer",
            requestedModel: model,
            prompt: buildCodeReviewPrompt(reviewer, specContent, planContent, changedPaths, diff, currentCommit),
            invocation: { cwd: worktreePath },
          },
          rootDir
        );
        if (!dispatch.ok) {
          return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, commit ${currentCommit}, reviewer ${reviewer.id}: ${dispatch.reason}`);
        }
        const headAfter = runGit(["rev-parse", "HEAD"], worktreePath);
        if (!headAfter.ok) {
          return abort(stage.id, "code_review.worktree.dirty", `round ${roundNumber}: the worktree head could not be re-read after ${reviewer.id}: ${headAfter.detail}`);
        }
        if (headAfter.stdout.trim() !== currentCommit) {
          return abort(stage.id, "code_review.worktree.dirty", `round ${roundNumber}: reviewer ${reviewer.id} moved the worktree head from ${currentCommit} to ${headAfter.stdout.trim()}`);
        }
        const cleanAfter = checkWorktreeClean(worktreePath);
        if (!cleanAfter.ok) {
          return abort(
            stage.id,
            "code_review.worktree.dirty",
            cleanAfter.detail !== undefined
              ? `round ${roundNumber}: cannot check worktree cleanliness after ${reviewer.id}: ${cleanAfter.detail}`
              : `round ${roundNumber}: reviewer ${reviewer.id} left the worktree dirty in: ${cleanAfter.entries.join(", ")}`
          );
        }
        const body = extractJsonBody(dispatch.envelope.resultText);
        if (body.kind === "refused") {
          return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, reviewer ${reviewer.id} body refused: ${body.reason}`);
        }
        const result = validateAgentResult(reviewer.id, body.value);
        if (!result.ok) {
          return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, reviewer ${reviewer.id} result refused: ${result.reason}`);
        }
        if (result.value.status !== "proposed") {
          return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, reviewer ${reviewer.id} returned status ${result.value.status}, not proposed — a reviewer that cannot review must not pass the gate by absence`);
        }
        const content = result.value.proposedContentChanges as { findings?: unknown } | undefined;
        if (!Array.isArray(content?.findings)) {
          return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, reviewer ${reviewer.id} result is missing proposedContentChanges.findings`);
        }
        const reports = validateReviewerReports(content.findings, {
          agentId: reviewer.id,
          upstreamPrefix: upstreamPrefixFor("plan"),
        });
        if (!reports.ok) {
          return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, reviewer ${reviewer.id} result refused: ${reports.reason}`);
        }
        const reportRefusal = validateCodeReviewReports(reports.value, changedPaths);
        if (reportRefusal !== null) {
          return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, reviewer ${reviewer.id} result refused: ${reportRefusal}`);
        }
        for (const report of reports.value) {
          if (!profile.policy.severities.includes(report.severity)) {
            return abort(stage.id, "code_review.reviewer.failed", `round ${roundNumber}, reviewer ${reviewer.id} result refused: severity ${JSON.stringify(report.severity)} is not in the frozen severities ${profile.policy.severities.join(", ")}`);
          }
        }
        agentByRun.set(dispatch.agentRunId, reviewer.id);
        for (const report of reports.value) {
          const finding = store.upsertCanonicalFinding(stage.id, roundNumber, report.intentKey, report.location);
          store.insertFindingReport({
            findingId: finding.id,
            agentRunId: dispatch.agentRunId,
            severity: report.severity,
            classification: report.classification,
            subject: report.subject,
          });
          audit(
            stage.id,
            "code_review.finding.record",
            `round=${roundNumber}; commit=${currentCommit}; finding=${finding.id}; location=${report.location}; intent=${report.intentKey}; severity=${report.severity}; reviewer=${reviewer.id}`
          );
        }
        process.stderr.write(
          `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} reviewed ${reviewer.id} (${reviewer.specialty ?? "general review"}) at ${currentCommit.slice(0, 8)}: ${reports.value.length} finding(s) in ${Date.now() - startedAt}ms\n`
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
      const decision = decideCodeReviewRound(
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
        remediation: null,
      };
      rounds.push(roundRecord);

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
        const reason = `code_review blocked after round ${roundNumber}/${profile.policy.codeReviewMaxRounds}: finding id(s) ${named}; threshold ${profile.policy.codeReviewBlockingSeverity}`;
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
          requestedModel: model,
          prompt: buildCodeReviewRemediationPrompt(
            author,
            specContent,
            planContent,
            scope,
            currentCommit,
            changedPaths,
            diff,
            recordedFindings.map((finding) => ({
              findingId: finding.id,
              location: finding.location,
              intentKey: finding.intentKey,
              reports: finding.reports.map((report) => ({
                reviewerId: report.agent,
                severity: report.severity,
                classification: report.classification,
                subject: report.subject,
              })),
            }))
          ),
          invocation: { cwd: worktreePath },
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

      const verification = await verifyCommit({
        rootDir,
        worktreePath,
        expectedCommit: applied.resultingCommit,
        commands: profile.verification.commands,
        timeoutSeconds: profile.policy.verifyCommandTimeoutSeconds,
        maxBytes: profile.policy.resultMaxBytes,
        retentionMaxBytes: profile.policy.verifyRetentionMaxBytes,
        envPassthrough: profile.policy.verifyEnvPassthrough,
        evidenceDir: codeReviewVerificationDir(rootDir, runId, roundNumber),
        audit: (action, summary) => audit(stage.id, `code_review.verification.${action}`, `round=${roundNumber}; commit=${applied.resultingCommit}; ${summary}`),
        progress: (command, because, durationMs) => {
          process.stderr.write(
            `round ${roundNumber}/${profile.policy.codeReviewMaxRounds} verification ${because === null ? "pass" : "BLOCK"} ${command.name} at ${applied.resultingCommit.slice(0, 8)} in ${durationMs}ms\n`
          );
        },
      });
      roundRecord.remediation = {
        author: author.id,
        baseCommit: currentCommit,
        resultingCommit: applied.resultingCommit,
        changedPaths: applied.changedPaths,
        verification: verification.record,
      };
      if (verification.record.outcome === "block") {
        const { resultRef } = writeRecord("block", [], currentCommit);
        const reason = `code_review remediation verification blocked after round ${roundNumber}: ${verification.reason}`;
        store.completeStage(stage.id, resultRef, "block");
        store.setRunStatus(runId, "blocked");
        audit(stage.id, "code_review.verification.block", `round=${roundNumber}; commit=${applied.resultingCommit}; ${verification.reason}`);
        return { ok: false, reason };
      }
      audit(stage.id, "code_review.remediation.pass", `round=${roundNumber}; base=${currentCommit}; commit=${applied.resultingCommit}; changedPaths=${applied.changedPaths.join(",")}; verification=pass`);
      currentCommit = applied.resultingCommit;
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
