import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  applyRefresh, bootstrapToken, emptyResourceState, ensureSlot, isEditableTarget,
  isCurrentRefresh, parseRoute, repositoryViews, routeHash, routeWithoutToken,
  shortcutDestination, validatedLimit,
} from "../src/dashboard/app.js";
import {
  AGENT_MODEL_UNAVAILABLE, AGENT_TOKEN_CLASS_NOTE, AVERAGE_EXECUTION_UNAVAILABLE_REASON,
  FINDING_ORDER_STATEMENT, IDENTITY_FRAGMENT_LENGTH,
  MALFORMED_LIST_REASON,
  MALFORMED_NORMATIVE_REASON, TOKEN_CLASSES, TREND_UNAVAILABLE, activityItems, agentAnalytics,
  artifactChange, approvalWindow, cardSeverity,
  collapsedColumnStatement, commandText, constantColumn, costChartSeries, coverageQualifier,
  finalPanelBlockingSummary, findingCard, forbiddenFieldStatement, fullCoverageStatement,
  identityPresentation, latestTimestamp, orderFindings,
  portfolioProjection, repositoryIdentity, runExecutiveSummary, severityOrder, snapshotProjection,
  snapshotState, stagePresentation, statusPresentation, timestampPresentation, tokenTotal,
  usdPresentation,
} from "../src/dashboard/dashboard-model.js";
import { readRunsResult, readStatusResult } from "../src/operator-read.ts";
import { openStore } from "../src/store.ts";
import type { OperatorResult } from "../src/operator-output.ts";
import type { RunSnapshot } from "../src/operator-state.ts";

const CLI = resolve("src", "cli.ts");

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "bw-dashboard-ui-"));
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository(parent: string): string {
  const root = join(parent, "target with spaces");
  mkdirSync(root);
  git(root, "init", "-q");
  writeFileSync(join(root, ".gitignore"), ".governance/\n");
  writeFileSync(join(root, "governed.yaml"), 'verify:\n  - name: unit\n    command: ["node", "--version"]\n');
  writeFileSync(join(root, "tracked.txt"), "unchanged\n");
  git(root, "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base");
  return root;
}

