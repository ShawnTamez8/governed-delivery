import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { validateAgentResult } from "../src/agent-result.ts";
import { appendAudit, type AuditRow } from "../src/audit.ts";
import { canonicalJson, normalizeText, sha256Hex } from "../src/canonical.ts";
import { parsePassedCodeReviewRecord, validateCodeReviewReports, type CodeReviewRecord } from "../src/code-review.ts";
import { runCodeReviewStage } from "../src/code-review-stage.ts";
import { runDeliveryStage } from "../src/delivery-stage.ts";
import { formatImplementationGate, parseImplementationGate, parseVerificationHandoff } from "../src/handoff.ts";
import { acquireLock } from "../src/lock.ts";
import { extractJsonBody } from "../src/parse-output.ts";
import { worktreePath } from "../src/paths.ts";
import { validatePlanDoc } from "../src/plan-doc.ts";
import { policyHash } from "../src/policy.ts";
import { upstreamPrefixFor, validateReviewerReports } from "../src/reconciliation.ts";
import { computeScope } from "../src/scope.ts";
import { computeRisk } from "../src/select.ts";
import { readSpecDeclaredArtifacts, validateSpecDoc } from "../src/spec-doc.ts";
import { runVerificationStage } from "../src/verification-stage.ts";
import { CLAUDE_CODE } from "../src/executor.ts";
import { parseEnvelope } from "../src/harness.ts";
import { boundaryFingerprint, listRuns, readRunSnapshot, RunMissingError } from "../src/operator-state.ts";
import {
  formatOperatorResult, operatorEnvelope, operatorExit, snapshotText,
  type OperatorCommand, type OperatorErrorCode,
} from "../src/operator-output.ts";
import { freezeProfile, loadProfile, type Profile } from "../src/profile.ts";
import { openStore, type AgentRunInput, type RunRow, type StageRow, type Store } from "../src/store.ts";

const recorded = readFileSync(new URL("./fixtures/harness/claude-code-envelope.json", import.meta.url), "utf8");
const envelope = parseEnvelope(CLAUDE_CODE, recorded);

