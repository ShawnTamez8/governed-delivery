import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appendAudit } from "./audit.ts";
import { normalizeText, sha256Hex } from "./canonical.ts";
import { DECISION_ACTIONS, requireRunInProgress, type DecisionQuestionRow, type StageRow, type Store } from "./store.ts";
import type { ExecutorDefinition } from "./executor.ts";
import { loadVerifiedProfile, requireFrozenBinding, resolveStageModel } from "./profile.ts";
import { dispatchOnce } from "./dispatch.ts";
import { extractJsonBody } from "./parse-output.ts";
import { validateAgentResult } from "./agent-result.ts";
import { buildSpecDecisionFoldPrompt, type FoldQuestionInput } from "./prompts.ts";
import { validateSpecDoc, writeSpecDoc, type SpecDoc } from "./spec-doc.ts";
import { specNormativeNodes, upstreamPrefixFor, validateReconciliation } from "./reconciliation.ts";
import { computeRisk } from "./select.ts";
import { computeScope, touchesProtected } from "./scope.ts";
import { DISCLOSED_OPEN_DECISION_INTENT } from "./spec-stage.ts";

/**
 * The `spec_decision` boundary (architecture section 12). A `spec_review`
 * blocking decision that carries a question pauses the run; the operator
 * answers each question here, and the decision group then folds the answers
 * into the specification. Answers are human decisions (hazard 14): they are
 * audited `actor: operator`, `actorType: human`, and never described as a
 * reviewer or panel result.
 */

/** Longest `modify` answer the operator may record, in characters. */
export const DECISION_ANSWER_MAX_CHARS = 4000;

export type DecisionAction = "approve" | "deny" | "modify";

export type AnswerResult =
  | { ok: true; answerId: number; questionId: number; action: DecisionAction; answer: string; open: number }
  | { ok: false; reason: string };

/**
 * The review stage whose questions are open for answers: the run's last stage
 * must be a passed `spec_review` and no `spec_decision` row may exist yet.
 */
export function openDecisionStage(store: Store, runId: number): { ok: true; reviewStage: StageRow } | { ok: false; reason: string } {
  const chain = store.getStageChain(runId);
  if (chain.some((s) => s.kind === "spec_decision")) {
    return { ok: false, reason: `run ${runId} already has a spec_decision stage: its questions are closed` };
  }
  const last = chain[chain.length - 1];
  if (!last || last.kind !== "spec_review" || last.status !== "passed") {
    return {
      ok: false,
      reason: `run ${runId}'s last stage is ${last ? `${last.kind} (${last.status})` : "absent"}, not a passed spec_review`,
    };
  }
  return { ok: true, reviewStage: last };
}

/** The question's options as recorded; the store keeps them as JSON text. */
export function questionOptions(question: DecisionQuestionRow): { label: string; answer: string }[] {
  return JSON.parse(question.options) as { label: string; answer: string }[];
}

/**
 * Record the operator's one immutable answer to one question. `approve`
 * stores the recommended option's answer, `deny` stores an empty answer (the
 * question stays open upstream), and `modify` stores the operator's own text.
 * Deterministic and dispatch-free: a refusal is an operator input error, is
 * audited `decision.refused` outside any transaction, and writes no answer —
 * the same shape as `approveRun`.
 */