function newRun(root: string, parent: string, slug: string): number {
  const created = spawnSync(process.execPath, [
    CLI, "new-run", "--repo", root, "--project", "project", "--feature", "feature",
    "--slug", slug, "--change-kind", "feature", "--model", "test-model",
  ], { cwd: parent, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  return Number(created.stdout.trim());
}

function successEnvelope(result: unknown, observedAt = "2026-09-12T12:00:00.000Z"): OperatorResult {
  return {
    command: "status",
    outcome: "ok",
    repository: "C:\\target",
    runId: 1,
    errorCode: null,
    reason: null,
    observedAt,
    result,
  };
}

/**
 * A run whose recorded evidence is deliberately partial: one agent row reports
 * cost and two token classes, a second reports nothing, and a third records a
 * failed attempt. Nothing here is hand-written presentation data — every value
 * below is read back through the authoritative read route.
 */
function seedPartialRun(root: string, parent: string, slug: string): RunSnapshot {
  const runId = newRun(root, parent, slug);
  const store = openStore(root);
  const spec = store.insertStage(runId, "spec", null);
  store.insertAgentRun({
    stageId: spec.id, agent: "alpha-author", role: "author", executor: "claude_code",
    requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
    tokensIn: 120, tokensOut: 40, cacheRead: null, cacheWrite: null, cost: 0.25,
    durationMs: 900, inputHash: "in-a", outputHash: "out-a", rawOutputRef: "raw/a.json",
    independence: "unverified_self_attestation",
  });
  store.insertAgentRun({
    stageId: spec.id, agent: "zulu-reviewer", role: "reviewer", executor: "claude_code",
    requestedModel: "test-model", effectiveModel: null, fallback: null,
    tokensIn: null, tokensOut: null, cacheRead: null, cacheWrite: null, cost: null,
    durationMs: 700, inputHash: "in-b", outputHash: "out-b", rawOutputRef: "raw/b.json",
    independence: "configured_standalone",
  });
  const reviewer = store.insertAgentRun({
    stageId: spec.id, agent: "zulu-reviewer", role: "reviewer", executor: "claude_code",
    requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
    tokensIn: 10, tokensOut: 5, cacheRead: null, cacheWrite: null, cost: null,
    durationMs: 100, inputHash: "in-c", outputHash: "out-c", rawOutputRef: "raw/c.json",
    independence: "configured_standalone",
  });
  store.completeStage(spec.id, "spec.md", "pass");
  const plan = store.insertStage(runId, "plan", spec.id);
  const finding = store.upsertCanonicalFinding(plan.id, 1, "missing-rollback", "plan.md:12");
  store.insertFindingReport({
    findingId: finding.id, agentRunId: reviewer.id, severity: "high",
    classification: "current_artifact", subject: "The plan records no rollback step.",
  });
  store.insertFindingDecision({
    findingId: finding.id, agentRunId: reviewer.id, disposition: "addressed",
    rationale: "The plan now records a rollback step.",
    changedLocations: ["plan.md:12", "plan.md:40"],
    grounding: null,
    normativeChanges: [{
      artifactLocation: "plan.md:40",
      artifactText: "Restore the prior commit before retrying.",
      grounding: { source: "design", location: "design.md:7", excerpt: "Every task states its rollback." },
    }],
    artifactHashBefore: "hash-before", artifactHashAfter: "hash-after",
  });
  store.close();
  const envelope = readStatusResult(root, parent, runId);
  assert.equal(envelope.outcome, "ok");
  return envelope.result as RunSnapshot;
}

test("client token, token-free routes, limits, and stable deep links are deterministic", () => {
  assert.equal(bootstrapToken("#token=abc_123"), "abc_123");
  assert.equal(bootstrapToken("#repository=repo&run=4"), null);
  assert.equal(routeWithoutToken("#token=abc_123"), "");
  assert.equal(routeWithoutToken("#token=abc_123&repository=repo_A&run=4"), "#repository=repo_A&run=4");
  assert.deepEqual(parseRoute("#repository=repo_A&run=4"), { repositoryId: "repo_A", runId: 4 });
  assert.deepEqual(parseRoute("#run=bad&repository=../escape"), { repositoryId: null, runId: null });
  const route = routeHash("stable-id", 7);
  assert.equal(route, "#repository=stable-id&run=7");
  assert.deepEqual(parseRoute(route), { repositoryId: "stable-id", runId: 7 });
  for (const value of [1, 20, 100, "50"]) assert.equal(validatedLimit(value), Number(value));
  for (const value of [0, 101, "1.5", "x"]) assert.throws(() => validatedLimit(value), RangeError);
});

test("refresh state replaces only complete success and expires only on 401", () => {
  const first = successEnvelope({ value: "first" });
  let resource = applyRefresh(emptyResourceState(), { status: 200, envelope: first });
  assert.equal(resource.sessionExpired, false);
  assert.equal(resource.resource.stale, false);
  assert.deepEqual(resource.resource.envelope, first);

  const refusal: OperatorResult = {
    ...successEnvelope(null, "2026-09-12T12:01:00.000Z"),
    outcome: "state_missing",
    errorCode: "state_missing",
    reason: "state is missing",
  };
  resource = applyRefresh(resource.resource, { status: 200, envelope: refusal });
  assert.equal(resource.sessionExpired, false);
  assert.equal(resource.resource.stale, true);
  assert.deepEqual(resource.resource.envelope, first);
  assert.equal(resource.resource.errorCode, "state_missing");
  assert.equal(resource.resource.attemptedAt, refusal.observedAt);

  const failed = applyRefresh(resource.resource, { status: 503, reason: "transport failed" });
  assert.equal(failed.sessionExpired, false);
  assert.equal(failed.resource.stale, true);
  assert.deepEqual(failed.resource.envelope, first);
  const expired = applyRefresh(failed.resource, { status: 401, reason: "expired" });
  assert.equal(expired.sessionExpired, true);
  assert.deepEqual(expired.resource, failed.resource);

  const replacement = successEnvelope({ value: "second" }, "2026-09-12T12:02:00.000Z");
  const restored = applyRefresh(failed.resource, { status: 200, envelope: replacement });
  assert.equal(restored.resource.stale, false);
  assert.deepEqual(restored.resource.envelope, replacement);

  const runOne = applyRefresh(emptyResourceState(1), { status: 200, envelope: first }, 1);
  const runTwoRefusal: OperatorResult = {
    ...refusal,
    runId: 2,
    observedAt: "2026-09-12T12:03:00.000Z",
  };
  const runTwo = applyRefresh(runOne.resource, { status: 200, envelope: runTwoRefusal }, 2);
  assert.equal(runTwo.resource.requestedRunId, 2);
  assert.equal(runTwo.resource.envelope, null);
  assert.equal(runTwo.resource.stale, false);
  assert.equal(runTwo.resource.errorCode, "state_missing");

  const mismatched = applyRefresh(emptyResourceState(2), { status: 200, envelope: first }, 2);
  assert.equal(mismatched.resource.envelope, null);
  assert.equal(mismatched.resource.errorCode, "response_identity_mismatch");
});

test("only the latest refresh may update its selected resource", () => {
  assert.equal(isCurrentRefresh(2, 2, 100, 100), true);
  assert.equal(isCurrentRefresh(1, 2, 100, 100), false);
  assert.equal(isCurrentRefresh(2, 2, 20, 100), false);
  assert.equal(isCurrentRefresh(4, 4, "repository-a:1", "repository-a:2"), false);
});

test("per-run snapshot slots stay isolated and never borrow another run's envelope", () => {
  const state = {
    repository: { id: "repo-a", path: "C:\\a" },
    runs: emptyResourceState(),
    runsRequestId: 0,
    snapshots: new Map(),
  };
  const one = ensureSlot(state, 1);
  const two = ensureSlot(state, 2);
  assert.notEqual(one, two);
  assert.equal(ensureSlot(state, 1), one);
  assert.equal(one.resource.requestedRunId, 1);
  assert.equal(two.resource.requestedRunId, 2);

  const snapshotOne = successEnvelope({ marker: "run-one" });
  one.resource = applyRefresh(one.resource, { status: 200, envelope: snapshotOne }, 1).resource;
  assert.equal(two.resource.envelope, null);

  // A refusal for run 2 must not promote run 1's envelope into run 2's slot.
  const refusalTwo: OperatorResult = {
    ...successEnvelope(null), runId: 2, outcome: "run_missing",
    errorCode: "run_missing", reason: "run 2 is missing",
  };
  two.resource = applyRefresh(two.resource, { status: 200, envelope: refusalTwo }, 2).resource;
  assert.equal(two.resource.envelope, null);
  assert.equal(two.resource.stale, false);
  assert.deepEqual(one.resource.envelope, snapshotOne);
});

test("portfolio views cover the loaded window and exclude a retained out-of-window slot", () => {
  const summary = (id: number, status: string, phase: string) => ({
    id, project: "p", featureId: "f", slug: `s${id}`, status, phase,
    lastRecordedAt: "2026-09-12T12:00:00.000Z",
  });
  const repositories = new Map([
    ["repo-a", {
      repository: { id: "repo-a", path: "C:\\a" },
      runs: applyRefresh(emptyResourceState(), {
        status: 200,
        envelope: successEnvelope({
          runs: [summary(1, "completed", "completed"), summary(2, "blocked", "blocked")],
          limit: 2, hasMore: true,
        }),
      }).resource,
      runsRequestId: 1,
      snapshots: new Map([[99, { resource: emptyResourceState(99), requestId: 1, loading: false }]]),
    }],
    ["repo-b", {
      repository: { id: "repo-b", path: "C:\\b" },
      runs: emptyResourceState(),
      runsRequestId: 0,
      snapshots: new Map(),
    }],
  ]);
  const views = repositoryViews({ repositories });
  assert.equal(views.length, 2);
  assert.deepEqual(views[0]?.snapshots.map((entry) => entry.runId), [1, 2]);
  assert.equal(views[1]?.available, false);

  const projection = portfolioProjection(views);
  assert.equal(projection.runs, 2);
  assert.equal(projection.blockedRuns, 1);
  assert.equal(projection.completedRuns, 1);
  assert.equal(projection.activeRuns, 0);
  assert.equal(projection.successRate.value, 0.5);
  assert.equal(projection.limitedScope, true);
  assert.equal(projection.repositories.configured, 2);
  assert.equal(projection.repositories.unavailable, 1);
  assert.equal(projection.coverage.loadedRuns, 2);
  assert.equal(projection.coverage.contributing, 0);
  assert.equal(projection.coverage.unavailable, 2);
  assert.equal(projection.findings.value, null, "no snapshot contributed, so findings are unavailable, not zero");
  assert.equal(projection.cost.knownUsd, null);
  assert.equal(projection.tokens.known, null);
  assert.equal(projection.averageExecution.value, null);
  assert.equal(projection.averageExecution.reason, AVERAGE_EXECUTION_UNAVAILABLE_REASON);
  assert.equal(projection.trend, TREND_UNAVAILABLE);

  const empty = portfolioProjection([]);
  assert.equal(empty.runs, 0, "an empty portfolio has zero loaded runs, which is a count and not an unavailable value");
  assert.equal(empty.successRate.value, null);
  assert.equal(empty.findings.value, null);
});

test("snapshot slot classification separates stale, pending, and unavailable evidence", () => {
  const snapshot = null as unknown as RunSnapshot;
  assert.equal(snapshotState({ runId: 1, snapshot, stale: false, loading: true }), "pending");
  assert.equal(snapshotState({ runId: 1, snapshot, stale: false, loading: false }), "unavailable");
  const present = { evidence: { findings: [] } } as unknown as RunSnapshot;
  assert.equal(snapshotState({ runId: 1, snapshot: present, stale: true, loading: false }), "stale");
  assert.equal(snapshotState({ runId: 1, snapshot: present, stale: false, loading: false }), "fresh");
});

test("status and stage presentation report recorded state without promoting it", () => {
  assert.deepEqual(statusPresentation("in_progress", "ready"),
    { label: "IN PROGRESS", tone: "active", source: "status" });
  assert.deepEqual(statusPresentation("in_progress", "awaiting_approval"),
    { label: "AWAITING APPROVAL", tone: "warning", source: "phase" });
  assert.deepEqual(statusPresentation("blocked", "interrupted_or_inconsistent"),
    { label: "ATTENTION REQUIRED", tone: "danger", source: "phase" });
  assert.deepEqual(statusPresentation("completed", "completed"),
    { label: "COMPLETED", tone: "success", source: "status" });
  assert.deepEqual(statusPresentation("blocked", "blocked"),
    { label: "BLOCKED", tone: "danger", source: "status" });

  const stage = (status: string, gateResult: string | null) =>
    stagePresentation({ status, gateResult } as unknown as RunSnapshot["stages"][number]);
  assert.equal(stage("passed", "block").label, "Blocked");
  assert.equal(stage("passed", "pass").label, "Passed");
  assert.equal(stage("passed", null).label, "Recorded");
  assert.equal(stage("open", null).label, "In progress");
});

test("run analytics report recorded coverage and refuse to invent an unreported value", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const snapshot = seedPartialRun(root, parent, "partial");

    const tokens = tokenTotal(snapshot.cost);
    assert.deepEqual(tokens.classes.map((entry) => entry.key), TOKEN_CLASSES.map((entry) => entry.key));
    assert.equal(tokens.classes[0]?.known, snapshot.cost.tokens.input.known);
    assert.equal(tokens.classes[2]?.known, null, "no row reported a cache-read token, so the class is unavailable");
    assert.equal(snapshot.cost.tokens.cacheRead.reportedRows, 0);
    assert.equal(tokens.known, (snapshot.cost.tokens.input.known ?? 0) + (snapshot.cost.tokens.output.known ?? 0));
    assert.equal(tokens.partial, true);

    const charts = costChartSeries(snapshot);
    assert.deepEqual(charts.stages.map((entry) => entry.stageId), snapshot.cost.byStage.map((group) => group.stageId));
    assert.deepEqual(charts.agents.map((entry) => entry.agent), snapshot.cost.byAgent.map((group) => group.agent));
    const unreported = charts.agents.find((entry) => entry.agent === "zulu-reviewer");
    assert.equal(unreported?.knownUsd, null, "an agent with no reported cost row stays unavailable, not zero");
    assert.equal(unreported?.fraction, 0);
    assert.equal(charts.agentState, "available");
    assert.equal(charts.tokenState, "available");
    assert.ok(charts.tokenMax > 0);
    assert.ok(charts.stageMax > 0);
    const stagePlan = charts.stages.find((entry) => entry.kind === "plan");
    assert.equal(stagePlan?.knownUsd, null);
    assert.equal(stagePlan?.fraction, 0);
    for (const entry of charts.stages) assert.ok(entry.fraction >= 0 && entry.fraction <= 1);
    const share = charts.agents.reduce((sum, entry) => sum + entry.fraction, 0);
    assert.ok(Math.abs(share - 1) < 1e-9, "reported agent shares total one whole");

    const agents = agentAnalytics(snapshot);
    assert.deepEqual(agents.map((entry) => entry.agent), snapshot.cost.byAgent.map((group) => group.agent));
    for (const agent of agents) {
      assert.equal(agent.model, null);
      assert.equal(agent.modelLabel, AGENT_MODEL_UNAVAILABLE);
      assert.equal(agent.trend, TREND_UNAVAILABLE);
      const group = snapshot.cost.byAgent.find((entry) => entry.agent === agent.agent);
      assert.equal(agent.executions, group?.agentRows);
      assert.equal(agent.costUnreportedRows, group?.costUnreportedRows);
    }
    assert.equal(agents.find((entry) => entry.agent === "zulu-reviewer")?.findingsGenerated, 1);
    assert.equal(agents.find((entry) => entry.agent === "alpha-author")?.findingsGenerated, 0);

    const items = activityItems(snapshot);
    for (let index = 1; index < items.length; index++) {
      assert.ok(Date.parse(items[index - 1]!.at) >= Date.parse(items[index]!.at), "newest recorded observation first");
    }
    const recordedTimestamps = snapshot.stages.filter((stage) => stage.startEvidence.at !== null).length +
      snapshot.stages.filter((stage) => stage.endedAt !== null).length;
    assert.ok(items.length <= recordedTimestamps + 1, "no item is inferred beyond recorded timestamps plus one audit event");
    for (const item of items) assert.notEqual(item.at, null);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("finding cards keep every report separate and name a malformed stored list", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const snapshot = seedPartialRun(root, parent, "findings");
    const finding = snapshot.evidence.findings[0]!;
    const card = findingCard(finding);
    assert.equal(card.id, finding.id);
    assert.deepEqual(card.reports, finding.reports);
    assert.equal(card.decision?.disposition, "addressed");
    assert.deepEqual(card.decision?.changedLocations, { available: true, values: ["plan.md:12", "plan.md:40"] });
    assert.equal(card.decision?.normativeChanges.available, true);
    assert.deepEqual(card.decision?.normativeChanges.values, [{
      artifactLocation: "plan.md:40",
      artifactText: "Restore the prior commit before retrying.",
      groundingSource: "design",
      groundingLocation: "design.md:7",
      groundingExcerpt: "Every task states its rollback.",
    }]);

    const malformed = findingCard({
      ...finding,
      decision: { ...finding.decision!, changed_locations: "not-json", normative_changes: "{ }" },
    });
    assert.deepEqual(malformed.decision?.changedLocations, { available: false, values: null });
    assert.deepEqual(malformed.decision?.normativeChanges, { available: false, values: null });
    assert.ok(MALFORMED_LIST_REASON.length > 0 && MALFORMED_NORMATIVE_REASON.length > 0);
    assert.doesNotMatch(MALFORMED_LIST_REASON, /not-json/);

    const undecided = findingCard({ ...finding, decision: null });
    assert.equal(undecided.decision, null);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("snapshot projection preserves authoritative arrays and command arguments from a real store", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "slug");
    const store = openStore(root);
    const stage = store.insertStage(runId, "spec", null);
    store.completeStage(stage.id, "missing-spec.md", "pass");
    for (let index = 0; index < 250; index++) {
      store.upsertCanonicalFinding(stage.id, 1, `finding-${index}`, `tracked.txt:${index + 1}`);
    }
    store.setRunStatus(runId, "blocked");
    store.close();
    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;
    const projection = snapshotProjection(snapshot, "C:\\Program Files\\BuildWorks\\src\\cli.ts", "win32");
    assert.equal(projection.systemName, "BuildWorks");
    assert.deepEqual(projection.overview.run, snapshot.run);
    assert.deepEqual(projection.overview.workflowAction.reasons, snapshot.workflowAction.reasons);
    assert.deepEqual(projection.overview.limitations, snapshot.limitations);
    assert.deepEqual(projection.stages, snapshot.stages);
    assert.deepEqual(projection.stageViews.map((view) => view.stage), snapshot.stages);
    assert.deepEqual(projection.cost, snapshot.cost);
    assert.deepEqual(projection.findings, snapshot.evidence.findings);
    assert.equal(projection.findings.length, 250);
    assert.equal(projection.findingCards.length, 250);
    assert.deepEqual(projection.governance.configuration, snapshot.configuration);
    assert.deepEqual(projection.governance.approval, snapshot.approval);
    assert.deepEqual(projection.delivery, snapshot.delivery);
    assert.deepEqual(projection.evidence, snapshot.evidence.references);
    assert.ok(JSON.stringify(projection).includes("Configured standalone reviewers and passed frozen commands do not prove product correctness."));
    assert.ok(JSON.stringify(projection).includes("missing-spec.md"));
    assert.equal(projection.cost.tokens.input.known, null);
    assert.equal(projection.cost.tokens.input.reportedRows, 0);
    assert.equal(projection.cost.tokens.input.unreportedRows, 0);
    assert.ok(projection.evidence.some((entry) =>
      entry.ref === "missing-spec.md" && ["missing", "unverified", "inconsistent"].includes(entry.availability)));
    assert.ok(projection.governance.commands.every((command) => !command.text.includes("undefined")));

    // Read commands lead in a fixed order, and repository-wide verify-audit is
    // never presented as if it took the selected run.
    const kinds = projection.governance.commands.map((command) => command.kind);
    assert.deepEqual(kinds.slice(0, 3), ["status", "doctor", "verify-audit"]);
    const audit = projection.governance.commands.find((command) => command.kind === "verify-audit")!;
    assert.equal(audit.scope, "repository");
    assert.ok(!audit.args.includes("--run"));
    for (const command of projection.governance.commands) {
      const action = command.kind === "workflow"
        ? snapshot.workflowAction
        : snapshot.operatorActions.find((entry) => entry.kind === command.kind)!;
      assert.deepEqual(command.args, action.args, `${command.kind} argv is projected unchanged`);
      assert.equal(command.command, action.command);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("the run list read route bounds the portfolio window it reports", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    for (const slug of ["one", "two", "three"]) newRun(root, parent, slug);
    const envelope = readRunsResult(root, parent, 2);
    assert.equal(envelope.outcome, "ok");
    const list = envelope.result as { runs: unknown[]; limit: number; hasMore: boolean };
    assert.equal(list.runs.length, 2);
    assert.equal(list.hasMore, true);
    assert.ok(!Object.hasOwn(list, "total"),
      "the read route reports no total, so the dashboard may not state how many runs lie outside the window");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a run that reported zero tokens is distinguished from a run that reported none", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "zeros");
    const store = openStore(root);
    const spec = store.insertStage(runId, "spec", null);
    store.insertAgentRun({
      stageId: spec.id, agent: "alpha-author", role: "author", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
      durationMs: 5, inputHash: "in", outputHash: "out", rawOutputRef: "raw/zero.json",
      independence: "unverified_self_attestation",
    });
    store.close();
    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;

    // The run recorded these zeros, so every class is reported, not missing.
    assert.equal(snapshot.cost.tokens.input.reportedRows, 1);
    assert.equal(snapshot.cost.tokens.input.known, 0);
    const charts = costChartSeries(snapshot);
    assert.equal(charts.tokenMax, 0);
    assert.equal(charts.tokenState, "reported_zero",
      "a reported zero is evidence; it is not the absence of evidence");
    assert.equal(charts.agentState, "reported_zero");
    assert.equal(charts.stageMax, 0);

    const unreported = seedPartialRun(root, parent, "unreported");
    assert.equal(unreported.cost.tokens.cacheRead.reportedRows, 0);
    assert.equal(costChartSeries({
      ...unreported,
      cost: {
        ...unreported.cost,
        byStage: unreported.cost.byStage.map((group) => ({
          ...group,
          tokens: {
            input: { known: null, reportedRows: 0, unreportedRows: group.agentRows },
            output: { known: null, reportedRows: 0, unreportedRows: group.agentRows },
            cacheRead: { known: null, reportedRows: 0, unreportedRows: group.agentRows },
            cacheWrite: { known: null, reportedRows: 0, unreportedRows: group.agentRows },
          },
        })),
      },
    }).tokenState, "unavailable");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("monetary, identity, and timestamp presentation narrow without altering a recorded value", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "presentation");
    const store = openStore(root);
    const spec = store.insertStage(runId, "spec", null);
    // Two distinct agents, because cost.byAgent groups by agent and the
    // per-agent rounding assertion below needs two separate recorded groups.
    store.insertAgentRun({
      stageId: spec.id, agent: "alpha-author", role: "author", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: 120, tokensOut: 40, cacheRead: 8, cacheWrite: 4, cost: 0.5452318,
      durationMs: 900, inputHash: "in-a", outputHash: "out-a", rawOutputRef: "raw/a.json",
      independence: "unverified_self_attestation",
    });
    store.insertAgentRun({
      stageId: spec.id, agent: "zulu-reviewer", role: "reviewer", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: 10, tokensOut: 5, cacheRead: 1, cacheWrite: 1, cost: 0.26745660000000004,
      durationMs: 100, inputHash: "in-b", outputHash: "out-b", rawOutputRef: "raw/b.json",
      independence: "configured_standalone",
    });
    store.close();
    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;

    const author = snapshot.cost.byAgent.find((group) => group.agent === "alpha-author");
    const reviewer = snapshot.cost.byAgent.find((group) => group.agent === "zulu-reviewer");
    assert.ok(author !== undefined && reviewer !== undefined, "both recorded agent groups are projected");
    const authorBefore = author.knownUsd;
    const aggregateBefore = snapshot.cost.knownUsd;

    const authorMoney = usdPresentation(author.knownUsd);
    assert.equal(authorMoney.display, "$0.55");
    assert.equal(authorMoney.exact, `$${authorBefore}`,
      "the recorded value stays reachable unrounded beside its two-decimal display");
    assert.match(usdPresentation(reviewer.knownUsd).display, /^\$\d+\.\d{2}$/);

    // The aggregate is the stored sum, not a sum of rounded components.
    const aggregate = usdPresentation(snapshot.cost.knownUsd);
    assert.equal(aggregate.exact, `$${aggregateBefore}`);
    assert.notEqual(aggregate.exact, `$${Number(authorMoney.display.slice(1)) + Number(usdPresentation(reviewer.knownUsd).display.slice(1))}`);
    assert.equal(snapshot.cost.knownUsd, aggregateBefore, "presentation does not mutate the projection");
    assert.equal(author.knownUsd, authorBefore);
    assert.deepEqual(usdPresentation(null), { available: false, display: "Unavailable", exact: "Unavailable" });

    const recordedIdentity = snapshot.configuration.profileHash ?? snapshot.configuration.startingCommit;
    assert.ok(recordedIdentity !== null && recordedIdentity.length > IDENTITY_FRAGMENT_LENGTH,
      "the seeded run records a long identifier to truncate; without one this test proves nothing");
    const identity = identityPresentation(recordedIdentity);
    assert.equal(identity.display.length, IDENTITY_FRAGMENT_LENGTH + 1);
    assert.equal(identity.full, recordedIdentity);
    assert.equal(identity.truncated, true);
    assert.equal(identityPresentation(recordedIdentity.slice(0, IDENTITY_FRAGMENT_LENGTH)).truncated, false);
    assert.equal(identityPresentation(recordedIdentity.slice(0, IDENTITY_FRAGMENT_LENGTH + 1)).truncated, true,
      "a value one character longer than the fragment is truncated");
    assert.equal(identityPresentation(null).display, "Not recorded");

    const utc = timestampPresentation(snapshot.run.createdAt, "UTC");
    assert.equal(utc.utc, snapshot.run.createdAt, "the recorded timestamp is retained byte-for-byte");
    assert.equal(utc.available, true);
    // The store writes `new Date().toISOString()`, so a recorded value is
    // already canonical and re-serializing it would be invisible here. The
    // contract is identity, so assert it on a valid ISO-8601 form that is not
    // its own canonical re-serialization; the expected value is the input.
    const nonCanonical = "2026-09-12T12:00:00Z";
    assert.notEqual(nonCanonical, new Date(Date.parse(nonCanonical)).toISOString(),
      "this input must differ from its canonical re-serialization or it proves nothing");
    assert.equal(timestampPresentation(nonCanonical, "UTC").utc, nonCanonical,
      "a recorded timestamp is passed through, never re-serialized");
    assert.notEqual(utc.display, timestampPresentation(snapshot.run.createdAt, "America/New_York").display,
      "the display really is zone-rendered, so it is not the recorded string relabelled");
    assert.equal(timestampPresentation(null).available, false);
    assert.equal(timestampPresentation("not a timestamp").display, "Unavailable");

    const chosen = latestTimestamp([
      { label: "Created", value: snapshot.run.createdAt },
      { label: "Updated", value: snapshot.run.updatedAt },
      { label: "Last recorded activity", value: snapshot.activity.lastRecordedAt },
    ]);
    const greatest = [snapshot.run.createdAt, snapshot.run.updatedAt, snapshot.activity.lastRecordedAt]
      .reduce((max, value) => (Date.parse(value) > Date.parse(max) ? value : max));
    assert.equal(chosen.latest?.value, greatest);
    assert.equal(chosen.others.length, 2);
    assert.equal(latestTimestamp([{ label: "Created", value: null }]).latest, null);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("constant columns collapse per render and coverage qualifiers appear only where a row is unreported", () => {
  const parent = workspace();
  try {
    const root = repository(parent);

    // A column that is constant because every recorded row agrees.
    const evenId = newRun(root, parent, "even-executions");
    let store = openStore(root);
    let spec = store.insertStage(evenId, "spec", null);
    for (const agent of ["alpha-author", "zulu-reviewer"]) {
      store.insertAgentRun({
        stageId: spec.id, agent, role: "author", executor: "claude_code",
        requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
        tokensIn: 10, tokensOut: 5, cacheRead: 2, cacheWrite: 1, cost: 0.1,
        durationMs: 10, inputHash: `in-${agent}`, outputHash: `out-${agent}`,
        rawOutputRef: `raw/${agent}.json`, independence: "configured_standalone",
      });
    }
    store.close();
    const even = readStatusResult(root, parent, evenId);
    assert.equal(even.outcome, "ok");
    const evenAgents = agentAnalytics(even.result as RunSnapshot);
    const evenExecutions = constantColumn(evenAgents, (row) => row.executions);
    assert.deepEqual(evenExecutions, { constant: true, value: 1, rowCount: 2 });
    assert.equal(collapsedColumnStatement("Executions", evenExecutions.value, evenExecutions.rowCount),
      "Executions is 1 for all 2 recorded rows.");

    // The same accessor over a run whose rows disagree must not collapse.
    const unevenId = newRun(root, parent, "uneven-executions");
    store = openStore(root);
    spec = store.insertStage(unevenId, "spec", null);
    for (const [agent, rows] of [["alpha-author", 1], ["zulu-reviewer", 2]] as const) {
      for (let index = 0; index < rows; index++) {
        store.insertAgentRun({
          stageId: spec.id, agent, role: "reviewer", executor: "claude_code",
          requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
          tokensIn: 10, tokensOut: 5, cacheRead: 2, cacheWrite: 1, cost: 0.1,
          durationMs: 10, inputHash: `in-${agent}-${index}`, outputHash: `out-${agent}-${index}`,
          rawOutputRef: `raw/${agent}-${index}.json`, independence: "configured_standalone",
        });
      }
    }
    store.close();
    const uneven = readStatusResult(root, parent, unevenId);
    assert.equal(uneven.outcome, "ok");
    const unevenAgents = agentAnalytics(uneven.result as RunSnapshot);
    assert.deepEqual(constantColumn(unevenAgents, (row) => row.executions),
      { constant: false, value: null, rowCount: 2 });
    assert.deepEqual(constantColumn([], (row: { executions: number }) => row.executions),
      { constant: false, value: null, rowCount: 0 },
      "no rows is an empty collection, not a constant column");

    // A statement about the current projection, not about the collapse rule:
    // agentAnalytics binds no model, so this column is constant in every run.
    // It should fail loudly if the deferred RunSnapshot extension ever lands.
    assert.deepEqual(constantColumn(unevenAgents, (row) => row.modelLabel),
      { constant: true, value: AGENT_MODEL_UNAVAILABLE, rowCount: 2 });

    // Coverage qualifiers attach only where a contributing row reported nothing.
    const fullyReported = unevenAgents.flatMap((row) => row.tokens.classes);
    for (const entry of fullyReported) assert.equal(coverageQualifier(entry), null);
    assert.equal(fullCoverageStatement(fullyReported),
      "Every contributing row reported this section's totals.");

    const partial = seedPartialRun(root, parent, "partial-coverage");
    const partialAgents = agentAnalytics(partial);
    const reviewer = partialAgents.find((row) => row.agent === "zulu-reviewer");
    assert.ok(reviewer !== undefined);
    const reviewerInput = reviewer.tokens.classes.find((entry) => entry.key === "input");
    assert.ok(reviewerInput !== undefined);
    assert.equal(reviewerInput.unreportedRows, 1);
    assert.equal(coverageQualifier(reviewerInput), "1 of 2 rows reported");
    assert.equal(fullCoverageStatement(partialAgents.flatMap((row) => row.tokens.classes)), null);
    assert.equal(fullCoverageStatement([]), null);

    // All four classes survive the projection; the omission R16 names is a
    // render defect, so the model must keep reporting every class.
    for (const row of partialAgents) {
      assert.equal(row.tokens.classes.length, 4);
      assert.deepEqual(row.tokens.classes.map((entry) => entry.key), TOKEN_CLASSES.map((entry) => entry.key));
    }
    assert.match(AGENT_TOKEN_CLASS_NOTE, /cache-read/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a decision field the recorded disposition forbids is never reported as missing", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "applicability");
    const store = openStore(root);
    const spec = store.insertStage(runId, "spec", null);
    const agent = store.insertAgentRun({
      stageId: spec.id, agent: "zulu-reviewer", role: "reviewer", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: 10, tokensOut: 5, cacheRead: 1, cacheWrite: 1, cost: 0.1,
      durationMs: 100, inputHash: "in", outputHash: "out", rawOutputRef: "raw/a.json",
      independence: "configured_standalone",
    });
    const before = "a".repeat(64);
    const after = "b".repeat(64);

    // Both shapes below are exactly what insertFindingDecision permits; the
    // inverse of either throws, which is why an absence label would be wrong.
    const addressed = store.upsertCanonicalFinding(spec.id, 1, "missing-rollback", "plan.md:12");
    store.insertFindingReport({
      findingId: addressed.id, agentRunId: agent.id, severity: "high",
      classification: "current_artifact", subject: "The plan records no rollback step.",
    });
    store.insertFindingDecision({
      findingId: addressed.id, agentRunId: agent.id, disposition: "addressed",
      rationale: "The plan now records a rollback step.",
      changedLocations: ["plan.md:12"], grounding: null,
      normativeChanges: [{
        artifactLocation: "plan.md:40", artifactText: "Restore the prior commit before retrying.",
        grounding: { source: "design", location: "design.md:7", excerpt: "Every task states its rollback." },
      }],
      artifactHashBefore: before, artifactHashAfter: after,
    });

    const rejected = store.upsertCanonicalFinding(spec.id, 1, "scope_creep", "plan.md:80");
    store.insertFindingReport({
      findingId: rejected.id, agentRunId: agent.id, severity: "low",
      classification: "current_artifact", subject: "The plan adds an unrequested abstraction.",
    });
    store.insertFindingDecision({
      findingId: rejected.id, agentRunId: agent.id, disposition: "rejected_with_rationale",
      rationale: "The design requires the abstraction.",
      changedLocations: [],
      grounding: { source: "design", location: "design.md:22", excerpt: "Two implementations exist." },
      normativeChanges: null,
      artifactHashBefore: before, artifactHashAfter: before,
    });
    store.close();

    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;
    const cards = snapshot.evidence.findings.map((finding) => findingCard(finding));
    const addressedCard = cards.find((card) => card.intentKey === "missing-rollback");
    const rejectedCard = cards.find((card) => card.intentKey === "scope_creep");
    assert.ok(addressedCard !== undefined && rejectedCard !== undefined);

    assert.deepEqual(addressedCard.applicability, { grounding: "forbidden", normativeChanges: "required" });
    assert.deepEqual(rejectedCard.applicability, { grounding: "required", normativeChanges: "forbidden" });
    assert.equal(addressedCard.decision?.groundingSource, null,
      "the store could not have recorded grounding here, so its absence is structural");
    assert.equal(rejectedCard.decision?.normativeChanges.values, null);

    const statement = forbiddenFieldStatement("Grounding", "addressed");
    assert.doesNotMatch(statement, /Not recorded/);
    assert.doesNotMatch(statement, /Unavailable/);
    assert.match(statement, /does not apply/);

    // The readable title accompanies the recorded key; it never replaces it.
    assert.equal(rejectedCard.title, "Scope creep");
    assert.equal(rejectedCard.intentKey, "scope_creep");

    assert.equal(addressedCard.artifact?.equal, false);
    assert.match(addressedCard.artifact?.statement ?? "", /changed/);
    assert.equal(addressedCard.artifact?.before.full, before);
    assert.equal(addressedCard.artifact?.after.full, after);
    assert.equal(rejectedCard.artifact?.equal, true);
    assert.match(rejectedCard.artifact?.statement ?? "", /unchanged/);
    assert.equal(artifactChange(before, null).equal, null);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("findings order blocking first, then severity, then recorded identifier", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "ordering");

    // The run's own frozen vocabulary decides the order, so read it before
    // seeding rather than asserting against a severity list invented here.
    const configured = readStatusResult(root, parent, runId);
    assert.equal(configured.outcome, "ok");
    const severities = severityOrder((configured.result as RunSnapshot).configuration);
    assert.ok(severities !== null && severities.length >= 3,
      "this run froze a code-review severity order; without one there is nothing to rank against");
    const lowest = severities[0]!;
    const highest = severities[severities.length - 1]!;
    const middle = severities[1]!;

    const store = openStore(root);
    const spec = store.insertStage(runId, "spec", null);
    const agent = store.insertAgentRun({
      stageId: spec.id, agent: "zulu-reviewer", role: "reviewer", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: 10, tokensOut: 5, cacheRead: 1, cacheWrite: 1, cost: 0.1,
      durationMs: 100, inputHash: "in", outputHash: "out", rawOutputRef: "raw/a.json",
      independence: "configured_standalone",
    });
    const seeded: Record<string, number> = {};
    for (const [intent, severity] of [
      ["a-lowest", lowest], ["b-highest", highest], ["c-highest-tie", highest], ["d-middle", middle],
    ] as const) {
      const finding = store.upsertCanonicalFinding(spec.id, 1, intent, `plan.md:${intent}`);
      store.insertFindingReport({
        findingId: finding.id, agentRunId: agent.id, severity,
        classification: "current_artifact", subject: `recorded ${severity}`,
      });
      seeded[intent] = finding.id;
    }
    store.close();

    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;
    const cards = snapshot.evidence.findings.map((finding) => findingCard(finding));
    assert.equal(cards.length, 4);

    const ordered = orderFindings(cards, severities);
    assert.deepEqual(ordered.map((card) => card.intentKey),
      ["b-highest", "c-highest-tie", "d-middle", "a-lowest"]);
    assert.ok(seeded["b-highest"]! < seeded["c-highest-tie"]!,
      "the tie must resolve to the lower recorded identifier, so it must be seeded first");
    assert.deepEqual(cards.map((card) => card.id), snapshot.evidence.findings.map((finding) => finding.id),
      "ordering returns a new array and leaves the authoritative order intact");

    // finalPanelBlocking is projected only by a matched final code-review panel,
    // so exercise that branch by spreading one store-read card, following the
    // same pattern the zero-token test uses to reach an unreachable state.
    const promoted = cards.map((card) => card.intentKey === "a-lowest"
      ? { ...card, finalPanelBlocking: true }
      : { ...card, finalPanelBlocking: card.intentKey === "b-highest" ? false : card.finalPanelBlocking });
    assert.equal(orderFindings(promoted, severities)[0]!.intentKey, "a-lowest",
      "a recorded blocking finding outranks a higher severity that the panel did not block");

    const summary = finalPanelBlockingSummary(promoted);
    assert.equal(summary.nullCount, 2);
    assert.equal(summary.shown.length, 2);
    for (const card of summary.shown) assert.notEqual(card.finalPanelBlocking, null);
    assert.match(summary.statement ?? "", /2 of 4 findings/);
    assert.equal(finalPanelBlockingSummary(promoted.map((card) => ({ ...card, finalPanelBlocking: false }))).statement, null);

    // Severity cannot be ranked against a vocabulary the run never froze.
    assert.deepEqual(cardSeverity(cards[0]!, null), { available: false, severity: null, rank: null });
    assert.deepEqual(cardSeverity(cards[0]!, ["not-a-recorded-severity"]),
      { available: false, severity: null, rank: null });
    assert.equal(cardSeverity(cards.find((card) => card.intentKey === "b-highest")!, severities).severity, highest);
    assert.match(FINDING_ORDER_STATEMENT, /recorded identifier/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("the executive summary is derived from projected records, never from the eligibility prose", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "summary");

    const configured = readStatusResult(root, parent, runId);
    assert.equal(configured.outcome, "ok");
    const severities = severityOrder((configured.result as RunSnapshot).configuration);
    assert.ok(severities !== null && severities.length >= 3,
      "the severity order must come from the run's frozen configuration, not from this test");
    const lowest = severities[0]!;
    const middle = severities[1]!;
    const highest = severities[severities.length - 1]!;

    const store = openStore(root);
    const spec = store.insertStage(runId, "spec", null);
    const agent = store.insertAgentRun({
      stageId: spec.id, agent: "zulu-reviewer", role: "reviewer", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: 120, tokensOut: 40, cacheRead: 8, cacheWrite: 4, cost: 0.5452318,
      durationMs: 100, inputHash: "in", outputHash: "out", rawOutputRef: "raw/a.json",
      independence: "configured_standalone",
    });
    const ids: Record<string, number> = {};
    for (const [intent, severity] of [
      ["a-middle", middle], ["b-highest", highest], ["c-lowest", lowest],
    ] as const) {
      const finding = store.upsertCanonicalFinding(spec.id, 1, intent, `plan.md:${intent}`);
      store.insertFindingReport({
        findingId: finding.id, agentRunId: agent.id, severity,
        classification: "current_artifact", subject: `recorded ${severity}`,
      });
      ids[intent] = finding.id;
    }
    store.close();

    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;
    const options = { repositoryPath: root, runs: [], observedAt: envelope.observedAt };
    const summary = runExecutiveSummary(snapshot, options);

    // No final panel has run, so selection falls to the highest recorded
    // severity and says the final panel projected nothing.
    assert.equal(summary.blockingFinding.available, true);
    assert.equal(summary.blockingFinding.finalPanelProjected, false);
    assert.equal(summary.blockingFinding.id, ids["b-highest"]);
    assert.equal(summary.blockingFinding.severity, highest);
    assert.equal(summary.blockingFinding.location, "plan.md:b-highest");
    assert.equal(summary.blockingFinding.title, "B highest");
    assert.equal(summary.blockingFinding.intentKey, "b-highest");
    assert.equal(summary.blockingFinding.tiedWith, 0);

    // The next action is copied, not composed.
    assert.deepEqual(summary.nextAction.reasons, snapshot.workflowAction.reasons);
    assert.deepEqual(summary.nextAction.args, snapshot.workflowAction.args);
    assert.equal(summary.nextAction.command, snapshot.workflowAction.command);
    assert.equal(summary.nextAction.eligible, snapshot.workflowAction.eligible);
    const recorded = new Set(snapshot.workflowAction.reasons.map((entry) => entry.reason));
    for (const entry of summary.nextAction.reasons) {
      assert.ok(recorded.has(entry.reason), "every reason shown is a recorded reason string");
    }
    assert.deepEqual(summary.state, statusPresentation(snapshot.run.status, snapshot.phase));
    assert.equal(summary.run.project, snapshot.run.project);

    // A recorded blocking decision outranks a higher severity the panel did
    // not block. finalPanelBlocking is projected only by a matched final
    // code-review panel, so reach that branch by spreading store-read records.
    const blocked = runExecutiveSummary({
      ...snapshot,
      evidence: {
        ...snapshot.evidence,
        findings: snapshot.evidence.findings.map((finding) => ({
          ...finding,
          finalPanelBlocking: finding.intentKey === "b-highest" ? false : true,
        })),
      },
    }, options);
    assert.equal(blocked.blockingFinding.finalPanelProjected, true);
    assert.equal(blocked.blockingFinding.finalPanelBlocking, true);
    assert.equal(blocked.blockingFinding.id, ids["a-middle"],
      "among blocking findings the highest severity is named, not the first recorded");
    assert.equal(blocked.blockingFinding.severity, middle);

    // A matched final panel that blocked nothing records false on every card.
    // That is a projected result reporting no blocking finding, and must not be
    // reported as a panel that projected nothing at all.
    const cleanPanel = runExecutiveSummary({
      ...snapshot,
      evidence: {
        ...snapshot.evidence,
        findings: snapshot.evidence.findings.map((finding) => ({ ...finding, finalPanelBlocking: false })),
      },
    }, options);
    assert.equal(cleanPanel.blockingFinding.finalPanelProjected, true,
      "a recorded false is a projected final-panel result");
    assert.equal(cleanPanel.blockingFinding.finalPanelBlocking, false);
    assert.equal(cleanPanel.blockingFinding.id, ids["b-highest"],
      "with nothing blocking, selection falls to the highest recorded severity");
    // The unmatched-panel state stays distinct: every card carries null.
    assert.equal(summary.blockingFinding.finalPanelProjected, false);
    assert.equal(summary.blockingFinding.finalPanelBlocking, false);

    assert.equal(summary.cost.display, "$0.55");
    assert.equal(summary.tokens.known, 172);
    assert.deepEqual(summary.unavailable, []);
    assert.deepEqual(summary.grouped, []);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("an executive summary with no finding, no cost, and no token row states each absence", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "absences");
    const store = openStore(root);
    const spec = store.insertStage(runId, "spec", null);
    store.insertAgentRun({
      stageId: spec.id, agent: "alpha-author", role: "author", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: null, tokensOut: null, cacheRead: null, cacheWrite: null, cost: null,
      durationMs: 10, inputHash: "in", outputHash: "out", rawOutputRef: "raw/a.json",
      independence: "configured_standalone",
    });
    store.close();
    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;
    const summary = runExecutiveSummary(snapshot,
      { repositoryPath: root, runs: [], observedAt: envelope.observedAt });

    assert.equal(summary.blockingFinding.available, false);
    assert.match(summary.blockingFinding.reason ?? "", /0 findings/);
    assert.equal(summary.cost.available, false);
    assert.equal(summary.cost.display, "Unavailable");
    assert.equal(summary.tokens.known, null, "no reporting row is not a zero total");
    assert.equal(summary.unavailable.length, 3);
    // These three absences have three distinct recorded reasons, so nothing
    // collapses here. The contract is one statement per distinct reason with
    // every label carried exactly once — not collapse for its own sake.
    assert.equal(summary.grouped.length, new Set(summary.unavailable.map((row) => row.reason)).size);
    assert.deepEqual(summary.grouped.flatMap((entry) => entry.labels).sort(),
      summary.unavailable.map((row) => row.label).sort());
    for (const entry of summary.grouped) {
      for (const label of entry.labels) assert.match(entry.statement, new RegExp(label));
      assert.match(entry.statement, new RegExp(entry.reason.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    // A run that recorded zeros is a different state from one that recorded
    // nothing, and the summary must keep them distinct.
    const zeroId = newRun(root, parent, "zeros");
    const zeroStore = openStore(root);
    const zeroSpec = zeroStore.insertStage(zeroId, "spec", null);
    zeroStore.insertAgentRun({
      stageId: zeroSpec.id, agent: "alpha-author", role: "author", executor: "claude_code",
      requestedModel: "test-model", effectiveModel: "test-model", fallback: null,
      tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, cost: 0,
      durationMs: 10, inputHash: "in", outputHash: "out", rawOutputRef: "raw/z.json",
      independence: "configured_standalone",
    });
    zeroStore.close();
    const zeroEnvelope = readStatusResult(root, parent, zeroId);
    assert.equal(zeroEnvelope.outcome, "ok");
    const zeroSummary = runExecutiveSummary(zeroEnvelope.result as RunSnapshot,
      { repositoryPath: root, runs: [], observedAt: zeroEnvelope.observedAt });
    assert.equal(zeroSummary.tokens.known, 0);
    assert.equal(zeroSummary.cost.available, true);
    assert.equal(zeroSummary.cost.display, "$0.00");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a closed approval window is derived without contradicting the recorded state", () => {
  const parent = workspace();
  try {
    const root = repository(parent);
    const runId = newRun(root, parent, "approval");
    const store = openStore(root);
    store.insertApproval({
      runId, featureId: "feature", specHash: "a".repeat(64), startingCommit: "b".repeat(40),
      profileHash: "c".repeat(64), risk: "standard", scope: JSON.stringify(["src"]),
      expiresAt: "2026-09-12T11:00:00.000Z", signature: "signature", signer: "operator",
    });
    store.close();
    const envelope = readStatusResult(root, parent, runId);
    assert.equal(envelope.outcome, "ok");
    const snapshot = envelope.result as RunSnapshot;
    assert.equal(snapshot.approval.expiresAt, "2026-09-12T11:00:00.000Z");
    const recordedState = snapshot.approval.state;

    const closed = approvalWindow(snapshot.approval, "2026-09-12T12:00:00.000Z");
    assert.equal(closed.closed, true);
    assert.equal(closed.state, recordedState, "a derived closure never rewrites the recorded state");
    assert.match(closed.statement, /has closed/);
    assert.deepEqual(closed.derivedFrom,
      ["approval.expiresAt 2026-09-12T11:00:00.000Z", "observedAt 2026-09-12T12:00:00.000Z"]);

    const open = approvalWindow(snapshot.approval, "2026-09-12T10:00:00.000Z");
    assert.equal(open.closed, false);
    assert.equal(open.state, recordedState);

    assert.equal(approvalWindow(snapshot.approval, null).closed, null);
    assert.equal(approvalWindow({ ...snapshot.approval, expiresAt: null }, "2026-09-12T12:00:00.000Z").closed, null);

    const projection = snapshotProjection(snapshot, "C:\\cli.ts", "win32", "2026-09-12T12:00:00.000Z");
    assert.equal(projection.governance.approvalWindow.closed, true);
    assert.deepEqual(projection.governance.approval, snapshot.approval);
    assert.equal(snapshotProjection(snapshot, "C:\\cli.ts").governance.approvalWindow.closed, null,
      "without an observation time the window cannot be derived");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a repository leads with its recorded project identity and reports a zero run count in one line", () => {
  // Two roots: the repository helper hard-codes the directory name, so a second
  // repository under the same parent would collide on mkdirSync.
  const populated = workspace();
  const bare = workspace();
  try {
    const root = repository(populated);
    for (const slug of ["alpha", "bravo", "charlie"]) newRun(root, populated, slug);
    const envelope = readRunsResult(root, populated, 20);
    assert.equal(envelope.outcome, "ok");
    const list = envelope.result as { runs: { project: string }[]; limit: number };
    assert.equal(list.runs.length, 3);

    // The recorded project is what the operator recognises, so it leads.
    const loaded = repositoryIdentity(root, list.runs);
    assert.equal(loaded.display, list.runs[0]!.project);
    assert.equal(loaded.source, "project");
    assert.equal(loaded.canonicalPath, root);

    // A repository with no loaded run has no recorded project to lead with, so
    // the final path segment stands in — spaces and all — and the canonical
    // path is still carried verbatim.
    // A repository whose state exists but holds no run: `migrate` creates the
    // store without creating a run, which is the loaded-but-empty case the
    // one-line rule governs. A repository with no state at all refuses the read
    // outright and takes the separate no-run-list branch instead.
    const emptyRoot = repository(bare);
    const migrated = spawnSync(process.execPath, [CLI, "migrate", "--repo", emptyRoot],
      { cwd: bare, encoding: "utf8" });
    assert.equal(migrated.status, 0, migrated.stderr);
    const emptyEnvelope = readRunsResult(emptyRoot, bare, 20);
    assert.equal(emptyEnvelope.outcome, "ok");
    const emptyList = emptyEnvelope.result as { runs: { project: string }[] };
    assert.equal(emptyList.runs.length, 0);
    const unloaded = repositoryIdentity(emptyRoot, emptyList.runs);
    assert.equal(unloaded.display, "target with spaces");
    assert.equal(unloaded.source, "path_segment");
    assert.equal(unloaded.canonicalPath, emptyRoot);
    assert.ok(unloaded.display.includes(" "),
      "the recorded directory name carries spaces; the identity must not normalise them away");
  } finally {
    rmSync(populated, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

test("display-only command text quotes shell metacharacters without changing projected argv", () => {
  const args = ["--repo", "C:\\repo with spaces\\operator's", "--run", "7", "<signature-file>", "$(touch nope)"];
  const windows = commandText("C:\\tool path\\src\\cli.ts", "status", args, "win32");
  assert.equal(windows,
    "& node 'C:\\tool path\\src\\cli.ts' 'status' '--repo' 'C:\\repo with spaces\\operator''s' '--run' '7' '<signature-file>' '$(touch nope)'");
  const posix = commandText("/tool path/src/cli.ts", "status", args, "linux");
  assert.equal(posix,
    "node '/tool path/src/cli.ts' 'status' '--repo' 'C:\\repo with spaces\\operator'\"'\"'s' '--run' '7' '<signature-file>' '$(touch nope)'");
});

test("keyboard policy suppresses editable targets, disabled shortcuts, and unavailable destinations", () => {
  assert.equal(isEditableTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: "BUTTON" }), false);
  assert.equal(shortcutDestination("/", null), "run-search");
  assert.equal(shortcutDestination("g", "r"), "runs");
  assert.equal(shortcutDestination("g", "f"), "findings");
  assert.equal(shortcutDestination("g", "a"), "governance");
  assert.equal(shortcutDestination("g", "t"), null);
  assert.equal(shortcutDestination("g", "r", true), null);
  assert.equal(shortcutDestination("g", "r", false, true), null);
});

/** WCAG 2.1 relative luminance, computed here rather than taken on trust. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function declaredTokens(css: string, selector: string): Map<string, string> {
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "s").exec(css);
  assert.ok(block, `${selector} declares no token block`);
  const tokens = new Map<string, string>();
  for (const match of block[1]!.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(match[1]!, match[2]!);
  }
  return tokens;
}

/**
 * The eight categorical chart colours a theme declares. The light values sit at
 * column zero and the explicit dark overrides carry the theme selector, so the
 * line anchor keeps the indented `prefers-color-scheme` copies out of both.
 */
function seriesColours(css: string, prefix: string): Map<string, string> {
  const colours = new Map<string, string>();
  const pattern = new RegExp(`^${prefix}\\.series-([1-8])\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6})\\s*;\\s*\\}`, "gm");
  for (const match of css.matchAll(pattern)) colours.set(match[1]!, match[2]!);
  return colours;
}

test("declared theme tokens meet the 4.5:1 text contrast requirement in both themes", () => {
  const css = readFileSync(resolve("src", "dashboard", "styles.css"), "utf8");
  // Every token that carries text against every surface that can sit behind it.
  // A new state colour or a new surface joins this product automatically.
  const foregrounds = ["--text", "--muted", "--primary", "--success", "--warning",
    "--error", "--critical", "--active", "--neutral"];
  const backgrounds = ["--panel", "--background", "--surface-raised", "--surface-sunken"];
  for (const [selector, theme] of [[":root", "light"], ['\\[data-theme="dark"\\]', "dark"]] as const) {
    const tokens = declaredTokens(css, selector);
    for (const foreground of foregrounds) {
      for (const background of backgrounds) {
        const front = tokens.get(foreground);
        const back = tokens.get(background);
        assert.ok(front && back, `${theme} theme declares ${foreground} and ${background}`);
        const ratio = contrast(front, back);
        assert.ok(ratio >= 4.5, `${theme} ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
      }
    }
  }
  // The reference pair proves the calculation itself, not just the tokens.
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
});

test("non-text state indicators meet the 3:1 contrast requirement in both themes", () => {
  const css = readFileSync(resolve("src", "dashboard", "styles.css"), "utf8");
  for (const [selector, prefix, theme] of [
    [":root", "", "light"],
    ['\\[data-theme="dark"\\]', ':root\\[data-theme="dark"\\] ', "dark"],
  ] as const) {
    const panel = declaredTokens(css, selector).get("--panel");
    assert.ok(panel, `${theme} theme declares --panel`);
    const colours = seriesColours(css, prefix);
    assert.equal(colours.size, 8, `${theme} theme declares eight series colours`);
    for (const [series, colour] of colours) {
      const ratio = contrast(colour, panel);
      assert.ok(ratio >= 3, `${theme} series-${series} ${colour} on --panel is ${ratio.toFixed(2)}:1`);
    }
  }
  // 3:1 is a real boundary, proved against the published greyscale limit:
  // #949494 is the lightest grey that still reaches 3:1 on white, #959595 is
  // the next step and does not.
  assert.ok(contrast("#949494", "#ffffff") >= 3);
  assert.ok(contrast("#959595", "#ffffff") < 3);
});

test("static assets keep the approved accessible boundary and omit unauthorized transports", () => {
  const html = readFileSync(resolve("src", "dashboard", "index.html"), "utf8");
  const css = readFileSync(resolve("src", "dashboard", "styles.css"), "utf8");
  const script = readFileSync(resolve("src", "dashboard", "app.js"), "utf8");
  const model = readFileSync(resolve("src", "dashboard", "dashboard-model.js"), "utf8");
  for (const landmark of ["<header", "<nav", "<main", "<footer", "aria-live", "shortcut"]) {
    assert.ok(html.includes(landmark), landmark);
  }
  assert.match(html, /read-only/i);
  for (const token of ["--background", "--panel", "--primary", "--success", "--warning", "--error", "--text"]) {
    assert.ok(css.includes(token), token);
  }
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(css, /#repository-filter\s*\{[^}]*width:\s*min\(32rem,\s*100%\)/s);
  assert.match(css, /main\s*>\s*\*\s*\{[^}]*min-width:\s*0/s);
  for (const series of [1, 2, 3, 4, 5, 6, 7, 8]) assert.match(css, new RegExp(`\\.series-${series}\\b`));

  // The surface and accent tokens are declared by every theme block, including
  // the `prefers-color-scheme` copy, and every declared token is referenced.
  for (const token of ["--surface-raised", "--surface-sunken", "--accent-wash"]) {
    assert.equal(css.match(new RegExp(`${token}:`, "g"))?.length, 3, `${token} declared in three theme blocks`);
  }
  for (const token of ["--accent", "--surface-raised", "--surface-sunken", "--accent-wash"]) {
    assert.match(css, new RegExp(`var\\(${token}\\)`), `${token} is used, not merely declared`);
  }
  // One state scale: the finding card takes the same tone classes the badges
  // and timeline markers take, and the charts keep the separate series scale
  // because they encode agents and stages rather than state.
  assert.ok(script.includes("`finding-card tone-${tone}`"),
    "the finding card carries a tone class from the shared state scale");
  assert.ok(script.includes("`summary-head tone-${summary.state.tone}`"),
    "the executive summary head carries a tone class from the shared state scale");
  assert.match(css, /\.finding-card\s*\{[^}]*border-left:\s*4px solid currentcolor/s);

  // What the visual observation can be held to mechanically: focus is never
  // suppressed, the indicator rule stays unscoped so it reaches the new
  // disclosure summaries and copy buttons, and every auto-fit grid clamps its
  // track so a 320 CSS-pixel viewport produces no document-level scrolling.
  assert.doesNotMatch(css, /outline:\s*(none|0)\b/);
  assert.match(css, /(^|\n):focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/s);
  const autoFit = css.match(/repeat\(auto-fit,\s*minmax\([^)]*\)[^)]*\)/g) ?? [];
  assert.ok(autoFit.length >= 3, "every responsive region is an auto-fit grid");
  for (const grid of autoFit) {
    assert.match(grid, /minmax\(min\(\d+(\.\d+)?rem, 100%\), 1fr\)/, grid);
  }

  // The read-only boundary: no mutating method, no push transport, no timer,
  // and no markup parsed from a projected value.
  assert.doesNotMatch(script, /\bWebSocket\b|\bEventSource\b|\bsetInterval\b|innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(script, /fetch\([^)]*\{[^}]*method\s*:/s);
  assert.doesNotMatch(model, /\bdocument\.|\bwindow\.|\bfetch\(|\bXMLHttpRequest\b|\blocalStorage\b|\bsessionStorage\b/);

  // Presentation no longer falls back to serialized state, and the CSP forbids
  // inline style, so no rule may be assigned from script.
  assert.doesNotMatch(script, /JSON\.stringify/);
  assert.doesNotMatch(script, /\bjsonSection\b/);
  assert.doesNotMatch(script, /\.style\./);
  assert.doesNotMatch(script, /setAttribute\(\s*["']style["']/);

  // The shell ships aria-busy="true"; the terminal-failure screen must clear
  // it, or a screen reader suppresses the message it just placed there.
  assert.match(html, /<main id="dashboard" tabindex="-1" aria-busy="true">/);
  assert.match(script, /function showSessionExpired\([^)]*\)\s*\{[^}]*setAttribute\("aria-busy", "false"\)/s);

  // Density restructure. The run view opens on one triage summary with the
  // findings section still expanded, and every other section is a native
  // disclosure whose content is built before it is ever opened.
  assert.match(script, /function collapsibleSection\(/);
  assert.match(script, /function renderExecutiveSummary\(/);
  assert.doesNotMatch(script, /function renderSummary\b|function renderLimitations\b/);
  assert.match(script, /renderExecutiveSummary\(summary, projection, application\),\s*renderFindings\(projection, application\),/);
  for (const [title, id] of [
    ["Governed actions", "governance"], ["Cost and tokens", "cost-and-tokens"],
    ["Workflow timeline", "workflow"], ["Activity", "activity"], ["Agent analytics", "agents"],
    ["Frozen configuration and approval", "configuration"], ["Delivery", "delivery"],
    ["Evidence", "evidence"],
  ] as const) {
    assert.ok(script.includes(`panel("${title}", "${id}")`), `${title} keeps id ${id}`);
  }

  // Collapse is presentation only. It is never restored from storage and never
  // reaches the route, so the single open assignment is the focus handler that
  // keeps a keyboard shortcut from landing on hidden content.
  assert.equal((script.match(/\.open\s*=/g) ?? []).length, 1);
  assert.match(script, /addEventListener\("focus", \(\) => \{ details\.open = true; \}\)/);
  assert.doesNotMatch(script, /addEventListener\("toggle"/);

  // Narrowed presentation replaced the raw helpers outright, so no call site can
  // still print an unrounded total or a bare recorded UTC string.
  assert.doesNotMatch(script, /function usd\(|function timeNode\(/);
  for (const helper of ["moneyNode", "recordedTime", "identityNode", "copyControl"]) {
    assert.match(script, new RegExp(`function ${helper}\\(`), helper);
  }

  // Finding cards are ranked and their applicability is stated. Scope the
  // absence-label rule to the finding renderers themselves: the same labels are
  // legitimate elsewhere, so a whole-file match would pass or fail by accident.
  for (const call of ["orderFindings(", "forbiddenFieldStatement(", "finalPanelBlockingSummary(", "cardSeverity("]) {
    assert.ok(script.includes(call), call);
  }
  const findingsStart = script.indexOf("function findingCardNode(");
  const findingsEnd = script.indexOf("function renderGovernance(");
  assert.ok(findingsStart > 0 && findingsEnd > findingsStart, "the finding renderers bound a region to assert against");
  const findingsBody = script.slice(findingsStart, findingsEnd);
  // Both forbidden branches must be inside the finding renderers and must be
  // reached before the recorded-value branch, so a structurally forbidden field
  // can never fall through to an absence label.
  assert.equal((findingsBody.match(/forbiddenFieldStatement\(/g) ?? []).length, 2);
  assert.match(findingsBody, /applicability\.grounding === "forbidden"[^]*?\} else \{[^]*?text\(decision\.groundingSource/);
  assert.match(findingsBody, /applicability\.normativeChanges === "forbidden"[^]*?\} else if \(!changes\.available\)/);
  // A malformed stored record stays a separately named condition, distinct from
  // a field the recorded disposition structurally forbids.
  assert.match(findingsBody, /MALFORMED_NORMATIVE_REASON/);

  // A zero-run repository returns after one line: no definition list, no
  // disclosure, and no trailing run-limit note wrapped around an empty state.
  // Sliced out of the source so the assertion constrains the branch body
  // itself, not merely that a return exists somewhere after it.
  const zeroStart = script.indexOf("if (list.runs.length === 0) {");
  assert.ok(zeroStart > 0, "renderRepository carries a zero-run branch");
  const zeroEnd = script.indexOf("parent.append(article);", zeroStart);
  assert.ok(zeroEnd > zeroStart, "the zero-run branch appends and returns");
  const zeroBranch = script.slice(zeroStart, zeroEnd);
  assert.match(script.slice(zeroEnd), /^parent\.append\(article\);\n {4}return;/);
  for (const forbidden of ["definitionList(", "disclosure(", "runLimit", "hasMore"]) {
    assert.ok(!zeroBranch.includes(forbidden),
      `the zero-run branch renders no ${forbidden}: ${zeroBranch}`);
  }
  // The repeated per-card trend label became one statement for the region.
  assert.doesNotMatch(script, /const trend = element\("p", null, "kpi-trend"\)/);
  const kpiStart = script.indexOf("function kpiCard(");
  const kpiEnd = script.indexOf("function renderRepository(");
  assert.ok(kpiStart > 0 && kpiEnd > kpiStart, "the portfolio renderers bound a region to assert against");
  const kpiBody = script.slice(kpiStart, kpiEnd);
  assert.equal((kpiBody.match(/TREND_UNAVAILABLE_LABEL/g) ?? []).length, 1);

  // The next action's own command is projected under the kind "workflow". An
  // execution group is never a command kind, so matching on action.group would
  // resolve to null on every render and silently drop the command.
  assert.ok(script.includes('command.kind === "workflow"'),
    "the next-action tile looks up the command kind the projection assigns");
  assert.ok(!script.includes("command.kind === action.group"),
    "the next-action tile does not compare a command kind to an execution group");
  // R10: the run view decides the latest timestamp through the model, and the
  // superseded ones go to the disclosure rather than beside it.
  assert.match(script, /const stamps = latestTimestamp\(\[/);
  assert.match(script, /stamps\.others\.map\(/);
  assert.match(script, /stamps\.latest !== null/);
  // Every collapsed section states a count; none is left unstated.
  const appendStart = script.indexOf("renderExecutiveSummary(summary, projection, application),");
  assert.ok(appendStart > 0, "the run view appends its sections in one place");
  const appendBody = script.slice(appendStart, script.indexOf("aria-busy", appendStart));
  assert.equal((appendBody.match(/collapsibleSection\(/g) ?? []).length, 8);
  assert.ok(!appendBody.includes("collapsibleSection(null,"),
    `every collapsed section states its count: ${appendBody}`);
});
