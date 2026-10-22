import { normalizeLocation } from "./finding.ts";
import type { ReviewerReport } from "./reconciliation.ts";
import type { CommitVerificationRecord } from "./commit-verification.ts";
import type { InspectableProfile } from "./profile.ts";
import { codeReviewPanel } from "./select.ts";
import { REPRODUCTION_FILE_NAME, REPRODUCTION_MAX_CHARS, REPRODUCTION_MAX_COUNT } from "./acceptance.ts";

const LINE_SUFFIX = /^[1-9][0-9]*$/;
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export interface RecordedReport {
  agent: string;
  severity: string;
  classification: "current_artifact";
  subject: string;
}

export interface RecordedFinding {
  id: number;
  location: string;
  intentKey: string;
  reports: RecordedReport[];
}

export interface CodeReviewBlock {
  findingId: number;
  severity: string;
  location: string;
}

/**
 * One preserved check's result at a remediation's commit
 * (docs/features/reproduced-review-findings/plan.md, Task 6): `holds` when every
 * test passed on both repeats, `fails` otherwise, including a run that could
 * not start or left its checkout dirty. A failing check blocks nothing; the
 * next panel is told of it.
 */
export interface CodeReviewPreservedCheck {
  findingId: number;
  reviewer: string;
  fileName: string;
  confirmedInRound: number;
  outcome: "holds" | "fails";
  detail: string | null;
  /** `null` when the check never reached its command. */
  evidenceRef: string | null;
}

export interface CodeReviewRemediationRecord {
  author: string;
  baseCommit: string;
  resultingCommit: string;
  changedPaths: string[];
  verification: CommitVerificationRecord;
  /**
   * Each preserved check's result at `resultingCommit`, in the order they were
   * preserved; empty when the remediation's verification blocked.
   */
  preservedChecks: CodeReviewPreservedCheck[];
}

/**
 * The code-review reconciler's calls before one remediation, in call order,
 * and what they decided (`docs/features/code-review-reconciler/plan.md`).
 * `rejected` holds each finding every call validly rejected, with every call's
 * rationale and excerpt; `kept` is every other finding id, sent to remediation.
 */
export interface CodeReviewReconciliation {
  calls: Array<{
    agentRunId: number | null;
    status: "valid" | "failed" | "unparsed";
    reason: string | null;
    problems: string[];
  }>;
  rejected: Array<{ findingId: number; rationales: string[]; excerpts: string[]; agentRunIds: number[] }>;
  kept: number[];
}

/**
 * What running one reviewer's reproduction against the commit it reviewed
 * showed (docs/features/reproduced-review-findings/plan.md). Evidence only: no
 * outcome changes what the reconciler, remediation or the gate receive.
 */
export interface CodeReviewReproduction {
  findingId: number;
  reviewer: string;
  fileName: string;
  contentSha256: string;
  outcome: "confirmed" | "not_reproduced" | "repro_failed";
  detail: string | null;
  evidenceRef: string | null;
}

export interface CodeReviewRound {
  round: number;
  reviewedCommit: string;
  changedPaths: string[];
  findings: RecordedFinding[];
  blocking: CodeReviewBlock[];
  /** In panel order, then reply order. */
  reproductions: CodeReviewReproduction[];
  reconciliation: CodeReviewReconciliation | null;
  remediation: CodeReviewRemediationRecord | null;
}

export interface CodeReviewRecord {
  runId: number;
  stageId: number;
  worktreePath: string;
  patchBase: string;
  initialVerifiedCommit: string;
  finalVerifiedCommit: string;
  panel: string[];
  panelSize: number;
  maxRounds: number;
  blockingSeverity: string;
  severities: string[];
  rounds: CodeReviewRound[];
  blocking: CodeReviewBlock[];
  outcome: "pass" | "block";
  createdAt: string;
}

export interface PassedCodeReviewVerification {
  expectedCommit: string;
  outcome: "pass";
  blockingCommand: null;
  commands: unknown[];
}

export interface PassedCodeReviewRemediation {
  baseCommit: string;
  resultingCommit: string;
  changedPaths: string[];
  verification: PassedCodeReviewVerification;
}

export interface PassedCodeReviewRound {
  round: number;
  reviewedCommit: string;
  changedPaths: string[];
  findings: unknown[];
  blocking: unknown[];
  remediation: PassedCodeReviewRemediation | null;
}