export function answerQuestion(
  store: Store,
  input: { runId: number; findingId: number; action: string; answer?: string }
): AnswerResult {
  const { runId, findingId, action } = input;
  // audit.run_id carries a foreign key, so a refusal for a missing run is
  // returned without an event rather than thrown.
  const run = store.getRun(runId);
  const refuse = (reason: string): AnswerResult => {
    if (run) {
      appendAudit(store, {
        runId,
        stageId: null,
        actor: "operator",
        actorType: "human",
        action: "decision.refused",
        summary: reason,
      });
    }
    return { ok: false, reason };
  };
  if (!run) return refuse(`run ${runId} does not exist`);
  const blocked = requireRunInProgress(run);
  if (blocked !== null) return refuse(blocked);
  const open = openDecisionStage(store, runId);
  if (!open.ok) return refuse(open.reason);
  const reviewStage = open.reviewStage;
  const questions = store.getDecisionQuestions(reviewStage.id);
  const question = questions.find((q) => q.finding_id === findingId);
  if (!question) {
    return refuse(`finding ${findingId} has no question in run ${runId}'s spec_review stage ${reviewStage.id}`);
  }
  const answers = store.getDecisionAnswers(reviewStage.id);
  if (answers.some((a) => a.question_id === question.id)) {
    return refuse(`the question for finding ${findingId} is already answered; answers are immutable`);
  }
  if (!DECISION_ACTIONS.includes(action)) {
    return refuse(`invalid decision action ${action}: allowed values are ${DECISION_ACTIONS.join(", ")}`);
  }
  let answer: string;
  if (action === "modify") {
    // Trimmed here, not by each writer, so the CLI and the dashboard record
    // the same bytes for the same answer.
    const text = input.answer?.trim() ?? "";
    if (text === "") {
      return refuse("modify requires a non-empty answer");
    }
    if (text.length > DECISION_ANSWER_MAX_CHARS) {
      return refuse(`modify answer is ${text.length} characters; the limit is ${DECISION_ANSWER_MAX_CHARS}`);
    }
    answer = text;
  } else {
    if (input.answer !== undefined) {
      return refuse(`${action} takes no answer text; use modify to write your own`);
    }
    answer = action === "approve" ? questionOptions(question)[question.recommended]!.answer : "";
  }

  // One unit of work: the answer and its audit event commit together or not
  // at all, so a failed append leaves no answer that a retry would then find
  // already recorded.
  const row = store.transaction(() => {
    const inserted = store.insertDecisionAnswer({ questionId: question.id, action, answer });
    appendAudit(store, {
      runId,
      stageId: reviewStage.id,
      actor: "operator",
      actorType: "human",
      action: "decision.answer",
      summary: `question ${question.id} for finding ${findingId} answered ${action}; answerHash=${sha256Hex(answer)}`,
    });
    return inserted;
  });
  return {
    ok: true,
    answerId: row.id,
    questionId: question.id,
    action: action as DecisionAction,
    answer,
    open: questions.length - answers.length - 1,
  };
}

export type DecisionStageResult =
  | { ok: true; stageId: number; specPath: string; folded: number }
  | { ok: false; reason: string };

function riskOf(doc: SpecDoc, changeKind: string, slug: string): string {
  return computeRisk(changeKind, computeScope(doc.declaredArtifacts).length, touchesProtected(doc.declaredArtifacts, slug));
}

/**
 * The open decisions the fold must leave exactly as reviewed: every entry
 * except one whose own disclosed finding carries an approve or modify answer.
 * A denied disclosure must also still be in the reviewed spec, because the
 * spec_review reconciler may have dropped or renumbered it while asking.
 * `specNormativeNodes` excludes `## Open decisions`, so the normative delta
 * cannot see an entry deleted or reworded there; this check is separate.
 */
