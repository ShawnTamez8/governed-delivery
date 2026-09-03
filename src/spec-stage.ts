import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutorDefinition } from "./executor.ts";
import { requireRunInProgress, type CanonicalFindingRow, type FindingDecisionRow, type Store } from "./store.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { dispatchOnce } from "./dispatch.ts";
import { validateAgentResult } from "./agent-result.ts";
import { extractJsonBody } from "./parse-output.ts";
import type { AgentDefinition } from "./agents.ts";
import { findingIdentity } from "./finding.ts";
import { computeRisk, selectReviewers, staffingShortfall, validatePanelRequest } from "./select.ts";
import { computeScope, touchesProtected } from "./scope.ts";
import {
  buildSpecAuthorPrompt,
  buildSpecReconcilePrompt,
  buildSpecReviewPrompt,
  buildSpecSelfCritiquePrompt,
  type ReconciliationFindingInput,
} from "./prompts.ts";
import { validateSpecDoc, writeSpecDoc, type SpecDoc } from "./spec-doc.ts";
import {
  specNormativeNodes,
  upstreamPrefixFor,
  validateReconciliation,
  validateReviewerReports,
} from "./reconciliation.ts";
import { validateSelfCritique } from "./self-critique.ts";
import { deriveRoute, proposalIdentity, writeProposalEvidence } from "./proposal.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { BLOCKING_DISPOSITIONS } from "./plan-gate.ts";

export type StageResult =
  | { ok: true; stageIds: { spec: number; specReview: number }; specPath: string }
  | { ok: false; reason: string };

/**
 * The deterministic decision gate (section 12, as amended for step 5b).
 * Identical in contract to `planReviewGate` — see that function's comment for
 * what "decision completeness" means and what it does not establish.
 */
export function specReviewGate(
  decisions: FindingDecisionRow[]
): { pass: true } | { pass: false; blockedFindingIds: number[] } {
  const blocked = decisions.filter((d) => BLOCKING_DISPOSITIONS.includes(d.disposition));
  return blocked.length === 0
    ? { pass: true }
    : { pass: false, blockedFindingIds: blocked.map((d) => d.finding_id) };
}

/**
 * The spec and spec-review stages, as two rows matching section 5's chain.
 * Every failure path is terminal: the affected stage completes blocked (with
 * no approved output_ref), the run blocks, and the reason returns — and an
 * unexpected throw is caught by the same terminal machinery, so no run is
 * ever left wedged.
 */
