import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { validateAgentResult } from "./agent-result.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { dispatchOnce } from "./dispatch.ts";
import type { ExecutorDefinition } from "./executor.ts";
import { codeReviewEvidenceDir, codeReviewEvidenceRef } from "./paths.ts";
import { normalizeLocation } from "./finding.ts";
import { extractJsonBody } from "./parse-output.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { buildCodeReviewPrompt } from "./prompts.ts";
import { proposalIdentity, writeProposalEvidence } from "./proposal.ts";
import { upstreamPrefixFor, validateReviewerReports, type ReviewerReport } from "./reconciliation.ts";
import { codeReviewPanel, codeReviewStaffingShortfall } from "./select.ts";
import {
  requireRunInProgress,
  type CanonicalFindingRow,
  type FindingReportRow,
  type Store,
} from "./store.ts";

export type CodeReviewStageResult =
  | { ok: true; stageId: number; resultRef: string }
  | { ok: false; reason: string };

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A `current_artifact` location's optional line suffix: a positive integer. */
const LINE_SUFFIX = /^[1-9][0-9]*$/;

/** One reviewer's report as the record carries it, attributed to its agent. */
export interface RecordedReport {
  agent: string;
  severity: string;
  classification: string;
  subject: string;
}

/** One canonical finding and every report made on it, as the record carries it. */
export interface RecordedFinding {
  id: number;
  location: string;
  intentKey: string;
  reports: RecordedReport[];
}

/** One finding the gate blocked on, and why. */
export interface CodeReviewBlock {
  findingId: number;
  /** The highest severity any report gave the finding, in the frozen order. */
  severity: string;
  /**
   * The canonical finding's location: a changed path for a
   * `current_artifact` finding, and the `upstream:plan:<decision-key>` token
   * itself for an upstream one — so the decision key travels in the record
   * and in the gate event rather than only in a report row.
   */
  location: string;
  cause: "upstream" | "severity";
}

/** The proposal one upstream finding raised, as the record carries it. */
export interface RecordedProposal {
  proposalId: number;
  findingId: number;
  route: string;
  evidenceRef: string;
}

/**
 * The structured record `delivery_check` is handed (section 4: stage N's
 * `output_ref` is literally what stage N+1 was handed).
 *
 * Exported so delivery reads the same type this stage writes from, rather
 * than a second hand-written description of one shape (hard rule 3). It
 * carries the range and the worktree as well as the verdict, because
 * delivery cross-checks those against the verification record it walks back
 * to: a review that read a different range has not reviewed what delivery is
 * about to certify.
 */
export interface CodeReviewRecord {
  runId: number;
  stageId: number;
  worktreePath: string;
  patchBase: string;
  verifiedCommit: string;
  changedPaths: string[];
  /** The agent ids seated, in seat order. */
  panel: string[];
  blockingSeverity: string;
  /** The frozen severity order the gate indexed, not the live constant. */
  severities: string[];
  findings: RecordedFinding[];
  blocking: CodeReviewBlock[];
  proposals: RecordedProposal[];
  outcome: "pass" | "block";
  createdAt: string;
}

/**
 * Every `current_artifact` location must name one of the changed paths, with
 * an optional positive integer line. Returns the refusal, or null.
 *
 * A pure function, exported so it can be tested directly and replayed against
 * a recorded real response.
 *
 * The reviewer prompt states this rule; this is the deterministic backstop
 * (hazard 3). Without it an untrusted reviewer could place an authoritative,
 * run-blocking finding on a heading, a prose description, or a file the run
 * never touched — defeating the traceability the finding's location exists
 * for.
 *
 * The shared `validateReviewerReports` has already normalized the location by
 * the time this runs: it trims edge whitespace, collapses internal runs, and
 * drops one trailing colon. **Each changed path is normalized the same way
 * before the comparison.** A normalization applied at one side of a comparison
 * and not the other is this repository's recurring defect, and here it had a
 * concrete cost: a changed path containing a run of whitespace — git emits
 * such names raw under `-z` — could never be cited at all, because the
 * reviewer's correct report normalized to something no raw path equalled, and
 * the run took a terminal block that a fresh run would repeat identically.
 *
 * Normalizing both sides admits a collision the raw comparison could not have:
 * two changed paths differing only in whitespace share one normalized form,
 * and the reviewer's citation genuinely does not say which it meant. That is
 * refused as ambiguous rather than resolved by picking one — the location
 * exists to make a finding traceable, and a guess would make it traceable to
 * the wrong file.
 *
 * Upstream reports are ignored: their location syntax is the shared
 * validator's business, and it has already refused anything that is not the
 * exact `upstream:plan:<decision-key>` token.
 */