test("operator result serializer has one envelope/newline and the plan's exact outcome exits", () => {
  const cases: [OperatorCommand, string, OperatorErrorCode | null, number][] = [
    ["doctor", "ready", null, 0], ["doctor", "not_ready", "setup_required", 1],
    ["doctor", "error", "usage", 2], ["runs", "ok", null, 0],
    ["runs", "state_missing", "state_missing", 1], ["status", "ok", null, 0],
    ["status", "run_missing", "run_missing", 1], ["status", "error", "target_unavailable", 1],
    ["run", "completed", null, 0], ["run", "awaiting_approval", null, 3],
    ["run", "consent_required", "consent_required", 1], ["run", "refused", "usage", 2],
    ["run", "blocked", "policy_block", 1], ["run", "failed", "execution_failed", 1],
    ...(["schema_unsupported", "state_unavailable", "writer_contention", "observation_changed",
      "run_aged", "chain_incomplete", "evidence_invalid"] as const)
      .map((code): [OperatorCommand, string, OperatorErrorCode, number] => ["run", "refused", code, 1]),
  ];
  for (const [command, outcome, code, exit] of cases) {
    const object = operatorEnvelope(command, null, null, outcome, null, code, code === null ? null : "original diagnostic");
    const bytes = formatOperatorResult(object, true);
    assert.equal(bytes, `${JSON.stringify(object)}\n`);
    assert.deepEqual(Object.keys(JSON.parse(bytes)),
      ["command", "outcome", "repository", "runId", "errorCode", "reason", "observedAt", "result"]);
    assert.equal(operatorExit(object), exit, `${command}/${outcome}/${code}`);
    assert.doesNotMatch(formatOperatorResult(object, false), /\u001b\[/);
  }
});

function withStore(fn: (store: Store, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "bw-operator-state-"));
  const store = openStore(root);
  try {
    fn(store, root);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function agent(store: Store, stageId: number, overrides: Partial<AgentRunInput> = {}) {
  return store.insertAgentRun({
    stageId, agent: "reviewer", role: "reviewer", executor: CLAUDE_CODE.id,
    requestedModel: envelope.effectiveModel!, effectiveModel: envelope.effectiveModel,
    fallback: envelope.fallback, tokensIn: envelope.tokensIn, tokensOut: envelope.tokensOut,
    cacheRead: envelope.cacheRead, cacheWrite: envelope.cacheWrite, cost: envelope.cost,
    durationMs: JSON.parse(recorded).duration_ms, inputHash: sha256Hex("schema-bound observation"),
    outputHash: sha256Hex(recorded), rawOutputRef: "recorded-response.json",
    independence: "configured_standalone", ...overrides,
  });
}

test("run inventory uses selected schema rows, newest IDs, the documented limit and hasMore", () => {
  withStore((store, root) => {
    assert.deepEqual(listRuns(store), { runs: [], limit: 20, hasMore: false });
    assert.throws(() => readRunSnapshot(store, root, 0), RunMissingError);
    const rows = Array.from({ length: 24 }, (_, i) => store.insertRun(`project-${i}`, `feature-${i}`, `slug-${i}`, "feature"));
    const expected = rows.toReversed();
    const page = listRuns(store);
    assert.equal(page.limit, 20);
    assert.equal(page.hasMore, true);
    assert.deepEqual(page.runs.map((r) => r.id), expected.slice(0, page.limit).map((r) => r.id));
    const all = listRuns(store, rows.length);
    assert.equal(all.hasMore, false);
    assert.deepEqual(all.runs.map((r) => [r.project, r.featureId, r.slug, r.status, r.lastRecordedAt]),
      expected.map((r) => [r.project, r.feature_id, r.slug, r.status, r.updated_at]));
    assert.deepEqual(listRuns(store, 1).runs.map((r) => r.id), [expected[0]!.id]);
  });
});

test("run-scoped cost totals derive recorded telemetry before report fan-out and retain unknown coverage", () => {
  withStore((store, root) => {
    const selected = store.insertRun("selected", "selected", "selected", "feature");
    const other = store.insertRun("other", "other", "other", "feature");
    const review = store.insertStage(selected.id, "code_review", null);
    const otherStage = store.insertStage(other.id, "code_review", null);
    const inputs = [
      agent(store, review.id, { agent: "reviewer-one" }),
      agent(store, review.id, { agent: "reviewer-two", cost: 0, tokensOut: 0 }),
      agent(store, review.id, { agent: "implementer", role: "author" }),
      agent(store, review.id, { agent: "reviewer-one", cost: null, tokensIn: null, tokensOut: null, cacheRead: null, cacheWrite: null }),
    ];
    agent(store, otherStage.id, { agent: "reviewer-one" });
    const finding = store.upsertCanonicalFinding(review.id, 1, "recorded-review", "base.txt:1");
    for (const a of inputs.filter((a) => a.role === "reviewer")) {
      store.insertFindingReport({ findingId: finding.id, agentRunId: a.id, severity: "high",
        classification: "current_artifact", subject: "schema-bound report fan-out" });
    }
    for (const runId of [selected.id, other.id]) {
      appendAudit(store, { runId, stageId: runId === selected.id ? review.id : otherStage.id,
        actor: "reviewer-one", actorType: "agent", action: "agent.dispatch.failed", summary: "failed invocation without confirmed telemetry" });
    }
    const { snapshot } = readRunSnapshot(store, root, selected.id);
    const { cost } = snapshot;
    assert.equal(cost.currency, "USD");
    assert.equal(cost.knownUsd, inputs.reduce((sum, a) => sum + (a.cost ?? 0), 0));
    assert.equal(cost.agentRows, inputs.length);
    assert.equal(cost.costReportedRows, inputs.filter((a) => a.cost !== null).length);
    assert.equal(cost.costUnreportedRows, inputs.filter((a) => a.cost === null).length);
    assert.equal(cost.recordedFailedAttempts, store.getAuditEvents(selected.id).filter((a) => a.action === "agent.dispatch.failed").length);
    for (const [output, field] of [
      ["input", "tokens_in"], ["output", "tokens_out"], ["cacheRead", "cache_read"], ["cacheWrite", "cache_write"],
    ] as const) {
      const known = inputs.filter((a) => a[field] !== null);
      assert.deepEqual(cost.tokens[output], { known: known.reduce((sum, a) => sum + a[field]!, 0),
        reportedRows: known.length, unreportedRows: inputs.length - known.length });
    }
    assert.equal(cost.byStage.find((s) => s.stageId === review.id)!.knownUsd, cost.knownUsd);
    assert.deepEqual(cost.byAgent.map((a) => [a.agent, a.knownUsd]),
      [...new Set(inputs.map((a) => a.agent))].sort().map((name) =>
        [name, inputs.filter((a) => a.agent === name).reduce((sum, a) => sum + (a.cost ?? 0), 0)]));
    assert.equal(cost.byAgent.find((a) => a.agent === "implementer")!.knownUsd, envelope.cost);
    assert.equal(snapshot.evidence.findings[0]!.reports.length, inputs.filter((a) => a.role === "reviewer").length);
    const failure = snapshot.evidence.references.filter((r) => r.kind === "raw_directory");
    assert.equal(failure.length, cost.recordedFailedAttempts);
    assert.match(failure[0]!.reason!, /no exact raw-output linkage/);
    assert.ok(snapshot.limitations.some((reason) => /complete bill/.test(reason)));
    const empty = store.insertStage(selected.id, "verification", review.id);
    const emptyTotals = readRunSnapshot(store, root, selected.id).snapshot.cost.byStage.find((s) => s.stageId === empty.id)!;
    assert.equal(emptyTotals.knownUsd, 0);
    assert.deepEqual(emptyTotals.tokens.input, { known: null, reportedRows: 0, unreportedRows: 0 });
  });
});

test("recorded remediation-chain presentation preserves partial telemetry, immutable reports and checked commit evidence", () => {
  const chain = JSON.parse(readFileSync(new URL(
    "./fixtures/recorded/code-review-web-calculator-powershell-remediation-chain.json", import.meta.url), "utf8")) as {
      run: RunRow; stages: StageRow[]; review: CodeReviewRecord; audit: AuditRow[];
      usage: { dispatches: number; costUsd: number };
      dispatches: { provenance: { agent: string; agentRunId: number; durationMs: number; inputSha256: string };
        envelope: unknown }[];
    };
  withStore((store, root) => {
    const run = store.insertRun(chain.run.project, chain.run.feature_id, chain.run.slug, chain.run.change_kind);
    const fixture = join(root, "recorded-excerpt");
    mkdirSync(fixture);
    const absentWorktree = join(fixture, "unavailable-worktree");
    const stages = new Map<number, StageRow>();
    for (const retained of chain.stages) {
      const stage = store.insertStage(run.id, retained.kind,
        retained.input_stage_id === null ? null : stages.get(retained.input_stage_id)!.id);
      const output = retained.kind === "implementation" ? absentWorktree : join(fixture, `${retained.kind}.json`);
      store.exec("UPDATE stage SET output_ref = ?, status = ?, gate_result = ?, started_at = ?, ended_at = ? WHERE id = ?",
        [output, retained.status, retained.gate_result, retained.started_at, retained.ended_at, stage.id]);
      stages.set(retained.id, store.getStage(stage.id)!);
    }
    const reviewStage = stages.get(chain.review.stageId)!;
    const captures = chain.dispatches.map((dispatch) => {
      const raw = JSON.stringify(dispatch.envelope);
      const parsed = parseEnvelope(CLAUDE_CODE, raw);
      const body = extractJsonBody(parsed.resultText);
      assert.equal(body.kind, "ok", JSON.stringify(body));
      const result = validateAgentResult(dispatch.provenance.agent, body.value);
      assert.ok(result.ok, result.ok ? "" : result.reason);
      const rawOutputRef = join(fixture, `dispatch-${dispatch.provenance.agentRunId}.json`);
      writeFileSync(rawOutputRef, raw);
      const row = agent(store, reviewStage.id, {
        agent: result.value.agent, role: result.value.role, executor: result.value.executor,
        requestedModel: parsed.effectiveModel!, effectiveModel: parsed.effectiveModel, fallback: parsed.fallback,
        tokensIn: parsed.tokensIn, tokensOut: parsed.tokensOut, cacheRead: parsed.cacheRead, cacheWrite: parsed.cacheWrite,
        cost: parsed.cost, durationMs: dispatch.provenance.durationMs, inputHash: dispatch.provenance.inputSha256,
        outputHash: sha256Hex(raw), rawOutputRef,
      });
      return { parsed, result: result.value, row };
    });
    const verificationCommands = chain.review.rounds.flatMap((r) => r.remediation?.verification.commands ?? []);
    const frozen = freezeProfile(root, run.id, null, captures[0]!.parsed.effectiveModel!,
      { commands: verificationCommands.map((c) => ({ name: c.name, command: c.argv })) });
    const profile = frozen.profile;
    profile.policy.codeReviewPanelSize = chain.review.panelSize;
    profile.policy.codeReviewMaxRounds = chain.review.maxRounds;
    profile.policy.codeReviewBlockingSeverity = chain.review.blockingSeverity;
    profile.policy.severities = [...chain.review.severities];
    profile.policyHash = policyHash(profile.policy);
    const bytes = canonicalJson(profile);
    writeFileSync(frozen.path, bytes);
    store.setProfileRef(run.id, sha256Hex(bytes));
    const checked = parsePassedCodeReviewRecord(chain.review, chain.run.id, chain.review.stageId, profile);
    assert.ok(checked.ok, checked.ok ? "" : checked.reason);

    const review = structuredClone(chain.review);
    review.runId = run.id;
    review.stageId = reviewStage.id;
    review.worktreePath = absentWorktree;
    for (const round of review.rounds) {
      for (const reviewer of review.panel) {
        const capture = captures.filter((c) => c.row.agent === reviewer)[round.round - 1]!;
        assert.equal(capture.result.role, "reviewer");
        const reports = validateReviewerReports(
          (capture.result.proposedContentChanges as { findings?: unknown }).findings,
          { agentId: reviewer, upstreamPrefix: upstreamPrefixFor("plan") });
        assert.ok(reports.ok, reports.ok ? "" : reports.reason);
        assert.equal(validateCodeReviewReports(reports.value, round.changedPaths), null);
        assert.deepEqual(reports.value, round.findings.flatMap((f) =>
          f.reports.filter((r) => r.agent === reviewer).map((r) => ({
            severity: r.severity, classification: r.classification, subject: r.subject,
            location: f.location, intentKey: f.intentKey,
          }))));
        for (const report of reports.value) {
          const finding = store.upsertCanonicalFinding(reviewStage.id, round.round, report.intentKey, report.location);
          store.insertFindingReport({ findingId: finding.id, agentRunId: capture.row.id,
            severity: report.severity, classification: report.classification, subject: report.subject });
          round.findings.find((f) => f.location === report.location && f.intentKey === report.intentKey)!.id = finding.id;
        }
      }
      if (round.remediation !== null) {
        const author = captures.find((c) => c.row.agent === round.remediation!.author)!;
        assert.equal(author.result.role, "author");
        assert.equal(author.result.proposedPatches![0]!.baseCommit, round.remediation.baseCommit);
        assert.deepEqual(author.result.proposedPatches!.flatMap((p) => p.files.map((f) => f.path)),
          round.remediation.changedPaths);
        round.remediation.verification.commands.forEach((command, index) => {
          command.evidenceRef = join(fixture, `round-${round.round}-command-${index}.unavailable`);
        });
      }
    }
    assert.equal(captures.length, chain.review.rounds.reduce((count, r) =>
      count + chain.review.panel.length + (r.remediation === null ? 0 : 1), 0));
    writeFileSync(reviewStage.output_ref!, JSON.stringify(review));

    const implementationGate = chain.audit.find((a) => a.action === "implementation.gate.pass")!;
    const implementation = parseImplementationGate(implementationGate.summary);
    assert.ok(implementation.ok, implementation.ok ? "" : implementation.reason);
    const verificationStage = [...stages.values()].find((s) => s.kind === "verification")!;
    // The capture retains this handoff's hashes, not the initial command record or a usable historical worktree.
    const verification = { runId: run.id, stageId: verificationStage.id, worktreePath: absentWorktree,
      patchBase: implementation.value.base, verifiedCommit: implementation.value.head, outcome: verificationStage.gate_result };
    const handoff = parseVerificationHandoff(verification, run.id, verificationStage.id);
    assert.ok(handoff.ok, handoff.ok ? "" : handoff.reason);
    writeFileSync(verificationStage.output_ref!, JSON.stringify(verification));
    for (const event of chain.audit.filter((a) =>
      ["implementation.gate.pass", "verification.gate.pass", "code_review.gate.pass"].includes(a.action))) {
      appendAudit(store, { runId: run.id, stageId: stages.get(event.stage_id!)!.id,
        actor: event.actor, actorType: event.actor_type, action: event.action, summary: event.summary });
    }
    store.setRunStatus(run.id, chain.run.status);
    store.exec("UPDATE run SET created_at = ?, updated_at = ? WHERE id = ?",
      [chain.run.created_at, chain.run.updated_at, run.id]);

    const rows = captures.map((c) => c.row);
    const { snapshot } = readRunSnapshot(store, root, run.id);
    assert.equal(snapshot.cost.knownUsd, rows.reduce((sum, row) => sum + (row.cost ?? 0), 0));
    assert.equal(snapshot.cost.agentRows, chain.dispatches.length);
    assert.equal(snapshot.cost.costReportedRows, rows.filter((row) => row.cost !== null).length);
    assert.equal(snapshot.cost.costUnreportedRows, rows.filter((row) => row.cost === null).length);
    assert.ok(snapshot.cost.agentRows < chain.usage.dispatches);
    assert.ok(snapshot.cost.knownUsd < chain.usage.costUsd, "the retained responses are not the complete run's bill");
    for (const [output, field] of [
      ["input", "tokens_in"], ["output", "tokens_out"], ["cacheRead", "cache_read"], ["cacheWrite", "cache_write"],
    ] as const) {
      const known = rows.filter((row) => row[field] !== null);
      assert.deepEqual(snapshot.cost.tokens[output], { known: known.length ? known.reduce((sum, row) => sum + row[field]!, 0) : null,
        reportedRows: known.length, unreportedRows: rows.length - known.length });
    }
    assert.deepEqual(snapshot.cost.byAgent.map((a) => [a.agent, a.agentRows, a.knownUsd]),
      [...new Set(rows.map((r) => r.agent))].sort().map((name) => {
        const selected = rows.filter((row) => row.agent === name);
        return [name, selected.length, selected.reduce((sum, row) => sum + (row.cost ?? 0), 0)];
      }));
    assert.equal(snapshot.cost.byStage.find((s) => s.stageId === reviewStage.id)!.knownUsd, snapshot.cost.knownUsd);
    assert.deepEqual(snapshot.stages.map((s) => [s.kind, s.status, s.gateResult, s.startedAt, s.endedAt]),
      chain.stages.map((s) => [s.kind, s.status, s.gate_result, s.started_at, s.ended_at]));
    assert.deepEqual(snapshot.evidence.findings.map((f) => ({
      round: f.round, location: f.location, intentKey: f.intentKey,
      reports: f.reports.map((r) => ({ agent: r.reviewerId, severity: r.severity,
        classification: r.classification, subject: r.subject })),
    })), chain.review.rounds.flatMap((r) => r.findings.map((f) => ({
      round: r.round, location: f.location, intentKey: f.intentKey, reports: f.reports,
    }))));
    assert.ok(snapshot.evidence.findings.every((f) => f.finalPanelBlocking === null && f.decision === null));
    assert.equal(snapshot.delivery.patchBase, checked.value.patchBase);
    assert.equal(snapshot.delivery.initialVerifiedCommit, checked.value.initialVerifiedCommit);
    assert.equal(snapshot.delivery.finalReviewedCommit, checked.value.finalVerifiedCommit);
    assert.notEqual(snapshot.delivery.initialVerifiedCommit, snapshot.delivery.finalReviewedCommit);
    assert.deepEqual(snapshot.delivery.verification.filter((v) => v.round !== null).map((v) => ({
      round: v.round, commit: v.commit, outcome: v.outcome, commands: v.commands,
    })), review.rounds.flatMap((r) => r.remediation === null ? [] : [{
      round: r.round, commit: r.remediation.resultingCommit, outcome: r.remediation.verification.outcome,
      commands: r.remediation.verification.commands,
    }]));
    assert.equal(snapshot.phase, "completed");
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.equal(snapshot.delivery.branch, null);
    assert.equal(snapshot.delivery.deliveredCommit, null);
    assert.ok(snapshot.limitations.some((reason) => /command projection.*incomplete or malformed/.test(reason)));
    assert.ok(snapshot.limitations.some((reason) => /complete bill/.test(reason)));
    assert.ok(snapshot.limitations.some((reason) => /do not prove product correctness/.test(reason)));
    for (const reference of snapshot.evidence.references) {
      assert.ok(resolve(root, reference.ref).startsWith(`${root}\\`), "all inspected paths belong to this disposable fixture");
    }
    const output = formatOperatorResult(operatorEnvelope("status", root, run.id, "ok", snapshot), true);
    assert.deepEqual(JSON.parse(output).result, snapshot);
    const text = snapshotText(snapshot);
    for (const report of snapshot.evidence.findings.flatMap((f) => f.reports)) assert.ok(text.includes(report.subject));
    assert.ok(text.includes(snapshot.delivery.initialVerifiedCommit!));
    assert.ok(text.includes(snapshot.delivery.finalReviewedCommit!));
    assert.doesNotMatch(output, /proposedPatches|proposedContentChanges|resultText/);
  });
});

test("stage timing comes from actual end/create-audit rows, and dispatch audit is not run updated_at", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  withStore((store, root) => {
    const run = store.insertRun("timing", "timing", "timing", "feature");
    t.mock.timers.tick(1000);
    const stage = store.insertStage(run.id, "spec", null);
    store.setStageStatus(stage.id, "in_progress");
    assert.equal(store.getStage(stage.id)!.started_at, null);
    assert.equal(readRunSnapshot(store, root, run.id).snapshot.stages[0]!.startEvidence.source, null);
    appendAudit(store, { runId: run.id, stageId: stage.id, actor: "system", actorType: "cli",
      action: "spec.stage.create", summary: "created the specification stage" });
    const start = store.getAuditEvents(run.id).at(-1)!;
    let snapshot = readRunSnapshot(store, root, run.id).snapshot;
    assert.deepEqual(snapshot.stages[0]!.startEvidence, { at: start.created_at, source: "stage_create_audit", auditId: start.id });
    t.mock.timers.tick(1000);
    agent(store, stage.id, { agent: "spec-author", role: "author" });
    snapshot = readRunSnapshot(store, root, run.id).snapshot;
    assert.equal(snapshot.activity.lastRecordedAt, start.created_at, "an agent row has no fabricated invocation timestamp");
    assert.equal(store.getRun(run.id)!.updated_at, run.updated_at);
    appendAudit(store, { runId: run.id, stageId: stage.id, actor: "spec-author", actorType: "agent",
      action: "agent.dispatch", summary: "the recorded dispatch event" });
    const dispatch = store.getAuditEvents(run.id).at(-1)!;
    snapshot = readRunSnapshot(store, root, run.id).snapshot;
    assert.equal(snapshot.activity.lastRecordedAt, dispatch.created_at);
    assert.equal(snapshot.activity.lastEvent!.id, dispatch.id);
    t.mock.timers.tick(1000);
    store.completeStage(stage.id, "missing-spec.md", "pass");
    const completed = store.getStage(stage.id)!;
    snapshot = readRunSnapshot(store, root, run.id).snapshot;
    assert.equal(snapshot.stages[0]!.startedAt, null);
    assert.equal(snapshot.stages[0]!.endedAt, completed.ended_at);
    assert.equal(snapshot.activity.lastRecordedAt, completed.ended_at);
    assert.equal(listRuns(store).runs[0]!.lastRecordedAt, completed.ended_at);
  });
});

test("large selected finding/report/decision arrays are complete in text and JSON without raw payloads", () => {
  withStore((store, root) => {
    const run = store.insertRun("large", "large", "large", "feature");
    const stage = store.insertStage(run.id, "spec_review", null);
    const reviewers = [agent(store, stage.id, { agent: "reviewer-one" }), agent(store, stage.id, { agent: "reviewer-two" })];
    const inserted = Array.from({ length: 1105 }, (_, i) => {
      const finding = store.upsertCanonicalFinding(stage.id, 1, `finding-${i}`, `requirement-${i}`);
      const reports = reviewers.map((reviewer) => store.insertFindingReport({ findingId: finding.id, agentRunId: reviewer.id,
        severity: "high", classification: "current_artifact", subject: `schema-permitted report ${i}` }));
      return { finding, reports };
    });
    const decision = store.insertFindingDecision({ findingId: inserted[0]!.finding.id, agentRunId: reviewers[0]!.id,
      disposition: "addressed", rationale: "recorded document decision", changedLocations: ["requirement-0"],
      grounding: null, normativeChanges: [], artifactHashBefore: sha256Hex("before"), artifactHashAfter: sha256Hex("after") });
    store.setRunStatus(run.id, "blocked");
    const snapshot = readRunSnapshot(store, root, run.id).snapshot;
    const json = formatOperatorResult(operatorEnvelope("status", root, run.id, "ok", snapshot), true);
    assert.equal(json.split("\n").length, 2);
    const parsed = JSON.parse(json).result;
    assert.deepEqual(parsed.evidence.findings.map((f: { id: number }) => f.id), inserted.map(({ finding }) => finding.id));
    assert.deepEqual(parsed.evidence.findings.flatMap((f: { reports: { id: number }[] }) => f.reports.map((r) => r.id)),
      inserted.flatMap(({ reports }) => reports.map((r) => r.id)));
    const { finding_id: _findingId, ...expectedDecision } = decision;
    assert.deepEqual(parsed.evidence.findings[0].decision, JSON.parse(JSON.stringify(expectedDecision)));
    assert.ok(snapshot.evidence.findings.every((f) => f.finalPanelBlocking === null));
    const text = snapshotText(snapshot);
    const textSnapshot = JSON.parse(text.slice(text.indexOf("Recorded snapshot:\n") + "Recorded snapshot:\n".length));
    assert.deepEqual(textSnapshot, parsed);
    assert.doesNotMatch(text, /\u001b\[|modelUsage|terminal_reason|subagent_stats/);
    assert.equal(snapshot.phase, "blocked");
    assert.equal(snapshot.workflowAction.eligible, false);
  });
});

test("profile and approval projections preserve original bindings while missing evidence stays inspectable", () => {
  withStore((store, root) => {
    const run = store.insertRun("profile", "profile", "profile", "feature");
    const configuration = { commands: [{ name: "node", command: ["node", "--version"] }] };
    const frozen = freezeProfile(root, run.id, null, envelope.effectiveModel!, configuration);
    store.setProfileRef(run.id, frozen.hash);
    const stage = store.insertStage(run.id, "spec", null);
    store.completeStage(stage.id, "absent-spec.md", "pass");
    const approved = store.insertApproval({ runId: run.id, featureId: run.feature_id, specHash: sha256Hex("spec"),
      startingCommit: sha256Hex("commit"), profileHash: frozen.hash, risk: "low", scope: JSON.stringify(["src/"]),
      expiresAt: new Date(0).toISOString(), signature: "approval-signature-must-not-be-displayed", signer: "public-fingerprint" });
    const snapshot = readRunSnapshot(store, root, run.id).snapshot;
    assert.deepEqual(snapshot.configuration.modelMap, frozen.profile.modelMap);
    assert.deepEqual(snapshot.configuration.verificationCommands,
      configuration.commands.map((c) => ({ name: c.name, argv: c.command })));
    assert.equal(snapshot.configuration.profileHash, frozen.hash);
    assert.equal(snapshot.configuration.policyHash, frozen.profile.policyHash);
    assert.equal(snapshot.configuration.deadline,
      new Date(Date.parse(run.created_at) + frozen.profile.policy.runDurationLimitSeconds * 1000).toISOString());
    assert.equal(snapshot.approval.id, approved.id);
    assert.equal(snapshot.approval.state, "granted");
    assert.equal(snapshot.approval.expiresAt, approved.expires_at);
    assert.deepEqual(snapshot.approval.scope, JSON.parse(approved.scope));
    assert.doesNotMatch(JSON.stringify(snapshot), /approval-signature-must-not-be-displayed/);
    assert.ok(snapshot.limitations.some((s) => s.includes("absent-spec.md")));
    assert.ok(snapshot.evidence.references.some((r) => r.ref === stage.output_ref || r.ref === "absent-spec.md"));
    rmSync(frozen.path);
    const missing = readRunSnapshot(store, root, run.id).snapshot;
    assert.equal(missing.configuration.profileHash, null);
    assert.equal(missing.configuration.modelMap, null);
    assert.equal(missing.configuration.verificationCommands, null);
    assert.equal(missing.approval.id, approved.id);
    assert.equal(missing.stages[0]!.id, stage.id);
    assert.ok(missing.limitations.some((s) => /no frozen profile/.test(s)));
  });
});

test("boundary fingerprint uses the explicit selected row tuples without wall clock or unrelated audit events", () => {
  withStore((store) => {
    const run = store.insertRun("fingerprint", "fingerprint", "fingerprint", "feature");
    const stage = store.insertStage(run.id, "spec", null);
    appendAudit(store, { runId: run.id, stageId: stage.id, actor: "system", actorType: "cli",
      action: "spec.stage.create", summary: "recorded boundary" });
    const audit = store.getAuditEvents(run.id);
    const expected = sha256Hex(JSON.stringify([
      [run.id, run.project, run.feature_id, run.slug, run.change_kind, run.status, run.profile_ref, run.created_at, run.updated_at],
      [[stage.id, stage.run_id, stage.kind, stage.ordinal, stage.input_stage_id, stage.output_ref, stage.status,
        stage.gate_result, stage.started_at, stage.ended_at]],
      audit.map((a) => [a.id, a.run_id, a.stage_id, a.actor, a.actor_type, a.action, a.summary, a.hash, a.prev_hash, a.created_at]),
    ]));
    assert.equal(boundaryFingerprint(run, [stage], audit), expected);
    const other = store.insertRun("other", "other", "other", "feature");
    appendAudit(store, { runId: other.id, stageId: null, actor: "system", actorType: "cli",
      action: "run.create", summary: "unrelated" });
    assert.equal(boundaryFingerprint(store.getRun(run.id), [stage], store.getAuditEvents(run.id)), expected);
    assert.notEqual(boundaryFingerprint(undefined, [stage], audit), expected);
  });
});

test("snapshot detects selected boundary changes across evidence reads without treating another run as changed", (t) => {
  withStore((store, root) => {
    const selected = store.insertRun("selected", "selected", "selected", "feature");
    const other = store.insertRun("other", "other", "other", "feature");
    const original = store.readSnapshot.bind(store);
    let reads = 0;
    let changingRun = other.id;
    const observe: Store["readSnapshot"] = (fn) => {
      const value = original(fn);
      if (++reads === 1) {
        appendAudit(store, { runId: changingRun, stageId: null, actor: "system", actorType: "cli",
          action: "profile.freeze.failed", summary: "a recorded change between database observations" });
      }
      return value;
    };
    const mocked = t.mock.method(store, "readSnapshot", observe);
    const unrelated = readRunSnapshot(store, root, selected.id);
    assert.equal(reads, 2);
    assert.ok(!unrelated.snapshot.workflowAction.reasons.some((r) => r.code === "observation_changed"));
    reads = 0;
    changingRun = selected.id;
    const changed = readRunSnapshot(store, root, selected.id);
    assert.equal(reads, 2);
    assert.equal(changed.snapshot.workflowAction.eligible, false);
    assert.equal(changed.snapshot.workflowAction.reasons[0]!.code, "observation_changed");
    assert.ok(changed.snapshot.limitations.some((r) => /boundary changed during inspection/.test(r)));
    mocked.mock.restore();
  });
});

function git(root: string, ...args: string[]): string {
  const result = spawnSync("git", ["--no-optional-locks", ...args], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout.trim();
}

function commitAll(root: string): string {
  git(root, "add", "-A");
  git(root, "-c", "user.name=BuildWorks", "-c", "user.email=buildworks@example.invalid", "commit", "-qm", "schema-bound fixture");
  return git(root, "rev-parse", "HEAD");
}

interface BoundaryContext {
  root: string;
  store: Store;
  runId: number;
  profile: Profile;
  specPath: string;
  planPath: string;
  worktree: string;
  initialCommit: string | null;
}

async function withBoundary(prefix: number, fn: (ctx: BoundaryContext) => void | Promise<void>,
  options: { omitAudit?: string; mode?: string; blockedReview?: boolean; freeze?: (profile: Profile) => void } = {}): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-operator-boundary-"));
  const store = openStore(root);
  const oldMode = process.env.EMIT_MODE;
  process.env.EMIT_MODE = options.mode ?? "ok";
  try {
    git(root, "init", "-q");
    writeFileSync(join(root, ".gitignore"), ".governance/\n*.scratch\n");
    writeFileSync(join(root, "base.txt"), "schema-bound worktree marker\n");
    writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: node\n    command: ["node", "--version"]\n');
    const specPath = join(root, "docs", "features", "demo", "spec.md");
    const planPath = join(root, "docs", "features", "demo", "plan.md");
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(join(dirname(specPath), "design.md"), "# design\nThe declared artifact must be committed.\n");
    const startingCommit = commitAll(root);
    const run = store.insertRun("operator", "demo", "demo", "feature");
    const frozen = freezeProfile(root, run.id, startingCommit, "fixture-model",
      { commands: [{ name: "node", command: ["node", "--version"] }] });
    const { profile } = loadProfile(root, run.id);
    profile.approvalSigner = null;
    profile.executor = { ...profile.executor,
      command: [process.execPath, resolve("test", "fixtures", "harness", "emit-code-review.mjs")],
      probe: [process.execPath, "--version"],
      sandbox: { ...profile.executor.sandbox, envPassthrough: [...profile.executor.sandbox.envPassthrough, "EMIT_MODE"] } };
    options.freeze?.(profile);
    profile.policyHash = policyHash(profile.policy);
    const serialized = canonicalJson(profile);
    writeFileSync(frozen.path, serialized);
    store.setProfileRef(run.id, sha256Hex(serialized));
    const exec = store.exec.bind(store);
    if (options.omitAudit) store.exec = (sql, params = []) => {
      if (sql.startsWith("INSERT INTO audit") && params[4] === options.omitAudit) return;
      exec(sql, params);
    };
    const audit = (stageId: number, action: string, summary: string) =>
      appendAudit(store, { runId: run.id, stageId, actor: "system", actorType: "cli", action, summary });
    const specification = `feature: demo
change_kind: feature

## Declared artifacts

- src/a1.ts

## Acceptance criteria

- AC-001: The declared artifact must be committed.
`;
    const spec = validateSpecDoc(specification);
    assert.ok(spec.ok, spec.ok ? "" : spec.reason);
    const scope = computeScope(spec.value.declaredArtifacts);
    const risk = computeRisk(run.change_kind, scope.length, false);
    const specHash = sha256Hex(normalizeText(specification));
    const planText = `feature: demo
plan_for: ${specHash}

## Tasks

- Commit the declared artifact.

## Coverage

- ${spec.value.acceptanceCriteria[0]!.id} -> ${scope[0]}
`;
    const plan = validatePlanDoc(planText);
    assert.ok(plan.ok, plan.ok ? "" : plan.reason);
    let predecessor: number | null = null;
    const stage = (kind: string, ref: string) => {
      const row = store.insertStage(run.id, kind, predecessor);
      audit(row.id, kind === "awaiting_approval" ? "approval.stage.create" : `${kind}.stage.create`, `created ${kind} stage ${row.id}`);
      store.completeStage(row.id, ref, "pass");
      predecessor = row.id;
      return row.id;
    };
    if (prefix >= 1) { writeFileSync(specPath, specification); stage("spec", specPath); }
    if (prefix >= 2) audit(stage("spec_review", specPath), "spec.gate.pass", `spec_review gate passed in round 1; specHash=${specHash}; risk=${risk}`);
    if (prefix >= 3) {
      const approvalStage = stage("awaiting_approval", specPath);
      const approval = store.insertApproval({ runId: run.id, featureId: run.feature_id, specHash, startingCommit,
        profileHash: store.getRun(run.id)!.profile_ref!, risk, scope: canonicalJson(scope),
        expiresAt: new Date(0).toISOString(), signature: "schema-permitted historical approval", signer: "fixture-signer" });
      audit(approvalStage, "approval.granted", `approval ${approval.id} verified for run ${run.id}, signer ${approval.signer}; signer not bound at intake`);
    }
    if (prefix >= 4) { writeFileSync(planPath, planText); stage("plan", planPath); }
    if (prefix >= 5) audit(stage("plan_review", planPath), "plan.gate.pass",
      `plan_review gate passed in round 1; planHash=${sha256Hex(normalizeText(planText))}; planFor=${specHash}`);
    const worktree = worktreePath(root, run.id);
    let initialCommit: string | null = null;
    if (prefix >= 6) {
      git(root, "worktree", "add", "-q", worktree, "-b", `gov/demo/${run.id}`, startingCommit);
      const docs = join(worktree, "docs", "features", "demo");
      mkdirSync(docs, { recursive: true });
      writeFileSync(join(docs, "spec.md"), specification);
      writeFileSync(join(docs, "plan.md"), planText);
      const base = commitAll(worktree);
      for (const artifact of scope) {
        const path = join(worktree, artifact);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "schema-bound committed artifact\n");
      }
      initialCommit = commitAll(worktree);
      audit(stage("implementation", worktree), "implementation.gate.pass", formatImplementationGate({ base, head: initialCommit }));
    }
    if (prefix >= 7) {
      const result = await runVerificationStage(store, { runId: run.id, rootDir: root });
      assert.ok(result.ok, result.ok ? "" : result.reason);
    }
    if (prefix >= 8) {
      const result = await runCodeReviewStage(store, profile.executor, { runId: run.id, rootDir: root });
      assert.equal(result.ok, !options.blockedReview, result.ok ? "" : result.reason);
    }
    if (prefix >= 9) {
      const result = runDeliveryStage(store, { runId: run.id, rootDir: root });
      assert.ok(result.ok, result.ok ? "" : result.reason);
    }
    await fn({ root, store, runId: run.id, profile, specPath, planPath, worktree, initialCommit });
  } finally {
    store.close();
    if (oldMode === undefined) delete process.env.EMIT_MODE;
    else process.env.EMIT_MODE = oldMode;
    rmSync(root, { recursive: true, force: true });
  }
}

test("every architecture prefix exposes only its exact next group, including the approval pause without a row", async (t) => {
  const expected = [
    [0, "spec", "ready"], [2, "approval", "awaiting_approval"], [3, "plan", "ready"],
    [5, "implementation", "ready"], [6, "verification", "ready"], [7, "code_review", "ready"],
    [8, "delivery_check", "ready"], [9, null, "completed"],
  ] as const;
  for (const [prefix, group, phase] of expected) await t.test(`prefix ${prefix}`, async () => {
    await withBoundary(prefix, ({ store, root, runId }) => {
      const { snapshot } = readRunSnapshot(store, root, runId);
      assert.equal(snapshot.phase, phase, JSON.stringify(snapshot.workflowAction.reasons));
      assert.equal(snapshot.workflowAction.group, group);
      assert.equal(snapshot.workflowAction.eligible, group !== null, JSON.stringify(snapshot.workflowAction.reasons));
      assert.equal(snapshot.stages.length, prefix);
      if (prefix === 2) {
        assert.equal(store.getApproval(runId), undefined);
        assert.equal(snapshot.approval.state, "missing");
        assert.ok(snapshot.approval.scope!.length > 0);
        assert.equal(store.getStageChain(runId).some((s) => s.kind === "awaiting_approval"), false);
      }
      if (prefix >= 3) assert.equal(snapshot.approval.expiresAt, new Date(0).toISOString(), "elapsed expiry is not post-grant revocation");
    });
  });
});

test("partial document groups and manual, skipped, pending or contradictory row chains never continue", async (t) => {
  for (const prefix of [1, 4]) await t.test(`partial group ${prefix}`, () => withBoundary(prefix, ({ store, root, runId }) => {
    const { snapshot } = readRunSnapshot(store, root, runId);
    assert.equal(snapshot.phase, "interrupted_or_inconsistent");
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.code === "chain_incomplete"));
  }));
  for (const [name, mutation] of [
    ["unknown", "UPDATE stage SET kind = 'manual' WHERE ordinal = 1"],
    ["pending", "UPDATE stage SET status = 'pending' WHERE ordinal = 1"],
    ["in progress", "UPDATE stage SET status = 'in_progress' WHERE ordinal = 1"],
    ["failed", "UPDATE stage SET status = 'failed' WHERE ordinal = 1"],
    ["skipped", "UPDATE stage SET ordinal = 3 WHERE ordinal = 1"],
    ["predecessor", "UPDATE stage SET input_stage_id = NULL WHERE ordinal = 1"],
    ["missing output", "UPDATE stage SET output_ref = NULL WHERE ordinal = 1"],
    ["gate", "UPDATE stage SET gate_result = 'block' WHERE ordinal = 1"],
    ["false completed", "UPDATE run SET status = 'completed'"],
  ]) await t.test(name!, () => withBoundary(2, ({ store, root, runId }) => {
    store.exec(mutation!);
    const { snapshot } = readRunSnapshot(store, root, runId);
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.code === "chain_incomplete"));
  }));
});

