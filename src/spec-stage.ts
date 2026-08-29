import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutorDefinition } from "./executor.ts";
import type { FindingRow, Store } from "./store.ts";
import { dispatchOnce } from "./dispatch.ts";
import { agentById } from "./agents.ts";
import { validateAgentResult } from "./agent-result.ts";
import { extractJsonBody } from "./parse-output.ts";
import { SEVERITIES, SEVERITY_ORDER, findingIdentity, normalizeLocation } from "./finding.ts";
import { computeRisk, selectReviewers, PANEL_SIZE } from "./select.ts";
import { computeScope, touchesProtected } from "./scope.ts";
import { buildSpecAuthorPrompt, buildSpecReviewPrompt } from "./prompts.ts";
import { writeSpecDoc, type SpecDoc } from "./spec-doc.ts";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { MATERIAL_THRESHOLD, REMEDIATION_ROUNDS, REQUIRED_SPECIALTIES } from "./policy.ts";

export type StageResult =
  | { ok: true; stageIds: { spec: number; specReview: number }; specPath: string }
  | { ok: false; reason: string };

/**
 * The deterministic gate (section 12): a reviewer's verdict is an input,
 * never the gate. Passes iff no material finding remains open.
 */
export function specReviewGate(
  findings: FindingRow[]
): { pass: true } | { pass: false; openMaterialIds: number[] } {
  const openMaterial = findings.filter(
    (f) => SEVERITY_ORDER[f.severity] >= SEVERITY_ORDER[MATERIAL_THRESHOLD] && f.disposition === "open"
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
  input: { runId: number; requestedModel: string; rootDir: string }
): Promise<StageResult> {
  const { runId, requestedModel, rootDir } = input;
  const run = store.getRun(runId);
  if (!run) {
    return { ok: false, reason: `run ${runId} does not exist` };
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
  const author = agentById("spec-author")!;

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
    const authorDispatch = await dispatchOnce(
      store,
      executor,
      {
        stageId: specStage.id,
        agent: author.id,
        role: "author",
        requestedModel,
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
    const panel = selectReviewers(risk, REQUIRED_SPECIALTIES);
    if (panel.length < PANEL_SIZE[risk]) {
      return abort(
        reviewStage.id,
        "spec.panel.incomplete",
        `spec panel incomplete: risk ${risk} needs ${PANEL_SIZE[risk]} reviewers, found ${panel.length}`
      );
    }

    for (let round = 1; round <= REMEDIATION_ROUNDS; round++) {
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
            requestedModel,
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
      const gate = specReviewGate(store.getFindings(reviewStage.id));
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
      if (round >= REMEDIATION_ROUNDS) {
        return abort(
          reviewStage.id,
          "spec.gate.block",
          `spec_review blocked: material findings remain open after ${REMEDIATION_ROUNDS} rounds: ${gate.openMaterialIds.join(", ")}`
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
          requestedModel,
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
    return { ok: false, reason: "spec_review did not reach a terminal state" };
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