export interface PassedCodeReviewRecord {
  runId: number;
  stageId: number;
  worktreePath: string;
  patchBase: string;
  initialVerifiedCommit: string;
  finalVerifiedCommit: string;
  panel: string[];
  panelSize: number;
  maxRounds: number;
  blockingSeverity: string;
  severities: string[];
  rounds: PassedCodeReviewRound[];
  blocking: unknown[];
  outcome: "pass";
}

/** Delivery's existing checks do not validate finding, command, or author contents. */
export function parsePassedCodeReviewRecord(
  value: unknown,
  runId: number,
  stageId: number,
  profile: InspectableProfile
): { ok: true; value: PassedCodeReviewRecord } | { ok: false; reason: string } {
  const invalidRecord = "the record does not describe this run's passed code review";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: invalidRecord };
  }
  const parsed = value as Record<string, unknown>;
  const expectedPanel = codeReviewPanel(
    profile.agents,
    profile.policy.codeReviewPanelSize,
    profile.executor.id
  ).map((agent) => agent.id);
  if (
    parsed.runId !== runId ||
    typeof parsed.stageId !== "number" ||
    parsed.stageId !== stageId ||
    parsed.outcome !== "pass" ||
    !Array.isArray(parsed.blocking) ||
    parsed.blocking.length !== 0 ||
    typeof parsed.worktreePath !== "string" ||
    typeof parsed.initialVerifiedCommit !== "string" ||
    !COMMIT.test(parsed.initialVerifiedCommit) ||
    typeof parsed.finalVerifiedCommit !== "string" ||
    !COMMIT.test(parsed.finalVerifiedCommit) ||
    typeof parsed.patchBase !== "string" ||
    !COMMIT.test(parsed.patchBase) ||
    !Array.isArray(parsed.panel) ||
    parsed.panel.some((agent) => typeof agent !== "string") ||
    JSON.stringify(parsed.panel) !== JSON.stringify(expectedPanel) ||
    parsed.panelSize !== profile.policy.codeReviewPanelSize ||
    parsed.panel.length !== parsed.panelSize ||
    parsed.maxRounds !== profile.policy.codeReviewMaxRounds ||
    parsed.blockingSeverity !== profile.policy.codeReviewBlockingSeverity ||
    !Array.isArray(parsed.severities) ||
    JSON.stringify(parsed.severities) !== JSON.stringify(profile.policy.severities) ||
    !Array.isArray(parsed.rounds) ||
    parsed.rounds.length === 0 ||
    parsed.rounds.length > parsed.maxRounds
  ) {
    return { ok: false, reason: invalidRecord };
  }
  const rounds: PassedCodeReviewRound[] = [];
  let expectedReviewedCommit = parsed.initialVerifiedCommit;
  for (let index = 0; index < parsed.rounds.length; index += 1) {
    const candidate: unknown = parsed.rounds[index];
    const invalidRound = `round ${index + 1} does not describe its reviewed commit`;
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, reason: invalidRound };
    }
    const round = candidate as Record<string, unknown>;
    if (
      round.round !== index + 1 ||
      round.reviewedCommit !== expectedReviewedCommit ||
      typeof round.reviewedCommit !== "string" ||
      !COMMIT.test(round.reviewedCommit) ||
      !Array.isArray(round.changedPaths) ||
      round.changedPaths.length === 0 ||
      round.changedPaths.some((path) => typeof path !== "string") ||
      !Array.isArray(round.findings) ||
      !Array.isArray(round.blocking)
    ) {
      return { ok: false, reason: invalidRound };
    }
    const checkedRound: PassedCodeReviewRound = {
      round: index + 1, reviewedCommit: round.reviewedCommit, changedPaths: round.changedPaths,
      findings: round.findings, blocking: round.blocking, remediation: null,
    };
    rounds.push(checkedRound);
    if (round.remediation === null) {
      if (index !== parsed.rounds.length - 1) {
        return { ok: false, reason: `round ${index + 1} has no remediation before another panel` };
      }
      expectedReviewedCommit = round.reviewedCommit;
      continue;
    }
    if (typeof round.remediation !== "object" || Array.isArray(round.remediation)) {
      return { ok: false, reason: `round ${index + 1} has an invalid remediation record` };
    }
    const remediation = round.remediation as Record<string, unknown>;
    const verification = remediation.verification;
    const invalidVerification = `round ${index + 1} does not carry a passed verification for its remediation`;
    if (
      remediation.baseCommit !== round.reviewedCommit ||
      typeof remediation.resultingCommit !== "string" ||
      !COMMIT.test(remediation.resultingCommit) ||
      !Array.isArray(remediation.changedPaths) ||
      remediation.changedPaths.length === 0 ||
      remediation.changedPaths.some((path) => typeof path !== "string") ||
      typeof verification !== "object" ||
      verification === null ||
      Array.isArray(verification)
    ) {
      return { ok: false, reason: invalidVerification };
    }
    const verified = verification as Record<string, unknown>;
    if (
      verified.expectedCommit !== remediation.resultingCommit ||
      verified.outcome !== "pass" ||
      verified.blockingCommand !== null ||
      !Array.isArray(verified.commands)
    ) {
      return { ok: false, reason: invalidVerification };
    }
    checkedRound.remediation = {
      baseCommit: round.reviewedCommit,
      resultingCommit: remediation.resultingCommit,
      changedPaths: remediation.changedPaths,
      verification: {
        expectedCommit: remediation.resultingCommit, outcome: "pass",
        blockingCommand: null, commands: verified.commands,
      },
    };
    expectedReviewedCommit = remediation.resultingCommit;
  }
  if (expectedReviewedCommit !== parsed.finalVerifiedCommit) {
    return { ok: false, reason: "the final verified commit is not the last commit the panel reviewed" };
  }
  const lastRound = rounds[rounds.length - 1]!;
  if (lastRound.remediation !== null || lastRound.blocking.length !== 0) {
    return { ok: false, reason: "the passed final panel is not terminal and non-blocking" };
  }
  return {
    ok: true,
    value: {
      runId, stageId, worktreePath: parsed.worktreePath, patchBase: parsed.patchBase,
      initialVerifiedCommit: parsed.initialVerifiedCommit, finalVerifiedCommit: parsed.finalVerifiedCommit,
      panel: parsed.panel, panelSize: parsed.panelSize, maxRounds: parsed.maxRounds,
      blockingSeverity: parsed.blockingSeverity, severities: parsed.severities,
      rounds, blocking: parsed.blocking, outcome: "pass",
    },
  };
}