export function openDecisionRefusals(
  store: Store,
  questions: readonly DecisionQuestionRow[],
  actions: ReadonlyMap<number, string>,
  reviewed: SpecDoc,
  folded: SpecDoc
): string[] {
  const refusals: string[] = [];
  const locationOf = (id: string) => `${upstreamPrefixFor("design")}${id.toLowerCase()}`;
  const owned = new Set<string>();
  for (const question of questions) {
    const finding = store.getCanonicalFinding(question.finding_id);
    if (!finding || finding.intent_key !== DISCLOSED_OPEN_DECISION_INTENT) continue;
    const entry = reviewed.openDecisions.find((d) => locationOf(d.id) === finding.location);
    if (actions.get(question.id) !== "deny") {
      if (entry) owned.add(entry.id);
    } else if (!entry) {
      refusals.push(`denied ${finding.location.slice(upstreamPrefixFor("design").length).toUpperCase()} is missing from the reviewed spec`);
    }
  }
  for (const entry of reviewed.openDecisions) {
    if (owned.has(entry.id)) continue;
    const kept = folded.openDecisions.find((d) => d.id === entry.id);
    if (!kept) {
      refusals.push(`${entry.id} was removed`);
    } else if (kept.severity !== entry.severity || kept.text !== entry.text) {
      refusals.push(`${entry.id} changed from (${entry.severity}) ${entry.text} to (${kept.severity}) ${kept.text}`);
    }
  }
  return refusals;
}

/**
 * The decision group (architecture section 12, `spec_decision`). Once every
 * question has an answer it creates `spec_decision` and, unless every answer
 * is deny, dispatches the frozen spec author once to fold the approved and
 * modified answers into the specification. The fold passes the same
 * mechanical gates as every other revision, plus the fold-only grounding
 * (design, or that same question's answer) and the denied-disclosure check.
 * A precondition refusal creates nothing; a failure after the stage row is
 * created blocks the stage and the run, and a fresh run is the repair.
 */