test("each missing stage-create or gate audit window refuses without erasing readable rows", async (t) => {
  const cases = [
    [2, "spec.stage.create"], [2, "spec_review.stage.create"], [2, "spec.gate.pass"],
    [3, "approval.stage.create"], [3, "approval.granted"], [5, "plan.stage.create"],
    [5, "plan_review.stage.create"], [5, "plan.gate.pass"], [6, "implementation.stage.create"],
    [6, "implementation.gate.pass"], [7, "verification.stage.create"], [7, "verification.gate.pass"],
    [8, "code_review.stage.create"], [8, "code_review.gate.pass"],
  ] as const;
  for (const [prefix, omitted] of cases) await t.test(omitted, () => withBoundary(prefix, ({ store, root, runId }) => {
    const { snapshot } = readRunSnapshot(store, root, runId);
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.equal(snapshot.stages.length, prefix);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.code === "evidence_invalid" && r.reason.includes(omitted)));
  }, { omitAudit: omitted }));
});

test("bound specification, plan, approval and retained handoffs reject edits before continuation", async (t) => {
  const changes: [string, number, (ctx: BoundaryContext) => void][] = [
    ["spec hash", 3, (c) => writeFileSync(c.specPath, `${readFileSync(c.specPath, "utf8")}\nEdited.\n`)],
    ["plan hash", 5, (c) => writeFileSync(c.planPath, `${readFileSync(c.planPath, "utf8")}\nEdited.\n`)],
    ["scope", 3, (c) => c.store.exec("UPDATE approval SET scope = ?", [JSON.stringify(["other.ts"])])],
    ["feature", 3, (c) => c.store.exec("UPDATE approval SET feature_id = 'other'")],
    ["profile binding", 3, (c) => c.store.exec("UPDATE approval SET profile_hash = ?", [sha256Hex("other")])],
    ["starting commit", 3, (c) => c.store.exec("UPDATE approval SET starting_commit = ?", [sha256Hex("other")])],
    ["missing approval", 3, (c) => c.store.exec("DELETE FROM approval")],
    ["missing verification", 7, (c) => rmSync(resolve(c.root, c.store.getStageChain(c.runId).at(-1)!.output_ref!))],
    ["verification identity", 7, (c) => {
      const path = resolve(c.root, c.store.getStageChain(c.runId).at(-1)!.output_ref!);
      const record = JSON.parse(readFileSync(path, "utf8"));
      record.runId++;
      writeFileSync(path, JSON.stringify(record));
    }],
    ["review final commit", 8, (c) => {
      const path = resolve(c.root, c.store.getStageChain(c.runId).at(-1)!.output_ref!);
      const record = JSON.parse(readFileSync(path, "utf8"));
      record.finalVerifiedCommit = record.patchBase;
      writeFileSync(path, JSON.stringify(record));
    }],
  ];
  for (const [name, prefix, mutate] of changes) await t.test(name, () => withBoundary(prefix, (ctx) => {
    mutate(ctx);
    const { snapshot } = readRunSnapshot(ctx.store, ctx.root, ctx.runId);
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.code === "evidence_invalid"));
  }));
});

