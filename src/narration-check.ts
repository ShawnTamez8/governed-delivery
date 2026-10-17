import { appendAudit } from "./audit.ts";
import { sha256Hex } from "./canonical.ts";
import type { NarrationCheckConfig } from "./profile.ts";
import { writeRawOutput } from "./raw-output.ts";
import { upstreamPrefixFor, validateReviewerReports, type ReviewerReport } from "./reconciliation.ts";
import type { CanonicalFindingRow, Store } from "./store.ts";
import { askSystemOne, type ChoiceQuestion, type SystemOneRequest } from "./systemone.ts";

/**
 * The narration check (`docs/features/narration-check-spec-review/plan.md`): does
 * an Acceptance criteria entry carry its author's remark about the document or
 * the work, which the section's stated rule forbids? The question, its options
 * and its state are the ones evaluated on 2026-10-17
 * (`docs/features/decision-1-format-checks/plan.md`, "Evaluation record"), byte
 * for byte; `test/systemone-format-evidence.test.ts` proves the recorded hashes
 * still match them.
 */

export type NarrationAnswer = "criterion" | "contains-remark";

export const NARRATION_QUESTION_NAME = "narration";
export const NARRATION_POSITIVE: NarrationAnswer = "contains-remark";

export const NARRATION_OPTIONS: Readonly<Record<NarrationAnswer, string>> = {
  criterion: "The entry is only an acceptance criterion.",
  "contains-remark": "Some or all of the entry is the author's remark about the document or the work.",
};

/** The section rule, verbatim from the spec author prompt in `src/prompts.ts`. */
export const ACCEPTANCE_SECTION_RULE =
  "Every non-blank line in this section is one criterion and nothing else: no heading, no note, no explanation, and never one criterion wrapped across two lines; put an explanation of a numbering decision in your summary or an ordinary prose section, not inside this section.";

export const NARRATION_QUESTION_TEXT =
  "The state holds the rule for the Acceptance criteria section of a specification, and one entry written in that section. " +
  "Is the entry only an acceptance criterion, or is some or all of it the author's remark about the document or the work, " +
  "such as why something was numbered or decided, or that something was left undecided?";

export function narrationQuestion(): ChoiceQuestion {
  return { type: "choice", instructions: NARRATION_QUESTION_TEXT, criteria: { ...NARRATION_OPTIONS } };
}

/** The hash the profile freezes and the evaluation recorded for this question. */
export function narrationQuestionHash(): string {
  return sha256Hex(JSON.stringify(narrationQuestion()));
}

export function narrationState(entry: string): string {
  return [`Section rule: ${ACCEPTANCE_SECTION_RULE}`, "", `Entry: ${entry}`].join("\n");
}

/**
 * One entry per list line under `## Acceptance criteria`, and one per run of
 * consecutive non-list lines: the recorded note spans three physical lines.
 */
export function acceptanceEntries(spec: string): Array<{ lines: [number, number]; entry: string }> {
  const lines = spec.split(/\r?\n/);
  const entries: Array<{ lines: [number, number]; entry: string }> = [];
  let inSection = false;
  let open: { lines: [number, number]; parts: string[] } | null = null;
  const close = () => {
    if (open) entries.push({ lines: open.lines, entry: open.parts.join(" ") });
    open = null;
  };
  lines.forEach((line, index) => {
    const number = index + 1;
    if (/^#/.test(line)) {
      close();
      inSection = line.trim() === "## Acceptance criteria";
      return;
    }
    if (!inSection) return;
    if (line.trim() === "") return close();
    if (/^\s*- /.test(line)) {
      close();
      entries.push({ lines: [number, number], entry: line.trim() });
      return;
    }
    if (open) {
      open.lines[1] = number;
      open.parts.push(line.trim());
    } else {
      open = { lines: [number, number], parts: [line.trim()] };
    }
  });
  close();
  return entries;
}

// ---- the spec-review round ------------------------------------------------------

/** The agent, setting and executor every narration agent run records. */
export const NARRATION_AGENT = "narration-check";
export const NARRATION_EXECUTOR = "systemone";
export const NARRATION_INTENT = "criterion-carries-remark";
/** The severity a flagged entry is reported at: a defect in the artifact, not one that blocks by itself. */
export const NARRATION_SEVERITY = "medium";

const CRITERION_LINE = /^- (AC-\d{3,}): /;

export interface NarrationRoundInput {
  store: Store;
  rootDir: string;
  runId: number;
  /** The spec_review stage the round belongs to; its agent runs and findings hang off it. */
  stageId: number;
  round: number;
  /** The specification this round's panel reviews. */
  spec: string;
  config: NarrationCheckConfig;
  key: string;
}

export type NarrationRoundResult =
  | { ok: true; answered: number; flagged: Array<{ finding: CanonicalFindingRow; report: ReviewerReport }> }
  | { ok: false; reason: string };

/**
 * Ask Decision-1 about every Acceptance criteria entry, in document order, one
 * request each, and stop at the first failure. Nothing is retried, skipped or
 * defaulted: a non-2xx status, a timeout, a network error, a body that is not
 * JSON or fails validation, and an entry that is not a criterion line each end
 * the round with a reason the caller blocks the run on. Every response is
 * retained raw before it is acted on (hazard 2), and the request carries no key.
 */