export interface CodeReviewGateFinding {
  finding: { id: number; location: string };
  reports: readonly { severity: string; classification: string }[];
}

export interface CodeReviewGatePass {
  round: number;
  maxRounds: number;
  commit: string;
  findings: number;
  blockingSeverity: string;
}

/** One canonical audit handoff binding delivery to the final panel verdict. */
export function formatCodeReviewGatePass(value: CodeReviewGatePass): string {
  return `round=${value.round}/${value.maxRounds}; commit=${value.commit}; findings=${value.findings}; blocking=0; threshold=${value.blockingSeverity}`;
}

export function parseCodeReviewGatePass(
  summary: string
): { ok: true; value: CodeReviewGatePass } | { ok: false; reason: string } {
  const match = /^round=([1-9][0-9]*)\/([1-9][0-9]*); commit=([0-9a-f]{40}(?:[0-9a-f]{24})?); findings=(0|[1-9][0-9]*); blocking=0; threshold=([^;\r\n]+)$/.exec(
    summary
  );
  if (!match) {
    return { ok: false, reason: "does not match the canonical code-review pass handoff" };
  }
  return {
    ok: true,
    value: {
      round: Number(match[1]),
      maxRounds: Number(match[2]),
      commit: match[3]!,
      findings: Number(match[4]),
      blockingSeverity: match[5]!,
    },
  };
}

/**
 * Code review admits only actionable findings in the current code. The shared
 * document-review validator still recognizes `upstream`; this caller refuses
 * it before persistence and then binds every accepted location to the complete
 * changed-path set for the commit under review.
 */