export async function runSpecDecisionStage(
  store: Store,
  executor: ExecutorDefinition,
  input: { runId: number; rootDir: string }
): Promise<DecisionStageResult> {
  const { runId, rootDir } = input;
  const run = store.getRun(runId);
  if (!run) return { ok: false, reason: `run ${runId} does not exist` };
  const blocked = requireRunInProgress(run);
  if (blocked !== null) return { ok: false, reason: blocked };
  const verified = loadVerifiedProfile(rootDir, run);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const profile = verified.profile;
  const open = openDecisionStage(store, runId);
  if (!open.ok) return { ok: false, reason: open.reason };
  const reviewStage = open.reviewStage;
  const questions = store.getDecisionQuestions(reviewStage.id);
  if (questions.length === 0) {
    return { ok: false, reason: `run ${runId}'s spec_review stage ${reviewStage.id} opened no question to fold` };
  }
  const answers = new Map(store.getDecisionAnswers(reviewStage.id).map((a) => [a.question_id, a]));
  const unanswered = questions.filter((q) => !answers.has(q.id)).map((q) => q.finding_id);
  if (unanswered.length > 0) {
    return { ok: false, reason: `question(s) for finding(s) ${unanswered.join(", ")} are unanswered` };
  }
  const folds = questions.filter((q) => answers.get(q.id)!.action !== "deny");
  // Configuration failures precede the stage row and any spend, as in
  // `runSpecStage`: the fold is a spec-author dispatch under the spec model.
  let model: string | null = null;
  const author = profile.agents.find((a) => a.id === "spec-author");
  if (folds.length > 0) {
    const resolved = resolveStageModel(profile, "spec");
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    model = resolved.model;
    const binding = requireFrozenBinding(profile, executor, "spec");
    if (!binding.ok) return { ok: false, reason: binding.reason };
    if (!author) return { ok: false, reason: "configured agent spec-author is not in the frozen profile" };
    if (author.executor !== executor.id) {
      return { ok: false, reason: `agent ${author.id} is bound to executor ${author.executor}, not the frozen executor ${executor.id}` };
    }
    if (!author.outputs.includes("spec-reconciliation")) {
      return { ok: false, reason: `configured agent ${author.id} does not allow spec-reconciliation output` };
    }
  }
  const specPath = reviewStage.output_ref!;
  let reviewedContent: string;
  let design: string;
  try {
    reviewedContent = readFileSync(resolve(rootDir, specPath), "utf8");
    design = readFileSync(join(rootDir, "docs", "features", run.slug, "design.md"), "utf8");
  } catch (err) {
    return { ok: false, reason: `cannot read the reviewed spec or design: ${(err as Error).message}` };
  }
  const reviewed = validateSpecDoc(reviewedContent);
  if (!reviewed.ok) return { ok: false, reason: `the reviewed spec ${specPath} no longer validates: ${reviewed.reason}` };

  const audit = (stageId: number, action: string, summary: string): void => {
    appendAudit(store, { runId, stageId, actor: "system", actorType: "cli", action, summary });
  };
  let stageId: number | null = null;
  const abort = (id: number, action: string, reason: string): DecisionStageResult => {
    audit(id, action, reason);
    store.completeStage(id, "", "block");
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  };
  const pass = (id: number, path: string, content: string, doc: SpecDoc, folded: number): DecisionStageResult => {
    store.completeStage(id, path, "pass");
    audit(
      id,
      "spec_decision.gate.pass",
      `spec_decision gate passed; specHash=${sha256Hex(normalizeText(content))}; risk=${riskOf(doc, run.change_kind, run.slug)}; answers=${questions.length}; folded=${folded}`
    );
    return { ok: true, stageId: id, specPath: path, folded };
  };

  try {
    const stage = store.insertStage(runId, "spec_decision", reviewStage.id);
    stageId = stage.id;
    audit(stage.id, "spec_decision.stage.create", `created spec_decision stage ${stage.id}`);
    const actions = new Map(questions.map((q) => [q.id, answers.get(q.id)!.action]));
    if (folds.length === 0) {
      const missing = openDecisionRefusals(store, questions, actions, reviewed.value, reviewed.value);
      if (missing.length > 0) {
        return abort(stage.id, "spec_decision.fold.invalid", `spec decision refused: ${missing.join("; ")}`);
      }
      return pass(stage.id, specPath, reviewedContent, reviewed.value, 0);
    }

    const foldInputs: FoldQuestionInput[] = questions.map((q) => {
      const answer = answers.get(q.id)!;
      return { findingId: q.finding_id, text: q.text, action: answer.action as FoldQuestionInput["action"], answer: answer.answer };
    });
    const dispatch = await dispatchOnce(
      store,
      executor,
      {
        stageId: stage.id,
        agent: author!.id,
        role: "author",
        requestedModel: model!,
        prompt: buildSpecDecisionFoldPrompt(author!, design, reviewedContent, foldInputs),
      },
      rootDir
    );
    if (!dispatch.ok) return abort(stage.id, "spec_decision.fold.failed", dispatch.reason);
    const body = extractJsonBody(dispatch.envelope.resultText);
    if (body.kind === "refused") {
      return abort(stage.id, "spec_decision.fold.invalid", `spec decision fold body refused: ${body.reason}`);
    }
    const result = validateAgentResult(author!.id, body.value);
    if (!result.ok) {
      return abort(stage.id, "spec_decision.fold.invalid", `spec decision fold result refused: ${result.reason}`);
    }
    if (result.value.status !== "proposed") {
      return abort(stage.id, "spec_decision.fold.failed", `spec author returned status ${result.value.status}, not proposed`);
    }
    const content = result.value.proposedContentChanges as { spec?: unknown; decisions?: unknown } | undefined;
    if (typeof content?.spec !== "string") {
      return abort(stage.id, "spec_decision.fold.invalid", "spec decision fold result is missing proposedContentChanges.spec");
    }
    const folded = validateSpecDoc(content.spec);
    if (!folded.ok) {
      return abort(stage.id, "spec_decision.fold.invalid", `spec decision fold document refused: ${folded.reason}`);
    }
    if (folded.value.changeKind !== run.change_kind) {
      return abort(
        stage.id,
        "spec_decision.fold.invalid",
        `spec change_kind ${folded.value.changeKind} does not match run change_kind ${run.change_kind}`
      );
    }
    const reviewedIds = new Set(reviewed.value.openDecisions.map((d) => d.id));
    const added = folded.value.openDecisions.map((d) => d.id).filter((id) => !reviewedIds.has(id));
    if (added.length > 0) {
      return abort(stage.id, "spec_decision.fold.invalid", `spec decision fold added open decision(s) ${added.join(", ")}`);
    }
    const denied = questions.filter((q) => answers.get(q.id)!.action === "deny");
    const disturbed = openDecisionRefusals(store, questions, actions, reviewed.value, folded.value);
    if (disturbed.length > 0) {
      return abort(
        stage.id,
        "spec_decision.fold.invalid",
        `spec decision fold changed open decision(s) no folded answer owns: ${disturbed.join("; ")}`
      );
    }
    const operatorAnswers = new Map(folds.map((q) => [q.finding_id, answers.get(q.id)!.answer]));
    const reconciliation = validateReconciliation(content.decisions, {
      canonicalFindingIds: folds.map((q) => q.finding_id),
      governingSource: "design",
      governingText: design,
      beforeNormativeNodes: specNormativeNodes(reviewed.value),
      afterNormativeNodes: specNormativeNodes(folded.value),
      operatorAnswers,
    });
    if (!reconciliation.ok) {
      return abort(stage.id, "spec_decision.fold.invalid", `spec decision fold refused: ${reconciliation.reason}`);
    }
    const notAddressed = reconciliation.value.decisions.filter((d) => d.disposition !== "addressed");
    if (notAddressed.length > 0) {
      const conversions = new Map(reconciliation.value.conversions.map((c) => [c.findingId, c.reason]));
      return abort(
        stage.id,
        "spec_decision.fold.invalid",
        `spec decision fold must address every folded answer: ${notAddressed
          .map((d) => `finding ${d.findingId} is ${d.disposition}${conversions.has(d.findingId) ? ` (${conversions.get(d.findingId)})` : ""}`)
          .join("; ")}`
      );
    }
    if (reconciliation.value.unclaimedNodes.length > 0) {
      return abort(
        stage.id,
        "spec_decision.fold.invalid",
        `spec decision fold left normative node(s) unclaimed by any folded answer: ${reconciliation.value.unclaimedNodes.join(" | ")}`
      );
    }
    if (reconciliation.value.unclaimedRemovals.length > 0) {
      return abort(
        stage.id,
        "spec_decision.fold.invalid",
        `spec decision fold left removed normative node(s) unclaimed by any folded answer: ${reconciliation.value.unclaimedRemovals.join(" | ")}`
      );
    }
    let written: { path: string; doc: SpecDoc };
    try {
      written = writeSpecDoc(rootDir, run.slug, content.spec, profile.startingCommit);
    } catch (err) {
      return abort(stage.id, "spec_decision.fold.invalid", `spec decision fold document refused: ${(err as Error).message}`);
    }
    audit(
      stage.id,
      "spec_decision.fold.record",
      `folded ${folds.length} answer(s) for finding(s) ${folds.map((q) => q.finding_id).join(",")}; denied=${denied.map((q) => q.finding_id).join(",")}; claims=${reconciliation.value.decisions.map((d) => `${d.findingId}:${d.normativeChanges?.length ?? 0}`).join(",")}; specHashBefore=${sha256Hex(normalizeText(reviewedContent))}; specHashAfter=${sha256Hex(normalizeText(content.spec))}`
    );
    return pass(stage.id, written.path, content.spec, written.doc, folds.length);
  } catch (err) {
    const reason = `spec decision stage failed: ${(err as Error).message}`;
    if (stageId !== null) {
      const stage = store.getStage(stageId);
      if (stage && (stage.status === "pending" || stage.status === "in_progress")) {
        store.completeStage(stageId, "", "block");
      }
      audit(stageId, "spec_decision.stage.failed", reason);
    }
    store.setRunStatus(runId, "blocked");
    return { ok: false, reason };
  }
}
