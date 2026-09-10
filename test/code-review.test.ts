import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAgentResult } from "../src/agent-result.ts";
import {
  codeReviewGate,
  decideCodeReviewRound,
  formatCodeReviewGatePass,
  parseCodeReviewGatePass,
  parsePassedCodeReviewRecord,
  validateCodeReviewReports,
  type CodeReviewRecord,
} from "../src/code-review.ts";
import { extractJsonBody } from "../src/parse-output.ts";
import { upstreamPrefixFor, validateReviewerReports } from "../src/reconciliation.ts";
import { freezeProfile, type Profile } from "../src/profile.ts";
import { policyHash } from "../src/policy.ts";

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

const recordedChain = JSON.parse(readFileSync(new URL(
  "./fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json", import.meta.url
), "utf8")) as { review: CodeReviewRecord };

function withRecordedReview(fn: (record: CodeReviewRecord, profile: Profile) => void): void {
  const parent = resolve("node_modules", ".handoff-parser-tests");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "case-"));
  try {
    const record = structuredClone(recordedChain.review);
    const commands = record.rounds[0]!.remediation!.verification.commands.map((command) => ({
      name: command.name, command: command.argv,
    }));
    const frozen = freezeProfile(root, record.runId, record.patchBase, "test-model", { commands });
    const policy = { ...frozen.profile.policy, codeReviewPanelSize: record.panelSize,
      codeReviewMaxRounds: record.maxRounds, codeReviewBlockingSeverity: record.blockingSeverity,
      severities: record.severities };
    fn(record, { ...frozen.profile, policy, policyHash: policyHash(policy) });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("passed-review parsing preserves the recorded remediation chain as checked subsets", () => {
  withRecordedReview((record, profile) => {
    const result = parsePassedCodeReviewRecord(record, record.runId, record.stageId, profile);
    assert.ok(result.ok, result.ok ? "" : result.reason);
    const parsedValue = result.value;
    const { createdAt: _createdAt, rounds, ...checked } = record;
    assert.deepEqual(parsedValue, {
      ...checked,
      rounds: rounds.map((round) => ({
        ...round,
        remediation: round.remediation === null ? null : {
          baseCommit: round.remediation.baseCommit,
          resultingCommit: round.remediation.resultingCommit,
          changedPaths: round.remediation.changedPaths,
          verification: {
            expectedCommit: round.remediation.verification.expectedCommit,
            outcome: round.remediation.verification.outcome,
            blockingCommand: round.remediation.verification.blockingCommand,
            commands: round.remediation.verification.commands,
          },
        },
      })),
    });
    if (false) {
      // @ts-expect-error The delivery parser does not validate report contents.
      parsedValue.rounds[0]!.findings[0]!.reports;
      // @ts-expect-error The delivery parser does not validate command contents.
      parsedValue.rounds[0]!.remediation!.verification.commands[0]!.exitCode;
      // @ts-expect-error The delivery parser never validates the remediation author.
      parsedValue.rounds[0]!.remediation!.author;
      // @ts-expect-error A createdAt field is not part of the checked handoff.
      parsedValue.createdAt;
    }
  });
});

test("passed-review parsing does not strengthen unvalidated findings, commands, metadata, or paths", () => {
  withRecordedReview((record, profile) => {
    const changed = structuredClone(record) as unknown as Record<string, unknown>;
    delete changed.createdAt;
    changed.worktreePath = "";
    const rounds = changed.rounds as Record<string, unknown>[];
    rounds[0]!.findings = [null, "unvalidated finding"];
    rounds[0]!.blocking = [null];
    rounds[0]!.changedPaths = ["", ""];
    rounds[1]!.findings = [null];
    const remediation = rounds[0]!.remediation as Record<string, unknown>;
    delete remediation.author;
    remediation.changedPaths = ["", ""];
    (remediation.verification as Record<string, unknown>).commands = [null, "unvalidated command"];
    const result = parsePassedCodeReviewRecord(changed, record.runId, record.stageId, profile);
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.deepEqual(result.value.rounds[0]!.findings, rounds[0]!.findings);
    assert.deepEqual(result.value.rounds[0]!.blocking, rounds[0]!.blocking);
    assert.deepEqual(result.value.rounds[1]!.findings, rounds[1]!.findings);
    assert.deepEqual(result.value.rounds[0]!.remediation!.verification.commands, [null, "unvalidated command"]);
    assert.ok(!("createdAt" in result.value));
    assert.ok(!("author" in result.value.rounds[0]!.remediation!));
  });
});

test("passed-review parsing retains top-level identity and frozen panel policy refusals", () => {
  withRecordedReview((record, profile) => {
    for (const changed of [
      null, undefined, false, 1, "", [], {},
      { ...record, runId: record.runId + 1 },
      { ...record, stageId: String(record.stageId) },
      { ...record, stageId: record.stageId + 1 },
      { ...record, outcome: "block" },
      { ...record, blocking: [null] },
      { ...record, worktreePath: null },
      { ...record, initialVerifiedCommit: "bad" },
      { ...record, finalVerifiedCommit: record.finalVerifiedCommit.toUpperCase() },
      { ...record, patchBase: record.patchBase.slice(1) },
      { ...record, panel: record.panel.toReversed() },
      { ...record, panel: [null] },
      { ...record, panelSize: record.panelSize + 1 },
      { ...record, maxRounds: record.maxRounds + 1 },
      { ...record, blockingSeverity: "not-a-severity" },
      { ...record, severities: record.severities.toReversed() },
      { ...record, rounds: [] },
      { ...record, rounds: [...record.rounds, ...record.rounds] },
    ]) {
      assert.deepEqual(parsePassedCodeReviewRecord(changed, record.runId, record.stageId, profile), {
        ok: false, reason: "the record does not describe this run's passed code review",
      });
    }
  });
});

test("passed-review parsing names invalid rounds and preserves final-panel and remediation invariants", () => {
  withRecordedReview((record, profile) => {
    const mutations: [string, (value: Record<string, unknown>) => void, RegExp][] = [
      ["null round", (value) => { (value.rounds as unknown[])[0] = null; }, /round 1 does not describe its reviewed commit/],
      ["wrong ordinal", (value) => { (value.rounds as Record<string, unknown>[])[0]!.round = 2; }, /round 1 does not describe its reviewed commit/],
      ["broken chain", (value) => { (value.rounds as Record<string, unknown>[])[1]!.reviewedCommit = record.initialVerifiedCommit; }, /round 2 does not describe its reviewed commit/],
      ["empty paths", (value) => { (value.rounds as Record<string, unknown>[])[0]!.changedPaths = []; }, /round 1 does not describe its reviewed commit/],
      ["missing findings", (value) => { delete (value.rounds as Record<string, unknown>[])[0]!.findings; }, /round 1 does not describe its reviewed commit/],
      ["early terminal panel", (value) => { (value.rounds as Record<string, unknown>[])[0]!.remediation = null; }, /round 1 has no remediation before another panel/],
      ["missing remediation", (value) => { delete (value.rounds as Record<string, unknown>[])[0]!.remediation; }, /round 1 has an invalid remediation record/],
      ["array remediation", (value) => { (value.rounds as Record<string, unknown>[])[0]!.remediation = []; }, /round 1 has an invalid remediation record/],
      ["wrong final commit", (value) => { value.finalVerifiedCommit = record.initialVerifiedCommit; }, /final verified commit is not the last commit the panel reviewed/],
      ["blocking final panel", (value) => { (value.rounds as Record<string, unknown>[])[1]!.blocking = [null]; }, /passed final panel is not terminal and non-blocking/],
      ["unreviewed final patch", (value) => { value.rounds = [(value.rounds as unknown[])[0]]; }, /passed final panel is not terminal and non-blocking/],
    ];
    for (const [label, mutate, reason] of mutations) {
      const changed = structuredClone(record) as unknown as Record<string, unknown>;
      mutate(changed);
      const result = parsePassedCodeReviewRecord(changed, record.runId, record.stageId, profile);
      assert.ok(!result.ok, label);
      assert.match(result.reason, reason, label);
    }
    for (const changedFields of [
      { baseCommit: record.patchBase },
      { resultingCommit: "bad" },
      { changedPaths: [] },
      { changedPaths: [null] },
      { verification: null },
      { verification: [] },
      { verification: { ...record.rounds[0]!.remediation!.verification, expectedCommit: record.patchBase } },
      { verification: { ...record.rounds[0]!.remediation!.verification, outcome: "block" } },
      { verification: { ...record.rounds[0]!.remediation!.verification, blockingCommand: "node-version" } },
      { verification: { ...record.rounds[0]!.remediation!.verification, commands: null } },
    ]) {
      const changed = structuredClone(record);
      Object.assign(changed.rounds[0]!.remediation!, changedFields);
      assert.deepEqual(parsePassedCodeReviewRecord(changed, record.runId, record.stageId, profile), {
        ok: false, reason: "round 1 does not carry a passed verification for its remediation",
      });
    }
  });
});