test("a legitimately remediated review keeps historical initial and final commit handoffs distinct", async () => {
  await withBoundary(8, ({ store, root, runId, initialCommit, worktree, profile }) => {
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, true, JSON.stringify(snapshot.workflowAction.reasons));
    assert.equal(snapshot.delivery.initialVerifiedCommit, initialCommit);
    assert.notEqual(snapshot.delivery.finalReviewedCommit, initialCommit);
    assert.equal(snapshot.delivery.finalReviewedCommit, git(worktree, "rev-parse", "HEAD"));
    assert.equal(snapshot.delivery.verification.length, 2);
    assert.deepEqual(snapshot.delivery.verification.map((v) => v.commands.map((c) => c.argv)),
      snapshot.delivery.verification.map(() => profile.verification.commands.map((c) => c.command)));
    assert.ok(snapshot.evidence.findings.every((f) => f.finalPanelBlocking === null), "earlier findings are historical, not synthesized fixed verdicts");
  }, { mode: "high-then-clean" });
});

test("worktree observations preserve index bytes and match each core boundary's cleanliness policy", async (t) => {
  for (const prefix of [6, 7, 8]) await t.test(`index at ${prefix}`, () => withBoundary(prefix, ({ store, root, runId, worktree }) => {
    const index = git(worktree, "rev-parse", "--git-path", "index");
    const bytes = readFileSync(index);
    const mtime = statSync(index).mtimeMs;
    const artifact = join(worktree, "src", "a1.ts");
    const now = new Date();
    utimesSync(artifact, now, now);
    const previous = process.env.GIT_OPTIONAL_LOCKS;
    process.env.GIT_OPTIONAL_LOCKS = "1";
    try {
      const snapshot = readRunSnapshot(store, root, runId).snapshot;
      assert.equal(snapshot.workflowAction.eligible, true, JSON.stringify(snapshot.workflowAction.reasons));
      assert.deepEqual(readFileSync(index), bytes);
      assert.equal(statSync(index).mtimeMs, mtime);
    } finally {
      if (previous === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
      else process.env.GIT_OPTIONAL_LOCKS = previous;
    }
  }));
  for (const prefix of [7, 8]) await t.test(`ignored and untracked at ${prefix}`, () => withBoundary(prefix, ({ store, root, runId, worktree }) => {
    writeFileSync(join(worktree, "temporary.scratch"), "ignored fixture\n");
    writeFileSync(join(worktree, "untracked.txt"), "untracked fixture\n");
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, prefix === 8, JSON.stringify(snapshot.workflowAction.reasons));
  }));
  await withBoundary(6, ({ store, root, runId, worktree }) => {
    writeFileSync(join(worktree, "src", "a1.ts"), "uncommitted\n");
    assert.equal(readRunSnapshot(store, root, runId).snapshot.workflowAction.eligible, false);
  });
  await withBoundary(7, ({ store, root, runId, worktree }) => {
    writeFileSync(join(worktree, "src", "a1.ts"), "a later committed change\n");
    const later = commitAll(worktree);
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.reason.includes(`the worktree is at ${later}, not the bound commit`)));
  });
  await withBoundary(7, ({ store, root, runId, worktree }) => {
    git(root, "worktree", "remove", "--force", worktree);
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.ok(snapshot.workflowAction.reasons.some((r) => /cannot read worktree head/.test(r.reason)));
  });
});