export async function runSpecStage(
  store: Store,
  executor: ExecutorDefinition,
  input: { runId: number; requestedModel?: string; rootDir: string },
  // A test seam, and the only one, mirroring `runPlanStage`'s: the seeded
  // registry seats more distinct specialties than any request a fixture can
  // honestly make short, so the short-panel refusal below is otherwise
  // unreachable and could never be proven by breaking it. Callers pass
  // nothing. Candidates travel in because the panel must come from the frozen
  // profile's agents (hard rule 6).
  deps: {
    selectPanel?: (
      candidates: readonly AgentDefinition[],
      size: number,
      requiredSpecialties: string[],
      requestedSpecialties: readonly string[]
    ) => AgentDefinition[];
  } = {}
): Promise<StageResult> {
  const { runId, requestedModel, rootDir } = input;
  const selectPanel = deps.selectPanel ?? selectReviewers;
  const run = store.getRun(runId);
  if (!run) {
    return { ok: false, reason: `run ${runId} does not exist` };
  }
  // Before the design document is read, and well before anything can spawn: a
  // run that is blocked or completed can never finish, so authoring against it
  // is spend with no possible outcome. This mirrors the ordering in `src/cli.ts`'s
  // dispatch case, where the state check precedes the prompt-file read.
  const blocked = requireRunInProgress(run);
  if (blocked !== null) {
    return { ok: false, reason: blocked };
  }
  // Section 10: the model is resolved from the profile frozen at run start,
  // and an unmapped stage kind fails here — at configuration time, before any
  // invocation — rather than after a spawn has already cost something.
  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) {
    return { ok: false, reason: verified.reason };
  }
  const profile = verified.profile;
  const resolvedModel = resolveStageModel(profile, "spec");
  if (!resolvedModel.ok) {
    return { ok: false, reason: resolvedModel.reason };
  }
  // The review panel is a different stage kind and resolves its own entry.
  // Reusing the author's model would leave the `spec_review` entry never
  // consulted here while `bw dispatch` — which resolves by `stage.kind` —
  // enforced it, so the two surfaces would disagree about one stage the
  // moment the values stopped coinciding.
  const resolvedReviewModel = resolveStageModel(profile, "spec_review");
  if (!resolvedReviewModel.ok) {
    return { ok: false, reason: resolvedReviewModel.reason };
  }
  // Hard rule 6: a flag that silently overrode the snapshot would make the
  // frozen profile a decoration. Supplying it is allowed; disagreeing is not.
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
  const binding = requireFrozenBinding(profile, executor, "spec");
  if (!binding.ok) {
    return { ok: false, reason: binding.reason };
  }
  const reviewBinding = requireFrozenBinding(profile, executor, "spec_review");
  if (!reviewBinding.ok) {
    return { ok: false, reason: reviewBinding.reason };
  }
  const existing = store.getStageChain(runId);
  if (existing.length > 0) {
    return {
      ok: false,
      reason: `run ${runId} already has stage ${existing[0].kind} with status ${existing[0].status}`,
    };
  }
  const designPath = join(rootDir, "docs", "features", run.slug, "design.md");
  let design: string;
  try {
    design = readFileSync(designPath, "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read design document ${designPath}: ${(err as Error).message}` };
  }

  const audit = (stageId: number | null, action: string, summary: string): void => {
    appendAudit(store, { runId, stageId, actor: "system", actorType: "cli", action, summary });
  };
  // The author comes from the frozen profile, not the live registry, and is
  // bound to the executor the run froze (section 9: a field that nothing
  // enforces does not belong here).
  const author = profile.agents.find((a) => a.id === "spec-author");
  if (!author) {
    return { ok: false, reason: "configured agent spec-author is not in the frozen profile" };
  }
  if (author.executor !== executor.id) {
    return {
      ok: false,
      reason: `agent ${author.id} is bound to executor ${author.executor}, not the frozen executor ${executor.id}`,
    };
  }

  let specStageId: number | null = null;
  let reviewStageId: number | null = null;

  const abort = (stageId: number, action: string, reason: string): StageResult => {
    audit(stageId, action, reason);
    store.completeStage(stageId, "", "block");
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  };

  try {
    // --- spec stage: author, validation, content write ---
    const specStage = store.insertStage(runId, "spec", null);
    specStageId = specStage.id;
    audit(specStage.id, "spec.stage.create", `created spec stage ${specStage.id}`);
    if (!author.outputs.includes("spec")) {
      return abort(specStage.id, "spec.author.failed", `configured agent ${author.id} does not allow spec output`);
    }
    // Checked beside the draft's own capability, not beside the dispatch it
    // guards. A run whose frozen author cannot self-critique can never
    // complete this stage, and the rule every other capability check in this
    // file follows is that a configuration failure fails before a paid
    // invocation rather than after one.
    if (!author.outputs.includes("spec-self-critique")) {
      return abort(
        specStage.id,
        "spec.selfcritique.failed",
        `configured agent ${author.id} does not allow spec-self-critique output`
      );
    }
    if (!author.outputs.includes("spec-reconciliation")) {
      return abort(
        specStage.id,
        "spec.reconcile.failed",
        `configured agent ${author.id} does not allow spec-reconciliation output`
      );
    }
    const authorDispatch = await dispatchOnce(
      store,
      executor,
      {
        stageId: specStage.id,
        agent: author.id,
        role: "author",
        requestedModel: model,
        prompt: buildSpecAuthorPrompt(author, design),
      },
      rootDir
    );
    if (!authorDispatch.ok) {
      return abort(specStage.id, "spec.author.failed", authorDispatch.reason);
    }
    const authorBody = extractJsonBody(authorDispatch.envelope.resultText);
    if (authorBody.kind === "refused") {
      return abort(specStage.id, "spec.content.invalid", `spec author body refused: ${authorBody.reason}`);
    }
    const authorResult = validateAgentResult(author.id, authorBody.value);
    if (!authorResult.ok) {
      return abort(specStage.id, "spec.content.invalid", `spec author result refused: ${authorResult.reason}`);
    }
    if (authorResult.value.status !== "proposed") {
      return abort(specStage.id, "spec.author.failed", `spec author returned status ${authorResult.value.status}, not proposed`);
    }
    const authorContent = authorResult.value.proposedContentChanges as { spec?: unknown } | undefined;
    if (typeof authorContent?.spec !== "string") {
      return abort(specStage.id, "spec.content.invalid", "spec author result is missing proposedContentChanges.spec");
    }
    let specContent = authorContent.spec;
    let written: { path: string; doc: SpecDoc };
    try {
      written = writeSpecDoc(rootDir, run.slug, specContent, profile.startingCommit);
    } catch (err) {
      return abort(specStage.id, "spec.content.invalid", (err as Error).message);
    }
    let specPath = written.path;
    if (written.doc.changeKind !== run.change_kind) {
      return abort(
        specStage.id,
        "spec.content.invalid",
        `spec change_kind ${written.doc.changeKind} does not match run change_kind ${run.change_kind}`
      );
    }
    audit(specStage.id, "spec.content.write", `wrote ${specPath}`);

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
        stageId: specStage.id,
        agent: author.id,
        role: "author",
        requestedModel: model,
        prompt: buildSpecSelfCritiquePrompt(author, design, specContent, {
          sizeMin: profile.policy.panelSizeMin,
          sizeMax: profile.policy.panelSizeMax,
          requiredSpecialties: profile.policy.requiredSpecialties,
          registeredSpecialties,
        }),
      },
      rootDir
    );
    if (!critiqueDispatch.ok) {
      return abort(specStage.id, "spec.selfcritique.failed", critiqueDispatch.reason);
    }
    const critiqueBody = extractJsonBody(critiqueDispatch.envelope.resultText);
    if (critiqueBody.kind === "refused") {
      return abort(specStage.id, "spec.selfcritique.invalid", `spec self-critique body refused: ${critiqueBody.reason}`);
    }
    const critiqueResult = validateAgentResult(author.id, critiqueBody.value);
    if (!critiqueResult.ok) {
      return abort(specStage.id, "spec.selfcritique.invalid", `spec self-critique result refused: ${critiqueResult.reason}`);
    }
    if (critiqueResult.value.status !== "proposed") {
      return abort(
        specStage.id,
        "spec.selfcritique.failed",
        `spec author returned status ${critiqueResult.value.status}, not proposed`
      );
    }
    const critiqueContent = critiqueResult.value.proposedContentChanges as
      | { selfCritique?: unknown }
      | undefined;
    const critique = validateSelfCritique(critiqueContent?.selfCritique);
    if (!critique.ok) {
      return abort(specStage.id, "spec.selfcritique.invalid", `spec self-critique refused: ${critique.reason}`);
    }
    // The mechanical artifact gates run again on the revised document. A
    // self-critique that produces an invalid specification blocks the stage:
    // it never falls back to the draft, because a silent fallback would make
    // the phase optional in exactly the runs where it went wrong.
    try {
      written = writeSpecDoc(rootDir, run.slug, critique.value.artifact, profile.startingCommit);
    } catch (err) {
      return abort(
        specStage.id,
        "spec.selfcritique.invalid",
        `spec self-critique document refused: ${(err as Error).message}`
      );
    }
    specContent = critique.value.artifact;
    specPath = written.path;
    if (written.doc.changeKind !== run.change_kind) {
      return abort(
        specStage.id,
        "spec.selfcritique.invalid",
        `spec change_kind ${written.doc.changeKind} does not match run change_kind ${run.change_kind}`
      );
    }
    audit(specStage.id, "spec.content.write", `wrote self-critique revision ${specPath}`);
    // Recorded before it is acted on, so the request the author made survives
    // in the audit trail whether or not the panel it asked for could be
    // staffed.
    audit(
      specStage.id,
      "spec.selfcritique.record",
      `spec self-critique returned ${critique.value.critique.length} critique entries; panel request size ${critique.value.panelRequest.size}, specialties [${critique.value.panelRequest.specialties.join(", ")}]`
    );
    store.completeStage(specStage.id, specPath, "pass");

    // --- spec_review stage: panel, findings, gate, closure ---
    const reviewStage = store.insertStage(runId, "spec_review", specStage.id);
    reviewStageId = reviewStage.id;
    audit(reviewStage.id, "spec_review.stage.create", `created spec_review stage ${reviewStage.id}`);
    const risk = computeRisk(
      run.change_kind,
      computeScope(written.doc.declaredArtifacts).length,
      touchesProtected(written.doc.declaredArtifacts, run.slug)
    );
    // Active review configuration comes from the profile frozen at run start.
    // The new round budget is frozen but stays inactive until Task 9 can give
    // it its promised panel-and-reconciliation meaning. Risk still binds the
    // approval; it simply no longer sizes the panel — the author does, within
    // the bounds this run froze.
    const requested = validatePanelRequest(
      critique.value.panelRequest,
      profile.policy.panelSizeMin,
      profile.policy.panelSizeMax,
      profile.policy.requiredSpecialties
    );
    if (!requested.ok) {
      return abort(reviewStage.id, "spec.panel.invalid", `spec panel request refused: ${requested.reason}`);
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
        "spec.panel.unstaffable",
        `spec panel cannot be staffed: ${shortfall}`
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
        "spec.panel.incomplete",
        `spec panel incomplete: needs ${panelSize} reviewers, found ${panel.length}`
      );
    }
    for (const reviewer of panel) {
      if (reviewer.executor !== executor.id) {
        return abort(
          reviewStage.id,
          "spec.reviewer.failed",
          `agent ${reviewer.id} is bound to executor ${reviewer.executor}, not the frozen executor ${executor.id}`
        );
      }
    }

    // The configured round count (section 12, as amended 2026-09-01): one
    // complete panel -> reconciliation cycle per round, gated once over every
    // round's decisions after the loop — not a closure budget with an early
    // exit on the first clean pass.
    const rounds: number = profile.policy.specReviewRounds;
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
          return abort(reviewStage.id, "spec.reviewer.failed", `configured agent ${reviewer.id} does not allow findings output`);
        }
        const dispatch = await dispatchOnce(
          store,
          executor,
          {
            stageId: reviewStage.id,
            agent: reviewer.id,
            role: "reviewer",
            requestedModel: reviewModel,
            prompt: buildSpecReviewPrompt(reviewer, design, specContent),
          },
          rootDir
        );
        if (!dispatch.ok) {
          return abort(reviewStage.id, "spec.reviewer.failed", dispatch.reason);
        }
        const reviewerBody = extractJsonBody(dispatch.envelope.resultText);
        if (reviewerBody.kind === "refused") {
          return abort(reviewStage.id, "spec.reviewer.failed", `reviewer ${reviewer.id} body refused: ${reviewerBody.reason}`);
        }
        const reviewerResult = validateAgentResult(reviewer.id, reviewerBody.value);
        if (!reviewerResult.ok) {
          return abort(reviewStage.id, "spec.reviewer.failed", `reviewer ${reviewer.id} result refused: ${reviewerResult.reason}`);
        }
        if (reviewerResult.value.status !== "proposed") {
          return abort(
            reviewStage.id,
            "spec.reviewer.failed",
            `reviewer ${reviewer.id} returned status ${reviewerResult.value.status}, not proposed — a reviewer that cannot review must not pass the gate by absence`
          );
        }
        const reviewerContent = reviewerResult.value.proposedContentChanges as { findings?: unknown } | undefined;
        if (!Array.isArray(reviewerContent?.findings)) {
          return abort(
            reviewStage.id,
            "spec.reviewer.failed",
            `reviewer ${reviewer.id} result is missing proposedContentChanges.findings`
          );
        }
        const reports = validateReviewerReports(reviewerContent.findings, {
          agentId: reviewer.id,
          upstreamPrefix: upstreamPrefixFor("design"),
        });
        if (!reports.ok) {
          return abort(reviewStage.id, "spec.reviewer.failed", `reviewer ${reviewer.id} result refused: ${reports.reason}`);
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
            "spec.finding.record",
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
      const beforeContent = specContent;
      const reconcileDispatch = await dispatchOnce(
        store,
        executor,
        {
          stageId: specStage.id,
          agent: author.id,
          role: "author",
          requestedModel: model,
          prompt: buildSpecReconcilePrompt(author, design, specContent, reconcileFindings),
        },
        rootDir
      );
      if (!reconcileDispatch.ok) {
        return abort(reviewStage.id, "spec.reconcile.failed", reconcileDispatch.reason);
      }
      const reconcileBody = extractJsonBody(reconcileDispatch.envelope.resultText);
      if (reconcileBody.kind === "refused") {
        return abort(reviewStage.id, "spec.reconcile.invalid", `reconciliation body refused: ${reconcileBody.reason}`);
      }
      const reconcileResult = validateAgentResult(author.id, reconcileBody.value);
      if (!reconcileResult.ok) {
        return abort(reviewStage.id, "spec.reconcile.invalid", `reconciliation result refused: ${reconcileResult.reason}`);
      }
      if (reconcileResult.value.status !== "proposed") {
        return abort(
          reviewStage.id,
          "spec.reconcile.failed",
          `spec author returned status ${reconcileResult.value.status}, not proposed`
        );
      }
      const reconcileContent = reconcileResult.value.proposedContentChanges as
        | { spec?: unknown; decisions?: unknown }
        | undefined;
      if (typeof reconcileContent?.spec !== "string") {
        return abort(reviewStage.id, "spec.reconcile.invalid", "reconciliation result is missing proposedContentChanges.spec");
      }
      const reconciledDoc = validateSpecDoc(reconcileContent.spec);
      if (!reconciledDoc.ok) {
        return abort(
          reviewStage.id,
          "spec.reconcile.invalid",
          `spec reconciliation document refused: ${reconciledDoc.reason}`
        );
      }
      const reconciliation = validateReconciliation(reconcileContent.decisions, {
        canonicalFindingIds: reconcileFindings.map((f) => f.findingId),
        governingSource: "design",
        governingText: design,
        beforeNormativeNodes: specNormativeNodes(written.doc),
        afterNormativeNodes: specNormativeNodes(reconciledDoc.value),
      });
      if (!reconciliation.ok) {
        return abort(reviewStage.id, "spec.reconcile.invalid", `spec reconciliation refused: ${reconciliation.reason}`);
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
          "spec.reconcile.invalid",
          `spec reconciliation left normative node(s) unclaimed by any decision: ${reconciliation.value.unclaimedNodes.join(" | ")}`
        );
      }
      if (reconciledDoc.value.changeKind !== run.change_kind) {
        return abort(
          reviewStage.id,
          "spec.reconcile.invalid",
          `spec change_kind ${reconciledDoc.value.changeKind} does not match run change_kind ${run.change_kind}`
        );
      }
      try {
        written = writeSpecDoc(rootDir, run.slug, reconcileContent.spec, profile.startingCommit);
      } catch (err) {
        return abort(reviewStage.id, "spec.reconcile.invalid", (err as Error).message);
      }
      specContent = reconcileContent.spec;
      specPath = written.path;
      audit(specStage.id, "spec.content.write", `wrote reconciliation revision ${specPath}`);
      const specHashBefore = sha256Hex(normalizeText(beforeContent));
      const specHashAfter = sha256Hex(normalizeText(specContent));
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
          artifactHashBefore: specHashBefore,
          artifactHashAfter: specHashAfter,
        });
        if (decision.disposition === "upstream_follow_up" || decision.disposition === "upstream_blocking") {
          const candidate = decision.proposal!;
          const route = deriveRoute(decision.disposition);
          const evidenceRef = writeProposalEvidence(rootDir, runId, {
            findingId: decision.findingId,
            candidate,
            route,
            rationale: decision.rationale,
            artifactHashBefore: specHashBefore,
            artifactHashAfter: specHashAfter,
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
            "spec.proposal.record",
            `proposal ${proposal.id} ${created ? "created" : "linked"}; finding=${decision.findingId}; route=${route}; risk=${risk}; specHashBefore=${specHashBefore}; specHashAfter=${specHashAfter}; evidence=${evidenceRef}`
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
          "spec.reconcile.record",
          `spec reconcile round ${round}: specHashBefore=${specHashBefore}; specHashAfter=${specHashAfter}; risk=${risk}; decisions=${reconciliation.value.decisions.length}; findings=${reconcileFindings.map((f) => f.findingId).join(",")}; ${decisionParts.join(" ")}; conversions=${conversionParts}; unclaimed=${reconciliation.value.unclaimedNodes.length}; proposals=${proposalParts.join(",")}`
        );
      }
    }

    // --- decision gate: over every round this stage ran, not the last one ---
    const decisions = store.getFindingDecisions(reviewStage.id);
    const gate = specReviewGate(decisions);
    if (gate.pass) {
      audit(
        reviewStage.id,
        "spec.gate.pass",
        // Machine-readable: the approval gate reads these back to refuse an
        // authorization binding a spec no panel gated. Normalized before
        // hashing so a CRLF checkout cannot break the comparison.
        `spec_review gate passed after ${rounds} round(s); specHash=${sha256Hex(normalizeText(specContent))}; risk=${risk}`
      );
      store.completeStage(reviewStage.id, specPath, "pass");
      return { ok: true, stageIds: { spec: specStage.id, specReview: reviewStage.id }, specPath };
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
    return abort(reviewStage.id, "spec.gate.block", `spec_review blocked: finding id(s) ${blockedNames}`);
  } catch (err) {
    // The wedge guard: an unexpected throw (filesystem, database) must
    // produce the same terminal state as any other failure.
    const reason = `spec stage failed: ${(err as Error).message}`;
    for (const id of [specStageId, reviewStageId]) {
      if (id !== null) {
        const stage = store.getStage(id);
        if (stage && (stage.status === "pending" || stage.status === "in_progress")) {
          store.completeStage(id, "", "block");
        }
      }
    }
    audit(reviewStageId ?? specStageId, "spec.stage.failed", reason);
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  }
}
