import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAuditChain } from "../src/audit.ts";
import { canonicalJson, sha256Hex } from "../src/canonical.ts";
import type { ExecutorDefinition } from "../src/executor.ts";
import {
  NARRATION_AGENT,
  NARRATION_INTENT,
  narrationQuestion,
  narrationQuestionHash,
  narrationState,
} from "../src/narration-check.ts";
import { SYSTEMONE_REQUEST_TIMEOUT_MS, policyHash } from "../src/policy.ts";
import type { NarrationCheckConfig } from "../src/profile.ts";
import { runSpecStage } from "../src/spec-stage.ts";
import { openStore, type AgentRunRow, type Store } from "../src/store.ts";
import { freezeUniformProfile } from "./uniform-profile.ts";
import {
  ALWAYS_CRITERION,
  RECORDED_CRITERION,
  RECORDED_REMARK,
  withStandIn,
  type StandIn,
  type StandInAnswer,
  type StandInReply,
} from "./systemone-stand-in.ts";

/**
 * The narration check inside `runSpecStage`
 * (`docs/features/narration-check-spec-review/plan.md`, Task 5), against the
 * loopback stand-in, which replays only recorded Decision-1 bodies. The stage's
 * author, reviewers and reconciler are the shared spec-stage harness fixture.
 */

const RECORDED = join(process.cwd(), "test", "fixtures", "recorded");
const FIXTURE = join(process.cwd(), "test", "fixtures", "harness", "emit-spec-stage.mjs");
const EVALUATION = JSON.parse(readFileSync(join(RECORDED, "systemone-format-checks-evaluation.json"), "utf8")) as {
  requests: Array<{ check: string; questionHash: string }>;
};
const PROBE = JSON.parse(readFileSync(join(RECORDED, "systemone-probe-snitch-resource.json"), "utf8")) as {
  records: Array<{ label: string; body: unknown }>;
};

function fixtureExecutor(): ExecutorDefinition {
  return {
    id: "claude-code",
    command: ["node", FIXTURE],
    probe: ["node", "--version"],
    capabilities: ["spec", "plan", "review", "implementation"],
    telemetry: { perInvocationModel: true, effectiveModel: true, tokenUsage: true, sessionCost: true },
    sandbox: {
      allowedPaths: [],
      deniedPaths: [],
      commandAllowlist: [],
      idleTimeoutSeconds: 30,
      absoluteTimeoutSeconds: 120,
      envPassthrough: ["PATH", "SystemRoot", "TEMP", "TMP"],
      network: "inherit",
    },
  };
}

interface Ctx {
  store: Store;
  root: string;
  runId: number;
}

/**
 * A run frozen with the fixture executor and, unless `narration` is null, the
 * narration check pointed at the stand-in. The profile is re-hashed onto the
 * run row, as `freezeExecutorIntoProfile` does in test/spec-stage.test.ts.
 */