test("guided age uses strict greater-than and observing its own lock requires explicit owned-writer context", async (t) => {
  await withBoundary(0, ({ store, root, runId, profile }) => {
    const deadline = Date.parse(store.getRun(runId)!.created_at) + profile.policy.runDurationLimitSeconds * 1000;
    t.mock.timers.enable({ apis: ["Date"], now: deadline });
    assert.equal(readRunSnapshot(store, root, runId).snapshot.workflowAction.eligible, true);
    t.mock.timers.tick(1);
    const aged = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(aged.workflowAction.eligible, false);
    assert.match(aged.workflowAction.reasons.find((r) => r.code === "run_aged")!.reason, /guided-entry.*Low-level spec\/plan/);
    t.mock.timers.reset();
    const release = acquireLock(root);
    try {
      const observed = readRunSnapshot(store, root, runId).snapshot;
      assert.equal(observed.workflowAction.eligible, false);
      assert.ok(observed.workflowAction.reasons.some((r) => r.code === "writer_contention"));
      assert.equal(readRunSnapshot(store, root, runId, { ownedWriter: true }).snapshot.workflowAction.eligible, true);
    } finally { release(); }
  });
});

test("completed records remain terminal when present-day evidence is missing, without invented delivery facts", async () => {
  await withBoundary(9, ({ store, root, runId }) => {
    const before = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(before.delivery.deliveredCommit, before.delivery.finalReviewedCommit);
    assert.deepEqual(before.delivery.deliveredPaths, before.approval.scope);
    const stage = store.getStageChain(runId).at(-1)!;
    rmSync(resolve(root, stage.output_ref!));
    const missing = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(missing.run.status, "completed");
    assert.equal(missing.phase, "completed");
    assert.equal(missing.workflowAction.group, null);
    assert.equal(missing.workflowAction.eligible, false);
    assert.equal(missing.delivery.deliveredCommit, null);
    assert.equal(missing.delivery.outcome, null);
    assert.ok(missing.evidence.references.some((r) => r.kind === "delivery_result" && r.availability === "missing"));
  });
  await withBoundary(9, ({ store, root, runId }) => {
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.phase, "completed");
    assert.equal(snapshot.workflowAction.group, null);
    assert.equal(snapshot.delivery.deliveredCommit, null);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.reason.includes("delivery.gate.pass")));
  }, { omitAudit: "delivery.gate.pass" });
});