export function validateCodeReviewReports(
  reports: readonly Pick<ReviewerReport, "classification" | "location">[],
  changedPaths: readonly string[]
): string | null {
  const listed = changedPaths.join(", ") || "none";
  for (const report of reports) {
    if (report.classification !== "current_artifact") {
      return `code-review finding classification ${JSON.stringify(
        report.classification
      )} is not current_artifact: this stage accepts only defects correctable in the current code`;
    }
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

/** One reproduction a reviewer attached to one of its own findings, as validated. */
export interface ReviewerReproduction {
  intentKey: string;
  /** Normalized, as the finding it names is. */
  location: string;
  fileName: string;
  content: string;
}

const REPRODUCTION_FIELDS = ["intentKey", "location", "fileName", "content"];

/**
 * A reviewer reply's `proposedContentChanges.reproductions`
 * (docs/features/reproduced-review-findings/plan.md, Task 3), checked against
 * the reply's own validated findings. Every bound the reply schema states is
 * checked again here, because nothing has shown the harness enforces them. It
 * reads its own member only: `validateReviewerReports`, which other stages
 * share, does not change. An absent member is an empty list.
 */
export function validateCodeReviewReproductions(
  raw: unknown,
  reports: readonly Pick<ReviewerReport, "intentKey" | "location">[]
): { ok: true; value: ReviewerReproduction[] } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "proposedContentChanges.reproductions is not an array" };
  if (raw.length > REPRODUCTION_MAX_COUNT) {
    return { ok: false, reason: `the reply carries ${raw.length} reproductions; at most ${REPRODUCTION_MAX_COUNT} are allowed` };
  }
  const value: ReviewerReproduction[] = [];
  const named = new Set<string>();
  const fileNames = new Set<string>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: "a reproduction entry is not an object" };
    }
    const r = entry as { [key: string]: unknown };
    const unknown = Object.keys(r).find((key) => !REPRODUCTION_FIELDS.includes(key));
    if (unknown !== undefined) {
      return { ok: false, reason: `a reproduction carries an unknown field ${unknown}: allowed fields are ${REPRODUCTION_FIELDS.join(", ")}` };
    }
    if (typeof r.intentKey !== "string" || typeof r.location !== "string") {
      return { ok: false, reason: "a reproduction's intentKey and location must be strings" };
    }
    if (typeof r.fileName !== "string" || !REPRODUCTION_FILE_NAME.test(r.fileName)) {
      return { ok: false, reason: `reproduction file name ${JSON.stringify(r.fileName)} does not match ${REPRODUCTION_FILE_NAME.source}` };
    }
    if (fileNames.has(r.fileName)) return { ok: false, reason: `reproduction file name ${r.fileName} is used twice in the reply` };
    fileNames.add(r.fileName);
    // Counted in code points, as the schema's `maxLength` counts them.
    const characters = typeof r.content === "string" ? [...r.content].length : 0;
    if (typeof r.content !== "string" || characters > REPRODUCTION_MAX_CHARS) {
      return {
        ok: false,
        reason: `reproduction ${r.fileName} content must be a string of at most ${REPRODUCTION_MAX_CHARS} characters${typeof r.content === "string" ? `, not ${characters}` : ""}`,
      };
    }
    const location = normalizeLocation(r.location);
    const identity = `${r.intentKey}::${location}`;
    if (!reports.some((report) => report.intentKey === r.intentKey && report.location === location)) {
      return { ok: false, reason: `reproduction ${r.fileName} names no finding of this reply: ${identity}` };
    }
    if (named.has(identity)) return { ok: false, reason: `the reply attaches two reproductions to one finding: ${identity}` };
    named.add(identity);
    value.push({ intentKey: r.intentKey, location, fileName: r.fileName, content: r.content });
  }
  return { ok: true, value };
}

/** The final-panel severity gate, ordered only by the frozen vocabulary. */
export function codeReviewGate(
  findings: readonly CodeReviewGateFinding[],
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
    for (const report of reports) {
      if (report.classification !== "current_artifact") {
        throw new Error(
          `finding ${finding.id} carries classification ${report.classification}, not current_artifact`
        );
      }
      const index = severities.indexOf(report.severity);
      if (index === -1) {
        throw new Error(
          `finding ${finding.id} carries severity ${report.severity}, which is not in the frozen severities ${severities.join(", ")}`
        );
      }
      if (index > highest) highest = index;
    }
    if (highest >= threshold) {
      blocking.push({
        findingId: finding.id,
        severity: severities[highest]!,
        location: finding.location,
      });
    }
  }
  return blocking.length === 0 ? { pass: true } : { pass: false, blocking };
}

export type CodeReviewRoundDecision =
  | { action: "pass" }
  | { action: "remediate" }
  | { action: "block"; blocking: CodeReviewBlock[] };

/**
 * Decide one panel outcome. Any finding triggers remediation while another
 * complete panel remains; only the configured final panel applies severity.
 */
export function decideCodeReviewRound(
  findings: readonly CodeReviewGateFinding[],
  blockingSeverity: string,
  severities: readonly string[],
  hasAnotherRound: boolean
): CodeReviewRoundDecision {
  if (findings.length === 0) return { action: "pass" };
  // Validate every frozen severity and the code-only classification even when
  // the decision is remediation, so invalid evidence never reaches an author.
  const gate = codeReviewGate(findings, blockingSeverity, severities);
  if (hasAnotherRound) return { action: "remediate" };
  return gate.pass ? { action: "pass" } : { action: "block", blocking: gate.blocking };
}