export function validateCodeReviewLocations(
  reports: readonly Pick<ReviewerReport, "classification" | "location">[],
  changedPaths: readonly string[]
): string | null {
  const listed = changedPaths.join(", ") || "none";
  for (const report of reports) {
    if (report.classification !== "current_artifact") continue;
    const location = report.location;
    const whole = changedPaths.filter((p) => normalizeLocation(p) === location);
    if (whole.length > 1) {
      return `finding location ${JSON.stringify(location)} names more than one changed path (${whole.join(", ")})`;
    }
    if (whole.length === 1) continue;
    const prefixes = changedPaths.filter((p) => location.startsWith(`${normalizeLocation(p)}:`));
    if (prefixes.length === 0) {
      return `finding location ${JSON.stringify(location)} is not one of the changed paths (${listed})`;
    }
    if (prefixes.length > 1) {
      return `finding location ${JSON.stringify(location)} matches more than one changed path (${prefixes.join(", ")})`;
    }
    const suffix = location.slice(normalizeLocation(prefixes[0]!).length + 1);
    if (!LINE_SUFFIX.test(suffix)) {
      return `finding location ${JSON.stringify(location)} has the line suffix ":${suffix}", which is not a positive integer line number`;
    }
  }
  return null;
}

/**
 * The deterministic gate (section 12). Pure, and exported so it can be tested
 * directly and replayed against a recorded real response.
 *
 * A finding blocks with cause `upstream` when any report on it carries
 * classification `upstream`, whatever its severity; otherwise it blocks with
 * cause `severity` when any report reaches `blockingSeverity` in the frozen
 * order. Each blocking finding appears once, carrying the highest severity
 * any report gave it.
 *
 * **What this proves, and what it does not.** It proves that no reviewer
 * asserted a severity at or above the threshold this run froze, and that no
 * reviewer placed a defect's cause in the approved plan. It does not prove
 * the code is correct: nothing confirms a below-threshold finding was
 * harmless, no author answers any finding, and a change whose diff, spec, and
 * plan exceed the frozen prompt ceiling is refused by name rather than
 * reviewed in part — so the stage's reach is bounded by diff size, and a
 * refusal there lands after implementation has already spent.
 *
 * **Why a severity threshold rather than decision completeness.** Section 12
 * replaced severity gating with decision completeness for `spec_review` and
 * `plan_review` because those stages have a reconciliation dispatch that
 * produces decisions to be complete about. This stage has none — there is no
 * author to answer a finding, and building that answer path is the
 * remediation loop section 12 defers — so the only deterministic function of
 * what the stage holds is over the reports themselves. Blocking on any
 * finding at all would make the default installation unable to complete a run
 * against any design large enough to attract one (hazard 11), which is why it
 * is a threshold and not a count.
 *
 * **Why upstream is not gated by severity.** A reviewer who concludes the
 * approved plan left a decision unmade has named something no code change in
 * this run can repair (hazard 16). Passing that below the threshold would
 * deliver code over a defect nobody owns, so it blocks for a human at any
 * severity and raises a non-binding proposal — section 13's requirement that
 * an upstream finding have somewhere actionable to go.
 *
 * The throws are wedge guards, never the ordinary path: `invalidPolicyReason`
 * refuses a threshold absent from the frozen vocabulary at freeze time, and
 * the stage refuses a report severity absent from it before persisting
 * anything.
 */
