import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutorDefinition } from "./executor.ts";
import { requireRunInProgress, type FindingRow, type Store } from "./store.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { dispatchOnce } from "./dispatch.ts";
import { validateAgentResult } from "./agent-result.ts";
import { extractJsonBody } from "./parse-output.ts";
import type { AgentDefinition } from "./agents.ts";
import { SEVERITIES, SEVERITY_ORDER, findingIdentity, normalizeLocation } from "./finding.ts";
import { computeRisk, selectReviewers, staffingShortfall, validatePanelRequest } from "./select.ts";
import { computeScope, touchesProtected } from "./scope.ts";
import { buildSpecAuthorPrompt, buildSpecReviewPrompt, buildSpecSelfCritiquePrompt } from "./prompts.ts";
import { writeSpecDoc, type SpecDoc } from "./spec-doc.ts";
import { validateSelfCritique } from "./self-critique.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";

// Transitional only. The shipped stages still implement the old
// panel -> author revision -> closure-panel loop. Task 9 removes this budget
// and activates the frozen configured rounds only when each one can include
// the promised reconciliation dispatch.
const LEGACY_CLOSURE_PASSES = 3;

export type StageResult =
  | { ok: true; stageIds: { spec: number; specReview: number }; specPath: string }
  | { ok: false; reason: string };

/**
 * The deterministic gate (section 12): a reviewer's verdict is an input,
 * never the gate. Passes iff no material finding remains open.
 */
export function specReviewGate(
  findings: FindingRow[],
  materialityThreshold: string
): { pass: true } | { pass: false; openMaterialIds: number[] } {
  const openMaterial = findings.filter(
    (f) =>
      SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[materialityThreshold] &&
      f.disposition === "open"
  );
  return openMaterial.length === 0
    ? { pass: true }
    : { pass: false, openMaterialIds: openMaterial.map((f) => f.id) };
}

interface FindingShape {
  location?: unknown;
  intentKey?: unknown;
  severity?: unknown;
  subject?: unknown;
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
      written = writeSpecDoc(rootDir, run.slug, specContent);
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
      written = writeSpecDoc(rootDir, run.slug, critique.value.artifact);
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