export async function runNarrationRound(input: NarrationRoundInput): Promise<NarrationRoundResult> {
  const { store, rootDir, runId, stageId, round, config, key } = input;
  const flagged: Array<{ finding: CanonicalFindingRow; report: ReviewerReport }> = [];
  const entries = acceptanceEntries(input.spec);
  for (const { lines, entry } of entries) {
    const id = CRITERION_LINE.exec(entry)?.[1];
    if (id === undefined) {
      // validateSpecDoc admits only criterion lines in this section, so reaching
      // here means the two readers of the section disagree: a defect, named.
      return { ok: false, reason: `narration check: the Acceptance criteria entry at line ${lines[0]} is not a criterion line, though the specification validated: ${JSON.stringify(entry.slice(0, 80))}` };
    }
    const request: SystemOneRequest = {
      state: narrationState(entry),
      questions: { [NARRATION_QUESTION_NAME]: narrationQuestion() },
    };
    const sent = { model: config.deployment, ...request };
    const outcome = await askSystemOne(
      { endpoint: config.endpoint, deployment: config.deployment, deploymentType: config.deploymentType },
      key,
      request,
      config.timeoutMs
    );
    const rawOutputRef = writeRawOutput(rootDir, runId, JSON.stringify({
      check: NARRATION_QUESTION_NAME,
      criterion: id,
      round,
      endpoint: config.endpoint,
      request: sent,
      outcome: outcome.ok
        ? { ok: true, status: outcome.status, requestIds: outcome.requestIds, durationMs: outcome.durationMs, body: outcome.text }
        : { ok: false, status: outcome.status, reason: outcome.reason, durationMs: outcome.durationMs, body: outcome.body },
    }, null, 2));
    if (!outcome.ok) {
      return {
        ok: false,
        reason: `narration request for ${id} failed${outcome.status === null ? "" : ` with status ${outcome.status}`}: ${outcome.reason} (retained ${rawOutputRef})`,
      };
    }
    const answer = outcome.response.answers[NARRATION_QUESTION_NAME]!;
    const probability = answer.probabilities[answer.choice]!;
    const isFlagged = answer.choice === NARRATION_POSITIVE && probability >= config.threshold;
    let report: ReviewerReport | null = null;
    if (isFlagged) {
      const reports = validateReviewerReports(
        [{
          severity: NARRATION_SEVERITY,
          classification: "current_artifact",
          location: id,
          intentKey: NARRATION_INTENT,
          subject: `${id} carries the author's remark about the document or the work (Decision-1 narration check: ${NARRATION_POSITIVE} at ${probability.toFixed(3)}, threshold ${config.threshold}). The Acceptance criteria rule is: "${ACCEPTANCE_SECTION_RULE}" The entry is: ${entry}`,
        }],
        { agentId: NARRATION_AGENT, upstreamPrefix: upstreamPrefixFor("design") }
      );
      if (!reports.ok) {
        return { ok: false, reason: `narration check: the report for ${id} was refused: ${reports.reason}` };
      }
      report = reports.value[0]!;
    }
    // One unit per entry: the agent run, its finding and report when flagged,
    // its typed answer and its audit event commit together or not at all.
    store.transaction(() => {
      const agentRun = store.insertAgentRun({
        stageId,
        agent: NARRATION_AGENT,
        role: "reviewer",
        executor: NARRATION_EXECUTOR,
        requestedModel: config.deployment,
        requestedEffort: null,
        setting: NARRATION_AGENT,
        effectiveModel: outcome.response.model,
        fallback: null,
        tokensIn: outcome.response.usage.input_tokens,
        tokensOut: outcome.response.usage.output_tokens,
        cacheRead: null,
        cacheWrite: null,
        cost: null,
        durationMs: outcome.durationMs,
        inputHash: sha256Hex(JSON.stringify(sent)),
        outputHash: sha256Hex(outcome.text),
        rawOutputRef,
        independence: "configured_standalone",
      });
      let finding: CanonicalFindingRow | null = null;
      if (report !== null) {
        finding = store.upsertCanonicalFinding(stageId, round, report.intentKey, report.location);
        store.insertFindingReport({
          findingId: finding.id,
          agentRunId: agentRun.id,
          severity: report.severity,
          classification: report.classification,
          subject: report.subject,
        });
        flagged.push({ finding, report });
      }
      store.insertCheckAnswer({
        agentRunId: agentRun.id,
        checkName: NARRATION_QUESTION_NAME,
        subject: id,
        questionHash: sha256Hex(JSON.stringify(request.questions[NARRATION_QUESTION_NAME])),
        stateHash: sha256Hex(request.state),
        endpoint: config.endpoint,
        deploymentType: config.deploymentType,
        choice: answer.choice,
        probabilities: answer.probabilities,
        threshold: config.threshold,
        flagged: isFlagged,
        findingId: finding?.id ?? null,
      });
      appendAudit(store, {
        runId,
        stageId,
        actor: NARRATION_AGENT,
        actorType: "agent",
        action: "spec.narration.answer",
        summary: `${id}: ${answer.choice} ${probability}; flagged=${isFlagged}${finding === null ? "" : `; finding=${finding.id}`}; agentRun=${agentRun.id}; model=${outcome.response.model}; round ${round}`,
      });
    });
  }
  return { ok: true, answered: entries.length, flagged };
}