export function codeReviewGate(
  findings: readonly { finding: CanonicalFindingRow; reports: readonly FindingReportRow[] }[],
  blockingSeverity: string,
  severities: readonly string[]
): { pass: true } | { pass: false; blocking: CodeReviewBlock[] } {
  const threshold = severities.indexOf(blockingSeverity);
  if (threshold === -1) {
    throw new Error(
      `the code-review blocking severity ${blockingSeverity} is not in the frozen severities ${severities.join(", ")}`
    );
  }
  const blocking: CodeReviewBlock[] = [];
  for (const { finding, reports } of findings) {
    if (reports.length === 0) continue;
    let highest = -1;
    let upstream = false;
    for (const report of reports) {
      const index = severities.indexOf(report.severity);
      if (index === -1) {
        throw new Error(
          `finding ${finding.id} carries severity ${report.severity}, which is not in the frozen severities ${severities.join(", ")}`
        );
      }
      if (index > highest) highest = index;
      if (report.classification === "upstream") upstream = true;
    }
    const cause: "upstream" | "severity" | null = upstream
      ? "upstream"
      : highest >= threshold
        ? "severity"
        : null;
    if (cause === null) continue;
    blocking.push({
      findingId: finding.id,
      severity: severities[highest]!,
      location: finding.location,
      cause,
    });
  }
  return blocking.length === 0 ? { pass: true } : { pass: false, blocking };
}

/**
 * The code review stage, one row continuing section 5's chain from the passed
 * `verification` row: seat a fixed panel of every registered code reviewer,
 * hand each the approved specification and plan, the changed paths, and the
 * unified diff of the range verification proved, with the worktree at the
 * verified commit as a read-only working directory; record every report as
 * immutable evidence on a canonical finding; and decide a deterministic gate
 * over those findings.
 *
 * It exists because a chain could prove every declared path was committed and
 * that the frozen commands passed, and still have had nothing read the code —
 * hazard 18, observed on a completed run.
 *
 * **The panel is fixed and there is no author.** No panel request, no
 * self-critique, no reconciliation dispatch, no remediation round, no
 * re-review, and no operator waiver. Round is always 1. A block is terminal
 * and a fresh run is the repair — which, against the same design and model,
 * varies nothing (hazard 7), so a mistaken block ends at the design or the
 * rubric rather than at a retry. Section 12's deferred-behaviours subsection
 * records both of those absences.
 *
 * **The tree is checked, not trusted** (hazard 15). The reviewers run with
 * the worktree as their working directory under a read-only executor, and the
 * stage asserts the worktree is at the verified commit and clean before the
 * stage row exists and again after every dispatch.
 *
 * **Independence is not claimed.** Every dispatch goes through `dispatchOnce`,
 * which records `configured_standalone`; the panel never seats the
 * implementer because it filters on `role: "reviewer"`. What the audit can
 * support is "separately dispatched and recorded as `configured_standalone`",
 * which is what the binding documents say (section 6, hazard 14).
 */