    // The configured count starts governing here only when Task 9 replaces
    // this legacy loop with complete panel-and-reconciliation cycles.
    const rounds: number = LEGACY_CLOSURE_PASSES;
    for (let round = 1; round <= rounds; round++) {
      const reportedIdentities = new Set<string>();
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
            prompt: buildSpecReviewPrompt(reviewer, specContent),
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
        for (const entry of reviewerContent.findings as unknown[]) {
          if (entry === null || typeof entry !== "object") {
            return abort(reviewStage.id, "spec.reviewer.failed", `reviewer ${reviewer.id} finding entry is not an object`);
          }
          const f = entry as FindingShape;
          if (typeof f.location !== "string" || f.location === "") {
            return abort(reviewStage.id, "spec.reviewer.failed", `reviewer ${reviewer.id} finding is missing a non-empty location`);
          }
          if (typeof f.intentKey !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.intentKey) || f.intentKey.length > 64) {
            return abort(
              reviewStage.id,
              "spec.reviewer.failed",
              `reviewer ${reviewer.id} finding intentKey ${String(f.intentKey)} is not lowercase kebab-case within 64 characters`
            );
          }
          if (typeof f.severity !== "string" || !SEVERITIES.includes(f.severity)) {
            return abort(
              reviewStage.id,
              "spec.reviewer.failed",
              `reviewer ${reviewer.id} finding severity ${String(f.severity)} is not one of ${SEVERITIES.join(", ")}`
            );
          }
          if (typeof f.subject !== "string" || f.subject === "") {
            return abort(reviewStage.id, "spec.reviewer.failed", `reviewer ${reviewer.id} finding is missing a non-empty subject`);
          }
          // Store the normalized location: identity derives from the
          // normalized form (section 8), so the DB and the resolution pass
          // key on the same string.
          const normalized = normalizeLocation(f.location);
          store.insertFinding({
            stageId: reviewStage.id,
            agentRunId: dispatch.agentRunId,
            severity: f.severity,
            intentKey: f.intentKey,
            subject: f.subject,
            location: normalized,
          });
          audit(reviewStage.id, "spec.finding.record", `recorded finding at ${normalized} (${f.intentKey})`);
          reportedIdentities.add(findingIdentity(f.location, f.intentKey));
        }
      }
      // Resolution: the panel's re-review resolves, never the author's claim.
      for (const finding of store.getFindings(reviewStage.id)) {
        if (finding.disposition === "open" && !reportedIdentities.has(findingIdentity(finding.location, finding.intent_key))) {
          store.updateFindingDisposition(finding.id, "resolved");
          audit(reviewStage.id, "spec.finding.resolved", `finding ${finding.id} resolved by re-review`);
        }
      }
      const gate = specReviewGate(
        store.getFindings(reviewStage.id),
        profile.policy.materialityThreshold
      );
      if (gate.pass) {
        audit(
          reviewStage.id,
          "spec.gate.pass",
          // Machine-readable: the approval gate reads these back to refuse an
          // authorization binding a spec no panel gated. Normalized before
          // hashing so a CRLF checkout cannot break the comparison.
          `spec_review gate passed in round ${round}; specHash=${sha256Hex(normalizeText(specContent))}; risk=${risk}`
        );
        store.completeStage(reviewStage.id, specPath, "pass");
        return { ok: true, stageIds: { spec: specStage.id, specReview: reviewStage.id }, specPath };
      }
      if (round >= rounds) {
        return abort(
          reviewStage.id,
          "spec.gate.block",
          `spec_review blocked: material findings remain open after ${rounds} legacy closure passes: ${gate.openMaterialIds.join(", ")}`
        );
      }
      // Revision round: the author addresses the open material findings.
      const findingsSummary = store
        .getFindings(reviewStage.id)
        .filter((f) => gate.openMaterialIds.includes(f.id))
        .map((f) => `finding ${f.id} (${f.severity}) ${f.subject}`)
        .join("\n");
      const revisionDispatch = await dispatchOnce(
        store,
        executor,
        {
          stageId: specStage.id,
          agent: author.id,
          role: "author",
          requestedModel: model,
          prompt: buildSpecAuthorPrompt(author, design, { findingsSummary }),
        },
        rootDir
      );
      if (!revisionDispatch.ok) {
        return abort(reviewStage.id, "spec.author.failed", revisionDispatch.reason);
      }
      const revisionBody = extractJsonBody(revisionDispatch.envelope.resultText);
      if (revisionBody.kind === "refused") {
        return abort(reviewStage.id, "spec.content.invalid", `revision body refused: ${revisionBody.reason}`);
      }
      const revisionResult = validateAgentResult(author.id, revisionBody.value);
      if (!revisionResult.ok) {
        return abort(reviewStage.id, "spec.content.invalid", `revision result refused: ${revisionResult.reason}`);
      }
      if (revisionResult.value.status !== "proposed") {
        return abort(reviewStage.id, "spec.author.failed", `spec author returned status ${revisionResult.value.status}, not proposed`);
      }
      const revisionContent = revisionResult.value.proposedContentChanges as { spec?: unknown } | undefined;
      if (typeof revisionContent?.spec !== "string") {
        return abort(reviewStage.id, "spec.content.invalid", "revision result is missing proposedContentChanges.spec");
      }
      try {
        written = writeSpecDoc(rootDir, run.slug, revisionContent.spec);
      } catch (err) {
        return abort(reviewStage.id, "spec.content.invalid", (err as Error).message);
      }
      if (written.doc.changeKind !== run.change_kind) {
        return abort(
          reviewStage.id,
          "spec.content.invalid",
          `spec change_kind ${written.doc.changeKind} does not match run change_kind ${run.change_kind}`
        );
      }
      specContent = revisionContent.spec;
      specPath = written.path;
      audit(specStage.id, "spec.content.write", `wrote revision ${specPath}`);
    }
    return abort(
      reviewStage.id,
      "spec.gate.block",
      "spec_review exhausted its legacy closure passes without a terminal gate result"
    );
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
