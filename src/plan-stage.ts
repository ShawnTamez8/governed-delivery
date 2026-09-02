import { readFileSync } from "node:fs";
import type { ExecutorDefinition } from "./executor.ts";
import { requireRunInProgress, type CanonicalFindingRow, type Store } from "./store.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { dispatchOnce } from "./dispatch.ts";
import type { AgentDefinition } from "./agents.ts";
import { validateAgentResult } from "./agent-result.ts";
import { extractJsonBody } from "./parse-output.ts";
import { findingIdentity } from "./finding.ts";
import { computeRisk, selectReviewers, staffingShortfall, validatePanelRequest } from "./select.ts";
import { computeScope, touchesProtected } from "./scope.ts";
import {
  buildPlanAuthorPrompt,
  buildPlanReconcilePrompt,
  buildPlanReviewPrompt,
  buildPlanSelfCritiquePrompt,
  type ReconciliationFindingInput,
} from "./prompts.ts";
import { validatePlanDoc, writePlanDoc, type PlanDoc } from "./plan-doc.ts";
import { coverageFitsScope, coverageMeetsCriteria, planReviewGate } from "./plan-gate.ts";
import { validateSpecDoc } from "./spec-doc.ts";
import {
  planNormativeNodes,
  upstreamPrefixFor,
  validateReconciliation,
  validateReviewerReports,
} from "./reconciliation.ts";
import { validateSelfCritique } from "./self-critique.ts";
import { deriveRoute, proposalIdentity, writeProposalEvidence } from "./proposal.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";

export type PlanStageResult =
  | { ok: true; stageIds: { plan: number; planReview: number }; planPath: string }
  | { ok: false; reason: string };

/**
 * The plan and plan_review stages, as two rows continuing section 5's chain
 * from the approved `awaiting_approval` row.
 *
 * **On the duplication with `src/spec-stage.ts`.** The two orchestrators have
 * the same shape: author dispatch, envelope validation, content write, the
 * author's self-critique phase and the re-gating of what it returns, panel
 * selection, findings, deterministic gate, bounded closure rounds. That is
 * deliberate and is not an oversight to be filed in review. Hard rule 4
 * forbids an abstraction before two real implementations exist, and this is
 * the moment the second one appears. Extracting the shared shape is a
 * decision for the step that has both in hand and can see which parts
 * actually generalize — the differences (a coverage gate with no spec
 * analogue, a different precondition chain, a document schema that binds to
 * an upstream hash) are exactly what a premature interface would have had to
 * guess at.
 *
 * Every failure path is terminal, matching `runSpecStage`: the affected stage
 * completes blocked with no approved `output_ref`, the run blocks, an audit
 * event names the reason, and `dispatchOnce` has already retained the raw
 * output. An unexpected throw lands in the same terminal machinery, so no run
 * is left wedged.
 */
