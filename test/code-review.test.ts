import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAgentResult } from "../src/agent-result.ts";
import {
  codeReviewGate,
  decideCodeReviewRound,
  formatCodeReviewGatePass,
  parseCodeReviewGatePass,
  validateCodeReviewReports,
} from "../src/code-review.ts";
import { extractJsonBody } from "../src/parse-output.ts";
import { upstreamPrefixFor, validateReviewerReports } from "../src/reconciliation.ts";

const SEVERITIES = ["low", "medium", "high", "critical"];

test("the code-review pass handoff has one exact round and commit-bound shape", () => {
  const summary = formatCodeReviewGatePass({
    round: 2,
    maxRounds: 4,
    commit: "a".repeat(40),
    findings: 1,
    blockingSeverity: "high",
  });
  assert.equal(
    summary,
    `round=2/4; commit=${"a".repeat(40)}; findings=1; blocking=0; threshold=high`
  );
  assert.deepEqual(parseCodeReviewGatePass(summary), {
    ok: true,
    value: {
      round: 2,
      maxRounds: 4,
      commit: "a".repeat(40),
      findings: 1,
      blockingSeverity: "high",
    },
  });
  assert.equal(parseCodeReviewGatePass(`${summary}; extra`).ok, false);
});

function finding(severity: string, classification = "current_artifact") {
  return {
    finding: { id: 7, location: "src/a.ts:3" },
    reports: [{ severity, classification }],
  };
}

test("every finding remediates before the final panel, regardless of severity", () => {
  for (const severity of SEVERITIES) {
    assert.deepEqual(decideCodeReviewRound([finding(severity)], "high", SEVERITIES, true), {
      action: "remediate",
    });
  }
});

test("the final panel passes empty and below-threshold findings", () => {
  assert.deepEqual(decideCodeReviewRound([], "high", SEVERITIES, false), { action: "pass" });
  assert.deepEqual(decideCodeReviewRound([finding("low")], "high", SEVERITIES, false), {
    action: "pass",
  });
  assert.deepEqual(decideCodeReviewRound([finding("medium")], "high", SEVERITIES, false), {
    action: "pass",
  });
});

test("the final panel blocks at the frozen threshold and above", () => {
  for (const severity of ["high", "critical"]) {
    const result = decideCodeReviewRound([finding(severity)], "high", SEVERITIES, false);
    assert.equal(result.action, "block");
    if (result.action !== "block") continue;
    assert.deepEqual(result.blocking, [{ findingId: 7, severity, location: "src/a.ts:3" }]);
  }
});

test("the frozen severity order controls the final comparison", () => {
  const frozen = ["low", "high", "medium", "critical"];
  assert.deepEqual(codeReviewGate([finding("high")], "medium", frozen), { pass: true });
  assert.equal(codeReviewGate([finding("medium")], "medium", frozen).pass, false);
});

test("code review refuses upstream classification and locations outside the changed set", () => {
  assert.match(
    String(
      validateCodeReviewReports(
        [{ classification: "upstream", location: "upstream:plan:missing-decision" }],
        ["src/a.ts"]
      )
    ),
    /only defects correctable in the current code/
  );
  assert.match(
    String(
      validateCodeReviewReports(
        [{ classification: "current_artifact", location: "src/b.ts" }],
        ["src/a.ts"]
      )
    ),
    /not one of the changed paths/
  );
  assert.equal(
    validateCodeReviewReports(
      [{ classification: "current_artifact", location: "src/a.ts:3" }],
      ["src/a.ts"]
    ),
    null
  );
});

test("recorded code-review responses still parse through the current code-only contract", () => {
  const fixtures = [
    "code-review-web-calculator-correctness-two-high-findings.json",
    "code-review-web-calculator-security-empty-fenced.json",
    "code-review-web-calculator-correctness-enter-double-activation.json",
    "code-review-web-calculator-remediation-clean-correctness.json",
    "code-review-web-calculator-remediation-clean-security.json",
  ];
  for (const name of fixtures) {
    const recorded = JSON.parse(
      readFileSync(join(process.cwd(), "test", "fixtures", "recorded", name), "utf8")
    ) as {
      provenance: { agent: string; stageContext: { changedPaths: string[] } };
      envelope: { result: string };
    };
    const body = extractJsonBody(recorded.envelope.result);
    if (body.kind !== "ok") assert.fail(`${name}: ${body.reason}`);
    const result = validateAgentResult(recorded.provenance.agent, body.value);
    if (!result.ok) assert.fail(`${name}: ${result.reason}`);
    const content = result.value.proposedContentChanges as { findings?: unknown };
    const reports = validateReviewerReports(content.findings, {
      agentId: recorded.provenance.agent,
      upstreamPrefix: upstreamPrefixFor("plan"),
    });
    if (!reports.ok) assert.fail(`${name}: ${reports.reason}`);
    assert.equal(
      validateCodeReviewReports(reports.value, recorded.provenance.stageContext.changedPaths),
      null,
      name
    );
  }
});