test("frozen models, named authors and staffing are checked without an executor probe", async (t) => {
  const cases: [string, number, (profile: Profile) => void][] = [
    ["missing spec review model", 0, (p) => { delete p.modelMap.spec_review; }],
    ["missing plan author", 3, (p) => { p.agents = p.agents.filter((a) => a.id !== "plan-author"); }],
    ["missing patch output", 5, (p) => { p.agents.find((a) => a.id === "implementer")!.outputs = []; }],
    ["missing review capability", 7, (p) => { p.executor.capabilities = p.executor.capabilities.filter((c) => c !== "review"); }],
    ["unstaffable code panel", 7, (p) => { p.agents = p.agents.filter((a) => !a.outputs.includes("code-findings")); }],
  ];
  for (const [name, prefix, freeze] of cases) await t.test(name, () => withBoundary(prefix, ({ store, root, runId }) => {
    const before = store.query("SELECT id FROM agent_run");
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.code === "setup_required"));
    assert.deepEqual(store.query("SELECT id FROM agent_run"), before);
  }, { freeze }));
});

test("current policy affects approval readiness but never revokes an already granted boundary", async () => {
  const freeze = (profile: Profile) => { profile.policy.codeReviewMaxRounds = profile.policy.codeReviewMaxRounds === 1 ? 2 : 1; };
  await withBoundary(2, ({ store, root, runId }) => {
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.match(snapshot.workflowAction.reasons.find((r) => r.code === "policy_block")!.reason, /policy has changed since intake/);
  }, { freeze });
  await withBoundary(3, ({ store, root, runId }) => {
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, true, JSON.stringify(snapshot.workflowAction.reasons));
  }, { freeze });
});