export async function runPlanStage(
  store: Store,
  executor: ExecutorDefinition,
  input: { runId: number; requestedModel?: string; rootDir: string },
  // A test seam, and the only one: the seeded registry seats more distinct
  // specialties than the frozen floor asks for, so the short-panel refusal is
  // unreachable with real agents and the guard could otherwise never be proven
  // by breaking it. Callers pass nothing; tests pass a panel of any size.
  // Candidates travel in because the panel must come from the frozen
  // profile's agents (hard rule 6).
  deps: {
    selectPanel?: (
      candidates: readonly AgentDefinition[],
      size: number,
      requiredSpecialties: string[],
      requestedSpecialties: readonly string[]
    ) => AgentDefinition[];
  } = {}
): Promise<PlanStageResult> {
  const { runId, requestedModel, rootDir } = input;
  const selectPanel = deps.selectPanel ?? selectReviewers;
  const run = store.getRun(runId);
  if (!run) {
    return { ok: false, reason: `run ${runId} does not exist` };
  }
  const blocked = requireRunInProgress(run);
  if (blocked !== null) {
    return { ok: false, reason: blocked };
  }

  const chain = store.getStageChain(runId);
  if (chain.some((s) => s.kind === "plan")) {
    const existing = chain.find((s) => s.kind === "plan")!;
    return {
      ok: false,
      reason: `run ${runId} already has a plan stage with status ${existing.status}`,
    };
  }
  const last = chain[chain.length - 1];
  if (!last) {
    return { ok: false, reason: `run ${runId} has no approved awaiting_approval stage to plan from` };
  }
  if (last.kind !== "awaiting_approval" || last.status !== "passed" || !last.output_ref) {
    return {
      ok: false,
      reason: `run ${runId}'s last stage is ${last.kind} (${last.status}), not a passed awaiting_approval`,
    };
  }

  // Section 10: the model comes from the profile frozen at run start, and an
  // unmapped stage kind fails here rather than after a spawn has spent.
  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const profile = verified.profile;
  const resolvedModel = resolveStageModel(profile, "plan");
  if (!resolvedModel.ok) {
    return { ok: false, reason: resolvedModel.reason };
  }
  // The review panel is a different stage kind and resolves its own entry.
  // Reusing the author's model would leave the `plan_review` entry never
  // consulted here while `bw dispatch` — which resolves by `stage.kind` —
  // enforced it, so the two surfaces would disagree about one stage the
  // moment the values stopped coinciding.
  const resolvedReviewModel = resolveStageModel(profile, "plan_review");
  if (!resolvedReviewModel.ok) {
    return { ok: false, reason: resolvedReviewModel.reason };
  }
  if (requestedModel !== undefined && requestedModel !== resolvedModel.model) {
    return {
      ok: false,
      reason: `--model ${requestedModel} does not match the model frozen at run start (${resolvedModel.model}): config is frozen at run start`,
    };
  }
  const model = resolvedModel.model;
  const reviewModel = resolvedReviewModel.model;
  // Hard rule 6 and section 11: the run executes against the executor it
  // froze, and a stage requiring a capability no frozen executor declares
  // fails at configuration time — before any stage row or paid invocation.
  // This stage dispatches under two stage kinds, so both required
  // capabilities are checked here, mirroring the two model resolutions.
  const binding = requireFrozenBinding(profile, executor, "plan");
  if (!binding.ok) {
    return { ok: false, reason: binding.reason };
  }
  const reviewBinding = requireFrozenBinding(profile, executor, "plan_review");
  if (!reviewBinding.ok) {
    return { ok: false, reason: reviewBinding.reason };
  }

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
    return { ok: false, reason: `run ${runId}'s approved scope is unreadable: ${(err as Error).message}` };
  }

  const specPath = last.output_ref;
  let specContent: string;
  try {
    specContent = readFileSync(specPath, "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read approved spec ${specPath}: ${(err as Error).message}` };
  }

  // The binding chain's newest link. The panel gated a specification, the
  // operator signed that specification, and this stage is the first consumer
  // to read the file afterwards. Provenance is not enough: the file can be
  // edited after approval, and a plan built from an edited spec would carry a
  // signature that never authorized it. Re-verified before anything can be
  // dispatched, with the approval gate's own wording so one defect reads the
  // same wherever it surfaces.
  const specHash = sha256Hex(normalizeText(specContent));
  const gateEvent = store.query<{ summary: string }>(
    "SELECT summary FROM audit WHERE run_id = ? AND action = 'spec.gate.pass' ORDER BY id DESC LIMIT 1",
    [runId]
  )[0];
  if (!gateEvent) {
    return {
      ok: false,
      reason: `run ${runId} has no spec.gate.pass audit event: the spec_review gate never recorded what it approved`,
    };
  }
  const gated = /specHash=([0-9a-f]{64}); risk=(low|standard|high)/.exec(gateEvent.summary);
  if (!gated) {
    return { ok: false, reason: `run ${runId}'s spec.gate.pass event does not record a spec hash and risk` };
  }
  if (gated[1] !== specHash) {
    return { ok: false, reason: `the spec has changed since review: gated ${gated[1]}, on disk ${specHash}` };
  }

  // The panel is sized from the same inputs the approval bound, so the plan
  // panel and the spec panel are sized on the same basis.
  const specDoc = validateSpecDoc(specContent);
  if (!specDoc.ok) {
    return { ok: false, reason: `the approved spec ${specPath} no longer validates: ${specDoc.reason}` };
  }

  const audit = (stageId: number | null, action: string, summary: string): void => {
    appendAudit(store, { runId, stageId, actor: "system", actorType: "cli", action, summary });
  };
  // The author comes from the frozen profile, not the live registry, and is
  // bound to the executor the run froze (section 9: a field that nothing
  // enforces does not belong here).
  const author = profile.agents.find((a) => a.id === "plan-author");
  if (!author) {
    return { ok: false, reason: "configured agent plan-author is not in the frozen profile" };
  }
  if (author.executor !== executor.id) {
    return {
      ok: false,
      reason: `agent ${author.id} is bound to executor ${author.executor}, not the frozen executor ${executor.id}`,
    };
  }

  let planStageId: number | null = null;
  let reviewStageId: number | null = null;

  const abort = (stageId: number, action: string, reason: string): PlanStageResult => {
    audit(stageId, action, reason);
    store.completeStage(stageId, "", "block");
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  };

  try {
    // --- plan stage: author, validation, content write, coverage gate ---
    const planStage = store.insertStage(runId, "plan", last.id);
    planStageId = planStage.id;
    audit(planStage.id, "plan.stage.create", `created plan stage ${planStage.id}`);
    if (!author.outputs.includes("plan")) {
      return abort(planStage.id, "plan.author.failed", `configured agent ${author.id} does not allow plan output`);
    }
    // Checked beside the draft's own capability, not beside the dispatch it
    // guards. A run whose frozen author cannot self-critique can never
    // complete this stage, and the rule every other capability check in this
    // file follows is that a configuration failure fails before a paid
    // invocation rather than after one.
    if (!author.outputs.includes("plan-self-critique")) {
      return abort(
        planStage.id,
        "plan.selfcritique.failed",
        `configured agent ${author.id} does not allow plan-self-critique output`
      );
    }
    if (!author.outputs.includes("plan-reconciliation")) {
      return abort(
        planStage.id,
        "plan.reconcile.failed",
        `configured agent ${author.id} does not allow plan-reconciliation output`
      );
    }
    const authorDispatch = await dispatchOnce(
      store,
      executor,
      {
        stageId: planStage.id,
        agent: author.id,
        role: "author",
        requestedModel: model,
        prompt: buildPlanAuthorPrompt(author, specContent, specHash, scope),
      },
      rootDir
    );
    if (!authorDispatch.ok) {
      return abort(planStage.id, "plan.author.failed", authorDispatch.reason);
    }
    const authorBody = extractJsonBody(authorDispatch.envelope.resultText);
    if (authorBody.kind === "refused") {
      return abort(planStage.id, "plan.content.invalid", `plan author body refused: ${authorBody.reason}`);
    }
    const authorResult = validateAgentResult(author.id, authorBody.value);
    if (!authorResult.ok) {
      return abort(planStage.id, "plan.content.invalid", `plan author result refused: ${authorResult.reason}`);
    }
    if (authorResult.value.status !== "proposed") {
      return abort(
        planStage.id,
        "plan.author.failed",
        `plan author returned status ${authorResult.value.status}, not proposed`
      );
    }
    const authorContent = authorResult.value.proposedContentChanges as { plan?: unknown } | undefined;
    if (typeof authorContent?.plan !== "string") {
      return abort(planStage.id, "plan.content.invalid", "plan author result is missing proposedContentChanges.plan");
    }
    let planContent = authorContent.plan;
    let written: { path: string; doc: PlanDoc };
    try {
      written = writePlanDoc(rootDir, run.slug, planContent);
    } catch (err) {
      return abort(planStage.id, "plan.content.invalid", (err as Error).message);
    }
    let planPath = written.path;
    const planForCheck = (doc: PlanDoc, stageId: number): PlanStageResult | null =>
      doc.planFor === specHash
        ? null
        : abort(
            stageId,
            "plan.content.invalid",
            `plan_for ${doc.planFor} does not match the approved spec hash ${specHash}: the plan was written from a different specification`
          );
    const mismatched = planForCheck(written.doc, planStage.id);
    if (mismatched) return mismatched;
    audit(planStage.id, "plan.content.write", `wrote ${planPath}`);

    // The coverage gate runs here, before the panel: it is deterministic and
    // free, so refusing a plan that promises out-of-scope artifacts saves a
    // full panel's invocations on a plan that could never pass.
    const coverage = coverageFitsScope(written.doc, scope);
    if (!coverage.ok) {
      // The audit event carries the criteria names, not just a count — the
      // reason string is the operator's only diagnosable record of what the
      // plan promised that nobody approved.
      return abort(
        planStage.id,
        "plan.coverage.unkeepable",
        `plan promises coverage outside the approved scope: ${coverage.unkeepable.join("; ")}`
      );
    }
    const complete = coverageMeetsCriteria(written.doc, specDoc.value.acceptanceCriteria);
    if (!complete.ok) {
      return abort(
        planStage.id,
        "plan.coverage.incomplete",
        `plan does not cover every acceptance criterion: ${complete.uncovered.join("; ")}`
      );
    }

    // --- self-critique: the author's own pass, before any reviewer sees it ---
    // One dispatch per artifact, under the author's frozen definition and the
    // author's model mapping, recorded as its own agent_run. It is never a
    // panel seat and never contributes to an independence claim (hazard 14).
    // The lenses the frozen registry can actually seat on the frozen
    // executor, which is what the prompt names. The Task 1 prototype recorded
    // an author asking for an unstaffable specialty when it was not told.
    const registeredSpecialties = [
      ...new Set(
        profile.agents
          .filter(
            (a) => a.role === "reviewer" && a.outputs.includes("findings") && a.executor === executor.id
          )
          .map((a) => a.specialty)
          .filter((s): s is string => s !== null)
      ),
    ].sort();
    const critiqueDispatch = await dispatchOnce(
      store,
      executor,
      {
        stageId: planStage.id,
        agent: author.id,
        role: "author",
        requestedModel: model,
        prompt: buildPlanSelfCritiquePrompt(
          author,
          specContent,
          planContent,
          specHash,
          scope,
          {
            sizeMin: profile.policy.panelSizeMin,
            sizeMax: profile.policy.panelSizeMax,
            requiredSpecialties: profile.policy.requiredSpecialties,
            registeredSpecialties,
          }
        ),
      },
      rootDir
    );
    if (!critiqueDispatch.ok) {
      return abort(planStage.id, "plan.selfcritique.failed", critiqueDispatch.reason);
    }
    const critiqueBody = extractJsonBody(critiqueDispatch.envelope.resultText);
    if (critiqueBody.kind === "refused") {
      return abort(planStage.id, "plan.selfcritique.invalid", `plan self-critique body refused: ${critiqueBody.reason}`);
    }
    const critiqueResult = validateAgentResult(author.id, critiqueBody.value);
    if (!critiqueResult.ok) {
      return abort(planStage.id, "plan.selfcritique.invalid", `plan self-critique result refused: ${critiqueResult.reason}`);
    }
    if (critiqueResult.value.status !== "proposed") {
      return abort(
        planStage.id,
        "plan.selfcritique.failed",
        `plan author returned status ${critiqueResult.value.status}, not proposed`
      );
    }
    const critiqueContent = critiqueResult.value.proposedContentChanges as
      | { selfCritique?: unknown }
      | undefined;
    const critique = validateSelfCritique(critiqueContent?.selfCritique);
    if (!critique.ok) {
      return abort(planStage.id, "plan.selfcritique.invalid", `plan self-critique refused: ${critique.reason}`);
    }
    // Every mechanical gate the draft passed runs again on the revised plan,
    // on the parsed candidate and before it can replace the document on disk.
    // A self-critique that produces an invalid plan blocks the stage: it
    // never falls back to the draft, because a silent fallback would make the
    // phase optional in exactly the runs where it went wrong.
    const critiqueParsed = validatePlanDoc(critique.value.artifact);
    if (!critiqueParsed.ok) {
      return abort(
        planStage.id,
        "plan.selfcritique.invalid",
        `plan self-critique document refused: ${critiqueParsed.reason}`
      );
    }
    const critiqueMismatch = planForCheck(critiqueParsed.value, planStage.id);
    if (critiqueMismatch) return critiqueMismatch;
    const critiqueCoverage = coverageFitsScope(critiqueParsed.value, scope);
    if (!critiqueCoverage.ok) {
      return abort(
        planStage.id,
        "plan.coverage.unkeepable",
        `plan promises coverage outside the approved scope: ${critiqueCoverage.unkeepable.join("; ")}`
      );
    }
    const critiqueComplete = coverageMeetsCriteria(critiqueParsed.value, specDoc.value.acceptanceCriteria);
    if (!critiqueComplete.ok) {
      return abort(
        planStage.id,
        "plan.coverage.incomplete",
        `plan does not cover every acceptance criterion: ${critiqueComplete.uncovered.join("; ")}`
      );
    }
    try {
      written = writePlanDoc(rootDir, run.slug, critique.value.artifact);
    } catch (err) {
      return abort(planStage.id, "plan.selfcritique.invalid", (err as Error).message);
    }
    planContent = critique.value.artifact;
    planPath = written.path;
    audit(planStage.id, "plan.content.write", `wrote self-critique revision ${planPath}`);
    // Recorded before it is acted on, so the request the author made survives
    // in the audit trail whether or not the panel it asked for could be
    // staffed.
    audit(
      planStage.id,
      "plan.selfcritique.record",
      `plan self-critique returned ${critique.value.critique.length} critique entries; panel request size ${critique.value.panelRequest.size}, specialties [${critique.value.panelRequest.specialties.join(", ")}]`
    );
    store.completeStage(planStage.id, planPath, "pass");

    // --- plan_review stage: panel, findings, gate, closure ---
    const reviewStage = store.insertStage(runId, "plan_review", planStage.id);
    reviewStageId = reviewStage.id;
    audit(reviewStage.id, "plan_review.stage.create", `created plan_review stage ${reviewStage.id}`);
    const risk = computeRisk(
      run.change_kind,
      computeScope(specDoc.value.declaredArtifacts).length,
      touchesProtected(specDoc.value.declaredArtifacts, run.slug)
    );
    // Active review configuration comes from the profile frozen at run start.
    // The new round budget is frozen but stays inactive until Task 9 can give
    // it its promised panel-and-reconciliation meaning. Risk still binds the
    // approval; it no longer sizes the panel — the author does, within the
    // bounds this run froze.
    const requested = validatePanelRequest(
      critique.value.panelRequest,
      profile.policy.panelSizeMin,
      profile.policy.panelSizeMax,
      profile.policy.requiredSpecialties
    );
    if (!requested.ok) {
      return abort(reviewStage.id, "plan.panel.invalid", `plan panel request refused: ${requested.reason}`);
    }
    const panelSize = requested.value.size;
    const candidates = profile.agents.filter((agent) => agent.executor === executor.id);
    // Refused before selection, not after: the ranked fill would happily seat
    // a different lens in place of one the registry cannot staff, and the
    // panel would come out the right size with the wrong composition. The
    // length check below cannot see that — only this can.
    const shortfall = staffingShortfall(
      candidates,
      panelSize,
      profile.policy.requiredSpecialties,
      requested.value.specialties,
      executor.id
    );
    if (shortfall !== null) {
      return abort(
        reviewStage.id,
        "plan.panel.unstaffable",
        `plan panel cannot be staffed: ${shortfall}`
      );
    }
    const panel = selectPanel(
      candidates,
      panelSize,
      profile.policy.requiredSpecialties,
      requested.value.specialties
    );
    if (panel.length < panelSize) {
      return abort(
        reviewStage.id,
        "plan.panel.incomplete",
        `plan panel incomplete: needs ${panelSize} reviewers, found ${panel.length}`
      );
    }
    for (const reviewer of panel) {
      if (reviewer.executor !== executor.id) {
        return abort(
          reviewStage.id,
          "plan.reviewer.failed",
          `agent ${reviewer.id} is bound to executor ${reviewer.executor}, not the frozen executor ${executor.id}`
        );
      }
    }

    // The configured round count (section 12, as amended 2026-09-01): one
    // complete panel -> reconciliation cycle per round, gated once over every
    // round's decisions after the loop — not a closure budget with an early
    // exit on the first clean pass.
    const rounds: number = profile.policy.planReviewRounds;
    for (let round = 1; round <= rounds; round++) {
      // This round's reports, keyed by canonical identity, in panel order.
      // They travel to the reconciler unfused: two reviewers reporting one
      // identity are two immutable reports on one canonical finding, each
      // keeping its own severity and classification (section 13's no-fusion
      // rule). The canonical row itself is looked up fresh every round
      // because identity is round-scoped (section 8): the same location and
      // intentKey in a later round is a different row, never a resolution of
      // the earlier one.
      const roundReports = new Map<string, ReconciliationFindingInput["reports"]>();
      const roundFindings = new Map<string, CanonicalFindingRow>();
      for (const reviewer of panel) {
        if (!reviewer.outputs.includes("findings")) {
          return abort(reviewStage.id, "plan.reviewer.failed", `configured agent ${reviewer.id} does not allow findings output`);
        }
        const dispatch = await dispatchOnce(
          store,
          executor,
          {
            stageId: reviewStage.id,
            agent: reviewer.id,
            role: "reviewer",
            requestedModel: reviewModel,
            prompt: buildPlanReviewPrompt(reviewer, planContent, specContent),
          },
          rootDir
        );
        if (!dispatch.ok) {
          return abort(reviewStage.id, "plan.reviewer.failed", dispatch.reason);
        }
        const reviewerBody = extractJsonBody(dispatch.envelope.resultText);
        if (reviewerBody.kind === "refused") {
          return abort(reviewStage.id, "plan.reviewer.failed", `reviewer ${reviewer.id} body refused: ${reviewerBody.reason}`);
        }
        const reviewerResult = validateAgentResult(reviewer.id, reviewerBody.value);
        if (!reviewerResult.ok) {
          return abort(reviewStage.id, "plan.reviewer.failed", `reviewer ${reviewer.id} result refused: ${reviewerResult.reason}`);
        }
        if (reviewerResult.value.status !== "proposed") {
          return abort(
            reviewStage.id,
            "plan.reviewer.failed",
            `reviewer ${reviewer.id} returned status ${reviewerResult.value.status}, not proposed — a reviewer that cannot review must not pass the gate by absence`
          );
        }
        const reviewerContent = reviewerResult.value.proposedContentChanges as { findings?: unknown } | undefined;
        if (!Array.isArray(reviewerContent?.findings)) {
          return abort(
            reviewStage.id,
            "plan.reviewer.failed",
            `reviewer ${reviewer.id} result is missing proposedContentChanges.findings`
          );
        }
        const reports = validateReviewerReports(reviewerContent.findings, {
          agentId: reviewer.id,
          upstreamPrefix: upstreamPrefixFor("specification"),
        });
        if (!reports.ok) {
          return abort(reviewStage.id, "plan.reviewer.failed", `reviewer ${reviewer.id} result refused: ${reports.reason}`);
        }
        for (const report of reports.value) {
          // The validator normalizes the location: identity derives from the
          // normalized form (section 8), so the canonical row and the
          // reconciliation input key on the same string.
          const finding = store.upsertCanonicalFinding(reviewStage.id, round, report.intentKey, report.location);
          store.insertFindingReport({
            findingId: finding.id,
            agentRunId: dispatch.agentRunId,
            severity: report.severity,
            classification: report.classification,
            subject: report.subject,
          });
          audit(
            reviewStage.id,
            "plan.finding.record",
            `recorded finding ${finding.id} at ${report.location} (${report.intentKey}), round ${round}`
          );
          const identity = findingIdentity(report.location, report.intentKey);
          roundFindings.set(identity, finding);
          const list = roundReports.get(identity) ?? [];
          list.push({
            reviewerId: reviewer.id,
            severity: report.severity,
            classification: report.classification,
            location: report.location,
            intentKey: report.intentKey,
            subject: report.subject,
          });
          roundReports.set(identity, list);
        }
      }
      // --- reconciliation: the author's typed answer to this round's findings ---
      // The phase order (section 12) is panel, then reconciliation, then the
      // gate, once per round — dispatched even over an empty round, because
      // the reconciler is the actor that confirms an empty findings set.
      const reconcileFindings: ReconciliationFindingInput[] = [...roundReports.entries()].map(
        ([identity, reports]) => ({ findingId: roundFindings.get(identity)!.id, reports })
      );
      const beforeContent = planContent;
      const reconcileDispatch = await dispatchOnce(
        store,
        executor,
        {
          stageId: planStage.id,
          agent: author.id,
          role: "author",
          requestedModel: model,
          prompt: buildPlanReconcilePrompt(author, specContent, planContent, specHash, scope, reconcileFindings),
        },
        rootDir
      );
      if (!reconcileDispatch.ok) {
        return abort(reviewStage.id, "plan.reconcile.failed", reconcileDispatch.reason);
      }
      const reconcileBody = extractJsonBody(reconcileDispatch.envelope.resultText);
      if (reconcileBody.kind === "refused") {
        return abort(reviewStage.id, "plan.reconcile.invalid", `reconciliation body refused: ${reconcileBody.reason}`);
      }
      const reconcileResult = validateAgentResult(author.id, reconcileBody.value);
      if (!reconcileResult.ok) {
        return abort(reviewStage.id, "plan.reconcile.invalid", `reconciliation result refused: ${reconcileResult.reason}`);
      }
      if (reconcileResult.value.status !== "proposed") {
        return abort(
          reviewStage.id,
          "plan.reconcile.failed",
          `plan author returned status ${reconcileResult.value.status}, not proposed`
        );
      }
      const reconcileContent = reconcileResult.value.proposedContentChanges as
        | { plan?: unknown; decisions?: unknown }
        | undefined;
      if (typeof reconcileContent?.plan !== "string") {
        return abort(reviewStage.id, "plan.reconcile.invalid", "reconciliation result is missing proposedContentChanges.plan");
      }
      // The reconciled plan is checked *before* it overwrites the gated
      // document, on the parsed candidate — a plan that fails any binding
      // must never replace the one the gate approved on disk, which is the
      // same rule the legacy revision path followed.
      const reconciledParsed = validatePlanDoc(reconcileContent.plan);
      if (!reconciledParsed.ok) {
        return abort(reviewStage.id, "plan.reconcile.invalid", `plan reconciliation document refused: ${reconciledParsed.reason}`);
      }
      const reconciledDoc = reconciledParsed.value;
      const reconcileMismatch = planForCheck(reconciledDoc, reviewStage.id);
      if (reconcileMismatch) return reconcileMismatch;
      const reconcileCoverage = coverageFitsScope(reconciledDoc, scope);
      if (!reconcileCoverage.ok) {
        return abort(
          reviewStage.id,
          "plan.coverage.unkeepable",
          `plan promises coverage outside the approved scope: ${reconcileCoverage.unkeepable.join("; ")}`
        );
      }
      const reconcileComplete = coverageMeetsCriteria(reconciledDoc, specDoc.value.acceptanceCriteria);
      if (!reconcileComplete.ok) {
        return abort(
          reviewStage.id,
          "plan.coverage.incomplete",
          `plan does not cover every acceptance criterion: ${reconcileComplete.uncovered.join("; ")}`
        );
      }
      const reconciliation = validateReconciliation(reconcileContent.decisions, {
        canonicalFindingIds: reconcileFindings.map((f) => f.findingId),
        governingSource: "specification",
        governingText: specContent,
        beforeNormativeNodes: planNormativeNodes(written.doc),
        afterNormativeNodes: planNormativeNodes(reconciledDoc),
      });
      if (!reconciliation.ok) {
        return abort(reviewStage.id, "plan.reconcile.invalid", `plan reconciliation refused: ${reconciliation.reason}`);
      }
      // An added normative node no decision claimed. Two different situations
      // raise this same signal, and only one of them has nothing to record.
      //
      // A deterministic content check that converted a decision drops that
      // decision's claims — `src/reconciliation.ts`: "a converted decision
      // drops its entries, so its nodes surface as unclaimed" — while the
      // decision itself survives as `cannot_determine`. There *is* an owning
      // decision there, and section 12 requires it to be stored and then
      // blocked by name at the gate. Aborting on the released node instead
      // would discard the typed answer, the conversion record, and the
      // canonical finding id, leaving the operator prose where the contract
      // promises a named finding.
      //
      // With no conversion, nothing owns the node: there is no decision row
      // for the gate to block on, so the round fails closed here.
      if (
        reconciliation.value.unclaimedNodes.length > 0 &&
        reconciliation.value.conversions.length === 0
      ) {
        return abort(
          reviewStage.id,
          "plan.reconcile.invalid",
          `plan reconciliation left normative node(s) unclaimed by any decision: ${reconciliation.value.unclaimedNodes.join(" | ")}`
        );
      }
      try {
        written = writePlanDoc(rootDir, run.slug, reconcileContent.plan);
      } catch (err) {
        return abort(reviewStage.id, "plan.reconcile.invalid", (err as Error).message);
      }
      planContent = reconcileContent.plan;
      planPath = written.path;
      audit(planStage.id, "plan.content.write", `wrote reconciliation revision ${planPath}`);
      const planHashBefore = sha256Hex(normalizeText(beforeContent));
      const planHashAfter = sha256Hex(normalizeText(planContent));
      // Persist each decision against its canonical finding (Task 7), and
      // every upstream candidate as a stored, non-binding proposal (Task 8).
      // One reconciling agent_run_id: every decision this round came from the
      // same reconciliation dispatch.
      const proposalParts: string[] = [];
      for (const decision of reconciliation.value.decisions) {
        store.insertFindingDecision({
          findingId: decision.findingId,
          agentRunId: reconcileDispatch.agentRunId,
          disposition: decision.disposition,
          rationale: decision.rationale,
          changedLocations: decision.changedLocations,
          grounding: decision.grounding,
          normativeChanges: decision.normativeChanges,
          artifactHashBefore: planHashBefore,
          artifactHashAfter: planHashAfter,
        });
        if (decision.disposition === "upstream_follow_up" || decision.disposition === "upstream_blocking") {
          const candidate = decision.proposal!;
          const route = deriveRoute(decision.disposition);
          const evidenceRef = writeProposalEvidence(rootDir, runId, {
            findingId: decision.findingId,
            candidate,
            route,
            rationale: decision.rationale,
            artifactHashBefore: planHashBefore,
            artifactHashAfter: planHashAfter,
          });
          const identity = proposalIdentity(reviewStage.id, candidate.title, candidate.problem, route);
          const { proposal, created } = store.upsertProposal(
            {
              runId,
              stageId: reviewStage.id,
              findingId: decision.findingId,
              title: candidate.title,
              problem: candidate.problem,
              whyUpstream: candidate.whyUpstream,
              route,
              evidenceRef,
            },
            identity
          );
          // Its own queryable event (Task 8 step 8), not just a field inside
          // the reconciliation summary: a later query has to find every
          // upstream block, and whether a candidate created a proposal or
          // linked to one already raised, without parsing prose. A valid hash
          // chain proves the events present were not altered — it cannot
          // prove a required event was ever emitted, so the event has to
          // exist in its own right.
          audit(
            reviewStage.id,
            "plan.proposal.record",
            `proposal ${proposal.id} ${created ? "created" : "linked"}; finding=${decision.findingId}; route=${route}; risk=${risk}; planHashBefore=${planHashBefore}; planHashAfter=${planHashAfter}; evidence=${evidenceRef}`
          );
          proposalParts.push(
            `${decision.findingId}:${proposal.id}:${route}:${created ? "created" : "linked"}`
          );
        }
      }
      // Machine-readable, in the shape the gate events use: the before and
      // after hashes are retained on the event itself, so the evidence
      // survives a later run overwriting the file (hazard 2).
      {
        const decisionParts = reconcileFindings.map((f) => {
          const decision = reconciliation.value.decisions.find((d) => d.findingId === f.findingId)!;
          return `d${f.findingId}=${decision.disposition}; loc${f.findingId}=${decision.changedLocations.join("+")}`;
        });
        const conversionParts = reconciliation.value.conversions
          .map((c) => `${c.findingId}:${c.from}->cannot_determine`)
          .join(",");
        audit(
          reviewStage.id,
          "plan.reconcile.record",
          `plan reconcile round ${round}: planHashBefore=${planHashBefore}; planHashAfter=${planHashAfter}; risk=${risk}; decisions=${reconciliation.value.decisions.length}; findings=${reconcileFindings.map((f) => f.findingId).join(",")}; ${decisionParts.join(" ")}; conversions=${conversionParts}; unclaimed=${reconciliation.value.unclaimedNodes.length}; proposals=${proposalParts.join(",")}`
        );
      }
    }

    // --- decision gate: over every round this stage ran, not the last one ---
    const decisions = store.getFindingDecisions(reviewStage.id);
    const gate = planReviewGate(decisions);
    if (gate.pass) {
      audit(
        reviewStage.id,
        "plan.gate.pass",
        // `planFor` is recorded for the same reason the spec event carries
        // `specHash`: a later stage must not have to trust an editable file
        // to learn which specification the passed plan was written from.
        `plan_review gate passed after ${rounds} round(s); planHash=${sha256Hex(normalizeText(planContent))}; planFor=${written.doc.planFor}; risk=${risk}`
      );
      store.completeStage(reviewStage.id, planPath, "pass");
      return { ok: true, stageIds: { plan: planStage.id, planReview: reviewStage.id }, planPath };
    }
    const proposalsByFinding = new Map<number, number[]>();
    for (const proposal of store.getProposalsForStage(reviewStage.id)) {
      for (const findingId of store.getProposalSources(proposal.id)) {
        const list = proposalsByFinding.get(findingId) ?? [];
        list.push(proposal.id);
        proposalsByFinding.set(findingId, list);
      }
    }
    const blockedNames = gate.blockedFindingIds
      .map((id) => {
        const proposals = proposalsByFinding.get(id);
        return proposals && proposals.length > 0 ? `${id} (proposal ${proposals.join("+")})` : `${id}`;
      })
      .join(", ");
    return abort(reviewStage.id, "plan.gate.block", `plan_review blocked: finding id(s) ${blockedNames}`);
  } catch (err) {
    // The wedge guard: an unexpected throw must produce the same terminal
    // state as any other failure.
    const reason = `plan stage failed: ${(err as Error).message}`;
    for (const id of [planStageId, reviewStageId]) {
      if (id !== null) {
        const stage = store.getStage(id);
        if (stage && (stage.status === "pending" || stage.status === "in_progress")) {
          store.completeStage(id, "", "block");
        }
      }
    }
    audit(reviewStageId ?? planStageId, "plan.stage.failed", reason);
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  }
}
