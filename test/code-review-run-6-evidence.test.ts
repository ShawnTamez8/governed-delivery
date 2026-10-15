import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The facts hazard 23 cites about crew-chatter run 6
 * (`docs/features/implementation-self-review/plan.md`, Task 1), read from the
 * fixtures extracted from that run's store and from the paid replay of its
 * round-1 security reviewer, so the hazard rests on committed data.
 */
interface Report { reviewer: string; severity: string; subject: string }
interface Finding {
  findingId: number;
  round: number;
  intentKey: string;
  location: string;
  reports: Report[];
  decision?: { disposition: string; normativeChanges: { artifactText: string }[] | null };
}
interface ReplayFinding { location: string; intentKey: string; subject: string }

const RECORDED = join(process.cwd(), "test", "fixtures", "recorded");
const RUN6 = JSON.parse(readFileSync(join(RECORDED, "code-review-crew-chatter-run-6.json"), "utf8")) as {
  provenance: Record<string, unknown>;
  planReviewDecisions: Finding[];
  codeReviewFindings: Finding[];
};
const REPLAY = JSON.parse(
  readFileSync(join(RECORDED, "code-review-replay-crew-chatter-run-6-security.json"), "utf8")
) as { calls: { label: string; findings: ReplayFinding[] | null }[] };

const decision = (id: number) => {
  const finding = RUN6.planReviewDecisions.find((entry) => entry.findingId === id);
  assert.ok(finding?.decision, `plan-review finding ${id} has a decision`);
  return finding.decision;
};
const codeFinding = (id: number) => {
  const finding = RUN6.codeReviewFindings.find((entry) => entry.findingId === id);
  assert.ok(finding, `code-review finding ${id} is recorded`);
  return finding;
};

test("the run 6 fixture names its run, store, capture date and what it dropped", () => {
  const provenance = RUN6.provenance;
  assert.match(String(provenance.run), /crew-chatter run 6/);
  assert.match(String(provenance.store), /state\.db/);
  assert.equal(provenance.captured, "2026-10-13");
  assert.equal(typeof provenance.dropped, "string");
  assert.ok(String(provenance.dropped).length > 0);
});

test("the run's total and its one remediation dispatch are recorded: 22 dispatches, $4.83619668, $0.5517149", () => {
  const total = RUN6.provenance.runTotal as { dispatches: number; costUsd: number };
  assert.equal(total.dispatches, 22);
  assert.equal(total.costUsd, 4.83619668);
  const dispatches = RUN6.provenance.codeReviewDispatches as { agent: string; cost: number }[];
  assert.deepEqual(dispatches.filter((d) => d.agent === "implementer").map((d) => d.cost), [0.5517149]);
});

test("round 2 has exactly four findings with a high report: 208, 209, 210, 211", () => {
  const high = RUN6.codeReviewFindings
    .filter((finding) => finding.round === 2 && finding.reports.some((report) => report.severity === "high"))
    .map((finding) => finding.findingId)
    .sort((a, b) => a - b);
  assert.deepEqual(high, [208, 209, 210, 211]);
});

test("plan review removed the one-request-in-flight rule (#187) and routed session revocation upstream (#189)", () => {
  const removed = decision(187);
  assert.equal(removed.disposition, "addressed");
  assert.ok(
    (removed.normativeChanges ?? []).some((change) => change.artifactText.includes("A send is never deferred behind an earlier request")),
    "#187 states the never-deferred rule"
  );
  assert.equal(decision(189).disposition, "upstream_follow_up");
  assert.match(String(RUN6.provenance.passwordChangedAtBeforeRemediation), /^absent/);
});

test("the NUL-byte defect appears in round 1 (#201) and again in round 2 (#209)", () => {
  assert.match(codeFinding(201).intentKey, /nul/);
  assert.match(codeFinding(209).intentKey, /nul/);
  assert.equal(codeFinding(201).round, 1);
  assert.equal(codeFinding(209).round, 2);
});

/** A replay finding that is #209 itself: validateEmail lets a NUL byte through. */
const isValidateEmailNul = (finding: ReplayFinding) =>
  finding.location.startsWith("backend/src/features/auth/service.ts") &&
  finding.intentKey.includes("email") &&
  finding.subject.includes("validateEmail") &&
  /NUL|U\+0000|\\u0000/.test(finding.subject);

/** Any replay finding where a NUL byte in an email reaches Postgres, on any path. */
const isEmailNul = (finding: ReplayFinding) =>
  finding.location.startsWith("backend/src/features/auth/service.ts") &&
  finding.intentKey.includes("email") &&
  /NUL|U\+0000|\\u0000/.test(finding.subject);

const controlLabels = (match: (finding: ReplayFinding) => boolean) =>
  REPLAY.calls
    .filter((call) => call.label.startsWith("control-") && (call.findings ?? []).some(match))
    .map((call) => call.label);

test("the round-1 security control replay found #209 itself in exactly one of ten calls: control-4", () => {
  assert.equal(REPLAY.calls.filter((call) => call.label.startsWith("control-")).length, 10);
  assert.deepEqual(controlLabels(isValidateEmailNul), ["control-4"]);
});

test("one other control call, control-6, found a NUL byte in the email on the sign-in path", () => {
  // control-6 names authenticate(), not validateEmail; control-3's email finding is
  // about other control characters reaching the log, not a NUL byte reaching Postgres.
  assert.deepEqual(controlLabels(isEmailNul), ["control-4", "control-6"]);
});