async function withNarratedRun(
  standIn: StandIn,
  narration: (base: NarrationCheckConfig) => NarrationCheckConfig | null,
  fn: (ctx: Ctx) => Promise<void>
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "bw-narration-"));
  const store = openStore(root);
  try {
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git("init", "-q");
    writeFileSync(join(root, "base.txt"), "base");
    git("add", "-A");
    git("-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "-m", "base");
    const run = store.insertRun("p", "f-1", "demo", "feature");
    const frozen = freezeUniformProfile(root, run.id, git("rev-parse", "HEAD"), "m", { commands: [{ name: "unit", command: ["node", "--version"] }] });
    const profile = JSON.parse(readFileSync(frozen.path, "utf8")) as Record<string, unknown>;
    profile.executor = fixtureExecutor();
    profile.narrationCheck = narration({
      endpoint: standIn.env.SYSTEMONE_ENDPOINT!,
      deployment: standIn.env.SYSTEMONE_DEPLOYMENT!,
      deploymentType: standIn.env.SYSTEMONE_DEPLOYMENT_TYPE!,
      threshold: 0.8,
      timeoutMs: SYSTEMONE_REQUEST_TIMEOUT_MS,
      questionHash: narrationQuestionHash(),
    });
    const serialized = canonicalJson(profile);
    writeFileSync(frozen.path, serialized);
    store.setProfileRef(run.id, sha256Hex(serialized));
    mkdirSync(join(root, "docs", "features", "demo"), { recursive: true });
    writeFileSync(join(root, "docs", "features", "demo", "design.md"), "# design\n");
    await fn({ store, root, runId: run.id });
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function agentRuns(store: Store, runId: number): AgentRunRow[] {
  return store.query<AgentRunRow>("SELECT a.* FROM agent_run a JOIN stage s ON s.id = a.stage_id WHERE s.run_id = ? ORDER BY a.id", [runId]);
}

function narrated(answer: StandInAnswer, fn: (ctx: Ctx, standIn: StandIn) => Promise<void>, narration = (base: NarrationCheckConfig): NarrationCheckConfig | null => base) {
  return withStandIn(answer, (standIn) => withNarratedRun(standIn, narration, (ctx) => fn(ctx, standIn)));
}

// ---- the question --------------------------------------------------------------

test("the frozen question is the one the 2026-10-17 evaluation sent", () => {
  const recorded = new Set(EVALUATION.requests.filter((r) => r.check === "narration").map((r) => r.questionHash));
  assert.deepEqual([...recorded], [narrationQuestionHash()]);
});

// ---- the stage ------------------------------------------------------------------

test("a clean specification gets one recorded answer per criterion and no finding", async () => {
  await narrated(ALWAYS_CRITERION, async ({ store, root, runId }, standIn) => {
    const result = await runSpecStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    const review = store.getStageChain(runId).find((s) => s.kind === "spec_review")!;
    const answers = store.getCheckAnswers(review.id);
    assert.equal(standIn.requests.length, answers.length);
    assert.ok(answers.length > 0);
    assert.ok(answers.every((a) => a.flagged === 0 && a.finding_id === null && a.choice === "criterion"));
    assert.ok(!store.getCanonicalFindings(review.id).some((f) => f.intent_key === NARRATION_INTENT));
    // What was sent: the evaluated question and state, the frozen deployment, the key in its header.
    const recordedModel = JSON.parse(RECORDED_CRITERION).model as string;
    for (const [index, request] of standIn.requests.entries()) {
      assert.equal(request.headers["api-key"], standIn.key);
      assert.equal(request.body.model, standIn.env.SYSTEMONE_DEPLOYMENT);
      assert.deepEqual(request.body.questions, { narration: narrationQuestion() });
      assert.equal(sha256Hex(request.body.state), answers[index]!.state_hash);
    }
    const narration = agentRuns(store, runId).filter((a) => a.agent === NARRATION_AGENT);
    assert.equal(narration.length, answers.length);
    for (const run of narration) {
      assert.deepEqual(
        { executor: run.executor, role: run.role, effort: run.requested_effort, cost: run.cost, model: run.effective_model, stage: run.stage_id, setting: run.setting },
        { executor: "systemone", role: "reviewer", effort: null, cost: null, model: recordedModel, stage: review.id, setting: NARRATION_AGENT }
      );
      const raw = readFileSync(join(root, run.raw_output_ref), "utf8");
      assert.ok(raw.includes(JSON.stringify(RECORDED_CRITERION)), "the response body is retained as received");
      assert.ok(!raw.includes(standIn.key), "the key is never retained");
    }
    assert.equal(store.getAuditEvents(runId).filter((e) => e.action === "spec.narration.answer").length, answers.length);
    assert.equal(verifyAuditChain(store), null);
  });
});

test("each round asks about the specification its panel reviews, with the evaluated state", async () => {
  await narrated(ALWAYS_CRITERION, async ({ store, root, runId }, standIn) => {
    // Two rounds frozen, as freezePolicyInto does in test/spec-stage.test.ts;
    // the seeded policy runs one (SPEC_REVIEW_ROUNDS).
    const path = join(root, ".governance", "profiles", String(runId), "profile.json");
    const profile = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    profile.policy = { ...(profile.policy as Record<string, unknown>), specReviewRounds: 2 };
    profile.policyHash = policyHash(profile.policy as never);
    const serialized = canonicalJson(profile);
    writeFileSync(path, serialized);
    store.setProfileRef(runId, sha256Hex(serialized));
    const result = await runSpecStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    // The fixture's round-1 panel reviews its self-critique revision and
    // reports; the reconciler's revision is what the clean round-2 panel reviews
    // (test/fixtures/harness/emit-spec-stage.mjs).
    assert.deepEqual(
      standIn.requests.map((r) => r.body.state),
      ["- AC-001: the thing works SELFCRITIQUED", "- AC-001: the thing works REVISED-spec"].map(narrationState)
    );
  });
});

test("a flagged criterion becomes a round finding the reconciler answers, and its answer names it", async () => {
  await narrated(() => ({ status: 200, body: RECORDED_REMARK }), async ({ store, root, runId }) => {
    const result = await runSpecStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    const review = store.getStageChain(runId).find((s) => s.kind === "spec_review")!;
    const finding = store.getCanonicalFindings(review.id).find((f) => f.intent_key === NARRATION_INTENT);
    assert.ok(finding, "the flagged criterion is a canonical finding");
    assert.equal(finding.round, 1);
    assert.match(finding.location, /^AC-\d{3}$/);
    const [report] = store.getFindingReports(finding.id);
    assert.equal(store.getAgentRun(report!.agent_run_id)!.agent, NARRATION_AGENT);
    assert.deepEqual({ severity: report!.severity, classification: report!.classification }, { severity: "medium", classification: "current_artifact" });
    assert.match(report!.subject, new RegExp(`^${finding.location} carries the author's remark .* contains-remark at 0\\.980, threshold 0\\.8\\)`));
    const answer = store.getCheckAnswers(review.id).find((a) => a.subject === finding.location)!;
    assert.deepEqual({ flagged: answer.flagged, finding: answer.finding_id }, { flagged: 1, finding: finding.id });
    // The fixture reconciler decides exactly the finding ids its prompt names.
    assert.ok(store.getFindingDecisions(review.id).some((d) => d.finding_id === finding.id), "the reconciler received and answered it");
  });
});

for (const [name, reply, timeoutMs, reason] of [
  ["a 500", { status: 500, body: JSON.stringify({ error: { code: "InternalServerError", message: "stand-in failure" } }) } as StandInReply | "hang", SYSTEMONE_REQUEST_TIMEOUT_MS, /^narration request for AC-\d{3} failed with status 500: HTTP 500 InternalServerError \(retained \.governance[\\/]raw[\\/]/],
  ["a body that answers another question", { status: 200, body: JSON.stringify(PROBE.records.find((r) => r.label === "sky-api-key")!.body) } as StandInReply | "hang", SYSTEMONE_REQUEST_TIMEOUT_MS, /failed with status 200: the response failed validation: /],
  ["a request that never answers", "hang" as StandInReply | "hang", 200, /^narration request for AC-\d{3} failed: timed out after 200 ms/],
] as const) {
  test(`${name} blocks the stage and the run before the panel spends, with the response retained`, async () => {
    await narrated(() => reply, async ({ store, root, runId }, standIn) => {
      const result = await runSpecStage(store, fixtureExecutor(), { runId, rootDir: root });
      assert.equal(result.ok, false);
      assert.match(result.ok ? "" : result.reason, reason);
      assert.equal(standIn.requests.length, 1, "no retry, and no later criterion asked");
      assert.equal(store.getRun(runId)!.status, "blocked");
      const review = store.getStageChain(runId).find((s) => s.kind === "spec_review")!;
      assert.equal(review.status, "blocked");
      assert.ok(!agentRuns(store, runId).some((a) => a.role === "reviewer"), "no reviewer and no narration agent run");
      assert.deepEqual(store.getCheckAnswers(review.id), []);
      const failed = store.getAuditEvents(runId).filter((e) => e.action === "spec.narration.failed");
      assert.equal(failed.length, 1);
      const retained = /\(retained ([^)]+)\)/.exec(failed[0]!.summary)?.[1];
      assert.ok(retained && existsSync(join(root, retained)), "the failed response is retained");
      const record = readFileSync(join(root, retained), "utf8");
      assert.ok(!record.includes(standIn.key));
      assert.equal(JSON.parse(record).outcome.body, reply === "hang" ? null : reply.body, "the body is retained as received");
    }, (base) => ({ ...base, timeoutMs }));
  });
}

test("a question changed since the run froze it, or a missing key, refuses before any stage row", async () => {
  await narrated(ALWAYS_CRITERION, async ({ store, root, runId }, standIn) => {
    const result = await runSpecStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.match(result.ok ? "" : result.reason, new RegExp(`^the narration question changed since run ${runId} started \\(frozen ${"0".repeat(64)}, code ${narrationQuestionHash()}\\)`));
    assert.deepEqual(store.getStageChain(runId), []);
    assert.equal(standIn.requests.length, 0);
    assert.equal(store.getRun(runId)!.status, "in_progress", "a configuration refusal blocks nothing");
  }, (base) => ({ ...base, questionHash: "0".repeat(64) }));
  await narrated(ALWAYS_CRITERION, async ({ store, root, runId }, standIn) => {
    delete process.env.SYSTEMONE_API_KEY;
    const result = await runSpecStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.equal(result.ok ? "" : result.reason, "narration check: SYSTEMONE_API_KEY is not set");
    assert.deepEqual(store.getStageChain(runId), []);
    assert.equal(standIn.requests.length, 0);
  });
});

test("a run frozen with the check off sends nothing", async () => {
  await narrated(ALWAYS_CRITERION, async ({ store, root, runId }, standIn) => {
    const result = await runSpecStage(store, fixtureExecutor(), { runId, rootDir: root });
    assert.ok(result.ok, result.ok ? "" : result.reason);
    assert.equal(standIn.requests.length, 0);
    assert.ok(!agentRuns(store, runId).some((a) => a.agent === NARRATION_AGENT));
  }, () => null);
});