test("branch/worktree residue, cross-run predecessors and generic manual audit cannot authorize continuation", async () => {
  await withBoundary(5, ({ store, root, runId, worktree }) => {
    mkdirSync(worktree, { recursive: true });
    assert.ok(readRunSnapshot(store, root, runId).snapshot.workflowAction.reasons.some((r) => /worktree path already exists/.test(r.reason)));
  });
  await withBoundary(5, ({ store, root, runId }) => {
    git(root, "branch", `gov/demo/${runId}`);
    assert.ok(readRunSnapshot(store, root, runId).snapshot.workflowAction.reasons.some((r) => /run branch already exists/.test(r.reason)));
  });
  await withBoundary(2, ({ store, root, runId }) => {
    const other = store.insertRun("other", "other", "other", "feature");
    const foreign = store.insertStage(other.id, "spec", null);
    store.exec("UPDATE stage SET input_stage_id = ? WHERE run_id = ? AND ordinal = 1", [foreign.id, runId]);
    assert.ok(readRunSnapshot(store, root, runId).snapshot.workflowAction.reasons.some((r) => r.code === "chain_incomplete"));
  });
  await withBoundary(2, ({ store, root, runId }) => {
    const first = store.getStageChain(runId)[0]!;
    for (const action of ["stage.add", "stage.complete"]) {
      appendAudit(store, { runId, stageId: first.id, action, actor: "system", actorType: "cli", summary: "manual stage" });
    }
    assert.ok(readRunSnapshot(store, root, runId).snapshot.workflowAction.reasons.some((r) => r.reason.includes("spec.stage.create")));
  }, { omitAudit: "spec.stage.create" });
});