export async function runCodeReviewStage(
  store: Store,
  executor: ExecutorDefinition,
  input: { runId: number; requestedModel?: string; rootDir: string }
): Promise<CodeReviewStageResult> {
  const { runId, requestedModel, rootDir } = input;

  // Git is spawned directly, no shell, the way the three sibling stages spawn
  // it. The 64 MiB buffer is delivery's: the unified diff of a run's whole
  // patch range is the largest git output in the chain.
  const runGit = (
    args: string[],
    cwd: string
  ): { ok: true; stdout: string } | { ok: false; detail: string } => {
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
  };

  /**
   * Clean means *everything*: tracked, untracked, and ignored-but-matching.
   * The implementation stage's check, copied — the reviewers are invoked with
   * this tree as their working directory, and a file they wrote there is the
   * executor boundary having failed. The stage names it and refuses; it never
   * resets and continues, because that would destroy the evidence.
   */
  const worktreeClean = (
    cwd: string
  ): { ok: true } | { ok: false; entries: string[]; detail?: string } => {
    const status = runGit(
      ["status", "--porcelain", "-z", "--untracked-files=all", "--ignored=matching"],
      cwd
    );
    if (!status.ok) {
      return { ok: false, entries: [], detail: status.detail };
    }
    const entries = status.stdout.split("\0").filter((e) => e !== "");
    return entries.length === 0 ? { ok: true } : { ok: false, entries };
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
  const existing = chain.find((s) => s.kind === "code_review");
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
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const profile = verified.profile;

  const resolvedModel = resolveStageModel(profile, "code_review");
  if (!resolvedModel.ok) {
    return { ok: false, reason: resolvedModel.reason };
  }
  if (requestedModel !== undefined && requestedModel !== resolvedModel.model) {
    return {
      ok: false,
      reason: `--model ${requestedModel} does not match the model frozen at run start (${resolvedModel.model}): config is frozen at run start`,
    };
  }
  const model = resolvedModel.model;

  // Hard rule 6 and section 11: the run executes against the executor it
  // froze, and a stage requiring a capability no frozen executor declares
  // fails at configuration time — before the stage row or any paid
  // invocation exists.
  const binding = requireFrozenBinding(profile, executor, "code_review");
  if (!binding.ok) {
    return { ok: false, reason: binding.reason };
  }

  // Section 20's run-duration ceiling, read from the profile frozen at run
  // start so the run is governed by the limit in force when it began.
  const ageSeconds = (Date.now() - Date.parse(run.created_at)) / 1000;
  if (ageSeconds > profile.policy.runDurationLimitSeconds) {
    return {
      ok: false,
      reason: `run ${runId} has exceeded the run-duration limit of ${profile.policy.runDurationLimitSeconds} seconds`,
    };
  }

  // The verification record, re-read and validated with the same field checks
  // `runDeliveryStage` applies — this stage reads the same handoff delivery
  // does, and a tolerance applied at one boundary and not its sibling is this
  // repository's recurring defect.
  const verificationRecordPath = join(rootDir, last.output_ref);
  let worktreePath: string;
  let verifiedCommit: string;
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
    verifiedCommit = parsed.verifiedCommit;
    patchBase = parsed.patchBase;
  } catch (err) {
    return {
      ok: false,
      reason: `run ${runId}'s verification record at ${last.output_ref} is invalid: ${(err as Error).message}`,
    };
  }

  // Verification completes its stage and appends its gate event as separate
  // writes, so a crash between them leaves a passed row whose outcome the
  // audit never recorded. Two paid reviewer dispatches must not be spent on
  // one. (One verification stage exists per run, so the action alone
  // identifies the event.)
  const verifiedEvent = store
    .getAuditEvents(runId)
    .filter((e) => e.action === "verification.gate.pass")
    .pop();
  if (!verifiedEvent) {
    return {
      ok: false,
      reason: `run ${runId}'s passed verification stage ${verificationStageId} has no verification.gate.pass audit event: the audit trail does not record the verification outcome — start a fresh run; the branch and evidence are retained`,
    };
  }

  // Only `spec_hash` is read here. The signed scope is delivery's concern:
  // this stage judges the change against the specification, not against the
  // declared-artifact list.
  const approval = store.getApproval(runId);
  if (!approval) {
    return { ok: false, reason: `run ${runId} has no recorded approval` };
  }

  // The approved specification and plan, re-verified against the signed spec
  // hash and the gated plan hash exactly as `runImplementationStage` verifies
  // them: "present and wrong" is a judgement against the specification, so a
  // spec or plan edited after its gate would have the panel judging the code
  // against content nobody approved.
  const planStage = chain.find((s) => s.kind === "plan_review");
  if (!planStage || !planStage.output_ref) {
    return {
      ok: false,
      reason: `run ${runId} has no passed plan_review stage with a plan to read`,
    };
  }
  let planContent: string;
  try {
    planContent = readFileSync(planStage.output_ref, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: `cannot read the approved plan ${planStage.output_ref}: ${(err as Error).message}`,
    };
  }
  const planHash = sha256Hex(normalizeText(planContent));
  const planGateEvent = store.query<{ summary: string }>(
    "SELECT summary FROM audit WHERE run_id = ? AND action = 'plan.gate.pass' ORDER BY id DESC LIMIT 1",
    [runId]
  )[0];
  if (!planGateEvent) {
    return {
      ok: false,
      reason: `run ${runId} has no plan.gate.pass audit event: the plan_review gate never recorded what it approved`,
    };
  }
  const gatedPlan = /planHash=([0-9a-f]{64}); planFor=([0-9a-f]{64})/.exec(planGateEvent.summary);
  if (!gatedPlan) {
    return {
      ok: false,
      reason: `run ${runId}'s plan.gate.pass event does not record a plan hash and plan_for`,
    };
  }
  if (gatedPlan[1] !== planHash) {
    return { ok: false, reason: `the plan has changed since review: gated ${gatedPlan[1]}, on disk ${planHash}` };
  }

  const approvalStage = chain.find((s) => s.kind === "awaiting_approval");
  if (!approvalStage || !approvalStage.output_ref) {
    return {
      ok: false,
      reason: `run ${runId} has no passed awaiting_approval stage with a spec to read`,
    };
  }
  let specContent: string;
  try {
    specContent = readFileSync(approvalStage.output_ref, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: `cannot read the approved spec ${approvalStage.output_ref}: ${(err as Error).message}`,
    };
  }
  const specHash = sha256Hex(normalizeText(specContent));
  if (approval.spec_hash !== specHash) {
    return {
      ok: false,
      reason: `the spec has changed since approval: signed ${approval.spec_hash}, on disk ${specHash}`,
    };
  }
  if (gatedPlan[2] !== specHash) {
    return {
      ok: false,
      reason: `the spec does not match the plan the gate approved: planFor ${gatedPlan[2]}, on disk ${specHash}`,
    };
  }

  // Section 4 makes the branch the deliverable, so the stage proves it is
  // about to review exactly what verification proved.
  if (!existsSync(worktreePath)) {
    return { ok: false, reason: `the worktree for run ${runId} is missing at ${worktreePath}` };
  }
  const headAtEntry = runGit(["rev-parse", "HEAD"], worktreePath);
  if (!headAtEntry.ok) {
    return { ok: false, reason: `cannot read the worktree head at ${worktreePath}: ${headAtEntry.detail}` };
  }
  if (headAtEntry.stdout.trim() !== verifiedCommit) {
    return {
      ok: false,
      reason: `the worktree is at ${headAtEntry.stdout.trim()}, not the verified commit ${verifiedCommit}`,
    };
  }
  const cleanAtEntry = worktreeClean(worktreePath);
  if (!cleanAtEntry.ok) {
    return {
      ok: false,
      reason:
        cleanAtEntry.detail !== undefined
          ? `cannot check worktree cleanliness before code review: ${cleanAtEntry.detail}`
          : `worktree is not clean before code review: ${cleanAtEntry.entries.join(", ")}`,
    };
  }

  // The same staffing question the profile freeze already answered, asked
  // again at this boundary because a tolerance applied at one boundary and
  // not its sibling is this repository's recurring defect — and because the
  // profile's frozen agent list, not the live registry, is what seats this
  // panel (hard rule 6).
  const panel = codeReviewPanel(profile.agents, executor.id);
  const shortfall = codeReviewStaffingShortfall(profile.agents, profile.policy.panelSizeMin, executor.id);
  if (shortfall !== null) {
    return { ok: false, reason: `run ${runId} cannot seat a code-review panel: ${shortfall}` };
  }
  for (const reviewer of panel) {
    if (!reviewer.outputs.includes("code-findings")) {
      return { ok: false, reason: `configured agent ${reviewer.id} does not allow code-findings output` };
    }
  }

  // The changed set and the diff. The reviewers cannot run git — the frozen
  // executor's tool inventory is Read, Glob, Grep — so what changed has to
  // reach them in the prompt.
  const namesOnly = runGit(["diff", "--name-only", "-z", patchBase, verifiedCommit], worktreePath);
  if (!namesOnly.ok) {
    return {
      ok: false,
      reason: `cannot read the changed paths for ${patchBase}..${verifiedCommit}: ${namesOnly.detail}`,
    };
  }
  const changedPaths = namesOnly.stdout.split("\0").filter((p) => p !== "");
  if (changedPaths.length === 0) {
    return {
      ok: false,
      reason: `run ${runId}'s verified range ${patchBase}..${verifiedCommit} changed no files: a passed verification over a range that changed nothing is a state no honest run reaches, and a review of nothing must not pass`,
    };
  }
  const diffText = runGit(["diff", "--no-color", patchBase, verifiedCommit], worktreePath);
  if (!diffText.ok) {
    return {
      ok: false,
      reason: `cannot read the diff for ${patchBase}..${verifiedCommit}: ${diffText.detail}`,
    };
  }
  const diff = diffText.stdout;

  const audit = (stageId: number | null, action: string, summary: string): void => {
    appendAudit(store, { runId, stageId, actor: "system", actorType: "cli", action, summary });
  };

  /** Every terminal failure inside the stage row lands the same way. */
  const abort = (stageId: number, action: string, reason: string): CodeReviewStageResult => {
    audit(stageId, action, reason);
    store.completeStage(stageId, "", "block");
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  };

  const evidenceDir = codeReviewEvidenceDir(rootDir, runId);
  let stageId: number | null = null;

  try {
    const stage = store.insertStage(runId, "code_review", last.id);
    stageId = stage.id;
    store.setStageStatus(stage.id, "in_progress");
    audit(
      stage.id,
      "code_review.stage.create",
      `created code_review stage ${stage.id} for worktree ${worktreePath} over ${patchBase}..${verifiedCommit}; panel=${panel
        .map((a) => a.id)
        .join("+")}`
    );

    // Which agent made which report. The report row stores the agent_run id,
    // and the record attributes each report to its reviewer by name.
    const agentByRun = new Map<number, string>();

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
          prompt: buildCodeReviewPrompt(
            reviewer,
            specContent,
            planContent,
            changedPaths,
            diff,
            verifiedCommit
          ),
          invocation: { cwd: worktreePath },
        },
        rootDir
      );
      if (!dispatch.ok) {
        return abort(stage.id, "code_review.reviewer.failed", dispatch.reason);
      }

      // A prompt is a request; the tree is checked (hazard 15). Re-read
      // immediately after the dispatch, before the result is parsed, so a
      // reviewer that wrote into the checkout is named rather than having its
      // findings recorded as though the boundary held.
      const headAfter = runGit(["rev-parse", "HEAD"], worktreePath);
      if (!headAfter.ok) {
        return abort(
          stage.id,
          "code_review.worktree.dirty",
          `the worktree head could not be re-read after ${reviewer.id}: ${headAfter.detail}`
        );
      }
      if (headAfter.stdout.trim() !== verifiedCommit) {
        return abort(
          stage.id,
          "code_review.worktree.dirty",
          `reviewer ${reviewer.id} moved the worktree head from ${verifiedCommit} to ${headAfter.stdout.trim()}`
        );
      }
      const cleanAfter = worktreeClean(worktreePath);
      if (!cleanAfter.ok) {
        return abort(
          stage.id,
          "code_review.worktree.dirty",
          cleanAfter.detail !== undefined
            ? `cannot check worktree cleanliness after ${reviewer.id}: ${cleanAfter.detail}`
            : `reviewer ${reviewer.id} left the worktree dirty in: ${cleanAfter.entries.join(", ")}`
        );
      }

      const body = extractJsonBody(dispatch.envelope.resultText);
      if (body.kind === "refused") {
        return abort(
          stage.id,
          "code_review.reviewer.failed",
          `reviewer ${reviewer.id} body refused: ${body.reason}`
        );
      }
      const result = validateAgentResult(reviewer.id, body.value);
      if (!result.ok) {
        return abort(
          stage.id,
          "code_review.reviewer.failed",
          `reviewer ${reviewer.id} result refused: ${result.reason}`
        );
      }
      if (result.value.status !== "proposed") {
        return abort(
          stage.id,
          "code_review.reviewer.failed",
          `reviewer ${reviewer.id} returned status ${result.value.status}, not proposed — a reviewer that cannot review must not pass the gate by absence`
        );
      }
      const content = result.value.proposedContentChanges as { findings?: unknown } | undefined;
      if (!Array.isArray(content?.findings)) {
        return abort(
          stage.id,
          "code_review.reviewer.failed",
          `reviewer ${reviewer.id} result is missing proposedContentChanges.findings`
        );
      }
      const reports = validateReviewerReports(content.findings, {
        agentId: reviewer.id,
        upstreamPrefix: upstreamPrefixFor("plan"),
      });
      if (!reports.ok) {
        return abort(
          stage.id,
          "code_review.reviewer.failed",
          `reviewer ${reviewer.id} result refused: ${reports.reason}`
        );
      }

      // The two checks the shared validator cannot make for this caller. It
      // accepts any non-empty `current_artifact` location and checks severity
      // against the live `SEVERITIES`; this stage needs the location to name a
      // changed path and the severity to be in the vocabulary the gate will
      // index.
      const badLocation = validateCodeReviewLocations(reports.value, changedPaths);
      if (badLocation !== null) {
        return abort(
          stage.id,
          "code_review.reviewer.failed",
          `reviewer ${reviewer.id} result refused: ${badLocation}`
        );
      }
      for (const report of reports.value) {
        if (!profile.policy.severities.includes(report.severity)) {
          return abort(
            stage.id,
            "code_review.reviewer.failed",
            `reviewer ${reviewer.id} result refused: severity ${JSON.stringify(report.severity)} is not in the frozen severities ${profile.policy.severities.join(", ")}`
          );
        }
      }

      agentByRun.set(dispatch.agentRunId, reviewer.id);
      for (const report of reports.value) {
        // Round is always 1: one panel, no second round, nothing to
        // deduplicate a later round against.
        const finding = store.upsertCanonicalFinding(stage.id, 1, report.intentKey, report.location);
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
          `recorded finding ${finding.id} at ${report.location} (${report.intentKey}), round 1, severity ${report.severity}, ${report.classification}`
        );
      }

      // One progress line per reviewer as it finishes: only the stage knows a
      // dispatch has completed before the run has, and printing the effective
      // panel is what makes the frozen configuration visible at the
      // operator's surface (hazard 12). stderr, so stdout stays exactly the
      // result path the CLI prints.
      process.stderr.write(
        `reviewed ${reviewer.id} (${reviewer.specialty ?? "general review"}): ${reports.value.length} finding(s) in ${Date.now() - startedAt}ms\n`
      );
    }

    // --- the gate, over the frozen threshold and the frozen order ---
    const canonical = store.getCanonicalFindings(stage.id);
    const withReports = canonical.map((finding) => ({
      finding,
      reports: store.getFindingReports(finding.id),
    }));
    const verdict = codeReviewGate(
      withReports,
      profile.policy.codeReviewBlockingSeverity,
      profile.policy.severities
    );
    const blocking = verdict.pass ? [] : verdict.blocking;

    const recordedFindings: RecordedFinding[] = withReports.map(({ finding, reports }) => ({
      id: finding.id,
      location: finding.location,
      intentKey: finding.intent_key,
      reports: reports.map((r) => ({
        agent: agentByRun.get(r.agent_run_id) ?? "unknown",
        severity: r.severity,
        classification: r.classification,
        subject: r.subject,
      })),
    }));

    // Every upstream finding becomes a non-binding blocking_dependency
    // proposal, whatever its severity — section 13's "somewhere to go" for a
    // concern no code change in this run can repair. The candidate is derived
    // from the finding, never a second model-returned field that could
    // disagree with the route. The proposal and its evidence are retained;
    // only a human promotes it or authorizes a spike, and a fresh run is the
    // repair.
    const proposals: RecordedProposal[] = [];
    const proposalParts: string[] = [];
    for (const entry of blocking) {
      if (entry.cause !== "upstream") continue;
      const reports = withReports.find((f) => f.finding.id === entry.findingId)?.reports ?? [];
      const upstreamReport = reports.find((r) => r.classification === "upstream")!;
      const reviewerId = agentByRun.get(upstreamReport.agent_run_id) ?? "unknown";
      const decisionKey = entry.location.slice(upstreamPrefixFor("plan").length);
      const title = upstreamReport.subject;
      const problem = `${upstreamReport.subject} Code reviewer ${reviewerId} classified this finding upstream at severity ${upstreamReport.severity}, naming the plan decision ${decisionKey}.`;
      const whyUpstream = `The approved plan (${planHash}) leaves decision ${decisionKey} unmade, so the change cannot be corrected in code within this run.`;
      const rationale = `code reviewer ${reviewerId} classified the finding upstream at severity ${upstreamReport.severity}`;
      const evidenceRef = writeProposalEvidence(rootDir, runId, {
        findingId: entry.findingId,
        candidate: { title, problem, whyUpstream },
        route: "blocking_dependency",
        rationale,
        // This stage changes no artifact, so both hashes are the plan's.
        artifactHashBefore: planHash,
        artifactHashAfter: planHash,
      });
      const identity = proposalIdentity(stage.id, title, problem, "blocking_dependency");
      const { proposal, created } = store.upsertProposal(
        {
          runId,
          stageId: stage.id,
          findingId: entry.findingId,
          title,
          problem,
          whyUpstream,
          route: "blocking_dependency",
          evidenceRef,
        },
        identity
      );
      audit(
        stage.id,
        "code_review.proposal.record",
        `proposal ${proposal.id} ${created ? "created" : "linked"}; finding=${entry.findingId}; route=blocking_dependency; severity=${upstreamReport.severity}; decision=${decisionKey}; planHash=${planHash}; evidence=${evidenceRef}`
      );
      proposals.push({
        proposalId: proposal.id,
        findingId: entry.findingId,
        route: "blocking_dependency",
        evidenceRef,
      });
      proposalParts.push(
        `${entry.findingId}:${proposal.id}:blocking_dependency:${created ? "created" : "linked"}`
      );
    }

    const outcome: "pass" | "block" = blocking.length === 0 ? "pass" : "block";
    const record: CodeReviewRecord = {
      runId,
      stageId: stage.id,
      worktreePath,
      patchBase,
      verifiedCommit,
      changedPaths,
      panel: panel.map((a) => a.id),
      blockingSeverity: profile.policy.codeReviewBlockingSeverity,
      severities: [...profile.policy.severities],
      findings: recordedFindings,
      blocking,
      proposals,
      outcome,
      createdAt: new Date().toISOString(),
    };
    mkdirSync(evidenceDir, { recursive: true });
    const recordPath = join(evidenceDir, "result.json");
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    writeFileSync(join(evidenceDir, "report.md"), buildReport(record));
    const resultRef = codeReviewEvidenceRef(runId, "result.json");

    const summaryHead = `over ${patchBase}..${verifiedCommit}; panel=${panel
      .map((a) => a.id)
      .join("+")}; findings=${recordedFindings.length}; blocking=${blocking.length}; threshold=${record.blockingSeverity}`;

    if (blocking.length > 0) {
      const named = blocking
        .map((b) => `finding=${b.findingId}; severity=${b.severity}; cause=${b.cause}; location=${b.location}`)
        .join("; ");
      const reason = `code_review blocked: finding id(s) ${blocking
        .map((b) => `${b.findingId} (${b.severity}, ${b.cause}, ${b.location})`)
        .join(", ")}; threshold ${record.blockingSeverity}`;
      // The record is the evidence and survives, as verification's does.
      store.completeStage(stage.id, resultRef, "block");
      store.setRunStatus(runId, "blocked");
      audit(
        stage.id,
        "code_review.gate.block",
        `code_review gate blocked ${summaryHead}; ${named}; proposals=${proposalParts.join(",") || "none"}`
      );
      return { ok: false, reason };
    }

    store.completeStage(stage.id, resultRef, "pass");
    audit(stage.id, "code_review.gate.pass", `code_review gate passed ${summaryHead}`);
    return { ok: true, stageId: stage.id, resultRef };
  } catch (err) {
    // The wedge guard: an unexpected throw must produce the same terminal
    // state as any other failure.
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

/**
 * The human-readable report, written beside the record rather than instead of
 * it: an operator reads this, and `delivery_check` reads `result.json`.
 */
function buildReport(record: CodeReviewRecord): string {
  const lines = [
    `# Code review report: run ${record.runId}`,
    "",
    `**Outcome:** ${record.outcome}`,
    "",
    `**Worktree:** ${record.worktreePath}`,
    "",
    `**Range:** ${record.patchBase}..${record.verifiedCommit}`,
    "",
    `**Panel:** ${record.panel.join(", ")} — separately dispatched and recorded as \`configured_standalone\``,
    "",
    `**Blocking severity:** ${record.blockingSeverity} (frozen order: ${record.severities.join(", ")})`,
    "",
    "## Findings",
    "",
  ];
  if (record.findings.length === 0) {
    lines.push("No reviewer reported a finding.");
  }
  for (const finding of record.findings) {
    lines.push(`### ${finding.location} (${finding.intentKey})`, "");
    for (const report of finding.reports) {
      lines.push(`- **${report.agent}** — ${report.severity}, ${report.classification} — ${report.subject}`);
    }
    lines.push("");
  }
  if (record.proposals.length > 0) {
    lines.push("## Proposals raised", "");
    for (const proposal of record.proposals) {
      lines.push(
        `- proposal ${proposal.proposalId} from finding ${proposal.findingId} (${proposal.route}) — evidence at \`${proposal.evidenceRef}\``
      );
    }
    lines.push("");
  }
  if (record.outcome === "block") {
    lines.push("## Blocked", "");
    for (const entry of record.blocking) {
      lines.push(`- finding ${entry.findingId} — ${entry.severity}, ${entry.cause} — ${entry.location}`);
    }
    lines.push(
      "",
      "No remediation round, re-review, or operator waiver exists: the run is terminal and a fresh run is the repair (architecture section 12)."
    );
  }
  return `${lines.join("\n")}\n`;
}
