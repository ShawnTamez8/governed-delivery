import { normalizeLocation } from "./finding.ts";
import type { ReviewerReport } from "./reconciliation.ts";
import type { CommitVerificationRecord } from "./commit-verification.ts";

const LINE_SUFFIX = /^[1-9][0-9]*$/;

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

export interface CodeReviewRemediationRecord {
  author: string;
  baseCommit: string;
  resultingCommit: string;
  changedPaths: string[];
  verification: CommitVerificationRecord;
}

export interface CodeReviewRound {
  round: number;
  reviewedCommit: string;
  changedPaths: string[];
  findings: RecordedFinding[];
  blocking: CodeReviewBlock[];
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