test("final code-review findings are labelled from the bound recorded panel, not invented cross-round resolutions", async () => {
  for (const blocked of [false, true]) await withBoundary(8, ({ store, root, runId, profile }) => {
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    const stage = store.getStageChain(runId).at(-1)!;
    const record = JSON.parse(readFileSync(resolve(root, stage.output_ref!), "utf8"));
    const final = record.rounds.at(-1);
    const finalFindings = snapshot.evidence.findings.filter((f) => f.round === final.round && f.stageId === stage.id);
    assert.ok(finalFindings.length > 0);
    assert.equal(final.round, profile.policy.codeReviewMaxRounds);
    for (const finding of finalFindings) {
      assert.equal(finding.finalPanelBlocking, final.blocking.some((b: { findingId: number }) => b.findingId === finding.id));
      assert.equal(finding.decision, null);
    }
    assert.ok(snapshot.evidence.findings.filter((f) => f.round !== final.round).every((f) => f.finalPanelBlocking === null));
    assert.equal(snapshot.phase, blocked ? "blocked" : "ready");
    assert.equal(snapshot.workflowAction.eligible, !blocked);
  }, { mode: blocked ? "high" : "low", blockedReview: blocked });
});

test("scope metadata reuses the specification reader without requiring unrelated downstream schema fields", async () => {
  await withBoundary(3, ({ specPath }) => {
    const original = readFileSync(specPath, "utf8");
    const parsed = validateSpecDoc(original);
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
    const changed = original.replace(/^## Acceptance criteria[\s\S]*$/m, "## Acceptance criteria\nUnstructured historical content\n");
    assert.equal(validateSpecDoc(changed).ok, false);
    assert.deepEqual(readSpecDeclaredArtifacts(changed), parsed.value.declaredArtifacts);
    assert.deepEqual(readSpecDeclaredArtifacts(`\uFEFF${original.replace(/\n/g, "\r\n")}`), parsed.value.declaredArtifacts);
    assert.equal(readSpecDeclaredArtifacts("No declared-artifact section"), null);
  });
});

test("unchecked command projections stay unavailable without silently strengthening the core verification handoff", async () => {
  await withBoundary(7, ({ root, store, runId }) => {
    const stage = store.getStageChain(runId).at(-1)!;
    const path = resolve(root, stage.output_ref!);
    const value = JSON.parse(readFileSync(path, "utf8"));
    delete value.commands[0].argv;
    writeFileSync(path, JSON.stringify(value));
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, true, JSON.stringify(snapshot.workflowAction.reasons));
    assert.deepEqual(snapshot.delivery.verification[0]!.commands, []);
    assert.ok(snapshot.limitations.some((reason) => /command projection.*incomplete or malformed/.test(reason)));
    const entry = snapshot.evidence.references.find((r) => r.kind === "verification_result")!;
    assert.equal(entry.availability, "unverified");
    assert.match(entry.reason!, /unchecked fields are not a stronger core handoff contract/);
  });
});

test("a fresh spec boundary ignores shared old projections but still requires its design", async () => {
  await withBoundary(0, ({ store, root, runId, specPath, planPath }) => {
    writeFileSync(specPath, "An earlier run's projection.\n");
    writeFileSync(planPath, "An earlier run's plan.\n");
    assert.equal(readRunSnapshot(store, root, runId).snapshot.workflowAction.eligible, true);
    rmSync(join(dirname(specPath), "design.md"));
    const snapshot = readRunSnapshot(store, root, runId).snapshot;
    assert.equal(snapshot.workflowAction.eligible, false);
    assert.ok(snapshot.workflowAction.reasons.some((r) => r.code === "setup_required" && r.reason.includes("cannot read design")));
  });
});
